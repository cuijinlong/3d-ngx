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
  /**
   * 缩略图（2026-11-23）。
   *
   * <p>存的是**压缩后的 dataURL**（JPEG，宽 480px 以内）。
   *
   * <h3>为什么允许内联而不是只存文件 id</h3>
   *
   * <p>场景卡片要显示缩略图，而列表页不该为每张卡片再发一次资源请求 ——
   * 卡片一多就是 N 个请求（本项目明令禁止 N+1）。内联在文档里，
   * 列表一次拿全。
   *
   * <p>代价是文档变大。所以限制尺寸：480×270 JPEG q0.72 约 25~40KB，
   * 相对场景本身的 GLB 引用（几 MB）可忽略。
   */
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedVersion?: number;
}

/**
 * 场景数据源别名（2026-11-23）。
 *
 * <h2>为什么需要</h2>
 *
 * <p>在线编程时最大的问题是**不知道能用什么**：写 `bind-telemetry` 要填
 * `telemetryKey`，但那个键在不在？属性有哪些？这台设备有没有告警？
 * 没有一处能查。只能去平台页面翻，或者猜 —— 而猜错的键不会报错，
 * 卡片只是永远显示「暂无数据」。
 *
 * <p>TB 的做法是 dashboard 级 entity alias：给实体起个短名，widget 引用别名
 * 而不是硬编码 UUID。这里对应到「场景级数据源」：一个场景声明它用到的
 * 设备/资产/范围，并给它们起名，供脚本和卡片引用。
 *
 * <h2>三种解析方式</h2>
 *
 * <ul>
 *   <li><code>device</code> —— 一台具体设备，最常用（网关、单台机组）；</li>
 *   <li><code>asset</code> —— 一个资产，读它的一次性属性（额定制冷量这类）；</li>
 *   <li><code>scope</code> —— 一个范围（场站/场景拓扑），解析成**一批**设备。
 *       对应模板里的聚合槽和逐台列。</li>
 * </ul>
 */
export interface SceneDataSource {
  /** 脚本里引用用的短名，如 `"gw"` / `"units"`。全局唯一。 */
  id: string;
  /** 显示名，如「网关」「9 台模块机」。 */
  name: string;
  kind: "device" | "asset" | "scope";
  /** kind=device 必填 */
  deviceId?: string;
  /** kind=asset 必填 */
  assetId?: string;
  /** kind=scope 必填，复用卡片的范围结构 */
  scope?: {
    kind: "site" | "topology";
    siteId?: string;
    siteName?: string;
    topologyId?: string;
    topologyName?: string;
  };
  /** 这块数据是干什么的，给人看。 */
  note?: string;
}

export interface SceneDocument {
  schemaVersion: "1.0.0";
  scene: SceneMeta;
  settings: SceneSettings;
  /** 主模型资产，SaveHMI 导出的整场景 GLB 走这里 */
  rootAssetId?: string;
  entities: SceneEntity[];
  bindings: DeviceBinding[];
  /**
   * 本场景的数据源别名（2026-11-23）。
   *
   * <p>显式声明的部分。另有**隐含源**从 `bindings` 自动推导
   * （每个绑了设备的 3D 对象都是一个源），两者合并后才是完整清单 ——
   * 见 `resolveSceneDataSources()`。这样零配置也有内容，
   * 显式声明只是用来补命名和覆盖范围。
   */
  dataSources?: SceneDataSource[];
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
