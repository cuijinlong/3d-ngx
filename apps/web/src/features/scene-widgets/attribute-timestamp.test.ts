import { describe, expect, it, vi } from "vitest";
import type { GuardClient } from "@idt/data-adapter";
import { GuardServerProvider } from "../../../../../packages/data-adapter/src/guard-provider";

/*
 * 服务端属性回退时的时间戳（2026-11-24 修）。
 *
 * <h3>为什么这条重要</h3>
 *
 * <p>运行状态、故障码这类数据天生低频更新 —— 适合放属性而不是遥测。
 * 但属性**只保留最新值、不存历史**，所以 `lastUpdateTs` 是它唯一能
 * 自证「我刚更新过」的依据。
 *
 * <p>原来 `getTelemetry` 在「时序键缺失 → 回退读属性」这条路上写
 * `timestamp: Date.now()` —— 把陈旧数据伪装成刚刚更新。
 * 实测有台模块机的属性停在 12.5 小时前，前端却当成当前值。
 * 这个 bug 会让任何「数据停滞」告警永远失效。
 */

function makeProvider(json: (path: string) => unknown) {
  const requestJson = vi.fn(async (_method: string, path: string) => json(path));
  const client = { requestJson } as unknown as GuardClient;
  return { provider: new GuardServerProvider(client), requestJson };
}

describe("属性回退的时间戳", () => {
  it("★ 用属性自己的 lastUpdateTs，不用 Date.now()", async () => {
    const ATTR_TS = 1795434239666; // 用户实测那台模块机的真实时间
    const { provider } = makeProvider((path) => {
      if (path.includes("/values/timeseries")) return {}; // 时序里没有这个键
      if (path.includes("SERVER_SCOPE")) {
        return [{ key: "sys_run_state", value: "8", lastUpdateTs: ATTR_TS }];
      }
      return [];
    });

    const rows = await provider.getTelemetry("dev-1", ["sys_run_state"]);
    const row = rows.find((r) => r.key === "sys_run_state");
    expect(row).toBeTruthy();
    /* 时间戳必须等于属性的更新时间，而不是「现在」 */
    expect(row!.timestamp).toBe(ATTR_TS);
    expect(Math.abs(row!.timestamp - Date.now())).toBeGreaterThan(60_000);
  });

  it("没有 lastUpdateTs 时才退到当前时间", async () => {
    const { provider } = makeProvider((path) => {
      if (path.includes("/values/timeseries")) return {};
      if (path.includes("SERVER_SCOPE")) return [{ key: "fault_code", value: "TH702" }];
      return [];
    });
    const before = Date.now();
    const rows = await provider.getTelemetry("dev-1", ["fault_code"]);
    const row = rows.find((r) => r.key === "fault_code");
    expect(row!.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("时序有值时优先用时序，不去碰属性", async () => {
    const { provider, requestJson } = makeProvider((path) => {
      if (path.includes("/values/timeseries")) {
        return { running: [{ ts: 111, value: true }] };
      }
      return [];
    });
    const rows = await provider.getTelemetry("dev-1", ["running"]);
    expect(rows[0]?.timestamp).toBe(111);
    /* 时序已覆盖 → 不该再去读属性（省一次请求） */
    expect(requestJson.mock.calls.some((c) => String(c[1]).includes("attributes"))).toBe(false);
  });

  it("三类属性都能回退（CLIENT_SCOPE 是状态类数据最合适的落点）", async () => {
    const { provider } = makeProvider((path) => {
      if (path.includes("/values/timeseries")) return {};
      if (path.includes("CLIENT_SCOPE")) {
        return [{ key: "sys_fault_level", value: 2, lastUpdateTs: 222 }];
      }
      return [];
    });
    const rows = await provider.getTelemetry("dev-1", ["sys_fault_level"]);
    expect(rows[0]?.value).toBe(2);
    expect(rows[0]?.timestamp).toBe(222);
  });
});
