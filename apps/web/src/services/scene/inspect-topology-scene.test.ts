import { describe, expect, it } from "vitest";
import type { TopologyCard, TopologyGraph } from "@idt/data-adapter";
import { inspectTopologySceneResult } from "./sceneService";

const topologyId = "c2a42730-e5c2-11f1-8972-71dd197ec25f";

function graph(patch: Partial<TopologyGraph> = {}): TopologyGraph {
  return { id: topologyId, name: "scn-7ce48900-测试 拓扑", nodes: [], ...patch };
}

function card(patch: Partial<TopologyCard> = {}): TopologyCard {
  return { id: topologyId, name: "scn-7ce48900-测试 拓扑", ...patch };
}

describe("inspectTopologySceneResult", () => {
  it("opens a scene instance from load even when the list has no card", () => {
    const result = inspectTopologySceneResult({
      topologyId,
      graph: graph({ sceneInstance: true, customerId: "cust-1" }),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.platform?.topologyId).toBe(topologyId);
    expect(result.document.platform?.sceneInstance).toBe(true);
    expect(result.document.rootAssetId).toBeUndefined();
    expect(result.document.platform?.glb).toBeUndefined();
  });

  it("copies platform glb onto the stub document", () => {
    const glb = { objectKey: "sites/site-1/topo/model.glb", fileName: "天骄科技园.glb" };
    const result = inspectTopologySceneResult({
      topologyId,
      graph: graph({ sceneInstance: true, glb }),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.platform?.glb).toEqual(glb);
  });

  it("keeps a missing-model scene as ok, not not-found", () => {
    const result = inspectTopologySceneResult({
      topologyId,
      sceneCard: card({ sceneInstance: true, customerId: "cust-1" }),
    });
    expect(result.status).toBe("ok");
  });

  it("still reports not-found when the platform hides an unpublished draft", () => {
    const result = inspectTopologySceneResult({
      topologyId,
      loadFailed: new Error("拓扑不存在"),
    });
    expect(result).toEqual({ status: "not-found" });
  });

  it("reports not-scene for an ordinary 2D graph", () => {
    const result = inspectTopologySceneResult({
      topologyId,
      graph: graph({ sceneInstance: false }),
      graphCard: card({ sceneInstance: false }),
    });
    expect(result.status).toBe("not-scene");
  });
});
