import type {
  ActionMapping,
  BindableSignal,
  CommandDef,
  Device,
  DeviceBinding,
  DevicePoint,
  SceneEntity,
  TelemetryMapping,
} from "@idt/shared-types";
import { slugKey } from "../services/device/deviceService";
import { formatPlatformDeviceName, isVirtualPlatformDevice } from "@idt/data-adapter";

const BUTTON_SUFFIX = /控制面板|屏幕/g;
const TAG_RE = /(\d+)\s*[#＃号]/g;
const SPLIT_RE = /[（）()【】\[\]·•.,，、_\-\/\s]+/;
const MATCH_THRESHOLD = 80;

export function tokenizeName(raw: string): string[] {
  const cleaned = (raw ?? "").replace(BUTTON_SUFFIX, " ");
  const tokens = cleaned
    .split(SPLIT_RE)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function extractUnitTag(raw: string): string | undefined {
  TAG_RE.lastIndex = 0;
  const match = TAG_RE.exec(raw ?? "");
  return match ? `${match[1]}#` : undefined;
}

function tokenCovers(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 2 && b.includes(a)) return true;
  if (b.length >= 2 && a.includes(b)) return true;
  return false;
}

function entityTokensCovered(entityTokens: string[], deviceTokens: string[]): boolean {
  if (entityTokens.length === 0 || deviceTokens.length === 0) return false;
  return entityTokens.every((entityToken) => deviceTokens.some((deviceToken) => tokenCovers(entityToken, deviceToken)));
}

export function scoreNameMatch(entityName: string, deviceName: string): number {
  const entityTag = extractUnitTag(entityName);
  const deviceTag = extractUnitTag(deviceName);
  if (entityTag && deviceTag && entityTag !== deviceTag) return 0;

  const entityTokens = tokenizeName(entityName);
  const deviceTokens = tokenizeName(deviceName);
  if (!entityTokensCovered(entityTokens, deviceTokens)) return 0;

  let score = 70;
  const same = entityTokens.filter((entityToken) => deviceTokens.includes(entityToken)).length;
  score += Math.min(20, same * 6);
  if (entityTag && entityTag === deviceTag) score += 15;
  if (entityTokens.join("") === deviceTokens.join("")) score += 10;
  return Math.min(100, score);
}

export function isGatewayDevice(device: Pick<Device, "name" | "type">): boolean {
  const text = `${device.type} ${device.name}`.toLowerCase();
  return text.includes("网关") || text.includes("gateway");
}

export function pickDeviceForEntity(entityName: string, devices: Device[]): Device | undefined {
  let best: Array<{ device: Device; score: number }> = [];
  for (const device of devices) {
    if (isVirtualPlatformDevice(device)) continue;
    const score = scoreNameMatch(entityName, device.name);
    if (score < MATCH_THRESHOLD) continue;
    const lead = best[0];
    if (!lead || score > lead.score) {
      best = [{ device, score }];
    } else if (score === lead.score) {
      best.push({ device, score });
    }
  }
  const top = best[0];
  if (!top) return undefined;
  if (best.length === 1) return top.device;
  const specific = best.filter((item) => !isGatewayDevice(item.device));
  return specific.length === 1 ? specific[0]?.device : undefined;
}

/** 有位号时按名称/位号建议；没有位号（泵、PLC、三通等）只做精确名称匹配，一对多就不猜。 */
export function pickDeviceByBindingRule(entityName: string, devices: Device[]): Device | undefined {
  if (extractUnitTag(entityName)) return pickDeviceForEntity(entityName, devices);
  const exact = devices.filter((device) => !isVirtualPlatformDevice(device) && device.name.trim() === entityName.trim());
  return exact.length === 1 ? exact[0] : undefined;
}

function isStartAction(actionId: string, actionLabel: string): boolean {
  const text = `${actionId} ${actionLabel}`.toLowerCase();
  return actionId.toLowerCase() === "start" || actionLabel === "启动" || text.includes("启动") || /\bstart\b/.test(text);
}

function isStopAction(actionId: string, actionLabel: string): boolean {
  const text = `${actionId} ${actionLabel}`.toLowerCase();
  return actionId.toLowerCase() === "stop" || actionLabel === "停止" || text.includes("停止") || /\bstop\b/.test(text);
}

function commandTarget(command: CommandDef): string {
  const id = command.id;
  const idx = id.indexOf(":");
  if (idx > 0) return id.slice(idx + 1);
  return "";
}

function isBroadcastCommand(command: CommandDef): boolean {
  const id = command.id.toLowerCase().replace(/[_-]/g, "");
  return id === "startall" || id === "stopall";
}

function preferTargetName(entityName: string, devices: Device[]): string | undefined {
  return pickDeviceForEntity(entityName, devices)?.name;
}

export function suggestCommandForAction(
  actionId: string,
  actionLabel: string,
  commands: CommandDef[],
  context?: { entityName: string; boundDevice?: Pick<Device, "name" | "type">; devices?: Device[] },
): { command: CommandDef; params?: Record<string, unknown> } | undefined {
  if (commands.length === 0) return undefined;

  const start = isStartAction(actionId, actionLabel);
  const stop = isStopAction(actionId, actionLabel);
  const prefix = start ? "start" : stop ? "stop" : "";
  const entityName = context?.entityName ?? "";
  const devices = context?.devices ?? [];
  const preferredName = entityName ? preferTargetName(entityName, devices) : undefined;

  const exact = commands.find((c) => c.id === actionId || c.label === actionLabel);
  if (exact && !isBroadcastCommand(exact)) {
    const params = targetParamsForCommand(exact, entityName, devices, preferredName, context?.boundDevice);
    return { command: exact, params };
  }

  if (prefix) {
    const plain = commands.find((c) => c.id.toLowerCase() === prefix || c.label === (start ? "启动" : "停止"));
    if (plain && !isBroadcastCommand(plain)) {
      const params = targetParamsForCommand(plain, entityName, devices, preferredName, context?.boundDevice);
      return { command: plain, params };
    }

    const prefixed = commands
      .filter((c) => {
        const id = c.id.toLowerCase();
        return id.startsWith(`${prefix}:`) || id.startsWith(`${prefix}/`);
      })
      .map((command) => {
        const target = commandTarget(command) || command.label;
        const score = Math.max(
          scoreNameMatch(entityName, target),
          preferredName ? scoreNameMatch(preferredName, target) : 0,
        );
        return { command, score };
      })
      .filter((item) => item.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    const topPrefixed = prefixed[0];
    const nextPrefixed = prefixed[1];
    if (topPrefixed && (prefixed.length === 1 || (nextPrefixed && topPrefixed.score > nextPrefixed.score))) {
      return { command: topPrefixed.command };
    }
  }

  const loose = commands.find((c) => {
    if (isBroadcastCommand(c)) return false;
    const text = `${c.id} ${c.label}`.toLowerCase();
    return text.includes(actionId.toLowerCase()) || (actionLabel && c.label.includes(actionLabel));
  });
  if (loose) return { command: loose };
  return undefined;
}

const TARGET_PARAM_NAMES = new Set(["target", "device", "deviceid", "devicename", "name"]);

export function targetParamsForCommand(
  command: CommandDef,
  entityName: string,
  devices: Device[],
  preferredName?: string,
  boundDevice?: Pick<Device, "name" | "type">,
): Record<string, unknown> | undefined {
  if (!command.params?.length) return undefined;
  if (boundDevice && !isGatewayDevice(boundDevice)) return undefined;
  const target = preferredName ?? preferTargetName(entityName, devices);
  if (!target) return undefined;
  const field = command.params.find((p) => TARGET_PARAM_NAMES.has(p.name.toLowerCase()));
  if (!field) return undefined;
  return { [field.name]: target };
}

export function suggestPoint(signalName: string, points: DevicePoint[]): DevicePoint | undefined {
  const slug = slugKey(signalName);
  const exact = points.filter((p) => p.key === slug || p.key === signalName || p.label === signalName);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  const loose = points.filter((p) => p.label.includes(signalName) || signalName.includes(p.label) || p.key.includes(slug));
  return loose.length === 1 ? loose[0] : undefined;
}

export function isVisualEffectAction(actionId: string, label = ""): boolean {
  const text = `${actionId} ${label}`.toLowerCase();
  if (/(^|[:/_-])(start|stop)([:/_-]|$)/.test(text) || /启动|停止/.test(`${actionId} ${label}`)) return false;
  return /spin|blink|fan|led|风扇|指示灯|叶轮|swing|gauge|door|摆针|柜门|flow|open|close|管道|流动|阀门|仪表/.test(text);
}

export function buildDeviceBinding(args: {
  existingId?: string;
  createId: () => string;
  entity: SceneEntity;
  device: Device;
  signals: BindableSignal[];
  points: DevicePoint[];
  commands: CommandDef[];
  devices: Device[];
}): DeviceBinding {
  const { entity, device, signals, points, commands, devices } = args;
  const telemetryMappings: TelemetryMapping[] = signals
    .filter((s) => s.kind === "telemetry")
    .map((s) => {
      const point = suggestPoint(s.name, points) ?? suggestPoint(s.label.replace(/（.*?）$/u, ""), points);
      return {
        field: s.name,
        telemetryKey: point?.key ?? "",
        label: s.label,
        unit: s.unit ?? point?.unit,
        displayType: s.valueType,
      };
    })
    .filter((item) => item.telemetryKey);
  const actionMappings: ActionMapping[] = signals
    .filter((s) => s.kind === "action")
    .map((s) => ({
      actionId: s.name,
      label: s.label,
      clip: s.clip,
    }));
  void commands;
  void devices;
  const statusPoint = suggestPoint("运行状态", points) ?? suggestPoint("running", points);
  return {
    id: args.existingId ?? args.createId(),
    sceneEntityId: entity.id,
    deviceId: device.id,
    deviceName: formatPlatformDeviceName(device),
    telemetryMappings,
    actionMappings,
    statusMapping: statusPoint
      ? {
          telemetryKey: statusPoint.key,
          rules: [
            { operator: "eq", value: false, state: "warning" },
            { operator: "eq", value: "停止", state: "warning" },
            { operator: "eq", value: true, state: "normal" },
            { operator: "eq", value: "运行", state: "normal" },
          ],
        }
      : undefined,
  };
}

export function signalsForEntity(signals: BindableSignal[], entity: SceneEntity): BindableSignal[] {
  return signals.filter((b) => b.entityNode === entity.nodeName || b.entityNode === entity.id);
}

export type MatchBindingPlan = {
  entity: SceneEntity;
  device: Device;
  signals: BindableSignal[];
};

export function planNameMatches(args: {
  entities: SceneEntity[];
  devices: Device[];
  bindables: BindableSignal[];
  existing?: DeviceBinding[];
  overwrite?: boolean;
}): { plans: MatchBindingPlan[]; skippedBound: number; unmatched: number } {
  const existingByEntity = new Map((args.existing ?? []).map((b) => [b.sceneEntityId, b]));
  const plans: MatchBindingPlan[] = [];
  let skippedBound = 0;
  let unmatched = 0;
  for (const entity of args.entities) {
    const device = pickDeviceByBindingRule(entity.name, args.devices);
    const existing = existingByEntity.get(entity.id) ?? existingByEntity.get(entity.nodeName ?? "");
    if (!device) {
      unmatched += 1;
      continue;
    }
    if (existing && existing.deviceId !== device.id && !args.overwrite) {
      skippedBound += 1;
      continue;
    }
    plans.push({
      entity,
      device,
      signals: signalsForEntity(args.bindables, entity),
    });
  }
  return { plans, skippedBound, unmatched };
}

