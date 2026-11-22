import { useEffect, useState } from "react";
import type { DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import { telemetryRuntime, useTelemetryStore } from "../stores/telemetry.store";
import { clearDemoRunning, getDemoRunning } from "./demo-command-state";

export type TelemetrySourceMode = "live" | "demo";

const STORAGE_KEY = "idt-3d-ngx-telemetry-source";
const EVENT = "idt-telemetry-source-changed";

export function loadTelemetrySource(): TelemetrySourceMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "demo" ? "demo" : "live";
  } catch {
    return "live";
  }
}

export function saveTelemetrySource(mode: TelemetrySourceMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

export function useTelemetrySource(): [TelemetrySourceMode, (mode: TelemetrySourceMode) => void] {
  const [mode, setMode] = useState<TelemetrySourceMode>(loadTelemetrySource);
  useEffect(() => {
    const onChange = () => setMode(loadTelemetrySource());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [
    mode,
    (next) => {
      telemetryRuntime.latest.clear();
      useTelemetryStore.getState().clear();
        if (next !== "demo") clearDemoRunning();
      saveTelemetrySource(next);
      setMode(next);
    },
  ];
}

function demoValue(
  mapping: DeviceBinding["telemetryMappings"][number],
  now: number,
  salt: number,
  deviceId: string,
): number | string | boolean {
  const text = `${mapping.label} ${mapping.field} ${mapping.telemetryKey}`.toLowerCase();
  const running = getDemoRunning(deviceId);
  if (mapping.displayType === "boolean" || /状态|running|door|led/.test(text)) {
    if (/状态|running/.test(text) || mapping.displayType === "boolean" && /运行|running/.test(text)) {
      if (mapping.displayType === "boolean") return running;
      return running ? "运行" : "停止";
    }
    return running;
  }
  const wave = Math.sin(now / 4000 + salt);
  const scale = running ? 1 : 0.15;
  if (/温度|temperature|temp/.test(text)) return Number((24 + wave * 3 * scale).toFixed(1));
  if (/功率|power/.test(text)) return Number(((running ? 12 : 0) + wave * 4 * scale).toFixed(1));
  if (/开度|opening/.test(text)) return Number(((running ? 70 : 0) + wave * 15 * scale).toFixed(1));
  if (/湿度|humidity/.test(text)) return Number((55 + wave * 8 * scale).toFixed(1));
  if (mapping.displayType === "number") return Number(((running ? 20 : 0) + wave * 5 * scale).toFixed(1));
  return "演示";
}

/** 可切换的演示测点：只写到当前已绑定的键，并在铭牌上标明「演示」，不是成品假数。 */
export function useDemoTelemetry(bindings: DeviceBinding[], enabled: boolean): void {
  const apply = useTelemetryStore((s) => s.apply);

  useEffect(() => {
    if (!enabled || bindings.length === 0) return;
    const tick = () => {
      const now = Date.now();
      bindings.forEach((binding, index) => {
        const keys = new Set<string>();
        const push = (key: string | undefined, mapping?: DeviceBinding["telemetryMappings"][number]) => {
          if (!key || keys.has(key)) return;
          keys.add(key);
          const row: TelemetryRecord = {
            deviceId: binding.deviceId,
            key,
            value: demoValue(
              mapping ?? { field: key, telemetryKey: key, label: key, displayType: "number" },
              now,
              index,
              binding.deviceId,
            ),
            timestamp: now,
            source: "mock",
          };
          apply(row);
        };
        for (const mapping of binding.telemetryMappings) {
          push(mapping.telemetryKey, mapping);
        }
        if (binding.statusMapping?.telemetryKey) {
          push(binding.statusMapping.telemetryKey, {
            field: binding.statusMapping.telemetryKey,
            telemetryKey: binding.statusMapping.telemetryKey,
            label: "运行状态",
            displayType: "boolean",
          });
        }
        for (const action of binding.actionMappings) push(action.telemetryKey);
      });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, bindings, apply]);
}
