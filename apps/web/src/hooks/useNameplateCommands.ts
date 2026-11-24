
import { useCallback, useEffect, useMemo, useState } from "react";
import { message } from "antd";
import type { CommandDef, DeviceBinding } from "@idt/shared-types";
import {
  describeCommandError,
  getCommandProvider,
  getDataProvider,
  getProviderKind,
  isVirtualPlatformDevice,
} from "@idt/data-adapter";
import { applyDemoCommand } from "./demo-command-state";
import { loadTelemetrySource } from "./useTelemetrySource";
import type { DevicePlate, PlateStatus } from "../utils/device-plates";
import {
  matchNameplateCommand,
  nameplateReasonText,
  declaredCommandParams,
  type NameplateMatch,
} from "../utils/nameplate-commands";
import { inferRangeForCommand, matchNumericCommand, type ControlRange } from "../utils/control-range";

/**
 * 一个设备的控制能力（2026-11-23）。
 *
 * <p>从「只有启停」扩展成两套：
 * <ul>
 *   <li>`start` / `stop` —— 布尔启停，界面上做成绿/红大圆按钮；</li>
 *   <li>`numeric` —— 数值型控制（开度 / 设定点），界面上做成滑块。
 *       带上 `range` 说明**协议接收什么数字**，渲染层不需要自己换算。</li>
 * </ul>
 *
 * <p>`numeric` 为 null 有两种情况：设备根本没这类命令，或命令需要多个参数
 * （无法判断该让用户拖哪一个）。两者都不该出现一个坏掉的滑块。
 */
export type NameplateNumericState = {
  enabled: boolean;
  reason?: string;
  commandId?: string;
  label?: string;
  /** 协议口径：min/max/step/scale/unit，见 `utils/control-range.ts` */
  range: ControlRange;
  /** 参数名（`setOpening` 的 `value`）—— 下发时要用它做 key */
  paramName: string;
};

export type NameplateCommandState = {
  start: { enabled: boolean; reason?: string; commandId?: string; label?: string };
  stop: { enabled: boolean; reason?: string; commandId?: string; label?: string };
  /** 数值控制（开度/设定点）。没有这类能力时为 null，界面不渲染滑块。 */
  numeric: NameplateNumericState | null;
};

/**
 * 解析数值型控制能力（2026-11-23）。
 *
 * <p>`waiting` 时禁用而不是隐藏：滑块突然消失会让人以为「这台不支持开度」，
 * 而实际上只是正在下发。
 */
function resolveNumeric(list: CommandDef[], waiting: boolean): NameplateNumericState | null {
  const command = matchNumericCommand(list);
  if (!command) return null;
  const paramName = command.params?.[0]?.name ?? "value";
  if (waiting) {
    return {
      enabled: false,
      reason: nameplateReasonText("busy"),
      commandId: command.id,
      label: command.label,
      range: inferRangeForCommand(command),
      paramName,
    };
  }
  return {
    enabled: true,
    commandId: command.id,
    label: command.label || command.id,
    range: inferRangeForCommand(command),
    paramName,
  };
}

/**
 * 解析单侧启停能力（2026-11-23 加互斥）。
 *
 * <h2>★ 为什么必须互斥</h2>
 *
 * <p>客户原话：「3D设备点击下面的启停按钮要互斥不能同时可点」。
 *
 * <p>原来 `start` / `stop` 各自判断「设备上有没有这条命令」，
 * 结果两个都 enabled —— 运行中的机组，「启动」照样可点。
 * 现场后果很直接：点「启动」发一条无意义的开机命令，
 * 网关要么拒绝（界面看不出）、要么真的重启机组。
 *
 * <h2>判据来自铭牌状态，不是命令清单</h2>
 *
 * <p>`plate.status` 是四态（running / stopped / fault / offline / unknown），
 * 由 `buildDevicePlates` 从遥测算出，和列表、3D 染色同源。
 * 拿它判互斥才能保证「界面说的状态」和「按钮能不能点」一致。
 *
 * <table>
 *   <tr><th>当前状态</th><th>启动</th><th>停止</th><th>理由</th></tr>
 *   <tr><td>running</td><td>禁用</td><td>可点</td><td>已在运行，再发启动无意义</td></tr>
 *   <tr><td>stopped / fault / offline</td><td>可点</td><td>禁用</td><td>没在运行，停它无意义</td></tr>
 *   <tr><td>unknown</td><td>可点</td><td>可点</td><td>不知道状态时不该锁死任一方向</td></tr>
 * </table>
 *
 * <p>fault 允许「启动」：现场常见做法是重启一次尝试恢复，
 * 而真正的清故障要走告警处置。把启动也禁掉会让值班员无从下手。
 */
export function resolveNameplateSide(
  match: NameplateMatch,
  busy: boolean,
  side: "start" | "stop",
  status: PlateStatus,
): NameplateCommandState["start"] {
  if (busy) return { enabled: false, reason: nameplateReasonText("busy") };
  if (!match.ok) return { enabled: false, reason: nameplateReasonText(match.reason) };

  /*
   * 互斥判定。only `running` 与「非 running」两种情形需要锁，
   * `unknown` 一律两侧放开 —— 状态不明时替用户做决定更危险。
   */
  if (status === "running" && side === "start") {
    return { enabled: false, reason: "设备已在运行，无需再次启动" };
  }
  if (status !== "running" && status !== "unknown" && side === "stop") {
    return { enabled: false, reason: "设备当前未运行，无需停止" };
  }

  return { enabled: true, commandId: match.command.id, label: match.command.label || match.command.id };
}

export function useNameplateCommands(plates: DevicePlate[], bindings: DeviceBinding[]) {
  const [commandsByDevice, setCommandsByDevice] = useState<Record<string, CommandDef[]>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [virtualIds, setVirtualIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const needed = useMemo(() => {
    const ids = new Set<string>();
    for (const plate of plates) {
      if (!plate.showStartStop) continue;
      const binding = bindings.find((item) => item.sceneEntityId === plate.node);
      if (binding?.deviceId) ids.add(binding.deviceId);
    }
    return [...ids];
  }, [plates, bindings]);

  const refreshVirtualFlags = useCallback(async (deviceIds: string[]) => {
    const next = new Set<string>();
    await Promise.all(
      deviceIds.map(async (deviceId) => {
        try {
          const device = await getDataProvider().getDevice(deviceId);
          if (!device || isVirtualPlatformDevice(device)) next.add(deviceId);
        } catch {
          /* 读失败不当成虚拟，避免误伤下发 */
        }
      }),
    );
    setVirtualIds(next);
    return next;
  }, []);

  const load = useCallback(async (deviceIds: string[]) => {
    const next: Record<string, CommandDef[]> = {};
    const nextFailed = new Set<string>();
    let errorText: string | null = null;
    await Promise.all(
      deviceIds.map(async (deviceId) => {
        try {
          next[deviceId] = await getCommandProvider().listCommands(deviceId);
        } catch (error) {
          nextFailed.add(deviceId);
          errorText = describeCommandError(error).message;
        }
      }),
    );
    setCommandsByDevice((prev) => ({ ...prev, ...next }));
    setFailed((prev) => {
      const merged = new Set(prev);
      for (const id of deviceIds) {
        if (nextFailed.has(id)) merged.add(id);
        else merged.delete(id);
      }
      return merged;
    });
    setListError(errorText);
    if (errorText) message.warning(`命令列表暂时读不到，已保留上次选项。${errorText}`);
    return { commands: next, failed: nextFailed };
  }, []);

  useEffect(() => {
    if (needed.length === 0) return;
    void refreshVirtualFlags(needed);
    void load(needed);
  }, [needed.join("|"), load, refreshVirtualFlags]);

  const stateByNode = useMemo(() => {
    const map: Record<string, NameplateCommandState> = {};
    for (const plate of plates) {
      if (!plate.showStartStop) continue;
      const binding = bindings.find((item) => item.sceneEntityId === plate.node);
      if (!binding?.deviceId) {
        map[plate.node] = {
          start: { enabled: false, reason: nameplateReasonText("unbound") },
          stop: { enabled: false, reason: nameplateReasonText("unbound") },
          numeric: null,
        };
        continue;
      }
      if (virtualIds.has(binding.deviceId)) {
        map[plate.node] = {
          start: { enabled: false, reason: "绑定已失效（虚拟设备）" },
          stop: { enabled: false, reason: "绑定已失效（虚拟设备）" },
          numeric: null,
        };
        continue;
      }
      const cached = commandsByDevice[binding.deviceId];
      if (failed.has(binding.deviceId) && !cached) {
        map[plate.node] = {
          start: { enabled: false, reason: nameplateReasonText("list-failed") },
          stop: { enabled: false, reason: nameplateReasonText("list-failed") },
          numeric: null,
        };
        continue;
      }
      const list = cached ?? [];
      const waiting = busy?.startsWith(`${plate.node}:`) ?? false;
      map[plate.node] = {
        start: resolveNameplateSide(matchNameplateCommand("start", list), waiting, "start", plate.status),
        stop: resolveNameplateSide(matchNameplateCommand("stop", list), waiting, "stop", plate.status),
        numeric: resolveNumeric(list, waiting),
      };
    }
    return map;
  }, [plates, bindings, commandsByDevice, failed, virtualIds, busy]);

  const send = useCallback(
    async (node: string, kind: "start" | "stop") => {
      const binding = bindings.find((item) => item.sceneEntityId === node);
      if (!binding?.deviceId) {
        message.warning(nameplateReasonText("unbound"));
        return;
      }
      /*
       * 提成局部常量：TS 的收窄跨不过 await 边界，直接写 binding.deviceId
       * 在 await 之后会退回 string | undefined（v2 里该字段本就可选）。
       */
      const deviceId = binding.deviceId;
      setBusy(`${node}:${kind}`);
      try {
        const device = await getDataProvider().getDevice(deviceId);
        if (!device || isVirtualPlatformDevice(device)) {
          setVirtualIds((prev) => new Set(prev).add(deviceId));
          message.error(device && isVirtualPlatformDevice(device) ? "绑定已失效（虚拟设备）" : "未绑定目标设备");
          return;
        }
        const { commands, failed: nextFailed } = await load([deviceId]);
        const list = commands[deviceId] ?? commandsByDevice[deviceId] ?? [];
        if (nextFailed.has(deviceId) && list.length === 0) {
          message.error(nameplateReasonText("list-failed"));
          return;
        }
        if (nextFailed.has(deviceId)) {
          message.warning("命令列表暂时读不到，已按上次选项匹配");
        }
        const match = matchNameplateCommand(kind, list);
        if (!match.ok) {
          message.warning(nameplateReasonText(match.reason));
          return;
        }
        const demo = loadTelemetrySource() === "demo";
        const live = loadTelemetrySource() === "live" && getProviderKind() === "guard";
        const label = match.command.label || (kind === "start" ? "启动" : "停止");
        if (live) {
          try {
            await getCommandProvider().sendCommand(deviceId, match.command.id, declaredCommandParams(match.command));
            message.success(`「${label}」已送出`);
          } catch (error) {
            message.error(describeCommandError(error).message);
          }
          return;
        }
        if (demo) {
          applyDemoCommand(deviceId, match.command.id, label);
          message.success(`演示数据已切换为「${kind === "start" ? "运行" : "停止"}」`);
        }
      } finally {
        setBusy(null);
      }
    },
    [bindings, load, commandsByDevice],
  );

  /**
   * 下发数值型控制（开度 / 设定点）（2026-11-23）。
   *
   * <h3>为什么单独一个方法而不是给 `send` 加分支</h3>
   *
   * <p>`send` 的入参是 `"start" | "stop"`，语义是「切到某个布尔态」；
   * 数值命令要带一个**经换算的整数**，并且要先把该值夹进协议范围。
   * 混进同一个函数会让「谁负责夹范围」变得含糊 —— 而那是会设错现场参数的地方。
   *
   * @param wireValue **协议侧**的整数（渲染层用 `toWire` 换算好再传）
   */
  const sendNumeric = useCallback(
    async (node: string, wireValue: number) => {
      const binding = bindings.find((item) => item.sceneEntityId === node);
      if (!binding?.deviceId) {
        message.warning(nameplateReasonText("unbound"));
        return;
      }
      const deviceId = binding.deviceId;
      setBusy(`${node}:numeric`);
      try {
        const { commands, failed: nextFailed } = await load([deviceId]);
        const list = commands[deviceId] ?? commandsByDevice[deviceId] ?? [];
        if (nextFailed.has(deviceId) && list.length === 0) {
          message.error(nameplateReasonText("list-failed"));
          return;
        }
        const command = matchNumericCommand(list);
        if (!command) {
          message.warning("该设备没有可用的数值控制命令");
          return;
        }
        const paramName = command.params?.[0]?.name ?? "value";
        const label = command.label || command.id;
        /*
         * 二次夹范围：调用方已经夹过，但这里再夹一次。
         *
         * <p>理由：`sendNumeric` 是公开 API，将来别处直接调也可能忘夹。
         * 把非法值发出去（比如 250℃）比多发一次 Math.min 危险得多。
         */
        const range = inferRangeForCommand(command);
        const safe = Math.min(range.max, Math.max(range.min, Math.round(wireValue)));

        const demo = loadTelemetrySource() === "demo";
        const live = loadTelemetrySource() === "live" && getProviderKind() === "guard";
        if (live) {
          try {
            await getCommandProvider().sendCommand(deviceId, command.id, { [paramName]: safe });
            message.success(`「${label}」已送出：${safe}`);
          } catch (error) {
            message.error(describeCommandError(error).message);
          }
          return;
        }
        if (demo) {
          /* 演示模式：把值写进本地状态，界面上的当前值跟着变 */
          applyDemoCommand(deviceId, command.id, label, { [paramName]: safe });
          message.success(`演示数据已设为 ${safe}`);
        }
      } finally {
        setBusy(null);
      }
    },
    [bindings, load, commandsByDevice],
  );

  return { stateByNode, busy, listError, send, sendNumeric };
}
