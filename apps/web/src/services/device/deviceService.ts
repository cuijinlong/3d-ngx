
import type { Device, DevicePoint, HmiDevice, ParsedHmiScene } from "@idt/shared-types";
import { db } from "../storage/db";
import { createId } from "../../utils/id";
import { getDataProvider, getMockController, getProviderKind, isRealtimePlatformDevice, listRealtimeDevices, profileByType } from "@idt/data-adapter";

function inferType(point: DevicePoint): DevicePoint["displayType"] {
  return point.displayType;
}

export async function listDevices(options?: { siteId?: string; topologyId?: string; customerId?: string }): Promise<Device[]> {
  if (getProviderKind() === "guard") {
    const devices = await listRealtimeDevices({ siteId: options?.siteId, topologyId: options?.topologyId, customerId: options?.customerId });
    return devices.filter(isRealtimePlatformDevice);
  }
  const rows = await db.devices.toArray();
  getMockController().seedDevices(rows);
  return rows;
}

export async function getDevice(id: string): Promise<Device | undefined> {
  if (getProviderKind() === "guard") {
    return (await getDataProvider().getDevice(id)) ?? undefined;
  }
  return db.devices.get(id);
}

export async function saveDevice(device: Device): Promise<Device> {
  if (getProviderKind() === "guard") {
    throw new Error("已连接后端，请在平台里修改设备");
  }
  const next = { ...device, updatedAt: new Date().toISOString() };
  await db.devices.put(next);
  getMockController().upsertRuntime(next);
  return next;
}

export async function createDevice(input: {
  name: string;
  type: string;
  points?: DevicePoint[];
}): Promise<Device> {
  const now = new Date().toISOString();
  const profile = profileByType(input.type);
  const points = input.points ?? profile.points.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    displayType: p.displayType,
  }));
  const device: Device = {
    id: createId("device"),
    name: input.name,
    type: input.type,
    points,
    source: "mock",
    createdAt: now,
    updatedAt: now,
  };
  return saveDevice(device);
}

export async function deleteDevice(id: string): Promise<void> {
  if (getProviderKind() === "guard") {
    throw new Error("已连接后端，请在平台里删除设备");
  }
  await db.devices.delete(id);
  getMockController().removeDevice(id);
}

export function pointsFromHmiDevice(device: HmiDevice): DevicePoint[] {
  const points: DevicePoint[] = device.data.map((d) => ({
    key: slugKey(d.name),
    label: d.name,
    unit: d.unit,
    displayType: inferDisplay(d.name, d.unit, d.val),
  }));
  return points;
}

export async function createDevicesFromHmi(hmi: ParsedHmiScene): Promise<Device[]> {
  const existing = await db.devices.toArray();
  const created: Device[] = [];
  const candidates = [
    ...hmi.devices.filter((d) => d.data.length > 0 || d.actions.length > 0),
    ...hmi.valves.map((v) => ({
      node: v.node,
      name: v.typeLabel ? `${v.node} ${v.typeLabel}` : v.node,
      tag: undefined,
      model: v.type,
      modelName: v.typeLabel,
      actions: [
        ...(v.clips?.open ? [{ id: "open", label: "打开阀门", clip: v.clips.open }] : []),
        ...(v.clips?.close ? [{ id: "close", label: "关闭阀门", clip: v.clips.close }] : []),
      ],
      data: [{ name: "开关", val: v.open ? "开" : "关" }],
    })),
    ...hmi.instruments.map((i) => ({
      node: i.node,
      name: i.typeLabel ? `${i.node} ${i.typeLabel}` : i.node,
      tag: undefined,
      model: i.type,
      modelName: i.typeLabel,
      actions: [
        ...(i.clips?.on ? [{ id: "on", label: "开启", clip: i.clips.on }] : []),
        ...(i.clips?.off ? [{ id: "off", label: "关闭", clip: i.clips.off }] : []),
      ],
      data: [] as { name: string; unit?: string; val?: string }[],
    })),
  ];

  for (const item of candidates) {
    const name = "tag" in item && item.tag ? `${item.name}（${item.tag}）` : item.name;
    if (existing.some((d) => d.name === name) || created.some((d) => d.name === name)) continue;
    const type = inferDeviceType(item);
    const points = pointsFromHmiDevice(item as HmiDevice);
    if (points.length === 0 && item.actions.length > 0) {
      points.push({ key: "running", label: "运行状态", displayType: "text" });
    }
    created.push(await createDevice({ name, type, points }));
  }
  return created;
}

function inferDeviceType(item: { modelName?: string; name: string }): string {
  const text = `${item.modelName ?? ""} ${item.name}`;
  if (text.includes("泵")) return "pump";
  if (text.includes("变压")) return "transformer";
  if (text.includes("电表")) return "meter";
  if (text.includes("空压")) return "compressor";
  return "generic";
}

function inferDisplay(name: string, unit?: string, val?: string): DevicePoint["displayType"] {
  if (unit && unit !== "") {
    if (name.includes("状态")) return "text";
    return "number";
  }
  if (val !== undefined && val !== "" && !Number.isNaN(Number(val))) return "number";
  if (name.includes("状态") || name.includes("开关")) return "text";
  return "text";
}

export function slugKey(label: string): string {
  const map: Record<string, string> = {
    温度: "temperature",
    功率: "power",
    开度: "opening",
    运行状态: "running",
    电压: "voltage",
    电流: "current",
    频率: "frequency",
    压力: "pressure",
    开关: "open",
  };
  if (map[label]) return map[label];
  return `p_${Array.from(label).reduce((n, c) => n + c.charCodeAt(0), 0).toString(16)}`;
}

void inferType;
