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

  it("★ 选中设备后 KPI 是**这台设备自己**的维度，不是全场统计", () => {
    /*
     * 2026-11-23 改。客户原话：「下面抽屉出来的统计维度可视化要改成
     * 和业务场景匹配的，现在这个肯定不合理」。
     *
     * <p>改动前：点 1# 机组，抽屉显示「运行设备 1 / 设备总数 3 /
     * 系统告警 — / 总消耗量 10.6 kW」—— 前三项都是**全场**的口径。
     *
     * <p>改动后：状态 + 该设备自己的遥测 + 它在同组里的功率排名。
     */
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

    /* 状态格：只看选中的这台（dev-1 在运行），不是全场台数 */
    expect(model.kpis.find((item) => item.id === "status")?.value).toBe("运行");
    /* 该设备自己的功率 */
    expect(model.kpis.find((item) => item.id === "metric-功率")?.value).toBe("8.6 kW");
    /* 功率排名：8.6 高于 2，所以第 1 / 2 */
    expect(model.kpis.find((item) => item.id === "rank")?.value).toBe("第 1 / 2");

    /* 旧的全场维度不再出现在选中态下 */
    expect(model.kpis.some((item) => item.id === "total")).toBe(false);
    expect(model.kpis.some((item) => item.id === "consumption")).toBe(false);

    /*
     * 2026-11-23 改：运行/停止**不再走 chips**，而是单一的 `status`。
     *
     * <p>客户原话：「启停按钮下面运行状态就是属于那个状态那个亮就行了」。
     * 原来 chips 会同时给出「运行 1」「停止 0」两枚，两个都亮，读不出当前状态。
     *
     * <p>所以这里的断言从「chips 里有 running」改成两条：
     * ① `status` 给出唯一答案；② chips 里不再有这对键（否则界面会重复显示）。
     */
    expect(model.status.kind).toBe("running");
    expect(model.status.label).toBe("运行");
    expect(model.chips.some((chip) => chip.id === "running")).toBe(false);
    expect(model.chips.some((chip) => chip.id === "stopped")).toBe(false);
    expect(model.dataSummary).not.toContain("99");
  });

  it("★ 选中故障设备时，状态格带故障码", () => {
    const bindings = [binding("m1", "dev-1")];
    const latest = new Map<string, TelemetryRecord>([
      /* 8 = 故障（手册 30001 枚举） */
      ["dev-1:sys_run_state", { deviceId: "dev-1", key: "sys_run_state", value: 8, timestamp: 1, source: "mock" }],
      ["dev-1:fault_code", { deviceId: "dev-1", key: "fault_code", value: "TH702", timestamp: 1, source: "mock" }],
    ]);
    const plates = buildDevicePlates({ devices: hmi.devices, bindings, latest });
    const model = buildControlDrawerModel({ hmi, selectedNode: "m1", plates, bindings, latest });
    expect(model.kpis.find((item) => item.id === "status")?.value).toBe("故障 TH702");
  });
});

describe("buildControlDrawerModel · 单一运行状态（2026-11-23）", () => {
  /*
   * 构造 latest 表。键名写成 `dev-1:running`，拆出来填 deviceId / key。
   * `split(":")` 的结果在类型上是 `string | undefined`，这里显式收窄，
   * 避免为了测试方便而放宽 `TelemetryRecord` 的类型。
   */
  const latestOf = (rows: Array<[string, string | number | boolean]>) => {
    const map = new Map<string, TelemetryRecord>();
    for (const [id, value] of rows) {
      const at = id.indexOf(":");
      const deviceId = id.slice(0, at);
      const field = id.slice(at + 1);
      map.set(id, { deviceId, key: field, value, timestamp: 1, source: "mock" });
    }
    return map;
  };

  it("★ 停机的设备：status 是 stopped，且 chips 里没有运行/停止", () => {
    const bindings = [binding("m1", "dev-1", false)];
    const latest = latestOf([["dev-1:running", false]]);
    const plates = buildDevicePlates({ devices: hmi.devices, bindings, latest });
    const model = buildControlDrawerModel({ hmi, selectedNode: "m1", plates, bindings, latest });
    expect(model.status.kind).toBe("stopped");
    expect(model.status.label).toBe("停机");
    expect(model.chips.some((chip) => chip.id === "running" || chip.id === "stopped")).toBe(false);
  });

  it("★ 未绑定遥测的设备：status 是 unknown，不是 running（不能猜成在跑）", () => {
    const bindings = [binding("m1", "dev-1")];
    const model = buildControlDrawerModel({ hmi, selectedNode: "m1", bindings, latest: {} });
    expect(model.status.kind).toBe("unknown");
    expect(model.status.label).toBe("未知");
  });

  it("★ 故障设备：status 带故障码（供抽屉显示 TH702）", () => {
    const bindings = [binding("m1", "dev-1")];
    const latest = latestOf([
      ["dev-1:sys_run_state", 8],
      ["dev-1:fault_code", "TH702"],
    ]);
    const plates = buildDevicePlates({ devices: hmi.devices, bindings, latest });
    const model = buildControlDrawerModel({ hmi, selectedNode: "m1", plates, bindings, latest });
    expect(model.status.kind).toBe("fault");
    expect(model.status.faultCode).toBe("TH702");
  });
});
