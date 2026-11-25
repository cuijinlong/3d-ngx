import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getDataProvider, lookupFaultCodes } from "@idt/data-adapter";
import type { AlarmAssigneeList, AlarmRecord } from "@idt/shared-types";
import { useFaultCodes } from "../../hooks/useFaultCodes";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { formatDataAge } from "./widget-values";
import styles from "./WidgetOverlay.module.css";

/**
 * 告警详情弹层（2026-11-23）。
 *
 * <h2>为什么要有这一层</h2>
 *
 * <p>客户原话：「告警里面的每一条太复杂了，点击告警在出现类似TB的告警详情弹出层」。
 *
 * <p>第一版把手册的「原因 / 处理」直接铺在每条告警上，一条占 5~6 行。
 * 341px 高的卡片只放得下两条，其余全省略 —— 结果既看不全，
 * 每条又都读不完。**列表该给摘要，详情该在点开之后**：
 * 这是 TB 原生告警面板的做法，也是唯一能在窄栏里既放下条数又放下内容的排法。
 *
 * <h2>为什么用 portal 而不是在卡片内绝对定位</h2>
 *
 * <p>卡片有 `clip-path` 切角和 `overflow: hidden`（大屏皮肤的斜切角），
 * 弹层在里面会被裁掉一半 —— 而且不报错，只是看起来「弹层没弹出来」。
 * 挂到 `document.body` 下才能盖住整屏。
 *
 * <h2>操作：确认 / 清除 / 分配处理人</h2>
 *
 * <p>三者对应平台三个接口，且都**以平台回读为准**：
 * 操作成功后调 `refreshAlarms()` 重新拉列表，而不是在本地改状态。
 * 本地改会出现「界面说已确认、平台仍是未确认」—— 下一次轮询又变回去。
 */
export function AlarmDetailDialog({
  alarm,
  onClose,
}: {
  alarm: AlarmRecord;
  onClose: () => void;
}) {
  /*
   * 详情弹层知道是哪台设备，按型号拉 —— 比全量少拿无关条目。
   * 列表（AlarmList / TickerCard）**不能**这么传，它们跨设备。
   */
  const { dictionary } = useFaultCodes(true, alarm.deviceId);
  const refreshAlarms = useTelemetryStore((s) => s.refreshAlarms);
  const provider = getDataProvider();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<AlarmAssigneeList | null>(null);
  const [picked, setPicked] = useState<string>("");

  const entries = lookupFaultCodes(dictionary, alarm.message);

  /*
   * 处理人列表按需拉（只在弹层打开时）。
   *
   * <p>不在卡片挂载时拉：那会给每个大屏都发一次请求，而大多数时间
   * 没人点开详情。弹层打开才需要选人。
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!provider.listAlarmAssignees) return;
      const list = await provider.listAlarmAssignees().catch(() => null);
      if (alive && list) setAssignees(list);
    })();
    return () => {
      alive = false;
    };
  }, [provider]);

  /*
   * Esc 关闭。
   *
   * <p>大屏常用键盘操作，且弹层盖住整屏，没有 Esc 就只能找 X。
   * 只监听一次、卸载时摘掉 —— 漏摘会在切换告警时累积多个监听器。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (key: string, action: () => Promise<void>, doneMsg: string) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refreshAlarms();
      /*
       * 「清除」之后这条告警就不在活跃列表里了，弹层没有内容可看 ——
       * 必须关掉，否则用户面对一个已经不存在的告警发呆，
       * 还以为没生效。
       */
      if (key === "clear") onClose();
      else setBusy(null);
      console.info(`[告警] ${doneMsg}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const isAlarm = alarm.level === "alarm";
  const manual = entries[0];

  return createPortal(
    <div
      className={styles.alarmDialogMask}
      data-testid="alarm-detail-dialog"
      role="dialog"
      aria-modal="true"
      onClick={(event) => {
        /* 点遮罩关闭；点内容不关 —— 否则选人时点一下全没了 */
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.alarmDialog}>
        <header className={styles.alarmDialogHead}>
          <span className={`${styles.alarmDialogBadge} ${isAlarm ? styles.alarmDialogBadgeAlarm : ""}`}>
            {isAlarm ? "告警" : "预警"}
          </span>
          <span className={styles.alarmDialogTitle} title={alarm.message}>
            {alarm.message}
          </span>
          <button
            type="button"
            className={styles.alarmDialogClose}
            data-testid="alarm-detail-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className={styles.alarmDialogBody}>
          {/* ---------- 属性区（对应 TB 告警详情的属性表） ---------- */}
          <dl className={styles.alarmProps} data-testid="alarm-detail-props">
            <div>
              <dt>设备</dt>
              <dd>{alarm.deviceName || "—"}</dd>
            </div>
            <div>
              <dt>严重程度</dt>
              <dd className={isAlarm ? styles.alarmSeverityAlarm : styles.alarmSeverityWarn}>
                {isAlarm ? "严重（CRITICAL / MAJOR）" : "轻微（MINOR 及以下）"}
              </dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>
                {alarm.acknowledged ? "已确认" : "未确认"}
                {alarm.active === false ? " · 已清除" : " · 活跃"}
              </dd>
            </div>
            <div>
              <dt>发生时间</dt>
              <dd>
                {new Date(alarm.timestamp).toLocaleString("zh-CN", { hour12: false })}
                <span className={styles.alarmAge}>({formatDataAge(Date.now() - alarm.timestamp)}前)</span>
              </dd>
            </div>
            <div>
              <dt>故障码</dt>
              <dd className={styles.alarmCodes}>
                {entries.length
                  ? entries.map((entry) => entry.codes.join("/")).join("、")
                  : "告警文本中未识别到厂商码"}
              </dd>
            </div>
          </dl>

          {/* ---------- 手册区（客户要求「把设备手册的原型写在告警中」） ---------- */}
          <section className={styles.alarmManual} data-testid="alarm-detail-manual">
            <h4>设备手册 · 故障分析</h4>
            {manual ? (
              <>
                <p className={styles.alarmManualDesc}>{manual.desc}</p>
                {manual.analysis ? (
                  <p>
                    <b>原因</b>
                    {manual.analysis}
                  </p>
                ) : null}
                {manual.solution ? (
                  <p>
                    <b>处理</b>
                    {manual.solution}
                  </p>
                ) : null}
                {manual.source ? <p className={styles.alarmManualSrc}>出处：{manual.source}</p> : null}
              </>
            ) : (
              <p className={styles.alarmManualSrc}>
                当前告警文本中没有可识别的厂商故障码，未匹配到手册条目。
              </p>
            )}
          </section>

          {/* ---------- 分配处理人 ---------- */}
          {provider.assignAlarm ? (
            <section className={styles.alarmAssign} data-testid="alarm-detail-assign">
              <h4>指派处理人</h4>
              <div className={styles.alarmAssignRow}>
                <select
                  className={styles.alarmAssignSelect}
                  data-testid="alarm-assignee-select"
                  value={picked}
                  onChange={(event) => setPicked(event.target.value)}
                  disabled={!assignees?.users.length || busy != null}
                >
                  <option value="">选择处理人…</option>
                  {(assignees?.users ?? []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {/*
                       * 显示顺序：姓名 → 角色标签 → 邮箱。
                       *
                       * <p>2026-11-24 改：以前只有「姓名（邮箱）」，
                       * 而实际人员里有租户管理员与各客户的值班员，
                       * 光看邮箱分不出「这个人属于哪个客户」——
                       * 派错人在本系统里表现为「显示已派单、其实没人处理」。
                       *
                       * <p>角色标签用短的：租户管理员 / 客户用户。
                       * 写全「TENANT_ADMIN」现场没人看得懂。
                       */}
                      {user.name}
                      {user.authority === "TENANT_ADMIN" ? "（租户管理员）" : ""}
                      {user.authority === "CUSTOMER_USER" ? "（客户）" : ""}
                      {user.email && user.email !== user.name ? ` · ${user.email}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.alarmAssignBtn}
                  data-testid="alarm-assign-btn"
                  disabled={!picked || busy != null}
                  onClick={() =>
                    void run("assign", () => provider.assignAlarm!(alarm.id, picked), "已指派处理人")
                  }
                >
                  {busy === "assign" ? "指派中…" : "指派"}
                </button>
              </div>
              {assignees?.restricted ? (
                <p className={styles.alarmAssignNote} data-testid="alarm-assign-restricted">
                  {assignees.note}
                </p>
              ) : assignees && assignees.users.length === 0 ? (
                /*
                 * 不 restricted 但列表是空：说明接口通了、租户下确实没人。
                 * 这和「接口被拒」是两件事，不能共用一句提示 ——
                 * 前者要用户去建人，后者要管理员去看权限。
                 */
                <p className={styles.alarmAssignNote} data-testid="alarm-assign-empty">
                  租户下还没有可指派的人员。先在平台「用户管理」里添加账号。
                </p>
              ) : null}
            </section>
          ) : null}

          {error ? (
            <p className={styles.alarmDialogError} data-testid="alarm-detail-error">
              操作失败：{error}
            </p>
          ) : null}
        </div>

        <footer className={styles.alarmDialogFoot}>
          {provider.ackAlarm && !alarm.acknowledged ? (
            <button
              type="button"
              className={styles.alarmActionBtn}
              data-testid="alarm-detail-ack"
              disabled={busy != null}
              onClick={() => void run("ack", () => provider.ackAlarm!(alarm.id), "已确认告警")}
            >
              {busy === "ack" ? "确认中…" : "确认告警"}
            </button>
          ) : null}
          {provider.clearAlarm ? (
            <button
              type="button"
              className={`${styles.alarmActionBtn} ${styles.alarmActionDanger}`}
              data-testid="alarm-detail-clear"
              disabled={busy != null}
              onClick={() => void run("clear", () => provider.clearAlarm!(alarm.id), "已清除告警")}
            >
              {busy === "clear" ? "清除中…" : "清除告警"}
            </button>
          ) : null}
          <button type="button" className={styles.alarmActionBtn} onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
