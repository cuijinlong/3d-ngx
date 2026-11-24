import { describe, expect, it } from "vitest";
import {
  describeRange,
  evaluateRange,
  extractMetricDiagnoses,
  inferWorkingMode,
  judgeMetric,
  pickRanges,
} from "./metric-diagnosis";
import type { MetricDiagnosis } from "./metric-diagnosis";

/**
 * 工况联动的范围判据。
 *
 * <p>这是「说清为什么算异常」的核心 —— 同一个温度在制冷/制热下
 * 结论相反，判错方向比不判更糟（运维会去修没坏的东西）。
 */

/** 复刻 seed 里 water_out_temp 的真实结构（开利手册 6.1）。 */
const WATER_OUT: MetricDiagnosis = {
  normalRange: [
    { min: 5, max: 20, unit: "℃", when: "制冷工况运行中" },
    { min: 30, max: 60, unit: "℃", when: "制热工况运行中（30RQ080VHS 为 30~55）" },
  ],
  faultMeaning: "读数恒定不变、跳变或超范围 → 出水温度传感器失效（TH702）",
  actions: ["检查传感器接线", "更换温度传感器"],
  faultCodes: ["TH702"],
  docRef: "开利手册 6.1",
};

describe("extractMetricDiagnoses", () => {
  it("只收有 diagnosis 的 key", () => {
    const map = extractMetricDiagnoses({
      standardKeys: [
        { code: "water_out_temp", diagnosis: WATER_OUT },
        { code: "energy", diagnosis: null },
        { code: "reactive_reading" },
      ],
    });
    expect(map.size).toBe(1);
    expect(map.has("water_out_temp")).toBe(true);
  });

  it("★ 空壳 diagnosis 不收 —— 否则界面会画一个空白诊断块", () => {
    const map = extractMetricDiagnoses({
      standardKeys: [
        { code: "a", diagnosis: {} },
        { code: "b", diagnosis: { normalRange: [] } },
        { code: "c", diagnosis: { docRef: "" } },
        { code: "d", diagnosis: { faultCodes: [] } },
      ],
    });
    expect(map.size).toBe(0);
  });

  it("有任意一个字段就算有依据", () => {
    const map = extractMetricDiagnoses({
      standardKeys: [
        { code: "onlyDoc", diagnosis: { docRef: "手册 1.2" } },
        { code: "onlyRange", diagnosis: { normalRange: [{ max: 2, unit: "%" }] } },
        { code: "onlyCodes", diagnosis: { faultCodes: ["TH702"] } },
      ],
    });
    expect(map.size).toBe(3);
  });

  it("raw 为 null 时给空 map", () => {
    expect(extractMetricDiagnoses(null).size).toBe(0);
  });
});

describe("pickRanges — 工况过滤", () => {
  it("制冷只取制冷范围", () => {
    const ranges = pickRanges(WATER_OUT, "cooling");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.min).toBe(5);
    expect(ranges[0]?.max).toBe(20);
  });

  it("制热只取制热范围", () => {
    const ranges = pickRanges(WATER_OUT, "heating");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.min).toBe(30);
  });

  it("工况未知时全部返回 —— 让调用方自己决定怎么展示", () => {
    expect(pickRanges(WATER_OUT, null)).toHaveLength(2);
  });

  it("★ 不限工况的范围在任何工况下都保留", () => {
    // 三相不平衡率 ≤2% 与冷热无关
    const diag: MetricDiagnosis = {
      normalRange: [
        { max: 2, unit: "%" },
        { min: 5, max: 20, unit: "℃", when: "制冷工况运行中" },
      ],
    };
    expect(pickRanges(diag, "cooling")).toHaveLength(2);
    expect(pickRanges(diag, "heating")).toHaveLength(1);
    expect(pickRanges(diag, "heating")[0]?.max).toBe(2);
  });

  it("没有任何 normalRange 时返回空数组", () => {
    expect(pickRanges({ faultMeaning: "x" }, "cooling")).toEqual([]);
    expect(pickRanges(null, "cooling")).toEqual([]);
  });
});

describe("evaluateRange", () => {
  it("在范围内 → ok", () => {
    expect(evaluateRange({ min: 5, max: 20 }, 12)).toBe("ok");
    expect(evaluateRange({ min: 5, max: 20 }, 5)).toBe("ok");
    expect(evaluateRange({ min: 5, max: 20 }, 20)).toBe("ok");
  });

  it("低于下限 → low，高于上限 → high", () => {
    expect(evaluateRange({ min: 5, max: 20 }, 4.9)).toBe("low");
    expect(evaluateRange({ min: 5, max: 20 }, 20.1)).toBe("high");
  });

  it("只有单边限制时另一边不限", () => {
    expect(evaluateRange({ max: 8 }, -100)).toBe("ok");
    expect(evaluateRange({ min: 3 }, 999)).toBe("ok");
  });

  it("值为 null/undefined/NaN → unknown", () => {
    expect(evaluateRange({ min: 5, max: 20 }, null)).toBe("unknown");
    expect(evaluateRange({ min: 5, max: 20 }, undefined)).toBe("unknown");
    expect(evaluateRange({ min: 5, max: 20 }, Number.NaN)).toBe("unknown");
    expect(evaluateRange({ min: 5, max: 20 }, Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  it("两边都没有边界 → unknown，不是 ok", () => {
    // 「没有判据」不能当成「正常」—— 假装正常比报错危险
    expect(evaluateRange({}, 42)).toBe("unknown");
  });
});

describe("describeRange", () => {
  it("双边 / 单边 / 无边界", () => {
    expect(describeRange({ min: 5, max: 20, unit: "℃" })).toBe("5~20℃");
    expect(describeRange({ min: 3, unit: "℃" })).toBe("≥3℃");
    expect(describeRange({ max: 8, unit: "℃" })).toBe("≤8℃");
    expect(describeRange({})).toBe("—");
  });
});

describe("judgeMetric — 工况联动的完整判读", () => {
  it("★ 同一个 25℃：制冷下判高、制热下判低", () => {
    /*
     * 这是整套设计的核心用例。25℃ 落在制冷范围(5~20)之上、
     * 制热范围(30~60)之下 —— 方向相反，判错就会让运维去修没坏的东西。
     */
    const cooling = judgeMetric(WATER_OUT, 25, "cooling");
    expect(cooling.verdict).toBe("high");
    expect(cooling.reason).toContain("5~20℃");
    expect(cooling.reason).toContain("制冷");

    const heating = judgeMetric(WATER_OUT, 25, "heating");
    expect(heating.verdict).toBe("low");
    expect(heating.reason).toContain("30~60℃");
    expect(heating.reason).toContain("制热");
  });

  it("范围内的值给 ok，并带上工况说明", () => {
    const r = judgeMetric(WATER_OUT, 12, "cooling");
    expect(r.verdict).toBe("ok");
    expect(r.reason).toContain("正常范围");
    expect(r.reason).toContain("制冷");
  });

  it("reason 里带当前值和单位，用户才知道差多少", () => {
    const r = judgeMetric(WATER_OUT, 28, "cooling");
    expect(r.reason).toContain("当前 28℃");
  });

  it("值缺失 → unknown + 明说缺失，不判 ok", () => {
    const r = judgeMetric(WATER_OUT, null, "cooling");
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("缺失");
  });

  it("没有 diagnosis → unknown，不假装正常", () => {
    const r = judgeMetric(undefined, 42, "cooling");
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toContain("暂无官方判据");
  });

  it("★ 多工况但工况未知时，优先用通用范围而不瞎猜", () => {
    const diag: MetricDiagnosis = {
      normalRange: [
        { max: 2, unit: "%" }, // 通用
        { min: 5, max: 20, unit: "℃", when: "制冷工况运行中" },
      ],
    };
    // 工况未知，1.5% 落在通用范围里 → 应判 ok，而不是拿制冷范围去比
    expect(judgeMetric(diag, 1.5, null).verdict).toBe("ok");
    expect(judgeMetric(diag, 3, null).verdict).toBe("high");
  });

  it("不编造数字：所有边界都来自传入的 diagnosis", () => {
    const custom: MetricDiagnosis = { normalRange: [{ min: 100, max: 200, unit: "kPa" }] };
    expect(judgeMetric(custom, 150, "cooling").verdict).toBe("ok");
    expect(judgeMetric(custom, 99, "cooling").verdict).toBe("low");
  });
});

describe("inferWorkingMode", () => {
  it("协议值 0=制冷 1=制热", () => {
    expect(inferWorkingMode(0)).toBe("cooling");
    expect(inferWorkingMode(1)).toBe("heating");
  });

  it("字符串数字也认", () => {
    expect(inferWorkingMode("0")).toBe("cooling");
    expect(inferWorkingMode("1")).toBe("heating");
  });

  it("中文文本兜底", () => {
    expect(inferWorkingMode("制冷")).toBe("cooling");
    expect(inferWorkingMode("制热")).toBe("heating");
  });

  it("★ 未知值返回 null，不猜 —— 猜错工况结论会反", () => {
    expect(inferWorkingMode(2)).toBeNull();
    expect(inferWorkingMode(9)).toBeNull();
    expect(inferWorkingMode(null)).toBeNull();
    expect(inferWorkingMode(undefined)).toBeNull();
    expect(inferWorkingMode("")).toBeNull();
    expect(inferWorkingMode("未知")).toBeNull();
  });
});
