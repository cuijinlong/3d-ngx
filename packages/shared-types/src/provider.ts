import type { AlarmRecord, Device, DevicePoint, TelemetryRecord } from "./device";

export interface DeviceDataProvider {
  getDevices(): Promise<Device[]>;
  getDevice(id: string): Promise<Device | null>;
  getTelemetry(deviceId: string, keys: string[]): Promise<TelemetryRecord[]>;
  subscribeTelemetry(
    deviceIds: string[],
    callback: (data: TelemetryRecord) => void,
  ): () => void;
  getAlarms?(): Promise<AlarmRecord[]>;
  subscribeAlarms?(callback: (alarms: AlarmRecord[]) => void): () => void;
  /** 动态读取设备当前可绑定的遥测键，禁止前端写死键名表。 */
  listTelemetryKeys(deviceId: string): Promise<DevicePoint[]>;
}

export type CommandParamType = "number" | "boolean" | "text";

export interface CommandParamDef {
  name: string;
  type: CommandParamType;
  /**
   * 缺省视为必填。只有显式 required: false 才是可选。
   * 铭牌启停匹配前应先丢掉带必填参数的命令。
   */
  required?: boolean;
}

export interface CommandDef {
  id: string;
  /** 展示用标签（下拉和摘要优先用这个）。 */
  label: string;
  /** 与 label 相同或来自源数据的 name；按「名称或标签」匹配时可一起看。解析时会补上。 */
  name?: string;
  params?: CommandParamDef[];
  /** 是否含必填参数。适配器解析时会补上；也可调用 commandHasRequiredParams。 */
  hasRequiredParams?: boolean;
}

export interface DeviceCommandProvider {
  listCommands(deviceId: string): Promise<CommandDef[]>;
  sendCommand(
    deviceId: string,
    commandId: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
}

export type DataProviderKind = "mock" | "guard";

export interface GuardConnectionSettings {
  /** 浏览器请求前缀，开发环境用 /api 走 Vite 代理 */
  apiBase: string;
  username: string;
  password?: string;
  token?: string;
  refreshToken?: string;
}

export interface GuardConnectionStatus {
  connected: boolean;
  kind: DataProviderKind;
  apiBase?: string;
  username?: string;
  authority?: string;
  deviceCount?: number;
  message?: string;
}
