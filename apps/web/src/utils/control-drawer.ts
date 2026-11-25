import type { DeviceBinding, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import { FAULT_CODE_KEYS, SYS_RUN_STATE_KEY, bindingRunningState, formatMetricNumber, formatTelemetryText, isStatusMapping, mappingKeys, readLatest, type DevicePlate } from "./device-plates";
import { uniqueEntitiesFromParsed } from "./hmi-entities";

export type DrawerChip = {
  id: string;
  label: string;
  value: string;
  active?: boolean;
};

export type DrawerKpi = {
  id: string;
  label: string;
  value: string;
  dim: boolean;
};

export type ControlDrawerMode = "unselected" | "start-stop" | "no-start-stop";

export type ControlDrawerModel = {
  title: string;
  mode: ControlDrawerMode;
  providesStartStop: boolean;
  startStopNote?: string;
  bound: boolean;
  dataSummary: string;
  chips: DrawerChip[];
  kpis: DrawerKpi[];
  /**
   * 当前设备的**唯一**运行状态（2026-11-23 客户要求）。
   *
   * <h3>为什么单独一个字段，而不是继续用 chips</h3>
   *
   * <p>客户原话：「启停按钮下面运行状态就是属于那个状态那个亮就行了」。
   *
   * <p>原来 `chips` 会同时给出「运行 / 停止」两枚标签（各自带计数），
   * 一台设备时就是「运行 1」「停止 0」并排 —— 两个都在亮，
   * 用户读不出「现在到底是哪个」。
   *
   * <p>现在给单一状态：五态之一（运行/停止/故障/离线/未知），
   * 界面上只点亮这一格。
   */
  status: {
    /** 状态标识，与 `device-plates` 的 `PlateStatus` 同源 */
    kind: "running" | "stopped" | "fault" | "offline" | "unknown";
    /** 显示文案（`运行` / `停机` / `故障` / `离线` / `未知`） */
    label: string;
    /** 故障码（有就带上，`TH702`） */
    faultCode?: string;
  };
};

export type DrawerControlContent = "none" | "start-stop" | "no-start-stop";

/** 未选中时不画出启动/停止键（包括禁用态）；失焦后抽屉只留细提手。 */
export function drawerControlContent(mode: ControlDrawerMode): DrawerControlContent {
  if (mode === "start-stop") return "start-stop";
  if (mode === "no-start-stop") return "no-start-stop";
  return "none";
}

export const DRAWER_COPY = {
  unselected: "未选中设备",
  unbound: "未绑定",
  bound: "已绑定",
  noStartStop: "该对象没有控制面板和屏幕，不提供启停",
  emptyChip: "—",
} as const;

function displayNameFor(hmi: ParsedHmiScene | null | undefined, node?: string | null): string {
  if (!hmi || !node) return DRAWER_COPY.unselected;
  const hit = uniqueEntitiesFromParsed(hmi).find((item) => item.node === node);
  return hit?.name || node;
}

function statusLabelOf(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  if (/故障|fault/.test(raw)) return "故障";
  if (/报警|告警|alarm/.test(raw)) return "报警";
  if (/检修|maintain|service/.test(raw)) return "检修";
  if (/备用|standby/.test(raw)) return "备用";
  if (/运行|running/.test(raw)) return "运行";
  if (/停止|stop|stopped/.test(raw)) return "停止";
  return null;
}

function collectChips(
  bindings: DeviceBinding[],
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
): DrawerChip[] {
  const chips = new Map<string, DrawerChip>();
  const bump = (id: string, label: string, active: boolean) => {
    const prev = chips.get(id);
    if (prev) {
      const count = Number(prev.value);
      chips.set(id, { ...prev, value: String((Number.isFinite(count) ? count : 0) + (active ? 1 : 0)), active: prev.active || active });
      return;
    }
    chips.set(id, { id, label, value: active ? "1" : "0", active });
  };

  for (const binding of bindings) {
    if (!binding.deviceId) continue;
    const running = bindingRunningState(binding, latest);
    if (running === true) bump("running", "运行", true);
    if (running === false) bump("stopped", "停止", true);
    for (const mapping of binding.telemetryMappings) {
      const kind = statusLabelOf(`${mapping.label} ${mapping.field} ${mapping.telemetryKey}`);
      if (!kind || kind === "运行" || kind === "停止") continue;
      const row = readLatest(latest, binding.deviceId, mappingKeys(mapping));
      const active = Boolean(row && formatTelemetryText(row.value, mapping.displayType));
      bump(kind, kind, active);
    }
  }
  return [...chips.values()];
}

function consumptionText(
  bindings: DeviceBinding[],
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
): string | null {
  let total = 0;
  let unit = "";
  let hit = 0;
  for (const binding of bindings) {
    if (!binding.deviceId) continue;
    for (const mapping of binding.telemetryMappings) {
      const text = `${mapping.label} ${mapping.field} ${mapping.telemetryKey} ${mapping.unit ?? ""}`.toLowerCase();
      if (!/功率|消耗|power|kw/.test(text)) continue;
      const row = readLatest(latest, binding.deviceId, mappingKeys(mapping));
      const num = typeof row?.value === "number" ? row.value : Number(row?.value);
      if (!Number.isFinite(num)) continue;
      total += num;
      hit += 1;
      unit = mapping.unit || unit || "kW";
    }
  }
  if (!hit) return null;
  /* 与卡片走同一套精度规则（2026-11-23），否则抽屉里 119.9 会变成 120。 */
  const body = formatMetricNumber(total);
  return unit ? `${body} ${unit}` : body;
}

/**
 * 选中设备自己的业务维度 KPI（2026-11-23）。
 *
 * <h2>为什么要重写</h2>
 *
 * <p>原来的四格是「运行设备 / 设备总数 / 系统告警 / 总消耗量」——
 * **全部是全场统计**。客户点一下 1# 机组，抽屉却告诉他
 * 「全场 9 台里有 5 台在运行、全场总功率多少」，
 * 跟他点的那台毫无关系。客户原话：「肯定不合理」。
 *
 * <p>还有一处概念错误：「总消耗量」是把各设备的 `power`（瞬时功率，kW）
 * 相加，却叫「消耗量」。功率相加不等于用电量，差一个时间积分 ——
 * 现场会拿它去对电表，然后发现对不上。
 *
 * <h2>现在给什么</h2>
 *
 * <ol>
 *   <li><b>运行状态</b>：四态 + 故障码（手册 30001），与人眼看 3D 同一口径；</li>
 *   <li><b>该设备自己的遥测</b>（最多 3 项）：出水温度、进水温度、功率…，
 *       只取该设备绑定上真实存在的；</li>
 *   <li><b>功率排名</b>：该机在同组设备里排第几 —— 这是运维真正关心的问题
 *       （「这台是不是在拖后腿」），而它必须跨设备算，所以在最后补一格。</li>
 * </ol>
 *
 * <h2>为什么不在这里做过时/超范围告警判定</h2>
 *
 * <p>那是 `metric-diagnosis` 的职责（需要异步拉字典）。
 * 抽屉是**快速扫一眼**的场景，把判据搬进来会让这里多一个异步负载。
 * 需要判读时点开设备专题卡，那里有完整的手册依据。
 */
function selectedDeviceKpis(args: {
  bindings: DeviceBinding[];
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
  plate?: DevicePlate;
  allBindings: DeviceBinding[];
}): DrawerKpi[] {
  const { bindings, latest, plate, allBindings } = args;
  if (!bindings.length) return [];

  const out: DrawerKpi[] = [];

  /* ① 运行状态：优先用铭牌已算好的四态（与列表、 3D 同源） */
  const statusText =
    plate?.status === "fault" ? (plate.faultCode ? `故障 ${plate.faultCode}` : "故障")
    : plate?.status === "running" ? "运行"
    : plate?.status === "stopped" ? "停止"
    : plate?.status === "offline" ? "离线"
    : "未知";
  out.push({ id: "status", label: "运行状态", value: statusText, dim: !plate || plate.status === "unknown" });

  /*
   * ② 该设备自己的遥测。
   *
   * <p>剔除两类：
   *   · `sys_run_state` 与故障码键 —— 已在第一格说过了，否则会重复显示
   *     「运行状态 运行」和「状态 5」两行，而后者是原始寄存器值；
   *   · **运行状态类映射**（`running` / 「运行状态」等）—— 同理，
   *     第一格已经是四态。「运行状态 故障」和「运行 停止」并排，
   *     同一件事说两遍，还把有限的 4 格占满：实测功率因此被截掉
   *     （2026-11-24 客户要求看功率，而它排在第 5 项）。
   */
  const skip = new Set([SYS_RUN_STATE_KEY, ...FAULT_CODE_KEYS]);
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (!binding.deviceId) continue;
    for (const mapping of binding.telemetryMappings) {
      const keys = mappingKeys(mapping);
      if (keys.some((k) => skip.has(k))) continue;
      if (isStatusMapping(mapping)) continue;
      const label = mapping.label || mapping.field || mapping.telemetryKey || "";
      if (!label || seen.has(label)) continue;
      const row = readLatest(latest, binding.deviceId, keys);
      if (!row) continue;
      const text = formatTelemetryText(row.value, mapping.displayType, mapping.unit);
      if (!text) continue;
      seen.add(label);
      out.push({
        id: `metric-${label}`,
        label,
        value: mapping.unit && !text.includes(mapping.unit) ? `${text} ${mapping.unit}` : text,
        dim: false,
      });
      /* 加上状态格，最多 4 格 —— 再多抽屉里会挤成两行看不完 */
      if (out.length >= 4) return out;
    }
  }

  /*
   * ③ 功率排名（业务维度）。
   *
   * <p>「这台机组有没有在出力」光看自己的功率回答不了 ——
   * 得知道它在 9 台里算高还是算低。所以才要跨设备算。
   * 同值时并列（不算谁高谁低），避免排名在抖动中反复变化。
   */
  const ranking = powerRanking(allBindings, latest, bindings[0]?.deviceId);
  if (ranking) {
    out.push({
      id: "rank",
      label: "功率排名",
      value: `第 ${ranking.rank} / ${ranking.total}`,
      dim: false,
    });
  }
  return out;
}

/** 当前设备在「有功率读数的同组设备」里排第几（降序，同值并列）。 */
function powerRanking(
  bindings: DeviceBinding[],
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>,
  deviceId?: string,
): { rank: number; total: number } | null {
  if (!deviceId) return null;
  const rows: Array<{ deviceId: string; power: number }> = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (!binding.deviceId || seen.has(binding.deviceId)) continue;
    const mapping = binding.telemetryMappings.find((m) => /power|功率/i.test(`${m.label} ${m.field} ${m.telemetryKey}`));
    if (!mapping) continue;
    const row = readLatest(latest, binding.deviceId, mappingKeys(mapping));
    const num = typeof row?.value === "number" ? row.value : Number(row?.value);
    if (!Number.isFinite(num)) continue;
    seen.add(binding.deviceId);
    rows.push({ deviceId: binding.deviceId, power: num });
  }
  const self = rows.find((row) => row.deviceId === deviceId);
  if (!self || rows.length < 2) return null;
  /* 严格大于它的人数 + 1 = 名次（同值并列） */
  const rank = rows.filter((row) => row.power > self.power).length + 1;
  return { rank, total: rows.length };
}

export function buildControlDrawerModel(args: {
  hmi: ParsedHmiScene | null | undefined;
  selectedNode?: string | null;
  plates?: DevicePlate[];
  bindings: DeviceBinding[];
  latest: Map<string, TelemetryRecord> | Record<string, TelemetryRecord>;
  alarmCount?: number | null;
}): ControlDrawerModel {
  const { hmi, selectedNode, plates = [], bindings, latest, alarmCount } = args;
  const selectedPlate = plates.find((plate) => plate.node === selectedNode);
  const selectedBindings = selectedNode
    ? bindings.filter((item) => item.sceneEntityId === selectedNode || item.sceneEntityId === selectedPlate?.node)
    : [];
  const providesStartStop = Boolean(
    hmi?.devices.find((item) => item.node === selectedNode)?.hasNameplateControls,
  );
  const bound = selectedPlate ? selectedPlate.bound : selectedBindings.some((item) => Boolean(item.deviceId));
  const dataSummary = !selectedNode
    ? DRAWER_COPY.unbound
    : bound
      ? selectedPlate?.lines.filter((line) => !line.missing).slice(0, 2).map((line) => `${line.label} ${line.text}`).join(" · ") || DRAWER_COPY.bound
      : DRAWER_COPY.unbound;

  /*
   * 单一运行状态（2026-11-23）。
   *
   * <p>直接复用铭牌已经算好的 `selectedPlate.status` —— 它与列表圆点、
   * 3D 染色同源（`buildDevicePlates` → `sysRunStateKind`）。
   * 在抽屉里另算一遍会出现「列表说运行、抽屉说停止」。
   *
   * <p>`chips` 仍然保留（它承载的是别的维度：故障/报警等计数），
   * 但「运行 / 停止」这一对会从 chips 里剔掉，避免与这一格重复。
   */
  const statusKind = selectedPlate?.status ?? "unknown";
  const statusLabel =
    statusKind === "running" ? "运行"
    : statusKind === "stopped" ? "停机"
    : statusKind === "fault" ? "故障"
    : statusKind === "offline" ? "离线"
    : "未知";
  const status = {
    kind: statusKind,
    label: statusLabel,
    ...(selectedPlate?.faultCode ? { faultCode: selectedPlate.faultCode } : {}),
  } as ControlDrawerModel["status"];

  const chips = collectChips(selectedBindings, latest).filter(
    /* 运行/停止已由上面这一格单独表达，chips 里再有就是重复 */
    (chip) => chip.id !== "running" && chip.id !== "stopped",
  );
  /*
   * 全场维度的兜底数字。
   *
   * <p>注意 `chips` 现在只收**选中设备**的绑定（原来传的是全部 bindings，
   * 那是「全场有几台在跑」—— 与用户点的那台无关）。
   * 而下面这个 `running` 是**全场**运行台数，只在未选中设备时用，
   * 两个变量名字像但口径不同，所以单独取。
   */
  const allChips = collectChips(bindings, latest);
  const running = allChips.find((chip) => chip.id === "running");
  const deviceTotal = hmi?.devices.length ?? 0;
  const consumption = consumptionText(bindings, latest);
  const alarmValue = typeof alarmCount === "number" ? String(alarmCount) : null;

  const mode: ControlDrawerMode = !selectedNode ? "unselected" : providesStartStop ? "start-stop" : "no-start-stop";
  /*
   * 选中设备时给**它自己**的维度；未选中时才退回全场概览。
   *
   * <p>用 `selectedDeviceKpis(...).length` 判断而不是只看 selectedNode：
   * 选中了一个没绑设备的对象（阀门、管件）时，前者是空数组，
   * 这时显示「全场概览」比显示四格「—」有用。
   */
  const deviceKpis = selectedDeviceKpis({ bindings: selectedBindings, latest, plate: selectedPlate, allBindings: bindings });
  return {
    title: displayNameFor(hmi, selectedNode),
    mode,
    providesStartStop,
    startStopNote: mode === "no-start-stop" ? DRAWER_COPY.noStartStop : undefined,
    bound,
    dataSummary,
    chips,
    status,
    kpis: deviceKpis.length
      ? deviceKpis
      : [
          { id: "running", label: "运行设备", value: running?.value ?? "—", dim: !running },
          { id: "total", label: "设备总数", value: deviceTotal ? String(deviceTotal) : "—", dim: !deviceTotal },
          { id: "alarms", label: "系统告警", value: alarmValue ?? "—", dim: alarmValue == null },
          { id: "consumption", label: "总功率", value: consumption ?? "—", dim: !consumption },
        ],
  };
}
