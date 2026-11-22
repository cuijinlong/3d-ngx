import { GuardHttpError } from "./guard-client";

export const LOCAL_DRAFT_NOTICE = "未落库 / 本地草稿";

export function guardErrorCode(error: unknown): number | undefined {
  if (!(error instanceof GuardHttpError) || !error.body) return undefined;
  try {
    const parsed = JSON.parse(error.body) as { errorCode?: number };
    return typeof parsed.errorCode === "number" ? parsed.errorCode : undefined;
  } catch {
    return undefined;
  }
}

/** 路由尚未夹上：404/405 且不是平台业务错误码。ITEM_NOT_FOUND(32) 等表示接口已存在。 */
export function isSceneStorageUnmounted(error: unknown): boolean {
  if (!(error instanceof GuardHttpError)) return false;
  if (error.status === 401 || error.status === 403 || error.status === 400) return false;
  const code = guardErrorCode(error);
  if (code === 32 || code === 20 || code === 31 || code === 2) return false;
  const body = (error.body || "").toLowerCase();
  if (body.includes("<!doctype") || body.includes("<html")) return true;
  return error.status === 404 || error.status === 405;
}

export function isSceneStorageUnavailable(error: unknown): boolean {
  if (!(error instanceof GuardHttpError)) return true;
  if (isSceneStorageUnmounted(error)) return true;
  return error.status >= 500;
}

/** GET default-scene 空指针：已夹上的接口可能回 404 + ITEM_NOT_FOUND(32)，不要当成读取失败。 */
export function isDefaultSceneEmptyPointer(error: unknown): boolean {
  if (!(error instanceof GuardHttpError)) return false;
  if (error.status !== 404) return false;
  return guardErrorCode(error) === 32;
}
