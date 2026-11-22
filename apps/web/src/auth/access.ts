import type { SessionRole } from "@idt/data-adapter";
import { routes } from "../constants/routes";
import { resolveTenantCustomerId, usableCustomerId } from "./customer-scope";

export interface AccessInput {
  pathname: string;
  connected: boolean;
  role: SessionRole;
  customerId?: string;
}

export interface AccessDecision {
  type: "allow" | "redirect" | "block";
  to?: string;
}

export function homePath(role: SessionRole, customerId?: string, storage?: Storage | null): string {
  if (role === "customer") return routes.runtime;
  if (role === "tenant") {
    return customerScopePath(customerId, storage);
  }
  return routes.login;
}

/** Logo / 品牌回选客户，不落到刚才在管的客户场景列表，也不链到无名客户。客户账号仍回运行态。 */
export function brandPath(role: SessionRole): string {
  if (role === "tenant") return routes.selectCustomer;
  if (role === "customer") return routes.runtime;
  return routes.login;
}

/** 租户回到当前客户的场景管理；空/公共客户和未选择时回到选客户，或回到刚才明确选过的真实客户。 */
export function customerScopePath(customerId?: string, storage?: Storage | null): string {
  const id = resolveTenantCustomerId(customerId, storage);
  return id ? routes.customerScenes(id) : routes.selectCustomer;
}

export function postLoginPath(authority: string | undefined, customerId?: string, storage?: Storage | null): string {
  if (authority === "CUSTOMER_USER") return routes.runtime;
  if (authority === "TENANT_ADMIN") return customerScopePath(usableCustomerId(customerId), storage);
  return routes.login;
}

function matches(pathname: string, pattern: string): boolean {
  if (pathname === pattern) return true;
  const source = pattern
    .split("/")
    .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}$`).test(pathname);
}

export function isManagementPath(pathname: string): boolean {
  return (
    pathname === routes.selectCustomer ||
    matches(pathname, "/customers/:customerId/scenes") ||
    pathname === routes.studioScenes ||
    matches(pathname, "/studio/editor/:sceneId")
  );
}

export function resolveAccess(input: AccessInput): AccessDecision {
  const path = input.pathname || "/";
  if (path === routes.login) {
    if (input.connected) return { type: "redirect", to: homePath(input.role, input.customerId) };
    return { type: "allow" };
  }
  if (!input.connected || input.role === "anonymous") {
    return { type: "redirect", to: routes.login };
  }
  if (input.role === "customer" && isManagementPath(path)) {
    return { type: "block" };
  }
  if (input.role === "tenant" && path === routes.runtime) {
    return { type: "redirect", to: homePath("tenant", input.customerId) };
  }
  if (path === routes.root) {
    return { type: "redirect", to: homePath(input.role, input.customerId) };
  }
  return { type: "allow" };
}

export const CUSTOMER_HIDDEN_ENTRIES = [
  "场景管理",
  "编辑",
  "指定默认",
  "新建场景",
  "小部件拖拽",
  "绑定配置",
] as const;

export interface WorkbenchChrome {
  showSceneManagement: boolean;
  showEdit: boolean;
  showSetDefault: boolean;
  showCreateScene: boolean;
  showBindingPanel: boolean;
  showWidgetDrag: boolean;
  showDemoTelemetryToggle: boolean;
  showReturnToStudio: boolean;
  /** 仅租户可见小部件「未落库 / 本地草稿」标；客户运行态必须为 false。 */
  showWidgetDraftMark: boolean;
  showPlatformSettings: boolean;
  showJumpConfig: boolean;
  showLogout: boolean;
  showThemeToggle: boolean;
}

export function workbenchChrome(role: SessionRole): WorkbenchChrome {
  const tenant = role === "tenant";
  return {
    showSceneManagement: tenant,
    showEdit: tenant,
    showSetDefault: tenant,
    showCreateScene: tenant,
    showBindingPanel: tenant,
    showWidgetDrag: tenant,
    showDemoTelemetryToggle: tenant,
    showReturnToStudio: tenant,
    showWidgetDraftMark: tenant,
    showPlatformSettings: tenant,
    showJumpConfig: tenant,
    showLogout: true,
    showThemeToggle: true,
  };
}

/** 客户永远看不到小部件草稿标。即使误传 showDraftMark，也不展示。 */
export function shouldShowWidgetDraftMark(input: {
  role?: SessionRole;
  showDraftMark?: boolean;
  widgetsSource?: "platform" | "local-draft" | "empty";
  widgetCount: number;
}): boolean {
  if (input.role === "customer") return false;
  return Boolean(input.showDraftMark) && input.widgetsSource === "local-draft" && input.widgetCount > 0;
}
