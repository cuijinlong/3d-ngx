
import type { DeviceBinding, HmiDevice, TelemetryRecord } from "@idt/shared-types";
import { formatHmiDeviceName } from "@idt/engine-adapter";

export type PlateLine = {
  label: string;
  text: string;
  missing: boolean;
};

/**
 * 铭牌上的设备状态（2026-11-23）。
 *
 * <p>比原来的 `running: boolean | null` 多两态。客户要求
 * 「设备的铭牌上也要提示」—— 只说「运行/停止」表达不了故障：
 * 一台**故障停机**的机组在旧模型里与「正常停机」完全一样，
 * 而现场必须能一眼分辨「是我让它停的」还是「它坏了」。
 *
 * <p>取值与 3D 染色、列表状态用同一套判据（`sysRunStateKind`），
 * 避免「列表说故障、铭牌说停止」这种自相矛盾。
 */
export type PlateStatus = "running" | "stopped" | "fault" | "offline" | "unknown";

export type DevicePlate = {
  node: string;
  title: string;
  bound: boolean;
  source?: "live" | "demo";
  running: boolean | null;
  /**
   * 四态以上的显示状态。`running` 保留给 3D 动画与启停按钮，
   * 两者语义不同：`running=false` 无法区分「停机」与「故障」。
   */
  status: PlateStatus;
  /** 故障码（如 `TH702`）。来自设备上报的故障码键，不是前端猜的。 */
  faultCode?: string;
  lines: PlateLine[];
  kind: "board" | "badge";
  showStartStop: boolean;
};

/**
 * 设备可能上报故障码的键名。
 *
 * <p>不同厂商/网关写法不一致，列常见几种。读不到就不显示 ——
 * **不在前端把状态码拼成故障码**：那是猜，而现场会拿它去查手册。
 */
export const FAULT_CODE_KEYS = ["fault_code", "faultCode", "alarm_code", "alarmCode", "error_code"];

const MAX_LINES = 4;

/**
 * 遥测数值的统一格式化（2026-11-23）。
 *
 * <h2>为什么必须统一</h2>
 *
 * <p>改之前有三套规则，互相打架，大屏上能直接看出来：
 *
 * <table>
 *   <tr><th>真实值</th><th>单设备槽</th><th>聚合槽</th></tr>
 *   <tr><td>5.97</td><td>6.0</td><td>6.0</td></tr>
 *   <tr><td>119.9</td><td>119.9</td><td><b>120</b></td></tr>
 *   <tr><td>20</td><td><b>20</b></td><td><b>20.0</b></td></tr>
 * </table>
 *
 * <p>同一个「系统功率」卡里，主指标（聚合，119.9→120）和进出水（单设备，7.13→7.1）
 * 精度口径不同；而整数 20 在一处显示 `20`、另一处 `20.0`。
 * 根源是两条各自拍脑袋的规则：
 * <ul>
 *   <li>`formatTelemetryText`：一律 `toFixed(1)`，丢掉第二位小数；</li>
 *   <li>聚合槽：`abs >= 100 ? 0 : 1`，按数值大小决定精度 —— 119.9 被抹成 120。</li>
 * </ul>
 *
 * <h2>现在的规则</h2>
 *
 * <p><b>按数据本身的精度显示，最多 2 位，去掉尾随 0。</b>
 *
 * <pre>
 * 5.97  → "5.97"
 * 10.28 → "10.28"
 * 119.9 → "119.9"
 * 20    → "20"      （不是 "20.00"）
 * 0.5   → "0.5"
 * </pre>
 *
 * <p>2 位是上限：源头（网关 / 模拟器）通常给到 2 位，传感器有效位也到 0.01。
 * 再多就是浮点噪音（`7.130000000000001`），`toFixed` 正好截掉。
 *
 * <p>去尾随 0 是为了大屏观感 —— `20.00` 那一串零在深色背景上很脏，
 * 而 `20` 和 `20.0` 表达的信息完全相同。
 *
 * <p><b>比率/百分比不走这里</b>：`56%` 取整是对的，`56.3%` 在大屏上没有意义。
 */
export function formatMetricNumber(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const fixed = value.toFixed(maxDecimals);
  /*
   * 极小值被 toFixed 抹成 0 时退回原始写法 ——
   * 别把 0.004 显示成 0（那才是真正的精度损失）。
   */
  if (Number(fixed) === 0) return String(value);
  /* 去掉尾随 0 与孤立的小数点：`119.90` → `119.9`，`20.00` → `20`。 */
  return fixed.replace(/\.?0+$/, "");
}

export function formatTelemetryText(value: unknown, displayType?: string, unit?: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean" || displayType === "boolean") {
    return isTruthyState(value) ? "运行" : "停止";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const body = formatMetricNumber(value);
    return unit ? `${body} ${unit}` : body;
  }
  const asNumber = typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : null;
  if (asNumber !== null && Number.isFinite(asNumber) && displayType !== "text") {
    const body = formatMetricNumber(asNumber);
    return unit ? `${body} ${unit}` : body;
  }
  return unit ? `${String(value)} ${unit}` : String(value);
}

export function isTruthyState(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on" || value === "运行" || value === "开";
}

export function readLatest(
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
  /*
   * 允许 undefined：v2 绑定可以是「场景对象 → 资产属性」，这类条目没有 deviceId，
   * 本来就没有遥测可读。在入口处返回 undefined，比让每个调用点各写一遍空值判断可靠
   * —— 调用方已有的 !row 分支会自然走「无数据」路径。
   */
  deviceId: string | undefined,
  keys: Array<string | undefined | null>,
): TelemetryRecord | undefined {
  if (!deviceId) return undefined;
  const get = (key: string) => {
    const id = `${deviceId}:${key}`;
    return latest instanceof Map ? latest.get(id) : latest[id];
  };
  for (const key of keys) {
    if (!key) continue;
    const row = get(key);
    if (row && row.value !== undefined && row.value !== null && row.value !== "") return row;
  }
  return undefined;
}

export function mappingKeys(mapping: DeviceBinding["telemetryMappings"][number]): string[] {
  return [mapping.telemetryKey, mapping.field].filter((k): k is string => Boolean(k));
}

function isRunningMapping(mapping: DeviceBinding["telemetryMappings"][number]): boolean {
  const text = `${mapping.label} ${mapping.field} ${mapping.telemetryKey}`.toLowerCase();
  return /状态|running|runstate/.test(text) && !/启停/.test(text);
}

/**
 * 热泵机组的运行状态键（手册 §17 MODBUS 30001 / 30003+100×address）。
 *
 * <p>值是 **0~9 枚举**，不是布尔：`1=停机`、`5=运行`、`8=故障`。
 * 任何地方拿它做 truthy 判断都是错的 —— 1 和 8 都是非零，会被当成「在运行」，
 * 结果就是「列表显示停机，3D 风扇却在转」。所以统一从这里取判据。
 *
 * <p>放在 utils 层是因为 device-plates（底层展示）和 widget-values（部件层）
 * 都要用；放 features 会让 utils 反向依赖 features。
 */
export const SYS_RUN_STATE_KEY = "sys_run_state";

export type SysRunStateKind = "running" | "offline" | "fault" | "unknown";

/**
 * 手册枚举 → 四态。
 * 未列出的值（含初始化 0、测试 9、协议外值）一律 unknown：
 * 宁可显示「未知」，也不要猜成运行或停机。
 */
export function sysRunStateKind(value: unknown): SysRunStateKind {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n)) return "unknown";
  switch (n) {
    case 1: // 停机
    case 3: // 关机中
    case 4: // 待机
      return "offline";
    case 2: // 启动中
    case 5: // 运行
    case 6: // 水系统
    case 7: // 防冻
      return "running";
    case 8: // 故障
      return "fault";
    default:
      return "unknown";
  }
}

/**
 * 解释「这台设备的运行状态到底读哪个遥测」。
 *
 * <h2>为什么需要它</h2>
 *
 * <p>客户原话：「启停按钮下面运行状态就是属于那个状态那个亮就行了，
 * 但是我在平台端设备运维-实时监测中不知道哪个遥测跟这个运行状态绑定」。
 *
 * <p>问题真实存在：运行状态的判据分散在三处 ——
 * `statusMapping.telemetryKey`、`telemetryMappings` 里 label 含「状态」的项、
 * 以及硬编码的 `sys_run_state`。前两处是配置，第三处是代码约定，
 * 现场看「实时监测」那一列遥测键**完全推不出来**。
 *
 * <p>所以把推导过程显式化：给出**实际生效的键**、**来源**、**是否会回退**。
 * 用它渲染在绑定面板上，配色/状态格/3D 染色三者共用同一份说明。
 *
 * <h2>★ 顺序必须与 `bindingRunningState` 一致</h2>
 *
 * <p>这里只是「解释」，判据本身仍然只有 `bindingRunningState` 一份。
 * 如果两边顺序不同，界面会告诉你「读的是 A」，而 3D 实际按 B 染色 ——
 * 那比不解释更糟。改这里必须同步改 `bindingRunningState`。
 */
export type RunningStateSource = "status-mapping" | "telemetry-mapping" | "none";

export type RunningStateExplanation = {
  /** 实际生效的键（`null` = 没有可用的键） */
  key: string | null;
  /** 键的来源，决定它的语义 */
  source: RunningStateSource;
  /** 这个键的值怎么解释（枚举 / 布尔 / 未知） */
  valueKind: "enum" | "boolean" | "unknown";
  /**
   * 是否会在该键没数据时回退到别的键。
   *
   * <p>`statusMapping` 指定的键经常只有部分网关上报（3#~9# 只有布尔），
   * 这种情况下回退不是"异常"，是常态 —— 必须告诉用户，否则他会以为
   * 「配错了还在用」。
   */
  fallsBack: boolean;
  /** 人话解释，直接显示在界面上 */
  text: string;
};

export function explainRunningState(binding: DeviceBinding | undefined): RunningStateExplanation {
  if (!binding?.deviceId) {
    return {
      key: null,
      source: "none",
      valueKind: "unknown",
      fallsBack: false,
      text: "未绑定设备，运行状态无从判断",
    };
  }

  const statusKey = binding.statusMapping?.telemetryKey;
  if (statusKey) {
    /*
     * statusMapping 是显式配置，优先级最高（与 bindingRunningState 一致）。
     * 它的值可能是枚举也可能是布尔 —— 按键名判断，`sys_run_state` 是枚举。
     */
    const isEnum = statusKey === SYS_RUN_STATE_KEY || /state|code/i.test(statusKey);
    const fallbackMapping = binding.telemetryMappings.find(isRunningMapping);
    return {
      key: statusKey,
      source: "status-mapping",
      valueKind: isEnum ? "enum" : "boolean",
      fallsBack: Boolean(fallbackMapping),
      text: isEnum
        ? `读「${statusKey}」枚举（1 停机 / 5 运行 / 8 故障）`
        : `读「${statusKey}」布尔值`,
    };
  }

  const mapping = binding.telemetryMappings.find(isRunningMapping);
  if (mapping) {
    const key = mapping.telemetryKey || mapping.field;
    return {
      key,
      source: "telemetry-mapping",
      valueKind: key === SYS_RUN_STATE_KEY ? "enum" : "boolean",
      fallsBack: false,
      text:
        key === SYS_RUN_STATE_KEY
          ? `读「${key}」枚举（1 停机 / 5 运行 / 8 故障）`
          : `读「${key}」布尔值（true = 运行）`,
    };
  }

  return {
    key: null,
    source: "none",
    valueKind: "unknown",
    fallsBack: false,
    text: "没有配置运行状态遥测 —— 状态格会显示「未知」",
  };
}

export function bindingRunningState(
  binding: DeviceBinding,
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
): boolean | null {
  const keys = [
    binding.statusMapping?.telemetryKey,
    ...binding.telemetryMappings.filter(isRunningMapping).flatMap((m) => mappingKeys(m)),
  ];
  const row = readLatest(latest, binding.deviceId, keys);
  if (!row) return null;
  /*
   * sys_run_state 必须先按枚举解析：1(停机) / 8(故障) 都是非零，
   * 走 isTruthyState 会得到 true，3D 风扇就会在停机时转。
   */
  if (row.key === SYS_RUN_STATE_KEY) {
    const kind = sysRunStateKind(row.value);
    if (kind === "running") return true;
    if (kind === "offline" || kind === "fault") return false;
    return null; // 初始化/测试：说不清，交给上层显示未知
  }
  return isTruthyState(row.value);
}

function preferredMappings(bindings: DeviceBinding[]): DeviceBinding["telemetryMappings"] {
  const seen = new Set<string>();
  const out: DeviceBinding["telemetryMappings"] = [];
  const list = bindings.flatMap((b) => b.telemetryMappings);
  for (const mapping of list) {
    const id = mapping.field || mapping.telemetryKey || mapping.label;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(mapping);
  }
  return out;
}

/**
 * 设备文档里「状态类」指标：已经由铭牌状态徽标表达，不再占数据行。
 */
const DOC_STATUS_RE = /状态|运行|停机|故障|开关|报警|告警|status|running|runstate|state|online|fault|alarm/i;

/**
 * 设备文档（GLB `hmi.devices[].data`）里定义的数据指标名。
 *
 * <p>铭牌数据行**只能来自设备文档**（2026-11-24 客户要求）。
 * 原来直接用绑定的前 N 个映射，实测模块机的铭牌列出
 * 「运行 / 开度 / 风机状态 / 指示灯」—— 其中「风机状态」「指示灯」
 * 在设备文档里根本没有，于是永远显示「暂无数据」，
 * 现场会当成采集坏了。客户原话：「如果设备文档没有该指标就去掉」。
 */
function docMetricNames(device: HmiDevice): string[] {
  const names: string[] = [];
  for (const item of device.data ?? []) {
    const name = (item.name ?? "").trim();
    if (!name || DOC_STATUS_RE.test(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * 文档指标名 ↔ 绑定映射（label / field / telemetryKey）。
 *
 * <p>文档写「温度」，绑定写「进水温度」—— 必须允许互相包含，
 * 否则一条都匹配不上，铭牌反而变空。包含匹配要求候选至少 2 个字符，
 * 免得「水」「in」这类片段把不相干的映射全捞进来。
 */
function mappingMatchesMetric(
  mapping: DeviceBinding["telemetryMappings"][number],
  name: string,
): boolean {
  const norm = (value?: string) => (value ?? "").replace(/\s+/g, "").toLowerCase();
  const target = norm(name);
  if (!target) return false;
  for (const candidate of [mapping.label, mapping.field, mapping.telemetryKey]) {
    const value = norm(candidate);
    if (!value) continue;
    if (value === target) return true;
    if (value.length >= 2 && (value.includes(target) || target.includes(value))) return true;
  }
  return false;
}

export function buildDevicePlates(args: {
  devices: HmiDevice[];
  bindings: DeviceBinding[];
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
  source?: "live" | "demo";
}): DevicePlate[] {
  const { devices, bindings, latest, source } = args;
  const byNode = new Map<string, DeviceBinding[]>();
  for (const binding of bindings) {
    if (!binding.sceneEntityId) continue;
    const list = byNode.get(binding.sceneEntityId) ?? [];
    list.push(binding);
    byNode.set(binding.sceneEntityId, list);
  }

  const plates: DevicePlate[] = [];
  const seen = new Set<string>();
  for (const device of devices) {
    if (!device.node || seen.has(device.node)) continue;
    const nodeBindings = byNode.get(device.node) ?? [];
    const bound = nodeBindings.some((b) => Boolean(b.deviceId));
    const hasBoard = (device.data?.length ?? 0) > 0;
    const showStartStop = Boolean(device.hasNameplateControls);
    const hasSignals = hasBoard || (device.actions?.length ?? 0) > 0;
    // 三通、弯头、管配件：默认不占铭牌；泵/PLC 只用轻量连接签。
    if (!bound && !hasSignals && !showStartStop) continue;
    seen.add(device.node);
    const title = formatHmiDeviceName(device.name, device.tag);
    const kind: DevicePlate["kind"] = hasBoard || showStartStop ? "board" : "badge";
    const runningStates = kind === "board"
      ? nodeBindings.map((b) => bindingRunningState(b, latest)).filter((v): v is boolean => v !== null)
      : [];
    const running = kind === "board" && runningStates.length ? runningStates.some(Boolean) : null;
    /*
     * 四态状态 + 故障码（2026-11-23）。
     *
     * <p>优先看 `sys_run_state` 枚举（手册 30001）：1=停机、5=运行、8=故障。
     * 没有该键时退回 `running` 布尔：true→running，false→stopped。
     * 两者都没有则 unknown —— 不默认成 running，那会让没上报的设备看着健康。
     */
    let status: PlateStatus = "unknown";
    let faultCode: string | undefined;
    const boundBindings = nodeBindings.filter((b) => Boolean(b.deviceId));
    for (const b of boundBindings) {
      const sysRow = readLatest(latest, b.deviceId, [SYS_RUN_STATE_KEY]);
      if (sysRow) {
        const kindOf = sysRunStateKind(sysRow.value);
        if (kindOf !== "unknown") status = kindOf === "offline" ? "stopped" : kindOf;
      }
      if (!faultCode) {
        const codeRow = readLatest(latest, b.deviceId, FAULT_CODE_KEYS);
        const text = codeRow?.value;
        if (text != null && String(text).trim()) faultCode = String(text).trim();
      }
      if (status !== "unknown" && faultCode) break;
    }
    if (status === "unknown" && running === true) status = "running";
    if (status === "unknown" && running === false) status = "stopped";
    const lines: PlateLine[] = [];
    if (kind === "badge") {
      lines.push({ label: "连接", text: bound ? "已连接" : "未连接", missing: !bound });
    } else if (!bound) {
      lines.push({ label: "连接", text: "未连接", missing: true });
    } else if (hasBoard) {
      /*
       * 数据行以设备文档为准（2026-11-24）：
       * 文档里没有的指标不显示 —— 那是「配置里有、模型上没画」，
       * 不是「采集坏了」，挂在铭牌上只会误导现场。
       * 文档有、绑不上或没上报的指标保留，并如实标「暂无数据」。
       */
      const mappings = preferredMappings(nodeBindings);
      for (const name of docMetricNames(device).slice(0, MAX_LINES)) {
        const mapping = mappings.find((item) => mappingMatchesMetric(item, name));
        const binding = mapping
          ? nodeBindings.find((b) => b.telemetryMappings.includes(mapping)) ?? nodeBindings[0]
          : undefined;
        const row = mapping && binding ? readLatest(latest, binding.deviceId, mappingKeys(mapping)) : undefined;
        const text = formatTelemetryText(row?.value, mapping?.displayType, mapping?.unit);
        lines.push({
          label: mapping?.label || name,
          text: text || "暂无数据",
          missing: !text,
        });
      }
      if (lines.length === 0) {
        lines.push({ label: "数据", text: "暂无数据", missing: true });
      }
    }
    plates.push({ node: device.node, title, bound, source, running, status, faultCode, lines, kind, showStartStop });
  }
  return plates;
}
