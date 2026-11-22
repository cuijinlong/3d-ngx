import { describe, expect, it } from "vitest";
import {
  authorityFromJwt,
  isCustomerUser,
  isTenantAdmin,
  resolvePlatformAuthority,
  sessionRole,
} from "./authority";

function tokenWith(payload: Record<string, unknown>): string {
  const json = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `eyJhbGciOiJub25lIn0.${json}.sig`;
}

describe("platform authority from JWT", () => {
  it("reads TENANT_ADMIN and CUSTOMER_USER from ThingsBoard scopes", () => {
    expect(authorityFromJwt(tokenWith({ scopes: ["TENANT_ADMIN"] }))).toBe("TENANT_ADMIN");
    expect(authorityFromJwt(tokenWith({ scopes: ["CUSTOMER_USER"] }))).toBe("CUSTOMER_USER");
    expect(isTenantAdmin("TENANT_ADMIN")).toBe(true);
    expect(isCustomerUser("CUSTOMER_USER")).toBe(true);
  });

  it("prefers the user.authority already on the session, then the token", () => {
    const token = tokenWith({ scopes: ["CUSTOMER_USER"] });
    expect(resolvePlatformAuthority({ token })).toBe("CUSTOMER_USER");
    expect(resolvePlatformAuthority({ authority: "TENANT_ADMIN", token })).toBe("TENANT_ADMIN");
  });

  it("treats a disconnected session as anonymous even if a stale authority string is present", () => {
    expect(sessionRole("TENANT_ADMIN", false)).toBe("anonymous");
    expect(sessionRole("TENANT_ADMIN", true)).toBe("tenant");
    expect(sessionRole("CUSTOMER_USER", true)).toBe("customer");
  });
});
