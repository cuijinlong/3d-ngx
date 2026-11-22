import { GuardHttpError } from "@idt/data-adapter";

const WRONG = "账号或密码不正确";
const MISSING_USER = "请填写账号";
const MISSING_PASS = "请填写密码";
const UNREACHABLE = "暂时连不上服务，请稍后重试";

/** 登录缺项和失败只在卡内用中文说，不回显口令，也不把英文开发者提示铺到页面上。 */
export function loginMissingMessage(username: string, password: string): string | null {
  if (!username.trim()) return MISSING_USER;
  if (!password) return MISSING_PASS;
  return null;
}

export function loginFailureMessage(error: unknown): string {
  const status = error instanceof GuardHttpError ? error.status : undefined;
  if (status === 401 || status === 403) return WRONG;
  const raw = error instanceof Error ? error.message : "";
  if (/401|403|unauthorized|authentication failed|invalid credentials|bad credentials|access denied|incorrect password|wrong password/i.test(raw)) {
    return WRONG;
  }
  if (status === 0 || status === 408 || status === 502 || status === 503 || status === 504) return UNREACHABLE;
  if (/network|timeout|failed to fetch|econnrefused|enotfound|连不上|超时/i.test(raw)) return UNREACHABLE;
  if (/[一-鿿]/.test(raw) && !/password|token|stack|Error:/i.test(raw)) {
    return raw;
  }
  return WRONG;
}
