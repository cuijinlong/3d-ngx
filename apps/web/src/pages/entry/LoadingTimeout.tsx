import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LOAD_TIMEOUT_MESSAGE, LOAD_TIMEOUT_MS } from "../../constants/load-timeout";
import { CustomerTrail } from "./CustomerTrail";
import { EntryChrome, entryStyles } from "./EntryChrome";
import styles from "./EmptyDefaultScene.module.css";

export function useLoadTimeout(active: boolean, ms: number = LOAD_TIMEOUT_MS): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!active) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return timedOut;
}

export function LoadingTimeout(props: {
  backTo: string;
  customerName?: string;
}) {
  const nav = useNavigate();
  const crumbs = props.customerName?.trim()
    ? <CustomerTrail customerName={props.customerName} current="场景管理" nameTo={props.backTo} />
    : <b>选择客户</b>;
  return (
    <EntryChrome crumbs={crumbs}>
      <div className={`${styles.empty} ${styles.fill}`}>
        <div className={styles.card} role="status">
          <h1>{LOAD_TIMEOUT_MESSAGE}</h1>
          <div className={styles.actions}>
            <button type="button" className={entryStyles.primary} onClick={() => window.location.reload()}>
              刷新
            </button>
            <button type="button" className={entryStyles.ghost} onClick={() => nav(props.backTo)}>
              返回
            </button>
          </div>
        </div>
      </div>
    </EntryChrome>
  );
}
