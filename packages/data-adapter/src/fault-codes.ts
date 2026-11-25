import { getDataProvider } from "./registry";

/**
 * 厂商故障码诊断字典（2026-11-23）。
 *
 * <h2>它解决什么问题</h2>
 *
 * <p>现场拿到一个故障码（`TH702`、`10044`），要回答的是
 * **「这是什么、为什么、该查什么」**。以前这个答案在 PDF 里、在老师傅脑子里。
 * 现在平台把官方手册的「故障代码 / 描述 / 分析 / 解决方案」四列固化进
 * 主数据字典，前端只负责按码把它查出来。
 *
 * <h2>为什么放在 data-adapter 而不是页面里</h2>
 *
 * <p>按项目铁律，这是**引擎能力**不是某个屏的玩法：告警面板、设备专题、
 * 数据孪生上色、AI 归因四个消费方都要用同一份口径。
 * 写在某个 `.tsx` 里，第二个消费方必然复制一遍，然后慢慢走偏。
 *
 * <h2>为什么不给 provider 加 `getFaultCodes()` 方法</h2>
 *
 * <p>`requestJson` 已经是「带当前身份请求平台」的最小能力，
 * 再加专用方法等于让每个 provider 实现（mock / guard / 将来的其它源）
 * 各写一遍。字典接口是纯读，走通用请求即可。
 * 缺失 `requestJson` 时返回空字典并给出说明 —— 不抛错，因为
 * 「没有诊断依据」不该让告警列表整块打不开。
 */

/** 字典里的一条。`codes` 是数组：手册区间写法（CM001~CM016）一条覆盖多个码。 */
export interface FaultCodeEntry {
  codes: string[];
  /** 故障描述（手册原文）。 */
  desc: string;
  /** 故障分析 —— 为什么会这样。 */
  analysis?: string;
  /** 解决方案 —— 该查什么、换什么。 */
  solution?: string;
  /** 来源标识，如 `carrier-30rq-750vhs`。用于追溯是哪份官方文档。 */
  source?: string;
}

export interface FaultCodeDictionary {
  initialized: boolean;
  version: number;
  total: number;
  /** 扁平索引：code → 条目。区间写法已展开。 */
  byCode: Map<string, FaultCodeEntry>;
  /** 查询失败的说明（不阻断渲染）。 */
  error?: string;
}

const EMPTY: FaultCodeDictionary = {
  initialized: false,
  version: 0,
  total: 0,
  byCode: new Map(),
};

/**
 * 模块级缓存。
 *
 * <p>字典是租户级主数据，一天可能都不变一次，而告警面板会频繁重渲染。
 * 不缓存就是每次渲染都发一个 HTTP 请求。用 Promise 缓存而不是结果缓存：
 * 并发调用（多个卡片同时挂载）共享同一个 in-flight 请求，不会打出多个。
 */
const cache = new Map<string, Promise<FaultCodeDictionary>>();

/** 测试用：清空缓存。生产代码不要调。 */
export function resetFaultCodeCache(): void {
  cache.clear();
}

/** 把 `{ initialised, entries }` 转成按码索引。区间已在后端展开，这里只做扁平化。 */
export function indexFaultCodes(raw: {
  initialized?: boolean;
  version?: number;
  total?: number;
  entries?: FaultCodeEntry[];
  error?: string;
}): FaultCodeDictionary {
  const byCode = new Map<string, FaultCodeEntry>();
  for (const entry of raw.entries ?? []) {
    if (!entry || !Array.isArray(entry.codes)) continue;
    for (const code of entry.codes) {
      const key = String(code).trim();
      if (!key) continue;
      // 同一码出现两次时保留先到的：手册里后出现的多为区间补充说明
      if (!byCode.has(key)) byCode.set(key, entry);
    }
  }
  return {
    initialized: Boolean(raw.initialized),
    version: raw.version ?? 0,
    total: raw.total ?? byCode.size,
    byCode,
    error: raw.error,
  };
}

/**
 * 拉取故障码字典（带缓存）。
 *
 * <p>返回的 Promise 永不 reject —— 失败时给一个带 `error` 的空字典。
 * 理由：诊断信息是**增强**，不是主流程。它挂了不该让告警列表打不开。
 *
 * <h3>`deviceId` 的含义（2026-11-24）</h3>
 *
 * <p>不传 = 拉**全部型号**的码。告警列表必须用这一档：一条告警属于哪台
 * 设备都还没确定，只拉某个型号的码会让其它型号的告警翻不出说明。
 *
 * <p>传了 = 只拉该设备型号的码（后端按「设备 → 型号」反查）。
 * 告警详情页已经知道设备，用这一档能少拿一堆无关条目。
 *
 * <p>两档**分别缓存**（缓存键不同）。合成一份会互相污染：先打开的详情页
 * 把局部字典塞进缓存，之后告警列表就会拿不到别的型号的码 ——
 * 而这种缺失是静默的，只表现为「有些告警没有说明」。
 *
 * <p>后端定位不到型号时（设备 `model` 属性是「其他型号」这类自由文本）
 * 会**自动退回全量**并在 `scopeFallback` 里说明，所以传 deviceId 也不会更少。
 */
export function loadFaultCodes(deviceId?: string): Promise<FaultCodeDictionary> {
  const key = deviceId?.trim() || "";
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = (async () => {
    const provider = getDataProvider();
    if (!provider.requestJson) {
      return {
        ...EMPTY,
        error: "当前数据源不支持诊断字典（缺少 requestJson）",
      };
    }
    try {
      const path = key
        ? `/api/energy/fault-codes?deviceId=${encodeURIComponent(key)}`
        : "/api/energy/fault-codes";
      const raw = await provider.requestJson<{
        initialized?: boolean;
        version?: number;
        total?: number;
        entries?: FaultCodeEntry[];
        error?: string;
      }>("GET", path);
      return indexFaultCodes(raw ?? {});
    } catch (error) {
      return {
        ...EMPTY,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  cache.set(key, pending);
  return pending;
}

/**
 * 从任意文本里提取故障码。
 *
 * <h2>为什么要从文本里抽，而不是要求结构化字段</h2>
 *
 * <p>平台告警是 TB 原生结构（`type` / `severity` / `details`），
 * 故障码通常被拼进告警标题或消息里（`模块机 1# 报警 TH702` / `外机报警代码 CM071`）。
 * 我们没有权限改平台的告警写入格式，也不该要求现场按某个格式配置
 * —— 所以从文本里认码是唯一可行的路。
 *
 * <h2>识别的两种形态</h2>
 *
 * <ul>
 *   <li><b>厂商字母码</b>：`CM000` `CF021` `TH702` `PR731` `VF501` `VW201`
 *       —— 开利/约克这类变频机组手册的写法；</li>
 *   <li><b>寄存器数字码</b>：`10036` `10044` —— 卡乐这类按寄存器地址报的写法。
 *       只在**独立出现**时认（前后不是数字），否则 `30001` 这类地址会被误吞。</li>
 * </ul>
 *
 * <p>数字码要求 5 位且以 `10` 开头：这是实测两份手册的编码规律
 * （卡乐 10002~10102）。放宽会引入大量误报。
 */
const ALPHA_CODE = /\b(?:CM|CF|TH|PR|VF|VW|PA|PC|HP|LP)\d{3}\b/gi;
const NUMERIC_CODE = /(?<![\d.-])(10\d{3})(?![\d])/g;
export function extractFaultCodes(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(ALPHA_CODE)) {
    found.add(match[0].toUpperCase());
  }
  for (const match of text.matchAll(NUMERIC_CODE)) {
    found.add(match[1] as string);
  }
  return [...found];
}

/** 一批文本 → 命中的字典条目（去重，按首次出现顺序）。 */
export function lookupFaultCodes(
  dictionary: FaultCodeDictionary | null | undefined,
  text: string | null | undefined,
): FaultCodeEntry[] {
  if (!dictionary || !dictionary.byCode.size) return [];
  const out: FaultCodeEntry[] = [];
  const seen = new Set<FaultCodeEntry>();
  for (const code of extractFaultCodes(text)) {
    const entry = dictionary.byCode.get(code);
    if (entry && !seen.has(entry)) {
      seen.add(entry);
      out.push(entry);
    }
  }
  return out;
}

/** 单码查询：告警详情里按码查，或用户手工输入。 */
export function findFaultCode(
  dictionary: FaultCodeDictionary | null | undefined,
  code: string,
): FaultCodeEntry | null {
  if (!dictionary) return null;
  return dictionary.byCode.get(code.trim().toUpperCase()) ?? null;
}
