import { beforeEach, describe, expect, it } from "vitest";
import type { TelemetryRecord } from "@idt/shared-types";
import { readToggleState } from "./ControlBarCardBody";

/**
 * 开关按钮的「当前状态」判定（2026-11-23）。
 *
 * <h2>为什么这块必须单独测</h2>
 *
 * 「现在到底开着还是关着」直接决定按钮发什么命令：
 * 判成「运行中」就显示「停」，判成「停机」就显示「启动」。
 * 判错的后果不是显示难看，是**点一下反而把本来想开的关掉了**。
 *
 * 最容易踩的坑：`sys_run_state` 是 0~9 枚举，
 * 停机是 **1**（非零！）。用 `Boolean(value)` 判断会把停机读成运行中，
 * 按钮一直显示「停」，操作员点下去什么也不会变（因为它本来就没运行）。
 */
describe("readToggleState", () => {
  /*
   * 显式钉住「实时模式」。
   *
   * <p>`loadTelemetrySource()` 读 localStorage，而演示模式下读不到遥测时
   * 会退回 `getDemoRunning()`（默认 true = 运行中）。
   * 不清掉的话，本文件里「未知状态」的用例会随上一个测试留下的
   * localStorage 而飘 —— 单独跑绿、全量跑红。
   */
  beforeEach(() => {
    /* 该测试跑在 node 环境，没有 localStorage —— 有才清。 */
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  const rec = (value: unknown): TelemetryRecord => ({
    deviceId: "gw",
    key: "sys_run_state",
    value: value as never,
    timestamp: Date.now(),
    source: "mock",
  });

  const withState = (value: unknown) => ({ "gw:sys_run_state": rec(value) });

  it("5（运行）→ true", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState(5))).toBe(true);
  });

  it("★ 1（停机）→ false —— 1 是非零，用 truthy 会判反", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState(1))).toBe(false);
  });

  it("8（故障）→ false —— 故障设备不该显示「运行中」，否则会被误当成可停机", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState(8))).toBe(false);
  });

  it("2（启动中）→ true", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState(2))).toBe(true);
  });

  it("4（待机）→ false", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState(4))).toBe(false);
  });

  it("字符串 \"5\" 也认（平台遥测可能是字符串）", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState("5"))).toBe(true);
  });

  it("无法识别的值 → null（未知），不猜", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState("运行"))).toBeNull();
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, withState(null))).toBeNull();
  });

  it("没有遥测 → null（实时模式），不默认成运行中", () => {
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, {})).toBeNull();
  });

  it("别的设备的同名键不会被误读", () => {
    const latest = {
      "other:sys_run_state": { ...rec(5), deviceId: "other" },
    };
    expect(readToggleState({ deviceId: "gw", stateKey: "sys_run_state" }, latest)).toBeNull();
  });

  it("布尔型 stateKey 直接用值", () => {
    const latest = { "gw:power": { ...rec(true), key: "power" } };
    expect(readToggleState({ deviceId: "gw", stateKey: "power" }, latest)).toBe(true);
  });

  it("没配 stateKey → null（实时模式不知道该看哪个键）", () => {
    expect(readToggleState({ deviceId: "gw" }, withState(5))).toBeNull();
  });
});
