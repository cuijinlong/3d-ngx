export const DEFAULT_SCENE_DRAFT_NOTICE = "未落库 / 本地草稿";
export const DEFAULT_SCENE_DRAFT_STORAGE_KEY = "idt-3d-ngx-default-scene-draft";

export interface DefaultSceneDraft {
  customerId: string;
  topologyId: string;
  updatedAt: string;
}

type RawDraft = Partial<DefaultSceneDraft> & { sceneId?: string };
type DraftMap = Record<string, RawDraft>;

export type ResolveLegacySceneId = (sceneId: string) => string | undefined;

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
    const raw = store?.getItem(DEFAULT_SCENE_DRAFT_STORAGE_KEY);
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
    store?.setItem(DEFAULT_SCENE_DRAFT_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* 忽略配额或禁用存储 */
  }
}

function topologyFromRaw(row: RawDraft | undefined, resolveLegacy?: ResolveLegacySceneId): string | undefined {
  if (!row) return undefined;
  if (row.topologyId) return row.topologyId;
  if (row.sceneId && resolveLegacy) return resolveLegacy(row.sceneId);
  return undefined;
}

/** 旧草稿若只剩 sceneId：能解析出 topologyId 就迁过去，否则丢弃，不再用 sceneId 当打开主键。 */
export function readDefaultSceneDraft(
  customerId: string,
  storage?: Storage | null,
  resolveLegacy?: ResolveLegacySceneId,
): DefaultSceneDraft | null {
  if (!customerId) return null;
  const row = readMap(storage)[customerId];
  const topologyId = topologyFromRaw(row, resolveLegacy);
  if (!topologyId) return null;
  const draft: DefaultSceneDraft = {
    customerId,
    topologyId,
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
  if (!row?.topologyId) writeMap({ ...readMap(storage), [customerId]: draft }, storage);
  return draft;
}

export function writeDefaultSceneDraft(
  customerId: string,
  topologyId: string,
  storage?: Storage | null,
  now = () => new Date().toISOString(),
): DefaultSceneDraft {
  const draft: DefaultSceneDraft = { customerId, topologyId, updatedAt: now() };
  const map = readMap(storage);
  map[customerId] = draft;
  writeMap(map, storage);
  return draft;
}

export function clearDefaultSceneDraft(customerId: string, storage?: Storage | null): void {
  const map = readMap(storage);
  delete map[customerId];
  writeMap(map, storage);
}
