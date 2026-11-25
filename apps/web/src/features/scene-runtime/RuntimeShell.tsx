
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { parseHmiGlb } from "@idt/engine-adapter";
import { decideObjectClick, getConnectedGuardClient, getGuardStatus, getProviderKind, resolveSceneJumps, type SceneJumpLink, type SceneJumpTarget } from "@idt/data-adapter";
import { EngineViewport } from "../../engine/react/EngineViewport";
import { WidgetOverlay, hasSummaryCard } from "../scene-widgets/WidgetOverlay";
import { screenHasAnyTelemetry } from "../scene-widgets/widget-values";
import { EngineManager } from "../../engine/core/EngineManager";
import { getAsset, readAssetBuffer, resolveAssetUrl } from "../../services/asset/assetService";
import { useAppStore } from "../../stores/app.store";
import { useDeviceStore } from "../../stores/device.store";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";
import { useTelemetryFeed } from "../../hooks/useTelemetryFeed";
import { useSceneFeedDeviceIds } from "../../hooks/useSceneFeedDeviceIds";
import { useStylePackRenderRules } from "../../hooks/useStylePackRenderRules";
import { useTelemetryStore } from "../../stores/telemetry.store";
import { resolveSceneEntity } from "../../utils/scene-entity";
import { isControlDrawerOpen, isControlOrScreenPart, resolveSelectableNode } from "../../utils/selectable-node";
import { visibleSceneLabel } from "../../services/scene/scene-label";
import { routes } from "../../constants/routes";
import { customerScopePath } from "../../auth/access";
import { useAuthSession } from "../../auth/AuthSession";
import { HudSkinProvider } from "../../theme/HudSkin";
import { sceneSurfaceChrome } from "./runtime-surface";
import { RuntimeChrome } from "./RuntimeChrome";
import { useWeatherPlace } from "./useWeatherPlace";
import { ViewportFrame } from "./ViewportFrame";
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
  const surface = sceneSurfaceChrome("runtime", role);
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
  const [pinnedDrawer, setPinnedDrawer] = useState(false);
  const [choices, setChoices] = useState<SceneJumpTarget[] | null>(null);
  const [focusWidgetId, setFocusWidgetId] = useState<string | null>(null);
  const [jumpLinks, setJumpLinks] = useState<SceneJumpLink[]>([]);

  const customerId = document?.platform?.customerId || sessionCustomerId;
  /*
   * ★ 场景 id 以 **URL 为准**，不是 document（2026-11-23 实测修正）。
   *
   * <h3>为什么</h3>
   *
   * <p>场景文档优先从 IndexedDB 读（本地缓存）。旧缓存里的
   * `platform.topologyId` 可能是 null —— 因为早期版本没写这个字段。
   *
   * <p>后果是连锁的：`topologyId` 为 null →
   * 「同组场景导航」不工作、「风格套装规则」查不到（回落到默认值）。
   * 表现为「套装配了但没生效」，而代码链路全是对的。
   *
   * <p>URL 的 `:sceneId` 才是"我现在打开的是哪个场景"的权威来源 ——
   * 它是用户点进来的那个链接，不可能和缓存不一致。
   */
  const routeParams = useParams<{ sceneId?: string }>();
  const topologyId = routeParams.sceneId ?? document?.platform?.topologyId;
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

  /*
   * 订阅范围由 `useSceneFeedDeviceIds` 统一计算（2026-11-23）。
   *
   * <p>这段逻辑原来在本文件里内联，编辑器另写了一份而漏了两路来源 ——
   * 于是「设计时看到的」和「打开时看到的」不一致。
   * 现在两边共用同一个实现，改一处两边都变。
   */
  const {
    deviceIds,
    scopeDevices,
    setScopeDevices,
  } = useSceneFeedDeviceIds(document?.bindings, sceneWidgets);

  /*
   * ★ 只订阅实时数据（2026-11-23 客户要求）。
   *
   * <p>原先顶栏有「后端测点 / 演示数据」开关，演示那一路由 `useDemoTelemetry`
   * 在浏览器里造数。客户明确要求去掉：大屏显示什么，就必须是设备真报上来的。
   *
   * <p>去掉的不只是一个按钮 —— 演示模式还挂着 `useDemoTelemetry` 的定时器，
   * 它会持续往 store 里写假值。只要不删这行调用，即使没有开关，
   * localStorage 里残留的 `demo` 也会让大屏继续显示造的数。
   */
  useTelemetryFeed(deviceIds);

  /*
   * 风格套装的渲染规则（2026-11-23）。
   *
   * <p>「管三态」「昼夜联动」这些描述此前没有任何实现 —— 选了套装
   * 只是记了个标签。这个 hook 把平台返回的 `render` 规则灌进引擎：
   * 管道流速、停流透明度、阀门染色、数据过期淡出。
   *
   * <p>取不到规则时回落到默认值，3D 照常渲染 —— 一个"选不到套装"
   * 不该让整屏变白。
   */
  useStylePackRenderRules(
    document?.platform?.stylePack ?? document?.settings?.stylePack,
    topologyId,
  );

  /*
   * 「没有数据」提示（2026-11-23）。
   *
   * <p>网关还没上报时，大屏上只剩一屏「暂无数据」的卡片。用户看到的是
   * 「这个页面怎么这么空/这么简单」—— **真实原因是没数据，不是设计缺内容**。
   * 不把这两件事分开说，就会去改设计而白费功夫（我这次就先跑了这一趟）。
   *
   * <p>延迟 10 秒再弹：刚打开页面遥测本来就在路上，立刻提示是误报。
   */
  const latest = useTelemetryStore((state) => state.latest);
  const hasTelemetry = useMemo(
    () => screenHasAnyTelemetry(sceneWidgets, latest),
    [sceneWidgets, latest],
  );
  const [showNoDataHint, setShowNoDataHint] = useState(false);
  useEffect(() => {
    /* 来数就收起；只剩实时一路，没有「演示必然有数」这个分支了。 */
    if (hasTelemetry) {
      setShowNoDataHint(false);
      return;
    }
    /*
     * 等 45 秒再弹（2026-11-23 从 25 秒再放宽）。
     *
     * <p>实测（同一场景、14 台设备）：25 秒时提示已经弹出，而卡片上
     * 「9 台机组之和 202.5 kW」是有值的 —— **提示和数据同时存在**，
     * 自相矛盾。50 秒时提示自动收起（说明订阅确实在 25~50 秒之间完成）。
     *
     * <p>这类误报的代价比不提示高得多：客户看到「还没有收到设备数据」，
     * 第一反应是去查网关/配置，而实际上只是订阅还在路上。
     *
     * <p>45 秒 = 实测首轮完成时间 + 余量。真没数据的场景多等 20 秒不影响判断。
     */
    const timer = setTimeout(() => setShowNoDataHint(true), 45_000);
    return () => clearTimeout(timer);
  }, [hasTelemetry]);
  const resolveNode = (raw: string | null) => resolveSelectableNode(hmi, document, raw);
  const drawerOpen = isControlDrawerOpen(selectedNode, pinnedDrawer);

  const navState = customerId ? readSceneNav(customerId) : null;
  const crumbs = navState?.path?.length ? navState.path : topologyId ? [{ topologyId, name: sceneName }] : [];

  if (!document) return null;

  const guardStatus = getGuardStatus();
  /*
   * 数据口径标签（2026-11-23）：正常时**不挂任何标签**。
   *
   * <p>只剩一种数据来源了（实时），再标「实时数据」是废话；
   * 而「未连接平台」必须留着 —— 没有它，大屏空白时无法区分
   * 「配置好了没数据」和「根本没连上平台」，排查会走错方向。
   */
  const platformConnected = guardStatus.connected && getProviderKind() === "guard";
  const dataLabel = platformConnected ? "" : "未连接平台";

  /*
   * 天气行政区划（2026-11-24 客户要求）：场站 address → 组织 address → 场景 weatherSite。
   *
   * <p>放在 `if (!document) return null` **之前** —— React 的 hooks 不能在
   * 条件返回后面调，否则从「没文档」变成「有文档」时 hook 数量变了，直接报错。
   * 入参用可选链，document 为空时 hook 内部得到全 null，不发请求。
   */
  const weatherPlace = useWeatherPlace({
    siteId: document?.platform?.siteId ?? null,
    customerId: customerId ?? null,
    scenePlace: document?.platform?.weatherSite ?? null,
  });

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

  const crumbNodes = (
    <>
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
    </>
  );

  return (
    <HudSkinProvider enabled>
      <div className={styles.shell} data-ngx-hud="on" data-testid="runtime-shell">
        <RuntimeChrome
          crumbs={crumbNodes}
          dataLabel={dataLabel}
          showDataLabel={Boolean(dataLabel)}
          weatherPlace={weatherPlace.place}
          weatherPlaceSource={weatherPlace.source}
          latest={latest}
          showReturnToStudio={surface.showReturnToStudio}
          onReturnToStudio={() => nav(customerScopePath(customerId))}
          showLogout={surface.showLogout}
          onLogout={() => void logout().then(() => nav(routes.login, { replace: true }))}
          showThemeToggle={surface.showThemeToggle}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((value) => !value)}
          /*
           * 视角复位（2026-11-23）：按模板布局，按钮从视口右下角移到顶栏
           * —— 右下角是「加载率对比」卡的位置，按钮会压住它。
           * 同时做两件事：相机回到初始机位、滚动到「运行汇总」卡。
           */
          onOverview={() => {
            EngineManager.instance.refitCamera();
            const summary = hasSummaryCard(sceneWidgets?.widgets ?? []);
            if (summary) setFocusWidgetId(summary.id);
          }}
        />
      <div
        className={`${styles.body} ${fullscreen ? styles.full : ""}`}
        /* 诊断用：订阅名单 / 范围设备数。排查「大屏显示未知」时直接读这里。 */
        data-subscribed={deviceIds.length}
        data-scope-devices={scopeDevices.length}
      >
        {showNoDataHint ? (
          <div
            className={styles.noDataHint}
            data-testid="no-data-hint"
            /*
             * 带上判断结果：排查「明明有数却弹提示」时不用再猜。
             * 这里踩过一次 —— 逐台键没被算进判空，提示在 9 台都有状态时照弹。
             */
            data-has-telemetry={String(hasTelemetry)}
            role="status"
          >
            <span>
              还没有收到设备数据（网关未上报）。画面上的卡片位是配置好的，
              缺的是数据 —— 不是页面缺内容。
            </span>
          </div>
        ) : null}
        <div className={styles.view}>
          <EngineViewport
            mode="runtime"
            modelUrl={modelUrl}
            gridEnabled={false}
            selectedNode={selectedNode}
            bindings={document.bindings}
            hmi={hmi}
            emptyText="还没有模型"
            sceneName={sceneName}
            dataLabel={dataLabel}
            dataSource="live"
            drawerOpen={drawerOpen}
            resolveNode={resolveNode}
            onToggleDrawer={() => {
              if (selectedNode) return;
              setPinnedDrawer((open) => !open);
            }}
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
          >
            <ViewportFrame variant="hud" />
            <WidgetOverlay
              layout={sceneWidgets}
              onScopeDevicesChange={setScopeDevices}
              surface="runtime"
              readOnly
              showDraftMark={surface.showDraftMark}
              role={role}
              widgetsSource={persistence.widgetsSource}
              sceneTitle={sceneName}
              bindings={document.bindings}
              devices={devices}
              hmi={hmi}
              selectedNode={selectedNode}
              selectedEntityId={selectedEntityId}
              platform={document.platform}
              focusWidgetId={focusWidgetId}
              onConsumeFocus={() => setFocusWidgetId(null)}
              onExitDeviceFocus={() => {
                /* 退出设备专题 = 回到全景：清选中（外围卡滑回、抽屉收起），同时收起底部抽屉 */
                select(null, null);
                setPinnedDrawer(false);
              }}
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
    </HudSkinProvider>
  );
}

