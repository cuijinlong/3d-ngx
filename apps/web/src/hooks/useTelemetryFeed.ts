
import { useEffect, useRef, useState } from "react";
import { getDataProvider, getProviderKind, isRealtimePlatformDevice } from "@idt/data-adapter";
import { useDeviceStore } from "../stores/device.store";
import { useTelemetryStore } from "../stores/telemetry.store";

/** 订阅接口而不是 Mock 内部方法。UI 更新已在 store 层合并，3D 走 telemetryRuntime。
 *  已有绑定若指向平台虚拟设备，不把它当作实时采集来订阅。
 */
export function useTelemetryFeed(deviceIds: string[]): void {
  const apply = useTelemetryStore((s) => s.apply);
  const setAlarms = useTelemetryStore((s) => s.setAlarms);
  const refreshAlarms = useTelemetryStore((s) => s.refreshAlarms);
  const devices = useDeviceStore((s) => s.devices);
  const loading = useDeviceStore((s) => s.loading);

  /*
   * `devices` / `loading` 只用于「是否已知是虚拟设备」的判断，
   * **不能进 effect 依赖**（2026-11-23 实测）。
   *
   * <p>它们来自 deviceStore，页面加载过程中会变好几次（空 → 部分 → 全部）。
   * 每次变都重建订阅，而 `subscribeTelemetry` 的 cleanup 会把正在跑的批次
   * 中途停掉 —— 实测稳定只跑完前 6 台（正好是并发度），
   * 大屏上 7#~9# 永远「未知」，每次刷新停在不同设备上，极难定位。
   *
   * <p>用 ref 读最新值：过滤逻辑仍然是「当前的」，但不会因为 store 变化重订阅。
   */
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  /*
   * 「设备表就绪」必须是 **state**，不能是 ref（2026-11-23 修正）。
   *
   * <p>原来这里写的是：
   * ```
   * if (kind === "guard" && loadingRef.current && devicesRef.current.length === 0) return;
   * ```
   * 而 `loading` / `devices` 都不在 effect 依赖里（放进去会因 store 频繁变化
   * 重建订阅、打断轮询，见下方注释）。于是：页面加载时若设备表还在读，
   * effect 跑一次就 return，**之后再也没有理由重跑** —— 订阅压根不启动。
   *
   * <p>实测后果：首屏能不能出数取决于 `deviceIds` 会不会碰巧变一次
   * （scope 设备异步解析到位）。不变的话大屏永远停在「未知」。
   * 这是一个纯时序赌博，不是性能问题。
   *
   * <p>改成 state：只在「未就绪 → 就绪」翻转一次，不会引发频繁重建，
   * 但能保证订阅一定启动。
   */
  const [feedReady, setFeedReady] = useState(() => !loading || devices.length > 0);
  useEffect(() => {
    if (feedReady) return;
    if (!loading || devices.length > 0) setFeedReady(true);
  }, [feedReady, loading, devices.length]);

  useEffect(() => {
    const kind = getProviderKind();
    if (kind === "guard" && !feedReady) return;
    /*
     * 用**黑名单**而不是白名单（2026-11-23 修正）。
     *
     * <p>原来是 `allowed = devices.filter(isRealtime).map(id)`，再取交集 ——
     * 隐含假设「deviceStore 里有全部设备」。实测不成立：
     * 9 台模块机只有前几台在 store 里，其余被这个交集悄悄滤掉，
     * 大屏上永远显示「未知」，而后端 `values/timeseries` 明明有数据。
     *
     * <p>改成本意：只排除**已知是虚拟**的设备。
     * 不在 store 里的设备照常订阅 —— `subscribeTelemetry` 内部每台都会
     * `fetchRawDevice` + `isVirtualAdditionalInfo` 判断，本来就有第二道闸门。
     * 白名单在这里是多余的保护，代价是漏订阅。
     */
    const blocked =
      kind === "guard"
        ? new Set(devicesRef.current.filter((item) => !isRealtimePlatformDevice(item)).map((item) => item.id))
        : null;
    const ids = blocked ? deviceIds.filter((id) => !blocked.has(id)) : deviceIds;
    const provider = getDataProvider();
    const stop = provider.subscribeTelemetry(ids, (row) => {
      apply(row);
    });
    /*
     * 告警：优先用推送，没有就轮询（2026-11-23）。
     *
     * <p>**guard 没有 `subscribeAlarms`**（只有 mock 有）—— 原来这里
     * `provider.subscribeAlarms?.(setAlarms)` 在真实环境下是 no-op，
     * 于是 `alarms` 永远是空数组，`AlarmList` 一直显示「当前没有告警」，
     * 而平台侧有几十条。这类 bug 最麻烦的地方是「看起来正常」。
     *
     * <p>轮询 60 秒：告警不是秒级指标（遥测才需要秒级），
     * 60 秒既能让人及时看到新告警，又不会给平台加无谓负载。
     */
    let alarmTimer: ReturnType<typeof setInterval> | null = null;
    let stopAlarms: (() => void) | undefined;
    if (provider.subscribeAlarms) {
      stopAlarms = provider.subscribeAlarms(setAlarms);
      /* 订阅通常只在状态变化时推，先主动拉一次拿到当前存量。 */
      void refreshAlarms();
    } else if (provider.getAlarms) {
      void refreshAlarms();
      alarmTimer = setInterval(() => void refreshAlarms(), 60_000);
    }

    return () => {
      stop();
      stopAlarms?.();
      if (alarmTimer) clearInterval(alarmTimer);
    };
    /*
     * 依赖只留「订阅对象」+ 「是否就绪」。
     * devices / loading 本身已改用 ref —— 它们变化不该重建订阅，
     * 否则 cleanup 会打断正在进行的轮询批次。
     * `feedReady` 只会 false → true 翻转一次，代价可忽略。
     */
  }, [deviceIds.join("|"), apply, setAlarms, refreshAlarms, feedReady]);
}
