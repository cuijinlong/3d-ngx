import type { DeviceBinding } from "@idt/shared-types";
import { normalizeBinding } from "./binding-normalize";
import { parseSceneWidgetLayout, type SceneWidgetLayout } from "./scene-widget-layout";
import type { GuardClient } from "./guard-client";
import { GuardHttpError } from "./guard-client";
import {
  clearDefaultSceneDraft,
  readDefaultSceneDraft,
  writeDefaultSceneDraft,
  type ResolveLegacySceneId,
} from "./default-scene-draft";
import {
  isDefaultSceneEmptyPointer,
  isSceneStorageUnavailable,
  isSceneStorageUnmounted,
} from "./scene-storage-errors";
import {
  clearSceneWidgetDraft,
  readSceneWidgetDraft,
  writeSceneWidgetDraft,
} from "./scene-widget-draft";
import {
  jumpsFromObjectLinks,
  objectLinksFromJumps,
  parseSceneJumpRows,
} from "./scene-jump-adapter";
import {
  readSceneJumpDraft,
  writeSceneJumpDraft,
  type SceneJumpLink,
} from "./scene-jump-draft";

export const SCENE_BINDINGS_EMPTY = { schemaVersion: "1.0.0" as const, bindings: [] as DeviceBinding[] };
export const SCENE_WIDGETS_EMPTY: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [] };

export interface SceneBindingsDocument {
  schemaVersion: "1.0.0";
  bindings: DeviceBinding[];
}

export type SceneWidgetsDocument = SceneWidgetLayout;

export interface DefaultScenePointer {
  customerId: string;
  topologyId?: string | null;
  source: "platform" | "local-draft";
}

export interface SceneJumpsResult {
  links: SceneJumpLink[];
  source: "platform" | "local-draft";
}

export interface BindingsResult {
  document: SceneBindingsDocument;
  source: "platform" | "local-draft";
}

export interface WidgetsResult {
  document: SceneWidgetsDocument;
  source: "platform" | "empty" | "local-draft";
}

let cachedAvailability: { value: boolean; at: number } | null = null;

export function resetSceneStorageAvailabilityForTests(): void {
  cachedAvailability = null;
}

export class SceneStorageApi {
  constructor(private readonly client: GuardClient) {}

  async probe(customerId?: string): Promise<boolean> {
    if (cachedAvailability && Date.now() - cachedAvailability.at < 15_000) {
      return cachedAvailability.value;
    }
    const id = customerId || "00000000-0000-0000-0000-000000000001";
    try {
      await this.client.requestJson("GET", `/api/energy/customers/${encodeURIComponent(id)}/default-scene`);
      cachedAvailability = { value: true, at: Date.now() };
      return true;
    } catch (error) {
      const ok = !isSceneStorageUnmounted(error) && error instanceof GuardHttpError && error.status < 500;
      cachedAvailability = { value: ok, at: Date.now() };
      return ok;
    }
  }

  async getDefaultScene(customerId: string): Promise<{ customerId: string; topologyId: string | null }> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/customers/${encodeURIComponent(customerId)}/default-scene`,
    );
    return parseDefaultScene(payload, customerId);
  }

  async putDefaultScene(customerId: string, topologyId: string): Promise<{ customerId: string; topologyId: string | null }> {
    const payload = await this.client.requestJson<unknown>(
      "PUT",
      `/api/energy/customers/${encodeURIComponent(customerId)}/default-scene`,
      { topologyId },
    );
    return parseDefaultScene(payload, customerId, topologyId);
  }

  async deleteDefaultScene(customerId: string): Promise<void> {
    await this.client.requestJson(
      "DELETE",
      `/api/energy/customers/${encodeURIComponent(customerId)}/default-scene`,
    );
  }

  async getBindings(topologyId: string): Promise<SceneBindingsDocument> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}/scene-bindings`,
    );
    return parseBindings(payload);
  }

  async putBindings(topologyId: string, document: SceneBindingsDocument): Promise<SceneBindingsDocument> {
    const payload = await this.client.requestJson<unknown>(
      "PUT",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}/scene-bindings`,
      document,
    );
    return payload ? parseBindings(payload) : document;
  }

  async getWidgets(topologyId: string): Promise<SceneWidgetsDocument> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}/scene-widgets`,
    );
    return parseWidgets(payload);
  }

  async putWidgets(topologyId: string, document: SceneWidgetsDocument): Promise<SceneWidgetsDocument> {
    const payload = await this.client.requestJson<unknown>(
      "PUT",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}/scene-widgets`,
      document,
    );
    return payload ? parseWidgets(payload) : document;
  }

  async getJumps(topologyId: string): Promise<SceneJumpLink[]> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}/scene-jumps`,
    );
    return objectLinksFromJumps(parseSceneJumpRows(payload));
  }

  async putJumps(topologyId: string, links: SceneJumpLink[]): Promise<SceneJumpLink[]> {
    const body = jumpsFromObjectLinks(links);
    const payload = await this.client.requestJson<unknown>(
      "PUT",
      `/api/energy/topologies/${encodeURIComponent(topologyId)}/scene-jumps`,
      body,
    );
    const rows = payload != null ? parseSceneJumpRows(payload) : body.jumps;
    return objectLinksFromJumps(rows);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

export function parseDefaultScene(
  payload: unknown,
  customerId: string,
  fallbackTopologyId?: string,
): { customerId: string; topologyId: string | null } {
  const row = asRecord(payload);
  const topologyId = text(row.topologyId) || fallbackTopologyId || "";
  return {
    customerId: text(row.customerId) || customerId,
    topologyId: topologyId || null,
  };
}

export function parseBindings(payload: unknown): SceneBindingsDocument {
  const row = asRecord(payload);
  const raw = Array.isArray(row.bindings) ? row.bindings : Array.isArray(payload) ? payload : [];
  const bindings = raw
    .map((item) => bindingOf(item))
    .filter((item): item is DeviceBinding => Boolean(item));
  return { schemaVersion: "1.0.0", bindings };
}

/**
 * 归一化一条绑定。实现已抽到 binding-normalize.ts（v1/v2 共用一套规则）。
 *
 * 为什么必须走它、不能在本文件里各写一份：
 * v2 的资产绑定条目**不带** deviceId。老实现 `deviceId = text(row.deviceId)`
 * 会把它写成空字符串再 PUT 回后端 —— 而后端 `parseUuid("")` 直接抛
 * 「deviceId 不是合法 UUID」，整份绑定写不进去。资产条目必须是没有该字段。
 */
function bindingOf(raw: unknown): DeviceBinding | null {
  return normalizeBinding(raw);
}

export function parseWidgets(payload: unknown): SceneWidgetsDocument {
  return parseSceneWidgetLayout(payload);
}

export async function resolveDefaultScene(
  client: GuardClient | null,
  customerId: string,
  resolveLegacy?: ResolveLegacySceneId,
  storage?: Storage | null,
): Promise<DefaultScenePointer> {
  if (client) {
    try {
      const remote = await new SceneStorageApi(client).getDefaultScene(customerId);
      cachedAvailability = { value: true, at: Date.now() };
      return { customerId, topologyId: remote.topologyId, source: "platform" };
    } catch (error) {
      if (isDefaultSceneEmptyPointer(error)) {
        cachedAvailability = { value: true, at: Date.now() };
        return { customerId, topologyId: null, source: "platform" };
      }
      if (!isSceneStorageUnavailable(error) && error instanceof GuardHttpError && !isSceneStorageUnmounted(error) && error.status < 500) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
    }
  }
  const draft = readDefaultSceneDraft(customerId, storage, resolveLegacy);
  return { customerId, topologyId: draft?.topologyId ?? null, source: "local-draft" };
}

export async function saveDefaultScene(
  client: GuardClient | null,
  customerId: string,
  topologyId: string,
  storage?: Storage | null,
): Promise<DefaultScenePointer> {
  if (client) {
    try {
      const remote = await new SceneStorageApi(client).putDefaultScene(customerId, topologyId);
      clearDefaultSceneDraft(customerId, storage);
      cachedAvailability = { value: true, at: Date.now() };
      return { customerId, topologyId: remote.topologyId ?? topologyId, source: "platform" };
    } catch (error) {
      if (!isSceneStorageUnavailable(error) && !isSceneStorageUnmounted(error) && error instanceof GuardHttpError && error.status < 500) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
    }
  }
  writeDefaultSceneDraft(customerId, topologyId, storage);
  return { customerId, topologyId, source: "local-draft" };
}

export async function removeDefaultScene(
  client: GuardClient | null,
  customerId: string,
  storage?: Storage | null,
): Promise<DefaultScenePointer> {
  if (client) {
    try {
      await new SceneStorageApi(client).deleteDefaultScene(customerId);
      clearDefaultSceneDraft(customerId, storage);
      cachedAvailability = { value: true, at: Date.now() };
      return { customerId, topologyId: null, source: "platform" };
    } catch (error) {
      if (!isSceneStorageUnavailable(error) && !isSceneStorageUnmounted(error) && error instanceof GuardHttpError && error.status < 500) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
    }
  }
  clearDefaultSceneDraft(customerId, storage);
  return { customerId, topologyId: null, source: "local-draft" };
}

export async function resolveSceneJumps(
  client: GuardClient | null,
  customerId: string,
  fromTopologyId: string,
  storage?: Storage | null,
): Promise<SceneJumpsResult> {
  if (client) {
    try {
      const links = await new SceneStorageApi(client).getJumps(fromTopologyId);
      cachedAvailability = { value: true, at: Date.now() };
      return { links, source: "platform" };
    } catch (error) {
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
      else if (error instanceof GuardHttpError && error.status < 500 && !isSceneStorageUnmounted(error)) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
    }
  }
  const draft = readSceneJumpDraft(customerId, fromTopologyId, storage);
  return { links: draft?.links ?? [], source: "local-draft" };
}

export async function saveSceneJumps(
  client: GuardClient | null,
  customerId: string,
  fromTopologyId: string,
  links: SceneJumpLink[],
  storage?: Storage | null,
): Promise<SceneJumpsResult> {
  if (client) {
    try {
      const saved = await new SceneStorageApi(client).putJumps(fromTopologyId, links);
      writeSceneJumpDraft({ customerId, fromTopologyId, links: saved }, storage);
      cachedAvailability = { value: true, at: Date.now() };
      return { links: saved, source: "platform" };
    } catch (error) {
      if (!isSceneStorageUnavailable(error) && !isSceneStorageUnmounted(error) && error instanceof GuardHttpError && error.status < 500) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
    }
  }
  writeSceneJumpDraft({ customerId, fromTopologyId, links }, storage);
  return { links, source: "local-draft" };
}

export async function resolveSceneBindings(
  client: GuardClient | null,
  topologyId: string,
  local: DeviceBinding[] | undefined,
): Promise<BindingsResult> {
  if (client) {
    try {
      const document = await new SceneStorageApi(client).getBindings(topologyId);
      cachedAvailability = { value: true, at: Date.now() };
      return { document, source: "platform" };
    } catch (error) {
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
      else if (error instanceof GuardHttpError && error.status < 500 && !isSceneStorageUnmounted(error)) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
    }
  }
  return { document: { schemaVersion: "1.0.0", bindings: local ?? [] }, source: "local-draft" };
}

export async function saveSceneBindings(
  client: GuardClient | null,
  topologyId: string,
  bindings: DeviceBinding[],
): Promise<BindingsResult> {
  const document: SceneBindingsDocument = { schemaVersion: "1.0.0", bindings };
  if (client) {
    try {
      const saved = await new SceneStorageApi(client).putBindings(topologyId, document);
      cachedAvailability = { value: true, at: Date.now() };
      return { document: saved, source: "platform" };
    } catch (error) {
      if (!isSceneStorageUnavailable(error) && !isSceneStorageUnmounted(error) && error instanceof GuardHttpError && error.status < 500) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
    }
  }
  return { document, source: "local-draft" };
}

export async function resolveSceneWidgets(
  client: GuardClient | null,
  topologyId?: string | null,
  local?: SceneWidgetsDocument | null,
  storage?: Storage | null,
  sceneId?: string | null,
): Promise<WidgetsResult> {
  const draft = readSceneWidgetDraft({ topologyId, sceneId }, storage);
  if (client && topologyId) {
    try {
      const document = await new SceneStorageApi(client).getWidgets(topologyId);
      cachedAvailability = { value: true, at: Date.now() };
      if (draft) return { document: draft.document, source: "local-draft" };
      return { document, source: "platform" };
    } catch (error) {
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
      else if (error instanceof GuardHttpError && error.status < 500 && !isSceneStorageUnmounted(error)) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
    }
  }
  if (draft) return { document: draft.document, source: "local-draft" };
  if (local && (local.widgets.length || local.glassOpacity != null)) return { document: local, source: "local-draft" };
  return { document: { ...SCENE_WIDGETS_EMPTY }, source: local ? "local-draft" : "empty" };
}

export async function saveSceneWidgets(
  client: GuardClient | null,
  topologyId?: string | null,
  document?: SceneWidgetsDocument | null,
  storage?: Storage | null,
  sceneId?: string | null,
): Promise<WidgetsResult> {
  const next = document ?? { ...SCENE_WIDGETS_EMPTY };
  if (client && topologyId) {
    try {
      const saved = await new SceneStorageApi(client).putWidgets(topologyId, next);
      clearSceneWidgetDraft({ topologyId, sceneId }, storage);
      cachedAvailability = { value: true, at: Date.now() };
      return { document: saved, source: "platform" };
    } catch (error) {
      if (!isSceneStorageUnavailable(error) && !isSceneStorageUnmounted(error) && error instanceof GuardHttpError && error.status < 500) {
        cachedAvailability = { value: true, at: Date.now() };
        throw error;
      }
      if (isSceneStorageUnmounted(error)) cachedAvailability = { value: false, at: Date.now() };
    }
  }
  writeSceneWidgetDraft({
    ...(topologyId ? { topologyId } : {}),
    ...(sceneId ? { sceneId } : {}),
    document: next,
  }, storage);
  return { document: next, source: "local-draft" };
}

export async function probeSceneStorage(client: GuardClient | null, customerId?: string): Promise<boolean> {
  if (!client) return false;
  return new SceneStorageApi(client).probe(customerId);
}
