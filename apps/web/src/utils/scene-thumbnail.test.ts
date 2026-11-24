import { describe, expect, it } from "vitest";
import { THUMBNAIL_WIDTH, thumbnailSize } from "./scene-thumbnail";

/**
 * 缩略图尺寸换算（2026-11-23）。
 *
 * <p>纯函数，但错了两头都难受：算大了文档变大（每次保存都传几 MB），
 * 算小了卡片里糊成一片。而且它**不会报错**，只是「看着不太对」。
 */
describe("thumbnailSize", () => {
  it("1920×1080 → 480×270（保持 16:9）", () => {
    expect(thumbnailSize(1920, 1080)).toEqual({ width: 480, height: 270 });
  });

  it("4K 画面同样压到 480 宽", () => {
    const size = thumbnailSize(3840, 2160);
    expect(size.width).toBe(THUMBNAIL_WIDTH);
    expect(size.height).toBe(270);
  });

  it("★ 比目标还小的源图不放大", () => {
    /*
     * 放大只会让图变糊、还更占空间 —— 缩略图的意义是「看清布局」，
     * 不是「撑满卡片」。
     */
    const size = thumbnailSize(320, 180);
    expect(size.width).toBe(320);
    expect(size.height).toBe(180);
  });

  it("非 16:9 的画布按实际比例算", () => {
    /* 编辑器侧栏打开时画布会变窄，比例不再固定 */
    const size = thumbnailSize(1200, 1200);
    expect(size.width).toBe(480);
    expect(size.height).toBe(480);
  });

  it("★ 非法尺寸退回 16:9 默认值，不崩也不出 NaN", () => {
    /*
     * 画布还没初始化时 `canvas.width` 可能是 0。若直接除会得到
     * `Infinity` / `NaN`，写进 `<canvas width>` 就变成 0 或 300 ——
     * 图片看起来"莫名其妙很小"。
     */
    const cases: Array<[number, number]> = [[0, 0], [-1, 100], [Number.NaN, 100], [100, 0]];
    for (const [w, h] of cases) {
      const size = thumbnailSize(w, h);
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });

  it("高度至少 1px（极扁画布不能算成 0）", () => {
    const size = thumbnailSize(5000, 2);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});
