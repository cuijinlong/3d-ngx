import type { DeviceBinding, SceneDocument } from "@idt/shared-types";
import type { SceneWidgetLayout } from "@idt/data-adapter";
import { describeWidgetTypeSchemas } from "@idt/data-adapter";

/**
 * 交给 AI 的「场景上下文」。
 *
 * <h2>为什么需要单独抽一层</h2>
 *
 * <p>AI 只能照上下文办事。上下文缺什么，它就只能猜 —— 而猜错的产物
 * 看起来像「AI 不好用」，实际是「没说清」。
 *
 * <p>2026-11-24 实测暴露的正是这个：AI 能加卡片、能改标题，
 * 但**一次也没有成功绑定数据**。它给出的理由很准确 ——
 * 「上下文未提供『机组功率』的遥测键」。真实原因有两条，都是上下文缺项：
 *
 * <ul>
 *   <li>不知道每张卡有哪些**槽位键**（`slotKey`）。`bind-telemetry` 必须带它，
 *       猜错就是 `slot-not-found`，整体提案被拒；</li>
 *   <li>不知道场景里**哪些遥测键真实存在**。它只能编一个键名，
 *       而编出来的键在大屏上是永远的空值 —— 而且不报错。</li>
 * </ul>
 *
 * <h2>数据来源：只读场景文档，不发请求</h2>
 *
 * <p>遥测键从 `bindings[].telemetryMappings` 推导 —— 这些绑定是用户
 * 已经配好、正在实时刷数的，所以那里的键**一定是真实存在**的。
 * 不走「再问一遍平台有哪些键」：那要按设备逐个查（N+1），
 * 而在编辑器里每次打开面板都跑一遍是不合算的。
 *
 * <p>代价是：新场景（0 绑定）推不出任何键，AI 就依然只能说「请先绑定设备」。
 * 这是**正确**的行为 —— 它确实无从知道该绑什么。
 */

/** 一张卡在 AI 眼里长什么样：够它定位卡片和槽位，但不塞整个 widget。 */
export interface AiWidgetBrief {
  id: string;
  type: string;
  title?: string;
  /**
   * 位置与尺寸（百分比）。
   *
   * <p>必须给：AI 加新卡片时要判断「放哪不会压在别人身上」。
   * 2026-11-24 实测它就卡在这里 —— 「现有各卡片的具体坐标未提供，
   * 无法确定新卡放置位置避免重叠」，于是拒绝出提案。
   * 而它本来完全可以自己看出来的。
   */
  box?: { x: number; y: number; w: number; h: number };
  /** 槽位清单。`key` 是 `bind-telemetry` 要填的 `slotKey`。 */
  slots?: Array<{
    key: string;
    label?: string;
    unit?: string;
    /** 已绑的测点；有值说明这格正在刷数，改它就是在换数据源。 */
    telemetryKey?: string;
  }>;
}

/**
 * 一种卡片类型的「槽位模板」。
 *
 * <h3>为什么必须有（2026-11-24）</h3>
 *
 * <p>上下文原来只给**已存在**卡片的槽位。于是 AI 想新增一张 `trend-chart` 时
 * 无从知道它该有哪些槽位键，实测原话：
 * 「当前上下文未提供 trend-chart 的槽位定义，不能瞎绑」。
 *
 * <p>这句是对的 —— 槽位键是设计契约（`series-0` / `main` / `rows` …），
 * 猜错就是 `slot-not-found`，整个提案被整体拒绝。
 *
 * <p>数据来自内置大屏模板的 `regions[].interfaces[]`（那是唯一权威来源），
 * 按类型去重后喂给模型。
 */
export interface AiWidgetTypeSchema {
  type: string;
  label: string;
  defaultSize: { w: number; h: number };
  /** 该类型的槽位定义。`usesScope` 为 true 的项是范围选择器，不是测点。 */
  slots: Array<{
    key: string;
    name: string;
    valueType: string;
    usesScope: boolean;
    aggregate?: string;
    displayType?: string;
  }>;
  /** 模板里惯用的取数口径（dataSource / energyMetric / energyKind）。 */
  settings?: { dataSource?: string; energyMetric?: string; energyKind?: string };
  /** true = 按设备逐台各读一个值（这类卡片的测点槽位不能加 aggregate）。 */
  perDevice?: boolean;
}

/** 一个可用遥测键：从场景已有绑定里收集，去重后带上出处。 */
export interface AiTelemetryKeyBrief {
  key: string;
  label?: string;
  unit?: string;
  /** 出现在几台设备上 —— 帮助 AI 判断「这是通用点位还是某台特有」。 */
  deviceCount: number;
}

export interface AiSceneContext {
  name?: string;
  widgets: number;
  bindings: number;
  site?: string;
  topology?: string;
  widgetList: AiWidgetBrief[];
  telemetryKeys: AiTelemetryKeyBrief[];
  /** 可绑定的设备（来自绑定）。没有它，AI 无法把测点落到具体设备上。 */
  devices: Array<{ id: string; name: string }>;
  /** 每种卡片类型的槽位模板 —— 新增卡片的依据。 */
  widgetTypes: AiWidgetTypeSchema[];
  /**
   * 本场景的默认取数范围。
   *
   * <p>新增「按范围取数」的卡片（device-list / bar-compare）时，
   * 卡上必须带 `scope`，否则渲染层不知道取哪些设备 ——
   * 实测表现为卡片里写着「还没有绑定设备」，而槽位其实都配好了。
   *
   * <p>AI 自己编不出 siteId / topologyId（那是 UUID），所以必须给它。
   */
  sceneScope?: {
    kind: "topology" | "site";
    topologyId?: string;
    topologyName?: string;
    siteId?: string;
    siteName?: string;
  };
}

/** 上限：prompt 是有成本的，而且大段清单会让模型忽略真正的指令。 */
const MAX_WIDGETS = 40;
const MAX_SLOTS_PER_WIDGET = 12;
const MAX_TELEMETRY_KEYS = 60;
const MAX_DEVICES = 24;

/** 从绑定里收集遥测键。同一 key 出现在多台设备上只留一条。 */
export function collectTelemetryKeys(bindings: DeviceBinding[] | undefined): AiTelemetryKeyBrief[] {
  const byKey = new Map<string, AiTelemetryKeyBrief & { devices: Set<string> }>();
  for (const binding of bindings ?? []) {
    const deviceKey = binding.deviceId || binding.sceneEntityId || binding.id;
    for (const mapping of binding.telemetryMappings ?? []) {
      const key = mapping?.telemetryKey?.trim();
      if (!key) continue;
      const hit = byKey.get(key);
      if (hit) {
        hit.devices.add(deviceKey);
        /* 先到先得的 label/unit：同一键在不同设备上的标签应当一致，
         * 不一致时保留第一条，避免清单里出现「同一键两种叫法」让人困惑。 */
        continue;
      }
      byKey.set(key, {
        key,
        label: mapping.label?.trim() || undefined,
        unit: mapping.unit?.trim() || undefined,
        deviceCount: 0,
        devices: new Set([deviceKey]),
      });
    }
  }
  return [...byKey.values()]
    .map(({ devices, ...rest }) => ({ ...rest, deviceCount: devices.size }))
    .sort((a, b) => b.deviceCount - a.deviceCount || a.key.localeCompare(b.key))
    .slice(0, MAX_TELEMETRY_KEYS);
}

/** 可绑定设备清单。同一台设备在多个 3D 对象上出现时只留一条。 */
export function collectDevices(bindings: DeviceBinding[] | undefined): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string }> = [];
  for (const binding of bindings ?? []) {
    const id = binding.deviceId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: binding.deviceName?.trim() || id });
    if (out.length >= MAX_DEVICES) break;
  }
  return out;
}

export function buildWidgetBriefs(layout: SceneWidgetLayout | null | undefined): AiWidgetBrief[] {
  return (layout?.widgets ?? []).slice(0, MAX_WIDGETS).map((widget) => {
    const slots = (widget.slots ?? []).slice(0, MAX_SLOTS_PER_WIDGET).map((slot) => ({
      key: slot.key,
      ...(slot.label ? { label: slot.label } : {}),
      ...(slot.unit ? { unit: slot.unit } : {}),
      ...(slot.telemetryKey ? { telemetryKey: slot.telemetryKey } : {}),
    }));
    return {
      id: widget.id,
      type: widget.type,
      ...(widget.title ? { title: widget.title } : {}),
      box: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      ...(slots.length ? { slots } : {}),
    };
  });
}

/**
 * 卡片类型槽位模板 —— 转调 `@idt/data-adapter` 的公开 API。
 *
 * <p>不在这一层自己读模板 JSON：那要跨包引用 `packages/.../screen-templates/*.json`，
 * 路径一旦变动就是编译期一片红；而且槽位键的权威定义属于 data-adapter，
 * 归纳逻辑放在那里才对（渲染/待绑定/提案校验都用同一份）。
 */
export function collectWidgetTypeSchemas(): AiWidgetTypeSchema[] {
  return describeWidgetTypeSchemas();
}

/**
 * 场景的默认取数范围。
 *
 * <p>优先用拓扑（场景自己的设备集），没有拓扑信息时退到场站。
 * 两者都没有（本地草稿场景）时返回 undefined —— 这时 AI 也不该编一个。
 */
export function buildSceneScope(document?: SceneDocument | null): AiSceneContext["sceneScope"] {
  const platform = document?.platform;
  if (platform?.topologyId) {
    return {
      kind: "topology",
      topologyId: platform.topologyId,
      ...(platform.topologyName ? { topologyName: platform.topologyName } : {}),
      ...(platform.siteId ? { siteId: platform.siteId } : {}),
      ...(platform.siteName ? { siteName: platform.siteName } : {}),
    };
  }
  if (platform?.siteId) {
    return {
      kind: "site",
      siteId: platform.siteId,
      ...(platform.siteName ? { siteName: platform.siteName } : {}),
    };
  }
  return undefined;
}

export function buildAiSceneContext(input: {
  document?: SceneDocument | null;
  layout?: SceneWidgetLayout | null;
}): AiSceneContext {
  const { document, layout } = input;
  const bindings = document?.bindings;
  return {
    name: document?.scene?.name,
    widgets: layout?.widgets.length ?? 0,
    bindings: bindings?.length ?? 0,
    site: document?.platform?.siteName,
    topology: document?.platform?.topologyName,
    widgetList: buildWidgetBriefs(layout),
    telemetryKeys: collectTelemetryKeys(bindings),
    devices: collectDevices(bindings),
    ...(buildSceneScope(document) ? { sceneScope: buildSceneScope(document)! } : {}),
    /*
     * 卡片类型槽位模板 —— 有了它，AI 才敢「新增」一张指定类型的卡片。
     * 没有时它只能改已有卡片（那些槽位已知）。
     */
    widgetTypes: collectWidgetTypeSchemas(),
  };
}
