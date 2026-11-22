import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardClient, GuardHttpError } from "./guard-client";

type FetchCall = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

function jsonResponse(status: number, body?: unknown, headers?: Record<string, string>) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function parseCalls(mock: ReturnType<typeof vi.fn>): FetchCall[] {
  return mock.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep raw */
      }
    }
    return {
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body,
    };
  });
}

describe("GuardClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("logs in with username/password, keeps tokens only in memory, and does not retain the password", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/auth/login")) {
        return jsonResponse(200, { token: "access-1", refreshToken: "refresh-1" });
      }
      if (String(url).endsWith("/api/auth/user")) {
        return jsonResponse(200, { email: "tenant@example.com", authority: "TENANT_ADMIN" });
      }
      return jsonResponse(404, { message: "missing" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuardClient({
      apiBase: "/api",
      username: "tenant@example.com",
      password: "should-not-stay",
    });
    expect(client.getState().password).toBeUndefined();

    await client.login("tenant@example.com", "should-not-stay");
    const state = client.getState();
    expect(state.token).toBe("access-1");
    expect(state.refreshToken).toBe("refresh-1");
    expect(state.password).toBeUndefined();
    expect(state.authority).toBe("TENANT_ADMIN");

    const loginCall = parseCalls(fetchMock).find((call) => call.url.endsWith("/api/auth/login"));
    expect(loginCall?.body).toEqual({ username: "tenant@example.com", password: "should-not-stay" });
    const userCall = parseCalls(fetchMock).find((call) => call.url.endsWith("/api/auth/user"));
    expect(userCall?.headers?.["X-Authorization"]).toBe("Bearer access-1");
  });

  it("refreshes with the refresh token and never posts a password login after refresh failure", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/auth/token")) {
        return jsonResponse(401, { message: "refresh expired" });
      }
      if (String(url).endsWith("/api/auth/login")) {
        return jsonResponse(200, { token: "should-not-issue", refreshToken: "should-not-issue" });
      }
      return jsonResponse(500, { message: "unexpected" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuardClient({
      apiBase: "/api",
      username: "tenant@example.com",
      password: "should-not-be-used",
      token: "expired-access",
      refreshToken: "expired-refresh",
    });

    await expect(client.refreshSession()).rejects.toBeInstanceOf(GuardHttpError);
    const state = client.getState();
    expect(state.token).toBeUndefined();
    expect(state.refreshToken).toBeUndefined();
    expect(state.password).toBeUndefined();

    const calls = parseCalls(fetchMock);
    expect(calls.some((call) => call.url.endsWith("/api/auth/login"))).toBe(false);
    expect(calls.filter((call) => call.url.endsWith("/api/auth/token"))).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ refreshToken: "expired-refresh" });
  });

  it("logs out with the current access token using X-Authorization", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/auth/logout")) return jsonResponse(200, {});
      return jsonResponse(404, { message: "missing" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GuardClient({
      apiBase: "/api",
      username: "tenant@example.com",
      token: "access-live",
      refreshToken: "refresh-live",
    });
    await client.logout();
    expect(client.getState().token).toBeUndefined();
    expect(client.getState().refreshToken).toBeUndefined();

    const logoutCall = parseCalls(fetchMock)[0];
    expect(logoutCall?.url).toMatch(/\/api\/auth\/logout$/);
    expect(logoutCall?.method).toBe("POST");
    expect(logoutCall?.headers?.["X-Authorization"]).toBe("Bearer access-live");
    expect(logoutCall?.headers?.Authorization).toBeUndefined();
  });
});
