import { describe, expect, it, vi } from "vitest";
import type { GuardClient } from "./guard-client";
import {
  TopologyApi,
  filterCustomerSceneInstanceCards,
  filterTopologiesForCustomer,
} from "./topology-client";

describe("TopologyApi customer list", () => {
  it("calls the existing topologies endpoint with optional customerId and filters on the client", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      sites: [{ id: "site-1", name: "天骄科技园" }],
      items: [
        { id: "topo-a", name: "场站总览", siteName: "天骄科技园", customerId: "cust-1", roots: ["root-1"], rootNames: ["整站"], packVersion: "1.0.0", sceneInstance: true },
        { id: "topo-b", name: "别的客户", customerId: "cust-2" },
        { id: "topo-c", name: "未标客户" },
      ],
      total: 3,
    });
    const api = new TopologyApi({ requestJson } as unknown as GuardClient);
    const result = await api.list(0, 100, { customerId: "cust-1", sceneInstance: true });
    expect(requestJson).toHaveBeenCalledWith(
      "GET",
      "/api/energy/topologies?page=0&pageSize=100&customerId=cust-1&sceneInstance=true",
    );
    const mine = filterTopologiesForCustomer(result.items, "cust-1");
    expect(mine.map((item) => item.id)).toEqual(["topo-a"]);
    expect(mine[0]?.rootNames).toEqual(["整站"]);
    expect(mine[0]?.packVersion).toBe("1.0.0");
    expect(mine[0]?.sceneInstance).toBe(true);
    expect(filterTopologiesForCustomer(result.items, "cust-2").map((item) => item.id)).toEqual(["topo-b"]);
  });

  it("treats missing or false sceneInstance as a 2D graph even if the server ignored the query", () => {
    const requestJson = vi.fn().mockResolvedValue({
      items: [
        { id: "topo-2d", name: "物理图", customerId: "cust-1" },
        { id: "topo-false", name: "逻辑图", customerId: "cust-1", sceneInstance: false },
        { id: "topo-3d", name: "总览", customerId: "cust-1", sceneInstance: true, publishState: "draft" },
      ],
    });
    const api = new TopologyApi({ requestJson } as unknown as GuardClient);
    return api.list(0, 100, { customerId: "cust-1", sceneInstance: true }).then((result) => {
      expect(requestJson).toHaveBeenCalledWith(
        "GET",
        "/api/energy/topologies?page=0&pageSize=100&customerId=cust-1&sceneInstance=true",
      );
      expect(result.items.find((item) => item.id === "topo-3d")?.publishState).toBe("draft");
      expect(filterCustomerSceneInstanceCards(result.items, "cust-1").map((item) => item.id)).toEqual(["topo-3d"]);
    });
  });

  it("sends sceneInstance=true and optional customerId on the body, not in additionalInfo", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: "topo-new",
      name: "场站总览",
      customerId: "cust-1",
      sceneInstance: true,
      publishState: "draft",
    });
    const api = new TopologyApi({ requestJson } as unknown as GuardClient);
    const created = await api.create({
      siteId: "site-1",
      name: "场站总览 拓扑",
      viewType: "space",
      customerId: "cust-1",
      sceneInstance: true,
    });
    expect(created.sceneInstance).toBe(true);
    expect(created.publishState).toBe("draft");
    const [, path, body] = requestJson.mock.calls[0];
    expect(path).toBe("/api/energy/topologies");
    expect(body).toMatchObject({ siteId: "site-1", customerId: "cust-1", sceneInstance: true, name: "场站总览 拓扑" });
    expect(body).not.toHaveProperty("additionalInfo");
  });

  it("sends sceneInstance=false when the caller asks for ordinary 2D graphs", async () => {
    const requestJson = vi.fn().mockResolvedValue({ items: [] });
    const api = new TopologyApi({ requestJson } as unknown as GuardClient);
    await api.list(0, 100, { customerId: "cust-1", sceneInstance: false });
    expect(requestJson).toHaveBeenCalledWith(
      "GET",
      "/api/energy/topologies?page=0&pageSize=100&customerId=cust-1&sceneInstance=false",
    );
  });
});

describe("TopologyApi glb metadata", () => {
  it("parses glb from list and load responses", async () => {
    const requestJson = vi.fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: "topo-a",
            name: "场站总览",
            customerId: "cust-1",
            sceneInstance: true,
            glb: { objectKey: "sites/site-1/topo-a/model.glb", fileName: "天骄科技园.glb", size: 12, url: "/api/energy/topology-assets?objectKey=sites/site-1/topo-a/model.glb" },
          },
          {
            id: "topo-b",
            name: "字符串模型",
            sceneInstance: true,
            additionalInfo: { glb: "sites/site-1/topo-b/model.glb" },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "topo-a",
        name: "场站总览",
        customerId: "cust-1",
        sceneInstance: true,
        publishState: "published",
        glb: { objectKey: "sites/site-1/topo-a/model.glb", fileName: "天骄科技园.glb", size: 12 },
      });
    const api = new TopologyApi({ requestJson } as unknown as GuardClient);
    const listed = await api.list(0, 100, { sceneInstance: true });
    expect(listed.items[0]?.glb).toEqual({
      objectKey: "sites/site-1/topo-a/model.glb",
      fileName: "天骄科技园.glb",
      size: 12,
      url: "/api/energy/topology-assets?objectKey=sites/site-1/topo-a/model.glb",
    });
    expect(listed.items[1]?.glb).toEqual({ objectKey: "sites/site-1/topo-b/model.glb" });

    const graph = await api.load("topo-a");
    expect(graph.sceneInstance).toBe(true);
    expect(graph.publishState).toBe("published");
    expect(graph.customerId).toBe("cust-1");
    expect(graph.glb).toEqual({
      objectKey: "sites/site-1/topo-a/model.glb",
      fileName: "天骄科技园.glb",
      size: 12,
    });
  });

  it("downloads a platform asset with the existing objectKey url", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const requestBytes = vi.fn().mockResolvedValue({ blob: new Blob([bytes]), contentType: "model/gltf-binary" });
    const api = new TopologyApi({ requestBytes } as unknown as GuardClient);
    const got = await api.downloadAsset("sites/site-1/topo-a/model.glb");
    expect(requestBytes).toHaveBeenCalledWith("/api/energy/topology-assets?objectKey=sites%2Fsite-1%2Ftopo-a%2Fmodel.glb");
    expect(new Uint8Array(got)).toEqual(bytes);
  });

  it("sends publishState and glb on update", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: "topo-a",
      name: "场站总览",
      sceneInstance: true,
      publishState: "published",
      glb: { objectKey: "topology/tenant/topo-a/model.glb", fileName: "model.glb" },
    });
    const api = new TopologyApi({ requestJson } as unknown as GuardClient);
    const card = await api.update("topo-a", {
      glb: { objectKey: "topology/tenant/topo-a/model.glb", fileName: "model.glb" },
      publishState: "published",
    });
    expect(requestJson).toHaveBeenCalledWith(
      "POST",
      "/api/energy/topologies/topo-a",
      { glb: { objectKey: "topology/tenant/topo-a/model.glb", fileName: "model.glb" }, publishState: "published" },
    );
    expect(card.publishState).toBe("published");
    expect(card.glb?.objectKey).toBe("topology/tenant/topo-a/model.glb");
  });

  it("uploads a model with kind only in the query, not also in the form body", async () => {
    const requestForm = vi.fn().mockResolvedValue({
      kind: "glb",
      objectKey: "topology/tenant/topo-a/model.glb",
      fileName: "model.glb",
    });
    const api = new TopologyApi({ requestForm } as unknown as GuardClient);
    const file = new File(["glb"], "model.glb", { type: "model/gltf-binary" });
    await api.uploadAsset(file, { kind: "glb", topologyId: "topo-a", siteId: "site-1" });
    expect(requestForm).toHaveBeenCalledTimes(1);
    const [path, form] = requestForm.mock.calls[0] as [string, FormData];
    expect(path).toBe("/api/energy/topology-assets?kind=glb&siteId=site-1&topologyId=topo-a");
    expect(form.get("file")).toBe(file);
    expect(form.get("kind")).toBeNull();
  });
});
