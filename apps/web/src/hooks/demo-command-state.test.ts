import { beforeEach, describe, expect, it } from "vitest";
import { applyDemoCommand, clearDemoRunning, getDemoRunning, isStartCommand, isStopCommand } from "./demo-command-state";

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
