import { Button, Space, message } from "antd";
import { useMemo, useState } from "react";
import { getCommandProvider, getProviderKind, isRealtimePlatformDevice } from "@idt/data-adapter";
import { useDeviceStore } from "../../stores/device.store";
import type { SceneDocument } from "@idt/shared-types";
import { bindingsForNode } from "../../utils/scene-entity";
import { applyDemoCommand, isStartCommand, isStopCommand } from "../../hooks/demo-command-state";
import { loadTelemetrySource } from "../../hooks/useTelemetrySource";

export function ActionCommandBar({
  document,
  nodeName,
}: {
  document?: SceneDocument | null;
  nodeName?: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const devices = useDeviceStore((s) => s.devices);
  const actions = useMemo(() => {
    const list: Array<{ key: string; deviceId: string; commandId: string; label: string; params?: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    const kind = getProviderKind();
    const allowed = kind === "guard" ? new Set(devices.filter(isRealtimePlatformDevice).map((item) => item.id)) : null;
    for (const binding of bindingsForNode(document, nodeName ?? null)) {
      /* 资产绑定条目没有 deviceId —— 它不是「可下发命令的设备」，直接跳过。 */
      if (!binding.deviceId) continue;
      if (allowed && !allowed.has(binding.deviceId)) continue;
      for (const mapping of binding.actionMappings) {
        if (!mapping.commandId) continue;
        const key = `${binding.deviceId}:${mapping.commandId}:${mapping.actionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          key,
          deviceId: binding.deviceId,
          commandId: mapping.commandId,
          label: mapping.label || mapping.commandId,
          params: mapping.commandParams,
        });
      }
    }
    return list;
  }, [document, nodeName, devices]);

  if (actions.length === 0) return null;

  const send = async (item: (typeof actions)[number]) => {
    setBusy(item.key);
    const demo = loadTelemetrySource() === "demo";
    try {
      await getCommandProvider().sendCommand(item.deviceId, item.commandId, item.params);
      applyDemoCommand(item.deviceId, item.commandId, item.label);
      message.success(`已下发「${shortLabel(item)}」`);
    } catch (error) {
      if (demo && applyDemoCommand(item.deviceId, item.commandId, item.label) !== null) {
        message.warning("后端指令未送达，已在演示数据中切换启停");
      } else {
        message.error(error instanceof Error ? error.message : "指令下发失败");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="action-command-bar"
      style={{
        position: "absolute",
        left: 12,
        bottom: 16,
        zIndex: 3,
        display: "flex",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--ngx-glass-bg)",
        border: "1px solid var(--ngx-glass-border)",
        boxShadow: "var(--ngx-shadow)",
      }}
    >
      <Space size={8} wrap>
        {actions.map((item) => (
          <Button
            key={item.key}
            type={isStartCommand(item.commandId, item.label) ? "primary" : "default"}
            danger={isStopCommand(item.commandId, item.label)}
            size="small"
            data-command={item.commandId}
            loading={busy === item.key}
            onClick={() => void send(item)}
          >
            {shortLabel(item)}
          </Button>
        ))}
      </Space>
    </div>
  );
}

function shortLabel(item: { commandId: string; label: string }): string {
  if (isStartCommand(item.commandId, item.label)) return "启动";
  if (isStopCommand(item.commandId, item.label)) return "停止";
  return item.label.replace(/（演示指令）|（演示）/g, "");
}
