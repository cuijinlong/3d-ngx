import { DEFAULT_SCENE_DRAFT_NOTICE } from "./default-scene-draft";

export const SCENE_JUMP_DRAFT_NOTICE = DEFAULT_SCENE_DRAFT_NOTICE;
export const SCENE_JUMP_DRAFT_STORAGE_KEY = "idt-3d-ngx-scene-jump-draft";

export interface SceneJumpTarget {
  topologyId: string;
  label: string;
}

export interface SceneJumpLink {
  objectId: string;
  objectLabel?: string;
  targets: SceneJumpTarget[];
}

export interface SceneJumpDraft {
  customerId: string;
  fromTopologyId: string;
  updatedAt: string;
  links: SceneJumpLink[];
}

export type ObjectClickDecision =
  | { action: "select"; node: string | null }
  | { action: "enter"; node: string; topologyId: string }
  | { action: "choose"; node: string; targets: SceneJumpTarget[] };

type DraftMap = Record<string, SceneJumpDraft>;

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readMap(storage?: Storage | null): DraftMap {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    const raw = store?.getItem(SCENE_JUMP_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DraftMap;
  } catch {
    return {};
  }
}

function writeMap(map: DraftMap, storage?: Storage | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    store?.setItem(SCENE_JUMP_DRAFT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 忽略配额或禁用存储 */
  }
}

function keyOf(customerId: string, fromTopologyId: string): string {
  return `${customerId}::${fromTopologyId}`;
}

export function readSceneJumpDraft(
  customerId: string,
  fromTopologyId: string,
  storage?: Storage | null,
): SceneJumpDraft | null {
  if (!customerId || !fromTopologyId) return null;
  const row = readMap(storage)[keyOf(customerId, fromTopologyId)];
  if (!row?.fromTopologyId) return null;
  return row;
}

export function writeSceneJumpDraft(
  draft: Omit<SceneJumpDraft, "updatedAt"> & { updatedAt?: string },
  storage?: Storage | null,
): SceneJumpDraft {
  const next: SceneJumpDraft = {
    customerId: draft.customerId,
    fromTopologyId: draft.fromTopologyId,
    links: draft.links,
    updatedAt: draft.updatedAt ?? new Date().toISOString(),
  };
  const map = readMap(storage);
  map[keyOf(next.customerId, next.fromTopologyId)] = next;
  writeMap(map, storage);
  return next;
}

export function setObjectJumpTargets(
  customerId: string,
  fromTopologyId: string,
  objectId: string,
  targets: SceneJumpTarget[],
  objectLabel?: string,
  storage?: Storage | null,
): SceneJumpDraft {
  const current = readSceneJumpDraft(customerId, fromTopologyId, storage);
  const rest = (current?.links ?? []).filter((link) => link.objectId !== objectId);
  const links = targets.length ? [...rest, { objectId, objectLabel, targets }] : rest;
  return writeSceneJumpDraft({ customerId, fromTopologyId, links }, storage);
}

export function resolveJumpTargets(links: SceneJumpLink[], objectId: string | null | undefined): SceneJumpTarget[] {
  if (!objectId) return [];
  return links.find((link) => link.objectId === objectId)?.targets ?? [];
}

/**
 * 点对象时的观看态决策：控制面板/屏幕只选中所属设备、不跳；
 * 未配置只选中；一个目标直接进；多个先选再进。不要自动钻到第一项。
 */
export function decideObjectClick(input: {
  rawNode?: string | null;
  resolvedNode?: string | null;
  isControlOrScreen?: boolean;
  links?: SceneJumpLink[];
}): ObjectClickDecision {
  const node = input.resolvedNode ?? null;
  if (input.isControlOrScreen) return { action: "select", node };
  if (!node) return { action: "select", node: null };
  const targets = resolveJumpTargets(input.links ?? [], node).filter((item) => item.topologyId);
  if (targets.length === 0) return { action: "select", node };
  if (targets.length === 1) return { action: "enter", node, topologyId: targets[0]!.topologyId };
  return { action: "choose", node, targets };
}
