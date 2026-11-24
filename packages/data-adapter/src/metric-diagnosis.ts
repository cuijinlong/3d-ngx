import { getDataProvider } from "./registry";

/**
 * 指标诊断依据 + 工况联动判据（2026-11-23）。
 *
 * <h2>要解决的问题</h2>
 *
 * <p>「出水温度 25.3℃ 算不算异常？」—— 这个问题**没有唯一答案**：
 * 制冷工况正常 5~20℃，制热工况正常 30~60℃，同一个 25.3℃
 * 在制冷下偏高、在制热下偏低。所以判据必须**带工况**。
 *
 * <h2>为什么放在 data-adapter</h2>
 *
 * <p>这是引擎能力，不是某个屏的玩法。三个消费方口径必须一致：
 * <ul>
 *   <li>设备专题 —— 说清「为什么算异常」；</li>
 *   <li>平台告警 —— 阈值来源（不凭感觉拍）；</li>
 *   <li>数据孪生 —— 3D 里设备该绿还是该红。</li>
 * </ul>
 *
 * <h2>★ 判据只从字典来，绝不在这里写死任何数字</h2>
 *
 * <p>手册改版、不同机型范围不同（30RQ080VHS 制热上限是 55℃ 不是 60℃），
 * 写死在代码里就再也对不上了。这里只做「取值 + 比对」，
 * 所有边界都来自 `standardKeys[].diagnosis.normalRange`。
 */

/** 一条正常范围。`when` 描述适用工况（自由文本，来自手册原文）。 */
export interface NormalRange {
  min?: number;
  max?: number;
  unit?: string;
  /** 适用工况，如「制冷工况运行中」。缺省表示不限工况。 */
  when?: string;
}

export interface MetricDiagnosis {
  normalRange?: NormalRange[];
  /** 异常意味着什么（一句话）。 */
  faultMeaning?: string;
  /** 建议动作。 */
  actions?: string[];
  /** 关联故障码，可到 faultCodes 字典查详情。 */
  faultCodes?: string[];
  /** 手册章节 / 页码，用于回溯。 */
  docRef?: string;
}

/** key → diagnosis。只收录有 diagnosis 的 key。 */
export type MetricDiagnosisMap = Map<string, MetricDiagnosis>;

/** 判读结果等级。 */
export type MetricVerdict = "ok" | "low" | "high" | "unknown";

export interface MetricJudgement {
  verdict: MetricVerdict;
  /** 命中的那条范围（无则 undefined）。 */
  range?: NormalRange;
  /** 给用户看的一句话，说明为什么这样判。 */
  reason: string;
}

const EMPTY_MAP: MetricDiagnosisMap = new Map();

let cache: Promise<{ byKey: MetricDiagnosisMap; error?: string }> | null = null;

/** 测试用：清空缓存。 */
export function resetMetricDiagnosisCache(): void {
  cache = null;
}

/**
 * 从 `core-dictionaries` 的原始返回里抽出 diagnosis。
 *
 * <p>单独抽出来是为了可测：形状转换是最容易出错的一环，
 * 而它不需要网络。
 */
export function extractMetricDiagnoses(raw: {
  standardKeys?: Array<{ code?: string; diagnosis?: MetricDiagnosis | null }>;
} | null): MetricDiagnosisMap {
  const byKey: MetricDiagnosisMap = new Map();
  for (const item of raw?.standardKeys ?? []) {
    const code = item?.code;
    const diagnosis = item?.diagnosis;
    if (typeof code !== "string" || !code || !diagnosis) continue;
    /*
     * 只保留至少有一个可用字段的 diagnosis。
     *
     * 现场可能出现 `diagnosis: {}` 这种占位（字段建了但还没填）——
     * 收进 map 会让「有没有诊断依据」的判断变成 true，
     * 界面于是显示一个空白的诊断块。
     */
    const hasContent =
      (diagnosis.normalRange?.length ?? 0) > 0 ||
      Boolean(diagnosis.faultMeaning) ||
      (diagnosis.actions?.length ?? 0) > 0 ||
      (diagnosis.faultCodes?.length ?? 0) > 0 ||
      Boolean(diagnosis.docRef);
    if (hasContent) byKey.set(code, diagnosis);
  }
  return byKey;
}

/** 拉取指标诊断依据（带缓存，永不 reject）。 */
export function loadMetricDiagnoses(): Promise<{ byKey: MetricDiagnosisMap; error?: string }> {
  if (cache) return cache;
  cache = (async () => {
    const provider = getDataProvider();
    if (!provider.requestJson) {
      return { byKey: EMPTY_MAP, error: "当前数据源不支持字典（缺少 requestJson）" };
    }
    try {
      const raw = await provider.requestJson<{
        standardKeys?: Array<{ code?: string; diagnosis?: MetricDiagnosis | null }>;
      }>("GET", "/api/energy/core-dictionaries");
      return { byKey: extractMetricDiagnoses(raw) };
    } catch (error) {
      return {
        byKey: EMPTY_MAP,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  return cache;
}

/** 运行工况。`null` = 未知（按全部范围展示，不强行判）。 */
export type WorkingMode = "cooling" | "heating" | null;

const COOLING_HINT = /制冷|冷|cool/i;
const HEATING_HINT = /制热|热|heat/i;

/**
 * 按工况筛出适用的范围。
 *
 * <h2>为什么用「包含关键词」而不是严格相等</h2>
 *
 * <p>`when` 是手册原文的自由文本（「制冷工况运行中」「制热工况运行中」），
 * 各家写法不同，做成强类型枚举就得在录入时归一化 —— 而录入是现场干的，
 * 不可能保证。所以这里认关键词。
 *
 * <h2>没有 `when` 的范围怎么办</h2>
 *
 * <p>不限工况的范围（如「三相不平衡率 ≤2%」）在任何工况下都适用，
 * 所以**永远保留**。这也是为什么 `when` 缺失比写错安全。
 */
export function pickRanges(diagnosis: MetricDiagnosis | null | undefined, mode: WorkingMode): NormalRange[] {
  const all = diagnosis?.normalRange ?? [];
  if (!all.length) return [];
  const generic = all.filter((r) => !r.when || (!COOLING_HINT.test(r.when) && !HEATING_HINT.test(r.when)));
  if (!mode) return all;
  const hint = mode === "cooling" ? COOLING_HINT : HEATING_HINT;
  const matched = all.filter((r) => Boolean(r.when) && hint.test(r.when as string));
  /*
   * 该工况一条都没匹配到（手册只写了另一套）时，退回通用范围。
   * 返回空数组会让界面显示「无判据」—— 那不准确：通用范围仍然适用。
   */
  return [...matched, ...generic];
}

/**
 * 比对单个值。
 *
 * <p>`min` / `max` 任一缺失表示该侧不限。两边都缺失视为无法判。
 */
export function evaluateRange(range: NormalRange, value: number | null | undefined): MetricVerdict {
  if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
  const hasMin = typeof range.min === "number" && Number.isFinite(range.min);
  const hasMax = typeof range.max === "number" && Number.isFinite(range.max);
  if (!hasMin && !hasMax) return "unknown";
  if (hasMin && value < (range.min as number)) return "low";
  if (hasMax && value > (range.max as number)) return "high";
  return "ok";
}

/** 范围的文字形式：`5~20℃` / `≥3℃` / `≤8℃`。 */
export function describeRange(range: NormalRange): string {
  const unit = range.unit ?? "";
  const hasMin = typeof range.min === "number";
  const hasMax = typeof range.max === "number";
  if (hasMin && hasMax) return `${range.min}~${range.max}${unit}`;
  if (hasMin) return `≥${range.min}${unit}`;
  if (hasMax) return `≤${range.max}${unit}`;
  return "—";
}

/**
 * 综合判读一个指标值。
 *
 * <h2>为什么「多工况」时要特别说清</h2>
 *
 * <p>如果该 key 有多套范围而工况未知，硬判会误报。这时返回 `unknown`
 * 并说明「需按工况判」—— 界面上表现为「当前工况未知，无法判断」，
 * 而不是假装正常。**假装正常比报错危险**：运维会以为没问题。
 */
export function judgeMetric(
  diagnosis: MetricDiagnosis | null | undefined,
  value: number | null | undefined,
  mode: WorkingMode,
): MetricJudgement {
  const ranges = pickRanges(diagnosis, mode);
  if (!ranges.length) {
    return { verdict: "unknown", reason: diagnosis?.faultMeaning ? diagnosis.faultMeaning : "该指标暂无官方判据" };
  }
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { verdict: "unknown", reason: "当前值缺失，无法判读" };
  }

  /*
   * 工况未知且有工况限定范围时，优先信「通用范围」；
   * 一条通用范围都没有就明说无法判。
   */
  const generic = ranges.filter((r) => !r.when);
  const candidates = !mode && generic.length ? generic : ranges;

  for (const range of candidates) {
    const verdict = evaluateRange(range, value);
    if (verdict === "ok") {
      const when = range.when ? `（${range.when}）` : "";
      return {
        verdict: "ok",
        range,
        reason: `在当前正常范围 ${describeRange(range)}${when} 内`,
      };
    }
  }

  /*
   * 一条都没落在范围内 —— 挑「最接近」的那条来报，用户才知道差多少。
   * 全部超出时按第一条（通常是主工况）报，避免同时甩出两套矛盾结论。
   */
  const primary = candidates[0] as NormalRange;
  const verdict = evaluateRange(primary, value);
  const when = primary.when ? `（${primary.when}）` : "";
  const dir = verdict === "high" ? "高于" : verdict === "low" ? "低于" : "不在";
  return {
    verdict: verdict === "unknown" ? "unknown" : verdict,
    range: primary,
    reason: `${dir}正常范围 ${describeRange(primary)}${when}，当前 ${value}${primary.unit ?? ""}`,
  };
}

/**
 * 从 `sys_mode` 的原始值推断工况。
 *
 * <p>开利协议：0=制冷 1=制热（手册 §17 30003）。其它厂商可能不同，
 * 所以这个映射也放在字典之外、由调用方传语义进来更稳妥 ——
 * 这里保留一个默认实现，作为「没有更精确信息时」的兜底。
 *
 * <p>返回 `null` 表示无法判断（值缺失或不是已知取值）——
 * 宁可不判，也不要猜错工况然后给出反的结论。
 *
 * <p>接受 `unknown`：遥测值可能是 `number | string | boolean`，
 * 而布尔值在这里就是「未知工况」而不是 0/1。
 */
export function inferWorkingMode(sysModeValue: unknown): WorkingMode {
  if (sysModeValue === null || sysModeValue === undefined || sysModeValue === "") return null;
  /* 布尔值不能当 0/1：那会把「true」误判成制热 */
  if (typeof sysModeValue === "boolean") return null;
  const n = typeof sysModeValue === "number" ? sysModeValue : Number(sysModeValue);
  if (Number.isFinite(n)) {
    if (n === 0) return "cooling";
    if (n === 1) return "heating";
    return null;
  }
  const text = String(sysModeValue);
  if (COOLING_HINT.test(text)) return "cooling";
  if (HEATING_HINT.test(text)) return "heating";
  return null;
}
