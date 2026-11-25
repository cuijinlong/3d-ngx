import { useEffect, useMemo, useState } from "react";
import type { TelemetryRecord } from "@idt/shared-types";
import styles from "./RuntimeShell.module.css";
import { latestTelemetryTimestamp, describeFreshness } from "./data-freshness";
import { formatNowText, formatTodayText } from "./weather";
import { placeSourceLabel, type PlaceSource } from "./scene-place";
import { useWeather } from "./useWeather";

/**
 * 顶栏右侧的「天气 + 最新数据时间」（2026-11-24 客户要求）。
 *
 * <h2>为什么两个放一起</h2>
 *
 * 模板 `template01` 的 header 右上角本来就是 `☀ 22℃ 晴　2026.11.23 03:10`：
 * 左边天气、右边时间。客户要的「最新数据更新时间」正好是那一格时间的
 * 同类信息（**数据的时间**，不是当前时间），放同一行读起来最自然：
 *
 * ```
 * ☀ 晴 6℃    最新数据 19:03 · 3 分钟前    2026.11.24 19:26:31
 * ```
 *
 * 三段的语义从「环境」到「数据」到「现在」，从左到右时间精度递增。
 *
 * <h2>数据时间与当前时间必须都在</h2>
 *
 * 只有当前时间时，值班员无法判断屏上的数是旧的；
 * 只有数据时间时，他不知道自己看了多久。两个并排才构成判断依据。
 */
export function RuntimeStatus(props: {
  /** 天气地点（行政区划）。null = 没配置 */
  place: string | null;
  /** 地点来自哪一级，用于 title 提示 */
  placeSource: PlaceSource | null;
  /** 内存里最新的遥测表；取最大时间戳作为「最新数据时间」 */
  latest?: Record<string, TelemetryRecord> | Map<string, TelemetryRecord> | null;
}) {
  const weather = useWeather(props.place);

  /*
   * 相对时间（「3 分钟前」）自己走：遥测表不变时组件不会重渲染，
   * 不自己计时就会一直停在打开页面那一刻的「刚刚」。
   * 30 秒够 —— 这一格最细的粒度就是分钟。
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const latestTs = useMemo(
    () => latestTelemetryTimestamp(props.latest),
    // latest 是 Record/Map 引用，变化即代表新帧到达
    [props.latest],
  );
  const freshness = useMemo(() => describeFreshness(latestTs, now), [latestTs, now]);

  const weatherTitle =
    props.place === null
      ? `${placeSourceLabel(props.placeSource)}：给场站或组织填 address 属性后显示`
      : `${props.place}（${placeSourceLabel(props.placeSource)}）`;

  return (
    <div className={styles.statusGroup} data-testid="runtime-status">
      {/*
       * 天气：只显示真实值，拿不到就整块不渲染，不给假的 22℃。
       *
       * 当前天气与今日预报分成两个 span —— 中间靠 flex gap 拉开距离。
       * 写在一段文本里用空格分隔会被 HTML 合并，`6℃ 今日` 会粘在一起。
       */}
      {weather.status === "ready" ? (
        <span
          className={styles.weather}
          data-testid="runtime-weather"
          title={`${weatherTitle} · 观测 ${weather.snapshot.weather.observedAt}`}
        >
          {formatNowText(weather.snapshot)}
          {formatTodayText(weather.snapshot) ? (
            <em className={styles.forecast}>{formatTodayText(weather.snapshot)}</em>
          ) : null}
        </span>
      ) : null}

      {freshness.latestTs !== null ? (
        <span
          className={styles.freshness}
          data-testid="runtime-freshness"
          title={`最新一条遥测：${new Date(freshness.latestTs).toLocaleString("zh-CN")}`}
        >
          最新数据 {freshness.clockText}
          <em>· {freshness.text}</em>
        </span>
      ) : (
        /*
         * 一条遥测都没收到时也要显示。
         * 不显示的话，顶栏这一格会直接消失 —— 看起来像功能坏了，
         * 而不是「数据还没来」。写了 45 秒的「暂无数据」提示在正文里，
         * 但顶栏常驻一句更直接。
         */
        <span className={styles.freshness} data-testid="runtime-freshness">
          最新数据 <em>暂无数据</em>
        </span>
      )}
    </div>
  );
}
