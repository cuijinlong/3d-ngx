import { useEffect, useState } from "react";
import type { DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import { telemetryRuntime, useTelemetryStore } from "../stores/telemetry.store";
import { clearDemoRunning, getDemoRunning } from "./demo-command-state";

export type TelemetrySourceMode = "live" | "demo";

const STORAGE_KEY = "idt-3d-ngx-telemetry-source";
const EVENT = "idt-telemetry-source-changed";

/**
 * 永远返回 `"live"`（2026-11-23 客户要求）。
 *
 * <h2>为什么不是「删掉开关」就够了</h2>
 *
 * 开关删了，但下游还有 5 处 `loadTelemetrySource() === "demo"` 的分支：
 * 指令按钮在演示模式下会**只改本地状态、不发给后端**，还会提示
 * 「已在演示数据中切换启停」。一旦 localStorage 里残留 `demo`，
 * 客户点「启停」看着成功、设备毫不知情 —— 这是最坏的一种 bug。
 *
 * <p>所以入口这里直接钉死，并顺手把残留值清掉：只留一个真实来源。
 */
export function loadTelemetrySource(): TelemetrySourceMode {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "demo") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* 隐私模式 / 存储被禁用：读不到就是 live */
  }
  return "live";
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

/**
 * 平台标准 key 的演示值。
 *
 * <h2>为什么必须按 key 显式给，不能靠中文正则猜</h2>
 *
 * 旧实现按 `状态|running` 等中文/英文正则猜类型，对 `sys_run_state` 返回了
 * 字符串「运行」/「停止」。而判定期望的是 **0~9 数字枚举**：
 * `sysRunStateKind("运行")` → `Number("运行")` = NaN → unknown。
 * 结果就是「开了演示模式，9 台机组的运行状态全显示未知」。
 *
 * <p>标准 key 的名字是平台契约（不是我编的中文标签），按它给值最稳。
 * 未列出的键仍走下面按语义猜的兜底。
 */
const DEMO_BY_KEY: Record<string, (running: boolean, now: number, salt: number) => number> = {
  /* 1=停机 5=运行 —— 与手册 §17 30001 一致，不用真假布尔 */
  sys_run_state: (running) => (running ? 5 : 1),
  sys_mode: (_running) => 0,
  sys_fault_level: (_running) => 0,
  compressor_state: (running) => (running ? 1 : 0),
  water_in_temp: (_running, now, salt) => Number((12 + Math.sin(now / 5000 + salt) * 0.8).toFixed(1)),
  water_out_temp: (running, now, salt) => Number(((running ? 7 : 16) + Math.sin(now / 5000 + salt) * 0.6).toFixed(1)),
  /*
   * 模块机现场网关实际用 `temperature`（不是建档约定的 water_out_temp，
   * 见 68 脚本的说明）。演示数据必须跟着实际键走，
   * 否则「演示有、真实没有」，最难排查。
   */
  temperature: (running, now, salt) => Number(((running ? 7 : 16) + Math.sin(now / 5000 + salt) * 0.6).toFixed(1)),
  ambient_temp: (_running, now, salt) => Number((28 + Math.sin(now / 9000 + salt) * 2).toFixed(1)),
  sys_setpoint: (_running) => 7,
  power_total: (running, now, salt) => Number(((running ? 320 : 0) + Math.sin(now / 4000 + salt) * 25).toFixed(1)),
  load_rate: (running, now, salt) => Number(((running ? 68 : 0) + Math.sin(now / 6000 + salt) * 12).toFixed(0)),
  pump_freq: (running, now, salt) => Number(((running ? 42 : 0) + Math.sin(now / 7000 + salt) * 3).toFixed(1)),
  water_pressure: (running, now, salt) => Number(((running ? 0.42 : 0.05) + Math.sin(now / 8000 + salt) * 0.02).toFixed(2)),
};

/** 导出的目的：演示值必须能被单测直接验证，而不是只能靠肉眼看大屏。 */
export function demoValue(
  mapping: DeviceBinding["telemetryMappings"][number],
  now: number,
  salt: number,
  deviceId: string,
): number | string | boolean {
  const running = getDemoRunning(deviceId);

  const byKey = DEMO_BY_KEY[mapping.telemetryKey];
  if (byKey) return byKey(running, now, salt);

  const text = `${mapping.label} ${mapping.field} ${mapping.telemetryKey}`.toLowerCase();
  if (mapping.displayType === "boolean" || /状态|running|door|led/.test(text)) {
    if (/状态|running/.test(text) || mapping.displayType === "boolean" && /运行|running/.test(text)) {
      if (mapping.displayType === "boolean") return running;
      /*
       * 走到这里说明是「带状态字样的自定义键」。仍然给数字枚举而不是
       * 「运行/停止」字符串 —— 数字能被 displayType=number 的链路正确格式化，
       * 字符串会让枚举解析失败。
       */
      return running ? 1 : 0;
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
/**
 * 运行态演示遥测。
 *
 * <h2>extraKeys 为什么必须有</h2>
 *
 * 演示值原来只按 `document.bindings`（三维对象绑定）生成。
 * 但大屏卡片的槽位绑的是**另一批**设备：系统级点位挂网关设备，
 * 而网关不是 GLB 里的对象，压根不在 bindings 里。
 * 结果是「开了演示模式，3D 铭牌有数，大屏卡片全是未上报」——
 * 看起来像大屏坏了，实际是演示数据没覆盖到。
 *
 * @param bindings 三维对象绑定
 * @param enabled  是否开启演示
 * @param extraKeys 额外要造数的设备键：`{ [deviceId]: string[] }`，来自大屏布局槽位
 */
export function useDemoTelemetry(
  bindings: DeviceBinding[],
  enabled: boolean,
  extraKeys: Record<string, string[]> = {},
  perDeviceKeys: string[] = [],
): void {
  const apply = useTelemetryStore((s) => s.apply);
  /*
   * extraKeys 是每次渲染新建的对象，直接进依赖会让 effect 不停重建。
   * 用「排序后的内容」做签名，内容没变就不重启定时器。
   */
  const extraSignature = Object.keys(extraKeys)
    .sort()
    .map((id) => `${id}:${[...new Set(extraKeys[id] ?? [])].sort().join(",")}`)
    .join("|");
  /*
   * 「按设备逐台的列」（device-list / bar-compare）没有 deviceId，
   * 一个键要在**所有已绑设备**上都造出来，否则这类卡永远是「—」。
   * 实测缺口：机组加载率对比读 load_rate，而 load_rate 不在任何 3D 绑定的
   * telemetryMappings 里 —— 只按 bindings 造数就漏掉了整张图。
   */
  const perDeviceSignature = [...new Set(perDeviceKeys)].sort().join(",");

  useEffect(() => {
    if (!enabled) return;
    const extra: Array<{ deviceId: string; key: string }> = [];
    for (const deviceId of Object.keys(extraKeys)) {
      for (const key of new Set(extraKeys[deviceId] ?? [])) {
        extra.push({ deviceId, key });
      }
    }
    if (bindings.length === 0 && extra.length === 0) return;
    const tick = () => {
      const now = Date.now();
      /*
       * 大屏槽位的键先写：它们不进 bindings，只有这一条路能拿到演示值。
       * 用 deviceId 的字符和做 salt，让不同设备的曲线不同步、看起来更真实。
       */
      extra.forEach(({ deviceId, key }, index) => {
        const salt = (deviceId.charCodeAt(0) || 0) + index;
        apply({
          deviceId,
          key,
          value: demoValue({ field: key, telemetryKey: key, label: key, displayType: "number" }, now, salt, deviceId),
          timestamp: now,
          source: "mock",
        });
      });
      /*
       * 逐台列：对每台已绑设备各造一份。与上面的 extra 分开处理，
       * 因为它的设备集合来自 bindings（用户已绑的），而不是显式 deviceId。
       */
      const columnKeys = [...new Set(perDeviceKeys)].filter(Boolean);
      if (columnKeys.length) {
        bindings.forEach((binding, bindingIndex) => {
          if (!binding.deviceId) return;
          const deviceId = binding.deviceId;
          columnKeys.forEach((key, keyIndex) => {
            apply({
              deviceId,
              key,
              value: demoValue(
                { field: key, telemetryKey: key, label: key, displayType: "number" },
                now,
                bindingIndex + keyIndex * 7,
                deviceId,
              ),
              timestamp: now,
              source: "mock",
            });
          });
        });
      }
      bindings.forEach((binding, index) => {
        /*
         * 资产绑定条目没有 deviceId，也不应生成演示遥测：演示数据只能冒充
         * 「已绑设备的读数」，不能凭空造一个资产属性的假值。
         */
        if (!binding.deviceId) return;
        /* 提成常量：下面的 push 是闭包，收窄跨不进去。 */
        const deviceId = binding.deviceId;
        const keys = new Set<string>();
        const push = (key: string | undefined, mapping?: DeviceBinding["telemetryMappings"][number]) => {
          if (!key || keys.has(key)) return;
          keys.add(key);
          const row: TelemetryRecord = {
            deviceId,
            key,
            value: demoValue(
              mapping ?? { field: key, telemetryKey: key, label: key, displayType: "number" },
              now,
              index,
              deviceId,
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
  }, [enabled, bindings, apply, extraSignature, perDeviceSignature]);
}
