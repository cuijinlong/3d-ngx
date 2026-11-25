import { describe, expect, it } from "vitest";
import type { ScenePlatformRef } from "@idt/shared-types";
import type { SceneTemplateCard } from "@idt/data-adapter";
import { matchTemplateForScene } from "./TemplateFilePanel";

/*
 * 场景 → 模板的自动匹配（2026-11-24）。
 *
 * <p>这条逻辑错了的代价很具体：用户以为在改「自己这个场景的模板」，
 * 实际改了**另一个模板** —— 保存成功、界面无报错，只是改动「看起来没生效」。
 * 所以把每一级的判据和它的可信度都钉住。
 */

function tpl(over: Partial<SceneTemplateCard> & { id: string }): SceneTemplateCard {
  return { name: over.id, ...over } as SceneTemplateCard;
}

describe("matchTemplateForScene", () => {
  const a = tpl({ id: "a", name: "tpl-天骄", stylePack: "hvac-hud-v1@1.0.0", packId: "hvac-hud-v1" });
  const b = tpl({ id: "b", name: "tpl-园区", stylePack: "hvac-hud-v1@1.0.1", packId: "hvac-hud-v1" });
  const c = tpl({ id: "c", name: "tpl-其他", stylePack: "other-pack@1.0.0", packId: "other-pack" });

  it("★ stylePack 唯一命中 → exact（实例化时直接沿用的字段，最可信）", () => {
    const platform = { stylePack: "hvac-hud-v1@1.0.1" } as ScenePlatformRef;
    const out = matchTemplateForScene([b, c], platform);
    expect(out.template?.id).toBe("b");
    expect(out.confidence).toBe("exact");
  });

  it("★ 多个模板共用同一 stylePack → 用场景名细分（实测踩过）", () => {
    /*
     * 库里「tpl-冷热站标准版」与「tpl-天骄科技园标准版」的 stylePack
     * 都是 hvac-hud-v1@1.0.0。只 find() 第一个，天骄场景会指向冷热站模板 ——
     * 用户改的是另一个模板的样式，没有报错，只是「改动看起来没生效」。
     */
    const station = tpl({ id: "station", name: "tpl-冷热站标准版", stylePack: "hvac-hud-v1@1.0.0", packId: "hvac-hud-v1" });
    const tianjiao = tpl({ id: "tianjiao", name: "tpl-天骄科技园标准版", stylePack: "hvac-hud-v1@1.0.0", packId: "hvac-hud-v1" });
    const platform = { stylePack: "hvac-hud-v1@1.0.0" } as ScenePlatformRef;
    const out = matchTemplateForScene([station, tianjiao], platform, "天骄科技园");
    expect(out.template?.id).toBe("tianjiao");
    expect(out.confidence).toBe("exact");
  });

  it("★ 共用套装且场景名分不出来 → ambiguous（不硬猜）", () => {
    const station = tpl({ id: "station", name: "tpl-冷热站标准版", stylePack: "p@1" });
    const other = tpl({ id: "other", name: "tpl-园区标准版", stylePack: "p@1" });
    const platform = { stylePack: "p@1" } as ScenePlatformRef;
    /* 场景名与两边都不匹配 */
    const out = matchTemplateForScene([station, other], platform, "某某厂区");
    expect(out.confidence).toBe("ambiguous");
  });

  it("「标准版」这类通用后缀不会让两个模板都被选中", () => {
    /*
     * 冷热站标准版 vs 天骄科技园标准版 共享「标准版」——
     * 若去掉后缀这一步写错，两个都会被判为命中，结果是 null（分不出来），
     * 表现为永远 ambiguous。这条钉住「只按主体比较」。
     */
    const station = tpl({ id: "station", name: "tpl-冷热站标准版", stylePack: "p@1" });
    const tianjiao = tpl({ id: "tianjiao", name: "tpl-天骄科技园标准版", stylePack: "p@1" });
    const platform = { stylePack: "p@1" } as ScenePlatformRef;
    expect(matchTemplateForScene([station, tianjiao], platform, "冷热站").template?.id).toBe("station");
    expect(matchTemplateForScene([station, tianjiao], platform, "天骄科技园").template?.id).toBe("tianjiao");
  });

  it("stylePack 对不上时退回 packId（同套装不同版本）", () => {
    /* 场景记的是 v1.0.0，但模板库里只有 v1.0.1 → 按 packId 命中 b */
    const platform = { stylePack: "hvac-hud-v2@9.9.9", packId: "hvac-hud-v1" } as ScenePlatformRef;
    const out = matchTemplateForScene([b, c], platform);
    expect(out.template?.id).toBe("b");
    expect(out.confidence).toBe("pack");
  });

  it("两者都没有 → 返回 null + none（不硬塞列表第一个冒充命中）", () => {
    /*
     * 这一条是重点：调用方会退到「列表第一项」，但它必须知道自己是在猜，
     * 界面上要写「请自行确认」。把「猜的」标成「匹配到的」比空着更坏。
     */
    const platform = { stylePack: "unknown@1.0.0", packId: "unknown" } as ScenePlatformRef;
    const out = matchTemplateForScene([a, b], platform);
    expect(out.template).toBeNull();
    expect(out.confidence).toBe("none");
  });

  it("场景没有 platform 信息时不崩", () => {
    expect(matchTemplateForScene([a], undefined).confidence).toBe("none");
    expect(matchTemplateForScene([], undefined).template).toBeNull();
  });

  it("前后空白不算不同（人工维护的字段常有尾空格）", () => {
    const spaced = tpl({ id: "sp", stylePack: "  hvac-hud-v1@1.0.0  " });
    const platform = { stylePack: "hvac-hud-v1@1.0.0" } as ScenePlatformRef;
    expect(matchTemplateForScene([spaced], platform).template?.id).toBe("sp");
  });

  it("空模板列表返回 none，不抛错", () => {
    const out = matchTemplateForScene([], { stylePack: "x@1" } as ScenePlatformRef);
    expect(out).toEqual({ template: null, confidence: "none" });
  });
});
