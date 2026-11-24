import { useEffect, useMemo, useState } from "react";
import { listRealtimeDevices, widgetScopeKey } from "@idt/data-adapter";
import type { SceneDocument } from "@idt/shared-types";
import { displayNameOf } from "../utils/display-name";

/**
 * 解析**范围类**数据源的设备清单（2026-11-23）。
 *
 * <h2>解决什么</h2>
 *
 * <p>数据源里的 `kind: "scope"` 声明的是一段范围（场站 / 场景拓扑），
 * 它对应**一批**设备。不解析出来，面板只能显示「范围内 0 台」、
 * 脚本里 `ctx.keysOf("units")` 永远是空 —— 等于范围源不能用。
 *
 * <h2>为什么接受 `SceneDocument` 而不是解析后的源</h2>
 *
 * <p>解析后的源需要 `scopeDeviceIds` 才能算出 `entityIds`，
 * 而这个 hook 的产物**就是** `scopeDeviceIds` —— 接受解析结果会形成循环依赖。
 * 所以这里直接扫文档里的 `dataSources`，只挑 scope 类，不依赖解析产物。
 *
 * <h2>键必须与 WidgetOverlay 一致</h2>
 *
 * <p>用它算出的键交给 `resolveSceneDataSources(..., { scopeDeviceIds })`，
 * 而 `WidgetOverlay` 填的是 `topology:<id>` / `site:<id>`。
 * 两边都用 `widgetScopeKey` 生成，不自己拼字符串 ——
 * 拼错过一次：范围源静默返回空，面板说「范围内暂无设备」，
 * 人会去怀疑范围选错，而实际是键名不一致。
 */

export interface ScopeDeviceResolution {
  /** 范围 key（`topology:<id>` / `site:<id>`）→ 设备 id。 */
  scopeDeviceIds: Record<string, string[]>;
  /** 同样的 key → 设备显示名。面板要展示「是哪几台」，不能只有数量。 */
  names: Record<string, string[]>;
  loading: boolean;
}

export function useSceneDataSourceScopeDevices(document: SceneDocument | null | undefined): ScopeDeviceResolution {
  const [scopeDeviceIds, setScopeDeviceIds] = useState<Record<string, string[]>>({});
  const [names, setNames] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  /**
   * 需要解析的范围：只取 scope 类源，按 key 去重。
   * 同一范围在多个源里出现只拉一次。
   */
  const requested = useMemo(() => {
    const map = new Map<string, { siteId?: string; topologyId?: string }>();
    for (const source of document?.dataSources ?? []) {
      if (source.kind !== "scope" || !source.scope) continue;
      const key = widgetScopeKey(source.scope);
      if (!key) continue;
      map.set(key, {
        ...(source.scope.siteId ? { siteId: source.scope.siteId } : {}),
        ...(source.scope.topologyId ? { topologyId: source.scope.topologyId } : {}),
      });
    }
    return map;
  }, [document?.dataSources]);

  /* 依赖用内容签名；requested 是每次渲染新建的 Map。 */
  const signature = useMemo(
    () => [...requested.entries()].map(([key, query]) => `${key}|${query.siteId ?? ""}|${query.topologyId ?? ""}`).join(";"),
    [requested],
  );

  useEffect(() => {
    if (!requested.size) {
      setScopeDeviceIds({});
      setNames({});
      return;
    }
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const ids: Record<string, string[]> = {};
      const display: Record<string, string[]> = {};

      for (const [key, query] of requested) {
        try {
          /* 与 `WidgetOverlay` 完全相同的查询 —— 同一范围必须解析出同一批设备。 */
          const list = await listRealtimeDevices({
            ...(query.siteId ? { siteId: query.siteId } : {}),
            ...(query.topologyId ? { topologyId: query.topologyId } : {}),
          });
          ids[key] = list.map((item) => item.id);
          display[key] = list.map((item) => displayNameOf(item));
        } catch {
          /*
           * 单范围失败不拖垮其他范围。
           *
           * <p>注意：这里落成空数组会让面板显示「范围内暂无设备」——
           * 分辨不出「查询失败」。所以**不缓存失败结果**（不进 state 之外的任何缓存），
           * 下次签名变化会重试。
           */
          ids[key] = [];
          display[key] = [];
        }
      }

      if (!cancelled) {
        setScopeDeviceIds((prev) => ({ ...prev, ...ids }));
        setNames((prev) => ({ ...prev, ...display }));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  return { scopeDeviceIds, names, loading };
}
