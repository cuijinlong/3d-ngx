import { useEffect, useMemo, useRef, useState } from "react";
import type { SceneWidgetLayout } from "@idt/data-adapter";
import { AssetAccessError, getAssetApi } from "@idt/data-adapter";
import { assetAttrKey, type AssetAttributeLookup } from "../features/scene-widgets/widget-values";

/**
 * 运行态资产属性读取（2026-11-23）。
 *
 * <h2>为什么需要它</h2>
 *
 * `readSlotValue` 从 P0 起就支持「资产属性」分支，但**没有任何调用方传
 * `assetAttrs`** —— 配了资产槽卡片，运行态只会落到「暂时读不到」。
 * 这条 hook 补的就是这个断链：把布局里所有资产槽需要属性批量读回来，
 * 交给 `readSlotValue`。
 *
 * <h2>为什么按 assetId 分组</h2>
 *
 * 一个资产上可能挂多个槽（在线率、装机容量、投运日期）。
 * 按 key 逐个请求就是 N 次往返；分组后每资产一次请求，
 * 与 `AssetApi.getAttributes(assetId, keys[])` 的签名正好对上。
 *
 * <h2>为什么不做成实时轮询</h2>
 *
 * 资产属性是**配置类数据**（装机容量、投运日期），不是遥测。
 * 高频轮询既没必要也会压平台。这里按 `staleAfterSec` 里最小的那个
 * 作为刷新间隔（下限 30 秒），让「更新于 X 前」不至于永远不刷新。
 * 真实遥测仍走遥测订阅，两条链路不混。
 */

/** 需求：某资产要读哪些键。 */
interface AssetDemand {
  assetId: string;
  keys: string[];
  scope?: "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";
}

/**
 * 从布局里收集资产槽需求。
 *
 * <p>同一 assetId 的 key 合并；scope 取第一个非空的 ——
 * 同一资产上挂两个不同 scope 的槽属于配置错误，这里不报错也不猜，
 * 沿用先出现的那个（`AssetApi` 内部仍会按 SERVER→SHARED 兜底）。
 */
export function collectAssetDemands(layout: SceneWidgetLayout | null): AssetDemand[] {
  const byAsset = new Map<string, AssetDemand>();
  for (const widget of layout?.widgets ?? []) {
    for (const slot of widget.slots ?? []) {
      const assetId = slot.assetId?.trim();
      const attributeKey = slot.attributeKey?.trim();
      if (!assetId || !attributeKey) continue;
      const cur = byAsset.get(assetId);
      if (cur) {
        if (!cur.keys.includes(attributeKey)) cur.keys.push(attributeKey);
        continue;
      }
      byAsset.set(assetId, {
        assetId,
        keys: [attributeKey],
        ...(slot.attributeScope ? { scope: slot.attributeScope } : {}),
      });
    }
  }
  return [...byAsset.values()];
}

/** 刷新间隔：取所有槽里最小的 staleAfterSec，夹在 30s ~ 10min 之间。 */
function refreshIntervalMs(layout: SceneWidgetLayout | null): number {
  const values: number[] = [];
  for (const widget of layout?.widgets ?? []) {
    for (const slot of widget.slots ?? []) {
      if (slot.assetId && slot.attributeKey && slot.staleAfterSec) values.push(slot.staleAfterSec);
    }
  }
  if (!values.length) return 60_000;
  const min = Math.min(...values);
  return Math.min(600_000, Math.max(30_000, min * 1000));
}

export interface AssetAttributesState {
  /** 传给 readSlotValue 的查找表。null = 还没读到（或没有资产槽） */
  lookup: AssetAttributeLookup | null;
  /** 读失败时的原因，直接传给 readSlotValue 让界面分开说 */
  error?: "forbidden" | "unreachable";
  loading: boolean;
  /** 有几个资产槽在等数据，供调试与「未上报」提示用 */
  demandCount: number;
}

export function useAssetAttributes(layout: SceneWidgetLayout | null): AssetAttributesState {
  const demands = useMemo(() => collectAssetDemands(layout), [layout]);
  const intervalMs = useMemo(() => refreshIntervalMs(layout), [layout]);
  const [lookup, setLookup] = useState<AssetAttributeLookup | null>(null);
  const [error, setError] = useState<"forbidden" | "unreachable" | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const cancelled = useRef(false);

  /*
   * 需求签名：demands 每次渲染都是新数组（useMemo 依赖 layout 对象），
   * 直接放依赖里会导致每次 layout 引用变化都重读。用字符串签名去重，
   * 内容没变就不重新请求。
   */
  const signature = useMemo(
    () => demands.map((d) => `${d.assetId}:${d.scope ?? ""}:${d.keys.join(",")}`).join("|"),
    [demands],
  );

  useEffect(() => {
    cancelled.current = false;
    if (!signature) {
      setLookup(null);
      setError(undefined);
      return;
    }
    const api = getAssetApi();
    if (!api) {
      /*
       * 未连接平台：不是「属性不存在」，而是压根读不到。
       * 交给 error=unreachable，界面会说「暂时读不到」而不是「未上报」。
       */
      setLookup(null);
      setError("unreachable");
      return;
    }

    const load = async () => {
      setLoading(true);
      const next: AssetAttributeLookup = new Map();
      let nextError: "forbidden" | "unreachable" | undefined;
      for (const demand of demands) {
        try {
          const rows = await api.getAttributes(demand.assetId, demand.keys, demand.scope);
          for (const row of rows) {
            next.set(assetAttrKey(demand.assetId, row.key), {
              value: row.value,
              lastUpdatedTs: row.lastUpdatedTs,
            });
          }
        } catch (err) {
          /*
           * 一个资产失败不影响其他资产：部分成功也比整块空白好。
           * 但错误要记住，界面按「有值 / 无权限 / 读不到」分别展示。
           */
          if (err instanceof AssetAccessError) {
            nextError = err.kind === "forbidden" ? "forbidden" : "unreachable";
          } else {
            nextError = "unreachable";
          }
        }
      }
      if (cancelled.current) return;
      setLookup(next);
      setError(nextError);
      setLoading(false);
    };

    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => {
      cancelled.current = true;
      window.clearInterval(timer);
    };
  }, [signature, intervalMs, demands]);

  return { lookup, error, loading, demandCount: demands.length };
}
