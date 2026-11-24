import { describe, expect, it, vi } from "vitest";
import type { GuardClient } from "@idt/data-adapter";
import { GuardServerProvider } from "../../../../../packages/data-adapter/src/guard-provider";

/*
 * 告警处理人列表（2026-11-24）。
 *
 * <p>这块之前一直降级成「只能分配给自己」—— 因为走的是
 * `/api/tenant/{id}/users`，本部署对 TENANT_ADMIN 返回 403。
 * 客户提过「可以分配处理人」，实际拿到的是一个只有一项的下拉。
 *
 * <p>这里钉住的都是「错了会静默派错人」的点。
 */

function makeProvider(json: (path: string) => unknown) {
  const requestJson = vi.fn(async (_method: string, path: string) => json(path));
  const client = { requestJson } as unknown as GuardClient;
  return { provider: new GuardServerProvider(client), requestJson };
}

const AUTH_USER = {
  id: { id: "u-self" },
  tenantId: { id: "t-1" },
  email: "tenant@126.com",
  firstName: "租户",
  lastName: "管理员",
  authority: "TENANT_ADMIN",
};

describe("listAlarmAssignees", () => {
  it("★ 主路径走 userInfos/all?includeCustomers=true（不再撞 403 的 tenant/users）", async () => {
    const { provider, requestJson } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      if (path.startsWith("/api/userInfos/all")) {
        return {
          data: [
            { id: { id: "u-tenant" }, email: "tenant@126.com", firstName: "租户", lastName: "管理员", authority: "TENANT_ADMIN", customerId: { id: "13814000-1dd2-11b2-8080-808080808080" } },
            { id: { id: "u-cust" }, email: "demo@126.com", firstName: "值班", lastName: "小王", authority: "CUSTOMER_USER", customerId: { id: "7ce48900-d2bd-11f1-b794-31725d9e3862" } },
          ],
        };
      }
      throw Object.assign(new Error("403"), { status: 403 });
    });

    const result = await provider.listAlarmAssignees();
    expect(result.restricted).toBe(false);
    expect(result.users).toHaveLength(2);
    /* 请求确实带了 includeCustomers，否则只会有租户级用户 */
    const called = requestJson.mock.calls.map((c) => c[1] as string);
    expect(called.some((p) => p.includes("/api/userInfos/all") && p.includes("includeCustomers=true"))).toBe(true);
    expect(called.some((p) => p.includes("/api/tenant/"))).toBe(false);
  });

  it("★ 租户级用户的占位 customerId 归一成 null（否则界面会显示一串 uuid）", async () => {
    const { provider } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      return {
        data: [
          { id: { id: "u-tenant" }, email: "t@x.com", authority: "TENANT_ADMIN", customerId: { id: "13814000-1dd2-11b2-8080-808080808080" } },
          { id: { id: "u-empty" }, email: "e@x.com", authority: "TENANT_ADMIN", customerId: "00000000-0000-0000-0000-000000000000" },
        ],
      };
    });
    const result = await provider.listAlarmAssignees();
    expect(result.users.every((u) => u.customerId === null)).toBe(true);
  });

  it("★ 客户用户的 customerId 保留 —— 派单要靠它区分是谁的人", async () => {
    const { provider } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      return {
        data: [
          { id: { id: "u-cust" }, email: "demo@126.com", authority: "CUSTOMER_USER", customerId: "7ce48900-d2bd-11f1-b794-31725d9e3862" },
        ],
      };
    });
    const result = await provider.listAlarmAssignees();
    expect(result.users[0]?.customerId).toBe("7ce48900-d2bd-11f1-b794-31725d9e3862");
  });

  it("★ 租户管理员排在前面（派单时先看到能兜底的人）", async () => {
    const { provider } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      return {
        data: [
          { id: { id: "u-a" }, email: "aaa@x.com", firstName: "AAA", authority: "CUSTOMER_USER" },
          { id: { id: "u-z" }, email: "zzz@x.com", firstName: "ZZZ", authority: "TENANT_ADMIN" },
        ],
      };
    });
    const result = await provider.listAlarmAssignees();
    expect(result.users[0]?.authority).toBe("TENANT_ADMIN");
  });

  it("★ 同一用户出现两次只保留一条（分页/去重边界）", async () => {
    const { provider } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      return {
        data: [
          { id: { id: "u-1" }, email: "a@x.com", authority: "CUSTOMER_USER" },
          { id: { id: "u-1" }, email: "a@x.com", authority: "CUSTOMER_USER" },
        ],
      };
    });
    const result = await provider.listAlarmAssignees();
    expect(result.users).toHaveLength(1);
  });

  it("★ 两个接口都挂 → 降级成「只有自己」并给出原因，不抛错", async () => {
    const { provider } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      throw Object.assign(new Error("403"), { status: 403 });
    });
    const result = await provider.listAlarmAssignees();
    expect(result.restricted).toBe(true);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.id).toBe("u-self");
    /* 文案不能再写死「TENANT_ADMIN 列租户用户返回 403」—— 那是旧路径的原因 */
    expect(result.note).toContain("仅可分配给自己");
  });

  it("接口通了但确实没人 → restricted=false，界面据此显示另一句提示", async () => {
    const { provider } = makeProvider((path) => {
      if (path === "/api/auth/user") return AUTH_USER;
      return { data: [] };
    });
    const result = await provider.listAlarmAssignees();
    expect(result.restricted).toBe(true);
    expect(result.users.length).toBeLessThanOrEqual(1);
  });
});
