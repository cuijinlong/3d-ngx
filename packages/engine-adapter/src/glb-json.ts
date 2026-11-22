
/** 读取 GLB 第一个 JSON chunk，不依赖 3D 引擎。 */

const MAGIC = 0x46546c67; // glTF
const JSON_CHUNK = 0x4e4f534a; // JSON

export function extractGlbJson(buffer: ArrayBuffer): Record<string, unknown> {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12) {
    throw new Error("GLB 文件过短，不是有效模型");
  }
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error("不是 GLB 文件（缺少 glTF 文件头）");
  }
  const jsonLen = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== JSON_CHUNK) {
    throw new Error("GLB 第一个块不是 JSON");
  }
  const start = 20;
  const end = start + jsonLen;
  if (end > buffer.byteLength) {
    throw new Error("GLB JSON 块长度超出文件");
  }
  const bytes = new Uint8Array(buffer, start, jsonLen);
  const text = new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "").trim();
  return JSON.parse(text) as Record<string, unknown>;
}
