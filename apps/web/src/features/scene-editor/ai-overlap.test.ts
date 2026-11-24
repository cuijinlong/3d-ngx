import { describe, expect, it } from "vitest";
import { DEFAULT_AI_EXTENSION, type SceneWidgetLayout } from "@idt/data-adapter";
import { planAiActions } from "./ai-actions";

/*
 * AI 新增/移动卡片时的**遮挡校验**（2026-11-24）。
 *
 * <p>实测事故：AI 把一张 42×22 的对比卡放到 x=58,y=56，
 * 而告警条占 x=79~97.6 / y=61.4~93 —— 大幅重叠。
 * AI 在回答里写「不与任何现有卡片重叠」（它算错了），
 * 应用之后**告警卡在界面上完全看不见**，用户以为功能坏了。
 *
 * <p>遮挡是静默破坏：不报错、不告警，只有人去看才发现。
 */

const allowAll = {
  ...DEFAULT_AI_EXTENSION,
  operations: ["add-widget", "update-widget", "remove-widget", "bind-telemetry"],
};

/** 天骄场景的真实布局（7 张卡，全部贴边不重叠）。 */
const TIANJIAO: SceneWidgetLayout = {
  schemaVersion: "1.0.0",
  widgets: [
    /* title 要带上 —— 报错文案用 title 指认卡片，没有的话只能看到 id */
    { id: "title", type: "title", title: "天骄科技园 · 冷热站监控", x: 20, y: 2, w: 60, h: 6.5 },
    { id: "system-power", type: "metric-card", title: "场站用电量", x: 2.4, y: 12.6, w: 18.6, h: 22 },
    { id: "plant-capacity", type: "metric-card", title: "碳排放核算", x: 79, y: 12.6, w: 18.6, h: 18 },
    { id: "unit-list", type: "device-list", title: "机组状态", x: 79, y: 31.5, w: 18.6, h: 29 },
    { id: "power-trend", type: "trend-chart", title: "场站用电趋势", x: 2.4, y: 35.5, w: 18.6, h: 24 },
    { id: "load-compare", type: "bar-compare", title: "用能分项占比", x: 2.4, y: 60.4, w: 18.6, h: 32.6 },
    { id: "alarm-ticker", type: "alarm-ticker", title: "告警", x: 79, y: 61.4, w: 18.6, h: 31.6 },
  ] as SceneWidgetLayout["widgets"],
};

describe("add-widget 的遮挡校验", () => {
  it("★ 压住告警条 → 拒绝（就是实测那次事故）", () => {
    const { proposal } = planAiActions(TIANJIAO, [{
      op: "add-widget",
      widget: {
        id: "unit-water-inlet-compare", type: "bar-compare", title: "机组进水温度对比",
        /* 与告警条同位置 */
        x: 79, y: 61.4, w: 18.6, h: 24,
      },
    } as never], allowAll);

    expect(proposal.ok).toBe(false);
    const hits = proposal.issues.filter((i) => i.code === "widget-overlap");
    expect(hits.length).toBeGreaterThan(0);
    /* 报错必须说清压住了谁，否则用户不知道该挪哪张 */
    const all = hits.map((i) => i.message).join(" ");
    expect(all).toContain("机组进水温度对比");
    expect(all).toContain("告警");
    /* 也要给出双方的坐标，用户据此才知道往哪挪 */
    expect(all).toMatch(/x79~97\.6/);
  });

  it("★ 水平贴边不算重叠（大屏是切格子，共边是常态）", () => {
    const { proposal } = planAiActions(TIANJIAO, [{
      op: "add-widget",
      widget: {
        id: "center-left", type: "bar-compare", title: "左中对比",
        /* x 从 21 起，正好紧贴 system-power 的右边缘（2.4+18.6=21） */
        x: 21, y: 12.6, w: 20, h: 22,
      },
    } as never], allowAll);
    expect(proposal.ok).toBe(true);
  });

  it("★ 放进空白区 → 通过", () => {
    const { proposal } = planAiActions(TIANJIAO, [{
      op: "add-widget",
      widget: {
        id: "center-gap", type: "bar-compare", title: "中间对比",
        /* 中间 x21~79 是空的 3D 舞台；y 避开标题条（2~8.5） */
        x: 25, y: 20, w: 40, h: 22,
      },
    } as never], allowAll);
    expect(proposal.ok).toBe(true);
  });

  it("纵向不交叉就不算遮挡（同 x 但上下错开）", () => {
    const { proposal } = planAiActions(TIANJIAO, [{
      op: "add-widget",
      widget: {
        id: "under-health", type: "metric-card",
        /* 与 power-trend 同列，但不与任何卡在 y 上交叉：
           power-trend 到 59.5，load-compare 从 60.4 起 —— 中间只有 0.9 */
        x: 21, y: 35.5, w: 20, h: 10,
      },
    } as never], allowAll);
    expect(proposal.ok).toBe(true);
  });
});

describe("update-widget 移动时的遮挡校验", () => {
  it("★ 把卡片挪到别人身上 → 拒绝", () => {
    const { proposal } = planAiActions(TIANJIAO, [{
      op: "update-widget",
      id: "power-trend",
      /* 挪到告警条的位置 */
      patch: { x: 79, y: 61.4, w: 18.6, h: 24 },
    } as never], allowAll);
    expect(proposal.ok).toBe(false);
    expect(proposal.issues.some((i) => i.code === "widget-overlap")).toBe(true);
  });

  it("★ 只改标题不查重叠（历史遗留不该挡住无关改动）", () => {
    /* 造一个本来就有重叠的历史布局，改名仍应通过 */
    const legacy: SceneWidgetLayout = {
      schemaVersion: "1.0.0",
      widgets: [
        { id: "a", type: "metric-card", x: 10, y: 10, w: 30, h: 30 },
        { id: "b", type: "metric-card", x: 25, y: 25, w: 30, h: 30 },
      ] as SceneWidgetLayout["widgets"],
    };
    const { proposal } = planAiActions(legacy, [{
      op: "update-widget", id: "a", patch: { title: "改名" },
    } as never], allowAll);
    expect(proposal.ok).toBe(true);
  });

  it("缩小尺寸脱离重叠 → 通过", () => {
    const legacy: SceneWidgetLayout = {
      schemaVersion: "1.0.0",
      widgets: [
        { id: "a", type: "metric-card", x: 10, y: 10, w: 30, h: 30 },
        { id: "b", type: "metric-card", x: 25, y: 25, w: 30, h: 30 },
      ] as SceneWidgetLayout["widgets"],
    };
    const { proposal } = planAiActions(legacy, [{
      op: "update-widget", id: "a", patch: { w: 10, h: 10 },
    } as never], allowAll);
    expect(proposal.ok).toBe(true);
  });
});

describe("真实天骄布局本身是合法的", () => {
  it("★ 现有 7 张卡两两不重叠（校验不能把它们自己判成遮挡）", () => {
    /*
     * 挪动一张卡到它自己的位置 —— 校验会把该卡纳入 touched，
     * 于是它与**其余 6 张**都会被检查。若现有布局真有重叠，这里就会失败。
     */
    const { proposal } = planAiActions(TIANJIAO, [{
      op: "update-widget", id: "power-trend",
      patch: { x: 2.4, y: 35.5, w: 18.6, h: 24 },
    } as never], allowAll);
    expect(proposal.issues.filter((i) => i.code === "widget-overlap")).toEqual([]);
  });
});
