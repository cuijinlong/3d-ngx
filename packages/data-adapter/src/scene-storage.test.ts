import { describe, expect, it, vi, beforeEach } from "vitest";
import { GuardHttpError, type GuardClient } from "./guard-client";
import { isSceneStorageUnmounted } from "./scene-storage-errors";
import {
  objectLinksFromJumps,
  jumpsFromObjectLinks,
} from "./scene-jump-adapter";
import {
  SceneStorageApi,
  parseBindings,
  parseDefaultScene,
  parseWidgets,
  resetSceneStorageAvailabilityForTests,
  resolveDefaultScene,
  resolveSceneWidgets,
  saveDefaultScene,
  saveSceneJumps,
  saveSceneWidgets,
} from "./scene-storage";
import { DEFAULT_SCENE_DRAFT_STORAGE_KEY, readDefaultSceneDraft } from "./default-scene-draft";
import { readSceneJumpDraft, SCENE_JUMP_DRAFT_STORAGE_KEY } from "./scene-jump-draft";
import { readSceneWidgetDraft, SCENE_WIDGET_DRAFT_STORAGE_KEY, widgetDraftKey } from "./scene-widget-draft";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, value); },
  } as Storage;
}

describe("scene storage client", () => {
  beforeEach(() => {
    resetSceneStorageAvailabilityForTests();
  });

  it("treats HTML or bare 404 as unmounted, but ITEM_NOT_FOUND as a live endpoint", () => {
    expect(isSceneStorageUnmounted(new GuardHttpError("not found", 404, "<!doctype html>"))).toBe(true);
    expect(isSceneStorageUnmounted(new GuardHttpError("No static resource", 404, "No static resource scene-jumps"))).toBe(true);
    expect(isSceneStorageUnmounted(new GuardHttpError("拓扑不存在", 404, JSON.stringify({ status: 404, message: "拓扑不存在", errorCode: 32 })))).toBe(false);
    expect(isSceneStorageUnmounted(new GuardHttpError("无权访问", 403, JSON.stringify({ status: 403, errorCode: 20 })))).toBe(false);
  });

  it("parses default-scene, bindings and empty widgets documents", () => {
    expect(parseDefaultScene({ customerId: "cust-1", topologyId: "topo-a" }, "cust-1")).toEqual({
      customerId: "cust-1",
      topologyId: "topo-a",
    });
    expect(parseDefaultScene({ customerId: "cust-1", topologyId: null }, "cust-1").topologyId).toBeNull();
    const bindings = parseBindings({
      schemaVersion: "1.0.0",
      bindings: [{ id: "b1", sceneEntityId: "obj-1", deviceId: "dev-1", deviceName: "冷冻泵" }],
    });
    expect(bindings.bindings[0]?.deviceId).toBe("dev-1");
    expect(parseWidgets({ schemaVersion: "1.0.0", widgets: [] }).widgets).toEqual([]);
  });

  it("still assigns unique binding ids when randomUUID is missing", () => {
    const originalRandomUUID = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    try {
      const first = parseBindings({
        schemaVersion: "1.0.0",
        bindings: [{ sceneEntityId: "obj-1", deviceId: "dev-1", deviceName: "冷冻泵" }],
      });
      const second = parseBindings({
        schemaVersion: "1.0.0",
        bindings: [{ sceneEntityId: "obj-2", deviceId: "dev-2" }],
      });
      expect(first.bindings[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(second.bindings[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(first.bindings[0]?.id).not.toBe(second.bindings[0]?.id);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  it("calls the energy default-scene, bindings, widgets and jumps endpoints", async () => {
    const requestJson = vi.fn(async (method: string, path: string) => {
      if (path.endsWith("/default-scene") && method === "GET") return { customerId: "cust-1", topologyId: "topo-a" };
      if (path.endsWith("/scene-bindings") && method === "GET") return { schemaVersion: "1.0.0", bindings: [] };
      if (path.endsWith("/scene-widgets") && method === "PUT") return { schemaVersion: "1.0.0", widgets: [] };
      if (path.endsWith("/scene-jumps") && method === "PUT") {
        return { jumps: [{ toId: "topo-b", targets: [{ objectId: "obj-a", label: "机房" }] }] };
      }
      return {};
    });
    const api = new SceneStorageApi({ requestJson } as unknown as GuardClient);
    expect(await api.getDefaultScene("cust-1")).toEqual({ customerId: "cust-1", topologyId: "topo-a" });
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/energy/customers/cust-1/default-scene");
    await api.getBindings("topo-a");
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/energy/topologies/topo-a/scene-bindings");
    await api.putWidgets("topo-a", { schemaVersion: "1.0.0", widgets: [] });
    expect(requestJson).toHaveBeenCalledWith("PUT", "/api/energy/topologies/topo-a/scene-widgets", { schemaVersion: "1.0.0", widgets: [] });
    const links = await api.putJumps("topo-a", [{ objectId: "obj-a", targets: [{ topologyId: "topo-b", label: "机房" }] }]);
    expect(requestJson).toHaveBeenCalledWith(
      "PUT",
      "/api/energy/topologies/topo-a/scene-jumps",
      jumpsFromObjectLinks([{ objectId: "obj-a", targets: [{ topologyId: "topo-b", label: "机房" }] }]),
    );
    expect(links).toEqual(objectLinksFromJumps([{ toId: "topo-b", targets: [{ objectId: "obj-a", label: "机房" }] }]));
  });

  it("falls back to a marked local draft when default-scene is not mounted", async () => {
    const storage = memoryStorage();
    const requestJson = vi.fn(async () => {
      throw new GuardHttpError("Not Found", 404, "<!doctype html>");
    });
    const client = { requestJson } as unknown as GuardClient;
    const resolved = await resolveDefaultScene(client, "cust-1", undefined, storage);
    expect(resolved).toEqual({ customerId: "cust-1", topologyId: null, source: "local-draft" });
    const saved = await saveDefaultScene(client, "cust-1", "topo-a", storage);
    expect(saved.source).toBe("local-draft");
    expect(readDefaultSceneDraft("cust-1", storage)?.topologyId).toBe("topo-a");
    expect(storage.getItem(DEFAULT_SCENE_DRAFT_STORAGE_KEY)).toContain("topo-a");
  });

  it("clears the local default draft after a successful platform PUT", async () => {
    const storage = memoryStorage();
    const requestJson = vi.fn(async () => ({ customerId: "cust-1", topologyId: "topo-a" }));
    const saved = await saveDefaultScene({ requestJson } as unknown as GuardClient, "cust-1", "topo-a", storage);
    expect(saved).toEqual({ customerId: "cust-1", topologyId: "topo-a", source: "platform" });
    expect(readDefaultSceneDraft("cust-1", storage)).toBeNull();
  });

  it("keeps object-centered local jump drafts when the jumps API is unmounted", async () => {
    const storage = memoryStorage();
    const requestJson = vi.fn(async () => {
      throw new GuardHttpError("Not Found", 404, "No static resource");
    });
    const links = [{ objectId: "obj-a", targets: [{ topologyId: "topo-b", label: "机房" }] }];
    const saved = await saveSceneJumps({ requestJson } as unknown as GuardClient, "cust-1", "topo-a", links, storage);
    expect(saved.source).toBe("local-draft");
    expect(readSceneJumpDraft("cust-1", "topo-a", storage)?.links).toEqual(links);
    expect(storage.getItem(SCENE_JUMP_DRAFT_STORAGE_KEY)).toContain("obj-a");
  });

  it("treats default-scene 404 ITEM_NOT_FOUND as an empty pointer, not a read failure", async () => {
    const requestJson = vi.fn(async () => {
      throw new GuardHttpError("未设置默认场景", 404, JSON.stringify({ status: 404, message: "未设置默认场景", errorCode: 32 }));
    });
    const resolved = await resolveDefaultScene({ requestJson } as unknown as GuardClient, "cust-1");
    expect(resolved).toEqual({ customerId: "cust-1", topologyId: null, source: "platform" });
  });

  it("writes a durable local widget draft when PUT scene-widgets fails, and clears it after a successful platform write", async () => {
    const storage = memoryStorage();
    const layout = { schemaVersion: "1.0.0" as const, glassOpacity: 0.8, widgets: [] };
    const requestJson = vi.fn(async () => {
      throw new GuardHttpError("Not Found", 404, "<!doctype html>");
    });
    const saved = await saveSceneWidgets({ requestJson } as unknown as GuardClient, "topo-a", {
      schemaVersion: "1.0.0",
      glassOpacity: 0.8,
      widgets: [{ id: "w1", type: "metric-card", x: 30, y: 74, w: 16, h: 12, style: { opacity: 0.6 } }],
    }, storage);
    expect(saved.source).toBe("local-draft");
    expect(readSceneWidgetDraft("topo-a", storage)?.document.widgets).toHaveLength(1);
    expect(storage.getItem(SCENE_WIDGET_DRAFT_STORAGE_KEY)).toContain("metric-card");

    const resolved = await resolveSceneWidgets({ requestJson } as unknown as GuardClient, "topo-a", undefined, storage);
    expect(resolved.source).toBe("local-draft");
    expect(resolved.document.glassOpacity).toBe(0.8);
    expect(resolved.document.widgets[0]?.style?.opacity).toBe(0.6);

    const ok = vi.fn(async (_method: string, _path: string, body?: unknown) => body ?? { schemaVersion: "1.0.0", widgets: [] });
    const published = await saveSceneWidgets({ requestJson: ok } as unknown as GuardClient, "topo-a", saved.document, storage);
    expect(published.source).toBe("platform");
    expect(readSceneWidgetDraft("topo-a", storage)).toBeNull();
  });

  it("writes a scene-keyed local widget draft when there is no topologyId, and resolve can read it back after refresh", async () => {
    const storage = memoryStorage();
    const layout = {
      schemaVersion: "1.0.0" as const,
      glassOpacity: 0.72,
      widgets: [{ id: "w1", type: "metric-card", x: 30, y: 74, w: 16, h: 12 }],
    };
    const requestJson = vi.fn(async () => {
      throw new Error("should not call the platform without a topologyId");
    });
    const saved = await saveSceneWidgets({ requestJson } as unknown as GuardClient, null, layout, storage, "scene-local");
    expect(saved.source).toBe("local-draft");
    expect(requestJson).not.toHaveBeenCalled();
    expect(widgetDraftKey({ sceneId: "scene-local" })).toBe("scene:scene-local");
    expect(readSceneWidgetDraft({ sceneId: "scene-local" }, storage)?.document.widgets).toHaveLength(1);
    expect(storage.getItem(SCENE_WIDGET_DRAFT_STORAGE_KEY)).toContain("scene:scene-local");

    const refreshed = memoryStorage();
    refreshed.setItem(SCENE_WIDGET_DRAFT_STORAGE_KEY, storage.getItem(SCENE_WIDGET_DRAFT_STORAGE_KEY)!);
    const resolved = await resolveSceneWidgets(null, null, undefined, refreshed, "scene-local");
    expect(resolved.source).toBe("local-draft");
    expect(resolved.document.widgets[0]?.id).toBe("w1");
    expect(resolved.source).not.toBe("platform");
  });
});
