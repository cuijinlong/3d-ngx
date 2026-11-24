import { describe, expect, it } from "vitest";
import type { Device, DeviceBinding, SceneEntity } from "@idt/shared-types";
import { OVERVIEW_SITUATION_TEMPLATE_ID, getBuiltinScreenTemplate } from "./screen-template";
import { applyGeneratedWiring, applySceneWiring, applyScreenWiring, parseScreenWiring, reviewScreenWiring, summarizeWiringReport } from "./screen-wiring";

function device(id: string, name: string, virtual = false): Device {
  return {
    id,
    name,
    type: "hvac",
    points: [{ key: "load", label: "负荷", displayType: "number" }],
    source: "guard",
    deviceVirtual: virtual ? "virtual" : "real",
    createdAt: "",
    updatedAt: "",
  };
}

function entity(id: string, name: string): SceneEntity {
  return {
    id,
    name,
    nodeName: name,
    assetId: "asset-1",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

const wiringRaw = {
  schemaVersion: "1.0.0",
  kind: "screen-wiring",
  templateId: OVERVIEW_SITUATION_TEMPLATE_ID,
  templateVersion: 1,
  interfaceBindings: [
    { regionId: "device-status", key: "scope", source: "site", siteId: "site-1", siteName: "一号站" },
    { regionId: "metric-load", key: "main", source: "device-point", deviceId: "dev-real", telemetryKey: "load" },
    { regionId: "metric-load", key: "left", source: "device-point", deviceId: "dev-virtual", telemetryKey: "load" },
  ],
  objectBindings: [
    {
      objectName: "AHU-01",
      deviceId: "dev-real",
      deviceName: "一号空调",
      telemetryMappings: [{ field: "run", telemetryKey: "run", label: "运行" }],
      actionMappings: [{ actionId: "spin:fan", label: "风机", commandId: "start" }],
    },
    { objectName: "PUMP-99", deviceId: "dev-real" },
    { objectName: "AHU-02", deviceId: "dev-virtual" },
  ],
};

describe("screen wiring contract", () => {
  it("parses a skill wiring document and keeps the stable shape", () => {
    const parsed = parseScreenWiring(wiringRaw);
    expect(parsed?.kind).toBe("screen-wiring");
    expect(parsed?.templateId).toBe(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(parsed?.interfaceBindings.map((item) => `${item.regionId}.${item.key}`)).toEqual([
      "device-status.scope",
      "metric-load.main",
      "metric-load.left",
    ]);
    expect(parsed?.objectBindings.map((item) => item.objectName)).toEqual(["AHU-01", "PUMP-99", "AHU-02"]);
    expect(applyGeneratedWiring).toBe(applyScreenWiring);
    expect(applySceneWiring).toBe(applyScreenWiring);
    expect(parseScreenWiring({ templateId: OVERVIEW_SITUATION_TEMPLATE_ID, interfaceBindings: [], objectBindings: [] })).toBeNull();
    expect(parseScreenWiring({ kind: "other", templateId: OVERVIEW_SITUATION_TEMPLATE_ID, interfaceBindings: [], objectBindings: [] })).toBeNull();
  });

  it("applies wiring to cards and 3D objects, rejects virtual and unmatched names, and does not write rejected ids", () => {
    const parsed = parseScreenWiring(wiringRaw)!;
    const result = applyScreenWiring({
      wiring: parsed,
      layout: null,
      bindings: [],
      entities: [entity("e1", "AHU-01"), entity("e2", "AHU-02")],
      devices: [device("dev-real", "一号空调"), device("dev-virtual", "虚拟机", true)],
      sceneName: "天骄科技园",
    });
    expect(result.layout.templateId).toBe(OVERVIEW_SITUATION_TEMPLATE_ID);
    expect(result.layout.interfaceBindings?.map((item) => `${item.regionId}.${item.key}`)).toEqual([
      "device-status.scope",
      "metric-load.main",
    ]);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]?.sceneEntityId).toBe("e1");
    expect(result.bindings[0]?.deviceId).toBe("dev-real");
    expect(result.bindings[0]?.actionMappings[0]?.commandId).toBe("start");
    expect(result.report.rejectedInterfaces).toBe(1);
    expect(result.report.rejectedObjects).toBe(2);
    expect(result.report.issues.some((item) => item.includes("虚拟设备"))).toBe(true);
    expect(result.report.issues.some((item) => item.includes("PUMP-99"))).toBe(true);
    expect(JSON.stringify(result.layout.interfaceBindings)).not.toContain("dev-virtual");
    expect(JSON.stringify(result.bindings)).not.toContain("dev-virtual");
    expect(summarizeWiringReport(result.report)).toContain("未生效");
  });

  it("reviews missing required card interfaces and bound objects for the drawer", () => {
    const template = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID)!;
    expect(template.objectBinding?.matchBy).toBe("objectName");
    expect(template.objectBinding?.fields.some((item) => item.key === "targetDevice")).toBe(true);
    const layout = applyScreenWiring({
      wiring: parseScreenWiring({
        kind: "screen-wiring",
        templateId: OVERVIEW_SITUATION_TEMPLATE_ID,
        interfaceBindings: [
          { regionId: "device-status", key: "scope", source: "site", siteId: "site-1" },
        ],
        objectBindings: [{ objectName: "AHU-01", deviceId: "dev-real", deviceName: "一号空调" }],
      })!,
      entities: [entity("e1", "AHU-01")],
      devices: [device("dev-real", "一号空调")],
      sceneName: "演示站",
    }).layout;
    const review = reviewScreenWiring({
      layout,
      bindings: [{
        id: "b1",
        sceneEntityId: "e1",
        deviceId: "dev-real",
        deviceName: "一号空调",
        telemetryMappings: [],
        actionMappings: [],
      }],
      entities: [entity("e1", "AHU-01")],
      devices: [device("dev-real", "一号空调")],
    });
    const main = review.cards.find((item) => item.id === "metric-load.main");
    const scope = review.cards.find((item) => item.id === "device-status.scope");
    const left = review.cards.find((item) => item.id === "metric-load.left");
    expect(main?.ok).toBe(false);
    expect(main?.status).toBe("empty");
    expect(scope?.ok).toBe(true);
    expect(left?.ok).toBe(true);
    expect(left?.optional).toBe(true);
    expect(review.objects[0]?.ok).toBe(true);
    expect(review.objects[0]?.status).toBe("bound");
    expect(review.issueCount).toBeGreaterThan(0);
  });

  it("does not apply a virtual 3D binding even if one was already stored", () => {
    const existing: DeviceBinding[] = [{
      id: "old",
      sceneEntityId: "e1",
      deviceId: "dev-real",
      deviceName: "一号空调",
      telemetryMappings: [],
      actionMappings: [],
    }];
    const result = applyScreenWiring({
      wiring: parseScreenWiring({
        kind: "screen-wiring",
        templateId: OVERVIEW_SITUATION_TEMPLATE_ID,
        interfaceBindings: [],
        objectBindings: [{ objectName: "AHU-01", deviceId: "dev-virtual" }],
      })!,
      bindings: existing,
      entities: [entity("e1", "AHU-01")],
      devices: [device("dev-real", "一号空调"), device("dev-virtual", "虚拟机", true)],
    });
    expect(result.bindings[0]?.deviceId).toBe("dev-real");
    expect(result.report.rejectedObjects).toBe(1);
  });
});
