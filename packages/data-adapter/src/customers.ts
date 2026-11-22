import type { Device } from "@idt/shared-types";
import type { GuardClient } from "./guard-client";
import { toGuardDevice, type GuardDeviceRow } from "./guard-device";
import { isRealtimePlatformDevice } from "./device-virtual";

export interface PlatformCustomer {
  id: string;
  name: string;
}

interface ThingsBoardId {
  id?: string;
  entityType?: string;
}

interface ThingsBoardCustomer {
  id?: ThingsBoardId | string;
  title?: string;
  name?: string;
}

interface ThingsBoardPage<T> {
  data?: T[];
  hasNext?: boolean;
}

function customerId(row: ThingsBoardCustomer): string | undefined {
  if (typeof row.id === "string" && row.id) return row.id;
  if (row.id && typeof row.id === "object" && typeof row.id.id === "string" && row.id.id) {
    return row.id.id;
  }
  return undefined;
}

/** 使用平台已有客户列表接口，不在 3D-NGX 另造客户库。 */
export async function listPlatformCustomers(client: GuardClient): Promise<PlatformCustomer[]> {
  const rows: PlatformCustomer[] = [];
  const pageSize = 100;
  for (let page = 0; page < 50; page += 1) {
    const result = await client.requestJson<ThingsBoardPage<ThingsBoardCustomer>>(
      "GET",
      `/api/customers?pageSize=${pageSize}&page=${page}`,
    );
    const data = result?.data ?? [];
    for (const row of data) {
      const id = customerId(row);
      if (!id) continue;
      rows.push({ id, name: row.title || row.name || id });
    }
    if (!result?.hasNext || data.length === 0) break;
  }
  return rows;
}

interface ThingsBoardDevicePage {
  data?: GuardDeviceRow[];
  hasNext?: boolean;
}

/** 现有平台接口：租户给该客户绑定时走 GET /api/customer/{customerId}/devices，只要实时设备。 */
export async function listCustomerPlatformDevices(client: GuardClient, customerId: string): Promise<Device[]> {
  if (!customerId) return [];
  const rows: Device[] = [];
  const pageSize = 100;
  for (let page = 0; page < 50; page += 1) {
    const result = await client.requestJson<ThingsBoardDevicePage>(
      "GET",
      `/api/customer/${encodeURIComponent(customerId)}/devices?pageSize=${pageSize}&page=${page}`,
    );
    const data = result?.data ?? [];
    for (const row of data) {
      const device = toGuardDevice(row);
      if (device.id && isRealtimePlatformDevice(device)) rows.push(device);
    }
    if (!result?.hasNext || data.length === 0) break;
  }
  return rows;
}
