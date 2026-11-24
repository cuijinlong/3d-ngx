import { createContext, useContext, type ReactNode } from "react";

const HudSkinContext = createContext(false);

export function HudSkinProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <HudSkinContext.Provider value={enabled}>{children}</HudSkinContext.Provider>;
}

export function useHudSkin(): boolean {
  return useContext(HudSkinContext);
}
