import { describe, expect, it } from "vitest";
import type { ParsedHmiScene, SceneDocument, SceneEntity } from "@idt/shared-types";
import {
  isControlDrawerOpen,
  isControlOrScreenPart,
  resolveSelectableNode,
  visibleDevicePlates,
} from "./selectable-node";

function entity(nodeName: string, name = nodeName): SceneEntity {
  return {
    id: nodeName,
    name,
    nodeName,
    assetId: "a",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

const hmi = {
  schema: "hmi-scene/1",
  name: "demo",
  devices: [
    { node: "module-9", name: "模块机", tag: "9#", actions: [], data: [], hasNameplateControls: true },
    { node: "pump-2", name: "立式管道离心泵 2", actions: [], data: [] },
  ],
  valves: [{ node: "XV-101", type: "butterfly", typeLabel: "蝶阀" }],
  instruments: [],
  pipes: [{ node: "L-101-1", no: "L-101" }],
  fittings: [{ node: "tee-2", type: "tee", typeLabel: "三通 2" }],
  bindables: [],
  rules: [],
} as unknown as ParsedHmiScene;

const document = {
  entities: [entity("module-9", "模块机 9#"), entity("pump-2"), entity("XV-101"), entity("L-101-1"), entity("tee-2")],
} as unknown as SceneDocument;

describe("resolveSelectableNode", () => {
  it("maps control panel and screen hits to the parent module", () => {
    expect(resolveSelectableNode(hmi, document, "module-9_control-panel")).toBe("module-9");
    expect(resolveSelectableNode(hmi, document, "module-9_screen")).toBe("module-9");
    expect(isControlOrScreenPart("module-9_control-panel", "module-9")).toBe(true);
    expect(isControlOrScreenPart("module-9", "module-9")).toBe(false);
  });

  it("keeps real selectable objects and treats unknown meshes as a miss", () => {
    expect(resolveSelectableNode(hmi, document, "XV-101")).toBe("XV-101");
    expect(resolveSelectableNode(hmi, document, "L-101-1")).toBe("L-101-1");
    expect(resolveSelectableNode(hmi, document, "floor-mesh")).toBeNull();
    expect(resolveSelectableNode(hmi, document, null)).toBeNull();
  });
});

describe("visibleDevicePlates and drawer open", () => {
  const plates = [{ node: "module-9" }, { node: "pump-2" }, { node: "plc-1" }];

  it("★ 只显示选中的铭牌：没有选中就一个都不显示", () => {
    expect(visibleDevicePlates(plates, null)).toEqual([]);
    expect(visibleDevicePlates(plates, undefined)).toEqual([]);
    expect(visibleDevicePlates(plates, "module-9").map((p) => p.node)).toEqual(["module-9"]);
    expect(visibleDevicePlates(plates, "pump-2").map((p) => p.node)).toEqual(["pump-2"]);
  });

  it("签收悬停不再显示铭牌：多传参数也不会生效（2026-11-25 客户要求）", () => {
    /*
     * 用 `as never` 模拟「旧代码/第三方仍按三参调用」——
     * 第三参被忽略，铭牌只跟着选中走。
     */
    const call = visibleDevicePlates as (
      plates: Array<{ node: string }>,
      selected?: string | null,
      hovered?: string | null,
    ) => Array<{ node: string }>;
    expect(call(plates, null, "pump-2")).toEqual([]);
    expect(call(plates, "module-9", "pump-2").map((p) => p.node)).toEqual(["module-9"]);
  });
  it("opens the drawer on selection or pin, never on hover alone", () => {
    expect(isControlDrawerOpen(null, false)).toBe(false);
    expect(isControlDrawerOpen("module-9", false)).toBe(true);
    expect(isControlDrawerOpen(null, true)).toBe(true);
    expect(isControlDrawerOpen(undefined, false)).toBe(false);
  });
});
