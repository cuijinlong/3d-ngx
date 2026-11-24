import { describe, expect, it } from "vitest";
import {
  widgetRenderRect,
  DEVICE_DRAWER_RECT,
  exitDirectionOf,
  EXIT_EXEMPT_TYPES,
  shouldEnterDeviceFocus,
} from "./widget-values";

/**
 * 设备专题模式：抽屉几何 + 外围滑出方位（2026-11-23）。
 *
 * <p>钉住两件事：
 * 1. 抽屉几何**只在渲染期生效**，布局值不被改写
 * 2. 滑出方向按卡片实际方位决定（左往左、右往右、底往下）
 */

const SELECTION = { x: 81, y: 13.4, w: 16.5, h: 27.5, type: "selection-card" };
const METRIC_LEFT = { x: 2.5, y: 13.43, w: 16.5, h: 17.5, type: "metric-card" };
const METRIC_RIGHT = { x: 81, y: 41.8, w: 16.5, h: 26.9, type: "metric-card" };
const TREND_BOTTOM = { x: 3.13, y: 82.83, w: 46.5, h: 14.2, type: "trend-chart" };
const TITLE = { x: 20, y: 2, w: 60, h: 6.5, type: "title" };

describe("widgetRenderRect", () => {
  it("未聚焦时一律用布局值", () => {
    for (const w of [SELECTION, METRIC_LEFT, TITLE]) {
      expect(widgetRenderRect(w, false)).toEqual({ x: w.x, y: w.y, w: w.w, h: w.h });
    }
  });

  it("聚焦时只有 selection-card 变抽屉", () => {
    const r = widgetRenderRect(SELECTION, true);
    expect(r).toEqual(DEVICE_DRAWER_RECT);
    expect(r.w).toBeGreaterThan(SELECTION.w);
  });

  it("★ 聚焦时其他类型保持原位 —— 它们靠滑出类离开，不改几何", () => {
    /*
     * 这点很关键：如果外围卡也改几何，退出时要还原两套坐标，
     * 任何一次渲染异常都会把布局改坏。几何只给抽屉用。
     */
    for (const w of [METRIC_LEFT, METRIC_RIGHT, TREND_BOTTOM, TITLE]) {
      expect(widgetRenderRect(w, true)).toEqual({ x: w.x, y: w.y, w: w.w, h: w.h });
    }
  });

  it("★ 不改写入参对象（纯函数，布局数据零污染）", () => {
    const original = { ...SELECTION };
    widgetRenderRect(SELECTION, true);
    expect(SELECTION).toEqual(original);
  });

  it("抽屉留出 3D 视野：左边界不早于 60%，右边界不超出 100%", () => {
    expect(DEVICE_DRAWER_RECT.x).toBeGreaterThanOrEqual(60);
    expect(DEVICE_DRAWER_RECT.x + DEVICE_DRAWER_RECT.w).toBeLessThanOrEqual(100);
    expect(DEVICE_DRAWER_RECT.y + DEVICE_DRAWER_RECT.h).toBeLessThanOrEqual(100);
  });
});

describe("exitDirectionOf — 滑出方向", () => {
  it("左翼卡 → left", () => {
    expect(exitDirectionOf(METRIC_LEFT)).toBe("left");
  });

  it("右翼卡 → right", () => {
    expect(exitDirectionOf(METRIC_RIGHT)).toBe("right");
  });

  it("★ 底部靠左的卡 → down（不能用归区函数，它会判成 left）", () => {
    /*
     * 这条是实测踩出来的：TREND_BOTTOM x=3.13 靠左但 y=82.83 在底部。
     * `zoneForExistingWidget` 先判 x 再判 y，会返回 "left"，
     * 于是底部趋势卡往左滑 —— 与「向最近外侧」的直觉不符。
     */
    expect(exitDirectionOf(TREND_BOTTOM)).toBe("down");
  });

  it("底部靠右的卡 → down（不是 right）", () => {
    expect(exitDirectionOf({ x: 55, y: 82, w: 42, type: "trend-chart" })).toBe("down");
  });

  it("标题 / 说明 / 选中卡不滑出", () => {
    for (const t of ["title", "caption", "selection-card"]) {
      expect(exitDirectionOf({ x: 20, y: 2, w: 60, type: t })).toBe("none");
      expect(EXIT_EXEMPT_TYPES.has(t)).toBe(true);
    }
  });

  it("跨中线的宽卡按中心点判方向", () => {
    /* x=45 w=20 → 中心 55 → right */
    expect(exitDirectionOf({ x: 45, y: 30, w: 20, type: "metric-card" })).toBe("right");
    /* x=30 w=20 → 中心 40 → left */
    expect(exitDirectionOf({ x: 30, y: 30, w: 20, type: "metric-card" })).toBe("left");
  });
});

/**
 * 是否进入设备专题模式（2026-11-23）。
 *
 * <p>这几条锁住的是一个**真实缺陷**：客户要求删掉「选中机组」卡后，
 * 专题模式只剩「外围滑出」这一半 —— 点设备，右翼全部飞走，
 * 屏幕上没有抽屉补位，也没有返回提示。不报错，只能肉眼看出来。
 */
describe("shouldEnterDeviceFocus", () => {
  const withSelection = [{ type: "selection-card" }, { type: "metric-card" }];
  const withoutSelection = [{ type: "metric-card" }, { type: "device-list" }];

  it("运行态 + 有选中 + 布局有选中卡 → 进入专题", () => {
    expect(
      shouldEnterDeviceFocus({
        surface: "runtime",
        widgets: withSelection,
        selectedNode: "1#",
      }),
    ).toBe(true);
  });

  it("★ 布局没有选中卡 → 不进入（否则外围滑走后无人补位）", () => {
    expect(
      shouldEnterDeviceFocus({
        surface: "runtime",
        widgets: withoutSelection,
        selectedNode: "1#",
      }),
    ).toBe(false);
  });

  it("没选中任何对象 → 不进入（全景态）", () => {
    expect(
      shouldEnterDeviceFocus({
        surface: "runtime",
        widgets: withSelection,
        selectedNode: null,
        selectedEntityId: null,
      }),
    ).toBe(false);
  });

  it("实体 id 也算选中（有的对象只有 entityId 没有 nodeName）", () => {
    expect(
      shouldEnterDeviceFocus({
        surface: "runtime",
        widgets: withSelection,
        selectedEntityId: "entity-1",
      }),
    ).toBe(true);
  });

  it("编辑态一律不进入 —— 那时选设备是为了改绑定", () => {
    expect(
      shouldEnterDeviceFocus({
        surface: "editor",
        widgets: withSelection,
        selectedNode: "1#",
      }),
    ).toBe(false);
  });

  it("空布局不崩（模板还没应用时）", () => {
    expect(
      shouldEnterDeviceFocus({ surface: "runtime", widgets: [], selectedNode: "1#" }),
    ).toBe(false);
  });
});
