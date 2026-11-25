import type { DeviceBinding, SceneDocument } from "@idt/shared-types";
import type { SceneWidget, SceneWidgetLayout } from "@idt/data-adapter";
import {
  describeWidgetTypeSchemas,
  energyKindOf,
  energyMetricOf,
  expandDefaultTitle,
  getBuiltinScreenTemplate,
} from "@idt/data-adapter";

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
    /**
     * 候选测点（**只给未绑定的槽位**，最多 3 条，按相关度排序）。
     *
     * <h3>为什么要把排序结果直接给它（2026-11-24）</h3>
     *
     * <p>§30.8 记的遗留项：「AI 不知道槽位该绑哪个键，只能从标签和单位上做弱判断」。
     * 实测它面对 60 个可用键时，会挑一个「看起来差不多」的 ——
     * 比如把「机组功率」绑到某台设备的 `opening`，因为两者都带 `%`。
     *
     * <p>把「label 最像的那几个」预先算好放在槽位旁边，模型就从一个
     * 「在 60 个里猜」的任务变成「在 3 个里挑」—— 而后者它做得很好。
     * 判据是纯文本的，不依赖模型能力，所以结果稳定可复现。
     */
    suggestedKeys?: Array<{ key: string; label?: string; unit?: string; reason: string }>;
  }>;
  /**
   * 这张卡现在按什么口径统计（2026-11-24）。
   *
   * <h3>为什么必须给</h3>
   *
   * <p>客户原话：「最起码用户可以参与告诉 AI 现场是什么情况，
   * 好让他修改大屏的布局和统计维度」。
   *
   * <p>此前 AI 只知道卡片「有哪几个槽位」，不知道它是「读设备遥测」
   * 还是「读场站能耗」，也不知道看的是用量/成本/碳排。
   * 于是用户说「把这张改成看碳排」，AI 只能凭卡片标题猜 ——
   * 而 `energyMetric` 本来就是 `update-widget` 能改的字段。
   */
  stats?: {
    /** `telemetry` = 读设备实时测点；`energy` = 读场站能耗统计。 */
    dataSource: "telemetry" | "energy";
    /** 只在 energy 口径下有意义。缺省表示按部件类型的默认值。 */
    energyMetric?: string;
    /** 统计品种码（elec / heat / water / gas / steam…）。 */
    energyKind?: string;
    /** true = 当前是类型默认值，不是显式配置的。 */
    energyMetricDefaulted?: boolean;
  };
  /** 设备名包含过滤（device-list / bar-compare 用）。改它就是换统计范围。 */
  filterText?: string;
  /** 范围：整场站 or 某拓扑（决定「统计哪些设备」）。 */
  scope?: string;
}

/**
 * 可选的统计维度清单（2026-11-24）。
 *
 * <p>客户说「其实就是知识库提供给 AI」——这就是那份知识：
 * 字段能填什么、每项是什么意思、哪种卡适合哪种口径。
 *
 * <p>**不硬编码在前端与 prompt 两处**：这张表从部件类型定义里读
 * （`describeWidgetTypeSchemas`），漏了新类型会自动跟上。
 */
export interface AiStatsVocabulary {
  dataSource: Array<{ value: string; label: string; note: string }>;
  energyMetric: Array<{ value: string; label: string; note: string }>;
  energyKindNote: string;
  /** 按部件类型的默认口径 —— AI 要据此判断「不填会变成什么」。 */
  defaultsByType: Array<{ type: string; dataSource: string; energyMetric?: string }>;
}

export function buildStatsVocabulary(): AiStatsVocabulary {
  return {
    dataSource: [
      { value: "telemetry", label: "设备实时测点", note: "读单台或按范围逐台的遥测（温度/功率/开度等）" },
      { value: "energy", label: "场站能耗统计", note: "读场站级汇总（用量/成本/碳排/折标煤），不受单台设备限制" },
    ],
    energyMetric: [
      { value: "usage", label: "用量", note: "按品种统计消耗量，需同时给 energyKind" },
      { value: "cost", label: "费用", note: "按费率折算的金额" },
      { value: "carbon", label: "碳排", note: "按排放因子折算" },
      { value: "tce", label: "折标煤", note: "统一折算到吨标煤，跨品种可比" },
      { value: "trend", label: "趋势", note: "按时间分桶的走势，适合 trend-chart" },
      { value: "ranking", label: "排名", note: "按设备/分项排序，适合 bar-compare" },
    ],
    energyKindNote:
      "统计品种码由平台按场站实际品种返回（常见 elec 电 / heat 热 / water 水 / gas 气 / steam 汽）。"
      + "不校验取值，但填了场站没有的品种会显示「该场站没有 X 品种数据」。",
    defaultsByType: [
      { type: "metric-card", dataSource: "energy", energyMetric: "usage" },
      { type: "trend-chart", dataSource: "energy", energyMetric: "trend" },
      { type: "bar-compare", dataSource: "energy", energyMetric: "ranking" },
      { type: "device-list", dataSource: "telemetry" },
      { type: "selection-card", dataSource: "telemetry" },
    ],
  };
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
  /**
   * 模板里的约定文件（2026-11-24）——由调用方读好后放进上下文。
   *
   * <p>为什么不在 `buildAiSceneContext` 里读：那会让这个纯函数变成
   * 异步 + 依赖网络，测试要 mock 一堆东西。
   * 读取由 `useTemplateDocs` 负责，这里只承载数据。
   *
   * <p>内容是**作者写的意图**（`requirements.md` / `SKILL.md` /
   * `schema.json` / `style-pack.json`），优先级高于模型对场景结构的推断。
   * 没有它就是空数组 —— 与「读失败」在模型侧表现一致，都表示「没有额外要求」。
   */
  templateDocs?: Array<{ name: string; content: string }>;
  /**
   * 模板规划的底稿 + 与当前实例的偏差（2026-11-24）。
   *
   * <h2>为什么这是「不断改实例来教 AI」的关键</h2>
   *
   * <p>客户原话：「我还是想通过不断的修改实例化的模板来更好的和 AI 交互理解」。
   *
   * <p>用户手工挪一张卡、改一个标题，本身就是**偏好的表达**。
   * 但此前 AI 只看得到现状（`widgetList`），看不到「本来该是什么样」，
   * 于是它无法理解「这个位置是用户特意挪的」还是「模板本来就这样」。
   *
   * <p>给出基线 + 偏差后，AI 能读出意图：「用户把告警卡从右下挪到右中，
   * 说明他更看重告警」—— 之后再加卡就会避开告警的位置、优先给它留空间。
   */
  templateBaseline?: AiTemplateBaseline;
  /**
   * 统计维度词表（2026-11-24）。
   *
   * <p>客户说「其实就是知识库提供给 AI」—— 这是知识库里关于**口径**的那份：
   * 字段能填什么、每项什么意思、各类型默认填什么。
   * 没有它，模型只知道「有个 energyMetric 字段」，不知道能改成哪几个值。
   */
  statsVocabulary?: AiStatsVocabulary;
}

/** 模板底稿与实例偏差。 */
export interface AiTemplateBaseline {
  templateId: string;
  name: string;
  /** 模板规划的全部区域（按模板顺序）。 */
  regions: Array<{
    id: string;
    type: string;
    title: string;
    box: { x: number; y: number; w: number; h: number };
  }>;
  /**
   * 实例相对模板的改动 —— **这是用户的偏好信号**，不是错误。
   *
   * <p>只收「有意义的」：位置变化要超过 {@link MOVE_EPS} 个百分点、
   * 标题要真的不同。像素级的微调收进来只会淹没真正的意图。
   */
  deviations?: {
    /** 模板有、实例没有 —— 用户删掉了。 */
    removed: Array<{ id: string; type: string; title: string }>;
    /** 实例有、模板没有 —— 用户自己加的。 */
    added: Array<{ id: string; type: string; title: string }>;
    /** 位置或尺寸变了。 */
    moved: Array<{ id: string; title: string; from: string; to: string }>;
    /** 标题变了。 */
    retitled: Array<{ id: string; from: string; to: string }>;
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

/** 每个未绑定槽位最多给 3 个候选；再多模型反而挑花眼。 */
const MAX_SUGGESTIONS_PER_SLOT = 3;

/** 每张卡最多为几个槽位算候选：冷门卡片常常一堆空槽位。 */
const MAX_SUGGESTED_SLOTS_PER_WIDGET = 6;

/** 建议理由，直接写进 prompt —— 模型看得懂「为什么是它」才会用。 */
export type SlotSuggestionReason = "label-exact" | "label-partial" | "unit-and-label" | "unit";

function normalizeText(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

/**
 * 给一个未绑定槽位挑候选测点键（2026-11-24，§30.8-1 的遗留项）。
 *
 * <h2>打分规则（从强到弱）</h2>
 *
 * <ol>
 *   <li><b>label 完全相同</b>（「功率」vs「功率」）—— 最强信号；</li>
 *   <li><b>label 互相包含</b>（「进水温度」vs「温度」）—— 次强，
 *       要求双方都 ≥2 字，免得单个「水」把所有带水的键都捞进来；</li>
 *   <li><b>单位一致</b>（槽位 `kW`、键 `kW`）—— 中等信号。
 *       单独用不够：九台机组的 `opening` 也带 `%`，把「机组功率」绑到
 *       开度上就是这么来的。所以单位只在 label 也有点时加分。</li>
 *   <li><b>只有单位一致</b> —— 最弱，只在没有任何 label 命中时才给，
 *       且理由写成 `unit`（意思是「只能靠单位猜」）。</li>
 * </ol>
 *
 * <p>已绑定的槽位不参与 —— 那会挤掉真正需要建议的空槽位。
 *
 * <p>`deviceCount` 参与排序：同一 label 有通用键（出现在 9 台上）和
 * 专属键（只 1 台）时，通用键更适合做卡片级绑定。
 */
export function suggestKeysForSlot(
  slot: { label?: string; unit?: string },
  keys: AiTelemetryKeyBrief[],
): Array<{ key: string; label?: string; unit?: string; reason: SlotSuggestionReason }> {
  const slotLabel = normalizeText(slot.label);
  const slotUnit = normalizeText(slot.unit);
  const scored: Array<{
    item: AiTelemetryKeyBrief;
    score: number;
    reason: SlotSuggestionReason;
  }> = [];

  for (const item of keys) {
    const keyLabel = normalizeText(item.label);
    const keyUnit = normalizeText(item.unit);
    const unitMatch = Boolean(slotUnit && keyUnit && slotUnit === keyUnit);
    let score = 0;
    let reason: SlotSuggestionReason | null = null;

    if (slotLabel && keyLabel && slotLabel === keyLabel) {
      score = 100;
      reason = unitMatch ? "unit-and-label" : "label-exact";
    } else if (
      slotLabel &&
      keyLabel &&
      slotLabel.length >= 2 &&
      keyLabel.length >= 2 &&
      (slotLabel.includes(keyLabel) || keyLabel.includes(slotLabel))
    ) {
      score = unitMatch ? 70 : 60;
      reason = unitMatch ? "unit-and-label" : "label-partial";
    } else if (unitMatch) {
      score = 20;
      reason = "unit";
    }

    if (!reason || score <= 0) continue;
    /* 通用键优先：同一 label 下 9 台都有的键比 1 台特有的更适合做卡片绑定 */
    score += Math.min(9, item.deviceCount);
    scored.push({ item, score, reason });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.item.key.localeCompare(b.item.key))
    .slice(0, MAX_SUGGESTIONS_PER_SLOT)
    .map(({ item, reason }) => ({
      key: item.key,
      ...(item.label ? { label: item.label } : {}),
      ...(item.unit ? { unit: item.unit } : {}),
      reason,
    }));
}

export function buildWidgetBriefs(
  layout: SceneWidgetLayout | null | undefined,
  telemetryKeys: AiTelemetryKeyBrief[] = [],
): AiWidgetBrief[] {
  return (layout?.widgets ?? []).slice(0, MAX_WIDGETS).map((widget) => {
    /* 每张卡只给前几个空槽位算候选，避免一张卡就撑爆 prompt */
    let suggestedBudget = MAX_SUGGESTED_SLOTS_PER_WIDGET;
    const slots = (widget.slots ?? []).slice(0, MAX_SLOTS_PER_WIDGET).map((slot) => {
      /*
       * 只给空槽位算候选：已绑的槽位不需要推荐，
       * 给它反而会挤占「这张卡到底哪几格还空着」的注意力。
       */
      const needsSuggestion = !slot.telemetryKey && suggestedBudget > 0 && telemetryKeys.length > 0;
      const suggested = needsSuggestion ? suggestKeysForSlot(slot, telemetryKeys) : [];
      if (suggested.length) suggestedBudget -= 1;
      return {
        key: slot.key,
        ...(slot.label ? { label: slot.label } : {}),
        ...(slot.unit ? { unit: slot.unit } : {}),
        ...(slot.telemetryKey ? { telemetryKey: slot.telemetryKey } : {}),
        ...(suggested.length ? { suggestedKeys: suggested } : {}),
      };
    });
    /*
     * 统计口径（2026-11-24）。
     *
     * <p>客户原话：「最起码用户可以参与告诉 AI 现场是什么情况，
     * 好让他修改大屏的布局和统计维度」。
     *
     * <p>只给**能耗类**卡片带 energyMetric：遥测类卡片没有「用量/成本」
     * 这些概念，给它加只会让模型以为可以无故改。反过来，
     * `energyMetricDefaulted` 要标出来 —— 模型得知道「这个值没显式配过」，
     * 用户说「改成看碳排」时它才敢直接覆盖。
     */
    const dataSource = widget.dataSource ?? defaultDataSourceOf(widget.type);
    const stats =
      dataSource === "energy"
        ? {
            dataSource,
            energyMetric: energyMetricOf(widget),
            energyKind: energyKindOf(widget),
            ...(widget.energyMetric ? {} : { energyMetricDefaulted: true }),
          }
        : { dataSource };
    return {
      id: widget.id,
      type: widget.type,
      ...(widget.title ? { title: widget.title } : {}),
      box: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      ...(slots.length ? { slots } : {}),
      stats,
      ...(widget.filterText ? { filterText: widget.filterText } : {}),
      ...(widget.scope ? { scope: describeScope(widget.scope) } : {}),
    };
  });
}

/**
 * 没有显式 `dataSource` 时，按部件类型判断它读的是哪一类数。
 *
 * <p>与渲染层的判据一致（`EnergyCards` 走 energy 分支的类型）：
 * 指标卡 / 趋势 / 条形对比默认读场站能耗；设备列表与选中卡读遥测。
 * 分叉的后果是「AI 以为这张卡能改口径，改完卡片毫无变化」。
 */
function defaultDataSourceOf(type: string): "telemetry" | "energy" {
  if (type === "metric-card" || type === "trend-chart" || type === "bar-compare") return "energy";
  return "telemetry";
}

/** 范围的可读描述 —— 模型看得懂「整场站」才好判断统计范围。 */
function describeScope(scope: SceneWidget["scope"]): string {
  if (!scope) return "未指定";
  if (scope.kind === "site") return `场站：${scope.siteName ?? scope.siteId ?? "全部"}`;
  if (scope.kind === "topology") return `拓扑：${scope.topologyName ?? scope.topologyId ?? "当前场景"}`;
  return String(scope.kind);
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

/** 位置变化超过这个百分点才算「挪过」—— 像素级微调不是意图。 */
const MOVE_EPS = 2;

function boxText(box: { x: number; y: number; w: number; h: number }): string {
  /* 保留一位小数：百分比坐标写成 2.4000000000000004 只会让模型分心 */
  const r = (n: number) => Math.round(n * 10) / 10;
  return `${r(box.x)},${r(box.y)},${r(box.w)},${r(box.h)}`;
}

/**
 * 算出「模板底稿」与「当前实例」的差异（2026-11-24）。
 *
 * <p>匹配键是 widget id —— `materializeScreenTemplate` 里
 * `id: region.id`，所以模板区域与实例卡片的 id 天然一致。
 *
 * <p>没有模板（`layout.templateId` 为空、或那个模板已下线）时返回 undefined：
 * 这时 AI 只该看现状，硬编一个「基线」等于给它错误参照。
 */
export function buildTemplateBaseline(
  layout?: SceneWidgetLayout | null,
  /*
   * 场景名（2026-11-24）。
   *
   * <p>模板标题里常有 `{sceneName}` 占位符（如 `{sceneName} · 冷热站监控`），
   * 实例化时会被展开成真实场景名。不带进来直接比字符串，
   * 每张带占位符的卡都会被判成「用户改过标题」—— 那是噪音，
   * 而且会误导 AI 去"还原"一个本来就没变过的标题。
   */
  sceneName?: string,
): AiTemplateBaseline | undefined {
  const templateId = layout?.templateId;
  if (!templateId) return undefined;
  const template = getBuiltinScreenTemplate(templateId);
  if (!template) return undefined;

  const regions = template.regions.map((region) => ({
    id: region.id,
    type: region.type,
    /* 展开占位符后再比 —— 与 materializeScreenTemplate 同口径 */
    title: expandDefaultTitle(region.defaultTitle, sceneName),
    box: { x: region.x, y: region.y, w: region.w, h: region.h },
  }));

  const byId = new Map<string, SceneWidget>((layout?.widgets ?? []).map((w) => [w.id, w]));
  const regionIds = new Set(regions.map((r) => r.id));

  const removed: Array<{ id: string; type: string; title: string }> = [];
  const moved: Array<{ id: string; title: string; from: string; to: string }> = [];
  const retitled: Array<{ id: string; from: string; to: string }> = [];

  for (const region of regions) {
    const widget = byId.get(region.id);
    if (!widget) {
      /* 模板有、实例没有 → 用户删了。不区分「还没建」与「删了」：
         两者对 AI 的含义一致 —— 现在没有这块。 */
      removed.push({ id: region.id, type: region.type, title: region.title });
      continue;
    }
    const from = region.box;
    const to = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
    const drifted =
      Math.abs(from.x - to.x) > MOVE_EPS ||
      Math.abs(from.y - to.y) > MOVE_EPS ||
      Math.abs(from.w - to.w) > MOVE_EPS ||
      Math.abs(from.h - to.h) > MOVE_EPS;
    if (drifted) {
      moved.push({ id: region.id, title: widget.title ?? region.title, from: boxText(from), to: boxText(to) });
    }
    const regionTitle = widget.title?.trim();
    if (regionTitle && regionTitle !== region.title) {
      retitled.push({ id: region.id, from: region.title, to: regionTitle });
    }
  }

  const added = (layout?.widgets ?? [])
    .filter((w) => !regionIds.has(w.id))
    .map((w) => ({ id: w.id, type: w.type, title: w.title ?? "" }));

  const hasDeviation = removed.length + moved.length + retitled.length + added.length > 0;
  return {
    templateId,
    name: template.name,
    regions,
    ...(hasDeviation ? { deviations: { removed, added, moved, retitled } } : {}),
  };
}

export function buildAiSceneContext(input: {
  document?: SceneDocument | null;
  layout?: SceneWidgetLayout | null;
}): AiSceneContext {
  const { document, layout } = input;
  const bindings = document?.bindings;
  /*
   * 遥测键先算出来，再传给 `buildWidgetBriefs` ——
   * 空槽位的候选推荐就是从这份键表里挑的（§30.8-1 遗留项）。
   */
  const telemetryKeys = collectTelemetryKeys(bindings);
  return {
    name: document?.scene?.name,
    widgets: layout?.widgets.length ?? 0,
    bindings: bindings?.length ?? 0,
    site: document?.platform?.siteName,
    topology: document?.platform?.topologyName,
    widgetList: buildWidgetBriefs(layout, telemetryKeys),
    telemetryKeys,
    devices: collectDevices(bindings),
    ...(buildSceneScope(document) ? { sceneScope: buildSceneScope(document)! } : {}),
    /*
     * 模板底稿与偏差。有它，AI 才能把「用户手工改过的地方」当成偏好读，
     * 而不是把现状当成模板原样。
     */
    ...(buildTemplateBaseline(layout, document?.scene.name)
      ? { templateBaseline: buildTemplateBaseline(layout, document?.scene.name)! }
      : {}),
    /* 统计维度词表 —— 「知识库」里关于口径的那部分，模型据此才知道能改成什么 */
    statsVocabulary: buildStatsVocabulary(),
    /*
     * 卡片类型槽位模板 —— 有了它，AI 才敢「新增」一张指定类型的卡片。
     * 没有时它只能改已有卡片（那些槽位已知）。
     */
    widgetTypes: collectWidgetTypeSchemas(),
  };
}
