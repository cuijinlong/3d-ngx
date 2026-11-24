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
 * 1. 9 个区域齐全，坐标不重叠、不超边界；
 * 2. device-list / bar-compare 这两个新类型能通过 parseSceneWidget；
 * 3. filterText 一路透传到布局 —— 丢了就会把网关和泵一起列进「9 台机组」。
 */
describe("天骄冷热站模板", () => {
  const template = getBuiltinScreenTemplate(TIANJIAO_HEAT_PUMP_TEMPLATE_ID);

  it("能取到内置模板", () => {
    expect(template).toBeDefined();
    expect(template?.name).toBe("天骄冷热站");
  });

  it("区域齐全（9 块：标题 + 左3 + 右3 + 底2）", () => {
    expect(template?.regions).toHaveLength(9);
    const ids = template!.regions.map((r) => r.id);
    expect(ids).toEqual([
      "title",
      "system-power",
      // 2026-11-23 新增：资产属性卡（装机参数，走 asset-attribute 而非设备遥测）
      "plant-capacity",
      "unit-list",
      "selected-unit",
      "unit-summary",
      // 2026-11-23 新增：控制条（发命令，不读点值，所以没有 interfaces）
      "control-bar",
      "power-trend",
      "load-compare",
    ]);
  });

  it("控制条不声明点位接口 —— 否则待绑定清单会要求它「绑测点」", () => {
    const bar = template!.regions.find((r) => r.id === "control-bar");
    expect(bar?.type).toBe("control-bar");
    expect(bar?.interfaces ?? []).toHaveLength(0);
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
    const summary = layout.widgets.find((w) => w.type === "summary-card");
    expect(list?.filterText).toBe("模块机");
    expect(compare?.filterText).toBe("模块机");
    // 汇总也要按同一口径，否则与列表数字矛盾
    expect(summary?.filterText).toBe("模块机");
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
