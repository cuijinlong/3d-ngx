import {
  DEFAULT_AI_EXTENSION,
  examineLayoutProposal,
  type AiExtension,
  type LayoutOperation,
  type LayoutProposal,
  type SceneWidgetLayout,
} from "@idt/data-adapter";

/**
 * AI 返回的 `actions` → 可落地的布局改动（2026-11-24）。
 *
 * <h2>为什么单独抽出来</h2>
 *
 * <p>`AiBuildPanel` 的注释里一直写着「前端收到后交给 `applyAiActions` 落进布局」，
 * 但那个函数**从来没实现过** —— 面板只显示 `content`，`actions` 直接丢掉。
 * 也就是说：后端即使接上 LLM 并返回了 `actions`，界面也不会有任何变化。
 *
 * <p>这块不依赖任何 LLM，纯前端，所以先做掉：后端一接上就能用。
 *
 * <h2>★ 三条硬规则</h2>
 *
 * <ol>
 *   <li><b>不直接改布局</b>。先 `examineLayoutProposal` 校验 + 算差异，
 *       把「会改成什么 / 哪条越界」摆给用户看，确认后才落。</li>
 *   <li><b>整份接受或整份拒绝</b>。任一条不合法就不应用 ——
 *       部分应用会让用户拿到一个「一半是新的一半是旧的」布局，
 *       而 AI 说的话和布局对不上，排查时无从下手。</li>
 *   <li><b>操作白名单来自模板</b>（`aiExtension.operations`），
 *       不是写死的 `IMPLEMENTED_OPERATIONS`。模板声明「这张大屏不许加卡」，
 *       AI 就不该能加。</li>
 * </ol>
 *
 * <h2>为什么未知形状要当错误而不是跳过</h2>
 *
 * <p>后端可能返回 `{type:"add-widget",...}`（而不是 `{op:...}`）。
 * 把它静默过滤掉，用户会看到「AI 说改好了」但界面没变 ——
 * 那是最难排查的一类问题。所以形状不对就明确报错，并指出期望的字段名。
 */

/** 后端回包里 `actions` 的合法形状校验结果。 */
export type AiActionsParse =
  | { ok: true; operations: LayoutOperation[] }
  | { ok: false; error: string };

const OPERATION_NAMES = ["add-widget", "update-widget", "remove-widget", "bind-telemetry"] as const;

/**
 * 解析后端 `actions` 字段。
 *
 * <p>接受两种形态（都见过）：
 * <ul>
 *   <li>`{ op: "update-widget", ... }` —— spec 里的写法；</li>
 *   <li>`{ type: "update-widget", ... }` —— 有些后端习惯用 type。</li>
 * </ul>
 * 只认这两种，别的一律报错并说明期望。
 */
export function parseAiActions(raw: unknown): AiActionsParse {
  if (raw === undefined || raw === null) return { ok: true, operations: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "actions 不是数组。期望 [{ op: \"update-widget\", ... }]。" };
  }
  const operations: LayoutOperation[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `actions[${i}] 不是对象。` };
    }
    const row = item as Record<string, unknown>;
    const name = typeof row.op === "string" ? row.op : typeof row.type === "string" ? row.type : "";
    if (!name) {
      return {
        ok: false,
        error: `actions[${i}] 缺少操作名。期望字段 op（或 type），可取：${OPERATION_NAMES.join(" / ")}。`,
      };
    }
    if (!(OPERATION_NAMES as readonly string[]).includes(name)) {
      return {
        ok: false,
        error: `actions[${i}] 的操作「${name}」不支持。当前只支持：${OPERATION_NAMES.join(" / ")}。`,
      };
    }
    /* 去掉 op/type 两个键名差异，只保留规范化后的操作名 */
    const { op: _op, type: _type, ...rest } = row;
    operations.push({ ...(rest as object), op: name } as LayoutOperation);
  }
  return { ok: true, operations };
}

export interface AiPlan {
  /** 校验结果（含 diff / issues / 应用后的布局） */
  proposal: LayoutProposal;
  /** 是否还有「需要人看一眼」的改动 —— 有就必须等确认 */
  needsConfirm: boolean;
  /**
   * 这份提案是在**空场景**上算的（2026-11-24）。
   *
   * <p>界面要把这件事说出来：用户看到「+ 新增卡片 × 7」时
   * 得知道那是「从零搭」而不是「在已有大屏上加了 7 块」。
   * 两者确认时的心理预期完全不同。
   */
  fromEmpty?: boolean;
}

/** 空布局的基准值。写在这里而不是共用常量：避免调用方拿到后被误改。 */
function emptyLayout(): SceneWidgetLayout {
  return { schemaVersion: "1.0.0", widgets: [] };
}

/**
 * 把操作变成一份待确认的计划。
 *
 * <h3>空场景可搭（2026-11-24 改）</h3>
 *
 * <p>原来 `layout` 为空时**整份拒绝**，提示「先点场景设置应用一份底稿」。
 * 而客户要的正是「让 AI 按模板开发大屏」—— 新建场景天然是空的，
 * 那道门等于把最常见的起点封死了：「AI 帮我搭一个大屏」
 * 得到的回覆是「你先自己建一个」。
 *
 * <p>现在以空布局为基准继续算：`add-widget` 能正常落地
 * （`parseSceneWidget` 对缺失坐标有自动错开的默认值）；
 * `update-widget` / `remove-widget` / `bind-telemetry` 会报
 * 「找不到卡片」—— 那个报错在空场景里是**准确的**，不该掩盖。
 */
export function planAiActions(
  layout: SceneWidgetLayout | null | undefined,
  operations: LayoutOperation[],
  extension?: AiExtension | null,
): AiPlan {
  const fromEmpty = !layout || !Array.isArray(layout.widgets) || layout.widgets.length === 0;
  const base = layout && Array.isArray(layout.widgets) ? layout : emptyLayout();
  const proposal = examineLayoutProposal(base, operations, extension ?? DEFAULT_AI_EXTENSION);
  /*
   * 只要有改动就要求确认。
   *
   * <p>不因为「改动小」就自动应用：AI 理解偏差是常态，
   * 而大屏改动会立刻被现场看到。宁可多一次点击。
   */
  return { proposal, needsConfirm: proposal.ok && proposal.diff.length > 0, ...(fromEmpty ? { fromEmpty } : {}) };
}
