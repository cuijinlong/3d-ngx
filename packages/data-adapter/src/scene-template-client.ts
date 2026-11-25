import type { GuardClient } from "./guard-client";

/** 模板库仅租户。路径按场景存储实装报告，不另造平台接口。 */
export interface SceneTemplateCard {
  id: string;
  name: string;
  description?: string;
  templateVersion?: string;
  glbObjectKey?: string;
  packObjectKey?: string;
  /** 风格套装，如 hvac-hud-v1@1.0.0。实例化时直接沿用到场景。 */
  stylePack?: string;
  packId?: string;
  packVersion?: string;
  /** 套装附加文件（zip/js/css），实例化时一并带过去 */
  styleFiles?: Array<{ objectKey: string; fileName?: string }>;
  /**
   * 档案里是否记录了模型（2026-11-23）。
   *
   * <h3>为什么需要独立字段</h3>
   *
   * <p>「有没有模型」原来靠 `glbObjectKey` 判断，但客户端的
   * `GET /scene-template-options` **故意不返回 objectKey** ——
   * 那是对象存储的内部布局。于是卡片的「含模型 / 仅布局」标签必须
   * 由后端直接给一个布尔值。
   *
   * <p>`undefined` = 接口没告诉（老接口 / 租户端 list）；
   * 此时调用方退回用 `glbObjectKey` 推断，不要当成 false。
   */
  hasModel?: boolean;
}

/**
 * 模板里的一个文件（文件资源管理器的一行）。
 *
 * <p>**没有 objectKey**：客户端一律按文件名读写，objectKey 由服务端
 * 从档案反查。这样即使前端被篡改，也构造不出「模板目录下的任意路径」。
 */
export interface SceneTemplateFile {
  name: string;
  /** glb | pack */
  kind: string;
  /** 小写扩展名，无点。如 css */
  ext: string;
  /**
   * 是否可在线编辑。
   *
   * <p>服务端按扩展名白名单判定（css/js/json/md/txt/html/svg/csv/map）。
   * glb 与 zip 一律 false —— 它们是二进制，读进编辑器只会得到乱码，
   * 存回去就毁了文件。
   */
  editable: boolean;
}

export interface SceneTemplateFileContent {
  name: string;
  ext: string;
  size: number;
  content: string;
}

export interface SceneTemplateWriteInput {
  name?: string;
  description?: string;
  templateVersion?: string;
  /** 风格套装，如 hvac-hud-v1@1.0.0（会拆成 packId/packVersion 落库） */
  stylePack?: string;
  packId?: string;
  packVersion?: string;
  glb?: { objectKey: string; fileName?: string };
  styleFiles?: Array<{ objectKey: string; fileName?: string }>;
}

function toWriteBody(input: SceneTemplateWriteInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.description !== undefined) body.description = input.description;
  if (input.templateVersion !== undefined) body.templateVersion = input.templateVersion;
  if (input.stylePack !== undefined) body.stylePack = input.stylePack;
  if (input.packId !== undefined) body.packId = input.packId;
  if (input.packVersion !== undefined) body.packVersion = input.packVersion;
  if (input.glb !== undefined) body.glb = input.glb;
  if (input.styleFiles !== undefined) body.styleFiles = input.styleFiles;
  return body;
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
  /*
   * glb 有两种形态：卡片回包是字符串 key，也可能是 {objectKey, fileName} 对象。
   * 只认字符串的话，对象形态会被解析成 undefined —— 表现为「模板有模型但显示没有」。
   */
  const glbRaw = first(src, ["glb"]);
  const glbObjectKey = typeof glbRaw === "string"
    ? text(glbRaw)
    : text(first(asRecord(glbRaw), ["objectKey", "key"]));
  return {
    id,
    /*
     * 优先 label / displayName，最后才退回 name。
     *
     * 后端把模板的技术名写成 `tpl-{显示名}`（唯一约束落在 name 上），
     * 而 label 才是用户起的名。按 [name, title, label] 顺序取的话，
     * 界面上会显示 `tpl-冷热站标准版` —— 实测回包确认过这个差异。
     */
    name: text(first(src, ["label", "displayName", "name", "title"]), id),
    description: text(first(src, ["description", "remark"])) || undefined,
    templateVersion: text(first(src, ["templateVersion", "version"])) || undefined,
    glbObjectKey: glbObjectKey || text(first(src, ["glbObjectKey", "modelObjectKey", "objectKey"])) || undefined,
    packObjectKey: text(first(src, ["packObjectKey"])) || undefined,
    stylePack: text(first(src, ["stylePack"])) || undefined,
    packId: text(first(src, ["packId"])) || undefined,
    packVersion: text(first(src, ["packVersion"])) || undefined,
    /*
     * `hasModel` 只有布尔才采信（2026-11-23）。
     *
     * <p>不同接口给的形态不一样：`scene-template-options` 直接给布尔，
     * 老接口没有这个字段。一律按布尔判定，字符串 "false" 会被当成 true
     * —— 那会让「仅布局」的模板显示成「含模型」，建完发现没模型。
     */
    hasModel:
      typeof first(src, ["hasModel"]) === "boolean"
        ? (first(src, ["hasModel"]) as boolean)
        : undefined,
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

  /**
   * 新建模板。
   *
   * ⚠ 上传资源与写档案是两步（后端约定，不是实现遗漏）：
   * `POST /scene-template-assets` 只把文件写进对象存储，**不写模板档案**；
   * 档案里的 glb 必须再通过 create/update 的 `glb` 字段提交，
   * 由 `applyTemplateMeta → bindTemplateKey` 校验并落库。
   * 所以「新建带模型的模板」正确顺序是：
   *   create(name) → uploadAsset(file, {templateId}) → update(id, {glb:{objectKey}})
   */
  async create(input: SceneTemplateWriteInput): Promise<SceneTemplateCard> {
    const payload = await this.client.requestJson<unknown>("POST", "/api/energy/scene-templates", toWriteBody(input));
    const card = parseSceneTemplate(payload) ?? parseSceneTemplate(asRecord(payload).data);
    if (!card) throw new Error("创建模板成功，但返回里没有模板 id");
    return card;
  }

  async update(templateId: string, input: SceneTemplateWriteInput): Promise<SceneTemplateCard> {
    /*
     * 只提交实际给出的字段。全量提交 null 会把已有值清掉 ——
     * 例如只想改名字却把 description 传成 undefined，后端若按「null 即清空」处理就会丢描述。
     */
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.description !== undefined) body.description = input.description;
    if (input.templateVersion !== undefined) body.templateVersion = input.templateVersion;
    if (input.stylePack !== undefined) body.stylePack = input.stylePack;
    if (input.packId !== undefined) body.packId = input.packId;
    if (input.packVersion !== undefined) body.packVersion = input.packVersion;
    if (input.glb !== undefined) body.glb = input.glb;
    if (input.styleFiles !== undefined) body.styleFiles = input.styleFiles;

    const payload = await this.client.requestJson<unknown>(
      "POST",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}`,
      body,
    );
    const card = parseSceneTemplate(payload) ?? parseSceneTemplate(asRecord(payload).data);
    if (!card) throw new Error("更新模板成功，但返回里没有模板 id");
    return card;
  }

  /**
   * 列出模板的文件（2026-11-24）。
   *
   * <p>服务端从档案的 `additionalInfo`（`glb` + `styleFiles`）汇总，
   * 不是列举对象存储目录 —— 档案记录的是「这个模板实际引用了什么」，
   * 比目录更准（目录里可能有上传失败的残留）。
   */
  async listFiles(templateId: string): Promise<SceneTemplateFile[]> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}/files`,
    );
    const row = asRecord(payload);
    return asArray(row.files).map((raw) => {
      const f = asRecord(raw);
      return {
        name: text(f.name),
        kind: text(f.kind, "pack"),
        ext: text(f.ext),
        editable: f.editable === true,
      };
    }).filter((f) => f.name);
  }

  /**
   * 读文件文本内容。
   *
   * <p>只对可编辑格式有效 —— 服务端对 glb/zip 直接 400，
   * 而不是返回一段 UTF-8 解码后的乱码（乱码会让人以为文件坏了）。
   */
  async readFile(templateId: string, name: string): Promise<SceneTemplateFileContent> {
    const payload = await this.client.requestJson<unknown>(
      "GET",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}/files/content?name=${encodeURIComponent(name)}`,
    );
    const row = asRecord(payload);
    return {
      name: text(row.name, name),
      ext: text(row.ext),
      size: typeof row.size === "number" ? row.size : 0,
      content: typeof row.content === "string" ? row.content : "",
    };
  }

  /**
   * 覆盖写文件内容。
   *
   * <h3>★ 覆盖不可撤销</h3>
   *
   * <p>S3 没有版本，写之前旧内容就没了。调用方必须在界面上说清这一点，
   * 并在有未保存改动时确认一次 —— 后端的职责只是「如实执行」。
   */
  async writeFile(templateId: string, name: string, content: string): Promise<{ ok: boolean; size: number }> {
    const payload = await this.client.requestJson<unknown>(
      "POST",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}/files/content`,
      { name, content },
    );
    const row = asRecord(payload);
    return { ok: row.ok === true, size: typeof row.size === "number" ? row.size : 0 };
  }

  /**
   * 新建一个模板文本文件（2026-11-24）。
   *
   * <p>与 {@link writeFile} 的区别：后者要求文件**已存在**（防拼错文件名
   * 顺手造出空文件），而模板常常只有一个只读的 `model.glb` ——
   * 不放开新建就没有任何东西可编辑。
   *
   * <p>重名会被后端拒绝（不静默覆盖），所以调用方要把错误原样展示出来。
   */
  async createFile(templateId: string, name: string, content: string): Promise<{ ok: boolean; size: number }> {
    const payload = await this.client.requestJson<unknown>(
      "POST",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}/files`,
      { name, content },
    );
    const row = asRecord(payload);
    return { ok: row.ok === true, size: typeof row.size === "number" ? row.size : 0 };
  }

  async delete(templateId: string): Promise<unknown> {
    return this.client.requestJson(
      "DELETE",
      `/api/energy/scene-templates/${encodeURIComponent(templateId)}`,
    );
  }

  /**
   * 可实例化模板清单（只读，**客户角色也能调**）。
   *
   * <h3>为什么不用 {@link #list}</h3>
   *
   * <p>`list` 走 `GET /scene-templates`，后端限 `SYS_ADMIN` / `TENANT_ADMIN` ——
   * 客户登录时 403。而建场景是客户的主路径，模板中心必须对客户可用。
   *
   * <p>返回字段也小一圈：没有 `glbObjectKey` / `packObjectKey` / `styleFiles`。
   * 那些是对象存储的内部布局，客户端不需要，也不该拿。
   *
   * <p>形状与 `SceneTemplateCard` 一致 —— 两个接口在界面上是同一种卡片，
   * 多造一个类型只会让渲染层写两套分支。
   */
  async options(): Promise<SceneTemplateCard[]> {
    const payload = await this.client.requestJson<unknown>("GET", "/api/energy/scene-template-options");
    return parseSceneTemplateList(payload);
  }

  /**
   * 按模板 id 下载模型（只读，**客户可用**）。
   *
   * <p>服务端自己拼 `scene-template/{tenant}/{templateId}/model.glb`，
   * 客户端不需要（也不应该）知道 objectKey。
   *
   * <p>模板没有模型时后端返回 404 —— 那**不是错误**：
   * 可以从模板建一个只有布局的场景，之后再导模型。调用方应按
   * `GuardHttpError.status === 404` 走降级提示，而不是弹「下载失败」。
   */
  async downloadModel(templateId: string): Promise<ArrayBuffer> {
    const asset = await this.client.requestBytes(
      `/api/energy/scene-template-options/${encodeURIComponent(templateId)}/model`,
    );
    return asset.blob.arrayBuffer();
  }

  async uploadAsset(file: File, input: { kind: "glb" | "pack"; templateId?: string }): Promise<SceneTemplateAssetRef> {
    const form = new FormData();
    form.append("file", file);
    // kind 只放查询参数。表单里再附一份时，接口会把两个值拼成 "glb,glb" 并返回 400。
    const query = new URLSearchParams();
    query.set("kind", input.kind);
    if (input.templateId) query.set("templateId", input.templateId);
    return this.client.requestForm<SceneTemplateAssetRef>(`/api/energy/scene-template-assets?${query.toString()}`, form);
  }

  /**
   * 下载模板模型。
   *
   * 实例化场景时必须先下载回来，再作为新场景的模型上传 —— 平台对对象的
   * key 前缀有约束（场景模型必须在 `topology/{tenant}/` 下，模板的在
   * `scene-template/{tenant}/` 下），不能直接把模板的 objectKey 挂到场景上。
   * 所以「从模板建场景」是下载 + 重新上传，不是引用同一个对象。
   */
  async downloadAsset(objectKey: string): Promise<ArrayBuffer> {
    const asset = await this.client.requestBytes(this.assetUrl(objectKey));
    return asset.blob.arrayBuffer();
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
