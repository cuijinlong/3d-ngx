import { describe, expect, it } from "vitest";
import { GuardHttpError } from "@idt/data-adapter";
import { loginFailureMessage, loginMissingMessage } from "./login-card-message";

describe("login card messages", () => {
  it("asks for the missing field in Chinese inside the card", () => {
    expect(loginMissingMessage("", "x")).toBe("请填写账号");
    expect(loginMissingMessage("   ", "x")).toBe("请填写账号");
    expect(loginMissingMessage("admin", "")).toBe("请填写密码");
    expect(loginMissingMessage("admin", "secret")).toBeNull();
  });

  it("maps auth failures to 账号或密码不正确 and never echoes a password or English stack", () => {
    expect(loginFailureMessage(new GuardHttpError("Authentication failed", 401))).toBe("账号或密码不正确");
    expect(loginFailureMessage(new GuardHttpError("forbidden", 403))).toBe("账号或密码不正确");
    expect(loginFailureMessage(new Error("Unauthorized"))).toBe("账号或密码不正确");
    const text = loginFailureMessage(new Error("Authentication failed for password=super-secret"));
    expect(text).toBe("账号或密码不正确");
    expect(text).not.toContain("super-secret");
    expect(text).not.toMatch(/Authentication failed|Hey developer|Unexpected/i);
  });

  it("uses Chinese when the service cannot be reached", () => {
    expect(loginFailureMessage(new GuardHttpError("Bad Gateway", 502))).toBe("暂时连不上服务，请稍后重试");
    expect(loginFailureMessage(new Error("Failed to fetch"))).toBe("暂时连不上服务，请稍后重试");
  });
});
