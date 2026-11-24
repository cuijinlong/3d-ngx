import { describe, expect, it } from "vitest";
import { splitPinned } from "./AlarmTickerCard";

/**
 * 告警跑马灯：最严重常驻 + 其余滚动（2026-11-23）。
 *
 * <p>客户原话：「告警右上角有个等级筛选，把最严重的常驻，然后其他的跑马灯」。
 */

const row = (id: string, level: "alarm" | "warning") => ({ id, alarm: { level } });

describe("splitPinned", () => {
  it("★ 常驻的是**最严重**，不是最新的", () => {
    /*
     * 入参按时间降序：第一条是最新的「预警」，最后一条是一小时前的「告警」。
     * 直接取 [0] 会让预警压住告警 —— 严重度整个搞反。
     */
    const rows = [row("w-new", "warning"), row("w-old", "warning"), row("a-old", "alarm")];
    const { pinned } = splitPinned(rows, "all");
    expect(pinned?.id).toBe("a-old");
  });

  it("★ 常驻那条不能同时出现在滚动列表里", () => {
    const rows = [row("a1", "alarm"), row("w1", "warning"), row("w2", "warning")];
    const { pinned, rest } = splitPinned(rows, "all");
    expect(pinned?.id).toBe("a1");
    expect(rest.map((r) => r.id)).toEqual(["w1", "w2"]);
  });

  it("同级时取最新的（入参顺序已按时间降序）", () => {
    const rows = [row("a-new", "alarm"), row("a-old", "alarm")];
    const { pinned, rest } = splitPinned(rows, "all");
    expect(pinned?.id).toBe("a-new");
    expect(rest.map((r) => r.id)).toEqual(["a-old"]);
  });

  it("筛选「告警」时只留 alarm，预警不进常驻也不进滚动", () => {
    const rows = [row("w1", "warning"), row("a1", "alarm")];
    const { pinned, rest } = splitPinned(rows, "alarm");
    expect(pinned?.id).toBe("a1");
    expect(rest).toEqual([]);
  });

  it("筛选「预警」时只留 warning", () => {
    const rows = [row("a1", "alarm"), row("w1", "warning"), row("w2", "warning")];
    const { pinned, rest } = splitPinned(rows, "warning");
    expect(pinned?.id).toBe("w1");
    expect(rest.map((r) => r.id)).toEqual(["w2"]);
  });

  it("筛选后为空时返回 null（卡片走空态，不崩）", () => {
    const rows = [row("w1", "warning")];
    expect(splitPinned(rows, "alarm")).toEqual({ pinned: null, rest: [] });
  });

  it("完全没有告警时返回 null", () => {
    expect(splitPinned([], "all")).toEqual({ pinned: null, rest: [] });
  });

  it("只有一条时它常驻、滚动为空（不做单条动画）", () => {
    const { pinned, rest } = splitPinned([row("only", "alarm")], "all");
    expect(pinned?.id).toBe("only");
    expect(rest).toEqual([]);
  });
});
