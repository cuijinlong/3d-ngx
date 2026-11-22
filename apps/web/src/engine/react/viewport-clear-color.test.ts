import { describe, expect, it } from "vitest";
import { ngxThemePalettes } from "@idt/config";
import { DEFAULT_ENGINE_CONFIG } from "../core/EngineConfig";
import { viewportClearColor } from "./viewport-clear-color";

describe("viewport clearColor follows the UI theme", () => {
  it("uses the light viewport token, not the hardcoded engine paper color", () => {
    expect(viewportClearColor("light")).toBe(ngxThemePalettes.light.colorViewport);
    expect(viewportClearColor("light")).toBe("#dce3ed");
    expect(DEFAULT_ENGINE_CONFIG.clearColor).toBe("#eef2f6");
    expect(viewportClearColor("light")).not.toBe(DEFAULT_ENGINE_CONFIG.clearColor);
  });

  it("uses the dark viewport token when the theme is dark", () => {
    expect(viewportClearColor("dark")).toBe(ngxThemePalettes.dark.colorViewport);
    expect(viewportClearColor("dark")).toBe("#0e1218");
    expect(viewportClearColor("dark")).not.toBe("#eef2f6");
    expect(viewportClearColor("dark")).not.toBe(DEFAULT_ENGINE_CONFIG.clearColor);
  });

  it("prefers the live --ngx-color-viewport value when present", () => {
    expect(viewportClearColor("light", { cssVariable: "  #0e1218  " })).toBe("#0e1218");
    expect(viewportClearColor("dark", { cssVariable: "" })).toBe("#0e1218");
  });
});
