
import type { Device, DeviceBinding, DevicePoint, ParsedHmiScene, TelemetryRecord } from "@idt/shared-types";
import {
  isRealtimePlatformDevice,
  widgetScopeIsBound,
  widgetTypeMeta,
  widgetScopeKey,
  type SceneWidget,
  type SceneWidgetLayout,
  type SceneWidgetSlot,
} from "@idt/data-adapter";
import { SYS_RUN_STATE_KEY, bindingRunningState, formatMetricNumber, formatTelemetryText, mappingKeys, readLatest, sysRunStateKind } from "../../utils/device-plates";
import { displayNameOf } from "../../utils/display-name";

export type SlotUnavailableReason =
  | "unbound"
  | "missing"
  | "stale"
  | "forbidden"
  | "unreachable";

export type SlotReading = {
  label: string;
  text: string;
  unit?: string;
  bound: boolean;
  missing: boolean;
  source?: TelemetryRecord["source"];
  numeric?: number;

  /** 值从哪来。资产属性没有「实时」概念，界面上要能区分开。 */
  origin?: "device-telemetry" | "asset-attribute";
  /**
   * 这个值是槽位上写死的常量（量程/阈值/参考线），不是任何设备的数据。
   *
   * <p>保留原值本身，而不只是个布尔：调用方要知道「量程是 100」
   * 才能解释环的满刻度（`maxOrigin: "constant"`）。
   */
  constant?: number;
  /** 过期判据用的时间戳（遥测是 ts，属性是 lastUpdatedTs） */
  staleAt?: number;
  /*
   * 「为什么没有值」要能分开说。五种的处置完全不同：
   * unbound=去配绑定 / missing=设备没上报 / stale=数据停了 /
   * forbidden=没有权限 / unreachable=暂时连不上。
   * 全都画成「—」的话，用户只会反复刷新。
   */
  unavailableReason?: SlotUnavailableReason;
};

/** 资产属性读取结果，键为 `${assetId}:${attributeKey}`。 */
export type AssetAttributeLookup = Map<string, { value: number | string | boolean; lastUpdatedTs: number }>;

export function assetAttrKey(assetId: string, attributeKey: string): string {
  return `${assetId}:${attributeKey}`;
}

/*
 * 设备专题抽屉的几何（2026-11-23）。
 *
 * <p>选中设备后，选中卡不再留在右翼窄栏里，而是**展开成右侧抽屉**，
 * 占住「外围统计滑出后腾出的空间」。
 *
 * <p>为何定在 66%~5%：
 * <ul>
 *   <li>左边界 66% —— 与左翼卡片（2.5%~19%）之间还留 47% 给 3D 主体，
 *       保证「点开设备也不是全屏遮死模型」；</li>
 *   <li>右边界 97.5% —— 与模板右边距一致，不顶到屏幕边；</li>
 *   <li>垂直 11%~91% —— 避开顶部标题与底栏。</li>
 * </ul>
 *
 * <p>★ 这只是**渲染期几何，绝不写回 layout**。退出选中时直接用原
 * x/y/w/h 渲染，布局数据从未被动过 —— 这正是原注释担心的「改坏布局」
 * 的规避方式（旧方案只淡出不变宽，就是因为怕写回）。
 */
export const DEVICE_DRAWER_RECT = { x: 66, y: 11, w: 31.5, h: 80 } as const;

/** 渲染期的几何：要么用布局值，要么用抽屉矩形。 */
export function widgetRenderRect(
  widget: Pick<SceneWidget, "x" | "y" | "w" | "h" | "type">,
  deviceFocused: boolean,
): { x: number; y: number; w: number; h: number } {
  if (deviceFocused && widget.type === "selection-card") return DEVICE_DRAWER_RECT;
  return { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
}

/**
 * 聚焦时**不滑出**的类型（2026-11-23）。
 *
 * <p>标题 / 说明不是「统计」—— 滑走会让屏幕像坏了一半；
 * 选中卡本身是抽屉，不参与滑出。
 */
export const EXIT_EXEMPT_TYPES: ReadonlySet<string> = new Set([
  "selection-card",
  "title",
  "caption",
]);

/** 滑出方向。 */
export type ExitDirection = "left" | "right" | "down" | "none";

/**
 * 滑出方向判定（2026-11-23）。
 *
 * <h2>★ 为什么不能用 `zoneForExistingWidget`</h2>
 *
 * <p>试过，不行。那个函数是「归区」（决定部件属于左翼/右翼/底部），
 * 判断顺序是：先看 x 是否靠右、**再看 x 是否靠左**、最后才看 y。
 * 于是 y=83% 的底部趋势卡因为起点 x=3.13% 被判定成 `left`（实测）。
 *
 * <p>滑出要的是「向哪边出去最近」，与「归属哪个区」是两件事。
 * 混用会让底部卡往左滑 —— 虽然也能消失，但与「向最近外侧」的直觉不符；
 * 而改 `zoneForExistingWidget` 会影响 `preferredWingZone` 等调用方，风险更大。
 *
 * <h2>判定规则</h2>
 *
 * <p>先判纵向再判横向：底部条带上的卡（y ≥ 70%）无论靠左靠右都向下走。
 * 否则两张底卡一个向左一个向下，看起来很乱。
 */
export function exitDirectionOf(
  widget: Pick<SceneWidget, "x" | "y" | "w" | "type">,
): ExitDirection {
  if (EXIT_EXEMPT_TYPES.has(widget.type)) return "none";
  /* 底部条带优先：底卡向下滑，不参与左右判断 */
  if (widget.y >= 70) return "down";
  /* 用中心点而非左边界：跨中线的宽卡按重心决定方向更符直觉 */
  const center = widget.x + widget.w / 2;
  return center < 50 ? "left" : "right";
}

/**
 * 是否进入设备专题模式（2026-11-23）。
 *
 * <h2>为什么要抽成纯函数</h2>
 *
 * <p>这个判据原本内联在 `WidgetOverlay` 里，只判「运行态 + 有选中对象」。
 * 客户同日要求删掉「选中机组」卡后，专题模式只剩「外围滑出」这一半 ——
 * 点一台设备，外围卡全部飞走，却没有抽屉补位，屏幕上一片空白。
 *
 * <p>那种缺陷**不报错**，只能靠人盯着屏幕发现。所以把判据抽出来、
 * 单测钉住：将来谁把 selection-card 加回去（专题模式自动恢复）或再删掉
 * （自动停用），行为变化都能在测试里看到，而不是等交付后才被指出来。
 *
 * <h3>为什么必须有 selection-card</h3>
 *
 * <p>专题模式是**成对动作**：外围让位 + 抽屉补位。没有抽屉时让位是纯损失 ——
 * 用户看不到任何新信息，也没有「怎么回去」的提示（关闭按钮长在抽屉上）。
 */
export function shouldEnterDeviceFocus(options: {
  surface: "editor" | "runtime";
  widgets: ReadonlyArray<Pick<SceneWidget, "type">>;
  selectedNode?: string | null;
  selectedEntityId?: string | null;
}): boolean {
  if (options.surface !== "runtime") return false;
  if (!options.selectedNode && !options.selectedEntityId) return false;
  return options.widgets.some((widget) => widget.type === "selection-card");
}

export function findBindingForSlot(slot: SceneWidgetSlot, bindings: DeviceBinding[]): DeviceBinding | undefined {
  /*
   * 资产槽优先：slot 上写了 assetId，说明这张卡看的是资产属性，
   * 不该因为 sceneEntityId 恰好能匹配到一条设备绑定就串到设备读数上。
   */
  if (slot.assetId) {
    const byAsset = bindings.find(
      (item) => item.target?.entityType === "ASSET" && item.target.entityId === slot.assetId,
    );
    if (byAsset) return byAsset;
  }
  if (slot.deviceId) {
    const byDevice = bindings.find((item) => item.deviceId === slot.deviceId);
    if (byDevice) return byDevice;
  }
  if (slot.sceneEntityId) {
    return bindings.find((item) => item.sceneEntityId === slot.sceneEntityId && item.deviceId);
  }
  return undefined;
}

function isSlotRoleKey(key?: string): boolean {
  if (!key) return false;
  if (key === "main" || key === "left" || key === "right" || key === "used" || key === "total") return true;
  return /^(used|total)-\d+$/.test(key) || /-(used|total)$/.test(key);
}

function uniqueSlotKeys(keys: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(key);
  }
  return next;
}

function slotKeys(slot: SceneWidgetSlot, binding?: DeviceBinding): string[] {
  const preferred = uniqueSlotKeys([
    slot.telemetryKey,
    isSlotRoleKey(slot.key) ? undefined : slot.key,
  ]);
  if (preferred.length) return preferred;
  if (!binding) return [];
  return uniqueSlotKeys(binding.telemetryMappings.flatMap((item) => mappingKeys(item)));
}

/**
 * 展示路径：设备列表未就绪时不把有效实时读数打空；
 * 一旦列表里能判断该 ID 不是实时设备（含旧槽里的虚拟设备），就不得显示。
 */
export function canDisplayWidgetDeviceReading(
  deviceId: string | undefined,
  devices?: Array<Pick<Device, "id" | "source" | "deviceVirtual"> & { additionalInfo?: unknown }> | null,
): boolean {
  if (!deviceId) return false;
  if (!devices || devices.length === 0) return true;
  return isWidgetBindableDeviceId(deviceId, devices);
}

function numericOf(value: number | string | boolean): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/**
 * 读一个槽位的值。v2 起有两条路径：
 *
 * - 资产属性（slot.assetId + slot.attributeKey）：走 assetAttrs 查表，不看遥测。
 * - 设备遥测（slot.deviceId / binding.deviceId）：原来的逻辑，一字未改。
 *
 * 资产分支的「过期」语义与遥测不同：属性只有 lastUpdatedTs（上次写入），
 * 超时后**仍然显示值**并标 stale —— 把值抹掉反而让人以为属性丢了。
 */
export function readSlotValue(
  slot: SceneWidgetSlot,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
  assetAttrs?: AssetAttributeLookup,
  assetError?: "forbidden" | "unreachable",
  now: number = Date.now(),
): SlotReading {
  /*
   * 静态值优先（2026-11-23）。
   *
   * <p>量程/阈值这类「设计值」不属于任何设备，但界面需要把它当值渲染
   * （仪表环的分母、参考线标注）。放在最前面：填了 constant 就完全不看
   * 绑定与设备 —— 否则一个「量程 100」的槽位会因为没有 deviceId
   * 被判成 `bound:false`，仪表环永远不算 resolved。
   */
  if (slot.constant != null && Number.isFinite(slot.constant)) {
    return {
      label: slot.label || slot.key,
      text: formatTelemetryText(slot.constant, slot.displayType, slot.unit),
      unit: slot.unit,
      bound: true,
      missing: false,
      numeric: slot.constant,
      constant: slot.constant,
    };
  }
  const binding = findBindingForSlot(slot, bindings);

  if (slot.assetId && slot.attributeKey) {
    const label = slot.label || binding?.deviceName || slot.attributeKey;
    /*
     * 「没权限」和「连不上」必须分开，虽然两者都拿不到值：
     * 前者要去找管理员开权限，后者只要等一下重试。
     */
    if (assetError) {
      return {
        label, text: "", bound: true, missing: true,
        origin: "asset-attribute", unavailableReason: assetError,
      };
    }
    /* 没传查找表 = 调用方还没读属性，不是「属性不存在」。 */
    if (!assetAttrs) {
      return {
        label, text: "", bound: true, missing: true,
        origin: "asset-attribute", unavailableReason: "unreachable",
      };
    }
    const row = assetAttrs.get(assetAttrKey(slot.assetId, slot.attributeKey));
    if (!row) {
      return {
        label, text: "", bound: true, missing: true,
        origin: "asset-attribute", unavailableReason: "missing",
      };
    }
    const staleThresholdSec = slot.staleAfterSec ?? DEFAULT_TELEMETRY_STALE_SEC;
    const stale = Boolean(row.lastUpdatedTs > 0 && now - row.lastUpdatedTs > staleThresholdSec * 1000);
    return {
      label,
      text: formatTelemetryText(row.value, undefined, undefined),
      unit: slot.unit,
      bound: true,
      missing: false,
      origin: "asset-attribute",
      staleAt: row.lastUpdatedTs,
      numeric: numericOf(row.value),
      ...(stale ? { unavailableReason: "stale" as const } : {}),
    };
  }

  const deviceId = slot.deviceId || binding?.deviceId;
  const label = slot.label || binding?.deviceName || slot.telemetryKey || slot.key;
  if (!deviceId) {
    return { label, text: "", bound: false, missing: true, unavailableReason: "unbound" };
  }
  if (!canDisplayWidgetDeviceReading(deviceId, devices)) {
    return { label, text: "", bound: false, missing: true, unavailableReason: "unbound" };
  }
  const keys = slotKeys(slot, binding);
  const row = readLatest(latest, deviceId, keys);
  if (!row) {
    return { label, text: "", bound: true, missing: true, origin: "device-telemetry", unavailableReason: "missing" };
  }
  const mapping = binding?.telemetryMappings.find((item) => keys.includes(item.telemetryKey) || keys.includes(item.field));
  const unit = slot.unit || mapping?.unit || row.unit;
  /*
   * 显示类型：槽位优先于绑定（2026-11-23）。
   * 槽位是「这一列怎么显示」，绑定是「这个测点本身是什么」。
   * 少了这一级，想在某一列把 0/1 显示成「运行/停止」就没有地方可配。
   */
  const displayType = slot.displayType || mapping?.displayType;
  /*
   * 过期判定：槽位配了就用它的，没配走默认 600 秒。
   * 不能只在配置存在时才判 —— 那等于「配漏了就静默显示假实时」。
   */
  const staleThresholdSec = slot.staleAfterSec ?? DEFAULT_TELEMETRY_STALE_SEC;
  const stale = Boolean(row.timestamp > 0 && now - row.timestamp > staleThresholdSec * 1000);
  return {
    label,
    text: formatTelemetryText(row.value, displayType, undefined),
    unit,
    bound: true,
    missing: false,
    source: row.source,
    origin: "device-telemetry",
    staleAt: row.timestamp,
    numeric: numericOf(row.value),
    ...(stale ? { unavailableReason: "stale" as const } : {}),
  };
}

/**
 * 遥测默认过期阈值（秒）。
 *
 * <p>**必须有默认值**（2026-11-23 实测教训）：原来只有槽位显式配了
 * `staleAfterSec` 才判过期，实际一个都没配 —— 结果库里数据停了 51 小时，
 * 大屏照样显示「7.4℃」，和实时数据长得一模一样。
 *
 * <p>值班员据此以为设备正在运行，可能做出完全错误的判断。
 * 宁可默认标「数据延迟」，也不要让过期数据冒充实时。
 *
 * <p>600 秒的依据：正常网关 3 秒一轮上报，即使最慢的设备也不该
 * 超过 10 分钟无更新。要放宽可在槽位上显式配 `staleAfterSec`。
 */
export const DEFAULT_TELEMETRY_STALE_SEC = 600;

export type WidgetPointOption = {
  telemetryKey: string;
  label: string;
  unit?: string;
};

export type WidgetDeviceOption = {
  deviceId: string;
  deviceName: string;
  sceneEntityId?: string;
  keys: WidgetPointOption[];
};

function pointOption(point: Pick<DevicePoint, "key" | "label" | "unit"> | { telemetryKey: string; label?: string; unit?: string }): WidgetPointOption | null {
  const telemetryKey = "telemetryKey" in point ? point.telemetryKey : point.key;
  if (!telemetryKey) return null;
  return { telemetryKey, label: point.label || telemetryKey, unit: point.unit };
}

function mergeKeys(into: WidgetPointOption[], extra: Array<WidgetPointOption | null | undefined>): WidgetPointOption[] {
  const seen = new Set(into.map((item) => item.telemetryKey));
  const next = [...into];
  for (const row of extra) {
    if (!row?.telemetryKey || seen.has(row.telemetryKey)) continue;
    seen.add(row.telemetryKey);
    next.push(row);
  }
  return next;
}

/** 只接受当前实时设备列表里的 ID。列表里没有的旧绑定（含虚拟设备）一律拒绝。 */
export function isWidgetBindableDeviceId(
  deviceId: string | undefined,
  devices: Array<Pick<Device, "id" | "source" | "deviceVirtual"> & { additionalInfo?: unknown }>,
): boolean {
  if (!deviceId) return false;
  const device = devices.find((item) => item.id === deviceId);
  return Boolean(device && isRealtimePlatformDevice(device));
}

/**
 * 把选中的实时设备写入卡片槽位。ID 不在实时列表中、或虽在 bindOptions 里却对不上设备时，返回空数组，不写槽。
 */
export function resolveWidgetBindingSlots(
  deviceId: string,
  telemetryKey: string | undefined,
  bindOptions: WidgetDeviceOption[],
  devices: Device[],
): SceneWidgetSlot[] {
  if (!isWidgetBindableDeviceId(deviceId, devices)) return [];
  const option = bindOptions.find((item) => item.deviceId === deviceId);
  if (!option) return [];
  const key = telemetryKey || option.keys[0]?.telemetryKey;
  const meta = option.keys.find((item) => item.telemetryKey === key) ?? option.keys[0];
  if (!meta) {
    return [{ key: "value", deviceId: option.deviceId, sceneEntityId: option.sceneEntityId, label: option.deviceName }];
  }
  return [{
    key: meta.telemetryKey,
    telemetryKey: meta.telemetryKey,
    label: meta.label,
    unit: meta.unit,
    sceneEntityId: option.sceneEntityId,
    deviceId: option.deviceId,
  }];
}

/**
 * 编排绑定点位：来自平台实时设备与 GLB extras.hmi，不写死名单。
 * fail-closed：不在实时设备列表中的 ID 不得进入选项，即使它还留在旧对象绑定里。
 */
export function widgetBindableDevices(input: {
  bindings: DeviceBinding[];
  devices?: Device[];
  hmi?: ParsedHmiScene | null;
  extraKeys?: Record<string, WidgetPointOption[]>;
}): WidgetDeviceOption[] {
  const devices = input.devices ?? [];
  const byId = new Map<string, WidgetDeviceOption>();

  const upsert = (option: WidgetDeviceOption) => {
    if (!isWidgetBindableDeviceId(option.deviceId, devices)) return;
    const current = byId.get(option.deviceId);
    if (!current) {
      byId.set(option.deviceId, { ...option, keys: mergeKeys([], option.keys) });
      return;
    }
    current.deviceName = current.deviceName || option.deviceName;
    if (!current.sceneEntityId && option.sceneEntityId) current.sceneEntityId = option.sceneEntityId;
    current.keys = mergeKeys(current.keys, option.keys);
  };

  for (const device of devices) {
    upsert({
      deviceId: device.id,
      /* 命名铁律：显示层一律走 displayNameOf（label 优先），不要各处手写 || name */
      deviceName: displayNameOf(device),
      keys: (device.points ?? []).map((point) => pointOption(point)).filter((row): row is WidgetPointOption => Boolean(row)),
    });
  }

  for (const binding of input.bindings) {
    if (!binding.deviceId) continue;
    upsert({
      deviceId: binding.deviceId,
      deviceName: binding.deviceName,
      sceneEntityId: binding.sceneEntityId || undefined,
      keys: binding.telemetryMappings.map((mapping) => pointOption({
        telemetryKey: mapping.telemetryKey || mapping.field,
        label: mapping.label || mapping.telemetryKey || mapping.field,
        unit: mapping.unit,
      })).filter((row): row is WidgetPointOption => Boolean(row)),
    });
  }

  const hmi = input.hmi;
  if (hmi) {
    for (const device of hmi.devices ?? []) {
      const keys = (device.data ?? []).map((row) => pointOption({
        telemetryKey: row.name,
        label: row.name,
        unit: row.unit,
      })).filter((row): row is WidgetPointOption => Boolean(row));
      if (!keys.length) continue;
      const bound = input.bindings.find((item) => item.sceneEntityId === device.node);
      if (bound?.deviceId) {
        upsert({ deviceId: bound.deviceId, deviceName: bound.deviceName || device.name, sceneEntityId: bound.sceneEntityId, keys });
      }
    }
  }

  for (const [deviceId, keys] of Object.entries(input.extraKeys ?? {})) {
    const current = byId.get(deviceId);
    if (current) current.keys = mergeKeys(current.keys, keys);
  }

  return [...byId.values()];
}

export function bindingTelemetryOptions(
  bindings: DeviceBinding[],
  devices: Device[] = [],
  hmi?: ParsedHmiScene | null,
): WidgetDeviceOption[] {
  return widgetBindableDevices({ bindings, devices, hmi });
}

export const WIDGET_UNBOUND_MESSAGE = "还没有绑定设备";

export type SceneSummary = {
  boundCount: number;
  withDataCount: number;
  runningCount: number;
  stoppedCount: number;
  offlineCount: number;
  faultCount: number;
  unknownCount: number;
};

export function summarizeSceneBindings(
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
): SceneSummary {
  const bound = bindings.filter((item) => item.deviceId && canDisplayWidgetDeviceReading(item.deviceId, devices));
  let withDataCount = 0;
  let runningCount = 0;
  let stoppedCount = 0;
  let offlineCount = 0;
  let faultCount = 0;
  let unknownCount = 0;
  for (const binding of bound) {
    const keys = [
      binding.statusMapping?.telemetryKey,
      ...binding.telemetryMappings.flatMap((item) => mappingKeys(item)),
    ];
    const row = readLatest(latest, binding.deviceId, keys);
    if (row) withDataCount += 1;
    const kind = classifyBindingStatus(binding, latest);
    if (kind === "running") runningCount += 1;
    else if (kind === "fault") faultCount += 1;
    else if (kind === "offline") {
      offlineCount += 1;
      stoppedCount += 1;
    } else unknownCount += 1;
  }
  return {
    boundCount: bound.length,
    withDataCount,
    runningCount,
    stoppedCount,
    offlineCount,
    faultCount,
    unknownCount,
  };
}

export type BindingStatusKind = "running" | "offline" | "fault" | "unknown";

function statusText(value: unknown): string {
  return value == null ? "" : String(value).trim().toLowerCase();
}

export function classifyStatusValue(value: unknown): BindingStatusKind {
  const textValue = statusText(value);
  if (/故障|fault|alarm|error|告警/.test(textValue)) return "fault";
  if (/离线|offline/.test(textValue)) return "offline";
  if (value === false || value === 0 || value === "0" || value === "false" || value === "off" || /停止|停机|stopped|stop/.test(textValue)) {
    return "offline";
  }
  if (value === true || value === 1 || value === "1" || value === "true" || value === "on" || /运行|开/.test(textValue)) {
    return "running";
  }
  return "unknown";
}

/**
 * 热泵机组的系统/外机运行状态键（手册 §17 MODBUS 30001 / 30003+100a）。
 *
 * <p>它是 **0~9 枚举**，不是布尔，也不是「1=运行」那种约定：
 * `1=停机`、`5=运行`、`8=故障`。直接丢给 {@link classifyStatusValue} 会得到
 * 三个都是错的结果：1 被判成运行、5 和 8 被判成未知。所以必须专用解析。
 */
/**
 * 枚举表只有一份，在 utils/device-plates.ts —— 那里 3D 动画也要用。
 * 这里 re-export 是为了部件层调用方便，**不要在这里再写一张表**：
 * 两张表一旦分叉，就会出现「列表说停机、风扇在转」这种自相矛盾。
 */
export { SYS_RUN_STATE_KEY };

/** 语义别名：与 {@link sysRunStateKind} 完全等价，保留旧名以免改一堆调用点。 */
export const classifySysRunState = sysRunStateKind;

export function classifyBindingStatus(
  binding: DeviceBinding,
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
): BindingStatusKind {
  /*
   * 先单独处理 sys_run_state：它是枚举，混进下面的通用正则会被误判。
   * 只在这个 binding 确实映射了它时才读，避免给别的设备多发一次查表。
   */
  const mapped = binding.telemetryMappings.some((m) => mappingKeys(m).includes(SYS_RUN_STATE_KEY));
  if (mapped) {
    const sysRow = readLatest(latest, binding.deviceId, [SYS_RUN_STATE_KEY]);
    if (sysRow) {
      const kind = classifySysRunState(sysRow.value);
      if (kind !== "unknown") return kind;
      /*
       * 枚举是 0(初始化) / 9(测试) 时 unknown 是**正确答案**，不能继续
       * 往下走通用逻辑 —— 那会让 readLatest 再读到一个无关的 running 键。
       */
      return "unknown";
    }
  }

  const keys = [
    binding.statusMapping?.telemetryKey,
    ...binding.telemetryMappings
      .filter((mapping) => {
        const textValue = `${mapping.label} ${mapping.field} ${mapping.telemetryKey}`.toLowerCase();
        return /状态|status|running|runstate|故障|fault|alarm|离线|offline/.test(textValue);
      })
      .flatMap((item) => mappingKeys(item)),
  ];
  const row = readLatest(latest, binding.deviceId, keys);
  if (row) {
    const classified = classifyStatusValue(row.value);
    if (classified !== "unknown") return classified;
  }
  const running = bindingRunningState(binding, latest);
  if (running === true) return "running";
  if (running === false) return "offline";
  return "unknown";
}

const DEFAULT_STATUS_KEYS = [
  "status",
  "state",
  "running",
  "runState",
  "run_state",
  "online",
  "offline",
  "fault",
  "alarm",
  "active",
  "workStatus",
  "work_status",
];

export function classifyDeviceStatus(
  deviceId: string,
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  bindings: DeviceBinding[] = [],
): BindingStatusKind {
  const binding = bindings.find((item) => item.deviceId === deviceId);
  if (binding) {
    const kind = classifyBindingStatus(binding, latest);
    if (kind !== "unknown") return kind;
  }
  /*
   * 没有 binding 时，仍要先看 sys_run_state —— 大屏的「9 台设备列表」按
   * scope 拿设备，很多设备此刻还没配绑定，但遥测已经在报。
   * 不做这一步的话，真实协议设备只要没配绑定就一律显示「未知」。
   */
  const sysRow = readLatest(latest, deviceId, [SYS_RUN_STATE_KEY]);
  if (sysRow) return classifySysRunState(sysRow.value);
  const row = readLatest(latest, deviceId, DEFAULT_STATUS_KEYS);
  return row ? classifyStatusValue(row.value) : "unknown";
}

export function summarizeScopedDevices(
  deviceIds: string[] | undefined,
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  bindings: DeviceBinding[] = [],
  devices?: Device[] | null,
): SceneSummary {
  const ids = (deviceIds ?? []).filter((id) => canDisplayWidgetDeviceReading(id, devices));
  let withDataCount = 0;
  let runningCount = 0;
  let stoppedCount = 0;
  let offlineCount = 0;
  let faultCount = 0;
  let unknownCount = 0;
  for (const deviceId of ids) {
    const kind = classifyDeviceStatus(deviceId, latest, bindings);
    const row = readLatest(latest, deviceId, DEFAULT_STATUS_KEYS);
    if (row) withDataCount += 1;
    if (kind === "running") runningCount += 1;
    else if (kind === "fault") faultCount += 1;
    else if (kind === "offline") {
      offlineCount += 1;
      stoppedCount += 1;
    } else unknownCount += 1;
  }
  return {
    boundCount: ids.length,
    withDataCount,
    runningCount,
    stoppedCount,
    offlineCount,
    faultCount,
    unknownCount,
  };
}

/**
 * 一台设备在大屏列表/对比图里的一行。
 *
 * 与 {@link summarizeScopedDevices} 的区别：那个给合计（几台运行几台故障），
 * 这个给**逐台明细**。9 台机组的大屏要两种都有：左翼列表逐台看，
 * 汇总卡看整体。
 */
export interface ScopedDeviceRow {
  deviceId: string;
  /** 显示名：优先设备的 label，其次 name，最后设备 id */
  name: string;
  status: BindingStatusKind;
  /** 按 keys 顺序取到的读数（缺的项 missing=true） */
  readings: Array<{
    key: string;
    label: string;
    text: string;
    unit?: string;
    numeric?: number;
    missing: boolean;
    /** 画成进度条而不是文字（template01 的 .bar-row） */
    render?: "bar";
    /** 进度条满量程，缺省 100 */
    barMax?: number;
    /** 0~1 的条长比例；render 不是 bar 或没数值时为 undefined */
    ratio?: number;
    /** 这一列是开关量状态（displayType=boolean）—— 渲染层可据此省掉文字 */
    isStatus?: boolean;
  }>;
}

function deviceDisplayName(deviceId: string, bindings: DeviceBinding[], devices?: Device[] | null): string {
  const device = devices?.find((d) => d.id === deviceId);
  if (device) return displayNameOf(device, deviceId);
  const binding = bindings.find((b) => b.deviceId === deviceId);
  return binding?.deviceName || deviceId;
}

/**
 * 按 scope 列设备明细。
 *
 * <p>keys 是要展示的测点：不传就只给状态；传了 `["load_rate"]` 就多带一列读数。
 * 读数走 {@link readLatest}，与铭牌/其他部件同一套取数口径，不做第二套。
 *
 * <p>name 优先用 devices 里的 label（客户改的显示名），拿不到才退回 binding
 * 的 deviceName —— 后者是建档时的快照，客户改名后会过期。
 */
export function listScopedDevices(
  deviceIds: string[] | undefined,
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  bindings: DeviceBinding[] = [],
  devices?: Device[] | null,
  keys: string[] = [],
  /*
   * 传 slots 时以它为准（2026-11-23）。
   *
   * <p>`keys` 只有测点键，丢掉了槽位上的 `displayType` 与 `label`。
   * 实测后果：`running` 上报 0/1，槽位配了 `displayType: "boolean"`，
   * 大屏却显示「1」而不是「运行」—— 因为这里把 displayType 写死成 undefined，
   * 根本没往 formatTelemetryText 传。
   *
   * <p>保留 keys 参数是为了兼容只用键的调用方（bar-compare 只比一个数值列）。
   */
  slots?: SceneWidgetSlot[],
): ScopedDeviceRow[] {
  const ids = (deviceIds ?? []).filter((id) => canDisplayWidgetDeviceReading(id, devices));
  const columns = slots?.length
    ? slots.map((slot) => ({
        key: slot.telemetryKey || slot.key,
        label: slot.label || slot.telemetryKey || slot.key,
        displayType: slot.displayType,
        unit: slot.unit,
        render: slot.render,
        barMax: slot.barMax,
      }))
    : keys.map((key) => ({ key, label: key, displayType: undefined, unit: undefined, render: undefined, barMax: undefined }));
  return ids.map((deviceId) => ({
    deviceId,
    name: deviceDisplayName(deviceId, bindings, devices),
    status: classifyDeviceStatus(deviceId, latest, bindings),
    readings: columns.map((column) => {
      const row = readLatest(latest, deviceId, [column.key]);
      if (!row) {
        return { key: column.key, label: column.label, text: "", missing: true };
      }
      const numeric = typeof row.value === "number" && Number.isFinite(row.value)
        ? row.value
        : Number.isFinite(Number(row.value)) ? Number(row.value) : undefined;
      /*
       * 进度条比例：把原始值按满量程归一，钳到 0~1。
       * 超量程（如开度报 105）不画出格 —— 画出去会溢出容器，
       * 看起来像样式坏了而不是数据异常。
       */
      const barMax = column.barMax && column.barMax > 0 ? column.barMax : 100;
      const ratio =
        column.render === "bar" && numeric != null
          ? Math.min(1, Math.max(0, numeric / barMax))
          : undefined;
      return {
        key: column.key,
        label: column.label,
        text: formatTelemetryText(row.value, column.displayType, column.unit ?? row.unit),
        unit: column.unit ?? row.unit,
        numeric,
        missing: false,
        ...(column.render === "bar" ? { render: "bar" as const, barMax, ratio } : {}),
        ...(column.displayType === "boolean" ? { isStatus: true } : {}),
      };
    }),
  }));
}

export function widgetScopeDeviceIds(
  widget: Pick<SceneWidget, "scope">,
  scopeDeviceIds?: Record<string, string[]>,
): string[] | undefined {
  const key = widgetScopeKey(widget.scope);
  if (!key) return undefined;
  return scopeDeviceIds?.[key];
}

export function selectionBindings(
  selected: string | Array<string | null | undefined> | null | undefined,
  bindings: DeviceBinding[],
  devices?: Device[] | null,
): DeviceBinding[] {
  const keys = new Set(
    (Array.isArray(selected) ? selected : [selected]).filter((item): item is string => Boolean(item)),
  );
  if (!keys.size) return [];
  return bindings.filter((item) => item.deviceId && keys.has(item.sceneEntityId) && canDisplayWidgetDeviceReading(item.deviceId, devices));
}

export function hasSummaryCard(layoutWidgets: SceneWidget[]): SceneWidget | undefined {
  return layoutWidgets.find((item) => item.type === "summary-card");
}

export const METRIC_SLOT_KEYS = ["main", "left", "right"] as const;
export type MetricSlotKey = (typeof METRIC_SLOT_KEYS)[number];

export function metricSlotKey(slot: SceneWidgetSlot, index: number): MetricSlotKey {
  if (slot.key === "main" || slot.key === "left" || slot.key === "right") return slot.key;
  if (index <= 0) return "main";
  if (index === 1) return "left";
  return "right";
}

export type MetricBreakdown = {
  main?: SlotReading;
  left?: SlotReading;
  right?: SlotReading;
};

export function readMetricBreakdown(
  widget: SceneWidget,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
  assetAttrs?: AssetAttributeLookup,
  assetError?: "forbidden" | "unreachable",
): MetricBreakdown {
  const slots = widget.slots ?? [];
  const result: MetricBreakdown = {};
  slots.forEach((slot, index) => {
    const key = metricSlotKey(slot, index);
    if (result[key]) return;
    result[key] = readSlotValue(slot, bindings, latest, devices, assetAttrs, assetError);
  });
  return result;
}

export type RatioRingGroup = {
  index: number;
  label: string;
  used?: SlotReading;
  total?: SlotReading;
  usedValue?: number;
  totalValue?: number;
  ratio?: number;
  resolved: boolean;
};

function ratioSlotRole(slot: SceneWidgetSlot, index: number): "used" | "total" {
  /*
   * `value` / `max` 是仪表（gauge-ring）的自然命名，`used` / `total` 是圆环的。
   * 两者语义等价（分子 / 分母），所以在这里一起认（2026-11-23）。
   *
   * <p>为什么要认两套而不是统一成一套：
   * 「已用 / 总数」和「当前值 / 量程」是两种不同的业务语汇，
   * 强行让仪表的槽位叫 `used`，配置面板上会显示「已用 12」而实际含义是
   * 「当前加载率 12%」—— 配一个错一个字。
   */
  if (slot.key === "total" || slot.key.startsWith("total-") || slot.key.endsWith("-total")) return "total";
  if (slot.key === "used" || slot.key.startsWith("used-") || slot.key.endsWith("-used")) return "used";
  if (slot.key === "max" || slot.key.startsWith("max-") || slot.key.endsWith("-max")) return "total";
  if (slot.key === "value" || slot.key.startsWith("value-") || slot.key.endsWith("-value")) return "used";
  return index % 2 === 0 ? "used" : "total";
}

function ratioGroupIndex(slot: SceneWidgetSlot, index: number): number {
  const match = /(?:used|total|value|max)-(\d+)/.exec(slot.key);
  if (match) return Number(match[1]);
  return Math.floor(index / 2);
}

export function readRatioRingGroups(
  widget: SceneWidget,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
  scopeDeviceIds?: string[] | Record<string, string[]>,
  assetAttrs?: AssetAttributeLookup,
  assetError?: "forbidden" | "unreachable",
): RatioRingGroup[] {
  const slots = widget.slots ?? [];
  const groups = new Map<number, RatioRingGroup>();
  const ensure = (index: number, label?: string): RatioRingGroup => {
    const current = groups.get(index) ?? { index, label: label || `组 ${index + 1}`, resolved: false };
    if (label && (current.label.startsWith("组 ") || !current.label)) current.label = label;
    groups.set(index, current);
    return current;
  };
  slots.forEach((slot, index) => {
    const groupIndex = ratioGroupIndex(slot, index);
    const role = ratioSlotRole(slot, index);
    const reading = readSlotValue(slot, bindings, latest, devices, assetAttrs, assetError);
    const group = ensure(groupIndex, slot.label);
    if (role === "used") group.used = reading;
    else group.total = reading;
    if (reading.numeric != null) {
      if (role === "used") group.usedValue = reading.numeric;
      else group.totalValue = reading.numeric;
    }
  });
  const pointGroups = [...groups.values()]
    .sort((a, b) => a.index - b.index)
    .map((group) => {
      const resolved = group.used?.bound === true && !group.used.missing && group.total?.bound === true && !group.total.missing
        && group.usedValue != null && group.totalValue != null && group.totalValue !== 0;
      const ratio = resolved && group.usedValue != null && group.totalValue != null
        ? Math.max(0, Math.min(1, group.usedValue / group.totalValue))
        : undefined;
      return { ...group, resolved, ratio };
    });
  if (pointGroups.some((group) => group.resolved)) return pointGroups;
  if (!widgetScopeIsBound(widget.scope)) return pointGroups;
  const ids = Array.isArray(scopeDeviceIds) ? scopeDeviceIds : widgetScopeDeviceIds(widget, scopeDeviceIds);
  if (!ids) return [];
  const summary = summarizeScopedDevices(ids, latest, bindings, devices);
  if (!summary.boundCount) return [];
  const used: SlotReading = {
    label: "运行",
    text: String(summary.runningCount),
    bound: true,
    missing: false,
    numeric: summary.runningCount,
  };
  const total: SlotReading = {
    label: "总数",
    text: String(summary.boundCount),
    bound: true,
    missing: false,
    numeric: summary.boundCount,
  };
  return [{
    index: 0,
    label: widget.title || "运行台数",
    used,
    total,
    usedValue: summary.runningCount,
    totalValue: summary.boundCount,
    resolved: true,
    ratio: summary.boundCount > 0 ? summary.runningCount / summary.boundCount : 0,
  }];
}

/**
 * 环形仪表的取数结果（2026-11-23）。
 *
 * <p>与 `RatioRingGroup` 形状相似但**语义不同**：
 * <ul>
 *   <li>`RatioRingGroup` —— 已用/总数，两边都应该是真实测点；</li>
 *   <li>`GaugeRing` —— 当前值/量程，量程允许是设计常量（`slot.constant`），
 *       没配时用 `DEFAULT_GAUGE_MAX`。</li>
 * </ul>
 *
 * <p>刻意不复用同一个类型名：两者「缺量程怎么办」的答案相反 ——
 * 圆环缺总数就该报「未绑定」，仪表缺量程默认 100% 才合理。
 * 共用类型会让这个差异被抹平，后来人分不清该走哪套判定。
 */
export type GaugeRing = {
  index: number;
  label: string;
  /** 当前值。 */
  value?: SlotReading;
  /** 量程上限。`source` 标明它是绑来的还是默认的。 */
  max?: SlotReading;
  valueNum?: number;
  maxNum?: number;
  /** 0~1，已钳位。 */
  ratio?: number;
  resolved: boolean;
  /** 量程从哪来：测点 / 常量 / 默认兜底。界面要能说清，否则「为什么是 100%」无从解释。 */
  maxOrigin?: "slot" | "constant" | "default";
};

/** 仪表默认满量程（百分比类最常见）。 */
export const DEFAULT_GAUGE_MAX = 100;

/**
 * 读环形仪表的「值 / 量程」。
 *
 * <h2>槽位约定</h2>
 *
 * <p>沿用 `readRatioRingGroups` 的分组与角色判定（`used`/`total` 命名），
 * 因为它已经是成熟的：多组仪表（`value`/`max`）与双组（`value-1`/`max-1`）
 * 都能正确分组。这里只做**语义映射**（used→value、total→max）
 * 与**量程兜底**，不复制一套解析。
 *
 * <h2>★ 未配量程 vs 配了取不到，必须分开</h2>
 *
 * <ul>
 *   <li><b>未配量程槽</b>（`group.total` 为 undefined）→ 用默认 100。
 *       意图是「百分比类指标」，100 是合理假设；</li>
 *   <li><b>配了但取不到</b>（`group.total.bound && missing`）→ **不兜底**。
 *       用户明确要了真实量程却拿不到，用 100 顶替会画出一个**看起来正常、
 *       实际无意义**的环 —— 那比空着危险。</li>
 * </ul>
 */
export function readGaugeRings(
  widget: SceneWidget,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
  scopeDeviceIds?: string[] | Record<string, string[]>,
  assetAttrs?: AssetAttributeLookup,
  assetError?: "forbidden" | "unreachable",
): GaugeRing[] {
  const groups = readRatioRingGroups(widget, bindings, latest, devices, scopeDeviceIds, assetAttrs, assetError);
  return groups.map((group) => {
    const value = group.used;
    const valueNum = group.usedValue;
    let maxNum = group.totalValue;
    let maxOrigin: GaugeRing["maxOrigin"];
    if (group.total === undefined) {
      maxNum = DEFAULT_GAUGE_MAX;
      maxOrigin = "default";
    } else if (group.total.missing) {
      /*
       * 配了量程但没值 —— 保持 maxNum 为 undefined，下面 resolved 会判 false。
       * `maxOrigin: "slot"` 让界面能说「量程未上报」而不是「无数据」。
       */
      maxNum = undefined;
      maxOrigin = "slot";
    } else {
      maxOrigin = group.total.constant != null ? "constant" : "slot";
    }
    const resolved =
      Boolean(value?.bound) &&
      !value?.missing &&
      valueNum != null &&
      maxNum != null &&
      maxNum > 0;
    return {
      index: group.index,
      label: group.label,
      value,
      max: group.total,
      valueNum,
      maxNum,
      ratio: resolved && valueNum != null && maxNum != null ? Math.max(0, Math.min(1, valueNum / maxNum)) : undefined,
      resolved,
      maxOrigin,
    } satisfies GaugeRing;
  });
}

export function assignWidgetSlot(
  slots: SceneWidgetSlot[] | undefined,
  index: number,
  deviceId: string,
  telemetryKey: string | undefined,
  bindOptions: WidgetDeviceOption[],
  devices: Device[],
  preset?: Partial<SceneWidgetSlot>,
): SceneWidgetSlot[] {
  const next = [...(slots ?? [])];
  while (next.length <= index) next.push({ key: preset?.key || `slot-${next.length}` });
  if (!deviceId) {
    const cleared: SceneWidgetSlot = { key: preset?.key || next[index]?.key || `slot-${index}` };
    if (preset?.label) cleared.label = preset.label;
    next[index] = cleared;
    return next;
  }
  const resolved = resolveWidgetBindingSlots(deviceId, telemetryKey, bindOptions, devices);
  if (!resolved.length) return slots ?? [];
  /*
   * ★ 绑设备时**必须清掉资产字段**（2026-11-23）。
   * 从「资产属性」切回「设备遥测」时，若还留着 assetId，
   * readSlotValue 会先命中资产分支把设备读数盖掉 ——
   * 表现为「明明选了设备，显示的还是那个资产的旧值」。
   * 两种来源互斥，这里是覆盖式写入。
   */
  const { assetId: _dropAsset, attributeKey: _dropKey, attributeScope: _dropScope, ...rest } = resolved[0]!;
  next[index] = {
    ...rest,
    key: preset?.key || resolved[0]!.key,
    label: preset?.label || resolved[0]!.label,
    unit: preset?.unit || resolved[0]!.unit,
  };
  return next;
}

/**
 * 给槽位绑资产属性（2026-11-23）。
 *
 * <p>与 {@link assignWidgetSlot} 的关键差异：**必须清掉 deviceId / telemetryKey**。
 *
 * <p>两种来源是互斥的：一个槽要么读设备遥测、要么读资产属性。
 * 若留着 deviceId，`readSlotValue` 会先命中「资产分支」忽略它，
 * 但绑定写回后端时后端会按 deviceId 校验设备归属 —— 出现「配的是资产，
 * 却要求资产属于某个设备」的荒谬错误。所以这里是覆盖式写入，不是合并。
 *
 * <p>`assetId` 为空表示解绑，整条槽退回只剩 key/label。
 */
export function assignWidgetAssetSlot(
  slots: SceneWidgetSlot[] | undefined,
  index: number,
  assetId: string,
  attributeKey: string | undefined,
  preset?: Partial<SceneWidgetSlot>,
): SceneWidgetSlot[] {
  const next = [...(slots ?? [])];
  while (next.length <= index) next.push({ key: preset?.key || `slot-${next.length}` });
  const current = next[index];
  const base: SceneWidgetSlot = { key: preset?.key || current?.key || `slot-${index}` };
  /*
   * label / unit 优先用 preset，其次保留槽位原有的 ——
   * 解绑（assetId 为空）不该把标题也一起抹掉，否则界面上那张卡会变成无名卡。
   */
  const label = preset?.label || current?.label;
  const unit = preset?.unit || current?.unit;
  if (label) base.label = label;
  if (unit) base.unit = unit;
  if (preset?.staleAfterSec) base.staleAfterSec = preset.staleAfterSec;
  if (!assetId) {
    next[index] = base;
    return next;
  }
  next[index] = {
    ...base,
    assetId,
    ...(attributeKey ? { attributeKey } : {}),
    /* 资产属性没有「实时」概念，默认按 10 分钟判陈旧；调用方可用 preset 覆盖。 */
    staleAfterSec: preset?.staleAfterSec ?? 600,
  };
  return next;
}

/**
 * 收集布局里所有「槽位绑定的设备 + 键」。
 *
 * <p>两个消费方都需要它，而且缺了都会静默失效：
 * <ul>
 *   <li>实时订阅 —— 少了它，网关设备的遥测不会被订阅，
 *       表现为「3D 铭牌有数、大屏系统功率永远是 —」；</li>
 *   <li>演示数据 —— 少了它，开演示后大屏卡片全是「未上报」。</li>
 * </ul>
 *
 * <p>只收 `deviceId + telemetryKey` 都齐的槽：资产属性槽走另一条链路（读属性，不是遥测），
 * 混进来会给资产 id 发遥测订阅请求。
 */
export function collectWidgetSlotKeys(
  layout: Pick<SceneWidgetLayout, "widgets"> | null | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const widget of layout?.widgets ?? []) {
    for (const slot of widget.slots ?? []) {
      const deviceId = slot.deviceId;
      const key = slot.telemetryKey;
      if (!deviceId || !key) continue;
      const list = (out[deviceId] ??= []);
      if (!list.includes(key)) list.push(key);
    }
    /*
     * 控制条的状态键（2026-11-23）。
     *
     * <p>`control-bar` 用 `controls[].stateKey` 读当前开关状态，它**不在 slots 里**
     * （控制是发命令，不是读值，所以没占槽位）。但订阅与演示数据都按这张表走 ——
     * 漏掉它就等于：
     * <ul>
     *   <li>实时模式：`sys_run_state` 永远不被订阅 → 按钮永远显示「状态未知」，</li>
     *   <li>演示模式：不会造这个键 → 按钮靠本地内存兜底，刷新页面就复位。</li>
     * </ul>
     * 而且这个坑不报错，只是「按钮不反映实际状态」—— 现场会误判成网关没上报。
     */
    for (const control of widget.controls ?? []) {
      const key = control.stateKey;
      const deviceId = control.deviceId;
      if (!deviceId || !key) continue;
      const list = (out[deviceId] ??= []);
      if (!list.includes(key)) list.push(key);
    }
  }
  return out;
}

/**
 * 收集「按设备逐台的列」键：槽位只有 telemetryKey、没有 deviceId、也不是资产槽。
 *
 * <p>这类卡的语义是「每台设备各自读这一列」（9 台各自的出水温度 / 加载率）。
 * 演示数据需要它，因为绑定的 telemetryMappings 里可能没有这个键
 * —— 实测：机组加载率读 load_rate，而 load_rate 不在任何 3D 绑定里。
 *
 * <p>资产槽必须排除：它的键是属性名，不能当遥测键去造数。
 */
export function collectWidgetPerDeviceKeys(
  layout: Pick<SceneWidgetLayout, "widgets"> | null | undefined,
): string[] {
  const out: string[] = [];
  for (const widget of layout?.widgets ?? []) {
    for (const slot of widget.slots ?? []) {
      const key = slot.telemetryKey;
      if (!key || slot.deviceId || slot.assetId) continue;
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}

export type WidgetSurfaceMode = "editor" | "runtime";

export function widgetHasResolvableValue(
  widget: SceneWidget,
  input: {
    bindings: DeviceBinding[];
    latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>;
    history?: Record<string, { timestamp: number; value: number }[]>;
    devices?: Device[] | null;
    selectedNode?: string | null;
    selectedEntityId?: string | null;
    sceneTitle?: string;
    scopeDeviceIds?: Record<string, string[]>;
    /** 资产属性查找表。不传时资产槽一律判为「还没有值」 */
    assetAttrs?: AssetAttributeLookup;
    assetError?: "forbidden" | "unreachable";
  },
): boolean {
  const { bindings, latest, devices, assetAttrs, assetError } = input;
  /*
   * 语义（2026-11-23 调整）：**配置完整就该出现**，数据缺不缺是卡片自己的事。
   *
   * <p>改之前判据是「绑了 **且** 有值」，网关一断线整屏卡片成片消失。
   * 三种状态被压成两种，用户分不清：
   * <ul>
   *   <li>没配（漏配）—— 确实该隐藏，运行态不该露半成品；</li>
   *   <li>配了、没数（网关没上报）—— **该显示**，卡上说「暂无数据」，</li>
   *   <li>配了、有数 —— 正常。</li>
   * </ul>
   *
   * <p>参考模板（`template01` README）也是这个要求：
   * 「对缺失、过期、无权限的数据明确显示『暂无数据 / 数据延迟 / 无权限』」。
   */
  if (widget.type === "title") {
    return Boolean(widget.title?.trim() || input.sceneTitle?.trim());
  }
  if (widget.type === "caption") {
    return Boolean(widget.title?.trim());
  }
  if (widget.type === "summary-card") {
    if (!widgetScopeIsBound(widget.scope)) return false;
    const ids = widgetScopeDeviceIds(widget, input.scopeDeviceIds);
    /*
     * 有设备就显示 —— 原来还要求 `boundCount > 0`（至少一台有读数），
     * 网关断线时整块「运行汇总」消失，而那恰恰是最该被看到的时候
     * （它要告诉你 0 台运行）。卡片体已有「运行状态暂无数据」的兜底。
     */
    return Boolean(ids?.length);
  }
  if (widget.type === "alarm-ticker") {
    /*
     * 告警跑马灯总是显示（2026-11-23）。
     *
     * <p>它不绑任何设备/测点：数据来自平台活跃告警列表，与场站范围无关。
     * 「没有告警」也必须显示 —— 那是个**好消息**，整块消失会让值班员
     * 以为是卡片坏了，而不是「当前安全」。卡片体自己处理空态。
     */
    return true;
  }
  if (widget.type === "selection-card") {
    /*
     * 判据改成「场景里有可选中设备」，而不是「当前已选中且已绑定」（2026-11-23）。
     *
     * <p>原来的判据让这张卡**只在选中对象后才出现** —— 打开大屏时右侧第一块
     * 直接空着，视觉上右栏只有 2 块，而模板是 3 块（`template.manifest.json`
     * 的 `right-panels` 明确是 3 个 widget）。
     *
     * <p>这张卡的价值恰恰是「提示用户去点三维场景」。整块消失等于把入口藏了：
     * 用户不知道可以点，也就永远不会选中。
     *
     * <p>卡片体自己处理空态，不会显示假的选中数据。
     */
    return bindings.some(
      (item) => item.deviceId && canDisplayWidgetDeviceReading(item.deviceId, devices),
    );
  }
  if (widget.type === "metric-card") {
    const breakdown = readMetricBreakdown(widget, bindings, latest, devices, assetAttrs, assetError);
    /*
     * 只看「绑了没有」，不看「有没有数」（2026-11-23）。
     *
     * <p>原来要求 `bound && !missing` —— 网关一没上报，整张卡就从大屏消失。
     * 实测后果：实时模式下 8 块卡只显示 4 块，用户看到的是「页面怎么这么空」，
     * 而不是「有 4 块卡还没数据」。而且**配好了的卡消失**和**没配的卡消失**
     * 在视觉上完全一样，没人分得清。
     *
     * <p>卡片体自己已经处理了空态（`暂无数据` / `未绑定`）。
     * 所以这里只管「该不该出现在画面上」，缺数交给卡说。
     */
    return Boolean(breakdown.main?.bound || breakdown.left?.bound || breakdown.right?.bound);
  }
  if (widget.type === "ratio-ring") {
    /*
     * `resolved` 要求已用值和总量**都**读得出 —— 比「绑了没有」严格得多。
     * 只要任一侧绑了配置就显示，缺数由卡片说「暂无数据」。
     */
    return readRatioRingGroups(widget, bindings, latest, devices, input.scopeDeviceIds, assetAttrs, assetError)
      .some((group) => Boolean(group.used?.bound || group.total?.bound));
  }
  if (widget.type === "gauge-ring") {
    /*
     * 仪表与圆环的判据不同（2026-11-23）。
     *
     * <p>仪表只需要「值」有配置就显示 —— 量程可以缺（默认 100），
     * 所以不能像 ratio-ring 那样要求两侧都 bound：
     * 一个只配了 `value` 槽、没配 `max` 的仪表是**完全合法的用法**，
     * 按圆环的判据会判定未绑定 → 整块卡在大屏上消失。
     *
     * <p>常量槽（量程写 100）也算「有配置」：`readSlotValue` 给它们
     * `bound: true`，所以下面的 some() 自然成立。
     */
    return readGaugeRings(widget, bindings, latest, devices, input.scopeDeviceIds, assetAttrs, assetError)
      .some((ring) => Boolean(ring.value?.bound));
  }
  if (widget.type === "trend-chart") {
    /*
     * 原来要求「累积到 ≥2 个点」才显示 —— 刚打开页面必然不足 2 点，
     * 于是趋势图在最初几秒整个不渲染，用户以为这张卡不存在。
     * 卡片体已经有「暂无历史数据」的空态，不需要用隐藏来表达「还没攒够」。
     *
     * <p>聚合槽（2026-11-23 补）：`slot.aggregate` 的槽**没有 deviceId**
     * —— 数据由 scope 范围聚合而来。用 `readSlotValue` 判会得到 bound=false，
     * 整张趋势卡直接消失（实测踩过：改完聚合配置后趋势卡从 8 块里少掉一块）。
     * 判据改成「配了聚合 + 范围绑了」。
     */
    return (widget.slots ?? []).some((slot) =>
      slot.aggregate
        ? widgetScopeIsBound(widget.scope)
        : readSlotValue(slot, bindings, latest, devices, assetAttrs, assetError).bound,
    );
  }
  /*
   * 控制条（2026-11-23）。
   *
   * <p>它**没有 slots** —— 控制是发命令，不读值。若落到下面的兜底分支，
   * `widget.slots?.[0]` 是 undefined，直接 `return false`，
   * 于是配置得好好的控制条在运行态**永远不显示**（实测：浏览器里
   * 9 块卡只渲染出 2 块，控制条整个消失，而单测全绿）。
   *
   * <p>判据是「配了控件就该显示」：它的可用性不依赖遥测，
   * 而是依赖设备可达性 —— 那由按钮自身状态（状态未知/核实中）表达，
   * 不该由「有没有值」来隐掉整张卡。
   */
  if (widget.type === "control-bar") {
    return (widget.controls?.length ?? 0) > 0;
  }

  /*
   * 「按设备逐台读一列」（device-list / bar-compare，2026-11-23）。
   *
   * <p>这两类卡的槽**没有 deviceId** —— 语义是「范围内每台各自读这一列」。
   * 落到下面的兜底分支时，`readSlotValue` 因为找不到 deviceId 返回
   * `bound:false`，于是整卡被判为「没值」而**整个不显示**。
   *
   * <p>实测：演示模式下 9 块卡只出 5 块，机组状态和加载率对比全程缺席，
   * 而运行汇总（同样用 scope）却正常 —— 差别就在汇总卡不看 slot。
   *
   * <p>正确判据：范围绑定 + 范围内有设备 + 这一列至少在一台设备上读得出值。
   * 只看「有没有 slot」会把「范围还没解析出来」和「列没数据」混为一谈。
   */
  if (widgetTypeMeta(widget.type)?.scopePerDevice) {
    if (!widgetScopeIsBound(widget.scope)) return false;
    const ids = widgetScopeDeviceIds(widget, input.scopeDeviceIds);
    if (!ids?.length) return false;
    /*
     * 范围解析出设备 + 配了列 → 显示（2026-11-23 放宽）。
     *
     * <p>原来还要求「至少一台读得出值」，于是实时模式下网关没上报时
     * 「机组状态」整块消失 —— 用户既不知道有这块卡，也不知道是没数据。
     * 逐台列表自己的 `—` / 「暂无数据」已经把缺数说清楚了。
     */
    return (widget.slots ?? []).length > 0;
  }

  const first = widget.slots?.[0];
  if (!first) return false;
  /* 同上：绑了配置就显示，缺数由卡片表达。 */
  return readSlotValue(first, bindings, latest, devices, assetAttrs, assetError).bound;
}

/**
 * 运行态 / 预览是否展示这张卡。
 *
 * <p>判据是**配置是否完整**，不是「有没有值」——见 `widgetHasResolvableValue` 的说明。
 * 编排态（editor）不过滤，始终保留卡位。
 */
/**
 * input 直接复用 {@link widgetHasResolvableValue} 的参数类型，不再重复声明。
 *
 * <p>原来这里抄了一份同样的结构，加资产属性时只改了上面那份 ——
 * 调用方传 assetAttrs 会报「不认识这个字段」。类型重复就一定会漂。
 */
export function shouldDisplayWidgetInRuntime(
  widget: SceneWidget,
  input: Parameters<typeof widgetHasResolvableValue>[1],
): boolean {
  return widgetHasResolvableValue(widget, input);
}

export function widgetsForSurface(
  widgets: SceneWidget[],
  mode: WidgetSurfaceMode,
  input: Parameters<typeof shouldDisplayWidgetInRuntime>[1],
): SceneWidget[] {
  if (mode !== "runtime") return widgets;
  return widgets.filter((widget) => shouldDisplayWidgetInRuntime(widget, input));
}

/**
 * 整屏是否收到过任何遥测（2026-11-23）。
 *
 * <p>用途：网关还没上报时，大屏上只有一屏「暂无数据」的卡片。
 * 用户看到的是「这个页面怎么这么空/这么简单」—— 而真实原因是**没数据**，
 * 不是设计缺内容。这两件事必须分开讲，否则会去改设计而白费功夫。
 *
 * <p>只看**本屏卡片用到的键**：`latest` 里可能混着别的页面的遥测，
 * 拿它整体判空会在「本屏没数、别处有数」时误判为有数据。
 *
 * <p>`null` / `undefined` / 空串都算「没有值」—— 平台在设备从没上报过时，
 * 会返回一条 `value: null` 的占位记录（实测 `values/timeseries` 就是这样）。
 */
export function screenHasAnyTelemetry(
  layout: Pick<SceneWidgetLayout, "widgets"> | null | undefined,
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
): boolean {
  const hasValue = (value: unknown) => value !== null && value !== undefined && value !== "";

  /* ① 有明确 deviceId 的槽位：精确匹配 deviceId + key。 */
  const byDevice = collectWidgetSlotKeys(layout);
  for (const [deviceId, keys] of Object.entries(byDevice)) {
    for (const key of keys) {
      const row = readLatest(latest, deviceId, [key]);
      if (row && hasValue(row.value)) return true;
    }
  }

  /*
   * ② 「按设备逐台读一列」（device-list / bar-compare）的键。
   *
   * <p>**漏掉这一段会导致误报**（实测踩过）：这些槽位**没有 deviceId**，
   * 所以 `collectWidgetSlotKeys` 根本不收它们的键。只看 ① 的话，
   * 网关那 3 个系统级点位是 null 就判「整屏无数据」——
   * 而左边「机组状态」9 台明明都有运行状态，
   * 提示条照样弹出来说「还没有收到设备数据」。
   *
   * <p>这类键不知道具体挂在哪些设备上（设备由 scope 决定），
   * 所以扫一遍 latest：**任何一台设备**报了这个键就算有数据。
   * 宁可少弹一次提示，也不能在明明有数时说「没数据」。
   */
  const perDevice = new Set(collectWidgetPerDeviceKeys(layout));
  if (perDevice.size) {
    const rows = latest instanceof Map ? [...latest.values()] : Object.values(latest);
    for (const row of rows) {
      if (!row || !perDevice.has(row.key)) continue;
      if (hasValue(row.value)) return true;
    }
  }

  return false;
}

/**
 * 空卡「在等什么」的诊断文案（2026-11-23）。
 *
 * <h2>为什么需要</h2>
 *
 * 网关没上报时卡片显示「暂无数据」—— 用户知道没数，但不知道**缺哪个点、
 * 哪台设备、停了多久**。这三件事决定了要不要打电话给现场。
 *
 * <p>参考模板（template01）里没有空态，因为它全是写死的演示值；
 * 我们是真实接入，空态本身就是信息，必须说清楚。
 *
 * <h2>为什么不能用 readLatest 拿时间</h2>
 *
 * `readLatest` 会跳过 `value` 为 null/空串的记录 —— 而平台在设备
 * **从没上报过**时会返回一条 `value: null` 的占位（实测 `/values/timeseries`
 * 就是这样）。那条记录的时间戳正是「最近一次尝试」的证据，要单独取。
 */
export function describePendingSlot(
  widget: Pick<SceneWidget, "slots"> & { type?: string },
  slotKey: string,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  devices?: Device[] | null,
  now: number = Date.now(),
): string {
  const slot = widget.slots?.find((item) => item.key === slotKey) ?? widget.slots?.[0];
  if (!slot) return "还没有配置数据点";
  const widgetTypeMetaForSlot = widget.type ? widgetTypeMeta(widget.type) : undefined;
  const key = slot.telemetryKey || slot.key;

  /* 资产属性槽：缺的是属性，不说「网关没上报」。 */
  if (slot.assetId && slot.attributeKey) {
    return `等待资产属性 ${slot.attributeKey}`;
  }

  /*
   * 聚合槽（2026-11-23）：它**没有 deviceId** —— 数据由 scope 范围内
   * 多台设备聚合并。说「还没有绑定设备」是错的，用户会去找一个不存在的选择项。
   */
  if (slot.aggregate) {
    return `等待范围内设备上报 ${key} 的历史（用于${slot.aggregate === "sum" ? "求和" : slot.aggregate === "avg" ? "求平均" : "聚合"}）`;
  }

  const deviceId = slot.deviceId || findBindingForSlot(slot, bindings)?.deviceId;
  if (!deviceId) {
    /*
     * 「按设备逐台读一列」的卡（device-list / bar-compare）本来就没有 deviceId
     * —— 设备由 scope 决定。对它们说「还没有选择设备」是错的（实测过：
     * 加载率对比卡明明配好了范围，却提示要选设备）。
     */
    if (widgetTypeMetaForSlot?.scopePerDevice) {
      return `等待范围内任一设备上报 ${key}`;
    }
    return "还没有选择设备";
  }
  const deviceName =
    devices?.find((item) => item.id === deviceId)?.label
    || bindings.find((item) => item.deviceId === deviceId)?.deviceName
    || deviceId.slice(0, 8);

  /* 直接取原始记录：readLatest 会滤掉 null 值，而我们要的是它的时间戳。 */
  const raw = latest instanceof Map ? latest.get(`${deviceId}:${key}`) : latest[`${deviceId}:${key}`];
  if (!raw) {
    return `等待 ${deviceName} 上报 ${key}`;
  }
  const ts = Number(raw.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return `等待 ${deviceName} 上报 ${key}`;
  }
  const hours = Math.max(0, Math.round((now - ts) / 3_600_000));
  if (hours < 1) return `${deviceName} 的 ${key} 刚刚上报，等待刷新`;
  if (hours < 24) return `${deviceName} 的 ${key} 已 ${hours} 小时没有新数据`;
  return `${deviceName} 的 ${key} 已 ${Math.round(hours / 24)} 天没有新数据`;
}

/**
 * 这张卡最新一条读数距今多久（毫秒），没有读数时返回 null。
 *
 * <h2>为什么要单独算</h2>
 *
 * <p>卡片体内部已经知道每条读数的 `staleAt`，但**卡片头**（`WidgetOverlay`）
 * 拿不到 —— 它只有一个 `latest` 表。往返传一遍 breakdown 会让两个组件的
 * 数据流纠缠在一起。
 *
 * <p>这里只查内存表、不做格式化，很便宜。语义取**最新**的那条：
 * 一张卡里 9 台设备，只要有一台在上报，这张卡就不算整体过期。
 * 逐台的过期状态由卡片体自己标（那是另一层信息）。
 *
 * <p>用途：数据停更时在卡片头给一个「延迟 51h」的标记。
 * 实测踩过 —— 库里数据停了 51 小时，大屏照样显示 7.4℃，和实时一模一样。
 */
export function widgetDataAgeMs(
  widget: SceneWidget,
  bindings: DeviceBinding[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  scopeDeviceIds?: Record<string, string[]>,
  now: number = Date.now(),
): number | null {
  const stamps: number[] = [];

  for (const slot of widget.slots ?? []) {
    const key = slot.telemetryKey;
    if (!key) continue;
    const deviceId = slot.deviceId || findBindingForSlot(slot, bindings)?.deviceId;
    if (deviceId) {
      const raw = latest instanceof Map ? latest.get(`${deviceId}:${key}`) : latest[`${deviceId}:${key}`];
      const ts = Number(raw?.timestamp);
      if (Number.isFinite(ts) && ts > 0) stamps.push(ts);
      continue;
    }
    /* 逐台列：扫范围内所有设备，取这台卡上最新的一条。 */
    for (const id of widgetScopeDeviceIds(widget, scopeDeviceIds) ?? []) {
      const raw = latest instanceof Map ? latest.get(`${id}:${key}`) : latest[`${id}:${key}`];
      const ts = Number(raw?.timestamp);
      if (Number.isFinite(ts) && ts > 0) stamps.push(ts);
    }
  }

  if (!stamps.length) return null;
  return Math.max(0, now - Math.max(...stamps));
}

/** 把毫秒年龄说成「3 分钟 / 5 小时 / 2 天」。 */
export function formatDataAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

/**
 * 按范围聚合一个测点（2026-11-23）。
 *
 * <h2>为什么需要</h2>
 *
 * <p>网关还没上报系统级点位（`power_total` 实测 `value: null`），
 * 「系统功率」卡只能空着。但 9 台机组各自的 `power` 是有的（19.3~20.9 kW）——
 * 求和约 175 kW，是真实数据，比空卡有用得多。
 *
 * <h2>为什么必须由调用方写清口径</h2>
 *
 * <p>9 台机组 `power` 之和 ≈ 机组总输入功率，**不等于**手册 30005 的
 * 「系统功率」—— 后者还包含水泵、风机等辅助设备。
 * 两者差 10%~20% 很正常，但看数字的人不会知道。
 *
 * <p>所以 label 必须写「9 台机组之和」这类明确的说法。
 * 这个函数只负责算，不替调用方决定怎么称呼它。
 *
 * <p>只统计**有值**的设备：某台没上报就跳过，不按 0 算 ——
 * 按 0 算会让总数凭空变小，看起来像负荷下降。
 */
export function readScopedAggregate(
  slot: SceneWidgetSlot,
  deviceIds: string[],
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>,
  now: number = Date.now(),
): SlotReading | null {
  const aggregate = slot.aggregate;
  const key = slot.telemetryKey;
  if (!aggregate || !key) return null;

  const values: Array<{ value: number; ts: number }> = [];
  for (const deviceId of deviceIds) {
    const raw = latest instanceof Map ? latest.get(`${deviceId}:${key}`) : latest[`${deviceId}:${key}`];
    if (!raw) continue;
    const numeric = numericOf(raw.value);
    if (numeric == null) continue;
    values.push({ value: numeric, ts: Number(raw.timestamp) || 0 });
  }

  if (!values.length) {
    return {
      label: slot.label || key,
      text: "",
      unit: slot.unit,
      bound: true,
      missing: true,
      origin: "device-telemetry",
    };
  }

  const numbers = values.map((item) => item.value);
  let result: number;
  switch (aggregate) {
    case "avg":
      result = numbers.reduce((a, b) => a + b, 0) / numbers.length;
      break;
    case "max":
      result = Math.max(...numbers);
      break;
    case "min":
      result = Math.min(...numbers);
      break;
    default:
      result = numbers.reduce((a, b) => a + b, 0);
  }

  /*
   * 时间戳取**最老**的一条：聚合值里有任何一台过时，
   * 整个聚合结果就不该被当成实时（短板效应）。
   */
  const oldestTs = Math.min(...values.map((item) => item.ts).filter((ts) => ts > 0));
  const thresholdSec = slot.staleAfterSec ?? DEFAULT_TELEMETRY_STALE_SEC;
  const stale = Number.isFinite(oldestTs) && oldestTs > 0 && now - oldestTs > thresholdSec * 1000;

  /*
   * 用统一格式化，不再按数值大小决定精度（2026-11-23）。
   *
   * <p>原规则 `abs >= 100 ? 0 : 1` 把 119.9 显示成 120 —— 而同一张卡上
   * 单设备槽（进出水 7.13）走的是另一位规则，两个数精度口径不一致，
   * 看起来像其中一个是错的。
   */
  return {
    label: slot.label || key,
    text: formatMetricNumber(result),
    unit: slot.unit,
    bound: true,
    missing: false,
    source: "guard",
    origin: "device-telemetry",
    staleAt: Number.isFinite(oldestTs) ? oldestTs : undefined,
    numeric: result,
    ...(stale ? { unavailableReason: "stale" as const } : {}),
  };
}

/**
 * 把多台设备的历史序列合并成一条聚合序列（2026-11-23）。
 *
 * <h2>为什么在客户端合并</h2>
 *
 * <p>平台没有「跨设备聚合」接口。9 台机组的功率之和的历史，
 * 只能逐台拉再自己合并。
 *
 * <p>这是**一次加载**、不轮询 —— 9 个请求可以接受，
 * 与轮询路径的 N+1 是两件事（那条路径每 3 秒跑一轮，才是真问题）。
 *
 * <h2>按时间桶对齐，不是按点下标</h2>
 *
 * <p>各台设备的采样时刻并不一致（轮询 3 秒一轮，但上报时刻有抖动），
 * 按下标对齐会把「1# 的 10:00」和「2# 的 10:03」当成同一个时刻相加。
 * 所以先按 `intervalMs` 把时间归桶，同桶内相加。
 *
 * <p>**缺桶不补 0**：某台在某小时没数据时，那个桶只有其余设备的和。
 * 补 0 会让曲线出现假的「负荷骤降」，而实际是那台掉线了 ——
 * 这类假谷底在现场最难分辨（看起来像设备正常停机）。
 */
export function mergeHistoryAggregate(
  series: Array<Array<{ timestamp: number; value: number }>>,
  aggregate: "sum" | "avg" | "max" | "min",
  intervalMs: number,
): Array<{ timestamp: number; value: number }> {
  if (!series.length) return [];
  const bucketMs = intervalMs > 0 ? intervalMs : 60_000;

  /* bucket → 该桶内所有设备的点 */
  const buckets = new Map<number, number[]>();
  for (const points of series) {
    for (const point of points) {
      if (!Number.isFinite(point.value) || !Number.isFinite(point.timestamp)) continue;
      const bucket = Math.floor(point.timestamp / bucketMs) * bucketMs;
      const list = buckets.get(bucket);
      if (list) list.push(point.value);
      else buckets.set(bucket, [point.value]);
    }
  }

  const out: Array<{ timestamp: number; value: number }> = [];
  for (const [timestamp, values] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    let value: number;
    switch (aggregate) {
      case "avg":
        value = values.reduce((a, b) => a + b, 0) / values.length;
        break;
      case "max":
        value = Math.max(...values);
        break;
      case "min":
        value = Math.min(...values);
        break;
      default:
        value = values.reduce((a, b) => a + b, 0);
    }
    out.push({ timestamp, value });
  }
  return out;
}

/**
 * 构造趋势图的序列数据（2026-11-23 从 `TrendCardBody` 抽出来，为了可测）。
 *
 * <h2>为什么抽出来</h2>
 *
 * <p>「趋势图能不能画出线」完全取决于这里返回的 `data.length >= 2`。
 * 内联在组件的 `useMemo` 里没法单测，而这块恰好有两条容易搞错的分支：
 *
 * <ol>
 *   <li>聚合槽（`slot.aggregate`）走 `scopedHistory`，不读 store 累积；</li>
 *   <li>单设备槽走 store 累积（`history[deviceId:key]`）。</li>
 * </ol>
 *
 * <p>混用会得到「多台之和」和「单台值」画在同一张图上 —— 两条线量纲不同，
 * 看起来像其中一条坏了。
 */
export function buildTrendSeries(args: {
  slots: SceneWidgetSlot[];
  bindings: DeviceBinding[];
  latest: Record<string, TelemetryRecord> | Map<string, TelemetryRecord>;
  history: Record<string, Array<{ timestamp: number; value: number }>>;
  devices?: Device[] | null;
  scopedHistory?: Record<string, Array<{ timestamp: number; value: number }>>;
  palette: Array<string | undefined>;
}): Array<{
  name: string;
  color?: string;
  data: Array<[number, number]>;
  bound: boolean;
}> {
  const { slots, bindings, latest, history, devices, scopedHistory, palette } = args;
  return slots.map((slot, index) => {
    const keys = [slot.telemetryKey, slot.key].filter(Boolean) as string[];
    let points: Array<{ timestamp: number; value: number }>;
    let bound: boolean;

    if (slot.aggregate) {
      /* 聚合槽：只认 scopedHistory。store 累积的是单台值，混进来会画错。 */
      points = scopedHistory?.[slot.key] ?? [];
      bound = points.length >= 2;
    } else {
      const reading = readSlotValue(slot, bindings, latest, devices);
      const device = reading.bound
        ? slot.deviceId || findBindingForSlot(slot, bindings)?.deviceId
        : undefined;
      points = keys.flatMap((key) => (device ? history[`${device}:${key}`] ?? [] : []));
      bound = reading.bound;
    }

    return {
      name: slot.label || slot.telemetryKey || slot.key,
      color: palette[index % Math.max(1, palette.length)],
      data: points.map((point) => [point.timestamp, point.value] as Array<[number, number]>[number]),
      bound,
    };
  });
}
