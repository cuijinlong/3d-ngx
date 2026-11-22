/** 从 GLB extras.hmi（hmi-scene/1）或节点图动态解析出的可绑定目标，禁止写死设备清单。 */

export type HmiEntityKind =
  | "device"
  | "valve"
  | "instrument"
  | "pipe"
  | "fitting"
  | "button"
  | "node";

export type BindableKind = "telemetry" | "action" | "state";

export interface HmiAction {
  id: string;
  label: string;
  clip?: string;
  on?: boolean;
  loop?: boolean;
  kind?: string;
}

export interface HmiDataPoint {
  name: string;
  unit?: string;
  val?: string;
}

export interface HmiDevice {
  node: string;
  name: string;
  tag?: string;
  model?: string;
  modelName?: string;
  actions: HmiAction[];
  data: HmiDataPoint[];
  /** 同时具备控制面板和屏幕零件时，铭牌才提供启停。不要写死台数或型号。 */
  hasNameplateControls?: boolean;
}

export interface HmiValve {
  node: string;
  type?: string;
  typeLabel?: string;
  pipe?: string;
  open?: boolean;
  clips?: { open?: string; close?: string };
  stopsFlow?: boolean;
}

export interface HmiInstrument {
  node: string;
  type?: string;
  typeLabel?: string;
  pipe?: string;
  clips?: { on?: string; off?: string };
}

export interface HmiPipe {
  node: string;
  no?: string;
  name?: string;
  mediumLabel?: string;
  from?: string;
  to?: string;
  seg?: string | number;
  segs?: string | number;
  flowClip?: string;
  flowNode?: string;
  flowOn?: boolean;
  valves: string[];
  instruments: string[];
}

export interface HmiFitting {
  node: string;
  type?: string;
  typeLabel?: string;
  pipe?: string;
}

export interface BindableSignal {
  id: string;
  entityNode: string;
  entityName: string;
  entityKind: HmiEntityKind;
  kind: BindableKind;
  name: string;
  label: string;
  unit?: string;
  valueType: "number" | "boolean" | "text";
  clip?: string;
  defaultValue?: string | number | boolean;
  loop?: boolean;
  clipKind?: string;
}

export interface HmiAnimationClip {
  name: string;
  loop?: boolean;
  kind?: string;
}

export interface ParsedHmiScene {
  schema?: string;
  name?: string;
  units?: string;
  up?: string;
  source: "hmi-extras" | "node-graph";
  devices: HmiDevice[];
  valves: HmiValve[];
  instruments: HmiInstrument[];
  pipes: HmiPipe[];
  fittings: HmiFitting[];
  rules: string[];
  animations: string[];
  animationClips?: HmiAnimationClip[];
  bindables: BindableSignal[];
  nodeNames: string[];
}
