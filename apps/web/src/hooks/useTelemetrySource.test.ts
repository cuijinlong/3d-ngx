import { describe, expect, it } from "vitest";
import { demoValue } from "./useTelemetrySource";
import { sysRunStateKind } from "../utils/device-plates";
import { clearDemoRunning, setDemoRunning } from "./demo-command-state";

/**
 * 演示值（2026-11-23 修）。
 *
 * 旧实现按中文正则 `状态|running` 猜类型，对 `sys_run_state` 返回**字符串**
 * 「运行」/「停止」。而判定期望 0~9 数字枚举：
 * `sysRunStateKind("运行")` → `Number("运行")` = NaN → unknown。
 * 结果是「开了演示模式，9 台机组运行状态全显示未知」——
 * 比不显示演示数据更糟，因为看起来像设备坏了。
 */

function mapping(telemetryKey: string, displayType: "number" | "boolean" | "text" = "number") {
  return { field: telemetryKey, telemetryKey, label: telemetryKey, displayType };
}

describe("demoValue / sys_run_state", () => {
  it("运行时返回数字 5（不是「运行」字符串）", () => {
    setDemoRunning("dev-running", true);
    const value = demoValue(mapping("sys_run_state"), Date.now(), 0, "dev-running");
    expect(typeof value).toBe("number");
    expect(value).toBe(5);
    clearDemoRunning();
  });

  it("停机时返回数字 1（演示启停能改写它，不能写死为运行）", () => {
    setDemoRunning("dev-stopped", false);
    const value = demoValue(mapping("sys_run_state"), Date.now(), 0, "dev-stopped");
    expect(value).toBe(1);
    clearDemoRunning();
  });

  it("★ 产出的值能被 sysRunStateKind 正确分类（这才是真判据）", () => {
    setDemoRunning("dev-x", false);
    const value = demoValue(mapping("sys_run_state"), Date.now(), 0, "dev-x");
    expect(sysRunStateKind(value)).toBe("offline");
    clearDemoRunning();
    /*
     * 反向钉住旧实现的错误：它产出的是字符串「运行」，
     * 而枚举解析对字符串给 unknown —— 大屏会显示「未知」。
     */
    expect(sysRunStateKind("运行")).toBe("unknown");
  });
});

describe("demoValue / 其他标准 key", () => {
  it("进水温度在合理区间（不能是 24 那种通用兜底）", () => {
    const value = demoValue(mapping("water_in_temp"), Date.now(), 0, "dev-1");
    expect(value as number).toBeGreaterThan(10);
    expect(value as number).toBeLessThan(14);
  });

  it("出水温度低于进水温度（制冷工况）", () => {
    const inTemp = demoValue(mapping("water_in_temp"), Date.now(), 0, "dev-1") as number;
    const outTemp = demoValue(mapping("water_out_temp"), Date.now(), 0, "dev-1") as number;
    expect(outTemp).toBeLessThan(inTemp);
  });

  it("加载率在 0~100 之间（百分比不能给 20 那种通用值）", () => {
    const value = demoValue(mapping("load_rate"), Date.now(), 0, "dev-1") as number;
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });

  it("故障等级在 0~2（协议值域）", () => {
    const value = demoValue(mapping("sys_fault_level"), Date.now(), 0, "dev-1") as number;
    expect([0, 1, 2]).toContain(value);
  });

  it("同一时刻多次调用结果稳定（不抖动到无法读数）", () => {
    const now = 1_700_000_000_000;
    const a = demoValue(mapping("power_total"), now, 7, "dev-1");
    const b = demoValue(mapping("power_total"), now, 7, "dev-1");
    expect(a).toBe(b);
  });

  it("未知键仍走兜底，返回数字而不崩", () => {
    const value = demoValue(mapping("some_custom_key"), Date.now(), 0, "dev-1");
    expect(typeof value).toBe("number");
  });
});
