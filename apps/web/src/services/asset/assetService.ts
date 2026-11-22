
import type { ModelAsset, ModelAssetType } from "@idt/shared-types";
import { db, type StoredAsset } from "../storage/db";
import { createId } from "../../utils/id";

const URL_CACHE = new Map<string, string>();

function inferType(file: File): ModelAssetType {
  const name = file.name.toLowerCase();
  if (name.endsWith(".glb")) return "glb";
  if (name.endsWith(".gltf")) return "gltf";
  if (name.endsWith(".sog") || name.endsWith(".ply") || name.endsWith(".splat") || name.endsWith(".ksplat")) {
    return "gsplat";
  }
  if (name.endsWith(".hdr") || name.endsWith(".exr")) return "environment";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp")) {
    return "texture";
  }
  throw new Error(`暂不支持的文件类型：${file.name}`);
}

export async function importAssetFile(file: File, metadata?: Record<string, unknown>): Promise<StoredAsset> {
  const type = inferType(file);
  const now = new Date().toISOString();
  const asset: StoredAsset = {
    id: createId("asset"),
    name: file.name.replace(/\.[^.]+$/, ""),
    type,
    url: "",
    fileSize: file.size,
    status: "ready",
    mimeType: file.type || undefined,
    createdAt: now,
    updatedAt: now,
    metadata,
    blob: file,
  };
  await db.assets.put(asset);
  return asset;
}

export async function listAssets(): Promise<StoredAsset[]> {
  return db.assets.orderBy("updatedAt").reverse().toArray();
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  return db.assets.get(id);
}

export async function deleteAsset(id: string): Promise<void> {
  const url = URL_CACHE.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    URL_CACHE.delete(id);
  }
  await db.assets.delete(id);
}

export async function resolveAssetUrl(asset: StoredAsset | ModelAsset): Promise<string> {
  const stored = "blob" in asset && asset.blob ? (asset as StoredAsset) : await db.assets.get(asset.id);
  if (stored?.url && !stored.blob) return stored.url;
  if (stored?.blob) {
    const cached = URL_CACHE.get(stored.id);
    if (cached) return cached;
    const url = URL.createObjectURL(stored.blob);
    URL_CACHE.set(stored.id, url);
    return url;
  }
  if (asset.url) return asset.url;
  throw new Error("模型文件不可用");
}

export async function readAssetBuffer(id: string): Promise<ArrayBuffer> {
  const stored = await db.assets.get(id);
  if (stored?.blob) return stored.blob.arrayBuffer();
  if (stored?.url) {
    const res = await fetch(stored.url);
    if (!res.ok) throw new Error("下载模型失败");
    return res.arrayBuffer();
  }
  throw new Error("找不到模型数据");
}

export async function importPublicModel(url: string, name: string): Promise<StoredAsset> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法加载示例模型：${url}`);
  const blob = await res.blob();
  const file = new File([blob], `${name}.glb`, { type: "model/gltf-binary" });
  return importAssetFile(file, { source: "public", url });
}
