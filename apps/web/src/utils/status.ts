
import type { DeviceBinding, DeviceStatus, TelemetryRecord } from "@idt/shared-types";
import { bindingRunningState, SYS_RUN_STATE_KEY, sysRunStateKind } from "./device-plates";

/**
 * 绑定 → 3D 染色用的状态（2026-11-23 重写）。
 *
 * <h2>旧实现的严重缺陷</h2>
 *
 * <p>原第一行是 `if (!binding?.statusMapping) return "normal"` ——
 * **没配状态映射的设备一律染成绿色（正常）**。
 *
 * <p>实测后果：2# 机组 `sys_run_state = 8`（故障）、告警列表里挂着
 * `TH702`，而 3D 里那台机器跟旁边正常的一模一样 —— 因为它没配
 * `statusMapping`。客户原话就是「故障的应该是红色」。
 *
 * <h2>现在：三级回退</h2>
 *
 * <ol>
 *   <li>`statusMapping` 配了 → 按规则的阈值判断；</li>
 *   <li>`statusMapping` 配了但它指定的键**没有值** → 退回设备的 `running` 布尔；</li>
 *   <li>两者都没有 → `offline`（这台真没上报状态）。</li>
 * </ol>
 *
 * <h2>★ 第二条是 2026-11-23 补的关键回退</h2>
 *
 * <p>客户报：「3D 的机组为什么只有一个是绿色，实际运行的不只 1 个」。
 *
 * <p>根因：13 条绑定的 `statusMapping.telemetryKey` 都写的是 `sys_run_state`
 * （手册 30001 枚举），而平台库里只有 **1# 和 2#** 有这个键；
 * 3#~9# 只有 `running` 布尔。旧代码 `if (!row) return "offline"` ——
 * 于是 3#~9# 全部被染成灰色「离线」，即使其中 4 台 `running = true`。
 *
 * <p>这是个会误导现场判断的缺陷：值班员看到整排灰，会以为机组全停了。
 * 而不同厂商的网关上报粒度本来就不同（有的只给布尔、有的给枚举），
 * **不能把「没上报枚举键」当成「设备离线」。**
 */
export function evalStatus(
  binding: DeviceBinding | undefined,
  latest: Map<string, TelemetryRecord>,
): DeviceStatus {
  if (!binding?.deviceId) return "normal";

  if (binding.statusMapping) {
    const row = latest.get(`${binding.deviceId}:${binding.statusMapping.telemetryKey}`);
    if (row) {
      if (row.value === "离线") return "offline";
      for (const rule of binding.statusMapping.rules) {
        if (match(rule.operator, row.value, rule.value)) return rule.state;
      }
      return "normal";
    }
    /*
     * 该键没有值 → **先回退到 running**，不要直接判离线。
     *
     * <p>`bindingRunningState` 自己就是「sys_run_state 优先，否则找
     * running 映射」，还处理了「1(停机)/8(故障) 是非零、不能当 true」
     * 这个陷阱。复用它比自己再写一遍可靠。
     */
    const running = bindingRunningState(binding, latest);
    if (running === true) return "normal";
    if (running === false) return "offline";
    /* running 也没值 —— 这台确实没上报任何状态 */
    return "offline";
  }

  /*
   * 回退：手册枚举。这是热泵现场的真实协议点（30001），
   * 不依赖绑定配置 —— 只要网关按手册写，3D 就能正确上色。
   */
  const sysRow = latest.get(`${binding.deviceId}:${SYS_RUN_STATE_KEY}`);
  if (sysRow) {
    const kind = sysRunStateKind(sysRow.value);
    if (kind === "fault") return "alarm";
    if (kind === "offline") return "offline";
    if (kind === "running") return "normal";
  }
  return "normal";
}

function match(
  op: "eq" | "gt" | "gte" | "lt" | "lte",
  left: string | number | boolean,
  right: string | number | boolean,
): boolean {
  if (op === "eq") return left === right || String(left) === String(right);
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

export const STATUS_COLOR: Record<DeviceStatus, string> = {
  normal: "#19b37d",
  warning: "#e8930c",
  alarm: "#e5484d",
  offline: "#5f6e84",
};

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  normal: "正常",
  warning: "预警",
  alarm: "告警",
  offline: "离线",
};
