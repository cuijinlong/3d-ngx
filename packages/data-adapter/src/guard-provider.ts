import type {
  CommandDef,
  Device,
  DeviceCommandProvider,
  DeviceDataProvider,
  DevicePoint,
  TelemetryDisplayType,
  TelemetryRecord,
} from "@idt/shared-types";
import { GuardClient, GuardHttpError, type GuardAuthState } from "./guard-client";
import { parseCommands, RealtimeDeviceError, toCommandError } from "./commands";
import { isVirtualAdditionalInfo } from "./device-virtual";
import { toGuardDevice } from "./guard-device";

interface TbId {
  id?: string;
  entityType?: string;
}

interface TbDevice {
  id?: TbId | string;
  name?: string;
  type?: string;
  label?: string;
  createdTime?: number;
  additionalInfo?: Record<string, unknown> | string | null;
}

interface TbPage<T> {
  data?: T[];
  totalElements?: number;
  totalPages?: number;
  hasNext?: boolean;
}

function inferDisplay(key: string): TelemetryDisplayType {
  const k = key.toLowerCase();
  if (/(running|status|state|door|led|switch|open|enabled|active)/.test(k)) return "boolean";
  if (/(name|mode|text|msg|message)/.test(k)) return "text";
  return "number";
}

function pointOf(key: string): DevicePoint {
  return { key, label: key, displayType: inferDisplay(key) };
}

const ATTR_SKIP = new Set([
  "active",
  "area",
  "demo",
  "inactivityAlarmTime",
  "rpcMethods",
  "source",
  "type1",
  "type2",
  "measurePoints",
  "deviceVirtual",
  "deviceType1",
  "deviceType",
  "energyTypeCode",
  "isMeter",
]);

function parseMeasurePoints(raw: unknown): DevicePoint[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: DevicePoint[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { standardField?: string; deviceField?: string; label?: string };
    const key = String(rec.standardField || rec.deviceField || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: rec.label || rec.deviceField || key,
      displayType: inferDisplay(key),
    });
  }
  return out;
}

export class GuardServerProvider implements DeviceDataProvider, DeviceCommandProvider {
  constructor(private readonly client: GuardClient) {}

  getAuthState(): GuardAuthState {
    return this.client.getState();
  }

  async getDevices(): Promise<Device[]> {
    const rows = await this.listRawDevices();
    // 3D 绑定只列出实时设备；虚拟设备只用于平台手动上报。
    return rows.filter((row) => !isVirtualAdditionalInfo(row.additionalInfo)).map((row) => toGuardDevice(row));
  }

  async getDevice(id: string): Promise<Device | null> {
    const row = await this.fetchRawDevice(id);
    if (!row) return null;
    const points = await this.listTelemetryKeys(id);
    return toGuardDevice(row, points);
  }

  async listTelemetryKeys(deviceId: string): Promise<DevicePoint[]> {
    const points = new Map<string, DevicePoint>();
    try {
      const keys = await this.client.requestJson<string[]>(
        "GET",
        `/api/plugins/telemetry/DEVICE/${deviceId}/keys/timeseries`,
      );
      for (const key of keys ?? []) points.set(key, pointOf(key));
    } catch {
      /* 时序键读不到时，仍尝试属性和标准测点 */
    }
    try {
      const attrs = await this.readAttributes(deviceId);
      for (const attr of attrs) {
        if (attr.key === "measurePoints") {
          for (const point of parseMeasurePoints(attr.value)) {
            if (!points.has(point.key)) points.set(point.key, point);
          }
          continue;
        }
        if (ATTR_SKIP.has(attr.key)) continue;
        if (!points.has(attr.key)) points.set(attr.key, pointOf(attr.key));
      }
    } catch {
      /* 保留已读到的时序键 */
    }
    return [...points.values()];
  }

  async getTelemetry(deviceId: string, keys: string[]): Promise<TelemetryRecord[]> {
    if (keys.length === 0) return [];
    const query = new URLSearchParams({
      keys: keys.join(","),
      useStrictDataTypes: "true",
    });
    const data = await this.client.requestJson<Record<string, Array<{ ts?: number; value?: unknown }>>>(
      "GET",
      `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?${query.toString()}`,
    );
    const records: TelemetryRecord[] = [];
    for (const key of Object.keys(data ?? {})) {
      const last = (data[key] ?? [])[0];
      if (!last) continue;
      const value = last.value;
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") continue;
      records.push({
        deviceId,
        key,
        value,
        timestamp: last.ts ?? Date.now(),
        source: "guard",
      });
    }
    const have = new Set(records.map((row) => row.key));
    const missing = keys.filter((key) => !have.has(key));
    if (missing.length) {
      try {
        const attrs = await this.readAttributes(deviceId);
        const want = new Set(missing);
        for (const attr of attrs) {
          if (!want.has(attr.key)) continue;
          const value = attr.value;
          if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") continue;
          records.push({
            deviceId,
            key: attr.key,
            value,
            timestamp: Date.now(),
            source: "guard",
          });
        }
      } catch {
        /* 属性补读失败时只返回已有时序 */
      }
    }
    return records;
  }

  subscribeTelemetry(
    deviceIds: string[],
    callback: (data: TelemetryRecord) => void,
  ): () => void {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      for (const id of deviceIds) {
        try {
          const device = await this.fetchRawDevice(id);
          if (!device || isVirtualAdditionalInfo(device.additionalInfo)) continue;
          const keys = (await this.listTelemetryKeys(id)).map((p) => p.key);
          const rows = await this.getTelemetry(id, keys);
          if (stopped) return;
          for (const row of rows) callback(row);
        } catch {
          /* 轮询失败时保持上一帧，下一轮再试 */
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async listCommands(deviceId: string): Promise<CommandDef[]> {
    const scopes = ["SERVER_SCOPE", "SHARED_SCOPE", "CLIENT_SCOPE"] as const;
    for (const scope of scopes) {
      try {
        const rows = await this.client.requestJson<Array<{ key?: string; value?: unknown }>>(
          "GET",
          `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}?keys=rpcMethods`,
        );
        const hit = (rows ?? []).find((r) => r.key === "rpcMethods");
        const cmds = parseCommands(hit?.value);
        if (cmds.length) return cmds;
      } catch {
        /* 尝试下一个范围 */
      }
    }
    return [];
  }

  async sendCommand(
    deviceId: string,
    commandId: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const device = await this.fetchRawDevice(deviceId);
    if (!device) throw new RealtimeDeviceError("missing");
    if (isVirtualAdditionalInfo(device.additionalInfo)) {
      throw new RealtimeDeviceError("virtual");
    }
    try {
      await this.client.requestJson("POST", `/api/rpc/oneway/${deviceId}`, {
        method: commandId,
        params: params ?? {},
      });
    } catch (error) {
      throw toCommandError(error);
    }
  }

  private async fetchRawDevice(deviceId: string): Promise<TbDevice | null> {
    try {
      return await this.client.requestJson<TbDevice>("GET", `/api/device/${deviceId}`);
    } catch (error) {
      if (error instanceof GuardHttpError && error.status === 404) return null;
      throw error;
    }
  }

  private async readAttributes(deviceId: string): Promise<Array<{ key: string; value: unknown }>> {
    const scopes = ["SERVER_SCOPE", "SHARED_SCOPE", "CLIENT_SCOPE"] as const;
    const rows: Array<{ key: string; value: unknown }> = [];
    const seen = new Set<string>();
    for (const scope of scopes) {
      try {
        const data = await this.client.requestJson<Array<{ key?: string; value?: unknown }>>(
          "GET",
          `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}`,
        );
        for (const row of data ?? []) {
          if (!row.key || seen.has(row.key)) continue;
          seen.add(row.key);
          rows.push({ key: row.key, value: row.value });
        }
      } catch {
        /* 尝试下一个范围 */
      }
    }
    return rows;
  }

  private async listRawDevices(): Promise<TbDevice[]> {
    const state = this.client.getState();
    const pageSize = 100;
    const rows: TbDevice[] = [];
    for (let page = 0; page < 20; page += 1) {
      const path =
        state.authority === "CUSTOMER_USER" && state.customerId
          ? `/api/customer/${state.customerId}/devices?pageSize=${pageSize}&page=${page}`
          : `/api/tenant/devices?pageSize=${pageSize}&page=${page}`;
      const data = await this.client.requestJson<TbPage<TbDevice>>("GET", path);
      rows.push(...(data.data ?? []));
      if (!data.hasNext && (data.data?.length ?? 0) < pageSize) break;
      if ((data.data?.length ?? 0) === 0) break;
    }
    return rows;
  }
}

export async function createGuardProvider(state: GuardAuthState): Promise<{
  provider: GuardServerProvider;
  client: GuardClient;
}> {
  const client = new GuardClient(state);

  const hydrateUser = async () => {
    const user = await client.requestJson<{
      authority?: string;
      customerId?: { id?: string } | string;
      email?: string;
    }>("GET", "/api/auth/user");
    client.applyAuthUser(user);
  };

  if (state.token) {
    try {
      await hydrateUser();
      return { provider: new GuardServerProvider(client), client };
    } catch {
      /* 访问令牌失效则尝试刷新 */
    }
  }

  if (state.refreshToken || client.getState().refreshToken) {
    try {
      await client.refreshSession();
      await hydrateUser();
      return { provider: new GuardServerProvider(client), client };
    } catch {
      /* 刷新失败后，仅在这次调用显式提供了密码时才重新登录 */
    }
  }

  if (state.username && state.password) {
    await client.login(state.username, state.password);
    return { provider: new GuardServerProvider(client), client };
  }

  throw new Error("登录已过期，请重新连接后端");
}
