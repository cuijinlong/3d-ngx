/**
 * 场景数据源：解析、合并、校验（2026-11-23）。
 *
 * <h2>解决什么问题</h2>
 *
 * <p>在线编程时写 <code>bind-telemetry</code> 要填 <code>telemetryKey</code>，
 * 但那个键在不在？这台设备有哪些属性？有没有告警？**一处都查不到**。
 * 只能去平台页面翻，或者猜 —— 而猜错的键不会报错，卡片只是永远显示「暂无数据」。
 *
 * <p>所以场景要有「数据源」：一组带名字的实体，外加**自动勘察**出来的
 * 可用遥测键/属性键/告警。开发时先看清单再写代码。
 *
 * <h2>显式 + 隐含</h2>
 *
 * <p>只有显式声明的话，每个场景都要手工配一遍，实际没人会配 ——
 * 于是清单永远是空的，功能等于不存在。
 *
 * <p>所以有两路来源，合并后才是完整清单：
 * <ul>
 *   <li><b>显式</b> —— <code>scene.dataSources</code>，用户起名、写说明、配范围；</li>
 *   <li><b>隐含</b> —— 从 <code>scene.bindings</code> 推导：凡是绑了设备的
 *       3D 对象都是一个源，名字取对象名。</li>
 * </ul>
 *
 * <p>显式声明同名时**覆盖**隐含源 —— 用户起了名就以用户的为准。
 */

import type { SceneDataSource, SceneDocument } from "@idt/shared-types";
import { widgetScopeKey } from "./scene-widget-layout";

/** 解析后的一个数据源：别名的实体身份 + 从哪来。 */
export interface ResolvedDataSource extends SceneDataSource {
  /** `explicit` = 用户声明；`implicit` = 从 3D 绑定推导。 */
  origin: "explicit" | "implicit";
  /** 这个源解析出的实体 id 列表（device 1 个，scope 多个）。 */
  entityIds: string[];
  /** 解析失败的说明。有值时不参与勘察，但**仍然列出** —— 让人看到哪里错了。 */
  problems: string[];
  /**
   * 范围类源「设备清单还没解析」。
   *
   * <p>与 `problems` 分开：这是**待定**不是**配错**。范围设备要调平台接口
   * 才知道，面板不该在还没查的时候报「范围内暂无设备」—— 那会让人以为配错了。
   */
  scopePending?: boolean;
}

/** 推断一个隐含源的短名：优先用 3D 对象名，退到设备名，最后用 id 片段。 */
function implicitId(sceneEntityId: string, deviceName?: string): string {
  const base = (deviceName || sceneEntityId).trim();
  /* 只保留字母数字汉字，避免脚本里得用引号包奇怪字符。 */
  const clean = base.replace(/[^\p{L}\p{N}_-]/gu, "");
  return clean || `src_${sceneEntityId.slice(0, 6)}`;
}

/**
 * 合并显式与隐含数据源。
 *
 * <p>不解析实体（那需要设备表），只做清单合并与去重 ——
 * 保持纯函数，便于单测和「不联网也能跑」。
 */
export function mergeSceneDataSources(scene: Pick<SceneDocument, "bindings" | "dataSources" | "entities">): Array<{
  source: SceneDataSource;
  origin: "explicit" | "implicit";
}> {
  const explicit = scene.dataSources ?? [];
  const explicitIds = new Set(explicit.map((item) => item.id));
  /* 显式声明的设备也算「已经覆盖」，避免同一台设备出现两条。 */
  const explicitDevices = new Set(
    explicit.map((item) => item.deviceId).filter((id): id is string => Boolean(id)),
  );

  /* 显式标注：否则 TS 把 merged 推断成「origin 只能是 explicit」。 */
  const merged: Array<{ source: SceneDataSource; origin: "explicit" | "implicit" }> =
    explicit.map((source) => ({ source, origin: "explicit" }));
  const seenDevice = new Set(explicitDevices);

  for (const binding of scene.bindings ?? []) {
    if (!binding.deviceId || !binding.sceneEntityId) continue;
    /* 同一台设备在 3D 里可能绑了多个节点，只取第一个当代表。 */
    if (seenDevice.has(binding.deviceId)) continue;
    seenDevice.add(binding.deviceId);

    const entity = scene.entities?.find((item) => item.id === binding.sceneEntityId);
    const id = implicitId(binding.sceneEntityId, entity?.name || binding.deviceName);
    /* 短名与显式源撞了：加后缀，不要覆盖用户起的名字。 */
    let unique = id;
    let suffix = 2;
    while (explicitIds.has(unique)) {
      unique = `${id}${suffix}`;
      suffix += 1;
    }

    merged.push({
      origin: "implicit",
      source: {
        id: unique,
        name: entity?.name || binding.deviceName || unique,
        kind: "device",
        deviceId: binding.deviceId,
        note: "来自三维对象绑定",
      },
    });
  }

  return merged;
}

/**
 * 把数据源解析成实体 id 列表。
 *
 * <p>`scope` 源需要外部提供「范围 → 设备」的映射（那要调平台接口），
 * 所以由调用方传进来，本函数保持纯。
 */
export function resolveDataSourceEntities(
  source: SceneDataSource,
  lookup: {
    /** 范围 id → 设备 id 列表。由 `widgetScopeDeviceIds` 一类逻辑算出。 */
    scopeDeviceIds?: Record<string, string[]>;
  } = {},
): { entityIds: string[]; problems: string[] } {
  const problems: string[] = [];

  if (source.kind === "device") {
    if (!source.deviceId) problems.push("kind=device 但没有填 deviceId");
    return { entityIds: source.deviceId ? [source.deviceId] : [], problems };
  }

  if (source.kind === "asset") {
    if (!source.assetId) problems.push("kind=asset 但没有填 assetId");
    return { entityIds: source.assetId ? [source.assetId] : [], problems };
  }

  /* kind === "scope" */
  if (!source.scope) {
    problems.push("kind=scope 但没有填 scope（场站或场景拓扑）");
    return { entityIds: [], problems };
  }
  const scope = source.scope;
  if (scope.kind === "site" && !scope.siteId) {
    problems.push("scope.kind=site 但没有填 siteId");
    return { entityIds: [], problems };
  }
  if (scope.kind === "topology" && !scope.topologyId) {
    problems.push("scope.kind=topology 但没有填 topologyId");
    return { entityIds: [], problems };
  }

  /*
   * 范围键必须用 `widgetScopeKey` 生成，不能自己拼（2026-11-23 修正）。
   *
   * <p>原来这里写的是裸 id（`scope.topologyId`），而 `WidgetOverlay` 填进
   * `scopeDeviceIds` 的键是 **`topology:<id>` / `site:<id>`** ——
   * 两者对不上，查表永远 miss，范围源**静默返回空**。
   *
   * <p>这类 bug 最难查：不报错、面板显示「范围内暂无设备」，
   * 于是人去怀疑范围选错了，而实际是键名不一致。
   * 复用 `widgetScopeKey` 才有唯一真相。
   */
  const scopeKey = widgetScopeKey({
    kind: scope.kind,
    ...(scope.siteId ? { siteId: scope.siteId } : {}),
    ...(scope.topologyId ? { topologyId: scope.topologyId } : {}),
  });
  /*
   * 没传映射 = 「还没解析」，不是「解析出 0 台」。
   *
   * 这两者必须分开：面板在打开时会先展示配置，设备清单还没拉；
   * 若此时报「范围内暂无设备」，用户会去检查范围选得对不对 ——
   * 而实际只是勘察还没开始。
   */
  if (!lookup.scopeDeviceIds) {
    return { entityIds: [], problems: [] };
  }
  const ids = scopeKey ? lookup.scopeDeviceIds[scopeKey] ?? [] : [];
  if (!ids.length) {
    problems.push("范围内暂无设备（可能范围确实没有设备，或设备未加载）");
  }
  return { entityIds: ids, problems };
}

/** 把合并 + 解析串起来，得到面板和脚本要的完整清单。 */
export function resolveSceneDataSources(
  scene: Pick<SceneDocument, "bindings" | "dataSources" | "entities">,
  lookup: { scopeDeviceIds?: Record<string, string[]> } = {},
): ResolvedDataSource[] {
  return mergeSceneDataSources(scene).map(({ source, origin }) => {
    const { entityIds, problems } = resolveDataSourceEntities(source, lookup);
    const scopePending = source.kind === "scope" && !lookup.scopeDeviceIds;
    return {
      ...source,
      origin,
      entityIds,
      problems,
      ...(scopePending ? { scopePending: true } : {}),
    };
  });
}

/**
 * 校验数据源清单，返回人话问题列表。
 *
 * <p>在**保存时**调用。写错的别名不会让界面崩，只会让脚本里 `ctx.src("xxx")`
 * 找不到 —— 那种失败要排查很久，不如保存时直接说。
 */
export function validateSceneDataSources(sources: SceneDataSource[] | undefined): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const source of sources ?? []) {
    const label = source.name || source.id || "(未命名)";

    if (!source.id?.trim()) {
      problems.push(`${label}：缺少短名 id（脚本里要用它引用）`);
      continue;
    }
    /* 短名会进脚本代码，限制字符集避免要加转义。 */
    if (!/^[\p{L}\p{N}_-]+$/u.test(source.id)) {
      problems.push(`${label}：短名「${source.id}」只能包含字母、数字、下划线、短横线`);
    }
    if (seen.has(source.id)) problems.push(`${label}：短名「${source.id}」重复`);
    seen.add(source.id);

    if (!source.name?.trim()) problems.push(`${source.id}：缺少显示名`);

    if (source.kind === "device" && !source.deviceId) {
      problems.push(`${label}：类型是「设备」但没选设备`);
    }
    if (source.kind === "asset" && !source.assetId) {
      problems.push(`${label}：类型是「资产」但没选资产`);
    }
    if (source.kind === "scope") {
      if (!source.scope) problems.push(`${label}：类型是「范围」但没选范围`);
      else if (source.scope.kind === "site" && !source.scope.siteId) {
        problems.push(`${label}：范围是场站但没选场站`);
      } else if (source.scope.kind === "topology" && !source.scope.topologyId) {
        problems.push(`${label}：范围是场景拓扑但没选拓扑`);
      }
    }
  }

  return problems;
}
