import { describe, expect, it } from "vitest";
import { visibleSceneLabel } from "./scene-label";

describe("visibleSceneLabel", () => {
  it("prefers group node names or a scene name, and never puts a raw id on the main label", () => {
    expect(visibleSceneLabel("场站总览", ["冷冻机房"], "topo-a")).toBe("冷冻机房");
    expect(visibleSceneLabel("场站总览", [], "topo-a")).toBe("场站总览");
    expect(visibleSceneLabel("topo-a", [], "topo-a")).toBe("未命名场景");
    expect(visibleSceneLabel(undefined, undefined, "topo-a")).toBe("未命名场景");
    expect(visibleSceneLabel(undefined, ["冷冻机房"], "topo-a")).toBe("冷冻机房");
    expect(visibleSceneLabel("", ["整站", "topo-a"], "topo-a")).toBe("整站");
  });
});
