import { Button } from "antd";
import { useMemo, useState } from "react";
import type { Device, DeviceBinding, ParsedHmiScene, SceneEntity, TelemetryRecord } from "@idt/shared-types";
import { formatPlatformDeviceName, getMockController, getProviderKind } from "@idt/data-adapter";
import {
  BROWSE_COPY,
  browseEmptyCopy,
  browseHeading,
  browseKind,
  buildBrowseMetrics,
  findHmiDevice,
  hasBoardData,
  type BrowseMetric,
} from "../../utils/browse-panel";
import { BindingPanel } from "./BindingPanel";
import { AlarmList } from "../alarm/AlarmList";
import styles from "./BrowsePanel.module.css";

function Sparkline({ values, ok = false }: { values: number[]; ok?: boolean }) {
  if (values.length < 2) return null;
  const width = 320;
  const height = 56;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((value, index) => {
    const x = 2 + (index / (values.length - 1)) * (width - 4);
    const y = height - 6 - ((value - min) / span) * (height - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width="100%" height={56} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden>
      <polyline
        points={pts.join(" ")}
        stroke={ok ? "var(--ngx-color-success)" : "var(--ngx-color-primary)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function readHistory(deviceId?: string, key?: string): number[] {
  if (!deviceId || !key || getProviderKind() !== "mock") return [];
  try {
    return getMockController()
      .getHistory(deviceId, key, 24)
      .map((row) => (typeof row.value === "number" ? row.value : Number(row.value)))
      .filter((value) => Number.isFinite(value));
  } catch {
    return [];
  }
}

function Empty({ title, help }: { title: string; help: string }) {
  return (
    <div className={styles.empty} data-testid="browse-empty">
      <p>{title}</p>
      <div className={styles.help}>{help}</div>
    </div>
  );
}

export function WorkbenchSidePanel({
  entity,
  hmi,
  devices,
  binding,
  latest,
  editing = false,
  onEdit,
  onExit,
  allowEdit = true,
  showAlarms = false,
}: {
  entity?: SceneEntity;
  hmi: ParsedHmiScene | null;
  devices: Device[];
  binding?: DeviceBinding;
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
  editing?: boolean;
  onEdit?: () => void;
  onExit?: () => void;
  allowEdit?: boolean;
  showAlarms?: boolean;
}) {
  const [tab, setTab] = useState<"live" | "history">("live");
  const node = entity?.nodeName ?? entity?.id;
  const device = findHmiDevice(hmi, node);
  const heading = browseHeading(hmi, node);
  const bound = Boolean(binding?.deviceId);
  const kind = browseKind({ selected: Boolean(node), bound, hasBoard: hasBoardData(device) });
  const metrics = useMemo(
    () => (kind === "metrics" ? buildBrowseMetrics({ device, binding, latest }) : []),
    [kind, device, binding, latest],
  );
  const empty = browseEmptyCopy(kind, tab, allowEdit);
  const canEdit = allowEdit && Boolean(entity);
  const boundDeviceName = formatPlatformDeviceName({
    ...devices.find((item) => item.id === binding?.deviceId),
    deviceName: binding?.deviceName,
  });
  const subtitle = node
    ? bound
      ? `已绑定${boundDeviceName ? ` · ${boundDeviceName}` : ""} · 实时`
      : "未绑定"
    : undefined;

  return (
    <div className={styles.wrap} data-testid="workbench-side" data-mode={allowEdit && editing && entity ? "edit" : "browse"} data-allow-edit={allowEdit ? "true" : "false"} data-kind={kind}>
      <div className={styles.header}>
        <div>
          <h3>{heading.title}</h3>
          {allowEdit && editing && entity ? null : subtitle ? <div className={styles.sub}>{subtitle}</div> : null}
        </div>
        {allowEdit ? (
          <div>
            {editing && entity ? (
              <Button size="small" onClick={onExit}>
                退出编辑
              </Button>
            ) : (
              <Button type="primary" size="small" onClick={onEdit} disabled={!canEdit}>
                编辑
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {allowEdit && editing && entity ? (
        <div className={styles.editBody}>
          <BindingPanel entity={entity} hmi={hmi} devices={devices} embedded />
        </div>
      ) : (
        <>
          <div className={styles.tabs}>
            <button type="button" className={`${styles.tab} ${tab === "live" ? styles.tabOn : ""}`} onClick={() => setTab("live")}>
              实时检测
            </button>
            <button type="button" className={`${styles.tab} ${tab === "history" ? styles.tabOn : ""}`} onClick={() => setTab("history")}>
              历史数据
            </button>
          </div>
          <div className={styles.body}>
            {kind !== "metrics" ? (
              <Empty title={empty.title} help={empty.help} />
            ) : tab === "live" ? (
              <>
                <div className={styles.metrics}>
                  {metrics.map((item) => (
                    <MetricRow key={item.field} item={item} />
                  ))}
                </div>
                <p className={styles.hint}>测点来自该对象已绑定的看板数据，不是写死的字段。</p>
              </>
            ) : (
              <>
                <HistoryList metrics={metrics} />
                <p className={styles.hint}>图表系列来自该对象已绑定的看板数据（guard-server 实时遥测）。</p>
              </>
            )}
            {showAlarms ? (
              <div className={styles.alarms}>
                <AlarmList compact />
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function MetricRow({ item }: { item: BrowseMetric }) {
  const running = item.field.includes("运行") && !item.missing && (item.text === "运行" || item.text === "开");
  const unit = item.unit;
  const body = unit && item.text.endsWith(unit) ? item.text.slice(0, -unit.length).trim() : item.text;
  return (
    <div className={styles.metric}>
      <span className={styles.k}>{item.label}</span>
      <span className={`${styles.n} ${running ? styles.ok : ""}`}>
        {body}
        {unit && !item.missing ? <small>{unit}</small> : null}
      </span>
    </div>
  );
}

function HistoryList({ metrics }: { metrics: BrowseMetric[] }) {
  const series = metrics.map((item) => ({ item, values: readHistory(item.deviceId, item.telemetryKey) }));
  if (series.every((row) => row.values.length < 2) && series.every((row) => row.item.missing)) {
    return <Empty title={BROWSE_COPY.noHistory} help="绑定测点后，这里会按该对象的看板数据出图。" />;
  }
  return (
    <div className={styles.charts}>
      {series.map(({ item, values }) => (
        <div className={styles.chart} key={item.field}>
          <div className={styles.chartHead}>
            <span className={styles.k}>{item.label}</span>
            <span className={styles.cur}>
              {item.text}
            </span>
          </div>
          {values.length >= 2 ? (
            <Sparkline values={values} ok={item.field.includes("运行") && item.text === "运行"} />
          ) : (
            <div className={styles.help}>{BROWSE_COPY.noHistory}</div>
          )}
        </div>
      ))}
    </div>
  );
}
