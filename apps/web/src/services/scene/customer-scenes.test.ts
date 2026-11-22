import { describe, expect, it } from "vitest";
import type { SceneDocument } from "@idt/shared-types";
import { customerCardHints, defaultSceneBanner, emptySceneListMessage, mergeCustomerSceneRows } from "./customer-scenes";

function localDoc(customerId: string, topologyId: string, name: string): SceneDocument {
  return {
    schemaVersion: "1.0.0",
    scene: { id: `local-${topologyId}`, name, createdAt: "t", updatedAt: "t" },
    settings: { background: "#dce3ed", environment: null, gridEnabled: true },
    entities: [],
    bindings: [],
    platform: { customerId, siteId: "site-1", siteName: "天骄科技园", topologyId, topologyName: name, viewType: "space", rootNames: ["冷冻机房"], packVersion: "1.0.0" },
  };
}

describe("list scenes by customer", () => {
  it("keeps only this customer's topologies and does not reuse an unscoped local scene list", () => {
    const cards = [
      { id: "topo-a", name: "场站总览", customerId: "cust-1", siteName: "天骄科技园", rootNames: ["整站"], packVersion: "1.0.0", sceneInstance: true },
      { id: "topo-b", name: "别的客户总览", customerId: "cust-2", siteName: "五院", sceneInstance: true },
    ];
    const local = [
      localDoc("cust-1", "topo-a", "场站总览草稿"),
      localDoc("cust-1", "topo-room", "冷冻机房"),
      localDoc("cust-2", "topo-b", "不该出现"),
    ];
    const rows = mergeCustomerSceneRows(cards, local, "cust-1", true);
    expect(rows.map((row) => row.topologyId).sort()).toEqual(["topo-a", "topo-room"]);
    expect(rows.find((row) => row.topologyId === "topo-a")?.hasLocalDraft).toBe(true);
    expect(rows.find((row) => row.topologyId === "topo-a")?.packVersion).toBe("1.0.0");
    expect(rows.some((row) => row.topologyId === "topo-b")).toBe(false);
  });

  it("drops unmarked 2D topologies from the platform list, but keeps an already attached local 3D draft", () => {
    const cards = [
      { id: "topo-2d", name: "场站物理图", customerId: "cust-1" },
      { id: "topo-2d-false", name: "逻辑图", customerId: "cust-1", sceneInstance: false },
      { id: "topo-3d", name: "场站总览", customerId: "cust-1", sceneInstance: true, packVersion: "1.0.0" },
    ];
    const local = [localDoc("cust-1", "topo-2d", "已挂靠的三维草稿")];
    const rows = mergeCustomerSceneRows(cards, local, "cust-1", true);
    expect(rows.map((row) => row.topologyId).sort()).toEqual(["topo-2d", "topo-3d"]);
    expect(rows.find((row) => row.topologyId === "topo-2d")?.hasLocalDraft).toBe(true);
    expect(rows.find((row) => row.topologyId === "topo-2d")?.name).toBe("已挂靠的三维草稿");
    expect(rows.some((row) => row.topologyId === "topo-2d-false")).toBe(false);
    expect(rows.find((row) => row.topologyId === "topo-3d")?.hasLocalDraft).toBe(false);
    expect(rows.find((row) => row.topologyId === "topo-3d")?.mark).toEqual({ kind: "draft", label: "草稿" });
    expect(rows.find((row) => row.topologyId === "topo-2d")?.mark).toEqual({ kind: "local-draft", label: "未落库 / 本地草稿" });
  });

  it("does not stamp 未落库 on a persisted published platform row even if a local cache exists", () => {
    const cards = [
      { id: "topo-3d", name: "场站总览", customerId: "cust-1", sceneInstance: true, publishState: "published" },
    ];
    const local = [localDoc("cust-1", "topo-3d", "场站总览草稿")];
    const rows = mergeCustomerSceneRows(cards, local, "cust-1", true);
    expect(rows[0]?.mark.kind).toBe("published");
    expect(rows[0]?.mark.label).toBe("已发布");
    expect(rows[0]?.mark.localNote).toBe("有本地缓存");
    expect(rows[0]?.mark.label).not.toContain("未落库");
    const offline = mergeCustomerSceneRows(cards, local, "cust-1", false);
    expect(offline[0]?.mark.label).toBe("未落库 / 本地草稿");
  });

  it("explains why a customer scene list is empty", () => {
    const none = emptySceneListMessage({ rows: [], stats: { customerTotal: 0, sceneTotal: 0, twoDTotal: 0, otherSceneTotal: 0 } });
    expect(none).toBe("该客户还没有可管理的三维场景，可以新建一个。");
    const filtered = emptySceneListMessage({ rows: [], stats: { customerTotal: 2, sceneTotal: 0, twoDTotal: 2, otherSceneTotal: 0 } });
    expect(filtered).toContain("普通二维图");
    const unattached = emptySceneListMessage({ rows: [], stats: { customerTotal: 0, sceneTotal: 0, twoDTotal: 0, otherSceneTotal: 3 } });
    expect(unattached).toContain("没有挂靠到这个客户");
    const down = emptySceneListMessage({ rows: [], sourceError: "timeout", stats: { customerTotal: 0, sceneTotal: 0, twoDTotal: 0, otherSceneTotal: 0 } });
    expect(down).toContain("接口不可用或超时");
    expect(emptySceneListMessage({ rows: [{ topologyId: "t1" } as never], stats: { customerTotal: 1, sceneTotal: 1, twoDTotal: 0, otherSceneTotal: 0 } })).toBeNull();
  });

  it("writes 还没有指定默认场景 when there is no default, and names it when there is one", () => {
    expect(customerCardHints({ count: 0 })).toEqual({
      defaultHint: "还没有指定默认场景",
      countHint: "0 个可管理的三维场景",
    });
    expect(customerCardHints({ count: 3, defaultName: "场站总览" })).toEqual({
      defaultHint: "默认场景：场站总览",
      countHint: "3 个可管理的三维场景",
    });
    expect(defaultSceneBanner({})).toBe("还没有指定默认场景");
    expect(defaultSceneBanner({ defaultId: "topo-a", defaultName: "场站总览" })).toBe("默认场景：场站总览");
    expect(defaultSceneBanner({ defaultId: "topo-a" })).toBe("还没有指定默认场景");
    expect(defaultSceneBanner({ defaultId: "topo-a", defaultName: "场站总览" })).not.toContain("默认场景指针");
  });
});
