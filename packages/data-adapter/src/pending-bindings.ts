/**
 * 待绑定清单：从大屏布局推导「还差什么才算配好」。
 *
 * <h2>与「有没有值」是两件事</h2>
 *
 * `widgetHasResolvableValue`（widget-values.ts）判定的是**运行态该不该显示这张卡**
 * —— 它依赖实时遥测，没数据就返回 false。
 *
 * 本模块判定的是**配置完整性** —— 只看「有没有绑」，不看「现在有没有数」。
 * 两者混用会得出荒谬结论：设备断线时，一张配得好好的卡会被报成「未绑定」。
 * 所以这里刻意不接收 `latest` 遥测。
 *
 * <h2>两类 slot 语义不同</h2>
 *
 * - 单值 slot（metric-card 等）：绑一台设备的某个测点 → 需要 deviceId + telemetryKey
 * - 按设备逐台（device-list / bar-compare）：一个列名，9 台各自读 → **只需要 telemetryKey**
 *
 * 这个差异来自注册表的 `scopePerDevice`。不区分的话，「9 台各自的出水温度」
 * 会被判成未绑定（因为它没有 deviceId），而它其实已经配好了。
 */
import type { SceneWidget, SceneWidgetLayout } from "./scene-widget-layout";
import { widgetScopeIsBound, widgetTypeMeta } from "./scene-widget-layout";

/** 单项缺什么。分别给出，因为三种的处置完全不同。 */
export type PendingIssue =
  /** 需要范围但没选（整张卡取不到设备） */
  | "no-scope"
  /** 需要绑测点但没绑 */
  | "no-slot"
  /** 绑了设备但没选测点（只有单值 slot 会出现） */
  | "no-key"
  /** 不可识别的部件类型（老布局 / 手写 JSON） */
  | "unknown-type";

export interface PendingBindingItem {
  widgetId: string;
  /** 卡上的标题，没有就用类型名 —— 界面上要能对上「哪张卡」 */
  title: string;
  widgetType: string;
  /** 缺的项，可能多个（例如既没范围又没绑测点） */
  issues: PendingIssue[];
  /** 该部件一共需要几个 slot。0 = 不需要 slot（如 title / summary-card） */
  requiredSlots: number;
  /** 已配好的 slot 数 */
  filledSlots: number;
}

export interface PendingBindingsReport {
  items: PendingBindingItem[];
  /** 需要配置的部件总数（不含 title / caption 这类纯装饰） */
  total: number;
  /** 完全配好的部件数 */
  ready: number;
  /** 一个都没配好的部件数（全部 issue 都在） */
  untouched: number;
  /** 全部配好时为 true */
  complete: boolean;
}

/**
 * 一张卡需要几个 slot。
 *
 * <p>优先取布局里实际存在的 slots 数量：客户可能加了两组圆环。
 * 布局里没有 slots 时，退到「至少 1 个」——只要该类型 usesSlots，
 * 就说明它必须绑东西才能出数。
 */
function requiredSlotCount(widget: SceneWidget): number {
  const meta = widgetTypeMeta(widget.type);
  if (!meta?.usesSlots) return 0;
  const declared = widget.slots?.length ?? 0;
  return declared > 0 ? declared : 1;
}

/**
 * 一个 slot 算不算配好。
 *
 * <p>`scopePerDevice` 的类型（device-list / bar-compare）只要 telemetryKey：
 * 它们的语义是「这个列读哪个键」，设备由 scope 决定，绑 deviceId 反而是错的。
 */
function slotIsFilled(widget: SceneWidget, slotIndex: number): boolean {
  const meta = widgetTypeMeta(widget.type);
  const slot = widget.slots?.[slotIndex];
  if (!slot) return false;
  /*
   * 资产槽的键名是 attributeKey，不是 telemetryKey（2026-11-23）。
   * 原来统一查 telemetryKey，导致配好的资产槽被误报为未绑定 ——
   * 而用户怎么配都「配不好」，因为两种字段名就不一样。
   */
  if (slot.assetId) return Boolean(slot.attributeKey);
  if (meta?.scopePerDevice) return Boolean(slot.telemetryKey);
  /* 单值 slot：设备 + 测点都要有，缺一不可。 */
  return Boolean(slot.deviceId && slot.telemetryKey);
}

/**
 * 整张卡是否「全部由资产属性驱动」。
 *
 * <p>资产卡不需要范围：它读的是资产自身属性（装机容量、投运日期），
 * 与场站下有哪些设备无关。仍要求 scope 会把配好的资产卡报成「未选范围」。
 */
function isAllAssetWidget(widget: SceneWidget): boolean {
  const slots = widget.slots ?? [];
  if (slots.length === 0) return false;
  /*
   * 只要求「每个槽都有 assetId」，不要求已选属性。
   *
   * 若要求 attributeKey，「选了资产还没选属性」这一刻会被判成非资产卡，
   * 于是同时报「未选范围」+「未选测点」——用户补完属性后前者自己消失，
   * 等于凭空多一条会自愈的噪音。意图已经明确是资产卡，就别再要求 scope。
   */
  return slots.every((slot) => Boolean(slot.assetId));
}

export function pendingBindingOfWidget(widget: SceneWidget): PendingBindingItem {
  const meta = widgetTypeMeta(widget.type);
  const issues: PendingIssue[] = [];

  if (!meta) {
    /*
     * 未知类型不猜它要什么，直接标出来。
     * 老布局里可能有已下线的类型，静默跳过会让人以为「这张卡没问题」。
     */
    return {
      widgetId: widget.id,
      title: widget.title || widget.type,
      widgetType: widget.type,
      issues: ["unknown-type"],
      requiredSlots: 0,
      filledSlots: 0,
    };
  }

  /*
   * 只有「按范围凑设备」的类型才把缺 scope 算作待办；
   * metric-card / trend-chart 绑的是具体设备，没范围也能出数。
   */
  const allAsset = isAllAssetWidget(widget);
  if (meta.scopeRequired && !allAsset && !widgetScopeIsBound(widget.scope)) {
    issues.push("no-scope");
  }

  const required = requiredSlotCount(widget);
  let filled = 0;
  if (required > 0) {
    for (let index = 0; index < required; index += 1) {
      if (slotIsFilled(widget, index)) {
        filled += 1;
        continue;
      }
      /*
       * 区分「完全没绑」和「绑了设备但没选测点」：
       * 前者要去找设备，后者只要在下拉里补选一个键。
       */
      const slot = widget.slots?.[index];
      /*
       * 资产槽「选了资产没选属性」等价于设备槽的「选了设备没选测点」：
       * 处置手段都是「再补一个下拉」，所以报同一个 issue。
       */
      const hasDeviceOrAsset = Boolean(slot?.deviceId || slot?.assetId);
      issues.push(hasDeviceOrAsset && !meta.scopePerDevice ? "no-key" : "no-slot");
    }
  }

  return {
    widgetId: widget.id,
    title: widget.title || meta.label || widget.type,
    widgetType: widget.type,
    issues: [...new Set(issues)],
    requiredSlots: required,
    filledSlots: filled,
  };
}

/**
 * 整屏待绑定清单。
 *
 * <p>只收「需要配置」的部件：title / caption / selection-card 这类
 * 要么不需要绑、要么绑定对象是运行时选中的，不该进清单 ——
 * 把它们算进去会让完成度永远到不了 100%，用户就不再看了。
 */
export function pendingBindingsOfLayout(
  layout: Pick<SceneWidgetLayout, "widgets"> | null | undefined,
): PendingBindingsReport {
  const widgets = layout?.widgets ?? [];
  const configurable = widgets.filter((widget) => {
    const meta = widgetTypeMeta(widget.type);
    if (!meta) return true; // 未知类型也要报，不能悄悄隐藏
    /* selection-card 绑的是「当前选中对象」，不是配置项。 */
    if (widget.type === "selection-card") return false;
    return Boolean(meta.usesScope || meta.usesSlots);
  });

  const items = configurable
    .map((widget) => pendingBindingOfWidget(widget))
    .filter((item) => item.issues.length > 0);

  const ready = configurable.length - items.length;
  const untouched = items.filter((item) => {
    const meta = widgetTypeMeta(item.widgetType);
    if (!meta) return true;
    /*
     * 「完全没动」= 需要 slot 但一个都没配上。
     * 不把 scope 作为必要条件：资产卡本来就不需要 scope，
     * 拿 scope 参与判断会把它一直算成「动过」。
     */
    return item.requiredSlots > 0 && item.filledSlots === 0;
  }).length;

  return {
    items,
    total: configurable.length,
    ready,
    untouched,
    complete: configurable.length > 0 && items.length === 0,
  };
}

/** 一句人话概括，给列表卡片和顶栏用。 */
export function pendingBindingsSummary(report: PendingBindingsReport): string {
  if (report.total === 0) return "这个布局还没有可配置的卡片";
  if (report.complete) return `${report.total} 块卡片已全部配置`;
  return `${report.ready}/${report.total} 块已配置，还差 ${report.items.length} 块`;
}

/** 单项的问题描述。分开写是因为三种处置手段不同。 */
export const PENDING_ISSUE_LABELS: Record<PendingIssue, string> = {
  "no-scope": "未选范围",
  "no-slot": "未绑定测点",
  "no-key": "已选设备，未选测点",
  "unknown-type": "未知部件类型",
};
