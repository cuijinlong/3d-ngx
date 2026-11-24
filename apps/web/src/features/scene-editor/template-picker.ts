import {
  OVERVIEW_SITUATION_TEMPLATE_ID,
  type SceneTemplateCard,
  type ScreenTemplate,
  listBuiltinScreenTemplates,
} from "@idt/data-adapter";

/**
 * 场景模板选择器的纯逻辑（2026-11-23）。
 *
 * <h2>为什么单独抽出来</h2>
 *
 * <p>模板中心弹框里有两件容易出错、又必须说得清的事：
 *
 * <ol>
 *   <li><b>平台模板 → 大屏布局的映射</b>。平台模板库（`/api/energy/scene-templates`）
 *       存的是「模型 + 风格套装」，**没有布局字段**；大屏布局是另一样东西
 *       （`ScreenTemplate`，代码里的两个内置 JSON）。用户从模板库选一个模板，
 *       系统必须给他定一个布局。这个映射是**约定**，不是数据 ——
 *       所以要在界面上一字不差地说明它，不能让用户以为模板自带布局。</li>
 *   <li><b>预览色系</b>。模板库没有缩略图字段。与其画一张假截图，
 *       不如用内置布局的真实 `regions` 画线框 —— 用户看到的就是建完之后
 *       大屏骨架的真实样子。</li>
 * </ol>
 *
 * <h2>★ 映射规则必须可解释</h2>
 *
 * <p>规则只有一条：**风格套装 / 名称 / 描述里出现热泵类关键词 → 冷热站布局**，
 * 否则用综合态势。返回的 `matched` 告诉界面这条命中是「按关键词」还是
 * 「默认兜底」，界面照实显示。猜错的代价是建完场景布局不对，
 * 而用户以为是模板坏了；明确标注「默认」至少让他知道该去哪改。
 */
export interface TemplateLayoutChoice {
  /** 内置大屏布局 id，直接喂给 `getBuiltinScreenTemplate` */
  layoutId: string;
  /** 布局显示名，如「天骄冷热站」 */
  layoutName: string;
  /**
   * 命中方式。
   *
   * <p>`keyword` = 按套装/名称/描述里的关键词匹配到了；
   * `default` = 没有匹配项，用默认布局。
   */
  matchedBy: "keyword" | "default";
  /** 界面上直接显示的一句话，避免各处自己拼文案导致口径不一致 */
  note: string;
}

/**
 * 热泵 / 冷热站的识别关键词。
 *
 * <p>同时覆盖中英文与套装命名（`hvac-hud-v1`）—— 模板库的 `stylePack`
 * 是英文标识，模板名是中文，只认一边就会漏。
 */
const HEAT_PUMP_HINTS = /热泵|冷热|hvac|cooling|chiller/i;

const DEFAULT_LAYOUT_ID = OVERVIEW_SITUATION_TEMPLATE_ID;

function layoutById(id: string): ScreenTemplate | undefined {
  return listBuiltinScreenTemplates().find((item) => item.id === id);
}

/**
 * 把平台模板映射到大屏布局。
 *
 * <p>`template` 可以为 null（还没选模板 = 用默认布局），返回值始终有值，
 * 界面不用到处判空。
 */
export function resolveLayoutForSceneTemplate(
  template: SceneTemplateCard | null | undefined,
): TemplateLayoutChoice {
  for (const item of listBuiltinScreenTemplates()) {
    /* 布局自己的 id 直接命中：后端将来若真给了 layoutId，这条会先接住 */
    if (template && (template as SceneTemplateCard & { layoutId?: string }).layoutId === item.id) {
      return {
        layoutId: item.id,
        layoutName: item.name,
        matchedBy: "keyword",
        note: `布局：${item.name}（模板指定）`,
      };
    }
  }

  if (template) {
    const haystack = [template.stylePack, template.packId, template.name, template.description]
      .filter(Boolean)
      .join(" ");
    if (HEAT_PUMP_HINTS.test(haystack)) {
      const heat = layoutById("tianjiao-heat-pump");
      if (heat) {
        return {
          layoutId: heat.id,
          layoutName: heat.name,
          matchedBy: "keyword",
          note: `布局：${heat.name}（按风格套装匹配）`,
        };
      }
    }
  }

  const fallback = layoutById(DEFAULT_LAYOUT_ID) ?? listBuiltinScreenTemplates()[0];
  return {
    layoutId: fallback?.id ?? DEFAULT_LAYOUT_ID,
    layoutName: fallback?.name ?? "综合态势",
    matchedBy: "default",
    note: `布局：${fallback?.name ?? "综合态势"}（默认）`,
  };
}

/**
 * 预览用的布局区（归一化到 0~100 的百分比）。
 *
 * <p>直接取内置布局的真实 `regions` —— 这样卡片上的线框和建完后的
 * 大屏骨架一致。`title` 区单独标出来（它在弹框卡片里只占一条细带）。
 */
export interface PreviewRegion {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 顶部标题条不画边框，只画一条淡色带 */
  isTitle: boolean;
}

export function previewRegions(layoutId: string): PreviewRegion[] {
  const layout = layoutById(layoutId);
  if (!layout) return [];
  return layout.regions.map((region) => ({
    id: region.id,
    title: region.defaultTitle,
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
    isTitle: region.zone === "title",
  }));
}

/**
 * 模板搜索。
 *
 * <p>空串返回全部（含默认项）；否则按名称/描述/套装匹配，不区分大小写。
 * 抽成函数是为了能测「搜不到时返回空数组」而不是悄悄返回全部 ——
 * 后者会让用户以为搜索没生效。
 */
export function filterSceneTemplates(templates: SceneTemplateCard[], query: string): SceneTemplateCard[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter((item) =>
    [item.name, item.description, item.stylePack, item.packId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

/**
 * 模板是否带模型。
 *
 * <p>「没有模型」不是错误状态：可以从模板建一个只有布局的场景，之后再导模型。
 * 界面据此显示提示，而不是把那一条禁用掉 —— 禁用会让用户不知道
 * 「为什么这个模板点不了」。
 */
export function templateHasModel(template: SceneTemplateCard): boolean {
  /*
   * 优先用后端直接给的布尔（2026-11-23）。
   *
   * <p>客户端的 `scene-template-options` 不返回 objectKey（那是对象存储的
   * 内部布局），所以只有 `glbObjectKey` 这一个判据时，「含模型」永远显示成
   * 「仅布局」—— 用户会以为模板没带模型，转头去手动上传。
   *
   * <p>`hasModel === undefined` 表示接口没给这个字段（租户端 list），
   * 此时才退回看 objectKey。不能把 undefined 当 false。
   */
  if (template.hasModel !== undefined) return template.hasModel;
  return Boolean(template.glbObjectKey);
}

/** 「内置布局」这一档用这个 id 前缀，和后端模板 id 区分开，避免撞库。 */
export const BUILTIN_LAYOUT_PREFIX = "builtin:";

/** 把内置布局包成一张卡片，让它和平台模板在同一网格里可选。 */
export function builtinLayoutCards(): SceneTemplateCard[] {
  return listBuiltinScreenTemplates().map((layout) => ({
    id: `${BUILTIN_LAYOUT_PREFIX}${layout.id}`,
    name: layout.name,
    description: layout.description,
    templateVersion: `v${layout.version}`,
  }));
}

export function isBuiltinLayoutCard(template: SceneTemplateCard): boolean {
  return template.id.startsWith(BUILTIN_LAYOUT_PREFIX);
}

/** 从内置卡片的合成 id 还原真实布局 id。 */
export function builtinLayoutId(template: SceneTemplateCard): string {
  return template.id.slice(BUILTIN_LAYOUT_PREFIX.length);
}
