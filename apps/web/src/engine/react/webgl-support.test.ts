import { describe, expect, it } from "vitest";
import { canCreateWebgl2, diagnoseWebgl, isGraphicsDeviceError } from "./webgl-support";

describe("isGraphicsDeviceError", () => {
  it("认得 PlayCanvas 与 @playcanvas/react 两层包装", () => {
    /*
     * 两层错误都要认：
     *   · @playcanvas/react 抛 `Error('Failed to create a graphics device')`；
     *   · PlayCanvas 自己抛 `AggregateError([...], 'Failed to create a graphics device')`。
     * 只认一层的话，另一种就会继续以 uncaught rejection 的形式留在控制台，
     * 而界面上依然是空白。
     */
    expect(isGraphicsDeviceError(new Error("Failed to create a graphics device"))).toBe(true);
    expect(isGraphicsDeviceError(new AggregateError([], "Failed to create a graphics device"))).toBe(true);
    expect(isGraphicsDeviceError("Failed to create a graphics device")).toBe(true);
  });

  it("不把无关错误当成图形设备失败", () => {
    /* 别抢别的错误的处理权 —— 例如 GLB 真的 404 时应该照常报出来 */
    expect(isGraphicsDeviceError(new Error("404 model.glb"))).toBe(false);
    expect(isGraphicsDeviceError(new Error("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(isGraphicsDeviceError(undefined)).toBe(false);
    expect(isGraphicsDeviceError(null)).toBe(false);
  });
});

describe("canCreateWebgl2", () => {
  it("测试环境（jsdom）没有 WebGL，返回 false 而不是抛错", () => {
    /* 组件里靠 import.meta.env.MODE 跳过检测；函数本身也不能炸 */
    expect(canCreateWebgl2()).toBe(false);
  });

  it("没有 document 时安全返回 false", () => {
    const original = globalThis.document;
    // @ts-expect-error 故意模拟非浏览器环境
    delete globalThis.document;
    try {
      expect(canCreateWebgl2()).toBe(false);
    } finally {
      globalThis.document = original;
    }
  });
});

describe("diagnoseWebgl", () => {
  it("测试环境（node，无 document）报告全不可用，不抛错", () => {
    const d = diagnoseWebgl();
    expect(d.webgl2).toBe(false);
    expect(d.webgl1).toBe(false);
    expect(d.renderer).toBeNull();
  });
});
