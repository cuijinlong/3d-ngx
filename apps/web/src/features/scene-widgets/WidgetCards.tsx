
import ReactECharts from "echarts-for-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { Device, DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import { ngxHudTokens } from "@idt/config";
import type { SceneWidget } from "@idt/data-adapter";
import { useScopedHistory } from "../../hooks/useScopedHistory";
import { useAppTheme } from "../../theme/AppThemeProvider";
import { useHudSkin } from "../../theme/HudSkin";
import type { TelemetryPoint } from "../../stores/telemetry.store";
import { useDeviceHistory } from "../../hooks/useDeviceHistory";
import { useMetricDiagnoses } from "../../hooks/useMetricDiagnoses";
import { inferWorkingMode, judgeMetric } from "@idt/data-adapter";
import type { MetricDiagnosisMap } from "@idt/data-adapter";
import { formatMetricNumber, formatTelemetryText } from "../../utils/device-plates";
import {
  WIDGET_UNBOUND_MESSAGE,
  buildTrendSeries,
  describePendingSlot,
  metricSlotKey,
  readMetricBreakdown,
  readScopedAggregate,
  readGaugeRings,
  readRatioRingGroups,
  type AssetAttributeLookup,
  selectionBindings,
  listScopedDevices,
  summarizeScopedDevices,
  widgetScopeDeviceIds,
  type RatioRingGroup,
  type GaugeRing,
  type SlotReading,
} from "./widget-values";
import styles from "./WidgetOverlay.module.css";
import { displayNameOf } from "../../utils/display-name";
import { DeviceCommandList } from "./DeviceCommandList";

function Empty({ children }: { children?: string }) {
  return <div className={styles.empty}>{children || WIDGET_UNBOUND_MESSAGE}</div>;
}

function readingReady(reading?: SlotReading | null): reading is SlotReading & { bound: true } {
  return Boolean(reading?.bound && !reading.missing);
}

/**
 * 遥测值 → 有限数字（2026-11-23）。
 *
 * <p>`TelemetryRecord.value` 是 `number | string | boolean`。
 * 拿它直接比范围会出两类错：字符串参与比较时是字典序
 * （`"10" < "9"` 为真），布尔值会被当成 0/1。
 * 所以只接受能真正转成有限数字的，其余一律 null（= 不判）。
 */
function toNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    /* 空串会被 Number() 当成 0，必须挡掉 */
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  /* 布尔值不当作 0/1：那会让「运行=1」这种状态位意外参与温度判读 */
  return null;
}

function HalfRing({ ratio, tone }: { ratio: number; tone: "accent" | "gold" }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = 16;
  const c = Math.PI * r;
  return (
    <svg className={styles.halfRing} viewBox="0 0 40 24" aria-hidden>
      <path
        d="M4 20 A16 16 0 0 1 36 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className={styles.ringTrack}
      />
      <path
        d="M4 20 A16 16 0 0 1 36 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        className={tone === "gold" ? styles.ringGold : styles.ringAccent}
        strokeDasharray={`${clamped * c} ${c}`}
      />
    </svg>
  );
}

export function MetricCardBody({
  widget,
  bindings,
  latest,
  devices,
  assetAttrs,
  assetError,
  scopeDeviceIds,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  assetAttrs?: AssetAttributeLookup;
  assetError?: "forbidden" | "unreachable";
  scopeDeviceIds?: Record<string, string[]>;
}) {
  const slots = widget.slots ?? [];
  if (!slots.length) return <Empty />;
  const breakdown = readMetricBreakdown(widget, bindings, latest, devices, assetAttrs, assetError);
  /*
   * 范围聚合槽（2026-11-23）。
   *
   * <p>槽位配了 `aggregate` 时不走 `readSlotValue` —— 后者要求具体 deviceId。
   * 聚合槽的语义就是「范围内所有设备求个和」，设备来自 scope。
   *
   * <p>覆盖而不是并存：同一个槽位要么是单设备读数，要么是聚合值，不该两者都有。
   */
  for (const slot of slots) {
    if (!slot.aggregate) continue;
    const key = metricSlotKey(slot, slots.indexOf(slot));
    const ids = widgetScopeDeviceIds(widget, scopeDeviceIds) ?? [];
    /*
     * 必须应用 filterText（2026-11-23）。
     *
     * <p>scope 指向场景拓扑，包含 1 资产 + 14 设备（9 台模块机 + 2 台泵 +
     * 2 个 PLC 柜 + 网关）。直接对 14 台求和会把泵的功率也算进去 ——
     * 那就不再是「9 台机组之和」，而是混了口径的数字，比空着更糟。
     *
     * <p>复用 `listScopedDevices` + `filterRowsByName`，和 device-list 的
     * 过滤规则保持一致：两处口径不同的话，同一屏上的数字会互相矛盾。
     */
    const filteredIds = filterRowsByName(
      listScopedDevices(ids, latest, bindings, devices, [], [slot]),
      widget.filterText,
    ).map((row) => row.deviceId);
    const aggregated = readScopedAggregate(slot, filteredIds, latest);
    if (aggregated) breakdown[key] = aggregated;
  }
  if (!breakdown.main?.bound && !breakdown.left?.bound && !breakdown.right?.bound) return <Empty />;
  if (!readingReady(breakdown.main)) {
    /*
     * 没数时说清「在等什么」（2026-11-23）。
     *
     * <p>只写「暂无数据」，用户知道没数但不知道缺哪个点、哪台设备、停了多久
     * —— 而那三件事决定了要不要打电话给现场。
     */
    if (breakdown.main?.bound) {
      return (
        <div className={styles.pendingBlock}>
          <div className={styles.pendingTitle}>暂无数据</div>
          <div className={styles.pendingDetail}>
            {describePendingSlot(widget, "main", bindings, latest, devices)}
          </div>
        </div>
      );
    }
    return <Empty>{WIDGET_UNBOUND_MESSAGE}</Empty>;
  }
  const sides = [breakdown.left, breakdown.right].filter(readingReady);
  const maxSide = Math.max(1, ...sides.map((item) => item.numeric ?? 0), breakdown.main.numeric ?? 0);
  return (
    <div className={styles.metricLayout}>
      {breakdown.left ? (
        <div className={styles.metricSide}>
          {readingReady(breakdown.left) && breakdown.left.numeric != null ? (
            <HalfRing ratio={(breakdown.left.numeric ?? 0) / maxSide} tone="accent" />
          ) : null}
          <span className={styles.metricSideLabel}>{breakdown.left.label || "左"}</span>
          {/*
           * 侧边也要带单位（2026-11-23）。
           * 装机参数卡是「制热量 710 / 制冷量 715 kW / 压缩机 224.3」——
           * 只有中间那个带 kW，两侧光秃秃的数字看不出量纲：
           * 710 是 kW 还是 W？224.3 是功率还是电流？
           */}
          <strong>
            {readingReady(breakdown.left)
              ? `${breakdown.left.text}${breakdown.left.unit || ""}`
              : "—"}
          </strong>
        </div>
      ) : <span />}
      <div className={styles.metricMain}>
        {/*
         * 主值也要有标签（2026-11-23）。
         * 装机参数卡的中间是 715 kW —— 左右都有「制热量 / 压缩机」，
         * 唯独中间不知道是什么。参考模板每个数字都有上下文小字。
         */}
        {breakdown.main.label ? (
          <span className={styles.metricMainLabel}>{breakdown.main.label}</span>
        ) : null}
        <div className={styles.metricValue}>
          <span>{breakdown.main.text}</span>
          {breakdown.main.unit ? <small className={styles.metricUnit}>{breakdown.main.unit}</small> : null}
        </div>
      </div>
      {breakdown.right ? (
        <div className={`${styles.metricSide} ${styles.metricSideRight}`}>
          {readingReady(breakdown.right) && breakdown.right.numeric != null ? (
            <HalfRing ratio={(breakdown.right.numeric ?? 0) / maxSide} tone="gold" />
          ) : null}
          <span className={styles.metricSideLabel}>{breakdown.right.label || "右"}</span>
          <strong>
            {readingReady(breakdown.right)
              ? `${breakdown.right.text}${breakdown.right.unit || ""}`
              : "—"}
          </strong>
        </div>
      ) : <span />}
    </div>
  );
}

function RatioRing({ group }: { group: RatioRingGroup }) {
  const ratio = group.ratio ?? 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className={styles.ratioItem}>
      <div className={styles.ratioDial}>
        <svg viewBox="0 0 56 56" aria-hidden>
          <circle cx="28" cy="28" r={r} fill="none" strokeWidth="5" className={styles.ringTrack} />
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            className={styles.ringAccent}
            strokeDasharray={`${ratio * c} ${c}`}
            transform="rotate(-90 28 28)"
          />
        </svg>
        <div className={styles.ratioValue}>
          <b>{group.usedValue}</b>
          <small>/{group.totalValue}</small>
        </div>
      </div>
      <div className={styles.ratioLabel}>{group.label}</div>
    </div>
  );
}

export function RatioRingCardBody({
  widget,
  bindings,
  latest,
  devices,
  scopeDeviceIds,
  assetAttrs,
  assetError,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  scopeDeviceIds?: Record<string, string[]>;
  assetAttrs?: AssetAttributeLookup;
  assetError?: "forbidden" | "unreachable";
}) {
  const groups = readRatioRingGroups(widget, bindings, latest, devices, scopeDeviceIds, assetAttrs, assetError);
  if (!groups.length || groups.every((group) => !group.resolved && !group.used?.bound && !group.total?.bound)) return <Empty />;
  const resolved = groups.filter((group) => group.resolved);
  if (!resolved.length) return <Empty>暂无数据</Empty>;
  const usedSum = resolved.reduce((sum, group) => sum + (group.usedValue ?? 0), 0);
  const totalSum = resolved.reduce((sum, group) => sum + (group.totalValue ?? 0), 0);
  return (
    <div className={styles.ratioLayout}>
      <div className={styles.ratioRow}>
        {resolved.map((group) => <RatioRing key={group.index} group={group} />)}
      </div>
      {totalSum > 0 ? (
        <div className={styles.segmentBar} aria-hidden>
          {resolved.map((group) => (
            <span
              key={group.index}
              className={styles.segment}
              style={{ width: `${Math.max(4, ((group.usedValue ?? 0) / totalSum) * 100)}%` }}
            />
          ))}
        </div>
      ) : null}
      {totalSum > 0 ? (
        <div className={styles.segmentMeta}>
          <span>使用率 {Math.round((usedSum / totalSum) * 100)}%</span>
          <span>已使用 {usedSum}</span>
          <span>可使用 {Math.max(0, totalSum - usedSum)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 环形仪表（2026-11-23）。
 *
 * <h2>它回答什么问题</h2>
 *
 * <p>「这台机组现在出多少力？」—— 一个数字（62%）看不出余量，
 * 一个环看得出「快到顶了」还是「刚起来」。参考效果图里
 * 「人车通行 / 出租状态」用的就是这种表达。
 *
 * <h2>为什么不做成 ratio-ring 的样式开关</h2>
 *
 * <p>ratio-ring 语义是「已用/总数」（两边都该绑真实测点），
 * gauge-ring 是「当前值/量程」（量程常是设计常量 100%）。
 * 两者「缺分母怎么办」的答案相反：前者报未绑定，后者默认满量程。
 * 类型分开，配置面板和 AI 生成才不会搞混「这块要不要绑 total」。
 */
export function GaugeRingCardBody({
  widget,
  bindings,
  latest,
  devices,
  scopeDeviceIds,
  assetAttrs,
  assetError,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  scopeDeviceIds?: Record<string, string[]>;
  assetAttrs?: AssetAttributeLookup;
  assetError?: "forbidden" | "unreachable";
}) {
  const rings = readGaugeRings(widget, bindings, latest, devices, scopeDeviceIds, assetAttrs, assetError);
  if (!rings.length) return <Empty />;
  const resolved = rings.filter((ring) => ring.resolved);
  if (!resolved.length) {
    /*
     * 一条都没成：说清卡在哪，不要只给「暂无数据」。
     * 「没绑定」和「绑了但量程没上报」处置完全不同 —— 一个去配绑定，一个去查设备。
     */
    const unbound = rings.every((ring) => !ring.value?.bound);
    return <Empty>{unbound ? undefined : "值或量程未上报"}</Empty>;
  }
  return (
    <div className={styles.gaugeLayout} data-testid="gauge-rings">
      {resolved.map((ring) => (
        <GaugeRingDial key={ring.index} ring={ring} />
      ))}
    </div>
  );
}

/** 环形仪表的单个盘。 */
function GaugeRingDial({ ring }: { ring: GaugeRing }) {
  /*
   * 渐变要挂 id，而同一屏可能有两三个仪表 —— 写死 id 会让后挂的实例
   * 引用到别人的渐变（SVG 按 id 全局查找，第一个赢）。
   * useId 由 React 保证同树内唯一，也是并发安全的。
   */
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ratio = ring.ratio ?? 0;

  /* 几何：120×120 画布，环半径 50，线宽 9 —— 粗环才像仪表，细环像 loading */
  const SIZE = 120;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = 50;
  const STROKE = 9;
  const circumference = 2 * Math.PI * R;
  /* 起点在 12 点方向，顺时针增长（rotate -90 实现） */
  const sweep = ratio * circumference;

  /* 环尾光点坐标：角度 = -90° + ratio×360° */
  const angle = -Math.PI / 2 + ratio * 2 * Math.PI;
  const dotX = CX + R * Math.cos(angle);
  const dotY = CY + R * Math.sin(angle);

  /* 12 个刻度，每 30° —— 参考图靠它把「圆环」变成「仪表」 */
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const inner = R - STROKE / 2 - 3;
    const outer = R - STROKE / 2 - 1;
    return {
      key: i,
      x1: CX + inner * Math.cos(a),
      y1: CY + inner * Math.sin(a),
      x2: CX + outer * Math.cos(a),
      y2: CY + outer * Math.sin(a),
      major: i % 3 === 0,
    };
  });

  const unit = ring.value?.unit ?? ring.max?.unit ?? "";
  const valueText = ring.value?.text ?? "";
  /*
   * 满量程的文字形式。`default` 来源要能看出来 —— 用户看到「/100」
   * 需要知道那是系统默认还是自己配的，否则改模板时找不到出处。
   */
  const maxText = ring.maxNum != null ? formatMetricNumber(ring.maxNum) : "";

  return (
    <div className={styles.gaugeItem} data-testid="gauge-ring">
      <div className={styles.gaugeDialWrap}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={styles.gaugeSvg} aria-hidden>
          <defs>
            {/*
             * 渐变沿环流动的方向不重要（环是圆的），用对角渐变即可 ——
             * 关键是两端色差要明显，否则远看还是一条单色细线。
             */}
            <linearGradient id={`gauge-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--ngx-hud-accent, #2ec7f0)" />
              <stop offset="55%" stopColor="var(--ngx-hud-corner, #5ce0ff)" />
              <stop offset="100%" stopColor="#a8f0ff" />
            </linearGradient>
          </defs>
          {/* 底轨 */}
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            className={styles.gaugeTrack}
          />
          {/* 刻度 */}
          <g className={styles.gaugeTicks}>
            {ticks.map((tick) => (
              <line
                key={tick.key}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                className={tick.major ? styles.gaugeTickMajor : styles.gaugeTick}
              />
            ))}
          </g>
          {/* 进度弧 */}
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            stroke={`url(#gauge-${uid})`}
            strokeDasharray={`${sweep} ${circumference}`}
            transform={`rotate(-90 ${CX} ${CY})`}
            className={styles.gaugeProgress}
          />
          {/*
           * 环尾光点：只在有进度时画。
           * ratio=0 时它会落在 12 点方向，和「完全空」的视觉冲突
           * （看起来像有一个很小的值）。
           */}
          {ratio > 0.005 ? (
            <circle cx={dotX} cy={dotY} r={STROKE / 2 + 1.5} className={styles.gaugeDot} />
          ) : null}
        </svg>
        <div className={styles.gaugeCenter}>
          <b>{valueText}</b>
          {unit ? <small>{unit}</small> : null}
          {/*
           * 量程写在中心下方而不是环外：环外要留给标签，
           * 而「/100」离开数字就失去意义（用户会以为是独立读数）。
           */}
          {maxText ? (
            <i className={styles.gaugeMax} data-origin={ring.maxOrigin}>
              / {maxText}
            </i>
          ) : null}
        </div>
      </div>
      <div className={styles.gaugeLabel}>{ring.label}</div>
    </div>
  );
}

export function SummaryCardBody({
  widget,
  bindings,
  latest,
  devices,
  scopeDeviceIds,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  scopeDeviceIds?: Record<string, string[]>;
}) {
  const scoped = widgetScopeDeviceIds(widget, scopeDeviceIds);
  /*
   * summary 也要按 filterText 收窄，否则「运行汇总」会把网管/泵/PLC 一起算进去，
   * 与左翼只列 9 台的列表对不上 —— 两块卡片数字互相矛盾比数字不刷新更糟。
   */
  const ids = filterIdsByName(scoped, widget.filterText, bindings, devices);
  const summary = summarizeScopedDevices(ids, latest, bindings, devices);
  if (!ids || !summary.boundCount) return <Empty />;
  const statusKnown = summary.runningCount + summary.offlineCount + summary.faultCount > 0;
  /* 在线 = 运行 + 故障（故障机仍能通信）。离线/未知不算在线。 */
  const onlineCount = summary.runningCount + summary.faultCount;
  return (
    <div className={styles.summaryLayout}>
      <div className={styles.summaryTotal}>
        <span>
          设备总数
          {/*
           * 「未知」放在总数旁边，不占一格（2026-11-23）。
           *
           * 为什么不单独一格：卡片按模板收到 11.35%（219px）后，
           * 4 格无论是 4 列还是 2×2 都放不下（实测 2×2 第二行被高度裁掉）。
           * 而「未知」的语义本来就是「其余 n 台没状态」—— 跟总数并排更贴切，
           * 而且永远不会被裁。模板的 device-split 也正好是 3 列。
           */}
          {summary.unknownCount > 0 ? (
            <em className={styles.summaryUnknown}>（{summary.unknownCount} 台未知）</em>
          ) : null}
        </span>
        <b>{summary.boundCount}</b>
      </div>
      {statusKnown ? (
        <>
        <div className={styles.summaryStatuses}>
          <div className={styles.statusTile}><span>运行</span><b className={styles.statusRun}>{summary.runningCount}</b></div>
          <div className={styles.statusTile}><span>离线</span><b className={styles.statusOff}>{summary.offlineCount}</b></div>
          <div className={styles.statusTile}><span>故障</span><b className={styles.statusFault}>{summary.faultCount}</b></div>
        </div>
        {/*
         * 在线率（2026-11-23）：对齐模板「设备设施」的「设备在线率 96.8%」。
         * 故障机仍能通信，算在线；离线与未知算不在线 —— 与上面三格自洽。
         */}
        <div className={styles.summaryRate}>
          <div className={styles.summaryRateHead}>
            <span>在线率</span>
            <b>{Math.round((onlineCount / summary.boundCount) * 100)}%</b>
          </div>
          <div className={styles.summaryRateTrack}>
            <div
              className={styles.summaryRateFill}
              style={{ width: `${Math.round((onlineCount / summary.boundCount) * 100)}%` }}
            />
          </div>
        </div>
        </>
      ) : (
        <div className={styles.muted}>运行状态暂无数据</div>
      )}
    </div>
  );
}

/**
 * 迷你趋势线（2026-11-23）。
 *
 * <h2>为什么用 SVG 而不是 ECharts</h2>
 *
 * <p>这块卡的可用区只有约 190px × 50px。ECharts 单实例初始化 + 布局
 * 的固定开销在这个尺寸上完全不成比例，而且一屏可能有几十个这样的
 * 小图（未来设备列表每行一个）。纯 SVG polyline 是几十行、零依赖、
 * 随渲染直接出图。
 *
 * <h2>为什么要画最小/最大标记</h2>
 *
 * <p>客户要「最高最低的数据可视化」。sparkline 本身看不出极值在哪，
 * 而「今天最高多少度」是运维判断负载的直接依据。用两个小圆点标出来，
 * 比在图外写一行字更容易对上位置。
 */
function Sparkline({
  points,
  tone = "accent",
}: {
  points: Array<{ ts: number; value: number }>;
  /** 只影响颜色；单位由调用方的文字行显示，图内不重复 */
  tone?: "accent" | "gold";
}) {
  if (!points.length) {
    return <div className={styles.sparkEmpty}>无历史</div>;
  }
  const W = 100;
  const H = 28;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  /* 全程恒定值时给一条居中的水平线，不要除以 0 */
  const span = max - min || 1;
  const t0 = points[0]!.ts;
  const t1 = points[points.length - 1]!.ts || t0 + 1;
  const x = (ts: number) => ((ts - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => H - 2 - ((v - min) / span) * (H - 4);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const color = tone === "gold" ? "#e6a23c" : "currentColor";
  const maxPoint = points.reduce((a, b) => (b.value > a.value ? b : a));
  const minPoint = points.reduce((a, b) => (b.value < a.value ? b : a));

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ color: tone === "gold" ? "#e6a23c" : undefined }}
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
      {/* 极值点：只在数值真的变化过时标，全程恒定标两个点会重叠 */}
      {max > min ? (
        <>
          <circle cx={x(maxPoint.ts)} cy={y(maxPoint.value)} r="1.6" fill="#e6a23c" vectorEffect="non-scaling-stroke" />
          <circle cx={x(minPoint.ts)} cy={y(minPoint.value)} r="1.6" fill="#5b8ff9" vectorEffect="non-scaling-stroke" />
        </>
      ) : null}
    </svg>
  );
}

export function SelectionCardBody(props: {
  selectedNode?: string | null;
  selectedEntityId?: string | null;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
}) {
  /*
   * 设备专题的历史曲线（2026-11-23）。
   *
   * <p>hook 必须在**组件顶层无条件调用** —— 不能写在
   * `if (!selectedNode) return ...` 之后，否则 React 的 hook 顺序会随
   * 选中/未选中变化，直接抛 "Rendered fewer hooks than expected"。
   *
   * <p>`useDeviceHistory` 内部对空 deviceId 直接返回空状态、不发请求，
   * 所以未选中时零开销。
   */
  const list = selectionBindings([props.selectedNode, props.selectedEntityId], props.bindings, props.devices);
  const primaryId = list[0]?.deviceId ?? null;
  const history = useDeviceHistory(primaryId, ["power", "temperature"], Boolean(primaryId));
  /*
   * 指标诊断依据（2026-11-23）。
   *
   * <p>同样必须在组件顶层无条件调用 —— `useDeviceHistory` 那里已经踩过一次
   * 「hook 在 early return 之后」的坑。未选中时传 false，零请求。
   */
  const diagnoses = useMetricDiagnoses(Boolean(primaryId));
  return <SelectionCardInner {...props} history={history} diagnoses={diagnoses.byKey} />;
}

function SelectionCardInner({
  selectedNode,
  selectedEntityId,
  bindings,
  latest,
  devices,
  history,
  diagnoses,
}: {
  selectedNode?: string | null;
  selectedEntityId?: string | null;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  history: ReturnType<typeof useDeviceHistory>;
  diagnoses: MetricDiagnosisMap | null;
}) {
  const list = selectionBindings([selectedNode, selectedEntityId], bindings, devices);
  /* inner 也要算一次：这里用于趋势的 key 拼装（外层那份只喂 hook） */
  const primaryId = list[0]?.deviceId;
  if (!selectedNode && !selectedEntityId) {
    /*
     * 空态给**可操作**的引导，不是「未选中对象」这种陈述句（2026-11-23）。
     *
     * <p>这张卡原来只在选中后才出现，用户从没见过它，也就不知道能点。
     * 现在它常驻，空态必须说清「点哪里」—— 否则只是一块写着「未选中」的空板。
     */
    /*
     * 空态用**准星框**填充视觉，不显示数字（2026-11-23 收回一版）。
     *
     * <p>第一版显示「13 个对象可点击」，但 13 是场景里所有带 sceneEntityId 的
     * 绑定，含非机组对象 —— 标题写「机组」、数字却是 13，用户会以为有 13 台机组。
     * 这个数无法保证准确表达「机组数」，那就不该以数字形态出现。
     *
     * <p>虚线准星框是科技大屏里通用的「此处可交互」视觉语言，
     * 只承载「可以点」这个含义，不承诺任何数量。
     */
    return (
      <div className={styles.selectionHint}>
        <div className={styles.selectionHintFrame} aria-hidden="true">
          <span />
        </div>
        <div className={styles.pendingTitle}>点击三维场景中的机组</div>
        <div className={styles.pendingDetail}>查看该机组的实时参数</div>
      </div>
    );
  }
  if (!list.length) return <Empty>该对象还没有绑定设备</Empty>;
  const rows = list.flatMap((binding) =>
    binding.telemetryMappings.map((mapping) => {
      const row = latest[`${binding.deviceId}:${mapping.telemetryKey}`] ?? latest[`${binding.deviceId}:${mapping.field}`];
      return {
        key: `${binding.id}-${mapping.telemetryKey || mapping.field}`,
        label: mapping.label || mapping.telemetryKey,
        text: row ? formatTelemetryText(row.value, mapping.displayType, mapping.unit || row.unit) : "",
        missing: !row,
        /*
         * 标准 key + 原始数值（2026-11-23）。
         *
         * <p>判读要用「标准 key」（去字典查 diagnosis）+ 「数值」（比范围），
         * 所以这两个不能丢。`text` 是给人看的格式化结果，拿它去比范围会
         * 因单位后缀/千分位而错。
         */
        standardKey: mapping.telemetryKey || mapping.field,
        /** 原始值（可能是字符串枚举，如 sys_mode 报「制热」）。 */
        rawValue: row ? row.value : null,
        /** 仅当能安全转成有限数字时给出，否则 null —— 不能用它判枚举型指标。 */
        numericValue: toNumeric(row?.value),
      };
    }),
  );

  /*
   * 当前工况（2026-11-23）。
   *
   * <p>判水温范围必须先知道在制冷还是制热 —— 同一个 25℃ 在制冷下偏高、
   * 在制热下偏低。取本台设备自己的 `sys_mode`，不用别台的：
   * 多机组系统里各台工况可能不同。
   */
  const modeRow = rows.find((r) => r.standardKey === "sys_mode" && !r.missing);
  const workingMode = inferWorkingMode(modeRow?.rawValue);

  /**
   * 对一行做判读。没有 diagnosis 的 key 返回 null（不显示任何标记）。
   *
   * <p>只对**有官方判据**的 key 判 —— 没依据就不判，绝不自己拍阈值。
   */
  const judgeRow = (row: (typeof rows)[number]) => {
    if (row.missing) return null;
    const diag = diagnoses?.get(row.standardKey);
    if (!diag) return null;
    return judgeMetric(diag, row.numericValue, workingMode);
  };
  if (!rows.length) return <Empty>该对象还没有绑定设备</Empty>;

  /*
   * 设备名（2026-11-23，客户要求「点设备后把设备专题情况统计一下」）。
   *
   * <p>原来这张卡只有一列「参数 → 值」，选中的是哪台机器要回头去看
   * 3D 场景里高亮的是谁。把名字顶在参数上方，卡片本身就能回答
   * 「我在看什么」—— 尤其是清一色「模块机 N#」这种只差一位的编号。
   */
  /*
   * ★「暂无数据」折叠成一行（2026-11-23 实测改进）。
   *
   * <h3>为什么必须折</h3>
   *
   * <p>实测：模块机只上报 `temperature` / `power` / `opening` / `running` 四项，
   * 而模板给这台设备配了 12 项映射（含风机状态、指示灯、外机模式…）。
   * 结果卡片上 8 行都是「暂无数据」，把 24h 趋势图挤出了可视区 ——
   * 客户点开设备最想看的「最近怎么走的」反而看不见。
   *
   * <h3>为什么不是直接删掉</h3>
   *
   * <p>「这个点没数据」本身是信息：可能是没接线、可能是设备不支持。
   * 删掉会让人以为模板没配这一项。折成一行「另有 N 项无数据」既能省空间，
   * 又保留了"有东西缺失"这件事。
   */
  const hasData = rows.filter((row) => !row.missing);
  const missingCount = rows.length - hasData.length;
  /* 全部没数据时不能只剩一行汇总 —— 那就是空卡，要如实说清 */
  const shownRows = hasData.length ? hasData : rows.slice(0, 1);

  const device = primaryId ? devices?.find((d) => d.id === primaryId) : undefined;
  const deviceName = displayNameOf(device);

  /*
   * 异常项汇总（2026-11-23）。
   *
   * <p>只在卡片底部说一次，不在每行重复长文本 —— 右翼空间有限，
   * 而「为什么算异常」往往一句话就够了：`高于正常范围 5~20℃（制冷工况），当前 25.3℃`。
   */
  const abnormal = shownRows
    .map((row) => ({ row, judgement: judgeRow(row) }))
    .filter(
      (item): item is { row: (typeof rows)[number]; judgement: NonNullable<ReturnType<typeof judgeRow>> } =>
        Boolean(item.judgement && (item.judgement.verdict === "high" || item.judgement.verdict === "low")),
    );
  const deviceMeta = device
    ? [device.type, device.points?.length ? `${device.points.length} 个测点` : ""]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className={styles.rows}>
      {deviceName ? (
        <div className={styles.spotlightHead} data-testid="selection-device-name">
          <b>{deviceName}</b>
          {deviceMeta ? <span>{deviceMeta}</span> : null}
        </div>
      ) : null}
      {shownRows.map((row) => {
        const judgement = judgeRow(row);
        const flag =
          judgement?.verdict === "high" ? "偏高" : judgement?.verdict === "low" ? "偏低" : null;
        return (
          <div className={styles.row} key={row.key}>
            <span>{row.label}</span>
            <b className={row.missing ? styles.muted : undefined}>
              {row.missing ? "暂无数据" : row.text}
              {/* 异常标记：只对超出官方范围的加上，让用户一眼看到哪项不对 */}
              {flag ? <i className={styles.rowFlag} data-testid="metric-abnormal-flag">{flag}</i> : null}
            </b>
          </div>
        );
      })}
      {missingCount > 0 && hasData.length > 0 ? (
        <div className={styles.rowsMore} title={rows.filter((r) => r.missing).map((r) => r.label).join("、")}>
          另有 {missingCount} 项无数据
        </div>
      ) : null}
      {/*
       * 异常判读说明（2026-11-23，验收判据第 10 条）。
       *
       * <p>「超出范围」本身不是解释。用户要知道**为什么算异常**：
       * 正常范围是多少、当前工况是哪一套。这些全来自厂商手册，
       * 不是前端拍的 —— 手册改版只需改字典，代码不动。
       */}
      {abnormal.length ? (
        <div className={styles.diagnosisNote} data-testid="selection-diagnosis">
          {abnormal.map(({ row, judgement }) => (
            <div key={row.key}>
              <b>{row.label}</b>
              {judgement.reason}
            </div>
          ))}
        </div>
      ) : null}
      {/*
       * 24 小时趋势（2026-11-23 客户要求「点设备后把设备专题情况统计一下」）。
       *
       * <p>只画两个最有诊断价值的量：
       *   · 功率 —— 判断这台机器是在出力还是空转
       *   · 温度 —— 判断是否偏离设定、是否有异常爬升
       *
       * <p>参数列表说的是「现在多少」，趋势说的是「最近怎么走的」。
       * 客户点开一台设备的动机通常是后者（「它今天正常吗」）。
       */}
      <SpotlightTrend history={history} latest={latest} primaryId={primaryId} />
      {/*
       * 设备操作（2026-11-23）。
       *
       * <p>客户要求点设备后「操作部件抽屉出来」。原来这张卡只有参数 + 趋势：
       * 看得见状态，但异常时动不了手，得切回别的页面 —— 「发现 → 处理」被断成两截。
       *
       * <p>命令来自设备自己的 rpcMethods，不写死命令名。
       * 没登记命令的设备不显示这一块（不是「空框占位」）。
       */}
      {primaryId ? (
        <div className={styles.spotlightActions} data-testid="selection-actions">
          <div className={styles.spotlightActionsHead}>操作</div>
          <DeviceCommandList deviceId={primaryId} deviceName={deviceName} />
        </div>
      ) : null}
    </div>
  );
}

/** 设备专题的 24h 迷你趋势（功率 + 温度）。 */
function SpotlightTrend({
  history,
  latest,
  primaryId,
}: {
  history: ReturnType<typeof useDeviceHistory>;
  latest: Record<string, TelemetryRecord>;
  primaryId?: string;
}) {
  if (!primaryId) return null;
  if (history.loading) {
    return <div className={styles.sparkEmpty}>加载 24h 趋势…</div>;
  }
  if (history.error) {
    /*
     * 历史拿不到不影响看当前值 —— 参数列表已经在上面了。
     * 所以只给一行小字，不占满卡片。
     */
    return <div className={styles.sparkEmpty}>趋势不可用：{history.error}</div>;
  }
  const powerPoints = history.series.power ?? [];
  const tempPoints = history.series.temperature ?? [];
  if (!powerPoints.length && !tempPoints.length) {
    return <div className={styles.sparkEmpty}>近 24h 无历史数据</div>;
  }
  const stat = (points: Array<{ value: number }>) => {
    if (!points.length) return null;
    const values = points.map((p) => p.value);
    return { min: Math.min(...values), max: Math.max(...values), last: values[values.length - 1]! };
  };
  const powerStat = stat(powerPoints);
  const tempStat = stat(tempPoints);
  const unitOf = (key: string, fallback: string) =>
    latest[`${primaryId}:${key}`]?.unit ?? fallback;

  return (
    <div className={styles.spotlightTrend} data-testid="selection-trend">
      {powerStat ? (
        <div className={styles.sparkBlock}>
          <div className={styles.sparkHead}>
            <span>功率 24h</span>
            <b>
              {formatMetricNumber(powerStat.last)}
              <i>{unitOf("power", "kW")}</i>
            </b>
          </div>
          <Sparkline points={powerPoints} />
          <div className={styles.sparkFoot}>
            最高 {formatMetricNumber(powerStat.max)} · 最低 {formatMetricNumber(powerStat.min)}
          </div>
        </div>
      ) : null}
      {tempStat ? (
        <div className={styles.sparkBlock}>
          <div className={styles.sparkHead}>
            <span>温度 24h</span>
            <b>
              {formatMetricNumber(tempStat.last)}
              <i>{unitOf("temperature", "℃")}</i>
            </b>
          </div>
          <Sparkline points={tempPoints} tone="gold" />
          <div className={styles.sparkFoot}>
            最高 {formatMetricNumber(tempStat.max)} · 最低 {formatMetricNumber(tempStat.min)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 按名称包含过滤 id 列表（summary-card 用）。空 filterText 原样返回。 */
function filterIdsByName(
  ids: string[] | undefined,
  filterText: string | undefined,
  bindings: DeviceBinding[],
  devices?: Device[] | null,
): string[] | undefined {
  const needle = (filterText || "").trim();
  if (!ids || !needle) return ids;
  return ids.filter((id) => {
    const device = devices?.find((d) => d.id === id);
    const name = device ? displayNameOf(device) : bindings.find((b) => b.deviceId === id)?.deviceName;
    return (name || "").includes(needle);
  });
}

/** 按名称包含过滤。空 filterText 原样返回 —— 不过滤是默认行为。 */
function filterRowsByName<T extends { name: string }>(rows: T[], filterText?: string): T[] {
  const needle = (filterText || "").trim();
  if (!needle) return rows;
  return rows.filter((row) => row.name.includes(needle));
}

const STATUS_CLASS: Record<string, string | undefined> = {
  running: styles.statusRun,
  offline: styles.statusOff,
  fault: styles.statusFault,
  unknown: styles.muted,
};

const STATUS_TEXT: Record<string, string> = {
  running: "运行",
  offline: "停机",
  fault: "故障",
  unknown: "未知",
};

/**
 * 设备列表：逐台列名字 + 状态 + 可选读数。
 *
 * <p>为什么不做成可点击选中：WidgetOverlay 的 body 组件目前没有 select 回调，
 * 要加得改三层 props。点选 3D 对象已经能选中设备，列表这里先只读，
 * 避免为了一个交互把部件层和数据层搅在一起。
 */
export function DeviceListCardBody({
  widget,
  bindings,
  latest,
  devices,
  scopeDeviceIds,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  scopeDeviceIds?: Record<string, string[]>;
}) {
  const ids = widgetScopeDeviceIds(widget, scopeDeviceIds);
  /*
   * 直接传 slots（不只是键）：槽位上的 displayType 决定 0/1 显示成
   * 「运行/停止」还是「1/0」，只传键会把这份配置丢掉。
   */
  const slots = (widget.slots ?? []).filter((slot) => Boolean(slot.telemetryKey));
  const rows = filterRowsByName(listScopedDevices(ids, latest, bindings, devices, [], slots), widget.filterText);
  if (!rows.length) {
    /* 过滤后为空要说清是「过滤掉了」还是「本来没有」，否则客户以为设备丢了 */
    const all = listScopedDevices(ids, latest, bindings, devices, [], slots);
    return <Empty>{all.length ? `没有名称含「${widget.filterText}」的设备` : undefined}</Empty>;
  }
  return (
    <div className={styles.deviceList}>
      {rows.map((row) => {
        /*
         * 一台设备显示**所有**配了键的读数（2026-11-23）。
         *
         * <p>原来固定取 `readings[0]` —— 即使模板给这台设备配了
         * 出水温度 + 运行状态 + 加载率 三列，也只显示第一列。
         * 参考大屏每行都能看到多项指标，信息密度就来自这里：
         * 9 台 × 3 列 = 27 个数字，而单列只有 9 个。
         *
         * <p>主值用 `<b>`（强调），其余用小一号的 `<em>`：
         * 一行里多个数字挤在一起，没有主次会看不清哪个是重点。
         */
        const shown = row.readings.filter((reading) => !reading.missing && reading.text !== "");
        /*
         * 进度条列单独拿出来（2026-11-23）。
         *
         * <p>对齐 template01 的 `.bar-row`：`名称 | ▬▬▬▬▬░░ | 数值`。
         * 一排纯数字看不出哪台在出力，一排条子一眼就能比出来 ——
         * 这是参考大屏信息密度高但不杂乱的关键。
         *
         * <p>条子放在名称和数值之间，文字列仍在右侧：
         * 删掉文字列会让「出水温度 7.4℃」这种非比例量无处安放。
         */
        const bars = shown.filter((reading) => reading.render === "bar");
        /*
         * 有进度条时把开关量状态从文字列里剔掉（2026-11-23）。
         * 状态已由 dot 颜色 + title 表达，再占一段文字会把温度挤掉 ——
         * 219px 宽的行放不下「名称 | 条 | 温度 | 运行」四段。
         */
        const texts = shown.filter(
          (reading) => reading.render !== "bar" && !(bars.length && reading.isStatus),
        );
        return (
          <div
            className={`${styles.deviceRow} ${bars.length ? styles.deviceRowWithBar : ""}`}
            key={row.deviceId}
          >
            {/*
             * 有进度条时，状态只用颜色点表达（2026-11-23）。
             *
             * 卡片按模板收窄到 219px 后，「名称 | 条 | 温度 | 状态」四段放不下，
             * 状态文字被裁成半截（实测截图）。
             * 参考模板的 .bar-row 只有「名称 | 条 | 数值」三段 —— 状态由颜色承载。
             * 这里同理：dot 颜色 = 运行/停机/故障/未知，并补 title 供 hover 查看，
             * 色觉障碍用户也能读到文字。
             */}
            <i
              className={styles.deviceDot}
              data-status={row.status}
              title={STATUS_TEXT[row.status] ?? "未知"}
              aria-label={STATUS_TEXT[row.status] ?? "未知"}
              {...(bars.length ? {} : { "aria-hidden": true })}
            />
            <span className={styles.deviceName} title={row.name}>{row.name}</span>
            {bars.length ? (
              <span className={styles.deviceBars}>
                {bars.map((reading) => (
                  <span
                    className={styles.barTrack}
                    key={reading.key}
                    title={`${reading.label}：${reading.text}${reading.unit || ""}`}
                  >
                    <i
                      className={styles.barFill}
                      style={{ width: `${Math.round((reading.ratio ?? 0) * 100)}%` }}
                      data-status={row.status}
                    />
                  </span>
                ))}
                {/*
                 * 条的数值（2026-11-23）。
                 *
                 * <h3>为什么必须有</h3>
                 *
                 * <p>只有条、没有数字时，「这台 19.3kW、那台 21.7kW」只能靠
                 * 长度目测 —— 而客户明确要求看到「功率」这个指标的具体值。
                 * 数值原本只藏在 hover 的 title 里，等于默认不可见。
                 *
                 * <h3>为什么放在条后面而不是条里面</h3>
                 *
                 * <p>条本身只有 8px 高，叠字会糊成一团。放右侧与其它读数
                 * 同一基线，扫视时是「名称 | 条 | 功率 | 温度」的顺序，
                 * 和人的阅读习惯一致。
                 *
                 * <p>多个 bar 时用 `/` 分隔并只显示第一个的数值 —— 一行
                 * 219px 放不下两组「条+数字」，硬塞会把温度挤掉。
                 */}
                {bars[0]?.text ? (
                  <em className={styles.barValue} title={bars[0].label}>
                    {bars[0].text}
                  </em>
                ) : null}
              </span>
            ) : null}
            <span className={styles.deviceValues}>
              {texts.length ? (
                texts.map((reading) => (
                  /*
                   * 只输出 `reading.text`，不再拼 `reading.unit`（2026-11-23）。
                   * `listScopedDevices` 里 `formatTelemetryText` 已经带上了单位，
                   * 再拼一次会变成「7.4 ℃℃」——实测截图确认过。
                   */
                  <em key={reading.key} title={reading.label}>
                    {reading.text}
                  </em>
                ))
              ) : bars.length ? null : (
                <b className={STATUS_CLASS[row.status] ?? styles.muted}>
                  {STATUS_TEXT[row.status] ?? "未知"}
                </b>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 设备对比条：每台一根横条，长度按同一列读数的相对大小。
 *
 * <p>只比同一量纲的键（如全部 load_rate）。不同单位的读数混在一起会让
 * 「最长的那根」失去意义 —— 调用方应只配一个 slot 键。
 */
export function BarCompareCardBody({
  widget,
  bindings,
  latest,
  devices,
  scopeDeviceIds,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  devices?: Device[] | null;
  scopeDeviceIds?: Record<string, string[]>;
}) {
  const ids = widgetScopeDeviceIds(widget, scopeDeviceIds);
  const slot = (widget.slots ?? [])[0];
  const key = slot?.telemetryKey;
  const rows = filterRowsByName(listScopedDevices(ids, latest, bindings, devices, key ? [key] : []), widget.filterText);
  if (!rows.length) {
    const all = listScopedDevices(ids, latest, bindings, devices, key ? [key] : []);
    return <Empty>{all.length ? `没有名称含「${widget.filterText}」的设备` : undefined}</Empty>;
  }
  /*
   * 全部没数时不要画一排空条（2026-11-23）。
   *
   * 原来这里会渲染 9 行「名称 —————— —」，看起来像表格骨架/样式坏了。
   * 用户分不清「没数据」和「页面出错」。和 metric-card 一样改成诊断说明。
   */
  const anyValue = rows.some((row) => row.readings[0] && !row.readings[0].missing);
  if (!anyValue) {
    return (
      <div className={styles.pendingBlock}>
        <div className={styles.pendingTitle}>暂无数据</div>
        <div className={styles.pendingDetail}>
          {describePendingSlot(widget, slot?.key ?? "load", bindings, latest, devices)}
        </div>
      </div>
    );
  }
  const values = rows.map((r) => r.readings[0]?.numeric ?? 0);
  const max = Math.max(1, ...values);
  return (
    <div className={styles.barCompare}>
      {rows.map((row, index) => {
        const reading = row.readings[0];
        const value = values[index] ?? 0;
        const pct = Math.max(0, Math.min(1, value / max)) * 100;
        return (
          <div className={styles.barRow} key={row.deviceId}>
            <span className={styles.barName} title={row.name}>{row.name}</span>
            <div className={styles.barTrack}>
              <i className={styles.barFill} data-status={row.status} style={{ width: `${pct}%` }} />
            </div>
            <b className={reading && !reading.missing ? undefined : styles.muted}>
              {reading && !reading.missing ? `${reading.text}${reading.unit || slot?.unit || ""}` : "—"}
            </b>
          </div>
        );
      })}
    </div>
  );
}

function useChartTokens() {
  const { theme } = useAppTheme();
  const hud = useHudSkin();
  const [tokens, setTokens] = useState({ text: "", muted: "", border: "", primary: "", gold: "" });
  useEffect(() => {
    if (hud) {
      setTokens({
        text: ngxHudTokens.text,
        muted: ngxHudTokens.muted,
        border: ngxHudTokens.accentSoft,
        primary: ngxHudTokens.accent,
        gold: ngxHudTokens.gold,
      });
      return;
    }
    const style = getComputedStyle(document.documentElement);
    setTokens({
      text: style.getPropertyValue("--ngx-color-text").trim(),
      muted: style.getPropertyValue("--ngx-color-muted").trim(),
      border: style.getPropertyValue("--ngx-color-border").trim(),
      primary: style.getPropertyValue("--ngx-color-primary").trim(),
      gold: style.getPropertyValue("--ngx-color-warning").trim(),
    });
  }, [theme, hud]);
  return tokens;
}

export function TrendCardBody({
  widget,
  bindings,
  latest,
  history,
  devices,
  scopedHistory,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  history: Record<string, TelemetryPoint[]>;
  devices?: Device[] | null;
  /**
   * 范围聚合历史（2026-11-23），由 `useScopedHistory` 提供。
   *
   * <p>聚合槽（`slot.aggregate`）没有单台设备可依，实时累积也没意义 ——
   * 必须走历史接口把 9 台各自的历史拉下来合并。
   */
  scopedHistory?: Record<string, Array<{ timestamp: number; value: number }>>;
}) {
  const tokens = useChartTokens();
  const slots = widget.slots?.length ? widget.slots : [];
  const series = useMemo(() => {
    /*
     * 构造逻辑抽到 `buildTrendSeries`（2026-11-23）——
     * 「能不能画出线」完全取决于它，内联在 useMemo 里没法单测。
     */
    return buildTrendSeries({
      slots,
      bindings,
      latest,
      history,
      devices,
      scopedHistory,
      palette: [tokens.primary, tokens.gold].filter(Boolean),
    }).map((item) => ({
      ...item,
      type: "line" as const,
      showSymbol: false,
      smooth: true,
      areaStyle: { opacity: 0.22 },
    }));
  }, [slots, bindings, latest, history, devices, scopedHistory, tokens.primary, tokens.gold]);

  if (!slots.length) return <Empty />;
  /*
   * 聚合槽的「可用」定义不同（2026-11-23）：
   * 它靠历史接口取数，历史点不足 2 个时 bound 就是 false ——
   * 但那不等于「没配置」，不应该落到 `<Empty>`（默认文案「还没有绑定设备」），
   * 那会让用户去找一个不存在的设备选择项（实测踩过）。
   *
   * 聚合槽一律走下面的 pendingBlock 分支，说清「在等什么历史」。
   */
  const hasAggregateSlot = slots.some((slot) => slot.aggregate);
  if (!hasAggregateSlot && series.every((item) => !item.bound)) return <Empty />;
  if (series.every((item) => item.data.length < 2)) {
    /*
     * 趋势图没点时也说清在等什么（2026-11-23）。
     * 「暂无历史数据」不区分「网关没上报」和「刚打开还没攒够」，用户无从判断。
     */
    return (
      <div className={styles.pendingBlock}>
        <div className={styles.pendingTitle}>暂无历史数据</div>
        <div className={styles.pendingDetail}>
          {describePendingSlot(widget, slots[0]?.key ?? "series-0", bindings, latest, devices)}
          {" · 或刚打开页面，正在累积"}
        </div>
      </div>
    );
  }

  /*
   * 末值做大数字（2026-11-23）：对齐模板底部左块「大数字 + 折线」。
   * 聚合槽的末值就是当前 9 台之和，与曲线右端一致，不会两个数打架。
   */
  const lastPoint = series.find((item) => item.data.length)?.data.slice(-1)[0];
  const unit = slots[0]?.unit;
  const kpiLabel = slots[0]?.label || slots[0]?.telemetryKey || "";

  return (
    <div className={styles.trendRow}>
      {lastPoint ? (
        <div className={styles.trendKpi}>
          <b>
            {/*
             * 与卡片其它数值走同一个格式化（2026-11-23）。
             *
             * <p>原来写的是 `Math.round(lastPoint[1])` —— 122.4 显示成 122，
             * 而同一张卡的 Y 轴刻度带小数、图例写着「9 台之和」，
             * 两处对不上，看着像数据错了。
             */}
            {formatMetricNumber(lastPoint[1])}
            {unit ? <i>{unit}</i> : null}
          </b>
          <span>{kpiLabel}</span>
        </div>
      ) : null}
    <ReactECharts
      className={styles.chart}
      style={{ height: "100%", width: "100%" }}
      option={{
        animation: false,
        color: [tokens.primary, tokens.gold].filter(Boolean),
        tooltip: { trigger: "axis" },
        legend: { right: 0, top: 0, textStyle: { color: tokens.muted, fontSize: 10 } },
        grid: { left: 28, right: 8, top: 22, bottom: 20 },
        xAxis: {
          type: "time",
          axisLabel: { color: tokens.muted, fontSize: 10 },
          axisLine: { lineStyle: { color: tokens.border } },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          /*
           * `scale: true` —— 不从 0 起（2026-11-23）。
           *
           * 总功率常年在 170~210 kW 之间波动，Y 轴从 0 起时这点起伏被压成
           * 一条几乎水平的直线，看起来像「没有数据」。模板里那条曲线是
           * 明显上下走的 —— 差别不在数据，在坐标轴起点。
           */
          scale: true,
          splitNumber: 3,
          axisLabel: { color: tokens.muted, fontSize: 10 },
          splitLine: { lineStyle: { color: tokens.border, opacity: 0.6 } },
        },
        series: series.filter((item) => item.data.length),
      }}
    />
    </div>
  );
}

export function TitleCardBody({ widget, fallback }: { widget: SceneWidget; fallback?: string }) {
  const text = widget.title?.trim() || fallback?.trim() || "";
  if (!text) return <Empty>还没有填写标题</Empty>;
  return (
    <>
      <h1 className={styles.titleText}>{text}</h1>
      {/*
       * 英文副标题（2026-11-23）：对齐 template01 大标题下方那行
       * `SMART CAMPUS DIGITAL TWIN VISUALIZATION PLATFORM`。
       * 中文大标题 + 小字英文是全屏最顶端的视觉锚点，缺了它标题区只剩一行字。
       */}
      {widget.subtitle ? (
        <div className={styles.titleSubtitle}>{widget.subtitle}</div>
      ) : null}
    </>
  );
}

export function CaptionCardBody({ widget }: { widget: SceneWidget }) {
  const text = widget.title?.trim() || "";
  if (!text) return <Empty>还没有填写说明</Empty>;
  return <div className={styles.captionText}>{text}</div>;
}

export function widgetHeading(widget: SceneWidget, fallbackTitle?: string) {
  if (widget.type === "title" || widget.type === "caption") return "";
  return widget.title?.trim() || fallbackTitle || "";
}

/**
 * 趋势卡 + 范围聚合历史（2026-11-23）。
 *
 * <h2>为什么要单独包一层</h2>
 *
 * <p>`WidgetOverlay` 在 `visibleWidgets.map()` 里渲染卡片 ——
 * **循环里不能调 hook**。而聚合历史需要 `useScopedHistory`（内部有 effect）。
 *
 * <p>抽成独立组件后，每张趋势卡是一个 React 组件实例，
 * hook 的调用顺序稳定，合法且不会互相干扰。
 */
export function TrendCardWithHistory({
  widget,
  bindings,
  latest,
  history,
  devices,
  scopeDeviceIds,
  deviceNameOf,
}: {
  widget: SceneWidget;
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord>;
  history: Record<string, TelemetryPoint[]>;
  devices?: Device[] | null;
  scopeDeviceIds?: Record<string, string[]>;
  deviceNameOf?: (id: string) => string;
}) {
  const hasAggregate = (widget.slots ?? []).some((slot) => slot.aggregate);
  const nameOf = deviceNameOf ?? ((id: string) => devices?.find((d) => d.id === id)?.label ?? id);
  /*
   * 没有聚合槽时传 null：hook 内部会跳过，不发任何请求。
   * 不能无条件调用后再判空 —— 单设备趋势卡不该白拉一次历史。
   */
  const scopedHistory = useScopedHistory(
    hasAggregate ? widget : null,
    scopeDeviceIds,
    nameOf,
  );
  return (
    <TrendCardBody
      widget={widget}
      bindings={bindings}
      latest={latest}
      history={history}
      devices={devices}
      scopedHistory={hasAggregate ? scopedHistory : undefined}
    />
  );
}
