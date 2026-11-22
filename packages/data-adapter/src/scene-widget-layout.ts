/** 布局样式只引用 --ngx-* token 名，不写死某一套主题的十六进制色。 */
export const DEFAULT_WIDGET_STYLE_TOKENS = {
  backgroundToken: "--ngx-glass-bg",
  borderToken: "--ngx-glass-border",
  blurToken: "--ngx-glass-blur",
  textToken: "--ngx-color-text",
  mutedToken: "--ngx-color-muted",
} as const;

/** 与 --ngx-glass-bg 的默认 alpha 一致。布局 JSON 只存 0.50–0.90 或 50–90 的百分比。 */
export const DEFAULT_GLASS_OPACITY = 0.72;
export const GLASS_OPACITY_MIN = 0.5;
export const GLASS_OPACITY_MAX = 0.9;

export type SceneWidgetTypeId =
  | "metric-card"
  | "trend-chart"
  | "summary-card"
  | "selection-card"
  | "title"
  | "caption"
  | (string & {});

export interface SceneWidgetTypeMeta {
  type: string;
  label: string;
  defaultSize: { w: number; h: number };
  maxCount?: number;
  /** 该类型是否需要实例测点槽位。模板里槽位不含 customer 的 deviceId。 */
  usesSlots?: boolean;
}

export const SCENE_WIDGET_TYPE_REGISTRY: SceneWidgetTypeMeta[] = [
  { type: "metric-card", label: "数值卡", defaultSize: { w: 16, h: 14 }, usesSlots: true },
  { type: "trend-chart", label: "趋势图", defaultSize: { w: 20.4, h: 22 }, usesSlots: true },
  { type: "summary-card", label: "汇总卡", defaultSize: { w: 16, h: 14 } },
  { type: "selection-card", label: "选中对象卡", defaultSize: { w: 20.4, h: 22 }, maxCount: 1 },
  { type: "title", label: "标题", defaultSize: { w: 56, h: 7 }, maxCount: 1 },
  { type: "caption", label: "右上说明", defaultSize: { w: 20, h: 6 }, maxCount: 1 },
];

export interface SceneWidgetStyle {
  backgroundToken?: string;
  borderToken?: string;
  blurToken?: string;
  textToken?: string;
  mutedToken?: string;
  /** 单卡覆盖。缺省则继承 layout.glassOpacity。 */
  opacity?: number;
}

export interface SceneWidgetSlot {
  key: string;
  label?: string;
  unit?: string;
  telemetryKey?: string;
  sceneEntityId?: string;
  /** 仅实例绑定填写；模板布局必须去掉。 */
  deviceId?: string;
}

export interface SceneWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  style?: SceneWidgetStyle;
  slots?: SceneWidgetSlot[];
}

export interface SceneWidgetLayout {
  schemaVersion: "1.0.0";
  /** 整屏玻璃默认透明度，缺省 0.72。 */
  glassOpacity?: number;
  widgets: SceneWidget[];
}

export const EMPTY_WIDGET_LAYOUT: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [] };

/** 画布百分比安全区：给底部抽屉和右下「总览」留空，拖到附近弹开。 */
export const WIDGET_SAFE_AREA = {
  top: 2,
  left: 2,
  right: 2,
  bottom: 18,
  overview: { right: 2, bottom: 8, width: 12, height: 10 },
} as const;

/**
 * 整屏分区：对照参考站成品封面构图（左右翼 + 中央主视觉 + 底部居中底座）。
 * 只采用分区与摆放，不搬该站配色。标题锁在画布顶边正中；次级说明在右上。
 * 左右列贴内缘上下对齐；汇总/数值卡落在主视觉正下方居中，不与左右列抢同一条垂直带。
 * 底部仍躲开抽屉和右下「总览」。
 */
export const WIDGET_STAGE_FRAME = {
  title: { x: 22, y: 2, w: 56, h: 7 },
  caption: { x: 78, y: 2, w: 20, h: 6 },
  leftCol: { x: 1.6, y: 10.2, w: 20.4 },
  rightCol: { x: 78, y: 10.2, w: 20.4 },
  bottomBase: { x: 23.4, y: 66, w: 53.2, h: 16 },
  columnGap: 1.4,
  baseGap: 1.2,
} as const;

export type WidgetStageZone = "title" | "caption" | "left" | "right" | "bottom";

export function contentBottom(): number {
  return 100 - WIDGET_SAFE_AREA.bottom;
}

export function stageFrameRects() {
  const bottomLimit = contentBottom();
  const left = { ...WIDGET_STAGE_FRAME.leftCol, h: bottomLimit - WIDGET_STAGE_FRAME.leftCol.y };
  const right = { ...WIDGET_STAGE_FRAME.rightCol, h: bottomLimit - WIDGET_STAGE_FRAME.rightCol.y };
  const bottom = { ...WIDGET_STAGE_FRAME.bottomBase };
  const stage = {
    x: left.x + left.w + WIDGET_STAGE_FRAME.columnGap,
    y: WIDGET_STAGE_FRAME.leftCol.y,
    w: WIDGET_STAGE_FRAME.rightCol.x - (left.x + left.w) - WIDGET_STAGE_FRAME.columnGap * 2,
    h: WIDGET_STAGE_FRAME.bottomBase.y - WIDGET_STAGE_FRAME.leftCol.y - WIDGET_STAGE_FRAME.baseGap,
  };
  return {
    title: { ...WIDGET_STAGE_FRAME.title },
    caption: { ...WIDGET_STAGE_FRAME.caption },
    left,
    right,
    bottom,
    stage,
  };
}

export function zoneForWidgetType(type: string): WidgetStageZone {
  if (type === "title") return "title";
  if (type === "caption") return "caption";
  if (type === "metric-card" || type === "summary-card") return "bottom";
  if (type === "selection-card") return "right";
  return "left";
}

export function isLockedStageType(type: string): boolean {
  return type === "title" || type === "caption";
}

export function widgetTypeMeta(type: string): SceneWidgetTypeMeta | undefined {
  return SCENE_WIDGET_TYPE_REGISTRY.find((item) => item.type === type);
}

export function isKnownWidgetType(type: string): boolean {
  return SCENE_WIDGET_TYPE_REGISTRY.some((item) => item.type === type);
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tokenName(value: unknown, fallback: string): string {
  const raw = text(value) || fallback;
  if (raw.startsWith("--")) return raw;
  if (raw.startsWith("ngx-")) return `--${raw}`;
  if (raw.startsWith("var(")) {
    const inner = raw.slice(4, -1).trim();
    return inner || fallback;
  }
  // 拒绝把十六进制色写进布局
  if (raw.startsWith("#") || raw.startsWith("rgb")) return fallback;
  return fallback;
}

/** 接受 0.50–0.90 或 50–90；写出两位小数。超出范围就夹到 50%–90%。 */
export function clampGlassOpacity(value: unknown, fallback = DEFAULT_GLASS_OPACITY): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  const ratio = !Number.isFinite(n) ? fallback : n > 1 && n <= 100 ? n / 100 : n;
  const stepped = Math.round(ratio * 100) / 100;
  return Math.min(GLASS_OPACITY_MAX, Math.max(GLASS_OPACITY_MIN, stepped));
}

export function parseOptionalGlassOpacity(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  if (typeof value === "string" && !Number.isFinite(Number(value))) return undefined;
  return clampGlassOpacity(value);
}

export function layoutGlassOpacity(layout: Pick<SceneWidgetLayout, "glassOpacity"> | null | undefined): number {
  return clampGlassOpacity(layout?.glassOpacity, DEFAULT_GLASS_OPACITY);
}

/** 单卡 style.opacity 覆盖整屏默认；未设置则跟随 layout.glassOpacity。 */
export function effectiveGlassOpacity(
  layout: Pick<SceneWidgetLayout, "glassOpacity"> | null | undefined,
  widget?: Pick<SceneWidget, "style"> | null,
): number {
  if (widget?.style && Object.prototype.hasOwnProperty.call(widget.style, "opacity") && widget.style.opacity != null) {
    return clampGlassOpacity(widget.style.opacity);
  }
  return layoutGlassOpacity(layout);
}

export function widgetHasGlassOverride(widget: Pick<SceneWidget, "style"> | null | undefined): boolean {
  return Boolean(widget?.style && Object.prototype.hasOwnProperty.call(widget.style, "opacity") && widget.style.opacity != null);
}

export function clearWidgetGlassOverride(widget: SceneWidget): SceneWidget {
  if (!widgetHasGlassOverride(widget) || !widget.style) return widget;
  const { opacity: _removed, ...rest } = widget.style;
  return { ...widget, style: rest };
}

export function parseWidgetSlot(raw: unknown): SceneWidgetSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const key = text(row.key) || text(row.telemetryKey) || "value";
  const slot: SceneWidgetSlot = { key };
  const label = text(row.label);
  const unit = text(row.unit);
  const telemetryKey = text(row.telemetryKey);
  const sceneEntityId = text(row.sceneEntityId);
  const deviceId = text(row.deviceId);
  if (label) slot.label = label;
  if (unit) slot.unit = unit;
  if (telemetryKey) slot.telemetryKey = telemetryKey;
  if (sceneEntityId) slot.sceneEntityId = sceneEntityId;
  if (deviceId) slot.deviceId = deviceId;
  return slot;
}

export function clampWidgetRect(input: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const minW = 8;
  const minH = 6;
  const w = Math.min(80, Math.max(minW, input.w));
  const h = Math.min(70, Math.max(minH, input.h));
  const maxX = 100 - WIDGET_SAFE_AREA.right - w;
  const maxY = 100 - WIDGET_SAFE_AREA.bottom - h;
  let x = Math.min(Math.max(WIDGET_SAFE_AREA.left, input.x), Math.max(WIDGET_SAFE_AREA.left, maxX));
  let y = Math.min(Math.max(WIDGET_SAFE_AREA.top, input.y), Math.max(WIDGET_SAFE_AREA.top, maxY));
  const ov = WIDGET_SAFE_AREA.overview;
  const overviewLeft = 100 - ov.right - ov.width;
  const overviewTop = 100 - ov.bottom - ov.height;
  const overlapsOverview = x + w > overviewLeft && x < 100 - ov.right && y + h >= overviewTop && y < 100 - ov.bottom;
  if (overlapsOverview) {
    x = Math.min(x, Math.max(WIDGET_SAFE_AREA.left, overviewLeft - w));
  }
  return { x, y, w, h };
}

export function parseSceneWidget(raw: unknown, index = 0): SceneWidget | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = text(row.type) || "metric-card";
  const meta = widgetTypeMeta(type);
  const size = meta?.defaultSize ?? { w: 18, h: 16 };
  const rect = clampWidgetRect({
    x: num(row.x, 4 + (index % 3) * 20),
    y: num(row.y, 4 + Math.floor(index / 3) * 18),
    w: num(row.w, size.w),
    h: num(row.h, size.h),
  });
  const styleRaw = row.style && typeof row.style === "object" ? (row.style as Record<string, unknown>) : {};
  const override = parseOptionalGlassOpacity(styleRaw.opacity ?? row.opacity);
  const slots = Array.isArray(row.slots)
    ? row.slots.map((item) => parseWidgetSlot(item)).filter((item): item is SceneWidgetSlot => Boolean(item))
    : Array.isArray(row.bindings)
      ? row.bindings.map((item, i) => parseWidgetSlot({ ...(item as object), key: `binding-${i}` })).filter((item): item is SceneWidgetSlot => Boolean(item))
      : [];
  const widget: SceneWidget = {
    id: text(row.id) || `widget-${index}`,
    type,
    ...rect,
    style: {
      backgroundToken: tokenName(styleRaw.backgroundToken, DEFAULT_WIDGET_STYLE_TOKENS.backgroundToken),
      borderToken: tokenName(styleRaw.borderToken, DEFAULT_WIDGET_STYLE_TOKENS.borderToken),
      blurToken: tokenName(styleRaw.blurToken, DEFAULT_WIDGET_STYLE_TOKENS.blurToken),
      textToken: tokenName(styleRaw.textToken, DEFAULT_WIDGET_STYLE_TOKENS.textToken),
      mutedToken: tokenName(styleRaw.mutedToken, DEFAULT_WIDGET_STYLE_TOKENS.mutedToken),
      ...(override != null ? { opacity: override } : {}),
    },
  };
  const title = text(row.title);
  if (title) widget.title = title;
  if (slots.length) widget.slots = slots;
  return widget;
}

export function parseSceneWidgetLayout(payload: unknown): SceneWidgetLayout {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const rawWidgets = Array.isArray(row.widgets) ? row.widgets : Array.isArray(payload) ? payload : [];
  const widgets = rawWidgets.map((item, index) => parseSceneWidget(item, index)).filter((item): item is SceneWidget => Boolean(item));
  const glassOpacity = parseOptionalGlassOpacity(row.glassOpacity);
  return glassOpacity != null
    ? { schemaVersion: "1.0.0", glassOpacity, widgets }
    : { schemaVersion: "1.0.0", widgets };
}

/** 模板只复用布局、透明度和未绑定槽位；去掉客户 deviceId、测点键和场景对象。 */
export function toTemplateWidgetLayout(layout: SceneWidgetLayout): SceneWidgetLayout {
  const widgets = layout.widgets.map((widget) => ({
    ...widget,
    slots: widget.slots
      ?.map((slot) => {
        const next: SceneWidgetSlot = { key: slot.key };
        if (slot.label) next.label = slot.label;
        if (slot.unit) next.unit = slot.unit;
        return next;
      })
      .filter((slot) => slot.key),
  }));
  return layout.glassOpacity != null
    ? { schemaVersion: "1.0.0", glassOpacity: clampGlassOpacity(layout.glassOpacity), widgets }
    : { schemaVersion: "1.0.0", widgets };
}

export function nextWidgetId(existing: SceneWidget[]): string {
  return `widget-${Date.now().toString(36)}-${existing.length}`;
}

export function canAddWidgetType(layout: SceneWidgetLayout, type: string): boolean {
  const meta = widgetTypeMeta(type);
  if (!meta?.maxCount) return true;
  return layout.widgets.filter((item) => item.type === type).length < meta.maxCount;
}

export function placeNewWidget(layout: SceneWidgetLayout, type: string, partial?: Partial<SceneWidget>): SceneWidget {
  const meta = widgetTypeMeta(type);
  const size = meta?.defaultSize ?? { w: 18, h: 16 };
  const slot = nextSlotInZone(layout, zoneForWidgetType(type), size);
  const widget = parseSceneWidget(
    {
      id: nextWidgetId(layout.widgets),
      type,
      ...slot,
      ...partial,
    },
    layout.widgets.length,
  )!;
  return widget;
}

function widgetsInZone(layout: SceneWidgetLayout, zone: WidgetStageZone): SceneWidget[] {
  return layout.widgets.filter((item) => zoneForWidgetType(item.type) === zone);
}

function packColumn(items: SceneWidget[], col: { x: number; y: number; w: number; h: number }): SceneWidget[] {
  if (!items.length) return [];
  const gap = WIDGET_STAGE_FRAME.columnGap;
  const h = Math.max(6, (col.h - gap * (items.length - 1)) / items.length);
  return items.map((widget, index) => ({
    ...widget,
    ...clampWidgetRect({ x: col.x, y: col.y + index * (h + gap), w: col.w, h }),
  }));
}

function packBottomBase(items: SceneWidget[], base: { x: number; y: number; w: number; h: number }): SceneWidget[] {
  if (!items.length) return [];
  const gap = WIDGET_STAGE_FRAME.baseGap;
  const cols = items.length <= 3 ? items.length : 3;
  const rows = Math.ceil(items.length / cols);
  const natural = (base.w - gap * (cols - 1)) / cols;
  const w = Math.max(8, items.length < 3 ? Math.min(22, natural) : natural);
  const h = Math.max(6, (base.h - gap * (rows - 1)) / rows);
  const used = cols * w + gap * (cols - 1);
  const originX = base.x + Math.max(0, (base.w - used) / 2);
  return items.map((widget, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      ...widget,
      ...clampWidgetRect({ x: originX + col * (w + gap), y: base.y + row * (h + gap), w, h }),
    };
  });
}

/** 在标题栏、右上说明、左右翼或底部底座里取下一个空位。 */
export function nextSlotInZone(
  layout: SceneWidgetLayout,
  zone: WidgetStageZone,
  size: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const rects = stageFrameRects();
  if (zone === "title") {
    return clampWidgetRect({ ...rects.title, h: size.h || rects.title.h });
  }
  if (zone === "caption") {
    return clampWidgetRect({ ...rects.caption, h: size.h || rects.caption.h });
  }
  if (zone === "bottom") {
    const preview = packBottomBase(
      [...widgetsInZone(layout, "bottom"), { id: "next", type: "metric-card", x: 0, y: 0, w: size.w, h: size.h } as SceneWidget],
      rects.bottom,
    );
    const last = preview[preview.length - 1]!;
    return { x: last.x, y: last.y, w: last.w, h: last.h };
  }
  const col = zone === "right" ? rects.right : rects.left;
  const existing = widgetsInZone(layout, zone);
  const y = existing.length
    ? Math.max(...existing.map((item) => item.y + item.h)) + WIDGET_STAGE_FRAME.columnGap
    : col.y;
  const h = Math.min(size.h, Math.max(6, col.y + col.h - y));
  return clampWidgetRect({ x: col.x, y, w: col.w, h });
}

/** 按封面骨架整理：标题锁顶中，说明锁右上，左右翼顶底对齐，数值/汇总落入底部居中底座。不改 type 和绑定。 */
export function relayoutStageFrame(layout: SceneWidgetLayout): SceneWidgetLayout {
  const rects = stageFrameRects();
  const byZone: Record<WidgetStageZone, SceneWidget[]> = { title: [], caption: [], left: [], right: [], bottom: [] };
  for (const widget of layout.widgets) {
    byZone[zoneForWidgetType(widget.type)].push(widget);
  }
  const widgets: SceneWidget[] = [
    ...byZone.title.map((widget) => ({ ...widget, ...clampWidgetRect({ ...rects.title, h: widget.h || rects.title.h }) })),
    ...byZone.caption.map((widget) => ({ ...widget, ...clampWidgetRect({ ...rects.caption, h: widget.h || rects.caption.h }) })),
    ...packColumn(byZone.left, rects.left),
    ...packColumn(byZone.right, rects.right),
    ...packBottomBase(byZone.bottom, rects.bottom),
  ];
  return layout.glassOpacity != null
    ? { schemaVersion: "1.0.0", glassOpacity: layout.glassOpacity, widgets }
    : { schemaVersion: "1.0.0", widgets };
}
