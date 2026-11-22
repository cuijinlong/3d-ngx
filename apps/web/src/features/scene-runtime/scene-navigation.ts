export const SCENE_NAV_STORAGE_KEY = "idt-3d-ngx-scene-nav-stack";

export interface SceneViewState {
  yaw: number;
  pitch: number;
  distance: number;
  pivot: [number, number, number];
}

export interface SceneNavEntry {
  topologyId: string;
  name: string;
  view?: SceneViewState;
  selectedNode?: string | null;
}

export interface SceneNavState {
  customerId: string;
  path: SceneNavEntry[];
}

export function startSceneNav(customerId: string, entry: SceneNavEntry): SceneNavState {
  return { customerId, path: [{ topologyId: entry.topologyId, name: entry.name }] };
}

/** 离开当前级进入下级前，把视角和选择记在当前条目上。 */
export function pushSceneNav(
  state: SceneNavState,
  leaving: Pick<SceneNavEntry, "view" | "selectedNode">,
  next: SceneNavEntry,
): SceneNavState {
  if (!state.path.length) return { customerId: state.customerId, path: [next] };
  const path = state.path.map((item, index) =>
    index === state.path.length - 1 ? { ...item, view: leaving.view, selectedNode: leaving.selectedNode } : item,
  );
  if (path.some((item) => item.topologyId === next.topologyId)) {
    const cut = path.findIndex((item) => item.topologyId === next.topologyId);
    return { customerId: state.customerId, path: path.slice(0, cut + 1) };
  }
  return { customerId: state.customerId, path: [...path, { topologyId: next.topologyId, name: next.name }] };
}

/** 点面包屑上级：裁到那一级，并返回离开前记下的视角和选择。 */
export function returnToSceneNav(
  state: SceneNavState,
  topologyId: string,
): { state: SceneNavState; restore?: SceneNavEntry } | null {
  const index = state.path.findIndex((item) => item.topologyId === topologyId);
  if (index < 0) return null;
  const restore = state.path[index];
  return {
    state: { customerId: state.customerId, path: state.path.slice(0, index + 1).map((item, i) => (i === index ? { ...item, view: undefined, selectedNode: undefined } : item)) },
    restore,
  };
}

export function currentSceneNav(state: SceneNavState | null | undefined): SceneNavEntry | undefined {
  return state?.path[state.path.length - 1];
}

export function readSceneNav(customerId: string, storage?: Storage | null): SceneNavState | null {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  try {
    const raw = store?.getItem(SCENE_NAV_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SceneNavState;
    if (parsed?.customerId !== customerId || !Array.isArray(parsed.path)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSceneNav(state: SceneNavState, storage?: Storage | null): void {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  try {
    store?.setItem(SCENE_NAV_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const SCENE_NAV_RESTORE_KEY = "idt-3d-ngx-scene-nav-restore";

export function writeSceneNavRestore(entry: SceneNavEntry, storage?: Storage | null): void {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  try {
    store?.setItem(SCENE_NAV_RESTORE_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function takeSceneNavRestore(topologyId: string, storage?: Storage | null): SceneNavEntry | null {
  const store = storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  try {
    const raw = store?.getItem(SCENE_NAV_RESTORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SceneNavEntry;
    if (parsed?.topologyId !== topologyId) return null;
    store?.removeItem(SCENE_NAV_RESTORE_KEY);
    return parsed;
  } catch {
    return null;
  }
}
