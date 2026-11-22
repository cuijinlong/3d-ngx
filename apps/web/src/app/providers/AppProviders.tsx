import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { restoreGuardConnection } from "@idt/data-adapter";
import { listDevices } from "../../services/device/deviceService";
import { useAppStore } from "../../stores/app.store";
import { useDeviceStore } from "../../stores/device.store";
import { AuthSessionProvider } from "../../auth/AuthSession";
import { AppThemeProvider } from "../../theme/AppThemeProvider";

const client = new QueryClient();

export function AppProviders({ children }: PropsWithChildren) {
  const setReady = useAppStore((s) => s.setReady);

  useEffect(() => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };
    void (async () => {
      try {
        await restoreGuardConnection();
      } catch {
        /* 恢复失败保持未登录，由登录页承接，不在整页拉警报 */
      }
      try {
        await listDevices();
        await useDeviceStore.getState().refresh();
      } catch {
        /* 本地数据失败不挡住登录入口 */
      } finally {
        finish();
      }
    })();
    return () => {
      settled = true;
    };
  }, [setReady]);

  return (
    <QueryClientProvider client={client}>
      <AppThemeProvider>
        <AntApp>
          <AuthSessionProvider>{children}</AuthSessionProvider>
        </AntApp>
      </AppThemeProvider>
    </QueryClientProvider>
  );
}
