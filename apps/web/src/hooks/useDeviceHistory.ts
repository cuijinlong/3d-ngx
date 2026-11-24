import { useEffect, useMemo, useRef, useState } from "react";
import { getDataProvider } from "@idt/data-adapter";

/**
 * 单台设备的近 24 小时历史（2026-11-23）。
 *
 * <h2>为什么不用 store 里的 history</h2>
 *
 * <p>`useTelemetryStore.history` 是**页面打开后实时累积**的 ——
 * 刚打开大屏时它几乎是空的。而「这台设备最近 24 小时功率怎么走的」
 * 正是客户点开设备时最想看的，不能等页面开够久才有。
 *
 * <p>所以这里直接问平台要历史（`getTelemetryHistory` → 服务端按 interval 聚合）。
 *
 * <h2>请求预算（A5）</h2>
 *
 * <p>点选设备才发、一次只发**一台**、两个键合并成一次请求。
 * 切设备时取消上一次（用序号丢弃迟到响应），不会累积。
 */
export interface DeviceHistoryPoint {
  ts: number;
  value: number;
}

export interface DeviceHistoryState {
  loading: boolean;
  error: string | null;
  /** key → 点序列（按时间升序） */
  series: Record<string, DeviceHistoryPoint[]>;
}

const HOUR_MS = 3_600_000;

const EMPTY: DeviceHistoryState = { loading: false, error: null, series: {} };

export function useDeviceHistory(
  deviceId: string | null | undefined,
  keys: string[],
  enabled = true,
): DeviceHistoryState {
  const [state, setState] = useState<DeviceHistoryState>(EMPTY);
  const seq = useRef(0);
  /* keys 是数组，直接进依赖会每次渲染都变 —— 用内容作键 */
  const keySig = useMemo(() => keys.filter(Boolean).sort().join(","), [keys]);

  useEffect(() => {
    if (!enabled || !deviceId || !keySig) {
      setState(EMPTY);
      return;
    }
    const provider = getDataProvider();
    if (!provider.getTelemetryHistory) {
      setState({ loading: false, error: "当前数据源不支持历史查询", series: {} });
      return;
    }

    const mySeq = ++seq.current;
    setState({ loading: true, error: null, series: {} });

    const toTs = Date.now();
    const fromTs = toTs - 24 * HOUR_MS;
    /*
     * 5 分钟一个点：24h = 288 点。
     *
     * 太密（1 分钟 = 1440 点）在 200px 宽的 sparkline 上完全看不出差别，
     * 只是多传 1000 多个点；太疏（1 小时 = 24 点）会把短时尖峰抹平 ——
     * 而尖峰正是判断「这台机器是不是在频繁启停」的关键。
     */
    const INTERVAL_MS = 5 * 60_000;

    void provider
      .getTelemetryHistory(deviceId, keySig.split(","), { fromTs, toTs, intervalMs: INTERVAL_MS })
      .then((rows) => {
        if (mySeq !== seq.current) return;
        const grouped: Record<string, DeviceHistoryPoint[]> = {};
        for (const row of rows ?? []) {
          if (!row || !Number.isFinite(row.value)) continue;
          (grouped[row.key] ??= []).push({ ts: row.timestamp, value: row.value });
        }
        for (const list of Object.values(grouped)) list.sort((a, b) => a.ts - b.ts);
        setState({ loading: false, error: null, series: grouped });
      })
      .catch((error: unknown) => {
        if (mySeq !== seq.current) return;
        setState({
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          series: {},
        });
      });

    return () => {
      /* 组件卸载或切设备：让迟到的响应失效 */
      seq.current += 1;
    };
  }, [deviceId, keySig, enabled]);

  return state;
}
