
import { describe, expect, it } from "vitest";
import type { DeviceBinding, HmiDevice, TelemetryRecord } from "@idt/shared-types";
import { buildDevicePlates, explainRunningState, formatMetricNumber, formatTelemetryText, isTruthyState, bindingRunningState, sysRunStateKind } from "./device-plates";

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
    /*
     * 23.46 → "23.46"，不再四舍五入到 23.5（2026-11-23）。
     *
     * <p>原断言是旧精度规则的规范（一律 toFixed(1)）。用户明确要求
     * 「有四舍五入的问题，你对准了」，所以按真实精度显示。
     */
    expect(formatTelemetryText(23.46, "number", "℃")).toBe("23.46 ℃");
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
    /*
     * 「运行状态」是状态类指标，由铭牌状态徽标表达，不再占数据行
     * （2026-11-24 客户要求：铭牌数据行只放设备文档里的采集指标）。
     */
    expect(plates[0]?.lines.map((l) => l.text)).not.toContain("运行");
    expect(plates[0]?.status).toBe("running");
    expect(plates[0]?.running).toBe(true);
    expect(isTruthyState(true)).toBe(true);
  });

  it("铭牌数据行只显示设备文档里有的指标，文档没有的不占行", () => {
    const latest = new Map<string, TelemetryRecord>([
      [
        "dev-1:temperature",
        { deviceId: "dev-1", key: "temperature", value: 26.2, timestamp: 1, source: "guard" },
      ],
    ]);
    const plates = buildDevicePlates({
      devices: [device],
      bindings: [
        binding({
          sceneEntityId: "1",
          deviceId: "dev-1",
          telemetryMappings: [
            /* 绑定里配了风机状态 / 指示灯，但设备文档只有「温度」—— */
            { field: "spin", telemetryKey: "spin", label: "风机状态", displayType: "number" },
            { field: "led", telemetryKey: "led", label: "指示灯", displayType: "number" },
            { field: "温度", telemetryKey: "temperature", label: "进水温度", unit: "℃", displayType: "number" },
          ],
        }),
      ],
      latest,
    });
    const labels = plates[0]?.lines.map((l) => l.label) ?? [];
    expect(labels).toEqual(["进水温度"]);
    expect(labels).not.toContain("风机状态");
    expect(labels).not.toContain("指示灯");
    expect(plates[0]?.lines[0]?.text).toBe("26.2 ℃");
  });

  it("文档「温度」优先匹配精确的同名映射，而不是前面排着的「进水温度」", () => {
    /*
     * 2026-11-24 实测：9 台模块机上报的是 `temperature`，
     * 而绑定里 `water_in_temp`（进水温度）排在前面。
     * 只按「能不能匹配上」找第一个的话，「温度」永远匹配到进水温度，
     * 而该键一条数据都没有 —— 铭牌就永远「暂无数据」。
     */
    const latest = new Map<string, TelemetryRecord>([
      [
        "dev-1:temperature",
        { deviceId: "dev-1", key: "temperature", value: 7.2, timestamp: 1, source: "guard" },
      ],
    ]);
    const plates = buildDevicePlates({
      devices: [device],
      bindings: [
        binding({
          sceneEntityId: "1",
          deviceId: "dev-1",
          telemetryMappings: [
            { field: "water_in_temp", telemetryKey: "water_in_temp", label: "进水温度", unit: "℃", displayType: "number" },
            { field: "temperature", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
          ],
        }),
      ],
      latest,
    });
    expect(plates[0]?.lines[0]).toEqual({ label: "温度", text: "7.2 ℃", missing: false });
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

/**
 * sys_run_state 是 0~9 枚举（手册 §17 MODBUS 30001）。
 *
 * 这段守的是「3D 风扇不能在停机时转」：
 * bindingRunningState 原来走 isTruthyState，而 1(停机) 和 8(故障) 都是非零
 * —— 会被判成「在运行」。列表显示「停机」而风扇在转，是最扎眼的自相矛盾。
 */
describe("bindingRunningState / sys_run_state", () => {
  const binding: DeviceBinding = {
    id: "b1",
    sceneEntityId: "1",
    deviceId: "dev-1",
    deviceName: "天骄-模块机-1#",
    telemetryMappings: [
      { field: "sys_run_state", telemetryKey: "sys_run_state", label: "运行状态", displayType: "number" },
    ],
    actionMappings: [],
  };

  function latest(value: number): Map<string, TelemetryRecord> {
    return new Map([
      ["dev-1:sys_run_state", {
        deviceId: "dev-1", key: "sys_run_state", value,
        timestamp: Date.now(), source: "guard" as const,
      }],
    ]);
  }

  it("5 运行 → true", () => {
    expect(bindingRunningState(binding, latest(5))).toBe(true);
  });

  it("★ 1 停机 → false（truthy 会误判成 true）", () => {
    expect(bindingRunningState(binding, latest(1))).toBe(false);
  });

  it("★ 8 故障 → false（故障不该让风扇转）", () => {
    expect(bindingRunningState(binding, latest(8))).toBe(false);
  });

  it("2 启动中 → true", () => {
    expect(bindingRunningState(binding, latest(2))).toBe(true);
  });

  it("0 初始化 → null（说不清，不猜）", () => {
    expect(bindingRunningState(binding, latest(0))).toBeNull();
  });

  it("没有数据 → null", () => {
    expect(bindingRunningState(binding, new Map())).toBeNull();
  });
});

describe("sysRunStateKind", () => {
  it("四态映射覆盖手册全部 10 个枚举值", () => {
    const table: Array<[number, string]> = [
      [0, "unknown"], [1, "offline"], [2, "running"], [3, "offline"], [4, "offline"],
      [5, "running"], [6, "running"], [7, "running"], [8, "fault"], [9, "unknown"],
    ];
    for (const [value, expected] of table) {
      expect(sysRunStateKind(value)).toBe(expected);
    }
  });

  it("字符串数字也认", () => {
    expect(sysRunStateKind("5")).toBe("running");
    expect(sysRunStateKind("1")).toBe("offline");
  });
});

/**
 * 遥测数值的精度（2026-11-23）。
 *
 * <p>改之前有三套规则互相打架，大屏上直接能看出来：
 *
 * <pre>
 * 真实值   单设备槽   聚合槽
 * 5.97     6.0        6.0
 * 119.9    119.9      120      ← 按 abs>=100 抹掉小数
 * 20       20         20.0     ← 两处格式不一致
 * </pre>
 *
 * <p>用户的原话是「有四舍五入的问题，你对准了」。所以这里逐条锁住。
 */
describe("formatMetricNumber / 精度对齐", () => {
  it("★ 保留 2 位小数，不再一律 toFixed(1)", () => {
    expect(formatMetricNumber(5.97)).toBe("5.97");
    expect(formatMetricNumber(10.28)).toBe("10.28");
    expect(formatMetricNumber(7.13)).toBe("7.13");
  });

  it("★ 大数值也不抹小数（119.9 不能变 120）", () => {
    expect(formatMetricNumber(119.9)).toBe("119.9");
    expect(formatMetricNumber(120.45)).toBe("120.45");
  });

  it("整数不带 .00（大屏上尾随 0 很脏）", () => {
    expect(formatMetricNumber(20)).toBe("20");
    expect(formatMetricNumber(100)).toBe("100");
    expect(formatMetricNumber(0)).toBe("0");
  });

  it("去掉尾随 0，但保留有效位", () => {
    expect(formatMetricNumber(119.9)).toBe("119.9");   // 不是 119.90
    expect(formatMetricNumber(0.5)).toBe("0.5");       // 不是 0.50
    expect(formatMetricNumber(20.0)).toBe("20");
  });

  it("浮点噪音被截断（toFixed 的作用）", () => {
    expect(formatMetricNumber(7.130000000000001)).toBe("7.13");
    expect(formatMetricNumber(0.1 + 0.2)).toBe("0.3");
  });

  it("极小值不显示成 0（那才是真的精度损失）", () => {
    expect(formatMetricNumber(0.004)).toBe("0.004");
  });

  it("负数正常", () => {
    expect(formatMetricNumber(-5.97)).toBe("-5.97");
    expect(formatMetricNumber(-20)).toBe("-20");
  });

  it("非有限值兜底", () => {
    expect(formatMetricNumber(Number.NaN)).toBe("NaN");
    expect(formatMetricNumber(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("formatTelemetryText / 走同一套精度", () => {
  it("单设备槽不再丢掉第二位小数", () => {
    /* 这条对应「进水 7.13℃ 显示成 7.1℃」。 */
    expect(formatTelemetryText(7.13, undefined, "℃")).toBe("7.13 ℃");
    expect(formatTelemetryText(5.97, undefined, "℃")).toBe("5.97 ℃");
  });

  it("整数与聚合槽格式一致（都是 20，不是 20 对 20.0）", () => {
    expect(formatTelemetryText(20, undefined, "kW")).toBe("20 kW");
  });

  it("布尔仍然显示运行/停止（精度规则不干扰）", () => {
    expect(formatTelemetryText(true, "boolean")).toBe("运行");
    expect(formatTelemetryText(false, "boolean")).toBe("停止");
  });

  it("字符串数字也走同一规则", () => {
    expect(formatTelemetryText("7.13", undefined, "℃")).toBe("7.13 ℃");
  });
});

/**
 * 铭牌四态 + 故障码（2026-11-23）。
 *
 * <p>客户要求「设备的铭牌上也要提示」。关键不是加个徽标，而是
 * **故障停机与正常停机必须能分开** —— 旧模型只有 `running: boolean`，
 * 两者都是 false，现场根本看不出机器是「我让它停的」还是「它坏了」。
 */
describe("铭牌状态：四态与故障码", () => {
  const faultBinding = binding({
    sceneEntityId: "1",
    deviceId: "dev-1",
    telemetryMappings: [
      { field: "温度", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
    ],
  });

  const plateOf = (latest: Map<string, TelemetryRecord>) =>
    buildDevicePlates({ devices: [device], bindings: [faultBinding], latest })[0];

  it("sys_run_state=8 → fault（不是 stopped）", () => {
    const plate = plateOf(new Map([
      ["dev-1:sys_run_state", { deviceId: "dev-1", key: "sys_run_state", value: 8, timestamp: 1, source: "guard" }],
    ]) as Map<string, TelemetryRecord>);
    expect(plate?.status).toBe("fault");
  });

  it("sys_run_state=5 → running", () => {
    const plate = plateOf(new Map([
      ["dev-1:sys_run_state", { deviceId: "dev-1", key: "sys_run_state", value: 5, timestamp: 1, source: "guard" }],
    ]) as Map<string, TelemetryRecord>);
    expect(plate?.status).toBe("running");
  });

  it("sys_run_state=1（停机）→ stopped，与故障区分开", () => {
    const plate = plateOf(new Map([
      ["dev-1:sys_run_state", { deviceId: "dev-1", key: "sys_run_state", value: 1, timestamp: 1, source: "guard" }],
    ]) as Map<string, TelemetryRecord>);
    expect(plate?.status).toBe("stopped");
  });

  it("没有 sys_run_state 时退回 running 布尔", () => {
    /*
     * 关键：`running` 必须**在绑定里配了映射**才会被读到。
     * 铭牌不猜设备上有什么键 —— 那会让一台配错的设备显示成
     * 「正好看起来正常」的状态。
     */
    const withRunning = binding({
      sceneEntityId: "1",
      deviceId: "dev-1",
      telemetryMappings: [
        { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" },
      ],
    });
    const plate = buildDevicePlates({
      devices: [device],
      bindings: [withRunning],
      latest: new Map([
        ["dev-1:running", { deviceId: "dev-1", key: "running", value: true, timestamp: 1, source: "guard" }],
      ]) as Map<string, TelemetryRecord>,
    })[0];
    expect(plate?.status).toBe("running");
  });

  it("★ 完全没有状态数据时是 unknown，不能默认成 running", () => {
    /*
     * 默认成 running 会让从未上报的设备看着健康 ——
     * 值班员据此以为一切正常，而实际是网关根本没通。
     */
    const plate = plateOf(new Map());
    expect(plate?.status).toBe("unknown");
  });

  it("故障码从设备上报读取，不在前端拼", () => {
    const plate = plateOf(new Map([
      ["dev-1:sys_run_state", { deviceId: "dev-1", key: "sys_run_state", value: 8, timestamp: 1, source: "guard" }],
      ["dev-1:fault_code", { deviceId: "dev-1", key: "fault_code", value: "TH702", timestamp: 1, source: "guard" }],
    ]) as Map<string, TelemetryRecord>);
    expect(plate?.status).toBe("fault");
    expect(plate?.faultCode).toBe("TH702");
  });
});

describe("explainRunningState（2026-11-23）", () => {
  const base = {
    id: "b1",
    sceneEntityId: "n1",
    deviceId: "dev-1",
    deviceName: "1#",
    telemetryMappings: [],
    actionMappings: [],
  } as unknown as DeviceBinding;

  it("配了 statusMapping 就用它，并说明是否会回退", () => {
    const explain = explainRunningState({
      ...base,
      statusMapping: { telemetryKey: "sys_run_state", rules: [] },
      telemetryMappings: [
        { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" },
      ],
    });
    expect(explain.source).toBe("status-mapping");
    expect(explain.key).toBe("sys_run_state");
    expect(explain.valueKind).toBe("enum");
    expect(explain.fallsBack).toBe(true);
    expect(explain.text).toContain("8 故障");
  });

  it("没配 statusMapping 时用 label 匹配到的遥测", () => {
    const explain = explainRunningState({
      ...base,
      telemetryMappings: [
        { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" },
      ],
    });
    expect(explain.source).toBe("telemetry-mapping");
    expect(explain.key).toBe("running");
    expect(explain.valueKind).toBe("boolean");
    expect(explain.fallsBack).toBe(false);
  });

  it("什么都没有时明确说「未知」，不猜成运行", () => {
    const explain = explainRunningState({ ...base, telemetryMappings: [] });
    expect(explain.source).toBe("none");
    expect(explain.key).toBeNull();
    expect(explain.text).toContain("未知");
  });

  it("未绑定设备时给出未绑定说明", () => {
    expect(explainRunningState(undefined).source).toBe("none");
  });

  it("★ 「启停」映射不算运行状态（避免把命令当状态）", () => {
    const explain = explainRunningState({
      ...base,
      telemetryMappings: [
        { field: "启停状态", telemetryKey: "onoff", label: "启停状态", displayType: "boolean" },
      ],
    });
    expect(explain.source).toBe("none");
  });
});
