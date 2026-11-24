import { useEffect, useMemo, useState } from "react";
import { getDataProvider } from "@idt/data-adapter";
import type { SceneWidget } from "@idt/data-adapter";
import { mergeHistoryAggregate, widgetScopeDeviceIds } from "../features/scene-widgets/widget-values";

/**
 * 范围聚合历史（2026-11-23）。
 *
 * <h2>解决什么</h2>
 *
 * <p>趋势图原来只画「本次打开页面后 store 累积的点」—— 刷新一次就从头开始，
 * 看不到「过去 24 小时」。而网关的系统级 `power_total` 根本没上报，
 * 「总功率趋势」永远是空的。
 *
 * <p>这个 hook 把 scope 范围内每台设备的历史拉下来，按时间桶合并成一条。
 * 9 台机组功率之和的趋势 = 真实的总功率曲线（口径写在卡片 label 里）。
 *
 * <h2>为什么只在聚合槽上工作</h2>
 *
 * <p>单设备槽的实时累积已经够用，不需要多拉一次历史。
 * 只有 `aggregate` 槽没有「单台设备」可依，才需要这个路径。
 *
 * <h2>请求量</h2>
 *
 * <p>9 台 × 1 次 = 9 个请求，**一次加载**（`deviceIds` + 时间窗不变就不重拉）。
 * 这与轮询 3 秒一轮的 N+1 是两件事。
 */
export function useScopedHistory(
  widget: Pick<SceneWidget, "scope" | "slots" | "filterText"> | null | undefined,
  scopeDeviceIds: Record<string, string[]> | undefined,
  deviceNameOf: (id: string) => string,
  windowHours = 24,
): Record<string, Array<{ timestamp: number; value: number }>> {
  const [result, setResult] = useState<Record<string, Array<{ timestamp: number; value: number }>>>({});

  /* 只处理配了 aggregate 的槽位。 */
  const aggSlots = useMemo(
    () => (widget?.slots ?? []).filter((slot) => slot.aggregate && slot.telemetryKey),
    [widget],
  );

  /* 名字过滤：和 device-list 用同一套规则，保证口径一致。 */
  const ids = useMemo(() => {
    const all = widgetScopeDeviceIds(widget ?? {}, scopeDeviceIds) ?? [];
    const needle = (widget?.filterText || "").trim();
    return needle ? all.filter((id) => deviceNameOf(id).includes(needle)) : all;
  }, [widget, scopeDeviceIds, deviceNameOf]);

  const idsKey = ids.join(",");
  const slotKey = aggSlots.map((slot) => `${slot.key}:${slot.telemetryKey}:${slot.aggregate}`).join("|");

  useEffect(() => {
    if (!aggSlots.length || !ids.length) {
      setResult({});
      return;
    }
    const provider = getDataProvider();
    if (!provider.getTelemetryHistory) {
      setResult({});
      return;
    }

    let cancelled = false;
    const toTs = Date.now();
    const fromTs = toTs - windowHours * 3_600_000;
    /* 24 小时切成 96 个 15 分钟桶 —— 曲线够细，点数也不至于爆。 */
    const intervalMs = 15 * 60_000;

    void (async () => {
      const next: Record<string, Array<{ timestamp: number; value: number }>> = {};
      for (const slot of aggSlots) {
        const key = slot.telemetryKey as string;
        const perDevice = await Promise.all(
          ids.map(async (deviceId) => {
            try {
              const rows = await provider.getTelemetryHistory!(deviceId, [key], {
                fromTs,
                toTs,
                intervalMs,
                limit: 200,
              });
              return rows.map((row) => ({ timestamp: row.timestamp, value: row.value }));
            } catch {
              /* 单台失败就少一台 —— 合并时该桶数值偏小，
                 但不会让整张图变空。宁可少一台也要画出其余 8 台。 */
              return [];
            }
          }),
        );
        next[slot.key] = mergeHistoryAggregate(perDevice, slot.aggregate!, intervalMs);
      }
      if (!cancelled) setResult(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey, slotKey, windowHours]); // eslint-disable-line react-hooks/exhaustive-deps

  return result;
}
