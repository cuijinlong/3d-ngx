import { useMemo, type ReactElement } from "react";
import ReactECharts from "echarts-for-react";
import type { SceneWidget } from "@idt/data-adapter";
import { formatMetricNumber } from "../../utils/device-plates";
import {
  ENERGY_GRANULARITIES,
  type EnergyGranularity,
  type EnergyKindRow,
  type SiteEnergyStats,
} from "../../hooks/useSiteEnergyStats";
import type { EnergyRollup } from "../../hooks/useEnergyRollup";
import styles from "./WidgetOverlay.module.css";

/**
 * 场站能耗类部件（2026-11-23）。
 *
 * <h2>为什么单独一个文件，而不是塞进 WidgetCards.tsx</h2>
 *
 * <p>`WidgetCards.tsx` 里那批 Body 全部围绕「槽位 → 遥测点位」这套模型
 * （`bindings` / `latest` / `slots`）。能耗统计是另一套：没有槽位、没有设备绑定，
 * 只有「一个场站的聚合量」。混进去会让每个 Body 都多一个 `if (energy)` 分支，
 * 而那个分支用不到它们共同的入参 —— 读代码的人要来回跳。
 *
 * <p>视觉上刻意复用 `WidgetOverlay.module.css` 里同一批类
 * （`metricLayout` / `trendRow` / `barCompare`），所以**外观与原来完全一致**，
 * 客户要求的是「样式不变、统计维度调整」。
 *
 * <h2>单位必须标清楚</h2>
 *
 * <p>`series.tce` 是折标煤（吨），不是电量。把 tce 写成 kWh 会让
 * 客户按错误的单价去算钱。每张卡的数字旁边都带单位，且单位来自接口本身
 * （`byKind[].unit`），不是这里硬编码的。
 */

/**
 * 能耗口径的默认展示项 —— 按部件类型给默认，布局里可用 `energyMetric` 覆盖。
 *
 * <p>默认 `usage`（用量）+ `elec`（电能）：绝大多数场站最先关心的是电。
 * 这不是硬编码"只能看电" —— 分类卡/趋势卡都能用 `energyKind` 换成任何品种。
 */
export function energyMetricOf(
  widget: SceneWidget,
): "usage" | "cost" | "carbon" | "tce" | "trend" | "ranking" {
  if (widget.energyMetric) return widget.energyMetric;
  if (widget.type === "trend-chart") return "trend";
  if (widget.type === "bar-compare") return "ranking";
  return "usage";
}

/** 当前卡关心的品种（`usage`/`trend` 用），默认电。 */
export function energyKindOf(widget: SceneWidget): string {
  return widget.energyKind?.trim() || "elec";
}

/**
 * 品种 code → 单位。
 *
 * <p>单位**优先用平台 `byKind[].unit`**（那是权威）。这里只是兜底：
 * 平台的 `kinds` 列表在 `seriesOf` 有数据时必然有对应项，但如果某个桶
 * 有数据而 `kinds` 汇总缺失（接口局部失败），至少要显示一个合理单位，
 * 而不是空白。
 */
const KIND_UNIT_FALLBACK: Record<string, string> = {
  elec: "kW·h",
  heat: "GJ",
  water: "m³",
  gas: "m³",
  steam: "t",
};

function unitOfKind(kinds: EnergyKindRow[], code: string): string {
  return kinds.find((k) => k.code === code)?.unit || KIND_UNIT_FALLBACK[code] || "";
}

function nameOfKind(kinds: EnergyKindRow[], code: string): string {
  return kinds.find((k) => k.code === code)?.name || code;
}

/**
 * 按数值长度自适应字号（2026-11-23）。
 *
 * <h3>为什么必须做这件事</h3>
 *
 * <p>实测踩到：`597.75 tCO₂` 在 11.35% 宽的卡里被裁成 `7.75` ——
 * 前两位被 overflow 吃掉，**数字看着像真的，实际差了两个数量级**。
 * 这比显示「暂无数据」危险得多，因为没人会怀疑一个正常大小的数字。
 *
 * <p>`metricValue` 的 `clamp(26px, 2.8vw, 40px)` 只按**视口宽**缩放，
 * 不知道卡片有多宽、数字有多长。卡宽由百分比决定，视口再宽也不会让
 * 一块 11% 的卡变宽 —— 所以必须在数字这一层按字符数收。
 *
 * <p>阈值按实测：40px 下 4 个字符约 96px，安全；
 * 6 个字符（`597.75`）就需要降到 32px 才不溢出。
 *
 * <h3>★ 2026-11-23 整体上调（40→54 / 31→44 / 25→35 / 21→28 / 17→22）</h3>
 *
 * <p>旧阈值是按**卡片 217px 宽**算的。客户要求「部件尽量大点」后，
 * 模板宽度改到 16.5%（1920 下 **317px**，可用宽度约 297px），
 * 旧字号在新卡片里明显偏小 —— 尤其 6 字符的 `62.51万` 只给 31px，
 * 那正是客户在主卡上看到的数。
 *
 * <p>按同一套度量（每字符约 0.6em）重算：6 字符 @44px ≈ 158px，
 * 加单位（0.36em）仍远低于 297px，余量充足。
 * 提升幅度约 40%，与卡片宽度增幅（+46%）基本匹配 ——
 * **两者必须同步，否则不是「字太小」就是「数字溢出」。**
 */
function kpiFontSize(text: string): number {
  const len = text.length;
  if (len <= 4) return 54;
  if (len <= 6) return 44;
  if (len <= 8) return 35;
  if (len <= 10) return 28;
  return 22;
}

/**
 * 大数值的紧凑写法（万 / 亿）。
 *
 * <p>设备用电排名里出现过 `1025068 kW·h` —— 这一格只有约 60px，
 * 七位数字必然换行。改写成 `102.5万` 既看得懂又不换行。
 *
 * <p>只对 **≥ 1 万** 生效：以下的值保留原样，`5424` 比 `0.54万` 直观。
 */
function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${formatMetricNumber(value / 1e8)}亿`;
  if (abs >= 1e4) return `${formatMetricNumber(value / 1e4)}万`;
  return formatMetricNumber(value);
}

/** 空态/错误态：复用 pendingBlock，和遥测部件的提示长一样。 */
function EnergyPending({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={styles.pendingBlock}>
      <div className={styles.pendingTitle}>{title}</div>
      {detail ? <div className={styles.pendingDetail}>{detail}</div> : null}
    </div>
  );
}

function pendingReason(stats: SiteEnergyStats): ReactElement {
  if (stats.loading) {
    return <EnergyPending title="正在统计" detail="读取场站能耗汇总…" />;
  }
  if (stats.error) {
    return <EnergyPending title="统计不可用" detail={stats.error} />;
  }
  if (!stats.series.length && !stats.kinds.length) {
    /*
     * 「没有数据」与「数据是 0」必须分开说。
     * 这个场站如果只是没上报，kinds 也会是空的（而不是 usage=0）。
     */
    return (
      <EnergyPending
        title="该场站暂无能耗数据"
        detail="设备尚未上报，或场站下没有计量点"
      />
    );
  }
  return <EnergyPending title="正在统计" detail="等待首次汇总…" />;
}

/**
 * 从用量序列里挑出峰值与谷值时段（2026-11-23）。
 *
 * <h2>为什么抽成纯函数</h2>
 *
 * <p>这段逻辑有两处「看着像自然写法、实际会出错」的坑，都只能靠单测钉住：
 * <ol>
 *   <li>**谷值必须排除 0**。数据断档那天的用量是 0，直接取 min 会得到
 *       「谷值 0」，运维会以为那天停机，实际是没上报。</li>
 *   <li>**只有一个桶时不能列两行**。峰谷同桶时上下两行一模一样，
 *       看起来像渲染重复。</li>
 * </ol>
 *
 * <p>另外它承担一个产品职责：左 1 卡与左 3 卡不能长得一样
 * （客户反馈过「重复」）。
 *
 * <h3>★ 2026-11-23：UI 已不再使用峰谷</h3>
 *
 * <p>客户原话「峰值和谷值先去掉」，左 1 改成「今日/本周/本月/本年」四格汇总。
 * 函数与测试**保留**：它锁住两处容易写错的判定（谷值必须排除 0、
 * 同桶时不返回），将来若恢复展示可以直接用，不用重新踩一遍。
 */
export function selectPeakTrough(
  series: ReadonlyArray<{ bucket: string; tce: number }>,
): Array<{ key: "peak" | "trough"; label: string; bucket: string; value: number }> | null {
  if (!series.length) return null;
  const nonZero = series.filter((b) => b.tce > 0);
  if (!nonZero.length) return null;
  const hi = series.reduce((a, b) => (b.tce > a.tce ? b : a));
  const lo = nonZero.reduce((a, b) => (b.tce < a.tce ? b : a));
  /* 同桶：列成两行等于把同一个数写两遍 */
  if (hi.bucket === lo.bucket) return null;
  return [
    { key: "peak", label: "峰值", bucket: hi.bucket, value: hi.tce },
    { key: "trough", label: "谷值", bucket: lo.bucket, value: lo.tce },
  ];
}

/* ==================================================================== */
/* ============================ ① KPI 卡 ============================== */
/* ==================================================================== */

/**
 * 耗电 / 碳排大数字卡。
 *
 * <p>布局与 `MetricCardBody` 一致：左侧大数字 + 单位，右侧一行补充信息。
 * 右侧不重复主数字，而是给一个**不同维度**的参照
 * （耗电看峰谷，碳排看吨标煤），这样一屏里两块卡不会说的是同一件事。
 */
export function EnergyMetricBody({
  widget,
  stats,
  rollup: passedRollup,
}: {
  widget: SceneWidget;
  stats: SiteEnergyStats;
  /**
   * 今日/本周/本月/本年汇总（2026-11-23）。
   *
   * <p>由 `useEnergyRollup` 单独取数 —— 它需要四个不同时间窗，
   * 塞不进 `stats` 那个「单窗口」模型。缺省给空值，编辑态预览也不会崩。
   */
  rollup?: EnergyRollup;
}) {
  const metric = energyMetricOf(widget);

  const kind = energyKindOf(widget);

  /* 缺省空汇总：编辑态 / 预览态不传时直接空，避免 `undefined.items` 崩掉 */
  const emptyRollup: EnergyRollup = { loading: false, error: null, items: [] };
  const rollup = passedRollup ?? emptyRollup;

  /*
   * 按 metric 分派（2026-11-23 通用化）。
   *
   * <h3>为什么不合并成一个"取数"函数</h3>
   *
   * <p>六种口径的"有没有数据"判据不同：碳排看 `kinds` 非空，
   * 用量看该品种是否真的出现，成本看 cost 是否 > 0。硬揉在一起
   * 会让每种口径都带上其它口径的假设 —— 上一版把「没有电表」判断成
   * 「没有能耗数据」就是这么来的。
   */
  const view = useMemo(() => {
    const title = widget.title?.trim();

    if (metric === "carbon") {
      return {
        value: stats.kpi.co2,
        unit: "tCO₂",
        label: title || "碳排放",
        /*
         * 不再用 side 显示「折标煤」—— 下方三格里已经有一格是折标煤
         * （2026-11-23 客户反馈「内容超出边界」，实测是同一句话出现两次：
         *  `折标煤 77.54 tce` 先出现在副标题、又出现在三格第一格）。
         * 副标题改成口径说明，信息不重复。
         */
        sideLabel: "核算口径",
        sideText: `${stats.kinds.length} 项能源品种`,
        hasData: stats.kinds.length > 0,
        emptyTitle: "暂无碳排数据",
        emptyDetail: stats.error ?? "该场站下没有可计量的用能点",
      };
    }

    if (metric === "tce") {
      return {
        value: stats.kpi.tce,
        unit: "tce",
        label: title || "综合能耗",
        sideLabel: "折标煤",
        sideText: `${formatMetricNumber(stats.kpi.co2)} tCO₂`,
        hasData: stats.kinds.length > 0,
        emptyTitle: "暂无综合能耗",
        emptyDetail: stats.error ?? "该场站下没有可计量的用能点",
      };
    }

    if (metric === "cost") {
      return {
        value: stats.kpi.cost,
        unit: "元",
        label: title || "用能成本",
        sideLabel: "设备数",
        sideText: `${stats.kpi.deviceCount} 台`,
        hasData: stats.costAvailable,
        emptyTitle: "暂无成本数据",
        emptyDetail: "该场站未配置用能单价",
      };
    }

    /*
     * usage（默认）：某个品种的用量。
     *
     * 取不到该品种时**不回落**成别的量 —— 单位不同，混着显示会被
     * 当成同一个东西。宁可说「没有 X 计量」，也不能显示一个错的数字。
     */
    const kindRow = stats.kinds.find((k) => k.code === kind);
    return {
      value: kindRow ? kindRow.usage : null,
      unit: unitOfKind(stats.kinds, kind),
      label: title || `${nameOfKind(stats.kinds, kind)}用量`,
      sideLabel: kindRow ? "占比" : "计量",
      sideText: kindRow ? `${formatMetricNumber(kindRow.pct)}%` : "无",
      hasData: kindRow != null,
      emptyTitle: `暂无${nameOfKind(stats.kinds, kind)}数据`,
      emptyDetail: stats.error ?? `该场站下没有可计量的${nameOfKind(stats.kinds, kind)}表`,
    };
  }, [metric, kind, stats, widget.title]);

  /*
   * 文字长度决定字号 —— 用 `compactNumber` 之后的结果算，
   * 而不是原始数值：`913400` 会被压成 `91.34万`（6 个字符），
   * 按 7 位数字去缩字号就白缩了。
   */
  const mainText = compactNumber(view.value ?? 0);


  /*
   * 碳排放口径的三格指标（2026-11-23）。
   *
   * <p>对应原型的 `info-metrics`（三列：数值 + 小标签）。
   * 全部由已有字段推导，不引入新数据源：
   *   · 折标煤 = `kpi.tce`
   *   · 排放强度 = co₂ / 用电量（有电量才有意义，否则不显示）
   *   · 计量品种 = `kinds.length`
   */
  const carbonStats = useMemo(() => {
    if (metric !== "carbon") return [];
    const kwh = stats.electricityKwh;
    const items: Array<{ value: string; label: string }> = [
      { value: `${formatMetricNumber(stats.kpi.tce)}`, label: "折标煤 tce" },
    ];
    if (kwh && kwh > 0) {
      /* kg CO₂ / kW·h 是行业通用强度量；tCO₂ ÷ kW·h × 1000 = kg/kW·h */
      items.push({ value: formatMetricNumber((stats.kpi.co2 * 1000) / kwh, 2), label: "排放强度 kg/kW·h" });
    }
    items.push({ value: `${stats.kinds.length}`, label: "计量品种" });
    return items;
  }, [metric, stats.kpi.tce, stats.kpi.co2, stats.electricityKwh, stats.kinds.length]);

  /*
   * ★ 早退必须放在**全部 hook 之后**（2026-11-23 实测崩溃）。
   *
   * <p>第一版把它放在 `kindRows` / `carbonStats` 两个 `useMemo` 之前：
   * 首屏「还没取到场站数据」时走早退、hook 数量少；数据到达后多调两个
   * `useMemo` → React 抛
   * `Rendered more hooks than during the previous render`，
   * 整页被错误边界接住，变成一张「页面出了点问题」的卡片。
   *
   * <p>后果特别隐蔽：**首屏看起来是空的（不是报错）**，要等数据回来才崩，
   * 所以「刷新一下就好了」这种假象很容易误导排查。
   */
  if (!view.hasData) {
    return <EnergyPending title={view.emptyTitle} detail={view.emptyDetail} />;
  }

  return (
    <div className={styles.energyKpi}>
      {/*
       * 主体区（2026-11-23 按原型 `info-lines` + `info-metrics` 重构）。
       *
       * <h3>改前的问题</h3>
       *
       * <p>原来是三行独立文本：大数字 / 标签 / 占比说明。三点问题：
       * <ol>
       *   <li>垂直占位太多，18% 高的卡（194px）里正文只剩 146px；</li>
       *   <li>标签与占比各占一行，中间大片留白，看着松散；</li>
       *   <li>没有任何分隔线，四格/三格与主体糊成一片。</li>
       * </ol>
       *
       * <h3>改后</h3>
       *
       * <p>大数字独占一行（保留视觉焦点），标签与占比合并成一行小字，
       * 下方用一条分隔线接住指标网格 —— 这正是原型的层级：
       * `ring-inner b`（大数） → `.info-lines`（行内 b + 说明） → `.info-metrics`（网格）。
       */}
      <div className={styles.energyHero}>
        <div className={styles.energyKpiValue} style={{ fontSize: kpiFontSize(mainText) }}>
          {mainText}
          <span className={styles.energyKpiUnit}>{view.unit}</span>
        </div>
        <div className={styles.energyKpiMeta}>
          <span className={styles.energyKpiLabel}>{view.label}</span>
          {view.sideText ? (
            <span className={styles.energyKpiSide}>
              {view.sideLabel} <b>{view.sideText}</b>
            </span>
          ) : null}
        </div>
      </div>
      {/*
       * 今日 / 本周 / 本月 / 本年 用电汇总（2026-11-23 客户要求）。
       *
       * <p>替换掉原来的「峰值 / 谷值」两行。客户原话：
       * 「场站用电量中增加今日用电、本周、本月、本年的用电汇总数字卡，峰值和谷值先去掉」。
       *
       * <p>只在「用电量」口径显示。碳排卡有自己的三格（折标煤/强度/品种），
       * 混进来会让两块卡又长得一样（之前已经因此返工过一次）。
       */}
      {metric === "usage" && rollup.items.length ? (
        <div className={styles.rollupGrid} data-testid="energy-rollup">
          {rollup.items.map((item) => (
            <div
              key={item.key}
              className={styles.rollupCell}
              data-key={item.key}
              data-empty={item.usage == null ? "true" : undefined}
              /*
               * 空值时 title 说明原因。悬停就能知道「为什么是 —」，
               * 不用去翻文档 —— 现场最常见的原因就是网关没上报。
               */
              title={
                item.usage == null
                  ? `${item.label}窗口内没有任何用电数据（可能是网关未上报）`
                  : `${item.label}累计用电 ${formatMetricNumber(item.usage)} ${view.unit}（截至现在）`
              }
            >
              <span className={styles.rollupLabel}>{item.label}</span>
              <b>
                {/* null 显示「—」：0 与「没数据」必须能分开，否则会误读成"没用电" */}
                {item.usage == null ? "—" : compactNumber(item.usage)}
                {item.usage == null ? null : <em>{view.unit}</em>}
              </b>
            </div>
          ))}
        </div>
      ) : null}
      {carbonStats.length ? (
        <div className={styles.energyMetricGrid} data-testid="energy-carbon-stats">
          {carbonStats.map((item) => (
            <div key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ==================================================================== */
/* =========================== ② 趋势卡 =============================== */
/* ==================================================================== */

/**
 * 场站能耗趋势 + 粒度切换。
 *
 * <h3>为什么用柱状而不是折线</h3>
 *
 * <p>遥测趋势是连续量（功率一直在变），折线合适；
 * 而这里每个桶是**一个周期的累计量**（这天用了多少、这月用了多少），
 * 天然是离散的柱。用折线去连「11-19 用了 103 tce、11-20 用了 36 tce」
 * 会画出斜边，看起来像"能耗在平滑下降"，实际那两天之间没有数据。
 *
 * <h3>峰谷怎么标</h3>
 *
 * <p>用 ECharts 的 `markPoint` 标最高/最低两根柱子，而不是在图外面写一行字 ——
 * 写字的话，人多半对不上是哪根柱。点位直接钉在柱子上，不会有歧义。
 * 最低值排除 0（见 `useSiteEnergyStats` 的说明）。
 */
export function EnergyTrendBody({
  widget,
  stats,
  gran,
  onGranChange,
}: {
  widget: SceneWidget;
  stats: SiteEnergyStats;
  gran: EnergyGranularity;
  onGranChange: (next: EnergyGranularity) => void;
}) {
  /*
   * ★ 展示某个**品种的用量**，不是综合能耗（2026-11-23）。
   *
   * <h3>为什么不能用 `series`</h3>
   *
   * <p>`stats.series` 里是 `tce`（折标煤）—— 把电、热、气按折标系数汇总后的值。
   * 客户要的是「这个场站每天用了多少度电」，两者差一个折标系数、单位也不同，
   * 客户按电价一乘就发现对不上账。
   *
   * <h3>为什么是 `seriesOf(kind)` 而不是写死 elec</h3>
   *
   * <p>第一版专门取了 `elecSeries` —— 那是把「这块卡看电」编进数据层。
   * 现在品种由 `energyKind` 配置决定，看水/热/气都只是改布局，不改代码。
   *
   * <p>该品种在本场站不存在时序列为空 —— 走下面的 pending 分支明确说明，
   * 而不是画一条 0 线（0 和「没数据」在运维眼里是完全不同的结论）。
   */
  const kind = energyKindOf(widget);
  const kindName = nameOfKind(stats.kinds, kind);
  const kindUnit = unitOfKind(stats.kinds, kind) || "—";

  const seriesOfKind = stats.seriesOf(kind);
  const buckets = seriesOfKind.map((s) => s.bucket);
  const values = seriesOfKind.map((s) => s.tce);
  /*
   * 峰谷在图内算，不依赖 hook 的 elecPeak/elecTrough ——
   * 那是上一版为"电能"单独算的，换成任何品种就失效了。
   * 最低值排除 0：数据断档那天的用量是 0，取 min 会得到
   * 「最低 0」，看着像那天没用电，其实可能是没数据。
   */
  const nonZero = seriesOfKind.filter((s) => s.tce > 0);
  const peak = seriesOfKind.length ? seriesOfKind.reduce((a, b) => (b.tce > a.tce ? b : a)) : null;
  const trough = nonZero.length ? nonZero.reduce((a, b) => (b.tce < a.tce ? b : a)) : null;

  const option = useMemo(() => {
    /*
     * 峰谷标注钉在柱子上，而不是在图外写一行字 ——
     * 写字的话人多半对不上是哪根柱。
     * 最低值排除 0（见 useSiteEnergyStats 里 elecTrough 的说明）。
     */
    const markPointData = [
      peak
        ? { name: "最高", coord: [peak.bucket, peak.tce], value: compactNumber(peak.tce) }
        : null,
      trough
        ? { name: "最低", coord: [trough.bucket, trough.tce], value: compactNumber(trough.tce) }
        : null,
    ].filter(Boolean);

    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => `${compactNumber(v)} ${kindUnit}`,
      },
      grid: { left: 32, right: 12, top: 26, bottom: 22 },
      xAxis: {
        type: "category",
        data: buckets,
        axisLabel: { fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: kindUnit,
        nameTextStyle: { fontSize: 9 },
        splitNumber: 3,
        /* 大数值轴标签用紧凑写法，否则 1000000 这种会把绘图区挤扁 */
        axisLabel: { fontSize: 10, formatter: (v: number) => compactNumber(v) },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 26,
          itemStyle: { borderRadius: [2, 2, 0, 0] },
          markPoint: markPointData.length
            ? {
                symbolSize: 44,
                label: { fontSize: 9, formatter: (p: { value: string }) => p.value },
                data: markPointData,
              }
            : undefined,
        },
      ],
    };
    /*
     * `kindUnit` 必须进依赖：切品种时若两个品种的桶名与数值恰好相同
     * （比如水和气都是同样的 6 个日期、同样的读数），只靠 buckets/values
     * 判断不出变化，图上的单位还停在旧品种。
     */
  }, [peak, trough, buckets.join("|"), values.join("|"), kindUnit]);

  if (!seriesOfKind.length) {
    /*
     * 有其它品种但缺这个品种 —— 要说清是「没有该品种计量」，
     * 而不是沿用 pendingReason（那句是「该场站暂无能耗数据」，不符合事实：
     * 场站有数据，只是没有这一种）。
     */
    if (stats.kinds.length) {
      return (
        <EnergyPending
          title={`该场站没有${kindName}计量`}
          detail={`范围内没有可读的${kindName}表，趋势无法统计`}
        />
      );
    }
    return pendingReason(stats);
  }

  return (
    <div className={styles.energyTrendRow}>
      {/*
       * ★ 左侧大数字已移除（2026-11-23 客户要求）。
       *
       * <p>客户原话：「把右侧第 2 个场站用电趋势内部去掉左侧的数字」。
       *
       * <p>那张卡当时已经移到左翼第 2 位，但内部的「62.51万 kW·h + 电能用量」
       * 仍占着左边一列 —— 卡宽只有 326px 时，图表只剩一半宽度（实测 167/295）。
       * 而且它与**同一列的上一张卡**（场站用电量）显示的是同一个总量，
       * 等于同一屏里同一个数字出现两次。
       *
       * <p>去掉后图表横跨整卡。总量没丢：上一张卡就是它，且图表本身
       * 逐桶可读，右侧还有粒度切换（时/日/月/年）。
       */}
      {/*
       * 粒度切换放在卡片正文里，而不是卡片标题栏 ——
       * 标题栏由 WidgetOverlay 统一渲染，从 Body 里改不到它。
       */}
      <div className={styles.granSwitch} data-testid={`energy-gran-${widget.id}`}>
        {ENERGY_GRANULARITIES.map((item) => (
          <button
            key={item.value}
            type="button"
            className={item.value === gran ? styles.granBtnActive : styles.granBtn}
            title={item.hint}
            onClick={(event) => {
              /* 阻止冒泡：卡片本身有 onClick（编辑态选中），会抢走点击 */
              event.stopPropagation();
              onGranChange(item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <ReactECharts
        className={styles.chart}
        style={{ height: "100%", width: "100%" }}
        option={option}
      />
    </div>
  );
}

/* ==================================================================== */
/* =========================== ③ 排名卡 =============================== */
/* ==================================================================== */

/**
 * 设备用电量排名（横向条）。
 *
 * <p>复用 `bar-compare` 的视觉：名称 + 轨道 + 填充 + 数值。
 * 高低两端用不同颜色标出来 —— 客户要「最高最低耗电的数据可视化」，
 * 光排序不够，得让眼睛一眼扫到两端。
 */
/**
 * 用能分项占比（2026-11-23 替换「设备用电排名」）。
 *
 * <h2>为什么换掉设备排名</h2>
 *
 * <p>客户原话：「设备用电排行没有用，换一下维度统计」。
 *
 * <p>实测原因（比「没用」更严重）：那个排名把**不同物理量的表混在一起排**：
 *
 * ```
 * 正泰三相电表  61.31万 kW·h
 * 雅达三相电表   1.21万 kW·h
 * 热力表        12.59 GJ
 * 蒸汽表         2.99 t
 * ```
 *
 * <p>三行单位不同（kW·h / GJ / t），条长按原始数值算，于是
 * 「2.99 t 蒸汽」的条比「1.21万 kW·h 电」还长 —— **视觉上完全误导**。
 * 而且排的是计量表而不是机组，运维看不出任何可行动的结论。
 *
 * <h2>换成什么</h2>
 *
 * <p>用能分项占比。这是能源管理系统的标准维度，且**天然解决混单位问题**：
 * <ul>
 *   <li>条长按 `pct`（平台已按**折标煤**统一折算后的占比），
 *       不同品种可比；</li>
 *   <li>数值各自带自己的单位，不混算；</li>
 *   <li>折标煤 `tce` 作为副数值 —— 那是唯一能跨品种相加的量纲。</li>
 * </ul>
 *
 * <p>数据全部来自 `stats.kinds`（平台返回），不推导、不造数。
 */
export function EnergyKindBreakdownBody({
  widget,
  stats,
}: {
  widget: SceneWidget;
  stats: SiteEnergyStats;
}) {
  const rows = useMemo(() => {
    /*
     * 只保留有用量的品种。`usage > 0` 而不是 `>= 0`：
     * 某品种装了表但一直没数据时 usage 是 0，列出来会让占比条全是 0 宽，
     * 看起来像界面坏了。
     */
    return [...stats.kinds].filter((k) => k.usage > 0).sort((a, b) => b.pct - a.pct);
  }, [stats.kinds]);

  if (!rows.length) return pendingReason(stats);

  /*
   * 条长基数用 pct，但 pct 之和可能不是 100（平台按折标煤折算，
   * 有个别品种份额极小被舍入）。用最大值归一，保证最长的占满轨道 ——
   * 直接除以 100 会让所有条都只有一半长度，看起来像"都没用能"。
   */
  const maxPct = Math.max(...rows.map((r) => r.pct), 1);

  return (
    <div className={styles.barCompare} data-testid={`energy-breakdown-${widget.id}`}>
      {rows.map((row, index) => (
        <div className={styles.barRow} key={row.code} data-rank={index + 1 <= 3 ? String(index + 1) : undefined}>
          {/*
           * 品种名（电能 / 热力 / 蒸汽）—— 这是可行动的信息：
           * 「热力占了快三成」比「某某电表排第一」有意义得多。
           */}
          <span className={styles.barName} title={`${row.name}：${compactNumber(row.usage)} ${row.unit}（折标煤 ${formatMetricNumber(row.tce)} tce）`}>
            {row.name}
          </span>
          <span className={styles.barTrack}>
            <i
              className={styles.barFill}
              style={{ width: `${Math.max(2, (row.pct / maxPct) * 100)}%` }}
            />
          </span>
          <b>
            {compactNumber(row.usage)}
            <i>{row.unit}</i>
          </b>
        </div>
      ))}
      {/*
       * 合计行：把「折标煤合计」写出来。
       *
       * <p>这是跨品种唯一能相加的量纲。没有它，用户看到「电 62.51万 kW·h、
       * 热 12.59 GJ、蒸汽 2.99 t」无法判断总量到底多少。
       */}
      <div className={styles.breakdownTotal} data-testid="energy-breakdown-total">
        <span>合计折标煤</span>
        <b>
          {formatMetricNumber(stats.kpi.tce)}
          <i>tce</i>
        </b>
      </div>
    </div>
  );
}
