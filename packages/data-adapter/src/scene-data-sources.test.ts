import { describe, expect, it } from "vitest";
import {
  mergeSceneDataSources,
  resolveDataSourceEntities,
  resolveSceneDataSources,
  validateSceneDataSources,
} from "./scene-data-sources";
import type { SceneDataSource, SceneDocument } from "@idt/shared-types";

/**
 * 场景数据源（2026-11-23）。
 *
 * <p>这层的价值全在「能不能查到」：在线编程写 `bind-telemetry` 要填键名，
 * 而写错的键**不报错** —— 卡片只是永远显示「暂无数据」。
 * 所以每条解析规则都要有断言，尤其是「零配置也有内容」这条，
 * 否则功能等于不存在（没人会手工配一遍才用它）。
 */

function scene(partial: Partial<SceneDocument> = {}): Pick<SceneDocument, "bindings" | "dataSources" | "entities"> {
  return {
    bindings: [],
    dataSources: [],
    entities: [],
    ...partial,
  } as Pick<SceneDocument, "bindings" | "dataSources" | "entities">;
}

const binding = (sceneEntityId: string, deviceId: string, deviceName: string) =>
  ({ id: `b-${deviceId}`, deviceId, sceneEntityId, deviceName, telemetryMappings: [] }) as never;

describe("mergeSceneDataSources / 显式与隐含", () => {
  it("★ 零配置时从 3D 绑定推导出源（否则功能等于不存在）", () => {
    const merged = mergeSceneDataSources(
      scene({
        bindings: [binding("node-1", "dev-1", "模块机 1#"), binding("node-2", "dev-2", "模块机 2#")],
        entities: [
          { id: "node-1", name: "模块机 1#", nodeName: "1" } as never,
          { id: "node-2", name: "模块机 2#", nodeName: "2" } as never,
        ],
      }),
    );
    expect(merged).toHaveLength(2);
    expect(merged.every((item) => item.origin === "implicit")).toBe(true);
    expect(merged.map((item) => item.source.deviceId)).toEqual(["dev-1", "dev-2"]);
  });

  it("显式声明优先，同名设备不再产生隐含源", () => {
    const merged = mergeSceneDataSources(
      scene({
        bindings: [binding("node-1", "dev-1", "模块机 1#")],
        dataSources: [{ id: "gw", name: "网关", kind: "device", deviceId: "dev-1" }],
      }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.origin).toBe("explicit");
    expect(merged[0]?.source.id).toBe("gw");
  });

  it("同一台设备绑多个 3D 节点只出一个源（否则清单重复）", () => {
    const merged = mergeSceneDataSources(
      scene({
        bindings: [binding("node-1", "dev-1", "网关"), binding("node-2", "dev-1", "网关")],
      }),
    );
    expect(merged).toHaveLength(1);
  });

  it("隐含源短名与显式源撞了要加后缀，不覆盖用户起的名字", () => {
    const merged = mergeSceneDataSources(
      scene({
        bindings: [binding("node-1", "dev-1", "网关")],
        entities: [{ id: "node-1", name: "网关" } as never],
        dataSources: [{ id: "网关", name: "我的网关", kind: "device", deviceId: "dev-9" }],
      }),
    );
    const ids = merged.map((item) => item.source.id);
    expect(ids).toContain("网关");
    expect(ids).toContain("网关2");
    /* 用户起的名字必须还在。 */
    expect(merged.find((item) => item.source.id === "网关")?.origin).toBe("explicit");
  });

  it("短名只保留字母数字汉字下划线和短横线（要能直接写进代码）", () => {
    const merged = mergeSceneDataSources(
      scene({ bindings: [binding("node-1", "dev-1", "模块机 1#（A区）")] }),
    );
    expect(merged[0]?.source.id).toMatch(/^[\p{L}\p{N}_-]+$/u);
  });
});

describe("resolveDataSourceEntities / 三种解析方式", () => {
  it("device：有 deviceId 就解析成一台", () => {
    const result = resolveDataSourceEntities({ id: "a", name: "A", kind: "device", deviceId: "d1" });
    expect(result.entityIds).toEqual(["d1"]);
    expect(result.problems).toEqual([]);
  });

  it("device 缺 deviceId 要报错（不是静默空）", () => {
    const result = resolveDataSourceEntities({ id: "a", name: "A", kind: "device" });
    expect(result.entityIds).toEqual([]);
    expect(result.problems[0]).toContain("deviceId");
  });

  it("asset：解析成资产 id", () => {
    const result = resolveDataSourceEntities({ id: "p", name: "冷热站", kind: "asset", assetId: "as1" });
    expect(result.entityIds).toEqual(["as1"]);
  });

  it("★ scope 未传设备映射时是「待定」，不是「配错」", () => {
    const result = resolveDataSourceEntities({
      id: "units",
      name: "9 台",
      kind: "scope",
      scope: { kind: "topology", topologyId: "t1" },
    });
    /* 关键：不能报 problems —— 面板会用红字说「范围内暂无设备」，
       而实际只是还没查，用户会去怀疑范围选错了。 */
    expect(result.problems).toEqual([]);
    expect(result.entityIds).toEqual([]);
  });

  it("★ scope 键必须用 widgetScopeKey 的格式（topology:<id>），不是裸 id", () => {
    /*
     * 这是修过的一个真 bug：本文件原来用 `scope.topologyId` 当键去查，
     * 而 `WidgetOverlay` 填的是 `topology:<id>` —— 对不上就永远 miss，
     * 范围源静默返回空、面板显示「范围内暂无设备」，人会去怀疑范围选错了。
     */
    const keyed = resolveDataSourceEntities(
      { id: "units", name: "9 台", kind: "scope", scope: { kind: "topology", topologyId: "t1" } },
      { scopeDeviceIds: { "topology:t1": ["d1", "d2"] } },
    );
    expect(keyed.entityIds).toEqual(["d1", "d2"]);

    /* 裸 id 作键**不应**命中 —— 若命中了说明又退回了旧写法。 */
    const bare = resolveDataSourceEntities(
      { id: "units", name: "9 台", kind: "scope", scope: { kind: "topology", topologyId: "t1" } },
      { scopeDeviceIds: { t1: ["d1", "d2"] } },
    );
    expect(bare.entityIds).toEqual([]);
    expect(bare.problems[0]).toContain("范围内暂无设备");
  });

  it("场站范围用 site:<id> 作键", () => {
    const result = resolveDataSourceEntities(
      { id: "site", name: "场站", kind: "scope", scope: { kind: "site", siteId: "s1" } },
      { scopeDeviceIds: { "site:s1": ["d9"] } },
    );
    expect(result.entityIds).toEqual(["d9"]);
  });

  it("scope 传了映射但该范围确实没设备 → 这才是问题", () => {
    const result = resolveDataSourceEntities(
      { id: "units", name: "9 台", kind: "scope", scope: { kind: "topology", topologyId: "t1" } },
      { scopeDeviceIds: { "topology:t1": [] } },
    );
    expect(result.problems[0]).toContain("范围内暂无设备");
  });

  it("scope 缺 kind 对应的 id 要报错", () => {
    const result = resolveDataSourceEntities({
      id: "s", name: "S", kind: "scope", scope: { kind: "site" },
    });
    expect(result.problems[0]).toContain("siteId");
  });
});

describe("resolveSceneDataSources / 串起来", () => {
  it("隐含源带 origin 标记，且 scope 源被标 scopePending", () => {
    const list = resolveSceneDataSources(
      scene({
        bindings: [binding("n1", "d1", "网关")],
        dataSources: [
          { id: "units", name: "机组", kind: "scope", scope: { kind: "topology", topologyId: "t1" } },
        ],
      }),
    );
    expect(list.find((item) => item.id === "units")?.scopePending).toBe(true);
    expect(list.find((item) => item.deviceId === "d1")?.origin).toBe("implicit");
  });
});

describe("validateSceneDataSources / 保存前挡一道", () => {
  const base: SceneDataSource = { id: "gw", name: "网关", kind: "device", deviceId: "d1" };

  it("合法清单无问题", () => {
    expect(validateSceneDataSources([base])).toEqual([]);
  });

  it("★ 短名重复要报（脚本里 ctx.src 会有歧义）", () => {
    const problems = validateSceneDataSources([base, { ...base, deviceId: "d2" }]);
    expect(problems.some((item) => item.includes("重复"))).toBe(true);
  });

  it("短名含空格/括号要报（写不进代码）", () => {
    const problems = validateSceneDataSources([{ ...base, id: "我的 网关" }]);
    expect(problems[0]).toContain("只能包含");
  });

  it("kind=asset 缺 assetId 要报", () => {
    const problems = validateSceneDataSources([{ id: "a", name: "A", kind: "asset" }]);
    expect(problems[0]).toContain("资产");
  });

  it("kind=scope 缺 scope 要报", () => {
    const problems = validateSceneDataSources([{ id: "s", name: "S", kind: "scope" }]);
    expect(problems[0]).toContain("范围");
  });

  it("空/未定义清单不报（合法状态：还没配）", () => {
    expect(validateSceneDataSources(undefined)).toEqual([]);
    expect(validateSceneDataSources([])).toEqual([]);
  });
});
