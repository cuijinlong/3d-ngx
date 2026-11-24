import type { ScenePlatformRef } from "@idt/shared-types";
import {
  widgetScopeKey,
  type SceneWidget,
  type SceneWidgetScope,
  type TopologySite,
} from "@idt/data-adapter";
import { widgetBindableDevices } from "./widget-values";
import styles from "./WidgetOverlay.module.css";
import { assetPickerErrorText, useAssetAttributeKeys, useCustomerAssets } from "../../hooks/useAssetPicker";

function scopeSelectValue(scope?: SceneWidgetScope): string {
  return widgetScopeKey(scope) ?? "";
}

function ScopeBinder(props: {
  widget: SceneWidget;
  platform?: ScenePlatformRef;
  sites: TopologySite[];
  aggregate: boolean;
  scopeOptionsAvailable?: boolean;
  onChange: (scope: SceneWidgetScope | undefined) => void;
}) {
  const { platform, sites } = props;
  const options: Array<{ value: string; label: string; scope: SceneWidgetScope }> = [];
  if (platform?.siteId) {
    options.push({
      value: `site:${platform.siteId}`,
      label: platform.siteName ? `本场景场站（${platform.siteName}）` : "本场景场站",
      scope: { kind: "site", siteId: platform.siteId, siteName: platform.siteName },
    });
  }
  if (platform?.topologyId) {
    options.push({
      value: `topology:${platform.topologyId}`,
      label: platform.topologyName ? `本场景拓扑（${platform.topologyName}）` : "本场景拓扑",
      scope: {
        kind: "topology",
        topologyId: platform.topologyId,
        topologyName: platform.topologyName,
        siteId: platform.siteId,
        siteName: platform.siteName,
      },
    });
  }
  for (const site of sites) {
    if (site.id && !options.some((item) => item.value === `site:${site.id}`)) {
      options.push({
        value: `site:${site.id}`,
        label: site.name ? `场站（${site.name}）` : `场站 ${site.id}`,
        scope: { kind: "site", siteId: site.id, siteName: site.name },
      });
    }
  }

  return (
    <>
      <label className={styles.field}>
        <span>{props.aggregate ? "汇总范围" : "先限定范围（可选）"}</span>
        <select
          data-testid="widget-scope-select"
          value={scopeSelectValue(props.widget.scope)}
          onChange={(event) => {
            const next = options.find((item) => item.value === event.target.value);
            props.onChange(next?.scope);
          }}
        >
          <option value="">{props.aggregate ? "选择场站或本场景拓扑" : "不限定，直接选设备"}</option>
          {options.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      {props.aggregate ? (
        <p className={styles.hint}>选中范围后，这张卡会按范围内的实时设备自动汇总。没有选范围时不会用模型上已绑的设备凑数。</p>
      ) : (
        <p className={styles.hint}>限定范围只缩小下面的设备列表，不会自动出数，还要再选实时设备和测点。</p>
      )}
      {props.scopeOptionsAvailable ? (
        <p className={styles.hint}>平台目前只能按场站或本场景拓扑列出实时设备，分组名称可以查到，但还不能按分组汇总。</p>
      ) : null}
    </>
  );
}

function slotPresetsForType(type: string, slotCount: number): Array<Partial<import("@idt/data-adapter").SceneWidgetSlot> & { key: string; label: string }> {
  if (type === "metric-card") {
    return [
      { key: "main", label: "主值" },
      { key: "left", label: "左分解" },
      { key: "right", label: "右分解" },
    ];
  }
  if (type === "ratio-ring") {
    const groups = Math.max(1, Math.ceil(slotCount / 2) || 1);
    const list: Array<{ key: string; label: string }> = [];
    for (let index = 0; index < groups; index += 1) {
      list.push({ key: `used-${index}`, label: `已用 ${index + 1}` });
      list.push({ key: `total-${index}`, label: `总数 ${index + 1}` });
    }
    return list;
  }
  if (type === "trend-chart") {
    const count = Math.max(1, slotCount);
    return Array.from({ length: count }, (_, index) => ({ key: `series-${index}`, label: `系列 ${index + 1}` }));
  }
  return [{ key: "value", label: "绑定设备" }];
}

/**
 * 槽位绑定器（2026-11-23 起支持资产属性）。
 *
 * <h2>为什么用「来源」切换而不是两个独立下拉</h2>
 *
 * 一个槽只能有一种来源：要么读设备遥测，要么读资产属性。
 * 并排放两个下拉会让人以为可以同时填，填完却只有一种生效 ——
 * 那种「填了没用」的状态最难排查。
 *
 * <h2>资产模式只用于「设备级指标表达不了的东西」</h2>
 *
 * 装机容量、投运日期、合同编号这类属于资产自身属性，设备上没有；
 * 而机组出水温度仍应走设备遥测（有 ts、有新鲜度）。
 * 所以资产下拉只列客户资产、属性下拉只列该资产已存在的属性键。
 */
function SlotBinder(props: {
  label: string;
  slot?: import("@idt/data-adapter").SceneWidgetSlot;
  bindOptions: ReturnType<typeof widgetBindableDevices>;
  customerId?: string;
  onBind: (deviceId: string, telemetryKey?: string) => void;
  onBindAsset: (assetId: string, attributeKey?: string) => void;
}) {
  const slot = props.slot;
  const assetMode = Boolean(slot?.assetId);
  const assets = useCustomerAssets(props.customerId, assetMode && Boolean(props.customerId));
  const attrs = useAssetAttributeKeys(slot?.assetId, assetMode);
  const assetError = assetPickerErrorText(assets.error);
  const attrError = assetPickerErrorText(attrs.error);

  return (
    <>
      <label className={styles.field}>
        <span>{props.label} · 来源</span>
        <select
          value={assetMode ? "asset" : "device"}
          onChange={(event) => {
            /*
             * 切到资产时先清空设备侧字段（assetId 留空 = 还没选资产）；
             * 切回设备时清空资产侧字段。互斥由 assignWidgetAssetSlot /
             * assignWidgetSlot 保证，这里只负责发起切换。
             */
            if (event.target.value === "asset") props.onBindAsset("", undefined);
            else props.onBind("", undefined);
          }}
        >
          <option value="device">设备遥测</option>
          <option value="asset">资产属性</option>
        </select>
      </label>

      {assetMode ? (
        <>
          <label className={styles.field}>
            <span>资产</span>
            <select
              value={slot?.assetId ?? ""}
              onChange={(event) => props.onBindAsset(event.target.value, undefined)}
            >
              <option value="">{assets.loading ? "读取中…" : "选择资产"}</option>
              {assets.assets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label || item.name}
                </option>
              ))}
            </select>
          </label>
          {assetError ? <p className={styles.hint}>{assetError}</p> : null}
          {slot?.assetId ? (
            <label className={styles.field}>
              <span>属性</span>
              <select
                value={slot.attributeKey ?? ""}
                onChange={(event) => props.onBindAsset(slot.assetId!, event.target.value)}
              >
                <option value="">{attrs.loading ? "读取中…" : "选择属性"}</option>
                {attrs.attributes.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {attrError ? <p className={styles.hint}>{attrError}</p> : null}
          {slot?.assetId && !attrs.loading && !attrs.attributes.length && !attrError ? (
            <p className={styles.hint}>这个资产还没有任何属性。先在设备/资产管理里写入属性值。</p>
          ) : null}
        </>
      ) : (
        <>
          <label className={styles.field}>
            <span>{props.label}</span>
            <select
              value={slot?.deviceId ?? ""}
              onChange={(event) => props.onBind(event.target.value)}
            >
              <option value="">选择实时设备</option>
              {props.bindOptions.map((item) => (
                <option key={item.deviceId} value={item.deviceId}>
                  {item.deviceName || item.deviceId}
                </option>
              ))}
            </select>
          </label>
          {slot?.deviceId ? (
            <label className={styles.field}>
              <span>遥测或属性</span>
              <select
                value={slot.telemetryKey || slot.key || ""}
                onChange={(event) => props.onBind(slot.deviceId!, event.target.value)}
              >
                {(props.bindOptions.find((item) => item.deviceId === slot.deviceId)?.keys ?? []).map((item) => (
                  <option key={item.telemetryKey} value={item.telemetryKey}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      )}
    </>
  );
}

export { scopeSelectValue, ScopeBinder, slotPresetsForType, SlotBinder };
