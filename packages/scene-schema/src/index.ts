
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0" as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const transformSchema = z.object({
  position: vec3,
  rotation: vec3,
  scale: vec3,
});

export const telemetryMappingSchema = z.object({
  field: z.string().min(1),
  telemetryKey: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().optional(),
  displayType: z.enum(["number", "boolean", "text"]),
});

export const actionMappingSchema = z.object({
  actionId: z.string().min(1),
  label: z.string().min(1),
  clip: z.string().optional(),
  telemetryKey: z.string().optional(),
  whenValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  commandId: z.string().optional(),
  commandParams: z.record(z.string(), z.unknown()).optional(),
});

export const statusRuleSchema = z.object({
  operator: z.enum(["eq", "gt", "gte", "lt", "lte"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
  state: z.enum(["normal", "warning", "alarm", "offline"]),
});

export const statusMappingSchema = z.object({
  telemetryKey: z.string().min(1),
  rules: z.array(statusRuleSchema),
});

export const deviceBindingSchema = z.object({
  id: z.string().min(1),
  sceneEntityId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceName: z.string().min(1),
  telemetryMappings: z.array(telemetryMappingSchema),
  actionMappings: z.array(actionMappingSchema).default([]),
  statusMapping: statusMappingSchema.optional(),
});

export const sceneEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodeName: z.string().optional(),
  assetId: z.string().optional(),
  transform: transformSchema,
  visible: z.boolean().optional(),
  binding: z.object({ deviceId: z.string() }).optional(),
});

export const sceneSettingsSchema = z.object({
  background: z.string(),
  environment: z.string().nullable(),
  gridEnabled: z.boolean(),
  snapEnabled: z.boolean().optional(),
  snapSize: z.number().optional(),
  coordinateSpace: z.enum(["local", "world"]).optional(),
  stylePack: z.string().optional(),
  packId: z.string().optional(),
  packVersion: z.string().optional(),
  baseType: z.enum(["auto", "steel-rail", "concrete-pad", "none"]).optional(),
  pedestal: z.enum(["auto", "steel-rail", "concrete-pad", "none", "steel", "concrete"]).optional(),
  weatherSite: z.string().optional(),
  weatherPlace: z.string().optional(),
});

export const sceneMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  /*
   * 缩略图 dataURL（2026-11-23）。
   *
   * <p>用 `data:image/` 前缀校验而不是只 `z.string()`：
   * 这个字段会被直接塞进 `<img src>`，若混进 `javascript:` 之类
   * 就是一个 XSS 面。校验前缀把它挡在 schema 层。
   */
  thumbnail: z.string().startsWith("data:image/").optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
  publishedVersion: z.number().optional(),
});


const platformSchema = z.object({
  siteId: z.string(),
  siteName: z.string().optional(),
  /*
   * customerId / sceneInstance / publishState 必须显式声明。
   * zod 的默认行为是把未声明字段 strip 掉，不是报错 —— 漏了这三个的后果是
   * 导入场景 JSON 后「没有客户归属」：租户列表看不到、客户按 customerId
   * 过滤也打不开，而且全程不报错（2026-11-22 实测复现）。
   * 与 @idt/shared-types 的 ScenePlatformRef 保持一致。
   */
  customerId: z.string().optional(),
  topologyId: z.string().optional(),
  topologyName: z.string().optional(),
  viewType: z.string(),
  roots: z.array(z.string()).optional(),
  rootNames: z.array(z.string()).optional(),
  packId: z.string().optional(),
  packVersion: z.string().optional(),
  stylePack: z.string().optional(),
  baseType: z.enum(["auto", "steel-rail", "concrete-pad", "none"]).optional(),
  weatherSite: z.string().optional(),
  glb: z.object({
    objectKey: z.string(),
    fileName: z.string().optional(),
    size: z.number().optional(),
    url: z.string().optional(),
  }).optional(),
  styleFiles: z.array(z.object({
    objectKey: z.string(),
    fileName: z.string().optional(),
    size: z.number().optional(),
    url: z.string().optional(),
  })).optional(),
  sceneInstance: z.boolean().optional(),
  publishState: z.string().optional(),
}).optional();

/**
 * 场景数据源别名（2026-11-23）。
 *
 * <p>`kind` 与必填字段的对应关系在纯逻辑里校验
 * （`resolveDataSourceEntities`）；这里只做形状约束，
 * 保持「schema 管类型、业务规则管语义」的分工。
 */
export const sceneDataSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["device", "asset", "scope"]),
  deviceId: z.string().optional(),
  assetId: z.string().optional(),
  scope: z
    .object({
      kind: z.enum(["site", "topology"]),
      siteId: z.string().optional(),
      siteName: z.string().optional(),
      topologyId: z.string().optional(),
      topologyName: z.string().optional(),
    })
    .optional(),
  note: z.string().optional(),
});

export const sceneDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  scene: sceneMetaSchema,
  settings: sceneSettingsSchema,
  rootAssetId: z.string().optional(),
  entities: z.array(sceneEntitySchema),
  bindings: z.array(deviceBindingSchema).default([]),
  platform: platformSchema,
  /*
   * 场景数据源别名（2026-11-23）。
   *
   * <p>不写进 schema 就会被 zod 在保存时**静默剥离** —— 界面上配了、
   * 刷新就没了，而且不报错。这是「新增场景级字段」必须记得的一步。
   */
  dataSources: z.array(sceneDataSourceSchema).optional(),
  hmiSnapshot: z
    .object({
      source: z.enum(["hmi-extras", "node-graph"]),
      name: z.string().optional(),
      bindableCount: z.number(),
    })
    .optional(),
});

export type SceneDocumentInput = z.infer<typeof sceneDocumentSchema>;

export function parseSceneDocument(data: unknown): SceneDocumentInput {
  return sceneDocumentSchema.parse(data);
}

export function safeParseSceneDocument(data: unknown) {
  return sceneDocumentSchema.safeParse(data);
}
