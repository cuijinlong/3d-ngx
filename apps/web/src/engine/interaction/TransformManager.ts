import type { Entity, Application } from "playcanvas";
import type { TransformTool } from "../../stores/editor.store";

/**
 * 变换编辑已收口：产品不是场景编辑器，不再把 gizmo 挂到 GLB 节点上。
 * 保留此类以免旧引用中断，方法都是空操作。
 */
export class TransformManager {
  attach(
    _app: Application,
    _entity: Entity | null,
    _tool: TransformTool,
    _coord: "local" | "world",
    _onChange?: (nodeName: string) => void,
  ): void {}

  applyTool(_tool: TransformTool, _coord: "local" | "world"): void {}

  setSnap(_enabled: boolean, _size: number): void {}

  detach(): void {}

  destroy(): void {}
}
