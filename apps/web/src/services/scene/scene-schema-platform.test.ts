import { describe, expect, it } from "vitest";
import { safeParseSceneDocument } from "@idt/scene-schema";

/**
 * 回归测试：platformSchema 曾经漏了 customerId / sceneInstance / publishState。
 *
 * zod 对未声明字段是 strip 而不是报错，所以「导入场景 JSON」会把客户归属
 * 静默吞掉 —— 场景落到「无客户」下，租户列表看不到、客户按 customerId
 * 过滤也打不开，且全程没有报错。这类失效只能靠单测钉住。
 */
function baseDoc(platform: unknown) {
  return {
    schemaVersion: "1.0.0",
    scene: { id: "s1", name: "测试场景", createdAt: "t", updatedAt: "t" },
    settings: { background: "#dce3ed", environment: null, gridEnabled: true },
    entities: [],
    bindings: [],
    ...(platform === undefined ? {} : { platform }),
  };
}

describe("scene-schema / platform", () => {
  it("保留 customerId、sceneInstance、publishState", () => {
    const result = safeParseSceneDocument(baseDoc({
      siteId: "site-1",
      siteName: "科技园",
      customerId: "cust-1",
      topologyId: "topo-1",
      topologyName: "热泵系统 1",
      viewType: "physical",
      roots: ["asset-root"],
      rootNames: ["热泵系统 1"],
      sceneInstance: true,
      publishState: "published",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const platform = result.data.platform;
    expect(platform?.customerId).toBe("cust-1");
    expect(platform?.sceneInstance).toBe(true);
    expect(platform?.publishState).toBe("published");
    expect(platform?.roots).toEqual(["asset-root"]);
  });

  it("缺 customerId 的旧文档仍能解析（不因缺少归属而拒绝）", () => {
    const result = safeParseSceneDocument(baseDoc({
      siteId: "site-1",
      viewType: "physical",
      topologyId: "topo-legacy",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.platform?.customerId).toBeUndefined();
    expect(result.data.platform?.topologyId).toBe("topo-legacy");
  });

  it("完全不写 platform 仍能解析（本地未挂靠场景）", () => {
    const result = safeParseSceneDocument(baseDoc(undefined));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.platform).toBeUndefined();
  });

  it("sceneInstance 必须是布尔，字符串不冒充", () => {
    const result = safeParseSceneDocument(baseDoc({
      siteId: "site-1",
      viewType: "physical",
      sceneInstance: "true",
    }));
    expect(result.success).toBe(false);
  });
});
