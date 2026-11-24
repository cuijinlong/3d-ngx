import { useMemo, type ReactElement } from "react";
import ReactECharts from "echarts-for-react";
import type { SceneWidget } from "@idt/data-adapter";
import { formatMetricNumber } from "../../utils/device-plates";
import { displayNameOf } from "../../utils/display-name";
import {
  ENERGY_GRANULARITIES,
  type EnergyGranularity,
  type EnergyKindRow,
  type SiteEnergyStats,
} from "../../hooks/useSiteEnergyStats";
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
 */
function kpiFontSize(text: string): number {
  const len = text.length;
  if (len <= 4) return 40;
  if (len <= 6) return 31;
  if (len <= 8) return 25;
  if (len <= 10) return 21;
  return 17;
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
}: {
  widget: SceneWidget;
  stats: SiteEnergyStats;
}) {
  const metric = energyMetricOf(widget);

  const kind = energyKindOf(widget);

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
        sideLabel: "折标煤",
        sideText: `${formatMetricNumber(stats.kpi.tce)} tce`,
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

  if (!view.hasData) {
    return <EnergyPending title={view.emptyTitle} detail={view.emptyDetail} />;
  }

  /*
   * 文字长度决定字号 —— 用 `compactNumber` 之后的结果算，
   * 而不是原始数值：`913400` 会被压成 `91.34万`（6 个字符），
   * 按 7 位数字去缩字号就白缩了。
   */
  const mainText = compactNumber(view.value ?? 0);

  return (
    <div className={styles.energyKpi}>
      <div className={styles.energyKpiValue} style={{ fontSize: kpiFontSize(mainText) }}>
        {mainText}
        <span className={styles.energyKpiUnit}>{view.unit}</span>
      </div>
      <div className={styles.energyKpiLabel}>{view.label}</div>
      <div className={styles.energyKpiSide}>
        {view.sideLabel} {view.sideText}
      </div>
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

  const total = seriesOfKind.reduce((sum, s) => sum + s.tce, 0);

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
    <div className={styles.trendRow}>
      <div className={styles.trendKpi}>
        <b>
          {compactNumber(total)}
          <i>{kindUnit}</i>
        </b>
        <span>
          {kindName}用量 · {ENERGY_GRANULARITIES.find((g) => g.value === gran)?.hint ?? ""}
        </span>
      </div>
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
export function EnergyRankingBody({
  widget,
  stats,
}: {
  widget: SceneWidget;
  stats: SiteEnergyStats;
}) {
  const rows = useMemo(() => {
    /*
     * 只保留 counted 的（参与计量的）设备。
     * 虚拟设备 / 不计入合计的点位放进去会让排名失去意义 ——
     * 它们本来就不进 KPI。
     */
    const list = stats.devices.filter((d) => d.counted !== false && d.usage > 0);
    return [...list].sort((a, b) => b.usage - a.usage);
  }, [stats.devices]);

  if (!rows.length) return pendingReason(stats);

  const max = Math.max(...rows.map((r) => r.usage), 1);
  /*
   * `rows.length` 上面已经判过非空，但 TS 从数组下标拿不到收窄。
   * 用解构 + 早返回把类型定下来，比到处写 `!` 安全。
   */
  const [top, ...rest] = rows;
  if (!top) return pendingReason(stats);
  const bottom = rest.length ? rest[rest.length - 1] : null;

  return (
    <div className={styles.barCompare} data-testid={`energy-ranking-${widget.id}`}>
      {rows.slice(0, 8).map((row) => {
        const isTop = row.id === top.id;
        const isBottom = bottom != null && row.id === bottom.id;
        return (
          <div className={styles.barRow} key={row.id}>
            {/*
             * 命名铁律：显示 label（`正泰三相电表 DTSD3366D`），
             * 不是技术名（`PowerMeter-3P-CHINT·平台演示中心`）。
             * title 也用显示名 —— 悬停时不该冒出技术名。
             */}
            <span className={styles.barName} title={displayNameOf(row, row.id)}>
              {displayNameOf(row, row.id)}
            </span>
            <span className={styles.barTrack}>
              <i
                className={styles.barFill}
                style={{
                  width: `${Math.max(2, (row.usage / max) * 100)}%`,
                  /* 颜色用内联而不是新 CSS 类：只有「最高/最低」两种特例，
                     为它们各加一条规则会让这份样式表越来越难读 */
                  background: isTop ? "#e6a23c" : isBottom ? "#5b8ff9" : undefined,
                }}
              />
            </span>
            <b>
              {compactNumber(row.usage)}
              <i>{row.unit}</i>
            </b>
          </div>
        );
      })}
    </div>
  );
}
