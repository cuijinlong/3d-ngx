
import { useCallback, useEffect, useMemo, useState } from "react";
import { message } from "antd";
import type { CommandDef, DeviceBinding } from "@idt/shared-types";
import {
  describeCommandError,
  getCommandProvider,
  getDataProvider,
  getProviderKind,
  isVirtualPlatformDevice,
} from "@idt/data-adapter";
import { applyDemoCommand } from "./demo-command-state";
import { loadTelemetrySource } from "./useTelemetrySource";
import type { DevicePlate } from "../utils/device-plates";
import {
  matchNameplateCommand,
  nameplateReasonText,
  declaredCommandParams,
  type NameplateMatch,
} from "../utils/nameplate-commands";

export type NameplateCommandState = {
  start: { enabled: boolean; reason?: string; commandId?: string; label?: string };
  stop: { enabled: boolean; reason?: string; commandId?: string; label?: string };
};

function resolveSide(match: NameplateMatch, busy: boolean): NameplateCommandState["start"] {
  if (busy) return { enabled: false, reason: nameplateReasonText("busy") };
  if (!match.ok) return { enabled: false, reason: nameplateReasonText(match.reason) };
  return { enabled: true, commandId: match.command.id, label: match.command.label || match.command.id };
}

export function useNameplateCommands(plates: DevicePlate[], bindings: DeviceBinding[]) {
  const [commandsByDevice, setCommandsByDevice] = useState<Record<string, CommandDef[]>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [virtualIds, setVirtualIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const needed = useMemo(() => {
    const ids = new Set<string>();
    for (const plate of plates) {
      if (!plate.showStartStop) continue;
      const binding = bindings.find((item) => item.sceneEntityId === plate.node);
      if (binding?.deviceId) ids.add(binding.deviceId);
    }
    return [...ids];
  }, [plates, bindings]);

  const refreshVirtualFlags = useCallback(async (deviceIds: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      deviceIds.map(async (deviceId) => {
        try {
          const device = await getDataProvider().getDevice(deviceId);
          if (!device || isVirtualPlatformDevice(device)) next.add(deviceId);
        } catch {
          /* 读失败不当成虚拟，避免误伤下发 */
        }
      }),
    );
    setVirtualIds(next);
    return next;
  }, []);

  const load = useCallback(async (deviceIds: string[]) => {
    const next: Record<string, CommandDef[]> = {};
    const nextFailed = new Set<string>();
    let errorText: string | null = null;
    await Promise.all(
      deviceIds.map(async (deviceId) => {
        try {
          next[deviceId] = await getCommandProvider().listCommands(deviceId);
        } catch (error) {
          nextFailed.add(deviceId);
          errorText = describeCommandError(error).message;
        }
      }),
    );
    setCommandsByDevice((prev) => ({ ...prev, ...next }));
    setFailed((prev) => {
      const merged = new Set(prev);
      for (const id of deviceIds) {
        if (nextFailed.has(id)) merged.add(id);
        else merged.delete(id);
      }
      return merged;
    });
    setListError(errorText);
    if (errorText) message.warning(`命令列表暂时读不到，已保留上次选项。${errorText}`);
    return { commands: next, failed: nextFailed };
  }, []);

  useEffect(() => {
    if (needed.length === 0) return;
    void refreshVirtualFlags(needed);
    void load(needed);
  }, [needed.join("|"), load, refreshVirtualFlags]);

  const stateByNode = useMemo(() => {
    const map: Record<string, NameplateCommandState> = {};
    for (const plate of plates) {
      if (!plate.showStartStop) continue;
      const binding = bindings.find((item) => item.sceneEntityId === plate.node);
      if (!binding?.deviceId) {
        map[plate.node] = {
          start: { enabled: false, reason: nameplateReasonText("unbound") },
          stop: { enabled: false, reason: nameplateReasonText("unbound") },
        };
        continue;
      }
      if (virtualIds.has(binding.deviceId)) {
        map[plate.node] = {
          start: { enabled: false, reason: "绑定已失效（虚拟设备）" },
          stop: { enabled: false, reason: "绑定已失效（虚拟设备）" },
        };
        continue;
      }
      const cached = commandsByDevice[binding.deviceId];
      if (failed.has(binding.deviceId) && !cached) {
        map[plate.node] = {
          start: { enabled: false, reason: nameplateReasonText("list-failed") },
          stop: { enabled: false, reason: nameplateReasonText("list-failed") },
        };
        continue;
      }
      const list = cached ?? [];
      const waiting = busy?.startsWith(`${plate.node}:`) ?? false;
      map[plate.node] = {
        start: resolveSide(matchNameplateCommand("start", list), waiting),
        stop: resolveSide(matchNameplateCommand("stop", list), waiting),
      };
    }
    return map;
  }, [plates, bindings, commandsByDevice, failed, virtualIds, busy]);

  const send = useCallback(
    async (node: string, kind: "start" | "stop") => {
      const binding = bindings.find((item) => item.sceneEntityId === node);
      if (!binding?.deviceId) {
        message.warning(nameplateReasonText("unbound"));
        return;
      }
      setBusy(`${node}:${kind}`);
      try {
        const device = await getDataProvider().getDevice(binding.deviceId);
        if (!device || isVirtualPlatformDevice(device)) {
          setVirtualIds((prev) => new Set(prev).add(binding.deviceId));
          message.error(device && isVirtualPlatformDevice(device) ? "绑定已失效（虚拟设备）" : "未绑定目标设备");
          return;
        }
        const { commands, failed: nextFailed } = await load([binding.deviceId]);
        const list = commands[binding.deviceId] ?? commandsByDevice[binding.deviceId] ?? [];
        if (nextFailed.has(binding.deviceId) && list.length === 0) {
          message.error(nameplateReasonText("list-failed"));
          return;
        }
        if (nextFailed.has(binding.deviceId)) {
          message.warning("命令列表暂时读不到，已按上次选项匹配");
        }
        const match = matchNameplateCommand(kind, list);
        if (!match.ok) {
          message.warning(nameplateReasonText(match.reason));
          return;
        }
        const demo = loadTelemetrySource() === "demo";
        const live = loadTelemetrySource() === "live" && getProviderKind() === "guard";
        const label = match.command.label || (kind === "start" ? "启动" : "停止");
        if (live) {
          try {
            await getCommandProvider().sendCommand(binding.deviceId, match.command.id, declaredCommandParams(match.command));
            message.success(`「${label}」已送出`);
          } catch (error) {
            message.error(describeCommandError(error).message);
          }
          return;
        }
        if (demo) {
          applyDemoCommand(binding.deviceId, match.command.id, label);
          message.success(`演示数据已切换为「${kind === "start" ? "运行" : "停止"}」`);
        }
      } finally {
        setBusy(null);
      }
    },
    [bindings, load, commandsByDevice],
  );

  return { stateByNode, busy, listError, send };
}
