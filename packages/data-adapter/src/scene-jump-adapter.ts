import type { SceneJumpLink } from "./scene-jump-draft";

export interface SceneJumpApiTarget {
  objectId: string;
  label?: string;
}

export interface SceneJumpApiRow {
  fromId?: string;
  toId: string;
  toName?: string;
  targets?: SceneJumpApiTarget[];
  objectId?: string;
  label?: string;
}

export interface SceneJumpPutBody {
  jumps: Array<{ toId: string; targets: SceneJumpApiTarget[] }>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function targetsOf(row: SceneJumpApiRow): SceneJumpApiTarget[] {
  const listed = Array.isArray(row.targets) ? row.targets : [];
  const fromArray = listed
    .map((item) => ({ objectId: text(item?.objectId), label: text(item?.label) || undefined }))
    .filter((item) => item.objectId);
  if (fromArray.length) return fromArray;
  const objectId = text(row.objectId);
  if (!objectId) return [];
  return [{ objectId, label: text(row.label) || undefined }];
}

/** 本地对象中心 links → 接口 toId 中心 jumps（同一 toId 上多个对象合并进 targets）。 */
export function jumpsFromObjectLinks(links: SceneJumpLink[]): SceneJumpPutBody {
  const byTo = new Map<string, SceneJumpApiTarget[]>();
  for (const link of links) {
    const objectId = text(link.objectId);
    if (!objectId) continue;
    for (const target of link.targets ?? []) {
      const toId = text(target.topologyId);
      if (!toId) continue;
      const list = byTo.get(toId) ?? [];
      if (!list.some((item) => item.objectId === objectId)) {
        list.push({ objectId, label: text(target.label) || undefined });
      }
      byTo.set(toId, list);
    }
  }
  return {
    jumps: [...byTo.entries()].map(([toId, targets]) => ({ toId, targets })),
  };
}

/** 接口 toId 中心行 → 本地对象中心 links（同一 objectId 的多个下级收成一条）。 */
export function objectLinksFromJumps(rows: SceneJumpApiRow[]): SceneJumpLink[] {
  const toNameById = new Map<string, string>();
  for (const row of rows ?? []) {
    const toId = text(row.toId);
    const name = text(row.toName);
    if (toId && name && !toNameById.has(toId)) toNameById.set(toId, name);
  }
  const byObject = new Map<string, SceneJumpLink>();
  for (const row of rows ?? []) {
    const toId = text(row.toId);
    if (!toId) continue;
    for (const target of targetsOf(row)) {
      const current = byObject.get(target.objectId) ?? { objectId: target.objectId, targets: [] };
      if (!current.targets.some((item) => item.topologyId === toId)) {
        current.targets.push({
          topologyId: toId,
          label: target.label || text(row.toName) || toNameById.get(toId) || "",
        });
      }
      byObject.set(target.objectId, current);
    }
  }
  return [...byObject.values()];
}

export function parseSceneJumpRows(payload: unknown): SceneJumpApiRow[] {
  if (Array.isArray(payload)) return payload as SceneJumpApiRow[];
  if (payload && typeof payload === "object") {
    const row = payload as { jumps?: unknown; data?: unknown; content?: unknown };
    const listed = row.jumps ?? row.data ?? row.content;
    if (Array.isArray(listed)) return listed as SceneJumpApiRow[];
  }
  return [];
}
