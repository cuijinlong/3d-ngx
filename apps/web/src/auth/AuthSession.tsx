import {
  connectGuard,
  disconnectGuard,
  getAuthSnapshot,
  loadSavedGuardSettings,
  type AuthSnapshot,
  type SessionRole,
} from "@idt/data-adapter";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAppStore } from "../stores/app.store";
import { homePath } from "./access";
import { routes } from "../constants/routes";
import { CustomerAccessBlocked } from "../pages/entry/CustomerAccessBlocked";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../constants/load-timeout";
import { ThemeToggle } from "../theme/ThemeToggle";
import entryStyles from "../pages/entry/EntryChrome.module.css";
import emptyStyles from "../pages/entry/EmptyDefaultScene.module.css";

interface AuthContextValue extends AuthSnapshot {
  ready: boolean;
  login: (username: string, password: string) => Promise<AuthSnapshot>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const bootReady = useAppStore((s) => s.ready);
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(() => getAuthSnapshot());

  useEffect(() => {
    const sync = () => setSnapshot(getAuthSnapshot());
    sync();
    window.addEventListener("idt-provider-changed", sync);
    return () => window.removeEventListener("idt-provider-changed", sync);
  }, [bootReady]);

  const value = useMemo<AuthContextValue>(() => ({
    ...snapshot,
    ready: bootReady,
    async login(username: string, password: string) {
      const saved = loadSavedGuardSettings();
      await connectGuard({
        apiBase: saved?.apiBase || "/api",
        username,
        password,
      });
      const next = getAuthSnapshot();
      setSnapshot(next);
      return next;
    },
    async logout() {
      await disconnectGuard();
      const next = getAuthSnapshot();
      setSnapshot(next);
    },
  }), [snapshot, bootReady]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuthSession 必须在 AuthSessionProvider 内使用");
  }
  return value;
}

function BootPlaceholder() {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!timedOut) {
    return (
      <div className="page" style={{ alignItems: "center", justifyContent: "center", color: "var(--ngx-color-muted)" }}>
        加载中
      </div>
    );
  }
  return (
    <div className={entryStyles.stage} style={{ minHeight: "100vh" }}>
      <div className={entryStyles.top}>
        <a className={entryStyles.brand} href={routes.selectCustomer} data-testid="app-logo">
          3D-NGX
        </a>
        <div className={entryStyles.crumb}>
          <a href={routes.selectCustomer} className={entryStyles.link} style={{ marginRight: 0 }}>
            选择客户
          </a>
        </div>
        <div className={entryStyles.spacer} />
        <ThemeToggle />
        <a className={entryStyles.ghost} href={routes.login} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          退出
        </a>
      </div>
      <div className={`${emptyStyles.empty} ${emptyStyles.fill}`}>
        <div className={emptyStyles.card} role="status">
          <h1>{LOAD_TIMEOUT_MESSAGE}</h1>
          <div className={emptyStyles.actions}>
            <button type="button" className={entryStyles.primary} onClick={() => window.location.reload()}>
              刷新
            </button>
            <a
              href={routes.login}
              className={entryStyles.ghost}
              style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >
              返回
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, connected } = useAuthSession();
  const location = useLocation();
  if (!ready) return <BootPlaceholder />;
  if (!connected) {
    return <Navigate to={routes.login} replace state={{ from: location.pathname }} />;
  }
  return children;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { ready, connected, role, customerId } = useAuthSession();
  if (!ready) return <BootPlaceholder />;
  if (connected) return <Navigate to={homePath(role, customerId)} replace />;
  return children;
}

export function RequireTenant({ children }: { children: ReactNode }) {
  const { role } = useAuthSession();
  if (role === "customer") return <CustomerAccessBlocked />;
  return children;
}

export function HomeRedirect() {
  const { ready, role, customerId } = useAuthSession();
  if (!ready) return <BootPlaceholder />;
  return <Navigate to={homePath(role, customerId)} replace />;
}

export type { SessionRole };
