import { describe, expect, it } from "vitest";
import type { DeviceBinding, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import { buildControlDrawerModel, DRAWER_COPY, drawerControlContent } from "./control-drawer";
import { buildDevicePlates } from "./device-plates";

const hmi = {
  schema: "hmi-scene/1",
  devices: [
    { node: "m1", name: "模块机", tag: "1#", actions: [], data: [{ name: "功率", unit: "kW", val: "99" }], hasNameplateControls: true },
    { node: "m2", name: "模块机", tag: "2#", actions: [], data: [{ name: "功率", unit: "kW", val: "99" }], hasNameplateControls: true },
    { node: "pump", name: "泵", actions: [{ id: "swing:gauge", label: "摆针" }], data: [] },
  ],
  valves: [],
  instruments: [],
  pipes: [],
  fittings: [],
  bindables: [],
  rules: [],
} as unknown as ParsedHmiScene;

function binding(node: string, deviceId: string, running?: boolean): DeviceBinding {
  const telemetryMappings = [
    { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" as const },
    { field: "功率", telemetryKey: "power", label: "功率", unit: "kW", displayType: "number" as const },
  ];
  return {
    id: `b-${node}`,
    sceneEntityId: node,
    deviceId,
    deviceName: deviceId,
    telemetryMappings,
    actionMappings: [],
    statusMapping: running === undefined ? undefined : { telemetryKey: "running", rules: [] },
  };
}

describe("buildControlDrawerModel", () => {
  it("uses parsed device count and does not hardcode 32 or a fixed chip set", () => {
    const model = buildControlDrawerModel({ hmi, selectedNode: null, bindings: [], latest: {} });
    expect(model.title).toBe(DRAWER_COPY.unselected);
    expect(model.mode).toBe("unselected");
    expect(model.providesStartStop).toBe(false);
    expect(model.dataSummary).toBe(DRAWER_COPY.unbound);
    expect(model.kpis.find((item) => item.id === "total")?.value).toBe("3");
    expect(model.kpis.find((item) => item.id === "total")?.value).not.toBe("32");
    expect(model.chips).toEqual([]);
    expect(JSON.stringify(model)).not.toContain("32");
    expect(drawerControlContent(model.mode)).toBe("none");
  });

  it("does not present start/stop buttons when nothing is selected", () => {
    expect(drawerControlContent("unselected")).toBe("none");
    expect(drawerControlContent("start-stop")).toBe("start-stop");
    expect(drawerControlContent("no-start-stop")).toBe("no-start-stop");
  });

  it("offers start/stop only when the selected object has a panel and a screen", () => {
    const withStart = buildControlDrawerModel({ hmi, selectedNode: "m1", bindings: [], latest: {} });
    expect(withStart.mode).toBe("start-stop");
    expect(withStart.providesStartStop).toBe(true);
    expect(withStart.startStopNote).toBeUndefined();
    expect(withStart.title).toBe("模块机 1#");

    const pump = buildControlDrawerModel({ hmi, selectedNode: "pump", bindings: [], latest: {} });
    expect(pump.mode).toBe("no-start-stop");
    expect(pump.providesStartStop).toBe(false);
    expect(pump.startStopNote).toBe(DRAWER_COPY.noStartStop);
  });

  it("derives running chips and consumption from bindings, not sample GLB values", () => {
    const bindings = [binding("m1", "dev-1", true), binding("m2", "dev-2", false)];
    const latest = new Map<string, TelemetryRecord>([
      ["dev-1:running", { deviceId: "dev-1", key: "running", value: true, timestamp: 1, source: "mock" }],
      ["dev-1:power", { deviceId: "dev-1", key: "power", value: 8.6, timestamp: 1, source: "mock" }],
      ["dev-2:running", { deviceId: "dev-2", key: "running", value: false, timestamp: 1, source: "mock" }],
      ["dev-2:power", { deviceId: "dev-2", key: "power", value: 2, timestamp: 1, source: "mock" }],
    ]);
    const plates = buildDevicePlates({ devices: hmi.devices, bindings, latest });
    const model = buildControlDrawerModel({ hmi, selectedNode: "m1", plates, bindings, latest });
    expect(model.bound).toBe(true);
    expect(model.kpis.find((item) => item.id === "running")?.value).toBe("1");
    expect(model.kpis.find((item) => item.id === "consumption")?.value).toBe("10.6 kW");
    expect(model.dataSummary).not.toContain("99");
    expect(model.chips.some((chip) => chip.id === "running" && chip.active)).toBe(true);
    expect(model.chips.some((chip) => chip.id === "stopped" && chip.active)).toBe(true);
  });
});
