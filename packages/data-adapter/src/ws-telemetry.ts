/**
 * 平台遥测的 WebSocket 推送（2026-11-24）。
 *
 * <h2>为什么需要它</h2>
 *
 * <p>`subscribeTelemetry` 名字叫订阅，实际是 `setInterval(3000)` 轮询：
 * 每 3 秒对全部设备发一轮 `values/timeseries`。14 台设备 = 每 3 秒 14 个请求，
 * 一天下来几十万次 —— 而绝大多数返回的是同一份没变的数据。
 *
 * <p>平台本身有 WebSocket（`/api/ws`），推的就是「有变化才发」。
 * 接上它，请求量能降一个量级。
 *
 * <h2>协议（实测 2026-11-24，不是照抄文档）</h2>
 *
 * <p>连接：`ws://host/api/ws?token=<平台令牌>`
 *
 * <p>订阅命令是 v2 格式，**不是**老的 `tsSubCmds`：
 *
 * <pre>
 * { cmds: [{ type: "ENTITY_DATA", cmdId, query: {
 *     entityFilter: { type: "entityList", entityType: "DEVICE", entityList: [...] },
 *     pageLink: { pageSize, page, textSearch: null, sortOrder: null },
 *     entityFields: [],
 *     latestValues: [{ type: "TIME_SERIES", key: "xxx" }, ...],
 * } }] }
 * </pre>
 *
 * <p>用老格式会收到 `errorCode: 2 / Failed to parse the payload`。
 *
 * <p>回包：`{ cmdId, data: { data: [{ entityId, latest: { TIME_SERIES: {...} } }] }, update }`
 * —— `data` 是初值快照，`update` 是增量。
 *
 * <h2>★ 一次订阅只能拿「显式列出的键」</h2>
 *
 * <p>实测：`latestValues: []` 返回空 —— 平台不会替你「拿全部」。
 * 所以必须先把每台设备的键查出来（复用 provider 的键缓存）。
 *
 * <h2>多设备一次发</h2>
 *
 * <p>每台设备一个 `cmdId`，全部塞进同一个 `cmds` 数组发一次。
 * 实测 2 个 cmd 各自独立回包，互不影响。
 *
 * <h2>★ 增量推送的可靠性：保留轮询兜底</h2>
 *
 * <p>实测握手与初值都正常，但**用 REST 写入遥测没能收到 `update`**
 * （后端订阅通知链路的触发条件未能确认，见文档 §32）。所以本模块
 * 不承诺「有了 WS 就能停掉轮询」——
 *
 * <p>调用方的正确姿势是：WS 连上用它的初值 + 增量，**同时保留降频轮询**。
 * 增量真的来了，轮询就只是自愈；增量不来，轮询保证数据不停。
 * 这个取舍写在这里，是为了避免下次有人看到「有 WS 了」就把轮询删掉。
 */

/** WS 上的一个实体数据片段。字段与平台 `EntityData` 对齐。 */
interface WsEntityData {
  entityId?: { id?: string };
  latest?: { TIME_SERIES?: Record<string, { ts?: number; value?: unknown }> };
  timeseries?: Record<string, Array<{ ts?: number; value?: unknown }>>;
}

interface WsEntityDataUpdate {
  cmdId?: number;
  data?: { data?: WsEntityData[] };
  update?: WsEntityData[];
  errorCode?: number;
  errorMsg?: string | null;
}

/** 订阅时给的一台设备 + 它的键。 */
export interface WsDeviceSubscription {
  deviceId: string;
  keys: string[];
}

export interface WsTelemetryOptions {
  /** 平台基地址（http/https），用于拼 ws/wss URL。 */
  baseUrl: string;
  /** 平台登录令牌。 */
  token: string;
  /** 收到一条遥测。 */
  onValue: (row: { deviceId: string; key: string; value: unknown; ts?: number }) => void;
  /** 连接状态变化（用于决定是否降频轮询）。 */
  onStatus?: (status: WsTelemetryStatus) => void;
  /** 调试日志（默认静默）。 */
  log?: (message: string) => void;
}

export type WsTelemetryStatus = "connecting" | "open" | "closed";

/**
 * 把 http(s) 基地址换成 ws(s)。
 *
 * <h3>三种 baseUrl 都要能吃下</h3>
 *
 * <ul>
 *   <li>`/api` —— 默认值，**相对路径**。必须补成 `location.origin`，
 *       否则 `new WebSocket("ws/api/ws")` 直接抛错。</li>
 *   <li>`http://127.0.0.1:8090/api` —— 绝对地址（设置页填的）。</li>
 *   <li>`https://host/sub/api` —— 带子路径，要保留子路径。</li>
 * </ul>
 *
 * <p>注意 `apiBase` 末尾常带 `/api`，而 WS 端点是 `/api/ws` ——
 * 所以要先剥掉末尾的 `/api` 再拼，否则会得到 `/api/api/ws`（404）。
 */
export function toWsUrl(baseUrl: string, token: string): string {
  let base = (baseUrl || "/api").trim();
  /* 相对路径补成绝对：WS 构造器不接受相对 URL */
  if (base.startsWith("/")) {
    const origin = typeof location !== "undefined" ? location.origin : "http://127.0.0.1";
    base = `${origin}${base}`;
  }
  base = base.replace(/\/+$/, "");
  /* 剥掉末尾的 /api —— 下面会统一拼 /api/ws */
  base = base.replace(/\/api$/i, "");
  const wsBase = base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  return `${wsBase}/api/ws?token=${encodeURIComponent(token)}`;
}

/** 把设备列表切成若干条 ENTITY_DATA 命令。 */
export function buildSubscriptionMessage(
  devices: WsDeviceSubscription[],
  startCmdId = 1,
): { cmds: unknown[]; nextCmdId: number } {
  const cmds: unknown[] = [];
  let cmdId = startCmdId;
  for (const device of devices) {
    if (!device.deviceId || !device.keys.length) continue;
    cmds.push({
      type: "ENTITY_DATA",
      cmdId,
      query: {
        entityFilter: { type: "entityList", entityType: "DEVICE", entityList: [device.deviceId] },
        pageLink: { pageSize: 10, page: 0, textSearch: null, sortOrder: null },
        entityFields: [],
        latestValues: device.keys.map((key) => ({ type: "TIME_SERIES", key })),
      },
    });
    cmdId += 1;
  }
  return { cmds, nextCmdId: cmdId };
}

/**
 * 从一条 WS 回包里抽出遥测。
 *
 * <p>初值在 `data.data[].latest.TIME_SERIES`，增量在 `update[]`，
 * 增量里既可能是 `latest`（属性式）也可能是 `timeseries`（时序式）。
 * 三种都要认 —— 只处理一种会让「有的设备实时、有的永远不动」。
 */
export function extractRows(
  message: WsEntityDataUpdate,
): Array<{ deviceId: string; key: string; value: unknown; ts?: number }> {
  const rows: Array<{ deviceId: string; key: string; value: unknown; ts?: number }> = [];
  const take = (entity: WsEntityData) => {
    const deviceId = entity.entityId?.id;
    if (!deviceId) return;
    for (const [key, cell] of Object.entries(entity.latest?.TIME_SERIES ?? {})) {
      if (!cell) continue;
      rows.push({ deviceId, key, value: cell.value, ...(typeof cell.ts === "number" ? { ts: cell.ts } : {}) });
    }
    for (const [key, series] of Object.entries(entity.timeseries ?? {})) {
      if (!Array.isArray(series)) continue;
      for (const point of series) {
        if (!point) continue;
        rows.push({ deviceId, key, value: point.value, ...(typeof point.ts === "number" ? { ts: point.ts } : {}) });
      }
    }
  };
  for (const entity of message.data?.data ?? []) take(entity);
  for (const entity of message.update ?? []) take(entity);
  return rows;
}

/**
 * 一条 WebSocket 遥测通道。
 *
 * <p>刻意做成「一次性」：调用方换设备集就 close 再 new。
 * 不做增量重订阅 —— 设备集变化不频繁，而重订阅的边界情况（旧 cmdId、
 * 重复数据）很容易出错，收益不值。
 */
/**
 * 重连退避：指数增长、封顶 30 秒（2026-11-24）。
 *
 * <p>为什么要重连：原来 `close` 事件只报一次状态就完了，连接断了永久停在那里，
 * 只靠 provider 的 20 秒轮询兜底 —— 大屏开一整天，WS 断一次就永久降级成
 * 高频轮询，用户看不出来，成本一直在。
 *
 * <p>为什么封顶 30 秒：轮询兜底在 WS 断开时是 3 秒一轮，重连间隔再长也没意义；
 * 而无限指数增长会让「网络恢复后」还要等几分钟才连回去。
 *
 * <p>为什么从 1 秒起：平台重启、网络抖动是最常见的原因，快速重试一次
 * 往往就恢复了；真断网时 1→2→4→8→16→30 也很快退到低频。
 */
export function nextReconnectDelay(attempt: number): number {
  const safe = Math.max(0, Math.floor(attempt));
  return Math.min(30_000, 1_000 * 2 ** safe);
}

export class WsTelemetryChannel {
  private socket: WebSocket | null = null;
  private closed = false;
  private readonly options: WsTelemetryOptions;
  /** 重连要重新订阅，所以设备清单必须留着（`open` 时传进来）。 */
  private devices: WsDeviceSubscription[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;

  constructor(options: WsTelemetryOptions) {
    this.options = options;
  }

  /** 建立连接并订阅。返回是否成功发起（不代表推送已验证）。 */
  open(devices: WsDeviceSubscription[]): void {
    if (this.closed) return;
    this.devices = devices;
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const { cmds } = buildSubscriptionMessage(this.devices);
    if (!cmds.length) return;

    this.options.onStatus?.("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(toWsUrl(this.options.baseUrl, this.options.token));
    } catch (error) {
      this.options.log?.(`WS 构造失败: ${String(error)}`);
      this.options.onStatus?.("closed");
      /*
       * 构造失败也要重连：常见原因是 baseUrl 写错或令牌里有非法字符，
       * 改完配置后不该要求用户手动刷新页面。
       */
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.closed) { try { socket.close(); } catch { /* 忽略 */ } return; }
      /*
       * 连上了才重置退避 —— 构造成功不等于连上。
       * 过早重置会让「网络完全不通」时退避永远停在 1 秒，变成 1 秒一次的重试风暴。
       */
      this.attempt = 0;
      this.options.onStatus?.("open");
      try {
        socket.send(JSON.stringify({ cmds }));
        this.options.log?.(`WS 已订阅 ${cmds.length} 台设备`);
      } catch (error) {
        this.options.log?.(`WS 发送订阅失败: ${String(error)}`);
      }
    });

    socket.addEventListener("message", (event) => {
      let parsed: WsEntityDataUpdate;
      try {
        parsed = JSON.parse(String(event.data)) as WsEntityDataUpdate;
      } catch {
        return;
      }
      /*
       * errorCode 非 0 要说出来。静默忽略会让「订阅格式写错了」
       * 表现成「一直没数据」，而这与「设备真没上报」长得一模一样。
       */
      if (parsed.errorCode) {
        this.options.log?.(`WS 订阅错误 ${parsed.errorCode}: ${parsed.errorMsg ?? ""}`);
        return;
      }
      for (const row of extractRows(parsed)) {
        this.options.onValue(row);
      }
    });

    socket.addEventListener("error", () => {
      this.options.log?.("WS 连接错误");
    });

    socket.addEventListener("close", () => {
      /*
       * 主动 close() 时 `closed` 已置 true，不能再排重连 ——
       * 否则组件卸载后还会留一个定时器把连接又拉起来（泄漏 + 幽灵数据）。
       */
      if (this.closed) return;
      this.options.onStatus?.("closed");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = nextReconnectDelay(this.attempt);
    this.attempt += 1;
    this.options.log?.(`WS ${delay}ms 后重连（第 ${this.attempt} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try { socket.close(); } catch { /* 已关闭 */ }
    this.options.onStatus?.("closed");
  }
}
