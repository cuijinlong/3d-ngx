import type { ParsedHmiScene, SceneDocument } from "@idt/shared-types";
import { uniqueEntitiesFromParsed } from "./hmi-entities";
import { isNodeDescendant, resolveSceneEntity } from "./scene-entity";

const PART_SUFFIX = /(?:^|_)(control-panel|screen)(?:_|$)/i;

export function isControlOrScreenPart(nodeName: string, deviceNode: string): boolean {
  if (!nodeName || !deviceNode) return false;
  if (nodeName === deviceNode) return false;
  return (
    nodeName === `${deviceNode}_control-panel` ||
    nodeName === `${deviceNode}_screen` ||
    nodeName.startsWith(`${deviceNode}_control-panel`) ||
    nodeName.startsWith(`${deviceNode}_screen`) ||
    (nodeName.startsWith(`${deviceNode}_`) && PART_SUFFIX.test(nodeName))
  );
}

/**
 * 把拾取到的节点收成可点选对象。点到控制面板或屏幕时，选中所属模块机。
 * 对不上可点选对象时返回 null（当作点空白）。
 */
export function resolveSelectableNode(
  hmi: ParsedHmiScene | null | undefined,
  document: SceneDocument | null | undefined,
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const selectables = hmi ? uniqueEntitiesFromParsed(hmi) : [];
  if (selectables.some((item) => item.node === raw)) return raw;

  if (hmi) {
    for (const device of hmi.devices) {
      if (isControlOrScreenPart(raw, device.node)) return device.node;
    }
  }

  const entity = resolveSceneEntity(document, raw);
  if (entity?.nodeName && selectables.some((item) => item.node === entity.nodeName)) {
    return entity.nodeName;
  }

  const hits = selectables.filter((item) => isNodeDescendant(raw, item.node));
  hits.sort((a, b) => b.node.length - a.node.length);
  return hits[0]?.node ?? null;
}

/**
 * 该显示哪些铭牌。
 *
 * <h2>★ 只认选中，不认悬停（2026-11-25 客户要求）</h2>
 *
 * <p>客户原话：「鼠标指向模块机不要显示铭牌，当时当鼠标点击模块机才要显示铭牌」。
 *
 * <p>原先是 `plate.node === selectedNode || plate.node === hoveredNode`，
 * 鼠标扫过整排机组时铭牌会一路跟着冒出来，既挡画面又看不出哪个是真正选中的。
 *
 * <p>悬停不再产生任何视觉反馈；`hoveredNode` 参数一起删掉，
 * 避免以后有人以为「传进来就会显示」。
 */
export function visibleDevicePlates<T extends { node: string }>(
  plates: T[],
  selectedNode?: string | null,
): T[] {
  return plates.filter((plate) => plate.node === selectedNode);
}

/** 抽屉是否展开：只由选中（或提手钉住）决定，指向不会升起抽屉。 */
export function isControlDrawerOpen(selectedNode?: string | null, pinned = false): boolean {
  return Boolean(selectedNode) || pinned;
}
