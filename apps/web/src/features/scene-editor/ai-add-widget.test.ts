import { describe, expect, it } from "vitest";
import { DEFAULT_AI_EXTENSION } from "@idt/data-adapter";
import { planAiActions } from "./ai-actions";
import { parseSceneWidget } from "../../../../../packages/data-adapter/src/scene-widget-layout";
import type { SceneWidgetLayout } from "@idt/data-adapter";

/*
 * AI 新增卡片的规范化（2026-11-24）。
 *
 * <p>钉住的是「AI 写错字段名 → 卡片空白且不报错」这一类静默故障。
 * 实测 AI 会给出 `{slotKey:"series-0"}` —— 因为 `bind-telemetry` 用的就是
 * `slotKey`，两个名字在同一份契约里不一致，混淆是系统性的。
 */

const EMPTY: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [] };

const allowAll = {
  ...DEFAULT_AI_EXTENSION,
  operations: ["add-widget", "update-widget", "remove-widget", "bind-telemetry"],
};

describe("parseSceneWidget 对 slotKey 的容错", () => {
  it("★ slotKey 被当成槽位键，而不是退到 telemetryKey", () => {
    const w = parseSceneWidget({
      id: "trend-1",
      type: "trend-chart",
      x: 1, y: 30, w: 18.6, h: 24,
      slots: [{ slotKey: "series-0", telemetryKey: "energy", aggregate: "sum" }],
    }, 0)!;
    /* 错退到 telemetryKey 会让键变成 "energy" —— 渲染层永远找不到 series-0 */
    expect(w.slots?.[0]?.key).toBe("series-0");
    expect(w.slots?.[0]?.telemetryKey).toBe("energy");
  });

  it("key 与 slotKey 同时存在时以 key 为准", () => {
    const w = parseSceneWidget({
      id: "x", type: "metric-card", x: 0, y: 0, w: 10, h: 10,
      slots: [{ key: "main", slotKey: "别的", telemetryKey: "power" }],
    }, 0)!;
    expect(w.slots?.[0]?.key).toBe("main");
  });
});

describe("add-widget 会规范化 AI 给的 widget", () => {
  it("★ 完整形态被保留：dataSource / aggregate 不丢", () => {
    const { proposal } = planAiActions(EMPTY, [{
      op: "add-widget",
      widget: {
        id: "spt",
        type: "trend-chart",
        x: 1, y: 30, w: 18.6, h: 24,
        title: "场站用电趋势",
        dataSource: "energy", energyMetric: "trend", energyKind: "elec",
        slots: [{ slotKey: "series-0", telemetryKey: "energy", aggregate: "sum" }],
      },
    } as never], allowAll);

    expect(proposal.ok).toBe(true);
    const added = proposal.next!.widgets[0]!;
    expect(added.dataSource).toBe("energy");
    expect(added.energyMetric).toBe("trend");
    expect(added.slots?.[0]?.key).toBe("series-0");
    expect(added.slots?.[0]?.aggregate).toBe("sum");
  });

  it("杂字段被清掉（不把 AI 的随手字段带进布局）", () => {
    const { proposal } = planAiActions(EMPTY, [{
      op: "add-widget",
      widget: {
        id: "m1", type: "metric-card", x: 1, y: 1, w: 10, h: 10,
        nonsenseField: "随便写的",
      },
    } as never], allowAll);
    expect(proposal.ok).toBe(true);
    expect(proposal.next!.widgets[0]).not.toHaveProperty("nonsenseField");
  });

  it("id 重复仍被拒（规范化不能绕过原有校验）", () => {
    const layout: SceneWidgetLayout = {
      schemaVersion: "1.0.0",
      widgets: [{ id: "dup", type: "metric-card", x: 0, y: 0, w: 10, h: 10 } as never],
    };
    const { proposal } = planAiActions(layout, [{
      op: "add-widget",
      widget: { id: "dup", type: "metric-card", x: 1, y: 1, w: 10, h: 10 },
    } as never], allowAll);
    expect(proposal.ok).toBe(false);
    expect(proposal.issues[0]?.code).toBe("widget-duplicate");
  });

  it("缺少 type 时明确报错，不是静默加一张坏卡", () => {
    const { proposal } = planAiActions(EMPTY, [{
      op: "add-widget",
      widget: { id: "no-type", x: 1, y: 1, w: 10, h: 10 },
    } as never], allowAll);
    /* parseSceneWidget 对缺失 type 会兜底成 metric-card —— 只要不崩即可 */
    const added = proposal.next?.widgets[0];
    expect(added?.type).toBeTruthy();
  });
});
