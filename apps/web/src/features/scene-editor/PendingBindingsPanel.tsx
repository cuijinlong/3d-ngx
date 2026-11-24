import {
  PENDING_ISSUE_LABELS,
  pendingBindingsOfLayout,
  pendingBindingsSummary,
  type PendingBindingItem,
  type SceneWidgetLayout,
} from "@idt/data-adapter";
import styles from "./BindingConfigDrawer.module.css";

/**
 * 待绑定清单（2026-11-23）。
 *
 * <h2>为什么单独一屏，不混进「画面卡片」核对</h2>
 *
 * 那个 tab 回答的是「我配的东西对不对」（已配置的复核），
 * 这个回答的是「我还差什么才能用」（未配置的待办）。
 * 两者的动作方向相反：前者是纠错，后者是补全。
 * 混在一起会让「3 块未配置」和「2 处标红」看起来是同一类问题。
 *
 * <h2>点一项跳回那张卡</h2>
 *
 * 清单本身不能编辑 —— 配置入口在「画面卡片」里逐张卡配。
 * 这里只负责指路：点一行就选中那张卡，用户接着在那边补。
 * 不做「一键自动绑」：所选设备/测点必须先由人确认，自动挑一个是最容易绑错的。
 */
export function PendingBindingsPanel({
  layout,
  onFocusWidget,
}: {
  layout: SceneWidgetLayout | null;
  onFocusWidget?: (widgetId: string) => void;
}) {
  const report = pendingBindingsOfLayout(layout);

  if (report.total === 0) {
    return (
      <div className={styles.section} data-testid="pending-bindings">
        <p className={styles.empty}>
          这个布局没有需要配置的卡片。先选一个大屏模板，或手动加几张卡。
        </p>
      </div>
    );
  }

  return (
    <div className={styles.section} data-testid="pending-bindings">
      <div className={styles.actions}>
        {report.complete ? (
          <span className={styles.ok} data-testid="pending-summary">{pendingBindingsSummary(report)}</span>
        ) : (
          <span className={styles.bad} data-testid="pending-summary">{pendingBindingsSummary(report)}</span>
        )}
      </div>

      <div className={styles.progressTrack} aria-hidden>
        <i
          className={styles.progressFill}
          style={{ width: `${report.total ? Math.round((report.ready / report.total) * 100) : 0}%` }}
        />
      </div>

      {report.complete ? (
        <p className={styles.hint}>全部卡片已配置。可以发布，或到「画面卡片」复核具体绑定。</p>
      ) : (
        <p className={styles.hint}>
          下面是还不能出数的卡片。点一行跳到那张卡，在「画面卡片」里补绑定 ——
          设备与测点要人来选，这里不自动挑。
        </p>
      )}

      {report.items.map((item) => (
        <PendingRow key={item.widgetId} item={item} onFocus={onFocusWidget} />
      ))}
    </div>
  );
}

function PendingRow({
  item,
  onFocus,
}: {
  item: PendingBindingItem;
  onFocus?: (widgetId: string) => void;
}) {
  const slotNote = item.requiredSlots > 0 ? `测点 ${item.filledSlots}/${item.requiredSlots}` : "无需测点";
  return (
    <button
      type="button"
      className={styles.deviceItem}
      data-testid={`pending-binding-${item.widgetId}`}
      onClick={() => onFocus?.(item.widgetId)}
    >
      <span>{item.title}</span>
      <span className={styles.bad}>
        {item.issues.map((issue) => PENDING_ISSUE_LABELS[issue]).join("、")}
      </span>
      <span className={styles.hint}>
        {item.widgetType} · {slotNote}
      </span>
    </button>
  );
}
