import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENE_DRAFT_NOTICE,
  DEFAULT_SCENE_DRAFT_STORAGE_KEY,
  readDefaultSceneDraft,
  writeDefaultSceneDraft,
} from "./default-scene-draft";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("default scene local draft", () => {
  it("stores a per-customer topologyId pointer and marks it unpublished", () => {
    const storage = new MemoryStorage();
    const draft = writeDefaultSceneDraft("cust-1", "topo-9", storage, () => "2026-11-21T13:00:00.000Z");
    expect(DEFAULT_SCENE_DRAFT_NOTICE).toBe("未落库 / 本地草稿");
    expect(draft).toEqual({
      customerId: "cust-1",
      topologyId: "topo-9",
      updatedAt: "2026-11-21T13:00:00.000Z",
    });
    expect(JSON.parse(storage.getItem(DEFAULT_SCENE_DRAFT_STORAGE_KEY) || "{}")["cust-1"].sceneId).toBeUndefined();
    expect(readDefaultSceneDraft("cust-1", storage)?.topologyId).toBe("topo-9");
    expect(readDefaultSceneDraft("other", storage)).toBeNull();
  });

  it("migrates a legacy sceneId draft when it can be resolved, otherwise discards it", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      DEFAULT_SCENE_DRAFT_STORAGE_KEY,
      JSON.stringify({ "cust-1": { customerId: "cust-1", sceneId: "scene-old", updatedAt: "2026-11-21T12:00:00.000Z" } }),
    );
    expect(readDefaultSceneDraft("cust-1", storage)).toBeNull();
    const migrated = readDefaultSceneDraft("cust-1", storage, (sceneId) => (sceneId === "scene-old" ? "topo-from-local" : undefined));
    expect(migrated?.topologyId).toBe("topo-from-local");
    expect(readDefaultSceneDraft("cust-1", storage)?.topologyId).toBe("topo-from-local");
    expect(JSON.parse(storage.getItem(DEFAULT_SCENE_DRAFT_STORAGE_KEY) || "{}")["cust-1"].sceneId).toBeUndefined();
  });
});
