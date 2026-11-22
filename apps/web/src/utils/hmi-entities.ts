
import type { ParsedHmiScene } from "@idt/shared-types";
import { formatHmiDeviceName, formatHmiPipeName } from "@idt/engine-adapter";

export type HmiSelectable = { node: string; name: string; kind: "device" | "valve" | "instrument" | "pipe" | "fitting" };

export function uniqueEntitiesFromParsed(parsed: ParsedHmiScene): HmiSelectable[] {
  const list: HmiSelectable[] = [];
  const seen = new Set<string>();
  const push = (node: string, name: string, kind: HmiSelectable["kind"]) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    list.push({ node, name, kind });
  };
  for (const d of parsed.devices) push(d.node, formatHmiDeviceName(d.name, d.tag), "device");
  for (const v of parsed.valves) push(v.node, v.typeLabel ? `${v.node} ${v.typeLabel}` : v.node, "valve");
  for (const i of parsed.instruments) push(i.node, i.typeLabel ? `${i.node} ${i.typeLabel}` : i.node, "instrument");
  for (const p of parsed.pipes) push(p.node, formatHmiPipeName(p), "pipe");
  for (const f of parsed.fittings) push(f.node, f.typeLabel ? `${f.node} ${f.typeLabel}` : f.node, "fitting");
  return list;
}
