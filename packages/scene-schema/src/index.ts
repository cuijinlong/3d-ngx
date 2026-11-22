
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
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
  publishedVersion: z.number().optional(),
});


const platformSchema = z.object({
  siteId: z.string(),
  siteName: z.string().optional(),
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
}).optional();

export const sceneDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  scene: sceneMetaSchema,
  settings: sceneSettingsSchema,
  rootAssetId: z.string().optional(),
  entities: z.array(sceneEntitySchema),
  bindings: z.array(deviceBindingSchema).default([]),
  platform: platformSchema,
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
