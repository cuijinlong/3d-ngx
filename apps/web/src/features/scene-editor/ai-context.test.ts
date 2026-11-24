import { describe, expect, it } from "vitest";
import type { DeviceBinding, SceneDocument } from "@idt/shared-types";
import type { SceneWidgetLayout } from "@idt/data-adapter";
import { buildAiSceneContext, collectDevices, collectTelemetryKeys } from "./ai-context";

/*
 * AI 上下文构造（2026-11-24）。
 *
 * <p>钉住的是「AI 能不能真的绑上数据」—— 这一层少一项，
 * 它就只能猜，而猜错的产物看起来像「AI 不好用」。
 */

function binding(over: Partial<DeviceBinding> & { id: string }): DeviceBinding {
  return {
    sceneEntityId: `node-${over.id}`,
    deviceName: `设备 ${over.id}`,
    telemetryMappings: [],
    actionMappings: [],
    ...over,
  } as DeviceBinding;
}

describe("collectTelemetryKeys", () => {
  it("★ 从已有绑定收集遥测键（那是唯一能确认「键真实存在」的来源）", () => {
    const keys = collectTelemetryKeys([
      binding({
        id: "b1",
        deviceId: "d1",
        telemetryMappings: [{ field: "power", telemetryKey: "power", label: "功率", unit: "kW", displayType: "number" }],
      }),
    ]);
    expect(keys).toEqual([{ key: "power", label: "功率", unit: "kW", deviceCount: 1 }]);
  });

  it("★ 同一键出现在多台设备上只留一条，并记录出现次数", () => {
    const mk = (id: string) =>
      binding({
        id,
        deviceId: `dev-${id}`,
        telemetryMappings: [{ field: "power", telemetryKey: "power", label: "功率", displayType: "number" }],
      });
    const keys = collectTelemetryKeys([mk("a"), mk("b"), mk("c")]);
    expect(keys).toHaveLength(1);
    /* 出现次数告诉 AI「这是通用点位，还是某台特有」 */
    expect(keys[0]?.deviceCount).toBe(3);
  });

  it("★ 通用键排在前面（AI 优先挑影响面大的）", () => {
    const keys = collectTelemetryKeys([
      binding({
        id: "x",
        deviceId: "d1",
        telemetryMappings: [{ field: "temp", telemetryKey: "temp_only", label: "温度", displayType: "number" }],
      }),
      binding({
        id: "y",
        deviceId: "d2",
        telemetryMappings: [{ field: "p", telemetryKey: "power", label: "功率", displayType: "number" }],
      }),
      binding({
        id: "z",
        deviceId: "d3",
        telemetryMappings: [{ field: "p", telemetryKey: "power", label: "功率", displayType: "number" }],
      }),
    ]);
    expect(keys[0]?.key).toBe("power");
  });

  it("空键 / 空绑定 / undefined 都不产生垃圾条目", () => {
    expect(collectTelemetryKeys(undefined)).toEqual([]);
    expect(collectTelemetryKeys([])).toEqual([]);
    expect(
      collectTelemetryKeys([
        binding({
          id: "b",
          deviceId: "d",
          telemetryMappings: [
            { field: "a", telemetryKey: "   ", label: "空", displayType: "number" },
            { field: "b", telemetryKey: "", label: "空", displayType: "number" },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("数量上限存在（prompt 有成本）", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      binding({
        id: `b${i}`,
        deviceId: `d${i}`,
        telemetryMappings: [{ field: `f${i}`, telemetryKey: `key_${i}`, label: `点位${i}`, displayType: "number" }],
      }),
    );
    expect(collectTelemetryKeys(many).length).toBeLessThanOrEqual(60);
  });
});

describe("collectDevices", () => {
  it("同一台设备绑在多个 3D 对象上只留一条", () => {
    const devices = collectDevices([
      binding({ id: "b1", deviceId: "dev-1", deviceName: "模块机 1#" }),
      binding({ id: "b2", deviceId: "dev-1", deviceName: "模块机 1#" }),
      binding({ id: "b3", deviceId: "dev-2", deviceName: "模块机 2#" }),
    ]);
    expect(devices).toEqual([
      { id: "dev-1", name: "模块机 1#" },
      { id: "dev-2", name: "模块机 2#" },
    ]);
  });

  it("资产绑定没有 deviceId 时跳过（bind-telemetry 的 deviceId 只能是设备）", () => {
    const devices = collectDevices([binding({ id: "b1", deviceName: "某个资产" })]);
    expect(devices).toEqual([]);
  });
});

describe("buildAiSceneContext", () => {
  it("★ 卡片必须带 slots —— 没有 slotKey，AI 写 bind-telemetry 必然被拒", () => {
    const layout = {
      schemaVersion: 1,
      widgets: [
        {
          id: "power-trend",
          type: "trend-chart",
          title: "机组功率趋势",
          x: 1, y: 1, w: 20, h: 20,
          slots: [
            { key: "main", label: "功率", unit: "kW", telemetryKey: "power" },
            { key: "limit", label: "上限" },
          ],
        },
      ],
    } as unknown as SceneWidgetLayout;

    const ctx = buildAiSceneContext({ layout });
    expect(ctx.widgetList[0]?.slots?.map((s) => s.key)).toEqual(["main", "limit"]);
    /* 已绑的键要带上 —— AI 据此知道「这格在刷数，改动等于换数据源」 */
    expect(ctx.widgetList[0]?.slots?.[0]?.telemetryKey).toBe("power");
  });

  it("没有槽位的卡片不塞空数组（省 prompt 且不误导）", () => {
    const layout = {
      schemaVersion: 1,
      widgets: [{ id: "title-main", type: "title", title: "总览", x: 0, y: 0, w: 100, h: 6 }],
    } as unknown as SceneWidgetLayout;
    const ctx = buildAiSceneContext({ layout });
    expect(ctx.widgetList[0]).not.toHaveProperty("slots");
  });

  it("新场景（0 绑定）如实给出空遥测键 —— 不发明数据", () => {
    const doc = { scene: { name: "新场景" }, bindings: [], platform: {} } as unknown as SceneDocument;
    const ctx = buildAiSceneContext({ document: doc });
    expect(ctx.bindings).toBe(0);
    expect(ctx.telemetryKeys).toEqual([]);
    expect(ctx.devices).toEqual([]);
  });

  it("layout 为 null 时不崩（场景还没布局）", () => {
    expect(buildAiSceneContext({ layout: null }).widgetList).toEqual([]);
  });

  it("场景名 / 场站 / 拓扑照常带上", () => {
    const doc = {
      scene: { name: "天骄科技园" },
      bindings: [],
      platform: { siteName: "生产园区", topologyName: "天骄科技园 拓扑" },
    } as unknown as SceneDocument;
    const ctx = buildAiSceneContext({ document: doc });
    expect(ctx.name).toBe("天骄科技园");
    expect(ctx.site).toBe("生产园区");
    expect(ctx.topology).toBe("天骄科技园 拓扑");
  });
});
