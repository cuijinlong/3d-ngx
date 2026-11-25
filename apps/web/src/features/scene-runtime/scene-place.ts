/**
 * 天气地点的**行政区划**从哪来（2026-11-24 客户定案）。
 *
 * <h2>优先级（客户原话「场站或组织」）</h2>
 *
 * ```
 * 1. 场站资产  address   ← 客户选「场站优先」
 * 2. 组织(客户) address   ← 缺了回落组织
 * 3. 场景 weatherSite     ← 老字段，向导里填过就还能用
 * 4. 都没有 → null（界面显示「未配置天气地点」，不猜城市）
 * ```
 *
 * <h2>为什么不能拿名字凑</h2>
 *
 * 场站名叫「生产园区」「办公园区」，组织叫「平台演示中心」——
 * 这些**都不是行政区划**，扔进地理编码只会查到同名的地方或者查不到。
 * 曾经想过「用场站名前两个字试一下」，那是猜：猜对了没人知道是猜的，
 * 猜错了大屏上就挂着一个别的城市的天气。所以只认显式填的 `address`。
 *
 * <h2>为什么地址读 SERVER_SCOPE 就行</h2>
 *
 * 2026-11-24 实测：客户角色（CUSTOMER_USER）读场站
 * `values/attributes?key=…` 能拿到 SERVER_SCOPE 的属性（`energyType` 正常返回）。
 * `AssetApi.getAttributes` 不传 scope 时会先试 SERVER 再退 SHARED，
 * 两种角色都适配，调用方不用判断权限。
 */

/** 读某个实体的 `address` 属性；没有/读不到返回 null。注入以便单测。 */
export interface AddressReader {
  (kind: "asset" | "customer", entityId: string): Promise<string | null>;
}

export type PlaceSource = "site" | "organization" | "scene";

export interface ResolvedPlace {
  /** 最终用于查天气的行政区划文本；null 表示三级都没有 */
  place: string | null;
  /** 这个地点是从哪一级拿到的，用于顶栏 title 提示「来源：场站」 */
  source: PlaceSource | null;
}

/** 地址空白（含全空格、`""`）一律视为没填。 */
function clean(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

/**
 * 按 场站 → 组织 → 场景 的顺序找第一个非空行政区划。
 *
 * <p>**读失败不阻断下一级**：某个实体没有权限或网络抖动时，
 * 不应该连组织级的地址也一起丢掉 —— 每一级单独 try。
 */
export async function resolveWeatherPlace(
  input: { siteId?: string | null; customerId?: string | null; scenePlace?: string | null },
  read: AddressReader,
): Promise<ResolvedPlace> {
  const attempts: Array<{ source: PlaceSource; run: () => Promise<string | null> }> = [];

  if (input.siteId) {
    const siteId = input.siteId;
    attempts.push({ source: "site", run: () => read("asset", siteId) });
  }
  if (input.customerId) {
    const customerId = input.customerId;
    attempts.push({ source: "organization", run: () => read("customer", customerId) });
  }

  for (const attempt of attempts) {
    try {
      const value = clean(await attempt.run());
      if (value) return { place: value, source: attempt.source };
    } catch {
      /* 单级失败继续下一级 —— 静默降级，最终由「未配置」兜底 */
    }
  }

  const fromScene = clean(input.scenePlace);
  if (fromScene) return { place: fromScene, source: "scene" };

  return { place: null, source: null };
}

/** 顶栏 `title` 里的来源说明。 */
export function placeSourceLabel(source: PlaceSource | null): string {
  switch (source) {
    case "site":
      return "来源：场站行政区划";
    case "organization":
      return "来源：组织行政区划";
    case "scene":
      return "来源：场景天气地点";
    default:
      return "未配置天气地点";
  }
}
