
import type {
  AlarmRecord,
  CommandDef,
  Device,
  DeviceCommandProvider,
  DeviceDataProvider,
  DevicePoint,
  TelemetryRecord,
} from "@idt/shared-types";
import { profileByType } from "./profiles";
import { formatPlatformDeviceName } from "./device-display";

export interface MockRuntimeOptions {
  /** 基础周期，实际间隔 = intervalMs / speed */
  intervalMs?: number;
}

type Listener = (row: TelemetryRecord) => void;
type AlarmListener = (alarms: AlarmRecord[]) => void;

interface DeviceRuntime {
  device: Device;
  paused: boolean;
  speed: number;
  offline: boolean;
  alarm: boolean;
  values: Record<string, number | string | boolean>;
}

function now() {
  return Date.now();
}

function jitter(base: number, min: number, max: number): number {
  const delta = (max - min) * 0.08;
  const next = base + (Math.random() * 2 - 1) * delta;
  return Math.min(max, Math.max(min, next));
}

export class MockDataProvider implements DeviceDataProvider, DeviceCommandProvider {
  readonly kind = "mock" as const;
  private runtimes = new Map<string, DeviceRuntime>();
  private listeners = new Set<Listener>();
  private alarmListeners = new Set<AlarmListener>();
  private history = new Map<string, TelemetryRecord[]>();
  private alarms: AlarmRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;
  private globalPaused = false;
  private globalSpeed = 1;
  private commandLog: Array<{ deviceId: string; commandId: string; at: number; params?: Record<string, unknown> }> = [];

  constructor(options: MockRuntimeOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1500;
  }

  seedDevices(devices: Device[]): void {
    for (const device of devices) {
      this.upsertRuntime(device);
    }
    this.ensureTimer();
  }

  upsertRuntime(device: Device): void {
    const existing = this.runtimes.get(device.id);
    const values: Record<string, number | string | boolean> = existing?.values ?? {};
    const profile = profileByType(device.type);
    for (const point of device.points) {
      if (values[point.key] !== undefined) continue;
      values[point.key] = this.initialValue(point, profile);
    }
    this.runtimes.set(device.id, {
      device,
      paused: existing?.paused ?? false,
      speed: existing?.speed ?? 1,
      offline: existing?.offline ?? false,
      alarm: existing?.alarm ?? false,
      values,
    });
  }

  removeDevice(id: string): void {
    this.runtimes.delete(id);
  }

  async getDevices(): Promise<Device[]> {
    return [...this.runtimes.values()].map((r) => r.device);
  }

  async getDevice(id: string): Promise<Device | null> {
    return this.runtimes.get(id)?.device ?? null;
  }

  async getTelemetry(deviceId: string, keys: string[]): Promise<TelemetryRecord[]> {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return [];
    const ts = now();
    return keys
      .filter((k) => rt.values[k] !== undefined)
      .map((key) => this.record(rt, key, ts));
  }

  subscribeTelemetry(deviceIds: string[], callback: Listener): () => void {
    const wrapped: Listener = (row) => {
      if (deviceIds.length === 0 || deviceIds.includes(row.deviceId)) {
        callback(row);
      }
    };
    this.listeners.add(wrapped);
    this.ensureTimer();
    return () => {
      this.listeners.delete(wrapped);
    };
  }

  async getAlarms(): Promise<AlarmRecord[]> {
    return this.alarms.filter((a) => a.active);
  }

  subscribeAlarms(callback: AlarmListener): () => void {
    this.alarmListeners.add(callback);
    callback(this.alarms.filter((a) => a.active));
    return () => {
      this.alarmListeners.delete(callback);
    };
  }

  getHistory(deviceId: string, key: string, limit = 60): TelemetryRecord[] {
    const rows = this.history.get(`${deviceId}:${key}`) ?? [];
    return rows.slice(-limit);
  }

  setPaused(paused: boolean): void {
    this.globalPaused = paused;
  }

  setSpeed(speed: number): void {
    this.globalSpeed = Math.max(0.25, Math.min(8, speed));
    this.restartTimer();
  }

  setDeviceOffline(deviceId: string, offline: boolean): void {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return;
    rt.offline = offline;
    if (offline) this.raiseAlarm(rt, "warning", `${rt.device.name} 已离线（演示）`);
    else this.clearAlarms(deviceId, "离线");
  }

  setDeviceAlarm(deviceId: string, alarm: boolean, message = "模拟告警"): void {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return;
    rt.alarm = alarm;
    if (alarm) this.raiseAlarm(rt, "alarm", `${rt.device.name} ${message}（演示）`);
    else this.clearAlarms(deviceId);
  }

  setPointValue(deviceId: string, key: string, value: number | string | boolean): void {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return;
    rt.values[key] = value;
    const row = this.record(rt, key, now());
    this.pushHistory(row);
    this.emit(row);
  }

  getSpeed(): number {
    return this.globalSpeed;
  }

  isPaused(): boolean {
    return this.globalPaused;
  }

  isOffline(deviceId: string): boolean {
    return this.runtimes.get(deviceId)?.offline ?? false;
  }

  async listTelemetryKeys(deviceId: string): Promise<import("@idt/shared-types").DevicePoint[]> {
    const device = this.runtimes.get(deviceId)?.device ?? (await this.getDevice(deviceId));
    return device?.points ?? [];
  }

  async listCommands(deviceId: string): Promise<CommandDef[]> {
    const rt = this.runtimes.get(deviceId);
    if (!rt) return [];
    const cmds: CommandDef[] = [
      { id: "start", label: "启动（演示指令）", name: "启动（演示指令）", hasRequiredParams: false },
      { id: "stop", label: "停止（演示指令）", name: "停止（演示指令）", hasRequiredParams: false },
    ];
    for (const p of rt.device.points) {
      if (p.displayType === "number") {
        cmds.push({
          id: `set:${p.key}`,
          label: `设置${p.label}（演示）`,
          name: `设置${p.label}（演示）`,
          params: [{ name: "value", type: "number", required: true }],
          hasRequiredParams: true,
        });
      }
    }
    return cmds;
  }

  async sendCommand(
    deviceId: string,
    commandId: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const rt = this.runtimes.get(deviceId);
    if (!rt) throw new Error("设备不存在");
    this.commandLog.push({ deviceId, commandId, at: now(), params });
    if (commandId === "start") {
      const key = rt.device.points.find((p) => p.label.includes("状态") || p.key === "running")?.key;
      if (key) this.setPointValue(deviceId, key, "运行");
    } else if (commandId === "stop") {
      const key = rt.device.points.find((p) => p.label.includes("状态") || p.key === "running")?.key;
      if (key) this.setPointValue(deviceId, key, "停止");
    } else if (commandId.startsWith("set:")) {
      const key = commandId.slice(4);
      const value = params?.value;
      if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
        this.setPointValue(deviceId, key, value);
      }
    }
  }

  getCommandLog() {
    return [...this.commandLog];
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.alarmListeners.clear();
  }

  private initialValue(
    point: DevicePoint,
    profile: ReturnType<typeof profileByType>,
  ): number | string | boolean {
    const tmpl = profile.points.find((p) => p.key === point.key || p.label === point.label);
    if (point.displayType === "text") {
      return tmpl?.textValues?.[0] ?? "运行";
    }
    if (point.displayType === "boolean") return true;
    if (tmpl?.base !== undefined) return tmpl.base;
    return 0;
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.restartTimer();
  }

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    const ms = Math.max(250, this.intervalMs / this.globalSpeed);
    this.timer = setInterval(() => this.tick(), ms);
  }

  private tick(): void {
    if (this.globalPaused) return;
    const ts = now();
    for (const rt of this.runtimes.values()) {
      if (rt.paused || rt.offline) continue;
      const profile = profileByType(rt.device.type);
      for (const point of rt.device.points) {
        const tmpl = profile.points.find((p) => p.key === point.key || p.label === point.label);
        if (point.displayType === "number") {
          const current = Number(rt.values[point.key] ?? tmpl?.base ?? 0);
          const next = jitter(current, tmpl?.min ?? current * 0.8, tmpl?.max ?? (current * 1.2 || 100));
          const rounded = Number(next.toFixed(point.unit === "MPa" || point.key === "pf" ? 2 : 1));
          rt.values[point.key] = rounded;
        } else if (point.displayType === "text" && tmpl?.textValues && Math.random() < 0.02) {
          // 偶尔翻转状态，保持可演示
          const vals = tmpl.textValues;
          const cur = String(rt.values[point.key] ?? vals[0]);
          rt.values[point.key] = vals.find((v) => v !== cur) ?? cur;
        }
        if (rt.alarm && point.label.includes("温度")) {
          rt.values[point.key] = Math.max(Number(rt.values[point.key] ?? 80), 88);
        }
        const row = this.record(rt, point.key, ts);
        this.pushHistory(row);
        this.emit(row);
      }
    }
  }

  private record(rt: DeviceRuntime, key: string, timestamp: number): TelemetryRecord {
    const point = rt.device.points.find((p) => p.key === key);
    return {
      deviceId: rt.device.id,
      key,
      value: rt.offline ? "离线" : (rt.values[key] ?? ""),
      unit: point?.unit,
      timestamp,
      source: "mock",
    };
  }

  private pushHistory(row: TelemetryRecord): void {
    const id = `${row.deviceId}:${row.key}`;
    const list = this.history.get(id) ?? [];
    list.push(row);
    if (list.length > 300) list.splice(0, list.length - 300);
    this.history.set(id, list);
  }

  private emit(row: TelemetryRecord): void {
    for (const listener of this.listeners) listener(row);
  }

  private raiseAlarm(rt: DeviceRuntime, level: "warning" | "alarm", message: string): void {
    const rec: AlarmRecord = {
      id: `alarm_${rt.device.id}_${now()}`,
      deviceId: rt.device.id,
      deviceName: formatPlatformDeviceName(rt.device),
      level,
      message,
      timestamp: now(),
      active: true,
      source: "mock",
    };
    this.alarms.push(rec);
    this.emitAlarms();
  }

  private clearAlarms(deviceId: string, includes?: string): void {
    for (const a of this.alarms) {
      if (a.deviceId === deviceId && a.active && (!includes || a.message.includes(includes))) {
        a.active = false;
      }
    }
    this.emitAlarms();
  }

  private emitAlarms(): void {
    const active = this.alarms.filter((a) => a.active);
    for (const listener of this.alarmListeners) listener(active);
  }
}

/** 模块只暴露接口，业务侧不要直接依赖这个类的内部方法。 */
export function createMockDataProvider(options?: MockRuntimeOptions): DeviceDataProvider & DeviceCommandProvider {
  return new MockDataProvider(options);
}
