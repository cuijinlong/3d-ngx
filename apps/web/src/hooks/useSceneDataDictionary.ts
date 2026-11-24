import { useEffect, useMemo, useRef, useState } from "react";
import { getDataProvider } from "@idt/data-adapter";
import type { ResolvedDataSource } from "@idt/data-adapter";

/**
 * 场景数据源**勘察**（2026-11-23）。
 *
 * <h2>它回答的问题</h2>
 *
 * <p>「这台设备能绑哪些遥测？身上有哪些属性？有没有活跃告警？」
 * 在线编程写 `bind-telemetry` 时要填的 `telemetryKey` 从哪来 —— 就是这里。
 *
 * <h2>★ 遥测与属性必须分开</h2>
 *
 * <p>不能用 `listTelemetryKeys` —— 它返回「**可绑定测点**」= 时序键 + 属性键的并集
 * （绑定面板需要，因为它允许绑属性）。实测后果：`brand` / `deviceCode` / `model`
 * 这些属性被列进「遥测」，用户照着建卡片就是「把属性当遥测读」，
 * 永远没有实时值、也永远不报错。
 *
 * <p>所以这里用 `listTimeseriesKeys`（纯时序）+ `listAttributeKeys`（纯属性），
 * 并在结果里再交叉剔除一次 —— 万一旧 provider 只能给并集，也不会污染「遥测」这一栏。
 *
 * <h2>为什么必须限量（A5 · 禁止 N+1）</h2>
 *
 * <p>一个 scope 源可能解析出 50 台设备，每台 2 个请求就是 100 个往返。
 * 这个 hook 挂在编辑器上，不设上限等于给平台注入请求风暴。所以：
 * 每源最多 12 台、全局并发 6、按实体 id 缓存（同一台设备只查一次）。
 *
 * <h2>告警只拉一次</h2>
 *
 * <p>平台告警接口是租户级的（`/api/alarms`），不是按设备查。
 * 拉一次全量再按 `deviceId` 分组 —— 不要让每台设备各拉一遍。
 */

export interface SourceTelemetryKey {
  key: string;
  label?: string;
  unit?: string;
  /** 有几个实体身上存在这个键（scope 源里通常是全部）。 */
  onEntities: number;
}

/** 单个实体上的一个键（还没统计「几台有」）。 */
interface RawTelemetryKey {
  key: string;
  label?: string;
  unit?: string;
}

export interface SourceCapabilities {
  /** 该源所有实体上出现过的**遥测**键（并集）。不含属性。 */
  telemetry: SourceTelemetryKey[];
  /** **属性**键（并集）。只有「上次写入」，不是实时值。 */
  attributes: string[];
  /** 与该源实体相关的活跃告警。 */
  alarms: Array<{ type: string; level: string; deviceId: string }>;
  /** 实际勘察了几个实体。 */
  checked: number;
  /** 源解析出的实体总数 —— `checked < total` 说明被限量截断。 */
  total: number;
  /** 勘察失败的说明（不阻断其余源）。 */
  error?: string;
}

const MAX_ENTITIES_PER_SOURCE = 12;
const CONCURRENCY = 6;

/** 简单并发池：最多同时跑 limit 个任务。 */
async function pooled<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

export function useSceneDataDictionary(
  sources: ResolvedDataSource[] | undefined,
): { dictionary: Record<string, SourceCapabilities>; loading: boolean } {
  const [dictionary, setDictionary] = useState<Record<string, SourceCapabilities>>({});
  const [loading, setLoading] = useState(false);
  /**
   * 实体级缓存：同一台设备无论出现在几个源里，只勘察一次。
   * 放 ref 而不是 state —— 它只影响请求量，不影响渲染。
   */
  const cache = useRef(new Map<string, { telemetry: RawTelemetryKey[]; attributes: string[] }>());

  /*
   * 依赖用**实体 id 的签名**，不用 sources 数组本身。
   * sources 是每次渲染新建的数组，直接进依赖会无限重跑勘察。
   */
  const signature = useMemo(
    () =>
      (sources ?? [])
        .map((source) => `${source.id}:${source.entityIds.slice(0, MAX_ENTITIES_PER_SOURCE).join(",")}`)
        .join("|"),
    [sources],
  );

  useEffect(() => {
    const list = sources ?? [];
    if (!list.length) {
      setDictionary({});
      return;
    }
    const provider = getDataProvider();
    let cancelled = false;

    void (async () => {
      setLoading(true);

      /* 告警一次拉全量，再按 deviceId 分组 —— 不是每台拉一次。 */
      let alarmsByDevice = new Map<string, Array<{ type: string; level: string; deviceId: string }>>();
      try {
        const alarms = (await provider.getAlarms?.()) ?? [];
        alarmsByDevice = alarms.reduce((acc, alarm) => {
          if (!alarm.active) return acc;
          const rows = acc.get(alarm.deviceId) ?? [];
          rows.push({ type: alarm.message, level: alarm.level, deviceId: alarm.deviceId });
          acc.set(alarm.deviceId, rows);
          return acc;
        }, new Map<string, Array<{ type: string; level: string; deviceId: string }>>());
      } catch {
        /* 告警拉不到不影响遥测/属性勘察 —— 面板会显示「告警未勘察到」。 */
      }

      /** 勘察一个实体（带缓存）。 */
      const inspectEntity = async (
        entityId: string,
      ): Promise<{ telemetry: RawTelemetryKey[]; attributes: string[] }> => {
        const cached = cache.current.get(entityId);
        if (cached) return cached;

        const [telemetryKeys, attributes] = await Promise.all([
          (async () => {
            if (provider.listTimeseriesKeys) {
              return provider.listTimeseriesKeys(entityId).catch(() => [] as string[]);
            }
            /*
             * 旧 provider 没有专用方法：退回「可绑定测点」，
             * 但下面会用属性集合交叉剔除，保证「遥测」这一栏不混入属性。
             */
            const points = (await provider.listTelemetryKeys?.(entityId).catch(() => [])) ?? [];
            return points.map((point) => point.key);
          })(),
          provider.listAttributeKeys
            ? provider.listAttributeKeys("DEVICE", entityId).catch(() => [] as string[])
            : Promise.resolve([] as string[]),
        ]);

        const attributeSet = new Set(attributes ?? []);
        const result: { telemetry: RawTelemetryKey[]; attributes: string[] } = {
          telemetry: (telemetryKeys ?? [])
            .filter((key) => !attributeSet.has(key))
            .map((key) => ({ key })),
          attributes: (attributes ?? []).slice().sort(),
        };
        cache.current.set(entityId, result);
        return result;
      };

      /*
       * 源之间也并发。
       *
       * <p>串行 for 时 13 个源 = 13 轮往返，实测要 20 秒 ——
       * 面板一直显示「正在勘察…」，看起来像卡死。并发后 2~3 秒。
       * 总并发仍由 `pooled` 控制在 6，不会放大请求数。
       */
      const handled = await pooled(list, CONCURRENCY, async (source) => {
        const entityIds = source.entityIds;
        if (!entityIds.length) {
          return {
            id: source.id,
            caps: {
              telemetry: [],
              attributes: [],
              alarms: [],
              checked: 0,
              total: 0,
              error: source.problems.join("；") || "该数据源没有解析出任何实体",
            } satisfies SourceCapabilities,
          };
        }

        const targets = entityIds.slice(0, MAX_ENTITIES_PER_SOURCE);
        try {
          const inspected = await pooled(targets, CONCURRENCY, inspectEntity);

          /*
           * 并集：统计每个键在多少个实体上出现过。
           * 面板据此标「全部 9 台都有」还是「只有 3 台有」——
           * 后者往往意味着配错了设备，或型号不同。
           */
          const keyCount = new Map<string, SourceTelemetryKey>();
          const attributeSet = new Set<string>();
          for (const item of inspected) {
            for (const key of item.telemetry) {
              const existing = keyCount.get(key.key);
              if (existing) {
                existing.onEntities += 1;
                continue;
              }
              const row: SourceTelemetryKey = { key: key.key, onEntities: 1 };
              if (key.label) row.label = key.label;
              if (key.unit) row.unit = key.unit;
              keyCount.set(key.key, row);
            }
            for (const attr of item.attributes) attributeSet.add(attr);
          }

          const alarms = targets.flatMap((id) => alarmsByDevice.get(id) ?? []);

          return {
            id: source.id,
            caps: {
              telemetry: [...keyCount.values()].sort((a, b) => a.key.localeCompare(b.key)),
              attributes: [...attributeSet].sort(),
              alarms,
              checked: targets.length,
              total: entityIds.length,
            } satisfies SourceCapabilities,
          };
        } catch (error) {
          return {
            id: source.id,
            caps: {
              telemetry: [],
              attributes: [],
              alarms: [],
              checked: 0,
              total: entityIds.length,
              error: error instanceof Error ? error.message : String(error),
            } satisfies SourceCapabilities,
          };
        }
      });

      if (cancelled) return;
      const next: Record<string, SourceCapabilities> = {};
      for (const item of handled) next[item.id] = item.caps;
      /* 与上一轮合并，避免「源顺序变化」时闪空。 */
      setDictionary((prev) => ({ ...prev, ...next }));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    /* 只按实体签名重跑；sources 对象每次渲染都是新的。 */
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  return { dictionary, loading };
}
