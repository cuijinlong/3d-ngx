import { useEffect, useRef } from "react";
import { getTopologyApi } from "@idt/data-adapter";
import { EngineManager, type ResolvedRenderRules } from "../engine/core/EngineManager";

/**
 * 把风格套装的渲染规则灌进引擎（2026-11-23）。
 *
 * <h2>它解决的问题</h2>
 *
 * <p>套装描述里写着「管三态」「昼夜联动」，但此前**代码里没有对应实现** ——
 * 选了套装只是记了一个标签，管道照样不流速、阀门不变色。描述是空话。
 *
 * <p>这个 hook 按 `stylePack`（形如 `hvac-hud-v1@1.0.0`）从平台取
 * `render` 规则，交给 `EngineManager` 应用。
 *
 * <h2>为什么要缓存 catalog</h2>
 *
 * <p>`stylePacks()` 每次都发 HTTP。大屏会反复挂载（切场景、切路由），
 * 不缓存等于每次进页面都多一个请求。catalog 是**发布时才变**的数据，
 * 页面生命周期内缓存完全够用。
 *
 * <h2>失败时的行为</h2>
 *
 * <p>取不到就**保持上一次的规则**（首次则是默认值），不重置、不抛错。
 * 场景必须能渲染 —— 一个"选不到套装"不该让 3D 变白。
 */
const catalogCache = new Map<string, ResolvedRenderRules | null>();

/** 只取 packId 部分：`hvac-hud-v1@1.0.0` → `hvac-hud-v1` */
function packIdOf(stylePack: string): string {
  return stylePack.split("@")[0]!.trim();
}

async function resolveRules(stylePack: string): Promise<ResolvedRenderRules | null> {
  const packId = packIdOf(stylePack);
  if (!packId) return null;
  if (catalogCache.has(packId)) return catalogCache.get(packId) ?? null;

  try {
    const api = getTopologyApi();
    const catalog = await api.stylePacks();
    /*
     * 整份 catalog 一次性填进缓存：同一环境下常有多个场景用不同套装，
     * 逐个按需请求会把同一个接口打很多次。
     */
    for (const pack of catalog?.packs ?? []) {
      if (!pack?.packId) continue;
      catalogCache.set(pack.packId, (pack.render as ResolvedRenderRules | undefined) ?? null);
    }
  } catch {
    /* 平台不可达：不写缓存，下次挂载还能重试 */
    return null;
  }
  return catalogCache.get(packId) ?? null;
}

/**
 * @param stylePack  形如 `hvac-hud-v1@1.0.0`
 * @param topologyId 可选的场景拓扑 id。`stylePack` 为空时用它去平台取 ——
 *                   见下方「为什么要回查平台」。
 */
export function useStylePackRenderRules(
  stylePack: string | null | undefined,
  topologyId?: string | null,
): void {
  /** 最后一次请求的序号（见 effect 内的说明） */
  const seqRef = useRef(0);
  useEffect(() => {
    /*
     * ★ 用序号而不是 `cancelled` 布尔（2026-11-23 修正）。
     *
     * <h3>为什么</h3>
     *
     * <p>场景加载会**多次**更新 document（骨架 → 模型 → 布局），
     * 每次都可能让 effect 重跑。此时前一次的 `cancelled` 变 true，
     * 它的 resolve 结果被丢弃 —— 而最后一次的异步链（查拓扑 → 查 catalog）
     * 又要重跑一遍。如果用户在这一秒内切走，规则就永远没被应用。
     *
     * <p>实测现象：dev 环境 trace 能看到 `resolveRules:done found=[pipe,valve,device]`，
     * 但引擎里 `getRenderRules()` 仍是默认值 —— 规则取到了却没生效，
     * 正是被 `cancelled` 拦掉的。
     *
     * <p>改成序号：只丢弃**更旧的**结果，最新的永远生效。
     * 这与 `useSiteEnergyStats` 里的 `seq` 是同一个模式。
     */
    const mySeq = ++seqRef.current;
    if (!stylePack && !topologyId) {
      /* 两个都没有：回到默认，避免沿用上一个场景的规则 */
      EngineManager.instance.setRenderRules(null);
      return undefined;
    }
    /*
     * ★ 为什么要回查平台（2026-11-23 实测）。
     *
     * <p>场景文档优先从 **IndexedDB** 读（本地缓存），而缓存里
     * `platform.stylePack` 可能是旧值 null —— 即使平台上已经配了
     * `hvac-hud-v1@1.0.0`。
     *
     * <p>实测现象：引擎里 `getRenderRules()` 一直是默认值，
     * 看起来像"套装规则没接上"。而真正的链路（取 catalog → 应用流速/
     * 阀门色）全都写好了。
     *
     * <p>stylePack 是**平台权威**的配置（不是本地编辑态），
     * 所以这里以平台为准：本地没有就查一次拓扑。
     * 用 `topologyId` 查，而不是遍历全部场景。
     */
    const resolvePack = async (): Promise<string | null> => {
      if (stylePack) return stylePack;
      if (!topologyId) return null;
      try {
        const api = getTopologyApi();
        const graph = await api.load(topologyId);
        return graph?.stylePack ?? null;
      } catch {
        return null;
      }
    };
    void resolvePack()
      .then((pack) => (pack ? resolveRules(pack) : null))
      .then((rules) => {
        /* 有更新的请求就不覆盖：避免旧场景的规则盖掉新场景 */
        if (mySeq !== seqRef.current) return;
        /*
         * `null` 也要调 setRenderRules —— 它内部会 merge 到默认值上。
         * 不调的话，从「有套装的场景」切到「无规则场景」会沿用旧规则。
         */
        EngineManager.instance.setRenderRules(rules);
      });
    return undefined;
  }, [stylePack, topologyId]);
}
