import { describe, expect, it } from "vitest";
import {
  bindingHasUnsupportedDerived,
  bindingIsAssetAttribute,
  bindingIsDeviceTelemetry,
  bindingPoints,
  bindingTargetOf,
  normalizeBinding,
  parseBindingPoint,
} from "./binding-normalize";

describe("normalizeBinding", () => {
  it("v1 文档（deviceId + telemetryMappings）原样保留并推导出 target", () => {
    const binding = normalizeBinding({
      id: "b1",
      sceneEntityId: "chiller-1",
      deviceId: "dev-1",
      deviceName: "1# 模块机",
      telemetryMappings: [
        { field: "water_in_temp", telemetryKey: "water_in_temp", label: "进水温度", unit: "℃", displayType: "number" },
      ],
      actionMappings: [],
    });

    expect(binding).not.toBeNull();
    expect(binding?.deviceId).toBe("dev-1");
    expect(binding?.target).toEqual({ entityType: "DEVICE", entityId: "dev-1", name: "1# 模块机" });
    // v1 字段必须还在，不做迁移式重写
    expect(binding?.telemetryMappings).toHaveLength(1);
  });

  it("资产条目（只有 target，没有 deviceId）被保留，且不带空字符串 deviceId", () => {
    const binding = normalizeBinding({
      id: "b2",
      sceneEntityId: "plant-root",
      target: { entityType: "ASSET", entityId: "asset-1", name: "热泵系统 1" },
      points: [{ slot: "equipment.onlineRate", source: "attribute", key: "onlineRate", displayType: "number" }],
      telemetryMappings: [],
      actionMappings: [],
    });

    expect(binding).not.toBeNull();
    /*
     * 关键断言：不能出现 deviceId。后端 validateBindings 对「带 deviceId 的条目」
     * 会做 parseUuid —— 空字符串直接抛「不是合法 UUID」，整份绑定写不进去。
     */
    expect(binding && "deviceId" in binding).toBe(false);
    expect(binding?.target?.entityType).toBe("ASSET");
    expect(binding?.points).toHaveLength(1);
  });

  it("既无 deviceId 也无 target 的条目被丢弃", () => {
    expect(normalizeBinding({ id: "b3", sceneEntityId: "x", telemetryMappings: [] })).toBeNull();
  });

  it("只有 target 没有 sceneEntityId 时仍保留（场景根级绑定）", () => {
    const binding = normalizeBinding({
      target: { entityType: "ASSET", entityId: "asset-1", name: "系统" },
      points: [{ slot: "s.k", source: "attribute", key: "k", displayType: "number" }],
    });
    expect(binding).not.toBeNull();
    expect(binding?.sceneEntityId).toBe("");
  });

  it("deviceId 与同 id 的 target 不会重复产出", () => {
    const binding = normalizeBinding({
      sceneEntityId: "e",
      deviceId: "dev-1",
      target: { entityType: "DEVICE", entityId: "dev-1", name: "设备" },
      telemetryMappings: [],
    });
    expect(binding?.target?.entityId).toBe("dev-1");
    expect(bindingPoints(binding!)).toHaveLength(0);
  });
});

describe("bindingPoints", () => {
  it("v1 文档由 telemetryMappings 推导，source 全是 telemetry", () => {
    const binding = normalizeBinding({
      sceneEntityId: "e",
      deviceId: "dev-1",
      telemetryMappings: [
        { field: "in", telemetryKey: "water_in_temp", label: "进水", unit: "℃", displayType: "number" },
        { field: "out", telemetryKey: "water_out_temp", label: "出水", unit: "℃", displayType: "number" },
      ],
    })!;

    const points = bindingPoints(binding);
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.source === "telemetry")).toBe(true);
    expect(points[0]).toMatchObject({ slot: "in", key: "water_in_temp", unit: "℃" });
  });

  it("同一个遥测键重复映射只产出一次", () => {
    const binding = normalizeBinding({
      sceneEntityId: "e",
      deviceId: "dev-1",
      telemetryMappings: [
        { field: "a", telemetryKey: "power_total", label: "A", displayType: "number" },
        { field: "b", telemetryKey: "power_total", label: "B", displayType: "number" },
      ],
    })!;
    expect(bindingPoints(binding)).toHaveLength(1);
  });

  it("有 points 时优先用 points，不再由 telemetryMappings 推导", () => {
    const binding = normalizeBinding({
      sceneEntityId: "e",
      deviceId: "dev-1",
      points: [{ slot: "s1", source: "telemetry", key: "k1", displayType: "number" }],
      telemetryMappings: [{ field: "old", telemetryKey: "k_old", label: "旧", displayType: "number" }],
    })!;
    const points = bindingPoints(binding);
    expect(points).toHaveLength(1);
    expect(points[0]?.key).toBe("k1");
  });
});

describe("parseBindingPoint", () => {
  it("attribute 允许带 scope", () => {
    const point = parseBindingPoint({
      slot: "a.b", source: "attribute", key: "onlineRate", scope: "SERVER_SCOPE", displayType: "number",
    });
    expect(point?.scope).toBe("SERVER_SCOPE");
  });

  it("telemetry 上的 scope 被忽略（不读进模型）", () => {
    const point = parseBindingPoint({
      slot: "a.b", source: "telemetry", key: "k", scope: "SERVER_SCOPE", displayType: "number",
    });
    expect(point).not.toBeNull();
    expect(point?.scope).toBeUndefined();
  });

  it("未知 source 被拒绝", () => {
    expect(parseBindingPoint({ slot: "a", source: "magic", key: "k" })).toBeNull();
  });

  it("缺 slot 或 key 被拒绝", () => {
    expect(parseBindingPoint({ source: "telemetry", key: "k" })).toBeNull();
    expect(parseBindingPoint({ slot: "a", source: "telemetry" })).toBeNull();
  });

  it("displayType 非法时退回 number，不丢整条", () => {
    const point = parseBindingPoint({ slot: "a", source: "telemetry", key: "k", displayType: "weird" });
    expect(point?.displayType).toBe("number");
  });

  it("staleAfterSec 只接受正数", () => {
    expect(parseBindingPoint({ slot: "a", source: "telemetry", key: "k", staleAfterSec: 300 })?.staleAfterSec).toBe(300);
    expect(parseBindingPoint({ slot: "a", source: "telemetry", key: "k", staleAfterSec: 0 })?.staleAfterSec).toBeUndefined();
    expect(parseBindingPoint({ slot: "a", source: "telemetry", key: "k", staleAfterSec: -5 })?.staleAfterSec).toBeUndefined();
  });
});

describe("判定函数", () => {
  const deviceBinding = normalizeBinding({
    sceneEntityId: "e", deviceId: "dev-1",
    telemetryMappings: [{ field: "f", telemetryKey: "k", label: "l", displayType: "number" }],
  })!;
  const assetBinding = normalizeBinding({
    sceneEntityId: "e",
    target: { entityType: "ASSET", entityId: "a-1", name: "资产" },
    points: [{ slot: "s", source: "attribute", key: "k", displayType: "number" }],
  })!;

  it("区分设备遥测与资产属性", () => {
    expect(bindingIsDeviceTelemetry(deviceBinding)).toBe(true);
    expect(bindingIsAssetAttribute(deviceBinding)).toBe(false);
    expect(bindingIsDeviceTelemetry(assetBinding)).toBe(false);
    expect(bindingIsAssetAttribute(assetBinding)).toBe(true);
  });

  it("bindingTargetOf 对资产条目返回 ASSET", () => {
    expect(bindingTargetOf(assetBinding)).toEqual({ entityType: "ASSET", entityId: "a-1", name: "资产" });
  });

  it("derived 能被识别为未支持（P0 不实现）", () => {
    const derived = normalizeBinding({
      sceneEntityId: "e", deviceId: "dev-1",
      points: [{ slot: "s", source: "derived", key: "k", displayType: "number" }],
    })!;
    expect(bindingHasUnsupportedDerived(derived)).toBe(true);
  });
});
