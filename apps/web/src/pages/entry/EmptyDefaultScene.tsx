import { EntryChrome } from "./EntryChrome";
import { routes } from "../../constants/routes";
import styles from "./EmptyDefaultScene.module.css";

export function EmptyDefaultScene({ source: _source }: { source?: "platform" | "local-draft" } = {}) {
  return (
    <EntryChrome crumbs={<b>默认场景</b>} brandTo={routes.runtime}>
      <div className={styles.empty}>
        <div className={styles.card}>
          <h1>还没有指定默认场景</h1>
          <p>管理员还没有为你指定默认场景。指定完成后，打开系统就会进入那个场景。当前没有指定默认场景，不会打开空白画面来代替。</p>
        </div>
      </div>
    </EntryChrome>
  );
}
