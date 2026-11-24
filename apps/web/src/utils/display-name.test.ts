import { describe, expect, it } from "vitest";
import { displayKeyOf, displayNameOf, shortTechnicalName } from "./display-name";

/**
 * 命名铁律的可执行契约（2026-11-23）。
 *
 * <p>这些用例的意义不只是"函数能用"，而是**把铁律钉住**：
 * 下一个 AI 改这里时，破坏「label 优先」或「key 不许硬编码中文」会直接红。
 */
describe("displayNameOf —— 显示层一律 label 优先", () => {
  it("label 有值时用 label，不用技术名", () => {
    expect(
      displayNameOf({ name: "PowerMeter-3P-CHINT·平台演示中心", label: "正泰三相电表 DTSD3366D" }),
    ).toBe("正泰三相电表 DTSD3366D");
  });

  it("label 为空时回落到 name（不能显示空白）", () => {
    expect(displayNameOf({ name: "天骄-模块机-1#·生产园区", label: "" })).toBe(
      "天骄-模块机-1#·生产园区",
    );
    expect(displayNameOf({ name: "x", label: "   " })).toBe("x");
    expect(displayNameOf({ name: "x" })).toBe("x");
  });

  it("都没有时用 fallback，不返回 undefined", () => {
    expect(displayNameOf({}, "未命名")).toBe("未命名");
    expect(displayNameOf(null)).toBe("");
    expect(displayNameOf(undefined, "id-123")).toBe("id-123");
  });
});

describe("shortTechnicalName —— 只在调试场景砍后缀", () => {
  it("砍掉 ·场站后缀", () => {
    expect(shortTechnicalName({ name: "PowerMeter-3P-CHINT·平台演示中心" })).toBe(
      "PowerMeter-3P-CHINT",
    );
  });

  it("没有 · 时原样返回", () => {
    expect(shortTechnicalName({ name: "module-1" })).toBe("module-1");
    expect(shortTechnicalName(null)).toBe("");
  });
});

describe("displayKeyOf —— 中文 key 来自场景配置，不是硬编码", () => {
  it("场景层的 label 优先（同一 key 在不同场景可叫不同名字）", () => {
    expect(displayKeyOf("temperature", { temperature: "出水温度" })).toBe("出水温度");
    expect(displayKeyOf("temperature", { temperature: "回风温度" })).toBe("回风温度");
  });

  it("场景层没有时用代码内的通用兜底", () => {
    expect(displayKeyOf("power", null, { power: "功率" })).toBe("功率");
  });

  it("都没有时回落到技术 key —— 不美化、不伪装成中文", () => {
    /*
     * 这一条是刻意的：把 `load_rate` 显示成 `load rate` 会让人以为
     * 已经翻译过了。原样显示反而更容易被发现并补上中文名。
     */
    expect(displayKeyOf("load_rate")).toBe("load_rate");
    expect(displayKeyOf("load_rate", {})).toBe("load_rate");
  });

  it("空 key 返回空串", () => {
    expect(displayKeyOf(null)).toBe("");
    expect(displayKeyOf("")).toBe("");
  });
});
