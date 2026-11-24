import { describe, expect, it } from "vitest";
import {
  NGX_THEME_STORAGE_KEY,
  NGX_HUD_ATTR,
  HUD_DEFAULT_GLASS_OPACITY,
  applyDocumentTheme,
  applyHudSkin,
  createAntdThemeTokens,
  isNgxThemeName,
  ngxHudTokens,
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

describe("ngx hud skin isolation", () => {
  it("does not treat hud as a workbench theme and keeps hud tokens off ngx-theme / data-theme", () => {
    expect(isNgxThemeName("hud")).toBe(false);
    expect(isNgxThemeName("light")).toBe(true);
    expect(ngxHudTokens.bg).toBe("#070d16");
    expect(ngxHudTokens.viewport).toBe("#071018");
    expect(ngxHudTokens.accent).toBe("#2ec7f0");
    expect(ngxHudTokens.glassBg).toBe("rgba(8, 24, 42, 0.64)");
    expect(HUD_DEFAULT_GLASS_OPACITY).toBe(0.64);

    const storage = new MemoryStorage();
    storage.setItem(NGX_THEME_STORAGE_KEY, "light");
    const written: string[] = [];
    const el = {
      attrs: new Map<string, string>(),
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
        written.push(`${name}=${value}`);
      },
      removeAttribute(name: string) {
        this.attrs.delete(name);
      },
      getAttribute(name: string) {
        return this.attrs.get(name) ?? null;
      },
    } as unknown as HTMLElement;

    applyHudSkin(true, { root: el, storage });
    expect((el as unknown as { getAttribute: (n: string) => string | null }).getAttribute(NGX_HUD_ATTR)).toBe("on");
    expect(written.some((item) => item.startsWith("data-theme="))).toBe(false);
    expect(storage.getItem(NGX_THEME_STORAGE_KEY)).toBe("light");

    applyDocumentTheme("dark", { root: el, storage });
    expect(storage.getItem(NGX_THEME_STORAGE_KEY)).toBe("dark");
    expect(written.filter((item) => item.startsWith("data-theme="))).toEqual(["data-theme=dark"]);

    applyHudSkin(false, { root: el, storage });
    expect((el as unknown as { getAttribute: (n: string) => string | null }).getAttribute(NGX_HUD_ATTR)).toBe(null);
    expect(storage.getItem(NGX_THEME_STORAGE_KEY)).toBe("dark");
  });
});
