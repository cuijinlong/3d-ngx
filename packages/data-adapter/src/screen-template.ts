import overviewSituationJson from "./screen-templates/overview-situation.json";
import tianjiaoHeatPumpJson from "./screen-templates/tianjiao-heat-pump.json";
import {
  SCENE_WIDGET_TYPE_REGISTRY,
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
  /**
   * 设计值常量（2026-11-23）。
   *
   * <p>仪表量程、参考线这类「设计值」不属于任何设备。模板里直接写：
   *
   * <pre>
   * { "key": "max", "name": "满量程", "valueType": "number",
   *   "allowedSources": [], "constant": 100 }
   * </pre>
   *
   * <p>存在此字段时，该 interface **不要求绑定**，生成的槽位带 `constant`，
   * 待绑定清单也不会报它。
   *
   * <p>为什么不能靠「留空让运行时默认 100」代替：
   * 默认值只能抽一个通用数（百分比）。功率量程 750kW、温度下限 -25℃
   * 这些必须由模板作者写清楚 —— 靠猜就会画出一个量纲错的环。
   */
  constant?: number;
  /**
   * 多设备聚合口径（2026-11-24）。
   *
   * <h3>为什么必须在模板里写</h3>
   *
   * <p>「9 台之和」这种槽位，如果只写 label 不写 `aggregate`，
   * 实例化出来的卡片 `hasAggregate = false`，于是走「绑一台设备」的取数路径 ——
   * 而它名下没有 deviceId，结果是**一张永远空白的趋势图，且不报错**。
   *
   * <p>实测证据：模板 JSON 里 `series-0` 叫「9 台之和」却没 `aggregate`；
   * 而库里天骄场景那份同名槽位带着 `aggregate: "sum"` ——
   * 说明是后来手工补的，模板一直缺。凡是从模板新建的场景，
   * 趋势图都是空的。
   */
  aggregate?: "sum" | "avg" | "max" | "min";
  /** 渲染形态（device-list 逐台列用 `bar`，见 SceneWidgetSlot.render）。 */
  render?: "value" | "bar";
  /** 显示类型：开关量需要 `boolean` 才会显示「运行/停止」而不是 1/0。 */
  displayType?: "number" | "boolean" | "text";
}

/**
 * 部件级设置（2026-11-24）。
 *
 * <p>`interfaces` 描述「有哪些可绑的槽位」，但这些**不描述卡片怎么取数**。
 * 一张「场站用电趋势」和一张「单台机组功率趋势」槽位结构可以完全一样，
 * 区别全在这里：走场站能量口径（`dataSource: "energy"`）还是走设备遥测。
 *
 * <p>缺了它，模板只能做出一张「结构对、数据源靠运气」的卡 ——
 * 而 data-adapter 的 materialize 以前根本无从表达这件事。
 */
export interface ScreenTemplateWidgetSettings {
  dataSource?: "telemetry" | "energy";
  energyMetric?: "usage" | "cost" | "carbon" | "tce" | "trend" | "ranking";
  energyKind?: string;
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
  /** 部件级取数设置。见 {@link ScreenTemplateWidgetSettings}。 */
  settings?: ScreenTemplateWidgetSettings;
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
  /*
   * 常量量程（2026-11-23）。
   *
   * 与 `parseWidgetSlot` 同口径：排除空串（`Number("") === 0` 会把
   * 「没填」误读成「量程 0」），允许 0 与负数。
   */
  const rawConstant = row.constant;
  if (rawConstant !== undefined && rawConstant !== null && rawConstant !== "") {
    const constant = Number(rawConstant);
    if (Number.isFinite(constant)) item.constant = constant;
  }
  /*
   * 槽位的取数/显示形态（2026-11-24）。
   *
   * 这三个字段以前被**静默丢弃**（解析函数不认就扔），于是模板作者
   * 在 JSON 里写了 `aggregate: "sum"` 也白写，实例化后卡片是空的。
   * 不认识的值一律不设 —— 留空比设错好（设错照样静默空白）。
   */
  const aggregate = text(row.aggregate);
  if (aggregate === "sum" || aggregate === "avg" || aggregate === "max" || aggregate === "min") {
    item.aggregate = aggregate;
  }
  const render = text(row.render);
  if (render === "value" || render === "bar") item.render = render;
  const displayType = text(row.displayType);
  if (displayType === "number" || displayType === "boolean" || displayType === "text") {
    item.displayType = displayType;
  }
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
  /* 部件级取数设置（2026-11-24）—— 只有认得的值才收，其余忽略 */
  if (row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)) {
    const rawSettings = row.settings as Record<string, unknown>;
    const settings: ScreenTemplateWidgetSettings = {};
    const dataSource = text(rawSettings.dataSource);
    if (dataSource === "telemetry" || dataSource === "energy") settings.dataSource = dataSource;
    const energyMetric = text(rawSettings.energyMetric);
    if (energyMetric === "usage" || energyMetric === "cost" || energyMetric === "carbon"
      || energyMetric === "tce" || energyMetric === "trend" || energyMetric === "ranking") {
      settings.energyMetric = energyMetric;
    }
    const energyKind = text(rawSettings.energyKind);
    if (energyKind) settings.energyKind = energyKind;
    if (Object.keys(settings).length) region.settings = settings;
  }
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

/** 一种卡片类型的槽位模板（供 AI 新增卡片时使用）。 */
export interface WidgetTypeSchema {
  type: string;
  label: string;
  defaultSize: { w: number; h: number };
  /**
   * `usesScope` 为 true 的项是范围选择器，不是测点。
   *
   * <p>`aggregate` / `displayType` 是模板给的**默认形态** ——
   * AI 照着建卡才不会是「结构对、一打开就空白」。
   */
  slots: Array<{
    key: string;
    name: string;
    valueType: string;
    usesScope: boolean;
    aggregate?: "sum" | "avg" | "max" | "min";
    displayType?: "number" | "boolean" | "text";
  }>;
  /** 该类型在模板里惯用的取数口径（`dataSource` / `energyMetric` / `energyKind`）。 */
  settings?: ScreenTemplateWidgetSettings;
  /**
   * true = 这个类型「按设备逐台各读一个值」（device-list / bar-compare）。
   *
   * <p>这类类型的测点槽位**不能带 `aggregate`** —— 一旦带了，
   * 待绑定诊断与取数都会切到「按范围聚合历史」的分支
   * （见 `describePendingSlot` 的聚合分支），而这里要的恰恰是逐台最新值。
   * 实测后果：卡片显示「等待范围内设备上报 water_in_temp 的历史（用于求平均）」，
   * 而它本该显示 9 台各自的水温。
   */
  perDevice?: boolean;
}

/**
 * 归纳「卡片类型 → 槽位模板」。
 *
 * <h3>为什么要这个函数（2026-11-24）</h3>
 *
 * <p>AI 搭建要能**新增**卡片，就必须知道那种类型该有哪些槽位键。
 * 只给「已有卡片的槽位」不够 —— 实测 AI 的原话是
 * 「上下文未提供 trend-chart 的槽位定义，不能瞎绑」，然后拒绝出提案。
 * 它说得对：`series-0` / `main` / `rows` 是设计契约，猜错就是
 * `slot-not-found`，整个提案被整体拒绝（提案不做部分应用）。
 *
 * <p>槽位键的权威来源就是内置模板的 `regions[].interfaces[]` ——
 * 渲染、待绑定判定、提案校验都以它为准。所以从那里归纳，不另立一份。
 *
 * <p>按类型去重，取先出现的。同类型在不同模板里的槽位一致
 * （`metric-card` 都是 `filter/main/left/right`），
 * 若将来分歧，应该先统一模板而不是让 AI 随机看到两种。
 */
export function describeWidgetTypeSchemas(): WidgetTypeSchema[] {
  const byType = new Map<string, WidgetTypeSchema>();
  for (const template of BUILTIN_SCREEN_TEMPLATES) {
    for (const region of template.regions) {
      if (byType.has(region.type)) continue;
      const meta = SCENE_WIDGET_TYPE_REGISTRY.find((item) => item.type === region.type);
      byType.set(region.type, {
        type: region.type,
        label: meta?.label ?? region.type,
        defaultSize: meta?.defaultSize ?? { w: region.w, h: region.h },
        slots: (region.interfaces ?? []).map((iface) => ({
          key: iface.key,
          name: iface.name,
          valueType: iface.valueType,
          usesScope: iface.allowedSources.includes("site")
            || iface.allowedSources.includes("scene-topology"),
          ...(iface.aggregate ? { aggregate: iface.aggregate } : {}),
          ...(iface.displayType ? { displayType: iface.displayType } : {}),
        })),
        ...(region.settings ? { settings: { ...region.settings } } : {}),
        ...(meta?.scopePerDevice ? { perDevice: true } : {}),
      });
    }
  }
  return [...byType.values()];
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
    const slotIfaces = region.interfaces.filter(
      (item) => item.allowedSources.includes("device-point") || item.constant != null,
    );
    const slots: SceneWidgetSlot[] = slotIfaces.map((iface) => {
      const bound = regionBindings.find((item) => item.key === iface.key);
      const slot: SceneWidgetSlot = { key: iface.key, label: iface.name };
      if (bound?.unit) slot.unit = bound.unit;
      if (bound?.label) slot.label = bound.label;
      if (bound?.deviceId) slot.deviceId = bound.deviceId;
      if (bound?.telemetryKey) slot.telemetryKey = bound.telemetryKey;
      /* 设计值优先于绑定：与 readSlotValue / pending 同口径 */
      if (iface.constant != null) slot.constant = iface.constant;
      /*
       * 取数/显示形态跟着模板走（2026-11-24）。
       *
       * 以前这三项不搬 —— 模板写了也不生效。后果最典型的是
       * 「9 台之和」的趋势图：`aggregate` 丢了 → hasAggregate=false
       * → 走单设备取数 → 没有 deviceId → **空白卡片，且不报错**。
       */
      if (iface.aggregate) slot.aggregate = iface.aggregate;
      if (iface.render) slot.render = iface.render;
      if (iface.displayType) slot.displayType = iface.displayType;
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
      /*
       * 部件级取数设置（2026-11-24）。
       *
       * 没有它，「场站用电趋势」与「单台机组功率趋势」在模板里长得一模一样 ——
       * 因为差别不在槽位结构，而在取数口径（场站能量 vs 设备遥测）。
       */
      ...(region.settings?.dataSource ? { dataSource: region.settings.dataSource } : {}),
      ...(region.settings?.energyMetric ? { energyMetric: region.settings.energyMetric } : {}),
      ...(region.settings?.energyKind ? { energyKind: region.settings.energyKind } : {}),
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
