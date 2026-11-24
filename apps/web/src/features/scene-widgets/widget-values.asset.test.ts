import { describe, expect, it } from "vitest";
import type { DeviceBinding } from "@idt/shared-types";
import { assetAttrKey, readSlotValue, type AssetAttributeLookup } from "./widget-values";
import type { SceneWidgetSlot } from "@idt/data-adapter";

/**
 * v2 资产属性分支（docs/twin-binding-contract.md §5）。
 *
 * 重点不是「能读出值」，而是**五种无值状态必须分得开**：
 * unbound / missing / stale / forbidden / unreachable。
 * 全画成「—」的话，用户只会反复刷新，运维也不知道该查什么。
 */

const assetSlot: SceneWidgetSlot = {
  key: "onlineRate",
  label: "设备在线率",
  unit: "%",
  assetId: "asset-1",
  attributeKey: "onlineRate",
};

const assetBinding: DeviceBinding = {
  id: "b-asset",
  sceneEntityId: "plant-root",
  deviceName: "热泵系统 1",
  target: { entityType: "ASSET", entityId: "asset-1", name: "热泵系统 1" },
  telemetryMappings: [],
  actionMappings: [],
  points: [{ slot: "equipment.onlineRate", source: "attribute", key: "onlineRate", displayType: "number" }],
};

function lookup(rows: Array<[string, number | string | boolean, number]>): AssetAttributeLookup {
  return new Map(rows.map(([key, value, lastUpdatedTs]) => [key, { value, lastUpdatedTs }]));
}

describe("readSlotValue / 资产属性", () => {
  it("有值 → origin=asset-attribute，带数值", () => {
    const reading = readSlotValue(
      assetSlot,
      [assetBinding],
      new Map(),
      [],
      lookup([[assetAttrKey("asset-1", "onlineRate"), 95, 1_700_000_000_000]]),
      undefined,
      1_700_000_100_000,
    );
    expect(reading.origin).toBe("asset-attribute");
    expect(reading.missing).toBe(false);
    expect(reading.numeric).toBe(95);
    expect(reading.unit).toBe("%");
    expect(reading.unavailableReason).toBeUndefined();
  });

  it("属性缺失 → missing（不是 0、不是空串）", () => {
    const reading = readSlotValue(assetSlot, [assetBinding], new Map(), [], lookup([]));
    expect(reading.origin).toBe("asset-attribute");
    expect(reading.missing).toBe(true);
    expect(reading.unavailableReason).toBe("missing");
    expect(reading.numeric).toBeUndefined();
  });

  it("超过 staleAfterSec 仍然给值，但标 stale", () => {
    const now = 1_700_000_000_000;
    const reading = readSlotValue(
      { ...assetSlot, staleAfterSec: 3600 },
      [assetBinding],
      new Map(),
      [],
      lookup([[assetAttrKey("asset-1", "onlineRate"), 88, now - 7200 * 1000]]),
      undefined,
      now,
    );
    // 值还在 —— 把值抹掉会让人以为属性丢了
    expect(reading.numeric).toBe(88);
    expect(reading.missing).toBe(false);
    expect(reading.unavailableReason).toBe("stale");
    expect(reading.staleAt).toBe(now - 7200 * 1000);
  });

  it("未超时不算 stale", () => {
    const now = 1_700_000_000_000;
    const reading = readSlotValue(
      { ...assetSlot, staleAfterSec: 3600 },
      [assetBinding],
      new Map(),
      [],
      lookup([[assetAttrKey("asset-1", "onlineRate"), 88, now - 60 * 1000]]),
      undefined,
      now,
    );
    expect(reading.unavailableReason).toBeUndefined();
  });

  it("403 → forbidden（与 missing 分开）", () => {
    const reading = readSlotValue(assetSlot, [assetBinding], new Map(), [], undefined, "forbidden");
    expect(reading.unavailableReason).toBe("forbidden");
    expect(reading.missing).toBe(true);
  });

  it("网络不可用 → unreachable（与 missing 分开）", () => {
    const reading = readSlotValue(assetSlot, [assetBinding], new Map(), [], undefined, "unreachable");
    expect(reading.unavailableReason).toBe("unreachable");
  });

  it("没传查找表也没传错误 → unreachable，不冒充 missing", () => {
    const reading = readSlotValue(assetSlot, [assetBinding], new Map(), []);
    expect(reading.unavailableReason).toBe("unreachable");
  });

  it("资产槽不会串到设备读数上（即使同一 binding 带 deviceId）", () => {
    const mixed: DeviceBinding = {
      ...assetBinding,
      deviceId: "dev-9",
      points: [{ slot: "s", source: "attribute", key: "onlineRate", displayType: "number" }],
    };
    const latest = new Map([
      ["dev-9:onlineRate", { deviceId: "dev-9", key: "onlineRate", value: 42, timestamp: Date.now(), source: "guard" as const }],
    ]);
    const reading = readSlotValue(assetSlot, [mixed], latest, [], lookup([]));
    // 资产分支优先，属性查不到就是 missing —— 不能退回设备遥测的 42
    expect(reading.origin).toBe("asset-attribute");
    expect(reading.unavailableReason).toBe("missing");
    expect(reading.numeric).toBeUndefined();
  });
});

describe("readSlotValue / 设备遥测（回归）", () => {
  it("无 deviceId 的槽 → unbound", () => {
    const reading = readSlotValue({ key: "k", label: "K" }, [], new Map());
    expect(reading.bound).toBe(false);
    expect(reading.unavailableReason).toBe("unbound");
  });

  it("有绑定但无数据 → missing，origin=device-telemetry", () => {
    const binding: DeviceBinding = {
      id: "b1",
      sceneEntityId: "e1",
      deviceId: "dev-1",
      deviceName: "1# 模块机",
      telemetryMappings: [{ field: "in", telemetryKey: "water_in_temp", label: "进水", unit: "℃", displayType: "number" }],
      actionMappings: [],
    };
    const reading = readSlotValue({ key: "in", deviceId: "dev-1" }, [binding], new Map());
    expect(reading.origin).toBe("device-telemetry");
    expect(reading.unavailableReason).toBe("missing");
  });

  it("遥测也能按 staleAfterSec 判过期", () => {
    const now = 1_700_000_000_000;
    const binding: DeviceBinding = {
      id: "b1",
      sceneEntityId: "e1",
      deviceId: "dev-1",
      deviceName: "1# 模块机",
      telemetryMappings: [{ field: "in", telemetryKey: "water_in_temp", label: "进水", unit: "℃", displayType: "number" }],
      actionMappings: [],
    };
    const latest = new Map([
      ["dev-1:water_in_temp", {
        deviceId: "dev-1", key: "water_in_temp", value: 12.5,
        timestamp: now - 600 * 1000, source: "guard" as const,
      }],
    ]);
    // slot 必须带 telemetryKey（或 key 就是数据键），否则 slotKeys 会去找 "in" 而不是 water_in_temp
    const reading = readSlotValue(
      { key: "in", label: "进水", telemetryKey: "water_in_temp", deviceId: "dev-1", staleAfterSec: 300 },
      [binding], latest, [], undefined, undefined, now,
    );
    expect(reading.numeric).toBe(12.5);
    expect(reading.unavailableReason).toBe("stale");
  });
});
