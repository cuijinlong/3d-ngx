import { describe, expect, it } from "vitest";
import type { DeviceBinding, SceneDocument } from "@idt/shared-types";
import type { SceneWidgetLayout } from "@idt/data-adapter";
import { buildAiSceneContext, buildStatsVocabulary, buildTemplateBaseline, collectDevices, collectTelemetryKeys, suggestKeysForSlot } from "./ai-context";

/*
 * AI 上下文构造（2026-11-24）。
 *
 * <p>钉住的是「AI 能不能真的绑上数据」—— 这一层少一项，
 * 它就只能猜，而猜错的产物看起来像「AI 不好用」。
 */

function binding(over: Partial<DeviceBinding> & { id: string }): DeviceBinding {
  return {
    sceneEntityId: `node-${over.id}`,
    deviceName: `设备 ${over.id}`,
    telemetryMappings: [],
    actionMappings: [],
    ...over,
  } as DeviceBinding;
}

describe("collectTelemetryKeys", () => {
  it("★ 从已有绑定收集遥测键（那是唯一能确认「键真实存在」的来源）", () => {
    const keys = collectTelemetryKeys([
      binding({
        id: "b1",
        deviceId: "d1",
        telemetryMappings: [{ field: "power", telemetryKey: "power", label: "功率", unit: "kW", displayType: "number" }],
      }),
    ]);
    expect(keys).toEqual([{ key: "power", label: "功率", unit: "kW", deviceCount: 1 }]);
  });

  it("★ 同一键出现在多台设备上只留一条，并记录出现次数", () => {
    const mk = (id: string) =>
      binding({
        id,
        deviceId: `dev-${id}`,
        telemetryMappings: [{ field: "power", telemetryKey: "power", label: "功率", displayType: "number" }],
      });
    const keys = collectTelemetryKeys([mk("a"), mk("b"), mk("c")]);
    expect(keys).toHaveLength(1);
    /* 出现次数告诉 AI「这是通用点位，还是某台特有」 */
    expect(keys[0]?.deviceCount).toBe(3);
  });

  it("★ 通用键排在前面（AI 优先挑影响面大的）", () => {
    const keys = collectTelemetryKeys([
      binding({
        id: "x",
        deviceId: "d1",
        telemetryMappings: [{ field: "temp", telemetryKey: "temp_only", label: "温度", displayType: "number" }],
      }),
      binding({
        id: "y",
        deviceId: "d2",
        telemetryMappings: [{ field: "p", telemetryKey: "power", label: "功率", displayType: "number" }],
      }),
      binding({
        id: "z",
        deviceId: "d3",
        telemetryMappings: [{ field: "p", telemetryKey: "power", label: "功率", displayType: "number" }],
      }),
    ]);
    expect(keys[0]?.key).toBe("power");
  });

  it("空键 / 空绑定 / undefined 都不产生垃圾条目", () => {
    expect(collectTelemetryKeys(undefined)).toEqual([]);
    expect(collectTelemetryKeys([])).toEqual([]);
    expect(
      collectTelemetryKeys([
        binding({
          id: "b",
          deviceId: "d",
          telemetryMappings: [
            { field: "a", telemetryKey: "   ", label: "空", displayType: "number" },
            { field: "b", telemetryKey: "", label: "空", displayType: "number" },
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("数量上限存在（prompt 有成本）", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      binding({
        id: `b${i}`,
        deviceId: `d${i}`,
        telemetryMappings: [{ field: `f${i}`, telemetryKey: `key_${i}`, label: `点位${i}`, displayType: "number" }],
      }),
    );
    expect(collectTelemetryKeys(many).length).toBeLessThanOrEqual(60);
  });
});

describe("collectDevices", () => {
  it("同一台设备绑在多个 3D 对象上只留一条", () => {
    const devices = collectDevices([
      binding({ id: "b1", deviceId: "dev-1", deviceName: "模块机 1#" }),
      binding({ id: "b2", deviceId: "dev-1", deviceName: "模块机 1#" }),
      binding({ id: "b3", deviceId: "dev-2", deviceName: "模块机 2#" }),
    ]);
    expect(devices).toEqual([
      { id: "dev-1", name: "模块机 1#" },
      { id: "dev-2", name: "模块机 2#" },
    ]);
  });

  it("资产绑定没有 deviceId 时跳过（bind-telemetry 的 deviceId 只能是设备）", () => {
    const devices = collectDevices([binding({ id: "b1", deviceName: "某个资产" })]);
    expect(devices).toEqual([]);
  });
});

describe("buildAiSceneContext", () => {
  it("★ 卡片必须带 slots —— 没有 slotKey，AI 写 bind-telemetry 必然被拒", () => {
    const layout = {
      schemaVersion: 1,
      widgets: [
        {
          id: "power-trend",
          type: "trend-chart",
          title: "机组功率趋势",
          x: 1, y: 1, w: 20, h: 20,
          slots: [
            { key: "main", label: "功率", unit: "kW", telemetryKey: "power" },
            { key: "limit", label: "上限" },
          ],
        },
      ],
    } as unknown as SceneWidgetLayout;

    const ctx = buildAiSceneContext({ layout });
    expect(ctx.widgetList[0]?.slots?.map((s) => s.key)).toEqual(["main", "limit"]);
    /* 已绑的键要带上 —— AI 据此知道「这格在刷数，改动等于换数据源」 */
    expect(ctx.widgetList[0]?.slots?.[0]?.telemetryKey).toBe("power");
  });

  it("没有槽位的卡片不塞空数组（省 prompt 且不误导）", () => {
    const layout = {
      schemaVersion: 1,
      widgets: [{ id: "title-main", type: "title", title: "总览", x: 0, y: 0, w: 100, h: 6 }],
    } as unknown as SceneWidgetLayout;
    const ctx = buildAiSceneContext({ layout });
    expect(ctx.widgetList[0]).not.toHaveProperty("slots");
  });

  it("新场景（0 绑定）如实给出空遥测键 —— 不发明数据", () => {
    const doc = { scene: { name: "新场景" }, bindings: [], platform: {} } as unknown as SceneDocument;
    const ctx = buildAiSceneContext({ document: doc });
    expect(ctx.bindings).toBe(0);
    expect(ctx.telemetryKeys).toEqual([]);
    expect(ctx.devices).toEqual([]);
  });

  it("layout 为 null 时不崩（场景还没布局）", () => {
    expect(buildAiSceneContext({ layout: null }).widgetList).toEqual([]);
  });

  it("场景名 / 场站 / 拓扑照常带上", () => {
    const doc = {
      scene: { name: "天骄科技园" },
      bindings: [],
      platform: { siteName: "生产园区", topologyName: "天骄科技园 拓扑" },
    } as unknown as SceneDocument;
    const ctx = buildAiSceneContext({ document: doc });
    expect(ctx.name).toBe("天骄科技园");
    expect(ctx.site).toBe("生产园区");
    expect(ctx.topology).toBe("天骄科技园 拓扑");
  });
});

describe("suggestKeysForSlot", () => {
  const keys = [
    { key: "power", label: "功率", unit: "kW", deviceCount: 9 },
    { key: "opening", label: "开度", unit: "%", deviceCount: 9 },
    { key: "temperature", label: "温度", unit: "℃", deviceCount: 9 },
    { key: "water_in_temp", label: "进水温度", unit: "℃", deviceCount: 1 },
  ];

  it("★ label 完全相同排第一（这是唯一不需要模型猜的情况）", () => {
    const out = suggestKeysForSlot({ label: "功率", unit: "kW" }, keys);
    expect(out[0]?.key).toBe("power");
    expect(out[0]?.reason).toBe("unit-and-label");
  });

  it("★ 单位一致但 label 不同，不能压过 label 命中的项", () => {
    /*
     * 实测踩过的坑：把「机组功率」绑到 `opening`，因为两者都带 `%`。
     * 纯单位匹配只能当兜底（reason=unit），排在所有 label 命中之后。
     */
    const out = suggestKeysForSlot({ label: "机组功率", unit: "%" }, keys);
    const openingIndex = out.findIndex((x) => x.key === "opening");
    /* 「功率」靠 label 包含命中，必须排在单纯单位命中的 opening 前面 */
    expect(out[0]?.key).toBe("power");
    if (openingIndex >= 0) expect(openingIndex).toBeGreaterThan(0);
  });

  it("label 部分包含也算命中（「进水温度」vs「温度」），但排在精确之后", () => {
    const out = suggestKeysForSlot({ label: "温度", unit: "℃" }, keys);
    expect(out[0]?.key).toBe("temperature");
    expect(out.map((x) => x.key)).toContain("water_in_temp");
  });

  it("没有任何命中时返回空数组（不编一个来凑数）", () => {
    const out = suggestKeysForSlot({ label: "完全无关的东西", unit: "MPa" }, keys);
    expect(out).toEqual([]);
  });

  it("最多 3 条（prompt 有成本，挑花眼反而更差）", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      key: `k${i}`, label: "功率", unit: "kW", deviceCount: 9,
    }));
    const out = suggestKeysForSlot({ label: "功率", unit: "kW" }, many);
    expect(out).toHaveLength(3);
  });

  it("通用键优先：同一 label 下 9 台都有的键排在 1 台特有的前面", () => {
    const out = suggestKeysForSlot({ label: "温度", unit: "℃" }, [
      { key: "one_off", label: "温度", unit: "℃", deviceCount: 1 },
      { key: "common", label: "温度", unit: "℃", deviceCount: 9 },
    ]);
    expect(out[0]?.key).toBe("common");
  });
});

describe("buildWidgetBriefs 的候选推荐接线", () => {
  it("★ 空槽位带 suggestedKeys；已绑槽位不带", () => {
    const layout = {
      schemaVersion: 1,
      widgets: [{
        id: "cap", type: "metric-card", title: "装机参数",
        x: 1, y: 1, w: 20, h: 20,
        slots: [
          { key: "main", label: "功率", unit: "kW", telemetryKey: "power" },
          { key: "left", label: "温度", unit: "℃" },
        ],
      }],
    } as unknown as SceneWidgetLayout;
    const doc = {
      scene: { name: "s" },
      bindings: [binding({
        id: "b1",
        deviceId: "d1",
        telemetryMappings: [
          { field: "power", telemetryKey: "power", label: "功率", unit: "kW", displayType: "number" },
          { field: "temperature", telemetryKey: "temperature", label: "温度", unit: "℃", displayType: "number" },
        ],
      })],
    } as unknown as SceneDocument;

    const ctx = buildAiSceneContext({ document: doc, layout });
    const slots = ctx.widgetList[0]?.slots ?? [];
    expect(slots[0]?.suggestedKeys).toBeUndefined();
    expect(slots[1]?.suggestedKeys?.[0]?.key).toBe("temperature");
  });

  it("新场景（0 绑定）不产生任何候选 —— 没键可选就不该编", () => {
    const layout = {
      schemaVersion: 1,
      widgets: [{ id: "cap", type: "metric-card", x: 1, y: 1, w: 20, h: 20, slots: [{ key: "main", label: "功率" }] }],
    } as unknown as SceneWidgetLayout;
    const ctx = buildAiSceneContext({ layout });
    expect(ctx.widgetList[0]?.slots?.[0]?.suggestedKeys).toBeUndefined();
  });
});

describe("统计口径进上下文（2026-11-24）", () => {
  function layoutWith(widgets: Array<Record<string, unknown>>) {
    return { schemaVersion: "1.0.0", widgets } as unknown as SceneWidgetLayout;
  }

  it("★ 能耗卡带上当前统计项，并标出「是类型默认」", () => {
    /*
     * 客户要求「让 AI 修改统计维度」。它得先知道这张卡现在看什么，
     * 才谈得上改。`energyMetricDefaulted` 是关键：没显式配过时，
     * AI 覆盖它是安全的；已显式配过则应该先问一句。
     */
    const ctx = buildAiSceneContext({
      layout: layoutWith([{ id: "w1", type: "metric-card", title: "用电量", x: 1, y: 1, w: 18, h: 16 }]),
    });
    const stats = ctx.widgetList[0]?.stats;
    expect(stats?.dataSource).toBe("energy");
    expect(stats?.energyMetric).toBe("usage");
    expect(stats?.energyKind).toBe("elec");
    expect(stats?.energyMetricDefaulted).toBe(true);
  });

  it("显式配过口径时不再标 defaulted", () => {
    const ctx = buildAiSceneContext({
      layout: layoutWith([{ id: "w1", type: "metric-card", energyMetric: "carbon", energyKind: "elec", x: 1, y: 1, w: 18, h: 16 }]),
    });
    expect(ctx.widgetList[0]?.stats?.energyMetric).toBe("carbon");
    expect(ctx.widgetList[0]?.stats?.energyMetricDefaulted).toBeUndefined();
  });

  it("遥测类卡片不塞 energyMetric（避免 AI 无故去改它）", () => {
    const ctx = buildAiSceneContext({
      layout: layoutWith([{ id: "d1", type: "device-list", x: 1, y: 1, w: 18, h: 30 }]),
    });
    const stats = ctx.widgetList[0]?.stats;
    expect(stats?.dataSource).toBe("telemetry");
    expect(stats?.energyMetric).toBeUndefined();
  });

  it("范围与过滤条件进上下文（换统计范围的依据）", () => {
    const ctx = buildAiSceneContext({
      layout: layoutWith([{
        id: "b1", type: "bar-compare", x: 1, y: 1, w: 18, h: 20,
        filterText: "模块机", scope: { kind: "topology", topologyId: "t1", topologyName: "冷热站" },
      }]),
    });
    expect(ctx.widgetList[0]?.filterText).toBe("模块机");
    expect(ctx.widgetList[0]?.scope).toContain("冷热站");
  });

  it("★ 统计词表随上下文下发（知识库里的口径部分）", () => {
    const vocab = buildStatsVocabulary();
    expect(vocab.dataSource.map((d) => d.value)).toEqual(["telemetry", "energy"]);
    expect(vocab.energyMetric.map((m) => m.value)).toEqual(["usage", "cost", "carbon", "tce", "trend", "ranking"]);
    expect(vocab.energyKindNote).toContain("elec");
    const ctx = buildAiSceneContext({ layout: layoutWith([]) });
    expect(ctx.statsVocabulary?.energyMetric).toHaveLength(6);
  });
});

describe("buildTemplateBaseline（实例偏离 = 用户偏好）", () => {
  it("★ 没有 templateId 时返回 undefined（不编造基线）", () => {
    expect(buildTemplateBaseline({ schemaVersion: "1.0.0", widgets: [] })).toBeUndefined();
    expect(buildTemplateBaseline(null)).toBeUndefined();
  });

  it("能识别删除 / 新增 / 挪位 / 改名四类偏离", () => {
    /*
     * 「不断修改实例化模板来和 AI 交互」的落地：这些偏离就是用户的意图信号。
     * 拿不到它，AI 分不清「模板原样」和「用户特意改的」，会好心改回去。
     */
    const baseline = buildTemplateBaseline({
      schemaVersion: "1.0.0",
      templateId: "tianjiao-heat-pump",
      widgets: [
        /* 与模板一致（标题用占位符展开后的值）→ 不该出现在偏离里 */
        { id: "title", type: "title", title: "天骄科技园 · 冷热站监控", x: 20, y: 1, w: 60, h: 6.5 },
        /* 挪位（79,61.4 → 81,40）+ 改名 */
        { id: "alarm-ticker", type: "alarm-ticker", title: "现场告警（重要）", x: 81, y: 40, w: 18.6, h: 31.6 },
        /* 用户自己加的 */
        { id: "user-added", type: "metric-card", title: "自定义", x: 2, y: 90, w: 18, h: 8 },
      ],
    } as unknown as SceneWidgetLayout, "天骄科技园");

    expect(baseline?.templateId).toBe("tianjiao-heat-pump");
    const dev = baseline?.deviations;
    /* 模板里有、实例里没 → removed */
    expect(dev?.removed.some((d) => d.id === "system-power")).toBe(true);
    /* 实例里有、模板里没 → added */
    expect(dev?.added.map((d) => d.id)).toContain("user-added");
    /* 挪位 */
    expect(dev?.moved.map((d) => d.id)).toContain("alarm-ticker");
    /* 改名 */
    expect(dev?.retitled.find((d) => d.id === "alarm-ticker")?.to).toBe("现场告警（重要）");
    /* 占位符展开后一致 → 既不算挪位也不算改名 */
    expect(dev?.moved.map((d) => d.id)).not.toContain("title");
    expect(dev?.retitled.map((d) => d.id)).not.toContain("title");
  });

  it("★ 占位符标题不被误判为「用户改过」（实测坑）", () => {
    /*
     * 模板写 `{sceneName} · 冷热站监控`，实例化后是 `天骄科技园 · 冷热站监控`。
     * 不展开就比字符串，每张带占位符的卡都会被标成改名 —— 噪音，
     * 还会让 AI 去「还原」一个从未变过的标题。
     */
    const baseline = buildTemplateBaseline({
      schemaVersion: "1.0.0",
      templateId: "tianjiao-heat-pump",
      widgets: [{ id: "title", type: "title", title: "天骄科技园 · 冷热站监控", x: 20, y: 1, w: 60, h: 6.5 }],
    } as unknown as SceneWidgetLayout, "天骄科技园");
    expect(baseline?.deviations?.retitled ?? []).toEqual([]);
  });
});
