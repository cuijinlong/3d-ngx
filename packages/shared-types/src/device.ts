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

/**
 * 绑定模型 v2（docs/twin-binding-contract.md §3）。
 *
 * 背景：v1 的 DeviceBinding 只能绑 DEVICE（`deviceId` 必填 + `telemetryMappings`）。
 * 数字孪生需要「场景对象 → 资产属性」这条路径（一个对象代表整个系统 / 机房，
 * 不是某一台设备），所以新增 `target` 与 `points`。
 *
 * 两条兼容约定：
 * 1. v1 字段（deviceId / telemetryMappings / actionMappings）保留，不迁移、不重写。
 *    半迁移的文档最难收拾：一半设备绑定一半资产绑定，回滚都无从下手。
 * 2. `deviceId` 从必填变可选，是因为后端 validateBindings 只校验「带 deviceId 的条目」
 *    —— 资产条目必须不带该字段才能通过。属性为空字符串也不行：后端会把它当 UUID 解析。
 */
export type AttributeScope = "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";

export interface BindingTarget {
  entityType: "DEVICE" | "ASSET";
  entityId: string;
  name: string;
}

/**
 * 一个绑定点。`source` 语义互斥，不允许运行时自动 fallback：
 * - telemetry：DEVICE 的时序键，有 ts，有新鲜度概念
 * - attribute：ASSET 的属性值，有 lastUpdatedTs，没有「实时」概念
 * - derived：由同一场景内其它 slot 计算（P0 未实现，见到即视为未绑定）
 */
export interface BindingPoint {
  /** "<regionId>.<interfaceKey>"，如 "equipment-status.onlineRate" */
  slot: string;
  source: "telemetry" | "attribute" | "derived";
  /** 遥测键或属性键。技术键，禁止翻译。 */
  key: string;
  /** 仅 attribute 使用 */
  scope?: AttributeScope;
  unit?: string;
  displayType: TelemetryDisplayType;
  /** telemetry 按 ts 判断；attribute 按 lastUpdatedTs 判断 */
  staleAfterSec?: number;
  /** 缺失时展示的文案，默认 "—"。不要填 0 或演示值。 */
  fallback?: string;
}

export interface DeviceBinding {
  id: string;
  sceneEntityId: string;
  /** v1 字段。资产绑定条目没有该字段（不能填空串，后端会当 UUID 解析）。 */
  deviceId?: string;
  deviceName: string;
  telemetryMappings: TelemetryMapping[];
  actionMappings: ActionMapping[];
  statusMapping?: StatusMapping;
  /** v2：DEVICE 或 ASSET。缺省时由 deviceId 推导为 DEVICE。 */
  target?: BindingTarget;
  /** v2：结构化绑定点。缺省时由 telemetryMappings 推导。 */
  points?: BindingPoint[];
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

/**
 * 告警可分配的处理人（2026-11-23）。
 *
 * <p>大屏告警详情弹层要能「分配处理人」—— 调平台
 * `POST /api/alarm/{id}/assign/{userId}`。那个接口需要用户 UUID，
 * 所以必须先把「人」列出来。
 */
export interface AlarmAssignee {
  id: string;
  /** 显示名：优先姓名，否则邮箱。 */
  name: string;
  email?: string;
  authority?: string;
  /**
   * 所属客户（2026-11-24 加）。
   *
   * <h3>为什么需要它</h3>
   *
   * <p>处理人下拉里同时有租户管理员与各客户的值班人员。只有邮箱时
   * 两个 `demo@` 开头的账号肉眼分不出是哪个客户的 —— 而派错人
   * 在本系统里是「显示已派单、实际没人收到」。
   *
   * <p>`null` = 租户级用户（不属于任何客户）。
   */
  customerId?: string | null;
  /** 客户名称，用在「姓名（客户）」那一行。 */
  customerTitle?: string;
}

/**
 * 处理人列表的返回。
 *
 * <h3>为什么不是直接返回数组</h3>
 *
 * <p>候选人列表可能拿不全 —— 若只返回数组，前端无法区分
 * 「租户真的只有 1 个人」与「平台不让我看」。
 *
 * <p>所以带上 `restricted` 与 `note`，让界面如实说明原因，
 * 而不是静默地只给一个选项。
 *
 * <h3>★ 2026-11-24：改用 `/api/userInfos/all?includeCustomers=true`</h3>
 *
 * <p>原实现走 `/api/tenant/{id}/users`，实测 **403**（该部署的 RBAC 只允许
 * 系统管理员走那条）。于是一直降级为「只能分配给自己」。
 *
 * <p>实测发现 `/api/userInfos/all?includeCustomers=true` 对 TENANT_ADMIN
 * 可用（200），且**同时返回租户管理员与各客户用户** —— 正是处理人需要的范围。
 * 旧路径保留作兜底，但不再是主力。
 */
export interface AlarmAssigneeList {
  users: AlarmAssignee[];
  /** true = 所有列表请求都被拒，这里只有降级候选（自己）。 */
  restricted: boolean;
  /** 降级原因，给界面直接展示。 */
  note?: string;
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
  /**
   * 是否已确认（2026-11-23）。
   *
   * <p>大屏要区分「待确认」和「已确认」—— 两者的处置动作不同：
   * 未确认的先确认（表示人看到了），确认后才谈清除（表示问题解决了）。
   * 不区分的话，按钮状态无从判断，用户会重复确认同一条。
   */
  acknowledged?: boolean;
}
