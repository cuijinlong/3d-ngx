/** 给用户看的平台设备名称：优先 label，否则 name，再否则已保存的展示名或 id。不要用于 3D 模型对象。 */
export function formatPlatformDeviceName(source?: {
  label?: string | null;
  name?: string | null;
  deviceName?: string | null;
  id?: string | null;
} | null): string {
  for (const value of [source?.label, source?.name, source?.deviceName, source?.id]) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text) return text;
  }
  return "";
}
