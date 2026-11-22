import { useNavigate } from "react-router-dom";
import { routes } from "../../constants/routes";
import { ThemeToggle } from "../../theme/ThemeToggle";
import entryStyles from "./EntryChrome.module.css";
import styles from "./EmptyDefaultScene.module.css";

/** 不引用 AuthSession，避免与 RequireTenant 形成循环依赖。 */
export function CustomerAccessBlocked() {
  const nav = useNavigate();
  return (
    <div className={entryStyles.stage}>
      <div className={entryStyles.top}>
        <span className={entryStyles.brand}>3D-NGX</span>
        <div className={entryStyles.crumb}><b>无法进入</b></div>
        <div className={entryStyles.spacer} />
        <ThemeToggle />
      </div>
      <div className={`${styles.empty} ${styles.fill}`}>
        <div className={styles.card}>
          <h1>没有权限进入该页面</h1>
          <p>场景管理、编辑和默认场景指定由管理员负责。请从你的默认场景进入，或请管理员为你指定默认场景。</p>
          <button type="button" className={entryStyles.primary} onClick={() => nav(routes.runtime)}>
            返回默认场景
          </button>
        </div>
      </div>
    </div>
  );
}
