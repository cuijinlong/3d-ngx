import { describe, expect, it } from "vitest";
import type { SceneWidgetLayout } from "@idt/data-adapter";
import { parseAiActions, planAiActions } from "./ai-actions";

/*
 * AI 动作落地（2026-11-24）。
 *
 * <p>这块之前是空的 —— 面板注释里写着「交给 applyAiActions」，
 * 函数却从来没实现。所以这里覆盖的都是「会让用户看到假成功」的路径。
 */

const layout = (): SceneWidgetLayout => ({
  schemaVersion: "1.0.0",
  templateId: "tianjiao-heat-pump",
  widgets: [
    {
      id: "power-trend",
      type: "trend-chart",
      x: 2,
      y: 30,
      w: 20,
      h: 24,
      title: "机组总功率趋势",
      slots: [{ key: "series-0", label: "功率", telemetryKey: "power" }],
    } as never,
    { id: "unit-list", type: "device-list", x: 78, y: 30, w: 20, h: 29, title: "机组状态" } as never,
  ],
});

describe("parseAiActions", () => {
  it("没有 actions 字段时返回空操作（不是错误）", () => {
    expect(parseAiActions(undefined)).toEqual({ ok: true, operations: [] });
    expect(parseAiActions(null)).toEqual({ ok: true, operations: [] });
  });

  it("★ 认 {op:...} 与 {type:...} 两种写法", () => {
    const a = parseAiActions([{ op: "remove-widget", id: "unit-list" }]);
    const b = parseAiActions([{ type: "remove-widget", id: "unit-list" }]);
    expect(a).toEqual({ ok: true, operations: [{ op: "remove-widget", id: "unit-list" }] });
    expect(b).toEqual({ ok: true, operations: [{ op: "remove-widget", id: "unit-list" }] });
  });

  it("★ 形状不对就报错，不静默丢弃", () => {
    const r = parseAiActions("not-an-array");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("不是数组");
  });

  it("★ 缺操作名时报错并列出可取的值（否则用户无从下手）", () => {
    const r = parseAiActions([{ id: "x" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("缺少操作名");
      expect(r.error).toContain("update-widget");
    }
  });

  it("★ 未实现的操作明确拒绝，而不是走查卡片那条路", () => {
    const r = parseAiActions([{ op: "add-scene-event" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("不支持");
  });

  it("非对象元素报错并给出下标", () => {
    const r = parseAiActions([{ op: "remove-widget", id: "a" }, "oops"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("actions[1]");
  });
});

describe("planAiActions", () => {
  it("没有布局时给明确指引，而不是让用户以为是 id 写错", () => {
    const plan = planAiActions(null, [{ op: "remove-widget", id: "unit-list" }]);
    expect(plan.proposal.ok).toBe(false);
    expect(plan.proposal.issues[0]?.message).toContain("还没有布局");
  });

  it("合法改动 → ok + diff + next，并要求确认", () => {
    const plan = planAiActions(layout(), [
      { op: "update-widget", id: "power-trend", patch: { title: "机组功率趋势" } },
    ]);
    expect(plan.proposal.ok).toBe(true);
    expect(plan.proposal.diff.length).toBeGreaterThan(0);
    expect(plan.proposal.next?.widgets.find((w) => w.id === "power-trend")?.title).toBe("机组功率趋势");
    expect(plan.needsConfirm).toBe(true);
  });

  it("★ 不存在的卡片 → 整体拒绝，不部分应用", () => {
    const plan = planAiActions(layout(), [
      { op: "update-widget", id: "power-trend", patch: { title: "改了" } },
      { op: "remove-widget", id: "no-such-card" },
    ]);
    expect(plan.proposal.ok).toBe(false);
    expect(plan.proposal.next).toBeUndefined();
    const codes = plan.proposal.issues.map((i) => i.code);
    expect(codes).toContain("widget-not-found");
  });

  it("★ 模板不允许的操作被拦下（aiExtension 是边界）", () => {
    const plan = planAiActions(
      layout(),
      [{ op: "remove-widget", id: "unit-list" }],
      { editableTargets: [], protectedTargets: [], operations: ["update-widget"], requiresDiffReview: true },
    );
    expect(plan.proposal.ok).toBe(false);
    expect(plan.proposal.issues.some((i) => i.code === "operation-not-allowed")).toBe(true);
  });

  it("槽位不存在时报 slot-not-found（键名猜错是高频错误）", () => {
    const plan = planAiActions(layout(), [
      { op: "bind-telemetry", id: "power-trend", slotKey: "series-9", telemetryKey: "power" },
    ]);
    expect(plan.proposal.ok).toBe(false);
    expect(plan.proposal.issues.some((i) => i.code === "slot-not-found")).toBe(true);
  });

  it("★ 纯函数：不修改传入的布局", () => {
    const before = layout();
    const snapshot = JSON.stringify(before);
    planAiActions(before, [{ op: "remove-widget", id: "unit-list" }]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("空操作列表 → 拒绝（没有改动就不该弹确认）", () => {
    const plan = planAiActions(layout(), []);
    expect(plan.proposal.ok).toBe(false);
    expect(plan.needsConfirm).toBe(false);
  });
});

/*
 * 桥接服务回包形状（2026-11-24）。
 *
 * <p>这些用例的价值在于：它们是**前后端契约的边界**。
 * 桥接服务（ai-bridge/server.js）把 codewhale 的输出整理成
 * `{content, actions}`，前端 `parseAiActions` 收的就是它。
 * 契约一旦漂移，表现是「AI 回答正常但改动不生效」——
 * 而那种失败不会报错，只会静默什么都不发生。
 */
describe("桥接回包契约", () => {
  it("★ codewhale 真实产出的 actions 形状能被解析", () => {
    /* 实测样本：bridge 返回的两条操作 */
    const raw = [
      { op: "update-widget", id: "power-trend", patch: { title: "机组功率趋势" } },
      { op: "remove-widget", id: "unit-list" },
    ];
    const r = parseAiActions(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.operations).toHaveLength(2);
      expect(r.operations[0]).toEqual({ op: "update-widget", id: "power-trend", patch: { title: "机组功率趋势" } });
    }
  });

  it("★ 桥接返回 actions:[] 时不该产生任何改动提案", () => {
    const r = parseAiActions([]);
    expect(r).toEqual({ ok: true, operations: [] });
    const plan = planAiActions(layout(), (r as { ok: true; operations: never[] }).operations);
    /* 空操作 → 校验拒绝，但**不要求确认**（没有东西可确认） */
    expect(plan.needsConfirm).toBe(false);
  });

  it("★ 模型自作主张多写字段（如 note）不影响解析", () => {
    const r = parseAiActions([
      { op: "update-widget", id: "power-trend", patch: { title: "X" }, reason: "用户要求", confidence: 0.9 },
    ]);
    expect(r.ok).toBe(true);
  });
});
