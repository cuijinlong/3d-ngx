import type { GuardClient } from "./guard-client";

/** 模板库仅租户。路径按场景存储实装报告，不另造平台接口。 */
export interface SceneTemplateCard {
  id: string;
  name: string;
  description?: string;
  templateVersion?: string;
  glbObjectKey?: string;
  packObjectKey?: string;
}

export interface SceneTemplateAssetRef {
  objectKey: string;
  fileName?: string;
  kind?: "glb" | "pack";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function first(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] != null && row[key] !== "") return row[key];
  }
  return undefined;
}

export function parseSceneTemplate(raw: unknown): SceneTemplateCard | null {
  const row = asRecord(raw);
  const nested = asRecord(first(row, ["data", "item", "template"]) ?? {});
  const src = text(first(row, ["id", "templateId"])) ? row : nested;
  const id = text(first(src, ["id", "templateId"]));
  if (!id) return null;
  return {
    id,
    name: text(first(src, ["name", "title", "label"]), id),
    description: text(first(src, ["description", "remark"])) || undefined,
    templateVersion: text(first(src, ["templateVersion", "version"])) || undefined,
    glbObjectKey: text(first(src, ["glbObjectKey", "modelObjectKey", "objectKey"])) || undefined,
    packObjectKey: text(first(src, ["packObjectKey"])) || undefined,
  };
}

export function parseSceneTemplateList(payload: unknown): SceneTemplateCard[] {
  const row = asRecord(payload);
  const raw = Array.isArray(payload) ? payload : asArray(first(row, ["items", "data", "content", "templates", "rows"]));
  return raw.map(parseSceneTemplate).filter((item): item is SceneTemplateCard => Boolean(item));
}

export class SceneTemplateApi {
  constructor(private readonly client: GuardClient) {}

  async list(): Promise<SceneTemplateCard[]> {
    const payload = await this.client.requestJson<unknown>("GET", "/api/energy/scene-templates");
    return parseSceneTemplateList(payload);
  }

  async get(templateId: string): Promise<SceneTemplateCard> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}`,
    );
    const card = parseSceneTemplate(payload) ?? parseSceneTemplate(asRecord(payload).data);
    if (!card) throw new Error("读取模板成功，但返回里没有模板 id");
    return card;
  }

  async create(input: { name: string; description?: string; templateVersion?: string }): Promise<SceneTemplateCard> {
    const payload = await this.client.requestJson<unknown>("POST", "/api/energy/scene-templates", {
      name: input.name,
      description: input.description || undefined,
      templateVersion: input.templateVersion || undefined,
    });
    const card = parseSceneTemplate(payload) ?? parseSceneTemplate(asRecord(payload).data);
    if (!card) throw new Error("创建模板成功，但返回里没有模板 id");
    return card;
  }

  async update(templateId: string, input: { name?: string; description?: string; templateVersion?: string }): Promise<SceneTemplateCard> {
    const payload = await this.client.requestJson<unknown>(
      "POST",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}`,
      {
        name: input.name,
        description: input.description,
        templateVersion: input.templateVersion,
      },
    );
    const card = parseSceneTemplate(payload) ?? parseSceneTemplate(asRecord(payload).data);
    if (!card) throw new Error("更新模板成功，但返回里没有模板 id");
    return card;
  }

  async delete(templateId: string): Promise<unknown> {
    return this.client.requestJson(
      "DELETE",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}`,
    );
  }

  async uploadAsset(file: File, input: { kind: "glb" | "pack"; templateId?: string }): Promise<SceneTemplateAssetRef> {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", input.kind);
    const query = new URLSearchParams();
    query.set("kind", input.kind);
    if (input.templateId) query.set("templateId", input.templateId);
    return this.client.requestForm<SceneTemplateAssetRef>(`/api/energy/scene-template-assets?${query.toString()}`, form);
  }

  assetUrl(objectKey: string): string {
    return `/api/energy/scene-template-assets?objectKey=${encodeURIComponent(objectKey)}`;
  }

  async deleteAsset(objectKey: string): Promise<unknown> {
    return this.client.requestJson(
      "DELETE",
      `/api/energy/scene-template-assets?objectKey=${encodeURIComponent(objectKey)}`,
    );
  }
}
