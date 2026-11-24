
import { useEffect, useMemo, useState } from "react";
import { EngineManager } from "../core/EngineManager";
import type { DevicePlate } from "../../utils/device-plates";
import { visibleDevicePlates } from "../../utils/selectable-node";
import styles from "./EngineViewport.module.css";

export type DeviceLabelItem = DevicePlate;

export function DeviceLabels({
  items,
  selectedNode,
  hoveredNode,
  onSelect,
  onHover,
}: {
  items: DeviceLabelItem[];
  selectedNode?: string | null;
  hoveredNode?: string | null;
  onSelect?: (node: string) => void;
  onHover?: (node: string | null) => void;
}) {
  const visible = useMemo(
    () => visibleDevicePlates(items, selectedNode, hoveredNode),
    [items, selectedNode, hoveredNode],
  );
  const [placed, setPlaced] = useState<Array<DeviceLabelItem & { x: number; y: number }>>([]);

  useEffect(() => {
    if (visible.length === 0) {
      setPlaced([]);
      return;
    }
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 80) return;
      last = now;
      const next: Array<DeviceLabelItem & { x: number; y: number }> = [];
      for (const item of visible) {
        const screen = EngineManager.instance.worldToScreen(item.node);
        if (screen?.visible) next.push({ ...item, x: screen.x, y: screen.y });
      }
      setPlaced(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  return (
    <>
      <div
        data-testid="device-plates-meta"
        data-item-count={items.length}
        data-visible-count={visible.length}
        data-placed-count={placed.length}
        hidden
      />
      {placed.length === 0 ? null : (
        <div className={styles.labels} data-testid="device-plates">
          {placed.map((item) => (
            <div
              key={item.node}
              data-testid="device-plate"
              data-node={item.node}
              data-bound={item.bound ? "true" : "false"}
              data-kind={item.kind}
              data-running={item.running === null ? "" : item.running ? "true" : "false"}
              data-status={item.status}
              data-fault-code={item.faultCode ?? ""}
              className={`${styles.tag} ${item.kind === "badge" ? styles.tagBadge : ""} ${item.bound ? styles.tagBound : styles.tagMuted} ${selectedNode === item.node ? styles.tagSelected : ""}`}
              style={{ transform: `translate(${item.x}px, ${item.y}px) translate(-50%, calc(-100% - 8px))` }}
              onClick={() => onSelect?.(item.node)}
              onMouseEnter={() => onHover?.(item.node)}
              onMouseLeave={() => onHover?.(null)}
            >
              <div className={styles.tagTitle}>
                <span>{item.title}</span>
                {/*
                 * 状态徽标（2026-11-23 改）。
                 *
                 * <p>原来只有「运行 / 停止」两种（看 `running` 布尔）。
                 * 客户要求「铭牌上也要提示」—— 关键是**故障**：
                 * 故障停机与正常停机在旧模型里长得一模一样，
                 * 而现场最需要分辨的就是这两种。
                 *
                 * <p>状态来自 `item.status`（与列表、 3D 染色同一套枚举），
                 * 不在渲染层重新判一次 —— 两处判据一旦分叉，就会出现
                 * 「列表写故障、铭牌写停止」。
                 */}
                {item.status === "running" ? <span className={styles.tagRun}>运行</span> : null}
                {item.status === "stopped" ? <span className={styles.tagStop}>停止</span> : null}
                {item.status === "fault" ? (
                  <span className={styles.tagFault}>
                    故障{item.faultCode ? ` ${item.faultCode}` : ""}
                  </span>
                ) : null}
                {item.status === "offline" ? <span className={styles.tagStop}>离线</span> : null}
              </div>
              {item.lines.map((line) => (
                <div key={line.label} className={`${styles.tagLine} ${line.missing ? styles.tagMissing : ""}`}>
                  <span>{line.label}</span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
