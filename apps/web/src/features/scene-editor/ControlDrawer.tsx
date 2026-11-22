import type { NameplateCommandState } from "../../hooks/useNameplateCommands";
import type { ControlDrawerModel } from "../../utils/control-drawer";
import { DRAWER_COPY, drawerControlContent } from "../../utils/control-drawer";
import styles from "./ControlDrawer.module.css";

export function ControlDrawer({
  open,
  model,
  commands,
  busy,
  onStart,
  onStop,
  onToggle,
}: {
  open: boolean;
  model: ControlDrawerModel;
  commands?: NameplateCommandState;
  busy?: string | null;
  onStart?: () => void;
  onStop?: () => void;
  onToggle?: () => void;
}) {
  const controls = drawerControlContent(model.mode);
  return (
    <div
      className={`${styles.drawer} ${open ? "" : styles.collapsed}`}
      data-testid="control-drawer"
      data-open={open ? "true" : "false"}
      data-mode={model.mode}
      data-controls={controls}
    >
      <button type="button" className={styles.handle} aria-label={open ? "收起控制面板" : "展开控制面板"} onClick={onToggle} />
      <div className={styles.body}>
        <div className={styles.row}>
          <div className={styles.group}>
            <span className={styles.lab}>设备控制</span>
            {controls === "no-start-stop" ? (
              <span className={styles.note}>{model.startStopNote ?? DRAWER_COPY.noStartStop}</span>
            ) : controls === "start-stop" ? (
              <>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.start}`}
                  disabled={!commands?.start.enabled}
                  title={commands?.start.reason}
                  data-reason={commands?.start.reason ?? ""}
                  onClick={() => commands?.start.enabled && onStart?.()}
                >
                  {busy?.endsWith(":start") ? "…" : "启动"}
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.stop}`}
                  disabled={!commands?.stop.enabled}
                  title={commands?.stop.reason}
                  data-reason={commands?.stop.reason ?? ""}
                  onClick={() => commands?.stop.enabled && onStop?.()}
                >
                  {busy?.endsWith(":stop") ? "…" : "停止"}
                </button>
              </>
            ) : null}
            <span className={`${styles.name} ${model.title === DRAWER_COPY.unselected ? styles.dim : ""}`}>{model.title}</span>
          </div>
          <div className={`${styles.group} ${styles.grow}`}>
            <span className={styles.lab}>设备数据</span>
            <span className={`${styles.val} ${model.bound ? "" : styles.dim}`}>{model.dataSummary}</span>
          </div>
        </div>
        <div className={styles.row}>
          <span className={styles.lab}>运行状态</span>
          <div className={styles.chips}>
            {model.chips.length === 0 ? (
              <span className={styles.chip}>
                <i />
                {DRAWER_COPY.emptyChip}
              </span>
            ) : (
              model.chips.map((chip) => (
                <span key={chip.id} className={`${styles.chip} ${chip.active ? styles.chipOn : ""}`}>
                  <i />
                  {chip.label} {chip.value}
                </span>
              ))
            )}
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
