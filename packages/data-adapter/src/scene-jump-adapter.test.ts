import { describe, expect, it } from "vitest";
import { jumpsFromObjectLinks, objectLinksFromJumps, parseSceneJumpRows } from "./scene-jump-adapter";
import type { SceneJumpLink } from "./scene-jump-draft";

describe("scene jump adapter", () => {
  it("converts object-centered local drafts to toId-centered API payloads and back", () => {
    const links: SceneJumpLink[] = [
      {
        objectId: "obj-a",
        targets: [
          { topologyId: "topo-1", label: "冷冻机房" },
          { topologyId: "topo-2", label: "配电室" },
        ],
      },
      {
        objectId: "obj-b",
        targets: [{ topologyId: "topo-1", label: "从总览进冷冻机房" }],
      },
    ];
    const body = jumpsFromObjectLinks(links);
    expect(body.jumps).toEqual([
      {
        toId: "topo-1",
        targets: [
          { objectId: "obj-a", label: "冷冻机房" },
          { objectId: "obj-b", label: "从总览进冷冻机房" },
        ],
      },
      {
        toId: "topo-2",
        targets: [{ objectId: "obj-a", label: "配电室" }],
      },
    ]);
    const roundTrip = objectLinksFromJumps(body.jumps);
    expect(roundTrip).toEqual(links);
  });

  it("reads a single objectId on a toId row as well as a targets array", () => {
    const links = objectLinksFromJumps([
      { toId: "topo-1", toName: "冷冻机房", objectId: "obj-a", label: "入口" },
      { toId: "topo-1", targets: [{ objectId: "obj-b" }] },
    ]);
    expect(links).toEqual([
      { objectId: "obj-a", targets: [{ topologyId: "topo-1", label: "入口" }] },
      { objectId: "obj-b", targets: [{ topologyId: "topo-1", label: "冷冻机房" }] },
    ]);
  });

  it("parses a bare array or a jumps wrapper from the API", () => {
    expect(parseSceneJumpRows({ jumps: [{ toId: "t1", targets: [] }] }).map((row) => row.toId)).toEqual(["t1"]);
    expect(parseSceneJumpRows([{ toId: "t2" }]).map((row) => row.toId)).toEqual(["t2"]);
  });
});
