import type { AlarmAssigneeList, AlarmRecord, Device, DevicePoint, TelemetryRecord } from "./device";

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
  /**
   * 属性键发现（2026-11-23）。
   *
   * <p>与 `listTelemetryKeys` 分开：那个是「能绑什么测点」，这个是
   * 「这台设备/资产身上有哪些属性」。属性只有「上次写入」，不是实时值 ——
   * 混在一起会让人误以为是遥测。
   *
   * <p>可选方法：mock 实现不提供，调用方必须容错。
   */
  listAttributeKeys?(entityType: "DEVICE" | "ASSET", entityId: string): Promise<string[]>;
  /**
   * 确认告警（2026-11-23）—— 「我看到了」。
   *
   * <p>与 `clearAlarm` 分开是刻意的：确认不代表问题解决。
   * 现场真实流程是先认领（避免多人重复处理），修好后再清除。
   * 合成一个「处理」按钮会让「谁在跟进」这件事无从追溯。
   *
   * <p>可选：mock 实现没有真实告警后端，调用方必须容错。
   */
  ackAlarm?(alarmId: string): Promise<void>;
  /**
   * 清除告警（2026-11-23）—— 「问题已解决」。
   *
   * <p>清除后它不再出现在活跃告警里。告警**记录**仍留在平台，
   * 可追溯（不要在本地删，那会让历史对不上）。
   */
  clearAlarm?(alarmId: string): Promise<void>;
  /**
   * 列出可分配的处理人（2026-11-23）。
   *
   * <p>平台可能拒绝（实测 `TENANT_ADMIN` 列租户用户返 403），
   * 此时返回降级候选 + `restricted: true`，**不抛错** ——
   * 「人员列表看不到」不该阻断「确认/清除」这些主功能。
   */
  listAlarmAssignees?(): Promise<AlarmAssigneeList>;
  /**
   * 分配处理人（2026-11-23）。
   *
   * <p>调平台 `POST /api/alarm/{id}/assign/{userId}`。
   */
  assignAlarm?(alarmId: string, assigneeId: string): Promise<void>;
  /**
   * 纯遥测键（2026-11-23）。
   *
   * <p>`listTelemetryKeys` 返回的是「可绑定测点」= 时序 + 属性并集；
   * 数据源面板要把两者分开显示，否则用户会把属性当遥测来绑。
   */
  listTimeseriesKeys?(deviceId: string): Promise<string[]>;
  /**
   * 拉一段历史时序（2026-11-23）。
   *
   * <p>为什么需要：趋势图原来只画「本次打开页面后累积的点」——
   * 刷新一次就从头开始，看不到「过去 24 小时」。
   *
   * <p>`intervalMs` 由调用方给：平台按这个粒度做服务端聚合（AVG），
   * 前端拿到的点数因此可控。不给就按原始点返回（可能很多）。
   *
   * <p>范围聚合（如 9 台之和的历史）由调用方多设备取数后自行合并 ——
   * 平台没有跨设备聚合接口，逐台拉是最直接的做法。
   * 一次加载、不轮询，9 台 9 个请求可以接受（区别于轮询路径的 N+1）。
   */
  getTelemetryHistory?(
    deviceId: string,
    keys: string[],
    options: { fromTs: number; toTs: number; intervalMs?: number; limit?: number },
  ): Promise<Array<{ key: string; timestamp: number; value: number }>>;

  /**
   * 通用 JSON 请求（2026-11-23）。
   *
   * <h2>为什么需要它，而不是再包一层专用方法</h2>
   *
   * <p>大屏现在要读的是**业务统计**（`/api/energy/comprehensive` 的年月日时能耗、
   * 碳排、分项占比），不是遥测点位。这类接口有十几个（峰谷、账单、碳核算…），
   * 每个都往 provider 接口上加一个 `getXxx()`，接口会迅速膨胀成一堵墙，
   * 而它们的共同点只是「带同一个 token 发一个 GET」。
   *
   * <p>所以只暴露一个最小能力：**带当前身份去请求平台**。
   * URI 由调用方给，鉴权、baseURL、错误转换仍然走 provider 内部那一套
   * —— 不重新实现一遍 fetch，否则 token 刷新、401 重登这些逻辑会出现第二份。
   *
   * <p>`?` 可选：mock provider 不需要实现。调用方负责在缺失时降级
   * （见 `useSiteEnergyStats`：没有它就返回空统计而不是抛错）。
   */
  requestJson?<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T>;
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
