import { describe, expect, it } from "vitest";
import { isHudSurface, runtimeSurfaceKind, sceneSurfaceChrome } from "./runtime-surface";

describe("runtime surface", () => {
  it("reuses the customer runtime surface for tenant preview and keeps the editor off the hud skin", () => {
    expect(isHudSurface("runtime")).toBe(true);
    expect(isHudSurface("preview")).toBe(true);
    expect(isHudSurface("editor")).toBe(false);
    expect(runtimeSurfaceKind("preview")).toBe("runtime");
    expect(runtimeSurfaceKind("runtime")).toBe("runtime");
    expect(runtimeSurfaceKind("editor")).toBe("editor");

    const preview = sceneSurfaceChrome("preview", "tenant");
    const customer = sceneSurfaceChrome("runtime", "customer");
    const editor = sceneSurfaceChrome("editor", "tenant");

    expect(preview.hud).toBe(true);
    expect(customer.hud).toBe(true);
    expect(editor.hud).toBe(false);
    expect(preview.widgetSurface).toBe(customer.widgetSurface);
    expect(preview.frame).toBe(customer.frame);
    expect(preview.viewportMode).toBe(customer.viewportMode);
    expect(preview.readOnly).toBe(true);
    expect(preview.showArrange).toBe(false);
    expect(preview.showDraftMark).toBe(false);
    expect(preview.showOpacityControls).toBe(false);
    expect(preview.showEditorToolbar).toBe(false);
    expect(preview.showBindingAside).toBe(false);
    expect(preview.showExitPreview).toBe(true);
    expect(customer.showExitPreview).toBe(false);
    expect(customer.showArrange).toBe(false);
    expect(customer.showDraftMark).toBe(false);
    expect(editor.showExitPreview).toBe(false);
    expect(editor.showEditorToolbar).toBe(true);
    expect(editor.showDraftMark).toBe(true);
    expect(editor.showArrange).toBe(true);
  });
});
