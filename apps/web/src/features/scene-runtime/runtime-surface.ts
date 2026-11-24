import type { SessionRole } from "@idt/data-adapter";
import { workbenchChrome } from "../../auth/access";

export type SceneSurfaceKind = "editor" | "runtime" | "preview";

/** 预览与客户运行态共用同一套表面：HUD 皮肤、只读、更瘦的客户壳。 */
export function runtimeSurfaceKind(kind: SceneSurfaceKind): "editor" | "runtime" {
  return kind === "editor" ? "editor" : "runtime";
}

export function isHudSurface(kind: SceneSurfaceKind): boolean {
  return kind === "runtime" || kind === "preview";
}

export function sceneSurfaceChrome(kind: SceneSurfaceKind, role: SessionRole) {
  const chrome = workbenchChrome(role);
  const hud = isHudSurface(kind);
  return {
    kind,
    hud,
    readOnly: hud || role === "customer",
    showEditorToolbar: kind === "editor",
    showEditorStatusBar: kind === "editor",
    showBindingAside: kind === "editor" && chrome.showBindingPanel,
    showArrange: kind === "editor" && chrome.showWidgetDrag,
    showDraftMark: kind === "editor" && chrome.showWidgetDraftMark,
    showOpacityControls: kind === "editor" && chrome.showWidgetDrag,
    showDemoTelemetryToggle: kind === "runtime" && chrome.showDemoTelemetryToggle,
    showReturnToStudio: kind === "runtime" && chrome.showReturnToStudio,
    showLogout: kind === "runtime" && chrome.showLogout,
    showExitPreview: kind === "preview",
    showThemeToggle: kind !== "preview",
    frame: hud ? "hud" : "edit",
    viewportMode: hud ? "runtime" : "studio",
    widgetSurface: runtimeSurfaceKind(kind),
  } as const;
}
