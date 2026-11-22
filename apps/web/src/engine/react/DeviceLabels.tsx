
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
              className={`${styles.tag} ${item.kind === "badge" ? styles.tagBadge : ""} ${item.bound ? styles.tagBound : styles.tagMuted} ${selectedNode === item.node ? styles.tagSelected : ""}`}
              style={{ transform: `translate(${item.x}px, ${item.y}px) translate(-50%, calc(-100% - 8px))` }}
              onClick={() => onSelect?.(item.node)}
              onMouseEnter={() => onHover?.(item.node)}
              onMouseLeave={() => onHover?.(null)}
            >
              <div className={styles.tagTitle}>
                <span>{item.title}</span>
                {item.kind === "board" && item.running === true ? <span className={styles.tagRun}>运行</span> : null}
                {item.kind === "board" && item.running === false ? <span className={styles.tagStop}>停止</span> : null}
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
