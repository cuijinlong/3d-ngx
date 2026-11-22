import type { DeviceBinding, SceneDocument, SceneEntity } from "@idt/shared-types";

export function isNodeDescendant(child: string, parent?: string): boolean {
  if (!child || !parent) return false;
  if (child === parent) return true;
  return child.startsWith(`${parent}_`) || child.startsWith(`${parent}-`);
}

export function resolveSceneEntity(
  document: SceneDocument | null | undefined,
  nodeName: string | null,
): SceneEntity | undefined {
  if (!document || !nodeName) return undefined;
  const exact = document.entities.find((entity) => entity.nodeName === nodeName || entity.id === nodeName);
  if (exact) return exact;
  const matches = document.entities.filter(
    (entity) => isNodeDescendant(nodeName, entity.nodeName) || isNodeDescendant(nodeName, entity.id),
  );
  matches.sort((a, b) => (b.nodeName ?? "").length - (a.nodeName ?? "").length);
  return matches[0];
}

export function bindingsForNode(
  document: SceneDocument | null | undefined,
  nodeName: string | null,
): DeviceBinding[] {
  if (!document || !nodeName) return [];
  const ids = new Set<string>([nodeName]);
  for (const entity of document.entities) {
    if (
      entity.nodeName === nodeName ||
      entity.id === nodeName ||
      isNodeDescendant(nodeName, entity.nodeName) ||
      isNodeDescendant(nodeName, entity.id)
    ) {
      ids.add(entity.id);
      if (entity.nodeName) ids.add(entity.nodeName);
    }
  }
  return document.bindings.filter((binding) => ids.has(binding.sceneEntityId));
}
