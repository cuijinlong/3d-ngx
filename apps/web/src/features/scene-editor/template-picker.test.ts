import { describe, expect, it } from "vitest";
import type { SceneTemplateCard } from "@idt/data-adapter";
import {
  BUILTIN_LAYOUT_PREFIX,
  builtinLayoutCards,
  builtinLayoutId,
  filterSceneTemplates,
  isBuiltinLayoutCard,
  previewRegions,
  resolveLayoutForSceneTemplate,
  templateHasModel,
} from "./template-picker";

/*
 * 模板选择器（2026-11-23）。
 *
 * <p>这里测的都是「界面上一眼看到、但很难靠肉眼验」的约定：
 * 布局映射、内置卡片 id 前缀、「有没有模型」的判据。
 */

const card = (over: Partial<SceneTemplateCard> = {}): SceneTemplateCard => ({
  id: "tpl-1",
  name: "冷热站标准版",
  ...over,
});

describe("resolveLayoutForSceneTemplate", () => {
  it("★ 热泵类模板 → 天骄冷热站布局（按名称匹配）", () => {
    const choice = resolveLayoutForSceneTemplate(card({ name: "热泵机组监控模板" }));
    expect(choice.layoutId).toBe("tianjiao-heat-pump");
    expect(choice.matchedBy).toBe("keyword");
    expect(choice.note).toContain("天骄冷热站");
  });

  it("★ 套装是英文也能匹配（hvac-hud-v1）", () => {
    const choice = resolveLayoutForSceneTemplate(card({ name: "标准模板", stylePack: "hvac-hud-v1@1.0.0" }));
    expect(choice.layoutId).toBe("tianjiao-heat-pump");
    expect(choice.matchedBy).toBe("keyword");
  });

  it("★ 匹配不到时用默认布局，并明确标注「默认」而不是装作匹配上了", () => {
    const choice = resolveLayoutForSceneTemplate(card({ name: "园区总览", description: "建筑标签" }));
    expect(choice.matchedBy).toBe("default");
    expect(choice.note).toContain("默认");
  });

  it("没选模板（null）也返回可用布局，界面不用到处判空", () => {
    const choice = resolveLayoutForSceneTemplate(null);
    expect(choice.layoutId).toBeTruthy();
    expect(choice.layoutName).toBeTruthy();
  });

  it("描述里出现热泵也算命中", () => {
    const choice = resolveLayoutForSceneTemplate(card({ name: "模板A", description: "用于热泵机房" }));
    expect(choice.layoutId).toBe("tianjiao-heat-pump");
  });
});

describe("previewRegions", () => {
  it("★ 预览线框来自真实布局，不是画出来的示意图", () => {
    const regions = previewRegions("tianjiao-heat-pump");
    expect(regions.length).toBeGreaterThan(0);
    /* 坐标必须在 0~100 内，否则线框会画到卡片外面 */
    for (const region of regions) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.w).toBeLessThanOrEqual(100.5);
      expect(region.y + region.h).toBeLessThanOrEqual(100.5);
    }
  });

  it("标题区被单独标出来（它在大屏上就是一条带，不该画成卡片）", () => {
    const regions = previewRegions("tianjiao-heat-pump");
    expect(regions.some((item) => item.isTitle)).toBe(true);
  });

  it("不存在的布局 id 返回空数组，而不是抛错", () => {
    expect(previewRegions("no-such-layout")).toEqual([]);
  });
});

describe("内置布局卡片", () => {
  it("★ id 带前缀，和后端模板 id 区分开（避免撞库 / 误写 templateId）", () => {
    const builtins = builtinLayoutCards();
    expect(builtins.length).toBeGreaterThan(0);
    for (const item of builtins) {
      expect(item.id.startsWith(BUILTIN_LAYOUT_PREFIX)).toBe(true);
      expect(isBuiltinLayoutCard(item)).toBe(true);
    }
  });

  it("能从合成 id 还原真实布局 id", () => {
    const first = builtinLayoutCards()[0]!;
    expect(previewRegions(builtinLayoutId(first)).length).toBeGreaterThan(0);
  });

  it("平台模板不会被误判成内置布局", () => {
    expect(isBuiltinLayoutCard(card({ id: "0f8a-uuid" }))).toBe(false);
  });
});

describe("templateHasModel", () => {
  it("★ 后端给了 hasModel=false 就以它为准 —— 不能因为「没 objectKey」当成有模型", () => {
    expect(templateHasModel(card({ hasModel: false }))).toBe(false);
  });

  it("★ hasModel 是唯一判据：客户端接口不返回 objectKey，只看它才能显示「含模型」", () => {
    expect(templateHasModel(card({ hasModel: true }))).toBe(true);
  });

  it("hasModel 缺省（老接口）时退回看 objectKey", () => {
    expect(templateHasModel(card({ glbObjectKey: "scene-template/a/b/model.glb" }))).toBe(true);
    expect(templateHasModel(card({}))).toBe(false);
  });
});

describe("filterSceneTemplates", () => {
  const rows = [
    card({ id: "a", name: "冷热站标准版", stylePack: "hvac-hud-v1@1.0.0" }),
    card({ id: "b", name: "园区总览", description: "建筑标签与告警" }),
  ];

  it("空搜索返回全部", () => {
    expect(filterSceneTemplates(rows, "   ")).toHaveLength(2);
  });

  it("按名称 / 描述 / 套装都能搜到", () => {
    expect(filterSceneTemplates(rows, "冷热")).toHaveLength(1);
    expect(filterSceneTemplates(rows, "告警")).toHaveLength(1);
    expect(filterSceneTemplates(rows, "hvac")).toHaveLength(1);
  });

  it("★ 搜不到时返回空数组（不能悄悄返回全部，那会让人以为搜索没生效）", () => {
    expect(filterSceneTemplates(rows, "不存在的东西")).toEqual([]);
  });

  it("大小写不敏感", () => {
    expect(filterSceneTemplates(rows, "HVAC")).toHaveLength(1);
  });
});
