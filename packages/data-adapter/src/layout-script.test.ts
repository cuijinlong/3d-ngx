import { describe, expect, it } from "vitest";
import { createScriptContext, runLayoutScript } from "./layout-script";
import { examineLayoutProposal } from "./layout-proposal";
import type { SceneWidgetLayout } from "./scene-widget-layout";

/**
 * 在线编程的脚本模式（2026-11-23）。
 *
 * <p>这个执行器的存在理由：JSON 提案写不了「按条件批量改」。
 * 但它同时是一个**执行用户代码**的入口，所以每条安全边界都要有断言 ——
 * 不能只靠「在浏览器里点一下看看有没有炸」。
 */

function layout(): SceneWidgetLayout {
  return {
    schemaVersion: "1.0.0",
    widgets: [
      {
        id: "system-power",
        type: "metric-card",
        x: 3, y: 13, w: 11, h: 24,
        title: "系统功率",
        slots: [
          { key: "main", label: "9 台机组之和", unit: "kW", telemetryKey: "power" },
          { key: "left", label: "进水", unit: "℃", telemetryKey: "water_in_temp", deviceId: "gw" },
        ],
      },
      {
        id: "unit-list",
        type: "device-list",
        x: 3, y: 58, w: 11, h: 22,
        slots: [
          { key: "value", label: "温度", render: "bar" },
          { key: "opening", label: "开度", render: "bar" },
        ],
      },
    ],
  };
}

describe("runLayoutScript / 基本执行", () => {
  it("★ 能循环 + 条件，产出多条操作（这正是 JSON 做不到的）", () => {
    const result = runLayoutScript(
      layout(),
      `
      // 所有 bar 槽按 key 分配满量程
      for (const wrapper of ctx.ofType("device-list")) {
        const slots = ctx.slotsOf(wrapper).map((slot) =>
          slot.render === "bar"
            ? { ...slot, barMax: slot.key === "opening" ? 100 : 40 }
            : slot,
        );
        ctx.ops.update(wrapper.id, { slots });
      }
      `,
    );
    expect(result.ok).toBe(true);
    expect(result.operations).toHaveLength(1);
    const patch = result.operations[0];
    expect(patch.op).toBe("update-widget");
    if (patch.op === "update-widget") {
      expect(patch.patch.slots?.find((s) => s.key === "opening")?.barMax).toBe(100);
      expect(patch.patch.slots?.find((s) => s.key === "value")?.barMax).toBe(40);
    }
  });

  it("能按 label 语义补 aggregate（口径不能只写在文字里）", () => {
    const result = runLayoutScript(
      layout(),
      `
      for (const wrapper of ctx.widgets) {
        for (const slot of ctx.slotsOf(wrapper)) {
          if (slot.label && slot.label.includes("之和") && !slot.aggregate) {
            ctx.ops.update(wrapper.id, {
              slots: ctx.slotsOf(wrapper).map((item) =>
                item.key === slot.key ? { ...item, aggregate: "sum" } : item,
              ),
            });
          }
        }
      }
      `,
    );
    expect(result.ok).toBe(true);
    const op = result.operations[0];
    if (op.op === "update-widget") {
      expect(op.patch.slots?.find((s) => s.key === "main")?.aggregate).toBe("sum");
    }
  });

  it("能读 ctx.devices 按设备生成绑定", () => {
    const result = runLayoutScript(
      layout(),
      `
      const gw = ctx.devices.find((d) => d.name && d.name.includes("网关"));
      if (gw) ctx.ops.bind("system-power", "left", "water_in_temp", gw.id);
      `,
      { devices: [{ id: "gw-1", name: "天骄-网关" }] },
    );
    expect(result.ok).toBe(true);
    const op = result.operations[0];
    expect(op.op).toBe("bind-telemetry");
    if (op.op === "bind-telemetry") expect(op.deviceId).toBe("gw-1");
  });

  it("ctx.log 会被收集（面板上要能看见脚本说了什么）", () => {
    const result = runLayoutScript(
      layout(),
      `
      ctx.log("找到", ctx.widgets.length, "张卡");
      ctx.ops.update("system-power", { title: "改过的标题" });
      `,
    );
    expect(result.ok).toBe(true);
    expect(result.logs.join(" ")).toContain("找到 2 张卡");
  });
});

describe("runLayoutScript / 快照隔离", () => {
  it("★ 改 ctx.layout 不影响原布局（脚本只能通过 ops 提交）", () => {
    const original = layout();
    const before = JSON.stringify(original);
    runLayoutScript(
      original,
      `
      // 直接改快照 —— 应该完全无效
      ctx.layout.widgets[0].title = "被脚本改掉了";
      ctx.widgets[0].x = 999;
      ctx.ops.update("system-power", { title: "正经改动" });
      `,
    );
    expect(JSON.stringify(original)).toBe(before);
  });

  it("快照里的 slots 不是原数组的引用", () => {
    const original = layout();
    const { ctx } = createScriptContext(original);
    ctx.slotsOf(ctx.widgets[0]!)[0]!.label = "改坏了";
    expect(original.widgets[0]!.slots![0]!.label).toBe("9 台机组之和");
  });
});

describe("runLayoutScript / 失败要说清原因", () => {
  it("语法错误给出语法错（不是运行时错）", () => {
    const result = runLayoutScript(layout(), "ctx.ops.update(");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("语法错误");
  });

  it("运行时异常带上原始信息", () => {
    const result = runLayoutScript(layout(), `throw new Error("我故意的");`);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("我故意的");
  });

  it("★ 空产出不算成功 —— 否则用户看到「0 行变化」会以为校验器坏了", () => {
    const result = runLayoutScript(layout(), `const x = 1 + 1;`);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("没有产出任何操作");
  });

  it("严格模式：未声明赋值直接报错（避免静默 typo）", () => {
    const result = runLayoutScript(layout(), `undeclaredVariable = 1; ctx.ops.remove("unit-list");`);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("运行出错");
  });
});

describe("脚本产出仍然过同一套校验", () => {
  it("★ 脚本想改 id 会被 protected-field 拦下（脚本不是后门）", () => {
    const base = layout();
    const result = runLayoutScript(
      base,
      `ctx.ops.update("system-power", { id: "换个名字" });`,
    );
    expect(result.ok).toBe(true); // 执行成功
    /* 但校验拒绝 —— 这才是关键。 */
    const proposal = examineLayoutProposal(base, result.operations);
    expect(proposal.ok).toBe(false);
    expect(proposal.issues[0]?.code).toBe("protected-field");
  });

  it("脚本引用不存在的卡片会被 widget-not-found 拦下", () => {
    const base = layout();
    const result = runLayoutScript(base, `ctx.ops.remove("不存在的卡");`);
    const proposal = examineLayoutProposal(base, result.operations);
    expect(proposal.ok).toBe(false);
    expect(proposal.issues[0]?.code).toBe("widget-not-found");
  });

  it("合法的脚本产出能通过校验并算出 next", () => {
    const base = layout();
    const result = runLayoutScript(base, `ctx.ops.update("system-power", { title: "系统总功率" });`);
    const proposal = examineLayoutProposal(base, result.operations);
    expect(proposal.ok).toBe(true);
    expect(proposal.next?.widgets[0]?.title).toBe("系统总功率");
  });
});

/**
 * 脚本能读到「有哪些数据源、哪些测点」（2026-11-23）。
 *
 * <p>这是这次补的核心：之前 `ctx.telemetryKeys` 从来没被填过，
 * 脚本写 `bind-telemetry` 只能靠人肉抄键名 —— 而抄错的键**不报错**，
 * 卡片只是永远显示「暂无数据」。
 */
describe("脚本读数据源", () => {
  const sources = [
    {
      id: "gw",
      name: "网关",
      kind: "device",
      deviceId: "gw-1",
      entityIds: ["gw-1"],
    },
    {
      id: "units",
      name: "9 台机组",
      kind: "scope",
      entityIds: ["d1", "d2"],
    },
  ];
  const dictionary = {
    gw: {
      telemetry: [
        { key: "water_in_temp", label: "进水温度", unit: "℃", onEntities: 1 },
        { key: "water_out_temp", label: "出水温度", unit: "℃", onEntities: 1 },
      ],
      attributes: ["rpcMethods", "deviceCode"],
      alarms: [{ type: "水温过高", level: "alarm", deviceId: "gw-1" }],
    },
    units: {
      telemetry: [{ key: "power", label: "功率", unit: "kW", onEntities: 2 }],
      attributes: [],
      alarms: [],
    },
  };

  it("★ ctx.keysOf 给出该源真实可用的测点（不用猜键名）", () => {
    const result = runLayoutScript(
      layout(),
      `
      const keys = ctx.keysOf("gw");
      ctx.log("网关测点:", keys.join(","));
      ctx.ops.update("system-power", { title: keys.join(",") });
      `,
      { sources, dictionary },
    );
    expect(result.ok).toBe(true);
    expect(result.logs.join(" ")).toContain("water_in_temp,water_out_temp");
  });

  it("ctx.src 能按短名拿到源，拿不到返回 undefined 而不是抛", () => {
    const result = runLayoutScript(
      layout(),
      `
      const found = ctx.src("units");
      const missing = ctx.src("没有这个");
      ctx.log("找到:", found ? found.name : "无", "| 找不到:", missing === undefined ? "undefined" : "有");
      ctx.ops.update("system-power", { title: found.name });
      `,
      { sources, dictionary },
    );
    expect(result.ok).toBe(true);
    expect(result.logs.join(" ")).toContain("9 台机组");
    expect(result.logs.join(" ")).toContain("undefined");
  });

  it("ctx.attributesOf / ctx.alarmsOf 可用", () => {
    const result = runLayoutScript(
      layout(),
      `
      ctx.log("属性:", ctx.attributesOf("gw").join(","));
      ctx.log("告警:", ctx.alarmsOf("gw").length);
      ctx.ops.update("system-power", { title: "x" });
      `,
      { sources, dictionary },
    );
    expect(result.logs.join(" ")).toContain("rpcMethods");
    expect(result.logs.join(" ")).toContain("告警: 1");
  });

  it("按数据源自动生成绑定（这是「按名绑定」的真实用法）", () => {
    const result = runLayoutScript(
      layout(),
      `
      const gw = ctx.src("gw");
      for (const key of ctx.keysOf("gw")) {
        ctx.log("可绑:", key);
      }
      if (gw && gw.deviceId) {
        ctx.ops.bind("system-power", "left", ctx.keysOf("gw")[0], gw.deviceId);
      }
      `,
      { sources, dictionary },
    );
    expect(result.ok).toBe(true);
    const op = result.operations[0];
    expect(op.op).toBe("bind-telemetry");
    if (op.op === "bind-telemetry") {
      expect(op.telemetryKey).toBe("water_in_temp");
      expect(op.deviceId).toBe("gw-1");
    }
  });

  it("没有数据源时 keysOf 返回空数组，不抛", () => {
    const result = runLayoutScript(
      layout(),
      `ctx.log("空:", ctx.keysOf("x").length); ctx.ops.remove("unit-list");`,
    );
    expect(result.ok).toBe(true);
    expect(result.logs.join(" ")).toContain("空: 0");
  });
});
