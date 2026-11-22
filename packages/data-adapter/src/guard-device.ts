import type { Device, DevicePoint } from "@idt/shared-types";
import { readDeviceVirtualFlag } from "./device-virtual";

export interface GuardDeviceRow {
  id?: { id?: string; entityType?: string } | string;
  name?: string;
  type?: string;
  label?: string;
  createdTime?: number;
  additionalInfo?: Record<string, unknown> | string | null;
}

function idOf(value: GuardDeviceRow["id"]): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.id ?? "";
}

/** 把平台设备行收成 Device：保留原始 name，同时带上 label，不再把 label 折进 name。 */
export function toGuardDevice(row: GuardDeviceRow, points: DevicePoint[] = []): Device {
  const id = idOf(row.id);
  const created = row.createdTime ? new Date(row.createdTime).toISOString() : new Date().toISOString();
  const name = (typeof row.name === "string" && row.name.trim()) || id;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  const deviceVirtual = readDeviceVirtualFlag(row.additionalInfo);
  return {
    id,
    name,
    ...(label ? { label } : {}),
    type: row.type || "default",
    points,
    source: "guard",
    deviceVirtual: deviceVirtual as Device["deviceVirtual"],
    createdAt: created,
    updatedAt: created,
  };
}
