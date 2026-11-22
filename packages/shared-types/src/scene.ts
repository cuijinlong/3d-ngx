import type { DeviceBinding } from "./device";

export interface Transform3 {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SceneEntity {
  id: string;
  name: string;
  /** 对应 GLB 节点名，用于拾取和绑定 */
  nodeName?: string;
  assetId?: string;
  transform: Transform3;
  visible?: boolean;
  binding?: { deviceId: string };
}

export type SceneBaseType = "auto" | "steel-rail" | "concrete-pad" | "none";

export interface SceneAssetRef {
  objectKey: string;
  fileName?: string;
  size?: number;
  url?: string;
}

export interface ScenePlatformRef {
  siteId: string;
  siteName?: string;
  customerId?: string;
  topologyId?: string;
  topologyName?: string;
  viewType: string;
  roots?: string[];
  rootNames?: string[];
  packId?: string;
  packVersion?: string;
  stylePack?: string;
  baseType?: SceneBaseType;
  weatherSite?: string;
  glb?: SceneAssetRef;
  styleFiles?: SceneAssetRef[];
  sceneInstance?: boolean;
  publishState?: string;
}

export interface SceneSettings {
  background: string;
  environment: string | null;
  gridEnabled: boolean;
  snapEnabled?: boolean;
  snapSize?: number;
  coordinateSpace?: "local" | "world";
  /** 风格套装钉，如 hvac-hud-v1@1.0.0；只存引用，完整皮肤待设计落地 */
  stylePack?: string;
  packId?: string;
  packVersion?: string;
  baseType?: SceneBaseType;
  /** 兼容旧字段；新代码请写 baseType（auto / steel-rail / concrete-pad / none） */
  pedestal?: SceneBaseType | "steel" | "concrete";
  weatherSite?: string;
  /** 兼容旧字段，等同 weatherSite */
  weatherPlace?: string;
}

export interface SceneMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedVersion?: number;
}

export interface SceneDocument {
  schemaVersion: "1.0.0";
  scene: SceneMeta;
  settings: SceneSettings;
  /** 主模型资产，SaveHMI 导出的整场景 GLB 走这里 */
  rootAssetId?: string;
  entities: SceneEntity[];
  bindings: DeviceBinding[];
  /** 只存场站/拓扑/视图/roots 引用，不要把拓扑整图写入场景 JSON */
  platform?: ScenePlatformRef;
  /** 解析后的可绑定清单会存一份快照，重新导入时以文件为准再解析 */
  hmiSnapshot?: {
    source: "hmi-extras" | "node-graph";
    name?: string;
    bindableCount: number;
  };
}

export interface SceneVersion {
  id: string;
  sceneId: string;
  version: number;
  createdAt: string;
  note?: string;
  document: SceneDocument;
}

export interface SceneListItem {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
  publishedAt?: string;
  entityCount: number;
  hasRootModel: boolean;
  siteName?: string;
  topologyName?: string;
  topologyId?: string;
}
