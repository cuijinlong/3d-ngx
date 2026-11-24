import { describe, expect, it } from "vitest";
import {
  SCENE_ROOT_ISSUE_LABELS,
  checkSceneRootConflict,
  sceneRootIssueOf,
  sceneRootOf,
} from "./scene-root";

/**
 * 场景根判据（docs/twin-binding-contract.md §2.3）。
 *
 * 最容易出错的两处：
 * 1. 存量多根 / 空根的场景被当成「已声明」，于是误判冲突或误报正常；
 * 2. 编辑态忘了排除自己，导致「改自己的场景」被自己的旧数据挡住。
 */

describe("sceneRootOf", () => {
  it("恰好一个根 → declared，带名字", () => {
    const info = sceneRootOf({ roots: ["asset-1"], rootNames: ["热泵系统 1"] });
    expect(info.state).toBe("declared");
    expect(info.count).toBe(1);
    expect(info.root).toEqual({ entityType: "ASSET", entityId: "asset-1", name: "热泵系统 1" });
  });

  it("没有根 → unresolved，count=0", () => {
    const info = sceneRootOf({});
    expect(info.state).toBe("unresolved");
    expect(info.count).toBe(0);
    expect(info.root).toBeUndefined();
  });

  it("多个根 → unresolved，count=2（历史 viewType 圈范围用法）", () => {
    const info = sceneRootOf({ roots: ["a", "b"], rootNames: ["A", "B"] });
    expect(info.state).toBe("unresolved");
    expect(info.count).toBe(2);
    expect(info.root).toBeUndefined();
  });

  it("空字符串根被过滤掉（不做 trim 会把 \" \" 当成一个根）", () => {
    expect(sceneRootOf({ roots: ["  "] }).state).toBe("unresolved");
    expect(sceneRootOf({ roots: ["asset-1", "  "] }).state).toBe("declared");
  });
});

describe("checkSceneRootConflict", () => {
  const cards = [
    { id: "topo-1", name: "冷热站总览", roots: ["asset-1"] },
    { id: "topo-2", name: "配电房", roots: ["asset-2"] },
  ];

  it("该资产没被占用 → free", () => {
    expect(checkSceneRootConflict({ rootAssetId: "asset-9", cards })).toEqual({ status: "free" });
  });

  it("已被别的场景占用 → conflict，返回可打开的目标", () => {
    const result = checkSceneRootConflict({ rootAssetId: "asset-1", cards });
    expect(result).toEqual({ status: "conflict", scene: { id: "topo-1", name: "冷热站总览" } });
  });

  it("编辑自己 → 不算冲突", () => {
    const result = checkSceneRootConflict({ rootAssetId: "asset-1", currentTopologyId: "topo-1", cards });
    expect(result).toEqual({ status: "free" });
  });

  it("空 rootAssetId → free（不挡「还没选资产」的中间态）", () => {
    expect(checkSceneRootConflict({ rootAssetId: "", cards })).toEqual({ status: "free" });
    expect(checkSceneRootConflict({ rootAssetId: "   ", cards })).toEqual({ status: "free" });
  });

  it("存量多根场景不参与冲突判断（否则脏数据会永久挡住新建）", () => {
    const legacy = [{ id: "topo-old", name: "历史多根", roots: ["asset-1", "asset-2"] }];
    expect(checkSceneRootConflict({ rootAssetId: "asset-1", cards: legacy })).toEqual({ status: "free" });
  });

  it("存量空根场景不参与冲突判断", () => {
    const legacy = [{ id: "topo-empty", name: "没选资产", roots: [] }];
    expect(checkSceneRootConflict({ rootAssetId: "asset-1", cards: legacy })).toEqual({ status: "free" });
  });

  it("多张卡同根时返回第一张（列表顺序稳定）", () => {
    const dup = [
      { id: "topo-a", name: "A", roots: ["asset-1"] },
      { id: "topo-b", name: "B", roots: ["asset-1"] },
    ];
    const result = checkSceneRootConflict({ rootAssetId: "asset-1", cards: dup });
    expect(result).toEqual({ status: "conflict", scene: { id: "topo-a", name: "A" } });
  });
});

describe("sceneRootIssueOf", () => {
  it("已声明 → none", () => {
    expect(sceneRootIssueOf({ roots: ["a"] })).toBe("none");
  });

  it("没选 → no-root", () => {
    expect(sceneRootIssueOf({ roots: [] })).toBe("no-root");
    expect(sceneRootIssueOf({})).toBe("no-root");
  });

  it("多个 → multi-root（与「没选」分开说）", () => {
    expect(sceneRootIssueOf({ roots: ["a", "b"] })).toBe("multi-root");
  });

  it("文案覆盖两种异常", () => {
    expect(SCENE_ROOT_ISSUE_LABELS["no-root"]).toBe("未绑定资产");
    expect(SCENE_ROOT_ISSUE_LABELS["multi-root"]).toBe("绑定了多个资产");
  });
});
