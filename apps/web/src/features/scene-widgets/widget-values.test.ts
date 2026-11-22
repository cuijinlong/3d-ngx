
import { describe, expect, it } from "vitest";
import type { Device, DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import { readSlotValue, summarizeSceneBindings, selectionBindings, widgetBindableDevices, resolveWidgetBindingSlots, canDisplayWidgetDeviceReading } from "./widget-values";

function binding(partial: Partial<DeviceBinding> = {}): DeviceBinding {
  return {
    id: "b1",
    sceneEntityId: "fan-1",
    deviceId: "dev-1",
    deviceName: "模块机 9#",
    telemetryMappings: [
      { field: "temp", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
    ],
    actionMappings: [],
    ...partial,
  };
}

describe("widget-values", () => {
  it("does not invent a value when the slot is unbound or has no latest reading", () => {
    const unbound = readSlotValue({ key: "temperature" }, [], {});
    expect(unbound.bound).toBe(false);
    expect(unbound.missing).toBe(true);
    expect(unbound.text).toBe("");

    const waiting = readSlotValue(
      { key: "temperature", sceneEntityId: "fan-1", telemetryKey: "temperature" },
      [binding()],
      {},
    );
    expect(waiting.bound).toBe(true);
    expect(waiting.missing).toBe(true);
    expect(waiting.text).toBe("");
  });

  it("reads a bound slot from live telemetry and summarizes only existing bindings", () => {
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
    };
    const reading = readSlotValue(
      { key: "temperature", sceneEntityId: "fan-1", telemetryKey: "temperature" },
      [binding()],
      latest,
    );
    expect(reading.missing).toBe(false);
    expect(reading.text).toContain("18.4");
    expect(reading.text).not.toContain("℃");
    expect(reading.unit).toBe("℃");

    const summary = summarizeSceneBindings([binding(), binding({ id: "b2", sceneEntityId: "fan-2", deviceId: "" })], latest);
    expect(summary.boundCount).toBe(1);
    expect(summary.withDataCount).toBe(1);
  });

  it("keeps the selection card empty until an object is selected", () => {
    expect(selectionBindings(null, [binding()])).toEqual([]);
    expect(selectionBindings("fan-1", [binding()]).map((item) => item.deviceId)).toEqual(["dev-1"]);
  });

  it("reads a slot bound only by deviceId and excludes platform virtual devices from bindable options", () => {
    const latest: Record<string, TelemetryRecord> = {
      "dev-9:power": {
        deviceId: "dev-9",
        key: "power",
        value: 120,
        unit: "kW",
        timestamp: 1,
        source: "guard",
      },
    };
    const reading = readSlotValue({ key: "power", deviceId: "dev-9", telemetryKey: "power", label: "功率" }, [], latest);
    expect(reading.bound).toBe(true);
    expect(reading.missing).toBe(false);
    expect(reading.text).toContain("120");

    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const virtual: Device = {
      ...realtime,
      id: "dev-v",
      name: "虚拟点位",
      deviceVirtual: "virtual",
    };
    const options = widgetBindableDevices({
      bindings: [
        binding({ deviceId: "dev-v", deviceName: "虚拟点位", sceneEntityId: "fan-v" }),
        binding(),
      ],
      devices: [realtime, virtual],
    });
    expect(options.map((item) => item.deviceId)).toEqual(["dev-1"]);
    expect(options[0]?.keys.some((item) => item.telemetryKey === "temperature")).toBe(true);
  });

  it("does not offer or write a virtual deviceId that only remains on a stale object binding", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const staleVirtual = binding({
      id: "b-v",
      deviceId: "dev-v",
      deviceName: "虚拟点位",
      sceneEntityId: "fan-v",
    });
    const options = widgetBindableDevices({
      bindings: [staleVirtual, binding()],
      devices: [realtime],
    });
    expect(options.map((item) => item.deviceId)).toEqual(["dev-1"]);
    expect(options.some((item) => item.deviceId === "dev-v")).toBe(false);

    expect(resolveWidgetBindingSlots("dev-v", "temperature", options, [realtime])).toEqual([]);

    const forged = [{
      deviceId: "dev-v",
      deviceName: "虚拟点位",
      sceneEntityId: "fan-v",
      keys: [{ telemetryKey: "temperature", label: "温度", unit: "℃" }],
    }];
    expect(resolveWidgetBindingSlots("dev-v", "temperature", forged, [realtime])).toEqual([]);
    expect(resolveWidgetBindingSlots("dev-1", "temperature", options, [realtime])[0]?.deviceId).toBe("dev-1");
  });

  it("does not display a value or trend for a stale virtual deviceId even when the feed still has data", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const latest: Record<string, TelemetryRecord> = {
      "dev-v:temperature": {
        deviceId: "dev-v",
        key: "temperature",
        value: 36,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
    };
    const staleSlot = { key: "temperature", deviceId: "dev-v", telemetryKey: "temperature", label: "温度" };
    const hidden = readSlotValue(staleSlot, [], latest, [realtime]);
    expect(hidden.text).toBe("");
    expect(hidden.bound).toBe(false);
    expect(hidden.missing).toBe(true);

    const beforeList = readSlotValue(staleSlot, [], latest, []);
    expect(beforeList.bound).toBe(true);
    expect(beforeList.text).toContain("36");
    expect(canDisplayWidgetDeviceReading("dev-v", [])).toBe(true);
    expect(canDisplayWidgetDeviceReading("dev-v", [realtime])).toBe(false);
    expect(readSlotValue({ key: "temperature", deviceId: "dev-1", telemetryKey: "temperature" }, [], latest, [realtime]).text).toContain("18.4");
  });

  it("excludes virtual or unknown devices from the summary and selection cards once the realtime list is ready", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        timestamp: 1,
        source: "guard",
      },
      "dev-v:temperature": {
        deviceId: "dev-v",
        key: "temperature",
        value: 36,
        timestamp: 1,
        source: "guard",
      },
    };
    const rows = [
      binding(),
      binding({ id: "b-v", deviceId: "dev-v", deviceName: "虚拟点位", sceneEntityId: "fan-v" }),
    ];
    const beforeList = summarizeSceneBindings(rows, latest);
    expect(beforeList.boundCount).toBe(2);
    expect(beforeList.withDataCount).toBe(2);

    const ready = summarizeSceneBindings(rows, latest, [realtime]);
    expect(ready.boundCount).toBe(1);
    expect(ready.withDataCount).toBe(1);

    expect(selectionBindings("fan-v", rows).map((item) => item.deviceId)).toEqual(["dev-v"]);
    expect(selectionBindings("fan-v", rows, [realtime])).toEqual([]);
    expect(selectionBindings("fan-1", rows, [realtime]).map((item) => item.deviceId)).toEqual(["dev-1"]);
  });
});
