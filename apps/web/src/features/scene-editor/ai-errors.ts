/**
 * AI 请求失败时给用户看什么。
 *
 * <h2>为什么要单独一个函数</h2>
 *
 * <p>原来的实现把所有非 2xx 都报成
 * 「后端未接通（HTTP 401）。需要平台实现 /api/ngx/ai/chat」——
 * 那是**后端还没实现这个路由时**的假设。现在后端实现了，
 * 401 / 403 / 503 都是有明确含义的业务错误，还这么报就变成**指错方向**：
 *
 * <ul>
 *   <li>401 → 用户该去重新登录，不该去「提需求让平台实现路由」；</li>
 *   <li>403 → 用户该换租户账号，或找管理员开权限；</li>
 *   <li>503 → 用户该找运维看平台是不是挂了。</li>
 * </ul>
 *
 * <h2>优先用服务端给的文案</h2>
 *
 * <p>桥接在失败时会在 body 里放 `{"error":"…"}`，那几句是照着
 * 「用户下一步该做什么」写的（见 ai-bridge/server.js 的 `verifyCaller`）。
 * 前端再自己编一套，两边迟早说法不一致 —— 所以能读到就用它的。
 */
export function describeAiFailure(status: number, serverError?: string): string {
  const detail = (serverError ?? "").trim();
  if (detail) return detail;
  /*
   * 没有 body 文案时才按状态码兜底。
   * 404 单独留着旧的提示：它确实最常意味着「路由没实现」，
   * 这时把契约写给用户是有用的。
   */
  if (status === 404) {
    return "后端未接通（HTTP 404）。需要平台实现 /api/ngx/ai/chat，"
      + "契约见 src/features/scene-editor/AiBuildPanel.tsx 顶部注释。";
  }
  if (status === 401) return "登录已失效（HTTP 401）。请重新登录后再试。";
  if (status === 403) return "当前账号没有使用 AI 搭建的权限（HTTP 403）。";
  if (status === 503) return "AI 服务暂时不可用（HTTP 503）。可能是平台未就绪。";
  return `AI 服务返回 HTTP ${status}。`;
}
