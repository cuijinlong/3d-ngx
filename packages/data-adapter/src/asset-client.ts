/**
 * 资产（ASSET）读取适配器。
 *
 * 用途：数字孪生的「场景对象 → 资产属性」这条绑定路径（docs/twin-binding-contract.md §4）。
 *
 * 三条边界，写在这里是为了以后不被悄悄改掉：
 *
 * 1. **只读属性，不读资产遥测。** TB 没有「资产级聚合遥测」接口，能读到的是该资产
 *    自己的属性（SERVER_SCOPE / SHARED_SCOPE）。要做子树设备聚合是另一件事，
 *    必须显式设计口径，不能在这里顺手拼一个「平均值」冒充资产级数据。
 * 2. **不静默截断。** 分页触到上限时返回 `truncated` 并 warn —— 与 listSiteDeviceIds 同口径。
 *    少了一半资产却当成全量，后果是场景里「资产对不上」但没人知道原因。
 * 3. **失败要可区分。** 403 / 404 / 网络不可用不能都变成「空数组」：
 *    界面上「无权限」「没有这个资产」「暂时读不到」是三种完全不同的处置。
 */
import { GuardHttpError, type GuardClient } from "./guard-client";

export type AssetAttributeScope = "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";

export interface PlatformAsset {
  id: string;
  /** 技术名（TB Asset.name），全局唯一 */
  name: string;
  /** 显示名（TB Asset.label），给用户看的 */
  label?: string;
  type: string;
  customerId?: string;
}

export interface AssetAttribute {
  key: string;
  value: number | string | boolean;
  /** 属性最后更新时间。注意：属性没有「实时」概念，只有「上次写入」 */
  lastUpdatedTs: number;
}

export interface AssetListResult {
  items: PlatformAsset[];
  total: number;
  /** true = 触到分页上限，结果可能不全 */
  truncated: boolean;
}

export type AssetAccessErrorKind = "forbidden" | "not-found" | "unreachable";

/**
 * 读取失败时的可区分错误。
 *
 * 不用裸 GuardHttpError 是因为调用方通常只关心「该显示哪句话」，
 * 而 status 到文案的映射散在各处容易漂。这里一次性定好。
 */
export class AssetAccessError extends Error {
  constructor(
    readonly kind: AssetAccessErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AssetAccessError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return String(value).trim();
}

function idOf(raw: unknown): string {
  if (typeof raw === "string" || typeof raw === "number") return text(raw);
  return text(asRecord(raw).id);
}

function toAccessError(error: unknown, what: string): AssetAccessError {
  if (error instanceof AssetAccessError) return error;
  const status = error instanceof GuardHttpError ? error.status : undefined;
  if (status === 401 || status === 403) {
    return new AssetAccessError("forbidden", `没有读取${what}的权限`, status);
  }
  if (status === 404) {
    return new AssetAccessError("not-found", `${what}不存在`, status);
  }
  return new AssetAccessError("unreachable", `暂时读不到${what}`, status);
}

export function parsePlatformAsset(raw: unknown): PlatformAsset | null {
  const row = asRecord(raw);
  const id = idOf(row.id);
  if (!id) return null;
  const asset: PlatformAsset = {
    id,
    name: text(row.name) || id,
    type: text(row.type),
  };
  const label = text(row.label);
  if (label) asset.label = label;
  const customerId = idOf(row.customerId);
  if (customerId) asset.customerId = customerId;
  return asset;
}

/**
 * 解析属性接口的返回。
 *
 * TB 的 `/values/attributes` 返回是数组，元素形如 `{key, value, lastUpdatedTs}`。
 * `value` 有时被包成 `{value, ts}`（取决于版本与序列化路径），两种都要认
 * —— 只看一种的话，另一条链路上的资产属性会全部变成「未上报」，而且不报错。
 */
export function parseAssetAttributes(payload: unknown): AssetAttribute[] {
  const rows = Array.isArray(payload) ? payload : asArray(asRecord(payload).data);
  const out: AssetAttribute[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = asRecord(raw);
    const key = text(row.key);
    if (!key || seen.has(key)) continue;
    const inner = asRecord(row.value);
    const rawValue = "value" in inner ? inner.value : row.value;
    if (typeof rawValue !== "number" && typeof rawValue !== "string" && typeof rawValue !== "boolean") continue;
    /*
     * 时间戳字段名有三种，实测都出现过：
     *   · lastUpdateTs  —— 平台当前实际返回的（2026-11-23 实测确认，
     *                      写成 lastUpdatedTs 会永远解析成 0，过期判断全失效）
     *   · lastUpdatedTs —— 早期文档/部分版本
     *   · ts / value.ts —— 属性值被包成 {value, ts} 时的内层
     */
    const ts = Number(
      typeof inner.ts === "number"
        ? inner.ts
        : typeof row.lastUpdateTs === "number"
          ? row.lastUpdateTs
          : typeof row.lastUpdatedTs === "number"
            ? row.lastUpdatedTs
            : row.ts,
    );
    seen.add(key);
    out.push({
      key,
      value: rawValue,
      lastUpdatedTs: Number.isFinite(ts) && ts > 0 ? ts : 0,
    });
  }
  return out;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

export class AssetApi {
  constructor(private readonly client: GuardClient) {}

  /**
   * 某客户名下的资产。
   *
   * 走 `GET /api/customer/{customerId}/assets`（客户只能读自己的）。
   * 不要用 `/api/tenant/assets`：那会把所有客户的资产混在一起，
   * 且 SYS_ADMIN 调它反而 403（见铁律 A2k）。
   */
  async listCustomerAssets(customerId: string, type?: string): Promise<AssetListResult> {
    if (!customerId) return { items: [], total: 0, truncated: false };
    const items: PlatformAsset[] = [];
    let total = 0;
    let truncated = false;
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page) });
        if (type) query.set("type", type);
        const payload = await this.client.requestJson<unknown>(
          "GET",
          `/api/customer/${encodeURIComponent(customerId)}/assets?${query.toString()}`,
        );
        const row = asRecord(payload);
        const chunk = asArray(row.data);
        for (const raw of chunk) {
          const asset = parsePlatformAsset(raw);
          if (asset && !items.some((existing) => existing.id === asset.id)) items.push(asset);
        }
        const totalElements = Number(row.totalElements);
        if (Number.isFinite(totalElements)) total = totalElements;
        const hasNext = row.hasNext === true || (Number.isFinite(totalElements) && items.length < totalElements);
        if (!hasNext || chunk.length === 0) break;
        if (page === MAX_PAGES - 1) {
          truncated = true;
          console.warn("[asset-client] 客户资产分页触到上限，结果可能不全", customerId);
        }
      }
    } catch (error) {
      throw toAccessError(error, "资产列表");
    }
    return { items, total: total || items.length, truncated };
  }

  async getAsset(assetId: string): Promise<PlatformAsset | null> {
    if (!assetId) return null;
    try {
      const payload = await this.client.requestJson<unknown>(
        "GET",
        `/api/asset/${encodeURIComponent(assetId)}`,
      );
      return parsePlatformAsset(payload);
    } catch (error) {
      const mapped = toAccessError(error, "资产");
      /* 404 是「这个资产没了」，是正常结果，交给调用方标失效，不当异常抛。 */
      if (mapped.kind === "not-found") return null;
      throw mapped;
    }
  }

  /**
   * 列出某资产的全部属性（用于「配绑定时」的下拉候选）。
   *
   * <p>与 {@link getAttributes} 的区别：那个是「已知键名去取值」，
   * 这个是「不知道有哪些键，先列出来」。两者都走同一个平台接口，
   * 只是带不带 `key` 查询参数。
   *
   * <p>不带 keys 时接口返回所有 scope 的合并结果；调用方若指定 scope
   * 就只读那一个。默认仍按 SERVER → SHARED 合并、CLIENT 不读 ——
   * 与 getAttributes 保持同一口径，避免「这里能选到但取不到值」。
   */
  async listAttributes(
    assetId: string,
    scope?: AssetAttributeScope,
  ): Promise<AssetAttribute[]> {
    if (!assetId) return [];
    const fetchScope = async (target?: AssetAttributeScope): Promise<AssetAttribute[]> => {
      const path = target
        ? `/api/plugins/telemetry/ASSET/${encodeURIComponent(assetId)}/values/attributes/${target}`
        : `/api/plugins/telemetry/ASSET/${encodeURIComponent(assetId)}/values/attributes`;
      return parseAssetAttributes(await this.client.requestJson<unknown>("GET", path));
    };
    try {
      if (scope) return await fetchScope(scope);
      const merged = new Map<string, AssetAttribute>();
      for (const target of ["SERVER_SCOPE", "SHARED_SCOPE"] as const) {
        for (const row of await fetchScope(target)) {
          if (!merged.has(row.key)) merged.set(row.key, row);
        }
      }
      /* 两个 scope 都空时再兜一次全量，兼容 ONLY_* 之类非标准 scope。 */
      if (merged.size === 0) {
        for (const row of await fetchScope(undefined)) {
          if (!merged.has(row.key)) merged.set(row.key, row);
        }
      }
      return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
    } catch (error) {
      throw toAccessError(error, "资产属性");
    }
  }

  /**
   * 读资产属性。
   *
   * 默认只读 SERVER_SCOPE + SHARED_SCOPE（配置类属性）。
   * CLIENT_SCOPE 是设备侧上报的状态，语义更接近遥测，默认不读 ——
   * 混进来会让人把「设备上报的状态」误当成「资产自身配置」。
   */
  async getAttributes(
    assetId: string,
    keys: string[],
    scope?: AssetAttributeScope,
  ): Promise<AssetAttribute[]> {
    if (!assetId) return [];
    const wanted = keys.map((key) => key.trim()).filter(Boolean);
    if (wanted.length === 0) return [];
    const query = wanted.map((key) => `key=${encodeURIComponent(key)}`).join("&");

    const fetchScope = async (target?: AssetAttributeScope): Promise<AssetAttribute[]> => {
      const path = target
        ? `/api/plugins/telemetry/ASSET/${encodeURIComponent(assetId)}/values/attributes/${target}?${query}`
        : `/api/plugins/telemetry/ASSET/${encodeURIComponent(assetId)}/values/attributes?${query}`;
      const payload = await this.client.requestJson<unknown>("GET", path);
      return parseAssetAttributes(payload);
    };

    /*
     * 无论走哪条分支，最终都按调用方请求的 keys 顺序返回。
     * 不排的话，界面列顺序会随接口返回顺序漂 —— 同一个看板两次刷新列位置不一样。
     */
    const order = (rows: AssetAttribute[]): AssetAttribute[] => {
      const byKey = new Map(rows.map((row) => [row.key, row]));
      return wanted.map((key) => byKey.get(key)).filter((row): row is AssetAttribute => Boolean(row));
    };

    try {
      if (scope) return order(await fetchScope(scope));
      /*
       * 不指定 scope 时接口返回全部 scope 的合并结果，同名 key 谁先谁后不确定。
       * 为了「同 key 只取一份且可预测」，按 SERVER → SHARED 顺序各读一次，
       * 先到先得。CLIENT_SCOPE 故意不读。
       */
      const merged = new Map<string, AssetAttribute>();
      for (const target of ["SERVER_SCOPE", "SHARED_SCOPE"] as const) {
        const rows = await fetchScope(target);
        for (const row of rows) {
          if (!merged.has(row.key)) merged.set(row.key, row);
        }
        if (wanted.every((key) => merged.has(key))) break;
      }
      /* 两个 scope 都读到了就不必再走合并接口；有缺则补一次全量，兜住 ONLY_* 之外的 scope。 */
      if (wanted.some((key) => !merged.has(key))) {
        for (const row of await fetchScope(undefined)) {
          if (!merged.has(row.key)) merged.set(row.key, row);
        }
      }
      return order([...merged.values()]);
    } catch (error) {
      throw toAccessError(error, "资产属性");
    }
  }
}
