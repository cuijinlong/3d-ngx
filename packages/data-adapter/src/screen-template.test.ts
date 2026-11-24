import { describe, expect, it } from "vitest";
import overviewSituationJson from "./screen-templates/overview-situation.json";
import { WIDGET_STAGE_FRAME, buildOverviewSituationLayout, parseSceneWidgetLayout } from "./scene-widget-layout";
import {
  OVERVIEW_SITUATION_TEMPLATE_ID,
  adoptScreenTemplate,
  applyScreenTemplate,
  expandDefaultTitle,
  getBuiltinScreenTemplate,
  listBuiltinScreenTemplates,
  materializeScreenTemplate,
  parseScreenTemplate,
  rematerializeLayout,
  saveTemplateDraft,
  upsertInterfaceBinding,
  upsertRegionTitle,
} from "./screen-template";
import { pendingBindingsOfLayout } from "./pending-bindings";

describe("screen template contract", () => {
  it("parses the builtin overview situation template and keeps stable region and interface keys", () => {
    const parsed = parseScreenTemplate(overviewSituationJson);
    expect(parsed?.id).toBe(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(parsed?.name).toBe("综合态势");
    expect(parsed?.regions.map((item) => item.id)).toEqual([
      "title",
      "metric-load",
      "device-status",
      "running-count",
      "energy-trend",
    ]);
    const listed = listBuiltinScreenTemplates();
    /*
     * 不再断言「恰好 1 个」：2026-11-23 加了「天骄冷热站」模板。
     * 改断言「包含 overview-situation 且 id 唯一」，加模板时不用改这条。
     */
    expect(listed.length).toBeGreaterThanOrEqual(1);
    expect(listed.map((item) => item.id)).toContain(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(new Set(listed.map((item) => item.id)).size).toBe(listed.length);
    const builtin = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!;
    expect(builtin.regions[1]?.interfaces.map((item) => item.key)).toEqual(["filter", "main", "left", "right"]);
    expect(builtin.regions[2]?.interfaces[0]?.allowedSources).toEqual(["site", "scene-topology"]);
    expect(builtin.objectBinding?.matchBy).toBe("objectName");
    expect(builtin.objectBinding?.fields.map((item) => item.key)).toEqual([
      "targetDevice",
      "nameplatePoints",
      "behaviors",
      "controlCommands",
      "status",
    ]);
    expect(JSON.stringify(builtin)).not.toContain("数字孪生智慧园区可视化平台");
    expect(JSON.stringify(builtin)).not.toMatch(/\bDigital Twin\b|Smart Park/i);
  });

  it("expands the title with the scene name and does not keep the placeholder when the name is empty", () => {
    expect(expandDefaultTitle("{sceneName} · 综合态势", "天骄科技园")).toBe("天骄科技园 · 综合态势");
    expect(expandDefaultTitle("{sceneName} · 综合态势", "  ")).toBe("综合态势");
  });

  it("materializes the overview layout on the stage frame without demo numbers or customer data in the template", () => {
    const template = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!;
    const layout = applyScreenTemplate(undefined, template, "天骄科技园");
    expect(layout.templateId).toBe(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(layout.interfaceBindings).toBeUndefined();
    expect(layout.widgets.map((item) => item.id)).toEqual([
      "title",
      "metric-load",
      "device-status",
      "running-count",
      "energy-trend",
    ]);
    expect(layout.widgets[0]?.title).toBe("天骄科技园 · 综合态势");
    expect(layout.widgets[1]?.title).toBe("实时负荷");
    expect(layout.widgets[2]?.title).toBe("设备状态");
    expect(layout.widgets[3]?.title).toBe("运行台数");
    expect(layout.widgets[4]?.title).toBe("用能趋势");
    expect(layout.widgets[1]?.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    expect(layout.widgets[3]?.x).toBeCloseTo(WIDGET_STAGE_FRAME.rightCol.x, 0);
    expect(layout.widgets.some((item) => item.slots?.some((slot) => slot.deviceId))).toBe(false);
    expect(JSON.stringify(template)).not.toContain("dev-1");

    const filled = upsertInterfaceBinding(
      layout,
      { regionId: "metric-load", key: "main", source: "device-point", deviceId: "dev-1", telemetryKey: "power" },
      { regionId: "metric-load", key: "main" },
      "天骄科技园",
    );
    expect(filled.interfaceBindings).toEqual([
      { regionId: "metric-load", key: "main", source: "device-point", deviceId: "dev-1", telemetryKey: "power" },
    ]);
    expect(filled.widgets.find((item) => item.id === "metric-load")?.slots?.find((item) => item.key === "main")).toMatchObject({
      deviceId: "dev-1",
      telemetryKey: "power",
    });
    expect(JSON.stringify(getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID))).not.toContain("dev-1");
  });

  it("round-trips template fields through the widget layout parser and keeps bindings off the template draft", () => {
    const template = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!;
    const scoped = upsertInterfaceBinding(
      applyScreenTemplate(undefined, template, "一号站"),
      { regionId: "device-status", key: "scope", source: "site", siteId: "site-1", siteName: "一号站" },
      { regionId: "device-status", key: "scope" },
      "一号站",
    );
    const titled = upsertRegionTitle(scoped, "title", "一号站 · 综合态势", "一号站");
    const parsed = parseSceneWidgetLayout(JSON.parse(JSON.stringify(titled)));
    expect(parsed.templateId).toBe(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(parsed.interfaceBindings?.[0]).toMatchObject({ regionId: "device-status", key: "scope", siteId: "site-1" });
    expect(rematerializeLayout(parsed, "一号站").widgets[2]?.scope).toEqual({ kind: "site", siteId: "site-1", siteName: "一号站" });
  });

  it("saves an online template draft onto the scene layout without writing customer bindings into the draft", () => {
    const template = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!;
    const layout = upsertInterfaceBinding(
      applyScreenTemplate(undefined, template, "园"),
      { regionId: "metric-load", key: "main", source: "device-point", deviceId: "dev-9", telemetryKey: "kw" },
      { regionId: "metric-load", key: "main" },
      "园",
    );
    const draft = {
      ...template,
      regions: [
        ...template.regions,
        {
          id: "extra-metric",
          type: "metric-card" as const,
          zone: "left" as const,
          x: 2,
          y: 50,
          w: 20.4,
          h: 16,
          defaultTitle: "附加指标",
          interfaces: [{ key: "main", name: "主值", valueType: "number" as const, allowedSources: ["device-point" as const] }],
        },
      ],
    };
    const saved = saveTemplateDraft(layout, draft, "园");
    expect(saved.templateDraft?.regions.some((item) => item.id === "extra-metric")).toBe(true);
    expect(saved.widgets.some((item) => item.id === "extra-metric")).toBe(true);
    expect(saved.interfaceBindings).toEqual([
      { regionId: "metric-load", key: "main", source: "device-point", deviceId: "dev-9", telemetryKey: "kw" },
    ]);
    expect(JSON.stringify(saved.templateDraft)).not.toContain("dev-9");
  });

  it("adopts an existing overview layout and keeps already filled scope bindings", () => {
    const current = buildOverviewSituationLayout("天骄科技园");
    current.widgets[2] = { ...current.widgets[2]!, scope: { kind: "site", siteId: "site-2", siteName: "二号站" } };
    const adopted = adoptScreenTemplate(current, getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!, "天骄科技园");
    expect(adopted.templateId).toBe(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(adopted.interfaceBindings).toEqual([
      { regionId: "device-status", key: "scope", source: "site", siteId: "site-2", siteName: "二号站" },
    ]);
    expect(adopted.widgets.find((item) => item.id === "device-status")?.scope).toEqual({
      kind: "site",
      siteId: "site-2",
      siteName: "二号站",
    });
  });

  it("materialize does not inject sample numbers", () => {
    const layout = materializeScreenTemplate(getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!, { sceneName: "试" });
    expect(JSON.stringify(layout.widgets)).not.toMatch(/"deviceId"\s*:\s*"/);
    expect(JSON.stringify(layout)).not.toContain("数字孪生智慧园区可视化平台");
  });
});

/**
 * 模板级在线编程边界（2026-11-23）。
 *
 * <p>不同模板该允许的改动不同：客户成品大屏可能只许改绑定，
 * 空白底稿允许自由加卡。写死一个全局默认值区分不了。
 */
describe("parseScreenTemplate / aiExtension", () => {
  const base = { schemaVersion: "1.0.0", id: "t", name: "t", version: 1, regions: [] };

  it("解析完整 aiExtension", () => {
    const tpl = parseScreenTemplate({
      ...base,
      aiExtension: {
        editableTargets: ["widget.binding"],
        protectedTargets: ["templateId"],
        operations: ["bind-telemetry"],
        requiresDiffReview: true,
      },
    });
    expect(tpl?.aiExtension).toEqual({
      editableTargets: ["widget.binding"],
      protectedTargets: ["templateId"],
      operations: ["bind-telemetry"],
      requiresDiffReview: true,
    });
  });

  it("★ operations 为空时整条丢掉 —— 空的边界会锁死整屏", () => {
    const tpl = parseScreenTemplate({
      ...base,
      aiExtension: { editableTargets: [], protectedTargets: [], operations: [], requiresDiffReview: true },
    });
    // 不写入 → 调用方退回 DEFAULT_AI_EXTENSION
    expect(tpl?.aiExtension).toBeUndefined();
  });

  it("没有 aiExtension 的存量模板不受影响", () => {
    expect(parseScreenTemplate(base)?.aiExtension).toBeUndefined();
  });

  it("requiresDiffReview 缺省按 true（安全侧）", () => {
    const tpl = parseScreenTemplate({
      ...base,
      aiExtension: { operations: ["update-widget"] },
    });
    expect(tpl?.aiExtension?.requiresDiffReview).toBe(true);
  });

  it("显式 false 才免审核", () => {
    const tpl = parseScreenTemplate({
      ...base,
      aiExtension: { operations: ["update-widget"], requiresDiffReview: false },
    });
    expect(tpl?.aiExtension?.requiresDiffReview).toBe(false);
  });
});

/**
 * 模板声明常量量程（2026-11-23）。
 *
 * <p>仪表（gauge-ring）的量程是设计值，模板必须能直接写死 ——
 * 否则每套模板都要求现场「有一个上报总量的设备」，新建场景配不出仪表。
 */
describe("模板 interface 的 constant（设计值）", () => {
  const base = {
    schemaVersion: 1,
    id: "tpl-gauge",
    name: "仪表模板",
    version: "1.0.0",
    description: "测",
    regions: [
      {
        id: "g1",
        type: "gauge-ring",
        zone: "left",
        x: 2,
        y: 10,
        w: 20,
        h: 20,
        defaultTitle: "加载率",
        interfaces: [
          { key: "value-0", name: "当前值", valueType: "number", allowedSources: ["device-point"] },
          { key: "max-0", name: "满量程", valueType: "number", allowedSources: [], constant: 100 },
        ],
      },
    ],
    objectBinding: {},
    aiExtension: { editableTargets: [], protectedTargets: [], operations: [], requiresDiffReview: true },
  };

  it("生成带 constant 的槽位，且不要求绑定", () => {
    const layout = materializeScreenTemplate(parseScreenTemplate(base)!, { sceneName: "测试" });
    const slots = layout.widgets[0]?.slots ?? [];
    expect(slots).toHaveLength(2);
    const max = slots.find((s) => s.key === "max-0");
    expect(max?.constant).toBe(100);
    /* 常量槽不需要设备 */
    expect(max?.deviceId).toBeUndefined();
    expect(max?.telemetryKey).toBeUndefined();
  });

  it("★ 允许 0 与负数 —— 量程不一定是正数", () => {
    for (const constant of [0, -25]) {
      const doc = structuredClone(base);
      doc.regions[0]!.interfaces[1] = {
        key: "max-0",
        name: "下限",
        valueType: "number",
        allowedSources: [],
        constant,
      } as never;
      const layout = materializeScreenTemplate(parseScreenTemplate(doc)!, { sceneName: "测试" });
      expect(layout.widgets[0]?.slots?.find((s) => s.key === "max-0")?.constant).toBe(constant);
    }
  });

  it("★ 空字符串不当作 0（Number('') === 0 的坑）", () => {
    const doc = structuredClone(base);
    doc.regions[0]!.interfaces[1] = {
      key: "max-0",
      name: "满量程",
      valueType: "number",
      allowedSources: ["device-point"],
      constant: "",
    } as never;
    const layout = materializeScreenTemplate(parseScreenTemplate(doc)!, { sceneName: "测试" });
    expect(layout.widgets[0]?.slots?.find((s) => s.key === "max-0")?.constant).toBeUndefined();
  });

  it("常量槽不会进「待绑定」清单", () => {
    const layout = materializeScreenTemplate(parseScreenTemplate(base)!, { sceneName: "测试" });
    const widget = layout.widgets[0]!;
    const report = pendingBindingsOfLayout(layout);
    const item = report.items.find((entry) => entry.widgetId === widget.id);
    /* 只差 value-0 一个槽，不是两个 */
    expect(item?.requiredSlots).toBe(2);
    expect(item?.filledSlots).toBe(1);
  });
});
