import type { DeviceBinding, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import { bindingRunningState, formatTelemetryText, mappingKeys, readLatest, type DevicePlate } from "./device-plates";
import { uniqueEntitiesFromParsed } from "./hmi-entities";

export type DrawerChip = {
  id: string;
  label: string;
  value: string;
  active?: boolean;
};

export type DrawerKpi = {
  id: string;
  label: string;
  value: string;
  dim: boolean;
};

export type ControlDrawerMode = "unselected" | "start-stop" | "no-start-stop";

export type ControlDrawerModel = {
  title: string;
  mode: ControlDrawerMode;
  providesStartStop: boolean;
  startStopNote?: string;
  bound: boolean;
  dataSummary: string;
  chips: DrawerChip[];
  kpis: DrawerKpi[];
};

export type DrawerControlContent = "none" | "start-stop" | "no-start-stop";

/** 未选中时不画出启动/停止键（包括禁用态）；失焦后抽屉只留细提手。 */
export function drawerControlContent(mode: ControlDrawerMode): DrawerControlContent {
  if (mode === "start-stop") return "start-stop";
  if (mode === "no-start-stop") return "no-start-stop";
  return "none";
}

export const DRAWER_COPY = {
  unselected: "未选中设备",
  unbound: "未绑定",
  bound: "已绑定",
  noStartStop: "该对象没有控制面板和屏幕，不提供启停",
  emptyChip: "—",
} as const;

function displayNameFor(hmi: ParsedHmiScene | null | undefined, node?: string | null): string {
  if (!hmi || !node) return DRAWER_COPY.unselected;
  const hit = uniqueEntitiesFromParsed(hmi).find((item) => item.node === node);
  return hit?.name || node;
}

function statusLabelOf(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/故障|fault/.test(raw)) return "故障";
  if (/报警|告警|alarm/.test(raw)) return "报警";
  if (/检修|maintain|service/.test(raw)) return "检修";
  if (/备用|standby/.test(raw)) return "备用";
  if (/运行|running/.test(raw)) return "运行";
  if (/停止|stop|stopped/.test(raw)) return "停止";
  return null;
}

function collectChips(
  bindings: DeviceBinding[],
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
): DrawerChip[] {
  const chips = new Map<string, DrawerChip>();
  const bump = (id: string, label: string, active: boolean) => {
    const prev = chips.get(id);
    if (prev) {
      const count = Number(prev.value);
      chips.set(id, { ...prev, value: String((Number.isFinite(count) ? count : 0) + (active ? 1 : 0)), active: prev.active || active });
      return;
    }
    chips.set(id, { id, label, value: active ? "1" : "0", active });
  };

  for (const binding of bindings) {
    if (!binding.deviceId) continue;
    const running = bindingRunningState(binding, latest);
    if (running === true) bump("running", "运行", true);
    if (running === false) bump("stopped", "停止", true);
    for (const mapping of binding.telemetryMappings) {
      const kind = statusLabelOf(`${mapping.label} ${mapping.field} ${mapping.telemetryKey}`);
      if (!kind || kind === "运行" || kind === "停止") continue;
      const row = readLatest(latest, binding.deviceId, mappingKeys(mapping));
      const active = Boolean(row && formatTelemetryText(row.value, mapping.displayType));
      bump(kind, kind, active);
    }
  }
  return [...chips.values()];
}

function consumptionText(
  bindings: DeviceBinding[],
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
): string | null {
  let total = 0;
  let unit = "";
  let hit = 0;
  for (const binding of bindings) {
    if (!binding.deviceId) continue;
    for (const mapping of binding.telemetryMappings) {
      const text = `${mapping.label} ${mapping.field} ${mapping.telemetryKey} ${mapping.unit ?? ""}`.toLowerCase();
      if (!/功率|消耗|power|kw/.test(text)) continue;
      const row = readLatest(latest, binding.deviceId, mappingKeys(mapping));
      const num = typeof row?.value === "number" ? row.value : Number(row?.value);
      if (!Number.isFinite(num)) continue;
      total += num;
      hit += 1;
      unit = mapping.unit || unit || "kW";
    }
  }
  if (!hit) return null;
  const body = Number.isInteger(total) ? String(total) : total.toFixed(1);
  return unit ? `${body} ${unit}` : body;
}

export function buildControlDrawerModel(args: {
  hmi: ParsedHmiScene | null | undefined;
  selectedNode?: string | null;
  plates?: DevicePlate[];
  bindings: DeviceBinding[];
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
  alarmCount?: number | null;
}): ControlDrawerModel {
  const { hmi, selectedNode, plates = [], bindings, latest, alarmCount } = args;
  const selectedPlate = plates.find((plate) => plate.node === selectedNode);
  const selectedBindings = selectedNode
    ? bindings.filter((item) => item.sceneEntityId === selectedNode || item.sceneEntityId === selectedPlate?.node)
    : [];
  const providesStartStop = Boolean(
    hmi?.devices.find((item) => item.node === selectedNode)?.hasNameplateControls,
  );
  const bound = selectedPlate ? selectedPlate.bound : selectedBindings.some((item) => Boolean(item.deviceId));
  const dataSummary = !selectedNode
    ? DRAWER_COPY.unbound
    : bound
      ? selectedPlate?.lines.filter((line) => !line.missing).slice(0, 2).map((line) => `${line.label} ${line.text}`).join(" · ") || DRAWER_COPY.bound
      : DRAWER_COPY.unbound;

  const chips = collectChips(bindings, latest);
  const running = chips.find((chip) => chip.id === "running");
  const deviceTotal = hmi?.devices.length ?? 0;
  const consumption = consumptionText(bindings, latest);
  const alarmValue = typeof alarmCount === "number" ? String(alarmCount) : null;

  const mode: ControlDrawerMode = !selectedNode ? "unselected" : providesStartStop ? "start-stop" : "no-start-stop";
  return {
    title: displayNameFor(hmi, selectedNode),
    mode,
    providesStartStop,
    startStopNote: mode === "no-start-stop" ? DRAWER_COPY.noStartStop : undefined,
    bound,
    dataSummary,
    chips,
    kpis: [
      { id: "running", label: "运行设备", value: running?.value ?? "—", dim: !running },
      { id: "total", label: "设备总数", value: deviceTotal ? String(deviceTotal) : "—", dim: !deviceTotal },
      { id: "alarms", label: "系统告警", value: alarmValue ?? "—", dim: alarmValue == null },
      { id: "consumption", label: "总消耗量", value: consumption ?? "—", dim: !consumption },
    ],
  };
}
