
import { create } from "zustand";

interface SelectionState {
  entityId: string | null;
  nodeName: string | null;
  select: (entityId: string | null, nodeName?: string | null) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  entityId: null,
  nodeName: null,
  select: (entityId, nodeName = null) => set({ entityId, nodeName }),
  clear: () => set({ entityId: null, nodeName: null }),
}));
