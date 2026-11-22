import { describe, expect, it } from "vitest";
import {
  NGX_THEME_STORAGE_KEY,
  applyDocumentTheme,
  createAntdThemeTokens,
  ngxThemePalettes,
  readStoredTheme,
  themeTokens,
} from "./theme";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("ngx theme", () => {
  it("defaults to light when nothing is stored and does not follow a fake system value", () => {
    const storage = new MemoryStorage();
    expect(readStoredTheme(storage)).toBe("light");
    storage.setItem(NGX_THEME_STORAGE_KEY, "system");
    expect(readStoredTheme(storage)).toBe("light");
    storage.setItem("theme", "dark");
    expect(readStoredTheme(storage)).toBe("light");
  });

  it("reads and persists only light or dark under ngx-theme", () => {
    const storage = new MemoryStorage();
    const root = { getAttribute: (_: string) => null, setAttribute: (_k: string, _v: string) => undefined } as unknown as HTMLElement;
    const written: string[] = [];
    const el = {
      setAttribute(name: string, value: string) {
        written.push(`${name}=${value}`);
      },
    } as unknown as HTMLElement;
    applyDocumentTheme("dark", { root: el, storage });
    expect(storage.getItem(NGX_THEME_STORAGE_KEY)).toBe("dark");
    expect(written).toEqual(["data-theme=dark"]);
    expect(readStoredTheme(storage)).toBe("dark");
    applyDocumentTheme("light", { root, storage, persist: false });
    expect(readStoredTheme(storage)).toBe("dark");
  });

  it("keeps the same primary on both palettes and maps Ant Design tokens from the chosen palette", () => {
    expect(ngxThemePalettes.light.colorPrimary).toBe("#1657e8");
    expect(ngxThemePalettes.dark.colorPrimary).toBe("#1657e8");
    expect(themeTokens.colorPrimary).toBe("#1657e8");
    expect(themeTokens.colorBg).toBe("#edf1f7");
    const light = createAntdThemeTokens("light");
    const dark = createAntdThemeTokens("dark");
    expect(light.colorPrimary).toBe("#1657e8");
    expect(dark.colorPrimary).toBe("#1657e8");
    expect(light.colorBgLayout).toBe("#edf1f7");
    expect(dark.colorBgLayout).toBe("#12161c");
    expect(light.fontSize).toBe(13);
    expect(dark.fontSize).toBe(13);
    expect(light.borderRadius).toBe(8);
    expect(dark.borderRadius).toBe(8);
  });
});
