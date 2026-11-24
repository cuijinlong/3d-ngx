import { useEffect, useMemo, useRef, useState } from "react";
import { AssetAccessError, getAssetApi, type AssetAttribute, type PlatformAsset } from "@idt/data-adapter";

/**
 * 资产选择器的数据源（2026-11-23）。
 *
 * <h2>为什么单独一个文件</h2>
 *
 * 配绑定时要做两件事：列客户资产、列某资产的属性键。
 * 两者都是「一次性拉取 + 局部缓存」，跟运行态的 `useAssetAttributes`
 * （按槽位批量轮询取值）用途不同，别混在一起 ——
 * 混了就会出现「配绑定的时候也在后台轮询」这种无谓请求。
 *
 * <h2>错误要能区分</h2>
 *
 * 403 和网络失败在界面上是两句话：前者要找管理员开权限，后者等一会重试。
 * 都变成空列表的话，用户只会以为「这个客户没有资产」。
 */

export interface AssetPickerState {
  assets: PlatformAsset[];
  loading: boolean;
  error?: "forbidden" | "unreachable";
}

export function useCustomerAssets(customerId: string | undefined, enabled: boolean): AssetPickerState {
  const [state, setState] = useState<AssetPickerState>({ assets: [], loading: false });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!enabled || !customerId) {
      setState({ assets: [], loading: false });
      return;
    }
    const api = getAssetApi();
    if (!api) {
      setState({ assets: [], loading: false, error: "unreachable" });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    void api
      .listCustomerAssets(customerId)
      .then((result) => {
        if (cancelled.current) return;
        setState({ assets: result.items, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled.current) return;
        const error = err instanceof AssetAccessError && err.kind === "forbidden" ? "forbidden" : "unreachable";
        setState({ assets: [], loading: false, error });
      });
    return () => {
      cancelled.current = true;
    };
  }, [customerId, enabled]);

  return state;
}

export interface AssetAttributeKeysState {
  attributes: AssetAttribute[];
  loading: boolean;
  error?: "forbidden" | "unreachable";
}

export function useAssetAttributeKeys(assetId: string | undefined, enabled: boolean): AssetAttributeKeysState {
  const [state, setState] = useState<AssetAttributeKeysState>({ attributes: [], loading: false });
  const cancelled = useRef(false);
  const key = useMemo(() => assetId?.trim() || "", [assetId]);

  useEffect(() => {
    cancelled.current = false;
    if (!enabled || !key) {
      setState({ attributes: [], loading: false });
      return;
    }
    const api = getAssetApi();
    if (!api) {
      setState({ attributes: [], loading: false, error: "unreachable" });
      return;
    }
    setState((prev) => ({ ...prev, loading: true }));
    void api
      .listAttributes(key)
      .then((rows) => {
        if (cancelled.current) return;
        setState({ attributes: rows, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled.current) return;
        const error = err instanceof AssetAccessError && err.kind === "forbidden" ? "forbidden" : "unreachable";
        setState({ attributes: [], loading: false, error });
      });
    return () => {
      cancelled.current = true;
    };
  }, [key, enabled]);

  return state;
}

/** 错误文案。空列表与「没权限」必须分开说。 */
export function assetPickerErrorText(error?: "forbidden" | "unreachable"): string {
  if (error === "forbidden") return "没有读取权限，请联系管理员";
  if (error === "unreachable") return "暂时读不到，请稍后重试";
  return "";
}
