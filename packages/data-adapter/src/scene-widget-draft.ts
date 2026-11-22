import { LOCAL_DRAFT_NOTICE } from "./scene-storage-errors";
import { parseSceneWidgetLayout, type SceneWidgetLayout } from "./scene-widget-layout";

export const SCENE_WIDGET_DRAFT_NOTICE = LOCAL_DRAFT_NOTICE;
export const SCENE_WIDGET_DRAFT_STORAGE_KEY = "idt-3d-ngx-scene-widget-draft";

export interface SceneWidgetDraft {
  topologyId: string;
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

export function readSceneWidgetDraft(
  topologyId: string,
  storage?: Storage | null,
): SceneWidgetDraft | null {
  if (!topologyId) return null;
  const row = readMap(storage)[topologyId];
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.topologyId !== "string" || rec.topologyId !== topologyId) return null;
  return {
    topologyId,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : new Date().toISOString(),
    document: parseSceneWidgetLayout(rec.document),
  };
}

export function writeSceneWidgetDraft(
  draft: Omit<SceneWidgetDraft, "updatedAt"> & { updatedAt?: string },
  storage?: Storage | null,
): SceneWidgetDraft {
  const next: SceneWidgetDraft = {
    topologyId: draft.topologyId,
    document: parseSceneWidgetLayout(draft.document),
    updatedAt: draft.updatedAt ?? new Date().toISOString(),
  };
  const map = readMap(storage);
  map[next.topologyId] = next;
  writeMap(map, storage);
  return next;
}

export function clearSceneWidgetDraft(topologyId: string, storage?: Storage | null): void {
  if (!topologyId) return;
  const map = readMap(storage);
  if (!(topologyId in map)) return;
  delete map[topologyId];
  writeMap(map, storage);
}
