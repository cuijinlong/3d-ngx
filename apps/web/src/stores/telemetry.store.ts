
import { create } from "zustand";
import type { AlarmRecord, TelemetryRecord } from "@idt/shared-types";
import { getDataProvider } from "@idt/data-adapter";

export type TelemetryPoint = { timestamp: number; value: number };

const HISTORY_CAP = 60;

function asNumeric(value: TelemetryRecord["value"]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function recordId(row: TelemetryRecord): string {
  return `${row.deviceId}:${row.key}`;
}

function sameRecord(prev: TelemetryRecord | undefined, next: TelemetryRecord): boolean {
  return Boolean(prev && prev.value === next.value && prev.timestamp === next.timestamp && prev.source === next.source && prev.unit === next.unit);
}

/** 3D 动画请读 telemetryRuntime，不要订阅本 store 做逐帧渲染。UI 快照按动画帧合并写入。 */
export const telemetryRuntime = {
  latest: new Map<string, TelemetryRecord>(),
  generation: 0,
};

const pending = new Map<string, TelemetryRecord>();
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => flushTelemetryTick());
  } else {
    setTimeout(() => flushTelemetryTick(), 16);
  }
}

/** 把本帧积压的遥测一次写入 UI store。可供测试同步触发。 */
export function flushTelemetryTick(): void {
  flushScheduled = false;
  if (pending.size === 0) return;
  const rows = [...pending.values()];
  pending.clear();
  useTelemetryStore.setState((state) => {
    const latest = { ...state.latest };
    let history = state.history;
    let historyChanged = false;
    for (const row of rows) {
      const id = recordId(row);
      latest[id] = row;
      const numeric = asNumeric(row.value);
      if (numeric === null) continue;
      if (!historyChanged) {
        history = { ...history };
        historyChanged = true;
      }
      history[id] = [...(history[id] ?? []), { timestamp: row.timestamp, value: numeric }].slice(-HISTORY_CAP);
    }
    return { latest, history };
  });
}

interface TelemetryState {
  latest: Record<string, TelemetryRecord>;
  history: Record<string, TelemetryPoint[]>;
  alarms: AlarmRecord[];
  demoBanner: boolean;
  apply: (row: TelemetryRecord) => void;
  clear: () => void;
  setAlarms: (alarms: AlarmRecord[]) => void;
  refreshAlarms: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  latest: {},
  history: {},
  alarms: [],
  demoBanner: true,
  apply: (row) => {
    const id = recordId(row);
    const prev = telemetryRuntime.latest.get(id);
    telemetryRuntime.latest.set(id, row);
    if (!sameRecord(prev, row)) telemetryRuntime.generation += 1;
    pending.set(id, row);
    scheduleFlush();
  },
  clear: () => {
    telemetryRuntime.latest.clear();
    telemetryRuntime.generation += 1;
    pending.clear();
    flushScheduled = false;
    set({ latest: {}, history: {} });
  },
  setAlarms: (alarms) => set({ alarms }),

  /**
   * 主动拉一次告警（2026-11-23）。
   *
   * <h2>为什么需要</h2>
   *
   * <p>告警原本只靠 `provider.subscribeAlarms` 推送，而 **guard 没有实现它**
   * （只有 mock 有）。于是真实环境下 `setAlarms` 从未被调用，
   * `AlarmList` 永远显示「当前没有告警」—— 而平台侧明明有几十条。
   *
   * <p>`useTelemetryFeed` 会用这个做轮询；告警处置后也调它做立即刷新
   * （轮询要等 60 秒，用户点完按钮看不到变化会以为没生效）。
   */
  refreshAlarms: async () => {
    try {
      const list = await getDataProvider().getAlarms?.();
      if (list) set({ alarms: list });
    } catch {
      /* 拉不到就保留上一次的列表 —— 总比清空好。 */
    }
  },
}));
