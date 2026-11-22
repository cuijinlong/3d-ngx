import { describe, expect, it } from "vitest";
import { routes } from "../constants/routes";
import {
  CUSTOMER_HIDDEN_ENTRIES,
  brandPath,
  customerScopePath,
  homePath,
  postLoginPath,
  resolveAccess,
  workbenchChrome,
} from "./access";
import { PLATFORM_NULL_CUSTOMER_ID, LAST_CUSTOMER_STORAGE_KEY } from "./customer-scope";

describe("login split and route access", () => {
  it("sends tenants to the customer picker and customers to /runtime after login", () => {
    expect(postLoginPath("TENANT_ADMIN")).toBe(routes.selectCustomer);
    expect(postLoginPath("TENANT_ADMIN", "cust-1")).toBe(routes.customerScenes("cust-1"));
    expect(postLoginPath("CUSTOMER_USER")).toBe(routes.runtime);
    expect(homePath("tenant")).toBe(routes.selectCustomer);
    expect(homePath("customer")).toBe(routes.runtime);
    expect(homePath("anonymous")).toBe(routes.login);
    expect(customerScopePath()).toBe(routes.selectCustomer);
    expect(customerScopePath("cust-1")).toBe(routes.customerScenes("cust-1"));
  });

  it("ignores the platform null customer and returns to the last real customer when one was chosen", () => {
    const memory: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => memory[key] ?? null,
      setItem: (key: string, value: string) => { memory[key] = value; },
      removeItem: (key: string) => { delete memory[key]; },
      clear: () => { for (const key of Object.keys(memory)) delete memory[key]; },
      key: (index: number) => Object.keys(memory)[index] ?? null,
      get length() { return Object.keys(memory).length; },
    } as Storage;

    expect(postLoginPath("TENANT_ADMIN", PLATFORM_NULL_CUSTOMER_ID, storage)).toBe(routes.selectCustomer);
    expect(homePath("tenant", PLATFORM_NULL_CUSTOMER_ID, storage)).toBe(routes.selectCustomer);
    expect(customerScopePath(PLATFORM_NULL_CUSTOMER_ID, storage)).toBe(routes.selectCustomer);

    memory[LAST_CUSTOMER_STORAGE_KEY] = "cust-demo";
    expect(postLoginPath("TENANT_ADMIN", PLATFORM_NULL_CUSTOMER_ID, storage)).toBe(routes.customerScenes("cust-demo"));
    expect(homePath("tenant", PLATFORM_NULL_CUSTOMER_ID, storage)).toBe(routes.customerScenes("cust-demo"));
    expect(customerScopePath(undefined, storage)).toBe(routes.customerScenes("cust-demo"));
    expect(customerScopePath(PLATFORM_NULL_CUSTOMER_ID, storage)).toBe(routes.customerScenes("cust-demo"));
  });

  it("sends unauthenticated visits of protected pages to /login", () => {
    expect(resolveAccess({ pathname: routes.studioScenes, connected: false, role: "anonymous" })).toEqual({
      type: "redirect",
      to: routes.login,
    });
    expect(resolveAccess({ pathname: routes.settings, connected: false, role: "anonymous" })).toEqual({
      type: "redirect",
      to: routes.login,
    });
    expect(resolveAccess({ pathname: routes.runtime, connected: false, role: "anonymous" })).toEqual({
      type: "redirect",
      to: routes.login,
    });
    expect(resolveAccess({ pathname: routes.login, connected: false, role: "anonymous" })).toEqual({
      type: "allow",
    });
  });

  it("does not let a customer open management by changing the address", () => {
    const customer = { connected: true as const, role: "customer" as const };
    expect(resolveAccess({ ...customer, pathname: routes.customerScenes("cust-1") })).toEqual({
      type: "block",
    });
    expect(resolveAccess({ ...customer, pathname: routes.selectCustomer })).toEqual({
      type: "block",
    });
    expect(resolveAccess({ ...customer, pathname: routes.studioScenes })).toEqual({
      type: "block",
    });
    expect(resolveAccess({ ...customer, pathname: routes.studioEditor("scene-1") })).toEqual({
      type: "block",
    });
    expect(resolveAccess({ ...customer, pathname: routes.settings })).toEqual({ type: "allow" });
    expect(resolveAccess({ ...customer, pathname: routes.runtime })).toEqual({ type: "allow" });
    expect(resolveAccess({ ...customer, pathname: routes.twinRuntime("scene-1") })).toEqual({ type: "allow" });
  });

  it("hides management entries from the customer chrome", () => {
    expect([...CUSTOMER_HIDDEN_ENTRIES]).toEqual([
      "场景管理",
      "编辑",
      "指定默认",
      "新建场景",
      "小部件拖拽",
      "绑定配置",
    ]);
    const customer = workbenchChrome("customer");
    expect(customer.showSceneManagement).toBe(false);
    expect(customer.showEdit).toBe(false);
    expect(customer.showSetDefault).toBe(false);
    expect(customer.showCreateScene).toBe(false);
    expect(customer.showBindingPanel).toBe(false);
    expect(customer.showWidgetDrag).toBe(false);
    expect(customer.showDemoTelemetryToggle).toBe(false);
    expect(customer.showReturnToStudio).toBe(false);
    expect(customer.showPlatformSettings).toBe(false);
    expect(customer.showJumpConfig).toBe(false);
    expect(customer.showLogout).toBe(true);
    expect(customer.showThemeToggle).toBe(true);
    expect(workbenchChrome("tenant").showEdit).toBe(true);
    expect(workbenchChrome("tenant").showPlatformSettings).toBe(true);
    expect(workbenchChrome("tenant").showJumpConfig).toBe(true);
  });

  it("sends the brand back to select-customer for tenants, not the last customer scene list", () => {
    expect(brandPath("tenant")).toBe(routes.selectCustomer);
    expect(brandPath("customer")).toBe(routes.runtime);
    expect(brandPath("anonymous")).toBe(routes.login);
    expect(brandPath("tenant")).not.toContain(PLATFORM_NULL_CUSTOMER_ID);
  });
});
