
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSession";
import { brandPath, workbenchChrome } from "../../auth/access";
import { routes } from "../../constants/routes";
import { ThemeToggle } from "../../theme/ThemeToggle";
import styles from "./EntryChrome.module.css";

export function EntryChrome(props: {
  crumbs: ReactNode;
  children: ReactNode;
  brandTo?: string;
}) {
  const { logout, role } = useAuthSession();
  const chrome = workbenchChrome(role);
  const nav = useNavigate();
  const brandTo = props.brandTo ?? brandPath(role);
  return (
    <div className={styles.stage}>
      <div className={styles.top}>
        <Link className={styles.brand} to={brandTo} data-testid="app-logo">
          3D-NGX
        </Link>
        <div className={styles.crumb}>{props.crumbs}</div>
        <div className={styles.spacer} />
        {/*
          模板库（2026-11-23）：租户级入口，放在所有租户页面共用顶栏上。
          不塞进客户范围菜单 —— 模板属于租户、不属于某个客户，
          客户进到自己的场景时也不该看到它（客户本来就走不到 EntryChrome 的租户分支）。
        */}
        {chrome.showPlatformSettings ? (
          <Link className={styles.ghost} to={routes.templates} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            模板库
          </Link>
        ) : null}
        {chrome.showPlatformSettings ? (
          <Link className={styles.ghost} to={routes.settings} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            设置
          </Link>
        ) : null}
        <ThemeToggle />
        <button
          type="button"
          className={styles.ghost}
          onClick={() => void logout().then(() => nav(routes.login, { replace: true }))}
        >
          退出
        </button>
      </div>
      {props.children}
    </div>
  );
}

export { styles as entryStyles };
