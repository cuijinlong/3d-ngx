import { describe, expect, it } from "vitest";
import {
  extractFaultCodes,
  findFaultCode,
  indexFaultCodes,
  lookupFaultCodes,
} from "./fault-codes";

/**
 * 故障码字典的纯逻辑部分。
 *
 * <p>不发网络请求 —— `loadFaultCodes` 那层是薄壳，靠这里保证
 * 「区间展开、文本抽码、误报防护」三件事对。
 */
describe("indexFaultCodes", () => {
  it("把区间写法的一条记录展开成按码可查", () => {
    const dict = indexFaultCodes({
      initialized: true,
      version: 14,
      total: 2,
      entries: [
        { codes: ["CM001", "CM002", "CM003"], desc: "室外从机通讯故障" },
        { codes: ["TH702"], desc: "出水温度传感器失效" },
      ],
    });
    expect(dict.byCode.size).toBe(4);
    expect(dict.byCode.get("CM002")?.desc).toBe("室外从机通讯故障");
    expect(dict.byCode.get("TH702")?.desc).toBe("出水温度传感器失效");
  });

  it("重复码保留先到的条目", () => {
    // 手册里同一码可能两次出现（正文 + 附录口径不同），先到的即主口径
    const dict = indexFaultCodes({
      entries: [
        { codes: ["VF101"], desc: "正文口径：输入缺相" },
        { codes: ["VF101"], desc: "附录口径：直流母线电压过低" },
      ],
    });
    expect(dict.byCode.get("VF101")?.desc).toBe("正文口径：输入缺相");
  });

  it("entries 缺失或畸形时给空字典而不是抛错", () => {
    expect(indexFaultCodes({}).byCode.size).toBe(0);
    expect(indexFaultCodes({ entries: undefined }).initialized).toBe(false);
    // 缺 codes 的条目直接跳过
    const tough = indexFaultCodes({
      entries: [{ desc: "没有 codes" } as never, null as never, { codes: [""], desc: "空码" }],
    });
    expect(tough.byCode.size).toBe(0);
  });

  it("码两端的空白被清掉", () => {
    const dict = indexFaultCodes({ entries: [{ codes: [" TH702 "], desc: "x" }] });
    expect(dict.byCode.has("TH702")).toBe(true);
  });
});

describe("extractFaultCodes", () => {
  it("认出厂商字母码", () => {
    expect(extractFaultCodes("模块机 1# 报警 TH702")).toEqual(["TH702"]);
    expect(extractFaultCodes("外机报警代码 CM071")).toEqual(["CM071"]);
    expect(extractFaultCodes("VF501 与 VW201")).toEqual(["VF501", "VW201"]);
  });

  it("认出卡乐 5 位寄存器码", () => {
    expect(extractFaultCodes("机房空调 10044")).toEqual(["10044"]);
    expect(extractFaultCodes("报警 10036/10037")).toEqual(["10036", "10037"]);
  });

  it("★ 不能把 MODBUS 寄存器地址误认成故障码", () => {
    /*
     * 这是最容易出错的一条：`30001`（系统状态）和 `10036`（报警码）
     * 都是 5 位数字。数字码只认 `10` 开头，且前后不能是数字，
     * 否则寄存器地址会大量误报成故障码。
     */
    expect(extractFaultCodes("30001 系统状态")).toEqual([]);
    expect(extractFaultCodes("40051 系统开关")).toEqual([]);
    expect(extractFaultCodes("30044~30063 报警代码")).toEqual([]);
  });

  it("不被小数和带连字符的编号误触发", () => {
    expect(extractFaultCodes("温度 10.5℃")).toEqual([]);
    expect(extractFaultCodes("订单 10-123")).toEqual([]);
  });

  it("空输入返回空数组", () => {
    expect(extractFaultCodes("")).toEqual([]);
    expect(extractFaultCodes(null)).toEqual([]);
    expect(extractFaultCodes(undefined)).toEqual([]);
  });

  it("同一个码出现多次只返回一次", () => {
    expect(extractFaultCodes("TH702 又一次 TH702")).toEqual(["TH702"]);
  });

  it("字母码大小写不敏感，统一大写返回", () => {
    expect(extractFaultCodes("th702")).toEqual(["TH702"]);
  });
});

describe("lookupFaultCodes", () => {
  const dict = indexFaultCodes({
    entries: [
      { codes: ["TH702"], desc: "出水温度传感器失效", analysis: "传感器损坏", solution: "换传感器" },
      { codes: ["CM071"], desc: "主机与1#变频水泵通讯故障" },
    ],
  });

  it("命中的返回条目，未命中的忽略", () => {
    const hits = lookupFaultCodes(dict, "报警 TH702 和 ZZ999");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.desc).toBe("出水温度传感器失效");
  });

  it("同一码重复出现只返回一条", () => {
    expect(lookupFaultCodes(dict, "TH702 TH702 TH702")).toHaveLength(1);
  });

  it("按首次出现顺序返回", () => {
    const hits = lookupFaultCodes(dict, "先 CM071 再 TH702");
    expect(hits.map((h) => h.desc)).toEqual([
      "主机与1#变频水泵通讯故障",
      "出水温度传感器失效",
    ]);
  });

  it("字典为空或 null 时返回空数组，不抛错", () => {
    expect(lookupFaultCodes(null, "TH702")).toEqual([]);
    expect(lookupFaultCodes(indexFaultCodes({}), "TH702")).toEqual([]);
    expect(lookupFaultCodes(dict, "")).toEqual([]);
  });
});

describe("findFaultCode", () => {
  const dict = indexFaultCodes({ entries: [{ codes: ["TH702"], desc: "出水温度传感器失效" }] });

  it("按码精确查", () => {
    expect(findFaultCode(dict, "TH702")?.desc).toBe("出水温度传感器失效");
  });

  it("查的时候大小写和空白都能容错", () => {
    expect(findFaultCode(dict, " th702 ")?.desc).toBe("出水温度传感器失效");
  });

  it("查不到返回 null", () => {
    expect(findFaultCode(dict, "ZZ999")).toBeNull();
    expect(findFaultCode(null, "TH702")).toBeNull();
  });
});
