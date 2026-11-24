import { describe, expect, it } from "vitest";
import { describeAiFailure } from "./ai-errors";

/*
 * AI 请求失败的文案（2026-11-24）。
 *
 * <p>原来所有非 2xx 都报「后端未接通，需要平台实现路由」——
 * 那是后端还没实现时的假设。加上身份校验后，这个文案会把人引向
 * 完全错误的方向（401 该去重新登录，不是去提需求）。
 */
describe("describeAiFailure", () => {
  it("★ 服务端给了 error 就用它（那是照着「下一步做什么」写的）", () => {
    expect(describeAiFailure(401, "未授权：缺少平台登录凭据。请先登录 3D-NGX 再使用 AI 搭建。"))
      .toBe("未授权：缺少平台登录凭据。请先登录 3D-NGX 再使用 AI 搭建。");
    expect(describeAiFailure(403, "只有租户管理员可以使用 AI 搭建（当前身份：CUSTOMER_USER）。"))
      .toContain("只有租户管理员");
  });

  it("★ 401 不能再被说成「后端未接通」", () => {
    const text = describeAiFailure(401);
    expect(text).toContain("重新登录");
    expect(text).not.toContain("未接通");
    expect(text).not.toContain("需要平台实现");
  });

  it("403 / 503 各有各的说法", () => {
    expect(describeAiFailure(403)).toContain("权限");
    expect(describeAiFailure(503)).toContain("暂时不可用");
  });

  it("404 仍保留「需要平台实现」——它确实最常意味着路由不存在", () => {
    const text = describeAiFailure(404);
    expect(text).toContain("未接通");
    expect(text).toContain("/api/ngx/ai/chat");
  });

  it("未知状态码给出行内码，不吞掉信息", () => {
    expect(describeAiFailure(500)).toContain("500");
    expect(describeAiFailure(418)).toContain("418");
  });

  it("空白 error 字符串不算「服务端给了说法」", () => {
    expect(describeAiFailure(401, "   ")).toContain("重新登录");
    expect(describeAiFailure(404, "")).toContain("未接通");
  });
});
