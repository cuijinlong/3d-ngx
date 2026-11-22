
import {
  LOCAL_DRAFT_NOTICE,
  getConnectedGuardClient,
  listPlatformCustomers,
  resolveDefaultScene,
  saveDefaultScene,
} from "@idt/data-adapter";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { isUsableCustomerId, writeLastCustomerId } from "../../auth/customer-scope";
import { routes } from "../../constants/routes";
import { CreateSceneWizard } from "../../features/scene-editor/CreateSceneWizard";
import {
  defaultSceneBanner,
  emptySceneListMessage,
  listCustomerScenes,
  type CustomerSceneListResult,
  type CustomerSceneRow,
} from "../../services/scene/customer-scenes";
import { listLocalScenesForCustomer, openSceneKey, resolveTopologyIdFromLegacyScene } from "../../services/scene/sceneService";
import { visibleSceneLabel } from "../../services/scene/scene-label";
import { CustomerTrail } from "./CustomerTrail";
import { EntryChrome, entryStyles as styles } from "./EntryChrome";
import { LoadingTimeout, useLoadTimeout } from "./LoadingTimeout";

export function CustomerScenesPage() {
  const { customerId = "" } = useParams();
  const nav = useNavigate();
  const [customerName, setCustomerName] = useState("");
  const [unknownCustomer, setUnknownCustomer] = useState(false);
  const [rows, setRows] = useState<CustomerSceneRow[]>([]);
  const [listResult, setListResult] = useState<CustomerSceneListResult | null>(null);
  const [defaultId, setDefaultId] = useState<string | undefined>();
  const [defaultSource, setDefaultSource] = useState<"platform" | "local-draft">("local-draft");
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const usable = isUsableCustomerId(customerId);
  const timedOut = useLoadTimeout(usable && loading);

  const refresh = async () => {
    if (!isUsableCustomerId(customerId)) return;
    setLoading(true);
    try {
      const list = await listCustomerScenes(customerId);
      setRows(list.rows);
      setListResult(list);
      setError(null);
    } catch (err) {
      setRows([]);
      setListResult(null);
      setError(err instanceof Error && err.message ? err.message : "无法读取该客户的场景");
    }
    const docs = await listLocalScenesForCustomer(customerId);
    const pointer = await resolveDefaultScene(
      getConnectedGuardClient(),
      customerId,
      (sceneId) => resolveTopologyIdFromLegacyScene(docs, sceneId),
    );
    setDefaultId(pointer.topologyId || undefined);
    setDefaultSource(pointer.source);
    setLoading(false);
  };

  useEffect(() => {
    if (!isUsableCustomerId(customerId)) return;
    void refresh();
    const client = getConnectedGuardClient();
    if (!client) return;
    void listPlatformCustomers(client)
      .then((list) => {
        const hit = list.find((row) => row.id === customerId);
        if (hit) {
          setCustomerName(hit.name);
          setUnknownCustomer(false);
          writeLastCustomerId(customerId);
        } else {
          setCustomerName("");
          setUnknownCustomer(true);
        }
      })
      .catch(() => undefined);
  }, [customerId]);

  const setDefault = async (topologyId: string) => {
    try {
      const pointer = await saveDefaultScene(getConnectedGuardClient(), customerId, topologyId);
      setDefaultId(pointer.topologyId || topologyId);
      setDefaultSource(pointer.source);
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "无法指定默认场景");
    }
  };

  const visibleRows = useMemo(() => {
    if (!defaultId || rows.some((row) => row.topologyId === defaultId)) return rows;
    const ghost: CustomerSceneRow = {
      topologyId: defaultId,
      name: visibleSceneLabel(undefined, undefined, defaultId),
      hasLocalDraft: defaultSource === "local-draft",
      fromPlatform: defaultSource === "platform",
      mark: {
        kind: defaultSource === "local-draft" ? "local-draft" : "draft",
        label: defaultSource === "local-draft" ? LOCAL_DRAFT_NOTICE : "草稿",
      },
    };
    return [...rows, ghost];
  }, [rows, defaultId, defaultSource]);

  if (!usable) {
    return <Navigate to={routes.selectCustomer} replace />;
  }

  if (timedOut && loading) {
    return <LoadingTimeout backTo={routes.selectCustomer} customerName={customerName} />;
  }

  const emptyText = unknownCustomer
    ? "名单里没有这个客户，或还没有挂靠到你可见的客户。"
    : emptySceneListMessage(listResult ?? { rows, stats: { customerTotal: 0, sceneTotal: 0, twoDTotal: 0, otherSceneTotal: 0 } });
  const defaultRow = visibleRows.find((row) => row.topologyId === defaultId);
  const defaultNote = defaultSceneBanner({
    defaultId,
    defaultName: defaultId ? visibleSceneLabel(defaultRow?.name, defaultRow?.rootNames, defaultId) : undefined,
  });

  return (
    <EntryChrome
      crumbs={<CustomerTrail customerName={customerName} current="场景管理" />}
      brandTo={routes.selectCustomer}
    >
      <div className={styles.main}>
        <div className={styles.pageHead}>
          <div>
            <h1>场景管理</h1>
            <p className={styles.sub}>
              为该客户指定默认场景，并进入设计或预览。客户打开后只会进入默认场景，看不到本页。这里只列出三维场景，普通设备图不会出现。
            </p>
            <div className={styles.draft}>{defaultNote}</div>
          </div>
          <button type="button" className={styles.primary} onClick={() => setWizardOpen(true)}>
            新建场景
          </button>
        </div>
        {error ? <div className={styles.error}>{error}</div> : null}
        {listResult?.sourceError && !error ? <div className={styles.error}>{listResult.sourceError}</div> : null}
        <div className={styles.grid}>
          {visibleRows.map((row) => {
            const isDefault = row.topologyId === defaultId;
            const localDraft = row.mark.kind === "local-draft";
            return (
              <article key={row.topologyId} className={styles.tile}>
                <div className={styles.thumb}>暂无预览</div>
                <div className={styles.titleRow}>
                  <h2 className={styles.tileTitle}>{visibleSceneLabel(row.name, row.rootNames, row.topologyId)}</h2>
                  {isDefault ? <span className={styles.tag}>默认</span> : null}
                  {localDraft ? <span className={styles.tag}>{row.mark.label}</span> : null}
                </div>
                <div className={styles.tileMeta}>
                  <span>场站 {row.siteName || "—"}</span>
                  <span>分组 {row.rootNames?.filter((item) => item && item !== row.topologyId).join("、") || "—"}</span>
                  <span>模板 {row.packVersion || "—"}</span>
                </div>
                <div className={styles.tileActions}>
                  <button type="button" className={styles.link} onClick={() => nav(routes.twinRuntime(row.topologyId))}>
                    打开
                  </button>
                  <button type="button" className={styles.link} onClick={() => nav(routes.studioEditor(row.topologyId))}>
                    进入设计
                  </button>
                  {!isDefault ? (
                    <button type="button" className={styles.link} onClick={() => void setDefault(row.topologyId)}>
                      设为默认
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {visibleRows.length === 0 && !loading ? <div className={styles.emptyPane}>{emptyText}</div> : null}
        </div>
        <CreateSceneWizard
          open={wizardOpen}
          customerId={customerId}
          onCancel={() => setWizardOpen(false)}
          onCreated={(doc) => {
            setWizardOpen(false);
            void refresh();
            const id = openSceneKey(doc);
            if (id) nav(routes.studioEditor(id));
          }}
        />
      </div>
    </EntryChrome>
  );
}
