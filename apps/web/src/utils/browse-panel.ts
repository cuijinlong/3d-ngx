import type { DeviceBinding, HmiDevice, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import { uniqueEntitiesFromParsed } from "./hmi-entities";
import { formatTelemetryText, mappingKeys, readLatest } from "./device-plates";

export const BROWSE_COPY = {
  unselected: "未选中设备",
  unselectedHelp: "在画面上点要查看的对象。测点和图表按该对象的解析与绑定结果生成。",
  unboundLive: "未绑定，暂无测点",
  unboundLiveHelp: "点「编辑」选择目标设备后再查看实时检测。",
  unboundLiveHelpRuntime: "该对象尚未绑定目标设备，暂无测点。",
  unboundHistory: "未绑定，暂无历史数据",
  unboundHistoryHelp: "点「编辑」选择目标设备后再查看历史数据。",
  unboundHistoryHelpRuntime: "该对象尚未绑定目标设备，暂无历史数据。",
  noBoard: "无看板数据",
  noBoardHelp: "该对象在模型里没有看板数据，不套用模块机的测点或图表。",
  noHistory: "暂无历史数据",
} as const;

export type BrowseKind = "unselected" | "unbound" | "no-board" | "metrics";

export type BrowseMetric = {
  field: string;
  label: string;
  text: string;
  unit?: string;
  missing: boolean;
  telemetryKey?: string;
  deviceId?: string;
};

export function hasBoardData(device?: HmiDevice | null, dataCount = 0): boolean {
  return (device?.data?.length ?? dataCount) > 0;
}

export function browseKind(input: {
  selected: boolean;
  bound: boolean;
  hasBoard: boolean;
}): BrowseKind {
  if (!input.selected) return "unselected";
  if (!input.hasBoard) return "no-board";
  if (!input.bound) return "unbound";
  return "metrics";
}

export function browseEmptyCopy(
  kind: BrowseKind,
  tab: "live" | "history",
  allowEdit = true,
): { title: string; help: string } {
  if (kind === "unselected") return { title: BROWSE_COPY.unselected, help: BROWSE_COPY.unselectedHelp };
  if (kind === "no-board") return { title: BROWSE_COPY.noBoard, help: BROWSE_COPY.noBoardHelp };
  if (tab === "history") {
    return {
      title: BROWSE_COPY.unboundHistory,
      help: allowEdit ? BROWSE_COPY.unboundHistoryHelp : BROWSE_COPY.unboundHistoryHelpRuntime,
    };
  }
  return {
    title: BROWSE_COPY.unboundLive,
    help: allowEdit ? BROWSE_COPY.unboundLiveHelp : BROWSE_COPY.unboundLiveHelpRuntime,
  };
}

export function findHmiDevice(hmi: ParsedHmiScene | null | undefined, node?: string | null): HmiDevice | undefined {
  if (!hmi || !node) return undefined;
  return hmi.devices.find((item) => item.node === node);
}

export function browseHeading(
  hmi: ParsedHmiScene | null | undefined,
  node?: string | null,
): { title: string; subtitle?: string } {
  if (!node) return { title: "浏览画面" };
  const hit = hmi ? uniqueEntitiesFromParsed(hmi).find((item) => item.node === node) : undefined;
  return { title: hit?.name || node };
}

export function buildBrowseMetrics(args: {
  device?: HmiDevice | null;
  binding?: DeviceBinding;
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
}): BrowseMetric[] {
  const { device, binding, latest } = args;
  const rows = device?.data ?? [];
  return rows.map((item) => {
    const mapping = binding?.telemetryMappings.find((row) => row.field === item.name);
    const record = mapping && binding?.deviceId
      ? readLatest(latest, binding.deviceId, mappingKeys(mapping))
      : undefined;
    const text = formatTelemetryText(record?.value, mapping?.displayType, mapping?.unit ?? item.unit);
    return {
      field: item.name,
      label: item.unit ? `${item.name}` : item.name,
      unit: mapping?.unit ?? item.unit,
      text: text || "暂无数据",
      missing: !text,
      telemetryKey: mapping?.telemetryKey,
      deviceId: binding?.deviceId,
    };
  });
}
