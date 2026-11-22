import {
  LOCAL_DRAFT_NOTICE,
  getConnectedGuardClient,
  resolveSceneJumps,
  saveSceneJumps,
  type SceneJumpTarget,
} from "@idt/data-adapter";
import { Select } from "antd";
import { useEffect, useState } from "react";
import { useAuthSession } from "../../auth/AuthSession";
import { workbenchChrome } from "../../auth/access";
import { listCustomerScenes } from "../../services/scene/customer-scenes";
import { visibleSceneLabel } from "../../services/scene/scene-label";
import { useSceneStore } from "../../stores/scene.store";
import styles from "./BindingPanel.module.css";

export function SceneJumpSection({ objectId, objectLabel }: { objectId: string; objectLabel?: string }) {
  const { role } = useAuthSession();
  const chrome = workbenchChrome(role);
  const document = useSceneStore((s) => s.document);
  const customerId = document?.platform?.customerId;
  const fromTopologyId = document?.platform?.topologyId;
  const [options, setOptions] = useState<SceneJumpTarget[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState<"platform" | "local-draft">("local-draft");

  useEffect(() => {
    if (!customerId || !chrome.showJumpConfig) return;
    void listCustomerScenes(customerId).then((result) => {
      const rows = result.rows;
      setOptions(
        rows
          .filter((row) => row.topologyId !== fromTopologyId)
          .map((row) => ({
            topologyId: row.topologyId,
            label: visibleSceneLabel(row.name, row.rootNames, row.topologyId),
          })),
      );
    });
  }, [customerId, fromTopologyId, chrome.showJumpConfig]);

  useEffect(() => {
    if (!customerId || !fromTopologyId) {
      setSelected([]);
      return;
    }
    let cancelled = false;
    void resolveSceneJumps(getConnectedGuardClient(), customerId, fromTopologyId).then((result) => {
      if (cancelled) return;
      setSource(result.source);
      setSelected(result.links.find((link) => link.objectId === objectId)?.targets.map((item) => item.topologyId) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, fromTopologyId, objectId]);

  if (!chrome.showJumpConfig) return null;

  const apply = (ids: string[]) => {
    if (!customerId || !fromTopologyId) return;
    const targets = ids
      .map((id) => options.find((item) => item.topologyId === id) || { topologyId: id, label: visibleSceneLabel(undefined, undefined, id) })
      .filter((item) => item.topologyId);
    setSelected(ids);
    void resolveSceneJumps(getConnectedGuardClient(), customerId, fromTopologyId).then((current) => {
      const rest = current.links.filter((link) => link.objectId !== objectId);
      const links = targets.length ? [...rest, { objectId, objectLabel, targets }] : rest;
      return saveSceneJumps(getConnectedGuardClient(), customerId, fromTopologyId, links);
    }).then((result) => setSource(result.source));
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>进入场景</div>
      {!customerId || !fromTopologyId ? (
        <div className={styles.muted}>这条画面还没有挂到客户拓扑，不能配置跳转。</div>
      ) : (
        <>
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: "100%" }}
            placeholder="选择已有场景，多个时观看态会先选再进"
            value={selected}
            options={options.map((item) => ({ value: item.topologyId, label: item.label }))}
            onChange={(value) => apply(value)}
          />
          <div className={styles.muted}>选项来自该客户已有场景的分组节点或名称。{source === "local-draft" ? LOCAL_DRAFT_NOTICE : "已同步到平台"}。</div>
        </>
      )}
    </div>
  );
}
