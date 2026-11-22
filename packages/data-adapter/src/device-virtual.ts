/**
 * 平台「实时 / 虚拟」判定。
 * 与 guard-server MeteringMath.isVirtual 对齐：只看 additionalInfo.deviceVirtual，
 * 不是 SERVER_SCOPE 属性。不要用设备名或 ID 白名单。
 *
 * 取值约定（平台「组织-场站-设备管理」）：
 * - "real" / 缺失：实时设备（自动采集），3D-NGX 可绑定
 * - "virtual" / true / 1："虚拟设备"（手动上报），不可绑定
 */
export function isVirtualDeviceVirtualValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const s = value.trim();
    return s.toLowerCase() === "virtual" || s === "1" || s.toLowerCase() === "true";
  }
  return false;
}

export function readDeviceVirtualFlag(additionalInfo: unknown): unknown {
  if (!additionalInfo) return undefined;
  let info: unknown = additionalInfo;
  if (typeof additionalInfo === "string") {
    try {
      info = JSON.parse(additionalInfo);
    } catch {
      return undefined;
    }
  }
  if (!info || typeof info !== "object") return undefined;
  return (info as Record<string, unknown>).deviceVirtual;
}

export function isVirtualAdditionalInfo(additionalInfo: unknown): boolean {
  if (additionalInfo === undefined || additionalInfo === null) return false;
  if (typeof additionalInfo === "object" && !Array.isArray(additionalInfo) && !("deviceVirtual" in (additionalInfo as object))) {
    return false;
  }
  return isVirtualDeviceVirtualValue(readDeviceVirtualFlag(additionalInfo));
}

/** 仅平台（guard）设备按 deviceVirtual 过滤；Mock 演示设备不是平台虚拟设备。 */
export function isVirtualPlatformDevice(device: {
  source?: string;
  deviceVirtual?: unknown;
  additionalInfo?: unknown;
}): boolean {
  if (device.source && device.source !== "guard") return false;
  if (device.deviceVirtual !== undefined) return isVirtualDeviceVirtualValue(device.deviceVirtual);
  return isVirtualAdditionalInfo(device.additionalInfo);
}

export function isRealtimePlatformDevice(device: {
  source?: string;
  deviceVirtual?: unknown;
  additionalInfo?: unknown;
}): boolean {
  return !isVirtualPlatformDevice(device);
}
