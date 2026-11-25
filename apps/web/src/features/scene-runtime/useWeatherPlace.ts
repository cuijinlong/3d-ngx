import { useEffect, useState } from "react";
import { getAssetApi, getConnectedGuardClient } from "@idt/data-adapter";
import { resolveWeatherPlace, type PlaceSource } from "./scene-place";

/**
 * 把「场站 / 组织 / 场景」里的行政区划解析成天气地点（2026-11-24）。
 *
 * <h2>为什么单独一个 hook</h2>
 *
 * 读地址要发两次网络请求（场站资产、客户属性），而顶栏是渲染最频繁的地方 ——
 * 直接写在 `RuntimeShell` 里会让每次遥测刷新都重算一遍地点。
 * 只有当 `siteId / customerId / scenePlace` 这三个输入本身变了才重查。
 *
 * <h2>失败不阻断</h2>
 *
 * 场站读不到就回落组织，组织读不到就回落场景字段，都没有就返回
 * `place = null`（顶栏不显示天气）。任何一级报错都不会让顶栏白屏。
 */
export interface ResolvedWeatherPlace {
  place: string | null;
  source: PlaceSource | null;
  /** 首次解析中；用于避免「还没查完就当没配置」 */
  loading: boolean;
}

/** 读实体属性里的 `address`。TB 的 `?key=` 无 scope 端点会返回调用方**有权读到**的 scope。 */
async function readAddress(kind: "asset" | "customer", entityId: string): Promise<string | null> {
  if (kind === "asset") {
    /*
     * 走 `AssetApi` 而不是手拼 URL：它内部已经实现了
     * SERVER_SCOPE → SHARED_SCOPE 的回退（客户角色读不到 SERVER 时会退一步），
     * 手写会漏掉这一层，表现是「租户账号能看天气、客户账号看不了」。
     */
    const api = getAssetApi();
    if (!api) return null;
    const rows = await api.getAttributes(entityId, ["address"]);
    const value = rows[0]?.value;
    return typeof value === "string" ? value : null;
  }

  const client = getConnectedGuardClient();
  if (!client) return null;
  const rows = await client.requestJson<Array<{ key?: string; value?: unknown }>>(
    "GET",
    `/api/plugins/telemetry/CUSTOMER/${encodeURIComponent(entityId)}/values/attributes?key=address`,
  );
  const row = Array.isArray(rows) ? rows.find((item) => item?.key === "address") : undefined;
  return typeof row?.value === "string" ? row.value : null;
}

export function useWeatherPlace(input: {
  siteId?: string | null;
  customerId?: string | null;
  scenePlace?: string | null;
}): ResolvedWeatherPlace {
  const { siteId, customerId, scenePlace } = input;
  const [state, setState] = useState<ResolvedWeatherPlace>({
    place: null,
    source: null,
    loading: Boolean(siteId || customerId || scenePlace),
  });

  useEffect(() => {
    /* 场景里直接填了地点时不查网络，省两次往返 */
    if (!siteId && !customerId) {
      setState({ place: scenePlace?.trim() || null, source: scenePlace?.trim() ? "scene" : null, loading: false });
      return;
    }

    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));
    void resolveWeatherPlace({ siteId, customerId, scenePlace }, readAddress)
      .then((resolved) => {
        if (!alive) return;
        setState({ ...resolved, loading: false });
      })
      .catch(() => {
        if (!alive) return;
        /* 理论上 resolveWeatherPlace 内部已捕获单级错误，这里兜底整链失败 */
        setState({ place: null, source: null, loading: false });
      });

    return () => {
      alive = false;
    };
  }, [siteId, customerId, scenePlace]);

  return state;
}
