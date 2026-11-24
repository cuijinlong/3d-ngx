import { describe, expect, it } from "vitest";
import type { TelemetryRecord } from "@idt/shared-types";
import { classifyDeviceStatus, classifySysRunState } from "./widget-values";

/**
 * sys_run_state 是 0~9 枚举（手册 §17 MODBUS 30001 / 30003+100a）。
 *
 * 这里钉住的是**不能用通用状态解析**这件事：
 * 通用逻辑把 1 当「运行」、5 当未知、8 当未知 —— 三个全错。
 * 这类错误在界面上表现为「明明停机显示运行」，正好是最容易被客户当场抓到的。
 */
describe("classifySysRunState", () => {
  const cases: Array<[number, string, string]> = [
    [0, "unknown", "初始化：还没启动完，不猜"],
    [1, "offline", "停机"],
    [2, "running", "启动中"],
    [3, "offline", "关机中"],
    [4, "offline", "待机"],
    [5, "running", "运行"],
    [6, "running", "水系统"],
    [7, "running", "防冻"],
    [8, "fault", "故障"],
    [9, "unknown", "测试"],
  ];

  for (const [value, expected, note] of cases) {
    it(`${value} → ${expected}（${note}）`, () => {
      expect(classifySysRunState(value)).toBe(expected);
    });
  }

  it("字符串数字也认（网关常按字符串上报）", () => {
    expect(classifySysRunState("5")).toBe("running");
    expect(classifySysRunState("1")).toBe("offline");
    expect(classifySysRunState("8")).toBe("fault");
  });

  it("协议外的值返回 unknown，不猜", () => {
    expect(classifySysRunState(42)).toBe("unknown");
    expect(classifySysRunState("abc")).toBe("unknown");
    expect(classifySysRunState(null)).toBe("unknown");
    expect(classifySysRunState(undefined)).toBe("unknown");
  });

  it("★ 关键反例：1 不能判成运行（通用逻辑会犯这个错）", () => {
    expect(classifySysRunState(1)).not.toBe("running");
  });
});

describe("classifyDeviceStatus / sys_run_state", () => {
  function latest(deviceId: string, key: string, value: unknown): Record<string, TelemetryRecord> {
    return {
      [`${deviceId}:${key}`]: {
        deviceId, key, value: value as number,
        timestamp: Date.now(), source: "guard",
      },
    };
  }

  it("无绑定但已上报 sys_run_state 时仍能判状态（9 台列表要用）", () => {
    expect(classifyDeviceStatus("dev-1", latest("dev-1", "sys_run_state", 5))).toBe("running");
    expect(classifyDeviceStatus("dev-1", latest("dev-1", "sys_run_state", 1))).toBe("offline");
    expect(classifyDeviceStatus("dev-1", latest("dev-1", "sys_run_state", 8))).toBe("fault");
  });

  it("sys_run_state 优先于同时存在的 running 键", () => {
    const rows = {
      ...latest("dev-1", "sys_run_state", 1),
      ...latest("dev-1", "running", true),
    };
    // 停机(1) 必须赢过 running=true 的旧演示字段
    expect(classifyDeviceStatus("dev-1", rows)).toBe("offline");
  });

  it("没有任何数据 → unknown", () => {
    expect(classifyDeviceStatus("dev-x", {})).toBe("unknown");
  });
});
