/**
 * 大屏顶栏的「最新数据更新时间」（2026-11-24 客户要求）。
 *
 * <h2>为什么要有</h2>
 *
 * 卡片头上已经有一个「延迟 N 小时」的标记（`widgetDataAgeMs`），但那是
 * **逐卡**的：一张卡有数据、另一张停了，大屏整体看着"正常"。
 * 现场值班员需要的是**一句话全局判断**：「我这屏上的数，是什么时候的」。
 *
 * <h2>为什么取全部测点的最大值</h2>
 *
 * 同一块屏上有温度、功率、状态几十个测点，上报节奏各不相同。
 * 取最大值 = 「最近有任何一条数据进来的时刻」，这回答的正是
 * 「系统还活着吗」。取最小值会永远显示好几小时前 —— 那是
 * 「最慢的测点」，不是「最新数据」，名字和语义对不上。
 *
 * <p>逐卡滞后由卡片自己的「延迟」标记负责，两者不重复。
 */
import type { TelemetryRecord } from "@idt/shared-types";
import { formatDataAge } from "../scene-widgets/widget-values";

export interface DataFreshness {
  /** 最近一条遥测的时间戳（毫秒）；一条都没有时为 null */
  latestTs: number | null;
  /** 距今毫秒数；null 表示没有数据 */
  ageMs: number | null;
  /** 「刚刚 / 3 分钟前 / 2 小时前」；没有数据时为「暂无数据」 */
  text: string;
  /** 观测时刻的时分，例如 `19:03`；没有数据时为空串 */
  clockText: string;
}

/**
 * 扫一遍内存里的最新值表，取最大时间戳。
 *
 * <p>`latest` 的键是 `${deviceId}:${key}`，值带 `timestamp`。
 * 非法时间戳（0 / NaN）直接跳过 —— 有些测点初始帧的 timestamp 是 0，
 * 算进去会把「最新时间」拉回到 1970。
 */
export function latestTelemetryTimestamp(
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord> | null | undefined,
): number | null {
  if (!latest) return null;
  let max = 0;
  const rows = latest instanceof Map ? latest.values() : Object.values(latest);
  for (const row of rows) {
    const ts = Number(row?.timestamp);
    if (Number.isFinite(ts) && ts > 0 && ts > max) max = ts;
  }
  return max > 0 ? max : null;
}

/** 把时间戳变成顶栏要的那几个字符串。 */
export function describeFreshness(
  latestTs: number | null,
  now: number = Date.now(),
): DataFreshness {
  if (latestTs === null) {
    return { latestTs: null, ageMs: null, text: "暂无数据", clockText: "" };
  }
  const ageMs = Math.max(0, now - latestTs);
  const d = new Date(latestTs);
  const pad = (n: number) => String(n).padStart(2, "0");
  /*
   * 只给时分，不区分今天/昨天。
   *
   * <p>顶栏这一格跟「3 小时前」并排，读者一眼就能推出是哪天；
   * 塞进 `11-24 19:03` 会把这一格拉宽，挤压中间的标题与面包屑
   * （1920 宽的现场大屏上尤其明显）。
   */
  return {
    latestTs,
    ageMs,
    text: `${formatDataAge(ageMs)}前`,
    clockText: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
