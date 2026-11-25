import { describe, expect, it } from "vitest";
import {
  inferSpinAxis,
  isSpinClip,
  nearestCommonAncestor,
  trackTargetNames,
  type AnimTrackLike,
  type TreeNodeLike,
} from "./track-mount";

const SCENE_ROOT = "天骄科技园";

/**
 * 复刻 `天骄科技园.glb` 里的 `1_spin_fan`：
 * 两个风扇节点、绕 **Y** 轴、5 帧转满 360°。
 *
 * 关键点：`entityPath` 是**完整场景路径**，首段是场景根而不是设备名 `1`。
 * 这正是「挂错节点 → 动画静默失效」的现场。
 */
function spinTrack(name = "1_spin_fan"): AnimTrackLike {
  const rotation = new Float32Array([
    0, 0, 0, 1,
    0, 0.6142, 0, 0.7891,
    0, 0.9966, 0, 0.0826,
    0, 0.7357, 0, -0.6773,
    0, 0, 0, -1,
  ]);
  const paths = ["1_spin_fan", "1_spin_fan_2"].map((target) => ({
    entityPath: [SCENE_ROOT, "设备", "1", "1_model", target],
    component: "graph",
    propertyPath: ["localRotation"],
  }));
  return {
    name,
    curves: paths.map((path) => ({ paths: [path], output: 0 })),
    outputs: [{ components: 4, data: rotation }],
  };
}

/* 构造一棵最小树：用一个普通对象挂 parent 指针，和 PlayCanvas 的 Entity 同构 */
interface FakeNode extends TreeNodeLike {
  name: string;
  parent?: FakeNode;
}
function node(name: string, parent?: FakeNode): FakeNode {
  const item: FakeNode = { name };
  if (parent) item.parent = parent;
  return item;
}

describe("nearestCommonAncestor", () => {
  it("★ 两个风扇兄弟的祖先是 1_model —— 挂在其中一个上会漏掉另一个", () => {
    const root = node("ImportedRoot");
    const devices = node("设备", root);
    const unit = node("1", devices);
    const model = node("1_model", unit);
    const fanA = node("1_spin_fan", model);
    const fanB = node("1_spin_fan_2", model);
    expect(nearestCommonAncestor([fanA, fanB])?.name).toBe("1_model");
  });

  it("单目标（管道 / 阀门）返回它自己", () => {
    const pipe = node("L-101-1");
    expect(nearestCommonAncestor([pipe])).toBe(pipe);
  });

  it("跨分支只能回到共同根", () => {
    const root = node("ImportedRoot");
    const a = node("1", root);
    const b = node("2", root);
    expect(nearestCommonAncestor([a, b])?.name).toBe("ImportedRoot");
  });

  it("空数组返回 null，调用方自己回退", () => {
    expect(nearestCommonAncestor([])).toBeNull();
  });
});

describe("trackTargetNames", () => {
  it("一条 track 同时驱动两个风扇节点（去重保序）", () => {
    expect(trackTargetNames(spinTrack())).toEqual(["1_spin_fan", "1_spin_fan_2"]);
  });
});

describe("inferSpinAxis", () => {
  it("★ 冷热机风扇推断出 Y 轴（写死 Z 会让叶片翻跟头，只转一半）", () => {
    expect(inferSpinAxis(spinTrack())).toEqual([0, 1, 0]);
  });

  it("绕 Z 的片段推断出 Z，说明不是无脑换成 Y", () => {
    const track: AnimTrackLike = {
      name: "叶轮_spin_fan",
      curves: [{ paths: [{ entityPath: ["root", "叶轮"], propertyPath: ["localRotation"] }], output: 0 }],
      outputs: [{ components: 4, data: new Float32Array([0, 0, 0.7071, 0.7071]) }],
    };
    const axis = inferSpinAxis(track);
    expect(axis?.[0]).toBeCloseTo(0, 5);
    expect(axis?.[1]).toBeCloseTo(0, 5);
    expect(axis?.[2]).toBeCloseTo(1, 5);
  });

  it("关键帧全是 0°/360°（四元数恒等）时返回 null —— 不瞎猜", () => {
    const track: AnimTrackLike = {
      name: "x_spin_fan",
      curves: [{ paths: [{ entityPath: ["root", "x"], propertyPath: ["localRotation"] }], output: 0 }],
      outputs: [{ components: 4, data: new Float32Array([0, 0, 0, 1, 0, 0, 0, -1]) }],
    };
    expect(inferSpinAxis(track)).toBeNull();
  });

  it("位置/缩放通道不参与判断", () => {
    const track: AnimTrackLike = {
      name: "x_flow",
      curves: [{ paths: [{ entityPath: ["root", "x"], propertyPath: ["localPosition"] }], output: 0 }],
      outputs: [{ components: 3, data: new Float32Array([5, 5, 5]) }],
    };
    expect(inferSpinAxis(track)).toBeNull();
  });

  it("兼容 2.x 的下划线字段（_curves / _outputs / _data）", () => {
    const track: AnimTrackLike = {
      _name: "1_spin_fan",
      _curves: [
        {
          _paths: [{ entityPath: ["root", "1_spin_fan"], propertyPath: ["localRotation"] }],
          _output: 0,
        } as never,
      ],
      _outputs: [{ _components: 4, _data: new Float32Array([0, 0.6, 0, 0.8]) }],
    };
    expect(trackTargetNames(track)).toEqual(["1_spin_fan"]);
    const axis = inferSpinAxis(track);
    expect(axis?.[1]).toBeCloseTo(1, 5);
  });
});

describe("isSpinClip", () => {
  it("认得 spin_fan / 叶轮，不误伤管道流量", () => {
    expect(isSpinClip("1_spin_fan")).toBe(true);
    expect(isSpinClip("立式管道离心泵_叶轮")).toBe(true);
    expect(isSpinClip("L-101-1_flow")).toBe(false);
    expect(isSpinClip("V-101_open")).toBe(false);
  });
});
