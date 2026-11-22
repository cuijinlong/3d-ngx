
import type { CommandDef } from "@idt/shared-types";
import { commandHasRequiredParams } from "@idt/data-adapter";

export type NameplateKind = "start" | "stop";

export type NameplateMatch =
  | { ok: true; command: CommandDef }
  | { ok: false; reason: "unbound" | "invalid" | "list-failed" | "no-match" | "busy" };

const REASON_TEXT: Record<Exclude<NameplateMatch, { ok: true }>["reason"], string> = {
  unbound: "未绑定",
  invalid: "绑定已失效",
  "list-failed": "命令列表暂时读不到",
  "no-match": "没有对应命令",
  busy: "正在下发",
};

export function nameplateReasonText(reason: Exclude<NameplateMatch, { ok: true }>["reason"]): string {
  return REASON_TEXT[reason];
}

function haystack(command: CommandDef): { id: string; label: string; text: string } {
  const id = command.id ?? "";
  const label = command.label ?? "";
  return { id, label, text: `${id} ${label}` };
}

function containsStartToken(command: CommandDef): boolean {
  const { id, label } = haystack(command);
  if (id.toLowerCase() === "start") return true;
  return label.includes("启动") || id.includes("启动");
}

function containsStopToken(command: CommandDef): boolean {
  const { id, label } = haystack(command);
  if (id.toLowerCase() === "stop") return true;
  return label.includes("停止") || id.includes("停止");
}

/** 不要仅因含「启」就命中「启停」setRunning。 */
export function matchNameplateCommand(kind: NameplateKind, commands: CommandDef[]): NameplateMatch {
  const candidates = commands.filter((command) => {
    if (commandHasRequiredParams(command)) return false;
    return kind === "start" ? containsStartToken(command) : containsStopToken(command);
  });
  if (candidates.length === 0) return { ok: false, reason: "no-match" };
  if (candidates.length === 1) return { ok: true, command: candidates[0]! };

  const exactId = kind === "start" ? "start" : "stop";
  const exact = candidates.filter((command) => command.id.toLowerCase() === exactId);
  if (exact.length === 1) return { ok: true, command: exact[0]! };
  if (exact.length > 1) return { ok: false, reason: "no-match" };

  const scored = [...candidates].sort((a, b) => {
    const labelDelta = (a.label ?? a.id).length - (b.label ?? b.id).length;
    if (labelDelta !== 0) return labelDelta;
    const colonA = a.id.includes(":") ? 1 : 0;
    const colonB = b.id.includes(":") ? 1 : 0;
    return colonA - colonB;
  });
  const first = scored[0]!;
  const second = scored[1]!;
  const firstLabel = (first.label ?? first.id).length;
  const secondLabel = (second.label ?? second.id).length;
  const firstColon = first.id.includes(":") ? 1 : 0;
  const secondColon = second.id.includes(":") ? 1 : 0;
  if (firstLabel === secondLabel && firstColon === secondColon) return { ok: false, reason: "no-match" };
  return { ok: true, command: first };
}

export function declaredCommandParams(_command: CommandDef): Record<string, unknown> {
  return {};
}
