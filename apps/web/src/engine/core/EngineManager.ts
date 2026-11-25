
import {
  Asset,
  BLEND_NONE,
  BLEND_NORMAL,
  Color,
  Entity,
  FILLMODE_NONE,
  Vec3,
  type Application,
} from "playcanvas";
import { DEFAULT_ENGINE_CONFIG } from "./EngineConfig";
import { pickDoorNodeNames, pickGaugeNodeNames, pickIndicatorNodeNames, pickSpinNodeNames } from "../animation/visual-nodes";
import {
  inferSpinAxis,
  isSpinClip,
  nearestCommonAncestor,
  trackTargetNames,
  type AnimTrackLike,
} from "../animation/track-mount";
import { disposeSharedPicker } from "../interaction/PickingManager";

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
/**
 * 引擎侧的渲染规则**默认值**。
 *
 * <h2>★ 为什么必须定义在类之前（踩过）</h2>
 *
 * <p>类字段初始化器（`private renderRules = DEFAULT_RENDER_RULES`）在
 * `new EngineManager()` 时求值。而 `const` 有 TDZ —— 如果这个常量写在
 * 文件末尾（类之后），单例构造时它还没初始化，直接抛
 * `ReferenceError: Cannot access 'DEFAULT_RENDER_RULES' before initialization`。
 *
 * <p>三个测试套件同时炸在这里，因为它们都会 import 本模块触发单例创建。
 */
export const DEFAULT_RENDER_RULES: ResolvedRenderRules = {
  pipe: { flowSpeed: 1, idleOpacity: 1 },
  valve: { openColor: "#27ae60", closedColor: "#c0392b", tintClosed: false },
  device: { statusRing: false, staleFadeMs: 0 },
};

/**
 * 推断不出转轴时手动兜底用哪根轴（2026-11-24）。
 *
 * <p>历史实现写死 Z，这里保留同一个值 —— 只是把「写死」改成「最后手段」。
 * 真正的轴由 GLB 旋转关键帧推断（见 `inferSpinAxis`）：
 * 冷热机风扇盘面在 XZ 平面、法线是 Y，绕 Z 会翻跟头、下半圈被机壳挡住，
 * 那正是「风扇只转一半」的真实原因。
 */
export const FALLBACK_SPIN_AXIS: [number, number, number] = [0, 0, 1];

/** `AnimComponentLayer` 在本项目用到的两个方法。 */
interface LayerPlayback {
  play?: (stateName?: string) => void;
  pause?: () => void;
}

/** `attachModelAnimations` 要回写到引擎实例的状态。 */
interface AnimAttachContext {
  clipLayer: Map<string, string>;
  clipLayerRef: Map<string, unknown>;
  spinAnimated: Set<Entity>;
  spinAxisByNode: Map<Entity, [number, number, number]>;
  spinClipByNode: Map<Entity, string>;
  flowSpeed: number;
}

export class EngineManager {
  static readonly instance = new EngineManager();

  app: Application | null = null;
  model: LoadedModel | null = null;
  private highlightColor = new Color(0x16 / 255, 0x57 / 255, 0xe8 / 255);
  private originalColors = new Map<string, Array<{ mesh: unknown; color: number[] }>>();
  private animationState = new Map<string, { playing: boolean; kind: string }>();
  /** 播放失败过的 clip（去重用，避免每帧刷同一条 warn） */
  private animWarned = new Set<string>();
  /**
   * clip → 所在 layer 名（2026-11-23）。
   *
   * <p>不能假设「都在 baseLayer」：`assignAnimation` 第一次调用会自动建
   * 名为 `Base` 的 layer 并把 state 设为 defaultState（**立即开始播**），
   * 之后再 assign 必须显式指定已存在的 layer。
   *
   * <p>所以挂载时把实际 layer 名记下来，播放时精确查找 ——
   * 靠猜（baseLayer / findLayer(clip)）在「同一设备两条动画」时必然错一条。
   */
  private clipLayer = new Map<string, string>();
  /**
   * clip → AnimComponentLayer **对象**（2026-11-23）。
   *
   * <h3>为什么要存对象</h3>
   *
   * <p>改流速需要拿到 `layer._controller._states[name].speed`。
   * 原来的做法是「按 clip 名反查实体 → findLayer」—— 但
   * `resolveClipEntity` 依赖命名规律，某些片段（尤其中文名、
   * 或节点被重命名）查不到时**静默跳过**，流速就永远停在 1。
   *
   * <p>挂载时那一瞬我们**手里就有 layer 对象**，直接存下来最可靠，
   * 也不需要再猜命名。
   */
  private clipLayerRef = new Map<string, unknown>();
  /**
   * 当前生效的渲染规则（2026-11-23）。
   *
   * <p>由风格套装提供（`hvac-hud-v1` 的「管三态」等）。默认值是
   * `DEFAULT_RENDER_RULES` —— 平台没给规则时行为与本次改动前完全一致，
   * 不会因为新增机制而改变旧场景的观感。
   */
  private renderRules: ResolvedRenderRules = DEFAULT_RENDER_RULES;
  /** 材质 → 原始不透明度（按对象记，不是按节点名，见 setPipeFlowing） */
  private pipeOpacity = new Map<object, number>();
  /** 每条管道当前已应用的流动状态（幂等判断用） */
  private pipeFlowState = new Map<string, boolean>();
  /**
   * 需要代码级兜底旋转的节点 → 轴向与角速度（度/秒）。
   *
   * <h3>为什么从 Set 改成 Map（2026-11-24）</h3>
   *
   * <p>原来 `tickAnimations` 写死 `rotateLocal(0, 0, dt * 180)`（绕 **Z**）。
   * 冷热机的风扇是水平轴流，叶片盘面在 XZ 平面、法线是 **Y** ——
   * 绕 Z 转等于让风扇翻跟头，下半圈钻进机壳，看起来「只转了一半」。
   * 轴向必须从 GLB 动画里推断，不能猜。
   */
  private spinNodes = new Map<Entity, { axis: [number, number, number]; speed: number }>();
  /**
   * 已被 GLB 自带动画驱动的节点。
   *
   * <p>这些节点**不能再手动转**：`setSpin` 的 `rotateLocal` 与动画通道写的是
   * 同一个 `localRotation`，谁后写谁生效 —— 同时开会抖，或者动画白播。
   */
  private spinAnimated = new Set<Entity>();
  /** 节点 → 从动画关键帧推断出的转轴（归一化）。没有记录时退回 Z 并留痕。 */
  private spinAxisByNode = new Map<Entity, [number, number, number]>();
  /**
   * 节点 → 它自己的转动 clip。
   *
   * <p>绑定里可能漏配 `clip`，此时 `DeviceStateAnimator` 只会调 `setSpin`。
   * 知道 clip 就能由引擎补播，而不是「交给动画」变成什么都不做。
   */
  private spinClipByNode = new Map<Entity, string>();
  /** 由 `setSpin` 兜底补播的节点（停机时要负责停回来）。 */
  private spinAutoPlayed = new Set<Entity>();
  private swingNodes = new Map<Entity, { kind: "gauge" | "door"; t: number; base: [number, number, number] }>();
  private tintState = new Map<string, string>();
  /**
   * 染色前的原始颜色，用于「取消染色」时**精确还原**（2026-11-23）。
   *
   * <h3>为什么必须缓存</h3>
   *
   * <p>原来的实现只把 `emissive` 归零就当作「恢复」—— 那只对「原本 emissive
   * 就是黑」的材质成立。一旦我们开始染 `diffuse`（下文的改动），
   * 不缓存原色就永远回不去，模型会带着一身洗不掉的红色。
   *
   * <p>键用材质而非 mesh：同一个材质常被多个 mesh 共享，
   * 按 mesh 缓存会重复保存同一份原色，且还原时互相覆盖。
   */
  private tintOriginal = new Map<object, { emissive: [number, number, number]; diffuse: [number, number, number] }>();
  private spinState = new Map<string, boolean>();
  private indicatorState = new Map<string, boolean>();
  private swingState = new Map<string, string>();
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
    disposeSharedPicker(this.app);
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
    /*
     * ★ 把 GLB 动画挂到对应节点上（2026-11-23 修复「管道不流动」）。
     *
     * <h3>为什么原来全都不动</h3>
     *
     * <p>PlayCanvas 的 `instantiateRenderEntity()` **只造渲染实体，不建 AnimComponent**。
     * glTF 的 94 条动画被加载成独立的 animation asset（`model_N/animation/i`），
     * 名字完好（`L-101-1_flow`、`1_spin_fan`…），但**没有任何节点持有播放器**。
     *
     * <p>于是 `playNamedAnimation` 里那两行
     * `anim.animation?.play?.(clip)` / `anim.anim?.baseLayer?.play?.(clip)`
     * 的每一层可选链都命中 undefined，被 try/catch 静默吞掉 ——
     * 风扇能转（靠 `setSpin` 手动旋转），管道却永远静止（只能靠动画片段）。
     *
     * <p>实测证据：`animAssets=94`、`flowAnimAssets=40`、`pipeHasAnim=false`。
     * 数据齐全、场景正确，缺的只是播放器。
     *
     * <h3>命名规律</h3>
     *
     * <p>动画名 = `<节点名>_<动作后缀>`，后缀是固定集合
     * （flow / open / close / on / off / spin_fan / blink_led / swing_gauge / swing_door）。
     * 反推节点名用 `stripClipSuffix`。94 条全部符合这条规律
     * （含中文名如 `立式管道离心泵_2_swing_gauge` → `立式管道离心泵_2`）。
     */
    /*
     * 传入当前规则里的流速（2026-11-23）。
     *
     * <p>★ 时序：`setRenderRules` 通常在场景文档就绪时调用，
     * 而模型可能**更晚**才加载完成。此时 `clipLayer` 还是空的，
     * `setRenderRules` 里那个"遍历已挂载动画改速度"的循环什么也没做 ——
     * 结果是规则取到了、日志对了、但流速永远是 1。
     *
     * <p>所以挂载动画时必须带上当前规则值，而不是假定之后会有人来改。
     */
    attachModelAnimations(app, asset, byName, {
      clipLayer: this.clipLayer,
      clipLayerRef: this.clipLayerRef,
      spinAnimated: this.spinAnimated,
      spinAxisByNode: this.spinAxisByNode,
      spinClipByNode: this.spinClipByNode,
      flowSpeed: this.renderRules.pipe.flowSpeed,
    });
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
    this.clipLayer.clear();
    this.clipLayerRef.clear();
    this.animWarned.clear();
    this.pipeOpacity.clear();
    this.pipeFlowState.clear();
    this.spinNodes.clear();
    this.spinAnimated.clear();
    this.spinAxisByNode.clear();
    this.spinClipByNode.clear();
    this.spinAutoPlayed.clear();
    this.swingNodes.clear();
    this.tintState.clear();
    /*
     * 材质原色也必须清空：模型换了，旧的材质引用已经失效。
     * 不清的话，新模型里恰好事复用同一个材质对象时，会把上个模型的
     * 颜色当成「原色」写回去 —— 颜色错得更隐蔽。
     */
    this.tintOriginal.clear();
    this.spinState.clear();
    this.indicatorState.clear();
    this.swingState.clear();
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

  /**
   * 应用风格套装的渲染规则（2026-11-23）。
   *
   * <h3>两件事必须同时做</h3>
   *
   * <ol>
   *   <li><b>存起来</b> —— 之后新挂载的动画、新流入的阀门状态要用它；</li>
   *   <li><b>立刻对已挂载的东西生效</b> —— 规则可能在模型加载完成后才到
   *       （场景元数据是异步取的）。只存不应用，用户要等到刷新才看见变化。</li>
   * </ol>
   *
   * <p>这里只处理「流速」这一项能立刻生效的。管道透明度与阀门颜色依赖
   * 当前流动/开关状态，由 `DeviceStateAnimator` 下一帧按规则重新决定 ——
   * 那处本来每帧都在算，不需要在这里补一遍。
   */
  setRenderRules(raw?: Parameters<typeof mergeRenderRules>[0] | null): void {
    this.renderRules = mergeRenderRules(raw);

    /* 已挂载的流动动画立即改用新速度 */
    const speed = this.renderRules.pipe.flowSpeed;
    for (const [clip, layer] of this.clipLayerRef) {
      if (!clip.endsWith("_flow")) continue;
      this.applyLayerSpeed(layer, speed);
    }
  }

  getRenderRules(): ResolvedRenderRules {
    return this.renderRules;
  }

  /**
   * 设置某段动画的播放速率。
   *
   * <h3>为什么改 `state.speed` 而不是重新 assign</h3>
   *
   * <p>`assignAnimation(path, track, speed)` 也能设速度，但它会重建 evaluator，
   * 正在播的流动会**跳回第一帧**。改 `controller._states[name].speed`
   * 是热更新，画面连续。
   *
   * <p>`_states` 是私有字段（PlayCanvas 2.x 没有公开 accessor），
   * 所以整段放在 try 里：拿不到就跳过，流速维持原样 —— 不能因为
   * 一个私有字段改名就让整个渲染崩掉。
   */
  /**
   * 直接对 layer 对象改播放速率（2026-11-23）。
   *
   * <p>改 `controller._states[name].speed` 是**热更新**：
   * 画面连续，不会像重新 `assignAnimation` 那样跳回第一帧。
   *
   * <p>`_states` 是 PlayCanvas 私有字段（2.x 无公开 accessor），
   * 所以整段包在 try 里 —— 字段改名时流速不生效，但画面不能崩。
   */
  private applyLayerSpeed(layer: unknown, speed: number): void {
    try {
      const states = (layer as { _controller?: { _states?: Record<string, { speed?: number }> } })
        ?._controller?._states;
      if (!states) return;
      for (const state of Object.values(states)) {
        state.speed = speed;
      }
    } catch {
      /* 私有结构变了：流速不生效，但不动画更不能崩 */
    }
  }

  /**
   * 管道透明度（对应套装的 `pipe.idleOpacity`）。
   *
   * <h3>为什么用整棵子树而不是单个 mesh</h3>
   *
   * <p>一条管段在 GLB 里通常拆成多个 mesh（直管 + 法兰 + 弯头）。
   * 只改 `entity.render` 会让其它部件还亮着，看起来像"改了一半"。
   *
   * <p>流动时恢复原值 —— 原值在第一次改动时记下来，
   * 不能假设是 1（有的材质本来就半透明）。
   */
  setPipeFlowing(nodeName: string, flowing: boolean): void {
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    /*
     * ★ 幂等（每帧都会调，见 DeviceStateAnimator 的说明）。
     *
     * 状态没变就直接返回 —— 否则每帧对整棵子树的材质做 `update()`，
     * 9 台设备的管道加起来上百个 mesh，会是白白的 GPU 上传。
     */
    const applied = this.pipeFlowState.get(nodeName);
    if (applied === flowing) return;
    this.pipeFlowState.set(nodeName, flowing);

    const target = flowing ? null : this.renderRules.pipe.idleOpacity;
    for (const mi of collectMeshes(entity)) {
      const mat = mi.material;
      if (!mat || typeof mat.opacity !== "number") continue;
      /*
       * ★ 按**材质对象**记原值，不是按 nodeName。
       *
       * 一条管段常拆成多个 mesh（直管 / 法兰 / 弯头），各自的初始
       * opacity 可能不同（有的本来就带半透明）。按节点记一个值，
       * 恢复时会把它们全都抹成同一个数字。
       */
      if (!this.pipeOpacity.has(mat)) this.pipeOpacity.set(mat, mat.opacity);
      if (target == null) {
        const original = this.pipeOpacity.get(mat) ?? 1;
        mat.opacity = original;
        /* 恢复时只在真的不透明时才关混合，避免把本来半透明的材质改坏 */
        if (original >= 1) mat.blendType = BLEND_NONE;
      } else {
        mat.opacity = target;
        /*
         * ★ 必须设 blendType，不能设 transparent。
         *
         * 实测：`mat.transparent = true` 抛
         * `TypeError: Cannot set property transparent of #<Material> which has only a getter`。
         * transparent 是由 blendType 推导出来的只读属性。
         * `blendType = BLEND_NORMAL` 之后 transparent 自动变 true。
         */
        if (mat.opacity < 1) mat.blendType = BLEND_NORMAL;
      }
      mat.update?.();
    }
  }

  /**
   * 阀门开/关染色（对应套装的 `valve.openColor` / `closedColor`）。
   *
   * <p>复用 `tintStatus`：它已经处理了「按子树收集 mesh、改 emissive、
   * 记录状态避免重复写」这几件事。阀门只是把它换个调用者。
   *
   * <p>`tintClosed === false` 时**只给关闭的染色，开启的不染** ——
   * 开启状态本来就该是模型原色，全染成绿色会让整屏失真。
   */
  setValveTint(nodeName: string, open: boolean): void {
    const rules = this.renderRules.valve;
    if (open || !rules.tintClosed) {
      this.tintStatus(nodeName, null);
      return;
    }
    this.tintStatus(nodeName, rules.closedColor);
  }

  /**
   * 按状态给设备染色（2026-11-23 重写）。
   *
   * <h2>旧实现的问题</h2>
   *
   * <p>只改 `emissive`（强度 0.4）。客户反馈「故障的设备看不到红色」——
   * 原因是**自发光对浅色/金属材质几乎不起作用**：很多 GLB 导出时
   * emissive 就是黑的，叠 0.4 倍红色只得到一层很淡的喙，远处看和正常机
   * 没区别。而大屏是 3 米外看的，必须要能一眼分辨。
   *
   * <h2>新实现：两层叠加</h2>
   *
   * <ol>
   *   <li><b>emissive</b> 强度 0.4 → 0.7，带颜色的自发光自己会亮，
   *       不依赖环境光；</li>
   *   <li><b>diffuse 向状态色混合 45%</b> —— 这是「看得到」的关键。
   *       漫反射是环境光下的主体颜色，改它才能让机身真正变红。
   *       不直接用 100% 是因为那会把模型的贴图/明暗全抹平，
   *       看上去像一个红色塑料块而不是「一台发红的设备」。</li>
   * </ol>
   *
   * <h2>为什么必须缓存原色</h2>
   *
   * <p>一旦开始改 `diffuse`，「把 emissive 归零」就不再等于恢复原样 ——
   * 必须按材质保存原始 emissive / diffuse，取消染色时逐项写回。
   * 不缓存的话，一台设备报警过一次就会永远带着红色（实测场景：
   * 故障恢复后数字已经变绿，3D 里的机器还是红的，自相矛盾）。
   *
   * <h2>已知局限：共享材质</h2>
   *
   * <p>若同一个材质被多台设备共用，给一台染色会同时影响其他设备。
   * 彻底解决需要克隆材质（破坏实例合批，逐台克隆会明显增加 draw call），
   * 所以**暂不做**。当前模型每台机组有独立的 mesh 与材质，不受影响；
   * 若将来接入共享材质的模型，应该先确认再决定是否克隆。
   */
  tintStatus(nodeName: string, hex: string | null): void {
    const next = hex ?? "";
    if (this.tintState.get(nodeName) === next) return;
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    this.tintState.set(nodeName, next);
    const color = hex ? new Color().fromString(hex) : null;
    /* 同一材质只处理一次：子树里多个 mesh 常共享同一份材质 */
    const seen = new Set<object>();
    for (const mi of collectMeshes(entity)) {
      const mat = mi.material;
      if (!mat || seen.has(mat)) continue;
      seen.add(mat);
      /*
       * 首次遇到这个材质时先存档原色。
       * 存档发生在任何写入之前，所以存下来的确实是模型的本来颜色。
       */
      let origin = this.tintOriginal.get(mat);
      if (!origin) {
        const e = mat.emissive;
        const d = mat.diffuse;
        origin = {
          emissive: [e?.r ?? 0, e?.g ?? 0, e?.b ?? 0],
          diffuse: [d?.r ?? 0, d?.g ?? 0, d?.b ?? 0],
        };
        this.tintOriginal.set(mat, origin);
      }
      if (!color) {
        /* 取消染色：按存档精确写回，而不是假设原色是黑/白 */
        mat.emissive?.set(origin.emissive[0], origin.emissive[1], origin.emissive[2]);
        mat.diffuse?.set(origin.diffuse[0], origin.diffuse[1], origin.diffuse[2]);
      } else {
        mat.emissive?.set(color.r * 0.7, color.g * 0.7, color.b * 0.7);
        if (mat.diffuse) {
          const mix = 0.45;
          mat.diffuse.set(
            origin.diffuse[0] * (1 - mix) + color.r * mix,
            origin.diffuse[1] * (1 - mix) + color.g * mix,
            origin.diffuse[2] * (1 - mix) + color.b * mix,
          );
        }
      }
      mat.update?.();
    }
  }

  setSpin(nodeName: string, playing: boolean): void {
    if (this.spinState.get(nodeName) === playing) return;
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    this.spinState.set(nodeName, playing);
    // 只转 spin_fan / 叶轮，不要把带 fan 字样的机柜或风圈转起来
    const named = collectSubtree(entity).filter((node) => node !== entity);
    const picked = new Set(pickSpinNodeNames(named.map((node) => node.name || "")));
    if (!playing) {
      for (const node of collectSubtree(entity)) {
        this.spinNodes.delete(node);
        /*
         * 补播的动画也得停下 —— 否则「设备已停机、风扇还在转」。
         * 只停我们自己的（`spinAutoPlayed`），不动业务驱动的 layer。
         */
        if (!this.spinAutoPlayed.delete(node)) continue;
        const clip = this.spinClipByNode.get(node);
        if (clip) this.pauseClip(clip);
      }
      return;
    }
    for (const node of named) {
      if (!picked.has(node.name)) continue;
      /*
       * 有 GLB 自带动画的节点交给动画，不要手动转。
       * 两者写同一个 `localRotation`：手动转会把动画覆盖掉（或反过来抖）。
       *
       * <p>但绑定里可能漏配 clip，那时没人会调 `playNamedAnimation` ——
       * 「交给动画」就变成什么都不做。所以这里按已知 clip 补播。
       *
       * <p>补播**不进 `animationState`**：那是业务状态的账本，
       * 写进去会让「业务说停机」和「兜底说转」互相覆盖，事后看不出谁干的。
       */
      if (this.spinAnimated.has(node)) {
        const clip = this.spinClipByNode.get(node);
        if (clip && !this.isClipManaged(clip)) {
          this.playClipDirect(clip);
          this.spinAutoPlayed.add(node);
        }
        continue;
      }
      const axis = this.spinAxisByNode.get(node) ?? FALLBACK_SPIN_AXIS;
      this.spinNodes.set(node, { axis, speed: 180 });
    }
  }

  /** 直接对 layer 播放，绕过 `animationState`（供 `setSpin` 兜底用）。 */
  private playClipDirect(clip: string): void {
    const layer = this.clipLayerRef.get(clip) as LayerPlayback | undefined;
    layer?.play?.(clip.split(".")[0]);
  }

  private pauseClip(clip: string): void {
    const layer = this.clipLayerRef.get(clip) as LayerPlayback | undefined;
    layer?.pause?.();
  }

  /** 这个 clip 是否已经由 `playNamedAnimation` 接管（不管调用方传的是哪个 ownerNode）。 */
  private isClipManaged(clip: string): boolean {
    if (this.animationState.has(clip)) return true;
    const tail = `:${clip}`;
    for (const key of this.animationState.keys()) {
      if (key.endsWith(tail)) return true;
    }
    return false;
  }

  setIndicator(nodeName: string, on: boolean): void {
    if (this.indicatorState.get(nodeName) === on) return;
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    this.indicatorState.set(nodeName, on);
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
    for (const [entity, motion] of this.spinNodes) {
      /*
       * 绕**推断出的轴**转，不再写死 Z（2026-11-24）。
       * 参数是角度制，和 `setLocalEulerAngles` 一致。
       */
      const degrees = motion.speed * dt;
      entity.rotateLocal(
        motion.axis[0] * degrees,
        motion.axis[1] * degrees,
        motion.axis[2] * degrees,
      );
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
    const next = `${playing ? "1" : "0"}:${kind}`;
    if (this.swingState.get(nodeName) === next) return;
    const entity = this.findEntity(nodeName);
    if (!entity) return;
    this.swingState.set(nodeName, next);
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
    const key = ownerNode ? `${ownerNode}:${clip}` : clip;
    const prev = this.animationState.get(key);
    if (prev?.playing === play) return;
    const root = this.model?.root;
    const app = this.app;
    if (!root || !app) return;
    this.animationState.set(key, { playing: play, kind: clip });
    const entity = resolveClipEntity(clip, ownerNode, this) ?? root;
    /*
     * 播放（2026-11-23 重写）。
     *
     * <h3>为什么要找 layer，而不是只用 baseLayer</h3>
     *
     * <p>`attachModelAnimations` 给每段动画单独建了一个**同名 layer**
     * （`assignAnimation(clip, track, clip)`）。同一台设备常有两段动画
     * （风扇 + 指示灯）要同时播；都塞进 base layer 会互相顶掉，只剩一条。
     *
     * <p>所以这里按 clip 名找它自己的 layer。找不到再退回 baseLayer ——
     * 兼容旧模型（只有 base layer 的那种）。
     *
     * <h3>为什么 stop 而不是销毁</h3>
     *
     * <p>`stop()` 停在当前帧，再 `play()` 能接着走，不重建 state。
     * 管道每天开关几十次，反复 assign 会不断分配 AnimEvaluator。
     */
    const anim = entity as unknown as {
      anim?: {
        findLayer?: (name: string) => LayerPlayback | null;
        baseLayer?: LayerPlayback;
      };
      /* 旧版 AnimationComponent（某些导出会带），保留兜底 */
      animation?: { play?: (name: string) => void; stop?: () => void };
    };
    try {
      /*
       * ★ 优先用挂载时存下的 **layer 对象**（2026-11-24）。
       *
       * <p>挂载点已改为 track 自己的场景根（`trackMountName`），
       * 不再是 `stripClipSuffix` 算出来的设备根。再按 `ownerNode`（设备根）
       * 去 `findLayer` 就必然找不到 —— layer 长在场景根那个组件上。
       *
       * <p>挂载时我们手里就有 layer 对象，直接存下来最可靠，也不需要猜命名。
       */
      const stored = this.clipLayerRef.get(clip) as LayerPlayback | undefined;
      /* state 名 = clip 的 `.` 前部分（与 `AnimController.assignAnimation` 一致） */
      const stateName = clip.split(".")[0];
      const layerName = this.clipLayer.get(clip) ?? null;
      const layer = (layerName ? anim.anim?.findLayer?.(layerName) : null)
        ?? anim.anim?.findLayer?.(clip)
        ?? null;
      if (play) {
        if (stored?.play) stored.play(stateName);
        else if (layer?.play) layer.play(stateName);
        else anim.anim?.baseLayer?.play?.(stateName);
        anim.animation?.play?.(clip);
      } else {
        /*
         * 用 pause 而不是 stop：AnimComponentLayer 只有 play/pause/reset。
         * 原先写的 `layer.stop?.()` 命中 undefined，可选链静默跳过 ——
         * 结果所有 layer 一直 playing（阀门 open 与 close 同时播）。
         * 旧版 AnimationComponent 那条路径保留 stop（它确实有）。
         */
        if (stored?.pause) stored.pause();
        else if (layer?.pause) layer.pause();
        else anim.anim?.baseLayer?.pause?.();
        anim.animation?.stop?.();
      }
    } catch {
      /*
       * 动画面板缺组件时不要抛 —— 风扇/摆针有代码级回退。
       * 但**不要静默**：这正是「管道不流动却毫无痕迹」的来源，
       * 首次失败打一条 warn 便于排查。
       */
      if (!this.animWarned.has(clip)) {
        this.animWarned.add(clip);
        console.warn(`[engine] 动画片段播放失败：${clip}（节点 ${entity.name}）`);
      }
    }
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

/*
 * 开发态把引擎单例挂到 `globalThis`（2026-11-24）。
 *
 * <h3>为什么需要</h3>
 *
 * <p>验收脚本（`scripts/verify-fan-spin.mjs`）要在页面里读**正在跑的那个**引擎状态。
 * 通过 `import('/src/engine/...')` 拿到的是**另一个模块实例** ——
 * Vite 的模块 URL 带时间戳，同一份源码会被实例化两次，
 * `model` 永远是 null。实测踩过。
 *
 * <p>生产构建里 `DEV` 为 false，不挂 —— 不给线上留调试口。
 */
if (import.meta.env?.DEV && typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).__idtEngine = EngineManager.instance;
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

/**
 * 我们会碰到的材质字段（PlayCanvas StandardMaterial 的子集）。
 *
 * <p>用结构化类型而不是导 `StandardMaterial`：同一份代码要兼容
 * 基础材质（没有 emissive），而具体类在 2.x 里变动过几次。
 */
interface TintableMaterial {
  emissive?: { r: number; g: number; b: number; set: (r: number, g: number, b: number) => void };
  /**
   * 漫反射颜色（2026-11-23 新增）。
   *
   * <p>不是所有材质都有 —— 纯 shader / 贴图叠加材质可能没这个属性，
   * 所以保持可选，用 `if (mat.diffuse)` 守卫。
   *
   * <p>为什么必须能改它：设备故障要「看得见红」。只调 `emissive`
   * 对浅色/金属材质几乎无效（实测 GLB 里 emissive 常为黑），
   * 而 `diffuse` 是环境光下的主体颜色，改它才真能让机身变色。
   */
  diffuse?: { r: number; g: number; b: number; set: (r: number, g: number, b: number) => void };
  /** 0~1，需配合 blendType !== BLEND_NONE 才生效 */
  opacity?: number;
  /**
   * 只读推导属性（`blendType !== BLEND_NONE`）。
   *
   * <p>**不要赋值** —— 它是 getter-only，赋值直接抛
   * `TypeError: Cannot set property transparent of #<Material> which has only a getter`。
   * 要开透明请设 {@link blendType}。
   */
  readonly transparent?: boolean;
  /**
   * 混合模式。`2` = BLEND_NORMAL（透明），`3` = BLEND_NONE（不透明）。
   *
   * <p>这是唯一能开/关透明的**可写**入口 —— 设成 2 之后 `transparent`
   * 会自己变成 true（实测确认）。
   */
  blendType?: number;
  update?: () => void;
}

function collectMeshes(entity: Entity): Array<{ material?: TintableMaterial }> {
  const result: Array<{ material?: TintableMaterial }> = [];
  const walk = (node: Entity) => {
    const render = (node as unknown as { render?: { meshInstances?: Array<{ material?: TintableMaterial }> } }).render;
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


/**
 * 由动画名反推它所属的节点名（2026-11-23）。
 *
 * <p>后缀集合来自 GLB 实测（94 条动画无一例外）：
 * `L-101-1_flow`、`V-101_open`、`1_spin_fan`、`PLC控制柜_2_blink_led`。
 *
 * <p>不能用「最后一个下划线之前」——`1_spin_fan` 会得到 `1_spin`（错），
 * 而 `V-101_open` 的节点名里本身就有下划线也不成立。
 * 必须按**已知后缀**剥，剥不掉就返回 null（宁可不动，也不要绑错节点）。
 */
const CLIP_SUFFIXES = [
  "flow",
  "spin_fan",
  "blink_led",
  "swing_gauge",
  "swing_door",
  "open",
  "close",
  "on",
  "off",
] as const;

export function stripClipSuffix(clip: string): string | null {
  for (const suffix of CLIP_SUFFIXES) {
    const tail = `_${suffix}`;
    if (clip.length > tail.length && clip.endsWith(tail)) {
      return clip.slice(0, -tail.length);
    }
  }
  return null;
}

/**
 * 给每段动画建播放器，并把它注册成独立 layer。
 *
 * <h3>★ 挂载点必须是「所有目标节点的公共祖先」（2026-11-24 实测修正）</h3>
 *
 * <p>试过两条错的路，记下来免得重踩：
 *
 * <ul>
 *   <li><b>按 `entityPath[0]` 找场景根</b> —— GLB 里首段是「天骄科技园」，
 *       但 PlayCanvas 实例化时丢掉了那层包装，实测 `byName.has("天骄科技园") === false`，
 *       这条查找永远失败（失败后总是回退，所以此前从未被发现）。</li>
 *   <li><b>按 `stripClipSuffix` 找单个目标节点</b> —— `1_spin_fan` 和 `1_spin_fan_2`
 *       是兄弟，挂在其中一个上，另一个就不在子树里，`findNode` 返回 `undefined`，
 *       那半边永远不动。</li>
 * </ul>
 *
 * <p>正确做法：取所有目标节点的**最近公共祖先**。PlayCanvas 的
 * `findNode` 路径匹配失败后会用 `nodes[<末段名>]` 兜底，而 `nodes` 是
 * 从挂载点子树摊平的 —— 只要目标都在子树里就行。
 *
 * <p>实测（挂到 `1` 上）：`binderNodes: 37`、`hasFanNode: true`、`evaluatorTargets: 2`
 * —— 两个风扇都绑上了。所以问题从来不是「绑不上」，而是下面的手动旋转抢写。
 *
 * <h3>为什么每段动画一个 layer</h3>
 *
 * <p>`baseLayer` 同一时刻只能播一个 state。同一台设备身上常有两条动画
 * （`1_spin_fan` + `1_blink_led`，风扇和指示灯要同时动），
 * 塞进同一个 base layer 会互相顶掉 —— 只剩最后播的那条。
 *
 * <p>所以用 `assignAnimation(clip, track, clip)`：state 名与 layer 名都取 clip 名，
 * 一段动画一条 layer，互不干扰。`playNamedAnimation` 直接用挂载时存下的 layer 对象。
 */
function attachModelAnimations(
  app: Application,
  asset: Asset,
  byName: Map<string, Entity>,
  ctx: AnimAttachContext,
): void {
  const { clipLayer, clipLayerRef, spinAnimated, spinAxisByNode, spinClipByNode, flowSpeed } = ctx;
  /*
   * PlayCanvas 把 glTF 动画拆成独立 asset，命名 `<containerName>/animation/<i>`。
   * 不依赖 `asset.resource.animations` —— 实测它是 null（2.x 已改结构）。
   */
  const prefix = `${asset.name}/animation/`;
  const tracks = app.assets.filter(
    /* `Boolean(...)` 不能省：`item.resource` 是 unknown，filter 谓词必须返回 boolean */
    (item) => item.type === "animation" && item.name.startsWith(prefix) && Boolean(item.resource),
  );
  if (!tracks.length) return;

  /*
   * 按**挂载点**分组（目标节点的公共祖先）。同一实体上的多条动画共享一个
   * AnimComponent，各占一条 layer。
   */
  const byEntity = new Map<Entity, Array<{ clip: string; track: AnimTrackLike }>>();
  const missing: string[] = [];
  let spinClips = 0;
  const spinAxisVotes = new Map<string, number>();
  for (const trackAsset of tracks) {
    const track = trackAsset.resource as AnimTrackLike;
    const clip = track?.name ?? track?._name;
    if (!clip) continue;
    /*
     * 挂载点 = 所有目标节点的最近公共祖先（详见图上方的说明）。
     * 目标一个都找不到时才回退到按 clip 名剥后缀的那个设备节点。
     */
    const targetEntities = trackTargetNames(track)
      .map((name) => byName.get(name))
      .filter((item): item is Entity => Boolean(item));
    const entity =
      nearestCommonAncestor(targetEntities) ?? byName.get(stripClipSuffix(clip) ?? "");
    if (!entity) {
      missing.push(clip);
      continue;
    }
    const list = byEntity.get(entity) ?? [];
    list.push({ clip, track });
    byEntity.set(entity, list);

    /*
     * 转动类动画额外记两件事：
     *  1. 目标节点由 GLB 驱动 → `setSpin` 不得再手动转；
     *  2. 从关键帧推断转轴 → 无动画时的代码级兜底才有正确方向。
     */
    if (!isSpinClip(clip)) continue;
    spinClips += 1;
    const axis = inferSpinAxis(track);
    if (axis) {
      const key = axis.map((item) => item.toFixed(2)).join(",");
      spinAxisVotes.set(key, (spinAxisVotes.get(key) ?? 0) + 1);
    }
    for (const name of trackTargetNames(track)) {
      const target = byName.get(name);
      if (!target) continue;
      spinAnimated.add(target);
      spinClipByNode.set(target, clip);
      if (axis) spinAxisByNode.set(target, axis);
    }
  }
  if (missing.length) {
    /*
     * 不要静默：挂载点找不到就意味着这段动画永远不会动。
     * 只打一条汇总，避免 94 条 track 刷满控制台。
     */
    console.warn(
      `[engine] ${missing.length} 段动画找不到挂载节点，已跳过：${missing.slice(0, 5).join("、")}${missing.length > 5 ? "…" : ""}`,
    );
  }

  let attached = 0;
  for (const [entity, clips] of byEntity) {
    try {
      /*
       * `addComponent` 的第二个参数是 **ComponentData 普通对象**，不是组件实例
       * （2.x 签名：`addComponent(type, data?)`）。
       */
      if (!entity.anim) entity.addComponent("anim", { activate: true });
      const anim = entity.anim as unknown as {
        assignAnimation: (nodePath: string, track: unknown, layerName?: string, speed?: number, loop?: boolean) => void;
        addLayer: (name: string, weight?: number) => unknown;
        findLayer?: (name: string) => LayerPlayback | null;
        baseLayer?: LayerPlayback;
      };

      /*
       * ★ 第一段动画不传 layerName：`assignAnimation` 会**自动建 stateGraph**
       *   （layer 名 `Base`、state 名 = clip、并设为 defaultState）。
       *   代价是它立刻开始播 —— 必须马上 stop，把启停权交给 playNamedAnimation，
       *   否则「阀门关着管道却在流」。
       *
       * ★ 之后每段都 `addLayer(clip)` 再 assign 到那条 layer。
       *   不先建 layer 就 assign，PlayCanvas 只打一行 error 然后**静默返回** ——
       *   我第一版就是这么踩的（日志里一串 "layer that doesn't exist"）。
       */
      const [first, ...rest] = clips;
      if (!first) continue;
      /*
       * 第三参数是速度 —— 流动片段用规则值，其它保持 1。
       * 只对 `_flow` 应用：风扇转慢会像卡顿，阀门开合慢会显得迟钝。
       */
      const speedFor = (clip: string) => (clip.endsWith("_flow") ? flowSpeed : 1);
      anim.assignAnimation(first.clip, first.track, undefined, speedFor(first.clip));
      /* AnimComponentLayer 没有 stop，只有 pause —— 见 playNamedAnimation 的说明 */
      anim.baseLayer?.pause?.();
      clipLayer.set(first.clip, "Base");
      /* 存 layer 对象：之后改流速不必再按名字找 */
      if (anim.baseLayer) clipLayerRef.set(first.clip, anim.baseLayer);
      attached += 1;

      for (const item of rest) {
        anim.addLayer(item.clip, 1);
        anim.assignAnimation(item.clip, item.track, item.clip, speedFor(item.clip));
        clipLayer.set(item.clip, item.clip);
        const created = anim.findLayer?.(item.clip);
        if (created) clipLayerRef.set(item.clip, created);
        attached += 1;
      }
      /*
       * 新挂上的动画一律先暂停：状态由 DeviceStateAnimator 决定，不由"谁先注册"决定。
       * （`addLayer` + `assignAnimation` 之后 layer 默认就在播 —— 实测阀门
       *   open/close 两条同时 playing，视觉上互相顶掉。）
       */
      for (const item of rest) {
        anim.findLayer?.(item.clip)?.pause?.();
      }
    } catch {
      /* 单台设备失败不影响其余；缺动画的只是这一路动作不动 */
    }
  }
  if (attached) {
    const axisNote = spinClips
      ? `，其中 ${spinClips} 段转动动画（轴 ${[...spinAxisVotes.keys()].join(" / ") || "未能推断"}）`
      : "";
    console.info(
      `[engine] 已为 ${attached} 段 GLB 动画挂载播放器（${byEntity.size} 个挂载点${axisNote}）`,
    );

    /*
     * ★ 显式设速度，不依赖 `assignAnimation` 的 speed 参数（2026-11-23）。
     *
     * <p>实测：`assignAnimation(clip, track, undefined, 0.8)` 传了 speed，
     * 但读回 `_controller._states[name].speed` 仍是 **1**。原因是组件方法
     * 只在「首次建 stateGraph」时把 speed 写进 state；后续路径走
     * `layer.assignAnimation(path, track, speed, loop)`，那一层对已存在的
     * state **不会更新 speed**。
     *
     * <p>直接改 `state.speed` 是确定生效的（热更新，画面连续）。
     * 与其和 API 的隐式行为较劲，不如显式写一次。
     */
    for (const [clip, layer] of clipLayerRef) {
      if (!clip.endsWith("_flow")) continue;
      try {
        const st = (layer as { _controller?: { _states?: Record<string, { speed?: number }> } })
          ?._controller?._states;
        if (st) for (const state of Object.values(st)) state.speed = flowSpeed;
      } catch { /* 私有字段结构变了：维持原速，不影响画面 */ }
    }


  }
}

/* ==================================================================== */
/* 风格套装渲染规则（2026-11-23）                                       */
/* ==================================================================== */

/**
 * 引擎侧的渲染规则（已填好默认值）。
 *
 * <h2>为什么在引擎里再定义一份默认值</h2>
 *
 * <p>平台可能给的是空对象、缺字段、或者旧版本没有 `render`。
 * 引擎必须能"拿到多少用多少，缺的走默认" —— 不能因为缺一个字段
 * 整份规则失效、更不能因此不渲染。
 */
export interface ResolvedRenderRules {
  pipe: { flowSpeed: number; idleOpacity: number };
  valve: { openColor: string; closedColor: string; tintClosed: boolean };
  device: { statusRing: boolean; staleFadeMs: number };
}


/**
 * 把平台给的（可能残缺的）规则合并到默认值上。
 *
 * <p>数值做范围收敛：`flowSpeed <= 0` 会让动画倒放或卡死，
 * `idleOpacity` 超出 0~1 会被 PlayCanvas 当成非法值。
 */
export function mergeRenderRules(
  raw?: {
    pipe?: { flowSpeed?: number; idleOpacity?: number };
    valve?: { openColor?: string; closedColor?: string; tintClosed?: boolean };
    device?: { statusRing?: boolean; staleFadeMs?: number };
  } | null,
): ResolvedRenderRules {
  const clamp = (v: number | undefined, lo: number, hi: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
  return {
    pipe: {
      flowSpeed: clamp(raw?.pipe?.flowSpeed, 0.1, 4, DEFAULT_RENDER_RULES.pipe.flowSpeed),
      idleOpacity: clamp(raw?.pipe?.idleOpacity, 0.1, 1, DEFAULT_RENDER_RULES.pipe.idleOpacity),
    },
    valve: {
      openColor: raw?.valve?.openColor || DEFAULT_RENDER_RULES.valve.openColor,
      closedColor: raw?.valve?.closedColor || DEFAULT_RENDER_RULES.valve.closedColor,
      tintClosed: raw?.valve?.tintClosed ?? DEFAULT_RENDER_RULES.valve.tintClosed,
    },
    device: {
      statusRing: raw?.device?.statusRing ?? DEFAULT_RENDER_RULES.device.statusRing,
      staleFadeMs: clamp(raw?.device?.staleFadeMs, 0, 86_400_000, DEFAULT_RENDER_RULES.device.staleFadeMs),
    },
  };
}
