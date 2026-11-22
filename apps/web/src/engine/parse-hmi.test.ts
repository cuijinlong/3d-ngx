
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractGlbJson,
  formatHmiDeviceName,
  formatHmiPipeName,
  parseHmiFromGltfJson,
  parseHmiGlb,
} from "@idt/engine-adapter";
import { uniqueEntitiesFromParsed } from "../utils/hmi-entities";

describe("formatHmiDeviceName / formatHmiPipeName", () => {
  it("有位号时写成「模块机 8#」，不拼成「模块机 8（8#）」或「模块机 8 8#」", () => {
    expect(formatHmiDeviceName("模块机", "1#")).toBe("模块机 1#");
    expect(formatHmiDeviceName("模块机 8", "8#")).toBe("模块机 8#");
    expect(formatHmiDeviceName("模块机 8#", "8#")).toBe("模块机 8#");
  });

  it("管道优先用 node，避免多段都显示成同一个 no", () => {
    expect(formatHmiPipeName({ node: "L-101-1", no: "L-101", seg: 1 })).toBe("L-101-1");
    expect(formatHmiPipeName({ node: "", no: "L-101", seg: 2 })).toBe("L-101-2");
  });
});

describe("parseHmiFromGltfJson", () => {
  it("从 extras.hmi 动态读取测点和动作，不合成 start/stop", () => {
    const parsed = parseHmiFromGltfJson({
      nodes: [
        {
          name: "Root",
          extras: {
            hmi: {
              schema: "hmi-scene/1",
              name: "测试机房",
              devices: [
                {
                  node: "1",
                  name: "模块机",
                  tag: "1#",
                  actions: [{ id: "spin:fan", label: "风扇转动", clip: "1_spin_fan" }],
                  data: [{ name: "温度", val: "25", unit: "℃" }],
                },
              ],
              valves: [{ node: "V-101", typeLabel: "蝶阀", open: true, clips: { open: "V-101_open", close: "V-101_close" } }],
              pipes: [{ node: "L-101-1", no: "L-101", seg: 1, segs: 4, flow: { node: "L-101_flow", clip: "L-101_flow", on: true } }],
            },
          },
        },
      ],
      animations: [{ name: "1_spin_fan", extras: { loop: true, kind: "spin" } }],
    });
    expect(parsed.source).toBe("hmi-extras");
    expect(parsed.devices).toHaveLength(1);
    expect(parsed.devices[0]?.hasNameplateControls).toBe(false);
    expect(parsed.bindables.some((b) => b.name === "温度" && b.entityNode === "1")).toBe(true);
    expect(parsed.bindables.some((b) => b.name === "spin:fan")).toBe(true);
    expect(parsed.bindables.some((b) => b.entityNode === "V-101" && b.name === "open")).toBe(true);
    expect(parsed.bindables.some((b) => b.name === "start" || b.name === "stop")).toBe(false);
    expect(parsed.pipes[0]?.seg).toBe(1);
    expect(parsed.pipes[0]?.flowNode).toBe("L-101_flow");
    expect(parsed.animationClips?.[0]).toEqual({ name: "1_spin_fan", loop: true, kind: "spin" });
    expect(parsed.bindables.find((b) => b.entityNode === "L-101-1")?.entityName).toBe("L-101-1");
  });

  it("控制面板和屏幕只作为铭牌启停条件，不进入可绑定项，也不合成 start/stop", () => {
    const parsed = parseHmiFromGltfJson({
      nodes: [
        {
          name: "Root",
          extras: {
            hmi: {
              schema: "hmi-scene/1",
              name: "测试机房",
              devices: [
                {
                  node: "1",
                  name: "模块机",
                  tag: "1#",
                  actions: [{ id: "spin:fan", label: "风扇转动", clip: "1_spin_fan" }],
                  data: [{ name: "运行状态", val: "运行" }],
                },
              ],
            },
          },
        },
        { name: "1" },
        { name: "1_control-panel", extras: { partId: "control-panel" } },
        { name: "1_screen", extras: { partId: "screen" } },
        { name: "1_control-panel-fastener-0321-0487", extras: { partId: "control-panel-fastener-0.321-0.487" } },
      ],
    });
    expect(parsed.devices[0]?.hasNameplateControls).toBe(true);
    expect(parsed.bindables.some((b) => b.name === "start" || b.name === "stop")).toBe(false);
    expect(parsed.bindables.some((b) => b.entityKind === "button")).toBe(false);
    expect(parsed.bindables.some((b) => (b.entityNode ?? "").includes("control-panel") || (b.entityNode ?? "").includes("screen"))).toBe(false);
    const entities = uniqueEntitiesFromParsed(parsed);
    expect(entities.map((item) => item.node)).toEqual(["1"]);
    expect(entities[0]?.name).toBe("模块机 1#");
  });

  it("没有 hmi 时不按节点图伪造可绑定清单", () => {
    const parsed = parseHmiFromGltfJson({ nodes: [{ name: "Pump" }, { name: "Valve" }] });
    expect(parsed.source).toBe("node-graph");
    expect(parsed.nodeNames).toEqual(["Pump", "Valve"]);
    expect(parsed.bindables).toEqual([]);
    expect(uniqueEntitiesFromParsed(parsed)).toEqual([]);
  });
});

describe("extractGlbJson", () => {
  it("读取标准 GLB JSON chunk", () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, nodes: [] }));
    const pad = (4 - (json.length % 4)) % 4;
    const jsonLen = json.length + pad;
    const total = 12 + 8 + jsonLen;
    const buf = new ArrayBuffer(total);
    const view = new DataView(buf);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonLen, true);
    view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buf, 20, json.length).set(json);
    const doc = extractGlbJson(buf);
    expect(doc.asset).toEqual({ version: "2.0" });
    const parsed = parseHmiGlb(buf);
    expect(parsed.source).toBe("node-graph");
    expect(parsed.bindables).toEqual([]);
  });
});

describe("天骄科技园.glb（若本地有模型）", () => {
  const candidates = [
    resolve(process.cwd(), "public/models/tianjiao.glb"),
    resolve(process.cwd(), "apps/web/public/models/tianjiao.glb"),
  ];
  const file = candidates.find((item) => existsSync(item));

  it.skipIf(!file)("可点选对象为 109，不含面板/屏幕，不合成 start/stop", () => {
    const buf = readFileSync(file!);
    const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const scene = parseHmiGlb(copy);
    const entities = uniqueEntitiesFromParsed(scene);
    expect(entities).toHaveLength(109);
    expect(scene.devices).toHaveLength(32);
    expect(scene.valves).toHaveLength(13);
    expect(scene.instruments).toHaveLength(2);
    expect(scene.pipes).toHaveLength(40);
    expect(scene.fittings).toHaveLength(22);
    expect(scene.devices.filter((d) => d.hasNameplateControls)).toHaveLength(9);
    expect(scene.bindables.some((b) => b.name === "start" || b.name === "stop")).toBe(false);
    expect(scene.bindables.some((b) => b.entityKind === "button")).toBe(false);
    expect(entities.some((item) => item.node.includes("control-panel") || item.node.includes("_screen"))).toBe(false);
  });
});
