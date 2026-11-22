
import type { DeviceBinding, HmiDevice, TelemetryRecord } from "@idt/shared-types";
import { formatHmiDeviceName } from "@idt/engine-adapter";

export type PlateLine = {
  label: string;
  text: string;
  missing: boolean;
};

export type DevicePlate = {
  node: string;
  title: string;
  bound: boolean;
  source?: "live" | "demo";
  running: boolean | null;
  lines: PlateLine[];
  kind: "board" | "badge";
  showStartStop: boolean;
};

const MAX_LINES = 4;

export function formatTelemetryText(value: unknown, displayType?: string, unit?: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean" || displayType === "boolean") {
    return isTruthyState(value) ? "运行" : "停止";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const body = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return unit ? `${body} ${unit}` : body;
  }
  const asNumber = typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : null;
  if (asNumber !== null && Number.isFinite(asNumber) && displayType !== "text") {
    const body = Number.isInteger(asNumber) ? String(asNumber) : asNumber.toFixed(1);
    return unit ? `${body} ${unit}` : body;
  }
  return unit ? `${String(value)} ${unit}` : String(value);
}

export function isTruthyState(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on" || value === "运行" || value === "开";
}

export function readLatest(
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
  deviceId: string,
  keys: Array<string | undefined | null>,
): TelemetryRecord | undefined {
  const get = (key: string) => {
    const id = `${deviceId}:${key}`;
    return latest instanceof Map ? latest.get(id) : latest[id];
  };
  for (const key of keys) {
    if (!key) continue;
    const row = get(key);
    if (row && row.value !== undefined && row.value !== null && row.value !== "") return row;
  }
  return undefined;
}

export function mappingKeys(mapping: DeviceBinding["telemetryMappings"][number]): string[] {
  return [mapping.telemetryKey, mapping.field].filter((k): k is string => Boolean(k));
}

function isRunningMapping(mapping: DeviceBinding["telemetryMappings"][number]): boolean {
  const text = `${mapping.label} ${mapping.field} ${mapping.telemetryKey}`.toLowerCase();
  return /状态|running|runstate/.test(text) && !/启停/.test(text);
}

export function bindingRunningState(
  binding: DeviceBinding,
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
): boolean | null {
  const keys = [
    binding.statusMapping?.telemetryKey,
    ...binding.telemetryMappings.filter(isRunningMapping).flatMap((m) => mappingKeys(m)),
  ];
  const row = readLatest(latest, binding.deviceId, keys);
  if (!row) return null;
  return isTruthyState(row.value);
}

function preferredMappings(bindings: DeviceBinding[]): DeviceBinding["telemetryMappings"] {
  const seen = new Set<string>();
  const out: DeviceBinding["telemetryMappings"] = [];
  const list = bindings.flatMap((b) => b.telemetryMappings);
  for (const mapping of list) {
    const id = mapping.field || mapping.telemetryKey || mapping.label;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(mapping);
  }
  return out;
}

export function buildDevicePlates(args: {
  devices: HmiDevice[];
  bindings: DeviceBinding[];
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
  source?: "live" | "demo";
}): DevicePlate[] {
  const { devices, bindings, latest, source } = args;
  const byNode = new Map<string, DeviceBinding[]>();
  for (const binding of bindings) {
    if (!binding.sceneEntityId) continue;
    const list = byNode.get(binding.sceneEntityId) ?? [];
    list.push(binding);
    byNode.set(binding.sceneEntityId, list);
  }

  const plates: DevicePlate[] = [];
  const seen = new Set<string>();
  for (const device of devices) {
    if (!device.node || seen.has(device.node)) continue;
    const nodeBindings = byNode.get(device.node) ?? [];
    const bound = nodeBindings.some((b) => Boolean(b.deviceId));
    const hasBoard = (device.data?.length ?? 0) > 0;
    const showStartStop = Boolean(device.hasNameplateControls);
    const hasSignals = hasBoard || (device.actions?.length ?? 0) > 0;
    // 三通、弯头、管配件：默认不占铭牌；泵/PLC 只用轻量连接签。
    if (!bound && !hasSignals && !showStartStop) continue;
    seen.add(device.node);
    const title = formatHmiDeviceName(device.name, device.tag);
    const kind: DevicePlate["kind"] = hasBoard || showStartStop ? "board" : "badge";
    const runningStates = kind === "board"
      ? nodeBindings.map((b) => bindingRunningState(b, latest)).filter((v): v is boolean => v !== null)
      : [];
    const running = kind === "board" && runningStates.length ? runningStates.some(Boolean) : null;
    const lines: PlateLine[] = [];
    if (kind === "badge") {
      lines.push({ label: "连接", text: bound ? "已连接" : "未连接", missing: !bound });
    } else if (!bound) {
      lines.push({ label: "连接", text: "未连接", missing: true });
    } else if (hasBoard) {
      for (const mapping of preferredMappings(nodeBindings).slice(0, MAX_LINES)) {
        const binding = nodeBindings.find((b) => b.telemetryMappings.includes(mapping)) ?? nodeBindings[0];
        const row = binding ? readLatest(latest, binding.deviceId, mappingKeys(mapping)) : undefined;
        const text = formatTelemetryText(row?.value, mapping.displayType, mapping.unit);
        lines.push({
          label: mapping.label || mapping.field,
          text: text || "暂无数据",
          missing: !text,
        });
      }
      if (lines.length === 0) {
        lines.push({ label: "数据", text: "暂无数据", missing: true });
      }
    }
    plates.push({ node: device.node, title, bound, source, running, lines, kind, showStartStop });
  }
  return plates;
}
