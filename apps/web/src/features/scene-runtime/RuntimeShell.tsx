
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseHmiGlb } from "@idt/engine-adapter";
import { decideObjectClick, getConnectedGuardClient, getGuardStatus, getProviderKind, resolveSceneJumps, type SceneJumpLink, type SceneJumpTarget } from "@idt/data-adapter";
import { EngineViewport } from "../../engine/react/EngineViewport";
import { WidgetOverlay, hasSummaryCard } from "../scene-widgets/WidgetOverlay";
import { EngineManager } from "../../engine/core/EngineManager";
import { getAsset, readAssetBuffer, resolveAssetUrl } from "../../services/asset/assetService";
import { useAppStore } from "../../stores/app.store";
import { useDeviceStore } from "../../stores/device.store";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";
import { useTelemetryFeed } from "../../hooks/useTelemetryFeed";
import { useNameplateCommands } from "../../hooks/useNameplateCommands";
import { resolveSceneEntity } from "../../utils/scene-entity";
import { buildControlDrawerModel } from "../../utils/control-drawer";
import { isControlDrawerOpen, isControlOrScreenPart, resolveSelectableNode } from "../../utils/selectable-node";
import { visibleSceneLabel } from "../../services/scene/scene-label";
import { routes } from "../../constants/routes";
import { customerScopePath } from "../../auth/access";
import { buildDevicePlates } from "../../utils/device-plates";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { useDemoTelemetry, useTelemetrySource } from "../../hooks/useTelemetrySource";
import { Button, Segmented, Space } from "antd";
import { useAuthSession } from "../../auth/AuthSession";
import { workbenchChrome } from "../../auth/access";
import { ThemeToggle } from "../../theme/ThemeToggle";
import {
  pushSceneNav,
  readSceneNav,
  returnToSceneNav,
  startSceneNav,
  takeSceneNavRestore,
  writeSceneNav,
  writeSceneNavRestore,
} from "./scene-navigation";
import styles from "./RuntimeShell.module.css";

export function RuntimeShell() {
  const nav = useNavigate();
  const { role, logout, customerId: sessionCustomerId } = useAuthSession();
  const chrome = workbenchChrome(role);
  const document = useSceneStore((s) => s.document);
  const sceneWidgets = useSceneStore((s) => s.sceneWidgets);
  const persistence = useSceneStore((s) => s.persistence);
  const hmi = useSceneStore((s) => s.hmi);
  const setHmi = useSceneStore((s) => s.setHmi);
  const devices = useDeviceStore((s) => s.devices);
  const refresh = useDeviceStore((s) => s.refresh);
  const ready = useAppStore((s) => s.ready);
  const selectedNode = useSelectionStore((s) => s.nodeName);
  const selectedEntityId = useSelectionStore((s) => s.entityId);
  const select = useSelectionStore((s) => s.select);
  const [modelUrl, setModelUrl] = useState<string>();
  const [fullscreen, setFullscreen] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [pinnedDrawer, setPinnedDrawer] = useState(false);
  const [choices, setChoices] = useState<SceneJumpTarget[] | null>(null);
  const [focusWidgetId, setFocusWidgetId] = useState<string | null>(null);
  const [jumpLinks, setJumpLinks] = useState<SceneJumpLink[]>([]);

  const customerId = document?.platform?.customerId || sessionCustomerId;
  const topologyId = document?.platform?.topologyId;
  const sceneName = visibleSceneLabel(document?.platform?.topologyName || document?.scene.name, document?.platform?.rootNames, document?.platform?.topologyId);

  useEffect(() => { if (ready) void refresh(); }, [ready, refresh]);

  useEffect(() => {
    const id = document?.rootAssetId;
    if (!id) { setModelUrl(undefined); return; }
    let cancelled = false;
    (async () => {
      const asset = await getAsset(id);
      if (!asset || cancelled) return;
      setModelUrl(await resolveAssetUrl(asset));
      const parsed = parseHmiGlb(await readAssetBuffer(id));
      if (!cancelled) setHmi(parsed);
    })();
    return () => { cancelled = true; };
  }, [document?.rootAssetId, setHmi]);

  useEffect(() => {
    if (!customerId || !topologyId) return;
    let state = readSceneNav(customerId);
    if (!state || !state.path.some((item) => item.topologyId === topologyId)) {
      state = startSceneNav(customerId, { topologyId, name: sceneName });
    } else {
      state = {
        customerId,
        path: state.path.map((item) => (item.topologyId === topologyId ? { ...item, name: sceneName } : item)),
      };
    }
    writeSceneNav(state);
  }, [customerId, topologyId, sceneName]);

  useEffect(() => {
    if (!customerId || !topologyId) {
      setJumpLinks([]);
      return;
    }
    let cancelled = false;
    void resolveSceneJumps(getConnectedGuardClient(), customerId, topologyId).then((result) => {
      if (!cancelled) setJumpLinks(result.links);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, topologyId]);

  useEffect(() => {
    if (!topologyId || !document) return;
    const restore = takeSceneNavRestore(topologyId);
    if (!restore) return;
    if (restore.selectedNode) {
      const entity = resolveSceneEntity(document, restore.selectedNode);
      select(entity?.id ?? restore.selectedNode, entity?.nodeName ?? restore.selectedNode);
    }
    if (!restore.view) return;
    let attempts = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const ok = EngineManager.instance.restoreCameraView(restore.view!);
      attempts += 1;
      if (!ok && attempts < 24) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }, [topologyId, document, modelUrl, select]);

  const [telemetrySource, setTelemetrySource] = useTelemetrySource();
  const feedSource = chrome.showDemoTelemetryToggle ? telemetrySource : "live";
  const latest = useTelemetryStore((s) => s.latest);
  const telemetryHistory = useTelemetryStore((s) => s.history);
  const deviceIds = useMemo(() => document?.bindings.map((b) => b.deviceId) ?? [], [document]);
  useTelemetryFeed(feedSource === "live" ? deviceIds : []);
  useDemoTelemetry(document?.bindings ?? [], feedSource === "demo");
  const labels = buildDevicePlates({
    devices: hmi?.devices ?? [],
    bindings: document?.bindings ?? [],
    latest,
    source: feedSource,
  });
  const { stateByNode, busy, send } = useNameplateCommands(labels, document?.bindings ?? []);
  const resolveNode = (raw: string | null) => resolveSelectableNode(hmi, document, raw);
  const drawerOpen = isControlDrawerOpen(selectedNode, pinnedDrawer);
  const drawerModel = useMemo(
    () =>
      buildControlDrawerModel({
        hmi,
        selectedNode,
        plates: labels,
        bindings: document?.bindings ?? [],
        latest,
      }),
    [hmi, selectedNode, labels, document?.bindings, latest],
  );

  const navState = customerId ? readSceneNav(customerId) : null;
  const crumbs = navState?.path?.length ? navState.path : topologyId ? [{ topologyId, name: sceneName }] : [];

  if (!document) return null;

  const guardStatus = getGuardStatus();
  const dataLabel = feedSource === "demo"
    ? "演示数据"
    : guardStatus.connected && getProviderKind() === "guard"
      ? "后端数据"
      : !guardStatus.connected && guardStatus.message
        ? "未连接平台"
        : "演示数据";

  const enterTopology = (nextId: string, nextName: string) => {
    if (!customerId || !topologyId) {
      nav(routes.twinRuntime(nextId));
      return;
    }
    const current = readSceneNav(customerId) ?? startSceneNav(customerId, { topologyId, name: sceneName });
    const next = pushSceneNav(
      current,
      { view: EngineManager.instance.captureCameraView() ?? undefined, selectedNode },
      { topologyId: nextId, name: nextName },
    );
    writeSceneNav(next);
    setChoices(null);
    nav(routes.twinRuntime(nextId));
  };

  const goToCrumb = (id: string) => {
    if (!customerId || id === topologyId) return;
    const current = readSceneNav(customerId);
    if (!current) {
      nav(routes.twinRuntime(id));
      return;
    }
    const result = returnToSceneNav(current, id);
    if (!result) return;
    writeSceneNav(result.state);
    if (result.restore) writeSceneNavRestore(result.restore);
    nav(routes.twinRuntime(id));
  };

  return (
    <div className={styles.shell}>
      <div className={styles.bar}>
        <div className={styles.crumbs}>
          {crumbs.map((item, index) => (
            <span key={item.topologyId}>
              {index > 0 ? <span className={styles.sep}>/</span> : null}
              {index === crumbs.length - 1 ? (
                <b>{item.name}</b>
              ) : (
                <button type="button" className={styles.crumbBtn} onClick={() => goToCrumb(item.topologyId)}>
                  {item.name}
                </button>
              )}
            </span>
          ))}
        </div>
        {chrome.showDemoTelemetryToggle ? <span className="idt-demo-tag">{dataLabel}</span> : null}
        <span className={styles.grow} />
        {chrome.showDemoTelemetryToggle ? (
          <Segmented
            size="small"
            value={telemetrySource}
            onChange={(v) => setTelemetrySource(v as typeof telemetrySource)}
            options={[
              { label: "后端测点", value: "live" },
              { label: "演示数据", value: "demo" },
            ]}
          />
        ) : null}
        <ThemeToggle />
        <Space>
          {chrome.showReturnToStudio ? (
            <Button onClick={() => nav(customerScopePath(customerId))}>返回场景管理</Button>
          ) : null}
          <Button onClick={() => setFullscreen((v) => !v)}>{fullscreen ? "退出全屏布局" : "全屏展示"}</Button>
          <Button onClick={() => void window.document.documentElement.requestFullscreen?.()}>浏览器全屏</Button>
          {chrome.showLogout ? (
            <Button onClick={() => void logout().then(() => nav(routes.login, { replace: true }))}>退出</Button>
          ) : null}
        </Space>
      </div>
      <div className={`${styles.body} ${fullscreen ? styles.full : ""}`}>
        <div className={styles.view}>
          <EngineViewport
            mode="runtime"
            modelUrl={modelUrl}
            gridEnabled={false}
            selectedNode={selectedNode}
            hoveredNode={hoveredNode}
            bindings={document.bindings}
            hmi={hmi}
            emptyText="该场景还没有导入模型"
            labels={labels}
            dataLabel={dataLabel}
            nameplateCommands={stateByNode}
            nameplateBusy={busy}
            drawerOpen={drawerOpen}
            drawerModel={drawerModel}
            resolveNode={resolveNode}
            onHover={setHoveredNode}
            onToggleDrawer={() => {
              if (selectedNode) return;
              setPinnedDrawer((open) => !open);
            }}
            onNameplateStart={(node) => void send(node, "start")}
            onNameplateStop={(node) => void send(node, "stop")}
            onSelect={(name) => {
              setChoices(null);
              const node = resolveNode(name);
              const isPart = Boolean(name && hmi?.devices.some((device) => isControlOrScreenPart(name, device.node)));
              const links = jumpLinks;
              const decision = decideObjectClick({
                rawNode: name,
                resolvedNode: node,
                isControlOrScreen: isPart,
                links,
              });
              if (decision.action === "enter") {
                const label = visibleSceneLabel(links.flatMap((link) => link.targets).find((item) => item.topologyId === decision.topologyId)?.label, undefined, decision.topologyId);
                enterTopology(decision.topologyId, label);
                return;
              }
              if (decision.action === "choose") {
                const entity = resolveSceneEntity(document, decision.node);
                select(entity?.id ?? decision.node, entity?.nodeName ?? decision.node);
                setChoices(decision.targets);
                return;
              }
              if (!decision.node) {
                select(null, null);
                setPinnedDrawer(false);
                return;
              }
              const entity = resolveSceneEntity(document, decision.node);
              select(entity?.id ?? decision.node, entity?.nodeName ?? decision.node);
            }}
            onOverview={() => {
              const summary = hasSummaryCard(sceneWidgets?.widgets ?? []);
              if (summary) setFocusWidgetId(summary.id);
            }}
          >
            <WidgetOverlay
              layout={sceneWidgets}
              readOnly
              showDraftMark={chrome.showWidgetDraftMark}
              role={role}
              widgetsSource={persistence.widgetsSource}
              sceneTitle={sceneName}
              bindings={document.bindings}
              devices={devices}
              hmi={hmi}
              latest={latest}
              history={telemetryHistory}
              selectedNode={selectedNode}
              selectedEntityId={selectedEntityId}
              focusWidgetId={focusWidgetId}
              onConsumeFocus={() => setFocusWidgetId(null)}
            />
          </EngineViewport>
          {choices && choices.length > 1 ? (
            <div className={styles.chooser} role="dialog" aria-label="选择要进入的场景">
              <div className={styles.chooserTitle}>选择要进入的场景</div>
              {choices.map((item) => (
                <button
                  type="button"
                  key={item.topologyId}
                  className={styles.chooserItem}
                  onClick={() => enterTopology(item.topologyId, visibleSceneLabel(item.label, undefined, item.topologyId))}
                >
                  {visibleSceneLabel(item.label, undefined, item.topologyId)}
                </button>
              ))}
              <button type="button" className={styles.chooserCancel} onClick={() => setChoices(null)}>
                取消
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

