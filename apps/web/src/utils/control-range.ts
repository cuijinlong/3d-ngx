import type { CommandDef } from "@idt/shared-types";

/**
 * 设备控制量的「数字口径」（2026-11-23）。
 *
 * <h2>为什么必须单独一个模块</h2>
 *
 * <p>客户原话：「如果是控制开度的那么看文档是接收什么数字，然后做成形象的按钮」。
 *
 * <p>这句话的重心在**「接收什么数字」**：界面上做成滑块很好看，
 * 但滑块发出的值必须和设备/网关真正接受的数字一致，否则：
 * 滑块拖到 70%，设备收到 `70`，而它期望的是 `700`（×10 的协议）——
 * 现场表现为「设了 70 度」。这类错误**不会报错**，只会安静地设错目标值。
 *
 * <h2>手册（30RBRQ065-750VHS 第 17 章）的可写数值点位</h2>
 *
 * <table>
 *   <tr><th>地址</th><th>含义</th><th>接收范围</th><th>换算</th></tr>
 *   <tr><td>40062</td><td>制冷设定点</td><td><b>50 ~ 250</b></td><td>÷10 → 5.0 ~ 25.0 ℃</td></tr>
 *   <tr><td>40063</td><td>制热设定点</td><td><b>150 ~ 550</b></td><td>÷10 → 15.0 ~ 55.0 ℃</td></tr>
 *   <tr><td>40052</td><td>系统模式</td><td>0 / 1</td><td>0 制冷 · 1 制热</td></tr>
 *   <tr><td>40051</td><td>系统开关</td><td>0 / 1</td><td>0 关机 · 1 开机</td></tr>
 * </table>
 *
 * <p>**开度本身在手册里没有写点** —— `30010 系统加载容量 %` 是只读。
 * 我们设备上登记的 `setOpening(value: number)` 是网关侧期望能力，
 * 口径取 0~100 百分比（与遥测 `opening` 同口径，便于「设 70 后读回 70」）。
 *
 * <h2>★ 换算方向只做一处</h2>
 *
 * <p>界面显示人类单位（℃ / %），协议收发整数。所有除法/乘法都在这里，
 * 渲染层只调 `toWire` / `fromWire`。散落在组件里迟早有一处漏了 ÷10。
 */

/** 一类数值控制量的口径。 */
export interface ControlRange {
  /** 协议侧最小值（**发出去的数字**） */
  min: number;
  /** 协议侧最大值 */
  max: number;
  /** 协议侧步长 */
  step: number;
  /**
   * 协议值 ÷ scale = 显示值。
   *
   * <p>手册设定点是 ×10 存的：`200` 表示 20.0℃。开度是 1:1（scale=1）。
   */
  scale: number;
  /** 显示单位（`℃` / `%`） */
  unit: string;
  /** 显示时保留几位小数（scale=10 时 1 位，scale=1 时 0 位） */
  displayDecimals: number;
  /** 给人看的说明，直接上界面 title */
  hint: string;
}

/**
 * 开度：0~100 %，1:1。
 *
 * <p>与遥测 `opening` 同口径 —— 设 70 后读到 70，现场能对上。
 */
export const OPENING_RANGE: ControlRange = {
  min: 0,
  max: 100,
  step: 1,
  scale: 1,
  unit: "%",
  displayDecimals: 0,
  hint: "开度按百分比下发（0~100），与遥测「开度」同口径",
};

/** 制冷设定点：手册 40062 接收 50~250，÷10 → 5.0~25.0℃。 */
export const COOLING_SETPOINT_RANGE: ControlRange = {
  min: 50,
  max: 250,
  step: 1,
  scale: 10,
  unit: "℃",
  displayDecimals: 1,
  hint: "制冷设定点（手册 40062）：下发 50~250，设备按 ÷10 解释为 5.0~25.0℃",
};

/** 制热设定点：手册 40063 接收 150~550，÷10 → 15.0~55.0℃。 */
export const HEATING_SETPOINT_RANGE: ControlRange = {
  min: 150,
  max: 550,
  step: 1,
  scale: 10,
  unit: "℃",
  displayDecimals: 1,
  hint: "制热设定点（手册 40063）：下发 150~550，设备按 ÷10 解释为 15.0~55.0℃",
};

/** 协议值 → 显示值。 */
export function fromWire(range: ControlRange, wire: number): number {
  return wire / range.scale;
}

/** 显示值 → 协议值。**必须取整**：手册那几个点位只收整数。 */
export function toWire(range: ControlRange, display: number): number {
  return Math.round(display * range.scale);
}

/**
 * 把任意数字夹到协议范围内并对齐步长。
 *
 * <p>界面上滑块本身不会越界，但**读回来的当前值可能是脏的**
 * （比如设备报 999 或 -5）。不夹的话滑块会跑到外面，或者发出非法值。
 */
export function clampWire(range: ControlRange, wire: number): number {
  if (!Number.isFinite(wire)) return range.min;
  const stepped = Math.round(wire / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, stepped));
}

/** 显示用的格式化：`20.0 ℃` / `70 %`。 */
export function formatRangeValue(range: ControlRange, wire: number): string {
  return `${fromWire(range, wire).toFixed(range.displayDecimals)} ${range.unit}`.trim();
}

/**
 * 从命令定义里推断该用哪套口径。
 *
 * <h3>判据顺序（先具体后宽泛）</h3>
 *
 * <ol>
 *   <li>命令 id / 标签含「制热」「heating」→ 制热设定点（150~550）</li>
 *   <li>含「制冷」「cooling」→ 制冷设定点（50~250）</li>
 *   <li>含「设定点」「setpoint」「temperature」→ 按系统模式判，拿不准时用制冷口径
 *       （制冷是默认工况，且范围更窄 —— 用宽的那个更容易发出非法值）</li>
 *   <li>其余（`setOpening` / 「开度」）→ 开度 0~100</li>
 * </ol>
 *
 * <p>拿不准时宁可退回开度口径而不是猜温度：开度 0~100 是安全区间，
 * 即使设备其实期望别的，至少不会把温度设成 250℃。
 */
export function inferRangeForCommand(command: CommandDef): ControlRange {
  const text = `${command.id ?? ""} ${command.label ?? ""}`.toLowerCase();
  if (/制热|heating|heat/.test(text)) return HEATING_SETPOINT_RANGE;
  if (/制冷|cooling|cool/.test(text)) return COOLING_SETPOINT_RANGE;
  if (/设定点|setpoint|temperature|温度/.test(text)) return COOLING_SETPOINT_RANGE;
  return OPENING_RANGE;
}

/**
 * 匹配「数值型」控制命令（2026-11-23）。
 *
 * <p>判据：有**恰好一个** number 类型参数，且不是纯开关类。
 * 为什么排除 `setRunning(value: boolean)` —— 它是启停，走大圆按钮那套，
 * 不该出现在滑块里（让用户拖一个「运行 0~1」的滑块毫无意义）。
 *
 * <p>多个 number 参数时**不匹配**（无法判断该让用户拖哪一个），
 * 界面上退回「只显示不执行」，与 `DeviceCommandList` 的既有策略一致。
 */
export function matchNumericCommand(commands: CommandDef[]): CommandDef | null {
  for (const command of commands) {
    const params = command.params ?? [];
    if (params.length !== 1) continue;
    const param = params[0]!;
    if (param.type !== "number") continue;
    /* 布尔型「数值」排除掉，它们本質是开关 */
    if (/running|power|enable|启用|启停/i.test(`${param.name} ${command.label ?? ""}`)) continue;
    return command;
  }
  return null;
}

/**
 * 数值控制滑块的初始**协议值**（2026-11-23）。
 *
 * <h2>为什么需要这个函数</h2>
 *
 * <p>滑块要有初始位置。三条来源，优先顺序不能乱：
 * <ol>
 *   <li>设备当前上报值（`opening` 65 → 滑块停在 65）—— 操作员看到的就是现状；</li>
 *   <li>读不到时退到范围**中点**（开度 50）—— 不是最小值：</li>
 * </ol>
 *
 * <p>为什么退中点而不是最小值：滑块停在 0 看起来像「设备被关到了全关」，
 * 而实际只是「没读到」。停在中间至少不会让人误判成故障态。
 *
 * <p>为什么这个函数抽出来：实测点中泵时它没有 `opening` 遥测，
 * 滑块落在 50 —— 事后无法从界面上区分「设备真是 50」与「没读到所以 50」。
 * 把判定写成纯函数并单测，至少逻辑本身是确定的、可回归的。
 *
 * @param range 协议口径
 * @param current 设备上报的当前协议值；`null` / `undefined` / 非有限数都算「没读到」
 */
export function initialWireValue(range: ControlRange, current: number | null | undefined): number {
  if (current == null || !Number.isFinite(current)) {
    return Math.round((range.min + range.max) / 2);
  }
  return clampWire(range, current);
}
