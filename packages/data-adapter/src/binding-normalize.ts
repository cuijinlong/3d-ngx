import type { AttributeScope, BindingPoint, BindingTarget, DeviceBinding } from "@idt/shared-types";

/**
 * 绑定模型 v1 ↔ v2 归一化（docs/twin-binding-contract.md §3.2）。
 *
 * 设计前提：**不迁移、不重写**。v1 文档（只有 deviceId + telemetryMappings）
 * 原样保留在库里和导出 JSON 里，读取时才推导出 v2 视图。
 * 半迁移的文档最难收拾 —— 一半设备绑定一半资产绑定，出问题连回滚都无从下手。
 */

const VALID_SOURCES = new Set(["telemetry", "attribute", "derived"]);
const VALID_SCOPES = new Set(["SERVER_SCOPE", "SHARED_SCOPE", "CLIENT_SCOPE"]);
const VALID_DISPLAY = new Set(["number", "boolean", "text"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseTarget(raw: unknown): BindingTarget | undefined {
  const row = asRecord(raw);
  const entityId = text(row.entityId);
  if (!entityId) return undefined;
  const entityType = text(row.entityType).toUpperCase() === "ASSET" ? "ASSET" : "DEVICE";
  return { entityType, entityId, name: text(row.name) || entityId };
}

export function parseBindingPoint(raw: unknown): BindingPoint | null {
  const row = asRecord(raw);
  const slot = text(row.slot);
  const key = text(row.key);
  if (!slot || !key) return null;
  const sourceRaw = text(row.source);
  if (!VALID_SOURCES.has(sourceRaw)) return null;
  const source = sourceRaw as BindingPoint["source"];
  /*
   * attribute 才允许 scope。telemetry 带 scope 说明文档有问题 ——
   * 静默忽略比报错安全（不让一条脏数据毁掉整份绑定），但也不要把它读进模型。
   */
  const scopeRaw = text(row.scope);
  const scope = source === "attribute" && VALID_SCOPES.has(scopeRaw)
    ? (scopeRaw as AttributeScope)
    : undefined;
  const displayRaw = text(row.displayType);
  const point: BindingPoint = {
    slot,
    source,
    key,
    displayType: VALID_DISPLAY.has(displayRaw) ? (displayRaw as BindingPoint["displayType"]) : "number",
  };
  if (scope) point.scope = scope;
  const unit = text(row.unit);
  if (unit) point.unit = unit;
  const stale = num(row.staleAfterSec);
  if (stale) point.staleAfterSec = stale;
  const fallback = text(row.fallback);
  if (fallback) point.fallback = fallback;
  return point;
}

/**
 * 把库里 / 导入 JSON 里的一条绑定归一成 v2 视图。
 *
 * 丢弃规则（与后端 validateBindings 对齐）：
 * - 既没有 deviceId 也没有 target → 丢弃（无法定位任何实体）
 * - 两者都没有时还要求 sceneEntityId 或 points 之一 —— 空壳条目留着只会让
 *   「未绑定项」统计失真
 */
export function normalizeBinding(raw: unknown): DeviceBinding | null {
  const row = asRecord(raw);
  const sceneEntityId = text(row.sceneEntityId ?? row.entityId);
  const deviceId = text(row.deviceId);
  const target = parseTarget(row.target);
  if (!deviceId && !target) return null;
  if (!sceneEntityId && !target) return null;

  const telemetryMappings = Array.isArray(row.telemetryMappings)
    ? (row.telemetryMappings as DeviceBinding["telemetryMappings"])
    : [];
  const actionMappings = Array.isArray(row.actionMappings)
    ? (row.actionMappings as DeviceBinding["actionMappings"])
    : [];
  const points = Array.isArray(row.points)
    ? row.points.map(parseBindingPoint).filter((item): item is BindingPoint => Boolean(item))
    : undefined;

  const binding: DeviceBinding = {
    id: text(row.id) || newBindingId(),
    sceneEntityId,
    deviceName: text(row.deviceName),
    telemetryMappings,
    actionMappings,
  };
  if (row.statusMapping) binding.statusMapping = row.statusMapping as DeviceBinding["statusMapping"];
  if (deviceId) binding.deviceId = deviceId;
  /*
   * target 缺省时由 deviceId 推导。不主动写回原文档，只保证读取侧一致：
   * 这样 v1 文档不需要迁移，v2 代码也不用到处判断「有没有 target」。
   */
  if (target) binding.target = target;
  else if (deviceId) binding.target = { entityType: "DEVICE", entityId: deviceId, name: binding.deviceName || deviceId };
  if (points && points.length) binding.points = points;
  return binding;
}

/**
 * 取一条绑定的全部绑定点。
 *
 * 有 points 用 points；没有就由 telemetryMappings 逐项推导成 telemetry 点
 * —— v1 文档的每个映射原本就是一个遥测键，语义完全一致。
 */
export function bindingPoints(binding: DeviceBinding): BindingPoint[] {
  if (binding.points && binding.points.length) return binding.points;
  const seen = new Set<string>();
  const out: BindingPoint[] = [];
  for (const mapping of binding.telemetryMappings ?? []) {
    const key = text(mapping?.telemetryKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const point: BindingPoint = {
      slot: text(mapping.field) || key,
      source: "telemetry",
      key,
      displayType: mapping.displayType ?? "number",
    };
    const unit = text(mapping.unit);
    if (unit) point.unit = unit;
    out.push(point);
  }
  return out;
}

/**
 * 一条绑定定位到的实体。DEVICE 条目带 deviceId，ASSET 条目没有。
 * 返回 null 表示这条绑定无法定位实体（不该出现在正常文档里）。
 */
export function bindingTargetOf(binding: DeviceBinding): BindingTarget | null {
  if (binding.target?.entityId) return binding.target;
  if (binding.deviceId) {
    return { entityType: "DEVICE", entityId: binding.deviceId, name: binding.deviceName || binding.deviceId };
  }
  return null;
}

/**
 * 这条绑定是否被「设备遥测」驱动。
 *
 * 大量既有逻辑（订阅、启停、状态动画）只对 DEVICE 成立，
 * 用它做统一判据，避免各处重复写 `entityType === "DEVICE"`。
 */
export function bindingIsDeviceTelemetry(binding: DeviceBinding): boolean {
  const target = bindingTargetOf(binding);
  return target?.entityType === "DEVICE";
}

/** 是否需要资产属性读取（走 AssetApi，不走遥测订阅）。 */
export function bindingIsAssetAttribute(binding: DeviceBinding): boolean {
  const target = bindingTargetOf(binding);
  if (target?.entityType !== "ASSET") return false;
  return bindingPoints(binding).some((point) => point.source === "attribute");
}

/**
 * derived 在 P0 未实现。单独导出判据，让调用方能把它显示成「未绑定」，
 * 而不是悄悄当 0 或空字符串。
 */
export function bindingHasUnsupportedDerived(binding: DeviceBinding): boolean {
  return bindingPoints(binding).some((point) => point.source === "derived");
}

function newBindingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
