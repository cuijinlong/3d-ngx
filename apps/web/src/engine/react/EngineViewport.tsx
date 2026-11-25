
import { Application, Entity } from "@playcanvas/react";
import { Camera } from "@playcanvas/react/components";
import { OrbitControls } from "@playcanvas/react/scripts";
import { ngxHudTokens } from "@idt/config";
import type { DeviceBinding, ParsedHmiScene } from "@idt/shared-types";
import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
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
import { diagnoseWebgl, isGraphicsDeviceError, type WebglDiagnosis, type WebglSupport } from "./webgl-support";
import styles from "./EngineViewport.module.css";

interface EngineViewportProps {
  modelUrl?: string;
  mode: "studio" | "runtime";
  gridEnabled?: boolean;
  selectedNode?: string | null;
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
  /*
   * WebGL2 预检 + 诊断（2026-11-24）。
   *
   * <p>未就绪前不能直接渲染 `<Application>`：它在没有 WebGL2 时会抛
   * `Failed to create a graphics device`，而组件本身返回 null ——
   * 现场看到的是「中间一块空白 + 一条看不懂的控制台错误」。
   *
   * <p>判定只用 `diagnosis.webgl2`：软件渲染（SwiftShader）**不阻断**，
   * 能跑就让它跑，只是慢 —— 把还能用的场景直接挡掉是更糟的失败。
   *
   * <p>测试环境（jsdom）没有 canvas 实现，必然拿不到上下文 ——
   * 若不跳过，所有渲染视口的用例都会看到「不支持 WebGL」而不是被测内容。
   */
  const [support, setSupport] = useState<WebglSupport>(() =>
    import.meta.env?.MODE === "test" ? "ok" : "checking",
  );
  /**
   * 诊断明细。客户报障时这是唯一的自证材料 —— 光说「不支持」
   * 他无法判断该关硬件加速、升级浏览器，还是换成实机访问。
   */
  const [diagnosis, setDiagnosis] = useState<WebglDiagnosis | null>(null);
  const runDiagnosis = useCallback(() => {
    const next = diagnoseWebgl();
    setDiagnosis(next);
    setSupport(next.webgl2 ? "ok" : "unavailable");
  }, []);
  useEffect(() => {
    if (import.meta.env?.MODE === "test") return;
    runDiagnosis();
  }, [runDiagnosis]);
  /*
   * 预检通过但真正创建仍失败时（典型：同时打开的页面太多，WebGL 上下文配额耗尽），
   * `<Application>` 的 rejection 没有 catch，只能从全局兜住 ——
   * 否则界面就是一块永久空白，刷新也不知道该刷新几次。
   */
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isGraphicsDeviceError(event.reason)) return;
      /* 重跑一次诊断：这次失败可能只是配额耗尽，判断依据要反映**当前**事实 */
      runDiagnosis();
      setSupport("unavailable");
      /* 已经接管了这条错误，不让它继续在控制台里裸着 */
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [runDiagnosis]);
  const clearColor = viewportClearColor(theme, {
    cssVariable: hud ? ngxHudTokens.viewport : readViewportCssClearColor(),
  });
  if (support === "unavailable") {
    return (
      <div className={styles.wrap} data-hud={hud ? "on" : undefined}>
        <GpuUnavailable diagnosis={diagnosis} onRetry={runDiagnosis} />
      </div>
    );
  }
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
      {/**
       * `powerPreference` 不传（用 @playcanvas/react 的默认 `default`，2026-11-24）。
       *
       * <p>原来写死 `"high-performance"`。这是个**请求**不是保证：
       * 在没有独显、或 GPU 被浏览器列入黑名单、或远程桌面/虚拟机的环境里，
       * Chrome 可能因为达不到「高性能」而不给上下文 —— 结果就是
       * `Failed to create a graphics device`。传 `default` 时 PlayCanvas
       * 会把该属性从 context 参数里删掉（`graphics-device.js` 里 `!== "default"`
       * 的分支），完全交给浏览器决定，成功率最高。
       *
       * <p>代价：双显卡机器上可能用集显。对一个大屏 3D 场景来说，
       * 「能跑」比「跑在用独显」重要得多。
       */}
      <Application fillMode="NONE" resolutionMode="AUTO" graphicsDeviceOptions={{ antialias: true }}>
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
        onSelect={(node) => props.onSelect?.(node)}
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

/**
 * 3D 引擎无法初始化时的提示（2026-11-24）。
 *
 * <h2>为什么只给一句提示</h2>
 *
 * <p>客户原话：「如果是电脑老旧的原因无法加载 WEBGL，那就算了提示一下就够了」。
 *
 * <p>第一版罗列了四条可能原因 + 排查步骤 + 探测明细。那是按「必须修好」
 * 设计的，而实际结论往往是**这台机器就是跑不了** —— 老机器、老显卡、
 * 公司策略禁用硬件加速，前端做什么都改变不了。这时候长篇排查
 * 只会让人以为系统有毛病，继续花时间。
 *
 * <p>所以收敛成一句话：不支持，不影响其它功能，换台机器或开硬件加速。
 * 「重新检测」保留 —— 有人改完浏览器设置不用刷新整页。
 */
function GpuUnavailable({ diagnosis, onRetry }: { diagnosis: WebglDiagnosis | null; onRetry: () => void }) {
  /*
   * 技术细节压成一行小字。平时不占视线，但客户报障时
   * 运维能直接看到是「连 WebGL1 都没有」还是「只有软件渲染」，
   * 省掉一轮来回问。不展开、不做表格。
   */
  const detail = diagnosis
    ? `WebGL2 ${diagnosis.webgl2 ? "✓" : "✗"} · WebGL1 ${diagnosis.webgl1 ? "✓" : "✗"} · WebGPU ${diagnosis.webgpu ? "✓" : "✗"}${
        diagnosis.renderer ? ` · ${diagnosis.renderer}` : ""
      }`
    : null;
  return (
    <div className={styles.gpuError} data-testid="gpu-unavailable">
      <div className={styles.gpuErrorCard}>
        <div className={styles.gpuErrorTitle}>当前设备无法显示 3D 视图</div>
        <p className={styles.gpuErrorText}>
          这台设备的浏览器未能启用 WebGL2（3D 渲染能力），属于设备或浏览器限制。
          除 3D 视图外，其它功能不受影响。
        </p>
        <p className={styles.gpuErrorText}>
          如需要在当前设备查看，可开启浏览器「使用硬件加速」后重启浏览器；否则请换一台较新的设备访问。
        </p>
        {detail ? (
          <p className={styles.gpuErrorDetail} data-testid="gpu-facts">
            {detail}
          </p>
        ) : null}
        <button type="button" className={styles.gpuErrorRetry} onClick={onRetry}>
          重新检测
        </button>
      </div>
    </div>
  );
}
