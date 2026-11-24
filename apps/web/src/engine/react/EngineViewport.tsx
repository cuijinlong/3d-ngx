
import { Application, Entity } from "@playcanvas/react";
import { Camera } from "@playcanvas/react/components";
import { OrbitControls } from "@playcanvas/react/scripts";
import { ngxHudTokens } from "@idt/config";
import type { DeviceBinding, ParsedHmiScene } from "@idt/shared-types";
import { useMemo, type ReactNode } from "react";
import { EngineManager } from "../core/EngineManager";
import { DEFAULT_ENGINE_CONFIG } from "../core/EngineConfig";
import { readViewportCssClearColor, viewportClearColor } from "./viewport-clear-color";
import { useAppTheme } from "../../theme/AppThemeProvider";
import { useHudSkin } from "../../theme/HudSkin";
import { EngineBridge } from "./EngineBridge";
import { DeviceLabels, type DeviceLabelItem } from "./DeviceLabels";
import type { NameplateCommandState } from "../../hooks/useNameplateCommands";
import { useNameplateCommands } from "../../hooks/useNameplateCommands";
import { SceneLights } from "./SceneLights";
import { ViewportHud } from "./ViewportHud";
import { ControlDrawer } from "../../features/scene-editor/ControlDrawer";
import type { ControlDrawerModel } from "../../utils/control-drawer";
import { buildControlDrawerModel } from "../../utils/control-drawer";
import { buildDevicePlates, readLatest } from "../../utils/device-plates";
import { useTelemetryStore } from "../../stores/telemetry.store";
import styles from "./EngineViewport.module.css";

interface EngineViewportProps {
  modelUrl?: string;
  mode: "studio" | "runtime";
  gridEnabled?: boolean;
  selectedNode?: string | null;
  hoveredNode?: string | null;
  bindings?: DeviceBinding[];
  hmi?: ParsedHmiScene | null;
  emptyText?: string;
  /** 3D 视口 HUD 上显示的场景名（`SCENE：xxx`）。 */
  sceneName?: string;
  dataLabel?: string;
  dataSource?: "live" | "demo";
  labels?: DeviceLabelItem[];
  nameplateCommands?: Record<string, NameplateCommandState>;
  nameplateBusy?: string | null;
  drawerOpen?: boolean;
  drawerModel?: ControlDrawerModel;
  resolveNode?: (raw: string | null) => string | null;
  onHover?: (nodeName: string | null) => void;
  onNameplateStart?: (node: string) => void;
  onNameplateStop?: (node: string) => void;
  onToggleDrawer?: () => void;
  onSelect?: (nodeName: string | null) => void;
  onLoaded?: (names: string[]) => void;
  onError?: (message: string) => void;
  onOverview?: () => void;
  /** 是否在视口右下角渲染「总览」按钮。运行态改由顶栏提供，故默认关闭。 */
  showOverviewButton?: boolean;
  children?: ReactNode;
}

export function EngineViewport(props: EngineViewportProps) {
  const { modelUrl, gridEnabled = true, emptyText = "把模型拖到这里，或点右上角「导入模型」" } = props;
  const { theme } = useAppTheme();
  const hud = useHudSkin();
  const clearColor = viewportClearColor(theme, {
    cssVariable: hud ? ngxHudTokens.viewport : readViewportCssClearColor(),
  });
  return (
    <div className={styles.wrap} data-hud={hud ? "on" : undefined}>
      {!modelUrl ? <div className={styles.hint}>{emptyText}</div> : null}
      {/*
       * 视口角的数据口径徽标（2026-11-23 收紧）。
       *
       * <p>原来写的是 `dataLabel ?? (guard ? "后端数据" : "演示数据")`，
       * 两条路都不对：
       *   · `dataLabel=""`（正常态，客户要求不挂标签）会渲染成**一个空白方块**
       *     —— 看着像渲染坏了，其实只是空字符串；
       *   · 没传 dataLabel 时自动编一个「后端数据/演示数据」，
       *     把已经删掉的演示概念又请回来了。
       *
       * <p>现在只在真有话说时（如「未连接平台」）才显示。
       */}
      {modelUrl && props.dataLabel ? (
        <div className={`${styles.badge} idt-demo-tag`}>{props.dataLabel}</div>
      ) : null}
      <Application fillMode="NONE" resolutionMode="AUTO" graphicsDeviceOptions={{ antialias: true, powerPreference: "high-performance" }}>
        {/*
         * clearColor 交给 SceneLights 设到 scene 上。
         * 不要写在 <Camera/> 上 —— 它不生效也不报错，见 SceneLights 的说明。
         */}
        <SceneLights gridEnabled={gridEnabled} clearColor={clearColor} groundColor={hud ? "#111b26" : undefined} />
        <Entity name="camera" position={DEFAULT_ENGINE_CONFIG.cameraPosition}>
          <Camera fov={DEFAULT_ENGINE_CONFIG.fov} />
          <OrbitControls distanceMin={1} distanceMax={4000} pitchAngleMax={90} pitchAngleMin={-5} frameOnStart={false} />
        </Entity>
        <EngineBridge
          modelUrl={props.modelUrl}
          mode={props.mode}
          gridEnabled={props.gridEnabled}
          selectedNode={props.selectedNode}
          bindings={props.bindings}
          hmi={props.hmi}
          resolveNode={props.resolveNode}
          onHover={props.onHover}
          onSelect={props.onSelect}
          onLoaded={props.onLoaded}
          onError={props.onError}
        />
        {/*
         * HUD 必须在 <Application> 内部：它用 useApp()/useFrame() 读真实
         * 帧率与相机坐标。position:absolute + DOM 在 canvas 之后 → 天然浮在上层。
         * 只在运行态（hud skin）显示；编辑态不需要这些装饰。
         */}
        {hud ? <ViewportHud sceneName={props.sceneName} /> : null}
      </Application>
      {modelUrl ? <ViewportLiveLayer {...props} /> : null}
      {props.children}
    </div>
  );
}

function ViewportLiveLayer(props: EngineViewportProps) {
  const latest = useTelemetryStore((s) => s.latest);
  const labels = useMemo(
    () =>
      props.labels ??
      buildDevicePlates({
        devices: props.hmi?.devices ?? [],
        bindings: props.bindings ?? [],
        latest,
        source: props.dataSource,
      }),
    [props.labels, props.hmi?.devices, props.bindings, latest, props.dataSource],
  );
  const commands = useNameplateCommands(labels, props.bindings ?? []);
  const stateByNode = props.nameplateCommands ?? commands.stateByNode;
  const busy = props.nameplateBusy ?? commands.busy;
  const drawerModel = useMemo(
    () =>
      props.drawerModel ??
      buildControlDrawerModel({
        hmi: props.hmi,
        selectedNode: props.selectedNode,
        plates: labels,
        bindings: props.bindings ?? [],
        latest,
      }),
    [props.drawerModel, props.hmi, props.selectedNode, labels, props.bindings, latest],
  );
  const selectedCommands = props.selectedNode ? stateByNode[props.selectedNode] : undefined;

  /*
   * 数值控制的当前值（2026-11-23）。
   *
   * <p>读**协议值**（`opening` 65 就是 65），抽屉负责显示时的单位换算。
   * 只有那台设备真的登记了数值命令时才读 —— 否则白算一遍。
   *
   * <p>为什么固定读 `opening`：目前设备上的数值命令只有 `setOpening`，
   * 而它的遥测回显键就是 `opening`。将来若有设定点回显键，
   * 应该在 `NameplateNumericState` 上加 `currentKey` 而不是在这里堆 if。
   */
  const numericCurrent = useMemo(() => {
    if (!props.selectedNode || !selectedCommands?.numeric) return null;
    const binding = (props.bindings ?? []).find((item) => item.sceneEntityId === props.selectedNode);
    if (!binding?.deviceId) return null;
    /*
     * 读开度当前值。读不到返回 null —— 抽屉会退到范围中点，
     * 把「没数据」与「真是 0」区分开（见 `initialWireValue`）。
     *
     * <p>只认 `opening` 一个键：目前设备上的数值命令只有 `setOpening`。
     * 将来若有设定点回显，应在 `NameplateNumericState` 上加 `currentKey`，
     * 而不是在这里堆 if。
     */
    const row = readLatest(latest, binding.deviceId, ["opening"]);
    if (!row) return null;
    const num = typeof row.value === "number" ? row.value : Number(row.value);
    return Number.isFinite(num) ? num : null;
  }, [props.selectedNode, props.bindings, selectedCommands?.numeric, latest]);

  return (
    <>
      <DeviceLabels
        items={labels}
        selectedNode={props.selectedNode}
        hoveredNode={props.hoveredNode}
        onSelect={(node) => props.onSelect?.(node)}
        onHover={props.onHover}
      />
      {drawerModel ? (
        <ControlDrawer
          open={Boolean(props.drawerOpen)}
          model={drawerModel}
          commands={selectedCommands}
          busy={busy}
          numericCurrent={numericCurrent}
          onStart={() => props.selectedNode && (props.onNameplateStart?.(props.selectedNode) ?? void commands.send(props.selectedNode, "start"))}
          onStop={() => props.selectedNode && (props.onNameplateStop?.(props.selectedNode) ?? void commands.send(props.selectedNode, "stop"))}
          onNumeric={(wire) => props.selectedNode && void commands.sendNumeric(props.selectedNode, wire)}
          onToggle={props.onToggleDrawer}
        />
      ) : null}
      {/*
       * 「总览」按钮已移到顶栏（2026-11-23）。
       *
       * 它原本固定在右下角 12px 处，正好压住模板布局里的「加载率对比」卡
       * —— 那张卡按模板要占满到 97%。为一个小按钮让整块卡左移不划算。
       * 顶栏本来就是操作按钮区（全屏 / 返回 / 退出），放这里更自然。
       */}
      {props.showOverviewButton ? (
        <button
          type="button"
          className={styles.overviewBtn}
          data-testid="camera-overview"
          onClick={() => {
            EngineManager.instance.refitCamera();
            props.onOverview?.();
          }}
        >
          总览
        </button>
      ) : null}
    </>
  );
}
