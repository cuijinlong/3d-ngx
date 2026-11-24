import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLASS_OPACITY,
  HUD_DEFAULT_GLASS_OPACITY,
  DEFAULT_WIDGET_STYLE_TOKENS,
  canAddWidgetType,
  clampGlassOpacity,
  clampWidgetRect,
  clearWidgetGlassOverride,
  effectiveGlassOpacity,
  effectiveHudGlassOpacity,
  isKnownWidgetType,
  parseSceneWidgetControl,
  parseSceneWidgetControlList,
  parseWidgetSlot,
  parseSceneWidgetLayout,
  toTemplateWidgetLayout,
  placeNewWidget,
  relayoutStageFrame,
  zoneForExistingWidget,
  zoneForWidgetType,
  WIDGET_SAFE_AREA,
  WIDGET_STAGE_FRAME,
  buildOverviewSituationLayout,
  overviewSituationTitle,
  layoutHasWidgets,
  widgetScopeIsBound,
  EMPTY_WIDGET_LAYOUT,
} from "./scene-widget-layout";

describe("scene widget layout", () => {
  it("parses a layout, stores style as token names, and rejects hardcoded hex colors", () => {
    const layout = parseSceneWidgetLayout({
      schemaVersion: "1.0.0",
      widgets: [
        {
          id: "w1",
          type: "metric-card",
          x: 4,
          y: 4,
          w: 18,
          h: 16,
          opacity: 0.8,
          style: { backgroundToken: "#ffffff", textToken: "ngx-color-text" },
          slots: [{ key: "value", deviceId: "dev-1", telemetryKey: "temp", label: "温度", unit: "℃" }],
        },
      ],
    });
    expect(layout.widgets[0]?.style?.backgroundToken).toBe(DEFAULT_WIDGET_STYLE_TOKENS.backgroundToken);
    expect(layout.widgets[0]?.style?.textToken).toBe("--ngx-color-text");
    expect(layout.widgets[0]?.style?.backgroundToken).not.toContain("#");
    expect(layout.widgets[0]?.slots?.[0]?.deviceId).toBe("dev-1");
  });

  it("strips customer deviceId when turning an instance layout into a reusable template", () => {
    const instance = parseSceneWidgetLayout({
      widgets: [
        {
          type: "trend-chart",
          slots: [{ key: "series", deviceId: "dev-9", telemetryKey: "power", sceneEntityId: "fan-9", label: "功率", unit: "kW" }],
        },
      ],
    });
    const template = toTemplateWidgetLayout(instance);
    expect(template.widgets[0]?.slots?.[0]).toEqual({
      key: "series",
      label: "功率",
      unit: "kW",
    });
    expect(template.widgets[0]?.slots?.[0]).not.toHaveProperty("deviceId");
    expect(template.widgets[0]?.slots?.[0]).not.toHaveProperty("telemetryKey");
    expect(template.widgets[0]?.slots?.[0]).not.toHaveProperty("sceneEntityId");
  });

  it("clamps widgets out of the drawer band and the overview button corner", () => {
    const hitOverview = clampWidgetRect({ x: 90, y: 90, w: 18, h: 16 });
    expect(hitOverview.y + hitOverview.h).toBeLessThanOrEqual(100 - WIDGET_SAFE_AREA.bottom + 0.01);
    const ov = WIDGET_SAFE_AREA.overview;
    expect(hitOverview.x + hitOverview.w).toBeLessThanOrEqual(100 - ov.right - ov.width + 0.01);
  });

  it("allows only one selection card and places new widgets inside the safe area", () => {
    let layout = parseSceneWidgetLayout({ widgets: [] });
    const first = placeNewWidget(layout, "selection-card");
    layout = { schemaVersion: "1.0.0", widgets: [first] };
    expect(canAddWidgetType(layout, "selection-card")).toBe(false);
    expect(canAddWidgetType(layout, "metric-card")).toBe(true);
    expect(first.y + first.h).toBeLessThanOrEqual(100 - WIDGET_SAFE_AREA.bottom);
  });

  it("follows the stage skeleton: title at top center, new data cards on the wings, not under the 3D view", () => {
    let layout = parseSceneWidgetLayout({ widgets: [] });
    expect(layout.widgets).toHaveLength(0);

    const title = placeNewWidget(layout, "title", { title: "场站总览" });
    layout = { schemaVersion: "1.0.0", widgets: [title] };
    const caption = placeNewWidget(layout, "caption", { title: "次级说明" });
    layout = { schemaVersion: "1.0.0", widgets: [...layout.widgets, caption] };
    const left = placeNewWidget(layout, "trend-chart");
    layout = { schemaVersion: "1.0.0", widgets: [...layout.widgets, left] };
    const right = placeNewWidget(layout, "selection-card");
    layout = { schemaVersion: "1.0.0", widgets: [...layout.widgets, right] };
    const metric = placeNewWidget(layout, "metric-card");
    layout = { schemaVersion: "1.0.0", widgets: [...layout.widgets, metric] };
    const summary = placeNewWidget(layout, "summary-card");
    layout = { schemaVersion: "1.0.0", widgets: [...layout.widgets, summary] };
    const rings = placeNewWidget(layout, "ratio-ring");
    layout = { schemaVersion: "1.0.0", widgets: [...layout.widgets, rings] };

    expect(zoneForWidgetType("title")).toBe("title");
    expect(zoneForWidgetType("caption")).toBe("caption");
    expect(zoneForWidgetType("metric-card")).toBe("left");
    expect(zoneForWidgetType("summary-card")).toBe("left");
    expect(zoneForWidgetType("ratio-ring")).toBe("left");
    expect(zoneForWidgetType("trend-chart")).toBe("left");
    expect(zoneForWidgetType("selection-card")).toBe("right");

    expect(title.x).toBeCloseTo(WIDGET_STAGE_FRAME.title.x, 0);
    expect(title.y).toBeLessThan(WIDGET_STAGE_FRAME.leftCol.y);
    expect(caption.x).toBeGreaterThan(title.x + title.w - 1);
    expect(left.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    expect(right.x).toBeCloseTo(WIDGET_STAGE_FRAME.rightCol.x, 0);
    expect(left.x + left.w).toBeLessThan(WIDGET_STAGE_FRAME.bottomBase.x + 0.2);
    expect(right.x).toBeGreaterThan(WIDGET_STAGE_FRAME.bottomBase.x + WIDGET_STAGE_FRAME.bottomBase.w - 0.2);

    for (const card of [metric, summary, rings]) {
      const onLeft = Math.abs(card.x - WIDGET_STAGE_FRAME.leftCol.x) < 0.2;
      const onRight = Math.abs(card.x - WIDGET_STAGE_FRAME.rightCol.x) < 0.2;
      expect(onLeft || onRight).toBe(true);
      expect(card.y).toBeLessThan(WIDGET_STAGE_FRAME.bottomBase.y);
      expect(card.y + card.h).toBeLessThanOrEqual(100 - WIDGET_SAFE_AREA.bottom + 0.01);
    }

    const packed = relayoutStageFrame(parseSceneWidgetLayout({
      widgets: [
        { type: "summary-card", x: 4, y: 20, w: 10, h: 10 },
        { type: "metric-card", x: 80, y: 16, w: 10, h: 10 },
        { type: "trend-chart", x: 4, y: 40, w: 10, h: 10 },
        { type: "title", x: 0, y: 40, w: 10, h: 8 },
        { type: "caption", x: 10, y: 40, w: 10, h: 6 },
        { type: "ratio-ring", x: 24, y: 70, w: 16, h: 12 },
      ],
    }));
    const packedTitle = packed.widgets.find((item) => item.type === "title")!;
    const packedCaption = packed.widgets.find((item) => item.type === "caption")!;
    const packedLeft = packed.widgets.filter((item) => item.type === "summary-card" || item.type === "trend-chart");
    const packedRight = packed.widgets.find((item) => item.type === "metric-card")!;
    const packedBottom = packed.widgets.find((item) => item.type === "ratio-ring")!;
    expect(packedTitle.x).toBeCloseTo(WIDGET_STAGE_FRAME.title.x, 0);
    expect(packedCaption.x).toBeCloseTo(WIDGET_STAGE_FRAME.caption.x, 0);
    expect(packedLeft).toHaveLength(2);
    for (const item of packedLeft) {
      expect(item.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    }
    expect(packedRight.x).toBeCloseTo(WIDGET_STAGE_FRAME.rightCol.x, 0);
    expect(zoneForExistingWidget(packedBottom)).toBe("bottom");
    expect(packedBottom.y).toBeGreaterThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.y - 0.2);
  });

  it("stores glass opacity as a 25%–90% ratio, inherits the layout default, and never keeps rgba in the template", () => {
    /* 下限 0.5 → 0.25（2026-11-23）：透明大屏需要比原来更透。 */
    expect(clampGlassOpacity(0.45)).toBe(0.45);
    expect(clampGlassOpacity(0.1)).toBe(0.25);
    expect(clampGlassOpacity(0.95)).toBe(0.9);
    expect(clampGlassOpacity(72)).toBe(0.72);
    expect(clampGlassOpacity(undefined)).toBe(DEFAULT_GLASS_OPACITY);

    const layout = parseSceneWidgetLayout({
      schemaVersion: "1.0.0",
      glassOpacity: 0.8,
      widgets: [
        { type: "metric-card", x: 4, y: 70, w: 16, h: 12 },
        { type: "trend-chart", x: 4, y: 16, w: 18, h: 22, style: { opacity: 0.6, backgroundToken: "rgba(255,0,0,0.5)" } },
        { type: "metric-card", x: 24, y: 70, w: 16, h: 12, opacity: 65 },
      ],
    });
    expect(layout.glassOpacity).toBe(0.8);
    expect(layout.widgets[0]?.style?.opacity).toBeUndefined();
    expect(effectiveGlassOpacity(layout, layout.widgets[0])).toBe(0.8);
    expect(layout.widgets[1]?.style?.opacity).toBe(0.6);
    expect(effectiveGlassOpacity(layout, layout.widgets[1])).toBe(0.6);
    expect(layout.widgets[1]?.style?.backgroundToken).toBe(DEFAULT_WIDGET_STYLE_TOKENS.backgroundToken);
    expect(JSON.stringify(layout)).not.toMatch(/rgba?\(/i);
    expect(layout.widgets[2]?.style?.opacity).toBe(0.65);

    const inherited = clearWidgetGlassOverride(layout.widgets[1]!);
    expect(inherited.style?.opacity).toBeUndefined();
    expect(effectiveGlassOpacity(layout, inherited)).toBe(0.8);

    const packed = relayoutStageFrame(layout);
    expect(packed.glassOpacity).toBe(0.8);
    const template = toTemplateWidgetLayout(layout);
    expect(template.glassOpacity).toBe(0.8);
    expect(template.widgets[1]?.style?.opacity).toBe(0.6);
    expect(template.widgets.some((item) => item.slots?.some((slot) => "deviceId" in slot && slot.deviceId))).toBe(false);
  });

  it("uses the stored glass percentage for both skins and only defaults hud opacity when unset", () => {
    /* 2026-11-23：0.64 → 0.42 → 0.30（客户两次要求运行态 3D 周围更透明）。 */
    expect(HUD_DEFAULT_GLASS_OPACITY).toBe(0.3);
    const unset = parseSceneWidgetLayout({ widgets: [{ type: "metric-card", x: 4, y: 16, w: 16, h: 12 }] });
    expect(unset.glassOpacity).toBeUndefined();
    expect(effectiveGlassOpacity(unset, unset.widgets[0])).toBe(DEFAULT_GLASS_OPACITY);
    expect(effectiveHudGlassOpacity(unset, unset.widgets[0])).toBe(HUD_DEFAULT_GLASS_OPACITY);

    const stored = parseSceneWidgetLayout({
      glassOpacity: 0.8,
      widgets: [
        { type: "metric-card", x: 4, y: 16, w: 16, h: 12 },
        { type: "ratio-ring", x: 78, y: 16, w: 16, h: 12, style: { opacity: 0.55 } },
      ],
    });
    expect(effectiveHudGlassOpacity(stored, stored.widgets[0])).toBe(0.8);
    expect(effectiveHudGlassOpacity(stored, stored.widgets[1])).toBe(0.55);
    expect(JSON.stringify(stored)).not.toMatch(/rgba?\(/i);
  });

  it("places the overview situation template on the wings without filling an empty default layout or writing sample numbers", () => {
    expect(EMPTY_WIDGET_LAYOUT.widgets).toEqual([]);
    expect(layoutHasWidgets(EMPTY_WIDGET_LAYOUT)).toBe(false);

    const layout = buildOverviewSituationLayout("天骄科技园");
    expect(overviewSituationTitle("天骄科技园")).toBe("天骄科技园 · 综合态势");
    expect(overviewSituationTitle("  ")).toBe("综合态势");
    expect(JSON.stringify(layout)).not.toContain("数字孪生智慧园区可视化平台");
    expect(JSON.stringify(layout)).not.toMatch(/\bDigital Twin\b|Smart Park/i);

    const title = layout.widgets.find((item) => item.type === "title")!;
    const metric = layout.widgets.find((item) => item.type === "metric-card")!;
    const summary = layout.widgets.find((item) => item.type === "summary-card")!;
    const ring = layout.widgets.find((item) => item.type === "ratio-ring")!;
    const trend = layout.widgets.find((item) => item.type === "trend-chart")!;
    expect(layout.widgets.map((item) => item.type)).toEqual([
      "title",
      "metric-card",
      "summary-card",
      "ratio-ring",
      "trend-chart",
    ]);
    expect(title.title).toBe("天骄科技园 · 综合态势");
    expect(metric.title).toBe("实时负荷");
    expect(summary.title).toBe("设备状态");
    expect(ring.title).toBe("运行台数");
    expect(trend.title).toBe("用能趋势");

    expect(title.x).toBeCloseTo(WIDGET_STAGE_FRAME.title.x, 0);
    expect(title.y).toBeLessThan(WIDGET_STAGE_FRAME.leftCol.y);
    expect(metric.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    expect(summary.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    expect(summary.y).toBeGreaterThan(metric.y);
    expect(ring.x).toBeCloseTo(WIDGET_STAGE_FRAME.rightCol.x, 0);
    expect(trend.x).toBeCloseTo(WIDGET_STAGE_FRAME.rightCol.x, 0);
    expect(trend.y).toBeGreaterThan(ring.y);
    for (const card of [metric, summary, ring, trend]) {
      expect(card.y).toBeLessThan(WIDGET_STAGE_FRAME.bottomBase.y);
      expect(widgetScopeIsBound(card.scope)).toBe(false);
      expect(card.slots?.some((slot) => slot.deviceId || slot.telemetryKey)).toBeFalsy();
    }
    expect(ring.slots?.map((slot) => slot.key)).toEqual(["used-0", "total-0", "used-1", "total-1"]);
    expect(layoutHasWidgets(layout)).toBe(true);

    const parsed = parseSceneWidgetLayout({
      widgets: [
        {
          type: "summary-card",
          title: "设备状态",
          scope: { kind: "site", siteId: "site-1", siteName: "一号站" },
          slots: [{ key: "value", deviceId: "dev-1", telemetryKey: "status" }],
        },
      ],
    });
    expect(parsed.widgets[0]?.scope).toEqual({ kind: "site", siteId: "site-1", siteName: "一号站" });
    const template = toTemplateWidgetLayout(parsed);
    expect(template.widgets[0]?.scope).toBeUndefined();
    expect(template.widgets[0]?.slots?.[0]?.deviceId).toBeUndefined();
    expect(template.widgets[0]?.slots?.[0]?.telemetryKey).toBeUndefined();
  });
});

/**
 * 控制按钮配置（2026-11-23）。
 *
 * 控制与「读值」是两件事：读失败只是显示「—」，发错命令会让现场设备
 * 没按预期动作。所以这里宁可整条丢掉，也不留一个点下去没反应的按钮。
 */
describe("parseSceneWidgetControl", () => {
  it("缺 deviceId 或 commandId → 整条丢弃", () => {
    expect(parseSceneWidgetControl({ commandId: "setSystemPower" })).toBeNull();
    expect(parseSceneWidgetControl({ deviceId: "gw" })).toBeNull();
    expect(parseSceneWidgetControl({ deviceId: "", commandId: "x" })).toBeNull();
    expect(parseSceneWidgetControl(null)).toBeNull();
  });

  it("保留双向命令的开/关参数（真实协议靠参数定方向，不能丢）", () => {
    const c = parseSceneWidgetControl({
      deviceId: "gw",
      commandId: "setSystemPower",
      label: "系统启停",
      kind: "toggle",
      onParams: { on: true },
      offParams: { on: false },
      stateKey: "sys_run_state",
      confirmText: "确认停机？",
    });
    expect(c).toEqual({
      key: "setSystemPower",
      deviceId: "gw",
      commandId: "setSystemPower",
      label: "系统启停",
      kind: "toggle",
      onParams: { on: true },
      offParams: { on: false },
      stateKey: "sys_run_state",
      confirmText: "确认停机？",
    });
  });

  it("没写 key 时用 commandId 兜底（同一卡里要能当 React key）", () => {
    expect(parseSceneWidgetControl({ deviceId: "d", commandId: "resetAlarm" })?.key).toBe("resetAlarm");
  });

  it("非法 kind 被丢掉，不写入未知值", () => {
    const c = parseSceneWidgetControl({ deviceId: "d", commandId: "c", kind: "switch" as never });
    expect(c?.kind).toBeUndefined();
  });

  it("onParams 不是对象时忽略（数组/字符串都不算参数）", () => {
    const c = parseSceneWidgetControl({ deviceId: "d", commandId: "c", onParams: [1, 2] as never });
    expect(c?.onParams).toBeUndefined();
  });

  it("列表解析过滤掉坏条目", () => {
    const list = parseSceneWidgetControlList([
      { deviceId: "d", commandId: "a" },
      { deviceId: "d" },
      null,
      { deviceId: "d", commandId: "b" },
    ]);
    expect(list.map((c) => c.commandId)).toEqual(["a", "b"]);
  });

  it("非数组返回空", () => {
    expect(parseSceneWidgetControlList(undefined)).toEqual([]);
    expect(parseSceneWidgetControlList({})).toEqual([]);
  });

  it("解析整个部件时带上 controls", () => {
    const layout = parseSceneWidgetLayout({
      widgets: [{
        id: "ctrl", type: "control-bar", x: 4, y: 4, w: 20, h: 12,
        controls: [{ deviceId: "gw", commandId: "setSystemPower", onParams: { on: true } }],
      }],
    });
    expect(layout.widgets[0].controls).toHaveLength(1);
  });

  it("★ 模板化时去掉 controls —— deviceId 是实例配置，带过去会指向别的客户的网关", () => {
    const layout = parseSceneWidgetLayout({
      widgets: [{
        id: "ctrl", type: "control-bar", x: 4, y: 4, w: 20, h: 12,
        controls: [{ deviceId: "gw-of-customer-a", commandId: "setSystemPower" }],
      }],
    });
    const tpl = toTemplateWidgetLayout(layout);
    expect(tpl.widgets[0].controls).toBeUndefined();
  });

  it("control-bar 是已知类型", () => {
    expect(isKnownWidgetType("control-bar")).toBe(true);
  });
});

/**
 * 槽位 displayType（2026-11-23）。
 *
 * <p>开关量（running / door / led）在网关上常是 0/1。不声明类型时
 * `formatTelemetryText` 会照数字输出，大屏上出现「1」—— 现场看不出是运行还是停机。
 */
describe("parseWidgetSlot / displayType", () => {
  it("解析三种合法值", () => {
    expect(parseWidgetSlot({ key: "s", displayType: "boolean" })?.displayType).toBe("boolean");
    expect(parseWidgetSlot({ key: "s", displayType: "number" })?.displayType).toBe("number");
    expect(parseWidgetSlot({ key: "s", displayType: "text" })?.displayType).toBe("text");
  });

  it("非法值被丢弃，不写入未知字符串", () => {
    expect(parseWidgetSlot({ key: "s", displayType: "toggle" })?.displayType).toBeUndefined();
    expect(parseWidgetSlot({ key: "s", displayType: 1 })?.displayType).toBeUndefined();
  });

  it("★ 模板化时保留 displayType（它是显示设计，不是实例绑定）", () => {
    const layout = parseSceneWidgetLayout({
      widgets: [{
        id: "u", type: "device-list", x: 2, y: 37, w: 20, h: 22,
        slots: [{ key: "state", telemetryKey: "running", displayType: "boolean" }],
      }],
    });
    const tpl = toTemplateWidgetLayout(layout);
    expect(tpl.widgets[0].slots?.[0].displayType).toBe("boolean");
    // 但测点键必须清掉（实例绑定）
    expect(tpl.widgets[0].slots?.[0].telemetryKey).toBeUndefined();
  });
});

/**
 * `parseSceneWidgetLayout` 是**白名单**解析（2026-11-23）。
 *
 * <p>没被它挑出来的字段一律丢弃。这条曾经让「数据源」功能整体失效：
 * 后端明明存住了（PUT 后读回还在），前端解析时丢掉，面板永远显示不出来 ——
 * 而且不报错，看起来像「用户没配过」。
 *
 * <p>所以这里锁住两件事：
 * ① 已知的场景级字段必须都能读回来；
 * ② 形状不对的条目要丢弃，但不能拖垮整个布局。
 */
describe("parseSceneWidgetLayout / 数据源", () => {
  const raw = {
    schemaVersion: "1.0.0",
    widgets: [
      { id: "w1", type: "metric-card", x: 0, y: 0, w: 20, h: 18 },
    ],
    dataSources: [
      {
        id: "gw",
        name: "网关",
        kind: "device",
        deviceId: "d-1",
        note: "系统级点位",
      },
      {
        id: "units",
        name: "9 台机组",
        kind: "scope",
        scope: { kind: "topology", topologyId: "t-1", topologyName: "天骄科技园" },
      },
      {
        id: "cap",
        name: "冷热站",
        kind: "asset",
        assetId: "a-1",
      },
    ],
  };

  it("★ 数据源能完整读回（否则存了也白存）", () => {
    const layout = parseSceneWidgetLayout(raw);
    expect(layout.dataSources).toHaveLength(3);
    expect(layout.dataSources?.[0]).toMatchObject({ id: "gw", kind: "device", deviceId: "d-1" });
    expect(layout.dataSources?.[1]?.scope).toMatchObject({ kind: "topology", topologyId: "t-1" });
    expect(layout.dataSources?.[2]).toMatchObject({ id: "cap", kind: "asset", assetId: "a-1" });
  });

  it("形状不对的条目被丢弃，其余照常", () => {
    const layout = parseSceneWidgetLayout({
      ...raw,
      dataSources: [
        { name: "没有 id" },
        { id: "x", name: "类型非法", kind: "table" },
        { id: "ok", name: "正常", kind: "device", deviceId: "d-9" },
      ],
    });
    expect(layout.dataSources).toHaveLength(1);
    expect(layout.dataSources?.[0]?.id).toBe("ok");
  });

  it("没有 dataSources 时不产生空字段（保持旧布局形状不变）", () => {
    const layout = parseSceneWidgetLayout({ schemaVersion: "1.0.0", widgets: [] });
    expect(layout.dataSources).toBeUndefined();
  });

  it("scope 缺 kind 时整个 scope 丢掉，但源本身保留", () => {
    const layout = parseSceneWidgetLayout({
      ...raw,
      dataSources: [{ id: "s", name: "范围", kind: "scope", scope: { topologyId: "t9" } }],
    });
    expect(layout.dataSources?.[0]?.id).toBe("s");
    expect(layout.dataSources?.[0]?.scope).toBeUndefined();
  });

  it("PUT → 解析 → 再序列化，数据源不丢（存读闭环）", () => {
    const once = parseSceneWidgetLayout(raw);
    const twice = parseSceneWidgetLayout(JSON.parse(JSON.stringify(once)));
    expect(twice.dataSources).toEqual(once.dataSources);
  });
});
