
import type { Device, DeviceBinding, ParsedHmiScene, ScenePlatformRef, TelemetryRecord } from "@idt/shared-types";
import {
  canAddWidgetType,
  clampGlassOpacity,
  clampWidgetRect,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  clearWidgetGlassOverride,
  effectiveGlassOpacity,
  effectiveHudGlassOpacity,
  EMPTY_WIDGET_LAYOUT,
  getDataProvider,
  getTopologyApi,
  layoutGlassOpacity,
  listRealtimeDevices,
  LOCAL_DRAFT_NOTICE,
  placeNewWidget,
  relayoutStageFrame,
  SCENE_WIDGET_TYPE_REGISTRY,
  isLockedStageType,
  stageFrameRects,
  widgetHasGlassOverride,
  widgetScopeKey,
  layoutHasWidgets,
  buildOverviewSituationLayout,
  WIDGET_MODEL_BINDING_HINT,
  OVERVIEW_SITUATION_REPLACE_CONFIRM,
  type SceneWidget,
  type SceneWidgetLayout,
  type SceneWidgetSlot,
  type SessionRole,
  type TopologySite,
  widgetTypeMeta,
  withWidgetLayout,
} from "@idt/data-adapter";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTelemetryStore, type TelemetryPoint } from "../../stores/telemetry.store";
import { previewDragLayout, shouldPersistWidgetDrag } from "./widget-drag";
import {
  BarCompareCardBody,
  CaptionCardBody,
  DeviceListCardBody,
  GaugeRingCardBody,
  MetricCardBody,
  RatioRingCardBody,
  SelectionCardBody,
  SummaryCardBody,
  TitleCardBody,
  TrendCardWithHistory,
  widgetHeading,
} from "./WidgetCards";
import { ControlBarCardBody } from "./ControlBarCardBody";
import { AlarmTickerCardBody } from "./AlarmTickerCard";
import {
  DEFAULT_TELEMETRY_STALE_SEC,
  assignWidgetAssetSlot,
  assignWidgetSlot,
  formatDataAge,
  hasSummaryCard,
  widgetDataAgeMs,
  widgetBindableDevices,
  widgetsForSurface,
  type WidgetPointOption,
  type WidgetSurfaceMode,
  EXIT_EXEMPT_TYPES,
  exitDirectionOf,
  shouldEnterDeviceFocus,
  widgetRenderRect,
} from "./widget-values";
import { ScopeBinder, SlotBinder, slotPresetsForType } from "./WidgetBinders";
import { useSiteEnergyStats, type EnergyGranularity } from "../../hooks/useSiteEnergyStats";
import { useEnergyRollup } from "../../hooks/useEnergyRollup";
import { EnergyKindBreakdownBody, EnergyMetricBody, EnergyTrendBody } from "./EnergyCards";
import { useAssetAttributes } from "../../hooks/useAssetAttributes";
import { shouldShowWidgetDraftMark } from "../../auth/access";
import { useHudSkin } from "../../theme/HudSkin";
import styles from "./WidgetOverlay.module.css";

type DragKind = "move" | "resize";

interface WidgetOverlayProps {
  layout: SceneWidgetLayout | null;
  surface?: WidgetSurfaceMode;
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
  platform?: ScenePlatformRef;
  onChangeLayout?: (layout: SceneWidgetLayout) => void;
  onConsumeFocus?: () => void;
  /**
   * 退出设备专题模式（2026-11-23）。
   *
   * <p>只在运行态、且选中了设备时才会渲染关闭按钮。
   * 点空白 3D 区域也能退出，但**两种都要有** ——
   * 有人习惯找按钮，有人习惯点空白（§12.2 验收判据）。
   */
  onExitDeviceFocus?: () => void;
  activeWidgetId?: string | null;
  onSelectWidget?: (widgetId: string) => void;
  /**
   * 范围解析出的设备 id 变化时上报（2026-11-23）。
   *
   * <p>为什么需要：`device-list` / `bar-compare` 的设备由 **scope 决定**，
   * 不在 `document.bindings` 里。而实时订阅名单只按 bindings + 槽位建 ——
   * 于是这些设备的遥测**从来没被订阅过**，大屏上永远显示「未知」。
   *
   * <p>实测：9 台模块机只有前 3 台（恰好在 3D 绑定里）能显示温度和状态，
   * 4#~9# 全是「未知」，而库里这 9 台的 `running` / `temperature` 都对得上。
   * 这不是数据问题，是订阅漏了。
   */
  onScopeDevicesChange?: (deviceIds: string[]) => void;
}

function tokenVar(name: string | undefined, fallback: string) {
  return name ? `var(${name})` : fallback;
}

/**
 * 滑出方向 → CSS 类名。
 *
 * <p>只做映射，方向判定在 `exitDirectionOf`（逻辑层，可单测）。
 * 放一起会让「哪边滑出」这个业务规则埋在渲染代码里，改一次要翻 UI 文件。
 */
function exitClassFor(
  widget: Pick<SceneWidget, "x" | "y" | "w" | "type">,
  s: Record<string, string>,
): string {
  const dir = exitDirectionOf(widget);
  if (dir === "left") return s.cardExitLeft ?? "";
  if (dir === "right") return s.cardExitRight ?? "";
  if (dir === "down") return s.cardExitDown ?? "";
  return "";
}

function widgetStyle(
  widget: SceneWidget,
  layout: SceneWidgetLayout,
  hud: boolean,
  deviceFocused = false,
): CSSProperties {
  const alpha = hud ? effectiveHudGlassOpacity(layout, widget) : effectiveGlassOpacity(layout, widget);
  const rect = widgetRenderRect(widget, deviceFocused);
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
    ["--widget-glass-alpha" as string]: String(alpha),
    ["--widget-blur" as string]: hud ? "var(--ngx-hud-glass-blur)" : tokenVar(widget.style?.blurToken, "var(--ngx-glass-blur)"),
    ["--widget-text" as string]: hud ? "var(--ngx-hud-text)" : tokenVar(widget.style?.textToken, "var(--ngx-color-text)"),
    ["--widget-muted" as string]: hud ? "var(--ngx-hud-muted)" : tokenVar(widget.style?.mutedToken, "var(--ngx-color-muted)"),
  };
}

function nextLayout(layout: SceneWidgetLayout, widgets: SceneWidget[], glassOpacity = layout.glassOpacity): SceneWidgetLayout {
  return withWidgetLayout(layout, widgets, glassOpacity);
}

function zoneStyle(rect: { x: number; y: number; w: number; h: number }): CSSProperties {
  return { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
}

export function WidgetOverlay(props: WidgetOverlayProps) {
  const storeLatest = useTelemetryStore((s) => s.latest);
  const storeHistory = useTelemetryStore((s) => s.history);
  const [dragLayout, setDragLayout] = useState<SceneWidgetLayout | null>(null);
  const dragLayoutRef = useRef<SceneWidgetLayout | null>(null);
  const layout = dragLayout ?? props.layout ?? EMPTY_WIDGET_LAYOUT;
  const bindings = props.bindings ?? [];
  const latest = props.latest ?? storeLatest;
  const history = props.history ?? storeHistory;
  const arranging = Boolean(props.arranging) && !props.readOnly;
  const hud = useHudSkin();
  const surface: WidgetSurfaceMode = props.surface ?? "editor";
  /*
   * 资产属性只读一次、全屏共用：放在主组件而不是每张卡里。
   * 放在卡里会让每张卡各发一轮请求，同一资产的属性被读 N 遍。
   */
  const assetState = useAssetAttributes(layout);
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

  const applyWidgetPatch = (id: string, patch: Partial<SceneWidget>): SceneWidgetLayout => {
    return nextLayout(
      layout,
      layout.widgets.map((item) => {
        if (item.id !== id) return item;
        const style = patch.style ? { ...item.style, ...patch.style } : item.style;
        return { ...item, ...patch, style };
      }),
    );
  };

  const updateWidget = (id: string, patch: Partial<SceneWidget>) => {
    const next = applyWidgetPatch(id, patch);
    if (dragRef.current) {
      dragLayoutRef.current = next;
      setDragLayout(next);
      return;
    }
    dragLayoutRef.current = null;
    setDragLayout(null);
    props.onChangeLayout?.(next);
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
    const base = props.layout ?? EMPTY_WIDGET_LAYOUT;
    const preview = previewDragLayout(base, drag.id, next);
    dragLayoutRef.current = preview;
    setDragLayout(preview);
  };

  const endDrag = () => {
    const pending = dragRef.current ? dragLayoutRef.current : null;
    dragRef.current = null;
    dragLayoutRef.current = null;
    setDragLayout(null);
    if (pending && shouldPersistWidgetDrag("up")) {
      props.onChangeLayout?.(pending);
    }
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

  /*
   * 设备聚焦态（2026-11-23，客户要求「点设备后周围统计自动收缩」）。
   *
   * <h3>为什么用「淡出 + 微缩」而不是真的改宽度</h3>
   *
   * <p>部件是**百分比绝对定位**（x/y/w/h 都是 %）。选中设备时去改其他卡的
   * 宽高，等于临时改布局 —— 退出选中还要还原，中间任何一次渲染异常都会
   * 把布局改坏，而且用户下次进编辑器看到的是被改过的坐标。
   *
   * <p>「降低不透明度 + 轻微缩小 + 去饱和」能表达同样的层级关系
   * （前景/背景），且是纯视觉状态：不写回 layout，退出即恢复。
   *
   * <p>只在运行态生效。编辑态点设备是为了选中对象改绑定，
   * 那时把别的卡淡掉会看不见自己要调的东西。
   *
   * <p>★ 2026-11-23 补一条前提：**布局里必须有「选中机组」卡（selection-card）**。
   * 专题模式是成对动作 —— 外围滑出、抽屉补位。客户同日要求删掉选中机组后，
   * 母屏上就只剩「滑出」这一半：点一台设备，右翼全部飞走，屏幕上空空如也，
   * 既没有新的信息出现，也没有东西提示怎么回去。那不叫聚焦，叫屏幕坏了。
   * 所以判据降到「有载体才滑出」；将来谁把这张卡加回来，专题模式自动恢复。
   */
  const deviceFocused = shouldEnterDeviceFocus({
    surface,
    widgets: layout.widgets,
    selectedNode: props.selectedNode,
    selectedEntityId: props.selectedEntityId,
  });
  const [sites, setSites] = useState<TopologySite[]>([]);
  const [scopeDeviceIds, setScopeDeviceIds] = useState<Record<string, string[]>>({});
  const [scopeOptionsAvailable, setScopeOptionsAvailable] = useState(false);
  const platform = props.platform;

  /*
   * 场站能耗统计（2026-11-23）。
   *
   * <p>只在**至少有一块卡声明了 `dataSource: "energy"`** 时才发请求 ——
   * 编辑态里大部分场景还是纯遥测大屏，不该白打一次聚合查询
   * （`comprehensive` 是全表扫描级别的操作，A5 精神）。
   *
   * <p>粒度由这里持有而不是各卡自己管：一屏上可能有多块能耗卡
   * （趋势 + 排名），它们必须看同一个时间窗，否则「趋势说这月 180 tce、
   * 排名说这几台加起来 300」这种自相矛盾就会出现。
   */
  const needsEnergy = useMemo(
    () => layout.widgets.some((w) => w.dataSource === "energy"),
    [layout.widgets],
  );
  const [energyGran, setEnergyGran] = useState<EnergyGranularity>("day");
  const energyStats = useSiteEnergyStats(
    { siteId: platform?.siteId, topologyId: platform?.topologyId },
    energyGran,
    needsEnergy,
  );
  /*
   * 今日 / 本周 / 本月 / 本年（2026-11-23）。
   *
   * <p>跟着 `needsEnergy` 走：纯遥测大屏不该白打四次聚合查询。
   * 它和 `energyStats` 是两个独立 hook —— 前者是「四固定窗口」，
   * 后者是「单窗口 + 可切粒度」，混在一起会让两者都变难读。
   */
  const energyRollup = useEnergyRollup(
    { siteId: platform?.siteId, topologyId: platform?.topologyId },
    needsEnergy,
  );
  const customerId = platform?.customerId;
  const visibleWidgets = widgetsForSurface(layout.widgets, surface, {
    bindings,
    latest,
    history,
    devices,
    selectedNode: props.selectedNode,
    selectedEntityId: props.selectedEntityId,
    sceneTitle: props.sceneTitle,
    scopeDeviceIds,
    /*
     * 必须传：运行态「只显示有值的卡」这条过滤，若不认识资产属性，
     * 配好的资产卡会被当成没值直接隐藏 —— 界面上表现为「配了却看不到」。
     */
    assetAttrs: assetState.lookup ?? undefined,
    assetError: assetState.error,
  });

  const applyOverviewSituation = () => {
    if (layoutHasWidgets(layout) && typeof window !== "undefined" && !window.confirm(OVERVIEW_SITUATION_REPLACE_CONFIRM)) {
      return;
    }
    const next = buildOverviewSituationLayout(props.sceneTitle);
    props.onChangeLayout?.(next);
    setSelectedId(next.widgets.find((item) => item.type === "title")?.id ?? next.widgets[0]?.id ?? null);
  };

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

  useEffect(() => {
    if (!arranging) return;
    let cancelled = false;
    void getTopologyApi().listAll({ customerId }).then((result) => {
      if (!cancelled) setSites(result.sites);
    }).catch(() => {
      if (!cancelled) setSites([]);
    });
    const siteId = platform?.siteId;
    const viewType = platform?.viewType;
    if (siteId && viewType) {
      void getTopologyApi().scopeOptions(siteId, viewType).then((result) => {
        if (!cancelled) setScopeOptionsAvailable(Boolean(result.data.options.length));
      }).catch(() => {
        if (!cancelled) setScopeOptionsAvailable(false);
      });
    }
    return () => { cancelled = true; };
  }, [arranging, customerId, platform?.siteId, platform?.viewType]);

  useEffect(() => {
    const needed = new Map<string, { siteId?: string; topologyId?: string }>();
    for (const widget of layout.widgets) {
      const key = widgetScopeKey(widget.scope);
      if (!key || !widget.scope) continue;
      needed.set(key, {
        siteId: widget.scope.kind === "site" ? widget.scope.siteId : undefined,
        topologyId: widget.scope.kind === "topology" ? widget.scope.topologyId : undefined,
      });
    }
    if (!needed.size) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string[]> = {};
      for (const [key, query] of needed) {
        try {
          const list = await listRealtimeDevices({
            siteId: query.siteId,
            topologyId: query.topologyId,
            customerId,
          });
          next[key] = list.map((item) => item.id);
        } catch {
          next[key] = [];
        }
      }
      if (!cancelled) {
        setScopeDeviceIds((prev) => ({ ...prev, ...next }));
        /* 把范围内所有设备上报给外壳，用于补齐实时订阅名单。 */
        const all = [...new Set(Object.values(next).flat())];
        props.onScopeDevicesChange?.(all);
      }
    })();
    return () => { cancelled = true; };
  }, [layout.widgets, customerId]);

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

      {visibleWidgets.map((widget) => {
        const meta = widgetTypeMeta(widget.type);
        const heading = widgetHeading(widget, meta?.label);
        const selectedCard = (arranging && widget.id === selectedId) || widget.id === props.activeWidgetId;
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
              /*
               * 设备聚焦（2026-11-23 改版）：不再是「变淡」，而是
               * **外围卡按方位滑出视野 + 选中卡展开成抽屉**。
               *
               * <p>客户原话：「把周围的统计部件缩回去，把设备维度相关的
               * 统计部件和操作部件抽屉出来」。只变淡等于「还占着位置」，
               * 3D 仍被压住 —— 滑出才真正腾出空间。
               *
               * <p>标题与说明不参与：它们不是「统计」，滑走会让屏幕显得坏了一半。
               */
              deviceFocused && widget.type === "selection-card" ? styles.cardDrawer : "",
              deviceFocused && !EXIT_EXEMPT_TYPES.has(widget.type)
                ? exitClassFor(widget, styles)
                : "",
            ].filter(Boolean).join(" ")}
            style={widgetStyle(widget, layout, hud, deviceFocused)}
            data-testid={`scene-widget-${widget.type}`}
            data-widget-id={widget.id}
            onMouseDown={onCardMouseDown}
            /*
             * 拦截滚轮，别让它冒泡到 window（2026-11-23 客户报障）。
             *
             * <h3>根因（实测，不是猜）</h3>
             *
             * <p>PlayCanvas 的 `Mouse` 把 `wheel` 监听挂在 **`window`** 上
             * （`playcanvas/build/playcanvas.mjs` 的 `attach()`：
             * `window.addEventListener("wheel", this._wheelHandler, { passive: false })`）。
             * 而 OrbitCamera 的 `onMouseWheel` **不判断坐标是否在 canvas 内** ——
             * 只要事件到达 window，它就改相机距离并 `preventDefault()`。
             *
             * <p>后果有两个，客户都提到了：
             * <ol>
             *   <li>「机组状态没有滚动效果」—— 默认滚动被 `preventDefault` 吃掉；</li>
             *   <li>在卡片上滚轮**还会把 3D 缩放一次**，人却以为自己在滚列表。</li>
             * </ol>
             *
             * <h3>为什么在卡片上拦、而不是只拦列表</h3>
             *
             * <p>卡片是大屏的信息层，**滚轮不该穿透到 3D**：用户在卡片上滚动
             * 的意图是「看这条卡里的更多内容」，不是「拉远镜头」。
             * 只拦可滚动容器的话，卡片内不可滚的区域仍会把滚轮漏给 3D，
             * 表现为「有的地方能滚、有的地方镜头会动」—— 更难理解。
             */
            onWheel={(event) => {
              event.stopPropagation();
            }}
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
              props.onSelectWidget?.(widget.id);
            }}
          >
            {widget.type !== "title" ? (
              <div className={styles.cardTitle}>
                {/*
                 * 对齐 template01 的 panel-head：左侧 `⌜ 中文`、右侧 7px 英文。
                 * `⌜` 是纯装饰（aria-hidden），不要进可读文本。
                 */}
                <span className={styles.cardTitleText}>
                  <span className={styles.cardTitleMark} aria-hidden>⌜</span>
                  {heading}
                </span>
                {/*
                 * 数据延迟标记（2026-11-23）。
                 *
                 * <p>实测：库里数据停了 51 小时，大屏照样显示「7.4℃」——
                 * 和实时数据长得一模一样。值班员据此以为设备正在运行，
                 * 可能做出完全错误的判断。
                 *
                 * <p>只在运行态显示：编辑态是在调布局，不需要这种运维信息。
                 */}
                {surface === "runtime" ? (() => {
                  const ageMs = widgetDataAgeMs(widget, bindings, latest, scopeDeviceIds);
                  if (ageMs == null) return null;
                  if (ageMs <= DEFAULT_TELEMETRY_STALE_SEC * 1000) return null;
                  return (
                    <span
                      className={styles.dataStale}
                      data-testid={`stale-${widget.id}`}
                      title="数据已停止更新，下方数值不是实时值"
                    >
                      延迟 {formatDataAge(ageMs)}
                    </span>
                  );
                })() : null}
                {widget.subtitle ? (
                  <span className={styles.cardSubtitle}>{widget.subtitle}</span>
                ) : null}
                {/*
                 * 抽屉关闭按钮（2026-11-23）。
                 *
                 * <p>设备专题是「点开」进入的，必须有显式的「退出」。
                 * 只靠点空白 3D 区域不够：那只在用户恰好点到没有对象的
                 * 像素时生效，点中任何一台机器都会**换成那台**而不是退出。
                 */}
                {deviceFocused && widget.type === "selection-card" ? (
                  <button
                    type="button"
                    className={styles.drawerClose}
                    data-testid="selection-drawer-close"
                    aria-label="退出设备专题"
                    title="返回全景（也可以点击空白 3D 区域）"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onExitDeviceFocus?.();
                    }}
                  >
                    ×
                  </button>
                ) : null}
                {arranging ? (
                  <button type="button" className={styles.remove} onClick={() => removeWidget(widget.id)}>
                    删除
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className={styles.cardBody}>
              {widget.type === "metric-card" ? (
                widget.dataSource === "energy" ? (
                  <EnergyMetricBody widget={widget} stats={energyStats} rollup={energyRollup} />
                ) : (
                <MetricCardBody
                  widget={widget} bindings={bindings} latest={latest} devices={devices}
                  assetAttrs={assetState.lookup ?? undefined} assetError={assetState.error}
                  scopeDeviceIds={scopeDeviceIds}
                />
                )
              ) : widget.type === "ratio-ring" ? (
                <RatioRingCardBody
                  widget={widget} bindings={bindings} latest={latest} devices={devices}
                  scopeDeviceIds={scopeDeviceIds}
                  assetAttrs={assetState.lookup ?? undefined} assetError={assetState.error}
                />
              ) : widget.type === "gauge-ring" ? (
                <GaugeRingCardBody
                  widget={widget} bindings={bindings} latest={latest} devices={devices}
                  scopeDeviceIds={scopeDeviceIds}
                  assetAttrs={assetState.lookup ?? undefined} assetError={assetState.error}
                />
              ) : widget.type === "trend-chart" ? (
                widget.dataSource === "energy" ? (
                  <EnergyTrendBody
                    widget={widget}
                    stats={energyStats}
                    gran={energyGran}
                    onGranChange={setEnergyGran}
                  />
                ) : (
                <TrendCardWithHistory
                  widget={widget} bindings={bindings} latest={latest} history={history} devices={devices}
                  scopeDeviceIds={scopeDeviceIds}
                  deviceNameOf={(id) => devices?.find((d) => d.id === id)?.label ?? id}
                />
                )
              ) : widget.type === "summary-card" ? (
                <SummaryCardBody widget={widget} bindings={bindings} latest={latest} devices={devices} scopeDeviceIds={scopeDeviceIds} />
              ) : widget.type === "device-list" ? (
                <DeviceListCardBody widget={widget} bindings={bindings} latest={latest} devices={devices} scopeDeviceIds={scopeDeviceIds} />
              ) : widget.type === "bar-compare" ? (
                widget.dataSource === "energy" ? (
                  <EnergyKindBreakdownBody widget={widget} stats={energyStats} />
                ) : (
                <BarCompareCardBody widget={widget} bindings={bindings} latest={latest} devices={devices} scopeDeviceIds={scopeDeviceIds} />
                )
              ) : widget.type === "control-bar" ? (
                <ControlBarCardBody widget={widget} devices={devices} latest={latest} />
              ) : widget.type === "alarm-ticker" ? (
                <AlarmTickerCardBody widget={widget} />
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
          <button
            type="button"
            className={styles.paletteBtn}
            data-testid="apply-overview-situation"
            onClick={applyOverviewSituation}
          >
            按综合态势样板摆好
          </button>
          <label className={styles.glassControl}>
            <span>玻璃透明度 {Math.round(layoutGlassOpacity(layout) * 100)}%</span>
            <input
              type="range"
              /* 用常量而不是写死 50：下限已在 2026-11-23 调到 25，
                 写死会让滑块拖不到真正的下限。 */
              min={Math.round(GLASS_OPACITY_MIN * 100)}
              max={Math.round(GLASS_OPACITY_MAX * 100)}
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
          platform={platform}
          sites={sites}
          scopeOptionsAvailable={scopeOptionsAvailable}
          scopeDeviceIds={scopeDeviceIds}
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
  platform?: ScenePlatformRef;
  sites?: TopologySite[];
  scopeOptionsAvailable?: boolean;
  scopeDeviceIds?: Record<string, string[]>;
  onChange: (patch: Partial<SceneWidget>) => void;
  onReplace: (widget: SceneWidget) => void;
  onSlots: (slots: SceneWidgetSlot[]) => void;
}) {
  const { widget, layout, bindOptions, devices, platform, sites = [] } = props;
  /*
   * 两个判定都从注册表读，不在这里写 if 链。
   * 原来的硬编码列表漏了 device-list / bar-compare —— 那两种卡在编辑器里
   * 没有范围选择器，而运行时又按 scope 取设备，等于配不出来（2026-11-23 修）。
   */
  const typeMeta = widgetTypeMeta(widget.type);
  const usesSlots = Boolean(typeMeta?.usesSlots);
  const usesScope = Boolean(typeMeta?.usesScope);
  /*
   * 范围聚合：仪表也要（2026-11-23）。
   * `readGaugeRings` 底层走 `readRatioRingGroups`，后者支持「未绑设备时
   * 按 scope 汇总」（如「9 台之和」）—— 但前提是槽位选项不限到单一设备。
   * 所以这里把它一起放开。
   */
  const aggregateScope = widget.type === "summary-card" || widget.type === "ratio-ring" || widget.type === "gauge-ring";
  const glass = effectiveGlassOpacity(layout, widget);
  const overridden = widgetHasGlassOverride(widget);
  const slotPresets = slotPresetsForType(widget.type, widget.slots?.length ?? 0);
  const scopeKey = widgetScopeKey(widget.scope);
  const scopedIds = scopeKey ? props.scopeDeviceIds?.[scopeKey] : undefined;
  const slotOptions = !aggregateScope && widget.scope && scopedIds
    ? bindOptions.filter((item) => scopedIds.includes(item.deviceId))
    : bindOptions;

  const applyBinding = (index: number, deviceId: string, telemetryKey: string | undefined, preset: Partial<SceneWidgetSlot>) => {
    props.onSlots(assignWidgetSlot(widget.slots, index, deviceId, telemetryKey, slotOptions, devices, preset));
  };
  const applyAssetBinding = (index: number, assetId: string, attributeKey: string | undefined, preset: Partial<SceneWidgetSlot>) => {
    props.onSlots(assignWidgetAssetSlot(widget.slots, index, assetId, attributeKey, preset));
  };

  return (
    <aside className={styles.inspector} data-testid="widget-inspector">
      <h3>小部件</h3>
      {usesScope ? <p className={styles.hint} data-testid="widget-binding-hint">{WIDGET_MODEL_BINDING_HINT}</p> : null}
      <label className={styles.field}>
        <span>标题</span>
        <input
          value={widget.title ?? ""}
          onChange={(event) => props.onChange({ title: event.target.value })}
          placeholder={widget.type === "title" ? "整屏标题" : widget.type === "caption" ? "右上说明" : "卡片标题"}
        />
      </label>
      <label className={styles.field}>
        <span>透明度 {Math.round(glass * 100)}%{overridden ? "（已覆盖）" : "（整屏默认）"}</span>
        <input
          type="range"
          min={Math.round(GLASS_OPACITY_MIN * 100)}
          max={Math.round(GLASS_OPACITY_MAX * 100)}
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
      {usesScope ? (
        <ScopeBinder
          widget={widget}
          platform={platform}
          sites={sites}
          aggregate={aggregateScope}
          scopeOptionsAvailable={props.scopeOptionsAvailable}
          onChange={(scope) => props.onChange({ scope })}
        />
      ) : null}
      {usesSlots ? (
        slotOptions.length ? (
          <>
            {slotPresets.map((preset, index) => (
              <SlotBinder
                key={`${preset.key}-${index}`}
                label={preset.label || "绑定设备"}
                slot={widget.slots?.[index]}
                bindOptions={slotOptions}
                customerId={props.platform?.customerId}
                onBind={(deviceId, telemetryKey) => applyBinding(index, deviceId, telemetryKey, preset)}
                onBindAsset={(assetId, attributeKey) => applyAssetBinding(index, assetId, attributeKey, preset)}
              />
            ))}
            {widget.type === "ratio-ring" || widget.type === "gauge-ring" || widget.type === "trend-chart" ? (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  if (widget.type === "ratio-ring" || widget.type === "gauge-ring") {
                    const group = Math.max(1, Math.ceil((widget.slots?.length ?? 0) / 2));
                    /*
                     * 仪表的槽位命名用 value/max（语义更准），并且在
                     * 量程槽上预填 `constant: 100` —— 新加的一组
                     * 立刻能用，不用再去绑一个「上报总量」的设备。
                     */
                    if (widget.type === "gauge-ring") {
                      props.onSlots([
                        ...(widget.slots ?? []),
                        { key: `value-${group}`, label: `当前值 ${group + 1}` },
                        { key: `max-${group}`, label: `满量程 ${group + 1}`, constant: 100 },
                      ]);
                      return;
                    }
                    props.onSlots([
                      ...(widget.slots ?? (group === 1 ? [] : [])),
                      { key: `used-${group}`, label: `已用 ${group + 1}` },
                      { key: `total-${group}`, label: `总数 ${group + 1}` },
                    ]);
                    return;
                  }
                  const nextIndex = widget.slots?.length ?? 0;
                  props.onSlots([...(widget.slots ?? []), { key: `series-${nextIndex}`, label: `系列 ${nextIndex + 1}` }]);
                }}
              >
                {widget.type === "ratio-ring"
                  ? "添加一组圆环"
                  : widget.type === "gauge-ring"
                    ? "添加一组仪表"
                    : "添加系列"}
              </button>
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

