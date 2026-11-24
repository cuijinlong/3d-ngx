import type { ActionMapping, Device, DeviceBinding, SceneEntity, StatusMapping, StatusRule, TelemetryMapping } from "@idt/shared-types";
import { isRealtimePlatformDevice, isVirtualPlatformDevice } from "./device-virtual";
import {
  OVERVIEW_SITUATION_TEMPLATE_ID,
  applyScreenTemplate,
  getBuiltinScreenTemplate,
  parseRegionTitles,
  parseTemplateInterfaceBindings,
  rematerializeLayout,
  resolveScreenTemplate,
  type ScreenTemplate,
  type TemplateInterfaceBinding,
} from "./screen-template";
import type { SceneWidgetLayout } from "./scene-widget-layout";

export const SCREEN_WIRING_SCHEMA = "1.0.0" as const;
export const SCREEN_WIRING_KIND = "screen-wiring" as const;

export interface ScreenObjectWiring {
  objectName: string;
  deviceId: string;
  deviceName?: string;
  telemetryMappings?: TelemetryMapping[];
  actionMappings?: ActionMapping[];
  statusMapping?: StatusMapping;
}

export interface ScreenWiringDocument {
  schemaVersion: "1.0.0";
  kind: "screen-wiring";
  templateId: string;
  templateVersion?: number;
  regionTitles?: Record<string, string>;
  interfaceBindings: TemplateInterfaceBinding[];
  objectBindings: ScreenObjectWiring[];
}

export type WiringIssueStatus =
  | "bound"
  | "empty"
  | "invalid"
  | "virtual"
  | "unresolved"
  | "unbound"
  | "unmatched"
  | "pending-devices";

export interface WiringReviewItem {
  id: string;
  title: string;
  key?: string;
  optional?: boolean;
  ok: boolean;
  status: WiringIssueStatus;
  detail: string;
  deviceId?: string;
  deviceName?: string;
}

export interface ScreenWiringReview {
  templateId?: string;
  templateName?: string;
  cards: WiringReviewItem[];
  objects: WiringReviewItem[];
  issueCount: number;
}

export interface ScreenWiringApplyReport {
  keptInterfaces: number;
  rejectedInterfaces: number;
  keptObjects: number;
  rejectedObjects: number;
  issues: string[];
}

export interface ScreenWiringApplyResult {
  layout: SceneWidgetLayout;
  bindings: DeviceBinding[];
  report: ScreenWiringApplyReport;
  review: ScreenWiringReview;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isFilledBinding(binding: TemplateInterfaceBinding): boolean {
  if (binding.source === "device-point" || binding.deviceId || binding.telemetryKey) {
    return Boolean(binding.deviceId);
  }
  return Boolean(binding.siteId || binding.topologyId);
}

function parseTelemetryMapping(raw: unknown): TelemetryMapping | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const field = text(row.field);
  const telemetryKey = text(row.telemetryKey);
  if (!field || !telemetryKey) return null;
  const mapping: TelemetryMapping = {
    field,
    telemetryKey,
    label: text(row.label) || field,
    displayType: row.displayType === "boolean" || row.displayType === "text" || row.displayType === "number"
      ? row.displayType
      : "number",
  };
  const unit = text(row.unit);
  if (unit) mapping.unit = unit;
  return mapping;
}

function parseActionMapping(raw: unknown): ActionMapping | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const actionId = text(row.actionId);
  if (!actionId) return null;
  const mapping: ActionMapping = {
    actionId,
    label: text(row.label) || actionId,
  };
  const clip = text(row.clip);
  const telemetryKey = text(row.telemetryKey);
  const commandId = text(row.commandId);
  if (clip) mapping.clip = clip;
  if (telemetryKey) mapping.telemetryKey = telemetryKey;
  if (row.whenValue !== undefined) mapping.whenValue = row.whenValue as string | number | boolean;
  if (commandId) mapping.commandId = commandId;
  if (row.commandParams && typeof row.commandParams === "object" && !Array.isArray(row.commandParams)) {
    mapping.commandParams = row.commandParams as Record<string, unknown>;
  }
  return mapping;
}

function parseStatusMapping(raw: unknown): StatusMapping | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const telemetryKey = text(row.telemetryKey);
  if (!telemetryKey || !Array.isArray(row.rules)) return undefined;
  const rules: StatusRule[] = [];
  for (const item of row.rules) {
    if (!item || typeof item !== "object") continue;
    const rule = item as Record<string, unknown>;
    const operator = rule.operator;
    const state = rule.state;
    if (operator !== "eq" && operator !== "gt" && operator !== "gte" && operator !== "lt" && operator !== "lte") continue;
    if (state !== "normal" && state !== "warning" && state !== "alarm" && state !== "offline") continue;
    if (rule.value === undefined) continue;
    rules.push({ operator, value: rule.value as number | string | boolean, state });
  }
  if (!rules.length) return undefined;
  return { telemetryKey, rules };
}

export function parseScreenObjectWiring(raw: unknown): ScreenObjectWiring | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const objectName = text(row.objectName) || text(row.nodeName) || text(row.name);
  const deviceId = text(row.deviceId);
  if (!objectName || !deviceId) return null;
  const wiring: ScreenObjectWiring = { objectName, deviceId };
  const deviceName = text(row.deviceName);
  if (deviceName) wiring.deviceName = deviceName;
  if (Array.isArray(row.telemetryMappings)) {
    wiring.telemetryMappings = row.telemetryMappings.map(parseTelemetryMapping).filter((item): item is TelemetryMapping => Boolean(item));
  }
  if (Array.isArray(row.actionMappings)) {
    wiring.actionMappings = row.actionMappings.map(parseActionMapping).filter((item): item is ActionMapping => Boolean(item));
  }
  const status = parseStatusMapping(row.statusMapping);
  if (status) wiring.statusMapping = status;
  return wiring;
}

export function parseScreenWiring(raw: unknown): ScreenWiringDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const kind = text(row.kind);
  if (kind !== SCREEN_WIRING_KIND) return null;
  const templateId = text(row.templateId);
  if (!templateId) return null;
  const document: ScreenWiringDocument = {
    schemaVersion: "1.0.0",
    kind: "screen-wiring",
    templateId,
    interfaceBindings: parseTemplateInterfaceBindings(row.interfaceBindings),
    objectBindings: Array.isArray(row.objectBindings)
      ? row.objectBindings.map(parseScreenObjectWiring).filter((item): item is ScreenObjectWiring => Boolean(item))
      : [],
  };
  const version = typeof row.templateVersion === "number" && Number.isFinite(row.templateVersion)
    ? Math.max(1, Math.floor(row.templateVersion))
    : undefined;
  if (version) document.templateVersion = version;
  const titles = parseRegionTitles(row.regionTitles);
  if (titles) document.regionTitles = titles;
  return document;
}

type DeviceRef = Pick<Device, "id" | "name" | "source" | "deviceVirtual"> & { additionalInfo?: unknown; label?: string };

function deviceById(devices: DeviceRef[], deviceId: string): DeviceRef | undefined {
  return devices.find((item) => item.id === deviceId);
}

export function describeDeviceBindingIssue(deviceId: string | undefined, devices: DeviceRef[]): { status: WiringIssueStatus; detail: string } | null {
  if (!deviceId) return { status: "empty", detail: "还没有对接结果" };
  if (!devices.length) return { status: "pending-devices", detail: "实时设备列表尚未就绪，待核对" };
  const device = deviceById(devices, deviceId);
  if (!device) return { status: "unresolved", detail: "对接的设备不在当前实时设备列表里，未生效" };
  if (isVirtualPlatformDevice(device) || !isRealtimePlatformDevice(device)) {
    return { status: "virtual", detail: `已拒绝虚拟设备「${device.label || device.name || deviceId}」，不能绑定` };
  }
  return null;
}

function matchEntity(entities: Array<Pick<SceneEntity, "id" | "name" | "nodeName">>, objectName: string) {
  const needle = objectName.trim();
  return entities.find((item) => item.nodeName === needle || item.name === needle || item.id === needle);
}

function acceptInterfaceBinding(binding: TemplateInterfaceBinding, devices: DeviceRef[]): { ok: boolean; issue?: string } {
  if (!isFilledBinding(binding)) return { ok: false, issue: `${binding.regionId}.${binding.key} 不完整，已跳过` };
  if (binding.deviceId) {
    const issue = describeDeviceBindingIssue(binding.deviceId, devices);
    if (issue && issue.status !== "pending-devices") {
      return { ok: false, issue: `${binding.regionId}.${binding.key}：${issue.detail}` };
    }
  }
  return { ok: true };
}

export function applyScreenWiring(input: {
  wiring: ScreenWiringDocument;
  layout?: SceneWidgetLayout | null;
  bindings?: DeviceBinding[];
  entities?: Array<Pick<SceneEntity, "id" | "name" | "nodeName">>;
  devices?: DeviceRef[];
  sceneName?: string;
}): ScreenWiringApplyResult {
  const devices = input.devices ?? [];
  const entities = input.entities ?? [];
  const issues: string[] = [];
  const template = resolveScreenTemplate(input.layout) ?? getBuiltinScreenTemplate(input.wiring.templateId) ?? getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID);
  if (!template) {
    const empty: SceneWidgetLayout = input.layout ?? { schemaVersion: "1.0.0", widgets: [] };
    const report = { keptInterfaces: 0, rejectedInterfaces: 0, keptObjects: 0, rejectedObjects: 0, issues: ["找不到对应的画面模板"] };
    return { layout: empty, bindings: input.bindings ?? [], report, review: reviewScreenWiring({ layout: empty, bindings: input.bindings ?? [], entities, devices, template: undefined }) };
  }

  let layout: SceneWidgetLayout = input.layout && input.layout.templateId
    ? input.layout
    : applyScreenTemplate(input.layout, template, input.sceneName);

  const keptInterfaces: TemplateInterfaceBinding[] = [];
  let rejectedInterfaces = 0;
  for (const binding of input.wiring.interfaceBindings) {
    const accepted = acceptInterfaceBinding(binding, devices);
    if (!accepted.ok) {
      rejectedInterfaces += 1;
      if (accepted.issue) issues.push(accepted.issue);
      continue;
    }
    keptInterfaces.push(binding);
  }

  layout = rematerializeLayout({
    ...layout,
    templateId: input.wiring.templateId || layout.templateId,
    templateVersion: input.wiring.templateVersion ?? layout.templateVersion,
    interfaceBindings: keptInterfaces,
    regionTitles: input.wiring.regionTitles ?? layout.regionTitles,
  }, input.sceneName);

  const nextBindings = [...(input.bindings ?? [])];
  let keptObjects = 0;
  let rejectedObjects = 0;
  for (const item of input.wiring.objectBindings) {
    const deviceIssue = describeDeviceBindingIssue(item.deviceId, devices);
    if (deviceIssue && deviceIssue.status !== "pending-devices") {
      rejectedObjects += 1;
      issues.push(`${item.objectName}：${deviceIssue.detail}`);
      continue;
    }
    const entity = matchEntity(entities, item.objectName);
    if (!entity) {
      rejectedObjects += 1;
      issues.push(`${item.objectName}：模型里找不到这个对象，未对接`);
      continue;
    }
    const device = deviceById(devices, item.deviceId);
    const existing = nextBindings.find((row) => row.sceneEntityId === entity.id || row.sceneEntityId === entity.nodeName);
    const rest = nextBindings.filter((row) => row.sceneEntityId !== entity.id && row.sceneEntityId !== entity.nodeName);
    rest.push({
      id: existing?.id || `wire-${entity.id}`,
      sceneEntityId: entity.id,
      deviceId: item.deviceId,
      deviceName: item.deviceName || device?.name || existing?.deviceName || item.deviceId,
      telemetryMappings: item.telemetryMappings ?? existing?.telemetryMappings ?? [],
      actionMappings: item.actionMappings ?? existing?.actionMappings ?? [],
      statusMapping: item.statusMapping ?? existing?.statusMapping,
    });
    nextBindings.length = 0;
    nextBindings.push(...rest);
    keptObjects += 1;
  }

  const report: ScreenWiringApplyReport = {
    keptInterfaces: keptInterfaces.length,
    rejectedInterfaces,
    keptObjects,
    rejectedObjects,
    issues,
  };
  return {
    layout,
    bindings: nextBindings,
    report,
    review: reviewScreenWiring({ layout, bindings: nextBindings, entities, devices, template }),
  };
}

/** skill 生成的整份接线一次落盘。与 applyScreenWiring 相同。 */
export const applyGeneratedWiring = applyScreenWiring;
/** 场景接线一次落盘。与 applyScreenWiring 相同。 */
export const applySceneWiring = applyScreenWiring;

export function reviewScreenWiring(input: {
  layout?: SceneWidgetLayout | null;
  bindings?: DeviceBinding[];
  entities?: Array<Pick<SceneEntity, "id" | "name" | "nodeName">>;
  devices?: DeviceRef[];
  template?: ScreenTemplate;
}): ScreenWiringReview {
  const layout = input.layout ?? null;
  const template = input.template ?? resolveScreenTemplate(layout);
  const devices = input.devices ?? [];
  const entities = input.entities ?? [];
  const bindings = input.bindings ?? [];
  const cards: WiringReviewItem[] = [];
  for (const region of template?.regions ?? []) {
    for (const iface of region.interfaces) {
      const binding = (layout?.interfaceBindings ?? []).find((item) => item.regionId === region.id && item.key === iface.key);
      const title = (layout?.regionTitles?.[region.id] || region.defaultTitle || region.id);
      const id = `${region.id}.${iface.key}`;
      if (!binding || !isFilledBinding(binding)) {
        cards.push({
          id,
          title,
          key: iface.key,
          optional: iface.optional,
          ok: Boolean(iface.optional),
          status: "empty",
          detail: iface.optional ? "可选接口，尚未对接" : "还没有对接结果",
        });
        continue;
      }
      const issue = binding.deviceId ? describeDeviceBindingIssue(binding.deviceId, devices) : null;
      if (issue) {
        cards.push({
          id,
          title,
          key: iface.key,
          optional: iface.optional,
          ok: issue.status === "pending-devices",
          status: issue.status,
          detail: issue.detail,
          deviceId: binding.deviceId,
        });
        continue;
      }
      const detail = binding.deviceId
        ? `已对接实时设备${binding.label || binding.deviceId}${binding.telemetryKey ? ` · ${binding.telemetryKey}` : ""}`
        : binding.topologyId
          ? `已对接本场景拓扑${binding.topologyName ? `（${binding.topologyName}）` : ""}`
          : `已对接场站${binding.siteName ? `（${binding.siteName}）` : ""}`;
      cards.push({
        id,
        title,
        key: iface.key,
        optional: iface.optional,
        ok: true,
        status: "bound",
        detail,
        deviceId: binding.deviceId,
      });
    }
  }

  const objects: WiringReviewItem[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    seen.add(entity.id);
    const binding = bindings.find((item) => item.sceneEntityId === entity.id || item.sceneEntityId === entity.nodeName);
    const title = entity.name || entity.nodeName || entity.id;
    if (!binding) {
      objects.push({ id: entity.id, title, ok: true, status: "unbound", detail: "这个对象还没有三维对接，铭牌和启停暂不可用" });
      continue;
    }
    const issue = describeDeviceBindingIssue(binding.deviceId, devices);
    if (issue && issue.status !== "pending-devices") {
      objects.push({
        id: entity.id,
        title,
        ok: false,
        status: issue.status,
        detail: issue.detail,
        deviceId: binding.deviceId,
        deviceName: binding.deviceName,
      });
      continue;
    }
    const points = binding.telemetryMappings.map((item) => item.label || item.telemetryKey).filter(Boolean);
    const actions = binding.actionMappings.map((item) => item.label || item.actionId).filter(Boolean);
    const commands = binding.actionMappings.filter((item) => item.commandId).map((item) => item.commandId);
    objects.push({
      id: entity.id,
      title,
      ok: true,
      status: issue?.status === "pending-devices" ? "pending-devices" : "bound",
      detail: issue
        ? issue.detail
        : `已对接 ${binding.deviceName || binding.deviceId}${points.length ? `；铭牌：${points.join("、")}` : ""}${actions.length ? `；行为：${actions.join("、")}` : ""}${commands.length ? `；启停命令：${commands.join("、")}` : ""}`,
      deviceId: binding.deviceId,
      deviceName: binding.deviceName,
    });
  }

  const issueCount = [...cards, ...objects].filter((item) => !item.ok).length;
  return {
    templateId: template?.id ?? layout?.templateId,
    templateName: template?.name,
    cards,
    objects,
    issueCount,
  };
}

export function summarizeWiringReport(report: ScreenWiringApplyReport): string {
  const parts = [
    `画面接口已应用 ${report.keptInterfaces} 项`,
    `三维对象已应用 ${report.keptObjects} 项`,
  ];
  if (report.rejectedInterfaces || report.rejectedObjects) {
    parts.push(`有 ${report.rejectedInterfaces + report.rejectedObjects} 项未生效`);
  }
  if (report.issues[0]) parts.push(report.issues[0]);
  return parts.join("。");
}
