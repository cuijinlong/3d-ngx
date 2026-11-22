
import { create } from "zustand";
import type { ParsedHmiScene, SceneDocument, SceneEntity } from "@idt/shared-types";
import {
  getConnectedGuardClient,
  resolveSceneBindings,
  resolveSceneWidgets,
  saveSceneBindings,
  saveSceneWidgets,
  writeSceneWidgetDraft,
  type SceneWidgetsDocument,
} from "@idt/data-adapter";
import { getScene, getSceneByTopologyId, inspectTopologyScene, saveScene } from "../services/scene/sceneService";
import { resolveOpenScene, SCENE_OPEN_ERRORS, type SceneOpenAccess } from "../services/scene/open-scene";
import { LOAD_TIMEOUT_MS } from "../constants/load-timeout";
import { useEditorStore } from "./editor.store";
import { createLoadSession } from "./scene-load-session";

const loadSession = createLoadSession();
let loadTimeoutMs = LOAD_TIMEOUT_MS;

/** 单测用：缩短超时，测完必须还原。 */
export function setSceneLoadTimeoutForTests(ms?: number): void {
  loadTimeoutMs = ms ?? LOAD_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}


interface HistoryEntry {
  label: string;
  document: SceneDocument;
}

interface SceneState {
  document: SceneDocument | null;
  hmi: ParsedHmiScene | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  loading: boolean;
  error: string | null;
  persistence: {
    available: boolean;
    bindingsSource: "platform" | "local-draft";
    widgetsSource: "platform" | "local-draft" | "empty";
  };
  sceneWidgets: SceneWidgetsDocument | null;
  setSceneWidgets: (layout: SceneWidgetsDocument | null) => void;
  load: (id: string, access?: SceneOpenAccess) => Promise<void>;
  setDocument: (document: SceneDocument, history?: string) => void;
  setHmi: (hmi: ParsedHmiScene | null) => void;
  updateEntity: (id: string, patch: Partial<SceneEntity>, history?: string) => void;
  addEntity: (entity: SceneEntity, history?: string) => void;
  removeEntity: (id: string) => void;
  undo: () => void;
  redo: () => void;
  persist: (note?: string) => Promise<void>;
  reset: () => void;
}

function clone(doc: SceneDocument): SceneDocument {
  return structuredClone(doc);
}

export const useSceneStore = create<SceneState>((set, get) => ({
  document: null,
  hmi: null,
  past: [],
  future: [],
  loading: false,
  error: null,
  persistence: { available: false, bindingsSource: "local-draft", widgetsSource: "empty" },
  sceneWidgets: null,

  load: async (id: string, access?: SceneOpenAccess) => {
    const ticket = loadSession.begin();
    set({ loading: true, error: null, document: null, past: [], future: [], sceneWidgets: null });
    try {
      const opened = await withTimeout((async () => {
        const viewerCustomerId = access?.role === "customer" ? access.customerId : undefined;
        let local = (await getSceneByTopologyId(id, viewerCustomerId)) ?? null;
        if (!local) {
          const legacy = await getScene(id);
          if (legacy?.platform?.topologyId) {
            if (!viewerCustomerId || legacy.platform.customerId === viewerCustomerId) local = legacy;
          }
        }
        let stub = null;
        let cause: "not-found" | "not-owned" | "not-scene" | "unavailable" | undefined;
        if (!local) {
          const inspected = await inspectTopologyScene(id);
          if (inspected.status === "ok") stub = inspected.document;
          else cause = inspected.status;
        }
        const result = resolveOpenScene({ access: access ?? { role: "anonymous" }, local, stub, cause });
        if (!result.ok) {
          return { ok: false as const, error: result.error };
        }
        let document = result.document;
        let persistence: SceneState["persistence"] = { available: false, bindingsSource: "local-draft", widgetsSource: "empty" };
        let sceneWidgets: SceneWidgetsDocument | null = null;
        const topologyId = document.platform?.topologyId;
        const client = getConnectedGuardClient();
        if (topologyId) {
          const bindings = await resolveSceneBindings(client, topologyId, document.bindings);
          if (bindings.source === "platform") {
            document = { ...document, bindings: bindings.document.bindings };
          }
          const widgets = await resolveSceneWidgets(client, topologyId);
          sceneWidgets = widgets.document;
          persistence = {
            available: bindings.source === "platform" || widgets.source === "platform",
            bindingsSource: bindings.source,
            widgetsSource: widgets.source,
          };
        }
        return { ok: true as const, document, persistence, sceneWidgets };
      })(), loadTimeoutMs, SCENE_OPEN_ERRORS.timeout);
      if (!ticket.isCurrent()) return;
      if (!opened.ok) {
        set({ loading: false, error: opened.error, document: null, sceneWidgets: null });
        return;
      }
      set({ document: opened.document, loading: false, error: null, persistence: opened.persistence, sceneWidgets: opened.sceneWidgets });
      useEditorStore.getState().markDirty(false);
    } catch (error) {
      if (!ticket.isCurrent()) return;
      set({
        loading: false,
        error: error instanceof Error ? error.message : SCENE_OPEN_ERRORS.unavailable,
        document: null,
      });
      ticket.expire();
    }
  },

  setDocument: (document, history) => {
    const current = get().document;
    const past = history && current
      ? [...get().past, { label: history, document: clone(current) }].slice(-80)
      : get().past;
    set({ document, past, future: history ? [] : get().future });
    if (history) useEditorStore.getState().markDirty(true);
  },

  setHmi: (hmi) => set({ hmi }),

  setSceneWidgets: (layout) => {
    const topologyId = get().document?.platform?.topologyId;
    if (topologyId && layout) {
      writeSceneWidgetDraft({ topologyId, document: layout });
      set({
        sceneWidgets: layout,
        persistence: { ...get().persistence, widgetsSource: "local-draft" },
      });
    } else {
      set({ sceneWidgets: layout });
    }
    useEditorStore.getState().markDirty(true);
  },


  updateEntity: (id, patch, history = "编辑实体") => {
    const current = get().document;
    if (!current) return;
    get().setDocument(
      {
        ...current,
        entities: current.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      },
      history,
    );
  },

  addEntity: (entity, history = "添加模型") => {
    const current = get().document;
    if (!current) return;
    get().setDocument({ ...current, entities: [...current.entities, entity] }, history);
  },

  removeEntity: (id) => {
    const current = get().document;
    if (!current) return;
    get().setDocument(
      {
        ...current,
        entities: current.entities.filter((e) => e.id !== id),
        bindings: current.bindings.filter((b) => b.sceneEntityId !== id),
      },
      "删除实体",
    );
  },

  undo: () => {
    const { past, document, future } = get();
    const last = past[past.length - 1];
    if (!last || !document) return;
    set({
      document: last.document,
      past: past.slice(0, -1),
      future: [...future, { label: "redo", document: clone(document) }],
    });
    useEditorStore.getState().markDirty(true);
  },

  redo: () => {
    const { future, document, past } = get();
    const next = future[future.length - 1];
    if (!next || !document) return;
    set({
      document: next.document,
      future: future.slice(0, -1),
      past: [...past, { label: "undo", document: clone(document) }],
    });
    useEditorStore.getState().markDirty(true);
  },

  persist: async (note) => {
    const document = get().document;
    if (!document) return;
    const saved = await saveScene(document, note);
    const topologyId = saved.platform?.topologyId;
    const client = getConnectedGuardClient();
    let persistence = get().persistence;
    let sceneWidgets = get().sceneWidgets;
    if (topologyId) {
      const bindings = await saveSceneBindings(client, topologyId, saved.bindings);
      const widgets = await saveSceneWidgets(client, topologyId, sceneWidgets);
      sceneWidgets = widgets.document;
      persistence = {
        available: bindings.source === "platform" || widgets.source === "platform",
        bindingsSource: bindings.source,
        widgetsSource: widgets.source,
      };
    }
    set({ document: saved, persistence, sceneWidgets });
    useEditorStore.getState().markDirty(false);
  },

  reset: () => {
    loadSession.invalidate();
    set({ document: null, hmi: null, past: [], future: [], error: null, loading: false, sceneWidgets: null, persistence: { available: false, bindingsSource: "local-draft", widgetsSource: "empty" } });
  },
}));
