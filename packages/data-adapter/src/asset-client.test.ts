import { describe, expect, it, vi } from "vitest";
import type { GuardClient } from "./guard-client";
import { GuardHttpError } from "./guard-client";
import {
  AssetAccessError,
  AssetApi,
  parseAssetAttributes,
  parsePlatformAsset,
} from "./asset-client";

/** 极简 GuardClient 假体：只实现 requestJson，按 path 路由。 */
function fakeClient(handler: (path: string) => unknown): GuardClient {
  return {
    requestJson: async (_method: string, path: string) => handler(path),
  } as unknown as GuardClient;
}

describe("parsePlatformAsset", () => {
  it("解析 id / name / label / type", () => {
    const asset = parsePlatformAsset({ id: { id: "a-1", entityType: "ASSET" }, name: "热泵系统 1", label: "科技园冷热站", type: "topology" });
    expect(asset).toEqual({ id: "a-1", name: "热泵系统 1", label: "科技园冷热站", type: "topology" });
  });

  it("label 为空时不写该字段（避免出现 label: \"\"）", () => {
    const asset = parsePlatformAsset({ id: "a-1", name: "x" });
    expect(asset && "label" in asset).toBe(false);
  });

  it("缺 id 返回 null", () => {
    expect(parsePlatformAsset({ name: "x" })).toBeNull();
  });
});

describe("parseAssetAttributes", () => {
  it("解析扁平结构 {key, value, lastUpdatedTs}", () => {
    const rows = parseAssetAttributes([{ key: "onlineRate", value: 95, lastUpdatedTs: 1700000000000 }]);
    expect(rows).toEqual([{ key: "onlineRate", value: 95, lastUpdatedTs: 1700000000000 }]);
  });

  it("解析 {value:{value, ts}} 包装（另一条链路的序列化方式）", () => {
    const rows = parseAssetAttributes([{ key: "onlineRate", value: { value: "95", ts: 1700000001000 } }]);
    expect(rows).toEqual([{ key: "onlineRate", value: "95", lastUpdatedTs: 1700000001000 }]);
  });

  it("布尔值不被当成非法值丢掉", () => {
    const rows = parseAssetAttributes([{ key: "running", value: false, lastUpdatedTs: 1 }]);
    expect(rows[0]?.value).toBe(false);
  });

  it("对象/数组值被跳过（属性只收标量）", () => {
    const rows = parseAssetAttributes([
      { key: "obj", value: { a: 1 }, lastUpdatedTs: 1 },
      { key: "arr", value: [1, 2], lastUpdatedTs: 1 },
      { key: "ok", value: 1, lastUpdatedTs: 1 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["ok"]);
  });

  it("同 key 只保留第一条", () => {
    const rows = parseAssetAttributes([
      { key: "k", value: 1, lastUpdatedTs: 1 },
      { key: "k", value: 2, lastUpdatedTs: 2 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(1);
  });

  it("缺时间戳时置 0，不丢值", () => {
    const rows = parseAssetAttributes([{ key: "k", value: 5 }]);
    expect(rows[0]).toEqual({ key: "k", value: 5, lastUpdatedTs: 0 });
  });
});

describe("AssetApi.listCustomerAssets", () => {
  it("多页拉全", async () => {
    const pages: Record<number, unknown> = {
      0: { data: [{ id: "a-1", name: "A" }], hasNext: true, totalElements: 2 },
      1: { data: [{ id: "a-2", name: "B" }], hasNext: false, totalElements: 2 },
    };
    const client = fakeClient((path) => {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return pages[page];
    });
    const result = await new AssetApi(client).listCustomerAssets("cust-1");
    expect(result.items.map((a) => a.id)).toEqual(["a-1", "a-2"]);
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(2);
  });

  it("分页触到上限时置 truncated 并 warn（不静默当全量）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let call = 0;
    const client = fakeClient(() => {
      call += 1;
      return { data: [{ id: `a-${call}`, name: `A${call}` }], hasNext: true, totalElements: 99999 };
    });
    const result = await new AssetApi(client).listCustomerAssets("cust-1");
    expect(result.truncated).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("空 customerId 直接返回空，不发请求", async () => {
    const requestJson = vi.fn();
    const client = { requestJson } as unknown as GuardClient;
    const result = await new AssetApi(client).listCustomerAssets("");
    expect(result).toEqual({ items: [], total: 0, truncated: false });
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("403 → AssetAccessError(kind=forbidden)，不是空数组", async () => {
    const client = fakeClient(() => {
      throw new GuardHttpError("forbidden", 403);
    });
    await expect(new AssetApi(client).listCustomerAssets("cust-1")).rejects.toMatchObject({
      name: "AssetAccessError",
      kind: "forbidden",
    });
  });

  it("网络错误 → kind=unreachable", async () => {
    const client = fakeClient(() => {
      throw new Error("fetch failed");
    });
    await expect(new AssetApi(client).listCustomerAssets("cust-1")).rejects.toBeInstanceOf(AssetAccessError);
    await expect(new AssetApi(client).listCustomerAssets("cust-1")).rejects.toMatchObject({ kind: "unreachable" });
  });
});

describe("AssetApi.getAttributes", () => {
  it("指定 scope 时只发一次请求", async () => {
    const paths: string[] = [];
    const client = fakeClient((path) => {
      paths.push(path);
      return [{ key: "onlineRate", value: 95, lastUpdatedTs: 1 }];
    });
    const rows = await new AssetApi(client).getAttributes("a-1", ["onlineRate"], "SERVER_SCOPE");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("/values/attributes/SERVER_SCOPE");
    expect(rows[0]?.value).toBe(95);
  });

  it("不指定 scope 时按 SERVER → SHARED 合并，先到先得", async () => {
    const client = fakeClient((path) => {
      if (path.includes("SERVER_SCOPE")) return [{ key: "k", value: "server", lastUpdatedTs: 1 }];
      if (path.includes("SHARED_SCOPE")) return [{ key: "k", value: "shared", lastUpdatedTs: 2 }];
      return [];
    });
    const rows = await new AssetApi(client).getAttributes("a-1", ["k"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("server");
  });

  it("请求不存在的 key 返回空数组，不抛", async () => {
    const client = fakeClient(() => []);
    await expect(new AssetApi(client).getAttributes("a-1", ["nope"])).resolves.toEqual([]);
  });

  it("keys 为空时不发请求", async () => {
    const requestJson = vi.fn();
    const client = { requestJson } as unknown as GuardClient;
    await expect(new AssetApi(client).getAttributes("a-1", [])).resolves.toEqual([]);
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("返回顺序按请求的 keys 排（界面列顺序稳定）", async () => {
    const client = fakeClient((path) => {
      if (path.includes("SERVER_SCOPE")) {
        return [
          { key: "b", value: 2, lastUpdatedTs: 1 },
          { key: "a", value: 1, lastUpdatedTs: 1 },
        ];
      }
      return [];
    });
    const rows = await new AssetApi(client).getAttributes("a-1", ["a", "b"], "SERVER_SCOPE");
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("403 → forbidden", async () => {
    const client = fakeClient(() => {
      throw new GuardHttpError("forbidden", 403);
    });
    await expect(new AssetApi(client).getAttributes("a-1", ["k"])).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("404 → not-found", async () => {
    const client = fakeClient(() => {
      throw new GuardHttpError("not found", 404);
    });
    await expect(new AssetApi(client).getAttributes("a-1", ["k"])).rejects.toMatchObject({ kind: "not-found" });
  });
});

describe("AssetApi.getAsset", () => {
  it("404 返回 null（资产被删是正常结果，不当异常）", async () => {
    const client = fakeClient(() => {
      throw new GuardHttpError("not found", 404);
    });
    await expect(new AssetApi(client).getAsset("a-1")).resolves.toBeNull();
  });

  it("403 仍抛错（无权限不能伪装成不存在）", async () => {
    const client = fakeClient(() => {
      throw new GuardHttpError("forbidden", 403);
    });
    await expect(new AssetApi(client).getAsset("a-1")).rejects.toMatchObject({ kind: "forbidden" });
  });
});

/**
 * listAttributes（2026-11-23）：配绑定时要「先列键名再选」。
 *
 * 与 getAttributes 的区别只在带不带 key 参数，所以这里重点验
 * 「不带 key」和「scope 合并口径与取值一致」——
 * 口径不一致会出现「下拉里能选到、运行时取不到值」。
 */
describe("AssetApi.listAttributes", () => {
  it("不带 keys 请求全量（路径里没有 key=）", async () => {
    const paths: string[] = [];
    const client = fakeClient((path) => {
      paths.push(path);
      if (path.includes("SERVER_SCOPE")) return [{ key: "onlineRate", value: 95, lastUpdatedTs: 1 }];
      return [];
    });
    const rows = await new AssetApi(client).listAttributes("a-1");

    expect(rows.map((r) => r.key)).toEqual(["onlineRate"]);
    expect(paths.every((p) => !p.includes("key="))).toBe(true);
  });

  it("SERVER 与 SHARED 合并，先到先得（与 getAttributes 同口径）", async () => {
    const client = fakeClient((path) => {
      if (path.includes("SERVER_SCOPE")) return [{ key: "k", value: "server", lastUpdatedTs: 1 }];
      if (path.includes("SHARED_SCOPE")) return [{ key: "k", value: "shared", lastUpdatedTs: 2 }];
      return [];
    });
    const rows = await new AssetApi(client).listAttributes("a-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("server");
  });

  it("结果按 key 排序（下拉顺序稳定，不随接口返回顺序跳动）", async () => {
    const client = fakeClient((path) => {
      if (path.includes("SERVER_SCOPE")) {
        return [
          { key: "zeta", value: 1, lastUpdatedTs: 1 },
          { key: "alpha", value: 2, lastUpdatedTs: 1 },
        ];
      }
      return [];
    });
    const rows = await new AssetApi(client).listAttributes("a-1");
    expect(rows.map((r) => r.key)).toEqual(["alpha", "zeta"]);
  });

  it("两个 scope 都空时兜一次全量", async () => {
    const paths: string[] = [];
    const client = fakeClient((path) => {
      paths.push(path);
      if (path.endsWith("/values/attributes")) return [{ key: "fallback", value: 1, lastUpdatedTs: 1 }];
      return [];
    });
    const rows = await new AssetApi(client).listAttributes("a-1");
    expect(rows.map((r) => r.key)).toEqual(["fallback"]);
  });

  it("指定 scope 时只发一次请求", async () => {
    const paths: string[] = [];
    const client = fakeClient((path) => {
      paths.push(path);
      return [{ key: "k", value: 1, lastUpdatedTs: 1 }];
    });
    await new AssetApi(client).listAttributes("a-1", "SHARED_SCOPE");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain("/values/attributes/SHARED_SCOPE");
  });

  it("403 → forbidden（下拉要能说「没权限」而不是空列表）", async () => {
    const client = fakeClient(() => {
      throw new GuardHttpError("forbidden", 403);
    });
    await expect(new AssetApi(client).listAttributes("a-1")).rejects.toMatchObject({ kind: "forbidden" });
  });
});

/**
 * 时间戳字段名（2026-11-23 实测踩到）。
 *
 * 平台 `values/attributes` 实际返回的是 **lastUpdateTs**（无 d），
 * 解析器原来只认 lastUpdatedTs —— 结果所有属性时间戳恒为 0，
 * 「更新于 X 前」永远不显示、过期判断永远不触发。
 * 这类 bug 不报错，只是安静地少一个功能。
 */
describe("parseAssetAttributes / 时间戳字段名", () => {
  it("认 lastUpdateTs（平台实际字段名）", () => {
    const rows = parseAssetAttributes([
      { lastUpdateTs: 1795370197918, key: "model", value: "30RQ750VHS" },
    ]);
    expect(rows[0]?.lastUpdatedTs).toBe(1795370197918);
  });

  it("也认 lastUpdatedTs 与 ts（兼容旧回包）", () => {
    expect(parseAssetAttributes([{ lastUpdatedTs: 111, key: "a", value: 1 }])[0]?.lastUpdatedTs).toBe(111);
    expect(parseAssetAttributes([{ ts: 222, key: "b", value: 1 }])[0]?.lastUpdatedTs).toBe(222);
  });

  it("内层 {value, ts} 优先于外层", () => {
    const rows = parseAssetAttributes([
      { lastUpdateTs: 111, key: "c", value: { value: 5, ts: 999 } },
    ]);
    expect(rows[0]?.lastUpdatedTs).toBe(999);
  });

  it("全都没有时给 0（读侧据此不判过期）", () => {
    expect(parseAssetAttributes([{ key: "d", value: 1 }])[0]?.lastUpdatedTs).toBe(0);
  });
});
