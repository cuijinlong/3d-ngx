
import { Button, Card, Form, Input, Space, Typography, message } from "antd";
import { useEffect, useState } from "react";
import {
  connectGuard,
  disconnectGuard,
  getGuardStatus,
  hasRefreshSession,
  loadSavedGuardSettings,
  restoreGuardConnection,
} from "@idt/data-adapter";
import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../../stores/device.store";
import { useAuthSession } from "../../auth/AuthSession";
import { brandPath, customerScopePath, workbenchChrome } from "../../auth/access";
import { resolveTenantCustomerId } from "../../auth/customer-scope";
import { routes } from "../../constants/routes";
import { EntryChrome, entryStyles } from "../entry/EntryChrome";

export function SettingsPage() {
  const { role, customerId } = useAuthSession();
  const nav = useNavigate();
  const chrome = workbenchChrome(role);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(getGuardStatus());
  const refreshDevices = useDeviceStore((s) => s.refresh);

  useEffect(() => {
    const saved = loadSavedGuardSettings();
    form.setFieldsValue({
      apiBase: saved?.apiBase || "/api",
      username: saved?.username || "",
      password: "",
    });
    setStatus(getGuardStatus());
  }, [form]);

  const connect = async () => {
    const values = await form.validateFields();
    setBusy(true);
    try {
      const next = await connectGuard({
        apiBase: values.apiBase || "/api",
        username: values.username,
        password: values.password,
      });
      setStatus(next);
      await refreshDevices();
      message.success(`已连接后端，读到 ${next.deviceCount ?? 0} 台设备`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "连接失败");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectGuard();
      const next = getGuardStatus();
      setStatus(next);
      await refreshDevices();
      message.success("已断开后端，改用演示数据");
    } catch (error) {
      const next = getGuardStatus();
      setStatus(next);
      await refreshDevices();
      message.warning(error instanceof Error ? error.message : "已完成本地断开，平台登出可能未成功");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!hasRefreshSession()) {
      message.warning("没有可恢复的登录会话，请重新输入密码连接。");
      return;
    }
    setBusy(true);
    try {
      const next = await restoreGuardConnection();
      setStatus(next);
      await refreshDevices();
      if (next.connected) message.success(`已恢复连接，设备 ${next.deviceCount ?? 0} 台`);
      else if (next.message) message.warning(next.message);
    } finally {
      setBusy(false);
    }
  };

  const brandTo = brandPath(role);
  const scopeId = resolveTenantCustomerId(customerId);
  const scenesTo = customerScopePath(scopeId);

  if (!chrome.showPlatformSettings) {
    return (
      <EntryChrome crumbs={<b>设置</b>} brandTo={brandTo}>
        <div className={entryStyles.main}>
          <h1>设置</h1>
          <p className={entryStyles.sub}>客户账号不能修改平台地址或绑定入口。</p>
          <button type="button" className={entryStyles.primary} onClick={() => nav(routes.runtime)}>
            返回
          </button>
        </div>
      </EntryChrome>
    );
  }

  return (
    <EntryChrome crumbs={<b>设置</b>} brandTo={brandTo}>
      <div className={entryStyles.main}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginBottom: 8 }}>
          <h1 style={{ margin: 0 }}>设置</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className={entryStyles.ghost} onClick={() => nav(routes.selectCustomer)}>
              返回选客户
            </button>
            {scopeId ? (
              <button type="button" className={entryStyles.ghost} onClick={() => nav(scenesTo)}>
                返回场景管理
              </button>
            ) : null}
          </div>
        </div>
        <p className={entryStyles.sub}>连接本机平台后，编辑时右侧绑定会从后端设备和测点动态读取，不会写死键名。</p>
        <Card style={{ marginTop: 16 }} title="后端连接">
          <Form form={form} layout="vertical" style={{ maxWidth: 440 }} initialValues={{ apiBase: "/api" }}>
            <Form.Item
              label="接口地址"
              name="apiBase"
              extra="开发环境请用 /api，由 Vite 代理到平台，不要把 localhost 填到这里。"
            >
              <Input placeholder="/api" />
            </Form.Item>
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请填写用户名" }]}>
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: "请填写密码" }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Space>
              <Button type="primary" loading={busy} onClick={() => void connect()}>
                连接后端
              </Button>
              <Button onClick={() => void restore()} disabled={busy}>
                恢复上次连接
              </Button>
              <Button danger disabled={!status.connected || busy} onClick={() => void disconnect()}>
                断开
              </Button>
            </Space>
          </Form>
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            当前数据源：{status.connected
              ? "guard-server（后端设备）"
              : status.kind === "guard"
                ? "平台未连接（请重新登录，未使用演示数据）"
                : "Mock（演示数据）"}
            {status.username ? ` · ${status.username}` : ""}
            {status.authority ? ` · ${status.authority}` : ""}
            {typeof status.deviceCount === "number" ? ` · ${status.deviceCount} 台设备` : ""}
            {status.message ? ` · ${status.message}` : ""}
          </Typography.Paragraph>
        </Card>
      </div>
    </EntryChrome>
  );
}
