import { describe, expect, it } from "vitest";
import { verifyCommandOutcome } from "./command-verify";

/**
 * 命令回执判定（2026-11-23）。
 *
 * <p>这块判错的方式很隐蔽：把「没变化」报成「失败」，或把「读不到」
 * 报成「失败」，都会让操作员做错误的现场动作
 * （以为设备坏了、或者反复点击去「再试一次」）。
 */
describe("verifyCommandOutcome", () => {
  it("到了目标态 → confirmed", () => {
    expect(verifyCommandOutcome({ before: false, after: true, targetOn: true })).toBe("confirmed");
    expect(verifyCommandOutcome({ before: true, after: false, targetOn: false })).toBe("confirmed");
  });

  it("★ 发命令前未知（null），回读到了目标态 → confirmed", () => {
    // 首次进页面时状态还没上报，点「启动」后读到运行 —— 这就是成功
    expect(verifyCommandOutcome({ before: null, after: true, targetOn: true })).toBe("confirmed");
  });

  it("★ 回读不到 → unverifiable，绝不报成失败", () => {
    expect(verifyCommandOutcome({ before: true, after: null, targetOn: false })).toBe("unverifiable");
    expect(verifyCommandOutcome({ before: null, after: null, targetOn: true })).toBe("unverifiable");
  });

  it("本来就在目标态 → confirmed（状态确实是我们要的）", () => {
    /*
     * 「发启动、本来就在跑」：状态等于目标态，就报 confirmed。
     * 不能报 unchanged —— 那会让操作员以为命令没生效。
     * 文案用「已确认为目标状态」而不是「已切换」，避免暗示发生过变化。
     */
    expect(verifyCommandOutcome({ before: true, after: true, targetOn: true })).toBe("confirmed");
  });

  it("状态没变且不在目标态 → unchanged（不等于失败）", () => {
    // 发「启动」但仍是停机：可能网关没实现，也可能被互锁拒绝
    expect(verifyCommandOutcome({ before: false, after: false, targetOn: true })).toBe("unchanged");
  });

  it("前态未知、回读非目标 → unchanged（分不清是没动还是别的原因）", () => {
    expect(verifyCommandOutcome({ before: null, after: false, targetOn: true })).toBe("unchanged");
  });

  it("★ 动了但没到目标态 → unexpected（例如转故障）", () => {
    // 发「启动」，结果从「停机」变「故障」：设备响应了，结果不是要的
    expect(verifyCommandOutcome({ before: false, after: true, targetOn: false })).toBe("unexpected");
  });

  it("四种结果互斥且都有值", () => {
    const all = new Set([
      verifyCommandOutcome({ before: false, after: true, targetOn: true }),
      verifyCommandOutcome({ before: false, after: false, targetOn: true }),
      verifyCommandOutcome({ before: false, after: true, targetOn: false }),
      verifyCommandOutcome({ before: false, after: null, targetOn: true }),
    ]);
    expect(all.size).toBe(4);
  });
});
