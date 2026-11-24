import { describe, expect, it } from "vitest";
import {
  PENDING_ISSUE_LABELS,
  pendingBindingOfWidget,
  pendingBindingsOfLayout,
  pendingBindingsSummary,
} from "./pending-bindings";
import type { SceneWidget } from "./scene-widget-layout";

/**
 * 待绑定清单（2026-11-23）。
 *
 * 这块最容易出的错是「把配置问题和数据问题混在一起」：
 * 设备断线时一张配好的卡被报成未绑定，用户就会去重复配置。
 * 所以这里的用例全部不传遥测 —— 只看配置。
 */

function widget(partial: Partial<SceneWidget> & Pick<SceneWidget, "id" | "type">): SceneWidget {
  return {
    x: 2, y: 2, w: 20, h: 15,
    ...partial,
  } as SceneWidget;
}

describe("pendingBindingOfWidget / 单值卡", () => {
  it("没测点 → 报 no-slot；metric-card 不要求 scope（绑具体设备）", () => {
    const item = pendingBindingOfWidget(widget({ id: "w1", type: "metric-card", title: "系统功率" }));
    expect(item.issues).toEqual(["no-slot"]);
    expect(item.requiredSlots).toBe(1);
    expect(item.filledSlots).toBe(0);
    expect(item.title).toBe("系统功率");
  });

  it("device-list 既没范围也没测点 → 两个 issue 都有（它靠范围凑设备）", () => {
    const item = pendingBindingOfWidget(widget({ id: "w1", type: "device-list", title: "机组状态" }));
    expect(item.issues).toContain("no-scope");
    expect(item.issues).toContain("no-slot");
  });

  it("有范围、设备测点都绑了 → 无 issue", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [{ key: "main", deviceId: "dev-1", telemetryKey: "power_total" }],
    }));
    expect(item.issues).toEqual([]);
    expect(item.filledSlots).toBe(1);
  });

  it("★ 绑了设备但没选测点 → no-key（与 no-slot 分开）", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [{ key: "main", deviceId: "dev-1" }],
    }));
    // 处置手段不同：no-slot 要去找设备，no-key 只要补选一个键
    expect(item.issues).toEqual(["no-key"]);
    expect(item.issues).not.toContain("no-slot");
  });

  it("只有测点没有设备 → no-slot（单值卡必须有设备）", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [{ key: "main", telemetryKey: "power_total" }],
    }));
    expect(item.issues).toEqual(["no-slot"]);
  });
});

describe("pendingBindingOfWidget / 按设备逐台的卡", () => {
  it("★ device-list 只配了键就算配好（不需要 deviceId）", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "device-list",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [{ key: "value", telemetryKey: "water_out_temp" }],
    }));
    // 这条是本次新增的核心语义：不区分的话会被误报成未绑定
    expect(item.issues).toEqual([]);
    expect(item.filledSlots).toBe(1);
  });

  it("device-list 没有键 → no-slot", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "device-list",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [{ key: "value" }],
    }));
    expect(item.issues).toEqual(["no-slot"]);
  });

  it("bar-compare 同样只认键", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "bar-compare",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [{ key: "load", telemetryKey: "load_rate" }],
    }));
    expect(item.issues).toEqual([]);
  });

  it("没选范围的 device-list 仍报 no-scope", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "device-list",
      slots: [{ key: "value", telemetryKey: "water_out_temp" }],
    }));
    expect(item.issues).toEqual(["no-scope"]);
  });
});

describe("pendingBindingOfWidget / 其他", () => {
  it("summary-card 只要范围，不要 slot", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "summary-card",
      scope: { kind: "topology", topologyId: "scene-1" },
    }));
    expect(item.issues).toEqual([]);
    expect(item.requiredSlots).toBe(0);
  });

  it("未知类型标 unknown-type，不静默跳过", () => {
    const item = pendingBindingOfWidget(widget({ id: "w1", type: "已下线的旧类型" }));
    expect(item.issues).toEqual(["unknown-type"]);
  });

  it("两个 slot 的卡要两个都配好", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "trend-chart",
      scope: { kind: "topology", topologyId: "scene-1" },
      slots: [
        { key: "series-0", deviceId: "dev-1", telemetryKey: "power_total" },
        { key: "series-1", deviceId: "dev-2" },
      ],
    }));
    expect(item.requiredSlots).toBe(2);
    expect(item.filledSlots).toBe(1);
    expect(item.issues).toEqual(["no-key"]);
  });
});

describe("pendingBindingsOfLayout", () => {
  it("全配好 → complete，items 为空", () => {
    const report = pendingBindingsOfLayout({
      widgets: [
        widget({ id: "t", type: "title", title: "标题" }),
        widget({
          id: "m", type: "metric-card",
          scope: { kind: "topology", topologyId: "s-1" },
          slots: [{ key: "main", deviceId: "d-1", telemetryKey: "power_total" }],
        }),
      ],
    });
    expect(report.complete).toBe(true);
    expect(report.items).toEqual([]);
    expect(report.total).toBe(1);
    expect(report.ready).toBe(1);
  });

  it("title / caption / selection-card 不计入总数", () => {
    const report = pendingBindingsOfLayout({
      widgets: [
        widget({ id: "t", type: "title" }),
        widget({ id: "c", type: "caption" }),
        widget({ id: "s", type: "selection-card" }),
      ],
    });
    // 它们不需要配置；算进去会让完成度永远到不了 100%
    expect(report.total).toBe(0);
    expect(report.complete).toBe(false);
    expect(pendingBindingsSummary(report)).toBe("这个布局还没有可配置的卡片");
  });

  it("部分配好 → 统计 ready / untouched", () => {
    const report = pendingBindingsOfLayout({
      widgets: [
        widget({
          id: "good", type: "metric-card",
          scope: { kind: "topology", topologyId: "s-1" },
          slots: [{ key: "main", deviceId: "d-1", telemetryKey: "power_total" }],
        }),
        widget({ id: "bad", type: "metric-card" }),
      ],
    });
    expect(report.total).toBe(2);
    expect(report.ready).toBe(1);
    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.widgetId).toBe("bad");
    // bad 一个都没配 → 计入 untouched
    expect(report.untouched).toBe(1);
    expect(report.complete).toBe(false);
  });

  it("空布局不报 complete（避免「0/0 已全部配置」的假完成）", () => {
    const report = pendingBindingsOfLayout({ widgets: [] });
    expect(report.complete).toBe(false);
    expect(report.total).toBe(0);
  });

  it("null 布局不崩", () => {
    const report = pendingBindingsOfLayout(null);
    expect(report.total).toBe(0);
  });
});

describe("pendingBindingsSummary", () => {
  it("全配好给总数", () => {
    const report = pendingBindingsOfLayout({
      widgets: [widget({
        id: "m", type: "metric-card",
        scope: { kind: "topology", topologyId: "s-1" },
        slots: [{ key: "main", deviceId: "d-1", telemetryKey: "power_total" }],
      })],
    });
    expect(pendingBindingsSummary(report)).toBe("1 块卡片已全部配置");
  });

  it("部分配好给出还差几块", () => {
    const report = pendingBindingsOfLayout({
      widgets: [
        widget({ id: "a", type: "metric-card" }),
        widget({ id: "b", type: "metric-card" }),
      ],
    });
    expect(pendingBindingsSummary(report)).toBe("0/2 块已配置，还差 2 块");
  });
});

describe("PENDING_ISSUE_LABELS", () => {
  it("四种 issue 都有中文说明", () => {
    expect(PENDING_ISSUE_LABELS["no-scope"]).toBe("未选范围");
    expect(PENDING_ISSUE_LABELS["no-slot"]).toBe("未绑定测点");
    expect(PENDING_ISSUE_LABELS["no-key"]).toBe("已选设备，未选测点");
    expect(PENDING_ISSUE_LABELS["unknown-type"]).toBe("未知部件类型");
  });
});

/**
 * 资产属性卡（2026-11-23）。
 *
 * 两处曾经判错：
 *  1. 完整性查 telemetryKey —— 资产槽用的是 attributeKey，永远查不到，
 *     结果「怎么配都显示未绑定」；
 *  2. 要求 scope —— 资产卡读的是资产自身属性，与场站设备无关。
 */
describe("pendingBindingOfWidget / 资产属性卡", () => {
  it("★ 资产槽配好（assetId + attributeKey）→ 无 issue，且不要求 scope", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      // 故意不给 scope：资产卡不该需要它
      slots: [{ key: "main", assetId: "asset-1", attributeKey: "rated_cooling_capacity", unit: "kW" }],
    }));
    expect(item.issues).toEqual([]);
    expect(item.filledSlots).toBe(1);
  });

  it("选了资产没选属性 → no-key（与设备槽语义一致）", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      slots: [{ key: "main", assetId: "asset-1" }],
    }));
    expect(item.issues).toEqual(["no-key"]);
  });

  it("资产卡与设备卡区分：metric-card 设备槽不要求 scope", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      slots: [{ key: "main", deviceId: "dev-1", telemetryKey: "power_total" }],
    }));
    expect(item.issues).toEqual([]);
  });

  it("资产卡判定：只要每槽都有 assetId，就不要求 scope", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "ratio-ring",
      slots: [
        { key: "used", assetId: "asset-1", attributeKey: "used" },
        { key: "total", assetId: "asset-1", attributeKey: "total" },
      ],
    }));
    // ratio-ring 的 scopeRequired=true，但全是资产槽 → 不报 scope
    expect(item.issues).toEqual([]);
  });
});

/**
 * scopeRequired vs usesScope（2026-11-23）。
 *
 * 「可配范围」不等于「必需范围」：
 * metric-card 绑具体设备，没范围也能读；summary-card 靠范围凑设备，没范围一台都拿不到。
 * 混为一谈会让 metric-card 永远挂着一条不影响使用的「未选范围」。
 */
describe("scopeRequired 区分", () => {
  it("metric-card 缺 scope 但不报 no-scope（可配非必需）", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "metric-card",
      slots: [{ key: "main", deviceId: "dev-1", telemetryKey: "power_total" }],
    }));
    expect(item.issues).not.toContain("no-scope");
    expect(item.issues).toEqual([]);
  });

  it("summary-card 缺 scope 要报（靠范围凑设备）", () => {
    const item = pendingBindingOfWidget(widget({ id: "w1", type: "summary-card" }));
    expect(item.issues).toEqual(["no-scope"]);
  });

  it("device-list 缺 scope 要报", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "device-list",
      slots: [{ key: "value", telemetryKey: "water_out_temp" }],
    }));
    expect(item.issues).toEqual(["no-scope"]);
  });

  it("trend-chart 缺 scope 不报（绑具体设备）", () => {
    const item = pendingBindingOfWidget(widget({
      id: "w1", type: "trend-chart",
      slots: [{ key: "series-0", deviceId: "dev-1", telemetryKey: "power_total" }],
    }));
    expect(item.issues).toEqual([]);
  });
});

/**
 * 控制条不该进待绑定清单（2026-11-23）。
 *
 * <p>待绑定清单统计的是「槽位还没绑测点」。控制条**没有槽位** ——
 * 它发命令，配置是 `controls[]`（设备 + 命令）。
 *
 * <p>如果给它标 usesSlots，清单会要求它「绑测点」，而这个要求无法满足
 * （它根本不用测点），完成度永远到不了 100% —— 用户就不再看了。
 */
describe("pending-bindings / 控制条", () => {
  const controlBar: SceneWidget = {
    id: "control-bar",
    type: "control-bar",
    x: 77.6,
    y: 48,
    w: 20.4,
    h: 11,
    controls: [{
      key: "system-power",
      deviceId: "gw-1",
      commandId: "setSystemPower",
      kind: "toggle",
      onParams: { on: true },
      offParams: { on: false },
      stateKey: "sys_run_state",
    }],
  };

  it("不进待绑定清单（没有槽位要绑）", () => {
    const report = pendingBindingsOfLayout({ widgets: [controlBar] } as never);
    expect(report.items).toEqual([]);
  });

  it("单独判定也不报 issue", () => {
    const item = pendingBindingOfWidget(controlBar);
    expect(item.issues).toEqual([]);
    expect(item.requiredSlots).toBe(0);
  });

  it("配置了 controls 但没槽位，仍不算「未知类型」", () => {
    const item = pendingBindingOfWidget(controlBar);
    expect(item.issues).not.toContain("unknown-type");
  });
});
