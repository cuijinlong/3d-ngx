import { describe, expect, it } from "vitest";
import type { DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import { STATUS_COLOR, STATUS_LABEL, evalStatus } from "./status";

/**
 * 3D 染色状态判定（2026-11-23）。
 *
 * <p>这套判据决定 3D 里每台设备是什么颜色。错了的表现是
 * **「故障的机器和正常的一模一样」** —— 不报错，只能靠人盯着场景发现。
 */

/* `sceneEntityId` 在 DeviceBinding 里是必填 string，所以基座里要显式给一个。 */
const binding = (overrides: Partial<DeviceBinding> = {}): DeviceBinding => ({
  id: "b1",
  sceneEntityId: "node-1",
  deviceId: "dev-1",
  deviceName: "模块机 1#",
  telemetryMappings: [],
  actionMappings: [],
  ...overrides,
});

const latestOf = (rows: Array<[string, unknown]>) =>
  new Map<string, TelemetryRecord>(
    rows.map(([key, value]) => [
      key,
      { deviceId: "dev-1", key: key.split(":")[1]!, value: value as string, timestamp: 1, source: "guard" },
    ]),
  );

describe("evalStatus", () => {
  it("★ 没配 statusMapping 但有 sys_run_state=8 → alarm（故障要红）", () => {
    /*
     * 这是客户报的核心问题：「设备中有一个是故障的，
     * 红色的 GLB 应该有不同颜色的设备状态」。
     *
     * 旧实现第一行就 `if (!statusMapping) return "normal"`，
     * 于是没配状态映射的故障机被染成正常绿。
     */
    const status = evalStatus(binding(), latestOf([["dev-1:sys_run_state", 8]]));
    expect(status).toBe("alarm");
  });

  it("sys_run_state=5 → normal", () => {
    expect(evalStatus(binding(), latestOf([["dev-1:sys_run_state", 5]]))).toBe("normal");
  });

  it("sys_run_state=1（停机）→ offline", () => {
    expect(evalStatus(binding(), latestOf([["dev-1:sys_run_state", 1]]))).toBe("offline");
  });

  it("配了 statusMapping 时仍以其规则为准（原行为不变）", () => {
    const withRules = binding({
      statusMapping: {
        telemetryKey: "temperature",
        rules: [{ operator: "gt", value: 15, state: "warning" }],
      },
    });
    expect(evalStatus(withRules, latestOf([["dev-1:temperature", 18.6]]))).toBe("warning");
  });

  it("statusMapping 命中不了规则时回落 normal", () => {
    const withRules = binding({
      statusMapping: { telemetryKey: "temperature", rules: [{ operator: "gt", value: 15, state: "warning" }] },
    });
    expect(evalStatus(withRules, latestOf([["dev-1:temperature", 7.2]]))).toBe("normal");
  });

  it("statusMapping 指定的键没有值 → offline", () => {
    const withRules = binding({
      statusMapping: { telemetryKey: "temperature", rules: [] },
    });
    expect(evalStatus(withRules, latestOf([]))).toBe("offline");
  });

  /*
   * ★ 客户实测缺陷（2026-11-23）：
   * 「3D 的机组为什么只有一个是绿色，实际运行的不只 1 个」。
   *
   * <p>根因：statusMapping 写的是 sys_run_state，但多数设备只有 running。
   * 旧代码「键没值 → offline」把在跑的机组全染灰。
   */
  describe("statusMapping 的键缺失时回退 running", () => {
    const withSysMapping = binding({
      statusMapping: {
        telemetryKey: "sys_run_state",
        rules: [
          { operator: "eq", value: 5, state: "normal" },
          { operator: "eq", value: 1, state: "offline" },
          { operator: "eq", value: 8, state: "alarm" },
        ],
      },
      telemetryMappings: [
        { field: "运行状态", telemetryKey: "running", label: "运行状态", displayType: "boolean" },
      ],
    });

    it("★ 有 running=true、无 sys_run_state → normal（不能判离线）", () => {
      const status = evalStatus(withSysMapping, latestOf([["dev-1:running", true]]));
      expect(status).toBe("normal");
    });

    it("有 running=false、无 sys_run_state → offline", () => {
      const status = evalStatus(withSysMapping, latestOf([["dev-1:running", false]]));
      expect(status).toBe("offline");
    });

    it("sys_run_state 存在时仍优先按枚举判（不被 running 覆盖）", () => {
      /*
       * 两者同时存在且矛盾时，枚举更权威：running=true 但 state=8（故障）
       * 必须是红色，否则故障机在 3D 里看着像在正常运行。
       */
      const status = evalStatus(
        withSysMapping,
        latestOf([
          ["dev-1:running", true],
          ["dev-1:sys_run_state", 8],
        ]),
      );
      expect(status).toBe("alarm");
    });

    it("两个键都没有 → offline（真的没上报状态）", () => {
      expect(evalStatus(withSysMapping, latestOf([]))).toBe("offline");
    });
  });

  it("既没配置也没上报 → normal（不制造假告警）", () => {
    expect(evalStatus(binding(), latestOf([]))).toBe("normal");
  });

  it("没有 deviceId 的绑定 → normal", () => {
    expect(evalStatus(binding({ deviceId: "" }), latestOf([["dev-1:sys_run_state", 8]]))).toBe("normal");
  });
});

describe("STATUS_COLOR / STATUS_LABEL", () => {
  it("★ alarm 必须是红色系，且与 normal 的绿色明显不同", () => {
    /*
     * 染色用 `STATUS_COLOR[status]`。若 alarm 和 normal 颜色接近，
     * 3D 里根本分不出来。这里钉住「红 ≠ 绿」这个最低要求。
     */
    const parse = (hex: string) => ({
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    });
    const alarm = parse(STATUS_COLOR.alarm);
    const normal = parse(STATUS_COLOR.normal);
    expect(alarm.r).toBeGreaterThan(alarm.g);
    expect(alarm.r).toBeGreaterThan(alarm.b);
    expect(normal.g).toBeGreaterThan(normal.r);
    /* 主色通道差距要够大，否则远看是同一个色 */
    expect(Math.abs(alarm.r - normal.r)).toBeGreaterThan(100);
  });

  it("四态都有中文标签", () => {
    for (const key of ["normal", "warning", "alarm", "offline"] as const) {
      expect(STATUS_LABEL[key]).toBeTruthy();
    }
    expect(STATUS_LABEL.alarm).toBe("告警");
  });
});
