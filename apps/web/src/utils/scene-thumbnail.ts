/**
 * 场景缩略图抓取与压缩（2026-11-23）。
 *
 * <h2>为什么不直接 `canvas.toDataURL()` 存原图</h2>
 *
 * <p>3D 画布在 1920×1080 下是 207 万像素，PNG dataURL 常有 **2~4MB**。
 * 存进场景 JSON 会让每次保存/列表拉取都背上几 MB —— 而它只是一张
 * 卡片缩略图，显示尺寸不到 300px 宽。
 *
 * <p>所以固定压到 480px 宽、JPEG q0.72：实测约 25~40KB，
 * 在卡片里看着清楚，传输代价可以忽略。
 *
 * <h2>★ WebGL 画布默认读不回像素</h2>
 *
 * <p>`preserveDrawingBuffer` 为 false 时（PlayCanvas 的默认值），
 * 在**渲染帧之外**调 `toDataURL` 会得到一张全透明的图 ——
 * 不报错，只是「缩略图存下来是空白的」。
 *
 * <p>这就是为什么 `captureCanvasThumbnail` 要检查结果：返回的图
 * 若几乎没内容，就明确返回失败原因，让调用方提示用户，
 * 而不是把一个空白缩略图存进场景。
 */

/** 缩略图目标宽度（px）。高度按画布宽高比推算。 */
export const THUMBNAIL_WIDTH = 480;

/** 按目标宽度与原始宽高比算缩略图尺寸。 */
export function thumbnailSize(srcW: number, srcH: number): { width: number; height: number } {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { width: THUMBNAIL_WIDTH, height: Math.round((THUMBNAIL_WIDTH * 9) / 16) };
  }
  /* 不放大：源图比目标还窄时保持原尺寸，放大只会让图变糊还更占空间 */
  const width = Math.min(THUMBNAIL_WIDTH, Math.round(srcW));
  const height = Math.max(1, Math.round((srcH * width) / srcW));
  return { width, height };
}

export interface ThumbnailResult {
  ok: boolean;
  /** 成功时是 JPEG dataURL；失败时为 null */
  dataUrl: string | null;
  /** 失败原因（中文，可直接给用户看） */
  reason?: string;
  /** 编码后的字节数估算，用于日志与体积监控 */
  bytes?: number;
}

/**
 * 从一个 `<canvas>` 抓缩略图。
 *
 * <p>纯 DOM 逻辑，不依赖 React / PlayCanvas —— 这样可以在 jsdom 里单测
 * 尺寸换算与「空白检测」，不必起 WebGL。
 */
export function captureCanvasThumbnail(source: HTMLCanvasElement | null): ThumbnailResult {
  if (!source) {
    return { ok: false, dataUrl: null, reason: "画布还没准备好，等场景加载完再试" };
  }
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) {
    return { ok: false, dataUrl: null, reason: "画布尺寸为 0，可能还没开始渲染" };
  }

  const { width, height } = thumbnailSize(srcW, srcH);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) {
    return { ok: false, dataUrl: null, reason: "无法创建 2D 绘图上下文" };
  }
  /*
   * 缩略图底色：深色而非透明。
   *
   * <p>JPEG 不支持透明，透明区域会被编码成黑色；而卡片背景是深蓝玻璃，
   * 直接给 `#04122a` 让边缘与卡片融为一体，不会有黑边。
   */
  ctx.fillStyle = "#04122a";
  ctx.fillRect(0, 0, width, height);
  try {
    ctx.drawImage(source, 0, 0, width, height);
  } catch (error) {
    return {
      ok: false,
      dataUrl: null,
      reason: `读取画布失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let dataUrl: string;
  try {
    dataUrl = out.toDataURL("image/jpeg", 0.72);
  } catch (error) {
    /* 跨域画布会抛 SecurityError —— 给明确原因，别只说"失败" */
    return {
      ok: false,
      dataUrl: null,
      reason: `画布被标记为跨域，无法读取：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  /*
   * ★ 空白检测。
   *
   * <p>WebGL 没保留绘制缓冲时，`drawImage` 画进去的全是透明像素，
   * 叠在深色底上就是一片纯色 —— 编码出来极小。
   * 实测正常场景 > 15KB；全空时约 2~3KB（纯色 JPEG 压缩率极高）。
   *
   * <p>阈值取 6KB：留出「画面确实很暗很简单」的余量，又不至于
   * 把空白图放过去。误报的代价是提示用户重试一次，成本很低。
   */
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = Math.round((base64.length * 3) / 4);
  if (bytes < 6000) {
    return {
      ok: false,
      dataUrl: null,
      bytes,
      reason:
        "抓到的画面是空白的（WebGL 未保留绘制缓冲）。"
        + "请先让场景渲染两帧，或在引擎侧开启 preserveDrawingBuffer 后重试。",
    };
  }

  return { ok: true, dataUrl, bytes };
}

/** 从页面里找主 3D 画布。找不到返回 null。 */
export function findSceneCanvas(root: ParentNode = document): HTMLCanvasElement | null {
  return root.querySelector("canvas");
}
