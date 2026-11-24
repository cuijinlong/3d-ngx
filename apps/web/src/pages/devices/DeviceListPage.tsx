
import { Button, Card, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MOCK_PROFILES, formatPlatformDeviceName } from "@idt/data-adapter";
import type { Device } from "@idt/shared-types";
import { routes } from "../../constants/routes";
import { createDevice, deleteDevice, listDevices } from "../../services/device/deviceService";

export function DeviceListPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Device[]>([]);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const refresh = () => void listDevices().then(setRows);
  useEffect(() => { refresh(); }, []);

  return (
    <div className="page">
      <div className="page-body">
        <div className="page-head">
          <div>
            <h1 className="page-title">模拟设备</h1>
            <p className="page-sub">这里维护的是本地定义的模拟设备档案（用于离线设计）；线上场景请绑 guard-server 的真实设备。</p>
          </div>
          <Button type="primary" onClick={() => setOpen(true)}>新建模拟设备</Button>
        </div>
        <Card>
          <Table
            rowKey="id"
            dataSource={rows}
            pagination={false}
            columns={[
              { title: "名称", render: (_: unknown, r: Device) => formatPlatformDeviceName(r) },
              { title: "类型", dataIndex: "type" },
              { title: "测点", render: (_: unknown, r: Device) => r.points.map((p) => p.label).join("、") || "—" },
              { title: "来源", render: () => <Tag>演示数据</Tag> },
              {
                title: "操作",
                render: (_: unknown, r: Device) => (
                  <Space>
                    <Button type="link" onClick={() => nav(routes.deviceDetail(r.id))}>详情</Button>
                    <Button type="link" danger onClick={() => void deleteDevice(r.id).then(refresh)}>删除</Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
        <Modal
          title="新建模拟设备"
          open={open}
          onCancel={() => setOpen(false)}
          onOk={async () => {
            const v = await form.validateFields();
            await createDevice({ name: v.name, type: v.type });
            setOpen(false);
            form.resetFields();
            refresh();
          }}
        >
          <Form form={form} layout="vertical" initialValues={{ type: "transformer" }}>
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select options={MOCK_PROFILES.map((p) => ({ value: p.type, label: p.label }))} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </div>
  );
}
