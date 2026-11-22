import { describe, expect, it } from "vitest";
import { formatPlatformDeviceName } from "./device-display";

describe("formatPlatformDeviceName", () => {
  it("prefers label over technical name and id", () => {
    expect(
      formatPlatformDeviceName({
        id: "dev-1",
        name: "tj-module-09",
        label: "模块机 9#",
        deviceName: "tj-module-09",
      }),
    ).toBe("模块机 9#");
  });

  it("falls back to name, then saved deviceName, then id", () => {
    expect(formatPlatformDeviceName({ name: "tj-module-09", id: "dev-1" })).toBe("tj-module-09");
    expect(formatPlatformDeviceName({ deviceName: "已保存的名称", id: "dev-1" })).toBe("已保存的名称");
    expect(formatPlatformDeviceName({ id: "dev-1" })).toBe("dev-1");
    expect(formatPlatformDeviceName({})).toBe("");
    expect(formatPlatformDeviceName(null)).toBe("");
    expect(formatPlatformDeviceName({ label: "  ", name: "  ", deviceName: " 泵 1  " })).toBe("泵 1");
  });
});
