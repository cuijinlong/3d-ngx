import { useMemo, useState } from "react";
import { message } from "antd";
import type { CommandDef, Device, DeviceBinding, DevicePoint, ParsedHmiScene } from "@idt/shared-types";
import { getCommandProvider, getDataProvider, isRealtimePlatformDevice } from "@idt/data-adapter";
import { useSceneStore } from "../stores/scene.store";
import { createId } from "../utils/id";
import { buildDeviceBinding, planNameMatches } from "../utils/bind-by-name";

export function useBindByName(hmi: ParsedHmiScene | null, devices: Device[]) {
  const document = useSceneStore((s) => s.document);
  const setDocument = useSceneStore((s) => s.setDocument);
  const persist = useSceneStore((s) => s.persist);
  const [running, setRunning] = useState(false);
  const bindableDevices = useMemo(() => devices.filter(isRealtimePlatformDevice), [devices]);

  const matchByName = async () => {
    if (!document) {
      message.warning("还没有打开场景");
      return;
    }
    const pool = bindableDevices;
    const { plans, skippedBound, unmatched } = planNameMatches({
      entities: document.entities,
      devices: pool,
      bindables: hmi?.bindables ?? [],
      existing: document.bindings,
    });
    if (plans.length === 0) {
      if (pool.length === 0) {
        message.warning("还没有可绑定的实时设备，请先连接后端或刷新设备");
      } else if (skippedBound && unmatched === document.entities.length - skippedBound) {
        message.info(`已有绑定，未改动 ${skippedBound} 个对象`);
      } else message.info("没有按名称匹配到可连接的设备");
      return;
    }
    setRunning(true);
    try {
      const cache = new Map<string, { points: DevicePoint[]; commands: CommandDef[] }>();
      for (const plan of plans) {
        if (cache.has(plan.device.id)) continue;
        const [nextPoints, nextCommands] = await Promise.all([
          getDataProvider().listTelemetryKeys(plan.device.id),
          getCommandProvider().listCommands(plan.device.id),
        ]);
        cache.set(plan.device.id, { points: nextPoints, commands: nextCommands });
      }
      const replaced = new Set(plans.map((plan) => plan.entity.id));
      const next = document.bindings.filter(
        (item) => !replaced.has(item.sceneEntityId) && !plans.some((plan) => plan.entity.nodeName === item.sceneEntityId),
      );
      for (const plan of plans) {
        const maps = cache.get(plan.device.id)!;
        const existing = document.bindings.find(
          (item) => item.sceneEntityId === plan.entity.id || item.sceneEntityId === plan.entity.nodeName,
        );
        next.push(
          buildDeviceBinding({
            existingId: existing?.id,
            createId: () => createId("bind"),
            entity: plan.entity,
            device: plan.device,
            signals: plan.signals,
            points: maps.points,
            commands: maps.commands,
            devices: pool,
          }),
        );
      }
      const entities = document.entities.map((e) => {
        const found = next.find((b: DeviceBinding) => b.sceneEntityId === e.id || b.sceneEntityId === e.nodeName);
        /* 同上：只有带 deviceId 的绑定才能回写到 SceneEntity.binding。 */
        return found?.deviceId
          ? { ...e, binding: { deviceId: found.deviceId } }
          : { ...e, binding: undefined };
      });
      setDocument({ ...document, bindings: next, entities }, "更新设备绑定");
      try {
        await persist("按名称自动连接后自动保存");
      } catch (error) {
        message.warning(error instanceof Error ? `绑定已更新，但自动保存失败：${error.message}` : "绑定已更新，但自动保存失败，请再点一次保存");
      }
      const extras = [
        skippedBound ? `跳过 ${skippedBound} 个已绑定` : "",
        unmatched ? `${unmatched} 个无匹配` : "",
      ].filter(Boolean);
      message.success(`已按名称连接 ${plans.length} 个对象${extras.length ? `（${extras.join("，")}）` : ""}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "按名称自动连接失败");
    } finally {
      setRunning(false);
    }
  };

  return { running, matchByName };
}
