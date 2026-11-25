/**
 * 从 PlayCanvas `AnimTrack` 里读出它**驱动哪些节点**、**绕哪根轴转**。
 *
 * <h2>为什么要读这些</h2>
 *
 * <p>2026-11-24 客户反馈「冷热机的转动风扇只有一半」。实测结论有三条，
 * 第一条是初判、后两条是浏览器实测修正后的真相：
 *
 * <ol>
 *   <li>每台冷热机有**两组**风扇（`1_spin_fan` + `1_spin_fan_2`），
 *       叶片盘面在 XZ 平面、法线是 **Y**；</li>
 *   <li>GLB 自带动画是绕 **Y** 的，而且**绑定是通的**
 *       （实测 `evaluatorTargets: 2`）—— 不是绑错节点；</li>
 *   <li>真正的毛病是 `tickAnimations` 里写死的 `rotateLocal(0, 0, …)`（绕 **Z**）：
 *       它和动画写同一个 `localRotation`，风扇一边被动画正转、一边被代码翻跟头，
 *       下半圈钻进机壳 —— 看起来就是「只转了一半」。</li>
 * </ol>
 *
 * <p>所以本模块只做两件纯数据的事：找出转轴、找出被驱动的节点。
 * 轴向**不能写死** —— 换一套 GLB（立式泵的叶轮、卧式风机）就未必是 Y。
 */

export interface AnimTrackPathLike {
  entityPath?: string[];
  propertyPath?: string[];
}

export interface AnimCurveLike {
  paths?: AnimTrackPathLike[];
  /** 指向 `track.outputs` 的下标（PlayCanvas 2.x 用 getter + 下划线字段） */
  output?: number;
  _output?: number;
}

export interface AnimDataLike {
  data?: ArrayLike<number>;
  _data?: ArrayLike<number>;
  components?: number;
  _components?: number;
}

/**
 * `AnimTrack` 的最小结构。
 *
 * <p>字段同时兼容 getter（`curves` / `outputs`）与 2.x 的下划线存储
 * （`_curves` / `_outputs`）—— 版本升级时不会因为改名而整段失效。
 */
export interface AnimTrackLike {
  name?: string;
  _name?: string;
  curves?: AnimCurveLike[];
  _curves?: AnimCurveLike[];
  outputs?: AnimDataLike[];
  _outputs?: AnimDataLike[];
}

function curvesOf(track: AnimTrackLike | null | undefined): AnimCurveLike[] {
  return track?.curves ?? track?._curves ?? [];
}

function pathsOf(curve: AnimCurveLike | null | undefined): AnimTrackPathLike[] {
  return curve?.paths ?? (curve as { _paths?: AnimTrackPathLike[] } | null | undefined)?._paths ?? [];
}

function outputsOf(track: AnimTrackLike | null | undefined): AnimDataLike[] {
  return track?.outputs ?? track?._outputs ?? [];
}

function outputIndexOf(curve: AnimCurveLike): number | null {
  const index = curve.output ?? curve._output;
  return typeof index === "number" && index >= 0 ? index : null;
}

function animDataOf(item: AnimDataLike | undefined): { data: ArrayLike<number> | null; components: number } {
  return {
    data: item?.data ?? item?._data ?? null,
    components: item?.components ?? item?._components ?? 4,
  };
}

/** 全部有效通道路径（`entityPath` 非空）。 */
export function trackPaths(track: AnimTrackLike | null | undefined): AnimTrackPathLike[] {
  const out: AnimTrackPathLike[] = [];
  for (const curve of curvesOf(track)) {
    for (const path of pathsOf(curve)) {
      if (Array.isArray(path?.entityPath) && path.entityPath.length > 0) out.push(path);
    }
  }
  return out;
}

/**
 * 这段动画的**挂载基准**应该取哪几个节点。
 *
 * <h2>为什么不能用 `entityPath[0]`</h2>
 *
 * <p>GLB 里的路径是 `["天骄科技园","设备","1","1_model","1_spin_fan"]`，
 * 但 PlayCanvas 实例化时**丢掉了最外层的 scene 包装**，真实层级是
 * `ImportedRoot/设备/1/1_model/1_spin_fan` —— 实测 `byName.has("天骄科技园") === false`。
 * 早期设计文档里「必须挂到路径首段」的说法因此不成立（也从未生效过，
 * 因为查找失败后总是回退）。
 *
 * <h2>正确的基准：所有目标节点的最近公共祖先</h2>
 *
 * <p>PlayCanvas 的 `DefaultAnimBinder.findNode` 在路径匹配失败后，
 * 会用 `this.nodes[<末段名>]` 兜底 —— 而 `nodes` 是从**挂载点子树**摊平出来的。
 * 所以只要所有目标节点都在挂载点的子树里，绑定就能成。
 *
 * <p>注意不能用「单个目标节点」当挂载点：`1_spin_fan` 与 `1_spin_fan_2`
 * 是兄弟节点，挂在其中一个上面，另一个就**不在子树里**，
 * `findNode` 返回 `undefined`，那半边永远不动 —— 这正是「只转一半」的另一种成因。
 */
export function trackTargetNames(track: AnimTrackLike | null | undefined): string[] {
  const seen = new Set<string>();
  for (const path of trackPaths(track)) {
    const name = path.entityPath?.[path.entityPath.length - 1];
    if (name) seen.add(name);
  }
  return [...seen];
}

/** clip 名是否属于「转动」一类（`1_spin_fan`、`叶轮`…）。 */
export function isSpinClip(clip: string): boolean {
  return /spin[_-]?fan|spin[_-]?blade|叶轮|风叶/i.test(clip);
}

/** 只要能向上走父子链就够 —— 不引 PlayCanvas 类型，方便单测。 */
export interface TreeNodeLike {
  parent?: unknown;
}

/**
 * 一组节点的最近公共祖先。
 *
 * <p>用作动画播放器的挂载点：PlayCanvas 的 `findNode` 会用挂载点子树
 * 摊平出来的 `nodes` 做名字兜底，所以只要目标都在子树里绑定就能成。
 *
 * <p>单个节点时返回它自己（管道 / 阀门这类单目标 track 就是这种情况）。
 * 不同分支下没有公共祖先时返回 `null`，调用方自己回退。
 *
 * <p>★ 不能用「目标之一」当挂载点：`1_spin_fan` 与 `1_spin_fan_2` 是兄弟，
 * 挂在其中一个上，另一个就不在子树里 —— 那半边永远不动。
 */
export function nearestCommonAncestor<T extends TreeNodeLike>(nodes: T[]): T | null {
  const first = nodes[0];
  if (!first) return null;
  let ancestor: T | null = first;
  for (const node of nodes.slice(1)) {
    if (!ancestor) return null;
    const chain = new Set<T>();
    for (let cursor: T | null = ancestor; cursor; cursor = cursor.parent as T | null) {
      chain.add(cursor);
    }
    let cursor: T | null = node;
    while (cursor && !chain.has(cursor)) cursor = cursor.parent as T | null;
    ancestor = cursor;
  }
  return ancestor;
}

/**
 * 从旋转关键帧推断转轴。
 *
 * <p>不能写死 Z 轴：叶片盘面的法线由模型决定。本项目的冷热机是水平轴流风扇，
 * 盘面在 XZ 平面，法线是 **Y**；写死 Z 会让叶片翻跟头、下半圈被机壳挡住。
 *
 * <p>做法：找到 `localRotation` 通道的第一帧明显旋转（|xyz| > 0.05），
 * 归一化即为轴。全部关键帧都是 0°/360°（四元数恒等）时无法判断，返回 `null`
 * —— 宁可退回旧行为并留痕，也不要瞎猜一根轴。
 */
export function inferSpinAxis(track: AnimTrackLike | null | undefined): [number, number, number] | null {
  const outputs = outputsOf(track);
  for (const curve of curvesOf(track)) {
    const paths = pathsOf(curve);
    const isRotation = paths.some((path) =>
      (path.propertyPath ?? []).some((part) => String(part).startsWith("localRotation")),
    );
    if (!isRotation) continue;
    const index = outputIndexOf(curve);
    if (index === null) continue;
    const { data, components } = animDataOf(outputs[index]);
    /* 非四元数（例如被压成标量）时没有轴可言 */
    if (!data || components !== 4) continue;
    for (let i = 0; i + 3 < data.length; i += 4) {
      const x = Number(data[i]);
      const y = Number(data[i + 1]);
      const z = Number(data[i + 2]);
      const length = Math.hypot(x, y, z);
      if (length > 0.05) return [x / length, y / length, z / length];
    }
  }
  return null;
}
