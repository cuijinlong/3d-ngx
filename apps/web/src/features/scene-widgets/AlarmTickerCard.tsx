import { useMemo, useState } from "react";
import type { SceneWidget } from "@idt/data-adapter";
import { extractFaultCodes, lookupFaultCodes } from "@idt/data-adapter";
import type { AlarmRecord } from "@idt/shared-types";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { useFaultCodes } from "../../hooks/useFaultCodes";
import { formatDataAge } from "./widget-values";
import { AlarmDetailDialog } from "./AlarmDetailDialog";
import styles from "./WidgetOverlay.module.css";

/**
 * 告警跑马灯（2026-11-23）。
 *
 * <h2>为什么不复用 `AlarmList`</h2>
 *
 * <p>`AlarmList` 是 **antd 组件**（List / Tag / Button），为侧边抽屉设计的：
 * 每行带「确认 / 清除」按钮、行高固定、内容不滚动。放到大屏上三个问题：
 * <ol>
 *   <li>大屏是**只读监视**视图，处置按钮该在运维页，不该在值班大屏 ——
 *       误点一下就把告警清掉了，而且大屏往往无人值守；</li>
 *   <li>antd 的 List 在 326px 宽的深色卡里样式不协调（浅色底、圆角、字重）；</li>
 *   <li>跑马灯要「自己往下走」，antd List 不提供这个行为。</li>
 * </ol>
 *
 * <h2>为什么把手册的故障分析直接铺在这</h2>
 *
 * <p>客户要求「把设备手册的原型写在告警中」。值班员看到 `TH702` 时，
 * 真正需要的是「这是什么、为什么、该查什么」—— 那个答案在厂商手册里，
 * 已经进了主数据字典（`faultCodes`）。把它显示在告警条目里，
 * 意味着看到告警的那一刻就知道怎么处理，不用再翻 PDF。
 *
 * <p>数据全部来自平台：告警列表来自 `getAlarms()`，故障说明来自字典接口。
 * 前端只做「按码匹配」和排版，不硬编码任何故障文本。
 *
 * <h2>为什么没有告警时也不隐藏</h2>
 *
 * <p>「当前无告警」是个**好消息**，必须能看见。整块消失会让值班员
 * 以为卡片坏了，反而去查一圈。空态给明确的正向提示。
 *
 * <h2>★ 最严重的常驻 + 其余跑马灯（客户要求）</h2>
 *
 * <p>纯跑马灯有个致命问题：**最要紧的那条会滚出视野**。值班员多数时间
 * 只是路过扫一眼屏幕，必须保证「最严重的那条一直在」。
 * 所以拆成两段：
 * <ul>
 *   <li><b>常驻区</b>：最严重的一条（告警优先于预警，同级取最新），不参与动画；</li>
 *   <li><b>滚动区</b>：其余条目向下循环滚动。</li>
 * </ul>
 *
 * <p>只有一条告警时不做动画 —— 让一条不动的告警来回滚是纯干扰。
 *
 * <h2>★ 条目只保留摘要，详情点开看（2026-11-23 改）</h2>
 *
 * <p>客户原话：「告警里面的每一条太复杂了，点击告警在出现类似TB的告警详情弹出层」。
 *
 * <p>上一版把手册的「原因 / 处理」铺在每条上，一条 5~6 行 ——
 * 341px 高的卡片只装得下两条，其余全被截。现在每条只留
 * 「等级 + 设备 + 故障码 + 时间 + 一句描述」，点开才展开完整手册、
 * 属性和处置操作。列表负责「看到有哪些」，弹层负责「这一条怎么回事」。
 */

/** 等级筛选项。`all` 是默认，最常用的入口。 */
export type LevelFilter = "all" | "alarm" | "warning";

/**
 * 从已按时间降序的告警里，拆出「常驻的一条」与「其余滚动条目」（2026-11-23）。
 *
 * <h2>为什么抽成纯函数</h2>
 *
 * <p>「最严重的常驻」是客户明确提的要求，而它有两处容易写错的地方，
 * 而且错了**不会报错、只能靠盯着屏幕发现**：
 *
 * <ol>
 *   <li>直接取 `filtered[0]` —— 那是「最新」，不是「最严重」。
 *       一条 5 分钟前的预警会压住一小时前的告警；</li>
 *   <li>忘了把常驻那条从滚动列表里去掉 —— 同一条会在屏上出现两遍，
 *       而两遍的内容还没滚动到不同步的位置，看起来像两条独立告警。</li>
 * </ol>
 *
 * <p>单测把这两种错法都钉住。
 */
export function splitPinned<T extends { alarm: { level: "warning" | "alarm" } }>(
  rows: T[],
  filter: LevelFilter,
): { pinned: T | null; rest: T[] } {
  const filtered = filter === "all" ? rows : rows.filter((row) => row.alarm.level === filter);
  if (!filtered.length) return { pinned: null, rest: [] };
  /* 告警优先于预警；同级取第一个（入参已按时间降序，即最新） */
  const pinned = filtered.find((row) => row.alarm.level === "alarm") ?? filtered[0]!;
  return { pinned, rest: filtered.filter((row) => row !== pinned) };
}

/** 一条告警 + 它命中的手册条目。 */
interface TickerRow {
  alarm: AlarmRecord;
  codes: string[];
  entries: ReturnType<typeof lookupFaultCodes>;
}

export function AlarmTickerCardBody({ widget }: { widget: SceneWidget }) {
  const alarms = useTelemetryStore((s) => s.alarms);
  const { dictionary } = useFaultCodes();
  /*
   * 等级筛选状态。
   *
   * <p>放在组件本地而不是布局配置：这是**看的人当下**想收窄视野的操作，
   * 不是屏的设计。存进布局会让下一个打开大屏的人继承上一个值班员
   * 的临时筛选，看到「告警 1 条」而不知道还有预警被藏起来了。
   */
  const [filter, setFilter] = useState<LevelFilter>("all");
  /*
   * 当前点开的告警。存 **alarm id** 而不是整条对象：
   * 平台刷新后对象会换新引用，存对象会让弹层停在旧数据上
   * （处理人改了、状态改了都看不到）。
   */
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * 只显示活跃告警，最新在前。
   *
   * <p>已恢复（`active=false`）的告警留在列表里会让大屏长期显示旧故障 ——
   * 值班员会以为问题还在。平台的活跃列表通常已经过滤，这里再兜一道：
   * 两个数据源（mock / guard）的过滤口径可能不一致。
   */
  const rows = useMemo<TickerRow[]>(() => {
    return [...alarms]
      .filter((item) => item.active !== false)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((alarm) => {
        const codes = extractFaultCodes(alarm.message);
        return { alarm, codes, entries: lookupFaultCodes(dictionary, alarm.message) };
      });
  }, [alarms, dictionary]);

  /* 各等级条数 —— 筛选按钮上要显示，值班员据此判断「有没有被筛掉的」。 */
  const counts = useMemo(() => {
    let alarm = 0;
    let warning = 0;
    for (const row of rows) {
      if (row.alarm.level === "alarm") alarm += 1;
      else warning += 1;
    }
    return { all: rows.length, alarm, warning };
  }, [rows]);

  const { pinned, rest } = useMemo(() => splitPinned(rows, filter), [rows, filter]);

  /*
   * 点开的那条 —— **每次从 rows 里按 id 重取**，不存对象快照。
   *
   * <p>平台刷新后（确认、指派、别人处理）对象会换新引用。存快照会让弹层
   * 停在旧数据上：状态写着「未确认」而平台已经确认了，用户会重复点。
   *
   * <p>顺带一个好处：告警被清除后它不在 `rows` 里，`opened` 自动变 null，
   * 弹层自己关闭，不会停在一个已不存在的告警上。
   */
  const opened = useMemo(
    () => (openId ? rows.find((row) => row.alarm.id === openId)?.alarm ?? null : null),
    [openId, rows],
  );

  /* 卡片标题可覆盖条数上限，默认 6 条 —— 再多滚一圈太久，值班员读不完。 */
  const limit = widget.alarmLimit && widget.alarmLimit > 0 ? widget.alarmLimit : 6;
  const restShown = rest.slice(0, Math.max(0, limit - 1));

  /*
   * 滚动只在「其余条目超出一屏」时开。
   *
   * <p>一条做无限滚动会变成一段反复横跳的动画，比不动更烦人。
   * 判据用条数而不是高度：卡片高度由布局决定，JS 里量高度还要
   * 等一帧、还要处理 resize —— 换不来更好的效果。
   */
  const scrolling = restShown.length > 1;
  /*
   * 无缝循环：把列表再复制一份接在后面。
   *
   * <p>`translateY(-50%)` 正好走到副本开头，此刻列表首尾相接，
   * 视觉上察觉不到跳变。不复制的话走到末尾会「闪」回顶部。
   */
  const loop = scrolling ? [...restShown, ...restShown] : restShown;

  /*
   * ★ 空态与全部 hook 之后。
   *
   * <p>这个组件里 `useState` / `useMemo` 都在上面无条件调用完了，
   * 早退放这里安全。上一轮 `EnergyMetricBody` 就是把两个 useMemo
   * 写在早退之后，导致首屏正常、数据到达即崩（详见 §14.4）。
   */
  if (!pinned) {
    return (
      <div className={styles.tickerWrap} data-testid="alarm-ticker">
        {rows.length ? (
          /*
           * 有告警但被筛掉了 —— 必须说清「是筛掉了，不是没有」。
           * 否则用户切到「告警」看到空白，会以为告警自己消失了。
           */
          <FilterBar filter={filter} counts={counts} onChange={setFilter} />
        ) : null}
        <div className={styles.tickerEmpty} data-testid="alarm-ticker-empty">
          <span className={styles.tickerOkMark} aria-hidden>✓</span>
          <div className={styles.tickerOkTitle}>
            {rows.length ? "该等级下没有告警" : "当前无活跃告警"}
          </div>
          <div className={styles.tickerOkDetail}>
            {rows.length
              ? `共 ${rows.length} 条其他等级告警，点上方「全部」查看`
              : "设备运行正常，告警规则未触发"}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tickerWrap} data-testid="alarm-ticker">
      <FilterBar filter={filter} counts={counts} onChange={setFilter} />
      {/*
       * 常驻区：最严重的那条。不参与动画 ——
       * 客户原话「把最严重的常驻」，滚动的信息看漏了还有它兜底。
       */}
      <div
        className={styles.tickerPinned}
        data-testid="alarm-ticker-pinned"
        data-level={pinned.alarm.level}
      >
        <AlarmTickerItem row={pinned} onOpen={setOpenId} />
      </div>
      {restShown.length ? (
        <div className={styles.tickerScrollArea} data-testid="alarm-ticker-scroll-area">
          <div
            className={`${styles.tickerTrack} ${scrolling ? styles.tickerScroll : ""}`}
            /*
             * 时长按条数算（每条约 4 秒）。固定时长会让「2 条」慢得发指、
             * 「6 条」快得看不清。4 秒是实测「一行小字读完」的下限。
             */
            style={scrolling ? { animationDuration: `${restShown.length * 4}s` } : undefined}
            data-testid="alarm-ticker-track"
          >
            {loop.map((row, index) => (
              <AlarmTickerItem key={`${row.alarm.id}-${index}`} row={row} onOpen={setOpenId} />
            ))}
          </div>
          {scrolling ? <div className={styles.tickerFadeTop} aria-hidden /> : null}
        </div>
      ) : null}
      {/*
       * 详情弹层（2026-11-23）。portal 渲染到 body，
       * 不受卡片 clip-path / overflow 裁剪。
       */}
      {opened ? <AlarmDetailDialog alarm={opened} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

/** 等级筛选条（右上角）。计数写在按钮里 —— 一眼看出有没有被筛掉的。 */
function FilterBar({
  filter,
  counts,
  onChange,
}: {
  filter: LevelFilter;
  counts: { all: number; alarm: number; warning: number };
  onChange: (next: LevelFilter) => void;
}) {
  const items: Array<{ key: LevelFilter; label: string; count: number }> = [
    { key: "all", label: "全部", count: counts.all },
    { key: "alarm", label: "告警", count: counts.alarm },
    { key: "warning", label: "预警", count: counts.warning },
  ];
  return (
    <div className={styles.tickerToolbar} data-testid="alarm-ticker-filter">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={item.key === filter ? styles.tickerFilterActive : styles.tickerFilterBtn}
          data-testid={`alarm-filter-${item.key}`}
          data-active={item.key === filter ? "true" : "false"}
          /* 计数为 0 的等级仍然可点 —— 点进去看到空态，比按钮消失更好理解 */
          onClick={(event) => {
            event.stopPropagation();
            onChange(item.key);
          }}
        >
          {item.label}
          <b>{item.count}</b>
        </button>
      ))}
    </div>
  );
}

function AlarmTickerItem({
  row,
  onOpen,
}: {
  row: TickerRow;
  onOpen: (alarmId: string) => void;
}) {
  const { alarm, codes, entries } = row;
  const isAlarm = alarm.level === "alarm";
  /*
   * 摘要只取手册的**一句描述**（`desc`），不铺原因/处理 ——
   * 那两段在 357px 宽的卡里一行放不下，会撑到 5~6 行。
   * 客户要求「条目别太复杂，点开看详情」，所以这里只给「这条是什么」。
   *
   * <p>字典没加载完 / 码不在字典里时退回告警原文 —— 不能因为
   * 「查不到手册」就不显示告警本身。
   */
  const summary = entries[0]?.desc ?? alarm.message;

  return (
    <button
      type="button"
      className={`${styles.tickerItem} ${isAlarm ? styles.tickerItemAlarm : styles.tickerItemWarn}`}
      data-testid="alarm-ticker-item"
      data-level={alarm.level}
      data-ack={alarm.acknowledged ? "true" : "false"}
      title={`${alarm.message} —— 点击查看详情`}
      onClick={(event) => {
        /*
         * 阻止冒泡：卡片本身有 onClick（编辑态选中），
         * 不拦的话点告警会把整块部件选中，弹层一闪就没了。
         */
        event.stopPropagation();
        onOpen(alarm.id);
      }}
    >
      <div className={styles.tickerHead}>
        <span className={styles.tickerBadge}>{isAlarm ? "告警" : "预警"}</span>
        <span className={styles.tickerDevice}>{alarm.deviceName}</span>
        {codes.length ? (
          <span className={styles.tickerCode}>{codes.join(" / ")}</span>
        ) : null}
        <span className={styles.tickerAge}>{formatDataAge(Date.now() - alarm.timestamp)}前</span>
        {alarm.acknowledged ? (
          <span className={styles.tickerAck}>已确认</span>
        ) : null}
      </div>
      <div className={styles.tickerDesc}>{summary}</div>
    </button>
  );
}
