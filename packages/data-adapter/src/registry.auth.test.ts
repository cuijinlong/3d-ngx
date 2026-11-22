import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GUARD_REFRESH_KEY,
  GUARD_SETTINGS_KEY,
  PLATFORM_CONNECTION_FAILED_MESSAGE,
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
  };
}

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("connectGuard session storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("window", { dispatchEvent() { return true; } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("persists only the profile and puts the refresh token in sessionStorage", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/auth/login") && init?.method === "POST") {
        return jsonResponse(200, { token: "access-live", refreshToken: "refresh-live" });
      }
      if (path.endsWith("/api/auth/user")) {
        return jsonResponse(200, { email: "tenant@example.com", authority: "TENANT_ADMIN" });
      }
      if (path.includes("/api/tenant/devices")) {
        return jsonResponse(200, { data: [], hasNext: false });
      }
      return jsonResponse(404, { message: path });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { connectGuard, getConnectedGuardClient, getGuardStatus, loadSavedGuardSettings } =
      await import("./registry");

    const status = await connectGuard({
      apiBase: "/api",
      username: "tenant@example.com",
      password: "must-not-persist",
    });
    expect(status.connected).toBe(true);
    expect(getGuardStatus().kind).toBe("guard");

    const localRaw = localStorage.getItem(GUARD_SETTINGS_KEY);
    expect(localRaw).toBeTruthy();
    const saved = JSON.parse(localRaw!);
    expect(saved).toEqual({ apiBase: "/api", username: "tenant@example.com" });
    expect(localRaw).not.toContain("must-not-persist");
    expect(localRaw).not.toContain("access-live");
    expect(localRaw).not.toContain("refresh-live");
    expect(sessionStorage.getItem(GUARD_REFRESH_KEY)).toBe("refresh-live");
    expect(sessionStorage.getItem(GUARD_SETTINGS_KEY)).toBeNull();

    const publicSettings = loadSavedGuardSettings();
    expect(publicSettings).toEqual({ apiBase: "/api", username: "tenant@example.com" });
    expect(publicSettings).not.toHaveProperty("password");
    expect(publicSettings).not.toHaveProperty("token");
    expect(publicSettings).not.toHaveProperty("refreshToken");

    const memory = getConnectedGuardClient()?.getState();
    expect(memory?.token).toBe("access-live");
    expect(memory?.refreshToken).toBe("refresh-live");
    expect(memory?.password).toBeUndefined();
  });

  it("restores with the session refresh token and does not post a password login", async () => {
    localStorage.setItem(GUARD_SETTINGS_KEY, JSON.stringify({ apiBase: "/api", username: "tenant@example.com" }));
    sessionStorage.setItem(GUARD_REFRESH_KEY, "refresh-live");

    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith("/api/auth/token")) {
        return jsonResponse(200, { token: "access-2", refreshToken: "refresh-2" });
      }
      if (path.endsWith("/api/auth/login")) {
        return jsonResponse(200, { token: "should-not-login", refreshToken: "should-not-login" });
      }
      if (path.endsWith("/api/auth/user")) {
        return jsonResponse(200, { email: "tenant@example.com", authority: "TENANT_ADMIN" });
      }
      if (path.includes("/api/tenant/devices")) {
        return jsonResponse(200, { data: [], hasNext: false });
      }
      return jsonResponse(404, { message: path });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { restoreGuardConnection, getConnectedGuardClient } = await import("./registry");
    const status = await restoreGuardConnection();
    expect(status.connected).toBe(true);
    expect(getConnectedGuardClient()?.getState().token).toBe("access-2");
    expect(sessionStorage.getItem(GUARD_REFRESH_KEY)).toBe("refresh-2");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.endsWith("/api/auth/token"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/api/auth/login"))).toBe(false);
  });

  it("does not fall back to mock data when restore fails", async () => {
    localStorage.setItem(
      GUARD_SETTINGS_KEY,
      JSON.stringify({
        apiBase: "/api",
        username: "tenant@example.com",
        password: "legacy-password",
        token: "dead-access",
        refreshToken: "dead-refresh",
      }),
    );

    const fetchMock = vi.fn(async (url: string) => {
      const path = String(url);
      if (path.endsWith("/api/auth/login")) {
        return jsonResponse(200, { token: "should-not-relogin", refreshToken: "should-not-relogin" });
      }
      return jsonResponse(401, { message: "Authentication failed" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const {
      restoreGuardConnection,
      getProviderKind,
      getGuardStatus,
      getDataProvider,
      getConnectedGuardClient,
    } = await import("./registry");

    const status = await restoreGuardConnection();
    expect(status.connected).toBe(false);
    expect(status.kind).toBe("guard");
    expect(status.message).toContain(PLATFORM_CONNECTION_FAILED_MESSAGE);
    expect(status.message).not.toContain("已回退到演示数据");
    expect(getProviderKind()).toBe("guard");
    expect(getGuardStatus().connected).toBe(false);
    expect(getConnectedGuardClient()).toBeNull();
    expect(await getDataProvider().getDevices()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(GUARD_SETTINGS_KEY)!)).toEqual({
      apiBase: "/api",
      username: "tenant@example.com",
    });
    expect(sessionStorage.getItem(GUARD_REFRESH_KEY)).toBeNull();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.endsWith("/api/auth/login"))).toBe(false);
  });

  it("calls logout with the access token and then returns to mock on disconnect", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/api/auth/login")) {
        return jsonResponse(200, { token: "access-live", refreshToken: "refresh-live" });
      }
      if (path.endsWith("/api/auth/user")) {
        return jsonResponse(200, { email: "tenant@example.com", authority: "TENANT_ADMIN" });
      }
      if (path.includes("/api/tenant/devices")) {
        return jsonResponse(200, { data: [], hasNext: false });
      }
      if (path.endsWith("/api/auth/logout")) {
        expect((init?.headers as Record<string, string>)["X-Authorization"]).toBe("Bearer access-live");
        return jsonResponse(200, {});
      }
      return jsonResponse(404, { message: path });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { connectGuard, disconnectGuard, getGuardStatus, getProviderKind, getConnectedGuardClient } =
      await import("./registry");
    await connectGuard({ apiBase: "/api", username: "tenant@example.com", password: "must-not-persist" });
    await disconnectGuard();

    expect(getProviderKind()).toBe("mock");
    expect(getGuardStatus().connected).toBe(false);
    expect(getConnectedGuardClient()).toBeNull();
    expect(sessionStorage.getItem(GUARD_REFRESH_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(GUARD_SETTINGS_KEY)!)).toEqual({
      apiBase: "/api",
      username: "tenant@example.com",
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/api/auth/logout"))).toBe(true);
  });
});
