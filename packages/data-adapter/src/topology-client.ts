/**
 * 平台设备拓扑（guard-server / 8090）客户端。
 * 路径以实测为准：不存在的接口会在调用处降级并留下说明，不编造 API。
 */
import type { Device } from "@idt/shared-types";
import { GuardHttpError, type GuardClient } from "./guard-client";

export type TopologyViewType = "physical" | "item" | "area" | "usage" | "space" | string;

export interface TopologySite {
  id: string;
  name: string;
}

export interface TopologyViewOption {
  code: TopologyViewType;
  label: string;
  dimension?: boolean | string;
  scopeLabel?: string;
  allLabel?: string;
}

export type TopologyBaseType = "auto" | "steel-rail" | "concrete-pad" | "none";

/**
 * 套装携带的**渲染规则**（2026-11-23）。
 *
 * <h2>为什么要有这份结构</h2>
 *
 * <p>此前套装只有 label / description 这类说明文字。`hvac-hud-v1` 的描述写着
 * 「管三态」，但代码里没有任何实现 —— 选了套装，管道不流速、阀门不变色。
 * 描述成了空话。
 *
 * <p>这份结构把它变成可执行契约：前端按 packId 取规则，应用到引擎。
 *
 * <h2>每一项都是可选的</h2>
 *
 * <p>平台可能只给一部分（旧版本、自定义套装）。前端必须能只拿到
 * `pipe.flowSpeed` 就工作，其余走默认 —— 不能因为缺一个字段整份规则失效。
 */
export interface StylePackRenderRules {
  pipe?: {
    /** 流动动画播放速率。1.0 = 原始速度；<1 更慢更易观察 */
    flowSpeed?: number;
    /** 未流动管道的透明度（0~1）。1 = 与流动时一样亮 */
    idleOpacity?: number;
  };
  valve?: {
    /** 开启状态染色（#RRGGBB） */
    openColor?: string;
    /** 关闭状态染色 */
    closedColor?: string;
    /** 是否真的给关闭的阀门染色。false 时只播 open/close 动画片段 */
    tintClosed?: boolean;
  };
  device?: {
    /** 是否给设备加状态环 */
    statusRing?: boolean;
    /**
     * 数据超过该毫秒数未更新时开始视觉淡出。0 = 不淡出。
     *
     * <p>这是「防止把陈旧数据当实时值」的保险：
     * 曾出现库里停了 51 小时、画面仍显示 7.4℃ 的事故。
     */
    staleFadeMs?: number;
  };
}

export interface TopologyStylePack {
  packId: string;
  packVersion: string;
  stylePack: string;
  label: string;
  description?: string;
  suitability?: string;
  defaultBaseType: TopologyBaseType;
  requireWeatherSite: boolean;
  /** 渲染规则；缺省时前端按内置默认值渲染（不是不渲染） */
  render?: StylePackRenderRules;
}

export interface TopologyBaseTypeOption {
  code: TopologyBaseType;
  label: string;
  hint?: string;
}

export interface TopologyStylePackCatalog {
  packs: TopologyStylePack[];
  baseTypes: TopologyBaseTypeOption[];
  maxBytes: number;
  storeEnabled?: boolean;
  usedFallback?: boolean;
  status?: number;
}

export interface TopologyAssetRef {
  ok?: boolean;
  kind: "glb" | "pack" | string;
  objectKey: string;
  fileName: string;
  size?: number;
  contentType?: string;
  sha256?: string;
  url?: string;
  inbox?: boolean;
}

export interface TopologyScopeOption {
  id: string;
  name: string;
  path?: string;
  type?: string;
  level?: number;
}

export interface TopologyScopeOptions {
  viewType?: string;
  scopeLabel?: string;
  allLabel?: string;
  options: TopologyScopeOption[];
}

export interface TopologyListQuery {
  siteId?: string;
  customerId?: string;
  sceneInstance?: boolean;
}

export interface TopologyGlbRef {
  objectKey: string;
  fileName?: string;
  size?: number;
  url?: string;
}

export interface TopologyCard {
  id: string;
  name: string;
  siteId?: string;
  siteName?: string;
  viewType?: string;
  description?: string;
  customerId?: string;
  roots?: string[];
  rootNames?: string[];
  packId?: string;
  packVersion?: string;
  stylePack?: string;
  sceneInstance?: boolean;
  publishState?: string;
  listOrder?: number;
  templateId?: string;
  templateVersion?: string;
  glb?: TopologyGlbRef;
}

export interface TopologyListResult {
  sites: TopologySite[];
  items: TopologyCard[];
  total?: number;
}

export interface TopologyDeviceNode {
  id: string;
  name: string;
  entityType: string;
  entityId?: string;
}

export interface TopologyGraph {
  id: string;
  name?: string;
  siteId?: string;
  siteName?: string;
  customerId?: string;
  viewType?: string;
  roots?: string[];
  /**
   * 风格套装引用（2026-11-23 补）。
   *
   * <p>类型里原来**没有这三个字段** —— 而 `RuntimeShell` 正是从
   * `document.platform.stylePack` 读套装。走 graph 路径打开的场景
   * 永远拿到 undefined，于是渲染规则回落到默认值：
   * 管道流速、阀门染色全部「看起来没生效」。
   *
   * <p>平台拓扑接口是有这三个值的（实测 `hvac-hud-v1@1.0.0`），
   * 只是解析时没取。典型的"后端给了、类型没声明、解析漏了"三连。
   */
  packId?: string;
  packVersion?: string;
  stylePack?: string;
  nodes: TopologyDeviceNode[];
  sceneInstance?: boolean;
  publishState?: string;
  glb?: TopologyGlbRef;
}

const VIEW_FALLBACK: TopologyViewOption[] = [
  { code: "physical", label: "物理结构", scopeLabel: "", allLabel: "覆盖整个场站" },
  { code: "item", label: "用电分项", scopeLabel: "具体分项", allLabel: "该场站下全部用电分项" },
  { code: "area", label: "用能区域", scopeLabel: "具体分区", allLabel: "该场站下全部用能区域" },
  { code: "usage", label: "用能性质", scopeLabel: "具体用能性质", allLabel: "该场站下全部用能性质" },
  { code: "space", label: "空间位置", scopeLabel: "具体空间位置", allLabel: "该场站下全部空间位置" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function flagTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function idOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return text(value);
  return text(first(asRecord(value), ["id"]));
}

function stringIds(value: unknown): string[] {
  return asArray(value).map((item) => (typeof item === "string" || typeof item === "number" ? text(item) : idOf(item))).filter(Boolean);
}

function stringNames(value: unknown): string[] {
  return asArray(value)
    .map((item) => (typeof item === "string" || typeof item === "number" ? text(item) : text(first(asRecord(item), ["name", "label", "title"]))))
    .filter(Boolean);
}

function first(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function assetRefOf(raw: unknown): TopologyGlbRef | undefined {
  if (typeof raw === "string" && raw.trim()) return { objectKey: raw.trim() };
  const row = asRecord(raw);
  const objectKey = text(first(row, ["objectKey", "key"]));
  if (!objectKey) return undefined;
  const size = Number(first(row, ["size", "fileSize"]));
  const fileName = text(first(row, ["fileName", "name"])) || undefined;
  const url = text(first(row, ["url"])) || undefined;
  return {
    objectKey,
    ...(fileName ? { fileName } : {}),
    ...(Number.isFinite(size) && size > 0 ? { size } : {}),
    ...(url ? { url } : {}),
  };
}

function siteOf(raw: unknown): TopologySite | null {
  const row = asRecord(raw);
  const id = text(first(row, ["id", "siteId"]));
  const name = text(first(row, ["name", "siteName", "title"]));
  if (!id) return null;
  return { id, name: name || id };
}

function cardOf(raw: unknown): TopologyCard | null {
  const row = asRecord(raw);
  const id = text(first(row, ["id", "topologyId"]));
  if (!id) return null;
  const site = asRecord(first(row, ["site"]) ?? {});
  const info = asRecord(first(row, ["additionalInfo", "info"]) ?? {});
  const customer = asRecord(first(row, ["customer"]) ?? {});
  const rawRoots = first(row, ["roots"]) ?? first(info, ["roots"]);
  const roots = stringIds(rawRoots);
  const namedFromObjects = asArray(rawRoots)
    .map((item) => (typeof item === "object" ? text(first(asRecord(item), ["name", "label", "title"])) : ""))
    .filter(Boolean);
  const listedNames = stringNames(first(row, ["rootNames"]) ?? first(info, ["rootNames"]));
  const rootNames = listedNames.length ? listedNames : namedFromObjects;
  return {
    id,
    name: text(first(row, ["name", "title"]), id),
    siteId: text(first(row, ["siteId"]) || first(site, ["id"])),
    siteName: text(first(row, ["siteName"]) || first(site, ["name"])),
    viewType: text(first(row, ["viewType", "view", "type"]) || first(info, ["viewType"])),
    description: text(first(row, ["description", "remark"]) || first(info, ["description"])),
    customerId: idOf(first(row, ["customerId"]) ?? first(customer, ["id"]) ?? first(info, ["customerId"])),
    roots: roots.length ? roots : undefined,
    rootNames: rootNames.length ? rootNames : undefined,
    packId: text(first(row, ["packId"]) || first(info, ["packId"])) || undefined,
    packVersion: text(first(row, ["packVersion"]) || first(info, ["packVersion"])) || undefined,
    stylePack: text(first(row, ["stylePack"]) || first(info, ["stylePack"])) || undefined,
    sceneInstance: flagTrue(first(row, ["sceneInstance"]) ?? first(info, ["sceneInstance"])) || undefined,
    publishState: text(first(row, ["publishState"]) || first(info, ["publishState"])) || undefined,
    listOrder: Number.isFinite(Number(first(row, ["listOrder"]) ?? first(info, ["listOrder"]))) ? Number(first(row, ["listOrder"]) ?? first(info, ["listOrder"])) : undefined,
    templateId: text(first(row, ["templateId"]) || first(info, ["templateId"])) || undefined,
    templateVersion: text(first(row, ["templateVersion"]) || first(info, ["templateVersion"])) || undefined,
    glb: assetRefOf(first(row, ["glb"]) ?? first(info, ["glb"])),
  };
}

function viewOf(raw: unknown): TopologyViewOption | null {
  const row = asRecord(raw);
  const code = text(first(row, ["code", "viewType", "id", "value"]));
  if (!code) return null;
  const fallback = VIEW_FALLBACK.find((item) => item.code === code);
  return {
    code,
    label: text(first(row, ["label", "name", "title"]), fallback?.label || code),
    dimension: typeof row.dimension === "boolean" ? row.dimension : text(first(row, ["dimension"])),
    scopeLabel: text(first(row, ["scopeLabel"]), fallback?.scopeLabel),
    allLabel: text(first(row, ["allLabel"]), fallback?.allLabel),
  };
}

function scopeOptionOf(raw: unknown): TopologyScopeOption | null {
  const row = asRecord(raw);
  const id = text(first(row, ["id", "entityId", "value"]));
  if (!id) return null;
  return {
    id,
    name: text(first(row, ["name", "label", "title"]), id),
    path: text(first(row, ["path", "fullName"])),
    type: text(first(row, ["type", "entityType"])),
    level: typeof row.level === "number" ? row.level : undefined,
  };
}

function nodeOf(raw: unknown): TopologyDeviceNode | null {
  const row = asRecord(raw);
  const entityType = text(first(row, ["entityType", "type", "nodeType"])).toUpperCase();
  const id = text(first(row, ["entityId", "id", "deviceId"]));
  if (!id) return null;
  return {
    id,
    name: text(first(row, ["name", "label", "title"]), id),
    entityType: entityType || "UNKNOWN",
    entityId: text(first(row, ["entityId", "deviceId"])) || id,
  };
}

export class TopologyApi {
  constructor(private readonly client: GuardClient) {}

  async list(page = 0, pageSize = 100, query?: TopologyListQuery): Promise<TopologyListResult> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query?.siteId) params.set("siteId", query.siteId);
    if (query?.customerId) params.set("customerId", query.customerId);
    if (query?.sceneInstance === true) params.set("sceneInstance", "true");
    else if (query?.sceneInstance === false) params.set("sceneInstance", "false");
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/topologies?${params.toString()}`,
    );
    const row = asRecord(payload);
    const sites = asArray(first(row, ["sites"])).map(siteOf).filter((s): s is TopologySite => Boolean(s));
    const rawItems = first(row, ["items", "data", "content", "topologies", "rows"]);
    const items = asArray(rawItems).map(cardOf).filter((s): s is TopologyCard => Boolean(s));
    const total = Number(first(row, ["total", "totalElements", "count"]));
    return { sites, items, total: Number.isFinite(total) ? total : items.length };
  }

  async listAll(query?: TopologyListQuery): Promise<TopologyListResult> {
    const items: TopologyCard[] = [];
    const sites: TopologySite[] = [];
    let total = 0;
    const pageSize = 100;
    for (let page = 0; page < 50; page += 1) {
      const chunk = await this.list(page, pageSize, query);
      items.push(...chunk.items);
      for (const site of chunk.sites) {
        if (!sites.some((row) => row.id === site.id)) sites.push(site);
      }
      total = chunk.total ?? items.length;
      if (chunk.items.length < pageSize || items.length >= total) break;
    }
    return { sites, items, total };
  }

  async views(): Promise<{ options: TopologyViewOption[]; usedFallback: boolean; status?: number }> {
    try {
      const payload = await this.client.requestJson<unknown>("GET", "/api/energy/topologies/views");
      const rows = Array.isArray(payload) ? payload : asArray(first(asRecord(payload), ["data", "items", "views", "options"]));
      const options = rows.map(viewOf).filter((s): s is TopologyViewOption => Boolean(s));
      if (options.length) return { options, usedFallback: false };
      return { options: VIEW_FALLBACK, usedFallback: true };
    } catch (error) {
      const status = error instanceof GuardHttpError ? error.status : undefined;
      return { options: VIEW_FALLBACK, usedFallback: true, status };
    }
  }

  async scopeOptions(siteId: string, viewType: string): Promise<{ data: TopologyScopeOptions; missing: boolean; status?: number }> {
    const query = `siteId=${encodeURIComponent(siteId)}&viewType=${encodeURIComponent(viewType)}`;
    try {
      const payload = await this.client.requestJson<unknown>("GET", `/api/energy/topologies/scope-options?${query}`);
      const row = Array.isArray(payload) ? { options: payload } : asRecord(payload);
      const options = asArray(first(row, ["options", "data", "items", "roots"]))
        .map(scopeOptionOf)
        .filter((s): s is TopologyScopeOption => Boolean(s));
      const fallback = VIEW_FALLBACK.find((item) => item.code === viewType);
      return {
        missing: false,
        data: {
          viewType: text(first(row, ["viewType"]), viewType),
          scopeLabel: text(first(row, ["scopeLabel"]), fallback?.scopeLabel),
          allLabel: text(first(row, ["allLabel"]), fallback?.allLabel),
          options,
        },
      };
    } catch (error) {
      const status = error instanceof GuardHttpError ? error.status : undefined;
      const fallback = VIEW_FALLBACK.find((item) => item.code === viewType);
      return {
        missing: true,
        status,
        data: { viewType, scopeLabel: fallback?.scopeLabel, allLabel: fallback?.allLabel, options: [] },
      };
    }
  }

  async stylePacks(): Promise<TopologyStylePackCatalog> {
    try {
      const payload = await this.client.requestJson<TopologyStylePackCatalog>("GET", "/api/energy/topology-style-packs");
      if (payload?.packs?.length) {
        return { ...payload, usedFallback: false };
      }
    } catch (error) {
      const status = error instanceof GuardHttpError ? error.status : undefined;
      return { ...STYLE_PACK_FALLBACK, usedFallback: true, status };
    }
    return { ...STYLE_PACK_FALLBACK, usedFallback: true };
  }

  async uploadAsset(file: File, input: { kind: "glb" | "pack"; siteId?: string; topologyId?: string }): Promise<TopologyAssetRef> {
    const form = new FormData();
    form.append("file", file);
    // kind 只放查询参数。表单里再附一份时，接口会把两个值拼成 "glb,glb" 并返回 400。
    const query = new URLSearchParams();
    query.set("kind", input.kind);
    if (input.siteId) query.set("siteId", input.siteId);
    if (input.topologyId) query.set("topologyId", input.topologyId);
    return this.client.requestForm<TopologyAssetRef>(`/api/energy/topology-assets?${query.toString()}`, form);
  }

  assetUrl(objectKey: string): string {
    return `/api/energy/topology-assets?objectKey=${encodeURIComponent(objectKey)}`;
  }

  async downloadAsset(objectKey: string): Promise<ArrayBuffer> {
    const asset = await this.client.requestBytes(this.assetUrl(objectKey));
    return asset.blob.arrayBuffer();
  }

  async deleteAsset(objectKey: string): Promise<{ ok: boolean; deleted: string }> {
    return this.client.requestJson<{ ok: boolean; deleted: string }>(
      "DELETE",
      `/api/energy/topology-assets?objectKey=${encodeURIComponent(objectKey)}`,
    );
  }

  async create(input: {
    siteId: string;
    name: string;
    viewType: string;
    description?: string;
    customerId?: string;
    sceneInstance?: boolean;
    publishState?: string;
    templateId?: string;
    templateVersion?: string;
    listOrder?: number;
    roots?: string[];
    packId?: string;
    packVersion?: string;
    stylePack?: string;
    baseType?: TopologyBaseType;
    structurePolicy?: TopologyBaseType;
    weatherSite?: string;
    glb?: { objectKey: string; fileName?: string };
    styleFiles?: Array<{ objectKey: string; fileName?: string }>;
  }): Promise<TopologyCard> {
    const payload = await this.client.requestJson<unknown>("POST", "/api/energy/topologies", {
      siteId: input.siteId,
      name: input.name,
      viewType: input.viewType,
      description: input.description || undefined,
      customerId: input.customerId || undefined,
      sceneInstance: input.sceneInstance === true ? true : undefined,
      publishState: input.publishState || undefined,
      templateId: input.templateId || undefined,
      templateVersion: input.templateVersion || undefined,
      listOrder: input.listOrder,
      roots: input.roots && input.roots.length ? input.roots : undefined,
      packId: input.packId,
      packVersion: input.packVersion,
      stylePack: input.stylePack,
      baseType: input.baseType,
      structurePolicy: input.structurePolicy ?? input.baseType,
      weatherSite: input.weatherSite,
      glb: input.glb,
      styleFiles: input.styleFiles,
    });
    const card = cardOf(payload) ?? cardOf(asRecord(payload).data);
    if (!card) throw new Error("创建拓扑成功，但返回里没有拓扑 id");
    return card;
  }

  async update(topologyId: string, input: {
    name?: string;
    viewType?: string;
    description?: string;
    roots?: string[];
    packId?: string;
    packVersion?: string;
    stylePack?: string;
    baseType?: TopologyBaseType;
    structurePolicy?: TopologyBaseType;
    weatherSite?: string;
    glb?: { objectKey: string; fileName?: string };
    styleFiles?: Array<{ objectKey: string; fileName?: string }>;
    publishState?: string;
  }): Promise<TopologyCard> {
    const payload = await this.client.requestJson<unknown>(
      "POST",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}`,
      input,
    );
    const card = cardOf(payload) ?? cardOf(asRecord(payload).data);
    if (!card) throw new Error("更新拓扑成功，但返回里没有拓扑 id");
    return card;
  }

  async load(topologyId: string): Promise<TopologyGraph> {
    const payload = await this.client.requestJson<unknown>("GET", `/api/energy/topologies/${encodeURIComponent(topologyId)}`);
    const row = asRecord(payload);
    const graph = asRecord(first(row, ["graph", "data"]) ?? row);
    const nodes = asArray(first(graph, ["nodes", "elements"]))
      .map(nodeOf)
      .filter((s): s is TopologyDeviceNode => Boolean(s));
    return {
      id: text(first(row, ["id"]) || first(graph, ["id"]), topologyId),
      name: text(first(row, ["name"]) || first(graph, ["name"])),
      siteId: text(first(row, ["siteId"]) || first(graph, ["siteId"])),
      siteName: text(first(row, ["siteName"]) || first(graph, ["siteName"])) || undefined,
      customerId: idOf(first(row, ["customerId"]) ?? first(graph, ["customerId"])) || undefined,
      viewType: text(first(row, ["viewType"]) || first(graph, ["viewType"])),
      roots: asArray(first(row, ["roots"]) || first(graph, ["roots"])).map((item) => text(item)).filter(Boolean),
      /* 与 card 路径保持一致（见 TopologyGraph 类型的说明） */
      packId: text(first(row, ["packId"]) || first(graph, ["packId"])) || undefined,
      packVersion: text(first(row, ["packVersion"]) || first(graph, ["packVersion"])) || undefined,
      stylePack: text(first(row, ["stylePack"]) || first(graph, ["stylePack"])) || undefined,
      nodes,
      sceneInstance: flagTrue(first(row, ["sceneInstance"]) ?? first(graph, ["sceneInstance"])) || undefined,
      publishState: text(first(row, ["publishState"]) || first(graph, ["publishState"])) || undefined,
      glb: assetRefOf(first(row, ["glb"]) ?? first(graph, ["glb"])),
    };
  }

  async listDeviceNodes(topologyId: string): Promise<TopologyDeviceNode[]> {
    const graph = await this.load(topologyId);
    return graph.nodes.filter((node) => node.entityType === "DEVICE" || node.entityType === "device");
  }
}

/**
 * 拓扑节点通常没有 additionalInfo.deviceVirtual，缺省会被当成实时设备。
 * 不要直接当作可绑定列表。请用 intersectRealtimeDevices 或 listRealtimeDevices({ topologyId })。
 */
export function devicesFromTopologyNodes(nodes: TopologyDeviceNode[]): Device[] {
  const now = new Date().toISOString();
  return nodes.map((node) => ({
    id: node.entityId || node.id,
    name: node.name,
    type: "device",
    points: [],
    source: "guard",
    createdAt: now,
    updatedAt: now,
  }));
}

export const STYLE_PACK_FALLBACK: TopologyStylePackCatalog = {
  packs: [
    {
      packId: "hvac-hud-v1",
      packVersion: "1.0.0",
      stylePack: "hvac-hud-v1@1.0.0",
      label: "HUD套装",
      description: "可折叠浮层、管三态、自适应底座",
      suitability: "机房/冷热源",
      defaultBaseType: "auto",
      requireWeatherSite: false,
    },
    {
      packId: "campus-daynight-v1",
      packVersion: "1.0.0",
      stylePack: "campus-daynight-v1@1.0.0",
      label: "全景套装",
      description: "院区昼夜与天气联动",
      suitability: "院区全景",
      defaultBaseType: "none",
      requireWeatherSite: true,
    },
  ],
  baseTypes: [
    { code: "auto", label: "自动", hint: "模块机和冷机用钢结构，水泵和冷却塔用混凝土" },
    { code: "steel-rail", label: "钢结构" },
    { code: "concrete-pad", label: "混凝土" },
    { code: "none", label: "无" },
  ],
  maxBytes: 48 * 1024 * 1024,
};

export { VIEW_FALLBACK };

export function isSceneInstanceCard(card: Pick<TopologyCard, "sceneInstance">): boolean {
  return card.sceneInstance === true;
}

export function filterTopologiesForCustomer(items: TopologyCard[], customerId: string): TopologyCard[] {
  if (!customerId) return [];
  return items.filter((item) => item.customerId === customerId);
}

/** 平台卡片只收 sceneInstance === true；缺省或 false 当作普通二维设备图。 */
export function filterCustomerSceneInstanceCards(items: TopologyCard[], customerId: string): TopologyCard[] {
  return filterTopologiesForCustomer(items, customerId).filter(isSceneInstanceCard);
}
