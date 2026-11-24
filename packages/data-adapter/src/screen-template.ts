import overviewSituationJson from "./screen-templates/overview-situation.json";
import tianjiaoHeatPumpJson from "./screen-templates/tianjiao-heat-pump.json";
import {
  clampWidgetRect,
  parseSceneWidget,
  parseWidgetScope,
  type SceneWidget,
  type SceneWidgetLayout,
  type SceneWidgetScope,
  type SceneWidgetSlot,
  type WidgetStageZone,
} from "./scene-widget-layout";

export const SCREEN_TEMPLATE_SCHEMA = "1.0.0" as const;
export const OVERVIEW_SITUATION_TEMPLATE_ID = "overview-situation";

export type ScreenTemplateValueType = "number" | "number-series" | "scope";
/**
 * 模板接口的数据来源。
 *
 * <p>`asset-attribute`（2026-11-23 新增）：读资产自身属性（装机容量、投运日期），
 * 与 `device-point`（设备遥测）是两条独立链路。
 * 漏这一个值会让模板里的资产接口**被静默丢弃**（下面的 filter 不认识就丢，
 * 然后回退成 device-point）—— 表现为「模板里写了资产来源，实例化后变成了设备来源」。
 */
export type ScreenTemplateSourceKind = "site" | "scene-topology" | "device-point" | "asset-attribute";

export interface ScreenTemplateInterface {
  key: string;
  name: string;
  valueType: ScreenTemplateValueType;
  allowedSources: ScreenTemplateSourceKind[];
  optional?: boolean;
}

/** 模板级的在线编程边界（与 template.manifest.json 的 aiExtension 同构）。 */
export interface ScreenTemplateAiExtension {
  editableTargets: string[];
  protectedTargets: string[];
  operations: string[];
  requiresDiffReview: boolean;
}

export interface ScreenTemplateRegion {
  id: string;
  type: string;
  zone: WidgetStageZone;
  x: number;
  y: number;
  w: number;
  h: number;
  defaultTitle: string;
  /** 标题右侧的英文小字（如 CAMPUS PROFILE），对齐 template01 的 panel-head。 */
  defaultSubtitle?: string;
  interfaces: ScreenTemplateInterface[];
  /** 设备名包含过滤（仅 device-list / bar-compare 用），如 "模块机" */
  filterText?: string;
}

export type ScreenObjectBindingFieldKey =
  | "targetDevice"
  | "nameplatePoints"
  | "behaviors"
  | "controlCommands"
  | "status";

export interface ScreenObjectBindingField {
  key: ScreenObjectBindingFieldKey | string;
  name: string;
  valueType: string;
  required?: boolean;
  optional?: boolean;
  note?: string;
}

export interface ScreenObjectBindingContract {
  matchBy: "objectName";
  description?: string;
  fields: ScreenObjectBindingField[];
}

export interface ScreenTemplate {
  schemaVersion: "1.0.0";
  id: string;
  name: string;
  version: number;
  description?: string;
  regions: ScreenTemplateRegion[];
  objectBinding?: ScreenObjectBindingContract;
  /**
   * 在线编程边界（2026-11-23）。
   *
   * <p>为什么要放在模板上：不同模板该允许的改动不同 ——
   * 一张客户成品大屏可能只允许改绑定，不允许增删卡片；
   * 一个空白底稿则允许自由加卡。写死在代码里的默认值做不到这种区分。
   *
   * <p>缺省时由 `DEFAULT_AI_EXTENSION` 兜底，所以存量模板不用改。
   */
  aiExtension?: ScreenTemplateAiExtension;
}

export interface TemplateInterfaceBinding {
  regionId: string;
  key: string;
  source?: ScreenTemplateSourceKind;
  siteId?: string;
  siteName?: string;
  topologyId?: string;
  topologyName?: string;
  deviceId?: string;
  telemetryKey?: string;
  unit?: string;
  label?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const VALUE_TYPES: ScreenTemplateValueType[] = ["number", "number-series", "scope"];
const SOURCE_KINDS: ScreenTemplateSourceKind[] = ["site", "scene-topology", "device-point", "asset-attribute"];
const ZONES: WidgetStageZone[] = ["title", "caption", "left", "right", "bottom"];

export function parseScreenTemplateInterface(raw: unknown): ScreenTemplateInterface | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const key = text(row.key);
  if (!key) return null;
  const valueType = VALUE_TYPES.includes(row.valueType as ScreenTemplateValueType)
    ? (row.valueType as ScreenTemplateValueType)
    : "number";
  const allowedSources = Array.isArray(row.allowedSources)
    ? row.allowedSources.filter((item): item is ScreenTemplateSourceKind => SOURCE_KINDS.includes(item as ScreenTemplateSourceKind))
    : [];
  const item: ScreenTemplateInterface = {
    key,
    name: text(row.name) || key,
    valueType,
    allowedSources: allowedSources.length ? allowedSources : valueType === "scope" ? ["site", "scene-topology"] : ["device-point"],
  };
  if (row.optional === true) item.optional = true;
  return item;
}

export function parseScreenTemplateRegion(raw: unknown, index = 0): ScreenTemplateRegion | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id) || `region-${index}`;
  const type = text(row.type) || "metric-card";
  const zone = ZONES.includes(row.zone as WidgetStageZone) ? (row.zone as WidgetStageZone) : "left";
  const rect = clampWidgetRect({
    x: num(row.x, 2),
    y: num(row.y, 10.2),
    w: num(row.w, 20.4),
    h: num(row.h, 16),
  });
  const interfaces = Array.isArray(row.interfaces)
    ? row.interfaces.map((item) => parseScreenTemplateInterface(item)).filter((item): item is ScreenTemplateInterface => Boolean(item))
    : [];
  const region: ScreenTemplateRegion = {
    id,
    type,
    zone,
    ...rect,
    defaultTitle: text(row.defaultTitle) || "",
    interfaces,
  };
  const defaultSubtitle = text(row.defaultSubtitle);
  if (defaultSubtitle) region.defaultSubtitle = defaultSubtitle;
  const filterText = text(row.filterText);
  if (filterText) region.filterText = filterText;
  return region;
}

/**
 * 解析模板的在线编程边界。
 *
 * <p>校验原则：字段类型不对就整条丢掉，不要留半截配置 ——
 * 一个 `operations: []` 的空边界会让该模板**什么都改不了**，
 * 而用户只会看到「提案被拒绝」却不知道为什么。
 */
export function parseScreenTemplateAiExtension(raw: unknown): ScreenTemplateAiExtension | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
  const operations = list(row.operations);
  /*
   * operations 为空等于「这个模板禁止一切在线编辑」。
   * 这几乎一定不是模板作者的意图，更像是写漏了 —— 按缺省处理，
   * 让它退回 DEFAULT_AI_EXTENSION，而不是把整屏锁死。
   */
  if (!operations.length) return undefined;
  return {
    editableTargets: list(row.editableTargets),
    protectedTargets: list(row.protectedTargets),
    operations,
    requiresDiffReview: row.requiresDiffReview !== false,
  };
}

export function parseScreenTemplate(raw: unknown): ScreenTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  if (!id) return null;
  const regions = Array.isArray(row.regions)
    ? row.regions.map((item, index) => parseScreenTemplateRegion(item, index)).filter((item): item is ScreenTemplateRegion => Boolean(item))
    : [];
  const template: ScreenTemplate = {
    schemaVersion: "1.0.0",
    id,
    name: text(row.name) || id,
    version: Math.max(1, Math.floor(num(row.version, 1))),
    regions,
  };
  const description = text(row.description);
  if (description) template.description = description;
  const objectBinding = parseScreenObjectBindingContract(row.objectBinding);
  if (objectBinding) template.objectBinding = objectBinding;
  const aiExtension = parseScreenTemplateAiExtension(row.aiExtension);
  if (aiExtension) template.aiExtension = aiExtension;
  return template;
}

export function parseScreenObjectBindingContract(raw: unknown): ScreenObjectBindingContract | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const fields = Array.isArray(row.fields)
    ? row.fields.map((item) => {
        if (!item || typeof item !== "object") return null;
        const field = item as Record<string, unknown>;
        const key = text(field.key);
        if (!key) return null;
        const parsed: ScreenObjectBindingField = {
          key,
          name: text(field.name) || key,
          valueType: text(field.valueType) || "realtime-device",
        };
        if (field.required === true) parsed.required = true;
        if (field.optional === true) parsed.optional = true;
        const note = text(field.note);
        if (note) parsed.note = note;
        return parsed;
      }).filter((item): item is ScreenObjectBindingField => Boolean(item))
    : [];
  if (!fields.length) return undefined;
  const contract: ScreenObjectBindingContract = { matchBy: "objectName", fields };
  const description = text(row.description);
  if (description) contract.description = description;
  return contract;
}

export function parseTemplateInterfaceBinding(raw: unknown): TemplateInterfaceBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const regionId = text(row.regionId);
  const key = text(row.key);
  if (!regionId || !key) return null;
  const binding: TemplateInterfaceBinding = { regionId, key };
  if (SOURCE_KINDS.includes(row.source as ScreenTemplateSourceKind)) binding.source = row.source as ScreenTemplateSourceKind;
  const siteId = text(row.siteId);
  const siteName = text(row.siteName);
  const topologyId = text(row.topologyId);
  const topologyName = text(row.topologyName);
  const deviceId = text(row.deviceId);
  const telemetryKey = text(row.telemetryKey);
  const unit = text(row.unit);
  const label = text(row.label);
  if (siteId) binding.siteId = siteId;
  if (siteName) binding.siteName = siteName;
  if (topologyId) binding.topologyId = topologyId;
  if (topologyName) binding.topologyName = topologyName;
  if (deviceId) binding.deviceId = deviceId;
  if (telemetryKey) binding.telemetryKey = telemetryKey;
  if (unit) binding.unit = unit;
  if (label) binding.label = label;
  return binding;
}

export function parseTemplateInterfaceBindings(raw: unknown): TemplateInterfaceBinding[] {
  return Array.isArray(raw)
    ? raw.map((item) => parseTemplateInterfaceBinding(item)).filter((item): item is TemplateInterfaceBinding => Boolean(item))
    : [];
}

export function parseRegionTitles(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const titles: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const title = text(value);
    if (key && title) titles[key] = title;
  }
  return Object.keys(titles).length ? titles : undefined;
}

const OVERVIEW_SITUATION_TEMPLATE = parseScreenTemplate(overviewSituationJson);

if (!OVERVIEW_SITUATION_TEMPLATE) {
  throw new Error("内置综合态势模板无法解析");
}

/**
 * 天骄冷热站模板（2026-11-23）。为热泵机组场景专用：
 * 左翼 9 台列表、右翼选中机组、底部功率趋势与加载率对比。
 *
 * <p>与「综合态势」的关系：那个是通用骨架（主指标 + 圆环 + 趋势），
 * 这个是设备密集场景。两个都保留 —— 综合态势适合只有几个 KPI 的场站，
 * 这个适合「一堆同类设备要逐台看」的机房。
 */
const TIANJIAO_HEAT_PUMP_TEMPLATE = parseScreenTemplate(tianjiaoHeatPumpJson);

if (!TIANJIAO_HEAT_PUMP_TEMPLATE) {
  throw new Error("内置天骄冷热站模板无法解析");
}

export const TIANJIAO_HEAT_PUMP_TEMPLATE_ID = "tianjiao-heat-pump";

const BUILTIN_SCREEN_TEMPLATES: ScreenTemplate[] = [OVERVIEW_SITUATION_TEMPLATE, TIANJIAO_HEAT_PUMP_TEMPLATE];

export function listBuiltinScreenTemplates(): ScreenTemplate[] {
  return BUILTIN_SCREEN_TEMPLATES.map((item) => structuredClone(item));
}

export function getBuiltinScreenTemplate(id: string): ScreenTemplate | undefined {
  const found = BUILTIN_SCREEN_TEMPLATES.find((item) => item.id === id);
  return found ? structuredClone(found) : undefined;
}

export function resolveScreenTemplate(layout: SceneWidgetLayout | null | undefined): ScreenTemplate | undefined {
  if (layout?.templateDraft) {
    const draft = parseScreenTemplate(layout.templateDraft);
    if (draft) return draft;
  }
  if (layout?.templateId) return getBuiltinScreenTemplate(layout.templateId);
  return undefined;
}

export function expandDefaultTitle(pattern: string, sceneName?: string): string {
  const name = (sceneName ?? "").trim();
  if (!pattern.includes("{sceneName}")) return pattern;
  if (!name) {
    const stripped = pattern.replace(/\{sceneName\}\s*·\s*/g, "").replaceAll("{sceneName}", "").trim();
    return stripped || "综合态势";
  }
  return pattern.replaceAll("{sceneName}", name);
}

function scopeFromBinding(binding: TemplateInterfaceBinding | undefined): SceneWidgetScope | undefined {
  if (!binding) return undefined;
  if (binding.source === "site" || binding.siteId) {
    return parseWidgetScope({ kind: "site", siteId: binding.siteId, siteName: binding.siteName });
  }
  if (binding.source === "scene-topology" || binding.topologyId) {
    return parseWidgetScope({
      kind: "topology",
      topologyId: binding.topologyId,
      topologyName: binding.topologyName,
      siteId: binding.siteId,
      siteName: binding.siteName,
    });
  }
  return undefined;
}

function bindingFromScope(regionId: string, key: string, scope: SceneWidgetScope | undefined): TemplateInterfaceBinding | null {
  if (!scope) return null;
  if (scope.kind === "site" && scope.siteId) {
    const binding: TemplateInterfaceBinding = { regionId, key, source: "site", siteId: scope.siteId };
    if (scope.siteName) binding.siteName = scope.siteName;
    return binding;
  }
  if (scope.kind === "topology" && scope.topologyId) {
    const binding: TemplateInterfaceBinding = {
      regionId,
      key,
      source: "scene-topology",
      topologyId: scope.topologyId,
    };
    if (scope.topologyName) binding.topologyName = scope.topologyName;
    if (scope.siteId) binding.siteId = scope.siteId;
    if (scope.siteName) binding.siteName = scope.siteName;
    return binding;
  }
  return null;
}

function isFilledBinding(binding: TemplateInterfaceBinding): boolean {
  if (binding.source === "device-point" || binding.deviceId || binding.telemetryKey) {
    return Boolean(binding.deviceId);
  }
  return Boolean(binding.siteId || binding.topologyId);
}

export function materializeScreenTemplate(
  template: ScreenTemplate,
  options: {
    sceneName?: string;
    interfaceBindings?: TemplateInterfaceBinding[];
    regionTitles?: Record<string, string>;
    glassOpacity?: number;
    templateDraft?: ScreenTemplate;
  } = {},
): SceneWidgetLayout {
  const bindings = options.interfaceBindings ?? [];
  const widgets = template.regions.map((region, index) => {
    const regionBindings = bindings.filter((item) => item.regionId === region.id);
    const scopeBinding = regionBindings.find((item) => {
      const iface = region.interfaces.find((entry) => entry.key === item.key);
      return iface?.valueType === "scope";
    });
    const slotIfaces = region.interfaces.filter((item) => item.allowedSources.includes("device-point"));
    const slots: SceneWidgetSlot[] = slotIfaces.map((iface) => {
      const bound = regionBindings.find((item) => item.key === iface.key);
      const slot: SceneWidgetSlot = { key: iface.key, label: iface.name };
      if (bound?.unit) slot.unit = bound.unit;
      if (bound?.label) slot.label = bound.label;
      if (bound?.deviceId) slot.deviceId = bound.deviceId;
      if (bound?.telemetryKey) slot.telemetryKey = bound.telemetryKey;
      return slot;
    });
    const title = options.regionTitles?.[region.id] ?? expandDefaultTitle(region.defaultTitle, options.sceneName);
    const raw = {
      id: region.id,
      type: region.type,
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      title,
      ...(region.defaultSubtitle ? { subtitle: region.defaultSubtitle } : {}),
      slots,
      scope: scopeFromBinding(scopeBinding),
      ...(region.filterText ? { filterText: region.filterText } : {}),
    };
    return parseSceneWidget(raw, index)!;
  });
  const layout: SceneWidgetLayout = {
    schemaVersion: "1.0.0",
    templateId: template.id,
    templateVersion: template.version,
    widgets,
  };
  if (options.glassOpacity != null) layout.glassOpacity = options.glassOpacity;
  if (options.templateDraft) layout.templateDraft = options.templateDraft;
  if (bindings.length) layout.interfaceBindings = bindings.filter(isFilledBinding);
  if (options.regionTitles && Object.keys(options.regionTitles).length) layout.regionTitles = options.regionTitles;
  return layout;
}

export function applyScreenTemplate(
  _current: SceneWidgetLayout | null | undefined,
  template: ScreenTemplate,
  sceneName?: string,
): SceneWidgetLayout {
  return materializeScreenTemplate(template, { sceneName });
}

export function rematerializeLayout(layout: SceneWidgetLayout, sceneName?: string): SceneWidgetLayout {
  const template = resolveScreenTemplate(layout);
  if (!template) return layout;
  return materializeScreenTemplate(template, {
    sceneName,
    interfaceBindings: layout.interfaceBindings,
    regionTitles: layout.regionTitles,
    glassOpacity: layout.glassOpacity,
    templateDraft: layout.templateDraft,
  });
}

export function upsertInterfaceBinding(
  layout: SceneWidgetLayout,
  binding: TemplateInterfaceBinding | null,
  lookup: { regionId: string; key: string },
  sceneName?: string,
): SceneWidgetLayout {
  const rest = (layout.interfaceBindings ?? []).filter((item) => !(item.regionId === lookup.regionId && item.key === lookup.key));
  const nextBindings = binding && isFilledBinding(binding) ? [...rest, binding] : rest;
  return rematerializeLayout({ ...layout, interfaceBindings: nextBindings.length ? nextBindings : undefined }, sceneName);
}

export function upsertRegionTitle(layout: SceneWidgetLayout, regionId: string, title: string, sceneName?: string): SceneWidgetLayout {
  const titles = { ...(layout.regionTitles ?? {}) };
  const trimmed = title.trim();
  if (trimmed) titles[regionId] = trimmed;
  else delete titles[regionId];
  return rematerializeLayout({ ...layout, regionTitles: Object.keys(titles).length ? titles : undefined }, sceneName);
}

export function saveTemplateDraft(layout: SceneWidgetLayout, draft: ScreenTemplate, sceneName?: string): SceneWidgetLayout {
  const parsed = parseScreenTemplate(draft);
  if (!parsed) return layout;
  const currentVersion = layout.templateDraft?.version ?? layout.templateVersion ?? 1;
  const next: ScreenTemplate = { ...parsed, version: parsed.version > currentVersion ? parsed.version : currentVersion + 1 };
  const allowed = new Set(next.regions.flatMap((region) => region.interfaces.map((item) => `${region.id}:${item.key}`)));
  const bindings = (layout.interfaceBindings ?? []).filter((item) => allowed.has(`${item.regionId}:${item.key}`));
  const titles = layout.regionTitles
    ? Object.fromEntries(Object.entries(layout.regionTitles).filter(([id]) => next.regions.some((region) => region.id === id)))
    : undefined;
  return materializeScreenTemplate(next, {
    sceneName,
    interfaceBindings: bindings,
    regionTitles: titles,
    glassOpacity: layout.glassOpacity,
    templateDraft: next,
  });
}

export function bindingFromScopeValue(regionId: string, key: string, scope: SceneWidgetScope | undefined): TemplateInterfaceBinding | null {
  return bindingFromScope(regionId, key, scope);
}

export function extractInterfaceBindingsFromWidgets(template: ScreenTemplate, widgets: SceneWidget[]): {
  interfaceBindings: TemplateInterfaceBinding[];
  regionTitles: Record<string, string>;
} {
  const interfaceBindings: TemplateInterfaceBinding[] = [];
  const regionTitles: Record<string, string> = {};
  const remaining = [...widgets];
  for (const region of template.regions) {
    const index = remaining.findIndex((item) => item.id === region.id || item.type === region.type);
    if (index < 0) continue;
    const widget = remaining.splice(index, 1)[0]!;
    if (widget.title) regionTitles[region.id] = widget.title;
    for (const iface of region.interfaces) {
      if (iface.valueType === "scope") {
        const binding = bindingFromScope(region.id, iface.key, widget.scope);
        if (binding) interfaceBindings.push(binding);
        continue;
      }
      const slot = widget.slots?.find((item) => item.key === iface.key);
      if (slot?.deviceId) {
        const binding: TemplateInterfaceBinding = {
          regionId: region.id,
          key: iface.key,
          source: "device-point",
          deviceId: slot.deviceId,
        };
        if (slot.telemetryKey) binding.telemetryKey = slot.telemetryKey;
        if (slot.unit) binding.unit = slot.unit;
        if (slot.label) binding.label = slot.label;
        interfaceBindings.push(binding);
      }
    }
  }
  return { interfaceBindings, regionTitles };
}

export function adoptScreenTemplate(layout: SceneWidgetLayout, template: ScreenTemplate, sceneName?: string): SceneWidgetLayout {
  const extracted = extractInterfaceBindingsFromWidgets(template, layout.widgets);
  return materializeScreenTemplate(template, {
    sceneName,
    interfaceBindings: extracted.interfaceBindings,
    regionTitles: extracted.regionTitles,
    glassOpacity: layout.glassOpacity,
  });
}
