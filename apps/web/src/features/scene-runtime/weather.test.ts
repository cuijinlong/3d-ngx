import { describe, it, expect } from "vitest";
import {
  describeWeatherCode,
  formatNowText,
  formatTodayText,
  formatWeatherText,
  geocode,
  isWeatherFresh,
  loadWeather,
  parseCurrentWeather,
  parseDailyForecast,
  pickBestPlace,
  placeCandidates,
  WEATHER_TTL_MS,
  type WeatherSnapshot,
} from "./weather";

const NOW = 1_795_500_000_000;

function fakeFetch(byUrl: (url: string) => { ok: boolean; body: unknown }) {
  return async (url: string) => {
    const { ok, body } = byUrl(url);
    return { ok, json: async () => body };
  };
}

describe("describeWeatherCode", () => {
  it("常见天气码给中文与图标", () => {
    expect(describeWeatherCode(0)).toEqual({ label: "晴", icon: "☀" });
    expect(describeWeatherCode(3)).toEqual({ label: "阴", icon: "☁" });
    expect(describeWeatherCode(95)).toEqual({ label: "雷阵雨", icon: "⛈" });
  });

  it("未知码不冒充晴天", () => {
    // 关键：回退成「—」而不是「晴」，避免把没见过的码说成好天气
    const unknown = describeWeatherCode(1234);
    expect(unknown.label).toBe("—");
    expect(unknown.label).not.toBe("晴");
  });
});

describe("pickBestPlace", () => {
  it("在多个同名地点里优先中国居民点、人口大的", () => {
    const payload = {
      results: [
        { name: "南京", latitude: 23.4, longitude: 99.7, country_code: "CN", feature_code: "PPL", population: 200 },
        { name: "南京", latitude: 32.06, longitude: 118.77, country_code: "CN", feature_code: "PPLA", population: 9_314_685, admin1: "江苏" },
      ],
    };
    const picked = pickBestPlace("南京", payload);
    expect(picked?.latitude).toBeCloseTo(32.06, 2);
    expect(picked?.admin1).toBe("江苏");
    expect(picked?.query).toBe("南京");
  });

  it("没有结果返回 null", () => {
    expect(pickBestPlace("不存在的地方", { results: [] })).toBeNull();
    expect(pickBestPlace("x", {})).toBeNull();
    expect(pickBestPlace("x", null)).toBeNull();
  });

  it("经纬度非法返回 null", () => {
    expect(
      pickBestPlace("x", { results: [{ name: "x", latitude: "abc", longitude: 1 }] }),
    ).toBeNull();
  });
});

describe("parseCurrentWeather", () => {
  it("取温度与天气码", () => {
    const parsed = parseCurrentWeather({
      current: { temperature_2m: 6.4, weather_code: 0, time: "2026-11-24T19:00" },
    });
    expect(parsed).toEqual({ temperatureC: 6.4, code: 0, observedAt: "2026-11-24T19:00" });
  });

  it("字段缺失返回 null，不填 0", () => {
    expect(parseCurrentWeather({ current: {} })).toBeNull();
    expect(parseCurrentWeather({})).toBeNull();
    expect(parseCurrentWeather({ current: { temperature_2m: null, weather_code: 0 } })).toBeNull();
  });
});

describe("isWeatherFresh", () => {
  const snapshot = (fetchedAt: number): WeatherSnapshot => ({
    place: { query: "南京", latitude: 32, longitude: 118, name: "南京" },
    weather: { temperatureC: 6, code: 0, observedAt: "" },
    today: null,
    label: "晴",
    icon: "☀",
    fetchedAt,
  });

  it("15 分钟内算新鲜", () => {
    expect(isWeatherFresh(snapshot(NOW - WEATHER_TTL_MS + 1000), NOW)).toBe(true);
  });

  it("超过 15 分钟过期", () => {
    expect(isWeatherFresh(snapshot(NOW - WEATHER_TTL_MS - 1), NOW)).toBe(false);
  });

  it("null 不算新鲜", () => {
    expect(isWeatherFresh(null, NOW)).toBe(false);
  });
});

describe("geocode", () => {
  it("空白地名不发请求", async () => {
    let called = 0;
    const fetchImpl = async () => {
      called += 1;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    expect(await geocode("   ", { fetchImpl })).toBeNull();
    expect(called).toBe(0);
  });

  it("把地名编码进 URL 并解析结果", async () => {
    let seen = "";
    const fetchImpl = fakeFetch((url) => {
      seen = url;
      return {
        ok: true,
        body: { results: [{ name: "南京", latitude: 32.06, longitude: 118.77, country_code: "CN", feature_code: "PPLA", population: 9_000_000 }] },
      };
    });
    const geo = await geocode("南京市江宁区", { fetchImpl });
    expect(seen).toContain(encodeURIComponent("南京市江宁区"));
    expect(geo?.latitude).toBeCloseTo(32.06, 2);
  });

  it("首轮查不到时自动回退到上级地名（实测「南京市江宁区」→「南京」）", async () => {
    const seen: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      seen.push(decodeURIComponent(url));
      /*
       * 模拟真实底库：只有「南京」有结果，带后缀的一律 0 条。
       * 不这样模拟的话，测不出回退链是否真的在跑。
       */
      if (url.includes(encodeURIComponent("南京")) && !url.includes(encodeURIComponent("市"))) {
        return { ok: true, body: { results: [{ name: "南京", latitude: 32.06, longitude: 118.77, country_code: "CN", feature_code: "PPLA", population: 9_000_000 }] } };
      }
      return { ok: true, body: { results: [] } };
    });
    const geo = await geocode("南京市江宁区2", { fetchImpl });
    expect(geo?.name).toBe("南京");
    expect(seen.length).toBeGreaterThan(1);
  });

  it("接口失败返回 null", async () => {
    const fetchImpl = fakeFetch(() => ({ ok: false, body: {} }));
    expect(await geocode("南京", { fetchImpl })).toBeNull();
  });
});

describe("placeCandidates", () => {
  it("完整行政区划逐级回退到可查城市名", () => {
    // 实测：只有「南京」在 GeoNames 有结果，带「市/区」后缀全查不到
    expect(placeCandidates("南京市江宁区")).toEqual([
      "南京市江宁区",
      "南京市江宁",
      "南京市",
      "南京",
    ]);
  });

  it("本来就能查到的名字保持原样在最前", () => {
    expect(placeCandidates("南京")[0]).toBe("南京");
  });

  it("候选永远只是原串的前缀，不会跳到别的城市", () => {
    for (const candidate of placeCandidates("苏州市姑苏区")) {
      expect("苏州市姑苏区".startsWith(candidate)).toBe(true);
    }
  });

  it("空白返回空数组", () => {
    expect(placeCandidates("   ")).toEqual([]);
  });

  it("去掉单字结果（避免「市」这种无意义候选）", () => {
    expect(placeCandidates("市").every((c) => c.length >= 2)).toBe(true);
  });
});

describe("parseDailyForecast", () => {
  it("取今日最高/最低与天气码", () => {
    const parsed = parseDailyForecast({
      daily: {
        time: ["2026-11-24"],
        temperature_2m_max: [9.4],
        temperature_2m_min: [2.1],
        weather_code: [3],
      },
    });
    expect(parsed).toEqual({ maxC: 9.4, minC: 2.1, code: 3 });
  });

  it("缺最高或最低时返回 null（只画一半更让人困惑）", () => {
    expect(parseDailyForecast({ daily: { temperature_2m_max: [9.4] } })).toBeNull();
    expect(parseDailyForecast({ daily: { temperature_2m_min: [2.1] } })).toBeNull();
    expect(parseDailyForecast({})).toBeNull();
    expect(parseDailyForecast({ daily: { temperature_2m_max: [null], temperature_2m_min: [2] } })).toBeNull();
  });

  it("天气码缺失时给 0，不影响极值", () => {
    const parsed = parseDailyForecast({
      daily: { temperature_2m_max: [9.4], temperature_2m_min: [2.1] },
    });
    expect(parsed).toEqual({ maxC: 9.4, minC: 2.1, code: 0 });
  });
});

describe("formatWeatherText", () => {
  const snapshot = (today: { maxC: number; minC: number; code: number } | null) => ({
    place: { query: "南京", latitude: 32, longitude: 118, name: "南京" },
    weather: { temperatureC: 6.4, code: 0, observedAt: "" },
    today,
    label: "晴",
    icon: "☀",
    fetchedAt: NOW,
  });

  it("温度取整，不显示小数", () => {
    expect(formatWeatherText(snapshot(null))).toBe("☀ 晴 6℃");
  });

  it("有今日预报时追加最高/最低（客户 2026-11-24 要求）", () => {
    expect(formatWeatherText(snapshot({ maxC: 9.4, minC: 2.1, code: 3 }))).toBe(
      "☀ 晴 6℃ 今日 9°/2°",
    );
  });

  it("拆开的两段与合并后一致（界面用两个 span 渲染，避免空格被合并）", () => {
    const snap = snapshot({ maxC: 9.4, minC: 2.1, code: 3 });
    expect(formatNowText(snap)).toBe("☀ 晴 6℃");
    expect(formatTodayText(snap)).toBe("今日 9°/2°");
    expect(formatWeatherText(snap)).toBe(`${formatNowText(snap)} ${formatTodayText(snap)}`);
  });

  it("没有预报时 formatTodayText 返回空串（调用方据此不渲染那一段）", () => {
    expect(formatTodayText(snapshot(null))).toBe("");
  });

  it("预报缺失时只显示当前天气，不编造极值", () => {
    const text = formatWeatherText(snapshot(null));
    expect(text).not.toContain("今日");
    expect(text).not.toContain("°");
  });
});

describe("loadWeather", () => {
  /*
   * 每个用例用**不同地名**：`geocode` 有模块级 24 小时缓存，
   * 复用同名会让后面的用例直接命中缓存、绕过 mock —— 测的就不是本意了。
   */
  it("两步都成功才给快照", async () => {
    const fetchImpl = fakeFetch((url) =>
      url.includes("geocoding")
        ? { ok: true, body: { results: [{ name: "南京", latitude: 32, longitude: 118, country_code: "CN" }] } }
        : {
            ok: true,
            body: {
              current: { temperature_2m: 6.4, weather_code: 0, time: "t" },
              daily: { temperature_2m_max: [9.4], temperature_2m_min: [2.1], weather_code: [0] },
            },
          },
    );
    const snapshot = await loadWeather("南京市江宁区", { fetchImpl, now: NOW });
    expect(snapshot?.label).toBe("晴");
    expect(snapshot?.fetchedAt).toBe(NOW);
    /* 同一次请求就带回了今日预报 —— 不应该再发第二次 */
    expect(snapshot?.today).toEqual({ maxC: 9.4, minC: 2.1, code: 0 });
  });

  it("地理编码失败整链返回 null（不编造天气）", async () => {
    const fetchImpl = fakeFetch(() => ({ ok: true, body: { results: [] } }));
    expect(await loadWeather("查无此地甲", { fetchImpl, now: NOW })).toBeNull();
  });

  it("天气接口失败整链返回 null", async () => {
    const fetchImpl = fakeFetch((url) =>
      url.includes("geocoding")
        ? { ok: true, body: { results: [{ name: "苏州", latitude: 31, longitude: 120 }] } }
        : { ok: false, body: {} },
    );
    expect(await loadWeather("苏州市姑苏区", { fetchImpl, now: NOW })).toBeNull();
  });
});
