/** 主界面展示用名称：优先分组节点名或场景名，不把原始 id 甩到界面上。 */
export function visibleSceneLabel(name?: string, groupNames?: string[], rawId?: string): string {
  const groups = (groupNames ?? []).map((item) => item.trim()).filter((item) => item && item !== rawId);
  if (groups.length) return groups.join("、");
  const label = (name ?? "").trim();
  if (label && label !== rawId) return label;
  return "未命名场景";
}
