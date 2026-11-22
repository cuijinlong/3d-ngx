import { LOCAL_DRAFT_NOTICE } from "./scene-storage-errors";
import { parseSceneWidgetLayout, type SceneWidgetLayout } from "./scene-widget-layout";

export const SCENE_WIDGET_DRAFT_NOTICE = LOCAL_DRAFT_NOTICE;
export const SCENE_WIDGET_DRAFT_STORAGE_KEY = "idt-3d-ngx-scene-widget-draft";

export interface SceneWidgetDraftRef {
  topologyId?: string | null;
  sceneId?: string | null;
}

export interface SceneWidgetDraft {
  topologyId?: string;
  sceneId?: string;
  updatedAt: string;
  document: SceneWidgetLayout;
}

type DraftMap = Record<string, unknown>;

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
    const raw = store?.getItem(SCENE_WIDGET_DRAFT_STORAGE_KEY);
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
    store?.setItem(SCENE_WIDGET_DRAFT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 忽略配额或禁用存储 */
  }
}

function asRef(ref: string | SceneWidgetDraftRef): SceneWidgetDraftRef {
  return typeof ref === "string" ? { topologyId: ref } : ref;
}

/** 优先 topologyId；没有平台拓扑时用 scene:{sceneId}，仍写在同一 localStorage 键下。 */
export function widgetDraftKey(ref: string | SceneWidgetDraftRef): string | null {
  const row = asRef(ref);
  if (row.topologyId) return row.topologyId;
  if (row.sceneId) return `scene:${row.sceneId}`;
  return null;
}

function lookupRow(ref: string | SceneWidgetDraftRef, storage?: Storage | null): { key: string; rec: Record<string, unknown> } | null {
  const map = readMap(storage);
  const row = asRef(ref);
  const primary = widgetDraftKey(row);
  const keys = [primary];
  if (row.topologyId && row.sceneId) keys.push(`scene:${row.sceneId}`);
  for (const key of keys) {
    if (!key) continue;
    const raw = map[key];
    if (!raw || typeof raw !== "object") continue;
    return { key, rec: raw as Record<string, unknown> };
  }
  return null;
}

function draftFromRow(key: string, rec: Record<string, unknown>): SceneWidgetDraft {
  const topologyId = typeof rec.topologyId === "string" && rec.topologyId ? rec.topologyId : undefined;
  const sceneId = typeof rec.sceneId === "string" && rec.sceneId ? rec.sceneId : key.startsWith("scene:") ? key.slice("scene:".length) : undefined;
  return {
    ...(topologyId ? { topologyId } : {}),
    ...(sceneId ? { sceneId } : {}),
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
    document: parseSceneWidgetLayout(rec.document),
  };
}

export function readSceneWidgetDraft(
  ref: string | SceneWidgetDraftRef,
  storage?: Storage | null,
): SceneWidgetDraft | null {
  const hit = lookupRow(ref, storage);
  if (!hit) return null;
  return draftFromRow(hit.key, hit.rec);
}

export function writeSceneWidgetDraft(
  draft: Omit<SceneWidgetDraft, "updatedAt"> & { updatedAt?: string },
  storage?: Storage | null,
): SceneWidgetDraft {
  const next: SceneWidgetDraft = {
    ...(draft.topologyId ? { topologyId: draft.topologyId } : {}),
    ...(draft.sceneId ? { sceneId: draft.sceneId } : {}),
    document: parseSceneWidgetLayout(draft.document),
    updatedAt: draft.updatedAt ?? new Date().toISOString(),
  };
  const key = widgetDraftKey(next);
  if (key) {
    const map = readMap(storage);
    map[key] = next;
    writeMap(map, storage);
  }
  return next;
}

export function clearSceneWidgetDraft(ref: string | SceneWidgetDraftRef, storage?: Storage | null): void {
  const map = readMap(storage);
  const row = asRef(ref);
  const keys = [widgetDraftKey(row)];
  if (row.sceneId) keys.push(`scene:${row.sceneId}`);
  let changed = false;
  for (const key of keys) {
    if (key && key in map) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writeMap(map, storage);
}
