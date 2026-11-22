/** guard-server / ThingsBoard 风格 HTTP 客户端。密码与令牌不写进源码，也不在此模块落盘。 */

export interface GuardAuthState {
  apiBase: string;
  username: string;
  password?: string;
  token?: string;
  refreshToken?: string;
  authority?: string;
  customerId?: string;
}

export class GuardHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

function joinUrl(apiBase: string, path: string): string {
  const base = apiBase.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!base) return p;
  if (p.startsWith("/api") && base.endsWith("/api")) return base + p.slice(4);
  return base + p;
}

export class GuardClient {
  private state: GuardAuthState;
  private refreshing: Promise<void> | null = null;

  constructor(state: GuardAuthState) {
    this.state = { ...state, apiBase: state.apiBase || "/api" };
    // 密码只用于当次显式登录，不留在客户端状态里做静默重登。
    delete this.state.password;
  }

  getState(): GuardAuthState {
    const copy = { ...this.state };
    delete copy.password;
    return copy;
  }

  applyAuthUser(user: {
    email?: string;
    authority?: string;
    customerId?: { id?: string } | string;
  }): void {
    this.state.authority = user.authority;
    const cid = user.customerId;
    this.state.customerId = typeof cid === "string" ? cid : cid?.id;
    if (user.email) this.state.username = user.email;
  }

  clearSecrets(): void {
    delete this.state.token;
    delete this.state.refreshToken;
    delete this.state.password;
  }

  async login(username: string, password: string): Promise<void> {
    this.state.username = username;
    delete this.state.password;
    const data = await this.requestJson<{ token: string; refreshToken: string }>(
      "POST",
      "/api/auth/login",
      { username, password },
      { auth: false },
    );
    this.state.token = data.token;
    this.state.refreshToken = data.refreshToken;
    const user = await this.requestJson<{
      email?: string;
      authority?: string;
      customerId?: { id?: string } | string;
    }>("GET", "/api/auth/user");
    this.applyAuthUser(user);
  }

  /** 用刷新令牌换新的访问令牌。失败时清空票据并抛错，不会用密码静默重登。 */
  async refreshSession(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!this.state.refreshToken) {
        this.clearSecrets();
        throw new GuardHttpError("登录已过期，请重新连接后端", 401);
      }
      try {
        const data = await this.requestJson<{ token: string; refreshToken: string }>(
          "POST",
          "/api/auth/token",
          { refreshToken: this.state.refreshToken },
          { auth: false },
        );
        this.state.token = data.token;
        this.state.refreshToken = data.refreshToken;
      } catch (error) {
        this.clearSecrets();
        if (error instanceof GuardHttpError) throw error;
        throw new GuardHttpError("登录已过期，请重新连接后端", 401);
      }
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  /** 带仍有效的访问票调用平台登出。只退当前 3D-NGX 会话。 */
  async logout(): Promise<void> {
    if (!this.state.token) {
      this.clearSecrets();
      return;
    }
    try {
      await this.requestJson("POST", "/api/auth/logout", undefined, { auth: true });
    } finally {
      this.clearSecrets();
    }
  }

  async requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { auth?: boolean },
  ): Promise<T> {
    const res = await this.request(method, path, body, options);
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      return undefined as T;
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options?: { auth?: boolean },
  ): Promise<Response> {
    const doFetch = async (token?: string) => {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (options?.auth !== false && token) headers["X-Authorization"] = `Bearer ${token}`;
      return fetch(joinUrl(this.state.apiBase, path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    };

    let res = await doFetch(this.state.token);
    if (res.status === 401 && options?.auth !== false) {
      await this.refreshSession();
      res = await doFetch(this.state.token);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `请求失败 ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        if (text) message = text.slice(0, 180);
      }
      throw new GuardHttpError(message, res.status, text);
    }
    return res;
  }

  /** multipart 上传。不要手动设置 Content-Type，以便浏览器带上 boundary。 */
  async requestForm<T>(path: string, form: FormData): Promise<T> {
    const doFetch = async (token?: string) => {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers["X-Authorization"] = `Bearer ${token}`;
      return fetch(joinUrl(this.state.apiBase, path), { method: "POST", headers, body: form });
    };
    let res = await doFetch(this.state.token);
    if (res.status === 401) {
      await this.refreshSession();
      res = await doFetch(this.state.token);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = `请求失败 ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        if (text) message = text.slice(0, 180);
      }
      throw new GuardHttpError(message, res.status, text);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async requestBytes(path: string): Promise<{ blob: Blob; contentType: string; fileName?: string }> {
    const doFetch = async (token?: string) => {
      const headers: Record<string, string> = { Accept: "*/*" };
      if (token) headers["X-Authorization"] = `Bearer ${token}`;
      return fetch(joinUrl(this.state.apiBase, path), { method: "GET", headers });
    };
    let res = await doFetch(this.state.token);
    if (res.status === 401) {
      await this.refreshSession();
      res = await doFetch(this.state.token);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GuardHttpError(text.slice(0, 180) || `请求失败 ${res.status}`, res.status, text);
    }
    const disposition = res.headers.get("content-disposition") || "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return {
      blob: await res.blob(),
      contentType: res.headers.get("content-type") || "application/octet-stream",
      fileName: match?.[1],
    };
  }
}
