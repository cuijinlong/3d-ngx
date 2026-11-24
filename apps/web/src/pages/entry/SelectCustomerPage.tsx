
import { getConnectedGuardClient, listPlatformCustomers, resolveDefaultScene, type PlatformCustomer } from "@idt/data-adapter";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isUsableCustomerId, writeLastCustomerId } from "../../auth/customer-scope";
import { routes } from "../../constants/routes";
import { customerCardHints, listCustomerScenes } from "../../services/scene/customer-scenes";
import { listLocalScenesForCustomer, resolveTopologyIdFromLegacyScene } from "../../services/scene/sceneService";
import { visibleSceneLabel } from "../../services/scene/scene-label";
import { EntryChrome, entryStyles as styles } from "./EntryChrome";
import { LoadingTimeout, useLoadTimeout } from "./LoadingTimeout";

interface CustomerCard extends PlatformCustomer {
  defaultHint: string;
  countHint: string;
}

export function SelectCustomerPage() {
  const nav = useNavigate();
  const [rows, setRows] = useState<CustomerCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timedOut = useLoadTimeout(loading);

  useEffect(() => {
    const client = getConnectedGuardClient();
    if (!client) {
      setError("尚未连接平台，请重新登录");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const list = (await listPlatformCustomers(client)).filter((row) => isUsableCustomerId(row.id));
        if (cancelled) return;
        setRows(list.map((row) => ({ ...row, ...customerCardHints({ count: 0 }) })));
        setError(null);
        const hints = await Promise.all(list.map((row) => loadCardHints(row.id)));
        if (cancelled) return;
        setRows(list.map((row, index) => ({ ...row, ...hints[index]! })));
      } catch (err: unknown) {
        if (cancelled) return;
        setRows([]);
        setError(err instanceof Error && err.message ? err.message : "无法读取平台客户列表");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * 从模板库「用它建场景」进来时会带 templateId。
   * 这里只负责把它透传到客户的场景页 —— 选客户仍然是必须的一步，
   * 不因为带了模板就跳过（模板是租户级的，场景必须落在某个客户下）。
   */
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get("templateId") || undefined;

  const openCustomer = (id: string) => {
    writeLastCustomerId(id);
    const base = routes.customerScenes(id);
    nav(templateId ? `${base}?templateId=${encodeURIComponent(templateId)}` : base);
  };

  if (timedOut && loading) {
    return <LoadingTimeout backTo={routes.login} />;
  }

  return (
    <EntryChrome crumbs={<b>选择客户</b>} brandTo={routes.selectCustomer}>
      <div className={styles.main}>
        <h1>选择客户</h1>
        <p className={styles.sub}>登录后先选择要管理的客户，再进入该客户的场景管理。名单来自平台已有客户，不在这里新建客户。</p>
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.grid}>
          {rows.map((row) => (
            <article key={row.id} className={`${styles.tile} ${styles.accent}`}>
              <div className={styles.kicker}>客户</div>
              <h2 className={styles.tileTitle}>{row.name}</h2>
              <div className={styles.tileMeta}>
                <span>{row.defaultHint}</span>
                <span>{row.countHint}</span>
              </div>
              <div className={styles.tileActions}>
                <button type="button" className={styles.link} onClick={() => openCustomer(row.id)}>
                  场景管理
                </button>
              </div>
            </article>
          ))}
          {!loading && rows.length === 0 ? (
            <div className={styles.emptyPane}>{error ? "暂时没有可展示的客户。" : "还没有可管理的客户"}</div>
          ) : null}
        </div>
      </div>
    </EntryChrome>
  );
}

async function loadCardHints(customerId: string): Promise<{ defaultHint: string; countHint: string }> {
  try {
    const list = await listCustomerScenes(customerId);
    const docs = await listLocalScenesForCustomer(customerId);
    const pointer = await resolveDefaultScene(
      getConnectedGuardClient(),
      customerId,
      (sceneId) => resolveTopologyIdFromLegacyScene(docs, sceneId),
    );
    const defaultRow = pointer.topologyId ? list.rows.find((row) => row.topologyId === pointer.topologyId) : undefined;
    const defaultName = pointer.topologyId
      ? visibleSceneLabel(defaultRow?.name, defaultRow?.rootNames, pointer.topologyId)
      : undefined;
    return customerCardHints({ count: list.rows.length, defaultName: pointer.topologyId ? defaultName : undefined });
  } catch {
    return customerCardHints({ count: 0 });
  }
}
