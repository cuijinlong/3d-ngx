function decodeBase64(value: string): string {
  if (typeof atob === "function") return atob(value);
  return Buffer.from(value, "base64").toString("utf8");
}

export const PLATFORM_AUTHORITY = {
  tenant: "TENANT_ADMIN",
  customer: "CUSTOMER_USER",
} as const;

export type SessionRole = "tenant" | "customer" | "anonymous";

export function decodeJwtPayload(token?: string): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  const payloadPart = parts[1];
  if (!payloadPart) return null;
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = decodeBase64(padded);
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function authorityFromJwt(token?: string): string | undefined {
  const payload = decodeJwtPayload(token);
  if (!payload) return undefined;
  if (typeof payload.authority === "string" && payload.authority) return payload.authority;
  const scopes = payload.scopes;
  if (Array.isArray(scopes)) {
    const first = scopes.find((item): item is string => typeof item === "string" && item.length > 0);
    if (first) return first;
  }
  return undefined;
}

export function resolvePlatformAuthority(state?: {
  authority?: string;
  token?: string;
}): string | undefined {
  if (state?.authority) return state.authority;
  return authorityFromJwt(state?.token);
}

export function isTenantAdmin(authority?: string): boolean {
  return authority === PLATFORM_AUTHORITY.tenant;
}

export function isCustomerUser(authority?: string): boolean {
  return authority === PLATFORM_AUTHORITY.customer;
}

export function sessionRole(authority?: string, connected = false): SessionRole {
  if (!connected) return "anonymous";
  if (isCustomerUser(authority)) return "customer";
  if (isTenantAdmin(authority)) return "tenant";
  return "anonymous";
}
