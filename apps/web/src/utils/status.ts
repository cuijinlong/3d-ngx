
import type { DeviceBinding, DeviceStatus, TelemetryRecord } from "@idt/shared-types";

export function evalStatus(
  binding: DeviceBinding | undefined,
  latest: Map<string, TelemetryRecord>,
): DeviceStatus {
  if (!binding?.statusMapping) return "normal";
  const row = latest.get(`${binding.deviceId}:${binding.statusMapping.telemetryKey}`);
  if (!row || row.value === "离线") return "offline";
  const value = row.value;
  for (const rule of binding.statusMapping.rules) {
    if (match(rule.operator, value, rule.value)) return rule.state;
  }
  return "normal";
}

function match(
  op: "eq" | "gt" | "gte" | "lt" | "lte",
  left: string | number | boolean,
  right: string | number | boolean,
): boolean {
  if (op === "eq") return left === right || String(left) === String(right);
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

export const STATUS_COLOR: Record<DeviceStatus, string> = {
  normal: "#19b37d",
  warning: "#e8930c",
  alarm: "#e5484d",
  offline: "#5f6e84",
};

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  normal: "正常",
  warning: "预警",
  alarm: "告警",
  offline: "离线",
};
