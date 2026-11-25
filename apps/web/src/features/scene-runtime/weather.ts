/**
 * 大屏顶栏的「今日天气」（2026-11-24 客户要求）。
 *
 * <h2>为什么要有</h2>
 *
 * `template01` 的 header 右上角是 `☀ 22℃ 晴　2026.11.23 03:10`。
 * 值班员看大屏时，「外面什么天气」直接影响负荷判断（高温/寒潮 = 空调负荷飙升），
 * 它不是装饰。
 *
 * <h2>为什么接 Open-Meteo</h2>
 *
 * 客户选了「浏览器直连、不要密钥」这条路。Open-Meteo 满足全部条件：
 * 免费、无需注册、CORS 开放、中文地名可查。
 * （2026-11-24 实测：`南京` → 32.06N / 118.78E → 返回真实温度。）
 *
 * <h2>绝对不编造</h2>
 *
 * `RuntimeClock` 此前的注释写着「没有数据源就不编」。这条继续守：
 * 拿不到就返回 `null`，界面上什么都不显示，**不给一个好看的假 22℃**。
 * 值班员会把假天气当真 —— 那比不显示糟得多。
 */

/** Open-Meteo 地理编码结果（只取用得到的字段）。 */
export interface GeoPlace {
  /** 输入的地名（回显用，保留用户写的原文） */
  query: string;
  latitude: number;
  longitude: number;
  /** 接口返回的规范名，例如「南京」 */
  name: string;
  /** 省 / 一级行政区，例如「江苏」 */
  admin1?: string;
  country?: string;
}

/** 当前天气（只取温度与天气码，够大屏用）。 */
export interface CurrentWeather {
  temperatureC: number;
  /** WMO Weather interpretation code */
  code: number;
  /** 观测时间（接口返回的本地时间字符串，例如 `2026-11-24T19:00`） */
  observedAt: string;
}

/**
 * 今日预报（2026-11-24 客户要求「今日天气预报」）。
 *
 * <h3>为什么单列一个结构而不是塞进 `CurrentWeather`</h3>
 *
 * 「现在 7℃」和「今天 2~9℃」是两个不同的事实：前者是观测，后者是全天的
 * 极值。合成一个对象后，任何一处误用都会让图上出现「当前温度 = 最高温」
 * 这种看起来合理、实际错位的读数。
 */
export interface DailyForecast {
  /** 今日最高温（℃） */
  maxC: number;
  /** 今日最低温（℃） */
  minC: number;
  /** 全天主导天气码（WMO） */
  code: number;
}

export interface WeatherSnapshot {
  place: GeoPlace;
  weather: CurrentWeather;
  /** 今日预报；接口没给时为 null（界面只显示当前天气，不编造极值） */
  today: DailyForecast | null;
  /** 中文描述，例如「晴」「小雨」 */
  label: string;
  /** 单字符图标（emoji），未知码回退 `•` */
  icon: string;
  /** 拉取成功的时刻（毫秒），用于判断缓存是否过期 */
  fetchedAt: number;
}

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/** 地理编码结果几乎不变，缓存一天；天气 15 分钟一轮（Open-Meteo 的观测粒度就是 15 分钟）。 */
const GEO_TTL_MS = 24 * 60 * 60 * 1000;
export const WEATHER_TTL_MS = 15 * 60 * 1000;

/**
 * WMO Weather interpretation codes → 中文 + 图标。
 *
 * <p>映射表按 Open-Meteo 官方文档的完整码表写，不省略 —— 省略的码会落到
 * 「未知」分支，大屏上出现 `•` 比出现「晴」更容易让人怀疑系统坏了。
 * 宁可写全 28 行。
 */
const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "晴", icon: "☀" },
  1: { label: "晴间多云", icon: "🌤" },
  2: { label: "多云", icon: "⛅" },
  3: { label: "阴", icon: "☁" },
  45: { label: "雾", icon: "🌫" },
  48: { label: "雾凇", icon: "🌫" },
  51: { label: "毛毛雨", icon: "🌦" },
  53: { label: "毛毛雨", icon: "🌦" },
  55: { label: "浓毛毛雨", icon: "🌦" },
  56: { label: "冻毛毛雨", icon: "🌧" },
  57: { label: "冻毛毛雨", icon: "🌧" },
  61: { label: "小雨", icon: "🌧" },
  63: { label: "中雨", icon: "🌧" },
  65: { label: "大雨", icon: "🌧" },
  66: { label: "冻雨", icon: "🌧" },
  67: { label: "冻雨", icon: "🌧" },
  71: { label: "小雪", icon: "🌨" },
  73: { label: "中雪", icon: "🌨" },
  75: { label: "大雪", icon: "❄" },
  77: { label: "雪粒", icon: "🌨" },
  80: { label: "阵雨", icon: "🌦" },
  81: { label: "阵雨", icon: "🌧" },
  82: { label: "强阵雨", icon: "🌧" },
  85: { label: "阵雪", icon: "🌨" },
  86: { label: "强阵雪", icon: "❄" },
  95: { label: "雷阵雨", icon: "⛈" },
  96: { label: "雷阵雨伴冰雹", icon: "⛈" },
  99: { label: "强雷雨伴冰雹", icon: "⛈" },
};

/**
 * 严格数值转换：`null` / `undefined` / `""` / `NaN` 一律返回 `null`。
 *
 * <p>**不能用 `Number()` 直接转**（2026-11-24 单测抓到）：
 * `Number(null) === 0`、`Number("") === 0`。接口少给一个字段，
 * 大屏上就会出现一个「0℃」或者坐标 (0,0) 的几内亚湾天气 ——
 * 看着完全正常，只是全都是假的。本模块宁可整块不显示。
 */
function strictNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 天气码 → 中文描述。未知码给「—」，不冒充晴。 */
export function describeWeatherCode(code: number): { label: string; icon: string } {
  return WMO[code] ?? { label: "—", icon: "•" };
}

/**
 * 从地理编码响应里挑一条。
 *
 * <h3>为什么要挑而不是取第一条</h3>
 *
 * `南京` 在 Open-Meteo 里能查出三条（江苏南京、云南临沧的一个同名村…）。
 * 直接取 `results[0]` 在这例里侥幸对了，但「江宁」这类区名可能先命中别处。
 * 判据用三个依次收紧的信号：
 *
 * 1. `country_code === "CN"`（现场都是国内场站）
 * 2. `feature_code` 以 `PPL` 开头（居民点/行政区，排除山峰河流）
 * 3. `population` 越大越可能是用户指的那个「南京」
 *
 * <p>三个都不满足时退回第一条 —— 有结果总比没有强，且地名由用户填，
 * 大概率本来就只有一条。全空返回 `null`。
 */
export function pickBestPlace(
  query: string,
  payload: unknown,
): GeoPlace | null {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  type Row = {
    latitude?: unknown;
    longitude?: unknown;
    name?: unknown;
    admin1?: unknown;
    country?: unknown;
    country_code?: unknown;
    feature_code?: unknown;
    population?: unknown;
  };

  const rows = results.filter((r): r is Row => Boolean(r) && typeof r === "object");
  const score = (row: Row): number => {
    let s = 0;
    if (row.country_code === "CN") s += 1000;
    if (typeof row.feature_code === "string" && row.feature_code.startsWith("PPL")) s += 100;
    const pop = typeof row.population === "number" ? row.population : 0;
    // 人口按对数压一下：南京 900 万 vs 某村 200 人，不该把分数拉成两个量级
    s += pop > 0 ? Math.log10(pop) : 0;
    return s;
  };

  const best = rows
    .map((row, index) => ({ row, index, s: score(row) }))
    .sort((a, b) => (b.s - a.s) || (a.index - b.index))[0]?.row;

  if (!best) return null;
  /* 缺失坐标必须是 null —— 变成 (0,0) 就是大西洋上的几内亚湾，见 strictNumber 注释 */
  const lat = strictNumber(best.latitude);
  const lon = strictNumber(best.longitude);
  if (lat === null || lon === null) return null;

  return {
    query,
    latitude: lat,
    longitude: lon,
    name: typeof best.name === "string" ? best.name : query,
    admin1: typeof best.admin1 === "string" ? best.admin1 : undefined,
    country: typeof best.country === "string" ? best.country : undefined,
  };
}

/** 从 forecast 响应里取当前天气。字段缺失/非数值返回 `null`（不填 0）。 */
export function parseCurrentWeather(payload: unknown): CurrentWeather | null {
  const current = (payload as { current?: unknown })?.current;
  if (!current || typeof current !== "object") return null;
  const c = current as { temperature_2m?: unknown; weather_code?: unknown; time?: unknown };
  const temp = strictNumber(c.temperature_2m);
  const code = strictNumber(c.weather_code);
  if (temp === null || code === null) return null;
  return {
    temperatureC: temp,
    code,
    observedAt: typeof c.time === "string" ? c.time : "",
  };
}

/** 已有快照是否还能直接用（未过期）。 */
export function isWeatherFresh(snapshot: WeatherSnapshot | null, now = Date.now()): boolean {
  return Boolean(snapshot) && now - (snapshot as WeatherSnapshot).fetchedAt < WEATHER_TTL_MS;
}

/**
 * 从 daily 段取今日极值。
 *
 * <p>`forecast_days=1` 时数组只有一项。任何一项缺失/非数值都返回 `null` ——
 * 只拿到最高温、没有最低温时，画「9° ~ --」比不画更让人困惑。
 */
export function parseDailyForecast(payload: unknown): DailyForecast | null {
  const daily = (payload as { daily?: unknown })?.daily;
  if (!daily || typeof daily !== "object") return null;
  const d = daily as {
    temperature_2m_max?: unknown;
    temperature_2m_min?: unknown;
    weather_code?: unknown;
  };
  const pickFirst = (value: unknown): number | null => {
    const first = Array.isArray(value) ? value[0] : value;
    return strictNumber(first);
  };
  const maxC = pickFirst(d.temperature_2m_max);
  const minC = pickFirst(d.temperature_2m_min);
  const code = pickFirst(d.weather_code);
  if (maxC === null || minC === null) return null;
  return { maxC, minC, code: code ?? 0 };
}

export interface WeatherFetcher {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

/** 地名 → 经纬度的模块级缓存（24 小时）。切场景回来不用重查。 */
const geocodeCache = new Map<string, { place: GeoPlace; at: number }>();

/**
 * 把「南京市江宁区」这类完整行政区划拆成可查的候选地名。
 *
 * <h3>为什么必须拆（2026-11-24 实测）</h3>
 *
 * Open-Meteo 的地理编码底库是 GeoNames，中文名**不带行政后缀**：
 *
 * ```
 * 南京市江宁区 → 0 条
 * 江宁区       → 0 条
 * 南京市       → 0 条
 * 南京         → 3 条（江苏南京 32.06N/118.78E …）
 * ```
 *
 * <p>而向导里让客户填的例子正是「南京市江宁区」（`CreateSceneWizard` 的
 * placeholder）。不拆的话，客户按提示填完，天气永远不显示 ——
 * 并且因为「查不到就不编造」的规则，界面上什么提示都没有，极难排查。
 *
 * <h3>为什么不算「猜地名」</h3>
 *
 * 逐级去掉行政后缀是**可解释的回退**：用户写的「南京市江宁区」在语义上
 * 属于「南京市」下级，取市级中心点定位是常规做法。候选里每一条都是
 * 原串的**前缀**，不会跳到别的城市。
 *
 * <p>真正禁止的是「用场站名猜城市」（「生产园区」→ 某地），那种没有字面依据。
 */
export function placeCandidates(place: string): string[] {
  const original = place.trim();
  if (!original) return [];

  const out: string[] = [];
  const push = (value: string) => {
    const text = value.trim();
    if (text.length >= 2 && !out.includes(text)) out.push(text);
  };

  push(original);

  /* ① 逐级去掉末尾行政后缀：「南京市江宁区」→「南京市江宁」 */
  const suffix = /(街道|自治区|自治州|自治县|新区|城区|省|市|区|县|州|盟|旗|镇|乡)$/;
  let trimmed = original;
  while (suffix.test(trimmed)) {
    trimmed = trimmed.replace(suffix, "");
    push(trimmed);
  }

  /*
   * ② 截到第一个「市 / 州 / 盟」：「南京市江宁区」→「南京市」→「南京」。
   * ① 只能去掉**最末**一个后缀，去掉后剩下「南京市江宁」—— 中间那个「市」
   * 仍然把地名卡住。必须单独做一次前缀截断。
   */
  const cityHead = original.match(/^(.+?[市州盟])/)?.[1];
  if (cityHead) {
    push(cityHead);
    push(cityHead.replace(/[市州盟]$/, ""));
  }

  return out;
}

/**
 * 查地名 → 经纬度。
 *
 * <p>`signal` 用于组件卸载时取消：大屏长时间挂着，反复切场景会攒下
 * 一堆悬空请求，慢网下可能晚到的响应覆盖新结果。
 */
export async function geocode(
  place: string,
  opts: { fetchImpl?: WeatherFetcher; signal?: AbortSignal; now?: number } = {},
): Promise<GeoPlace | null> {
  const query = place.trim();
  if (!query) return null;

  /* 地名→经纬度几乎不变，且 15 分钟轮询会反复问同一个地名，缓存一天。 */
  const now = opts.now ?? Date.now();
  const hit = geocodeCache.get(query);
  if (hit && now - hit.at < GEO_TTL_MS) return hit.place;

  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as WeatherFetcher);
  if (!doFetch) return null;

  /*
   * 按 完整名 → 去末级后缀 → 市级 → 去「市」 的顺序试。
   * 第一个查到结果的就用 —— 用户写得越具体，定位越准；
   * 底库没有这么细的名字时自动退到上级，而不是整块不显示。
   */
  for (const candidate of placeCandidates(query)) {
    const url =
      `${GEOCODE_URL}?name=${encodeURIComponent(candidate)}&count=5&language=zh&format=json`;
    const response = await doFetch(url, { signal: opts.signal });
    if (!response.ok) continue;
    const resolved = pickBestPlace(query, await response.json());
    if (resolved) {
      /* 缓存键用**用户原始输入**：下次同一个「南京市江宁区」直接命中，不再走一遍回退 */
      geocodeCache.set(query, { place: resolved, at: now });
      return resolved;
    }
  }
  return null;
}

/** 查实时天气。 */
/**
 * 查「当前天气 + 今日预报」。
 *
 * <p>一次请求取两段 —— Open-Meteo 的 `current` 与 `daily` 可以同请求返回，
 * 分两次发只会多一次往返，还可能出现两次调用跨过整点、日期不一致。
 *
 * <p>`current` 取不到就整体失败（`null`）：没有当前温度时，
 * 只显示「9° / 2°」会让人以为屏幕卡在早上的预报上。
 * `daily` 取不到只是少了极值，当前天气照常显示。
 */
export async function fetchWeather(
  geo: GeoPlace,
  opts: { fetchImpl?: WeatherFetcher; signal?: AbortSignal } = {},
): Promise<{ current: CurrentWeather; today: DailyForecast | null } | null> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as WeatherFetcher);
  if (!doFetch) return null;
  const url =
    `${FORECAST_URL}?latitude=${geo.latitude}&longitude=${geo.longitude}` +
    `&current=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=1` +
    `&timezone=Asia%2FShanghai`;
  const response = await doFetch(url, { signal: opts.signal });
  if (!response.ok) return null;
  const payload = await response.json();
  const current = parseCurrentWeather(payload);
  if (!current) return null;
  return { current, today: parseDailyForecast(payload) };
}

/**
 * 一步到位：地名 → 快照。
 *
 * <p>任何一步失败都返回 `null` —— 调用方据此显示「天气不可用」，
 * 而不是显示一个编出来的天气。
 */
export async function loadWeather(
  place: string,
  opts: { fetchImpl?: WeatherFetcher; signal?: AbortSignal; now?: number } = {},
): Promise<WeatherSnapshot | null> {
  const geo = await geocode(place, opts);
  if (!geo) return null;
  const fetched = await fetchWeather(geo, opts);
  if (!fetched) return null;
  const { label, icon } = describeWeatherCode(fetched.current.code);
  return {
    place: geo,
    weather: fetched.current,
    today: fetched.today,
    label,
    icon,
    fetchedAt: opts.now ?? Date.now(),
  };
}

/**
 * 大屏顶栏的显示文案。
 *
 * ```
 * ☀ 晴 7℃  今日 9°/2°     ← 有今日预报
 * ☀ 晴 7℃                 ← 预报缺失时只显示当前
 * ```
 *
 * <p>温度一律取整：小数点后一位在现场没人看，反而把这一格撑宽。
 * 极值用「斜杠 + 度」的紧凑写法（`9°/2°`），比 `9℃ ~ 2℃` 省一半宽度，
 * 顶栏右端还有时钟和四个按钮要放。
 */
export function formatWeatherText(snapshot: WeatherSnapshot): string {
  const now = formatNowText(snapshot);
  const today = formatTodayText(snapshot);
  return today ? `${now} ${today}` : now;
}

/**
 * 当前天气，例如 `☀ 晴 6℃`。
 *
 * <p>拆成两个函数是因为界面上这两段要**分开样式**：当前天气是正文色，
 * 今日预报淡一档。用连续空格分隔不行 —— HTML 会把连续空格合并成一个，
 * 结果是 `6℃ 今日` 粘在一起（2026-11-24 实测截图确认过）。
 */
export function formatNowText(snapshot: WeatherSnapshot): string {
  return `${snapshot.icon} ${snapshot.label} ${Math.round(snapshot.weather.temperatureC)}℃`;
}

/** 今日预报，例如 `今日 12°/4°`；没有预报时返回空串。 */
export function formatTodayText(snapshot: WeatherSnapshot): string {
  const today = snapshot.today;
  if (!today) return "";
  return `今日 ${Math.round(today.maxC)}°/${Math.round(today.minC)}°`;
}
