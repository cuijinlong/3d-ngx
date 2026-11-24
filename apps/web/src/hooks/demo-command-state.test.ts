import { beforeEach, describe, expect, it } from "vitest";
import { applyDemoCommand, clearDemoRunning, getDemoRunning, isStartCommand, isStopCommand, setDemoRunning } from "./demo-command-state";

describe("demo command state", () => {
  beforeEach(() => clearDemoRunning());

  it("默认当作运行，便于演示风扇先转起来", () => {
    expect(getDemoRunning("dev-1")).toBe(true);
  });

  it("启动/停止会改写运行状态，不会把 startAll 当成单机指令", () => {
    expect(isStartCommand("start", "启动（演示指令）")).toBe(true);
    expect(isStopCommand("stop", "停止（演示指令）")).toBe(true);
    expect(isStartCommand("startAll", "全部启动")).toBe(false);
    applyDemoCommand("dev-1", "stop", "停止（演示指令）");
    expect(getDemoRunning("dev-1")).toBe(false);
    applyDemoCommand("dev-1", "start", "启动（演示指令）");
    expect(getDemoRunning("dev-1")).toBe(true);
  });
});

/**
 * 双向开关命令（2026-11-23）。
 *
 * 真实协议的系统启停是**一条**命令带参数（setSystemPower + on:true/false，
 * 写 40051），不是 start/stop 两条。旧实现只按 id/标签猜方向，
 * 结果 setSystemPower 返回 null → 演示状态不变 → 按钮点了没反应。
 *
 * 反向的坑同样存在：标签「系统启停」里既有「启」也有「停」，
 * 靠标签猜哪边都是错的 —— 必须由参数决定。
 */
describe("applyDemoCommand / 双向命令", () => {
  it("on=true → 运行", () => {
    clearDemoRunning();
    expect(applyDemoCommand("gw-1", "setSystemPower", "系统启停", { on: true })).toBe(true);
    expect(getDemoRunning("gw-1")).toBe(true);
    clearDemoRunning();
  });

  it("on=false → 停机", () => {
    clearDemoRunning();
    setDemoRunning("gw-1", true);
    expect(applyDemoCommand("gw-1", "setSystemPower", "系统启停", { on: false })).toBe(false);
    expect(getDemoRunning("gw-1")).toBe(false);
    clearDemoRunning();
  });

  it("★ 双向命令没带 on 参数 → 返回 null，不猜方向", () => {
    clearDemoRunning();
    // 标签「系统启停」同时含「启」和「停」，猜哪边都是错的
    expect(applyDemoCommand("gw-1", "setSystemPower", "系统启停")).toBeNull();
    clearDemoRunning();
  });

  it("params.on 优先于 id 里的 start/stop 字样", () => {
    clearDemoRunning();
    // 名字叫 start，但参数说关 —— 参数优先
    expect(applyDemoCommand("d-1", "start", "启动", { on: false })).toBe(false);
    clearDemoRunning();
  });

  it("老的单向命令行为不变（无 params）", () => {
    clearDemoRunning();
    expect(applyDemoCommand("d-1", "start", "远程启动")).toBe(true);
    expect(applyDemoCommand("d-1", "stop", "远程停止")).toBe(false);
    clearDemoRunning();
  });

  it("on 不是布尔时不误判（字符串 \"true\" 不算）", () => {
    clearDemoRunning();
    expect(applyDemoCommand("d-1", "setSystemPower", "系统启停", { on: "true" as unknown as boolean })).toBeNull();
    clearDemoRunning();
  });
});
