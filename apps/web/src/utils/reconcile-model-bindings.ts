import type { DeviceBinding, SceneEntity } from "@idt/shared-types";

export interface DroppedModelBinding {
  objectName: string;
  deviceName: string;
}

export interface ReconcileModelBindingsResult {
  bindings: DeviceBinding[];
  kept: number;
  dropped: DroppedModelBinding[];
}

function namesOf(entity: Pick<SceneEntity, "id" | "name" | "nodeName"> | undefined, fallbackId?: string): string[] {
  return [entity?.nodeName, entity?.name, entity?.id, fallbackId].filter((item): item is string => Boolean(item && item.trim()));
}

function sameName(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

export function describeDroppedBindings(dropped: DroppedModelBinding[]): string {
  if (!dropped.length) return "";
  const sample = dropped.slice(0, 3).map((item) => `对象「${item.objectName}」原绑定「${item.deviceName || "未命名设备"}」`).join("、");
  const more = dropped.length > 3 ? `等 ${dropped.length} 条` : "";
  return `${sample}${more}`;
}

/** 更换 GLB 时按对象名保留仍能对上的三维绑定，对不上的解绑。 */
export function reconcileBindingsOnModelReplace(input: {
  previousEntities: SceneEntity[];
  previousBindings: DeviceBinding[];
  nextEntities: SceneEntity[];
}): ReconcileModelBindingsResult {
  const dropped: DroppedModelBinding[] = [];
  const bindings: DeviceBinding[] = [];
  for (const binding of input.previousBindings) {
    const previous = input.previousEntities.find((item) => item.id === binding.sceneEntityId);
    const previousNames = namesOf(previous, binding.sceneEntityId);
    const next = input.nextEntities.find((entity) => {
      const nextNames = namesOf(entity);
      return previousNames.some((name) => nextNames.some((candidate) => sameName(name, candidate)));
    });
    if (!next) {
      dropped.push({
        objectName: previous?.name || previous?.nodeName || binding.sceneEntityId,
        deviceName: binding.deviceName,
      });
      continue;
    }
    bindings.push(next.id === binding.sceneEntityId ? binding : { ...binding, sceneEntityId: next.id });
  }
  return { bindings, kept: bindings.length, dropped };
}
