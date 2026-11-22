import { describe, expect, it } from "vitest";
import {
  SCENE_JUMP_DRAFT_NOTICE,
  decideObjectClick,
  readSceneJumpDraft,
  setObjectJumpTargets,
} from "./scene-jump-draft";

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

describe("scene jump local draft and click rules", () => {
  it("stores per-customer, per-topology links as an unpublished draft", () => {
    const storage = new MemoryStorage();
    setObjectJumpTargets(
      "cust-1",
      "topo-overview",
      "building-a",
      [
        { topologyId: "topo-1f", label: "一层" },
        { topologyId: "topo-2f", label: "二层" },
      ],
      "A 栋",
      storage,
    );
    const draft = readSceneJumpDraft("cust-1", "topo-overview", storage);
    expect(SCENE_JUMP_DRAFT_NOTICE).toBe("未落库 / 本地草稿");
    expect(draft?.customerId).toBe("cust-1");
    expect(draft?.links).toHaveLength(1);
    expect(draft?.links[0]?.targets.map((item) => item.topologyId)).toEqual(["topo-1f", "topo-2f"]);
    expect(readSceneJumpDraft("cust-2", "topo-overview", storage)).toBeNull();
  });

  it("enters directly when one target is configured, and asks to choose when there are several", () => {
    const one = [{ objectId: "zone-1", targets: [{ topologyId: "topo-room", label: "冷冻机房" }] }];
    expect(decideObjectClick({ resolvedNode: "zone-1", links: one })).toEqual({
      action: "enter",
      node: "zone-1",
      topologyId: "topo-room",
    });
    const many = [
      {
        objectId: "building-a",
        targets: [
          { topologyId: "topo-1f", label: "一层" },
          { topologyId: "topo-2f", label: "二层" },
        ],
      },
    ];
    const chosen = decideObjectClick({ resolvedNode: "building-a", links: many });
    expect(chosen.action).toBe("choose");
    if (chosen.action === "choose") {
      expect(chosen.targets).toHaveLength(2);
      expect(chosen.targets[0]?.topologyId).not.toBe(chosen.targets[1]?.topologyId);
    }
  });

  it("only selects when nothing is configured, and never jumps from a control panel or screen", () => {
    const links = [{ objectId: "pump-1", targets: [{ topologyId: "topo-room", label: "机房" }] }];
    expect(decideObjectClick({ resolvedNode: "pipe-9", links })).toEqual({ action: "select", node: "pipe-9" });
    expect(decideObjectClick({ rawNode: "pump-1_control-panel", resolvedNode: "pump-1", isControlOrScreen: true, links })).toEqual({
      action: "select",
      node: "pump-1",
    });
    expect(decideObjectClick({ rawNode: "pump-1_screen", resolvedNode: "pump-1", isControlOrScreen: true, links })).toEqual({
      action: "select",
      node: "pump-1",
    });
  });
});
