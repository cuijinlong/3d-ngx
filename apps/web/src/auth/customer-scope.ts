
/** ThingsBoard / 平台用于「未归属客户」的空 UUID，不是一个可管理的真实客户。 */
export const PLATFORM_NULL_CUSTOMER_ID = "13814000-1dd2-11b2-8080-808080808080";

export const LAST_CUSTOMER_STORAGE_KEY = "idt-3d-ngx-last-customer";

export function isUsableCustomerId(id?: string | null): id is string {
  const value = (id ?? "").trim();
  if (!value) return false;
  return value.toLowerCase() !== PLATFORM_NULL_CUSTOMER_ID;
}

export function usableCustomerId(id?: string | null): string | undefined {
  return isUsableCustomerId(id) ? id : undefined;
}

function defaultStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLastCustomerId(storage?: Storage | null): string | undefined {
  try {
    const value = defaultStorage(storage)?.getItem(LAST_CUSTOMER_STORAGE_KEY);
    return usableCustomerId(value);
  } catch {
    return undefined;
  }
}

export function writeLastCustomerId(id: string, storage?: Storage | null): void {
  if (!isUsableCustomerId(id)) return;
  try {
    defaultStorage(storage)?.setItem(LAST_CUSTOMER_STORAGE_KEY, id);
  } catch {
    /* 私密模式写不进也不要打断跳转 */
  }
}

/** 租户票里的空/公共客户不算已选；有刚才明确选过的真实客户时用它。 */
export function resolveTenantCustomerId(sessionCustomerId?: string | null, storage?: Storage | null): string | undefined {
  return usableCustomerId(sessionCustomerId) ?? readLastCustomerId(storage);
}
