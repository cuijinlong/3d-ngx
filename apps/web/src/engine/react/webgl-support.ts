/**
 * WebGL2 可用性检测（2026-11-24）。
 *
 * <h2>为什么要先检测</h2>
 *
 * <p>`@playcanvas/react` 的 `<Application>` 在拿不到 WebGL2 时会在
 * `useLayoutEffect` 的 async 函数里 reject —— 没有任何 catch，
 * 于是浏览器的控制台只有一条 **uncaught (in promise)**：
 *
 * ```
 * Failed to create a graphics device
 * ```
 *
 * 组件此时返回 `null`，整块 3D 区域变成空白。现场看到的是
 * 「页面其它部分正常、中间的 3D 什么都没有」，而这条错误既不说明
 * 原因，也不指向任何可操作的动作 —— 客户的第一反应必然是
 * 「是不是 GLB 没加载到」（实际不是：上下文创建失败发生在任何模型请求之前）。
 *
 * <h2>为什么不试图"挽救"</h2>
 *
 * <p>客户定调（2026-11-24）：「如果是电脑老旧的原因无法加载 WEBGL，
 * 那就算了提示一下就够了」。
 *
 * <p>这个判断是对的：拿不到 WebGL2 意味着老机器、老显卡、或公司策略
 * 禁用硬件加速 —— 都不是前端能改变的。软件渲染（SwiftShader）能跑，
 * 但在这个量级的场景（1942 个节点 + 实时遥测）下基本不可用，
 * 硬撑只会让人以为系统坏了。
 *
 * <p>所以这里只做一件事：**如实判断能不能用**，把可探测的事实读出来
 * 交给界面显示一句提示。不做降级渲染、不做原因推断。
 */

export type WebglSupport = "checking" | "ok" | "unavailable";

export interface WebglDiagnosis {
  webgl2: boolean;
  webgl1: boolean;
  webgpu: boolean;
  /** 显卡/渲染器标识，如 `ANGLE (Apple, Apple M1 Pro, ...)` */
  renderer: string | null;
}

/**
 * 建一个临时上下文读渲染器标识，读完全部丢弃。
 *
 * <p>`WEBGL_debug_renderer_info` 在部分浏览器被隐私策略屏蔽，读不到就返回 null ——
 * 拿不到不等于没显卡，所以这里**不据此判断失败**，只当作附加信息。
 */
function probeRenderer(kind: "webgl2" | "webgl"): { ok: boolean; renderer: string | null } {
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const gl = canvas.getContext(kind) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return { ok: false, renderer: null };
    let renderer: string | null = null;
    try {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
    } catch {
      /* 隐私策略屏蔽：不影响可用性判断 */
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, renderer };
  } catch {
    return { ok: false, renderer: null };
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export function diagnoseWebgl(): WebglDiagnosis {
  /* 没有 document 只会在测试（node 环境）或 SSR 下出现，按「不可用」处理 */
  if (typeof document === "undefined") {
    return { webgl2: false, webgl1: false, webgpu: false, renderer: null };
  }
  const two = probeRenderer("webgl2");
  /* WebGL2 已经拿到就不必再建一个 WebGL1 上下文 —— 每个上下文都算配额 */
  const one = two.ok ? { ok: true, renderer: two.renderer } : probeRenderer("webgl");
  /* `navigator.gpu` 不在标准 lib.dom 类型里，取值前先窄化一下 */
  const webgpu = Boolean((globalThis.navigator as Navigator & { gpu?: unknown } | undefined)?.gpu);
  return { webgl2: two.ok, webgl1: one.ok, webgpu, renderer: two.renderer ?? one.renderer };
}

/**
 * 试建一个 WebGL2 上下文并立即释放。
 *
 * <p>返回 `false` 只表示「这一台机器此刻建不出 WebGL2」。
 */
export function canCreateWebgl2(): boolean {
  return diagnoseWebgl().webgl2;
}

/**
 * 判断一条错误是不是「图形设备创建失败」。
 *
 * <p>`<Application>` 内部先抛 PlayCanvas 的 `AggregateError`，
 * `@playcanvas/react` 再包装成 `Error('Failed to create a graphics device')`。
 * 两种都可能落到 `unhandledrejection` 里，所以按文本匹配。
 */
export function isGraphicsDeviceError(reason: unknown): boolean {
  const text =
    reason instanceof Error
      ? `${reason.name} ${reason.message}`
      : typeof reason === "string"
        ? reason
        : "";
  return /Failed to create a graphics device|graphics device/i.test(text);
}
