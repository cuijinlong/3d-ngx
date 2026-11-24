
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
            <p className="page-sub">测点可增删。这些配置会用于场景绑定，数值来自 guard-server 实时遥测。</p>
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
          {/*
           * 标题原来写「实时演示」+ 硬编码的「演示数据」标签（2026-11-23 改）。
           *
           * <p>那个标签是**写死的**，与实际数据源无关 —— 而 `TelemetryPanel`
           * 读的是 `useTelemetryStore`，也就是 guard-server 的真实遥测。
           * 明明是真数据却标「演示」，比不标更糟：客户会以为整块不可信。
           */}
          <Card title="实时数据">
            <TelemetryPanel device={device} />
          </Card>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          数据来自 guard-server 实时遥测；未订阅到的测点显示「—」。
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
