import { describe, expect, it } from "vitest";
import type { SceneWidget, SceneWidgetLayout } from "./scene-widget-layout";
import {
  DEFAULT_AI_EXTENSION,
  examineLayoutProposal,
  proposalNeedsReview,
  type LayoutOperation,
} from "./layout-proposal";

/**
 * 在线编程的提案校验（2026-11-23）。
 *
 * <p>这些断言的共同点：**每一种越界都必须是"拒绝"，而不是"尽量执行"**。
 * 在线编程最危险的失败不是报错，是悄悄改掉不该改的东西
 * （比如把 templateId 换了、把卡的类型换了）。
 */

function widget(partial: Partial<SceneWidget> = {}): SceneWidget {
  return {
    id: "w1",
    type: "metric-card",
    x: 2,
    y: 9,
    w: 20,
    h: 13,
    title: "系统功率",
    ...partial,
  } as SceneWidget;
}

function layout(widgets: SceneWidget[] = [widget()]): SceneWidgetLayout {
  return { schemaVersion: "1.0.0", widgets };
}

describe("examineLayoutProposal / 操作白名单", () => {
  it("不在 operations 里的操作被拒绝", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "drop-database" } as unknown as LayoutOperation,
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("operation-not-allowed");
  });

  it("空提案直接拒绝（没有操作就没有意图）", () => {
    const result = examineLayoutProposal(layout(), []);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("empty-operation");
  });

  it("自定义白名单生效：移除 update-widget 后它就不可用", () => {
    const strict = { ...DEFAULT_AI_EXTENSION, operations: ["add-widget"] };
    const result = examineLayoutProposal(
      layout(),
      [{ op: "update-widget", id: "w1", patch: { title: "x" } }],
      strict,
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("operation-not-allowed");
  });
});

describe("examineLayoutProposal / 保护字段", () => {
  it("★ 不允许改 type —— 改类型等于换部件，槽位与绑定会全部错位", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "update-widget", id: "w1", patch: { type: "trend-chart" } as Partial<SceneWidget> },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("protected-field");
    expect(result.issues[0]?.message).toContain("type");
  });

  it("★ 不允许改 id", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "update-widget", id: "w1", patch: { id: "hacked" } as Partial<SceneWidget> },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("protected-field");
  });
});

describe("examineLayoutProposal / 目标存在性", () => {
  it("改不存在的卡片被拒绝", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "update-widget", id: "nope", patch: { title: "x" } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("widget-not-found");
  });

  it("新增重复 id 被拒绝", () => {
    const result = examineLayoutProposal(layout(), [{ op: "add-widget", widget: widget() }]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("widget-duplicate");
  });

  it("绑定到不存在的槽位被拒绝，并列出可用槽位", () => {
    const w = widget({ slots: [{ key: "main", telemetryKey: "power_total" }] });
    const result = examineLayoutProposal(layout([w]), [
      { op: "bind-telemetry", id: "w1", slotKey: "nope", telemetryKey: "x" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("slot-not-found");
    expect(result.issues[0]?.message).toContain("main");
  });
});

describe("examineLayoutProposal / 正常提案", () => {
  it("改位置生成人可读 diff（不是 JSON Patch）", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "update-widget", id: "w1", patch: { y: 44 } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.next?.widgets[0].y).toBe(44);
    const text = result.diff.join("\n");
    expect(text).toContain("系统功率");
    expect(text).toContain("y: 9 → 44");
  });

  it("绑定遥测会清掉资产来源（否则切换来源不生效）", () => {
    const w = widget({
      slots: [{ key: "main", assetId: "a1", attributeKey: "rate", telemetryKey: undefined }],
    });
    const result = examineLayoutProposal(layout([w]), [
      { op: "bind-telemetry", id: "w1", slotKey: "main", telemetryKey: "power_total", deviceId: "gw" },
    ]);
    expect(result.ok).toBe(true);
    const slot = result.next?.widgets[0].slots?.[0];
    expect(slot?.telemetryKey).toBe("power_total");
    expect(slot?.deviceId).toBe("gw");
    expect(slot?.assetId).toBeUndefined();
    expect(slot?.attributeKey).toBeUndefined();
  });

  it("新增与删除都生成 diff", () => {
    const added = examineLayoutProposal(layout([]), [
      { op: "add-widget", widget: widget({ id: "new-1", title: "新卡" }) },
    ]);
    expect(added.ok).toBe(true);
    expect(added.next?.widgets).toHaveLength(1);
    expect(added.diff.join("\n")).toContain("新增");

    const removed = examineLayoutProposal(layout(), [{ op: "remove-widget", id: "w1" }]);
    expect(removed.ok).toBe(true);
    expect(removed.next?.widgets).toHaveLength(0);
    expect(removed.diff.join("\n")).toContain("删除");
  });
});

describe("examineLayoutProposal / 原子性", () => {
  it("★ 一条非法 → 整体拒绝，不做部分应用", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "update-widget", id: "w1", patch: { y: 44 } }, // 合法
      { op: "update-widget", id: "w1", patch: { type: "x" } as Partial<SceneWidget> }, // 非法
    ]);
    expect(result.ok).toBe(false);
    /*
     * 关键：next 必须不存在。如果这里给出一个「改了一半」的布局，
     * 提案方会以为全部成功，而屏幕上既不是旧状态也不是新状态。
     */
    expect(result.next).toBeUndefined();
    expect(result.issues).toHaveLength(1);
  });

  it("被拒绝时仍给出 diff —— 让人看到「本来会改成什么」", () => {
    const result = examineLayoutProposal(layout(), [
      { op: "update-widget", id: "w1", patch: { y: 44 } },
      { op: "update-widget", id: "w1", patch: { type: "x" } as Partial<SceneWidget> },
    ]);
    expect(result.diff.join("\n")).toContain("y: 9 → 44");
  });
});

describe("examineLayoutProposal / 纯函数", () => {
  it("不修改传入的 layout", () => {
    const original = layout();
    const snapshot = JSON.stringify(original);
    examineLayoutProposal(original, [{ op: "update-widget", id: "w1", patch: { y: 90 } }]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("不修改传入的槽位对象", () => {
    const slot = { key: "main", telemetryKey: "a" };
    const w = widget({ slots: [slot] });
    examineLayoutProposal(layout([w]), [
      { op: "bind-telemetry", id: "w1", slotKey: "main", telemetryKey: "b" },
    ]);
    expect(slot.telemetryKey).toBe("a");
  });
});

describe("proposalNeedsReview", () => {
  it("默认需要人工确认（requiresDiffReview = true）", () => {
    expect(proposalNeedsReview()).toBe(true);
  });

  it("显式关掉时可以免确认", () => {
    expect(proposalNeedsReview({ ...DEFAULT_AI_EXTENSION, requiresDiffReview: false })).toBe(false);
  });
});

/**
 * 声明了但没实现的操作（2026-11-23）。
 *
 * <p>`DEFAULT_AI_EXTENSION.operations` 里有 `add-scene-event` / `add-panel`
 * （与 `template01/template.manifest.json` 同构），但 `examineLayoutProposal`
 * 只有 4 个分支。
 *
 * <p>改之前的表现：这两个操作通过白名单后，落到「其余操作都要求目标存在」，
 * 拿 `operation.id`（它们根本没有这个字段）去查卡片 → 报
 * 「找不到卡片「undefined」」。用户会去翻卡片 id，而真正的原因是
 * **这个操作没有实现**。错误信息指错方向比不报错更浪费时间。
 */
describe("examineLayoutProposal / 声明但未实现的操作", () => {
  const layout: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [widget()] };

  for (const op of ["add-scene-event", "add-panel"]) {
    it(`★ ${op} 要报「尚未实现」，而不是「找不到卡片 undefined」`, () => {
      const result = examineLayoutProposal(
        layout,
        [{ op } as unknown as LayoutOperation],
        DEFAULT_AI_EXTENSION,
      );
      expect(result.ok).toBe(false);
      const messages = result.issues.map((issue) => issue.message).join(" ");
      expect(messages).toContain("尚未实现");
      /* 关键：绝不能出现 undefined 这种指错方向的字眼。 */
      expect(messages).not.toContain("undefined");
    });
  }

  it("真正实现的 4 种操作不被这条规则误伤", () => {
    const result = examineLayoutProposal(
      layout,
      [{ op: "update-widget", id: "w1", patch: { title: "改名" } }],
      DEFAULT_AI_EXTENSION,
    );
    expect(result.ok).toBe(true);
    expect(result.next?.widgets[0]?.title).toBe("改名");
  });

  it("没声明的操作仍报「不在允许清单里」（两种错误要分得开）", () => {
    const result = examineLayoutProposal(
      layout,
      [{ op: "drop-database" } as unknown as LayoutOperation],
      DEFAULT_AI_EXTENSION,
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain("不在允许清单里");
  });
});

/**
 * 模板自带的编辑边界（2026-11-23）。
 *
 * <p>天骄热泵模板现在自己声明 `aiExtension`，只列**真正实现**的 4 种操作。
 * 这比回落到 DEFAULT 更准确 —— DEFAULT 里含 `add-scene-event` / `add-panel`，
 * 而这两个没有实现，会让模型以为能做。
 *
 * <p>模板声明了边界，模型读模板就知道「能改什么」，不用去翻代码。
 */
describe("天骄热泵模板的 aiExtension", () => {
  it("声明的操作与实现一致（不多不少）", async () => {
    const { getBuiltinScreenTemplate, TIANJIAO_HEAT_PUMP_TEMPLATE_ID } =
      await import("./screen-template");
    const { IMPLEMENTED_OPERATIONS } = await import("./layout-proposal");
    const template = getBuiltinScreenTemplate(TIANJIAO_HEAT_PUMP_TEMPLATE_ID);
    expect(template?.aiExtension).toBeTruthy();
    expect([...(template?.aiExtension?.operations ?? [])].sort())
      .toEqual([...IMPLEMENTED_OPERATIONS].sort());
  });

  it("声明后 add-panel 被拒（回落到 DEFAULT 的话它会通过白名单）", async () => {
    const { getBuiltinScreenTemplate, TIANJIAO_HEAT_PUMP_TEMPLATE_ID } =
      await import("./screen-template");
    const template = getBuiltinScreenTemplate(TIANJIAO_HEAT_PUMP_TEMPLATE_ID);
    const extension = template!.aiExtension!;
    const result = examineLayoutProposal(
      { schemaVersion: "1.0.0", widgets: [widget()] },
      [{ op: "add-panel" } as unknown as LayoutOperation],
      extension,
    );
    expect(result.ok).toBe(false);
    /* 模板没声明 → 报「不在允许清单里」，这是最直白的说法。 */
    expect(result.issues[0]?.message).toContain("不在允许清单里");
  });

  it("requiresDiffReview 为 true（改之前必须先看差异）", async () => {
    const { getBuiltinScreenTemplate, TIANJIAO_HEAT_PUMP_TEMPLATE_ID } =
      await import("./screen-template");
    const template = getBuiltinScreenTemplate(TIANJIAO_HEAT_PUMP_TEMPLATE_ID);
    expect(template!.aiExtension!.requiresDiffReview).toBe(true);
  });
});

/**
 * 差异描述的**可读性**（2026-11-23）。
 *
 * <p>脚本模式一跑，diff 里原本有一半是 `slots: 数组(3) → 数组(3)` 和
 * `标题: 系统功率 → 系统功率` —— 用户看不出**哪个槽的哪个字段**变了。
 * 而「看一眼就知道改了什么」正是预览存在的唯一理由。
 */
describe("examineLayoutProposal / 差异可读性", () => {
  it("★ 值没变的字段不出现在差异里", () => {
    const layout: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [widget()] };
    const result = examineLayoutProposal(layout, [
      { op: "update-widget", id: "w1", patch: { title: "系统功率" } }, // 原值就是它
    ]);
    expect(result.ok).toBe(true);
    const text = result.diff.join("\n");
    expect(text).not.toContain("标题: 系统功率 → 系统功率");
    /* 但要说明「确实什么都没变」，否则用户以为校验器坏了。 */
    expect(text).toContain("没有任何实际变化");
  });

  it("★ slots 逐槽逐字段列出，不说「数组(3) → 数组(3)」", () => {
    const layout: SceneWidgetLayout = {
      schemaVersion: "1.0.0",
      widgets: [
        widget({
          slots: [
            { key: "main", label: "功率", unit: "kW" },
            { key: "left", label: "进水", unit: "℃" },
          ],
        }),
      ],
    };
    const result = examineLayoutProposal(layout, [
      {
        op: "update-widget",
        id: "w1",
        patch: {
          slots: [
            { key: "main", label: "9 台之和", unit: "kW", aggregate: "sum" },
            { key: "left", label: "进水", unit: "℃" },
          ],
        },
      },
    ]);
    const text = result.diff.join("\n");
    /* 变了的字段要指名道姓 */
    expect(text).toContain("main.label");
    expect(text).toContain("功率 → 9 台之和");
    expect(text).toContain("main.aggregate");
    /* 没变的槽不该出现 */
    expect(text).not.toContain("left.label");
    expect(text).not.toContain("数组(");
  });

  it("新增/删除的槽位单独标出", () => {
    const layout: SceneWidgetLayout = {
      schemaVersion: "1.0.0",
      widgets: [widget({ slots: [{ key: "main", label: "功率" }] })],
    };
    const result = examineLayoutProposal(layout, [
      { op: "update-widget", id: "w1", patch: { slots: [{ key: "series-0", label: "趋势" }] } },
    ]);
    const text = result.diff.join("\n");
    expect(text).toContain("槽位 + series-0");
    expect(text).toContain("槽位 - main");
  });

  it("位置字段用「位置/尺寸」前缀，人一眼能懂", () => {
    const layout: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [widget()] };
    const result = examineLayoutProposal(layout, [
      { op: "update-widget", id: "w1", patch: { y: 30 } },
    ]);
    expect(result.diff.join("\n")).toContain("位置/尺寸 y: 9 → 30");
  });
});
