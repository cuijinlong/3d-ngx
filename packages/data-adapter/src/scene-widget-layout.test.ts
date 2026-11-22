import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLASS_OPACITY,
  DEFAULT_WIDGET_STYLE_TOKENS,
  canAddWidgetType,
  clampGlassOpacity,
  clampWidgetRect,
  clearWidgetGlassOverride,
  effectiveGlassOpacity,
  parseSceneWidgetLayout,
  placeNewWidget,
  relayoutStageFrame,
  toTemplateWidgetLayout,
  zoneForWidgetType,
  WIDGET_SAFE_AREA,
  WIDGET_STAGE_FRAME,
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

  it("follows the cover skeleton: title at top center, wings on the sides, metrics in the bottom-center base", () => {
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

    expect(zoneForWidgetType("title")).toBe("title");
    expect(zoneForWidgetType("caption")).toBe("caption");
    expect(zoneForWidgetType("metric-card")).toBe("bottom");
    expect(zoneForWidgetType("summary-card")).toBe("bottom");
    expect(zoneForWidgetType("trend-chart")).toBe("left");
    expect(zoneForWidgetType("selection-card")).toBe("right");

    expect(title.x).toBeCloseTo(WIDGET_STAGE_FRAME.title.x, 0);
    expect(title.y).toBeLessThan(WIDGET_STAGE_FRAME.leftCol.y);
    expect(caption.x).toBeGreaterThan(title.x + title.w - 1);
    expect(left.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    expect(right.x).toBeCloseTo(WIDGET_STAGE_FRAME.rightCol.x, 0);
    expect(left.x + left.w).toBeLessThan(WIDGET_STAGE_FRAME.bottomBase.x + 0.2);
    expect(right.x).toBeGreaterThan(WIDGET_STAGE_FRAME.bottomBase.x + WIDGET_STAGE_FRAME.bottomBase.w - 0.2);

    expect(metric.y).toBeGreaterThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.y - 0.2);
    expect(summary.y).toBeGreaterThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.y - 0.2);
    expect(metric.x).toBeGreaterThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.x - 0.2);
    expect(metric.x + metric.w).toBeLessThanOrEqual(WIDGET_STAGE_FRAME.rightCol.x + 0.2);
    expect(summary.x + summary.w).toBeLessThanOrEqual(WIDGET_STAGE_FRAME.rightCol.x + 0.2);
    expect(metric.y + metric.h).toBeLessThanOrEqual(100 - WIDGET_SAFE_AREA.bottom + 0.01);

    const packed = relayoutStageFrame(parseSceneWidgetLayout({
      widgets: [
        { type: "summary-card", x: 40, y: 20, w: 10, h: 10 },
        { type: "metric-card", x: 10, y: 10, w: 10, h: 10 },
        { type: "trend-chart", x: 50, y: 50, w: 10, h: 10 },
        { type: "title", x: 0, y: 40, w: 10, h: 8 },
        { type: "caption", x: 10, y: 40, w: 10, h: 6 },
      ],
    }));
    const packedTitle = packed.widgets.find((item) => item.type === "title")!;
    const packedCaption = packed.widgets.find((item) => item.type === "caption")!;
    const packedLeft = packed.widgets.find((item) => item.type === "trend-chart")!;
    const packedBottom = packed.widgets.filter((item) => item.type === "metric-card" || item.type === "summary-card");
    expect(packedTitle.x).toBeCloseTo(WIDGET_STAGE_FRAME.title.x, 0);
    expect(packedCaption.x).toBeCloseTo(WIDGET_STAGE_FRAME.caption.x, 0);
    expect(packedLeft.x).toBeCloseTo(WIDGET_STAGE_FRAME.leftCol.x, 0);
    expect(packedBottom).toHaveLength(2);
    for (const item of packedBottom) {
      expect(item.x).toBeGreaterThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.x - 0.2);
      expect(item.x + item.w).toBeLessThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.x + WIDGET_STAGE_FRAME.bottomBase.w + 0.2);
      expect(item.y).toBeGreaterThanOrEqual(WIDGET_STAGE_FRAME.bottomBase.y - 0.2);
    }
  });

  it("stores glass opacity as a 50%–90% ratio, inherits the layout default, and never keeps rgba in the template", () => {
    expect(clampGlassOpacity(0.45)).toBe(0.5);
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
});
