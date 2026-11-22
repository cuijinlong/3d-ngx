import { ngxThemePalettes, type NgxThemeName } from "@idt/config";

/** 视口清屏色只跟 UI 主题走，不使用引擎配置里写死的浅色纸面。 */
export function viewportClearColor(
  theme: NgxThemeName,
  options?: { cssVariable?: string | null },
): string {
  const fromCss = options?.cssVariable?.trim();
  if (fromCss) return fromCss;
  return ngxThemePalettes[theme === "dark" ? "dark" : "light"].colorViewport;
}

export function readViewportCssClearColor(root?: Element | null): string | undefined {
  if (typeof getComputedStyle !== "function") return undefined;
  const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return undefined;
  const value = getComputedStyle(el).getPropertyValue("--ngx-color-viewport").trim();
  return value || undefined;
}
