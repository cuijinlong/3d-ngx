
import type { ActionMapping, DeviceBinding, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import { evalStatus } from "../../utils/status";
import { STATUS_COLOR } from "../../utils/status";
import { bindingRunningState, isTruthyState, readLatest } from "../../utils/device-plates";
import { EngineManager } from "../core/EngineManager";

export function isFanOrLedAction(actionId: string, label = ""): boolean {
  const text = `${actionId} ${label}`.toLowerCase();
  return /spin|blink|fan|led|风扇|指示灯|叶轮/.test(text);
}

export function isVisualDriveAction(actionId: string, label = ""): boolean {
  const text = `${actionId} ${label}`.toLowerCase();
  if (/(^|[:/_-])(start|stop)([:/_-]|$)/.test(text) || /启动|停止/.test(`${actionId} ${label}`)) return false;
  return /spin|blink|fan|led|风扇|指示灯|叶轮|swing|gauge|door|摆针|柜门|flow|open|close|管道|流动|阀门|仪表/.test(text);
}

function independentlyBound(mapping: ActionMapping | undefined): boolean {
  return Boolean(mapping?.telemetryKey);
}

export function applyBindingsToScene(
  hmi: ParsedHmiScene | null,
  bindings: DeviceBinding[],
  latest: Map<string, TelemetryRecord>,
): void {
  const engine = EngineManager.instance;
  const byNode = new Map<string, DeviceBinding>();
  for (const binding of bindings) {
    if (binding.sceneEntityId) byNode.set(binding.sceneEntityId, binding);
  }

  for (const binding of bindings) {
    const entity = binding.sceneEntityId;
    const status = evalStatus(binding, latest);
    engine.tintStatus(entity, STATUS_COLOR[status]);

    for (const action of binding.actionMappings) {
      if (!isVisualDriveAction(action.actionId, action.label)) continue;
      const shouldPlay = resolveAction(binding, action, latest);
      if (action.clip) engine.playNamedAnimation(action.clip, shouldPlay, entity);
      if (action.actionId.includes("spin") || action.label.includes("风扇")) {
        engine.setSpin(entity, shouldPlay);
      }
      if (action.actionId.includes("blink") || action.label.includes("指示灯")) {
        engine.setIndicator(entity, shouldPlay);
      }
      if (action.actionId.includes("swing:gauge") || action.label.includes("摆针") || action.label.includes("指针")) {
        engine.setSwing(entity, shouldPlay, "gauge");
      }
      if (action.actionId.includes("swing:door") || action.label.includes("柜门")) {
        engine.setSwing(entity, shouldPlay, "door");
      }
    }

    const signalDevice = hmi?.devices.find((d) => d.node === entity);
    if (signalDevice) {
      const running = isRunning(binding, latest);
      for (const action of signalDevice.actions) {
        const mapped = binding.actionMappings.find((item) => item.actionId === action.id);
        if (independentlyBound(mapped)) continue;
        if (action.id.includes("spin") || action.label.includes("风扇")) {
          engine.setSpin(entity, running);
          if (action.clip) engine.playNamedAnimation(action.clip, running, entity);
        }
        if (action.id.includes("blink") || action.label.includes("指示灯")) {
          engine.setIndicator(entity, running);
          if (action.clip) engine.playNamedAnimation(action.clip, running, entity);
        }
      }
    }
  }

  if (!hmi) return;

  const valveOpen = new Map<string, boolean>();
  for (const valve of hmi.valves) {
    const binding = byNode.get(valve.node);
    const mapped = binding?.actionMappings.find((item) => item.actionId === "open" || item.actionId === "close");
    if (binding && independentlyBound(mapped)) {
      valveOpen.set(valve.node, isOpen(binding, latest));
    } else {
      valveOpen.set(valve.node, valve.open ?? true);
    }
    if (valve.clips?.open) engine.playNamedAnimation(valve.clips.open, valveOpen.get(valve.node) === true, valve.node);
    if (valve.clips?.close) engine.playNamedAnimation(valve.clips.close, valveOpen.get(valve.node) === false, valve.node);
  }

  for (const pipe of hmi.pipes) {
    const binding = byNode.get(pipe.node);
    const mapped = binding?.actionMappings.find((item) => item.actionId === "flow");
    let on: boolean;
    if (binding && independentlyBound(mapped)) {
      on = resolveAction(binding, mapped!, latest);
    } else {
      const closers = (pipe.valves ?? []).filter((id) => hmi.valves.find((item) => item.node === id)?.stopsFlow);
      on = closers.every((id) => valveOpen.get(id) !== false);
    }
    if (pipe.flowClip) engine.playNamedAnimation(pipe.flowClip, on, pipe.node);
  }

  for (const instrument of hmi.instruments) {
    const binding = byNode.get(instrument.node);
    const mappedOn = binding?.actionMappings.find((item) => item.actionId === "on");
    const mappedOff = binding?.actionMappings.find((item) => item.actionId === "off");
    let on: boolean;
    if (binding && (independentlyBound(mappedOn) || independentlyBound(mappedOff))) {
      on = mappedOn ? resolveAction(binding, mappedOn, latest) : !resolveAction(binding, mappedOff!, latest);
    } else {
      const pipe = hmi.pipes.find((item) => item.node === instrument.pipe || item.instruments.includes(instrument.node));
      const closers = (pipe?.valves ?? []).filter((id) => hmi.valves.find((item) => item.node === id)?.stopsFlow);
      on = closers.every((id) => valveOpen.get(id) !== false);
    }
    if (instrument.clips?.on) engine.playNamedAnimation(instrument.clips.on, on, instrument.node);
    if (instrument.clips?.off) engine.playNamedAnimation(instrument.clips.off, !on, instrument.node);
  }
}

export function isRunning(binding: DeviceBinding, latest: Map<string, TelemetryRecord>): boolean {
  return bindingRunningState(binding, latest) === true;
}

function isOpen(binding: DeviceBinding, latest: Map<string, TelemetryRecord>): boolean {
  const keys = [
    ...binding.actionMappings.filter((m) => m.actionId === "open" || m.actionId === "close").map((m) => m.telemetryKey),
    ...binding.telemetryMappings
      .filter((m) => /开关|开度|open/.test(`${m.label} ${m.field} ${m.telemetryKey}`))
      .flatMap((m) => [m.telemetryKey, m.field]),
  ];
  const row = readLatest(latest, binding.deviceId, keys);
  if (!row) return true;
  if (typeof row.value === "number") return row.value > 0;
  return isTruthyState(row.value);
}

function resolveAction(
  binding: DeviceBinding,
  action: ActionMapping,
  latest: Map<string, TelemetryRecord>,
): boolean {
  if (!action.telemetryKey) {
    if (isFanOrLedAction(action.actionId, action.label)) return isRunning(binding, latest);
    if (action.whenValue === false) return false;
    if (action.whenValue === true) return true;
    return false;
  }
  const row = readLatest(latest, binding.deviceId, [action.telemetryKey]);
  if (!row) return false;
  if (action.whenValue === undefined) return isTruthyState(row.value);
  return String(row.value) === String(action.whenValue);
}
