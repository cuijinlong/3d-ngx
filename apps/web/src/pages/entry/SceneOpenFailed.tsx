import { useNavigate } from "react-router-dom";
import { SCENE_OPEN_UNKNOWN_MESSAGE } from "../../services/scene/open-scene";
import { CustomerTrail } from "./CustomerTrail";
import { EntryChrome, entryStyles } from "./EntryChrome";
import styles from "./EmptyDefaultScene.module.css";

export function SceneOpenFailed(props: {
  message?: string | null;
  backTo?: string;
  backLabel?: string;
  customerName?: string;
  framed?: boolean;
}) {
  const nav = useNavigate();
  const message = props.message?.trim() || SCENE_OPEN_UNKNOWN_MESSAGE;
  const backTo = props.backTo;
  const crumbs = props.customerName?.trim()
    ? <CustomerTrail customerName={props.customerName} current="打开失败" nameTo={backTo} />
    : <CustomerTrail current="打开失败" />;
  const card = (
    <div className={`${styles.empty} ${styles.fill}`}>
      <div className={styles.card}>
        <h1>打开失败</h1>
        <p>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={entryStyles.ghost} onClick={() => window.location.reload()}>
            刷新重试
          </button>
          {backTo ? (
            <button type="button" className={entryStyles.primary} onClick={() => nav(backTo)}>
              {props.backLabel || "返回场景管理"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
  if (props.framed === false) return card;
  return (
    <EntryChrome crumbs={crumbs}>
      {card}
    </EntryChrome>
  );
}
