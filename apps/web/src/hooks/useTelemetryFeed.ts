
import { useEffect } from "react";
import { getDataProvider, getProviderKind, isRealtimePlatformDevice } from "@idt/data-adapter";
import { useDeviceStore } from "../stores/device.store";
import { useTelemetryStore } from "../stores/telemetry.store";

/** 订阅接口而不是 Mock 内部方法。UI 更新已在 store 层合并，3D 走 telemetryRuntime。
 *  已有绑定若指向平台虚拟设备，不把它当作实时采集来订阅。
 */
export function useTelemetryFeed(deviceIds: string[]): void {
  const apply = useTelemetryStore((s) => s.apply);
  const setAlarms = useTelemetryStore((s) => s.setAlarms);
  const devices = useDeviceStore((s) => s.devices);
  const loading = useDeviceStore((s) => s.loading);

  useEffect(() => {
    const kind = getProviderKind();
    if (kind === "guard" && loading && devices.length === 0) return;
    const allowed = kind === "guard" ? new Set(devices.filter(isRealtimePlatformDevice).map((item) => item.id)) : null;
    const ids = allowed ? deviceIds.filter((id) => allowed.has(id)) : deviceIds;
    const provider = getDataProvider();
    const stop = provider.subscribeTelemetry(ids, (row) => {
      apply(row);
    });
    const stopAlarms = provider.subscribeAlarms?.(setAlarms);
    return () => {
      stop();
      stopAlarms?.();
    };
  }, [deviceIds.join("|"), apply, setAlarms, devices, loading]);
}
