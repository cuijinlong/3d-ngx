import { beforeEach, describe, expect, it } from "vitest";
import {
  adoptGuardSession,
  GUARD_REFRESH_KEY,
  GUARD_SETTINGS_KEY,
  loadGuardProfile,
  loadRefreshToken,
  persistGuardProfile,
  persistedGuardHasSecrets,
  sanitizeGuardProfile,
  writeRefreshToken,
} from "./guard-session";

function memoryStorage(init?: Record<string, string>) {
  const map = new Map<string, string>(Object.entries(init ?? {}));
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

describe("sanitizeGuardProfile", () => {
  it("keeps only apiBase and username", () => {
    expect(
      sanitizeGuardProfile({
        apiBase: "/api",
        username: "tenant@example.com",
        password: "should-not-leak",
        token: "access",
        refreshToken: "refresh",
      }),
    ).toEqual({ apiBase: "/api", username: "tenant@example.com" });
  });

  it("returns null without a username", () => {
    expect(sanitizeGuardProfile({ apiBase: "/api", password: "x" })).toBeNull();
  });
});

describe("persistedGuardHasSecrets", () => {
  it("detects password or tokens in a stored blob", () => {
    expect(persistedGuardHasSecrets({ username: "a", password: "p" })).toBe(true);
    expect(persistedGuardHasSecrets({ username: "a", token: "t" })).toBe(true);
    expect(persistedGuardHasSecrets({ username: "a", refreshToken: "r" })).toBe(true);
    expect(persistedGuardHasSecrets({ username: "a", apiBase: "/api" })).toBe(false);
  });
});

describe("adoptGuardSession", () => {
  let local: ReturnType<typeof memoryStorage>;
  let session: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    local = memoryStorage();
    session = memoryStorage();
  });

  it("migrates refresh token to sessionStorage and scrubs localStorage", () => {
    local.setItem(
      GUARD_SETTINGS_KEY,
      JSON.stringify({
        apiBase: "/api",
        username: "tenant@example.com",
        password: "should-not-remain",
        token: "legacy-access",
        refreshToken: "legacy-refresh",
      }),
    );

    const adopted = adoptGuardSession(local, session);

    expect(adopted.profile).toEqual({ apiBase: "/api", username: "tenant@example.com" });
    expect(adopted.accessToken).toBe("legacy-access");
    expect(adopted.refreshToken).toBe("legacy-refresh");
    expect(adopted.scrubbedSecrets).toBe(true);
    expect(loadRefreshToken(session)).toBe("legacy-refresh");
    expect(JSON.parse(local.getItem(GUARD_SETTINGS_KEY)!)).toEqual({
      apiBase: "/api",
      username: "tenant@example.com",
    });
    expect(local.getItem(GUARD_SETTINGS_KEY)).not.toContain("should-not-remain");
    expect(local.getItem(GUARD_SETTINGS_KEY)).not.toContain("legacy-access");
    expect(local.getItem(GUARD_SETTINGS_KEY)).not.toContain("legacy-refresh");
    expect(session.getItem(GUARD_REFRESH_KEY)).toBe("legacy-refresh");
  });

  it("prefers an existing session refresh token over a leftover local one", () => {
    local.setItem(
      GUARD_SETTINGS_KEY,
      JSON.stringify({ username: "tenant@example.com", refreshToken: "old-local" }),
    );
    writeRefreshToken("session-refresh", session);
    const adopted = adoptGuardSession(local, session);
    expect(adopted.refreshToken).toBe("session-refresh");
    expect(loadRefreshToken(session)).toBe("session-refresh");
  });

  it("persistGuardProfile never writes secrets", () => {
    persistGuardProfile({ apiBase: "/api", username: "a" }, local);
    const saved = JSON.parse(local.getItem(GUARD_SETTINGS_KEY)!);
    expect(saved).toEqual({ apiBase: "/api", username: "a" });
    expect(Object.keys(saved).sort()).toEqual(["apiBase", "username"]);
    expect(loadGuardProfile(local)).toEqual({ apiBase: "/api", username: "a" });
  });
});
