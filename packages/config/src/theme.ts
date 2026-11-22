export const NGX_THEME_STORAGE_KEY = "ngx-theme";

export type NgxThemeName = "light" | "dark";

export const NGX_FONT =
  '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif';

export const ngxThemeScale = {
  fontFamily: NGX_FONT,
  fontSizeCaption: 12,
  fontSizeBody: 13,
  fontSizeSection: 16,
  fontSizeTitle: 20,
  fontSizeDisplay: 24,
  lineHeight: 1.6,
  space1: 4,
  space2: 8,
  space3: 16,
  space4: 24,
  space5: 32,
  radius: 8,
  radiusControl: 6,
  radiusTag: 4,
  controlHeight: 32,
  controlHeightLarge: 36,
  glassBlur: 16,
} as const;

export const ngxThemePalettes = {
  light: {
    colorBg: "#edf1f7",
    colorSurface: "#ffffff",
    colorSurfaceRaised: "#ffffff",
    colorBorder: "#dce3ed",
    colorText: "#1f2329",
    colorMuted: "#5f6e84",
    colorPrimary: "#1657e8",
    colorPrimaryHover: "#2f6bff",
    colorPrimaryStrong: "#002c96",
    colorPrimarySoft: "#e8eefc",
    colorOnPrimary: "#ffffff",
    colorSuccess: "#19b37d",
    colorWarning: "#e8930c",
    colorDanger: "#e5484d",
    colorOffline: "#6B7178",
    colorViewport: "#dce3ed",
    colorNameplate: "rgba(31, 35, 41, 0.88)",
    colorNameplateText: "#ffffff",
    glassBg: "rgba(255, 255, 255, 0.72)",
    glassBorder: "rgba(220, 227, 237, 0.85)",
    shadow: "0 1px 4px rgba(0, 0, 0, 0.06)",
    focusRing: "0 0 0 3px rgba(22, 87, 232, 0.18)",
  },
  dark: {
    colorBg: "#12161c",
    colorSurface: "#1b212b",
    colorSurfaceRaised: "#232a36",
    colorBorder: "#2c3542",
    colorText: "#e8edf4",
    colorMuted: "#8b97a8",
    colorPrimary: "#1657e8",
    colorPrimaryHover: "#2f6bff",
    colorPrimaryStrong: "#9db6ff",
    colorPrimarySoft: "rgba(22, 87, 232, 0.20)",
    colorOnPrimary: "#ffffff",
    colorSuccess: "#19b37d",
    colorWarning: "#e8930c",
    colorDanger: "#e5484d",
    colorOffline: "#8b9198",
    colorViewport: "#0e1218",
    colorNameplate: "rgba(12, 16, 22, 0.90)",
    colorNameplateText: "#e8edf4",
    glassBg: "rgba(27, 33, 43, 0.72)",
    glassBorder: "rgba(255, 255, 255, 0.08)",
    shadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
    focusRing: "0 0 0 3px rgba(47, 107, 255, 0.35)",
  },
} as const;

/** 亮色基准，供仍引用 themeTokens 的调用方使用。不要再复制一份色板。 */
export const themeTokens = {
  colorBg: ngxThemePalettes.light.colorBg,
  colorSurface: ngxThemePalettes.light.colorSurface,
  colorBorder: ngxThemePalettes.light.colorBorder,
  colorText: ngxThemePalettes.light.colorText,
  colorMuted: ngxThemePalettes.light.colorMuted,
  colorPrimary: ngxThemePalettes.light.colorPrimary,
  colorPrimaryStrong: ngxThemePalettes.light.colorPrimaryStrong,
  colorAccent: ngxThemePalettes.light.colorPrimaryHover,
  colorSuccess: ngxThemePalettes.light.colorSuccess,
  colorWarning: ngxThemePalettes.light.colorWarning,
  colorDanger: ngxThemePalettes.light.colorDanger,
  colorViewport: ngxThemePalettes.light.colorViewport,
  fontFamily: NGX_FONT,
} as const;

export function isNgxThemeName(value: unknown): value is NgxThemeName {
  return value === "light" || value === "dark";
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 没选过就用亮色，不要跟随系统主题。 */
export function readStoredTheme(storage?: Storage | null): NgxThemeName {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    const raw = store?.getItem(NGX_THEME_STORAGE_KEY);
    return raw === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyDocumentTheme(
  theme: NgxThemeName,
  options?: { persist?: boolean; root?: HTMLElement | null; storage?: Storage | null },
): void {
  const name: NgxThemeName = theme === "dark" ? "dark" : "light";
  const root =
    options?.root ?? (typeof document !== "undefined" ? document.documentElement : null);
  root?.setAttribute("data-theme", name);
  if (options?.persist === false) return;
  const store = options?.storage === undefined ? defaultStorage() : options.storage;
  try {
    store?.setItem(NGX_THEME_STORAGE_KEY, name);
  } catch {
    /* 忽略配额或禁用存储 */
  }
}

export function createAntdThemeTokens(theme: NgxThemeName = "light") {
  const palette = ngxThemePalettes[theme === "dark" ? "dark" : "light"];
  return {
    colorPrimary: palette.colorPrimary,
    colorSuccess: palette.colorSuccess,
    colorWarning: palette.colorWarning,
    colorError: palette.colorDanger,
    colorText: palette.colorText,
    colorTextSecondary: palette.colorMuted,
    colorBorder: palette.colorBorder,
    colorBgLayout: palette.colorBg,
    colorBgContainer: palette.colorSurface,
    colorBgElevated: palette.colorSurfaceRaised,
    borderRadius: ngxThemeScale.radius,
    controlHeight: ngxThemeScale.controlHeight,
    fontFamily: NGX_FONT,
    fontSize: ngxThemeScale.fontSizeBody,
  };
}

/** 默认亮色 token，算法由应用里的 ConfigProvider 按当前主题补上。 */
export const antdTheme = {
  token: createAntdThemeTokens("light"),
};
