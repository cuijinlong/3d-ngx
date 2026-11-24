import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneDocument } from "@idt/shared-types";

const mocks = vi.hoisted(() => ({
  getTopologyApi: vi.fn(),
  getConnectedGuardClient: vi.fn(),
  uploadAsset: vi.fn(),
  update: vi.fn(),
  putBindings: vi.fn(),
  putWidgets: vi.fn(),
  getJumps: vi.fn(),
  putJumps: vi.fn(),
  readSceneJumpDraft: vi.fn(),
  clearSceneWidgetDraft: vi.fn(),
  getAsset: vi.fn(),
  readAssetBuffer: vi.fn(),
  saveScene: vi.fn(async (doc: SceneDocument) => doc),
}));

vi.mock("@idt/data-adapter", () => ({
  getTopologyApi: mocks.getTopologyApi,
  getConnectedGuardClient: mocks.getConnectedGuardClient,
  readSceneJumpDraft: mocks.readSceneJumpDraft,
  clearSceneWidgetDraft: mocks.clearSceneWidgetDraft,
  SCENE_WIDGETS_EMPTY: { schemaVersion: "1.0.0", widgets: [] },
  SceneStorageApi: class {
    putBindings = mocks.putBindings;
    putWidgets = mocks.putWidgets;
    getJumps = mocks.getJumps;
    putJumps = mocks.putJumps;
  },
}));

vi.mock("../asset/assetService", () => ({
  getAsset: mocks.getAsset,
  readAssetBuffer: mocks.readAssetBuffer,
}));

vi.mock("./sceneService", () => ({
  saveScene: mocks.saveScene,
}));

import {
  publishSceneToPlatform,
  PUBLISH_NEED_CONNECTION_MESSAGE,
  PUBLISH_NEED_MODEL_MESSAGE,
  PUBLISH_NEED_TOPOLOGY_MESSAGE,
  PUBLISH_WRITE_FAILED_MESSAGE,
} from "./publish-scene-to-platform";

function doc(patch: Partial<SceneDocument> = {}): SceneDocument {
  return {
    schemaVersion: "1.0.0",
    scene: { id: "scene-1", name: "测试场景", createdAt: "t", updatedAt: "t" },
    settings: { background: "#dce3ed", environment: null, gridEnabled: true },
    entities: [],
    bindings: [],
    platform: {
      customerId: "cust-1",
      siteId: "site-1",
      topologyId: "topo-1",
      topologyName: "测试场景",
      viewType: "space",
      sceneInstance: true,
      publishState: "draft",
    },
    ...patch,
  };
}

describe("publishSceneToPlatform", () => {
  beforeEach(() => {
    mocks.getTopologyApi.mockReset();
    mocks.getConnectedGuardClient.mockReset();
    mocks.uploadAsset.mockReset();
    mocks.update.mockReset();
    mocks.putBindings.mockReset();
    mocks.putWidgets.mockReset();
    mocks.getJumps.mockReset();
    mocks.putJumps.mockReset();
    mocks.readSceneJumpDraft.mockReset();
    mocks.clearSceneWidgetDraft.mockReset();
    mocks.getAsset.mockReset();
    mocks.readAssetBuffer.mockReset();
    mocks.saveScene.mockReset();
    mocks.saveScene.mockImplementation(async (next: SceneDocument) => next);
    mocks.getTopologyApi.mockReturnValue({ uploadAsset: mocks.uploadAsset, update: mocks.update });
    mocks.getConnectedGuardClient.mockReturnValue({ ok: true });
    mocks.putBindings.mockImplementation(async (_id: string, document: { bindings: unknown }) => document);
    mocks.putWidgets.mockImplementation(async (_id: string, document: unknown) => document);
    mocks.getJumps.mockResolvedValue([]);
    mocks.putJumps.mockResolvedValue([]);
    mocks.readSceneJumpDraft.mockReturnValue(null);
    mocks.update.mockImplementation(async (_id: string, input: { publishState?: string; glb?: { objectKey: string } }) => ({
      id: "topo-1",
      name: "测试场景",
      sceneInstance: true,
      publishState: input.publishState,
      glb: input.glb,
    }));
  });

  it("refuses to publish when the scene is not attached to a topology", async () => {
    const local = doc({ platform: undefined });
    await expect(publishSceneToPlatform({ document: local })).rejects.toThrow(PUBLISH_NEED_TOPOLOGY_MESSAGE);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses to publish when there is no local model and no platform objectKey", async () => {
    const local = doc();
    await expect(publishSceneToPlatform({ document: local })).rejects.toThrow(PUBLISH_NEED_MODEL_MESSAGE);
    expect(mocks.uploadAsset).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.putBindings).not.toHaveBeenCalled();
    expect(mocks.putWidgets).not.toHaveBeenCalled();
    expect(mocks.putJumps).not.toHaveBeenCalled();
    expect(mocks.saveScene).not.toHaveBeenCalled();
  });

  it("refuses to mark the local scene published when the platform is disconnected", async () => {
    mocks.getTopologyApi.mockImplementation(() => {
      throw new Error("尚未连接后端，无法读取设备拓扑");
    });
    mocks.getConnectedGuardClient.mockReturnValue(null);
    await expect(publishSceneToPlatform({ document: doc() })).rejects.toThrow(PUBLISH_NEED_CONNECTION_MESSAGE);
    expect(mocks.saveScene).not.toHaveBeenCalled();
  });

  it("uploads a local model, writes attributes, then sets publishState last", async () => {
    const local = doc({ rootAssetId: "asset-local-1" });
    mocks.getAsset.mockResolvedValue({ id: "asset-local-1", name: "天骄科技园" });
    mocks.readAssetBuffer.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    mocks.uploadAsset.mockResolvedValue({ objectKey: "topology/tenant/topo-1/model.glb", fileName: "天骄科技园.glb" });
    mocks.readSceneJumpDraft.mockReturnValue({ links: [{ objectId: "obj-1", targets: [] }] });

    const next = await publishSceneToPlatform({
      document: local,
      widgets: { schemaVersion: "1.0.0", widgets: [{ id: "w1", type: "summary" }] as never },
    });

    expect(mocks.uploadAsset).toHaveBeenCalledWith(
      expect.any(File),
      { kind: "glb", siteId: "site-1", topologyId: "topo-1" },
    );
    const file = mocks.uploadAsset.mock.calls[0]?.[0] as File;
    expect(file?.name).toBe("天骄科技园.glb");
    expect(mocks.update.mock.calls[0]?.[1]).toEqual({
      name: "测试场景",
      glb: { objectKey: "topology/tenant/topo-1/model.glb", fileName: "天骄科技园.glb" },
    });
    expect(mocks.putBindings).toHaveBeenCalled();
    expect(mocks.putWidgets).toHaveBeenCalled();
    expect(mocks.putJumps).toHaveBeenCalledWith("topo-1", [{ objectId: "obj-1", targets: [] }]);
    expect(mocks.update.mock.calls.at(-1)?.[1]).toEqual({ publishState: "published" });
    expect(next.platform?.publishState).toBe("published");
    expect(next.platform?.glb?.objectKey).toBe("topology/tenant/topo-1/model.glb");
    expect(next.scene.publishedAt).toBeTruthy();
    expect(mocks.saveScene).toHaveBeenCalled();
  });

  it("does not stamp local published when writing publishState fails", async () => {
    const local = doc({
      platform: {
        customerId: "cust-1",
        siteId: "site-1",
        topologyId: "topo-1",
        topologyName: "测试场景",
        viewType: "space",
        sceneInstance: true,
        publishState: "draft",
        glb: { objectKey: "topology/tenant/topo-1/model.glb" },
      },
    });
    mocks.update
      .mockResolvedValueOnce({ id: "topo-1", glb: { objectKey: "topology/tenant/topo-1/model.glb" } })
      .mockRejectedValueOnce(new Error("请求失败 500"));
    await expect(publishSceneToPlatform({ document: local })).rejects.toThrow("请求失败 500");
    expect(mocks.saveScene).not.toHaveBeenCalled();
  });

  it("does not disguise a failed upload as a successful publish", async () => {
    const local = doc({ rootAssetId: "asset-local-1" });
    mocks.getAsset.mockResolvedValue({ id: "asset-local-1", name: "model" });
    mocks.readAssetBuffer.mockResolvedValue(new Uint8Array([1]).buffer);
    mocks.uploadAsset.mockResolvedValue({ objectKey: "" });
    await expect(publishSceneToPlatform({ document: local })).rejects.toThrow(PUBLISH_WRITE_FAILED_MESSAGE);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.saveScene).not.toHaveBeenCalled();
  });
});
