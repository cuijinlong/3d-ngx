
import { describe, expect, it } from "vitest";
import type { Device, DeviceBinding, TelemetryRecord } from "@idt/shared-types";
import type { SceneWidget, SceneWidgetSlot } from "@idt/data-adapter";
import {
  collectWidgetPerDeviceKeys,
  collectWidgetSlotKeys,
  readSlotValue,
  summarizeSceneBindings,
  selectionBindings,
  widgetBindableDevices,
  resolveWidgetBindingSlots,
  canDisplayWidgetDeviceReading,
  assignWidgetSlot,
  readMetricBreakdown,
  readRatioRingGroups,
  shouldDisplayWidgetInRuntime,
  widgetsForSurface,
  summarizeScopedDevices,
  listScopedDevices,
  screenHasAnyTelemetry,
  describePendingSlot,
  formatDataAge,
  buildTrendSeries,
  mergeHistoryAggregate,
  readScopedAggregate,
  widgetDataAgeMs,
  WIDGET_UNBOUND_MESSAGE,
  assignWidgetAssetSlot,
} from "./widget-values";

function binding(partial: Partial<DeviceBinding> = {}): DeviceBinding {
  return {
    id: "b1",
    sceneEntityId: "fan-1",
    deviceId: "dev-1",
    deviceName: "模块机 9#",
    telemetryMappings: [
      { field: "temp", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
    ],
    actionMappings: [],
    ...partial,
  };
}

describe("widget-values", () => {
  it("does not invent a value when the slot is unbound or has no latest reading", () => {
    const unbound = readSlotValue({ key: "temperature" }, [], {});
    expect(unbound.bound).toBe(false);
    expect(unbound.missing).toBe(true);
    expect(unbound.text).toBe("");

    const waiting = readSlotValue(
      { key: "temperature", sceneEntityId: "fan-1", telemetryKey: "temperature" },
      [binding()],
      {},
    );
    expect(waiting.bound).toBe(true);
    expect(waiting.missing).toBe(true);
    expect(waiting.text).toBe("");
  });

  it("reads a bound slot from live telemetry and summarizes only existing bindings", () => {
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
    };
    const reading = readSlotValue(
      { key: "temperature", sceneEntityId: "fan-1", telemetryKey: "temperature" },
      [binding()],
      latest,
    );
    expect(reading.missing).toBe(false);
    expect(reading.text).toContain("18.4");
    expect(reading.text).not.toContain("℃");
    expect(reading.unit).toBe("℃");

    const summary = summarizeSceneBindings([binding(), binding({ id: "b2", sceneEntityId: "fan-2", deviceId: "" })], latest);
    expect(summary.boundCount).toBe(1);
    expect(summary.withDataCount).toBe(1);
  });

  it("keeps the selection card empty until an object is selected", () => {
    expect(selectionBindings(null, [binding()])).toEqual([]);
    expect(selectionBindings("fan-1", [binding()]).map((item) => item.deviceId)).toEqual(["dev-1"]);
  });

  it("reads a slot bound only by deviceId and excludes platform virtual devices from bindable options", () => {
    const latest: Record<string, TelemetryRecord> = {
      "dev-9:power": {
        deviceId: "dev-9",
        key: "power",
        value: 120,
        unit: "kW",
        timestamp: 1,
        source: "guard",
      },
    };
    const reading = readSlotValue({ key: "power", deviceId: "dev-9", telemetryKey: "power", label: "功率" }, [], latest);
    expect(reading.bound).toBe(true);
    expect(reading.missing).toBe(false);
    expect(reading.text).toContain("120");

    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const virtual: Device = {
      ...realtime,
      id: "dev-v",
      name: "虚拟点位",
      deviceVirtual: "virtual",
    };
    const options = widgetBindableDevices({
      bindings: [
        binding({ deviceId: "dev-v", deviceName: "虚拟点位", sceneEntityId: "fan-v" }),
        binding(),
      ],
      devices: [realtime, virtual],
    });
    expect(options.map((item) => item.deviceId)).toEqual(["dev-1"]);
    expect(options[0]?.keys.some((item) => item.telemetryKey === "temperature")).toBe(true);
  });

  it("does not offer or write a virtual deviceId that only remains on a stale object binding", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const staleVirtual = binding({
      id: "b-v",
      deviceId: "dev-v",
      deviceName: "虚拟点位",
      sceneEntityId: "fan-v",
    });
    const options = widgetBindableDevices({
      bindings: [staleVirtual, binding()],
      devices: [realtime],
    });
    expect(options.map((item) => item.deviceId)).toEqual(["dev-1"]);
    expect(options.some((item) => item.deviceId === "dev-v")).toBe(false);

    expect(resolveWidgetBindingSlots("dev-v", "temperature", options, [realtime])).toEqual([]);

    const forged = [{
      deviceId: "dev-v",
      deviceName: "虚拟点位",
      sceneEntityId: "fan-v",
      keys: [{ telemetryKey: "temperature", label: "温度", unit: "℃" }],
    }];
    expect(resolveWidgetBindingSlots("dev-v", "temperature", forged, [realtime])).toEqual([]);
    expect(resolveWidgetBindingSlots("dev-1", "temperature", options, [realtime])[0]?.deviceId).toBe("dev-1");
  });

  it("does not display a value or trend for a stale virtual deviceId even when the feed still has data", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const latest: Record<string, TelemetryRecord> = {
      "dev-v:temperature": {
        deviceId: "dev-v",
        key: "temperature",
        value: 36,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
    };
    const staleSlot = { key: "temperature", deviceId: "dev-v", telemetryKey: "temperature", label: "温度" };
    const hidden = readSlotValue(staleSlot, [], latest, [realtime]);
    expect(hidden.text).toBe("");
    expect(hidden.bound).toBe(false);
    expect(hidden.missing).toBe(true);

    const beforeList = readSlotValue(staleSlot, [], latest, []);
    expect(beforeList.bound).toBe(true);
    expect(beforeList.text).toContain("36");
    expect(canDisplayWidgetDeviceReading("dev-v", [])).toBe(true);
    expect(canDisplayWidgetDeviceReading("dev-v", [realtime])).toBe(false);
    expect(readSlotValue({ key: "temperature", deviceId: "dev-1", telemetryKey: "temperature" }, [], latest, [realtime]).text).toContain("18.4");
  });

  it("excludes virtual or unknown devices from the summary and selection cards once the realtime list is ready", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        timestamp: 1,
        source: "guard",
      },
      "dev-v:temperature": {
        deviceId: "dev-v",
        key: "temperature",
        value: 36,
        timestamp: 1,
        source: "guard",
      },
    };
    const rows = [
      binding(),
      binding({ id: "b-v", deviceId: "dev-v", deviceName: "虚拟点位", sceneEntityId: "fan-v" }),
    ];
    const beforeList = summarizeSceneBindings(rows, latest);
    expect(beforeList.boundCount).toBe(2);
    expect(beforeList.withDataCount).toBe(2);

    const ready = summarizeSceneBindings(rows, latest, [realtime]);
    expect(ready.boundCount).toBe(1);
    expect(ready.withDataCount).toBe(1);

    expect(selectionBindings("fan-v", rows).map((item) => item.deviceId)).toEqual(["dev-v"]);
    expect(selectionBindings("fan-v", rows, [realtime])).toEqual([]);
    expect(selectionBindings("fan-1", rows, [realtime]).map((item) => item.deviceId)).toEqual(["dev-1"]);
  });

  it("uses 还没有绑定设备 as the arrange empty copy; runtime keeps configured cards and hides unbound ones", () => {
    expect(WIDGET_UNBOUND_MESSAGE).toBe("还没有绑定设备");
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:temperature": {
        deviceId: "dev-1",
        key: "temperature",
        value: 18.4,
        unit: "℃",
        timestamp: 1,
        source: "guard",
      },
    };
    const unbound: SceneWidget = { id: "m1", type: "metric-card", x: 4, y: 16, w: 20, h: 16, title: "实时负荷" };
    const bound: SceneWidget = {
      id: "m2",
      type: "metric-card",
      x: 4,
      y: 16,
      w: 20,
      h: 16,
      slots: [{ key: "main", deviceId: "dev-1", telemetryKey: "temperature" }],
    };
    const missing: SceneWidget = {
      id: "m3",
      type: "metric-card",
      x: 4,
      y: 36,
      w: 20,
      h: 16,
      slots: [{ key: "main", deviceId: "dev-1", telemetryKey: "missing" }],
    };
    const title: SceneWidget = { id: "t1", type: "title", x: 22, y: 2, w: 56, h: 7, title: "天骄科技园运行总览" };
    const emptyTitle: SceneWidget = { id: "t2", type: "title", x: 22, y: 2, w: 56, h: 7 };
    const ctx = { bindings: [binding()], latest, sceneTitle: "场景" };
    /* 没绑定 → 隐藏（运行态不该露半成品） */
    expect(shouldDisplayWidgetInRuntime(unbound, ctx)).toBe(false);
    /* 绑了且有数 → 显示 */
    expect(shouldDisplayWidgetInRuntime(bound, ctx)).toBe(true);
    /*
     * ★ 绑了但没数 → **仍然显示**（2026-11-23 语义调整）。
     *
     * <p>原来这里是 false。后果：网关一断线，大屏成片卡片消失，
     * 用户看到「页面怎么这么空」，而不是「这块卡在等数据」。
     * 而且「配好了没数」和「压根没配」在视觉上完全一样，没人分得清。
     * 卡片体自己会显示「暂无数据」。
     */
    expect(shouldDisplayWidgetInRuntime(missing, ctx)).toBe(true);
    expect(shouldDisplayWidgetInRuntime(title, ctx)).toBe(true);
    expect(shouldDisplayWidgetInRuntime(emptyTitle, ctx)).toBe(true);
    expect(shouldDisplayWidgetInRuntime(emptyTitle, { ...ctx, sceneTitle: "" })).toBe(false);
    expect(widgetsForSurface([unbound, bound, missing, title], "editor", ctx).map((item) => item.id)).toEqual(["m1", "m2", "m3", "t1"]);
    /* 运行态：隐藏 m1（没配），保留 m2/m3（配了）与 t1 */
    expect(widgetsForSurface([unbound, bound, missing, title], "runtime", ctx).map((item) => item.id)).toEqual(["m2", "m3", "t1"]);
  });

  it("★ 范围聚合槽也算「有配置」（2026-11-24 实测暴露）", () => {
    /*
     * `system-power`（场站用电量）只有 `main` 一个聚合槽：
     * `{ key: "main", telemetryKey: "power", aggregate: "sum" }`，**没有 deviceId**。
     *
     * <p>`readSlotValue` 要求 deviceId，所以 breakdown.main.bound = false。
     * 只按 breakdown 判断的话整张卡会从大屏消失 —— 实测就是这样：
     * 删掉两个绑在 PLC 网关上的无用侧槽位后，「场站用电量」卡直接不见了。
     *
     * <p>这个缺陷一直存在，只是被那两个侧槽位撑着没暴露。
     */
    const aggregateOnly: SceneWidget = {
      id: "system-power",
      type: "metric-card",
      x: 2, y: 12, w: 18, h: 22,
      filterText: "模块机",
      scope: { kind: "topology", topologyId: "t1", topologyName: "场景" },
      slots: [{ key: "main", label: "9 台机组之和", telemetryKey: "power", aggregate: "sum" }],
    };
    const ctx = {
      bindings: [binding()],
      latest: new Map<string, TelemetryRecord>(),
      scopeDeviceIds: { "topology:t1": ["dev-1"] },
    };
    expect(shouldDisplayWidgetInRuntime(aggregateOnly, ctx)).toBe(true);

    /* scope 解不出设备时仍隐藏 —— 没设备就没有聚合值可算 */
    expect(shouldDisplayWidgetInRuntime(aggregateOnly, { ...ctx, scopeDeviceIds: {} })).toBe(false);

    /* 没有 aggregate 的裸槽位（无 deviceId、无 constant）依旧隐藏 */
    const naked: SceneWidget = {
      ...aggregateOnly,
      id: "naked",
      slots: [{ key: "main", label: "无来源", telemetryKey: "power" }],
    };
    expect(shouldDisplayWidgetInRuntime(naked, ctx)).toBe(false);
  });

  it("reads a main-plus-sides metric and resolved n/m ring groups without inventing numbers", () => {
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:power": { deviceId: "dev-1", key: "power", value: 286, unit: "kW", timestamp: 1, source: "guard" },
      "dev-1:elec": { deviceId: "dev-1", key: "elec", value: 210, unit: "kW", timestamp: 1, source: "guard" },
      "dev-1:used": { deviceId: "dev-1", key: "used", value: 9, timestamp: 1, source: "guard" },
      "dev-1:total": { deviceId: "dev-1", key: "total", value: 12, timestamp: 1, source: "guard" },
    };
    const metric: SceneWidget = {
      id: "metric",
      type: "metric-card",
      x: 4,
      y: 16,
      w: 20,
      h: 18,
      slots: [
        { key: "main", deviceId: "dev-1", telemetryKey: "power", label: "实时负荷", unit: "kW" },
        { key: "left", deviceId: "dev-1", telemetryKey: "elec", label: "电" },
        { key: "right", deviceId: "dev-1", telemetryKey: "cold", label: "冷" },
      ],
    };
    const breakdown = readMetricBreakdown(metric, [], latest);
    expect(breakdown.main?.text).toContain("286");
    expect(breakdown.left?.text).toContain("210");
    expect(breakdown.right?.bound).toBe(true);
    expect(breakdown.right?.missing).toBe(true);
    expect(shouldDisplayWidgetInRuntime(metric, { bindings: [], latest })).toBe(true);

    const rings: SceneWidget = {
      id: "rings",
      type: "ratio-ring",
      x: 78,
      y: 16,
      w: 20,
      h: 22,
      slots: [
        { key: "used-0", deviceId: "dev-1", telemetryKey: "used", label: "主机" },
        { key: "total-0", deviceId: "dev-1", telemetryKey: "total" },
        { key: "used-1", deviceId: "dev-1", telemetryKey: "missing", label: "循环泵" },
        { key: "total-1", deviceId: "dev-1", telemetryKey: "total" },
      ],
    };
    const groups = readRatioRingGroups(rings, [], latest);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.resolved).toBe(true);
    expect(groups[0]?.ratio).toBeCloseTo(9 / 12);
    expect(groups[1]?.resolved).toBe(false);
    expect(shouldDisplayWidgetInRuntime(rings, { bindings: [], latest })).toBe(true);
    /*
     * 只剩第 2 组（已用量读不到、总量读得到）。
     * 总量那侧**绑了配置** → 卡仍显示，缺的「已用」由卡说「暂无数据」。
     * 2026-11-23 前这里是 false（要求两侧都有值），网关断一项就整卡消失。
     */
    const unresolvedOnly: SceneWidget = { ...rings, slots: rings.slots?.slice(2) };
    expect(shouldDisplayWidgetInRuntime(unresolvedOnly, { bindings: [], latest })).toBe(true);
  });

  it("only writes a realtime device into the targeted slot and classifies fault without inventing counts", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "temperature", label: "温度", unit: "℃", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const options = widgetBindableDevices({ bindings: [binding()], devices: [realtime] });
    const slots = assignWidgetSlot([], 0, "dev-1", "temperature", options, [realtime], { key: "main", label: "主值" });
    expect(slots[0]?.deviceId).toBe("dev-1");
    expect(slots[0]?.key).toBe("main");
    expect(assignWidgetSlot(slots, 1, "dev-v", "temperature", options, [realtime], { key: "left" })).toEqual(slots);

    const running = binding({
      statusMapping: { telemetryKey: "state", rules: [] },
    });
    const faulted = binding({
      id: "b2",
      sceneEntityId: "fan-2",
      deviceId: "dev-2",
      deviceName: "2#",
      statusMapping: { telemetryKey: "state", rules: [] },
    });
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:state": { deviceId: "dev-1", key: "state", value: "运行", timestamp: 1, source: "guard" },
      "dev-2:state": { deviceId: "dev-2", key: "state", value: "故障", timestamp: 1, source: "guard" },
    };
    const summary = summarizeSceneBindings([running, faulted], latest);
    expect(summary.boundCount).toBe(2);
    expect(summary.runningCount).toBe(1);
    expect(summary.faultCount).toBe(1);
    expect(summary.offlineCount).toBe(0);
    expect(shouldDisplayWidgetInRuntime({ id: "s1", type: "summary-card", x: 4, y: 40, w: 20, h: 16 }, { bindings: [running, faulted], latest })).toBe(false);
    expect(shouldDisplayWidgetInRuntime({ id: "s2", type: "summary-card", x: 4, y: 40, w: 20, h: 16 }, { bindings: [], latest: {} })).toBe(false);
  });

  it("does not let a summary or ring card use model bindings until a visible scope is selected", () => {
    const realtime: Device = {
      id: "dev-1",
      name: "模块机 9#",
      type: "ahu",
      points: [{ key: "state", label: "状态", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const other: Device = {
      id: "dev-2",
      name: "泵 1#",
      type: "pump",
      points: [{ key: "state", label: "状态", displayType: "number" }],
      source: "guard",
      createdAt: "t",
      updatedAt: "t",
    };
    const running = binding({ statusMapping: { telemetryKey: "state", rules: [] } });
    const faulted = binding({
      id: "b2",
      sceneEntityId: "fan-2",
      deviceId: "dev-2",
      deviceName: "泵 1#",
      statusMapping: { telemetryKey: "state", rules: [] },
    });
    const latest: Record<string, TelemetryRecord> = {
      "dev-1:state": { deviceId: "dev-1", key: "state", value: "运行", timestamp: 1, source: "guard" },
      "dev-2:state": { deviceId: "dev-2", key: "state", value: "故障", timestamp: 1, source: "guard" },
    };
    const unboundSummary: SceneWidget = { id: "s1", type: "summary-card", x: 4, y: 40, w: 20, h: 16, title: "设备状态" };
    const ctx = { bindings: [running, faulted], latest, devices: [realtime, other] };
    expect(shouldDisplayWidgetInRuntime(unboundSummary, ctx)).toBe(false);
    expect(widgetsForSurface([unboundSummary], "editor", ctx)).toHaveLength(1);
    expect(widgetsForSurface([unboundSummary], "runtime", ctx)).toEqual([]);

    const scoped: SceneWidget = {
      ...unboundSummary,
      scope: { kind: "site", siteId: "site-1", siteName: "一号站" },
    };
    expect(shouldDisplayWidgetInRuntime(scoped, ctx)).toBe(false);
    const scopeDeviceIds = { "site:site-1": ["dev-1"] };
    const ready = { ...ctx, scopeDeviceIds };
    expect(shouldDisplayWidgetInRuntime(scoped, ready)).toBe(true);
    const scopedSummary = summarizeScopedDevices(["dev-1"], latest, [running, faulted], [realtime, other]);
    expect(scopedSummary.boundCount).toBe(1);
    expect(scopedSummary.runningCount).toBe(1);
    expect(scopedSummary.faultCount).toBe(0);

    const ring: SceneWidget = {
      id: "r1",
      type: "ratio-ring",
      x: 78,
      y: 12,
      w: 20,
      h: 22,
      title: "运行台数",
      slots: [
        { key: "used-0", label: "已用 1" },
        { key: "total-0", label: "总数 1" },
      ],
      scope: { kind: "topology", topologyId: "topo-1" },
    };
    expect(shouldDisplayWidgetInRuntime(ring, ctx)).toBe(false);
    const ringReady = { ...ctx, scopeDeviceIds: { "topology:topo-1": ["dev-1", "dev-2"] } };
    expect(shouldDisplayWidgetInRuntime(ring, ringReady)).toBe(true);
    const groups = readRatioRingGroups(ring, [running, faulted], latest, [realtime, other], ringReady.scopeDeviceIds);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.usedValue).toBe(1);
    expect(groups[0]?.totalValue).toBe(2);
    expect(groups[0]?.resolved).toBe(true);
  });
});

/**
 * 槽位绑资产属性（2026-11-23）。
 *
 * 守的核心是**互斥**：一个槽不能同时是设备遥测和资产属性。
 * 若切到资产时还留着 deviceId，后端写回会按 deviceId 校验设备归属，
 * 出现「配的是资产，却要求资产属于某个设备」的荒谬错误；
 * 反过来留着 assetId 时遥测分支也会被资产分支抢先命中。
 */
describe("assignWidgetAssetSlot", () => {
  it("绑资产时清掉 deviceId 与 telemetryKey", () => {
    const slots: SceneWidgetSlot[] = [
      { key: "main", deviceId: "dev-1", telemetryKey: "power_total", unit: "kW" },
    ];
    const next = assignWidgetAssetSlot(slots, 0, "asset-1", "installedCapacity");
    expect(next[0]?.assetId).toBe("asset-1");
    expect(next[0]?.attributeKey).toBe("installedCapacity");
    // 关键断言：设备侧字段必须消失
    expect(next[0]?.deviceId).toBeUndefined();
    expect(next[0]?.telemetryKey).toBeUndefined();
  });

  it("绑资产时默认给 staleAfterSec（属性没有实时概念）", () => {
    const next = assignWidgetAssetSlot([], 0, "asset-1", "k");
    expect(next[0]?.staleAfterSec).toBe(600);
  });

  it("preset 的 staleAfterSec 优先", () => {
    const next = assignWidgetAssetSlot([], 0, "asset-1", "k", { staleAfterSec: 3600 });
    expect(next[0]?.staleAfterSec).toBe(3600);
  });

  it("assetId 为空 = 解绑，退回只剩 key/label", () => {
    const slots: SceneWidgetSlot[] = [
      { key: "main", assetId: "asset-1", attributeKey: "k", label: "容量" },
    ];
    const next = assignWidgetAssetSlot(slots, 0, "", undefined);
    expect(next[0]?.assetId).toBeUndefined();
    expect(next[0]?.attributeKey).toBeUndefined();
    expect(next[0]?.key).toBe("main");
    expect(next[0]?.label).toBe("容量");
  });

  it("只选资产没选属性 → 保留 assetId，不写 attributeKey", () => {
    const next = assignWidgetAssetSlot([], 0, "asset-1", undefined);
    expect(next[0]?.assetId).toBe("asset-1");
    expect(next[0]?.attributeKey).toBeUndefined();
  });

  it("preset 的 key 与 label 被沿用（与 assignWidgetSlot 一致）", () => {
    const next = assignWidgetAssetSlot([], 0, "asset-1", "k", { key: "main", label: "装机容量", unit: "kW" });
    expect(next[0]?.key).toBe("main");
    expect(next[0]?.label).toBe("装机容量");
    expect(next[0]?.unit).toBe("kW");
  });

  it("索引超出时补齐前面的槽位", () => {
    const next = assignWidgetAssetSlot([], 2, "asset-1", "k");
    expect(next).toHaveLength(3);
    expect(next[2]?.assetId).toBe("asset-1");
  });

  it("★ 再绑回设备时资产字段被清掉（assignWidgetSlot 的对称行为）", () => {
    const withAsset: SceneWidgetSlot[] = [
      { key: "main", assetId: "asset-1", attributeKey: "k" },
    ];
    const options = [{ deviceId: "dev-1", deviceName: "1#", keys: [{ telemetryKey: "power_total", label: "功率" }] }];
    /* 必须给一台「平台实时设备」：assignWidgetSlot 对非实时设备返回原样，不会写入槽位。 */
    const devices = [{ id: "dev-1", name: "1#", label: "1#", source: "guard", deviceVirtual: false }];
    const next = assignWidgetSlot(withAsset, 0, "dev-1", "power_total", options as never, devices as never);
    expect(next[0]?.deviceId).toBe("dev-1");
    expect(next[0]?.assetId).toBeUndefined();
  });
});

/**
 * 槽位设备键收集（2026-11-23）。
 *
 * 两个消费方缺了都会静默失效：实时订阅与大屏演示数据。
 * 天骄的真实故障是：系统级点位挂网关设备，而网关不是 GLB 对象，
 * 不在 document.bindings 里 —— 于是大屏「系统功率」既订阅不到也造不出演示值。
 */
describe("collectWidgetSlotKeys", () => {
  it("收集 deviceId + telemetryKey 都齐的槽", () => {
    const layout = {
      widgets: [
        { id: "a", type: "metric-card", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "main", deviceId: "gw-1", telemetryKey: "power_total" },
        ] },
        { id: "b", type: "device-list", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "value", telemetryKey: "water_out_temp" },
        ] },
      ],
    } as never;
    const keys = collectWidgetSlotKeys(layout);
    expect(keys["gw-1"]).toEqual(["power_total"]);
    // 没 deviceId 的按设备逐台槽不进表（设备由 scope 决定，不在这里绑）
    expect(Object.keys(keys)).toEqual(["gw-1"]);
  });

  it("同一设备多个键合并且去重", () => {
    const layout = {
      widgets: [
        { id: "a", type: "trend-chart", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "s0", deviceId: "gw-1", telemetryKey: "power_total" },
          { key: "s1", deviceId: "gw-1", telemetryKey: "load_rate" },
        ] },
        { id: "b", type: "metric-card", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "main", deviceId: "gw-1", telemetryKey: "power_total" },
        ] },
      ],
    } as never;
    expect(collectWidgetSlotKeys(layout)["gw-1"]).toEqual(["power_total", "load_rate"]);
  });

  it("★ 资产属性槽不进表（否则会给资产 id 发遥测订阅）", () => {
    const layout = {
      widgets: [
        { id: "a", type: "metric-card", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "main", assetId: "asset-1", attributeKey: "rated_cooling_capacity" },
        ] },
      ],
    } as never;
    expect(collectWidgetSlotKeys(layout)).toEqual({});
  });

  it("空布局与 null 不崩", () => {
    expect(collectWidgetSlotKeys(null)).toEqual({});
    expect(collectWidgetSlotKeys({ widgets: [] } as never)).toEqual({});
  });
});

/**
 * 「按设备逐台的列」（2026-11-23）。
 *
 * 实测缺口：机组加载率对比读 load_rate，而 load_rate 不在任何 3D 绑定的
 * telemetryMappings 里（手册 §17 只有系统级 30010，没有单台加载率）。
 * 演示数据若只按 bindings 造数，整张对比图永远是「—」。
 */
describe("collectWidgetPerDeviceKeys", () => {
  it("只收有 key、无 deviceId、非资产槽的键", () => {
    const layout = {
      widgets: [
        { id: "a", type: "bar-compare", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "load", telemetryKey: "load_rate" },
        ] },
        { id: "b", type: "device-list", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "value", telemetryKey: "water_out_temp" },
        ] },
        { id: "c", type: "metric-card", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "main", deviceId: "dev-1", telemetryKey: "power_total" },
        ] },
        { id: "d", type: "metric-card", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "main", assetId: "asset-1", attributeKey: "capacity" },
        ] },
      ],
    } as never;
    expect(collectWidgetPerDeviceKeys(layout)).toEqual(["load_rate", "water_out_temp"]);
  });

  it("去重", () => {
    const layout = {
      widgets: [
        { id: "a", type: "device-list", x: 0, y: 0, w: 10, h: 10, slots: [{ key: "v", telemetryKey: "k" }] },
        { id: "b", type: "device-list", x: 0, y: 0, w: 10, h: 10, slots: [{ key: "v", telemetryKey: "k" }] },
      ],
    } as never;
    expect(collectWidgetPerDeviceKeys(layout)).toEqual(["k"]);
  });

  it("资产槽的键不被当作遥测键", () => {
    const layout = {
      widgets: [
        { id: "a", type: "metric-card", x: 0, y: 0, w: 10, h: 10, slots: [
          { key: "main", assetId: "a-1", attributeKey: "rated_cooling_capacity" },
        ] },
      ],
    } as never;
    expect(collectWidgetPerDeviceKeys(layout)).toEqual([]);
  });

  it("null 不崩", () => {
    expect(collectWidgetPerDeviceKeys(null)).toEqual([]);
  });
});

/**
 * 控制条的 stateKey 必须进订阅表（2026-11-23）。
 *
 * <p>control-bar 用 `controls[].stateKey` 读开关状态，它不在 slots 里
 * （控制是发命令，不占槽位）。订阅表漏掉它的后果：
 * 实时模式下 `sys_run_state` 永不被订阅 → 按钮永远显示「状态未知」，
 * 操作员分不清「设备没动」和「平台没收到」。
 *
 * <p>这个坑不报错，只是按钮不反映实际状态 —— 所以用测试钉住。
 */
describe("collectWidgetSlotKeys / 控制条状态键", () => {
  it("controls 的 stateKey 进订阅表", () => {
    const layout = {
      widgets: [{
        id: "ctrl", type: "control-bar", x: 77, y: 48, w: 20, h: 11,
        controls: [{
          key: "system-power", deviceId: "gw-1", commandId: "setSystemPower",
          kind: "toggle", stateKey: "sys_run_state",
        }],
      }],
    } as never;
    expect(collectWidgetSlotKeys(layout)).toEqual({ "gw-1": ["sys_run_state"] });
  });

  it("没配 stateKey 的按钮不产生订阅（避免订阅一个空键）", () => {
    const layout = {
      widgets: [{
        id: "ctrl", type: "control-bar", x: 0, y: 0, w: 20, h: 11,
        controls: [{ key: "a", deviceId: "gw-1", commandId: "resetAlarm", kind: "button" }],
      }],
    } as never;
    expect(collectWidgetSlotKeys(layout)).toEqual({});
  });

  it("与同一设备的槽位键合并去重", () => {
    const layout = {
      widgets: [{
        id: "c", type: "control-bar", x: 0, y: 0, w: 20, h: 11,
        controls: [{ key: "k", deviceId: "gw-1", commandId: "c", stateKey: "sys_run_state" }],
      }, {
        id: "m", type: "metric-card", x: 0, y: 0, w: 20, h: 11,
        slots: [{ key: "main", deviceId: "gw-1", telemetryKey: "sys_run_state" }],
      }],
    } as never;
    expect(collectWidgetSlotKeys(layout)).toEqual({ "gw-1": ["sys_run_state"] });
  });
});

/**
 * 控制条在运行态必须显示（2026-11-23）。
 *
 * <p>实测：浏览器里 9 块卡只渲染出 2 块，控制条整个消失，而全部单测是绿的 ——
 * 因为没有一个用例问过「没有 slots 的部件该不该显示」。
 *
 * <p>根因：`widgetHasResolvableValue` 的兜底分支读 `slots[0]`，
 * 取不到就 `return false`。控制条不发命令读值，本来就没有 slots。
 */
describe("shouldDisplayWidgetInRuntime / 控制条", () => {
  const base = { bindings: [], latest: {}, devices: [] };

  it("★ 配了 controls 就显示（没有 slots 也不例外）", () => {
    const widget = {
      id: "control-bar", type: "control-bar", x: 0, y: 0, w: 20, h: 11,
      controls: [{ key: "k", deviceId: "gw", commandId: "setSystemPower" }],
    } as never;
    expect(shouldDisplayWidgetInRuntime(widget, base as never)).toBe(true);
  });

  it("没配 controls 时不显示（空卡没意义）", () => {
    const widget = { id: "c", type: "control-bar", x: 0, y: 0, w: 20, h: 11 } as never;
    expect(shouldDisplayWidgetInRuntime(widget, base as never)).toBe(false);
  });

  it("不受遥测是否为空影响 —— 设备没上报时按钮仍要在（要能点）", () => {
    const widget = {
      id: "c", type: "control-bar", x: 0, y: 0, w: 20, h: 11,
      controls: [{ key: "k", deviceId: "gw", commandId: "setSystemPower", stateKey: "sys_run_state" }],
    } as never;
    // latest 空 = 完全没有遥测
    expect(shouldDisplayWidgetInRuntime(widget, { ...base, latest: {} } as never)).toBe(true);
  });
});

/**
 * 「按设备逐台读一列」的卡必须显示（2026-11-23）。
 *
 * <p>实测：演示模式下 9 块卡只出 5 块 —— 机组状态（device-list）和
 * 加载率对比（bar-compare）全程缺席，而运行汇总（同样用 scope）正常。
 *
 * <p>根因：这两类的槽**没有 deviceId**（语义是「每台各自读这一列」），
 * `readSlotValue` 找不到 deviceId 就返回 `bound:false`，
 * 兜底分支据此判整卡「没值」→ 不渲染。
 */
describe("shouldDisplayWidgetInRuntime / 逐台列的卡", () => {
  const scope = { kind: "topology" as const, topologyId: "t1", topologyName: "x" };
  const scopeDeviceIds = { "topology:t1": ["d1", "d2"] };

  const rec = (deviceId: string, value: number): TelemetryRecord => ({
    deviceId, key: "water_out_temp", value, timestamp: Date.now(), source: "mock",
  });

  it("★ 范围内有设备且这一列有值 → 显示（不能因为 slot 没 deviceId 就隐掉）", () => {
    const widget = {
      id: "unit-list", type: "device-list", x: 0, y: 0, w: 20, h: 22,
      scope,
      slots: [{ key: "value", telemetryKey: "water_out_temp" }],
    } as never;
    const latest = { "d1:water_out_temp": rec("d1", 7.2), "d2:water_out_temp": rec("d2", 7.8) };
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest, devices: [], scopeDeviceIds,
    } as never)).toBe(true);
  });

  it("范围内没有任何设备 → 不显示", () => {
    const widget = {
      id: "b", type: "bar-compare", x: 0, y: 0, w: 40, h: 20,
      scope,
      slots: [{ key: "load", telemetryKey: "load_rate" }],
    } as never;
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest: {}, devices: [], scopeDeviceIds: {},
    } as never)).toBe(false);
  });

  it("有设备但这一列全都没值 → 仍显示（2026-11-23 放宽）", () => {
    const widget = {
      id: "unit-list", type: "device-list", x: 0, y: 0, w: 20, h: 22,
      scope,
      slots: [{ key: "value", telemetryKey: "water_out_temp" }],
    } as never;
    /*
     * 网关断线时这块卡曾整块消失 —— 而「机组状态」恰恰是最该被看到的时候。
     * 现在保留卡位，逐行显示「—」，用户知道「有 9 台设备，只是没上报」。
     */
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest: {}, devices: [], scopeDeviceIds,
    } as never)).toBe(true);
  });

  it("没有 scope → 不显示", () => {
    const widget = {
      id: "unit-list", type: "device-list", x: 0, y: 0, w: 20, h: 22,
      slots: [{ key: "value", telemetryKey: "water_out_temp" }],
    } as never;
    const latest = { "d1:water_out_temp": rec("d1", 7.2) };
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest, devices: [], scopeDeviceIds,
    } as never)).toBe(false);
  });
});

/**
 * 槽位 displayType 优先于绑定（2026-11-23）。
 *
 * <p>同一台设备的 `running` 在不同卡片上可能想显示不同：
 * 列表里要「运行/停止」文字，趋势图要 0/1 数值。
 * 槽位是「这一列怎么显示」，绑定是「这个测点是什么」，前者更具体。
 */
describe("readSlotValue / displayType 优先级", () => {
  const rec = (value: unknown): TelemetryRecord => ({
    deviceId: "d1", key: "running", value: value as never, timestamp: Date.now(), source: "mock",
  });

  it("★ slot.displayType=boolean 把 1 显示成「运行」", () => {
    const slot = { key: "state", deviceId: "d1", telemetryKey: "running", displayType: "boolean" as const };
    const reading = readSlotValue(slot, [], { "d1:running": rec(1) }, []);
    expect(reading.text).toBe("运行");
  });

  it("0 显示成「停止」", () => {
    const slot = { key: "state", deviceId: "d1", telemetryKey: "running", displayType: "boolean" as const };
    expect(readSlotValue(slot, [], { "d1:running": rec(0) }, []).text).toBe("停止");
  });

  it("槽位优先于绑定的 displayType", () => {
    /* 名字别叫 binding —— 会和文件顶部的 binding() 工厂函数撞名。 */
    const bound = binding({
      deviceId: "d1",
      telemetryMappings: [{ telemetryKey: "running", label: "运行", displayType: "number" }],
    } as never);
    const slot = { key: "state", deviceId: "d1", telemetryKey: "running", displayType: "boolean" as const };
    // 绑定的 mapping 说 number，槽位说 boolean —— 槽位赢
    expect(readSlotValue(slot, [bound], { "d1:running": rec(1) }, []).text).toBe("运行");
  });

  it("没配 displayType 时退回数字原样（不改老行为）", () => {
    const slot = { key: "state", deviceId: "d1", telemetryKey: "running" };
    expect(readSlotValue(slot, [], { "d1:running": rec(1) }, []).text).toBe("1");
  });
});

/**
 * 逐台列的 displayType 必须真的生效（2026-11-23）。
 *
 * <p>实测：unit-list 配了 `state: running + displayType:boolean`，
 * 大屏却显示「模块机 1# 6.5 1」—— 那个孤零零的「1」就是运行状态。
 *
 * <p>根因：`listScopedDevices` 只收 `keys`，`formatTelemetryText(row.value,
 * undefined, ...)` 把 displayType 写死成 undefined。槽位上配了也没用。
 */
describe("listScopedDevices / displayType", () => {
  const rec = (key: string, value: unknown): TelemetryRecord => ({
    deviceId: "d1", key, value: value as never, timestamp: Date.now(), source: "mock",
  });

  it("★ 传 slots 时 0/1 按 boolean 显示成「运行/停止」", () => {
    const slots = [
      { key: "value", telemetryKey: "water_out_temp", unit: "℃" },
      { key: "state", telemetryKey: "running", displayType: "boolean" as const },
    ];
    const rows = listScopedDevices(
      ["d1"], { "d1:water_out_temp": rec("water_out_temp", 6.5), "d1:running": rec("running", 1) },
      [], [], [], slots,
    );
    expect(rows[0]!.readings[0]!.text).toBe("6.5 ℃");
    expect(rows[0]!.readings[1]!.text).toBe("运行");
  });

  it("0 显示「停止」", () => {
    const slots = [{ key: "state", telemetryKey: "running", displayType: "boolean" as const }];
    const rows = listScopedDevices(["d1"], { "d1:running": rec("running", 0) }, [], [], [], slots);
    expect(rows[0]!.readings[0]!.text).toBe("停止");
  });

  it("不传 slots 时退回 keys 原样输出（保持老行为）", () => {
    const rows = listScopedDevices(["d1"], { "d1:running": rec("running", 1) }, [], [], ["running"]);
    expect(rows[0]!.readings[0]!.text).toBe("1");
  });

  it("label 用槽位的中文名，不是测点键", () => {
    const slots = [{ key: "state", label: "运行状态", telemetryKey: "running" }];
    const rows = listScopedDevices(["d1"], { "d1:running": rec("running", 1) }, [], [], [], slots);
    expect(rows[0]!.readings[0]!.label).toBe("运行状态");
  });
});

/**
 * 运行态判据的语义：**配置完整就显示**，缺数由卡片说（2026-11-23）。
 *
 * <p>改之前的判据是「绑了 **且** 有值」。网关一断线整屏卡片成片消失，
 * 而用户看到的是「页面怎么这么空」—— 不是「有 4 块卡在等数据」。
 *
 * <p>更糟的是「配好了没数」和「压根没配」在视觉上完全一样。
 * 参考模板（template01 README）明确要求：缺失数据要显示「暂无数据」，
 * 而不是让卡片消失。
 */
describe("shouldDisplayWidgetInRuntime / 三段语义", () => {
  const rec = (key: string, value: number): TelemetryRecord => ({
    deviceId: "d1", key, value, timestamp: Date.now(), source: "mock",
  });

  it("没配置 → 隐藏（运行态不该露半成品）", () => {
    const widget = { id: "m", type: "metric-card", x: 0, y: 0, w: 20, h: 13 } as never;
    expect(shouldDisplayWidgetInRuntime(widget, { bindings: [], latest: {} } as never)).toBe(false);
  });

  it("★ 配了但没数 → 显示（卡自己说「暂无数据」）", () => {
    const widget = {
      id: "m", type: "metric-card", x: 0, y: 0, w: 20, h: 13,
      slots: [{ key: "main", deviceId: "d1", telemetryKey: "power_total" }],
    } as never;
    // latest 为空 = 网关完全没上报
    expect(shouldDisplayWidgetInRuntime(widget, { bindings: [], latest: {} } as never)).toBe(true);
  });

  it("配了且有数 → 显示", () => {
    const widget = {
      id: "m", type: "metric-card", x: 0, y: 0, w: 20, h: 13,
      slots: [{ key: "main", deviceId: "d1", telemetryKey: "power_total" }],
    } as never;
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest: { "d1:power_total": rec("power_total", 300) },
    } as never)).toBe(true);
  });

  it("★ 趋势图不再要求「攒够 2 个点」—— 刚打开页面就该有卡位", () => {
    const widget = {
      id: "t", type: "trend-chart", x: 0, y: 0, w: 40, h: 20,
      slots: [{ key: "series-0", deviceId: "d1", telemetryKey: "power_total" }],
    } as never;
    // history 全空（刚打开）
    expect(shouldDisplayWidgetInRuntime(widget, { bindings: [], latest: {}, history: {} } as never)).toBe(true);
  });

  it("★ 运行汇总只要有设备就显示（0 台运行也要能看见）", () => {
    const widget = {
      id: "s", type: "summary-card", x: 0, y: 0, w: 20, h: 14,
      scope: { kind: "topology", topologyId: "t1", topologyName: "x" },
    } as never;
    // 有设备但全无读数
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest: {}, devices: [], scopeDeviceIds: { "topology:t1": ["d1", "d2"] },
    } as never)).toBe(true);
  });
});

/**
 * 运行汇总的四项计数必须能加回总数（2026-11-23）。
 *
 * <p>实测：9 台里 1 台有状态、8 台没上报时，卡片只显示
 * 运行 1 / 离线 0 / 故障 0，加起来 1，与「设备总数 9」对不上。
 * 那 8 台是「没配绑定」还是「网关没上报」都需要处理，不能藏。
 */
describe("summarizeScopedDevices / unknownCount", () => {
  const rec = (deviceId: string, key: string, value: unknown): TelemetryRecord => ({
    deviceId, key, value: value as never, timestamp: Date.now(), source: "mock",
  });

  it("★ 四项相加等于总数（含未知）", () => {
    const latest = {
      "d1:sys_run_state": rec("d1", "sys_run_state", 5),
      "d2:sys_run_state": rec("d2", "sys_run_state", 1),
      // d3 完全没数据
    };
    const sum = summarizeScopedDevices(["d1", "d2", "d3"], latest, [], []);
    expect(sum.boundCount).toBe(3);
    expect(sum.runningCount).toBe(1);
    expect(sum.offlineCount).toBe(1);
    expect(sum.faultCount).toBe(0);
    expect(sum.unknownCount).toBe(1);
    expect(
      sum.runningCount + sum.offlineCount + sum.faultCount + sum.unknownCount,
    ).toBe(sum.boundCount);
  });

  it("全部未知时 unknownCount = 总数", () => {
    const sum = summarizeScopedDevices(["d1", "d2"], {}, [], []);
    expect(sum.unknownCount).toBe(2);
    expect(sum.runningCount + sum.offlineCount + sum.faultCount).toBe(0);
  });
});

/**
 * 整屏遥测判空（2026-11-23）。
 *
 * <p>用途：网关没上报时给出「不是设计简单，是还没数据」的提示。
 * 判错的两种后果：误报有数据 → 用户继续困惑；误报没数据 → 提示乱弹。
 */
describe("screenHasAnyTelemetry", () => {
  const layout = {
    widgets: [{
      id: "m", type: "metric-card", x: 0, y: 0, w: 20, h: 13,
      slots: [{ key: "main", deviceId: "d1", telemetryKey: "power_total" }],
    }],
  } as never;

  const rec = (value: unknown): TelemetryRecord => ({
    deviceId: "d1", key: "power_total", value: value as never, timestamp: Date.now(), source: "guard",
  });

  it("有值 → true", () => {
    expect(screenHasAnyTelemetry(layout, { "d1:power_total": rec(300) })).toBe(true);
  });

  it("★ 平台返回 value=null 的占位记录 → false（那是「从没上报」，不是有数据）", () => {
    expect(screenHasAnyTelemetry(layout, { "d1:power_total": rec(null) })).toBe(false);
  });

  it("空串也算没值", () => {
    expect(screenHasAnyTelemetry(layout, { "d1:power_total": rec("") })).toBe(false);
  });

  it("完全没有遥测 → false", () => {
    expect(screenHasAnyTelemetry(layout, {})).toBe(false);
  });

  it("★ 只有别的页面的遥测不算本屏有数据", () => {
    const other = { "other-device:some_key": { ...rec(1), deviceId: "other-device", key: "some_key" } };
    expect(screenHasAnyTelemetry(layout, other as never)).toBe(false);
  });

  it("0 是合法值，不能被当成没数据", () => {
    expect(screenHasAnyTelemetry(layout, { "d1:power_total": rec(0) })).toBe(true);
  });

  it("★ 只有逐台键有数据时也算有数据（否则提示条误报）", () => {
    /*
     * 实测踩过：网关的系统级点位全是 null，但「机组状态」9 台都有运行状态。
     * 逐台键没有 deviceId，`collectWidgetSlotKeys` 不收 ——
     * 只看它就会判「整屏无数据」，弹出「还没有收到设备数据」的假警报。
     */
    const perDeviceLayout = {
      widgets: [{
        id: "unit-list", type: "device-list", x: 0, y: 0, w: 20, h: 22,
        scope: { kind: "topology", topologyId: "t1", topologyName: "x" },
        slots: [{ key: "state", telemetryKey: "running", displayType: "boolean" }],
      }],
    } as never;
    const row: TelemetryRecord = {
      deviceId: "module-1", key: "running", value: 1 as never, timestamp: Date.now(), source: "guard",
    };
    expect(screenHasAnyTelemetry(perDeviceLayout, { "module-1:running": row })).toBe(true);
  });

  it("逐台键全是 null 时仍算无数据", () => {
    const perDeviceLayout = {
      widgets: [{
        id: "unit-list", type: "device-list", x: 0, y: 0, w: 20, h: 22,
        slots: [{ key: "state", telemetryKey: "running" }],
      }],
    } as never;
    const row: TelemetryRecord = {
      deviceId: "module-1", key: "running", value: null as never, timestamp: Date.now(), source: "guard",
    };
    expect(screenHasAnyTelemetry(perDeviceLayout, { "module-1:running": row })).toBe(false);
  });
});

/**
 * 空卡诊断文案（2026-11-23）。
 *
 * <p>「暂无数据」只说了结论，没说去哪查。这段文案的价值在于：
 * 缺哪个点、哪台设备、停了多久 —— 决定要不要打电话给现场。
 */
describe("describePendingSlot", () => {
  const now = Date.UTC(2026, 10, 23, 4, 0, 0);
  const widget = {
    slots: [{ key: "main", deviceId: "gw", telemetryKey: "power_total" }],
  } as never;
  const devices = [{ id: "gw", name: "gw", label: "天骄-PLC网关" }] as never;

  it("没有任何记录 → 说清等待哪台设备的哪个点", () => {
    const text = describePendingSlot(widget, "main", [], {}, devices, now);
    expect(text).toContain("天骄-PLC网关");
    expect(text).toContain("power_total");
    expect(text).toContain("等待");
  });

  it("★ value=null 的占位记录也要拿它的时间戳（这才是「停了多久」的证据）", () => {
    const latest = {
      "gw:power_total": {
        deviceId: "gw", key: "power_total", value: null as never,
        timestamp: now - 50 * 3_600_000, source: "guard" as const,
      },
    };
    const text = describePendingSlot(widget, "main", [], latest, devices, now);
    expect(text).toContain("2 天");
  });

  it("几小时没更新时说小时数", () => {
    const latest = {
      "gw:power_total": {
        deviceId: "gw", key: "power_total", value: null as never,
        timestamp: now - 3 * 3_600_000, source: "guard" as const,
      },
    };
    expect(describePendingSlot(widget, "main", [], latest, devices, now)).toContain("3 小时");
  });

  it("刚上报但值还是空 → 不说「停了很久」", () => {
    const latest = {
      "gw:power_total": {
        deviceId: "gw", key: "power_total", value: null as never,
        timestamp: now - 60_000, source: "guard" as const,
      },
    };
    const text = describePendingSlot(widget, "main", [], latest, devices, now);
    expect(text).not.toContain("小时");
    /* 注意别用 toContain("天") —— 设备名「天骄…」本身含「天」 */
    expect(text).not.toContain("天没有新数据");
  });

  it("资产属性槽不说「网关没上报」", () => {
    const assetWidget = {
      slots: [{ key: "main", assetId: "a1", attributeKey: "rated_cooling_capacity" }],
    } as never;
    const text = describePendingSlot(assetWidget, "main", [], {}, devices, now);
    expect(text).toContain("rated_cooling_capacity");
    expect(text).not.toContain("网关");
  });

  it("没配设备时直接说没选设备", () => {
    const bare = { slots: [{ key: "main", telemetryKey: "x" }] } as never;
    expect(describePendingSlot(bare, "main", [], {}, devices, now)).toContain("设备");
  });
});

/**
 * 逐台卡的 pending 文案（2026-11-23）。
 *
 * <p>device-list / bar-compare 的槽位没有 deviceId（设备由 scope 决定）。
 * 对它说「还没有选择设备」是错的 —— 实测加载率对比卡明明配好了范围，
 * 却提示要选设备，用户会去到处找根本不存在的设备选择项。
 */
describe("describePendingSlot / 逐台卡", () => {
  it("★ scopePerDevice 卡不说「还没有选择设备」", () => {
    const widget = {
      type: "bar-compare",
      slots: [{ key: "load", telemetryKey: "load_rate" }],
    } as never;
    const text = describePendingSlot(widget, "load", [], {}, undefined, Date.now());
    expect(text).not.toContain("还没有选择设备");
    expect(text).toContain("load_rate");
  });

  it("普通设备卡的槽位没 deviceId 时仍提示选设备", () => {
    const widget = {
      type: "metric-card",
      slots: [{ key: "main", telemetryKey: "power_total" }],
    } as never;
    expect(describePendingSlot(widget, "main", [], {}, undefined, Date.now())).toContain("选择设备");
  });
});

/**
 * 数据新鲜度（2026-11-23）。
 *
 * <p>背景：实测库里数据停了 **51 小时**，大屏照常显示「7.4℃」，
 * 和实时数据长得一模一样。值班员据此以为设备在运行 —— 可能做出错误判断。
 *
 * <p>两处修正：
 * <ol>
 *   <li>`staleAfterSec` 从「配了才判」改成**有默认值**（配漏了也不会静默显示假实时）</li>
 *   <li>卡片头渲染「延迟 N 天」标记</li>
 * </ol>
 */
describe("数据新鲜度", () => {
  const now = Date.UTC(2026, 10, 23, 6, 0, 0);
  const rec = (key: string, value: unknown, ageMs: number, deviceId = "d1"): TelemetryRecord => ({
    deviceId, key, value: value as never, timestamp: now - ageMs, source: "guard" as const,
  });

  describe("readSlotValue 默认过期阈值", () => {
    it("★ 没配 staleAfterSec 也判过期（默认 600 秒）", () => {
      const slot = { key: "main", deviceId: "d1", telemetryKey: "temperature" };
      // 51 小时前的数据，槽位没配任何阈值
      const reading = readSlotValue(slot, [], { "d1:temperature": rec("temperature", 7.4, 51 * 3600_000) }, [], undefined, undefined, now);
      expect(reading.unavailableReason).toBe("stale");
      // 值仍然保留 —— 抹掉反而让人以为测点丢了
      expect(reading.text).toBe("7.4");
    });

    it("刚上报的数据不算过期", () => {
      const slot = { key: "main", deviceId: "d1", telemetryKey: "temperature" };
      const reading = readSlotValue(slot, [], { "d1:temperature": rec("temperature", 7.4, 30_000) }, [], undefined, undefined, now);
      expect(reading.unavailableReason).toBeUndefined();
    });

    it("槽位显式配更宽的阈值时按它算", () => {
      const slot = { key: "main", deviceId: "d1", telemetryKey: "t", staleAfterSec: 86400 };
      // 2 小时前：默认 600 秒会判过期，但配了 1 天就不算
      const reading = readSlotValue(slot, [], { "d1:t": rec("t", 1, 2 * 3600_000) }, [], undefined, undefined, now);
      expect(reading.unavailableReason).toBeUndefined();
    });
  });

  describe("widgetDataAgeMs", () => {
    const widget = {
      id: "m", type: "metric-card",
      slots: [{ key: "main", deviceId: "d1", telemetryKey: "temperature" }],
    } as never;

    it("返回最新一条的年龄", () => {
      const latest = { "d1:temperature": rec("temperature", 7.4, 3600_000) };
      expect(widgetDataAgeMs(widget, [], latest, undefined, now)).toBe(3600_000);
    });

    it("没有任何读数 → null（不显示标记）", () => {
      expect(widgetDataAgeMs(widget, [], {}, undefined, now)).toBeNull();
    });

    it("★ 逐台卡取范围内最新的一台（一台在上报就算这张卡不过期）", () => {
      const listWidget = {
        id: "u", type: "device-list",
        scope: { kind: "topology", topologyId: "t1", topologyName: "x" },
        slots: [{ key: "v", telemetryKey: "temperature" }],
      } as never;
      const latest = {
        // 一台停了 51 小时，一台刚刚上报
        "d1:temperature": rec("temperature", 7.4, 51 * 3600_000, "d1"),
        "d2:temperature": rec("temperature", 7.5, 10_000, "d2"),
      };
      const age = widgetDataAgeMs(listWidget, [], latest, { "topology:t1": ["d1", "d2"] }, now);
      expect(age).toBe(10_000);
    });
  });

  describe("formatDataAge", () => {
    it("按量级说人话", () => {
      expect(formatDataAge(30_000)).toBe("刚刚");
      expect(formatDataAge(5 * 60_000)).toBe("5 分钟");
      expect(formatDataAge(2 * 3600_000)).toBe("2 小时");
      expect(formatDataAge(51 * 3600_000)).toBe("2 天");
    });
  });
});

/**
 * 范围聚合（2026-11-23）。
 *
 * <p>用途：网关没上报系统级 `power_total` 时，「系统功率」用 9 台机组
 * `power` 之和顶上 —— 真实数据比空卡有用，但口径必须在 label 里写清。
 *
 * <p>最容易出的错是**把不该算的设备算进来**（泵、PLC 柜、网关）。
 * scope 指向场景拓扑时有 14 台设备，直接求和会得到「混口径」的数字，
 * 比空着更糟 —— 所以聚合前必须先按 filterText 收窄。
 */
describe("readScopedAggregate", () => {
  const now = Date.UTC(2026, 10, 23, 6, 0, 0);
  const rec = (deviceId: string, value: unknown, ageMs = 1000): TelemetryRecord => ({
    deviceId, key: "power", value: value as never, timestamp: now - ageMs, source: "guard" as const,
  });

  const latest = {
    "m1:power": rec("m1", 19.3),
    "m2:power": rec("m2", 20.1),
    "m3:power": rec("m3", 20.9),
    "pump1:power": rec("pump1", 5.5),
  };

  it("★ sum 只算传入的设备（调用方负责先过滤）", () => {
    const slot = { key: "main", telemetryKey: "power", aggregate: "sum" as const, unit: "kW", label: "9 台之和" };
    const reading = readScopedAggregate(slot, ["m1", "m2", "m3"], latest, now);
    expect(reading?.text).toBe("60.3");
    expect(reading?.numeric).toBeCloseTo(60.3, 1);
    // 泵不在列表里 → 不能被算进来
    expect(reading?.numeric).not.toBeCloseTo(65.8, 1);
  });

  it("avg / max / min", () => {
    const base = { key: "main", telemetryKey: "power", unit: "kW" };
    expect(readScopedAggregate({ ...base, aggregate: "avg" }, ["m1", "m2"], latest, now)?.text).toBe("19.7");
    expect(readScopedAggregate({ ...base, aggregate: "max" }, ["m1", "m2", "m3"], latest, now)?.text).toBe("20.9");
    expect(readScopedAggregate({ ...base, aggregate: "min" }, ["m1", "m2", "m3"], latest, now)?.text).toBe("19.3");
  });

  it("★ 跳过没上报的设备，不按 0 算", () => {
    const slot = { key: "main", telemetryKey: "power", aggregate: "sum" as const };
    // m4 没数据
    const reading = readScopedAggregate(slot, ["m1", "m4"], latest, now);
    expect(reading?.numeric).toBe(19.3);
  });

  it("一台都没有 → missing（不让 0 冒充读数）", () => {
    const slot = { key: "main", telemetryKey: "power", aggregate: "sum" as const };
    const reading = readScopedAggregate(slot, ["nobody"], latest, now);
    expect(reading?.missing).toBe(true);
    expect(reading?.bound).toBe(true);
  });

  it("没配 aggregate → null（走原路径）", () => {
    const slot = { key: "main", telemetryKey: "power" };
    expect(readScopedAggregate(slot, ["m1"], latest, now)).toBeNull();
  });

  it("★ 过期判定取最老的一条（短板效应）", () => {
    const slot = { key: "main", telemetryKey: "power", aggregate: "sum" as const };
    const mixed = {
      "m1:power": rec("m1", 19),
      // 这一台停了 51 小时
      "m2:power": rec("m2", 20, 51 * 3600_000),
    };
    const reading = readScopedAggregate(slot, ["m1", "m2"], mixed, now);
    expect(reading?.unavailableReason).toBe("stale");
    /*
     * 但值仍然给出 —— 抹掉会让人以为测点丢了。
     *
     * 格式从 "39.0" 改成 "39"（2026-11-23）：统一精度规则后整数不再带
     * 尾随 0，与单设备槽一致（同一个 39 在两处不能一个显示 39、一个 39.0）。
     */
    expect(reading?.text).toBe("39");
  });

  it("都新鲜时不判过期", () => {
    const slot = { key: "main", telemetryKey: "power", aggregate: "sum" as const };
    expect(readScopedAggregate(slot, ["m1", "m2"], latest, now)?.unavailableReason).toBeUndefined();
  });
});

/**
 * 历史聚合合并（2026-11-23）。
 *
 * <p>平台没有跨设备聚合接口，「9 台功率之和的历史」只能逐台拉再自己合并。
 * 这块最容易错的是**时间对齐**和**缺桶处理**。
 */
describe("mergeHistoryAggregate", () => {
  const H = 3_600_000; // 1 小时

  it("sum 按时间桶相加", () => {
    const a = [{ timestamp: 1000, value: 10 }, { timestamp: 1000 + H, value: 12 }];
    const b = [{ timestamp: 1000, value: 20 }, { timestamp: 1000 + H, value: 22 }];
    const out = mergeHistoryAggregate([a, b], "sum", H);
    expect(out.map((p) => p.value)).toEqual([30, 34]);
  });

  it("★ 采样时刻不一致也归到同一个桶（不按下标对齐）", () => {
    // 1# 在 10:00:01，2# 在 10:03:00 —— 同一小时内
    const a = [{ timestamp: 1000, value: 10 }];
    const b = [{ timestamp: 1000 + 179_000, value: 20 }];
    const out = mergeHistoryAggregate([a, b], "sum", H);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe(30);
  });

  it("★ 缺桶不补 0（补 0 会造成假的负荷骤降）", () => {
    const a = [{ timestamp: 1000, value: 10 }, { timestamp: 1000 + H, value: 10 }];
    // b 只有第一个小时有数据
    const b = [{ timestamp: 1000, value: 5 }];
    const out = mergeHistoryAggregate([a, b], "sum", H);
    expect(out).toHaveLength(2);
    // 第二小时只有 a 的值，不是 10+0 也不是 0
    expect(out[1]!.value).toBe(10);
  });

  it("avg / max / min", () => {
    const a = [{ timestamp: 0, value: 10 }];
    const b = [{ timestamp: 0, value: 30 }];
    expect(mergeHistoryAggregate([a, b], "avg", H)[0]!.value).toBe(20);
    expect(mergeHistoryAggregate([a, b], "max", H)[0]!.value).toBe(30);
    expect(mergeHistoryAggregate([a, b], "min", H)[0]!.value).toBe(10);
  });

  it("结果按时间升序", () => {
    const a = [{ timestamp: 2 * H, value: 1 }, { timestamp: 0, value: 2 }];
    expect(mergeHistoryAggregate([a], "sum", H).map((p) => p.timestamp)).toEqual([0, 2 * H]);
  });

  it("丢弃非数值点", () => {
    const a = [{ timestamp: 0, value: Number.NaN }, { timestamp: 0, value: 5 }];
    expect(mergeHistoryAggregate([a], "sum", H)[0]!.value).toBe(5);
  });

  it("空输入 → 空输出", () => {
    expect(mergeHistoryAggregate([], "sum", H)).toEqual([]);
    expect(mergeHistoryAggregate([[]], "sum", H)).toEqual([]);
  });
});

/**
 * 趋势图序列构造（2026-11-23）。
 *
 * <p>「趋势图能不能画出线」完全取决于这里返回的 `data.length >= 2`。
 * 两条分支容易混：
 * <ul>
 *   <li>聚合槽走 `scopedHistory`（多台之和）</li>
 *   <li>单设备槽走 store 累积（这一台）</li>
 * </ul>
 * 混用会把「9 台之和」和「单台值」画在同一张图上 —— 量纲差 9 倍，
 * 看起来像其中一条坏了。
 */
describe("buildTrendSeries", () => {
  const now = 1_800_000_000_000;
  const latest: Record<string, TelemetryRecord> = {
    "d1:power": { deviceId: "d1", key: "power", value: 20 as never, timestamp: now, source: "guard" as const },
  };

  it("★ 聚合槽只认 scopedHistory，不读 store 累积", () => {
    const series = buildTrendSeries({
      slots: [{ key: "series-0", telemetryKey: "power", aggregate: "sum" }],
      bindings: [],
      latest,
      /* store 累积里有单台值 —— 不能被用上 */
      history: { "d1:power": [{ timestamp: now, value: 20 }] },
      scopedHistory: {
        "series-0": [
          { timestamp: now - 3600_000, value: 180 },
          { timestamp: now, value: 203 },
        ],
      },
      palette: ["#0ff"],
    });
    expect(series[0]!.data).toEqual([[now - 3600_000, 180], [now, 203]]);
    expect(series[0]!.bound).toBe(true);
  });

  it("聚合槽历史不足 2 点 → bound=false（画不出线）", () => {
    const series = buildTrendSeries({
      slots: [{ key: "series-0", telemetryKey: "power", aggregate: "sum" }],
      bindings: [],
      latest,
      history: {},
      scopedHistory: { "series-0": [{ timestamp: now, value: 203 }] },
      palette: ["#0ff"],
    });
    expect(series[0]!.bound).toBe(false);
    expect(series[0]!.data).toHaveLength(1);
  });

  it("单设备槽走 store 累积", () => {
    const series = buildTrendSeries({
      slots: [{ key: "series-0", deviceId: "d1", telemetryKey: "power" }],
      bindings: [],
      latest,
      history: {
        "d1:power": [
          { timestamp: now - 1000, value: 19 },
          { timestamp: now, value: 20 },
        ],
      },
      palette: ["#0ff"],
    });
    expect(series[0]!.data).toHaveLength(2);
    expect(series[0]!.bound).toBe(true);
  });

  it("聚合槽不会因为 scopedHistory 缺失而崩", () => {
    const series = buildTrendSeries({
      slots: [{ key: "series-0", telemetryKey: "power", aggregate: "sum" }],
      bindings: [],
      latest,
      history: {},
      palette: ["#0ff"],
    });
    expect(series[0]!.data).toEqual([]);
    expect(series[0]!.bound).toBe(false);
  });

  it("name 用槽位 label（图上图例要能看懂）", () => {
    const series = buildTrendSeries({
      slots: [{ key: "series-0", telemetryKey: "power", aggregate: "sum", label: "9 台之和" }],
      bindings: [],
      latest,
      history: {},
      scopedHistory: {},
      palette: ["#0ff"],
    });
    expect(series[0]!.name).toBe("9 台之和");
  });
});

/**
 * 「选中机组」卡必须常驻（2026-11-23）。
 *
 * <p>实测：模板 `template.manifest.json` 的 `right-panels` 是 3 个 widget，
 * 而大屏右栏只显示 2 块 —— 第一块「选中机组」在没选中对象时整块消失。
 *
 * <p>根因：判据是 `selectionBindings([selectedNode, selectedEntityId])`
 * 非空才显示。打开大屏时什么都没选中，于是这块永远不出现。
 *
 * <p>更糟的是逻辑闭环：用户从没见过这张卡 → 不知道能点 →
 * 永远不会选中 → 它永不显示。判据必须改成「场景里有可选中设备」。
 */
describe("shouldDisplayWidgetInRuntime / 选中机组", () => {
  const device = {
    id: "d1", label: "模块机 1#", name: "模块机 1#", source: "platform",
  } as never;
  const binding = {
    id: "b1", deviceId: "d1", sceneEntityId: "node-1", deviceName: "模块机 1#",
    telemetryMappings: [],
  } as never;
  const widget = { id: "selected-unit", type: "selection-card", x: 0, y: 0, w: 11, h: 27 } as never;

  it("★ 没选中对象，但场景里有可绑定设备 → 显示（否则右栏少一块）", () => {
    const shown = shouldDisplayWidgetInRuntime(widget, {
      bindings: [binding],
      latest: {},
      devices: [device],
      selectedNode: null,
      selectedEntityId: null,
    } as never);
    expect(shown).toBe(true);
  });

  it("场景里根本没有绑定设备 → 不显示（空卡没意义）", () => {
    const shown = shouldDisplayWidgetInRuntime(widget, {
      bindings: [],
      latest: {},
      devices: [device],
    } as never);
    expect(shown).toBe(false);
  });

  it("选中之后照常显示", () => {
    const shown = shouldDisplayWidgetInRuntime(widget, {
      bindings: [binding],
      latest: {},
      devices: [device],
      selectedNode: "node-1",
      selectedEntityId: "node-1",
    } as never);
    expect(shown).toBe(true);
  });
});

/**
 * 能耗卡（`dataSource: "energy"`）在运行态必须显示（2026-11-25 修）。
 *
 * <p>实测事故：`plant-capacity`（碳排放核算）编辑态可见、运行态整块消失。
 * 它的数据来自平台能耗接口（按场站聚合），**不绑任何遥测槽位** ——
 * 而 `metric-card` 的判据只看 `deviceId` / `aggregate`，对能耗卡必然
 * 得出 `bound: false`，于是被 `widgetsForSurface` 过滤掉。
 *
 * <p>这类漏卡不报错、不留痕：用户只知道「这块卡不见了」。
 */
describe("shouldDisplayWidgetInRuntime / 能耗卡", () => {
  it("★ dataSource=energy 的 metric-card，没有任何遥测槽 → 仍显示", () => {
    const widget = {
      id: "plant-capacity", type: "metric-card", x: 79, y: 12.6, w: 18.6, h: 18,
      dataSource: "energy", energyMetric: "carbon",
      slots: [{ key: "main", label: "制冷量", unit: "kW" }],
    } as never;
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest: {}, devices: [],
    } as never)).toBe(true);
  });

  it("不是能耗卡、槽位也没绑 → 仍然不显示（不能因为这次放宽而漏配的卡也露出来）", () => {
    const widget = {
      id: "plain", type: "metric-card", x: 0, y: 0, w: 20, h: 20,
      slots: [{ key: "main", label: "功率", unit: "kW" }],
    } as never;
    expect(shouldDisplayWidgetInRuntime(widget, {
      bindings: [], latest: {}, devices: [],
    } as never)).toBe(false);
  });
});
