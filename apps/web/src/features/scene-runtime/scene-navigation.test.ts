import { describe, expect, it } from "vitest";
import { pushSceneNav, returnToSceneNav, startSceneNav } from "./scene-navigation";

const viewA = { yaw: 40, pitch: -20, distance: 12, pivot: [1, 2, 3] as [number, number, number] };
const viewB = { yaw: 10, pitch: -8, distance: 6, pivot: [4, 5, 6] as [number, number, number] };

describe("scene breadcrumb navigation", () => {
  it("returns to the parent with the camera and selection saved when leaving", () => {
    const started = startSceneNav("cust-1", { topologyId: "topo-overview", name: "场站总览" });
    const down = pushSceneNav(
      started,
      { view: viewA, selectedNode: "building-a" },
      { topologyId: "topo-1f", name: "一层" },
    );
    const deeper = pushSceneNav(down, { view: viewB, selectedNode: "room-1" }, { topologyId: "topo-room", name: "冷冻机房" });
    expect(deeper.path.map((item) => item.topologyId)).toEqual(["topo-overview", "topo-1f", "topo-room"]);

    const backToOverview = returnToSceneNav(deeper, "topo-overview");
    expect(backToOverview?.restore?.topologyId).toBe("topo-overview");
    expect(backToOverview?.restore?.view).toEqual(viewA);
    expect(backToOverview?.restore?.selectedNode).toBe("building-a");
    expect(backToOverview?.state.path.map((item) => item.topologyId)).toEqual(["topo-overview"]);
  });

  it("returns one level and keeps the earlier ancestor views intact", () => {
    const started = startSceneNav("cust-1", { topologyId: "topo-overview", name: "场站总览" });
    const mid = pushSceneNav(started, { view: viewA, selectedNode: "building-a" }, { topologyId: "topo-1f", name: "一层" });
    const deep = pushSceneNav(mid, { view: viewB, selectedNode: "room-1" }, { topologyId: "topo-room", name: "冷冻机房" });
    const back = returnToSceneNav(deep, "topo-1f");
    expect(back?.restore?.view).toEqual(viewB);
    expect(back?.restore?.selectedNode).toBe("room-1");
    expect(back?.state.path).toHaveLength(2);
    expect(back?.state.path[0]?.view).toEqual(viewA);
  });
});
