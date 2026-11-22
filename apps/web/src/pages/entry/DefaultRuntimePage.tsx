
import { getConnectedGuardClient, resolveDefaultScene } from "@idt/data-adapter";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuthSession } from "../../auth/AuthSession";
import { brandPath, customerScopePath } from "../../auth/access";
import { resolveTenantCustomerId, usableCustomerId } from "../../auth/customer-scope";
import { routes } from "../../constants/routes";
import { listLocalScenesForCustomer, resolveTopologyIdFromLegacyScene } from "../../services/scene/sceneService";
import { EmptyDefaultScene } from "./EmptyDefaultScene";
import { EntryChrome, entryStyles } from "./EntryChrome";
import { LoadingTimeout, useLoadTimeout } from "./LoadingTimeout";
import { useCustomerName } from "./useCustomerName";
import styles from "./EmptyDefaultScene.module.css";

export function DefaultRuntimePage() {
  const { customerId, role } = useAuthSession();
  const scopeId = role === "customer" ? usableCustomerId(customerId) : resolveTenantCustomerId(customerId);
  const [ready, setReady] = useState(false);
  const [topologyId, setTopologyId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const timedOut = useLoadTimeout(!ready);
  const customerName = useCustomerName(scopeId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!scopeId) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const docs = await listLocalScenesForCustomer(scopeId);
        const pointer = await resolveDefaultScene(
          getConnectedGuardClient(),
          scopeId,
          (sceneId) => resolveTopologyIdFromLegacyScene(docs, sceneId),
        );
        if (!cancelled) {
          setTopologyId(pointer.topologyId || undefined);
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error && err.message ? err.message : "暂时无法读取默认场景，平台服务不可用或超时。");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeId]);

  const backToScenes = customerScopePath(scopeId);

  if (!ready && timedOut) {
    return <LoadingTimeout backTo={role === "tenant" ? backToScenes : routes.login} customerName={customerName} />;
  }

  if (!ready) {
    return (
      <div className="page" style={{ alignItems: "center", justifyContent: "center", color: "var(--ngx-color-muted)", background: "var(--ngx-color-bg)" }}>
        加载中
      </div>
    );
  }
  if (topologyId && !error) return <Navigate to={routes.twinRuntime(topologyId)} replace />;
  if (role === "customer" && !error) return <EmptyDefaultScene />;

  return (
    <EntryChrome crumbs={<b>默认场景</b>} brandTo={brandPath(role)}>
      <div className={`${styles.empty} ${styles.fill}`}>
        <div className={styles.card}>
          <h1>{error ? "无法打开默认场景" : "还没有指定默认场景"}</h1>
          <p>
            {error
              ? error
              : role === "tenant"
                ? "还没有为当前客户指定默认场景，或需要先选择一个客户。"
                : "还没有指定默认场景"}
          </p>
          {role === "tenant" ? (
            <div className={styles.actions}>
              <Link to={routes.selectCustomer} className={entryStyles.primary} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                返回选客户
              </Link>
              <Link to={backToScenes} className={entryStyles.ghost} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                {scopeId ? "返回场景管理" : "返回选客户"}
              </Link>
            </div>
          ) : (
            <Link to={routes.login} className={entryStyles.primary} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
              回到登录
            </Link>
          )}
        </div>
      </div>
    </EntryChrome>
  );
}
