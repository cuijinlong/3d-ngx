import { describe, expect, it } from "vitest";
import type { DeviceBinding, SceneEntity } from "@idt/shared-types";
import { describeDroppedBindings, reconcileBindingsOnModelReplace } from "./reconcile-model-bindings";

function entity(id: string, name: string, nodeName = id): SceneEntity {
  return {
    id,
    name,
    nodeName,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
  };
}

function binding(sceneEntityId: string, deviceName: string): DeviceBinding {
  return {
    id: `bind-${sceneEntityId}`,
    sceneEntityId,
    deviceId: `dev-${sceneEntityId}`,
    deviceName,
    telemetryMappings: [],
    actionMappings: [],
  };
}

describe("reconcileBindingsOnModelReplace", () => {
  it("keeps bindings whose object name still exists and retargets a renamed id", () => {
    const result = reconcileBindingsOnModelReplace({
      previousEntities: [entity("node-a", "1号模块机"), entity("node-b", "2号泵")],
      previousBindings: [binding("node-a", "模块机 A"), binding("node-b", "循环泵")],
      nextEntities: [entity("Mesh_A", "1号模块机", "Mesh_A"), entity("other", "冷却塔")],
    });
    expect(result.kept).toBe(1);
    expect(result.bindings[0]).toMatchObject({ sceneEntityId: "Mesh_A", deviceName: "模块机 A" });
    expect(result.dropped).toEqual([{ objectName: "2号泵", deviceName: "循环泵" }]);
    expect(describeDroppedBindings(result.dropped)).toContain("对象「2号泵」原绑定「循环泵」");
  });

  it("keeps every binding when node names are unchanged", () => {
    const entities = [entity("cab-1", "控制柜")];
    const result = reconcileBindingsOnModelReplace({
      previousEntities: entities,
      previousBindings: [binding("cab-1", "PLC")],
      nextEntities: [entity("cab-1", "控制柜")],
    });
    expect(result).toEqual({
      bindings: [binding("cab-1", "PLC")],
      kept: 1,
      dropped: [],
    });
  });
});
