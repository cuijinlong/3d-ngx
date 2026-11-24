import { describe, expect, it } from "vitest";
import { rollupWindows } from "./useEnergyRollup";

/**
 * 今日 / 本周 / 本月 / 本年的窗口计算（2026-11-23）。
 *
 * <p>这是纯函数，但边界极容易算错，而且错了**不会报错** ——
 * 只是数字看起来「有点小」或「偶尔跳一下」，很难当场发现。
 */

const DAY = 86_400_000;

const at = (s: string) => new Date(s);

describe("rollupWindows", () => {
  it("今日：今天 00:00 → 明天 00:00", () => {
    const w = rollupWindows(at("2026-11-23T15:37:12"));
    expect(new Date(w.today.from).getDate()).toBe(23);
    expect(new Date(w.today.from).getHours()).toBe(0);
    expect(w.today.to - w.today.from).toBe(DAY);
  });

  it("★ 今日的 to 是明天 0 点，不是「现在」", () => {
    /*
     * 用 `to = now` 会让「今天」这个桶被截断在查询时刻，
     * 同一份数据隔几分钟再查又变一次 —— 数字会自己跳。
     */
    const w = rollupWindows(at("2026-11-23T15:37:12"));
    const to = new Date(w.today.to);
    expect(to.getHours()).toBe(0);
    expect(to.getDate()).toBe(24);
  });

  it("本周从**周一**开始（2026-11-23 是周一）", () => {
    const w = rollupWindows(at("2026-11-23T10:00:00"));
    const from = new Date(w.week.from);
    expect(from.getDay()).toBe(1); // 1 = 周一
    expect(from.getDate()).toBe(23);
  });

  it("★ 周日属于「本周」而不是下一周（getDay()=0 的经典坑）", () => {
    /*
     * `Date.getDay()` 周日返回 0。直接 `today - day*DAY` 会算成
     * 「今天」，看起来对；但 `day=0` 时若写成 `day+1` 之类就会跳到下周。
     * 这里钉住：2026-11-29 是周日，它所在周从 11-23（周一）开始。
     */
    const w = rollupWindows(at("2026-11-29T20:00:00"));
    const from = new Date(w.week.from);
    expect(from.getDay()).toBe(1);
    expect(from.getDate()).toBe(23);
  });

  it("★ 本周的 to 是明天 0 点，不是下周一 0 点", () => {
    /*
     * 「本周用电」= 本周一 0 点到**今天结束**的累计，不该把还没发生的
     * 周四周五…算进窗口。
     *
     * <p>更硬的理由：若 to 取「下周一」，周三查时 `本周.to`(11-30)
     * 会**超过** `本月.to`(11-26)，四个区间就不再嵌套了 ——
     * 届时会出现「本周 100、本月 80」这种自相矛盾的组合。
     *
     * <p>所以四个区间的 to 统一都是明天 0 点。
     */
    const w = rollupWindows(at("2026-11-25T09:00:00"));
    expect(w.week.to).toBe(w.today.to);
    /* 周三：周一 → 次日，覆盖 3 天（含今天） */
    expect((w.week.to - w.week.from) / DAY).toBe(3);
  });

  it("本月从 1 日 00:00 开始", () => {
    const w = rollupWindows(at("2026-11-23T15:00:00"));
    const from = new Date(w.month.from);
    expect(from.getMonth()).toBe(10); // 10 = 11 月
    expect(from.getDate()).toBe(1);
  });

  it("本年从 1 月 1 日 00:00 开始", () => {
    const w = rollupWindows(at("2026-11-23T15:00:00"));
    const from = new Date(w.year.from);
    expect(from.getMonth()).toBe(0);
    expect(from.getDate()).toBe(1);
    expect(from.getFullYear()).toBe(2026);
  });

  it("★ 区间必须嵌套：今日 ⊆ 本周 ⊆ 本月 ⊆ 本年", () => {
    /*
     * 嵌套关系破了就说明某个边界算错。实际后果是四格数字
     * 出现「今日 > 本周」这种自相矛盾的组合，值班员会不信整块卡。
     */
    const w = rollupWindows(at("2026-11-23T15:00:00"));
    expect(w.today.from).toBeGreaterThanOrEqual(w.week.from);
    expect(w.week.from).toBeGreaterThanOrEqual(w.month.from);
    expect(w.month.from).toBeGreaterThanOrEqual(w.year.from);
    /* to 也必须是同一个（都是明天 0 点），否则窗口长度对不上 */
    expect(w.today.to).toBe(w.week.to);
    expect(w.week.to).toBe(w.month.to);
  });

  it("跨年边界：1 月 1 日的「本年」与「今日」重合", () => {
    const w = rollupWindows(at("2026-01-01T08:00:00"));
    expect(w.today.from).toBe(w.year.from);
  });
});
