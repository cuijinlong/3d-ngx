/** 解析设备属性 rpcMethods，以及下发错误的展示口径。不要解析 rpcCommands。 */

import type { CommandDef, CommandParamDef, CommandParamType } from "@idt/shared-types";
import { GuardHttpError } from "./guard-client";

export const VIRTUAL_DEVICE_UNBOUND_MESSAGE = "绑定已失效（虚拟设备）";

export class RealtimeDeviceError extends Error {
  readonly reason: "missing" | "virtual";

  constructor(reason: "missing" | "virtual", message?: string) {
    super(message ?? (reason === "virtual" ? VIRTUAL_DEVICE_UNBOUND_MESSAGE : "设备不存在"));
    this.name = "RealtimeDeviceError";
    this.reason = reason;
  }
}

function asParamType(value: unknown): CommandParamType {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "number" || raw === "int" || raw === "integer" || raw === "float" || raw === "double") return "number";
  if (raw === "boolean" || raw === "bool") return "boolean";
  return "text";
}

function parseParams(raw: unknown): CommandParamDef[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const params: CommandParamDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; type?: unknown; required?: unknown };
    const name = String(rec.name ?? "").trim();
    if (!name) continue;
    const required = rec.required === false ? false : true;
    params.push({ name, type: asParamType(rec.type), required });
  }
  return params.length ? params : undefined;
}

export function commandHasRequiredParams(command: Pick<CommandDef, "params" | "hasRequiredParams">): boolean {
  if (typeof command.hasRequiredParams === "boolean") return command.hasRequiredParams;
  return (command.params ?? []).some((param) => param.required !== false);
}

function normalizeCommand(id: string, label: string, name?: string, params?: CommandParamDef[]): CommandDef {
  const resolvedLabel = label || name || id;
  const resolvedName = name || resolvedLabel;
  const command: CommandDef = {
    id,
    label: resolvedLabel,
    name: resolvedName,
    params,
  };
  command.hasRequiredParams = commandHasRequiredParams(command);
  return command;
}

/**
 * 解析 rpcMethods 的 value（数组，或还需要再 JSON.parse 的字符串）。
 * 只认：字符串数组、带 id 的对象数组、整段失败的纯字符串。非数组对象得到空列表。
 * 不要把 rpcCommands（{ methods:[{ method, params, desc }] }）送进来。
 */
export function parseCommands(raw: unknown): CommandDef[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      const text = raw.trim();
      return text ? [normalizeCommand(text, text)] : [];
    }
  }
  if (!Array.isArray(value)) return [];
  const cmds: CommandDef[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const id = item.trim();
      if (id) cmds.push(normalizeCommand(id, id));
      continue;
    }
    if (item && typeof item === "object" && "id" in item) {
      const rec = item as { id?: unknown; label?: unknown; name?: unknown; params?: unknown };
      const id = String(rec.id ?? "").trim();
      if (!id) continue;
      const label = String(rec.label ?? "").trim();
      const name = String(rec.name ?? "").trim();
      cmds.push(normalizeCommand(id, label, name || undefined, parseParams(rec.params)));
    }
  }
  return cmds;
}

export function describeCommandError(error: unknown): { status?: number; message: string } {
  if (error instanceof RealtimeDeviceError) {
    return { message: error.message };
  }
  if (error instanceof GuardHttpError) {
    if (error.status === 504) return { status: 504, message: "请求超时" };
    const detail = error.message?.trim();
    if (detail && detail !== `请求失败 ${error.status}`) {
      return { status: error.status, message: `${error.status} ${detail}` };
    }
    return { status: error.status, message: `请求失败 ${error.status}` };
  }
  if (error instanceof Error && error.message.trim()) {
    return { message: error.message };
  }
  return { message: "下发失败" };
}

export function toCommandError(error: unknown): Error {
  if (error instanceof RealtimeDeviceError) return error;
  if (error instanceof GuardHttpError && error.status === 504) {
    return new GuardHttpError("请求超时", 504, error.body);
  }
  return error instanceof Error ? error : new Error("下发失败");
}
