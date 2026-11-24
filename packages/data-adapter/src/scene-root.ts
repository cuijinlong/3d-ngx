/**
 * 场景根（scene root）判据。
 *
 * 决策来源：客户 2026-11-22 定案「一个资产不允许挂多个场景实例」。
 *
 * 存储真相是**场景资产 additionalInfo.roots，且 length === 1**。
 * 不新造 `rootAssetId` 字段，原因（已核实平台源码）：`EnergyTopologyService.create/update`
 * 写 additionalInfo 走白名单，请求体里多带的字段不会落库；要加字段就得改 Java。
 * 而 `roots` 复用天然契合 —— 它已经过客户边界校验，也是后端 load() 的 BFS 起点。
 *
 * 存量兼容：库里已有多根（历史 viewType 圈范围用法）和空根的场景，
 * 一律标 `unresolved` 并且**不参与**唯一性检查 —— 拿它们去判冲突会误伤。
 */
import type { TopologyCard } from "./topology-client";

export interface SceneRootRef {
  entityType: "ASSET";
  entityId: string;
  name?: string;
}

/**
 * - declared：恰好一个根，可以参与唯一性判断
 * - unresolved：0 个或多个根，属于存量数据，需要用户在编辑器里收敛
 */
export type SceneRootState = "declared" | "unresolved";

export interface SceneRootInfo {
  state: SceneRootState;
  root?: SceneRootRef;
  /** 根的数量。unresolved 时用它区分「没选」和「选了多个」 */
  count: number;
}

export function sceneRootOf(card: Pick<TopologyCard, "roots" | "rootNames">): SceneRootInfo {
  const roots = (card.roots ?? []).map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean);
  if (roots.length !== 1) {
    return { state: "unresolved", count: roots.length };
  }
  const entityId = roots[0]!;
  const name = card.rootNames?.[0];
  return {
    state: "declared",
    count: 1,
    root: name ? { entityType: "ASSET", entityId, name } : { entityType: "ASSET", entityId },
  };
}

export type SceneRootConflict =
  /** 没被别的场景占用，可以建 / 已经就是这个场景自己的 */
  | { status: "free" }
  /** 已被另一个场景占用。不提供「强制创建」—— 这是产品决策，不是遗漏。 */
  | { status: "conflict"; scene: { id: string; name: string } };

export function checkSceneRootConflict(input: {
  rootAssetId: string;
  /** 编辑态传当前场景 id：命中自己算 free，不算冲突 */
  currentTopologyId?: string;
  /** 同客户、sceneInstance=true 的场景卡片 */
  cards: Array<Pick<TopologyCard, "id" | "name" | "roots">>;
}): SceneRootConflict {
  const rootAssetId = (input.rootAssetId ?? "").trim();
  if (!rootAssetId) return { status: "free" };
  for (const card of input.cards) {
    if (input.currentTopologyId && card.id === input.currentTopologyId) continue;
    const info = sceneRootOf(card);
    /*
     * 只比较 declared 的场景。多根 / 空根的存量场景不参与 ——
     * 否则一个历史脏数据会让别人永远建不了新场景。
     */
    if (info.state !== "declared") continue;
    if (info.root?.entityId !== rootAssetId) continue;
    return { status: "conflict", scene: { id: card.id, name: card.name } };
  }
  return { status: "free" };
}

export type SceneRootIssue = "none" | "no-root" | "multi-root";

/** 场景列表上的只读标记：存量数据不该被当成正常状态显示。 */
export function sceneRootIssueOf(card: Pick<TopologyCard, "roots">): SceneRootIssue {
  const info = sceneRootOf(card);
  if (info.state === "declared") return "none";
  return info.count === 0 ? "no-root" : "multi-root";
}

export const SCENE_ROOT_ISSUE_LABELS: Record<Exclude<SceneRootIssue, "none">, string> = {
  "no-root": "未绑定资产",
  "multi-root": "绑定了多个资产",
};
