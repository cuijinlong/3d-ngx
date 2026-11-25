import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Select, Tooltip } from "antd";
import type { ScenePlatformRef } from "@idt/shared-types";
import { getSceneTemplateApi, type SceneTemplateCard } from "@idt/data-adapter";
import { TemplateFileExplorer } from "./TemplateFileExplorer";
import styles from "./TemplateFilePanel.module.css";

/**
 * 场景设置抽屉里的「模板文件」入口（2026-11-24）。
 *
 * <h2>为什么要有这一块</h2>
 *
 * <p>客户原话：「我想在 3d-ngx 的设计页面的右上角场景设置加一个模版的文件资源
 * 浏览器，然后我可以编辑这个模版」。
 *
 * <p>模板文件资源管理器（§27）原来只在「模板中心」页面能打开 ——
 * 而人在设计页里改样式时，正需要顺手看/改模板的 css、布局 json。
 * 让他切到另一个页面、再找同一张模板，是纯粹的多余步骤。
 *
 * <h2>为什么不是「直接打开当前场景的模板」</h2>
 *
 * <p>场景与模板之间**没有可靠的引用字段**：场景资产的 `additionalInfo`
 * 里只有 `packId` / `stylePack`，实测天骄科技园这个场景连 `fromTemplate`
 * 都没有（老场景、手工建的都有）。硬绑一个字段会在半数场景上落空。
 *
 * <p>所以做成「自动猜 + 可手选」：
 * <ul>
 *   <li>按 `stylePack` 精确匹配 → 再按 `packId` → 都没有就选第一个；</li>
 *   <li>猜错时用户能在下拉里改 —— 界面上明确写着这是「猜的」。</li>
 * </ul>
 *
 * <h2>为什么权限失败要说话</h2>
 *
 * <p>模板接口是 `WRITE_AUTHORITIES`（SYS_ADMIN / TENANT_ADMIN），
 * 客户角色会 403。不做提示的话这一块就是**空白下拉 + 点不动的按钮**，
 * 用户只会以为功能坏了 —— 而它其实是「你这个身份不能改模板」。
 */

/**
 * 从模板清单里猜「这个场景最可能用哪个模板」。
 *
 * <p>三级判据，从严到松：
 * <ol>
 *   <li>`stylePack` 完全相同（`hvac-hud-v1@1.0.0`）—— 这是实例化时直接沿用
 *       的字段，最可信；</li>
 *   <li>`packId` 相同（`hvac-hud-v1`）—— 少了版本号，同一套装的不同版本；</li>
 *   <li>都没有 → 返回 null，让调用方落到「第一个」并把提示语写成猜的。</li>
 * </ol>
 *
 * <p>为什么不做模糊/子串匹配：模板名是人工起的（`tpl-天骄科技园标准版`），
 * 场景名也常是人工起的，两边对上不代表是同一个模板 —— 猜错的代价是
 * 用户去改了**另一个模板**的样式，而那不会报错，只会让改动看起来没生效。
 */
export function matchTemplateForScene(
  templates: SceneTemplateCard[],
  platform: ScenePlatformRef | undefined,
  sceneName?: string,
): { template: SceneTemplateCard | null; confidence: "exact" | "pack" | "ambiguous" | "none" } {
  if (!templates.length) return { template: null, confidence: "none" };

  /*
   * ★ stylePack **不唯一**（2026-11-24 实测）。
   *
   * <p>库里「tpl-冷热站标准版」与「tpl-天骄科技园标准版」的 `stylePack`
   * 都是 `hvac-hud-v1@1.0.0` —— 同一套风格套装被两个模板共用。
   * 只按 stylePack `find()` 第一个，实测就把天骄场景指向了「冷热站标准版」，
   * 用户在设计页改的是**另一个模板**的样式，没有报错、只是「改动看起来没生效」。
   *
   * <p>所以命中多个时再用场景名细分；仍然分不出来就标 `ambiguous`，
   * 让界面明说「有多个模板共用同一套装，请确认」。
   */
  const stylePack = platform?.stylePack?.trim();
  const byStyle = stylePack
    ? templates.filter((item) => item.stylePack?.trim() === stylePack)
    : [];
  if (byStyle.length === 1) return { template: byStyle[0] ?? null, confidence: "exact" };
  if (byStyle.length > 1) {
    const narrowed = narrowByName(byStyle, sceneName);
    return narrowed ? { template: narrowed, confidence: "exact" } : { template: byStyle[0] ?? null, confidence: "ambiguous" };
  }

  const packId = platform?.packId?.trim();
  if (packId) {
    const byPack = templates.filter((item) => item.packId?.trim() === packId);
    if (byPack.length === 1) return { template: byPack[0] ?? null, confidence: "pack" };
    if (byPack.length > 1) {
      const narrowed = narrowByName(byPack, sceneName);
      return narrowed ? { template: narrowed, confidence: "pack" } : { template: byPack[0] ?? null, confidence: "ambiguous" };
    }
  }
  return { template: null, confidence: "none" };
}

/**
 * 用场景名在同套装候选里再挑一次。
 *
 * <p>判据是**双向包含**：场景「天骄科技园」↔ 模板「tpl-天骄科技园标准版」。
 * 去掉 `tpl-` 前缀与「标准版/模板」这类通用后缀再比，否则
 * 「tpl-冷热站标准版」会因为共享「标准版」而误命中。
 *
 * <p>分不出来时返回 null —— 宁可不猜，也不要挑一个看起来像的。
 */
function narrowByName(candidates: SceneTemplateCard[], sceneName?: string): SceneTemplateCard | null {
  const want = stripDecorations(sceneName ?? "");
  if (!want) return null;
  let hit: SceneTemplateCard | null = null;
  for (const item of candidates) {
    const name = stripDecorations(item.name ?? "");
    if (!name) continue;
    if (!(name.includes(want) || want.includes(name))) continue;
    /* 超过一个都算分不出来 */
    if (hit) return null;
    hit = item;
  }
  return hit;
}

/** 去掉 `tpl-` 前缀与常见后缀，只留可比较的主体。 */
function stripDecorations(value: string): string {
  return value
    .replace(/^tpl[-_\s]*/i, "")
    .replace(/(标准版|模板|template)$/i, "")
    .replace(/[\s\-·_]+/g, "")
    .trim()
    .toLowerCase();
}

export function TemplateFilePanel({
  platform,
  sceneName,
}: {
  platform?: ScenePlatformRef;
  /** 场景名，用于在同套装模板里细分。不传就只能标「有歧义」。 */
  sceneName?: string;
}) {
  const [templates, setTemplates] = useState<SceneTemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  /** 403 / 未连接之类的失败原因。有值就只显示这一句，不显示下拉。 */
  const [blocked, setBlocked] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getSceneTemplateApi().list();
      setTemplates(rows);
      setBlocked(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      /*
       * 把 403 单独挑出来说，因为它的处置完全不同：
       * 别人看到的「加载失败」会让运维去查网络，而实际是身份不够。
       */
      setBlocked(
        /403|forbidden|权限/i.test(text)
          ? "当前身份不能编辑场景模板（只有租户管理员可以）。"
          : text,
      );
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 自动猜测结果。只在用户没手选时生效。 */
  const guess = useMemo(
    () => matchTemplateForScene(templates, platform, sceneName),
    [templates, platform, sceneName],
  );

  const selected = useMemo(() => {
    if (pickedId) return templates.find((item) => item.id === pickedId) ?? null;
    return guess.template ?? templates[0] ?? null;
  }, [pickedId, guess, templates]);

  const guessed = !pickedId;

  if (blocked) {
    return (
      <div className={styles.blocked} data-testid="tpl-file-blocked">
        <span>{blocked}</span>
        <Button size="small" onClick={() => void load()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="tpl-file-panel">
      <Select
        className={styles.select}
        size="small"
        loading={loading}
        value={selected?.id}
        placeholder={templates.length ? "选择模板" : "还没有场景模板"}
        disabled={!templates.length}
        onChange={(id: string) => setPickedId(id)}
        data-testid="tpl-file-select"
        options={templates.map((item) => ({
          value: item.id,
          label: item.name + (item.templateVersion ? ` · v${item.templateVersion}` : ""),
        }))}
      />
      <div className={styles.actions}>
        <Tooltip title="左侧列出模板的文件；css / js / json / html 可在右侧直接改">
          <Button
            size="small"
            type="primary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              setExplorerOpen(true);
            }}
            data-testid="tpl-file-open"
          >
            打开文件管理器
          </Button>
        </Tooltip>
        {templates.length ? (
          <Button size="small" onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        ) : null}
      </div>
      {/*
       * 猜测可信度要写出来。不写的话用户会以为「这一定是当前场景用的模板」——
       * 而它可能只是「列表里第一个」。改错模板不会报错，只会让改动看起来没生效。
       */}
      {templates.length ? (
        <p className={styles.hint} data-testid="tpl-file-guess">
          {!guessed
            ? "已手动选择模板。"
            : guess.confidence === "exact"
              ? "已按风格套装与场景名匹配到这个场景的模板。"
              : guess.confidence === "pack"
                ? "当前场景只记录了套装 id（没有版本），按它匹配的模板，可能不是同一个版本。"
                : guess.confidence === "ambiguous"
                  ? "有多个模板共用同一个风格套装，无法确定是哪一个 —— 请在上方下拉里确认。"
                  : "当前场景没有记录来源模板，这里显示的是模板列表第一项 —— 请自行确认。"}
        </p>
      ) : (
        <p className={styles.hint}>
          模板库还是空的。去「模板中心」建一个之后，这里就能编辑它的文件。
        </p>
      )}
      <TemplateFileExplorer
        open={explorerOpen}
        template={selected}
        onClose={() => setExplorerOpen(false)}
      />
    </div>
  );
}
