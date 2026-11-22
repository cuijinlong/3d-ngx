
import { APP_ERROR_BODY, APP_ERROR_TITLE } from "../constants/load-timeout";
import { routes } from "../constants/routes";
import { ThemeToggle } from "../theme/ThemeToggle";
import entryStyles from "../pages/entry/EntryChrome.module.css";
import styles from "../pages/entry/EmptyDefaultScene.module.css";

/** 中文全局失败页。不用路由钩子，因为错误边界在 RouterProvider 之外。不展示英文堆栈。 */
export function AppErrorPage() {
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
        <a className={entryStyles.ghost} href={routes.settings} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          设置
        </a>
        <ThemeToggle />
        <a className={entryStyles.ghost} href={routes.login} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          退出
        </a>
      </div>
      <div className={`${styles.empty} ${styles.fill}`}>
        <div className={styles.card} role="alert">
          <h1>{APP_ERROR_TITLE}</h1>
          <p>{APP_ERROR_BODY}</p>
          <div className={styles.actions}>
            <button type="button" className={entryStyles.primary} onClick={() => window.location.reload()}>
              刷新
            </button>
            <a
              href={routes.login}
              className={entryStyles.ghost}
              style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
            >
              回到登录
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
