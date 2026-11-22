import { describe, expect, it } from "vitest";
import type { CommandDef, Device, SceneEntity } from "@idt/shared-types";
import {
  buildDeviceBinding,
  pickDeviceForEntity,
  planNameMatches,
  scoreNameMatch,
  suggestCommandForAction,
} from "./bind-by-name";

function device(name: string, type = "模块机"): Device {
  return {
    id: name,
    name,
    type,
    points: [],
    source: "guard",
    createdAt: "",
    updatedAt: "",
  };
}

function entity(name: string, node = name): SceneEntity {
  return {
    id: node,
    name,
    nodeName: node,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

const chiller1 = device("天骄-模块机-1#·生产园区");
const chiller2 = device("天骄-模块机-2#·生产园区");
const gateway = device("天骄-PLC网关·生产园区", "网关");
const coldPump = device("天骄-冷冻泵-1#·生产园区", "泵");
const coolPump = device("天骄-冷却泵-1#·生产园区", "泵");

describe("scoreNameMatch / pickDeviceForEntity", () => {
  it("把模块机（1#）匹配到同编号模块机，而不是 2# 或网关", () => {
    expect(scoreNameMatch("模块机（1#）", chiller1.name)).toBeGreaterThanOrEqual(80);
    expect(pickDeviceForEntity("模块机（1#）", [chiller1, chiller2, gateway])).toEqual(chiller1);
    expect(pickDeviceForEntity("模块机（2#）", [chiller1, chiller2, gateway])).toEqual(chiller2);
    expect(pickDeviceForEntity("模块机（1#）", [gateway])).toBeUndefined();
  });

  it("控制面板和屏幕沿用同一台设备的名称匹配", () => {
    expect(pickDeviceForEntity("模块机（1#） 控制面板", [chiller1, chiller2, gateway])).toEqual(chiller1);
    expect(pickDeviceForEntity("模块机（1#） 屏幕", [chiller1, chiller2])).toEqual(chiller1);
  });

  it("名称过宽且多台同分时不自动绑定", () => {
    expect(pickDeviceForEntity("泵（1#）", [coldPump, coolPump])).toBeUndefined();
    expect(pickDeviceForEntity("冷冻泵（1#）", [coldPump, coolPump])).toEqual(coldPump);
  });

  it("不按名称匹配平台虚拟设备", () => {
    const virtualOnly = { ...chiller1, deviceVirtual: "virtual" as const };
    expect(pickDeviceForEntity("模块机（1#）", [virtualOnly])).toBeUndefined();
    expect(pickDeviceForEntity("模块机（1#）", [virtualOnly, chiller1])).toEqual(chiller1);
  });
});

describe("suggestCommandForAction", () => {
  const chillerCmds: CommandDef[] = [
    { id: "start", label: "启动" },
    { id: "stop", label: "停止" },
  ];
  const gatewayCmds: CommandDef[] = [
    { id: "startAll", label: "全部启动" },
    { id: "stopAll", label: "全部停止" },
    { id: "start:天骄-模块机-1#·生产园区", label: "启动 模块机 1#" },
    { id: "stop:天骄-模块机-1#·生产园区", label: "停止 模块机 1#" },
    { id: "start:天骄-模块机-2#·生产园区", label: "启动 模块机 2#" },
    { id: "stop:天骄-模块机-2#·生产园区", label: "停止 模块机 2#" },
  ];
  const gatewayPlain: CommandDef[] = [
    { id: "start", label: "启动", params: [{ name: "target", type: "text" }] },
    { id: "stop", label: "停止", params: [{ name: "target", type: "text" }] },
  ];
  const devices = [chiller1, chiller2, gateway];

  it("模块机上的启动/停止映射到 start/stop，不会落到 startAll", () => {
    expect(suggestCommandForAction("start", "启动", chillerCmds)?.command.id).toBe("start");
    expect(suggestCommandForAction("stop", "停止", chillerCmds)?.command.id).toBe("stop");
    expect(
      suggestCommandForAction("start", "启动", gatewayCmds, { entityName: "模块机（1#）", devices })?.command.id,
    ).toBe("start:天骄-模块机-1#·生产园区");
    expect(suggestCommandForAction("start", "启动", [{ id: "startAll", label: "全部启动" }])).toBeUndefined();
  });

  it("网关只有 start/stop 且带 target 参数时，补上匹配到的设备名", () => {
    const suggested = suggestCommandForAction("start", "启动", gatewayPlain, {
      entityName: "模块机（1#） 控制面板",
      boundDevice: gateway,
      devices,
    });
    expect(suggested?.command.id).toBe("start");
    expect(suggested?.params).toEqual({ target: "天骄-模块机-1#·生产园区" });
  });
});

describe("planNameMatches", () => {
  it("为设备和控制面板一起生成匹配计划，并跳过已绑定到其他设备的对象", () => {
    const entities = [
      entity("模块机 1#", "1"),
      entity("模块机 2#", "2"),
    ];
    const { plans, unmatched } = planNameMatches({
      entities,
      devices: [chiller1, chiller2, gateway],
      bindables: [],
    });
    expect(plans.map((p) => [p.entity.id, p.device.id])).toEqual([
      ["1", chiller1.id],
      ["2", chiller2.id],
    ]);
    expect(unmatched).toBe(0);

    const skipped = planNameMatches({
      entities,
      devices: [chiller1, chiller2],
      bindables: [],
      existing: [
        {
          id: "bind-1",
          sceneEntityId: "1",
          deviceId: "other",
          deviceName: "other",
          telemetryMappings: [],
          actionMappings: [],
        },
      ],
    });
    expect(skipped.skippedBound).toBe(1);
    expect(skipped.plans).toHaveLength(1);
  });
});

describe("planNameMatches 手绑规则", () => {
  it("没有位号的泵只按精确名称匹配，不靠型号去猜", () => {
    const pumpA = device("立式管道离心泵", "泵");
    const pumpB = device("立式管道离心泵 2", "泵");
    expect(planNameMatches({
      entities: [entity("立式管道离心泵", "立式管道离心泵")],
      devices: [pumpA, pumpB],
      bindables: [],
    }).plans.map((p) => p.device.id)).toEqual([pumpA.id]);
    expect(planNameMatches({
      entities: [entity("三通", "三通")],
      devices: [device("某处三通A"), device("某处三通B")],
      bindables: [],
    }).plans).toEqual([]);
  });
});

describe("buildDeviceBinding", () => {
  it("只自动建议测点，不按命令表合成启动/停止行为行", () => {
    const binding = buildDeviceBinding({
      createId: () => "bind-1",
      entity: entity("模块机（1#）", "1"),
      device: {
        ...chiller1,
        points: [
          { key: "temperature", label: "温度", unit: "℃", displayType: "number" },
          { key: "running", label: "运行状态", displayType: "text" },
        ],
      },
      signals: [
        { id: "1-temp", entityNode: "1", entityName: "模块机（1#）", entityKind: "device", kind: "telemetry", name: "温度", label: "温度", unit: "℃", valueType: "number" },
        { id: "1-run", entityNode: "1", entityName: "模块机（1#）", entityKind: "device", kind: "state", name: "运行状态", label: "运行状态", valueType: "text" },
        { id: "1-fan", entityNode: "1", entityName: "模块机（1#）", entityKind: "device", kind: "action", name: "spin:fan", label: "风扇转动", clip: "1_spin_fan", valueType: "boolean" },
      ],
      points: [
        { key: "temperature", label: "温度", unit: "℃", displayType: "number" },
        { key: "running", label: "运行状态", displayType: "text" },
      ],
      commands: [
        { id: "start", label: "启动（演示指令）" },
        { id: "stop", label: "停止（演示指令）" },
      ],
      devices: [chiller1],
    });
    expect(binding.actionMappings).toEqual([
      { actionId: "spin:fan", label: "风扇转动", clip: "1_spin_fan" },
    ]);
    expect(binding.telemetryMappings.find((m) => m.field === "温度")?.telemetryKey).toBe("temperature");
    expect(binding.deviceName).toBe(chiller1.name);
  });

  it("prefers the platform label as the saved display name", () => {
    const binding = buildDeviceBinding({
      createId: () => "bind-label",
      entity: entity("模块机（1#）", "1"),
      device: { ...chiller1, label: "模块机 1#" },
      signals: [],
      points: [],
      commands: [],
      devices: [chiller1],
    });
    expect(binding.deviceName).toBe("模块机 1#");
    expect(binding.deviceName).not.toBe(chiller1.name);
  });
});

