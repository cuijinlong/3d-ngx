
import { describe, expect, it } from "vitest";
import type { DeviceBinding, HmiDevice, TelemetryRecord } from "@idt/shared-types";
import { buildDevicePlates, formatTelemetryText, isTruthyState } from "./device-plates";

function binding(partial: Partial<DeviceBinding> & Pick<DeviceBinding, "sceneEntityId" | "deviceId">): DeviceBinding {
  return {
    id: partial.id ?? "b1",
    sceneEntityId: partial.sceneEntityId,
    deviceId: partial.deviceId,
    deviceName: partial.deviceName ?? "1#模块机",
    telemetryMappings: partial.telemetryMappings ?? [],
    actionMappings: partial.actionMappings ?? [],
    statusMapping: partial.statusMapping,
  };
}

const device: HmiDevice = {
  node: "1",
  name: "模块机",
  tag: "1#",
  actions: [],
  data: [{ name: "温度", val: "25", unit: "℃" }],
  hasNameplateControls: true,
};

describe("formatTelemetryText", () => {
  it("布尔显示运行或停止，数值带单位", () => {
    expect(formatTelemetryText(true, "boolean")).toBe("运行");
    expect(formatTelemetryText(false, "boolean")).toBe("停止");
    expect(formatTelemetryText(23.46, "number", "℃")).toBe("23.5 ℃");
    expect(formatTelemetryText(80, "number", "%")).toBe("80 %");
    expect(formatTelemetryText(undefined, "number", "℃")).toBe("");
  });
});

describe("buildDevicePlates", () => {
  it("未连接只显示名称和未连接，不用 GLB 里的示例值冒充实时数据", () => {
    const plates = buildDevicePlates({ devices: [device], bindings: [], latest: {} });
    expect(plates).toHaveLength(1);
    expect(plates[0]?.title).toBe("模块机 1#");
    expect(plates[0]?.bound).toBe(false);
    expect(plates[0]?.showStartStop).toBe(true);
    expect(plates[0]?.kind).toBe("board");
    expect(plates[0]?.lines.some((l) => l.text === "25 ℃" || l.text === "25")).toBe(false);
    expect(plates[0]?.lines[0]?.text).toBe("未连接");
  });

  it("已连接但没有平台值时显示暂无数据，不写死假数", () => {
    const plates = buildDevicePlates({
      devices: [device],
      bindings: [
        binding({
          sceneEntityId: "1",
          deviceId: "dev-1",
          telemetryMappings: [
            { field: "温度", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
          ],
        }),
      ],
      latest: {},
    });
    expect(plates[0]?.bound).toBe(true);
    expect(plates[0]?.lines[0]).toEqual({ label: "温度", text: "暂无数据", missing: true });
  });

  it("用绑定测点的实时值填充铭牌，名称写成模块机 8#", () => {
    const latest = new Map<string, TelemetryRecord>([
      [
        "dev-1:temperature",
        { deviceId: "dev-1", key: "temperature", value: 26.2, timestamp: 1, source: "guard" },
      ],
      [
        "dev-1:running",
        { deviceId: "dev-1", key: "running", value: true, timestamp: 1, source: "guard" },
      ],
    ]);
    const eight: HmiDevice = { ...device, node: "8", name: "模块机 8", tag: "8#" };
    const plates = buildDevicePlates({
      devices: [eight],
      bindings: [
        binding({
          sceneEntityId: "8",
          deviceId: "dev-1",
          telemetryMappings: [
            { field: "温度", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
            { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" },
          ],
        }),
      ],
      latest,
    });
    expect(plates[0]?.title).toBe("模块机 8#");
    expect(plates[0]?.lines.map((l) => l.text)).toContain("26.2 ℃");
    expect(plates[0]?.lines.map((l) => l.text)).toContain("运行");
    expect(plates[0]?.running).toBe(true);
    expect(isTruthyState(true)).toBe(true);
  });

  it("没有测点和动作的三通不生成铭牌；泵只用已连接/未连接，不出启停", () => {
    const plates = buildDevicePlates({
      devices: [
        device,
        { node: "三通", name: "三通", actions: [], data: [] },
        { node: "立式管道离心泵", name: "立式管道离心泵", actions: [{ id: "swing:gauge", label: "压力表指针摆动" }], data: [] },
      ],
      bindings: [
        binding({ sceneEntityId: "立式管道离心泵", deviceId: "pump-1" }),
      ],
      latest: {},
    });
    expect(plates.map((item) => item.node)).toEqual(["1", "立式管道离心泵"]);
    const pump = plates.find((item) => item.node === "立式管道离心泵");
    expect(pump?.kind).toBe("badge");
    expect(pump?.showStartStop).toBe(false);
    expect(pump?.running).toBeNull();
    expect(pump?.lines).toEqual([{ label: "连接", text: "已连接", missing: false }]);
  });
});
