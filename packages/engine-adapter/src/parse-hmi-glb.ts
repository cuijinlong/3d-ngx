
import type {
  BindableSignal,
  HmiAction,
  HmiAnimationClip,
  HmiDataPoint,
  HmiDevice,
  HmiFitting,
  HmiInstrument,
  HmiPipe,
  HmiValve,
  ParsedHmiScene,
} from "@idt/shared-types";
import { extractGlbJson } from "./glb-json";

interface GltfNode {
  name?: string;
  extras?: Record<string, unknown>;
  children?: number[];
}

interface GltfDoc {
  nodes?: GltfNode[];
  animations?: Array<{ name?: string; extras?: Record<string, unknown> }>;
  extras?: Record<string, unknown>;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function scalar(v: unknown): string | number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return str(v);
}

export function formatHmiDeviceName(name: string, tag?: string): string {
  if (!tag) return name;
  const compact = tag.replace(/[＃#]\s*$/u, "").trim();
  const compactTag = compact ? `${compact}#` : tag;
  let base = name.trim();
  const escapedTag = compactTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedRaw = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedNum = compact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  base = base
    .replace(new RegExp(`(?:\\s*[（(]?${escapedTag}[）)]?)$`, "u"), "")
    .replace(new RegExp(`(?:\\s*[（(]?${escapedRaw}[）)]?)$`, "u"), "")
    .replace(new RegExp(`(?:\\s+${escapedNum})$`, "u"), "")
    .trim();
  return base ? `${base} ${compactTag}` : compactTag;
}

export function formatHmiPipeName(pipe: Pick<HmiPipe, "node" | "no" | "name" | "seg">): string {
  if (pipe.node) return pipe.node;
  if (pipe.no && pipe.seg !== undefined && pipe.seg !== "") return `${pipe.no}-${pipe.seg}`;
  return pipe.no || pipe.name || "";
}

function inferValueType(
  name: string,
  unit?: string,
  sample?: string,
): "number" | "boolean" | "text" {
  const n = name.toLowerCase();
  if (
    unit === "℃" ||
    unit === "°C" ||
    unit === "kW" ||
    unit === "%" ||
    unit === "A" ||
    unit === "V" ||
    unit === "Hz" ||
    unit === "Pa" ||
    unit === "MPa" ||
    unit === "bar"
  ) {
    return "number";
  }
  if (n.includes("状态") || n.includes("开关") || n.includes("启停")) {
    if (sample === "true" || sample === "false") return "boolean";
    return "text";
  }
  if (sample !== undefined && sample !== "" && !Number.isNaN(Number(sample))) {
    return "number";
  }
  return "text";
}

function actionOf(raw: unknown): HmiAction | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    label: str(o.label) ?? id,
    clip: str(o.clip),
    on: typeof o.on === "boolean" ? o.on : undefined,
    loop: typeof o.loop === "boolean" ? o.loop : undefined,
    kind: str(o.kind),
  };
}

function dataOf(raw: unknown): HmiDataPoint | null {
  const o = asRecord(raw);
  if (!o) return null;
  const name = str(o.name);
  if (!name) return null;
  return { name, unit: str(o.unit), val: str(o.val) };
}

function parseDevices(list: unknown[]): HmiDevice[] {
  const out: HmiDevice[] = [];
  for (const raw of list) {
    const o = asRecord(raw);
    if (!o) continue;
    const node = str(o.node);
    const name = str(o.name);
    if (!node || !name) continue;
    out.push({
      node,
      name,
      tag: str(o.tag),
      model: str(o.model),
      modelName: str(o.modelName),
      actions: asArray(o.actions).map(actionOf).filter((x): x is HmiAction => !!x),
      data: asArray(o.data).map(dataOf).filter((x): x is HmiDataPoint => !!x),
    });
  }
  return out;
}

function parseValves(list: unknown[]): HmiValve[] {
  const out: HmiValve[] = [];
  for (const raw of list) {
    const o = asRecord(raw);
    if (!o) continue;
    const node = str(o.node);
    if (!node) continue;
    const clips = asRecord(o.clips);
    out.push({
      node,
      type: str(o.type),
      typeLabel: str(o.typeLabel),
      pipe: str(o.pipe),
      open: typeof o.open === "boolean" ? o.open : undefined,
      clips: clips
        ? { open: str(clips.open), close: str(clips.close) }
        : undefined,
      stopsFlow: typeof o.stopsFlow === "boolean" ? o.stopsFlow : undefined,
    });
  }
  return out;
}

function parseInstruments(list: unknown[]): HmiInstrument[] {
  const out: HmiInstrument[] = [];
  for (const raw of list) {
    const o = asRecord(raw);
    if (!o) continue;
    const node = str(o.node);
    if (!node) continue;
    const clips = asRecord(o.clips);
    out.push({
      node,
      type: str(o.type),
      typeLabel: str(o.typeLabel),
      pipe: str(o.pipe),
      clips: clips ? { on: str(clips.on), off: str(clips.off) } : undefined,
    });
  }
  return out;
}

function parsePipes(list: unknown[]): HmiPipe[] {
  const out: HmiPipe[] = [];
  for (const raw of list) {
    const o = asRecord(raw);
    if (!o) continue;
    const node = str(o.node);
    if (!node) continue;
    const flow = asRecord(o.flow);
    out.push({
      node,
      no: str(o.no),
      name: str(o.name),
      mediumLabel: str(o.mediumLabel),
      from: str(o.from),
      to: str(o.to),
      seg: scalar(o.seg),
      segs: scalar(o.segs),
      flowClip: flow ? str(flow.clip) : undefined,
      flowNode: flow ? str(flow.node) : undefined,
      flowOn: flow && typeof flow.on === "boolean" ? flow.on : undefined,
      valves: asArray(o.valves).filter((x): x is string => typeof x === "string"),
      instruments: asArray(o.instruments).filter((x): x is string => typeof x === "string"),
    });
  }
  return out;
}

function parseFittings(list: unknown[]): HmiFitting[] {
  const out: HmiFitting[] = [];
  for (const raw of list) {
    const o = asRecord(raw);
    if (!o) continue;
    const node = str(o.node);
    if (!node) continue;
    out.push({
      node,
      type: str(o.type),
      typeLabel: str(o.typeLabel),
      pipe: str(o.pipe),
    });
  }
  return out;
}

function parseAnimationClips(doc: GltfDoc): HmiAnimationClip[] {
  const out: HmiAnimationClip[] = [];
  for (const raw of doc.animations ?? []) {
    const name = str(raw.name);
    if (!name) continue;
    const extras = asRecord(raw.extras);
    out.push({
      name,
      loop: extras && typeof extras.loop === "boolean" ? extras.loop : undefined,
      kind: extras ? str(extras.kind) : undefined,
    });
  }
  return out;
}

function signal(partial: Omit<BindableSignal, "id">): BindableSignal {
  return {
    id: `${partial.entityKind}:${partial.entityNode}:${partial.kind}:${partial.name}`,
    ...partial,
  };
}

const BUTTON_PART_IDS = new Set(["control-panel", "screen"]);

function partIdOf(node: GltfNode): string {
  const extras = node.extras;
  return typeof extras?.partId === "string" ? extras.partId : "";
}

function isButtonPart(node: GltfNode, deviceNode: string): boolean {
  const name = node.name ?? "";
  if (!name) return false;
  if (name.includes("fastener") || name.includes("backplate") || name.includes("recess-mounting")) {
    return false;
  }
  const part = partIdOf(node);
  return (
    name === `${deviceNode}_control-panel` ||
    name === `${deviceNode}_screen` ||
    (name.startsWith(`${deviceNode}_`) && BUTTON_PART_IDS.has(part))
  );
}

function buttonPartLabel(node: GltfNode): string {
  const part = partIdOf(node);
  const name = node.name ?? "";
  if (part === "screen" || name.endsWith("_screen")) return "屏幕";
  return "控制面板";
}

function collectDeviceButtons(nodes: GltfNode[], deviceNode: string): GltfNode[] {
  return nodes.filter((node) => isButtonPart(node, deviceNode));
}

function attachNameplateFlags(devices: HmiDevice[], nodes: GltfNode[]): void {
  for (const device of devices) {
    const buttons = collectDeviceButtons(nodes, device.node);
    const hasPanel = buttons.some((node) => buttonPartLabel(node) === "控制面板");
    const hasScreen = buttons.some((node) => buttonPartLabel(node) === "屏幕");
    device.hasNameplateControls = hasPanel && hasScreen;
  }
}

function collectBindables(parsed: Omit<ParsedHmiScene, "bindables">): BindableSignal[] {
  const list: BindableSignal[] = [];

  for (const d of parsed.devices) {
    const entityName = formatHmiDeviceName(d.name, d.tag);
    for (const p of d.data) {
      list.push(
        signal({
          entityNode: d.node,
          entityName,
          entityKind: "device",
          kind: "telemetry",
          name: p.name,
          label: p.unit ? `${p.name}（${p.unit}）` : p.name,
          unit: p.unit,
          valueType: inferValueType(p.name, p.unit, p.val),
          defaultValue: p.val,
        }),
      );
    }
    for (const a of d.actions) {
      list.push(
        signal({
          entityNode: d.node,
          entityName,
          entityKind: "device",
          kind: "action",
          name: a.id,
          label: a.label,
          valueType: "boolean",
          clip: a.clip,
          defaultValue: a.on,
          loop: a.loop,
          clipKind: a.kind,
        }),
      );
    }
  }

  for (const v of parsed.valves) {
    const name = v.typeLabel ? `${v.node} ${v.typeLabel}` : v.node;
    if (v.clips?.open) {
      list.push(
        signal({
          entityNode: v.node,
          entityName: name,
          entityKind: "valve",
          kind: "action",
          name: "open",
          label: "打开阀门",
          valueType: "boolean",
          clip: v.clips.open,
          loop: false,
          clipKind: "open",
        }),
      );
    }
    if (v.clips?.close) {
      list.push(
        signal({
          entityNode: v.node,
          entityName: name,
          entityKind: "valve",
          kind: "action",
          name: "close",
          label: "关闭阀门",
          valueType: "boolean",
          clip: v.clips.close,
          loop: false,
          clipKind: "close",
        }),
      );
    }
  }

  for (const i of parsed.instruments) {
    const name = i.typeLabel ? `${i.node} ${i.typeLabel}` : i.node;
    if (i.clips?.on) {
      list.push(
        signal({
          entityNode: i.node,
          entityName: name,
          entityKind: "instrument",
          kind: "action",
          name: "on",
          label: "仪表开启",
          valueType: "boolean",
          clip: i.clips.on,
          loop: false,
          clipKind: "on",
        }),
      );
    }
    if (i.clips?.off) {
      list.push(
        signal({
          entityNode: i.node,
          entityName: name,
          entityKind: "instrument",
          kind: "action",
          name: "off",
          label: "仪表关闭",
          valueType: "boolean",
          clip: i.clips.off,
          loop: false,
          clipKind: "off",
        }),
      );
    }
  }

  for (const p of parsed.pipes) {
    if (!p.flowClip) continue;
    list.push(
      signal({
        entityNode: p.node,
        entityName: formatHmiPipeName(p),
        entityKind: "pipe",
        kind: "action",
        name: "flow",
        label: "管道流动",
        valueType: "boolean",
        clip: p.flowClip,
        defaultValue: p.flowOn,
        loop: true,
        clipKind: "flow",
      }),
    );
  }

  return list;
}

function findHmiRoot(
  doc: GltfDoc,
): { schema?: string; name?: string; units?: string; up?: string; payload: Record<string, unknown> } | null {
  const nodes = doc.nodes ?? [];
  const candidates: Record<string, unknown>[] = [];
  const rootExtras = asRecord(nodes[0]?.extras);
  if (rootExtras?.hmi) {
    const hmi = asRecord(rootExtras.hmi);
    if (hmi) candidates.push(hmi);
  }
  // asset.extras.hmi 只有导出元数据，不能当权威文档；不要从这里取绑定清单。
  for (const node of nodes) {
    const hmi = asRecord(asRecord(node.extras)?.hmi);
    if (hmi && (hmi.devices || hmi.schema)) candidates.push(hmi);
  }
  for (const hmi of candidates) {
    if (hmi.devices || hmi.valves || hmi.schema) {
      return {
        schema: str(hmi.schema),
        name: str(hmi.name),
        units: str(hmi.units),
        up: str(hmi.up),
        payload: hmi,
      };
    }
  }
  return null;
}

function fallbackFromNodes(doc: GltfDoc): ParsedHmiScene {
  const nodeNames = (doc.nodes ?? [])
    .map((n) => n.name)
    .filter((n): n is string => !!n);
  const animationClips = parseAnimationClips(doc);
  return {
    source: "node-graph",
    devices: [],
    valves: [],
    instruments: [],
    pipes: [],
    fittings: [],
    rules: [],
    animations: animationClips.map((item) => item.name),
    animationClips,
    bindables: [],
    nodeNames,
  };
}

export function parseHmiFromGltfJson(json: Record<string, unknown>): ParsedHmiScene {
  const doc = json as GltfDoc;
  const found = findHmiRoot(doc);
  const nodeNames = (doc.nodes ?? [])
    .map((n) => n.name)
    .filter((n): n is string => !!n);
  const animationClips = parseAnimationClips(doc);
  const animations = animationClips.map((item) => item.name);

  if (!found) {
    return fallbackFromNodes(doc);
  }

  const payload = found.payload;
  const devices = parseDevices(asArray(payload.devices));
  attachNameplateFlags(devices, doc.nodes ?? []);
  const base: Omit<ParsedHmiScene, "bindables"> = {
    schema: found.schema,
    name: found.name,
    units: found.units,
    up: found.up,
    source: "hmi-extras",
    devices,
    valves: parseValves(asArray(payload.valves)),
    instruments: parseInstruments(asArray(payload.instruments)),
    pipes: parsePipes(asArray(payload.pipes)),
    fittings: parseFittings(asArray(payload.fittings)),
    rules: asArray(payload.rules).filter((x): x is string => typeof x === "string"),
    animations,
    animationClips,
    nodeNames,
  };
  return { ...base, bindables: collectBindables(base) };
}

export function parseHmiGlb(buffer: ArrayBuffer): ParsedHmiScene {
  const json = extractGlbJson(buffer);
  return parseHmiFromGltfJson(json);
}

export async function parseHmiGlbFile(file: File): Promise<ParsedHmiScene> {
  const buffer = await file.arrayBuffer();
  return parseHmiGlb(buffer);
}
