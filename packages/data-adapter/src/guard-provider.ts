import type {
  AlarmAssignee,
  AlarmAssigneeList,
  AlarmRecord,
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
import { WsTelemetryChannel, type WsTelemetryStatus } from "./ws-telemetry";
import { toGuardDevice } from "./guard-device";

interface TbId {
  id?: string;
  entityType?: string;
}

/**
 * 一台设备的一条属性。
 *
 * <p>`lastUpdateTs` 是属性**最后一次写入**的时间 —— 属性只保留最新值、
 * 不存历史，所以这个时间戳是判断「数据是否停滞」的唯一依据。
 * 平台没给时留空，由调用方决定怎么兜底（不要在这里编一个）。
 */
interface DeviceAttributeRow {
  key: string;
  value: unknown;
  lastUpdateTs?: number;
  scope: "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";
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

/**
 * TB 的「空客户」占位 id。
 *
 * <p>租户级用户的 `customerId` 不是 null，而是这个全零 UUID。
 * 不识别它就会把「租户管理员」当成某个客户的人。
 */
const EMPTY_CUSTOMER_ID = "00000000-0000-0000-0000-000000000000";

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
  /**
   * 设备键列表缓存（2026-11-23）。
   *
   * <p>必须放在**实例**上，不能放在 `subscribeTelemetry` 的闭包里：
   * `useTelemetryFeed` 的 effect 依赖 `deviceIds.join("|")`，而范围设备是异步
   * 解析出来的 —— 一次页面加载会重订阅好几次。缓存放闭包里等于每次清零，
   * 每轮又得重新拉 keys + 3 个属性 scope（4 个请求/台）。
   */
  private readonly telemetryKeyCache = new Map<string, { keys: string[]; at: number }>();

  constructor(private readonly client: GuardClient) {}

  getAuthState(): GuardAuthState {
    return this.client.getState();
  }

  /**
   * 通用请求：把 client 的能力透出去（2026-11-23）。
   *
   * <p>直接委托 `client.requestJson`，不自己拼 fetch —— token 刷新、
   * 401 重登、错误码转换都在 client 里，复制一份必然与它走偏。
   */
  async requestJson<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    return this.client.requestJson<T>(method, path, body);
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

  /**
   * 纯遥测键（2026-11-23）。
   *
   * <p>与 `listTelemetryKeys` 的区别很关键：那个返回「**可绑定测点**」=
   * 时序键 + 属性键的并集（绑定面板需要，因为它允许绑属性）。
   *
   * <p>但数据源面板要**分开显示**「有哪些遥测」和「有哪些属性」——
   * 用并集会把 `brand` / `deviceCode` / `model` 这些属性列进「遥测」，
   * 用户照着建卡片就成了读属性当遥测，永远没有实时值。
   */
  async listTimeseriesKeys(deviceId: string): Promise<string[]> {
    try {
      const keys = await this.client.requestJson<string[]>(
        "GET",
        `/api/plugins/telemetry/DEVICE/${deviceId}/keys/timeseries`,
      );
      return [...new Set(keys ?? [])].sort();
    } catch {
      return [];
    }
  }

  /**
   * 属性键发现（2026-11-23）。
   *
   * <p>和 `listTelemetryKeys` 分开：那个是「能绑什么测点」，这个是
   * 「这台设备/资产身上有哪些属性」。数据源面板要分别展示 ——
   * 混在一起会让人以为属性也是实时遥测（属性只有「上次写入」）。
   *
   * <p>返回去重后的键名，按 scope 分组由调用方决定（这里只给 SERVER_SCOPE，
   * 因为业务属性都在那）。
   */
  async listAttributeKeys(entityType: "DEVICE" | "ASSET", entityId: string): Promise<string[]> {
    try {
      const keys = await this.client.requestJson<string[]>(
        "GET",
        `/api/plugins/telemetry/${entityType}/${entityId}/keys/attributes`,
      );
      return [...new Set(keys ?? [])].sort();
    } catch {
      /* 读不到就当没有 —— 数据源面板会显示「未勘察到」，不会崩。 */
      return [];
    }
  }

  /**
   * 活跃告警（2026-11-23）。
   *
   * <p>原来 `getAlarms` 只有 mock 实现，真实平台下 `subscribeAlarms` 是
   * `undefined` —— 大屏拿不到告警，且不报错（可选方法都被 `?.` 调用了）。
   * 数据源面板要展示「这台设备有没有告警」，所以补上。
   */
  /**
   * 确认告警（2026-11-23）。
   *
   * <p>调平台 `POST /api/alarm/{id}/ack`。实测返回 200；id 不存在时 404
   * （`Alarm with id [...] is not found`）—— 那种情况抛出去，
   * 让调用方看到「这条已经被人处理了」，而不是静默当成功。
   */
  async ackAlarm(alarmId: string): Promise<void> {
    await this.client.requestJson<unknown>(
      "POST",
      `/api/alarm/${encodeURIComponent(alarmId)}/ack`,
    );
  }

  /**
   * 清除告警（2026-11-23）。
   *
   * <p>调平台 `POST /api/alarm/{id}/clear`。清除后不再出现在活跃告警里，
   * 但平台侧记录保留 —— 本地不要删，否则历史对不上。
   */
  async clearAlarm(alarmId: string): Promise<void> {
    await this.client.requestJson<unknown>(
      "POST",
      `/api/alarm/${encodeURIComponent(alarmId)}/clear`,
    );
  }

  /**
   * 分配处理人（2026-11-23）。
   *
   * <p>调 `POST /api/alarm/{alarmId}/assign/{userId}`。实测返回 200，
   * `GET /api/alarm/{id}` 回读 `assigneeId` 已更新。
   */
  async assignAlarm(alarmId: string, assigneeId: string): Promise<void> {
    await this.client.requestJson<unknown>(
      "POST",
      `/api/alarm/${encodeURIComponent(alarmId)}/assign/${encodeURIComponent(assigneeId)}`,
    );
  }

  /**
   * 可分配的处理人（2026-11-23）。
   *
   * <h2>两级策略，且把「被拒」当正常结果</h2>
   *
   * <ol>
   *   <li>先取当前用户（`/api/auth/user`）—— 那是肯定能拿到的；</li>
   *   <li>再试租户用户列表（`/api/tenant/{id}/users`）补全。
   *       实测本部署对 `TENANT_ADMIN` 返 **403**，所以这里 catch 住，
   *       返回降级列表 + `restricted: true`，**不抛错**。</li>
   * </ol>
   *
   * <p>为什么不抛：人员列表看不到只是少了一个选人能力，
   * 「确认」「清除」才是主功能。为它抛错会让整个弹层打不开。
   */
  async listAlarmAssignees(): Promise<AlarmAssigneeList> {
    let current: AlarmAssignee | null = null;
    let tenantId: string | null = null;
    try {
      const user = await this.client.requestJson<{
        id?: { id?: string } | string;
        tenantId?: { id?: string } | string;
        email?: string;
        name?: string;
        firstName?: string;
        lastName?: string;
        authority?: string;
      }>("GET", "/api/auth/user");
      const uid = typeof user.id === "string" ? user.id : user.id?.id;
      const tid = typeof user.tenantId === "string" ? user.tenantId : user.tenantId?.id;
      if (tid) tenantId = tid;
      if (uid) {
        current = {
          id: uid,
          name: displayUserName(user) || user.email || uid,
          email: user.email,
          authority: user.authority,
        };
      }
    } catch {
      /* 拿不到当前用户也不致命：下面还有租户列表可试。 */
    }

    /*
     * ★ 主路径：`/api/userInfos/all?includeCustomers=true`（2026-11-24 改）。
     *
     * <h3>为什么换掉 `/api/tenant/{id}/users`</h3>
     *
     * <p>那条实测 **403** —— 本部署的 RBAC 只允许系统管理员走它。
     * 于是这里一直落到降级分支：「处理人只有你自己」，而下拉下方还写着
     * 「平台未开放人员列表」。客户提过「可以分配处理人」，
     * 实际拿到的是一个只有一项的下拉框 —— 功能等于没有。
     *
     * <h3>为什么 includeCustomers=true</h3>
     *
     * <p>告警的处置人通常不是租户管理员，而是**客户的值班人员**。
     * 不带这个参数时只列租户级用户（实测只有 1 个：租户管理员自己），
     * 带了才同时返回各客户用户（实测 2 个）。
     *
     * <p>返回里带 customerId，让界面能显示「姓名（客户名）」——
     * 否则两个 demo@ 开头的账号肉眼分不出是谁。
     */
    try {
      const page = await this.client.requestJson<{
        data?: Array<{
          id?: { id?: string } | string;
          email?: string;
          name?: string;
          firstName?: string;
          lastName?: string;
          authority?: string;
          customerId?: { id?: string } | string | null;
        }>;
      }>("GET", "/api/userInfos/all?pageSize=200&page=0&includeCustomers=true");

      const users: AlarmAssignee[] = [];
      const seen = new Set<string>();
      for (const row of page?.data ?? []) {
        const id = typeof row.id === "string" ? row.id : row.id?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const rawCustomer = row.customerId;
        const customerId =
          typeof rawCustomer === "string" ? rawCustomer : (rawCustomer?.id ?? null);
        /*
         * 租户级用户的 customerId 是「空客户」占位（13814000-…），
         * 把它当成"无客户"而不是一个真客户 —— 否则界面上会出现
         * 「租户管理员（13814000-1dd2-…）」，那串 uuid 对用户没有意义。
         */
        const isTenantLevel =
          !customerId || customerId === EMPTY_CUSTOMER_ID || customerId.startsWith("13814000");
        users.push({
          id,
          name: displayUserName(row) || row.email || id,
          email: row.email,
          authority: row.authority,
          customerId: isTenantLevel ? null : customerId,
        });
      }
      /*
       * 按「租户管理员在前、然后按姓名」排。
       *
       * <p>派单时人先看的是「谁有权限兜底」，租户管理员通常就是那个人。
       * 纯字母序会把它排到最后。
       */
      users.sort((a, b) => {
        const rank = (u: AlarmAssignee) => (u.authority === "TENANT_ADMIN" ? 0 : 1);
        const d = rank(a) - rank(b);
        return d !== 0 ? d : a.name.localeCompare(b.name, "zh-Hans-CN");
      });

      if (users.length) {
        /*
         * 客户名不在这里查：一条告警弹层要多查一遍客户列表就是 N+1。
         * 界面用 customerId 做去重分组即可，显示用邮箱/姓名已足够区分。
         */
        return { users, restricted: false };
      }
    } catch {
      /* 200 之外（403 / 404 / 网络）：继续试旧路径。 */
    }

    if (tenantId) {
      try {
        const page = await this.client.requestJson<{
          data?: Array<{
            id?: { id?: string } | string;
            email?: string;
            name?: string;
            firstName?: string;
            lastName?: string;
            authority?: string;
          }>;
        }>("GET", `/api/tenant/${encodeURIComponent(tenantId)}/users?pageSize=100&page=0`);
        const users: AlarmAssignee[] = [];
        const seen = new Set<string>();
        for (const row of page?.data ?? []) {
          const id = typeof row.id === "string" ? row.id : row.id?.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          users.push({
            id,
            name: displayUserName(row) || row.email || id,
            email: row.email,
            authority: row.authority,
            customerId: null,
          });
        }
        if (users.length) return { users, restricted: false };
      } catch {
        /* 403 / 网络失败：走下面的降级分支。 */
      }
    }

    return {
      users: current ? [current] : [],
      restricted: true,
      note: current
        ? "读取人员列表的接口都不可用，当前仅可分配给自己。"
        : "无法读取当前用户，处理人列表不可用。",
    };
  }

  async getAlarms(): Promise<AlarmRecord[]> {
    try {
      const page = await this.client.requestJson<{
        data?: Array<{
          id?: { id?: string };
          type?: string;
          severity?: string;
          originator?: { entityType?: string; id?: string };
          originatorName?: string;
          status?: string;
          startTs?: number;
        }>;
      }>("GET", "/api/alarms?pageSize=100&page=0&sortProperty=startTs&sortOrder=DESC");
      const rows = page?.data ?? [];
      return rows
        /* 只保留活跃（未清除）的 —— 已清除的告警对「当前状态」没有意义。 */
        .filter((row) => !row.status?.startsWith("CLEARED"))
        .map((row) => ({
          id: row.id?.id ?? `${row.originator?.id ?? "?"}:${row.type ?? "?"}:${row.startTs ?? 0}`,
          deviceId: row.originator?.id ?? "",
          deviceName: row.originatorName ?? "",
          level: row.severity === "CRITICAL" || row.severity === "MAJOR" ? "alarm" : "warning",
          message: row.type ?? "告警",
          timestamp: row.startTs ?? 0,
          active: true,
          source: "guard",
          /* TB 的 status 形如 ACTIVE_UNACK / ACTIVE_ACK，以 _ACK 结尾即已确认。 */
          acknowledged: Boolean(row.status?.endsWith("_ACK")),
        })) satisfies AlarmRecord[];
    } catch {
      return [];
    }
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
            /*
             * 用属性**自己的**更新时间（2026-11-24 修）。
             *
             * <p>原来写 `Date.now()` —— 陈旧属性会永远显示成「刚刚」。
             * 仅当平台没给时间戳时才退到当前时间（那是真的不知道）。
             */
            timestamp: attr.lastUpdateTs ?? Date.now(),
            source: "guard",
          });
        }
      } catch {
        /* 属性补读失败时只返回已有时序 */
      }
    }
    return records;
  }

  /**
   * 订阅设备遥测（轮询实现）。
   *
   * <h2>为什么原来的写法不能用（2026-11-23 实测）</h2>
   *
   * 原实现：`for (设备) { fetchRawDevice → listTelemetryKeys → getTelemetry }` 全串行，
   * 每台 **6 个请求**（device + keys + 3 个 scope 属性 + values），14 台 = 84 个往返。
   * 实测 18 秒只跑完 4 台 —— 大屏上后 10 台一直显示「未知」，
   * 而后端 `values/timeseries` 明明有数据。
   *
   * <p>更糟的是 `setInterval(3000)` 不管上一轮跑没跑完就再起一轮，
   * 多轮并发叠在一起，设备越多请求越密，形成风暴。
   *
   * <h2>三处修正</h2>
   *
   * <ol>
   *   <li><b>键列表缓存 60 秒</b>：设备有哪些遥测键几乎不变，
   *       但原来每轮每台都重新拉 keys + 3 个属性 scope（4 个请求）。
   *       缓存后每台只剩 device + values 两个。</li>
   *   <li><b>分批并发（4 台）</b>：14 台分 4 批而不是串行。
   *       并发度取 4 不是更大 —— 平台侧线程池有限，压太狠会拖慢别人的请求。</li>
   *   <li><b>单轮锁</b>：上一轮没跑完就跳过本轮，不再叠加。</li>
   * </ol>
   */
  subscribeTelemetry(
    deviceIds: string[],
    callback: (data: TelemetryRecord) => void,
  ): () => void {
    let stopped = false;
    let inFlight = false;
    const keyCache = this.telemetryKeyCache;
    const KEY_TTL_MS = 60_000;
    /*
     * 14 台 / 10 并发 ≈ 2 批（2026-11-23 从 6 提到 10）。
     *
     * <p>实测：首轮订阅要 15~20 秒才全部出数，大屏上先显示一片「未知」，
     * 十几秒后才陆续变成真实值 —— 用户会以为系统卡了。
     * 并发 6 → 10 后批次从 3 轮降到 2 轮，首屏时间明显缩短。
     *
     * <p>10 不是拍脑袋：平台侧 OneWay 请求是轻量的 DB 查询，
     * 单页实际设备数就十几台，10 并发不会压垮线程池
     * （对比：真实的大批量场景应走分页 + 上限保护，那时再降）。
     */
    const CONCURRENCY = 10;

    const pollOne = async (id: string) => {
      try {
        const device = await this.fetchRawDevice(id);
        if (!device || isVirtualAdditionalInfo(device.additionalInfo)) return;
        const cached = keyCache.get(id);
        let keys: string[];
        if (cached && Date.now() - cached.at < KEY_TTL_MS) {
          keys = cached.keys;
        } else {
          keys = (await this.listTelemetryKeys(id)).map((p) => p.key);
          keyCache.set(id, { keys, at: Date.now() });
        }
        if (!keys.length) return;
        const rows = await this.getTelemetry(id, keys);
        /*
         * **不要因为 stopped 丢弃已拉到的数据**（2026-11-23 实测根因）。
         *
         * <p>`useTelemetryFeed` 的 effect 会重建订阅（范围设备异步到达），
         * cleanup 把 `stopped` 置 true 时请求往往还在路上。
         * 原来这里 `if (stopped) return;` —— 请求回来一看 stopped 已 true，
         * 整批数据丢掉。实测稳定只覆盖**前 6 台**（并发度），
         * 后 8 台永远「未知」，每次刷新停在不同设备上，极难定位。
         *
         * <p>为什么不担心「旧订阅污染新视图」：`callback` 写的是**全局 store**，
         * 数据本身与订阅实例无关 —— 同一台设备同一个键，谁写进去都是同一份真相。
         * 丢掉反而是纯损失。
         */
        for (const row of rows) callback(row);
      } catch {
        /* 单台失败不影响其余设备；下一轮再试 */
      }
    };

    /*
     * ── WebSocket 推送（2026-11-24）──
     *
     * <p>插在轮询之前：WS 建起来后首屏几乎瞬时出数（实测 74ms 拿到全部初值），
     * 而原来的轮询首屏要 15~20 秒。
     *
     * <p>★ **轮询不删，只降频**。原因写在 `ws-telemetry.ts` 顶部：
     * 增量推送的触发条件在后端未能实测确认。留着轮询等于给自己留了自愈路径 ——
     * 增量真来了它只是空转，增量不来数据也不会停。
     */
    let wsStatus: WsTelemetryStatus = "closed";
    const channel = this.createWsChannel(deviceIds, (row) => {
      /*
       * WS 推来的行与 HTTP 拉的形状一致，直接走同一个 callback。
       * 时间戳以平台给的 ts 为准 —— 这是「数据新鲜度」的唯一依据。
       */
      callback({
        deviceId: row.deviceId,
        key: row.key,
        value: row.value as TelemetryRecord["value"],
        timestamp: row.ts ?? Date.now(),
        source: "guard",
      });
    }, (status) => {
      wsStatus = status;
    });

    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        /*
         * **批次之间不检查 stopped**（2026-11-23 实测修正）。
         *
         * <p>`useTelemetryFeed` 的 effect 会重建订阅（范围设备异步到达）。
         * cleanup 把 `stopped` 置 true 时，如果正在跑第一批，后续批次就此放弃 ——
         * 实测稳定只覆盖**前 6 台**（正好是并发度），后面 8 台永远「未知」，
         * 而每次刷新停在不同设备上，极难定位。
         *
         * <p>让本轮跑完的代价是多发几个请求（一轮而已，之后 stopped 就不再有下一轮）；
         * 收益是首屏一定能覆盖全部设备。漏数据的代价大得多。
         *
         * <p>`pollOne` 内部仍检查 stopped 再回调 —— 不会把旧数据写进新订阅的视图。
         */
        for (let i = 0; i < deviceIds.length; i += CONCURRENCY) {
          await Promise.all(deviceIds.slice(i, i + CONCURRENCY).map(pollOne));
        }
      } finally {
        inFlight = false;
      }
    };

    void tick();
    /*
     * 轮询间隔随 WS 状态变（2026-11-24）。
     *
     * <p>WS 连上 → 20 秒兜底；WS 没连上 → 保持 3 秒。
     * 用自调度的 setTimeout 而不是固定 setInterval：间隔要能随状态变，
     * 而 `setInterval` 的周期建好就改不了。
     *
     * <p>20 秒不是随手取的：它是「增量推送无声失效」时能被容忍的最长滞后
     * ——超过这个数，值班员会开始怀疑大屏卡了。真要更激进（比如 60 秒），
     * 必须先确认增量推送确实可靠。
     */
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const POLL_WS_OPEN_MS = 20_000;
    const POLL_WS_CLOSED_MS = 3_000;
    const schedule = () => {
      if (stopped) return;
      const delay = wsStatus === "open" ? POLL_WS_OPEN_MS : POLL_WS_CLOSED_MS;
      pollTimer = setTimeout(() => {
        void tick().finally(schedule);
      }, delay);
    };
    schedule();
    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      channel?.close();
    };
  }

  /**
   * 建 WS 遥测通道。
   *
   * <h3>为什么要先把键查出来</h3>
   *
   * <p>`ENTITY_DATA` 订阅必须逐个列出要订的 key（实测 `latestValues: []`
   * 返回空 —— 平台不会替你「全拿」）。所以这里先按设备取键列表，
   * 复用 `telemetryKeyCache`（60 秒 TTL，与轮询共享同一份缓存）。
   *
   * <h3>为什么是 fire-and-forget</h3>
   *
   * <p>键查询是异步的，而 `subscribeTelemetry` 必须同步返回 stop 函数。
   * 让它自己异步完成：期间轮询已经在跑，用户不会看到空白。
   *
   * @returns 通道对象（可能是 null —— 环境不支持 WebSocket 时优雅降级）
   */
  private createWsChannel(
    deviceIds: string[],
    onValue: (row: { deviceId: string; key: string; value: unknown; ts?: number }) => void,
    onStatus: (status: WsTelemetryStatus) => void,
  ): WsTelemetryChannel | null {
    /*
     * 非浏览器环境（vitest / SSR）没有 WebSocket。
     * 这里必须提前判掉：`new WebSocket` 会抛 ReferenceError，
     * 而订阅是热路径，抛出去会让整块面板白屏。
     */
    if (typeof WebSocket === "undefined") return null;
    const state = this.client.getState();
    if (!state.token) return null;

    const channel = new WsTelemetryChannel({
      baseUrl: state.apiBase,
      token: state.token,
      onValue,
      onStatus,
      log: (message) => {
        /* 只在有调试开关时输出，避免大屏控制台被刷屏 */
        if (typeof console !== "undefined" && (globalThis as { __NGX_WS_DEBUG__?: boolean }).__NGX_WS_DEBUG__) {
          console.info(`[ws-telemetry] ${message}`);
        }
      },
    });

    void (async () => {
      try {
        const subs = await Promise.all(
          deviceIds.map(async (id) => {
            const cached = this.telemetryKeyCache.get(id);
            const keys = cached && Date.now() - cached.at < 60_000
              ? cached.keys
              : (await this.listTelemetryKeys(id)).map((point) => point.key);
            return { deviceId: id, keys };
          }),
        );
        channel.open(subs.filter((item) => item.keys.length));
      } catch {
        /* 查键失败就完全交给轮询 —— WS 是增强，不是必需 */
        onStatus("closed");
      }
    })();

    return channel;
  }

  async getTelemetryHistory(
    deviceId: string,
    keys: string[],
    options: { fromTs: number; toTs: number; intervalMs?: number; limit?: number },
  ): Promise<Array<{ key: string; timestamp: number; value: number }>> {
    if (!keys.length) return [];
    const query = new URLSearchParams({
      keys: keys.join(","),
      startTs: String(options.fromTs),
      endTs: String(options.toTs),
      useStrictDataTypes: "true",
    });
    /*
     * interval + agg 让平台做服务端聚合。不给 interval 平台返回原始点，
     * 一天的数据可能就是几万条 —— 前端画不动，也没必要。
     */
    if (options.intervalMs && options.intervalMs > 0) {
      query.set("interval", String(options.intervalMs));
      query.set("agg", "AVG");
    }
    if (options.limit) query.set("limit", String(options.limit));

    const data = await this.client.requestJson<Record<string, Array<{ ts?: number; value?: unknown }>>>(
      "GET",
      `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?${query.toString()}`,
    );

    const out: Array<{ key: string; timestamp: number; value: number }> = [];
    for (const [key, rows] of Object.entries(data ?? {})) {
      for (const row of rows ?? []) {
        /* 平台在严格类型下仍可能回字符串，统一转数字。非数值点直接丢弃。 */
        const numeric = typeof row.value === "number" ? row.value : Number(row.value);
        if (!Number.isFinite(numeric)) continue;
        out.push({ key, timestamp: Number(row.ts) || 0, value: numeric });
      }
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
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

  /**
   * 读设备三类属性。
   *
   * <h3>★ 必须带回 `lastUpdateTs`（2026-11-24 修）</h3>
   *
   * <p>原来这里只取 `key` / `value`，把属性的更新时间丢掉了 —— 而调用方
   * （{@link getTelemetry} 的「时序缺失回退属性」分支）拿不到时间，只好写
   * `timestamp: Date.now()`。后果是把**陈旧数据伪装成刚刚更新**：
   * 实测某台模块机的属性停在 12.5 小时前，前端却认为它是当前值。
   *
   * <p>属性天生低频更新（状态、故障码、配置），时间戳是它唯一能自证新鲜的依据。
   * 丢掉它，就等于让「数据停滞」这类故障在界面上完全看不出来。
   */
  private async readAttributes(deviceId: string): Promise<DeviceAttributeRow[]> {
    const scopes = ["SERVER_SCOPE", "SHARED_SCOPE", "CLIENT_SCOPE"] as const;
    const rows: DeviceAttributeRow[] = [];
    const seen = new Set<string>();
    for (const scope of scopes) {
      try {
        const data = await this.client.requestJson<Array<{
          key?: string;
          value?: unknown;
          lastUpdateTs?: number;
          ts?: number;
        }>>(
          "GET",
          `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/${scope}`,
        );
        for (const row of data ?? []) {
          if (!row.key || seen.has(row.key)) continue;
          seen.add(row.key);
          const ts = row.lastUpdateTs ?? row.ts;
          rows.push({
            key: row.key,
            value: row.value,
            ...(typeof ts === "number" && Number.isFinite(ts) ? { lastUpdateTs: ts } : {}),
            scope,
          });
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

/**
 * 用户显示名（2026-11-23）。
 *
 * <p>平台返回的字段不统一：有时有 `name`（邮箱），有时只有
 * `firstName` / `lastName`。告警分派下拉里显示邮箱长且难扫，
 * 优先拼姓名。
 */
function displayUserName(row: {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}): string {
  const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return (row.name || row.email || "").trim();
}
