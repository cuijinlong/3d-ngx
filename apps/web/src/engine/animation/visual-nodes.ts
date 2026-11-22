/** 从 GLB 节点名里挑出真正该转、该亮的部件，避免把整台机柜转起来。 */

const SPIN_ROOT = /spin[_-]?fan/i;
const SPIN_PART = /spin[_-]?fan|fan[_-]?hub|fan[_-]?blade|叶轮|风叶/i;
const SPIN_EXCLUDE = /recess|rim|panel|cabinet|mounted|screen|control/i;

const LED_PREFERRED = /blink[_-]?led|status[_-]?led|指示灯/i;
const LED_FALLBACK = /(?:^|[_-])(led|lamp)(?:$|[_-])|指示/i;

export function pickSpinNodeNames(names: string[]): string[] {
  const parts = names.filter((name) => SPIN_PART.test(name) && !SPIN_EXCLUDE.test(name));
  const roots = parts.filter((name) => SPIN_ROOT.test(name));
  return roots.length ? roots : parts;
}

export function pickIndicatorNodeNames(names: string[]): string[] {
  const preferred = names.filter((name) => LED_PREFERRED.test(name));
  if (preferred.length) return preferred;
  return names.filter((name) => LED_FALLBACK.test(name) && !/panel|highlight|screen/i.test(name));
}


const GAUGE_PART = /swing[_-]?gauge|gauge[_-]?needle|pointer|摆针|指针/i;
const DOOR_PART = /swing[_-]?door|cabinet[_-]?door|door[_-]?leaf|柜门/i;

export function pickGaugeNodeNames(names: string[]): string[] {
  return names.filter((name) => GAUGE_PART.test(name));
}

export function pickDoorNodeNames(names: string[]): string[] {
  return names.filter((name) => DOOR_PART.test(name));
}
