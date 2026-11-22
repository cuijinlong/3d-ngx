
import {
  Asset,
  Color,
  Entity,
  FILLMODE_NONE,
  Vec3,
  type Application,
} from "playcanvas";
import { DEFAULT_ENGINE_CONFIG } from "./EngineConfig";
import { pickDoorNodeNames, pickGaugeNodeNames, pickIndicatorNodeNames, pickSpinNodeNames } from "../animation/visual-nodes";

export interface LoadedModel {
  url: string;
  asset: Asset;
  root: Entity;
  byName: Map<string, Entity>;
}

export interface EngineStats {
  fps: number;
  ms: number;
  drawCalls: number;
  triangles: number;
}

/**
 * 一个工作区只保留一个 PlayCanvas Application。
 * 不要把本对象放进 React 的高频状态。
 */
export class EngineManager {
  static readonly instance = new EngineManager();

  app: Application | null = null;
  model: LoadedModel | null = null;
  private highlightColor = new Color(0x16 / 255, 0x57 / 255, 0xe8 / 255);
  private originalColors = new Map<string, Array<{ mesh: unknown; color: number[] }>>();
  private animationState = new Map<string, { playing: boolean; kind: string }>();
  private spinNodes = new Set<Entity>();
  private swingNodes = new Map<Entity, { kind: "gauge" | "door"; t: number; base: [number, number, number] }>();
  private loadToken = 0;

  register(app: Application): void {
    if (this.app && this.app !== app) {
      this.disposeModel();
    }
    this.app = app;
    app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
    try {
      app.setCanvasFillMode(FILLMODE_NONE);
    } catch {
      /* 不同版本 API 可能已由 <Application> 设置 */
    }
    this.resizeToContainer();
  }

  /** 把画布对齐到可见容器，避免左侧列表把画布撑成几千像素高、模型和铭牌都跑出画面 */
  resizeToContainer(host?: HTMLElement | null): void {
    const app = this.app;
    if (!app) return;
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    const wrap = host ?? canvas.parentElement;
    if (!wrap) return;
    const width = Math.max(1, Math.round(wrap.clientWidth));
    const height = Math.max(1, Math.round(wrap.clientHeight));
    if (height > 1600 || width > 4000) return;
    if (canvas.clientWidth === width && canvas.clientHeight === height) return;
    try {
      app.resizeCanvas(width, height);
    } catch {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
  }

  private overviewFitToken = 0;

  refitCamera(): void {
    if (this.model?.root) this.fitCameraToModel(this.model.root);
  }

  captureCameraView(): { yaw: number; pitch: number; distance: number; pivot: [number, number, number] } | null {
    const orbit = this.orbitCamera();
    if (!orbit || typeof orbit.yaw !== "number" || typeof orbit.pitch !== "number" || typeof orbit.distance !== "number") {
      return null;
    }
    const pivot = orbit.pivotPoint;
    const x = typeof pivot?.x === "number" ? pivot.x : 0;
    const y = typeof pivot?.y === "number" ? pivot.y : 0;
    const z = typeof pivot?.z === "number" ? pivot.z : 0;
    return { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, pivot: [x, y, z] };
  }

  restoreCameraView(view: { yaw: number; pitch: number; distance: number; pivot: [number, number, number] }): boolean {
    this.cancelOverviewFit();
    const camera = this.cameraEntity();
    const orbit = this.orbitCamera();
    if (!camera || !orbit) return false;
    const target = new Vec3(view.pivot[0], view.pivot[1], view.pivot[2]);
    if (orbit.pivotPoint && typeof orbit.pivotPoint.copy === "function") orbit.pivotPoint.copy(target);
    else orbit.pivotPoint = target;
    if (typeof orbit.reset === "function") orbit.reset(view.yaw, view.pitch, view.distance);
    else {
      orbit.yaw = view.yaw;
      orbit.pitch = view.pitch;
      orbit.distance = view.distance;
    }
    orbit._updatePosition?.();
    return true;
  }

  private cameraEntity(): Entity | null {
    const app = this.app;
    if (!app) return null;
    const cameras = app.root.findComponents("camera") as Array<{ entity?: Entity }>;
    return cameras.find((item) => item.entity?.name === "camera")?.entity ?? cameras[0]?.entity ?? null;
  }

  private orbitCamera(): OrbitLike | null {
    const camera = this.cameraEntity();
    if (!camera) return null;
    const script = (camera as unknown as { script?: { orbitCamera?: OrbitLike; get?: (name: string) => OrbitLike } }).script;
    return script?.orbitCamera ?? script?.get?.("orbitCamera") ?? null;
  }


  cancelOverviewFit(): void {
    this.overviewFitToken += 1;
  }

  /** 模型 AABB 和轨道脚本可能晚一两帧才就绪，多试几次对准高机位总览 */
  scheduleOverviewFit(): void {
    const token = ++this.overviewFitToken;
    let attempts = 0;
    const tick = () => {
      if (token !== this.overviewFitToken) return;
      if (this.model?.root) this.fitCameraToModel(this.model.root);
      attempts += 1;
      if (attempts < 12) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  unregister(app?: Application): void {
    if (app && this.app !== app) return;
    this.disposeModel();
    this.app = null;
  }

  async loadGlb(url: string): Promise<LoadedModel> {
    const app = this.app;
    if (!app) throw new Error("引擎尚未初始化");
    const token = ++this.loadToken;
    this.disposeModel();

    const asset = new Asset(`model_${token}`, "container", { url });
    app.assets.add(asset);

    await new Promise<void>((resolve, reject) => {
      asset.ready(() => resolve());
      asset.on("error", (err: unknown) => {
        reject(err instanceof Error ? err : new Error("模型加载失败"));
      });
      app.assets.load(asset);
    });

    if (token !== this.loadToken) {
      app.assets.remove(asset);
      asset.unload();
      throw new Error("模型加载已取消");
    }

    const resource = asset.resource as {
      instantiateRenderEntity?: (options?: Record<string, unknown>) => Entity;
      instantiateRenderComponent?: () => Entity;
    };
    if (!resource?.instantiateRenderEntity) {
      throw new Error("该资源不是可实例化的 GLB/GLTF 容器");
    }
    const root = resource.instantiateRenderEntity();
    root.name = "ImportedRoot";
    app.root.addChild(root);

    const byName = new Map<string, Entity>();
    const walk = (entity: Entity) => {
      if (entity.name) byName.set(entity.name, entity);
      for (const child of entity.children) walk(child as Entity);
    };
    walk(root);

    this.model = { url, asset, root, byName };
    enableMeshShadows(root);
    this.resizeToContainer();
    this.fitCameraToModel(root);
    this.scheduleOverviewFit();
    return this.model;
  }

  disposeModel(): void {
    const app = this.app;
    if (this.model) {
      this.model.root.destroy();
      if (app) app.assets.remove(this.model.asset);
      this.model.asset.unload();
      this.model = null;
    }
    this.originalColors.clear();
    this.animationState.clear();
    this.spinNodes.clear();
  }

  findEntity(nodeName: string): Entity | undefined {
    return this.model?.byName.get(nodeName);
  }

  listEntityNames(): string[] {
    return this.model ? [...this.model.byName.keys()] : [];
  }

  setVisible(nodeName: string, visible: boolean): void {
    const entity = this.findEntity(nodeName);
    if (entity) entity.enabled = visible;
  }

  getTransform(nodeName: string): { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | null {
    const entity = this.findEntity(nodeName);
    if (!entity) return null;
    const p = entity.getLocalPosition();
    const r = entity.getLocalEulerAngles();
    const s = entity.getLocalScale();
    return {
      position: [round3(p.x), round3(p.y), round3(p.z)],
      rotation: [round3(r.x), round3(r.y), round3(r.z)],
      scale: [round3(s.x), round3(s.y), round3(s.z)],
    };
  }

  applyTransform(
    nodeName: string,
    transform: { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] },
  ): void {
    // 变换编辑已收口：SceneEntity.transform 只是旧 JSON 占位，导入/保存流程不得回放改写 GLB 节点。
    void nodeName;
    void transform;
  }


  restoreHighlights(): void {
    for (const backup of this.originalColors.values()) {
      for (const item of backup) {
        const mat = (item.mesh as { material?: { emissive?: { set: (r: number, g: number, b: number) => void }; update?: () => void } }).material;
        if (mat?.emissive) {
          mat.emissive.set(item.color[0] ?? 0, item.color[1] ?? 0, item.color[2] ?? 0);
          mat.update?.();
        }
      }
    }
    this.originalColors.clear();
  }

  highlight(nodeName: string | null): void {
    this.restoreHighlights();

    if (!nodeName) return;
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    const meshInstances = collectMeshes(entity);
    const backup: Array<{ mesh: { setParameter?: (k: string, v: unknown) => void; getParameter?: (k: string) => unknown; material?: { emissive?: { r: number; g: number; b: number }; update?: () => void } }; color: number[] }> = [];
    for (const mi of meshInstances) {
      const mat = mi.material;
      if (mat?.emissive) {
        backup.push({ mesh: mi, color: [mat.emissive.r, mat.emissive.g, mat.emissive.b] });
        mat.emissive.set(this.highlightColor.r * 0.35, this.highlightColor.g * 0.35, this.highlightColor.b * 0.35);
        mat.update?.();
      }
    }
    this.originalColors.set(nodeName, backup);
  }

  tintStatus(nodeName: string, hex: string | null): void {
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    const color = hex ? new Color().fromString(hex) : null;
    for (const mi of collectMeshes(entity)) {
      const mat = mi.material;
      if (!mat?.emissive) continue;
      if (!color) {
        mat.emissive.set(0, 0, 0);
      } else {
        mat.emissive.set(color.r * 0.4, color.g * 0.4, color.b * 0.4);
      }
      mat.update?.();
    }
  }

  setSpin(nodeName: string, playing: boolean): void {
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    // 只转 spin_fan / 叶轮，不要把带 fan 字样的机柜或风圈转起来
    const named = collectSubtree(entity).filter((node) => node !== entity);
    const picked = new Set(pickSpinNodeNames(named.map((node) => node.name || "")));
    const nodes = named.filter((node) => picked.has(node.name));
    for (const node of nodes) {
      if (playing) this.spinNodes.add(node);
      else this.spinNodes.delete(node);
    }
    if (!playing) {
      for (const node of collectSubtree(entity)) this.spinNodes.delete(node);
    }
  }

  setIndicator(nodeName: string, on: boolean): void {
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    const named = collectSubtree(entity).filter((node) => node !== entity);
    const picked = new Set(pickIndicatorNodeNames(named.map((node) => node.name || "")));
    const nodes = named.filter((node) => picked.has(node.name));
    const color = on ? new Color(0.1, 0.85, 0.45) : null;
    for (const node of nodes) {
      for (const mi of collectMeshes(node)) {
        const mat = mi.material;
        if (!mat?.emissive) continue;
        if (!color) mat.emissive.set(0, 0, 0);
        else mat.emissive.set(color.r, color.g, color.b);
        mat.update?.();
      }
    }
  }

  tickAnimations(dt: number): void {
    for (const entity of this.spinNodes) {
      entity.rotateLocal(0, 0, dt * 180);
    }
    for (const [entity, state] of this.swingNodes) {
      state.t += dt;
      const angle = Math.sin(state.t * 3) * (state.kind === "gauge" ? 20 : 40);
      if (state.kind === "gauge") {
        entity.setLocalEulerAngles(state.base[0] + angle, state.base[1], state.base[2]);
      } else {
        entity.setLocalEulerAngles(state.base[0], state.base[1] + angle, state.base[2]);
      }
    }
  }

  setSwing(nodeName: string, playing: boolean, kind: "gauge" | "door"): void {
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    const named = collectSubtree(entity).filter((node) => node !== entity);
    const picked = new Set((kind === "gauge" ? pickGaugeNodeNames : pickDoorNodeNames)(named.map((node) => node.name || "")));
    const targets = named.filter((node) => picked.has(node.name));
    for (const node of targets) {
      if (playing) {
        const existing = this.swingNodes.get(node);
        if (existing) {
          existing.kind = kind;
          continue;
        }
        const euler = node.getLocalEulerAngles();
        this.swingNodes.set(node, { kind, t: 0, base: [euler.x, euler.y, euler.z] });
      } else {
        const state = this.swingNodes.get(node);
        if (state) node.setLocalEulerAngles(state.base[0], state.base[1], state.base[2]);
        this.swingNodes.delete(node);
      }
    }
    if (!playing) {
      for (const node of collectSubtree(entity)) {
        const state = this.swingNodes.get(node);
        if (!state) continue;
        node.setLocalEulerAngles(state.base[0], state.base[1], state.base[2]);
        this.swingNodes.delete(node);
      }
    }
  }

  playNamedAnimation(clip: string, play: boolean, ownerNode?: string): void {
    const root = this.model?.root;
    const app = this.app;
    if (!root || !app) return;
    const entity = resolveClipEntity(clip, ownerNode, this) ?? root;
    const anim = (entity as unknown as { anim?: { assignAnimation?: (name: string, asset: unknown) => void; baseLayer?: { play?: (name: string) => void; stop?: () => void } }; animation?: { play?: (name: string) => void; stop?: () => void } });
    try {
      if (play) {
        anim.animation?.play?.(clip);
        anim.anim?.baseLayer?.play?.(clip);
      } else {
        anim.animation?.stop?.();
        anim.anim?.baseLayer?.stop?.();
      }
    } catch {
      /* 动画组件因模型导出差异可能不存在，旋转回退已覆盖风扇类动作 */
    }
    this.animationState.set(clip, { playing: play, kind: clip });
  }

  getStats(): EngineStats {
    const app = this.app;
    const stats = app?.stats as
      | {
          frame?: { fps?: number; ms?: number };
          drawCalls?: number | { total?: number };
          triangles?: number | { total?: number };
        }
      | undefined;
    return {
      fps: Math.round(stats?.frame?.fps ?? 0),
      ms: Number((stats?.frame?.ms ?? 0).toFixed(1)),
      drawCalls: readStatCount(stats?.drawCalls),
      triangles: readStatCount(stats?.triangles),
    };
  }

  private fitCameraToModel(root: Entity): void {
    const app = this.app;
    if (!app) return;
    const cameras = app.root.findComponents("camera") as Array<{ entity: Entity }>;
    const camera = cameras[0]?.entity;
    if (!camera) return;
    const box = aabbOf(root);
    if (!box) {
      camera.setPosition(...DEFAULT_ENGINE_CONFIG.cameraPosition);
      camera.lookAt(0, 0, 0);
      return;
    }
    const cx = (box.min[0] + box.max[0]) / 2;
    const cy = (box.min[1] + box.max[1]) / 2;
    const cz = (box.min[2] + box.max[2]) / 2;
    const dx = box.max[0] - box.min[0];
    const dy = box.max[1] - box.min[1];
    const dz = box.max[2] - box.min[2];
    const radius = Math.max(Math.hypot(dx, dy, dz) / 2, 1);
    const fov = (DEFAULT_ENGINE_CONFIG.fov * Math.PI) / 180;
    const factor = DEFAULT_ENGINE_CONFIG.fitDistanceFactor ?? 1.42;
    const dist = (radius / Math.sin(fov / 2)) * factor;
    const az = (DEFAULT_ENGINE_CONFIG.cameraAzimuthDeg * Math.PI) / 180;
    const el = (DEFAULT_ENGINE_CONFIG.cameraElevationDeg * Math.PI) / 180;
    camera.setPosition(
      cx + dist * Math.cos(el) * Math.sin(az),
      cy + dist * Math.sin(el),
      cz + dist * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(cx, cy, cz);
    syncOrbitCamera(camera, new Vec3(cx, cy, cz), dist);
  }

  /** 把节点包围盒顶心投到画布像素，供场内设备标签使用 */
  worldToScreen(nodeName: string): { x: number; y: number; z: number; visible: boolean } | null {
    const app = this.app;
    const entity = this.findEntity(nodeName);
    if (!app || !entity) return null;
    const cameras = app.root.findComponents("camera") as Array<{
      entity?: { name?: string; enabled?: boolean };
      enabled?: boolean;
      worldToScreen?: (world: Vec3, screen?: Vec3) => Vec3;
    }>;
    // <Application> 可能自带一台默认相机；铭牌必须用场景里那台轨道总览相机，否则全部投影会落在看不见的范围。
    const camera =
      cameras.find((item) => item.entity?.name === "camera" && item.worldToScreen) ||
      [...cameras].reverse().find((item) => item.worldToScreen && item.enabled !== false && item.entity?.enabled !== false) ||
      cameras.find((item) => item.worldToScreen);
    if (!camera?.worldToScreen) return null;
    const box = aabbOf(entity);
    const world = new Vec3();
    if (box) {
      world.set((box.min[0] + box.max[0]) / 2, box.max[1] + Math.max((box.max[1] - box.min[1]) * 0.08, 0.15), (box.min[2] + box.max[2]) / 2);
    } else {
      const p = entity.getPosition();
      world.set(p.x, p.y + 0.4, p.z);
    }
    const screen = camera.worldToScreen(world, new Vec3());
    const canvas = app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    // 实测 PlayCanvas worldToScreen.z 是到相机的距离（总览约数十单位），不是 [0,1] NDC；只用 z>0 排除相机后方。
    const inFront = Number.isFinite(screen.z) && screen.z > 0;
    return {
      x: screen.x,
      y: screen.y,
      z: screen.z,
      visible: inFront && screen.x >= -48 && screen.x <= w + 48 && screen.y >= -48 && screen.y <= h + 48,
    };
  }
}

function readStatCount(value: number | { total?: number } | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && typeof value.total === "number") return value.total;
  return 0;
}

function round3(n: number): number {

  return Number(n.toFixed(3));
}


function collectSubtree(entity: Entity): Entity[] {
  const out: Entity[] = [];
  const walk = (node: Entity) => {
    out.push(node);
    for (const child of node.children) walk(child as Entity);
  };
  walk(entity);
  return out;
}

/** 模型加载后把轨道相机的枢轴和距离对齐到总览机位，避免控件用整场（含地面）包围盒把机位拉偏 */
function syncOrbitCamera(camera: Entity, target: Vec3, distance: number): boolean {
  const script = (camera as unknown as { script?: { orbitCamera?: OrbitLike; get?: (name: string) => OrbitLike } }).script;
  const orbit = script?.orbitCamera ?? script?.get?.("orbitCamera");
  if (!orbit) return false;
  if (typeof orbit.distanceMin === "number" && orbit.distanceMin > 1) {
    orbit.distanceMin = 1;
  }
  if (typeof orbit.distanceMax === "number" && (orbit.distanceMax <= 0 || distance > orbit.distanceMax)) {
    orbit.distanceMax = Math.max(distance * 1.5, 2000);
  }
  if (typeof orbit.resetAndLookAtPoint === "function") {
    orbit.resetAndLookAtPoint(camera.getPosition(), target);
    if (typeof orbit.distance === "number") orbit.distance = distance;
    return true;
  }
  if (orbit.pivotPoint && typeof orbit.pivotPoint.copy === "function") {
    orbit.pivotPoint.copy(target);
  } else {
    orbit.pivotPoint = target.clone();
  }
  const quat = camera.getRotation();
  const yaw = typeof orbit._calcYaw === "function" ? orbit._calcYaw(quat) : DEFAULT_ENGINE_CONFIG.cameraAzimuthDeg;
  const pitch = typeof orbit._calcPitch === "function"
    ? orbit._calcPitch(quat, yaw)
    : -DEFAULT_ENGINE_CONFIG.cameraElevationDeg;
  if (typeof orbit.reset === "function") {
    orbit.reset(yaw, pitch, distance);
  } else {
    orbit.yaw = yaw;
    orbit.pitch = pitch;
    orbit.distance = distance;
  }
  orbit._updatePosition?.();
  return true;
}

interface OrbitLike {
  distanceMin?: number;
  distanceMax?: number;
  pivotPoint?: { copy?: (v: Vec3) => void; clone?: () => Vec3 } & Vec3;
  yaw?: number;
  pitch?: number;
  distance?: number;
  reset?: (yaw: number, pitch: number, distance: number) => void;
  resetAndLookAtPoint?: (resetPoint: Vec3, lookAtPoint: Vec3) => void;
  _updatePosition?: () => void;
  _calcYaw?: (quat: unknown) => number;
  _calcPitch?: (quat: unknown, yaw: number) => number;
}

function enableMeshShadows(entity: Entity): void {
  const walk = (node: Entity) => {
    const render = (node as unknown as {
      render?: { castShadows?: boolean; receiveShadows?: boolean; meshInstances?: Array<{ castShadow?: boolean; receiveShadow?: boolean }> };
    }).render;
    if (render) {
      render.castShadows = true;
      render.receiveShadows = true;
      for (const mi of render.meshInstances ?? []) {
        mi.castShadow = true;
        mi.receiveShadow = true;
      }
    }
    for (const child of node.children) walk(child as Entity);
  };
  walk(entity);
}

function collectMeshes(entity: Entity): Array<{ material?: { emissive?: { r: number; g: number; b: number; set: (r: number, g: number, b: number) => void }; update?: () => void } }> {
  const result: Array<{ material?: { emissive?: { r: number; g: number; b: number; set: (r: number, g: number, b: number) => void }; update?: () => void } }> = [];
  const walk = (node: Entity) => {
    const render = (node as unknown as { render?: { meshInstances?: Array<{ material?: { emissive?: { r: number; g: number; b: number; set: (r: number, g: number, b: number) => void }; update?: () => void } }> } }).render;
    if (render?.meshInstances) result.push(...render.meshInstances);
    for (const child of node.children) walk(child as Entity);
  };
  walk(entity);
  return result;
}

function aabbOf(root: Entity): { min: [number, number, number]; max: [number, number, number] } | null {
  let found = false;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const walk = (node: Entity) => {
    const render = (node as unknown as {
      render?: {
        meshInstances?: Array<{
          aabb?: { center?: { x: number; y: number; z: number }; halfExtents?: { x: number; y: number; z: number } };
        }>;
      };
    }).render;
    for (const mi of render?.meshInstances ?? []) {
      const box = mi.aabb;
      const c = box?.center;
      const h = box?.halfExtents;
      if (!c || !h) continue;
      found = true;
      min[0] = Math.min(min[0], c.x - h.x);
      min[1] = Math.min(min[1], c.y - h.y);
      min[2] = Math.min(min[2], c.z - h.z);
      max[0] = Math.max(max[0], c.x + h.x);
      max[1] = Math.max(max[1], c.y + h.y);
      max[2] = Math.max(max[2], c.z + h.z);
    }
    for (const child of node.children) walk(child as Entity);
  };
  walk(root);
  return found ? { min, max } : null;
}

function resolveClipEntity(clip: string, ownerNode: string | undefined, engine: EngineManager): Entity | undefined {
  if (ownerNode) {
    const owned = engine.findEntity(ownerNode);
    if (owned) return owned;
  }
  const byName = engine.model?.byName;
  if (!byName) return engine.model?.root;
  const exact = byName.get(clip);
  if (exact) return exact;
  const parts = clip.split("_");
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const key = parts.slice(0, i).join("_");
    const found = byName.get(key);
    if (found) return found;
  }
  return engine.model?.root;
}

