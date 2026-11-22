import { describe, expect, it } from "vitest";
import {
  isRealtimePlatformDevice,
  isVirtualAdditionalInfo,
  isVirtualDeviceVirtualValue,
  isVirtualPlatformDevice,
  readDeviceVirtualFlag,
} from "@idt/data-adapter";

describe("isVirtualDeviceVirtualValue 对齐 MeteringMath.isVirtual", () => {
  it("把 virtual / true / 1 视为虚拟设备", () => {
    expect(isVirtualDeviceVirtualValue("virtual")).toBe(true);
    expect(isVirtualDeviceVirtualValue("VIRTUAL")).toBe(true);
    expect(isVirtualDeviceVirtualValue(" true ")).toBe(true);
    expect(isVirtualDeviceVirtualValue("1")).toBe(true);
    expect(isVirtualDeviceVirtualValue(true)).toBe(true);
    expect(isVirtualDeviceVirtualValue(1)).toBe(true);
  });

  it("把 real / 缺失 / false / 0 视为实时设备", () => {
    expect(isVirtualDeviceVirtualValue("real")).toBe(false);
    expect(isVirtualDeviceVirtualValue("REAL")).toBe(false);
    expect(isVirtualDeviceVirtualValue(undefined)).toBe(false);
    expect(isVirtualDeviceVirtualValue(null)).toBe(false);
    expect(isVirtualDeviceVirtualValue("")).toBe(false);
    expect(isVirtualDeviceVirtualValue(false)).toBe(false);
    expect(isVirtualDeviceVirtualValue(0)).toBe(false);
    expect(isVirtualDeviceVirtualValue("other")).toBe(false);
  });
});

describe("additionalInfo.deviceVirtual", () => {
  it("从对象或 JSON 字符串读取标志，缺失则视为实时", () => {
    expect(readDeviceVirtualFlag({ deviceVirtual: "virtual" })).toBe("virtual");
    expect(readDeviceVirtualFlag('{"deviceVirtual":"virtual"}')).toBe("virtual");
    expect(isVirtualAdditionalInfo({ deviceVirtual: "virtual" })).toBe(true);
    expect(isVirtualAdditionalInfo({ deviceVirtual: "real" })).toBe(false);
    expect(isVirtualAdditionalInfo({})).toBe(false);
    expect(isVirtualAdditionalInfo(undefined)).toBe(false);
    expect(isVirtualAdditionalInfo(null)).toBe(false);
  });
});

describe("isVirtualPlatformDevice", () => {
  it("不把 Mock 演示设备当成平台虚拟设备", () => {
    expect(isVirtualPlatformDevice({ source: "mock", deviceVirtual: "virtual" })).toBe(false);
    expect(isRealtimePlatformDevice({ source: "mock" })).toBe(true);
  });

  it("按标志过滤 guard 设备，存量无属性视为实时", () => {
    expect(isVirtualPlatformDevice({ source: "guard", deviceVirtual: "virtual" })).toBe(true);
    expect(isVirtualPlatformDevice({ source: "guard", additionalInfo: { deviceVirtual: "virtual" } })).toBe(true);
    expect(isVirtualPlatformDevice({ source: "guard" })).toBe(false);
    expect(isRealtimePlatformDevice({ source: "guard", deviceVirtual: "real" })).toBe(true);
  });
});
