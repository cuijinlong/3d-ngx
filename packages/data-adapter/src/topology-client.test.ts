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
