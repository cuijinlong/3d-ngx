
import { useApp, useAppEvent } from "@playcanvas/react/hooks";
import { useEffect, useRef } from "react";
import type { DeviceBinding, ParsedHmiScene } from "@idt/shared-types";
import { EngineManager } from "../core/EngineManager";
import { pickEntityAt } from "../interaction/PickingManager";
import { applyBindingsToScene } from "../animation/DeviceStateAnimator";
import { telemetryRuntime } from "../../stores/telemetry.store";

interface EngineBridgeProps {
  modelUrl?: string;
  mode: "studio" | "runtime";
  gridEnabled?: boolean;
  selectedNode?: string | null;
  bindings?: DeviceBinding[];
  hmi?: ParsedHmiScene | null;
  resolveNode?: (raw: string | null) => string | null;
  onHover?: (nodeName: string | null) => void;
  onSelect?: (nodeName: string | null) => void;
  onLoaded?: (names: string[]) => void;
  onError?: (message: string) => void;
}

export function EngineBridge(props: EngineBridgeProps) {
  const app = useApp();
  const loading = useRef(false);
  const sizedOnce = useRef(false);
  const resolveRef = useRef(props.resolveNode);
  const selectRef = useRef(props.onSelect);
  const hoverRef = useRef(props.onHover);
  const appliedGeneration = useRef(-1);
  const appliedBindingKey = useRef("");
  resolveRef.current = props.resolveNode;
  selectRef.current = props.onSelect;
  hoverRef.current = props.onHover;

  useEffect(() => {
    EngineManager.instance.register(app);
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    const host = canvas.parentElement;
    let lastW = 0;
    let lastH = 0;
    sizedOnce.current = false;
    const apply = () => {
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === lastW && h === lastH) return;
      const firstRealSize = !sizedOnce.current && w > 1 && h > 1;
      lastW = w;
      lastH = h;
      EngineManager.instance.resizeToContainer(host);
      if (firstRealSize) {
        sizedOnce.current = true;
        EngineManager.instance.scheduleOverviewFit();
      } else {
        EngineManager.instance.resizeToContainer(host);
      }
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" && host ? new ResizeObserver(apply) : null;
    if (host && ro) ro.observe(host);
    window.addEventListener("resize", apply);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", apply);
      EngineManager.instance.unregister(app);
    };
  }, [app]);

  useEffect(() => {
    if (!props.modelUrl) {
      EngineManager.instance.disposeModel();
      props.onLoaded?.([]);
      return;
    }
    let cancelled = false;
    loading.current = true;
    EngineManager.instance
      .loadGlb(props.modelUrl)
      .then((model) => {
        if (cancelled) return;
        props.onLoaded?.([...model.byName.keys()]);
        EngineManager.instance.scheduleOverviewFit();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        props.onError?.(error instanceof Error ? error.message : "模型加载失败");
      })
      .finally(() => {
        loading.current = false;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.modelUrl, app]);

  useEffect(() => {
    EngineManager.instance.highlight(props.selectedNode ?? null);
  }, [app, props.selectedNode]);

  useEffect(() => {
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    const down = { x: 0, y: 0, dragging: false, pointerId: -1 };
    let hoverTimer = 0;
    let lastHover = 0;

    const resolve = (name: string | null) => (resolveRef.current ? resolveRef.current(name) : name);

    const onDown = (event: PointerEvent) => {
      down.x = event.clientX;
      down.y = event.clientY;
      down.dragging = false;
      down.pointerId = event.pointerId;
    };

    const onMove = (event: PointerEvent) => {
      if (loading.current) return;
      if (down.pointerId === event.pointerId && (Math.abs(event.clientX - down.x) > 6 || Math.abs(event.clientY - down.y) > 6)) {
        down.dragging = true;
      }
      if (down.pointerId !== -1) return;
      /*
       * 没人接悬停就不拾取（2026-11-25）。
       *
       * <p>铭牌改为「只认选中」后，`onHover` 当前没有消费者。
       * 不早退的话，鼠标每动 120ms 就在 1942 节点的模型上跑一次 raycast，
       * 而结果没人用。将来要做悬停高亮时传 `onHover` 即自动恢复。
       */
      if (!hoverRef.current) return;
      const now = Date.now();
      if (now - lastHover < 120) return;
      lastHover = now;
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        void pickEntityAt(event.clientX, event.clientY).then((entity) => {
          hoverRef.current?.(resolve(entity?.name ?? null));
        });
      }, 0);
    };

    const onUp = (event: PointerEvent) => {
      const wasDragging = down.dragging;
      const same = down.pointerId === event.pointerId;
      down.pointerId = -1;
      down.dragging = false;
      if (loading.current || !same || wasDragging) return;
      if (Math.abs(event.clientX - down.x) > 6 || Math.abs(event.clientY - down.y) > 6) return;
      void pickEntityAt(event.clientX, event.clientY).then((entity) => {
        selectRef.current?.(resolve(entity?.name ?? null));
      });
    };

    const onLeave = () => {
      if (down.pointerId !== -1) return;
      hoverRef.current?.(null);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      window.clearTimeout(hoverTimer);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [app]);

  useAppEvent("update", (dt: number) => {
    EngineManager.instance.tickAnimations(dt);
    if (!(props.mode === "runtime" || props.bindings?.length)) return;
    const bindingKey = `${props.mode}:${props.hmi?.name ?? ""}:${(props.bindings ?? []).map((item) => item.id).join(",")}`;
    const generation = telemetryRuntime.generation;
    if (appliedGeneration.current === generation && appliedBindingKey.current === bindingKey) return;
    appliedGeneration.current = generation;
    appliedBindingKey.current = bindingKey;
    applyBindingsToScene(props.hmi ?? null, props.bindings ?? [], telemetryRuntime.latest);
  });

  return null;
}
