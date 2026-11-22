/**
 * 平台登录会话的存储约定：
 * - 密码和访问令牌不得写入任何持久存储
 * - 刷新令牌最多放入 sessionStorage
 * - localStorage 的 idt-3d-ngx-guard 只保留 apiBase / username
 */

import type { GuardConnectionSettings } from "@idt/shared-types";

export const GUARD_SETTINGS_KEY = "idt-3d-ngx-guard";
export const GUARD_REFRESH_KEY = "idt-3d-ngx-guard-refresh";

export const PLATFORM_CONNECTION_FAILED_MESSAGE =
  "平台连接已失效，请重新登录。当前没有使用演示数据。";

export interface GuardProfile {
  apiBase: string;
  username: string;
}

export interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sanitizeGuardProfile(raw: unknown): GuardProfile | null {
  const row = asRecord(raw);
  if (!row) return null;
  const apiBase = typeof row.apiBase === "string" && row.apiBase.trim() ? row.apiBase.trim() : "/api";
  const username = typeof row.username === "string" ? row.username.trim() : "";
  if (!username) return null;
  return { apiBase, username };
}

export function persistedGuardHasSecrets(raw: unknown): boolean {
  const row = asRecord(raw);
  if (!row) return false;
  return Boolean(row.password || row.token || row.refreshToken);
}

export function readStorageJson(storage: MemoryStorage | null, key: string): unknown {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function persistGuardProfile(profile: GuardProfile, storage: MemoryStorage | null): void {
  if (!storage) return;
  storage.setItem(
    GUARD_SETTINGS_KEY,
    JSON.stringify({ apiBase: profile.apiBase || "/api", username: profile.username }),
  );
}

export function loadGuardProfile(storage: MemoryStorage | null): GuardProfile | null {
  return sanitizeGuardProfile(readStorageJson(storage, GUARD_SETTINGS_KEY));
}

export function writeRefreshToken(token: string | undefined, storage: MemoryStorage | null): void {
  if (!storage) return;
  const value = token?.trim();
  if (!value) {
    storage.removeItem(GUARD_REFRESH_KEY);
    return;
  }
  storage.setItem(GUARD_REFRESH_KEY, value);
}

export function loadRefreshToken(storage: MemoryStorage | null): string | undefined {
  if (!storage) return undefined;
  try {
    const value = storage.getItem(GUARD_REFRESH_KEY)?.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function clearRefreshToken(storage: MemoryStorage | null): void {
  storage?.removeItem(GUARD_REFRESH_KEY);
}

export interface AdoptedGuardSession {
  profile: GuardProfile | null;
  accessToken?: string;
  refreshToken?: string;
  scrubbedSecrets: boolean;
}

/**
 * 读取并收口历史落盘：把误存在 localStorage 里的刷新令牌迁到 sessionStorage，
 * 访问令牌只带回内存，密码和双令牌从 localStorage 删掉。
 */
export function adoptGuardSession(
  local: MemoryStorage | null,
  session: MemoryStorage | null,
): AdoptedGuardSession {
  const raw = readStorageJson(local, GUARD_SETTINGS_KEY);
  const row = asRecord(raw);
  const profile = sanitizeGuardProfile(raw);
  const accessToken = typeof row?.token === "string" && row.token.trim() ? row.token.trim() : undefined;
  const storedRefresh =
    typeof row?.refreshToken === "string" && row.refreshToken.trim() ? row.refreshToken.trim() : undefined;
  const sessionRefresh = loadRefreshToken(session);
  const refreshToken = sessionRefresh || storedRefresh;
  const scrubbedSecrets = persistedGuardHasSecrets(raw);

  if (profile) persistGuardProfile(profile, local);
  else local?.removeItem(GUARD_SETTINGS_KEY);

  if (refreshToken) writeRefreshToken(refreshToken, session);
  else clearRefreshToken(session);

  return { profile, accessToken, refreshToken, scrubbedSecrets };
}

export function browserLocalStorage(): MemoryStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function browserSessionStorage(): MemoryStorage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** 给设置页预填用：只回 apiBase / username，不含密码和令牌。 */
export function toPublicGuardSettings(profile: GuardProfile | null): GuardConnectionSettings | null {
  if (!profile) return null;
  return { apiBase: profile.apiBase, username: profile.username };
}
