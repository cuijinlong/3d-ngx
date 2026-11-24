/**
 * 在线编程：编辑提案的校验与差异预览（2026-11-23）。
 *
 * <h2>这个模块解决什么问题</h2>
 *
 * 「在线编程」指把一份**编辑提案**（一组操作）作用到大屏布局上 —— 提案可能来自
 * 人、脚本或 AI。核心风险不是「改错了」，而是**改了不该改的东西**
 * 或**改完没人看得见**。
 *
 * <p>模板清单里写得很明确（`template.manifest.json` 的 `aiExtension`）：
 *
 * ```json
 * {
 *   "editableTargets": ["widget.props", "widget.layout", "widget.style", "widget.binding", ...],
 *   "protectedTargets": ["templateId", "mountPoints.scene", "runtime.eventContract"],
 *   "operations": ["add-widget", "update-widget", "remove-widget", "bind-telemetry", ...],
 *   "requiresDiffReview": true
 * }
 * ```
 *
 * <p>所以这个模块**只做两件事**：判断提案是否越界、生成人能看懂的差异。
 * 它**绝不直接改布局** —— `requiresDiffReview` 的含义就是「先给人看，再决定」。
 *
 * <h2>为什么 diff 不能只给 JSON Patch</h2>
 *
 * `{"op":"replace","path":"/widgets/3/y","value":44}` 对人没有意义：
 * 第 4 块卡是哪块？y 从多少变到 44？现场核对时看不出「这是不是我要的改动」。
 * 所以差异行必须写成「卡片标题：字段 旧值 → 新值」。
 */

import type { SceneWidget, SceneWidgetLayout, SceneWidgetSlot } from "./scene-widget-layout";

/** 与 `template.manifest.json` 的 `aiExtension` 同构。 */
export interface AiExtension {
  /** 允许修改的目标（点分路径，如 `widget.layout`）。 */
  editableTargets: string[];
  /** 任何情况下都不许碰的目标。 */
  protectedTargets: string[];
  /** 允许的操作名。不在其中的操作一律拒绝。 */
  operations: string[];
  /** true = 必须先把差异给人看，确认后才应用。 */
  requiresDiffReview: boolean;
}

/**
 * **真正实现了**的操作。
 *
 * <p>与 `DEFAULT_AI_EXTENSION.operations` 是两个概念：
 * <ul>
 *   <li>`operations` 是「模板声明允许 AI 改什么」—— 面向模板作者；</li>
 *   <li>本常量是「代码真的能执行什么」—— 面向实现。</li>
 * </ul>
 *
 * <p>两者不一致会造成**指错方向的报错**（2026-11-23 实测）：
 * `add-scene-event` / `add-panel` 在声明里，但下面没有对应分支，
 * 于是落到「其余操作都要求目标存在」，拿一个不存在的 `operation.id`
 * 去查卡片 → 用户看到「找不到卡片「undefined」」，
 * 会去检查卡片 id，而真正的问题是「这个操作没实现」。
 *
 * <p>加新操作时**先在这里加**，再补分支 —— 否则报错会继续误导。
 */
export const IMPLEMENTED_OPERATIONS = [
  "add-widget",
  "update-widget",
  "remove-widget",
  "bind-telemetry",
] as const;

/**
 * 参考模板默认的编辑边界。
 *
 * <p>与 `template01/template.manifest.json` 一致。放成常量是为了「新场景默认就有边界」——
 * 没有边界意味着任何提案都能改 `templateId`，那等于能把整屏换成别的模板。
 */
export const DEFAULT_AI_EXTENSION: AiExtension = {
  editableTargets: [
    "widget.props",
    "widget.layout",
    "widget.style",
    "widget.binding",
    "scene.interaction",
    "scene.layer",
  ],
  protectedTargets: ["templateId", "mountPoints.scene", "runtime.eventContract"],
  operations: [
    "add-widget",
    "update-widget",
    "remove-widget",
    "bind-telemetry",
    "add-scene-event",
    "add-panel",
  ],
  requiresDiffReview: true,
};

/** 一条编辑操作。 */
export type LayoutOperation =
  | { op: "add-widget"; widget: SceneWidget }
  | { op: "update-widget"; id: string; patch: Partial<SceneWidget> }
  | { op: "remove-widget"; id: string }
  | {
      op: "bind-telemetry";
      id: string;
      slotKey: string;
      telemetryKey: string;
      deviceId?: string;
    };

export type ProposalIssueCode =
  | "operation-not-allowed"
  | "widget-not-found"
  | "widget-duplicate"
  | "protected-field"
  | "slot-not-found"
  | "empty-operation";

export interface ProposalIssue {
  code: ProposalIssueCode;
  /** 面向人的说明，含具体是哪块卡、哪个字段。 */
  message: string;
}

export interface LayoutProposal {
  /** 全部操作合法才为 true。有任一 issue 就整体拒绝 —— 不做「部分应用」。 */
  ok: boolean;
  issues: ProposalIssue[];
  /** 人可读的差异行。ok=false 时也保留，用于说明「本来会改成什么」。 */
  diff: string[];
  /** 应用后的布局。ok=false 时不存在。 */
  next?: SceneWidgetLayout;
}

/**
 * 不允许通过 `update-widget` 改的字段。
 *
 * <p>理由分两类：
 * <ul>
 *   <li>`id` / `type` —— 改的是「这张卡是谁」。改 type 等于换一种部件，
 *       应该 remove + add，否则槽位、绑定、位置全部语义错位。</li>
 *   <li>`schemaVersion`（布局级）—— 版本号由存储层管理，提案改了会让解析器走错分支。</li>
 * </ul>
 */
const PROTECTED_WIDGET_FIELDS = ["id", "type"] as const;

function widgetLabel(widget: SceneWidget | undefined, id: string): string {
  const title = widget?.title?.trim();
  return title ? `「${title}」(${id})` : `(${id})`;
}

function findWidget(layout: SceneWidgetLayout, id: string) {
  return layout.widgets.find((item) => item.id === id);
}

/** 把值压成一行短文本，避免 diff 里出现大段 JSON。 */
function brief(value: unknown): string {
  if (value === undefined) return "（空）";
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 24 ? `${value.slice(0, 24)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `数组(${value.length})`;
  return "对象";
}

/** 矩形字段单独描述，人一眼能懂「挪了多远、变多大」。 */
const RECT_FIELDS = new Set(["x", "y", "w", "h"]);

/** 结构相等：用于「值没变就不显示」——否则 diff 里全是 `A → A` 的噪音。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keySet = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keySet) {
      if (!sameValue(left[key], right[key])) return false;
    }
    return true;
  }
  return false;
}

/** 单个字段的人话描述。 */
function describeField(key: string, before: unknown, next: unknown): string {
  if (RECT_FIELDS.has(key)) return `  位置/尺寸 ${key}: ${brief(before)} → ${brief(next)}`;
  if (key === "title") return `  标题: ${brief(before)} → ${brief(next)}`;
  if (key === "subtitle") return `  副标题: ${brief(before)} → ${brief(next)}`;
  return `  ${key}: ${brief(before)} → ${brief(next)}`;
}

/**
 * 逐项对比两个数组（slots / controls），按 `key` 对齐。
 *
 * <h2>为什么不能只说「数组(3) → 数组(3)」</h2>
 *
 * <p>这是「微调」场景的致命缺陷（2026-11-23 实测）：脚本模式一跑，
 * 6 行差异里有一半是 `slots: 数组(3) → 数组(3)` —— 用户看不出**哪个槽的哪个字段**
 * 变了，等于没有差异可审。而「看一眼就知道改了什么」正是预览存在的理由。
 *
 * <p>所以这里按 key 配对，逐字段列出；新增/删除的项单独标出。
 */
function describeArrayDiff<T extends { key?: string }>(
  label: string,
  before: T[] | undefined,
  after: T[] | undefined,
): string[] {
  const lines: string[] = [];
  const oldList = before ?? [];
  const newList = after ?? [];
  const byKey = (list: T[], key?: string) => list.find((item) => item.key === key);

  for (const item of newList) {
    const prev = byKey(oldList, item.key);
    if (!prev) {
      lines.push(`  ${label} + ${item.key ?? "(无 key)"}`);
      continue;
    }
    for (const [field, value] of Object.entries(item)) {
      if (field === "key") continue;
      const prevValue = (prev as unknown as Record<string, unknown>)[field];
      if (sameValue(prevValue, value)) continue;
      lines.push(`  ${label} ${item.key ?? "(无 key)"}.${field}: ${brief(prevValue)} → ${brief(value)}`);
    }
  }
  for (const item of oldList) {
    if (!byKey(newList, item.key)) lines.push(`  ${label} - ${item.key ?? "(无 key)"}`);
  }
  return lines;
}

function describeUpdate(
  widget: SceneWidget,
  patch: Partial<SceneWidget>,
): string[] {
  const lines: string[] = [];
  for (const [key, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    const before = (widget as unknown as Record<string, unknown>)[key];
    /*
     * 值没变就不写这一行。
     *
     * 脚本模式很容易产出「把原值再写一遍」的操作（比如整份 slots 重排，
     * 但其中一半槽其实没动）。原样列出会让「6 行变化」里 4 行是废话，
     * 用户反而看不出真正的改动。
     */
    if (sameValue(before, next)) continue;
    if (key === "slots") {
      lines.push(...describeArrayDiff("槽位", before as SceneWidgetSlot[], next as SceneWidgetSlot[]));
      continue;
    }
    if (key === "controls") {
      lines.push(...describeArrayDiff("按钮", before as Array<{ key: string }>, next as Array<{ key: string }>));
      continue;
    }
    lines.push(describeField(key, before, next));
  }
  return lines;
}

/**
 * 校验并预览一份提案。
 *
 * <p>**纯函数**：不修改入参 `layout`，返回新的 `next`。调用方拿到结果后
 * 决定是否落地（见 `requiresDiffReview`）。
 */
export function examineLayoutProposal(
  layout: SceneWidgetLayout,
  operations: LayoutOperation[],
  extension: AiExtension = DEFAULT_AI_EXTENSION,
): LayoutProposal {
  const issues: ProposalIssue[] = [];
  const diff: string[] = [];

  if (!operations.length) {
    return {
      ok: false,
      issues: [{ code: "empty-operation", message: "提案里没有任何操作。" }],
      diff: [],
    };
  }

  /* 深拷贝：提案校验过程不能碰到调用方的布局。 */
  let working: SceneWidgetLayout = {
    ...layout,
    widgets: layout.widgets.map((item) => ({ ...item, slots: item.slots?.map((slot) => ({ ...slot })) })),
  };

  for (const operation of operations) {
    /* ── 1. 操作白名单 ── */
    if (!extension.operations.includes(operation.op)) {
      issues.push({
        code: "operation-not-allowed",
        message: `操作「${operation.op}」不在允许清单里（允许：${extension.operations.join(" / ")}）。`,
      });
      continue;
    }

    /*
     * ── 1b. 声明了但没实现 ──
     *
     * 白名单通过之后必须再问一句「真的能执行吗」。漏了这一步，
     * 未实现的操作会掉进下面的 `widget-not-found`，报「找不到卡片「undefined」」——
     * 那是把实现缺口伪装成数据问题，排查方向会完全错。
     */
    if (!(IMPLEMENTED_OPERATIONS as readonly string[]).includes(operation.op)) {
      issues.push({
        code: "operation-not-allowed",
        message: `操作「${operation.op}」已在模板白名单里声明，但当前版本尚未实现。`
          + `可用的操作：${IMPLEMENTED_OPERATIONS.join(" / ")}。`,
      });
      continue;
    }

    /* ── 2. add-widget ── */
    if (operation.op === "add-widget") {
      const widget = operation.widget;
      if (findWidget(working, widget.id)) {
        issues.push({
          code: "widget-duplicate",
          message: `新增的卡片 id「${widget.id}」已存在，不能重复添加。`,
        });
        continue;
      }
      working = { ...working, widgets: [...working.widgets, widget] };
      diff.push(`+ 新增卡片 ${widgetLabel(widget, widget.id)}（${widget.type}）`);
      continue;
    }

    /* ── 3. 其余操作都要求目标存在 ── */
    const target = findWidget(working, operation.id);
    if (!target) {
      issues.push({
        code: "widget-not-found",
        message: `找不到卡片「${operation.id}」，操作「${operation.op}」无法执行。`,
      });
      continue;
    }

    if (operation.op === "remove-widget") {
      working = {
        ...working,
        widgets: working.widgets.filter((item) => item.id !== operation.id),
      };
      diff.push(`- 删除卡片 ${widgetLabel(target, operation.id)}`);
      continue;
    }

    if (operation.op === "update-widget") {
      const protectedHits = PROTECTED_WIDGET_FIELDS.filter((field) => field in operation.patch);
      if (protectedHits.length) {
        issues.push({
          code: "protected-field",
          message: `卡片 ${widgetLabel(target, operation.id)} 的 ${protectedHits.join("、")} 不可修改（要换类型请用删除 + 新增）。`,
        });
        continue;
      }
      const updated: SceneWidget = { ...target, ...operation.patch };
      working = {
        ...working,
        widgets: working.widgets.map((item) => (item.id === operation.id ? updated : item)),
      };
      const lines = describeUpdate(target, operation.patch);
      /*
       * 没有任何实际变化时**整条不写**（2026-11-23）。
       *
       * 脚本常见产出「把原值再写一遍」（比如整份 slots 重排但一半槽没动）。
       * 列一行「（无可显示的变化）」只会稀释真正改动的重要性 ——
       * 用户扫一眼就跳过了。
       */
      if (lines.length) {
        diff.push(`~ 修改卡片 ${widgetLabel(target, operation.id)}`);
        diff.push(...lines);
      }
      continue;
    }

    if (operation.op === "bind-telemetry") {
      const slots: SceneWidgetSlot[] = target.slots ?? [];
      const slotIndex = slots.findIndex((slot) => slot.key === operation.slotKey);
      if (slotIndex < 0) {
        issues.push({
          code: "slot-not-found",
          message: `卡片 ${widgetLabel(target, operation.id)} 没有槽位「${operation.slotKey}」（现有：${slots.map((s) => s.key).join("、") || "无"}）。`,
        });
        continue;
      }
      const before = slots[slotIndex];
      const nextSlots = slots.map((slot, index) =>
        index === slotIndex
          ? {
              ...slot,
              telemetryKey: operation.telemetryKey,
              /*
               * 绑遥测时清掉资产来源 —— 两套来源同时存在会让 readSlotValue
               * 走资产分支，用户会以为「换了测点却没生效」。
               */
              assetId: undefined,
              attributeKey: undefined,
              ...(operation.deviceId ? { deviceId: operation.deviceId } : {}),
            }
          : slot,
      );
      working = {
        ...working,
        widgets: working.widgets.map((item) =>
          item.id === operation.id ? { ...item, slots: nextSlots } : item,
        ),
      };
      diff.push(`~ 绑定 ${widgetLabel(target, operation.id)} 的槽位 ${operation.slotKey}`);
      diff.push(`  测点: ${brief(before?.telemetryKey)} → ${brief(operation.telemetryKey)}`);
      if (operation.deviceId) diff.push(`  设备: ${brief(before?.deviceId)} → ${brief(operation.deviceId)}`);
      continue;
    }
  }

  /*
   * 有任一 issue 就整体拒绝，不做「部分应用」。
   *
   * 提案是「一次意图」：允许一半生效会得到既不是旧状态也不是新状态的中间态，
   * 而提案方以为全部成功了。宁可整体退回。
   */
  if (issues.length) return { ok: false, issues, diff };

  /*
   * 全部操作都合法、但没有任何实际变化（例如把原值再写一遍）。
   *
   * <p>仍然返回 ok —— 操作确实执行了；但 diff 里塞一行说明，
   * 否则面板显示「共 0 行变化」，用户会以为校验器坏了或脚本没跑。
   */
  if (!diff.length) {
    diff.push(`~ 共 ${operations.length} 条操作已校验通过，但没有任何实际变化（值与原布局相同）。`);
  }

  return { ok: true, issues: [], diff, next: working };
}

/** 提案是否需要人工确认后才能落地。 */
export function proposalNeedsReview(
  extension: AiExtension = DEFAULT_AI_EXTENSION,
): boolean {
  return extension.requiresDiffReview;
}
