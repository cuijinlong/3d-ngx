import { describe, expect, it } from "vitest";
import type { CommandDef } from "@idt/shared-types";
import {
  COOLING_SETPOINT_RANGE,
  HEATING_SETPOINT_RANGE,
  OPENING_RANGE,
  clampWire,
  formatRangeValue,
  initialWireValue,
  fromWire,
  inferRangeForCommand,
  matchNumericCommand,
  toWire,
} from "./control-range";

/**
 * 控制量的数字口径（2026-11-23）。
 *
 * <p>客户原话：「如果是控制开度的那么看文档是接收什么数字」。
 *
 * <p>这一组测试锁的核心是：**界面上拖的值 ≠ 发出去的值**。
 * 设定点在手册里是 ×10 存的（40062 收 50~250 表示 5.0~25.0℃），
 * 换算错一位，现场就把「20 度」设成了「200 度」。
 */

const cmd = (id: string, label: string, params?: CommandDef["params"]): CommandDef =>
  ({ id, label, ...(params ? { params } : {}) }) as CommandDef;

describe("协议值 ↔ 显示值换算", () => {
  it("开度是 1:1（设 70 读回 70）", () => {
    expect(toWire(OPENING_RANGE, 70)).toBe(70);
    expect(fromWire(OPENING_RANGE, 70)).toBe(70);
  });

  it("★ 制冷设定点：20.0℃ 必须下发 200（不是 20）", () => {
    /*
     * 手册 40062 收 50~250，按 ÷10 解释。发 20 会被设备当成 2.0℃ ——
     * 现场表现为「设了 20 度，机器显示 2 度」，而接口不会报错。
     */
    expect(toWire(COOLING_SETPOINT_RANGE, 20)).toBe(200);
    expect(fromWire(COOLING_SETPOINT_RANGE, 200)).toBe(20);
  });

  it("★ 制热设定点：45.0℃ 必须下发 450", () => {
    expect(toWire(HEATING_SETPOINT_RANGE, 45)).toBe(450);
    expect(fromWire(HEATING_SETPOINT_RANGE, 450)).toBe(45);
  });

  it("toWire 必须取整（手册那几个点位只收整数）", () => {
    expect(toWire(COOLING_SETPOINT_RANGE, 20.04)).toBe(200);
    expect(toWire(COOLING_SETPOINT_RANGE, 20.06)).toBe(201);
    /* 1:1 的开度也不能发小数 */
    expect(toWire(OPENING_RANGE, 70.6)).toBe(71);
  });

  it("显示格式化带单位与正确小数位", () => {
    expect(formatRangeValue(OPENING_RANGE, 70)).toBe("70 %");
    expect(formatRangeValue(COOLING_SETPOINT_RANGE, 200)).toBe("20.0 ℃");
  });
});

describe("clampWire — 脏值必须夹住", () => {
  it("超出上限夹到上限", () => {
    expect(clampWire(OPENING_RANGE, 999)).toBe(100);
    expect(clampWire(COOLING_SETPOINT_RANGE, 9999)).toBe(250);
  });

  it("低于下限夹到下限", () => {
    /* 开度 0 是合法值（全关），不能被当成"无值"丢弃 */
    expect(clampWire(OPENING_RANGE, -5)).toBe(0);
    expect(clampWire(HEATING_SETPOINT_RANGE, 10)).toBe(150);
  });

  it("非数字退回下限（不是 NaN）", () => {
    /*
     * 设备上报 `"--"` 时 Number() 是 NaN。若不处理，
     * 滑块 value 会变成 NaN，浏览器把它当 0 —— 看起来像"设备被关到了 0"。
     */
    expect(clampWire(OPENING_RANGE, Number("--"))).toBe(0);
    expect(clampWire(COOLING_SETPOINT_RANGE, NaN)).toBe(50);
  });

  it("对齐步长", () => {
    expect(clampWire({ ...OPENING_RANGE, step: 5 }, 63)).toBe(65);
    expect(clampWire({ ...OPENING_RANGE, step: 5 }, 62)).toBe(60);
  });
});

describe("matchNumericCommand — 哪些命令该做成滑块", () => {
  const openingCmd = cmd("setOpening", "设定开度", [{ name: "value", type: "number" }]);
  const runningCmd = cmd("setRunning", "启停", [{ name: "value", type: "boolean" }]);

  it("单 number 参数的命令 → 命中", () => {
    expect(matchNumericCommand([runningCmd, openingCmd])?.id).toBe("setOpening");
  });

  it("★ setRunning(boolean) 不能被当成滑块", () => {
    /*
     * 启停走大圆按钮。若它被 matchNumericCommand 抓走，
     * 界面上会出现「拖动设定运行值」这种荒诞滑块，
     * 而真正的绿/红圆钮反而不见了。
     */
    expect(matchNumericCommand([runningCmd])).toBeNull();
  });

  it("无参命令 → 不命中", () => {
    expect(matchNumericCommand([cmd("start", "远程启动")])).toBeNull();
  });

  it("★ 多个 number 参数 → 不命中（无法判断该拖哪个）", () => {
    const ambiguous = cmd("setRange", "设定", [
      { name: "low", type: "number" },
      { name: "high", type: "number" },
    ]);
    expect(matchNumericCommand([ambiguous])).toBeNull();
  });

  it("空列表 → null（不崩）", () => {
    expect(matchNumericCommand([])).toBeNull();
  });
});

describe("inferRangeForCommand — 该用哪套口径", () => {
  it("制热类命令用制热口径（150~550）", () => {
    const r = inferRangeForCommand(cmd("setHeatingSetpoint", "制热设定点"));
    expect(r.min).toBe(150);
    expect(r.max).toBe(550);
  });

  it("制冷类命令用制冷口径（50~250）", () => {
    const r = inferRangeForCommand(cmd("setCoolingSetpoint", "制冷设定点"));
    expect(r.min).toBe(50);
    expect(r.max).toBe(250);
  });

  it("setOpening 用开度口径（0~100）", () => {
    const r = inferRangeForCommand(cmd("setOpening", "设定开度"));
    expect(r.min).toBe(0);
    expect(r.max).toBe(100);
    expect(r.scale).toBe(1);
  });

  it("★ 拿不准时退回开度口径，而不是温度", () => {
    /*
     * 猜错方向的代价不对称：开度 0~100 是安全区间；
     * 若误判成温度并把 100 当 ℃ 下发到 ×10 协议，会变成 10.0℃ 或更糟。
     */
    const r = inferRangeForCommand(cmd("doSomething", "某种控制"));
    expect(r).toBe(OPENING_RANGE);
  });
});

describe("initialWireValue — 滑块停在哪儿", () => {
  it("★ 读得到当前值 → 用当前值（不是中点）", () => {
    /*
     * 操作员打开抽屉第一件事是看「现在是多少」。
     * 如果滑块永远停在中点，他无法从界面判断设备实际开度。
     */
    expect(initialWireValue(OPENING_RANGE, 65)).toBe(65);
    expect(initialWireValue(COOLING_SETPOINT_RANGE, 200)).toBe(200);
  });

  it("★ 读不到 → 范围中点，不是最小值也不报错", () => {
    /*
     * 停在 0 会被误读成「设备被关到全关」（一种故障态）。
     * 中点是中性位置。
     */
    expect(initialWireValue(OPENING_RANGE, null)).toBe(50);
    expect(initialWireValue(COOLING_SETPOINT_RANGE, undefined)).toBe(150);
  });

  it("脏值（NaN / 非有限数）按「读不到」处理", () => {
    expect(initialWireValue(OPENING_RANGE, NaN)).toBe(50);
    expect(initialWireValue(OPENING_RANGE, Infinity)).toBe(50);
  });

  it("越界值夹回范围（设备可能报 999）", () => {
    expect(initialWireValue(OPENING_RANGE, 999)).toBe(100);
    expect(initialWireValue(OPENING_RANGE, -5)).toBe(0);
  });
});
