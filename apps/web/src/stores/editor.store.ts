
import { create } from "zustand";

export type TransformTool = "translate" | "rotate" | "scale";

interface EditorState {
  tool: TransformTool;
  coordinateSpace: "local" | "world";
  snapEnabled: boolean;
  snapSize: number;
  dirty: boolean;
  preview: boolean;
  setTool: (tool: TransformTool) => void;
  setCoordinateSpace: (space: "local" | "world") => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapSize: (size: number) => void;
  markDirty: (dirty?: boolean) => void;
  setPreview: (preview: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  tool: "translate",
  coordinateSpace: "world",
  snapEnabled: false,
  snapSize: 0.1,
  dirty: false,
  preview: false,
  setTool: (tool) => set({ tool }),
  setCoordinateSpace: (coordinateSpace) => set({ coordinateSpace }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setSnapSize: (snapSize) => set({ snapSize }),
  markDirty: (dirty = true) => set({ dirty }),
  setPreview: (preview) => set({ preview }),
}));
