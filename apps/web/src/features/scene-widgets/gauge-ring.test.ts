import { describe, expect, it } from "vitest";
import type { TelemetryRecord } from "@idt/shared-types";
import type { SceneWidget } from "@idt/data-adapter";
import { parseWidgetSlot } from "@idt/data-adapter";
import {
  DEFAULT_GAUGE_MAX,
  readGaugeRings,
  readSlotValue,
} from "./widget-values";

/**
 * 环形仪表（gauge-ring）的取数与量程兜底。
 *
 * <p>这里钉住的核心差异：`gauge-ring` 与 `ratio-ring` 都是「值/分母」的形状，
 * 但**缺分母时结论相反** —— 仪表默认满量程，圆环报未解析。
 * 判错会让大屏画出一个「看起来正常、实际无意义」的环。
 */

function latestOf(values: Record<string, number>): Record<string, TelemetryRecord> {
  const out: Record<string, TelemetryRecord> = {};
  for (const [key, value] of Object.entries(values)) {
    out[`dev-1:${key}`] = {
      deviceId: "dev-1",
      key,
      value,
      timestamp: Date.now(),
      source: "guard",
    };
  }
  return out;
}

function gaugeWidget(slots: SceneWidget["slots"], title = "加载率"): SceneWidget {
  return { id: "g1", type: "gauge-ring", x: 2, y: 20, w: 20, h: 20, title, slots };
}

describe("parseWidgetSlot — constant", () => {
  it("解析数字常量", () => {
    expect(parseWidgetSlot({ key: "max", constant: 100 })?.constant).toBe(100);
    expect(parseWidgetSlot({ key: "max", constant: "750" })?.constant).toBe(750);
  });

  it("★ 允许 0 和负数 —— 量程可以是 0，温度下限可以是负", () => {
    expect(parseWidgetSlot({ key: "max", constant: 0 })?.constant).toBe(0);
    expect(parseWidgetSlot({ key: "min", constant: -25 })?.constant).toBe(-25);
  });

  it("★ 空字符串不能当 0（Number('') === 0 的经典坑）", () => {
    expect(parseWidgetSlot({ key: "max", constant: "" })?.constant).toBeUndefined();
    expect(parseWidgetSlot({ key: "max", constant: null })?.constant).toBeUndefined();
    expect(parseWidgetSlot({ key: "max" })?.constant).toBeUndefined();
  });

  it("非数字被丢弃", () => {
    expect(parseWidgetSlot({ key: "max", constant: "abc" })?.constant).toBeUndefined();
    expect(parseWidgetSlot({ key: "max", constant: Number.POSITIVE_INFINITY })?.constant).toBeUndefined();
  });
});

describe("readSlotValue — 常量分支", () => {
  it("常量直接成为值，不需要设备也不需要绑定", () => {
    const reading = readSlotValue({ key: "max", constant: 100, unit: "%" }, [], {});
    expect(reading.bound).toBe(true);
    expect(reading.missing).toBe(false);
    expect(reading.numeric).toBe(100);
    expect(reading.constant).toBe(100);
    expect(reading.unit).toBe("%");
  });

  it("★ 常量优先于绑定：同一槽位既填常量又绑设备时，以常量为准", () => {
    /*
     * 这不是「随便定的优先级」：量程是设计值，绑上的测点只可能是
     * 误配（或模板套用时残留）。若让绑定赢，用户改了常量却不生效，
     * 而且界面上完全看不出为什么。
     */
    const reading = readSlotValue(
      { key: "max", constant: 100, deviceId: "dev-1", telemetryKey: "total" },
      [],
      latestOf({ total: 12 }),
    );
    expect(reading.numeric).toBe(100);
    expect(reading.constant).toBe(100);
  });

  it("没填常量时行为完全不变（走原有绑定路径）", () => {
    const reading = readSlotValue(
      { key: "value", deviceId: "dev-1", telemetryKey: "load" },
      [],
      latestOf({ load: 62 }),
    );
    expect(reading.numeric).toBe(62);
    expect(reading.constant).toBeUndefined();
  });
});

describe("readGaugeRings — 值 / 量程", () => {
  it("值和量程都是测点：正常算比例", () => {
    const widget = gaugeWidget([
      { key: "value", deviceId: "dev-1", telemetryKey: "load", label: "加载率" },
      { key: "max", deviceId: "dev-1", telemetryKey: "capacity" },
    ]);
    const rings = readGaugeRings(widget, [], latestOf({ load: 62, capacity: 100 }));
    expect(rings).toHaveLength(1);
    expect(rings[0]?.resolved).toBe(true);
    expect(rings[0]?.ratio).toBeCloseTo(0.62);
    expect(rings[0]?.maxOrigin).toBe("slot");
  });

  it("★ 量程是常量（最常见用法）：/100 不需要任何设备上报", () => {
    const widget = gaugeWidget([
      { key: "value", deviceId: "dev-1", telemetryKey: "load", label: "加载率" },
      { key: "max", constant: 100, unit: "%" },
    ]);
    const rings = readGaugeRings(widget, [], latestOf({ load: 45 }));
    expect(rings[0]?.resolved).toBe(true);
    expect(rings[0]?.ratio).toBeCloseTo(0.45);
    expect(rings[0]?.maxOrigin).toBe("constant");
  });

  it("★ 完全没配量程 → 用默认 100，而不是判成未解析", () => {
    /*
     * 百分比类指标占绝大多数。要求每块仪表的模板都写一遍 `max: 100`
     * 是多余的仪式；缺省给 100 才符合「少配置」的模板库目标。
     */
    const widget = gaugeWidget([{ key: "value", deviceId: "dev-1", telemetryKey: "load" }]);
    const rings = readGaugeRings(widget, [], latestOf({ load: 45 }));
    expect(rings[0]?.resolved).toBe(true);
    expect(rings[0]?.maxNum).toBe(DEFAULT_GAUGE_MAX);
    expect(rings[0]?.maxOrigin).toBe("default");
    expect(rings[0]?.ratio).toBeCloseTo(0.45);
  });

  it("★ 配了量程槽但取不到值 → 不兜底成 100（宁可空着，不画假环）", () => {
    /*
     * 这是整套设计里最关键的取舍。用户明确配了「量程来自 capacity 测点」，
     * 那个测点没上报时，用 100 顶替会画出一个完全正常的环 ——
     * 值班员会据此以为设备在 62% 出力，而真实容量可能是 750kW。
     */
    const widget = gaugeWidget([
      { key: "value", deviceId: "dev-1", telemetryKey: "load" },
      { key: "max", deviceId: "dev-1", telemetryKey: "capacity" },
    ]);
    const rings = readGaugeRings(widget, [], latestOf({ load: 62 }));
    expect(rings[0]?.resolved).toBe(false);
    expect(rings[0]?.ratio).toBeUndefined();
    expect(rings[0]?.maxOrigin).toBe("slot");
  });

  it("值缺失时不算 resolved", () => {
    const widget = gaugeWidget([
      { key: "value", deviceId: "dev-1", telemetryKey: "load" },
      { key: "max", constant: 100 },
    ]);
    const rings = readGaugeRings(widget, [], {});
    expect(rings[0]?.resolved).toBe(false);
  });

  it("★ 量程为 0 时不算 resolved（除零保护），不抛错", () => {
    const widget = gaugeWidget([
      { key: "value", deviceId: "dev-1", telemetryKey: "load" },
      { key: "max", constant: 0 },
    ]);
    const rings = readGaugeRings(widget, [], latestOf({ load: 10 }));
    expect(rings[0]?.resolved).toBe(false);
    expect(rings[0]?.ratio).toBeUndefined();
  });

  it("比例钳在 0~1：超量程不画出格", () => {
    const widget = gaugeWidget([
      { key: "value", deviceId: "dev-1", telemetryKey: "load" },
      { key: "max", constant: 100 },
    ]);
    expect(readGaugeRings(widget, [], latestOf({ load: 250 }))[0]?.ratio).toBe(1);
    expect(readGaugeRings(widget, [], latestOf({ load: -5 }))[0]?.ratio).toBe(0);
  });

  it("支持多组仪表（value-1 / max-1 这类后缀）", () => {
    const widget = gaugeWidget([
      { key: "value-0", deviceId: "dev-1", telemetryKey: "load", label: "制冷" },
      { key: "max-0", constant: 100 },
      { key: "value-1", deviceId: "dev-1", telemetryKey: "power", label: "功率" },
      { key: "max-1", constant: 750 },
    ]);
    const rings = readGaugeRings(widget, [], latestOf({ load: 40, power: 150 }));
    expect(rings).toHaveLength(2);
    expect(rings[0]?.ratio).toBeCloseTo(0.4);
    expect(rings[1]?.ratio).toBeCloseTo(0.2);
    expect(rings[1]?.label).toBe("功率");
  });

  it("没有槽位时返回空数组，不抛错", () => {
    expect(readGaugeRings(gaugeWidget(undefined), [], {})).toEqual([]);
    expect(readGaugeRings(gaugeWidget([]), [], {})).toEqual([]);
  });
});
