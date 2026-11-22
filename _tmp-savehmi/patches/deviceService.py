from pathlib import Path
p = Path("apps/web/src/services/device/deviceService.ts")
text = p.read_text()
old_import = 'import { getDataProvider, getMockController, getProviderKind, isRealtimePlatformDevice, profileByType } from "@idt/data-adapter";'
new_import = 'import { getDataProvider, getMockController, getProviderKind, isRealtimePlatformDevice, listRealtimeDevices, profileByType } from "@idt/data-adapter";'
if old_import not in text:
    raise SystemExit("import not found")
text = text.replace(old_import, new_import, 1)
old_list = '''export async function listDevices(options?: { topologyId?: string }): Promise<Device[]> {
  if (getProviderKind() === "guard") {
    if (options?.topologyId) {
      try {
        const { getTopologyApi } = await import("@idt/data-adapter");
        const nodes = await getTopologyApi().listDeviceNodes(options.topologyId);
        const allowed = await getDataProvider().getDevices();
        const byId = new Map(allowed.map((item) => [item.id, item]));
        const listed = nodes
          .map((node) => byId.get(node.entityId || node.id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .filter(isRealtimePlatformDevice);
        if (listed.length) return listed;
      } catch (error) {
        console.warn("按拓扑读取设备失败，回退到平台设备列表", error);
      }
    }
    return (await getDataProvider().getDevices()).filter(isRealtimePlatformDevice);
  }
'''
new_list = '''export async function listDevices(options?: { siteId?: string; topologyId?: string }): Promise<Device[]> {
  if (getProviderKind() === "guard") {
    const devices = await listRealtimeDevices({ siteId: options?.siteId, topologyId: options?.topologyId });
    return devices.filter(isRealtimePlatformDevice);
  }
'''
if old_list not in text:
    raise SystemExit("listDevices block not found")
text = text.replace(old_list, new_list, 1)
old_get = '''export async function getDevice(id: string): Promise<Device | undefined> {
  if (getProviderKind() === "guard") {
    return (await getDataProvider().getDevices()).find((item) => item.id === id);
  }
  return db.devices.get(id);
}
'''
new_get = '''export async function getDevice(id: string): Promise<Device | undefined | null> {
  if (getProviderKind() === "guard") {
    return getDataProvider().getDevice(id);
  }
  return db.devices.get(id);
}
'''
if old_get not in text:
    raise SystemExit("getDevice block not found")
text = text.replace(old_get, new_get, 1)
p.write_text(text)
print("patched deviceService.ts")
