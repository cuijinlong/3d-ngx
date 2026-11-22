
import { describe, expect, it } from "vitest";
import type { DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import { isRunning, isVisualDriveAction } from "./DeviceStateAnimator";

const binding: DeviceBinding = {
  id: "b1",
  sceneEntityId: "1",
  deviceId: "dev-1",
  deviceName: "1#",
  telemetryMappings: [
    { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" },
  ],
  actionMappings: [
    { actionId: "spin:fan", label: "风扇转动", clip: "1_spin_fan", telemetryKey: "running", whenValue: true },
    { actionId: "swing:gauge", label: "压力表指针摆动", clip: "pump_swing_gauge", telemetryKey: "pressure", whenValue: true },
  ],
};

describe("isVisualDriveAction", () => {
  it("风扇、指示灯、摆针和柜门是画面效果，启停是指令", () => {
    expect(isVisualDriveAction("spin:fan", "风扇转动")).toBe(true);
    expect(isVisualDriveAction("blink_led", "指示灯")).toBe(true);
    expect(isVisualDriveAction("swing:gauge", "压力表指针摆动")).toBe(true);
    expect(isVisualDriveAction("swing:door", "柜门开合")).toBe(true);
    expect(isVisualDriveAction("flow", "管道流动")).toBe(true);
    expect(isVisualDriveAction("start", "启动")).toBe(false);
    expect(isVisualDriveAction("stop", "停止")).toBe(false);
  });
});

describe("isRunning", () => {
  it("从绑定的运行状态测点读取，没有值时不当作运行", () => {
    expect(isRunning(binding, new Map())).toBe(false);
    const latest = new Map<string, TelemetryRecord>([
      ["dev-1:running", { deviceId: "dev-1", key: "running", value: true, timestamp: 1, source: "guard" }],
    ]);
    expect(isRunning(binding, latest)).toBe(true);
  });
});
