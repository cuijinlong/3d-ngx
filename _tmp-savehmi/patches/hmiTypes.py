from pathlib import Path
p = Path("packages/shared-types/src/hmi.ts")
text = p.read_text()
if "hasNameplateControls" in text and "animationClips" in text:
    print("hmi.ts already extended")
    raise SystemExit(0)

text = text.replace(
'''export interface HmiAction {
  id: string;
  label: string;
  clip?: string;
  on?: boolean;
}
''',
'''export interface HmiAction {
  id: string;
  label: string;
  clip?: string;
  on?: boolean;
  loop?: boolean;
  kind?: string;
}
''')
text = text.replace(
'''  actions: HmiAction[];
  data: HmiDataPoint[];
}
''',
'''  actions: HmiAction[];
  data: HmiDataPoint[];
  /** 同时具备控制面板和屏幕零件时，铭牌才提供启停。不要写死台数或型号。 */
  hasNameplateControls?: boolean;
}
''')
text = text.replace(
'''  from?: string;
  to?: string;
  flowClip?: string;
  flowOn?: boolean;
''',
'''  from?: string;
  to?: string;
  seg?: string | number;
  segs?: string | number;
  flowClip?: string;
  flowNode?: string;
  flowOn?: boolean;
''')
text = text.replace(
'''  clip?: string;
  defaultValue?: string | number | boolean;
}
''',
'''  clip?: string;
  defaultValue?: string | number | boolean;
  loop?: boolean;
  clipKind?: string;
}
''')
text = text.replace(
'''export interface ParsedHmiScene {
''',
'''export interface HmiAnimationClip {
  name: string;
  loop?: boolean;
  kind?: string;
}

export interface ParsedHmiScene {
''')
text = text.replace(
'''  animations: string[];
  bindables: BindableSignal[];
''',
'''  animations: string[];
  animationClips?: HmiAnimationClip[];
  bindables: BindableSignal[];
''')
if "hasNameplateControls" not in text or "animationClips" not in text or "flowNode" not in text:
    raise SystemExit("hmi incremental patch failed")
p.write_text(text)
print("incrementally patched hmi.ts")
