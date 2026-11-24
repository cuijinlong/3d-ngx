import { describe, expect, it } from "vitest";
import {
  buildSubscriptionMessage,
  extractWsTelemetryRows,
  toWsUrl,
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
