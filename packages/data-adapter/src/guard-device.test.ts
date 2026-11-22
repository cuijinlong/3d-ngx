import { describe, expect, it } from "vitest";
import { toGuardDevice } from "./guard-device";
import { formatPlatformDeviceName } from "./device-display";

describe("toGuardDevice", () => {
  it("keeps the technical name and a separate label", () => {
    const device = toGuardDevice({
      id: { id: "dev-9", entityType: "DEVICE" },
      name: "tj-module-09",
      label: "模块机 9#",
      type: "模块机",
      createdTime: 0,
    });
    expect(device.id).toBe("dev-9");
    expect(device.name).toBe("tj-module-09");
    expect(device.label).toBe("模块机 9#");
    expect(formatPlatformDeviceName(device)).toBe("模块机 9#");
  });

  it("does not fold label into name when the technical name is missing", () => {
    const device = toGuardDevice({
      id: "dev-2",
      label: "立式管道离心泵 2",
    });
    expect(device.name).toBe("dev-2");
    expect(device.label).toBe("立式管道离心泵 2");
    expect(formatPlatformDeviceName(device)).toBe("立式管道离心泵 2");
  });

  it("omits empty label and falls back to name or id", () => {
    const named = toGuardDevice({ id: "dev-3", name: "tj-pump-2", label: "  " });
    expect(named.label).toBeUndefined();
    expect(formatPlatformDeviceName(named)).toBe("tj-pump-2");

    const bare = toGuardDevice({ id: { id: "dev-4" } });
    expect(bare.name).toBe("dev-4");
    expect(bare.label).toBeUndefined();
    expect(formatPlatformDeviceName(bare)).toBe("dev-4");
  });
});
