
import { Button, Card, Form, Input, Select, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getDevice, saveDevice } from "../../services/device/deviceService";
import type { Device, DevicePoint } from "@idt/shared-types";
import { formatPlatformDeviceName } from "@idt/data-adapter";
import { TelemetryPanel } from "../../features/telemetry/TelemetryPanel";
import { useTelemetryFeed } from "../../hooks/useTelemetryFeed";
import { routes } from "../../constants/routes";

export function DeviceDetailPage() {
  const { deviceId } = useParams();
  const nav = useNavigate();
  const [device, setDevice] = useState<Device>();
  useEffect(() => { if (deviceId) void getDevice(deviceId).then(setDevice); }, [deviceId]);
  useTelemetryFeed(device ? [device.id] : []);

  if (!device) return <div className="page-body">设备不存在</div>;

  return (
    <div className="page">
      <div className="page-body">
        <div className="page-head">
          <div>
            <h1 className="page-title">{formatPlatformDeviceName(device)}</h1>
            <p className="page-sub">测点可增删。这些配置会用于场景绑定，数据源仍是演示数据。</p>
          </div>
          <Button onClick={() => nav(routes.devices)}>返回列表</Button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="测点配置">
            <Space direction="vertical" style={{ width: "100%" }}>
              {device.points.map((p, idx) => (
                <Space key={p.key} wrap>
                  <Input value={p.label} onChange={(e) => patchPoint(device, setDevice, idx, { label: e.target.value })} />
                  <Input value={p.key} onChange={(e) => patchPoint(device, setDevice, idx, { key: e.target.value })} style={{ width: 140 }} />
                  <Input value={p.unit} placeholder="单位" onChange={(e) => patchPoint(device, setDevice, idx, { unit: e.target.value })} style={{ width: 80 }} />
                  <Select
                    value={p.displayType}
                    style={{ width: 100 }}
                    onChange={(displayType) => patchPoint(device, setDevice, idx, { displayType })}
                    options={["number", "boolean", "text"].map((v) => ({ value: v, label: v }))}
                  />
                </Space>
              ))}
              <Button onClick={() => setDevice({ ...device, points: [...device.points, { key: `p_${device.points.length + 1}`, label: "新测点", displayType: "number" }] })}>
                添加测点
              </Button>
              <Button type="primary" onClick={() => void saveDevice(device).then(setDevice)}>保存</Button>
            </Space>
          </Card>
          <Card title={<Space>实时演示 <span className="idt-demo-tag">演示数据</span></Space>}>
            <TelemetryPanel device={device} />
          </Card>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          网关指令与真实遥测将通过 DeviceDataProvider / DeviceCommandProvider 接入，当前未连接 guard-server。
        </Typography.Paragraph>
      </div>
    </div>
  );
}

function patchPoint(device: Device, setDevice: (d: Device) => void, idx: number, patch: Partial<DevicePoint>) {
  const points = device.points.map((p, i) => (i === idx ? { ...p, ...patch } : p));
  setDevice({ ...device, points });
}

void Form;
