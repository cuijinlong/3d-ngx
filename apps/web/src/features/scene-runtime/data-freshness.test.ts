import { describe, it, expect } from "vitest";
import type { TelemetryRecord } from "@idt/shared-types";
import { describeFreshness, latestTelemetryTimestamp } from "./data-freshness";

const NOW = new Date("2026-11-24T19:30:00").getTime();

function row(timestamp: number): TelemetryRecord {
  return { deviceId: "d1", key: "temperature", value: 6, timestamp, source: "guard" };
}

describe("latestTelemetryTimestamp", () => {
  it("取全部测点的最大值（最新数据来自任一条）", () => {
    const latest = {
      "d1:temperature": row(NOW - 5 * 60_000),
      "d2:power": row(NOW - 60_000),
      "d3:status": row(NOW - 3 * 60 * 60_000),
    };
    expect(latestTelemetryTimestamp(latest)).toBe(NOW - 60_000);
  });

  it("支持 Map", () => {
    const latest = new Map([
      ["a", row(NOW - 1000)],
      ["b", row(NOW - 2000)],
    ]);
    expect(latestTelemetryTimestamp(latest)).toBe(NOW - 1000);
  });

  it("空表返回 null", () => {
    expect(latestTelemetryTimestamp({})).toBeNull();
    expect(latestTelemetryTimestamp(null)).toBeNull();
    expect(latestTelemetryTimestamp(undefined)).toBeNull();
  });

  it("timestamp 为 0 / 非法时跳过，不被拉到 1970", () => {
    const latest = {
      "a:init": row(0),
      "b:bad": { ...row(0), timestamp: Number.NaN },
      "c:ok": row(NOW - 60_000),
    };
    expect(latestTelemetryTimestamp(latest)).toBe(NOW - 60_000);
  });

  it("全是 0 时返回 null 而不是 0", () => {
    expect(latestTelemetryTimestamp({ a: row(0) })).toBeNull();
  });
});

describe("describeFreshness", () => {
  it("没有数据时给「暂无数据」", () => {
    const result = describeFreshness(null, NOW);
    expect(result.text).toBe("暂无数据");
    expect(result.clockText).toBe("");
    expect(result.ageMs).toBeNull();
  });

  it("一分钟内是「刚刚前」并给时分", () => {
    const result = describeFreshness(NOW - 20_000, NOW);
    expect(result.text).toBe("刚刚前");
    expect(result.clockText).toBe("19:29");
  });

  it("按分钟/小时/天说年龄", () => {
    expect(describeFreshness(NOW - 3 * 60_000, NOW).text).toBe("3 分钟前");
    expect(describeFreshness(NOW - 2 * 60 * 60_000, NOW).text).toBe("2 小时前");
    expect(describeFreshness(NOW - 26 * 60 * 60_000, NOW).text).toBe("1 天前");
  });

  it("未来时间被夹到 0，不出现负年龄", () => {
    const result = describeFreshness(NOW + 60_000, NOW);
    expect(result.ageMs).toBe(0);
    expect(result.text).toBe("刚刚前");
  });
});
