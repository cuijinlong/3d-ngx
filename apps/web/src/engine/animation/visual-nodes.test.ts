
import { describe, expect, it } from "vitest";
import { pickDoorNodeNames, pickGaugeNodeNames, pickIndicatorNodeNames, pickSpinNodeNames } from "./visual-nodes";

describe("pickSpinNodeNames", () => {
  it("只转 spin_fan 父节点，不转机柜和风圈", () => {
    const names = [
      "1_air-cooled-twin-axial-fan-chiller-panel-mounted",
      "1_fan-recess",
      "1_fan-rim",
      "1_spin_fan",
      "1_fan-hub",
      "1_fan-blade",
      "1_spin_fan_2",
      "1_fan-hub_2",
      "1_fan-blade_7",
    ];
    expect(pickSpinNodeNames(names)).toEqual(["1_spin_fan", "1_spin_fan_2"]);
  });

  it("没有 spin_fan 时退回到叶轮/叶片", () => {
    expect(pickSpinNodeNames(["泵_叶轮", "泵_外壳"])).toEqual(["泵_叶轮"]);
  });
});

describe("pickIndicatorNodeNames", () => {
  it("优先 status-led / blink_led", () => {
    expect(pickIndicatorNodeNames(["1_status-led", "1_blink_led", "1_screen"])).toEqual([
      "1_status-led",
      "1_blink_led",
    ]);
  });
});

describe("pickGaugeNodeNames / pickDoorNodeNames", () => {
  it("认出摆针和柜门节点", () => {
    expect(pickGaugeNodeNames(["立式管道离心泵_swing_gauge", "立式管道离心泵_body"])).toEqual(["立式管道离心泵_swing_gauge"]);
    expect(pickDoorNodeNames(["PLC控制柜_swing_door", "PLC控制柜_blink_led"])).toEqual(["PLC控制柜_swing_door"]);
  });
});
