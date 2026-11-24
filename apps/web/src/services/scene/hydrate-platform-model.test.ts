import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneDocument } from "@idt/shared-types";

const mocks = vi.hoisted(() => ({
  getTopologyApi: vi.fn(),
  downloadAsset: vi.fn(),
  parseHmiGlb: vi.fn(),
  importAssetFile: vi.fn(),
  uniqueEntitiesFromParsed: vi.fn(),
}));

vi.mock("@idt/data-adapter", () => ({
  getTopologyApi: mocks.getTopologyApi,
}));

vi.mock("@idt/engine-adapter", () => ({
  parseHmiGlb: mocks.parseHmiGlb,
}));

vi.mock("../asset/assetService", () => ({
  importAssetFile: mocks.importAssetFile,
}));

vi.mock("../../utils/hmi-entities", () => ({
  uniqueEntitiesFromParsed: mocks.uniqueEntitiesFromParsed,
}));

import { hydrateRootModelFromPlatform, SCENE_MODEL_LOAD_FAILED_MESSAGE } from "./hydrate-platform-model";

function stub(patch: Partial<SceneDocument> = {}): SceneDocument {
  return {
    schemaVersion: "1.0.0",
    scene: { id: "scene-1", name: "测试场景", createdAt: "t", updatedAt: "t" },
    settings: { background: "#dce3ed", environment: null, gridEnabled: true },
    entities: [],
    bindings: [],
    platform: { customerId: "cust-1", siteId: "site-1", topologyId: "topo-1", topologyName: "测试场景", viewType: "space" },
    ...patch,
  };
}

describe("hydrateRootModelFromPlatform", () => {
  beforeEach(() => {
    mocks.getTopologyApi.mockReset();
    mocks.downloadAsset.mockReset();
    mocks.parseHmiGlb.mockReset();
    mocks.importAssetFile.mockReset();
    mocks.uniqueEntitiesFromParsed.mockReset();
    mocks.getTopologyApi.mockReturnValue({ downloadAsset: mocks.downloadAsset });
  });

  it("leaves a document without objectKey unchanged", async () => {
    const doc = stub();
    await expect(hydrateRootModelFromPlatform(doc)).resolves.toBe(doc);
    expect(mocks.downloadAsset).not.toHaveBeenCalled();
  });

  it("imports the platform glb and attaches the parsed HMI snapshot", async () => {
    const doc = stub({
      platform: {
        customerId: "cust-1",
        siteId: "site-1",
        topologyId: "topo-1",
        topologyName: "测试场景",
        viewType: "space",
        glb: { objectKey: "sites/site-1/topo-1/model.glb", fileName: "天骄科技园.glb" },
      },
    });
    const buffer = new Uint8Array([103, 108, 84, 70]).buffer;
    mocks.downloadAsset.mockResolvedValue(buffer);
    mocks.parseHmiGlb.mockReturnValue({ source: "glb", name: "天骄科技园", bindables: [{ node: "AHU-1", name: "模块机1" }] });
    mocks.importAssetFile.mockResolvedValue({ id: "asset-local-1" });
    mocks.uniqueEntitiesFromParsed.mockReturnValue([{ node: "AHU-1", name: "模块机1" }]);

    const next = await hydrateRootModelFromPlatform(doc);
    expect(mocks.downloadAsset).toHaveBeenCalledWith("sites/site-1/topo-1/model.glb");
    expect(mocks.importAssetFile).toHaveBeenCalled();
    const file = mocks.importAssetFile.mock.calls[0]?.[0] as File;
    expect(file?.name).toBe("天骄科技园.glb");
    expect(next.rootAssetId).toBe("asset-local-1");
    expect(next.hmiSnapshot).toEqual({ source: "glb", name: "天骄科技园", bindableCount: 1 });
    expect(next.entities).toEqual([
      expect.objectContaining({ id: "AHU-1", name: "模块机1", nodeName: "AHU-1", assetId: "asset-local-1" }),
    ]);
  });

  it("does not disguise a download failure as a missing scene", async () => {
    const doc = stub({
      platform: {
        customerId: "cust-1",
        siteId: "site-1",
        topologyId: "topo-1",
        topologyName: "测试场景",
        viewType: "space",
        glb: { objectKey: "sites/site-1/topo-1/model.glb" },
      },
    });
    mocks.downloadAsset.mockRejectedValue(new Error("请求失败 500"));
    await expect(hydrateRootModelFromPlatform(doc)).rejects.toThrow(SCENE_MODEL_LOAD_FAILED_MESSAGE);
  });
});
