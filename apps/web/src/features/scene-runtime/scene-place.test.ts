import { describe, it, expect } from "vitest";
import { placeSourceLabel, resolveWeatherPlace, type AddressReader } from "./scene-place";

function readerOf(map: Record<string, string | null>, fail: string[] = []): AddressReader {
  return async (kind, id) => {
    const key = `${kind}:${id}`;
    if (fail.includes(key)) throw new Error("boom");
    return map[key] ?? null;
  };
}

describe("resolveWeatherPlace", () => {
  it("场站有地址就用场站（客户定案：场站优先）", async () => {
    const read = readerOf({
      "asset:site-1": "南京市江宁区",
      "customer:cust-1": "北京市朝阳区",
    });
    expect(await resolveWeatherPlace({ siteId: "site-1", customerId: "cust-1" }, read)).toEqual({
      place: "南京市江宁区",
      source: "site",
    });
  });

  it("场站没填时回落到组织", async () => {
    const read = readerOf({ "customer:cust-1": "北京市朝阳区" });
    expect(await resolveWeatherPlace({ siteId: "site-1", customerId: "cust-1" }, read)).toEqual({
      place: "北京市朝阳区",
      source: "organization",
    });
  });

  it("场站读失败不阻断组织（每一级独立容错）", async () => {
    const read = readerOf({ "customer:cust-1": "北京市朝阳区" }, ["asset:site-1"]);
    expect(await resolveWeatherPlace({ siteId: "site-1", customerId: "cust-1" }, read)).toEqual({
      place: "北京市朝阳区",
      source: "organization",
    });
  });

  it("场站和组织都没有时用场景 weatherSite", async () => {
    const read = readerOf({});
    expect(
      await resolveWeatherPlace({ siteId: "site-1", customerId: "cust-1", scenePlace: "苏州市" }, read),
    ).toEqual({ place: "苏州市", source: "scene" });
  });

  it("全空白返回 null（不猜城市）", async () => {
    const read = readerOf({ "asset:site-1": "   ", "customer:cust-1": "" });
    expect(await resolveWeatherPlace({ siteId: "site-1", customerId: "cust-1", scenePlace: "  " }, read)).toEqual({
      place: null,
      source: null,
    });
  });

  it("地址前后空格被去掉", async () => {
    const read = readerOf({ "asset:site-1": "  南京市江宁区  " });
    const resolved = await resolveWeatherPlace({ siteId: "site-1" }, read);
    expect(resolved.place).toBe("南京市江宁区");
  });

  it("没有 siteId/customerId 时不发请求，直接用场景字段", async () => {
    let called = 0;
    const read: AddressReader = async () => {
      called += 1;
      return null;
    };
    const resolved = await resolveWeatherPlace({ scenePlace: "杭州市" }, read);
    expect(resolved).toEqual({ place: "杭州市", source: "scene" });
    expect(called).toBe(0);
  });
});

describe("placeSourceLabel", () => {
  it("每种来源都有中文说明", () => {
    expect(placeSourceLabel("site")).toContain("场站");
    expect(placeSourceLabel("organization")).toContain("组织");
    expect(placeSourceLabel("scene")).toContain("场景");
    expect(placeSourceLabel(null)).toContain("未配置");
  });
});
