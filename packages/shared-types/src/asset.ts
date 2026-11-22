export type ModelAssetType = "glb" | "gltf" | "gsplat" | "texture" | "environment";

export type ModelAssetStatus = "ready" | "processing" | "failed";

export interface ModelAsset {
  id: string;
  name: string;
  type: ModelAssetType;
  /** 运行时对象 URL，可能是 blob: 或 /models/... */
  url: string;
  thumbnail?: string;
  fileSize?: number;
  version?: string;
  status: ModelAssetStatus;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
