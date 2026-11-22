
import Dexie, { type Table } from "dexie";
import type { Device, ModelAsset, SceneDocument, SceneVersion } from "@idt/shared-types";

export interface StoredAsset extends ModelAsset {
  blob?: Blob;
}

export interface UiPrefs {
  id: "prefs";
  lastSceneId?: string;
  lastRuntimeId?: string;
}

class IdtDatabase extends Dexie {
  scenes!: Table<SceneDocument, string>;
  assets!: Table<StoredAsset, string>;
  devices!: Table<Device, string>;
  versions!: Table<SceneVersion, string>;
  prefs!: Table<UiPrefs, string>;

  constructor() {
    super("idt-3d-ngx");
    this.version(1).stores({
      scenes: "scene.id, scene.updatedAt, scene.name",
      assets: "id, type, name, updatedAt",
      devices: "id, name, type",
      versions: "id, sceneId, version, createdAt",
      prefs: "id",
    });
  }
}

export const db = new IdtDatabase();

export async function getPrefs(): Promise<UiPrefs> {
  const row = await db.prefs.get("prefs");
  return row ?? { id: "prefs" };
}

export async function patchPrefs(patch: Partial<Omit<UiPrefs, "id">>): Promise<void> {
  const current = await getPrefs();
  await db.prefs.put({ ...current, ...patch, id: "prefs" });
}
