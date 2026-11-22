
import { Button, Input, Segmented, Upload, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseHmiGlb } from "@idt/engine-adapter";
import type { ParsedHmiScene, SceneEntity } from "@idt/shared-types";
import { EngineViewport } from "../../engine/react/EngineViewport";
import { WidgetOverlay, hasSummaryCard } from "../scene-widgets/WidgetOverlay";
import { routes } from "../../constants/routes";
import { customerScopePath, shouldShowWidgetDraftMark, workbenchChrome } from "../../auth/access";
import { useAuthSession } from "../../auth/AuthSession";
import { LOCAL_DRAFT_NOTICE } from "@idt/data-adapter";
import { openSceneKey } from "../../services/scene/sceneService";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { importAssetFile, importPublicModel, resolveAssetUrl, readAssetBuffer } from "../../services/asset/assetService";
import { attachHmiSnapshot, publishScene } from "../../services/scene/sceneService";
import { useAppStore } from "../../stores/app.store";
import { useDeviceStore } from "../../stores/device.store";
import { useEditorStore } from "../../stores/editor.store";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";
import { downloadText } from "../../utils/download";
import { uniqueEntitiesFromParsed } from "../../utils/hmi-entities";
import { FindObjectPopover } from "./FindObjectPopover";
import { useNameplateCommands } from "../../hooks/useNameplateCommands";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard";
import { BindingPanel } from "./BindingPanel";
import { resolveSceneEntity } from "../../utils/scene-entity";
import { buildControlDrawerModel } from "../../utils/control-drawer";
import { isControlDrawerOpen, resolveSelectableNode } from "../../utils/selectable-node";
import { useTelemetryFeed } from "../../hooks/useTelemetryFeed";
import { useDemoTelemetry, useTelemetrySource } from "../../hooks/useTelemetrySource";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { buildDevicePlates } from "../../utils/device-plates";
import { getGuardStatus, getProviderKind } from "@idt/data-adapter";
import styles from "./EditorShell.module.css";

export function EditorShell() {
  const nav = useNavigate();
  const { role } = useAuthSession();
  const chrome = workbenchChrome(role);
  const document = useSceneStore((s) => s.document);
  const hmi = useSceneStore((s) => s.hmi);
  const setDocument = useSceneStore((s) => s.setDocument);
  const setHmi = useSceneStore((s) => s.setHmi);
  const persist = useSceneStore((s) => s.persist);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const past = useSceneStore((s) => s.past);
  const future = useSceneStore((s) => s.future);
  const dirty = useEditorStore((s) => s.dirty);
  useUnsavedChangesGuard(dirty);
  const persistence = useSceneStore((s) => s.persistence);
  const sceneWidgets = useSceneStore((s) => s.sceneWidgets);
  const setSceneWidgets = useSceneStore((s) => s.setSceneWidgets);
  const [telemetrySource, setTelemetrySource] = useTelemetrySource();
  const latest = useTelemetryStore((s) => s.latest);
  const telemetryHistory = useTelemetryStore((s) => s.history);
  const selectedNode = useSelectionStore((s) => s.nodeName);
  const selectedEntityId = useSelectionStore((s) => s.entityId);
  const select = useSelectionStore((s) => s.select);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [pinnedDrawer, setPinnedDrawer] = useState(false);
  const [editing, setEditing] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [focusWidgetId, setFocusWidgetId] = useState<string | null>(null);
  const devices = useDeviceStore((s) => s.devices);
  const refreshDevices = useDeviceStore((s) => s.refresh);
  const ready = useAppStore((s) => s.ready);

  const [modelUrl, setModelUrl] = useState<string>();
  const [loadState, setLoadState] = useState("未加载模型");

  useEffect(() => {
    if (ready) void refreshDevices();
  }, [ready, refreshDevices]);

  useEffect(() => {
    const id = document?.rootAssetId;
    if (!id) {
      setModelUrl(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getAsset } = await import("../../services/asset/assetService");
        const asset = await getAsset(id);
        if (!asset || cancelled) return;
        const url = await resolveAssetUrl(asset);
        if (!cancelled) setModelUrl(url);
        const buffer = await readAssetBuffer(id);
        const parsed = parseHmiGlb(buffer);
        if (!cancelled) setHmi(parsed);
      } catch (error) {
        if (!cancelled) message.error(error instanceof Error ? error.message : "模型读取失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [document?.rootAssetId, setHmi]);


  const applyParsedScene = useCallback(
    async (parsed: ParsedHmiScene, assetId: string, sceneName?: string) => {
      if (!document) return;
      const entities: SceneEntity[] = uniqueEntitiesFromParsed(parsed).map((item) => ({
        id: item.node,
        name: item.name,
        nodeName: item.node,
        assetId,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      }));
      const next = attachHmiSnapshot(
        {
          ...document,
          rootAssetId: assetId,
          scene: {
            ...document.scene,
            name: sceneName || parsed.name || document.scene.name,
          },
          entities,
        },
        parsed,
      );
      setDocument(next, "导入模型");
      setHmi(parsed);
    },
    [document, setDocument, setHmi],
  );

  const importGlb = async (file: File) => {
    try {
      setLoadState("正在解析 GLB…");
      const parsed = await parseHmiGlb(await file.arrayBuffer());
      const asset = await importAssetFile(file, { hmiName: parsed.name, bindables: parsed.bindables.length });
      await applyParsedScene(parsed, asset.id, parsed.name);
      let saved = false;
      try {
        await persist("导入后自动保存");
        saved = true;
      } catch (error) {
        message.warning(error instanceof Error ? `模型已导入，但自动保存失败：${error.message}` : "模型已导入，但自动保存失败，请再点一次保存");
      }
      const objectCount = uniqueEntitiesFromParsed(parsed).length;
      message.success(
        parsed.source === "hmi-extras"
          ? `已从模型读取 ${objectCount} 个对象${saved ? "，并已自动保存" : ""}`
          : `模型没有可用的画面文档${saved ? "，并已自动保存" : ""}`,
      );
      setLoadState(saved ? "模型已导入并保存" : "模型已导入");
    } catch (error) {
      setLoadState("加载失败");
      message.error(error instanceof Error ? error.message : "导入失败");
    }
    return false;
  };

  const importSample = async () => {
    try {
      setLoadState("正在加载示例模型…");
      const asset = await importPublicModel("/models/tianjiao.glb", "天骄科技园");
      const buffer = await readAssetBuffer(asset.id);
      const parsed = parseHmiGlb(buffer);
      await applyParsedScene(parsed, asset.id, parsed.name || "天骄科技园");
      let saved = false;
      try {
        await persist("导入后自动保存");
        saved = true;
      } catch (error) {
        message.warning(error instanceof Error ? `示例模型已导入，但自动保存失败：${error.message}` : "示例模型已导入，但自动保存失败，请再点一次保存");
      }
      message.success(`示例模型已导入，解析到 ${uniqueEntitiesFromParsed(parsed).length} 个对象${saved ? "，并已自动保存" : ""}`);
      setLoadState(saved ? "示例模型已导入并保存" : "示例模型已导入");
    } catch (error) {
      setLoadState("示例模型不可用");
      message.error(error instanceof Error ? error.message : "示例模型加载失败，请直接导入本地 GLB");
    }
  };


  const resolveNode = (raw: string | null) => resolveSelectableNode(hmi, document, raw);

  const onSelect = (nodeName: string | null) => {
    const node = resolveNode(nodeName);
    if (!node) {
      select(null, null);
      setPinnedDrawer(false);
      return;
    }
    const entity = resolveSceneEntity(document, node);
    select(entity?.id ?? node, entity?.nodeName ?? node);
  };

  const selectedEntity = useMemo(() => {
    if (!document) return undefined;
    return resolveSceneEntity(document, selectedNode) ?? document.entities.find((e) => e.id === useSelectionStore.getState().entityId);
  }, [document, selectedNode]);


  const deviceIds = useMemo(
    () => (document?.bindings ?? []).map((b) => b.deviceId).filter(Boolean),
    [document?.bindings],
  );
  useTelemetryFeed(telemetrySource === "live" ? deviceIds : []);
  useDemoTelemetry(document?.bindings ?? [], telemetrySource === "demo");

  const labels = buildDevicePlates({
    devices: hmi?.devices ?? [],
    bindings: document?.bindings ?? [],
    latest,
    source: telemetrySource,
  });
  const { stateByNode, busy, send } = useNameplateCommands(labels, document?.bindings ?? []);
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
  if (!document) return null;

  const objectCount = hmi ? uniqueEntitiesFromParsed(hmi).length : 0;
  const boundCount = document.bindings.filter((b) => b.deviceId).length;
  const guardStatus = getGuardStatus();
  const dataLabel = telemetrySource === "demo"
    ? "演示数据"
    : guardStatus.connected && getProviderKind() === "guard"
      ? "后端数据"
      : !guardStatus.connected && guardStatus.message
        ? "未连接平台"
        : "演示数据";

  return (
    <div className={styles.shell}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.back}
          onClick={() => nav(customerScopePath(document.platform?.customerId))}
        >
          返回场景管理
        </button>
        <span className={styles.brand}>3D-NGX</span>
        <span className={styles.draftTag}>{
          role !== "customer" && (
            !persistence.available
            || persistence.bindingsSource === "local-draft"
            || shouldShowWidgetDraftMark({
              role,
              showDraftMark: chrome.showWidgetDraftMark,
              widgetsSource: persistence.widgetsSource,
              widgetCount: sceneWidgets?.widgets.length ?? 0,
            })
          )
            ? LOCAL_DRAFT_NOTICE
            : document.platform?.publishState === "published"
              ? "已发布"
              : "草稿"
        }</span>
        <Input
          className={styles.name}
          value={document.scene.name}
          onChange={(e) =>
            setDocument({ ...document, scene: { ...document.scene, name: e.target.value } }, "重命名")
          }
        />
        <Button disabled={!past.length} onClick={undo}>撤销</Button>
        <Button disabled={!future.length} onClick={redo}>重做</Button>
        <FindObjectPopover hmi={hmi} devices={devices} onPick={onSelect} />
        {editing ? (
          <Button data-testid="exit-edit" onClick={() => { setEditing(false); setArranging(false); }}>退出编辑</Button>
        ) : (
          <Button type="primary" data-testid="enter-edit" onClick={() => setEditing(true)}>编辑</Button>
        )}
        {editing && chrome.showWidgetDrag ? (
          <Button
            data-testid="toggle-arrange"
            type={arranging ? "primary" : "default"}
            onClick={() => setArranging((open) => !open)}
          >
            {arranging ? "完成编排" : "编排"}
          </Button>
        ) : null}
        <span className={styles.grow} />
        <ThemeToggle />
        <span data-testid="telemetry-source">
          <Segmented
            size="small"
            value={telemetrySource}
            onChange={(v) => setTelemetrySource(v as typeof telemetrySource)}
            options={[
              { label: "后端测点", value: "live" },
              { label: "演示数据", value: "demo" },
            ]}
          />
        </span>
        <Upload accept=".glb,.gltf" showUploadList={false} beforeUpload={(f) => importGlb(f)}>
          <Button>导入模型</Button>
        </Upload>
        <Button onClick={() => void importSample()}>导入示例</Button>
        <Button
          type={dirty ? "primary" : "default"}
          onClick={() =>
            void persist("手动保存")
              .then(() => message.success("已保存到本地"))
              .catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"))
          }
        >
          保存
        </Button>
        <Button
          onClick={() => {
            downloadText(`${document.scene.name}.json`, JSON.stringify(document, null, 2));
          }}
        >
          导出 JSON
        </Button>
        <Button
          onClick={async () => {
            await persist("发布前保存");
            const published = await publishScene(document.scene.id);
            setDocument(published);
            nav(routes.twinRuntime(openSceneKey(published) || published.scene.id));
          }}
        >
          预览运行
        </Button>
      </div>
      <div className={`${styles.body} ${editing ? styles.bodyEditing : ""}`}>
        <div className={styles.viewport}>
          <EngineViewport
            mode="studio"
            modelUrl={modelUrl}
            gridEnabled={document.settings.gridEnabled}
            selectedNode={selectedNode}
            hoveredNode={hoveredNode}
            bindings={document.bindings}
            hmi={hmi}
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
            onSelect={onSelect}
            onLoaded={(names) => setLoadState(names.length ? `已加载 ${names.length} 个节点` : "模型无节点")}
            onError={(msg) => {
              setLoadState("加载失败");
              message.error(msg);
            }}
            onOverview={() => {
              const summary = hasSummaryCard(sceneWidgets?.widgets ?? []);
              if (summary) setFocusWidgetId(summary.id);
            }}
          >
            <WidgetOverlay
              layout={sceneWidgets}
              arranging={arranging && chrome.showWidgetDrag}
              readOnly={!editing || !chrome.showWidgetDrag}
              showDraftMark={chrome.showWidgetDraftMark}
              role={role}
              widgetsSource={persistence.widgetsSource}
              sceneTitle={document.scene.name}
              bindings={document.bindings}
              devices={devices}
              hmi={hmi}
              latest={latest}
              history={telemetryHistory}
              selectedNode={selectedNode}
              selectedEntityId={selectedEntityId}
              focusWidgetId={focusWidgetId}
              onConsumeFocus={() => setFocusWidgetId(null)}
              onChangeLayout={setSceneWidgets}
            />
          </EngineViewport>
        </div>
        {editing ? (
          <aside className={styles.props} data-testid="edit-binding-aside">
            <div className={styles.propsBody}>
              {selectedEntity ? (
                <BindingPanel entity={selectedEntity} hmi={hmi} devices={devices} embedded />
              ) : (
                <div className={styles.editEmpty} data-testid="edit-unselected">
                  <p>未选中设备</p>
                  <div>在画面上点要配置的对象后再绑定。</div>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
      <footer className={styles.status}>
        <span>{document.rootAssetId ? "已导入模型" : "还没有模型"}</span>
        <span>{loadState}</span>
        <span>可点选 {objectCount} 个对象</span>
        <span>已连接 {boundCount} 台设备</span>
        {dirty ? <span>未保存</span> : <span>已保存</span>}
        <span>{dataLabel}</span>
      </footer>
    </div>
  );
}


