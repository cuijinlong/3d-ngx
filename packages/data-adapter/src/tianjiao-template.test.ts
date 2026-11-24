import { describe, expect, it } from "vitest";
import {
  TIANJIAO_HEAT_PUMP_TEMPLATE_ID,
  applyScreenTemplate,
  getBuiltinScreenTemplate,
} from "./screen-template";
import { isKnownWidgetType, parseSceneWidgetLayout } from "./scene-widget-layout";

/**
 * 天骄冷热站模板（2026-11-23）。
 *
 * 钉住三件事，任何一条断了都表现为「大屏缺块/数字对不上」而不报错：
 * 1. 7 个区域齐全，坐标不重叠、不超边界；
 * 2. device-list / bar-compare 这两个新类型能通过 parseSceneWidget；
 * 3. filterText 一路透传到布局 —— 丢了就会把网关和泵一起列进「9 台机组」。
 *
 * <p>2026-11-23 改版：客户要求删掉「选中机组」和「系统控制」两块，
 * 并把原本在底部的「功率趋势」「功率对比」上移到右翼。所以现在是
 * **标题 + 左3 + 右3 = 7 块，底部不再放部件**（3D 视野更完整）。
 */
describe("天骄冷热站模板", () => {
  const template = getBuiltinScreenTemplate(TIANJIAO_HEAT_PUMP_TEMPLATE_ID);

  it("能取到内置模板", () => {
    expect(template).toBeDefined();
    expect(template?.name).toBe("天骄冷热站");
  });

  it("区域齐全（7 块：标题 + 左3 + 右3，底部不再放部件）", () => {
    expect(template?.regions).toHaveLength(7);
    const ids = template!.regions.map((r) => r.id);
    expect(ids).toEqual([
      "title",
      /* 2026-11-23：左翼「用电量 / 趋势 / 排名」 */
      "system-power",
      "power-trend",
      "load-compare",
      /* 右翼：碳排放 / 机组状态 / 告警跑马灯 */
      "plant-capacity",
      "unit-list",
      "alarm-ticker",
    ]);
  });

  it("★ 告警跑马灯在右翼最后一位（客户：「移到右侧第3个位置」）", () => {
    const right = template!.regions.filter((r) => r.zone === "right");
    const sorted = [...right].sort((a, b) => a.y - b.y);
    const ticker = sorted[sorted.length - 1]!;
    expect(ticker.id).toBe("alarm-ticker");
    expect(ticker.type).toBe("alarm-ticker");
    /* 它替代了「运行汇总」—— 两块不能同时在，否则右翼会变成 4 块 */
    expect(template!.regions.some((r) => r.id === "unit-summary")).toBe(false);
  });

  it("★ 不再包含「选中机组」与「系统控制」—— 客户 2026-11-23 明确要求去掉", () => {
    /*
     * 这是一条**回归锁**，不是描述现状。
     *
     * <p>这两块被删掉是有代价的：选中机组曾是「点设备看详情」的载体，
     * 系统控制曾是启停入口。哪天有人觉得「这里空着可惜」把它们加回来，
     * 应该先和客户确认，而不是让它悄悄出现在大屏上。
     * 要加回就走 review，把这条断言一起改。
     */
    const ids = template!.regions.map((r) => r.id);
    expect(ids).not.toContain("selected-unit");
    expect(ids).not.toContain("control-bar");
    const types = template!.regions.map((r) => r.type);
    expect(types).not.toContain("selection-card");
    expect(types).not.toContain("control-bar");
  });

  it("底部不再有部件（原先的趋势/对比已上移到右翼）", () => {
    const bottom = template!.regions.filter((r) => r.zone === "bottom");
    expect(bottom).toEqual([]);
  });

  it("同一次点击区域不重叠（新增卡最容易撞上邻居）", () => {
    const regions = template!.regions;
    const collide: string[] = [];
    for (let i = 0; i < regions.length; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) {
        const a = regions[i]!;
        const b = regions[j]!;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          collide.push(`${a.id}×${b.id}`);
        }
      }
    }
    expect(collide).toEqual([]);
  });

  it("左右两翼各三块、同列同宽、纵向不重叠（2026-11-23 第二轮）", () => {
    for (const zone of ["left", "right"] as const) {
      const column = template!.regions.filter((r) => r.zone === zone);
      expect(column).toHaveLength(3);
      const sorted = [...column].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h);
      }
      /* 同列三块必须同宽同 x，否则视觉上会参差 */
      for (const r of sorted) {
        expect(r.x).toBe(sorted[0]!.x);
        expect(r.w).toBe(sorted[0]!.w);
      }
      /*
       * 左翼第三块（设备排名）要高于上面两块：
       * 它是逐台列表，行数多；右翼第三块是告警跑马灯，不需要这个优待。
       */
      if (zone === "left") expect(sorted[2]!.h).toBeGreaterThan(sorted[0]!.h);
    }
  });

  it("★ 侧栏宽度不低于 17%：底部清空后空间全给卡片", () => {
    /*
     * 「部件再大一点」是客户两次提的要求（§10、§13）。这条把尺寸锁住：
     * 17% × 1920 ≈ 326px，低于这个数字就回到「小卡片」那版了。
     *
     * 上限也不能无限：中央 3D 要保留 ≥60%。
     */
    const left = template!.regions.find((r) => r.id === "system-power")!;
    const right = template!.regions.find((r) => r.id === "plant-capacity")!;
    /*
     * 2026-11-23 第三轮：客户要求「宽高再增加 30px」。
     * 17% → 18.6%（326 → 357px）。中央 3D 相应从 61.2% 降到 58%。
     *
     * <p>为什么把 60% 的下限放宽到 55%：60% 是当初「卡片多宽都行」时的
     * 自定约束，而客户三次要求放大卡片。58% 仍过半边、3D 依旧是主体，
     * 但**再往下压就要重新问客户** —— 卡片不能无限吃 3D 的面积。
     */
    expect(left.w).toBeGreaterThanOrEqual(18.5);
    expect(right.w).toBeGreaterThanOrEqual(18.5);
    const centerW = right.x - (left.x + left.w);
    expect(centerW).toBeGreaterThanOrEqual(55);
  });

  it("资产卡声明的是 asset-attribute 来源", () => {
    const capacity = template!.regions.find((r) => r.id === "plant-capacity");
    expect(capacity?.interfaces.some((i) => (i.allowedSources || []).includes("asset-attribute"))).toBe(true);
  });

  it("坐标都在 0~100 画布内且不越界", () => {
    for (const r of template!.regions) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(100);
      expect(r.y + r.h).toBeLessThanOrEqual(100);
    }
  });

  it("中间留给三维视口（左翼右边界 < 右翼左边界）", () => {
    const left = template!.regions.filter((r) => r.zone === "left");
    const right = template!.regions.filter((r) => r.zone === "right");
    const leftMax = Math.max(...left.map((r) => r.x + r.w));
    const rightMin = Math.min(...right.map((r) => r.x));
    expect(leftMax).toBeLessThan(rightMin);
  });

  it("实例化后 device-list / bar-compare 两个新类型都被保留", () => {
    const layout = applyScreenTemplate(null, template!, "天骄科技园");
    const types = layout.widgets.map((w) => w.type);
    expect(types).toContain("device-list");
    expect(types).toContain("bar-compare");
  });

  it("filterText 透传到布局（丢了会把网关/泵算进 9 台）", () => {
    const layout = applyScreenTemplate(null, template!, "天骄科技园");
    const list = layout.widgets.find((w) => w.type === "device-list");
    const compare = layout.widgets.find((w) => w.type === "bar-compare");
    expect(list?.filterText).toBe("模块机");
    expect(compare?.filterText).toBe("模块机");
    /*
     * 2026-11-23：「运行汇总」已被告警跑马灯替代（客户要求），
     * 所以不再有 summary-card 需要比对 filterText。
     * 列表与排名两块的口径仍然必须一致 —— 它们都写「9 台」。
     */
    expect(layout.widgets.some((w) => w.type === "summary-card")).toBe(false);
  });

  it("标题模板支持 {scene} 占位", () => {
    const layout = applyScreenTemplate(null, template!, "天骄科技园");
    const title = layout.widgets.find((w) => w.type === "title");
    expect(title?.title).toContain("天骄科技园");
  });

  it("实例化后模板布局不含实例绑定字段（deviceId 等）", () => {
    const layout = applyScreenTemplate(null, template!, "天骄科技园");
    for (const widget of layout.widgets) {
      for (const slot of widget.slots ?? []) {
        expect(slot.deviceId).toBeUndefined();
        expect(slot.assetId).toBeUndefined();
        expect(slot.telemetryKey).toBeUndefined();
      }
    }
  });
});

/**
 * 服务端写入的实例布局，前端必须能原样解析回来。
 *
 * 这里不 import 真实库里的 JSON（含环境特定 UUID，不能进源码目录），
 * 而是按 68-apply-heat-pump-screen.mjs 实际写出的结构内联一份最小样本。
 * 钉住的是「解析器不会丢掉实例字段」：scope / filterText / slot.telemetryKey /
 * slot.deviceId 任何一项丢了，大屏都会静默变成空白或不显示数字。
 */
describe("实例布局解析（parseSceneWidgetLayout）", () => {
  const serverLayout = {
    schemaVersion: "1.0.0",
    templateId: "tianjiao-heat-pump",
    templateVersion: 1,
    widgets: [
      {
        id: "unit-list", type: "device-list",
        x: 2, y: 25, w: 20.4, h: 33,
        title: "机组状态", filterText: "模块机",
        scope: { kind: "topology", topologyId: "scene-1", topologyName: "天骄科技园" },
        slots: [{ key: "value", label: "出水温度", telemetryKey: "water_out_temp", unit: "℃" }],
      },
      {
        id: "system-power", type: "metric-card",
        x: 2, y: 9, w: 20.4, h: 15,
        title: "系统功率",
        scope: { kind: "topology", topologyId: "scene-1", topologyName: "天骄科技园" },
        slots: [{ key: "main", label: "系统功率", telemetryKey: "power_total", unit: "kW", deviceId: "gw-1" }],
      },
      {
        id: "load-compare", type: "bar-compare",
        x: 51, y: 76, w: 47, h: 21,
        title: "机组加载率对比", filterText: "模块机",
        scope: { kind: "topology", topologyId: "scene-1", topologyName: "天骄科技园" },
        slots: [{ key: "load", label: "加载率", telemetryKey: "load_rate", unit: "%" }],
      },
    ],
  };

  it("保留 templateId / filterText / scope / slot 实例字段", () => {
    const layout = parseSceneWidgetLayout(serverLayout);
    expect(layout.templateId).toBe("tianjiao-heat-pump");
    const list = layout.widgets.find((w) => w.id === "unit-list")!;
    expect(list.type).toBe("device-list");
    expect(list.filterText).toBe("模块机");
    expect(list.scope?.kind).toBe("topology");
    expect(list.scope?.topologyId).toBe("scene-1");
    expect(list.slots?.[0]?.telemetryKey).toBe("water_out_temp");
    expect(list.slots?.[0]?.unit).toBe("℃");
  });

  it("device-list / bar-compare 的 slot 不绑 deviceId（按设备遍历读）", () => {
    const layout = parseSceneWidgetLayout(serverLayout);
    const list = layout.widgets.find((w) => w.id === "unit-list")!;
    const bar = layout.widgets.find((w) => w.id === "load-compare")!;
    expect(list.slots?.[0]?.deviceId).toBeUndefined();
    expect(bar.slots?.[0]?.deviceId).toBeUndefined();
  });

  it("系统级点位绑到网关（deviceId 保留）", () => {
    const layout = parseSceneWidgetLayout(serverLayout);
    const power = layout.widgets.find((w) => w.id === "system-power")!;
    expect(power.slots?.[0]?.deviceId).toBe("gw-1");
  });

  it("新类型在注册表里，不会被当成未知类型", () => {
    expect(isKnownWidgetType("device-list")).toBe(true);
    expect(isKnownWidgetType("bar-compare")).toBe(true);
  });
});
