import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDataProvider } from "@idt/data-adapter";

/**
 * 场站能耗统计（2026-11-23）。
 *
 * <h2>它取代了什么</h2>
 *
 * <p>大屏原先只读「遥测点位」—— 9 台模块机的 `power` / `temperature`。
 * 客户的要求是「场站的年月日时耗电统计、最高最低、碳核算」，
 * 这些是**统计量**不是点位量，必须走平台的业务接口：
 * `GET /api/energy/comprehensive`。
 *
 * <h2>为什么按 topologyId 而不是 siteId 参数</h2>
 *
 * <p>大屏只知道自己是哪个拓扑（场景）。设备挂在哪个场站只有平台知道。
 * `GET /api/energy/topologies/{id}` 直接返回 `siteId`，
 * 所以这里先解析一次、缓存起来，再拿去查统计 —— 调用方不必关心场站。
 *
 * <h2>★ 一个必须说清的数据事实：序列单位是 tce，不是 kWh</h2>
 *
 * <p>`comprehensive` 的 `series[].tce` 是**综合能耗折标煤**，
 * 把电、热、气、水按各自的折标系数汇总后除以 1000。
 * 分品种的原始用量在 `byKind[]` 里（`code: "elec"` 的 `usage` 才是 kWh）。
 *
 * <p>不能把 tce 换算回 kWh 当成「耗电趋势」：那样会把热力 11.6 GJ 也
 * 折成等效电量，曲线含义就错了。所以趋势卡展示的是「综合能耗 (tce)」，
 * 而「用电量 (kW·h)」单独作为 KPI 出现 —— 两者单位不同，各自诚实。
 *
 * <h2>平台的时间窗上限</h2>
 *
 * <p>`/api/energy/comprehensive` 拒绝 `to - from > 366 天`。
 * 所以「年」这一档拿不到 5 年历史，最多一年 —— 返回里带 `warning`
 * 说明这件事，卡片上也要标出来，否则客户会以为系统只存了一年数据。
 */

export type EnergyGranularity = "hour" | "day" | "month" | "year";

export const ENERGY_GRANULARITIES: Array<{ value: EnergyGranularity; label: string; hint: string }> = [
  { value: "hour", label: "时", hint: "近 48 小时" },
  { value: "day", label: "日", hint: "近 30 天" },
  { value: "month", label: "月", hint: "近 12 个月" },
  { value: "year", label: "年", hint: "近 1 年（平台上限）" },
];

const DAY_MS = 86_400_000;

/**
 * 各粒度的默认时间窗，**对齐到周期边界**。
 *
 * <h3>★ 为什么必须对齐（2026-11-23 实测）</h3>
 *
 * <p>第一版写的是 `to = Date.now()`、`from = to - 30 天`。结果同一屏
 * 隔几分钟刷新一次，用电量从 `91.34万` 跳到 `78.39万` —— 差 14%，
 * 而底层数据一个字节都没变（同参数连查三次完全相同）。
 *
 * <p>原因是平台按**整天**做桶。窗口起点 `11-13 13:47` 落在 11-13 这天中间，
 * 平台对这一天的取舍随查询时刻漂移：13:47 查时整天的量被算进来，
 * 13:52 查时又可能只算一部分 —— 每次刷新边界天进出，数字就跳一格。
 *
 * <p>对齐到 00:00 之后，窗口在一天之内固定，刷新只影响「今天」这个正在
 * 累积的桶（那是应该变的）。**数字自己会跳比数字偏小更糟** ——
 * 客户会认定系统坏了。
 */
function windowFor(gran: EnergyGranularity): { from: number; to: number } {
  const now = new Date();
  switch (gran) {
    case "hour": {
      /* 对齐到整点，回看 48 个整点 */
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
      return { from: to - 47 * 3_600_000, to: to + 3_600_000 };
    }
    case "day": {
      /* 今天 00:00 往前 29 天 = 完整 30 个自然日 */
      const to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      return { from: to - 29 * DAY_MS, to: to + DAY_MS };
    }
    case "month": {
      /* 本月 1 日 00:00 往前 11 个月 = 完整 12 个自然月 */
      const to = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const from = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
      return { from, to: Math.min(to + 31 * DAY_MS, Date.now()) };
    }
    case "year":
    default: {
      /*
       * 平台硬上限 366 天。对齐到今年 1 月 1 日；
       * 若今天已过 1 月，跨度必然 < 366 天，安全。
       */
      const to = new Date(now.getFullYear(), 0, 1).getTime();
      return { from: to, to: Math.min(to + 365 * DAY_MS, Date.now()) };
    }
  }
}

export interface EnergyKindRow {
  code: string;
  name: string;
  unit: string;
  usage: number;
  tce: number;
  co2: number;
  cost: number;
  pct: number;
}

export interface EnergyBucket {
  bucket: string;
  /** 综合能耗（吨标煤）。喂「综合能耗」口径，**不是**耗电量。 */
  tce: number;
  /**
   * 该桶的分品种用量（2026-11-23）。
   *
   * <p>单位随品种走：`elec` 是 kW·h、`heat` 是 GJ、`water` 是 m³。
   * 取不到某个品种就是「这一段没有该品种数据」，不是 0。
   *
   * <p>客户要的「年月日时耗电统计」取的就是 `byKind.elec`。
   */
  byKind: Record<string, number>;
}

export interface EnergyDeviceRow {
  id: string;
  /** 技术名（平台唯一键），标识用 */
  name: string;
  /**
   * 显示名（2026-11-23，命名铁律）。
   *
   * <p>平台侧补了这个字段。为空时前端回落 `name` ——
   * 但**不要**在显示处直接写 `label || name`，用 `displayNameOf`。
   */
  label: string;
  kind: string;
  kindName: string;
  unit: string;
  usage: number;
  tce: number;
  cost: number;
  virtual?: boolean;
  counted?: boolean;
}

export interface SiteEnergyStats {
  loading: boolean;
  error: string | null;
  /** 解析到的场站 id；null = 还没取到或该拓扑没有场站 */
  siteId: string | null;
  granularity: EnergyGranularity;
  kpi: { tce: number; cost: number; co2: number; deviceCount: number };
  kinds: EnergyKindRow[];
  series: EnergyBucket[];
  devices: EnergyDeviceRow[];
  /** 用电量（kW·h），从 byKind 里取 elec；没有电能品种时是 null */
  electricityKwh: number | null;
  /** 序列里最高的那个桶（按 tce） */
  peak: EnergyBucket | null;
  /** 序列里最低的**非零**桶 —— 全 0 时返回 null，避免把「没数据」当成「最低」 */
  trough: EnergyBucket | null;
  /**
   * ★ 按**品种**取用量序列（2026-11-23 重构）。
   *
   * <h3>为什么不是 `elecSeries`</h3>
   *
   * <p>第一版专门做了个 `elecSeries`（只取电能）。那是把「这块卡看电」
   * 编进了数据层 —— 下一个客户要看水/热/气就得改代码，违反产品铁律。
   *
   * <p>现在做成通用的：给一个品种 code，返回该品种的用量序列。
   * 品种列表来自平台 `byKind[].code`（`elec`/`heat`/`water`/`gas`/`steam`…），
   * 不在前端枚举。
   *
   * <p>某桶缺该品种时**跳过而不补 0** —— 「那天没数据」和「那天用量为 0」
   * 在图上必须能区分，否则运维会去查停机。
   */
  seriesOf: (kind: string) => EnergyBucket[];
  /** 所有可用的品种 code（来自平台返回，按首次出现顺序） */
  kindCodes: string[];
  /**
   * 成本数据是否可用（2026-11-23）。
   *
   * <p>判据是「任一品种的 `cost > 0`」而不是 `kpi.cost > 0` ——
   * 后者在有免费品种（如水）时也可能>0，看不出单价是否配齐。
   *
   * <p>分开判的理由：没配单价时 `cost` 恒为 0，直接显示「0 元」
   * 会让人以为这个月没用能，而不是「系统不知道怎么算钱」。
   */
  costAvailable: boolean;
  warnings: string[];
}

const EMPTY_STATS: SiteEnergyStats = {
  loading: true,
  error: null,
  siteId: null,
  granularity: "day",
  kpi: { tce: 0, cost: 0, co2: 0, deviceCount: 0 },
  kinds: [],
  series: [],
  devices: [],
  electricityKwh: null,
  peak: null,
  trough: null,
  seriesOf: () => [],
  kindCodes: [],
  costAvailable: false,
  warnings: [],
};

interface RawComprehensive {
  from?: number;
  to?: number;
  granularity?: string;
  kpi?: { tce?: number; cost?: number; co2?: number; deviceCount?: number };
  byKind?: Array<Partial<EnergyKindRow>>;
  series?: Array<{ bucket?: string; tce?: number; byKind?: Record<string, number> }>;
  devices?: Array<Partial<EnergyDeviceRow>>;
  warnings?: unknown;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalize(raw: RawComprehensive | null, gran: EnergyGranularity): Omit<SiteEnergyStats, "loading" | "error" | "siteId"> {
  const kinds: EnergyKindRow[] = (raw?.byKind ?? []).map((k) => ({
    code: String(k.code ?? ""),
    name: String(k.name ?? ""),
    unit: String(k.unit ?? ""),
    usage: num(k.usage),
    tce: num(k.tce),
    co2: num(k.co2),
    cost: num(k.cost),
    pct: num(k.pct),
  }));

  const series: EnergyBucket[] = (raw?.series ?? [])
    .map((s) => ({
      bucket: String(s.bucket ?? ""),
      tce: num(s.tce),
      /* 只收有限数字：接口给 null 表示"该桶没有这个品种"，不该变成 0 */
      byKind: Object.fromEntries(
        Object.entries(s.byKind ?? {})
          .map(([k, v]) => [k, Number(v)] as const)
          .filter(([, v]) => Number.isFinite(v)),
      ),
    }))
    .filter((s) => s.bucket);

  /*
   * 最高 / 最低。
   *
   * 最低值必须排除 0 —— 数据断档的日子 tce 就是 0，
   * 直接取 min 会得到「最低能耗 0」，对运维毫无意义且误导
   * （看着像那天没用电，其实可能是那天没数据）。
   */
  const nonZero = series.filter((s) => s.tce > 0);
  const peak = series.length ? series.reduce((a, b) => (b.tce > a.tce ? b : a)) : null;
  const trough = nonZero.length ? nonZero.reduce((a, b) => (b.tce < a.tce ? b : a)) : null;

  const elec = kinds.find((k) => k.code === "elec");

  /*
   * 按品种建索引：kind → 该品种的桶序列（跳过缺失桶，不补 0）。
   *
   * 一次遍历建好所有品种，而不是每个品种扫一遍 series ——
   * 一个场站可能有 5~6 个品种，扫 6 遍没必要。
   */
  const byKindIndex = new Map<string, EnergyBucket[]>();
  for (const bucket of series) {
    for (const [kind, value] of Object.entries(bucket.byKind)) {
      if (!Number.isFinite(value)) continue;
      const list = byKindIndex.get(kind) ?? [];
      /*
       * 复用 `EnergyBucket` 的形状，但把 `tce` 换成**该品种的用量**。
       * 字段名沿用 `tce` 会误导读代码的人（它不是折标煤），
       * 所以这里用一个显式的 `usage` 字段 —— 见 seriesOf 的返回说明。
       */
      list.push({ bucket: bucket.bucket, tce: value, byKind: bucket.byKind });
      byKindIndex.set(kind, list);
    }
  }
  const kindCodes = [...byKindIndex.keys()];
  const costAvailable = kinds.some((k) => k.cost > 0);

  const devices: EnergyDeviceRow[] = (raw?.devices ?? []).map((d) => ({
    id: String(d.id ?? ""),
    name: String(d.name ?? ""),
    label: String(d.label ?? ""),
    kind: String(d.kind ?? ""),
    kindName: String(d.kindName ?? ""),
    unit: String(d.unit ?? ""),
    usage: num(d.usage),
    tce: num(d.tce),
    cost: num(d.cost),
    virtual: d.virtual,
    counted: d.counted,
  }));

  const warnings = Array.isArray(raw?.warnings)
    ? raw!.warnings!.map((w) => String(w)).filter(Boolean)
    : [];

  if (gran === "year") {
    /*
     * 年档必然只有一个桶（平台上限一年）。不解释的话，
     * 客户会以为「年度统计坏了，只有一根柱子」。
     */
    warnings.push("平台单次查询上限 366 天，年档只覆盖最近一年");
  }

  return {
    granularity: gran,
    kpi: {
      tce: num(raw?.kpi?.tce),
      cost: num(raw?.kpi?.cost),
      co2: num(raw?.kpi?.co2),
      deviceCount: num(raw?.kpi?.deviceCount),
    },
    kinds,
    series,
    devices,
    electricityKwh: elec ? elec.usage : null,
    peak,
    trough,
    seriesOf: (kind: string) => byKindIndex.get(kind) ?? [],
    kindCodes,
    costAvailable,
    warnings,
  };
}

/** topologyId → siteId 的进程内缓存：一次页面加载只查一次 */
const siteIdCache = new Map<string, string | null>();

async function resolveSiteId(topologyId: string): Promise<string | null> {
  if (siteIdCache.has(topologyId)) return siteIdCache.get(topologyId) ?? null;
  const provider = getDataProvider();
  if (!provider.requestJson) return null;
  try {
    const topo = await provider.requestJson<{ siteId?: string }>(
      "GET",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}`,
    );
    const siteId = topo?.siteId ?? null;
    siteIdCache.set(topologyId, siteId);
    return siteId;
  } catch {
    /* 拓扑不存在 / 无权限：不缓存，下次还能重试 */
    return null;
  }
}

/**
 * 拉场站能耗统计。
 *
 * @param target     场站来源。`siteId` 优先（大屏的 `platform.siteId` 现成就有，
 *                   不必再查一次拓扑）；都没有时返回空统计而不是报错。
 * @param gran       时间粒度
 * @param enabled    false 时不发请求（编辑态没开这个开关就别打平台）
 */
export function useSiteEnergyStats(
  target: { siteId?: string | null; topologyId?: string | null },
  gran: EnergyGranularity,
  enabled = true,
): SiteEnergyStats {
  const knownSiteId = target.siteId ?? null;
  const topologyId = target.topologyId ?? null;
  const [stats, setStats] = useState<SiteEnergyStats>({ ...EMPTY_STATS, granularity: gran });
  const [siteId, setSiteId] = useState<string | null>(null);
  /**
   * 请求序号：快速切换粒度时，先发的请求可能后回来。
   * 只认最后一次 —— 否则界面会闪回上一个粒度的数据，看起来像"切换没生效"。
   */
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || (!knownSiteId && !topologyId)) {
      setStats({ ...EMPTY_STATS, loading: false, granularity: gran });
      return;
    }
    const provider = getDataProvider();
    if (!provider.requestJson) {
      setStats({
        ...EMPTY_STATS,
        loading: false,
        granularity: gran,
        error: "当前数据源不支持统计接口",
      });
      return;
    }

    const mySeq = ++seq.current;
    setStats((prev) => ({ ...prev, loading: true, error: null, granularity: gran }));

    try {
      /* 现成的 siteId 直接用；只有编辑器这种拿不到 platform 的场景才回落到查拓扑 */
      const sid = knownSiteId ?? (topologyId ? await resolveSiteId(topologyId) : null);
      if (mySeq !== seq.current) return;
      setSiteId(sid);
      if (!sid) {
        setStats({
          ...EMPTY_STATS,
          loading: false,
          granularity: gran,
          error: "该场景没有关联场站，无法统计能耗",
        });
        return;
      }

      const { from, to } = windowFor(gran);
      const path =
        `/api/energy/comprehensive?siteId=${encodeURIComponent(sid)}`
        + `&from=${from}&to=${to}&gran=${gran}`;
      const raw = await provider.requestJson<RawComprehensive>("GET", path);
      if (mySeq !== seq.current) return;

      setStats({
        loading: false,
        error: null,
        siteId: sid,
        ...normalize(raw, gran),
      });
    } catch (error) {
      if (mySeq !== seq.current) return;
      setStats({
        ...EMPTY_STATS,
        loading: false,
        granularity: gran,
        siteId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [knownSiteId, topologyId, gran, enabled, siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * 60 秒刷新。统计量的变化频率远低于遥测 ——
   * 跟着 3 秒的遥测轮询去刷 comprehensive 等于每小时打 1200 次聚合查询（A5 精神）。
   */
  useEffect(() => {
    if (!enabled || (!knownSiteId && !topologyId)) return undefined;
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load, enabled, knownSiteId, topologyId]);

  return useMemo(() => stats, [stats]);
}
