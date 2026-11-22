/**
 * 可绑定的实时设备列表。平台列表不会只返回实时设备，
 * 按场站或拓扑过滤时也要在适配器里排除虚拟设备。
 */
import type { Device, DeviceDataProvider } from "@idt/shared-types";
import { GuardHttpError, type GuardClient } from "./guard-client";
import { isRealtimePlatformDevice } from "./device-virtual";
import { TopologyApi, type TopologyDeviceNode } from "./topology-client";
import { listCustomerPlatformDevices } from "./customers";

export interface RealtimeDeviceQuery {
  /** 场站资产 ID。走已有 GET /api/energy/site-devices，再与实时设备求交。 */
  siteId?: string;
  /** 拓扑 ID。与拓扑设备节点求交。 */
  topologyId?: string;
  /** 仅场站列表支持，按名称/显示名包含过滤。 */
  nameFilter?: string;
  /** 租户在该客户场景里绑定时，走 GET /api/customer/{customerId}/devices。 */
  customerId?: string;
}

export function intersectRealtimeDevices(devices: Device[], nodes: TopologyDeviceNode[]): Device[] {
  const byId = new Map(
    devices.filter(isRealtimePlatformDevice).map((device) => [device.id, device]),
  );
  const seen = new Set<string>();
  const out: Device[] = [];
  for (const node of nodes) {
    const id = node.entityId || node.id;
    const device = byId.get(id);
    if (!device || seen.has(device.id)) continue;
    seen.add(device.id);
    out.push(device);
  }
  return out;
}

interface SiteDevicePage {
  data?: Array<{ id?: string }>;
  hasNext?: boolean;
  truncated?: boolean;
}

async function listSiteDeviceIds(
  client: GuardClient,
  siteId: string,
  nameFilter?: string,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let truncated = false;
  for (let page = 0; page < 50; page += 1) {
    const query = new URLSearchParams({
      siteId,
      pageSize: "200",
      page: String(page),
    });
    if (nameFilter) query.set("nameFilter", nameFilter);
    const payload = await client.requestJson<SiteDevicePage>(
      "GET",
      `/api/energy/site-devices?${query.toString()}`,
    );
    for (const row of payload.data ?? []) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (id) ids.push(id);
    }
    if (payload.truncated) truncated = true;
    if (!payload.hasNext) break;
  }
  return { ids, truncated };
}

/**
 * 先取平台实时设备（已排除虚拟），再按场站和/或拓扑求交。
 * site-devices 与拓扑节点都没有 deviceVirtual，不能单独当作可绑定列表。
 */
export async function listRealtimeDevicesFrom(
  provider: DeviceDataProvider,
  client: GuardClient | null,
  query?: RealtimeDeviceQuery,
): Promise<Device[]> {
  const customerId = query?.customerId?.trim();
  const realtime = customerId && client
    ? await listCustomerPlatformDevices(client, customerId)
    : (await provider.getDevices()).filter(isRealtimePlatformDevice);
  const siteId = query?.siteId?.trim();
  const topologyId = query?.topologyId?.trim();
  if (!siteId && !topologyId) return realtime;
  if (!client) return realtime;

  let allowed: Set<string> | null = null;
  if (siteId) {
    const { ids, truncated } = await listSiteDeviceIds(client, siteId, query?.nameFilter);
    if (truncated) {
      console.warn("按场站扫描设备达到平台上限，结果可能不全", siteId);
    }
    allowed = new Set(ids);
  }
  if (topologyId) {
    const nodes = await new TopologyApi(client).listDeviceNodes(topologyId);
    const topo = new Set(nodes.map((node) => node.entityId || node.id));
    allowed = allowed ? new Set([...allowed].filter((id) => topo.has(id))) : topo;
  }
  return realtime.filter((device) => allowed!.has(device.id));
}

export function isSiteDevicesUnavailable(error: unknown): boolean {
  return error instanceof GuardHttpError && (error.status === 404 || error.status === 400);
}
