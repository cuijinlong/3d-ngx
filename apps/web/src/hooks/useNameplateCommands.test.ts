import { describe, expect, it } from "vitest";
import { resolveNameplateSide } from "./useNameplateCommands";

/*
 * 启停互斥（2026-11-23）。
 *
 * <p>客户原话：「3D设备点击下面的启停按钮要互斥不能同时可点」。
 *
 * <p>改动前 `start` / `stop` 各自只判断「设备上有没有这条命令」，
 * 运行中的机组「启动」照样可点 —— 点下去要么被网关拒绝（界面看不出），
 * 要么真的重启机组。下面这张表就是新的判据表，逐行钉死。
 *
 * <p>依赖 `resolveNameplateSide` 是纯函数，所以这里不需要 React 环境。
 */
const okMatch = { ok: true as const, command: { id: "setRunning", label: "启停" } };
const missing = { ok: false as const, reason: "no-match" as const };

describe("启停按钮互斥", () => {
  it("★ 运行中：启动禁用、停止可点", () => {
    const start = resolveNameplateSide(okMatch, false, "start", "running");
    const stop = resolveNameplateSide(okMatch, false, "stop", "running");
    expect(start.enabled).toBe(false);
    expect(start.reason).toContain("已在运行");
    expect(stop.enabled).toBe(true);
  });

  it("★ 停机：启动可点、停止禁用", () => {
    const start = resolveNameplateSide(okMatch, false, "start", "stopped");
    const stop = resolveNameplateSide(okMatch, false, "stop", "stopped");
    expect(start.enabled).toBe(true);
    expect(stop.enabled).toBe(false);
    expect(stop.reason).toContain("未运行");
  });

  it("★ 故障：启动仍可点（现场靠重启尝试恢复），停止禁用", () => {
    expect(resolveNameplateSide(okMatch, false, "start", "fault").enabled).toBe(true);
    expect(resolveNameplateSide(okMatch, false, "stop", "fault").enabled).toBe(false);
  });

  it("★ 未知状态：两侧都放开 —— 状态不明时不替用户做决定", () => {
    expect(resolveNameplateSide(okMatch, false, "start", "unknown").enabled).toBe(true);
    expect(resolveNameplateSide(okMatch, false, "stop", "unknown").enabled).toBe(true);
  });

  it("离线：按未运行处理，停止禁用", () => {
    expect(resolveNameplateSide(okMatch, false, "start", "offline").enabled).toBe(true);
    expect(resolveNameplateSide(okMatch, false, "stop", "offline").enabled).toBe(false);
  });

  it("互斥优先于状态：命令不存在时两侧都禁用", () => {
    expect(resolveNameplateSide(missing, false, "start", "stopped").enabled).toBe(false);
    expect(resolveNameplateSide(missing, false, "stop", "running").enabled).toBe(false);
  });

  it("下发中：两侧都禁用，防止连点", () => {
    expect(resolveNameplateSide(okMatch, true, "start", "stopped").enabled).toBe(false);
    expect(resolveNameplateSide(okMatch, true, "stop", "running").enabled).toBe(false);
  });

  it("★ 任何状态下都不会出现「两个都可点」", () => {
    const statuses = ["running", "stopped", "fault", "offline", "unknown"] as const;
    for (const status of statuses) {
      const start = resolveNameplateSide(okMatch, false, "start", status).enabled;
      const stop = resolveNameplateSide(okMatch, false, "stop", status).enabled;
      if (status === "unknown") continue;
      expect(start && stop, `${status} 下两侧同时可点`).toBe(false);
    }
  });
});
