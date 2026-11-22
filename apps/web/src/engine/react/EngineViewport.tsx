
import { Application, Entity } from "@playcanvas/react";
import { Camera } from "@playcanvas/react/components";
import { OrbitControls } from "@playcanvas/react/scripts";
import { getProviderKind } from "@idt/data-adapter";
import type { DeviceBinding, ParsedHmiScene } from "@idt/shared-types";
import { useEffect, useState, type ReactNode } from "react";
import { EngineManager } from "../core/EngineManager";
import { DEFAULT_ENGINE_CONFIG } from "../core/EngineConfig";
import { readViewportCssClearColor, viewportClearColor } from "./viewport-clear-color";
import { useAppTheme } from "../../theme/AppThemeProvider";
import { EngineBridge } from "./EngineBridge";
import { DeviceLabels, type DeviceLabelItem } from "./DeviceLabels";
import type { NameplateCommandState } from "../../hooks/useNameplateCommands";
import { SceneLights } from "./SceneLights";
import { ControlDrawer } from "../../features/scene-editor/ControlDrawer";
import type { ControlDrawerModel } from "../../utils/control-drawer";
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
  dataLabel?: string;
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
  children?: ReactNode;
}

export function EngineViewport(props: EngineViewportProps) {
  const { modelUrl, gridEnabled = true, emptyText = "把模型拖到这里，或点右上角「导入模型」", labels = [] } = props;
  const { theme } = useAppTheme();
  const clearColor = viewportClearColor(theme, { cssVariable: readViewportCssClearColor() });
  const [kind, setKind] = useState(getProviderKind);

  useEffect(() => {
    const onChange = () => setKind(getProviderKind());
    window.addEventListener("idt-provider-changed", onChange);
    return () => window.removeEventListener("idt-provider-changed", onChange);
  }, []);

  const selectedCommands = props.selectedNode ? props.nameplateCommands?.[props.selectedNode] : undefined;

  return (
    <div className={styles.wrap}>
      {!modelUrl ? <div className={styles.hint}>{emptyText}</div> : null}
      {modelUrl ? (
        <div className={`${styles.badge} idt-demo-tag`}>
          {props.dataLabel ?? (kind === "guard" ? "后端数据" : "演示数据")}
        </div>
      ) : null}
      <Application fillMode="NONE" resolutionMode="AUTO" graphicsDeviceOptions={{ antialias: true, powerPreference: "high-performance" }}>
        <SceneLights gridEnabled={gridEnabled} />
        <Entity name="camera" position={DEFAULT_ENGINE_CONFIG.cameraPosition}>
          <Camera clearColor={clearColor} fov={DEFAULT_ENGINE_CONFIG.fov} />
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
      </Application>
      {modelUrl ? (
        <>
          <DeviceLabels
            items={labels}
            selectedNode={props.selectedNode}
            hoveredNode={props.hoveredNode}
            onSelect={(node) => props.onSelect?.(node)}
            onHover={props.onHover}
          />
          {props.drawerModel ? (
            <ControlDrawer
              open={Boolean(props.drawerOpen)}
              model={props.drawerModel}
              commands={selectedCommands}
              busy={props.nameplateBusy}
              onStart={() => props.selectedNode && props.onNameplateStart?.(props.selectedNode)}
              onStop={() => props.selectedNode && props.onNameplateStop?.(props.selectedNode)}
              onToggle={props.onToggleDrawer}
            />
          ) : null}
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
        </>
      ) : null}
      {props.children}
    </div>
  );
}
