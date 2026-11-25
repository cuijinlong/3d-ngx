import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDataProvider } from "@idt/data-adapter";

/**
 * 今日 / 本周 / 本月 / 本年的用电汇总（2026-11-23 客户要求）。
 *
 * <h2>为什么要单独一个 hook</h2>
 *
 * <p>`useSiteEnergyStats` 是「选一个粒度 + 一个窗口」的模型 —— 它服务趋势图
 * 和 KPI 大数字，同一时刻只有一个 `from/to`。而客户要在同一张卡里**同时**
 * 看到四个不同区间的汇总。硬塞进那个 hook 会让它变成「多窗口」的怪物，
 * 并且拖慢趋势图那条主链路。
 *
 * <h2>四次请求 vs 一次接口改造</h2>
 *
 * <p>平台现有接口 `GET /api/energy/comprehensive?siteId&from&to&gran`
 * 一次只能算一个窗口。要一次拿到四个区间，得改 Java 侧加一个新接口 ——
 * 那需要重编 jar + 重启容器，且影响面比这大得多。
 *
 * <p>所以这里**并发发四次**。这是固定 4 个请求，不是 N+1（N 是设备数）：
 * 设备涨到 100 台也还是 4 个请求。并且：
 * <ul>
 *   <li>四个请求并发，不是串行；</li>
 *   <li>按「日期」做进程内缓存 —— 同一天内反复渲染不再打平台；</li>
 *   <li>60 秒才刷新一次（与统计主链路同频）。</li>
 * </ul>
 *
 * <h2>★ 0 与「没有数据」必须分开</h2>
 *
 * <p>实测这个场站最近两天没有上报，于是「今日」「本周」的窗口内
 * 一个数据桶都没有。这时如果显示 `0 kW·h`，值班员会以为
 * 「今天到现在一度电都没用」—— 而实际是网关没上报。
 *
 * <p>所以每项的 `usage` 是 `number | null`：
 * `null` 表示**这个窗口里没有任何该品种的数据**，界面显示「—」并说明原因。
 */

export type RollupKey = "today" | "week" | "month" | "year";

export interface RollupItem {
  key: RollupKey;
  label: string;
  /**
   * 用电量（kW·h）。
   *
   * <p>`null` = 该窗口内没有任何电能数据（断档 / 未接入），
   * **不是** 0。界面必须区别对待，否则会把「没上报」渲染成「没用电」。
   */
  usage: number | null;
  /** 窗口是否包含「今天」这种正在累积的区间 —— 界面上要说明「截至现在」 */
  partial: boolean;
}

export interface EnergyRollup {
  loading: boolean;
  error: string | null;
  items: RollupItem[];
}

const DAY_MS = 86_400_000;

/**
 * 四个区间的窗口。
 *
 * <h3>为什么本周从周一开始</h3>
 *
 * <p>中国现场口径的「本周」是周一到周日。`Date.getDay()` 周日返回 0，
 * 直接减会算成「上周一」—— 必须 `(day + 6) % 7` 换算。
 *
 * <h3>为什么 today 的 to 是明天 0 点而不是现在</h3>
 *
 * <p>平台按整天做桶。`to = now` 会让「今天」这个桶被截断在查询时刻，
 * 而同一份数据隔几分钟再查又变一次 —— 与 `windowFor` 里记录过的
 * 「数字自己会跳」是同一个坑。对齐到明天 0 点后，窗口在一天之内恒定。
 */
export function rollupWindows(now = new Date()): Record<RollupKey, { from: number; to: number }> {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const todayStart = new Date(y, m, d).getTime();
  const tomorrowStart = todayStart + DAY_MS;

  /* 周一为一周之始：周日 getDay()=0 → (0+6)%7 = 6 天前 */
  const weekdayOffset = (now.getDay() + 6) % 7;
  const weekStart = todayStart - weekdayOffset * DAY_MS;

  return {
    today: { from: todayStart, to: tomorrowStart },
    week: { from: weekStart, to: tomorrowStart },
    month: { from: new Date(y, m, 1).getTime(), to: tomorrowStart },
    year: { from: new Date(y, 0, 1).getTime(), to: tomorrowStart },
  };
}

const LABELS: Record<RollupKey, string> = {
  today: "今日",
  week: "本周",
  month: "本月",
  year: "本年",
};

interface RawComprehensive {
  byKind?: Array<{ code?: string; usage?: unknown }>;
  series?: unknown[];
}

/**
 * 解析一个窗口的返回值。
 *
 * <p>判据用 `series` 而不是 `byKind`：`byKind` 即使没有任何数据也可能
 * 返回该品种的一行（usage=0）。而 `series` 为空代表**该窗口一个桶都没有**，
 * 那才是「没有数据」。两者结合：series 非空才认 usage。
 */
function parseUsage(raw: RawComprehensive | null): number | null {
  if (!raw) return null;
  const buckets = Array.isArray(raw.series) ? raw.series.length : 0;
  if (!buckets) return null;
  const elec = (raw.byKind ?? []).find((k) => k?.code === "elec");
  if (!elec) return null;
  const usage = Number(elec.usage);
  return Number.isFinite(usage) ? usage : null;
}

/**
 * 进程内缓存：`siteId + 当天日期 + 区间` → 数值。
 *
 * <p>同一天内「今日」的量会随时间增长，所以缓存**只在同一分钟内**有效 ——
 * 加 `minute` 而不是整天，否则页面上「今日」永远不会更新。
 */
const cache = new Map<string, number | null>();

function cacheKey(siteId: string, key: RollupKey, now: Date): string {
  const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  return `${siteId}|${key}|${stamp}`;
}

export function useEnergyRollup(
  target: { siteId?: string | null; topologyId?: string | null },
  enabled = true,
): EnergyRollup {
  const knownSiteId = target.siteId ?? null;
  const topologyId = target.topologyId ?? null;
  const [state, setState] = useState<EnergyRollup>({
    loading: true,
    error: null,
    items: [],
  });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    if (!enabled || (!knownSiteId && !topologyId)) {
      setState({ loading: false, error: null, items: [] });
      return;
    }
    const provider = getDataProvider();
    if (!provider.requestJson) {
      setState({ loading: false, error: "当前数据源不支持统计接口", items: [] });
      return;
    }
    /*
     * ★ 必须 `bind(provider)`，不能直接解构（2026-11-23 实测踩过）。
     *
     * <p>`requestJson` 是类方法，内部用 `this.client` 发请求。
     * 解构出来的函数 `this` 是 undefined —— 四个请求全部抛
     * `TypeError: Cannot read properties of undefined (reading 'client')`，
     * 被 catch 吞成 `usage: null`，界面上就是四个「—」。
     *
     * <p>`useSiteEnergyStats` 里写的是 `provider.requestJson(...)`（点调用，
     * this 正确），所以 KPI 有数字、四格全空 —— 看起来像「接口不通」。
     *
     * <p>绑定的另一个好处：`requestJson` 收窄成非可选类型，
     * TS 在 async 闭包内不会再报可能 undefined。
     */
    const requestJson = provider.requestJson.bind(provider);

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const siteId = knownSiteId ?? (await resolveSiteId(topologyId));
      if (mySeq !== seq.current) return;
      if (!siteId) {
        setState({ loading: false, error: "该场景没有关联场站", items: [] });
        return;
      }

      const now = new Date();
      const windows = rollupWindows(now);
      /*
       * 只取今日与本月（2026-11-24 客户要求）。
       *
       * <p>客户原话：「左侧部件的只保留今日和本月，其他的本周和本年都去掉」。
       * 四格在 18.6% 宽的卡里排成两行两列，字号被压得很小；
       * 只留两格后一行排开，数字能回到正常字号。
       *
       * <p>请求数也从 4 降到 2 —— 这块卡所在的面打开时少两次往返。
       */
      const keys: RollupKey[] = ["today", "month"];

      /*
       * 并发四个请求。用 `Promise.all` + 每个自己 catch：
       * 某一个区间失败不该让整块卡报错 —— 另外三个数字仍然有用。
       */
      const results = await Promise.all(
        keys.map(async (key) => {
          const cached = cache.get(cacheKey(siteId, key, now));
          if (cached !== undefined) return { key, usage: cached };
          const { from, to } = windows[key];
          try {
            const raw = await requestJson<RawComprehensive>(
              "GET",
              `/api/energy/comprehensive?siteId=${encodeURIComponent(siteId)}`
              + `&from=${from}&to=${to}&gran=day`,
            );
            const usage = parseUsage(raw);
            cache.set(cacheKey(siteId, key, now), usage);
            return { key, usage };
          } catch {
            /* 单区间失败：返回 null（界面显示 —），不污染其它区间 */
            return { key, usage: null };
          }
        }),
      );
      if (mySeq !== seq.current) return;

      setState({
        loading: false,
        error: null,
        items: results.map(({ key, usage }) => ({
          key,
          label: LABELS[key],
          usage,
          /* 今日/本周/本月/本年都是「进行中」的区间，数字会继续增长 */
          partial: true,
        })),
      });
    } catch (error) {
      if (mySeq !== seq.current) return;
      setState({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        items: [],
      });
    }
    /*
     * 依赖必须写全（2026-11-23 实测踩过）。
     *
     * <p>第一版用了自制的 `useCallbackRef`：只在**首次渲染**跑一次。
     * 而大屏加载时 `platform.siteId` 还没解析出来（是 null），
     * 那一次直接走了「没有场站」早退 —— 之后再也不会重跑，
     * 四格永远是「—」。而 `useSiteEnergyStats` 有正确的依赖，
     * 所以 KPI 有数字、四格全空，看起来像「接口不通」。
     */
  }, [enabled, knownSiteId, topologyId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * 60 秒刷新，与 `useSiteEnergyStats` 同频。
   *
   * <p>更频没意义：这些是聚合量，平台侧也是按分钟级缓存的；
   * 而「今日」这一格本来就该缓慢增长。
   */
  useEffect(() => {
    if (!enabled || (!knownSiteId && !topologyId)) return undefined;
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load, enabled, knownSiteId, topologyId]);

  return useMemo(() => state, [state]);
}

const siteIdCache = new Map<string, string | null>();

async function resolveSiteId(topologyId: string | null): Promise<string | null> {
  if (!topologyId) return null;
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
    return null;
  }
}
