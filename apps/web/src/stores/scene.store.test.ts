import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneDocument } from "@idt/shared-types";

const mocks = vi.hoisted(() => ({
  getSceneByTopologyId: vi.fn(),
  getScene: vi.fn(),
  inspectTopologyScene: vi.fn(),
  saveScene: vi.fn(),
  getConnectedGuardClient: vi.fn(() => null),
  resolveSceneBindings: vi.fn(),
  resolveSceneWidgets: vi.fn(),
  saveSceneBindings: vi.fn(),
  saveSceneWidgets: vi.fn(),
  hydrateRootModelFromPlatform: vi.fn(async (document: SceneDocument) => document),
}));

vi.mock("../services/scene/sceneService", () => ({
  getSceneByTopologyId: mocks.getSceneByTopologyId,
  getScene: mocks.getScene,
  inspectTopologyScene: mocks.inspectTopologyScene,
  saveScene: mocks.saveScene,
}));

vi.mock("../services/scene/hydrate-platform-model", () => ({
  hydrateRootModelFromPlatform: mocks.hydrateRootModelFromPlatform,
}));

vi.mock("@idt/data-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@idt/data-adapter")>();
  return {
    ...actual,
    getConnectedGuardClient: mocks.getConnectedGuardClient,
    resolveSceneBindings: mocks.resolveSceneBindings,
    resolveSceneWidgets: mocks.resolveSceneWidgets,
    saveSceneBindings: mocks.saveSceneBindings,
    saveSceneWidgets: mocks.saveSceneWidgets,
  };
});

import { SCENE_OPEN_ERRORS } from "../services/scene/open-scene";
import { setSceneLoadTimeoutForTests, useSceneStore } from "./scene.store";

function doc(topologyId: string, name = "场站总览"): SceneDocument {
  return {
    schemaVersion: "1.0.0",
    scene: { id: `local-${topologyId}`, name, createdAt: "t", updatedAt: "t" },
    settings: { background: "#dce3ed", environment: null, gridEnabled: true },
    entities: [],
    bindings: [],
    platform: { customerId: "cust-1", siteId: "site-1", topologyId, topologyName: name, viewType: "space" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("scene store load cancellation", () => {
  beforeEach(() => {
    mocks.getSceneByTopologyId.mockReset();
    mocks.getScene.mockReset();
    mocks.inspectTopologyScene.mockReset();
    mocks.saveScene.mockReset();
    mocks.hydrateRootModelFromPlatform.mockReset();
    mocks.hydrateRootModelFromPlatform.mockImplementation(async (document: SceneDocument) => document);
    mocks.resolveSceneBindings.mockReset();
    mocks.resolveSceneWidgets.mockReset();
    mocks.resolveSceneBindings.mockResolvedValue({ source: "empty", document: { bindings: [] } });
    mocks.resolveSceneWidgets.mockResolvedValue({ source: "empty", document: { widgets: [] } });
    mocks.getConnectedGuardClient.mockReturnValue(null);
    setSceneLoadTimeoutForTests(40);
    useSceneStore.getState().reset();
  });

  afterEach(() => {
    setSceneLoadTimeoutForTests();
    useSceneStore.getState().reset();
  });

  it("does not write a late success back after the open timeout", async () => {
    const pending = deferred<SceneDocument | undefined>();
    mocks.getSceneByTopologyId.mockReturnValue(pending.promise);
    const done = useSceneStore.getState().load("topo-late", { role: "tenant" });
    await done;
    expect(useSceneStore.getState().error).toBe(SCENE_OPEN_ERRORS.timeout);
    expect(useSceneStore.getState().document).toBeNull();
    expect(useSceneStore.getState().loading).toBe(false);

    pending.resolve(doc("topo-late", "迟到的场景"));
    await Promise.resolve();
    await Promise.resolve();
    expect(useSceneStore.getState().document).toBeNull();
    expect(useSceneStore.getState().error).toBe(SCENE_OPEN_ERRORS.timeout);
  });

  it("does not write a stale request back after leaving the page", async () => {
    const pending = deferred<SceneDocument | undefined>();
    mocks.getSceneByTopologyId.mockReturnValue(pending.promise);
    setSceneLoadTimeoutForTests(5_000);
    const pendingLoad = useSceneStore.getState().load("topo-leave", { role: "tenant" });
    useSceneStore.getState().reset();
    expect(useSceneStore.getState().document).toBeNull();
    expect(useSceneStore.getState().loading).toBe(false);

    pending.resolve(doc("topo-leave", "离开后才回来的场景"));
    await Promise.resolve();
    await Promise.resolve();
    expect(useSceneStore.getState().document).toBeNull();
    expect(useSceneStore.getState().error).toBeNull();
    await pendingLoad;
    expect(useSceneStore.getState().document).toBeNull();
  });
});

describe("scene store open path", () => {
  beforeEach(() => {
    mocks.getSceneByTopologyId.mockReset();
    mocks.getScene.mockReset();
    mocks.inspectTopologyScene.mockReset();
    mocks.hydrateRootModelFromPlatform.mockReset();
    mocks.hydrateRootModelFromPlatform.mockImplementation(async (document: SceneDocument) => document);
    mocks.resolveSceneBindings.mockResolvedValue({ source: "empty", document: { bindings: [] } });
    mocks.resolveSceneWidgets.mockResolvedValue({ source: "empty", document: { widgets: [] } });
    mocks.getConnectedGuardClient.mockReturnValue(null);
    setSceneLoadTimeoutForTests(40);
    useSceneStore.getState().reset();
  });

  afterEach(() => {
    setSceneLoadTimeoutForTests();
    useSceneStore.getState().reset();
  });

  it("opens a platform scene without a model instead of treating it as not found", async () => {
    const stub = doc("topo-open");
    mocks.getSceneByTopologyId.mockResolvedValue(undefined);
    mocks.getScene.mockResolvedValue(undefined);
    mocks.inspectTopologyScene.mockResolvedValue({ status: "ok", document: stub });
    await useSceneStore.getState().load("topo-open", { role: "tenant" });
    expect(useSceneStore.getState().error).toBeNull();
    expect(useSceneStore.getState().document?.platform?.topologyId).toBe("topo-open");
    expect(useSceneStore.getState().document?.rootAssetId).toBeUndefined();
    expect(mocks.hydrateRootModelFromPlatform).not.toHaveBeenCalled();
  });

  it("hydrates a platform glb when the browser has no local rootAssetId", async () => {
    const stub = doc("topo-glb");
    stub.platform = { ...stub.platform!, glb: { objectKey: "sites/site-1/topo-glb/model.glb", fileName: "天骄科技园.glb" } };
    mocks.getSceneByTopologyId.mockResolvedValue(undefined);
    mocks.getScene.mockResolvedValue(undefined);
    mocks.inspectTopologyScene.mockResolvedValue({ status: "ok", document: stub });
    mocks.hydrateRootModelFromPlatform.mockResolvedValue({ ...stub, rootAssetId: "asset-local-1" });
    await useSceneStore.getState().load("topo-glb", { role: "tenant" });
    expect(mocks.hydrateRootModelFromPlatform).toHaveBeenCalled();
    expect(useSceneStore.getState().error).toBeNull();
    expect(useSceneStore.getState().document?.rootAssetId).toBe("asset-local-1");
  });

  it("passes the customer id into inspect", async () => {
    mocks.getSceneByTopologyId.mockResolvedValue(undefined);
    mocks.getScene.mockResolvedValue(undefined);
    mocks.inspectTopologyScene.mockResolvedValue({ status: "not-found" });
    await useSceneStore.getState().load("topo-hidden", { role: "customer", customerId: "cust-1" });
    expect(mocks.inspectTopologyScene).toHaveBeenCalledWith("topo-hidden", "cust-1");
    expect(useSceneStore.getState().error).toBe(SCENE_OPEN_ERRORS["not-found"]);
  });
});
