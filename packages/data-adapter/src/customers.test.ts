import { describe, expect, it, vi } from "vitest";
import { listCustomerPlatformDevices, listPlatformCustomers } from "./customers";
import type { GuardClient } from "./guard-client";

describe("listPlatformCustomers", () => {
  it("calls the existing platform customers page API and maps title/id", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      data: [
        { id: { id: "c-1", entityType: "CUSTOMER" }, title: "天骄科技园" },
        { id: { id: "c-2" }, name: "某市热力" },
      ],
      hasNext: false,
    });
    const client = { requestJson } as unknown as GuardClient;
    const rows = await listPlatformCustomers(client);
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/customers?pageSize=100&page=0");
    expect(rows).toEqual([
      { id: "c-1", name: "天骄科技园" },
      { id: "c-2", name: "某市热力" },
    ]);
  });
});

describe("listCustomerPlatformDevices", () => {
  it("calls GET /api/customer/{customerId}/devices and keeps only realtime devices", async () => {
    const requestJson = vi.fn().mockResolvedValue({
      data: [
        { id: { id: "d-1" }, name: "泵 A", additionalInfo: { deviceVirtual: false } },
        { id: { id: "d-2" }, name: "虚拟泵", additionalInfo: { deviceVirtual: true } },
      ],
      hasNext: false,
    });
    const client = { requestJson } as unknown as GuardClient;
    const rows = await listCustomerPlatformDevices(client, "cust-1");
    expect(requestJson).toHaveBeenCalledWith("GET", "/api/customer/cust-1/devices?pageSize=100&page=0");
    expect(rows.map((row) => row.id)).toEqual(["d-1"]);
  });
});
