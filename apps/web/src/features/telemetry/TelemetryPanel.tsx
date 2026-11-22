import { Descriptions, Typography } from "antd";
import type { Device, DeviceBinding } from "@idt/shared-types";
import { formatPlatformDeviceName } from "@idt/data-adapter";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { TrendChart } from "./TrendChart";

export function TelemetryPanel({
  device,
  binding,
}: {
  device?: Device;
  binding?: DeviceBinding;
}) {
  const latest = useTelemetryStore((s) => s.latest);

  if (!device) {
    return <div style={{ padding: 12, color: "var(--idt-muted)" }}>点击设备查看属性。</div>;
  }

  const mappings = binding?.telemetryMappings ?? device.points.map((p) => ({
    field: p.label,
    telemetryKey: p.key,
    label: p.label,
    unit: p.unit,
  }));

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ margin: "0 0 8px" }}>{formatPlatformDeviceName(device)}</Typography.Title>
      <Descriptions size="small" column={1}>
        {mappings.map((m) => {
          const row = latest[`${device.id}:${m.telemetryKey}`];
          return (
            <Descriptions.Item key={m.telemetryKey} label={m.label}>
              {row ? `${String(row.value)}${row.unit ?? m.unit ?? ""}` : "—"}
            </Descriptions.Item>
          );
        })}
      </Descriptions>
      {device.id && mappings.length > 0 ? (
        <TrendChart deviceId={device.id} keys={mappings.map((m) => m.telemetryKey)} />
      ) : null}
    </div>
  );
}
