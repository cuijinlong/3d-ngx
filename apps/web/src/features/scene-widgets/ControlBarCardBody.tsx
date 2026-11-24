import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, message } from "antd";
import type { Device, TelemetryRecord } from "@idt/shared-types";
import type { SceneWidget, SceneWidgetControl } from "@idt/data-adapter";
import { getCommandProvider } from "@idt/data-adapter";
import { applyDemoCommand, getDemoRunning } from "../../hooks/demo-command-state";
import { loadTelemetrySource } from "../../hooks/useTelemetrySource";
import { readLatest, sysRunStateKind } from "../../utils/device-plates";
import { COMMAND_OUTCOME_TEXT, COMMAND_VERIFY_DELAY_MS, verifyCommandOutcome } from "./command-verify";
import styles from "./WidgetOverlay.module.css";
import { displayNameOf } from "../../utils/display-name";

/**
 * 控制条（2026-11-23）。
 *
 * <h2>为什么单独一种部件类型，而不是给 metric-card 加按钮</h2>
 *
 * 「读一个值」和「发一条命令」是两件事：
 * 前者失败只是显示「—」，后者失败会让现场设备没按预期动作。
 * 混在一张卡里，误点成本完全不同。单独一类，可以单独设确认文案与显隐规则。
 *
 * <h2>三个必须做对的地方</h2>
 *
 * 1. **互斥/二次确认**：停机是真动作，默认要确认；`confirmText` 可覆盖。
 * 2. **状态不能用 truthy 判**：`sys_run_state` 是 0~9 枚举，
 *    1(停机)/8(故障) 都是非零，用 `Boolean(value)` 会把停机显示成运行。
 * 3. **演示模式要能真的切**：`applyDemoCommand` 按 `params.on` 决定方向，
 *    旧实现靠标签猜，`setSystemPower`（标签「系统启停」）永远猜不出来。
 */
export function ControlBarCardBody({
  widget,
  devices,
  latest,
}: {
  widget: SceneWidget;
  devices?: Device[] | null;
  latest: Record<string, TelemetryRecord>;
}) {
  const controls = widget.controls ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * 正在等回读的按钮。没有它，操作员在 10 秒里看不到任何动静，
   * 很可能重复点击 —— 而这恰恰是最该避免的操作习惯。
   */
  const [verifying, setVerifying] = useState<string[]>([]);
  /*
   * 回执校验要读「10 秒后的最新遥测」，但 timeout 闭包捕获的是发命令那一刻的
   * latest。用 ref 存最新值，否则回读到的永远是旧状态，恒定判成「没变化」。
   */
  const latestRef = useRef(latest);
  latestRef.current = latest;
  /*
   * 按 control.key 存待触发的校验。同一按钮连点两次时，前一次的校验要作废 ——
   * 否则会先报一次「未变化」再报一次「已确认」，自相矛盾。
   */
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /* 组件卸载（切场景/关大屏）时清掉未触发的校验，避免对已卸载组件 setState。 */
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  /* 设备名给按钮做提示：多网关场景下光看命令名分不清控的是谁。 */
  const deviceName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const device of devices ?? []) map[device.id] = displayNameOf(device, device.id);
    return map;
  }, [devices]);

  if (!controls.length) {
    return <p className={styles.muted}>还没有配置控制按钮。</p>;
  }

  /**
   * 等一段时间回读状态，判定命令是否真的生效。
   *
   * <p>用 `latestRef.current` 而不是闭包里的 `latest`：闭包捕获的是发命令那一刻
   * 的快照，用它回读永远等于发命令前的值，会恒定判成「没变化」。
   */
  const scheduleVerify = (control: SceneWidgetControl, targetOn: boolean, before: boolean | null) => {
    const pending = timersRef.current.get(control.key);
    if (pending) clearTimeout(pending);
    setVerifying((list) => (list.includes(control.key) ? list : [...list, control.key]));
    const timer = setTimeout(() => {
      timersRef.current.delete(control.key);
      setVerifying((list) => list.filter((key) => key !== control.key));
      const after = readToggleState(control, latestRef.current);
      const outcome = verifyCommandOutcome({ before, after, targetOn });
      const text = `「${control.label || control.commandId}」：${COMMAND_OUTCOME_TEXT[outcome]}`;
      if (outcome === "confirmed") message.success(text);
      else if (outcome === "unexpected") message.error(text);
      else message.warning(text);
    }, COMMAND_VERIFY_DELAY_MS);
    timersRef.current.set(control.key, timer);
  };

  const run = async (control: SceneWidgetControl, on: boolean) => {
    /*
     * 参数：toggle 按当前要切到的方向取；button 用固定 params。
     * 双向命令必须带参数 —— 没有参数就不发，宁可不动作也不猜方向。
     */
    const params = control.kind === "button"
      ? control.params
      : on
        ? control.onParams
        : control.offParams;

    if (control.kind !== "button" && !params) {
      message.error(`「${control.label || control.commandId}」没有配置开/关参数，无法下发`);
      return;
    }

    const demo = loadTelemetrySource() === "demo";
    /*
     * 发命令前先记下状态，用于回读对比。
     * 只有 toggle 有明确目标态；button（复位这类）没有，不参与校验。
     */
    const isToggle = control.kind !== "button";
    const before = isToggle ? readToggleState(control, latestRef.current) : null;

    setBusy(control.key);
    try {
      await getCommandProvider().sendCommand(control.deviceId, control.commandId, params);
      /* 演示模式下让界面状态跟着变，否则用户会以为没生效。 */
      const demoChanged = demo
        ? applyDemoCommand(control.deviceId, control.commandId, control.label || "", params)
        : null;
      if (demoChanged !== null) {
        message.success(`演示模式：已切换为${demoChanged ? "运行" : "停机"}`);
        return;
      }
      /*
       * 实时模式：**不报成功**。
       *
       * <p>平台走 oneway RPC（`/api/rpc/oneway/...`），只保证消息发出、不等设备响应。
       * 而设备上的 `rpcMethods` 是我们自己 seed 进去的「期望支持清单」，
       * 不是网关真实上报的能力（见 46-seed-heat-pump-rig.mjs 的 GATEWAY_RPC）。
       * 所以此刻唯一确定的事是「指令已发出」。
       *
       * <p>真正的判据是设备状态有没有变 —— 交给 scheduleVerify 回读后再下结论。
       */
      if (!isToggle) {
        message.success(`已下发「${control.label || control.commandId}」`);
        return;
      }
      message.info(
        `已下发「${control.label || control.commandId}」，${Math.round(COMMAND_VERIFY_DELAY_MS / 1000)} 秒后核对设备状态…`,
      );
      scheduleVerify(control, on, before);
    } catch (error) {
      const changed = demo ? applyDemoCommand(control.deviceId, control.commandId, control.label || "", params) : null;
      if (changed !== null) {
        message.warning("后端指令未送达，已在演示数据中切换状态");
      } else {
        message.error(error instanceof Error ? error.message : "指令下发失败");
      }
    } finally {
      setBusy(null);
    }
  };

  const trigger = (control: SceneWidgetControl, on: boolean) => {
    const text = control.confirmText
      ?? (control.kind === "button" ? "" : on ? "" : "确认停机？");
    if (!text) {
      void run(control, on);
      return;
    }
    Modal.confirm({
      title: `确认执行「${control.label || control.commandId}」？`,
      content: text,
      okText: "确认",
      cancelText: "取消",
      okButtonProps: on ? undefined : { danger: true },
      onOk: () => run(control, on),
    });
  };

  return (
    <div className={styles.controlBar}>
      {controls.map((control) => (
        <ControlButton
          key={control.key}
          control={control}
          latest={latest}
          deviceLabel={deviceName[control.deviceId]}
          busy={busy === control.key}
          verifying={verifying.includes(control.key)}
          onTrigger={trigger}
        />
      ))}
    </div>
  );
}

function ControlButton({
  control,
  latest,
  deviceLabel,
  busy,
  verifying,
  onTrigger,
}: {
  control: SceneWidgetControl;
  latest: Record<string, TelemetryRecord>;
  deviceLabel?: string;
  busy: boolean;
  verifying: boolean;
  onTrigger: (control: SceneWidgetControl, on: boolean) => void;
}) {
  const isToggle = control.kind !== "button";
  const running = isToggle ? readToggleState(control, latest) : null;

  /*
   * 状态未知时按钮照常可点（现场可能就是要在没数据时操作），
   * 但文案要说清当前不知道 —— 不能默认显示「运行中」。
   */
  const label = control.label || control.commandId;
  /*
   * 校验中优先显示「核实中…」：这 10 秒里设备状态还是旧的，
   * 继续显示「运行中」会让操作员以为命令已经生效了。
   */
  const stateText = verifying
    ? " · 核实中…"
    : !isToggle
      ? ""
      : running === true
        ? " · 运行中"
        : running === false
          ? " · 停机"
          : " · 状态未知";

  return (
    <Button
      size="small"
      loading={busy}
      data-testid={`control-${control.key}`}
      title={deviceLabel ? `${label}（设备：${deviceLabel}）` : label}
      danger={isToggle && running === true}
      onClick={() => onTrigger(control, !(running === true))}
    >
      {isToggle && running === true ? `停 ${label}` : label}
      {stateText}
    </Button>
  );
}

/**
 * 读开关的当前状态。
 *
 * <p>优先用 `sys_run_state` 枚举解析（1停机 / 5运行），
 * 而不是 truthy —— 否则停机(1) 会被当成「在运行」，按钮还会显示「停」。
 * 没有 stateKey 或读不到时返回 null（未知），让按钮文案老实写「状态未知」。
 */
export function readToggleState(
  control: Pick<SceneWidgetControl, "deviceId" | "stateKey">,
  latest: Record<string, TelemetryRecord>,
): boolean | null {
  const stateKey = control.stateKey;
  if (!stateKey) {
    /* 演示模式下没有遥测也应能反映本地开关状态。 */
    const demo = loadTelemetrySource() === "demo";
    return demo ? getDemoRunning(control.deviceId) : null;
  }
  const row = readLatest(latest, control.deviceId, [stateKey]);
  if (!row) {
    const demo = loadTelemetrySource() === "demo";
    return demo ? getDemoRunning(control.deviceId) : null;
  }
  if (stateKey === "sys_run_state") {
    const kind = sysRunStateKind(row.value);
    if (kind === "running") return true;
    if (kind === "offline" || kind === "fault") return false;
    return null;
  }
  if (typeof row.value === "boolean") return row.value;
  return null;
}
