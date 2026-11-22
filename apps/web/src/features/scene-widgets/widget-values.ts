
import type { Device, DeviceBinding, DevicePoint, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import { isRealtimePlatformDevice, type SceneWidget, type SceneWidgetSlot } from "@idt/data-adapter";
import { bindingRunningState, formatTelemetryText, mappingKeys, readLatest } from "../../utils/device-plates";

export type SlotReading = {
  label: string;
  text: string;
  unit?: string;
  bound: boolean;
  missing: boolean;
  source?: TelemetryRecord["source"];
  numeric?: number;
};

export function findBindingForSlot(slot: SceneWidgetSlot, bindings: DeviceBinding[]): DeviceBinding | undefined {
  if (slot.deviceId) {
    const byDevice = bindings.find((item) => item.deviceId === slot.deviceId);
    if (byDevice) return byDevice;
  }
  if (slot.sceneEntityId) {
    return bindings.find((item) => item.sceneEntityId === slot.sceneEntityId && item.deviceId);
  }
  return undefined;
}

function slotKeys(slot: SceneWidgetSlot, binding?: DeviceBinding): string[] {
  const preferred = [slot.telemetryKey, slot.key].filter((key): key is string => Boolean(key));
  if (!binding) return preferred;
  const mapped = binding.telemetryMappings.flatMap((item) => mappingKeys(item));
  if (preferred.length) {
    const hit = preferred.find((key) => mapped.includes(key) || key === slot.key);
    return hit ? [hit, ...preferred.filter((key) => key !== hit), ...mapped] : [...preferred, ...mapped];
  }
  return mapped;
}

/**
 * 展示路径：设备列表未就绪时不把有效实时读数打空；
 * 一旦列表里能判断该 ID 不是实时设备（含旧槽里的虚拟设备），就不得显示。
 */
export function canDisplayWidgetDeviceReading(
  deviceId: string | undefined,
  devices?: Array<Pick<Device, "id" | "source" | "deviceVirtual"> & { additionalInfo?: unknown }> | null,
): boolean {
  if (!deviceId) return false;
  if (!devices || devices.length === 0) return true;
  return isWidgetBindableDeviceId(deviceId, devices);
}

export function readSlotValue(
  slot: SceneWidgetSlot,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
): SlotReading {
  const binding = findBindingForSlot(slot, bindings);
  const deviceId = slot.deviceId || binding?.deviceId;
  const label = slot.label || binding?.deviceName || slot.telemetryKey || slot.key;
  if (!deviceId) {
    return { label, text: "", bound: false, missing: true };
  }
  if (!canDisplayWidgetDeviceReading(deviceId, devices)) {
    return { label, text: "", bound: false, missing: true };
  }
  const keys = slotKeys(slot, binding);
  const row = readLatest(latest, deviceId, keys);
  if (!row) {
    return { label, text: "", bound: true, missing: true };
  }
  const mapping = binding?.telemetryMappings.find((item) => keys.includes(item.telemetryKey) || keys.includes(item.field));
  const unit = slot.unit || mapping?.unit || row.unit;
  const numeric = typeof row.value === "number" && Number.isFinite(row.value)
    ? row.value
    : typeof row.value === "string" && row.value.trim() !== "" && Number.isFinite(Number(row.value))
      ? Number(row.value)
      : undefined;
  return {
    label,
    text: formatTelemetryText(row.value, mapping?.displayType, undefined),
    unit,
    bound: true,
    missing: false,
    source: row.source,
    numeric,
  };
}

export type WidgetPointOption = {
  telemetryKey: string;
  label: string;
  unit?: string;
};

export type WidgetDeviceOption = {
  deviceId: string;
  deviceName: string;
  sceneEntityId?: string;
  keys: WidgetPointOption[];
};

function pointOption(point: Pick<DevicePoint, "key" | "label" | "unit"> | { telemetryKey: string; label?: string; unit?: string }): WidgetPointOption | null {
  const telemetryKey = "telemetryKey" in point ? point.telemetryKey : point.key;
  if (!telemetryKey) return null;
  return { telemetryKey, label: point.label || telemetryKey, unit: point.unit };
}

function mergeKeys(into: WidgetPointOption[], extra: Array<WidgetPointOption | null | undefined>): WidgetPointOption[] {
  const seen = new Set(into.map((item) => item.telemetryKey));
  const next = [...into];
  for (const row of extra) {
    if (!row?.telemetryKey || seen.has(row.telemetryKey)) continue;
    seen.add(row.telemetryKey);
    next.push(row);
  }
  return next;
}

/** 只接受当前实时设备列表里的 ID。列表里没有的旧绑定（含虚拟设备）一律拒绝。 */
export function isWidgetBindableDeviceId(
  deviceId: string | undefined,
  devices: Array<Pick<Device, "id" | "source" | "deviceVirtual"> & { additionalInfo?: unknown }>,
): boolean {
  if (!deviceId) return false;
  const device = devices.find((item) => item.id === deviceId);
  return Boolean(device && isRealtimePlatformDevice(device));
}

/**
 * 把选中的实时设备写入卡片槽位。ID 不在实时列表中、或虽在 bindOptions 里却对不上设备时，返回空数组，不写槽。
 */
export function resolveWidgetBindingSlots(
  deviceId: string,
  telemetryKey: string | undefined,
  bindOptions: WidgetDeviceOption[],
  devices: Device[],
): SceneWidgetSlot[] {
  if (!isWidgetBindableDeviceId(deviceId, devices)) return [];
  const option = bindOptions.find((item) => item.deviceId === deviceId);
  if (!option) return [];
  const key = telemetryKey || option.keys[0]?.telemetryKey;
  const meta = option.keys.find((item) => item.telemetryKey === key) ?? option.keys[0];
  if (!meta) {
    return [{ key: "value", deviceId: option.deviceId, sceneEntityId: option.sceneEntityId, label: option.deviceName }];
  }
  return [{
    key: meta.telemetryKey,
    telemetryKey: meta.telemetryKey,
    label: meta.label,
    unit: meta.unit,
    sceneEntityId: option.sceneEntityId,
    deviceId: option.deviceId,
  }];
}

/**
 * 编排绑定点位：来自平台实时设备与 GLB extras.hmi，不写死名单。
 * fail-closed：不在实时设备列表中的 ID 不得进入选项，即使它还留在旧对象绑定里。
 */
export function widgetBindableDevices(input: {
  bindings: DeviceBinding[];
  devices?: Device[];
  hmi?: ParsedHmiScene | null;
  extraKeys?: Record<string, WidgetPointOption[]>;
}): WidgetDeviceOption[] {
  const devices = input.devices ?? [];
  const byId = new Map<string, WidgetDeviceOption>();

  const upsert = (option: WidgetDeviceOption) => {
    if (!isWidgetBindableDeviceId(option.deviceId, devices)) return;
    const current = byId.get(option.deviceId);
    if (!current) {
      byId.set(option.deviceId, { ...option, keys: mergeKeys([], option.keys) });
      return;
    }
    current.deviceName = current.deviceName || option.deviceName;
    if (!current.sceneEntityId && option.sceneEntityId) current.sceneEntityId = option.sceneEntityId;
    current.keys = mergeKeys(current.keys, option.keys);
  };

  for (const device of devices) {
    upsert({
      deviceId: device.id,
      deviceName: device.label || device.name,
      keys: (device.points ?? []).map((point) => pointOption(point)).filter((row): row is WidgetPointOption => Boolean(row)),
    });
  }

  for (const binding of input.bindings) {
    if (!binding.deviceId) continue;
    upsert({
      deviceId: binding.deviceId,
      deviceName: binding.deviceName,
      sceneEntityId: binding.sceneEntityId || undefined,
      keys: binding.telemetryMappings.map((mapping) => pointOption({
        telemetryKey: mapping.telemetryKey || mapping.field,
        label: mapping.label || mapping.telemetryKey || mapping.field,
        unit: mapping.unit,
      })).filter((row): row is WidgetPointOption => Boolean(row)),
    });
  }

  const hmi = input.hmi;
  if (hmi) {
    for (const device of hmi.devices ?? []) {
      const keys = (device.data ?? []).map((row) => pointOption({
        telemetryKey: row.name,
        label: row.name,
        unit: row.unit,
      })).filter((row): row is WidgetPointOption => Boolean(row));
      if (!keys.length) continue;
      const bound = input.bindings.find((item) => item.sceneEntityId === device.node);
      if (bound?.deviceId) {
        upsert({ deviceId: bound.deviceId, deviceName: bound.deviceName || device.name, sceneEntityId: bound.sceneEntityId, keys });
      }
    }
  }

  for (const [deviceId, keys] of Object.entries(input.extraKeys ?? {})) {
    const current = byId.get(deviceId);
    if (current) current.keys = mergeKeys(current.keys, keys);
  }

  return [...byId.values()];
}

export function bindingTelemetryOptions(
  bindings: DeviceBinding[],
  devices: Device[] = [],
  hmi?: ParsedHmiScene | null,
): WidgetDeviceOption[] {
  return widgetBindableDevices({ bindings, devices, hmi });
}

export type SceneSummary = {
  boundCount: number;
  withDataCount: number;
  runningCount: number;
  stoppedCount: number;
  unknownCount: number;
};

export function summarizeSceneBindings(
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
): SceneSummary {
  const bound = bindings.filter((item) => item.deviceId && canDisplayWidgetDeviceReading(item.deviceId, devices));
  let withDataCount = 0;
  let runningCount = 0;
  let stoppedCount = 0;
  let unknownCount = 0;
  for (const binding of bound) {
    const keys = [
      binding.statusMapping?.telemetryKey,
      ...binding.telemetryMappings.flatMap((item) => mappingKeys(item)),
    ];
    if (readLatest(latest, binding.deviceId, keys)) withDataCount += 1;
    const running = bindingRunningState(binding, latest);
    if (running === true) runningCount += 1;
    else if (running === false) stoppedCount += 1;
    else unknownCount += 1;
  }
  return {
    boundCount: bound.length,
    withDataCount,
    runningCount,
    stoppedCount,
    unknownCount,
  };
}

export function selectionBindings(
  selected: string | Array<string | null | undefined> | null | undefined,
  bindings: DeviceBinding[],
  devices?: Device[] | null,
): DeviceBinding[] {
  const keys = new Set(
    (Array.isArray(selected) ? selected : [selected]).filter((item): item is string => Boolean(item)),
  );
  if (!keys.size) return [];
  return bindings.filter((item) => item.deviceId && keys.has(item.sceneEntityId) && canDisplayWidgetDeviceReading(item.deviceId, devices));
}

export function hasSummaryCard(layoutWidgets: SceneWidget[]): SceneWidget | undefined {
  return layoutWidgets.find((item) => item.type === "summary-card");
}
