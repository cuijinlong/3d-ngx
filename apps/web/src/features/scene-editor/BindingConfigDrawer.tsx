import { Button, Segmented, Upload, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { Device, DeviceBinding, ParsedHmiScene, SceneEntity, ScenePlatformRef } from "@idt/shared-types";
import {
  applyScreenWiring,
  parseScreenWiring,
  reviewScreenWiring,
  summarizeWiringReport,
  type SceneWidgetLayout,
  type WiringReviewItem,
} from "@idt/data-adapter";
import { BindingPanel } from "./BindingPanel";
import { PendingBindingsPanel } from "./PendingBindingsPanel";
import styles from "./BindingConfigDrawer.module.css";

/**
 * 三个 section 的动作方向不同：
 * - cards   ：已配的复核（纠错）
 * - devices ：三维对象对接（纠错）
 * - pending ：还没配的待办（补全）
 */
export type BindingConfigSection = "cards" | "devices" | "pending";

interface BindingConfigDrawerProps {
  layout: SceneWidgetLayout | null;
  sceneTitle?: string;
  platform?: ScenePlatformRef;
  bindings?: DeviceBinding[];
  devices?: Device[];
  hmi?: ParsedHmiScene | null;
  entities?: SceneEntity[];
  focusWidgetId?: string | null;
  focusEntity?: SceneEntity;
  section: BindingConfigSection;
  onSectionChange: (section: BindingConfigSection) => void;
  onChangeLayout?: (layout: SceneWidgetLayout) => void;
  onChangeBindings?: (bindings: DeviceBinding[]) => void;
  onSelectEntity?: (entityId: string, nodeName?: string) => void;
  onClose: () => void;
}

function statusClass(item: WiringReviewItem): string {
  if (item.ok && (item.status === "bound" || item.status === "pending-devices")) return styles.ok ?? "";
  if (item.status === "unbound" || (item.ok && item.status === "empty")) return styles.muted ?? "";
  return styles.bad ?? "";
}

function statusLabel(item: WiringReviewItem): string {
  if (item.status === "bound") return "已对接";
  if (item.status === "empty") return item.optional ? "可选未对接" : "未对接";
  if (item.status === "unbound") return "未对接";
  if (item.status === "virtual") return "虚拟设备已失效";
  if (item.status === "unresolved") return "设备对不上";
  if (item.status === "unmatched") return "对象对不上";
  if (item.status === "pending-devices") return "待核对列表";
  return "不对";
}

export function BindingConfigDrawer(props: BindingConfigDrawerProps) {
  const devices = props.devices ?? [];
  const bindings = props.bindings ?? [];
  const entities = props.entities ?? [];
  const review = useMemo(
    () => reviewScreenWiring({ layout: props.layout, bindings, entities, devices }),
    [props.layout, bindings, entities, devices],
  );
  const [activeId, setActiveId] = useState<string | null>(props.focusWidgetId ?? props.focusEntity?.id ?? null);
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    setActiveId(props.focusWidgetId ?? props.focusEntity?.id ?? null);
  }, [props.focusWidgetId, props.focusEntity?.id]);

  const applyFile = async (file: File) => {
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      message.error("对接文件不是合法 JSON");
      return false;
    }
    const wiring = parseScreenWiring(raw);
    if (!wiring) {
      message.error("对不上画面对接文件约定。请按 packages/data-adapter/src/screen-templates/README.md 生成 kind 为 screen-wiring 的文件。");
      return false;
    }
    const result = applyScreenWiring({
      wiring,
      layout: props.layout,
      bindings,
      entities,
      devices,
      sceneName: props.sceneTitle,
    });
    props.onChangeLayout?.(result.layout);
    props.onChangeBindings?.(result.bindings);
    const text = summarizeWiringReport(result.report);
    if (result.report.rejectedInterfaces || result.report.rejectedObjects) message.warning(text);
    else message.success(text);
    return false;
  };

  const cardItems = review.cards;
  const objectItems = review.objects;
  const focusedObject = props.focusEntity;

  return (
    <aside className={styles.panel} data-testid="binding-config-drawer">
      <div className={styles.head}>
        <h2>核对绑定</h2>
        <Button type="text" onClick={props.onClose} data-testid="close-binding-config">关闭</Button>
      </div>
      <div className={styles.body}>
        <p className={styles.note}>
          数据绑定不用在这里一项项手填。按模板接口说明用 skill 生成对接结果，再用「应用对接结果」加载。这个抽屉只用来核对：已对接什么、哪些不对。
        </p>
        <div className={styles.actions}>
          <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => applyFile(file)}>
            <Button type="primary" data-testid="apply-screen-wiring">应用对接结果</Button>
          </Upload>
          {review.issueCount ? (
            <span className={styles.bad}>有 {review.issueCount} 处需要对核</span>
          ) : (
            <span className={styles.ok}>当前没有标红的问题</span>
          )}
        </div>
        <div className={styles.head}>
          <Segmented
            block
            value={props.section}
            onChange={(value) => props.onSectionChange(value as BindingConfigSection)}
            options={[
              { label: "画面卡片", value: "cards" },
              { label: "三维设备", value: "devices" },
              { label: "待配置", value: "pending" },
            ]}
          />
        </div>
        {props.section === "pending" ? (
          <PendingBindingsPanel
            layout={props.layout}
            onFocusWidget={(widgetId) => {
              /* 跳到那张卡：切回 cards 并选中它，用户接着在那里补绑定。 */
              setActiveId(widgetId);
              props.onSectionChange("cards");
            }}
          />
        ) : props.section === "cards" ? (
          <div className={styles.section} data-testid="binding-config-cards">
            {!cardItems.length ? (
              <p className={styles.empty}>还没有画面接口。新建场景时请先选「综合态势」模板。</p>
            ) : null}
            {cardItems.map((item) => (
              <article
                key={item.id}
                className={`${styles.card} ${activeId === item.id || (props.focusWidgetId && item.id.startsWith(`${props.focusWidgetId}.`)) ? styles.cardActive : ""}`}
                data-testid={`binding-review-${item.id}`}
                onClick={() => setActiveId(item.id)}
              >
                <div className={styles.regionHead}>
                  <h3 className={styles.cardTitle}>{item.title}{item.key ? ` · ${item.key}` : ""}</h3>
                  <span className={statusClass(item)}>{statusLabel(item)}</span>
                </div>
                <p className={`${styles.hint} ${statusClass(item)}`}>{item.detail}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.section} data-testid="binding-config-devices">
            <p className={styles.hint}>三维对接只影响铭牌和底部启停。铭牌仍只在点选或指向时显示。底部启停仍从下方上浮，不在这里操作。</p>
            {!objectItems.length ? (
              <p className={styles.empty}>还没有模型。先导入或挂上 GLB，再应用带 objectBindings 的对接结果。</p>
            ) : null}
            {objectItems.map((item) => {
              const entity = entities.find((row) => row.id === item.id);
              const active = focusedObject?.id === item.id || activeId === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`${styles.deviceItem} ${active ? styles.deviceItemActive : ""}`}
                  onClick={() => {
                    setActiveId(item.id);
                    setCorrecting(false);
                    if (entity) props.onSelectEntity?.(entity.id, entity.nodeName);
                  }}
                >
                  <span>{item.title}</span>
                  <span className={statusClass(item)}>{statusLabel(item)}</span>
                  <span className={styles.hint}>{item.detail}</span>
                </button>
              );
            })}
            {focusedObject ? (
              <div className={styles.card}>
                <div className={styles.actions}>
                  <Button size="small" onClick={() => setCorrecting((value) => !value)} data-testid="toggle-binding-correct">
                    {correcting ? "收起纠正" : "纠正这项（可选）"}
                  </Button>
                </div>
                {correcting ? (
                  <BindingPanel entity={focusedObject} hmi={props.hmi ?? null} devices={devices} embedded />
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
