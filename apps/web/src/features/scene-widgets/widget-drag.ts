import type { SceneWidget, SceneWidgetLayout } from "@idt/data-adapter";

export type WidgetDragPhase = "move" | "up" | "cancel";

/** 编排拖拽只在 pointerup 写入 store / localStorage，移动过程只更新预览。 */
export function shouldPersistWidgetDrag(phase: WidgetDragPhase): boolean {
  return phase === "up";
}

export function previewDragLayout(
  layout: SceneWidgetLayout,
  id: string,
  rect: Pick<SceneWidget, "x" | "y" | "w" | "h">,
): SceneWidgetLayout {
  return {
    ...layout,
    widgets: layout.widgets.map((item) => (item.id === id ? { ...item, ...rect } : item)),
  };
}
