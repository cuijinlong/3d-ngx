import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { SettingOutlined } from "@ant-design/icons";
import { APP_NAV_ITEMS } from "../../constants/nav";
import { routes } from "../../constants/routes";
import { useAuthSession } from "../../auth/AuthSession";
import { homePath } from "../../auth/access";
import { ThemeToggle } from "../../theme/ThemeToggle";
import styles from "./AppLayout.module.css";

const icons: Record<(typeof APP_NAV_ITEMS)[number]["to"], ReactNode> = {
  [routes.settings]: <SettingOutlined />,
};

export function AppLayout() {
  const { role, customerId } = useAuthSession();
  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <NavLink to={homePath(role, customerId)} className={styles.logo} data-testid="app-logo">
          3D<span>-NGX</span>
        </NavLink>
        <nav className={styles.nav} data-testid="app-nav">
          {APP_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
            >
              {icons[item.to]}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.railFoot}>
          <ThemeToggle />
        </div>
      </aside>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  );
}
