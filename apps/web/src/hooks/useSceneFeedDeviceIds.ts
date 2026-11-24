import { useMemo, useState } from "react";
import type { SceneWidgetLayout } from "@idt/data-adapter";
import {
  collectWidgetPerDeviceKeys,
  collectWidgetSlotKeys,
} from "../features/scene-widgets/widget-values";

/**
 * 大屏/编辑器**共用**的遥测订阅范围计算（2026-11-23）。
 *
 * <h2>为什么必须共用</h2>
 *
 * <p>这段逻辑原来在 `RuntimeShell` 和 `EditorShell` 里各写了一份，
 * 结果**编辑器漏了两路来源**，表现是「所设计即所见」做不到：
 *
 * <table>
 *   <tr><th>来源</th><th>运行态</th><th>编辑器（改之前）</th></tr>
 *   <tr><td>`document.bindings` 的 deviceId</td><td>✓</td><td>✓</td></tr>
 *   <tr><td>槽位直绑的设备（网关）</td><td>✓</td><td>✗</td></tr>
 *   <tr><td>scope 解析出的设备</td><td>✓</td><td>✗</td></tr>
 * </table>
 *
 * <p>实测后果：编辑器里「进水 / 出水」永远是 `—`、「系统启停」永远
 * 「状态未知」，而运行态两个都有值 —— 设计时看到的成品和真打开时不一样。
 * 网关不是 GLB 对象，不在 `document.bindings` 里，只被槽位直接引用。
 *
 * <p>**不要在这两个外壳里再各自拼订阅名单**。漏一路不会报错，
 * 只会让某几块卡片安静地显示「暂无数据」。
 */
/**
 * 三路来源合并成订阅名单（纯函数，便于单测）。
 *
 * <p>**任何一路都不能省**：
 * <ul>
 *   <li>`bindings` —— 挂在 GLB 节点上的设备（铭牌、选中卡）；</li>
 *   <li>`slotKeys` —— 槽位直绑的设备，典型是网关。网关不是 GLB 对象，
 *       不在 bindings 里；漏了它，「进水/出水/系统启停」永远是 `—`；</li>
 *   <li>`scopeDevices` —— device-list / bar-compare 由 scope 决定的那批。</li>
 * </ul>
 *
 * <p>资产绑定条目没有 deviceId，会被跳过 —— 不能拿 `undefined` 去发请求。
 */
export function mergeFeedDeviceIds(
  bindings: ReadonlyArray<{ deviceId?: string }> | null | undefined,
  slotKeys: Record<string, string[]> | null | undefined,
  scopeDevices: readonly string[] | null | undefined,
): string[] {
  const ids = new Set<string>();
  for (const binding of bindings ?? []) {
    if (binding.deviceId) ids.add(binding.deviceId);
  }
  for (const deviceId of Object.keys(slotKeys ?? {})) ids.add(deviceId);
  for (const deviceId of scopeDevices ?? []) ids.add(deviceId);
  return [...ids];
}

export function useSceneFeedDeviceIds(
  bindings: ReadonlyArray<{ deviceId?: string }> | null | undefined,
  layout: SceneWidgetLayout | null | undefined,
): {
  deviceIds: string[];
  slotKeys: Record<string, string[]>;
  perDeviceKeys: string[];
  scopeDevices: string[];
  setScopeDevices: (deviceIds: string[]) => void;
} {
  /*
   * 槽位直绑的设备。这份表同时服务两条链路：
   *   · 实时订阅 —— 没有它，网关的遥测压根不会被订阅；
   *   · 演示数据 —— 没有它，演示模式下的系统功率永远是「—」。
   */
  const slotKeys = useMemo(() => collectWidgetSlotKeys(layout), [layout]);

  /* 「按设备逐台读一列」的卡只给键名，设备由 scope 决定。 */
  const perDeviceKeys = useMemo(() => collectWidgetPerDeviceKeys(layout), [layout]);

  /* 范围解析出的设备，由 `WidgetOverlay` 的 `onScopeDevicesChange` 回传。 */
  const [scopeDevices, setScopeDevices] = useState<string[]>([]);

  const deviceIds = useMemo(
    () => mergeFeedDeviceIds(bindings, slotKeys, scopeDevices),
    [bindings, slotKeys, scopeDevices],
  );

  return { deviceIds, slotKeys, perDeviceKeys, scopeDevices, setScopeDevices };
}
