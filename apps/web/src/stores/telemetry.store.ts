
import { create } from "zustand";
import type { AlarmRecord, TelemetryRecord } from "@idt/shared-types";

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

/** UI 侧节流后的遥测快照。3D 动画请读 telemetryRuntime，不要订阅本 store 做逐帧渲染。 */
interface TelemetryState {
  latest: Record<string, TelemetryRecord>;
  history: Record<string, TelemetryPoint[]>;
  alarms: AlarmRecord[];
  demoBanner: boolean;
  apply: (row: TelemetryRecord) => void;
  clear: () => void;
  setAlarms: (alarms: AlarmRecord[]) => void;
}

export const telemetryRuntime = {
  latest: new Map<string, TelemetryRecord>(),
};

export const useTelemetryStore = create<TelemetryState>((set) => ({
  latest: {},
  history: {},
  alarms: [],
  demoBanner: true,
  apply: (row) => {
    telemetryRuntime.latest.set(`${row.deviceId}:${row.key}`, row);
    const id = `${row.deviceId}:${row.key}`;
    const numeric = asNumeric(row.value);
    set((state) => {
      const prev = state.history[id] ?? [];
      const history = numeric === null
        ? state.history
        : {
            ...state.history,
            [id]: [...prev, { timestamp: row.timestamp, value: numeric }].slice(-HISTORY_CAP),
          };
      return {
        latest: { ...state.latest, [id]: row },
        history,
      };
    });
  },
  clear: () => {
    telemetryRuntime.latest.clear();
    set({ latest: {}, history: {} });
  },
  setAlarms: (alarms) => set({ alarms }),
}));
