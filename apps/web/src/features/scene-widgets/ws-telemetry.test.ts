import { describe, expect, it, vi } from "vitest";
import {
  buildSubscriptionMessage,
  extractWsTelemetryRows,
  nextReconnectDelay,
  toWsUrl,
  WsTelemetryChannel,
} from "@idt/data-adapter";

/*
 * WebSocket 遥测（2026-11-24）。
 *
 * <p>协议细节全部来自实测（见 ws-telemetry.ts 顶部）。
 * 这里钉住的是「照着实测结论实现」的那几处 —— 少一个就会静默无数据。
 */

describe("toWsUrl", () => {
  it("★ 相对 /api 必须补成绝对（WS 不接受相对 URL）", () => {
    const u = toWsUrl("/api", "t");
    expect(u.startsWith("ws://") || u.startsWith("wss://")).toBe(true);
  });

  it("★ 不能拼出 /api/api/ws（apiBase 末尾自带 /api）", () => {
    expect(toWsUrl("http://h:8090/api", "t")).toBe("ws://h:8090/api/ws?token=t");
  });

  it("https → wss", () => {
    expect(toWsUrl("https://h/api", "t")).toBe("wss://h/api/ws?token=t");
  });

  it("保留子路径（前端可能挂在 /sub 下）", () => {
    expect(toWsUrl("https://h/sub/api", "t")).toBe("wss://h/sub/api/ws?token=t");
  });
});

describe("buildSubscriptionMessage", () => {
  it("★ 用 v2 的 ENTITY_DATA 格式（老 tsSubCmds 会返回 errorCode 2）", () => {
    const { cmds } = buildSubscriptionMessage([
      { deviceId: "d1", keys: ["temp", "running"] },
    ]);
    const cmd = cmds[0] as Record<string, any>;
    expect(cmd.type).toBe("ENTITY_DATA");
    expect(cmd.query.entityFilter).toEqual({
      type: "entityList", entityType: "DEVICE", entityList: ["d1"],
    });
    /* ★ key 必须逐个列出 —— 实测 latestValues: [] 返回空 */
    expect(cmd.query.latestValues).toEqual([
      { type: "TIME_SERIES", key: "temp" },
      { type: "TIME_SERIES", key: "running" },
    ]);
  });

  it("每台设备一个 cmdId，互不冲突", () => {
    const { cmds, nextCmdId } = buildSubscriptionMessage([
      { deviceId: "d1", keys: ["a"] },
      { deviceId: "d2", keys: ["b"] },
    ]);
    expect(cmds).toHaveLength(2);
    expect((cmds[0] as any).cmdId).toBe(1);
    expect((cmds[1] as any).cmdId).toBe(2);
    expect(nextCmdId).toBe(3);
  });

  it("没有键的设备被跳过（空 latestValues 订阅只会白占一条 cmd）", () => {
    const { cmds } = buildSubscriptionMessage([
      { deviceId: "d1", keys: [] },
      { deviceId: "d2", keys: ["b"] },
    ]);
    expect(cmds).toHaveLength(1);
    expect((cmds[0] as any).query.entityFilter.entityList).toEqual(["d2"]);
  });
});

describe("extractWsTelemetryRows", () => {
  it("★ 认初值（data.data[].latest.TIME_SERIES）", () => {
    const rows = extractWsTelemetryRows({
      cmdId: 1,
      data: { data: [{
        entityId: { id: "dev-1" },
        latest: { TIME_SERIES: { sys_run_state: { ts: 111, value: "8" } } },
      }] },
    });
    expect(rows).toEqual([{ deviceId: "dev-1", key: "sys_run_state", value: "8", ts: 111 }]);
  });

  it("★ 也认增量（update[]）—— 只处理初值会让数据停在首帧", () => {
    const rows = extractWsTelemetryRows({
      cmdId: 1,
      update: [{
        entityId: { id: "dev-1" },
        latest: { TIME_SERIES: { temperature: { ts: 222, value: "18.6" } } },
      }],
    });
    expect(rows[0]?.key).toBe("temperature");
    expect(rows[0]?.ts).toBe(222);
  });

  it("★ 增量里的 timeseries 形态也要认（有的推送走这条）", () => {
    const rows = extractWsTelemetryRows({
      cmdId: 1,
      update: [{
        entityId: { id: "dev-1" },
        timeseries: { power: [{ ts: 333, value: "12.5" }, { ts: 334, value: "13" }] },
      }],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ts)).toEqual([333, 334]);
  });

  it("没有 entityId 的片段被丢弃（否则会写进 undefined 设备）", () => {
    const rows = extractWsTelemetryRows({
      cmdId: 1,
      data: { data: [{ latest: { TIME_SERIES: { a: { ts: 1, value: 1 } } } }] },
    });
    expect(rows).toEqual([]);
  });

  it("空回包不抛错", () => {
    expect(extractWsTelemetryRows({})).toEqual([]);
    expect(extractWsTelemetryRows({ cmdId: 1, data: { data: [] } })).toEqual([]);
  });

  it("null 值照原样带出（平台用 null 表示「该键无数据」，不能当成没收到）", () => {
    const rows = extractWsTelemetryRows({
      cmdId: 1,
      data: { data: [{
        entityId: { id: "d" },
        latest: { TIME_SERIES: { alarm_code: { ts: 5, value: null } } },
      }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBeNull();
  });
});

describe("nextReconnectDelay", () => {
  it("★ 指数退避并封顶 30 秒（不能无限增长）", () => {
    /*
     * 封顶的必要性：无限增长会让「网络恢复」后还要等几分钟才连回去；
     * 而不封顶也没有意义 —— 轮询兜底在 WS 断开时本来就是 3 秒一轮。
     */
    expect(nextReconnectDelay(0)).toBe(1_000);
    expect(nextReconnectDelay(1)).toBe(2_000);
    expect(nextReconnectDelay(2)).toBe(4_000);
    expect(nextReconnectDelay(3)).toBe(8_000);
    expect(nextReconnectDelay(4)).toBe(16_000);
    expect(nextReconnectDelay(5)).toBe(30_000);
    expect(nextReconnectDelay(50)).toBe(30_000);
  });

  it("负数/小数不产生非法间隔", () => {
    expect(nextReconnectDelay(-3)).toBe(1_000);
    expect(nextReconnectDelay(1.7)).toBe(2_000);
  });
});

describe("WsTelemetryChannel 断线重连", () => {
  /** 最小 WebSocket 桩：只实现 addEventListener 与 close，能手动触发事件。 */
  class FakeSocket {
    static all: FakeSocket[] = [];
    listeners = new Map<string, Array<(e?: unknown) => void>>();
    sent: string[] = [];
    closed = false;
    constructor(public url: string) {
      FakeSocket.all.push(this);
    }
    addEventListener(type: string, fn: (e?: unknown) => void) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.closed = true;
      this.emit("close");
    }
    emit(type: string, e?: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn(e);
    }
  }

  function withFake(fn: () => void) {
    const holder = globalThis as unknown as { WebSocket: unknown };
    const original = holder.WebSocket;
    holder.WebSocket = FakeSocket;
    FakeSocket.all = [];
    try {
      fn();
    } finally {
      holder.WebSocket = original;
    }
  }

  it("★ 非主动断开 → 按退避重连；主动 close → 不再重连", () => {
    /*
     * 这两条必须一起测：只测前半段会漏掉「组件卸载后定时器又把连接拉起来」
     * 这类泄漏 —— 它表现为大屏退出后仍在后台收数据，很难发现。
     */
    withFake(() => {
      vi.useFakeTimers();
      try {
        const statuses: string[] = [];
        const channel = new WsTelemetryChannel({
          baseUrl: "/api",
          token: "t",
          onValue: () => {},
          onStatus: (s) => statuses.push(s),
        });
        channel.open([{ deviceId: "d1", keys: ["k"] }]);
        expect(FakeSocket.all).toHaveLength(1);

        /* 服务端断开（不是我们主动关的）→ 应安排重连 */
        FakeSocket.all[0]!.emit("close");
        expect(statuses).toContain("closed");
        vi.advanceTimersByTime(999);
        expect(FakeSocket.all).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(FakeSocket.all).toHaveLength(2);

        /* 主动关闭后，即使再触发 close 事件也不该再建连 */
        channel.close();
        vi.advanceTimersByTime(60_000);
        expect(FakeSocket.all).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("连上后重置退避（避免断网时一直 1 秒一次）", () => {
    withFake(() => {
      vi.useFakeTimers();
      try {
        const channel = new WsTelemetryChannel({
          baseUrl: "/api",
          token: "t",
          onValue: () => {},
        });
        channel.open([{ deviceId: "d1", keys: ["k"] }]);
        /* 连断三次，把退避推到 4 秒 */
        for (let i = 0; i < 3; i++) {
          FakeSocket.all.at(-1)!.emit("close");
          vi.advanceTimersByTime(8_000);
        }
        const before = FakeSocket.all.length;
        /* 这次真的连上了 */
        FakeSocket.all.at(-1)!.emit("open");
        /* 再断 → 应该回到 1 秒退避 */
        FakeSocket.all.at(-1)!.emit("close");
        vi.advanceTimersByTime(1_000);
        expect(FakeSocket.all.length).toBe(before + 1);
        channel.close();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
