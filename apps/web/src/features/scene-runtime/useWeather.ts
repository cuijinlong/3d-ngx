import { useEffect, useRef, useState } from "react";
import {
  isWeatherFresh,
  loadWeather,
  type WeatherSnapshot,
} from "./weather";

/**
 * 天气 hook：地名 → 当前天气（2026-11-24）。
 *
 * <h2>四种状态必须分清</h2>
 *
 * ```
 * idle         还没开始（没有行政区划）
 * loading      正在查
 * ready        有快照，可以显示「☀ 晴 6℃」
 * unavailable  查不到（地名不识别 / 断网 / 接口变了）
 * ```
 *
 * <p>`unavailable` 与 `idle` 分开：前者说明「配置了地点但拿不到」，
 * 后者说明「根本没配地点」。混在一起会让排查方向走错 ——
 * 看到「没天气」时，先要能判断是缺配置还是缺网络。
 *
 * <h2>不上报错误到控制台</h2>
 *
 * <p>内网偶尔断一下外网是常态，天气是增强信息。每 15 分钟在控制台
 * 打一串 `Failed to fetch` 会淹没真正重要的报错。
 */
export type WeatherState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; snapshot: WeatherSnapshot }
  | { status: "unavailable" };

export function useWeather(place: string | null): WeatherState {
  const [state, setState] = useState<WeatherState>({ status: "idle" });
  /*
   * 快照放 ref：切换场景时会短暂经历 place=null → 新 place，
   * 期间不该把已经拿到的天气闪掉。同一天气地点再次挂载时直接复用。
   */
  const cache = useRef<WeatherSnapshot | null>(null);

  useEffect(() => {
    if (!place) {
      setState({ status: "idle" });
      return;
    }

    const cached = cache.current;
    if (cached && cached.place.query === place && isWeatherFresh(cached)) {
      setState({ status: "ready", snapshot: cached });
      return;
    }

    /* 换了地点：旧快照作废，避免把上一个城市的温度挂在新地名旁边 */
    if (cached && cached.place.query !== place) cache.current = null;

    let alive = true;
    const controller = new AbortController();
    setState({ status: "loading" });

    const run = async () => {
      const snapshot = await loadWeather(place, { signal: controller.signal }).catch(() => null);
      if (!alive) return;
      if (snapshot) {
        cache.current = snapshot;
        setState({ status: "ready", snapshot });
      } else {
        setState({ status: "unavailable" });
      }
    };
    void run();

    /*
     * 15 分钟刷新一次。Open-Meteo 的观测粒度就是 15 分钟，
     * 更密只会重复拿到同一个数；而大屏是常开的，不刷新会在
     * 早上挂到晚上一直显示 6℃。
     */
    const timer = window.setInterval(() => {
      void loadWeather(place, { signal: controller.signal })
        .then((snapshot) => {
          if (!alive || !snapshot) return;
          cache.current = snapshot;
          setState({ status: "ready", snapshot });
        })
        .catch(() => {
          /* 定时刷新失败保留旧值 —— 显示 15 分钟前的天气，比变成空白好 */
        });
    }, 15 * 60 * 1000);

    return () => {
      alive = false;
      window.clearInterval(timer);
      /*
       * 中止在途请求：大屏反复切场站时会攒下悬空请求，
       * 慢网下晚到的旧响应会覆盖新地点。
       */
      controller.abort();
    };
  }, [place]);

  return state;
}
