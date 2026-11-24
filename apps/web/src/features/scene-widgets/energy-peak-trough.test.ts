import { describe, expect, it } from "vitest";
import { selectPeakTrough } from "./EnergyCards";

/**
 * 峰值 / 谷值时段选择（2026-11-23）。
 *
 * <p>★ 当前 UI 已不展示峰谷（客户要求改成四区间汇总），
 * 这个函数与这批用例保留 —— 它们锁住的是**判定逻辑**的两处易错点
 * （谷值排除 0、同桶不返回），与展示位置无关。
 * 若将来恢复峰谷，直接复用，不必重建测试。
 *
 * <p>这几条背后是一个真实的客户反馈：「左侧第 3 个和第一个有重复设备用电排名」。
 * 第一版左 1 卡列的是「品种 + 用量」逐行列表，和左 3 的「设备 + 用量」
 * 在 326px 宽的卡里长得一模一样。改成峰谷后形态彻底分开 ——
 * 这个函数就是那个改动的核心，它退化就等于又回到列表。
 */
describe("selectPeakTrough", () => {
  it("正常序列取最高与最低", () => {
    const out = selectPeakTrough([
      { bucket: "11-19", tce: 103 },
      { bucket: "11-20", tce: 292 },
      { bucket: "11-21", tce: 51 },
    ]);
    expect(out).not.toBeNull();
    expect(out![0]).toMatchObject({ key: "peak", bucket: "11-20", value: 292 });
    expect(out![1]).toMatchObject({ key: "trough", bucket: "11-21", value: 51 });
  });

  it("★ 谷值排除 0 —— 断档那天不是「用得最少」", () => {
    /*
     * 0 表示「那天没有数据」，不是「那天用了 0」。若取 min 会得到谷值 0，
     * 运维看到会以为机组停机，实际只是网关没上报。
     */
    const out = selectPeakTrough([
      { bucket: "11-19", tce: 120 },
      { bucket: "11-20", tce: 0 },
      { bucket: "11-21", tce: 88 },
    ]);
    expect(out![1]).toMatchObject({ key: "trough", bucket: "11-21", value: 88 });
  });

  it("峰值仍可取 0 段之外的最高（0 不影响 peak）", () => {
    const out = selectPeakTrough([
      { bucket: "a", tce: 0 },
      { bucket: "b", tce: 5 },
      { bucket: "c", tce: 9 },
    ]);
    expect(out).not.toBeNull();
    const [peak, trough] = out!;
    expect(peak!.bucket).toBe("c");
    expect(trough!.bucket).toBe("b");
  });

  it("★ 只有一个桶时不返回（峰谷同值，列两行等于重复）", () => {
    expect(selectPeakTrough([{ bucket: "11-19", tce: 42 }])).toBeNull();
  });

  it("全部为 0 时返回 null（没有可比的两个时段）", () => {
    expect(
      selectPeakTrough([
        { bucket: "a", tce: 0 },
        { bucket: "b", tce: 0 },
      ]),
    ).toBeNull();
  });

  it("空序列返回 null（不抛错）", () => {
    expect(selectPeakTrough([])).toBeNull();
  });
});
