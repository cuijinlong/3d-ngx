import { useEffect, useMemo, useState } from "react";
import type { NameplateCommandState, NameplateNumericState } from "../../hooks/useNameplateCommands";
import type { ControlDrawerModel } from "../../utils/control-drawer";
import { DRAWER_COPY, drawerControlContent } from "../../utils/control-drawer";
import {
  clampWire,
  formatRangeValue,
  fromWire,
  initialWireValue,
  toWire,
} from "../../utils/control-range";
import styles from "./ControlDrawer.module.css";

/**
 * 底部设备抽屉（2026-11-23 改版）。
 *
 * <h2>这一版改了什么</h2>
 *
 * <p>客户原话：「设备控制中如果只有启停，那么就做成大圆按钮绿色和红色的。
 * 如果是控制开度的那么看文档是接收什么数字，然后做成形象的按钮」。
 *
 * <p>原来启停是 24px 的小胶囊按钮，混在一行文字里，在现场（隔着 3 米看大屏）
 * 根本点不准也不显眼。现在：
 * <ul>
 *   <li><b>只有启停</b> → 两颗直径 56px 的圆钮，绿=启动、红=停止；</li>
 *   <li><b>有数值控制</b>（开度/设定点）→ 圆钮 + 滑块，滑块上直接显示
 *       人类单位（`70 %` / `20.0 ℃`），下发时换算成协议整数。</li>
 * </ul>
 *
 * <h3>为什么圆钮不做「一个按钮来回切」</h3>
 *
 * <p>做成「一个按钮来回切」看着省地方，但现场后果很重：运行中再点一下就停机，
 * 而操作员很可能只是想「确认一下它在运行」。两颗独立按钮各自有明确语义，
 * 误触的成本从「停了一台机」降到「点了没反应」。
 */
export function ControlDrawer({
  open,
  model,
  commands,
  numericCurrent,
  busy,
  onStart,
  onStop,
  onNumeric,
  onToggle,
}: {
  open: boolean;
  model: ControlDrawerModel;
  commands?: NameplateCommandState;
  /**
   * 数值控制的**当前协议值**（如开度 65）。
   *
   * <p>由上层从遥测读出来传进来 —— 抽屉自己不查遥测，
   * 保持它是纯展示组件（可单测、可复用）。
   */
  numericCurrent?: number | null;
  busy?: string | null;
  onStart?: () => void;
  onStop?: () => void;
  /** 参数是**已换算好的协议整数**，由本组件用 `toWire` 算。 */
  onNumeric?: (wireValue: number) => void;
  onToggle?: () => void;
}) {
  const controls = drawerControlContent(model.mode);
  /*
   * 只有启停 = 大圆按钮；有数值控制 = 圆钮 + 滑块。
   * `commands?.numeric` 为 null 时说明这台设备没有数值型命令。
   */
  const numeric = commands?.numeric ?? null;
  const startDisabled = !commands?.start.enabled;
  const stopDisabled = !commands?.stop.enabled;

  return (
    <div
      className={`${styles.drawer} ${open ? "" : styles.collapsed}`}
      data-testid="control-drawer"
      data-open={open ? "true" : "false"}
      data-mode={model.mode}
      data-controls={controls}
      data-has-numeric={numeric ? "true" : "false"}
    >
      <button type="button" className={styles.handle} aria-label={open ? "收起控制面板" : "展开控制面板"} onClick={onToggle} />
      <div className={styles.body}>
        <div className={styles.row}>
          <div className={styles.group}>
            <span className={styles.lab}>设备控制</span>
            {controls === "no-start-stop" ? (
              <span className={styles.note}>{model.startStopNote ?? DRAWER_COPY.noStartStop}</span>
            ) : controls === "start-stop" ? (
              /*
               * 两颗独立圆钮。运行中时「启动」禁用而不是隐藏 ——
               * 隐藏会让操作员以为这台没有启动能力。
               */
              <div className={styles.roundBtns}>
                <button
                  type="button"
                  className={`${styles.roundBtn} ${styles.roundStart}`}
                  disabled={startDisabled}
                  title={commands?.start.reason ?? "启动该设备"}
                  data-reason={commands?.start.reason ?? ""}
                  data-testid="drawer-start"
                  onClick={() => commands?.start.enabled && onStart?.()}
                >
                  <span className={styles.roundGlyph} aria-hidden>▶</span>
                  <span className={styles.roundText}>
                    {busy?.endsWith(":start") ? "…" : "启动"}
                  </span>
                </button>
                <button
                  type="button"
                  className={`${styles.roundBtn} ${styles.roundStop}`}
                  disabled={stopDisabled}
                  title={commands?.stop.reason ?? "停止该设备"}
                  data-reason={commands?.stop.reason ?? ""}
                  data-testid="drawer-stop"
                  onClick={() => commands?.stop.enabled && onStop?.()}
                >
                  <span className={styles.roundGlyph} aria-hidden>■</span>
                  <span className={styles.roundText}>
                    {busy?.endsWith(":stop") ? "…" : "停止"}
                  </span>
                </button>
              </div>
            ) : null}
            {numeric ? (
              <NumericControl
                numeric={numeric}
                current={numericCurrent ?? null}
                busy={busy?.endsWith(":numeric") ?? false}
                onCommit={onNumeric}
              />
            ) : null}
          </div>
          <div className={`${styles.group} ${styles.grow}`}>
            <span className={styles.lab}>设备数据</span>
            <span className={`${styles.val} ${model.bound ? "" : styles.dim}`}>{model.dataSummary}</span>
          </div>
        </div>
        {/*
         * 运行状态：**只亮当前那一个**（2026-11-23 客户要求）。
         *
         * <p>客户原话：「启停按钮下面运行状态就是属于那个状态那个亮就行了」。
         *
         * <p>改前这里是 chips 列表，同时给出「运行 1」「停止 0」两枚标签 ——
         * 两个都带底色，用户读不出「现在到底是哪个」。现在五态里只有一格：
         *
         * ```
         * 运行状态   [● 运行]   ← 只有它是亮的
         * ```
         *
         * <p>状态来源是 `model.status`（与列表圆点、3D 染色同源），
         * 不在渲染层另算一遍 —— 两处判据分叉就会出现
         * 「列表说故障、抽屉说运行」。
         */}
        <div className={styles.row}>
          <span className={styles.lab}>运行状态</span>
          <div className={styles.statusRow}>
            <span
              className={styles.statusPill}
              data-kind={model.status.kind}
              data-testid="drawer-status"
              title={model.status.faultCode ? `故障码 ${model.status.faultCode}` : model.status.label}
            >
              <i />
              {model.status.label}
              {model.status.faultCode ? <em>{model.status.faultCode}</em> : null}
            </span>
            {/*
             * 其余维度（故障/报警计数等）仍然用 chips 展示 ——
             * 它们不是「二选一」的状态，可以并存。
             * 运行/停止已从 chips 里剔掉（见 control-drawer.ts 的注释）。
             */}
            {model.chips.map((chip) => (
              <span key={chip.id} className={`${styles.chip} ${chip.active ? styles.chipOn : ""}`}>
                <i />
                {chip.label} {chip.value}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.kpis}>
          {model.kpis.map((kpi) => (
            <div key={kpi.id}>
              <span className={styles.lab}>{kpi.label}</span>
              <b className={kpi.dim ? styles.kpiDim : undefined}>{kpi.value}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 数值控制（开度 / 设定点）。
 *
 * <h2>★ 滑块用「显示值」，下发用「协议值」</h2>
 *
 * <p>滑块本身跑在人类单位上（`0~100 %`、`5.0~25.0 ℃`）—— 让操作员拖的就是
 * 他脑子里想的那个数。`step` 也按显示单位算（`range.step / range.scale`），
 * 否则 ×10 的设定点会「拖一格跳 10℃」。
 *
 * <p>下发那一刻才 `toWire` 换成协议整数。这个换算只发生在
 * `utils/control-range.ts` 一处，组件里不出现任何 `/10`。
 *
 * <h2>为什么「先拖、再确认」而不是拖动即下发</h2>
 *
 * <p>拖动过程连续触发 `onChange`。若边拖边发，一次拖动就是几十条 RPC ——
 * 网关侧会把命令队列打满（与本项目记录过的「模拟器把平台写入队列压满」同类）。
 * 所以拖动只改本地显示，松手才发一次。
 */
function NumericControl({
  numeric,
  current,
  busy,
  onCommit,
}: {
  numeric: NameplateNumericState;
  current: number | null;
  busy: boolean;
  onCommit?: (wireValue: number) => void;
}) {
  const { range } = numeric;
  /*
   * 初始值：优先设备当前值（读得到才有意义），读不到就落在范围中点。
   *
   * <p>落在最小值更「安全」，但看起来像「设备被设成了 0」，
   * 容易被误解为故障。
   */
  const initial = useMemo(
    () => fromWire(range, initialWireValue(range, current)),
    [range, current],
  );

  const [draft, setDraft] = useState(initial);

  /*
   * 外部值变化（设备真被改了 / 切到另一台设备）时同步草稿。
   *
   * <p>只在**显示值真的不同**时才覆盖：否则用户正拖着滑块，
   * 一次遥测刷新就把他的手势拽回去。
   */
  useEffect(() => {
    setDraft((prev) => (Math.abs(prev - initial) < 1e-9 ? prev : initial));
  }, [initial]);

  /* 显示单位的步长：协议 step 1 ÷ scale 10 = 0.1℃ */
  const displayStep = range.step / range.scale;
  const displayMin = fromWire(range, range.min);
  const displayMax = fromWire(range, range.max);
  const wireValue = toWire(range, draft);
  const changed = current == null || wireValue !== clampWire(range, current);

  return (
    <div className={styles.numeric} data-testid="drawer-numeric">
      <div className={styles.numericHead}>
        <span className={styles.numericLabel} title={range.hint}>
          {numeric.label || "设定值"}
        </span>
        <b className={styles.numericValue}>{formatRangeValue(range, wireValue)}</b>
      </div>
      <div className={styles.numericRow}>
        <input
          type="range"
          className={styles.numericSlider}
          data-testid="drawer-numeric-slider"
          min={displayMin}
          max={displayMax}
          step={displayStep}
          value={draft}
          disabled={!numeric.enabled || busy}
          onChange={(event) => setDraft(Number(event.target.value))}
          /*
           * 松手才发。`onChange` 在拖动过程中持续触发（移动端也是），
           * 用它下发会把命令队列打满。
           */
          onPointerUp={() => changed && onCommit?.(wireValue)}
          onKeyUp={(event) => {
            /* 键盘调整（方向键）没有 pointerup，用 keyup 兜住 */
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
              if (changed) onCommit?.(wireValue);
            }
          }}
        />
        <button
          type="button"
          className={styles.numericSend}
          data-testid="drawer-numeric-send"
          disabled={!numeric.enabled || busy || !changed}
          title={changed ? `下发 ${wireValue}（设备接收的原始数字）` : "当前值未改变"}
          onClick={() => onCommit?.(wireValue)}
        >
          {busy ? "…" : "下发"}
        </button>
      </div>
      {/*
       * 把协议原始值写出来。客户明确问「文档是接收什么数字」——
       * 让操作员当场能看到「70 % 对应下发 70」「20.0 ℃ 对应下发 200」，
       * 不必去翻手册或问开发。
       */}
      <div className={styles.numericHint} data-testid="drawer-numeric-wire">
        下发原始值：<b>{wireValue}</b>（范围 {range.min}~{range.max}）· {range.hint}
      </div>
      {!numeric.enabled && numeric.reason ? (
        <div className={styles.numericHint}>{numeric.reason}</div>
      ) : null}
    </div>
  );
}
