/**
 * 命令回执校验（2026-11-23）。
 *
 * <h2>为什么需要它</h2>
 *
 * 平台下发命令走的是 **oneway RPC**（`/api/rpc/oneway/...`）—— 它只保证
 * 消息发出，不等待设备响应。网关不认识这条命令时（返回 `unknown method`）
 * 平台同样得到 200。
 *
 * 而设备上的命令清单 `rpcMethods` 是**我们自己在 seed 脚本里声明的**
 * （见 `46-seed-heat-pump-rig.mjs` 的 `GATEWAY_RPC`，注释写着
 * 「网关侧需实现同名方法」）—— 它表达的是「我们希望网关支持什么」，
 * 不是「网关真的支持什么」。所以**平台侧无法预先知道命令会不会被执行**。
 *
 * 唯一真相是**设备状态有没有变**。于是点完按钮后等一段时间回读状态键：
 * 到了目标态才算确认，没动就得如实告诉操作员去核实。
 *
 * <h2>为什么不是「成功 / 失败」二元</h2>
 *
 * 「状态没变」至少有四个互不相同的原因，前端分不清是哪个：
 *
 * <ol>
 *   <li>网关没实现这条命令 → 指令被丢弃；</li>
 *   <li>互锁拒绝（如 `30001=2 启动中` 不允许写）→ 命令正确执行但设备不动；</li>
 *   <li>设备本来就在目标态 → 不需要动作；</li>
 *   <li>上报还没回来 → 只是慢。</li>
 * </ol>
 *
 * 把它们统统写成「失败」是编造因果。所以只报**观察到的事实**：
 * 到了目标 / 没变化 / 变成别的状态 / 读不到。
 */

/** 回执判定结果。措辞对应见 `COMMAND_OUTCOME_TEXT`。 */
export type CommandOutcome = "confirmed" | "unchanged" | "unexpected" | "unverifiable";

/**
 * 等多久再回读状态。
 *
 * <p>手册要求 MODBUS 扫描周期 ≥500ms，加上网关处理与 MQTT 往返，
 * 短于 10 秒会把「慢」误判成「没响应」。宁可多等，也不要误报。
 */
export const COMMAND_VERIFY_DELAY_MS = 10_000;

/**
 * 判定一次命令的实际效果。
 *
 * @param before   发命令前的状态（`null` = 未知）
 * @param after    回读到的状态（`null` = 读不到）
 * @param targetOn 命令期望的目标态
 */
export function verifyCommandOutcome(args: {
  before: boolean | null;
  after: boolean | null;
  targetOn: boolean;
}): CommandOutcome {
  const { before, after, targetOn } = args;

  /* 读不到就不能断言 —— 这是最要紧的一条，别把「不知道」说成「失败」。 */
  if (after === null) return "unverifiable";

  /* 到了目标态，确认生效。 */
  if (after === targetOn) return "confirmed";

  /*
   * 确认动了、但没到目标态 —— 例如从「运行」变成「故障」。
   * 这比「没动」更值得提醒：设备确实响应了，只是结果不是我们要的。
   *
   * <p>必须要求 `before` 已知：前态未知时，「和刚才不一样」无从判断，
   * 归到 unchanged 更诚实（我们只知道「现在不是目标态」）。
   */
  if (before !== null && after !== before) return "unexpected";

  /*
   * 没变化，或无法判断有没有变化。
   *
   * <p>注意：这**不等于失败**。设备本来就在原状态时，命令不下发动作是正常的；
   * 互锁拒绝也是「正确执行、设备不动」。所以文案要说「状态未变化」，
   * 并指向人工核实，而不是「命令失败」。
   */
  return "unchanged";
}

/**
 * 面向操作员的文案。
 *
 * <p>都写「事实 + 下一步」，不写结论性判断 —— 因为 oneway 模式下
 * 前端确实不知道网关内部发生了什么。
 */
export const COMMAND_OUTCOME_TEXT: Record<CommandOutcome, string> = {
  confirmed: "状态已确认为目标状态",
  unchanged:
    "命令已发出，但设备状态未变化。可能是网关未实现该命令、被互锁拒绝，或设备本就在该状态 —— 请现场核实。",
  unexpected:
    "命令已发出，但设备状态变成了预期之外的值（例如转为故障）。请立即核实设备。",
  unverifiable:
    "命令已发出，但读不到设备状态，无法确认是否生效。请检查网关上报是否正常。",
};
