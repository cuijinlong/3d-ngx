/**
 * 这些辅助函数仍被未挂载的 BrowsePanel 使用。
 * 浏览态和运行态右侧不再出现该面板，也不再有「实时检测」「历史数据」选项卡。
 * 本文件只覆盖遗留纯函数，不约定它们出现在浏览/运行右侧。
 */
import { describe, expect, it } from "vitest";
import type { DeviceBinding, HmiDevice, TelemetryRecord } from "@idt/shared-types";
import {
  BROWSE_COPY,
  browseEmptyCopy,
  browseKind,
  buildBrowseMetrics,
} from "./browse-panel";

const moduleDevice: HmiDevice = {
  node: "m9",
  name: "模块机",
  tag: "9#",
  actions: [],
  data: [
    { name: "温度", unit: "℃", val: "99" },
    { name: "功率", unit: "kW", val: "88" },
  ],
};

const pumpDevice: HmiDevice = {
  node: "pump",
  name: "立式管道离心泵 2",
  actions: [{ id: "swing:gauge", label: "摆针" }],
  data: [],
};

describe("browseKind and copy", () => {
  it("uses 未选中设备 as the unselected empty state, not a bare bind prompt", () => {
    expect(browseKind({ selected: false, bound: false, hasBoard: false })).toBe("unselected");
    const copy = browseEmptyCopy("unselected", "live");
    expect(copy.title).toBe("未选中设备");
    expect(copy.title).toBe(BROWSE_COPY.unselected);
    expect(copy.title).not.toBe("在画面上点要连接的对象");
    expect(`${copy.title}${copy.help}`).not.toContain("在画面上点要连接的对象");
  });

  it("does not invent module-machine metrics for objects without board data", () => {
    expect(browseKind({ selected: true, bound: true, hasBoard: hasBoard(pumpDevice) })).toBe("no-board");
    const copy = browseEmptyCopy("no-board", "live");
    expect(copy.title).toBe("无看板数据");
    expect(copy.help).toContain("不套用模块机");
  });

  it("shows unbound empty copy when a board object has no target yet", () => {
    expect(browseKind({ selected: true, bound: false, hasBoard: true })).toBe("unbound");
    expect(browseEmptyCopy("unbound", "live").title).toBe("未绑定，暂无测点");
    expect(browseEmptyCopy("unbound", "history").title).toBe("未绑定，暂无历史数据");
    expect(browseEmptyCopy("unbound", "live").help).toContain("编辑");
  });

  it("uses runtime empty help that does not mention 编辑", () => {
    const live = browseEmptyCopy("unbound", "live", false);
    const history = browseEmptyCopy("unbound", "history", false);
    expect(live.title).toBe("未绑定，暂无测点");
    expect(history.title).toBe("未绑定，暂无历史数据");
    expect(live.help).not.toContain("编辑");
    expect(history.help).not.toContain("编辑");
    expect(browseEmptyCopy("unselected", "live", false).title).toBe("未选中设备");
  });
});

function hasBoard(device: HmiDevice): boolean {
  return (device.data?.length ?? 0) > 0;
}

describe("buildBrowseMetrics", () => {
  it("uses bound telemetry and never falls back to GLB sample values", () => {
    const binding: DeviceBinding = {
      id: "b1",
      sceneEntityId: "m9",
      deviceId: "dev-9",
      deviceName: "TJ-Module-09",
      telemetryMappings: [
        { field: "温度", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
      ],
      actionMappings: [],
    };
    const latest = new Map<string, TelemetryRecord>([
      ["dev-9:temperature", { deviceId: "dev-9", key: "temperature", value: 21.4, timestamp: 1, source: "mock" }],
    ]);
    const metrics = buildBrowseMetrics({ device: moduleDevice, binding, latest });
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({ field: "温度", text: "21.4 ℃", missing: false });
    expect(metrics[1]).toMatchObject({ field: "功率", text: "暂无数据", missing: true });
    expect(metrics.some((item) => item.text.includes("99") || item.text.includes("88"))).toBe(false);
  });
});
