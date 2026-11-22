
import type { Device, DeviceBinding, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import {
  canAddWidgetType,
  clampGlassOpacity,
  clampWidgetRect,
  clearWidgetGlassOverride,
  effectiveGlassOpacity,
  EMPTY_WIDGET_LAYOUT,
  getDataProvider,
  layoutGlassOpacity,
  LOCAL_DRAFT_NOTICE,
  placeNewWidget,
  relayoutStageFrame,
  SCENE_WIDGET_TYPE_REGISTRY,
  isLockedStageType,
  stageFrameRects,
  widgetHasGlassOverride,
  type SceneWidget,
  type SceneWidgetLayout,
  type SceneWidgetSlot,
  type SessionRole,
  widgetTypeMeta,
} from "@idt/data-adapter";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { TelemetryPoint } from "../../stores/telemetry.store";
import {
  CaptionCardBody,
  DemoMark,
  MetricCardBody,
  SelectionCardBody,
  SummaryCardBody,
  TitleCardBody,
  TrendCardBody,
  widgetHeading,
} from "./WidgetCards";
import { hasSummaryCard, readSlotValue, resolveWidgetBindingSlots, widgetBindableDevices, type WidgetPointOption } from "./widget-values";
import { shouldShowWidgetDraftMark } from "../../auth/access";
import styles from "./WidgetOverlay.module.css";

type DragKind = "move" | "resize";

interface WidgetOverlayProps {
  layout: SceneWidgetLayout | null;
  arranging?: boolean;
  readOnly?: boolean;
  showDraftMark?: boolean;
  role?: SessionRole;
  widgetsSource?: "platform" | "local-draft" | "empty";
  sceneTitle?: string;
  bindings?: DeviceBinding[];
  devices?: Device[];
  hmi?: ParsedHmiScene | null;
  latest?: Record<string, TelemetryRecord>;
  history?: Record<string, TelemetryPoint[]>;
  selectedNode?: string | null;
  selectedEntityId?: string | null;
  focusWidgetId?: string | null;
  onChangeLayout?: (layout: SceneWidgetLayout) => void;
  onConsumeFocus?: () => void;
}

function tokenVar(name: string | undefined, fallback: string) {
  return name ? `var(${name})` : fallback;
}

function widgetStyle(widget: SceneWidget, layout: SceneWidgetLayout): CSSProperties {
  return {
    left: `${widget.x}%`,
    top: `${widget.y}%`,
    width: `${widget.w}%`,
    height: `${widget.h}%`,
    ["--widget-glass-alpha" as string]: String(effectiveGlassOpacity(layout, widget)),
    ["--widget-blur" as string]: tokenVar(widget.style?.blurToken, "var(--ngx-glass-blur)"),
    ["--widget-text" as string]: tokenVar(widget.style?.textToken, "var(--ngx-color-text)"),
    ["--widget-muted" as string]: tokenVar(widget.style?.mutedToken, "var(--ngx-color-muted)"),
  };
}

function nextLayout(layout: SceneWidgetLayout, widgets: SceneWidget[], glassOpacity = layout.glassOpacity): SceneWidgetLayout {
  return glassOpacity != null
    ? { schemaVersion: "1.0.0", glassOpacity, widgets }
    : { schemaVersion: "1.0.0", widgets };
}

function zoneStyle(rect: { x: number; y: number; w: number; h: number }): CSSProperties {
  return { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
}

export function WidgetOverlay(props: WidgetOverlayProps) {
  const layout = props.layout ?? EMPTY_WIDGET_LAYOUT;
  const bindings = props.bindings ?? [];
  const latest = props.latest ?? {};
  const history = props.history ?? {};
  const arranging = Boolean(props.arranging) && !props.readOnly;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const consumeFocus = useRef(props.onConsumeFocus);
  consumeFocus.current = props.onConsumeFocus;
  const dragRef = useRef<{
    kind: DragKind;
    id: string;
    startX: number;
    startY: number;
    orig: SceneWidget;
  } | null>(null);

  useEffect(() => {
    if (!props.focusWidgetId) return;
    setFocusedId(props.focusWidgetId);
    const timer = window.setTimeout(() => {
      setFocusedId(null);
      consumeFocus.current?.();
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [props.focusWidgetId]);

  useEffect(() => {
    if (!arranging) setSelectedId(null);
  }, [arranging]);

  const selected = layout.widgets.find((item) => item.id === selectedId);

  const updateWidget = (id: string, patch: Partial<SceneWidget>) => {
    props.onChangeLayout?.(nextLayout(
      layout,
      layout.widgets.map((item) => {
        if (item.id !== id) return item;
        const style = patch.style ? { ...item.style, ...patch.style } : item.style;
        return { ...item, ...patch, style };
      }),
    ));
  };

  const replaceSlots = (id: string, slots: SceneWidgetSlot[]) => {
    updateWidget(id, { slots });
  };

  const addWidget = (type: string) => {
    if (!canAddWidgetType(layout, type)) return;
    const extra: Partial<SceneWidget> = type === "title" && props.sceneTitle ? { title: props.sceneTitle } : {};
    const widget = placeNewWidget(layout, type, extra);
    props.onChangeLayout?.(nextLayout(layout, [...layout.widgets, widget]));
    setSelectedId(widget.id);
  };

  const removeWidget = (id: string) => {
    props.onChangeLayout?.(nextLayout(layout, layout.widgets.filter((item) => item.id !== id)));
    if (selectedId === id) setSelectedId(null);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>, widget: SceneWidget, kind: DragKind) => {
    if (!arranging || isLockedStageType(widget.type)) return;
    event.preventDefault();
    event.stopPropagation();
    const layer = layerRef.current;
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    dragRef.current = {
      kind,
      id: widget.id,
      startX: ((event.clientX - rect.left) / rect.width) * 100,
      startY: ((event.clientY - rect.top) / rect.height) * 100,
      orig: { ...widget },
    };
    setSelectedId(widget.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onLayerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const layer = layerRef.current;
    if (!drag || !layer) return;
    const rect = layer.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    const next = drag.kind === "resize"
      ? clampWidgetRect({ x: drag.orig.x, y: drag.orig.y, w: drag.orig.w + dx, h: drag.orig.h + dy })
      : clampWidgetRect({ x: drag.orig.x + dx, y: drag.orig.y + dy, w: drag.orig.w, h: drag.orig.h });
    updateWidget(drag.id, next);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const onCardMouseDown = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  const showDraft = shouldShowWidgetDraftMark({
    role: props.role,
    showDraftMark: props.showDraftMark,
    widgetsSource: props.widgetsSource,
    widgetCount: layout.widgets.length,
  });
  const [extraKeys, setExtraKeys] = useState<Record<string, WidgetPointOption[]>>({});
  const devices = props.devices ?? [];
  const bindOptions = useMemo(
    () => widgetBindableDevices({ bindings, devices, hmi: props.hmi, extraKeys }),
    [bindings, devices, props.hmi, extraKeys],
  );
  const selectedDeviceId = selected?.slots?.[0]?.deviceId;

  useEffect(() => {
    if (!arranging || !selectedDeviceId) return;
    let cancelled = false;
    void getDataProvider().listTelemetryKeys(selectedDeviceId).then((points) => {
      if (cancelled) return;
      setExtraKeys((prev) => ({
        ...prev,
        [selectedDeviceId]: points.map((point) => ({
          telemetryKey: point.key,
          label: point.label || point.key,
          unit: point.unit,
        })),
      }));
    }).catch(() => {
      /* 列表仍用已有绑定、设备点和 extras.hmi */
    });
    return () => { cancelled = true; };
  }, [arranging, selectedDeviceId]);

  if (!arranging && !layout.widgets.length && !showDraft) return null;

  const frame = stageFrameRects();

  return (
    <div
      ref={layerRef}
      className={styles.layer}
      data-testid="widget-overlay"
      onPointerMove={onLayerPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {arranging ? (
        <div className={styles.zones} data-testid="widget-stage-zones">
          <div className={styles.zone} style={zoneStyle(frame.title)}>整屏标题</div>
          <div className={styles.zone} style={zoneStyle(frame.caption)}>右上说明</div>
          <div className={styles.zone} style={zoneStyle(frame.left)}>左翼</div>
          <div className={styles.zone} style={zoneStyle(frame.right)}>右翼</div>
          <div className={styles.zone} style={zoneStyle(frame.bottom)}>底部底座</div>
          <div className={`${styles.zone} ${styles.zoneStage}`} style={zoneStyle(frame.stage)}>3D 主视觉</div>
        </div>
      ) : null}

      {layout.widgets.map((widget) => {
        const meta = widgetTypeMeta(widget.type);
        const heading = widgetHeading(widget, meta?.label);
        const first = widget.slots?.[0];
        const demo = first ? readSlotValue(first, bindings, latest, devices).source === "mock" : false;
        const selectedCard = arranging && widget.id === selectedId;
        const focused = widget.id === focusedId;
        return (
          <article
            key={widget.id}
            className={[
              styles.card,
              widget.type === "title" ? styles.titleCard : "",
              widget.type === "caption" ? styles.captionCard : "",
              selectedCard ? styles.cardSelected : "",
              focused ? styles.cardFocused : "",
            ].filter(Boolean).join(" ")}
            style={widgetStyle(widget, layout)}
            data-testid={`scene-widget-${widget.type}`}
            data-widget-id={widget.id}
            onMouseDown={onCardMouseDown}
            onPointerDown={(event) => {
              if (!arranging) {
                event.stopPropagation();
                return;
              }
              if ((event.target as HTMLElement).closest("[data-resize]")) return;
              beginDrag(event, widget, "move");
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (arranging) setSelectedId(widget.id);
            }}
          >
            {widget.type !== "title" ? (
              <div className={styles.cardTitle}>
                <span>{heading}</span>
                <DemoMark show={demo} />
                {arranging ? (
                  <button type="button" className={styles.remove} onClick={() => removeWidget(widget.id)}>
                    删除
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className={styles.cardBody}>
              {widget.type === "metric-card" ? (
                <MetricCardBody widget={widget} bindings={bindings} latest={latest} devices={devices} />
              ) : widget.type === "trend-chart" ? (
                <TrendCardBody widget={widget} bindings={bindings} latest={latest} history={history} devices={devices} />
              ) : widget.type === "summary-card" ? (
                <SummaryCardBody bindings={bindings} latest={latest} devices={devices} />
              ) : widget.type === "selection-card" ? (
                <SelectionCardBody selectedNode={props.selectedNode} selectedEntityId={props.selectedEntityId} bindings={bindings} latest={latest} devices={devices} />
              ) : widget.type === "title" ? (
                <TitleCardBody widget={widget} fallback={props.sceneTitle} />
              ) : widget.type === "caption" ? (
                <CaptionCardBody widget={widget} />
              ) : (
                <div className={styles.empty}>未知类型：{widget.type}</div>
              )}
            </div>
            {arranging && !isLockedStageType(widget.type) ? (
              <span
                data-resize="1"
                className={styles.handle}
                onPointerDown={(event) => beginDrag(event, widget, "resize")}
              />
            ) : null}
          </article>
        );
      })}

      {arranging ? (
        <div className={styles.palette} data-testid="widget-palette">
          <label>添加</label>
          {SCENE_WIDGET_TYPE_REGISTRY.map((item) => (
            <button
              type="button"
              key={item.type}
              className={styles.paletteBtn}
              disabled={!canAddWidgetType(layout, item.type)}
              onClick={() => addWidget(item.type)}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.paletteBtn}
            disabled={!layout.widgets.length}
            data-testid="relayout-stage"
            onClick={() => props.onChangeLayout?.(relayoutStageFrame(layout))}
          >
            按整屏分区整理
          </button>
          <label className={styles.glassControl}>
            <span>玻璃透明度 {Math.round(layoutGlassOpacity(layout) * 100)}%</span>
            <input
              type="range"
              min={50}
              max={90}
              step={1}
              data-testid="layout-glass-opacity"
              value={Math.round(layoutGlassOpacity(layout) * 100)}
              onChange={(event) => props.onChangeLayout?.(nextLayout(layout, layout.widgets, clampGlassOpacity(Number(event.target.value) / 100)))}
            />
          </label>
        </div>
      ) : null}

      {arranging && selected ? (
        <WidgetInspector
          widget={selected}
          layout={layout}
          bindOptions={bindOptions}
          devices={devices}
          onChange={(patch) => updateWidget(selected.id, patch)}
          onReplace={(next) => props.onChangeLayout?.(nextLayout(layout, layout.widgets.map((item) => (item.id === next.id ? next : item))))}
          onSlots={(slots) => replaceSlots(selected.id, slots)}
        />
      ) : null}

      {showDraft ? <div className={styles.draft}>{LOCAL_DRAFT_NOTICE}</div> : null}
    </div>
  );
}

function WidgetInspector(props: {
  widget: SceneWidget;
  layout: SceneWidgetLayout;
  bindOptions: ReturnType<typeof widgetBindableDevices>;
  devices: Device[];
  onChange: (patch: Partial<SceneWidget>) => void;
  onReplace: (widget: SceneWidget) => void;
  onSlots: (slots: SceneWidgetSlot[]) => void;
}) {
  const { widget, layout, bindOptions, devices } = props;
  const usesSlots = Boolean(widgetTypeMeta(widget.type)?.usesSlots);
  const slot = widget.slots?.[0];
  const glass = effectiveGlassOpacity(layout, widget);
  const overridden = widgetHasGlassOverride(widget);

  const applyBinding = (deviceId: string, telemetryKey?: string) => {
    props.onSlots(resolveWidgetBindingSlots(deviceId, telemetryKey, bindOptions, devices));
  };

  return (
    <aside className={styles.inspector} data-testid="widget-inspector">
      <h3>小部件</h3>
      <label className={styles.field}>
        <span>标题</span>
        <input
          value={widget.title ?? ""}
          onChange={(event) => props.onChange({ title: event.target.value })}
          placeholder={widget.type === "title" ? "整屏标题" : widget.type === "caption" ? "右上说明，例如时间" : "卡片标题"}
        />
      </label>
      <label className={styles.field}>
        <span>透明度 {Math.round(glass * 100)}%{overridden ? "（已覆盖）" : "（整屏默认）"}</span>
        <input
          type="range"
          min={50}
          max={90}
          step={1}
          data-testid="widget-glass-opacity"
          value={Math.round(glass * 100)}
          onChange={(event) => props.onChange({ style: { ...widget.style, opacity: clampGlassOpacity(Number(event.target.value) / 100) } })}
        />
      </label>
      {overridden ? (
        <button
          type="button"
          className={styles.linkBtn}
          data-testid="widget-glass-inherit"
          onClick={() => props.onReplace(clearWidgetGlassOverride(widget))}
        >
          使用整屏默认
        </button>
      ) : null}
      {usesSlots ? (
        bindOptions.length ? (
          <>
            <label className={styles.field}>
              <span>绑定设备</span>
              <select
                value={slot?.deviceId ?? ""}
                onChange={(event) => applyBinding(event.target.value)}
              >
                <option value="">选择实时设备</option>
                {bindOptions.map((item) => (
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
                  onChange={(event) => applyBinding(slot.deviceId!, event.target.value)}
                >
                  {(bindOptions.find((item) => item.deviceId === slot.deviceId)?.keys ?? []).map((item) => (
                    <option key={item.telemetryKey} value={item.telemetryKey}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : (
          <div className={styles.empty}>暂无实时设备测点。请绑定平台实时设备的遥测或属性，不能绑定虚拟设备。</div>
        )
      ) : null}
    </aside>
  );
}

export { hasSummaryCard };
