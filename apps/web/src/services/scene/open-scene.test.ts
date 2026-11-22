import { describe, expect, it } from "vitest";
import type { SceneDocument } from "@idt/shared-types";
import { SCENE_OPEN_ERRORS, SCENE_OPEN_UNKNOWN_MESSAGE, resolveOpenScene } from "./open-scene";

function doc(customerId: string, topologyId: string, name = "场景"): SceneDocument {
  return {
    schemaVersion: "1.0.0",
    scene: { id: `local-${topologyId}`, name, createdAt: "t", updatedAt: "t" },
    settings: { background: "#dce3ed", environment: null, gridEnabled: true },
    entities: [],
    bindings: [],
    platform: { customerId, siteId: "site-1", topologyId, topologyName: name, viewType: "space" },
  };
}

describe("resolveOpenScene", () => {
  it("does not let a customer open another customer's local draft or stub", () => {
    const foreign = doc("cust-other", "topo-a", "别人的草稿");
    const denied = resolveOpenScene({
      access: { role: "customer", customerId: "cust-1" },
      local: foreign,
    });
    expect(denied).toEqual({ ok: false, error: SCENE_OPEN_ERRORS["not-owned"], kind: "not-owned" });
    expect("document" in denied && denied.ok).toBe(false);

    const stubDenied = resolveOpenScene({
      access: { role: "customer", customerId: "cust-1" },
      stub: { ...foreign, platform: { ...foreign.platform!, sceneInstance: true } },
    });
    expect(stubDenied.ok).toBe(false);
  });

  it("fails closed without inventing an empty opened scene when the document is missing or not owned", () => {
    const missing = resolveOpenScene({ access: { role: "customer", customerId: "cust-1" } });
    expect(missing).toEqual({ ok: false, error: SCENE_OPEN_ERRORS["not-found"], kind: "not-found" });
    expect(missing.ok ? missing.document : undefined).toBeUndefined();

    const mine = doc("cust-1", "topo-a");
    const allowed = resolveOpenScene({
      access: { role: "customer", customerId: "cust-1" },
      local: mine,
    });
    expect(allowed).toEqual({ ok: true, document: mine });
  });

  it("lets a tenant open a scene that belongs to a customer under that tenant", () => {
    const customerScene = doc("cust-1", "topo-a", "客户场站");
    const opened = resolveOpenScene({
      access: { role: "tenant" },
      local: customerScene,
    });
    expect(opened).toEqual({ ok: true, document: customerScene });

    const stub = {
      ...customerScene,
      platform: { ...customerScene.platform!, sceneInstance: true },
    };
    expect(resolveOpenScene({ access: { role: "tenant" }, stub }).ok).toBe(true);

    const missing = resolveOpenScene({ access: { role: "tenant" }, cause: "unavailable" });
    expect(missing).toEqual({ ok: false, error: SCENE_OPEN_ERRORS.unavailable, kind: "unavailable" });
  });

  it("uses the scheme sentences for each open-failure reason", () => {
    expect(SCENE_OPEN_ERRORS["not-found"]).toBe("找不到这个场景");
    expect(SCENE_OPEN_ERRORS["not-owned"]).toBe("这个场景不属于当前客户");
    expect(SCENE_OPEN_ERRORS.unavailable).toBe("暂时连不上服务，请稍后重试");
    expect(SCENE_OPEN_ERRORS.timeout).toBe("打开超时，请刷新或返回场景管理");
    expect(SCENE_OPEN_UNKNOWN_MESSAGE).toBe("打不开这个场景，请返回后重试");
    expect(Object.values(SCENE_OPEN_ERRORS).join("\n")).not.toContain("无法打开该场景");
  });
});
