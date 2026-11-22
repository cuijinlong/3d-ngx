import {
  applyDocumentTheme,
  createAntdThemeTokens,
  readStoredTheme,
  type NgxThemeName,
} from "@idt/config";
import { ConfigProvider, theme as antdThemeApi } from "antd";
import zhCN from "antd/locale/zh_CN";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface AppThemeValue {
  theme: NgxThemeName;
  setTheme: (theme: NgxThemeName) => void;
}

const AppThemeContext = createContext<AppThemeValue | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<NgxThemeName>(() => readStoredTheme());

  const setTheme = useCallback((next: NgxThemeName) => {
    const name: NgxThemeName = next === "dark" ? "dark" : "light";
    applyDocumentTheme(name);
    setThemeState(name);
  }, []);

  const antdTheme = useMemo(
    () => ({
      algorithm: theme === "dark" ? antdThemeApi.darkAlgorithm : antdThemeApi.defaultAlgorithm,
      token: createAntdThemeTokens(theme),
    }),
    [theme],
  );

  return (
    <AppThemeContext.Provider value={{ theme, setTheme }}>
      <ConfigProvider locale={zhCN} theme={antdTheme}>
        {children}
      </ConfigProvider>
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppThemeValue {
  const value = useContext(AppThemeContext);
  if (!value) throw new Error("useAppTheme 必须在 AppThemeProvider 内使用");
  return value;
}
