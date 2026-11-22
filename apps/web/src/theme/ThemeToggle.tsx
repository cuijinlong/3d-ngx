import styles from "./ThemeToggle.module.css";
import { useAppTheme } from "./AppThemeProvider";

export function ThemeToggle() {
  const { theme, setTheme } = useAppTheme();
  return (
    <div className={styles.toggle} role="group" aria-label="主题">
      <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
        亮色
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
        深色
      </button>
    </div>
  );
}
