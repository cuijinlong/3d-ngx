export type TelemetryDisplayType = "number" | "boolean" | "text";

export type DeviceStatus = "normal" | "warning" | "alarm" | "offline";

export interface DevicePoint {
  key: string;
  label: string;
  unit?: string;
  displayType: TelemetryDisplayType;
}

export interface Device {
  id: string;
  name: string;
  /** 平台设备标签。给用户看时优先用它，不要折进 name 里丢掉技术名称。 */
  label?: string;
  type: string;
  points: DevicePoint[];
  /** 第一阶段全部为演示数据，不可标成现场采集 */
  source: "mock" | "guard";
  /**
   * 平台 additionalInfo.deviceVirtual。
   * "real" 或缺失 = 实时设备；"virtual" = 虚拟设备（仅手动上报）。
   */
  deviceVirtual?: string | boolean | number;
  createdAt: string;
  updatedAt: string;
}

export interface TelemetryMapping {
  field: string;
  telemetryKey: string;
  label: string;
  unit?: string;
  displayType: TelemetryDisplayType;
}

export interface StatusRule {
  operator: "eq" | "gt" | "gte" | "lt" | "lte";
  value: number | string | boolean;
  state: DeviceStatus;
}

export interface StatusMapping {
  telemetryKey: string;
  rules: StatusRule[];
}

export interface ActionMapping {
  /** 来自 GLB 的动作 id，例如 spin:fan */
  actionId: string;
  label: string;
  clip?: string;
  /** 用哪个遥测键驱动该动作（例如运行状态） */
  telemetryKey?: string;
  /** 为真时播放动作；文本测点可填“运行” */
  whenValue?: string | number | boolean;
  /** 绑定到后端/网关指令 id，第一阶段走 Mock 指令 */
  commandId?: string;
  /** 下发指令时附带的参数，例如网关 start/stop 的 target */
  commandParams?: Record<string, unknown>;
}

export interface DeviceBinding {
  id: string;
  sceneEntityId: string;
  deviceId: string;
  deviceName: string;
  telemetryMappings: TelemetryMapping[];
  actionMappings: ActionMapping[];
  statusMapping?: StatusMapping;
}

export interface TelemetryRecord {
  deviceId: string;
  key: string;
  value: number | string | boolean;
  unit?: string;
  timestamp: number;
  /** 固定为演示数据来源标记 */
  source: "mock" | "guard";
}

export interface AlarmRecord {
  id: string;
  deviceId: string;
  deviceName: string;
  level: "warning" | "alarm";
  message: string;
  timestamp: number;
  active: boolean;
  source: "mock" | "guard";
}
