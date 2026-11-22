import { describe, expect, it } from "vitest";
import { APP_ERROR_BODY, APP_ERROR_TITLE, LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "./load-timeout";

describe("load timeout and unexpected error copy", () => {
  it("uses the 15 second threshold and the exact scheme sentences", () => {
    expect(LOAD_TIMEOUT_MS).toBe(15_000);
    expect(LOAD_TIMEOUT_MESSAGE).toBe("加载时间有点长，请刷新或返回。");
    expect(APP_ERROR_TITLE).toBe("页面出了点问题");
    expect(APP_ERROR_BODY).toBe("发生错误，请刷新后再试。");
  });
});
