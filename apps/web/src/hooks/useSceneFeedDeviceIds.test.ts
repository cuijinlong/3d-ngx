import { describe, expect, it } from "vitest";
import { mergeFeedDeviceIds } from "./useSceneFeedDeviceIds";

/**
 * 订阅名单合并（2026-11-23）。
 *
 * <p>这个函数存在的唯一原因，是编辑器和大屏曾经各写一份，而编辑器漏了两路：
 * 设计时「进水 / 出水」永远 `—`、「系统启停」永远「状态未知」，
 * 打开后却都有值 —— 所见即所得就是这么丢的。
 *
 * <p>所以这里逐个来源验证「漏了会怎样」，任何一路被去掉都要红。
 */
describe("mergeFeedDeviceIds", () => {
  it("★ 三路来源全部并入（缺一路就会有一批卡片永远无数据）", () => {
    const ids = mergeFeedDeviceIds(
      [{ deviceId: "glb-1" }],
      { "gw-1": ["water_in_temp"], "scope-1": ["power"] },
      ["scope-2"],
    );
    expect(ids.sort()).toEqual(["glb-1", "gw-1", "scope-1", "scope-2"]);
  });

  it("★ 只有 bindings 时，网关会缺席 —— 这正是编辑器原来的 bug", () => {
    const onlyBindings = mergeFeedDeviceIds([{ deviceId: "glb-1" }], {}, []);
    expect(onlyBindings).toEqual(["glb-1"]);
    expect(onlyBindings).not.toContain("gw-1");

    /* 补上 slotKeys 之后网关才在名单里。 */
    const withSlots = mergeFeedDeviceIds([{ deviceId: "glb-1" }], { "gw-1": ["water_in_temp"] }, []);
    expect(withSlots).toContain("gw-1");
  });

  it("三路指向同一台时不重复", () => {
    const ids = mergeFeedDeviceIds(
      [{ deviceId: "d1" }],
      { d1: ["power"] },
      ["d1"],
    );
    expect(ids).toEqual(["d1"]);
  });

  it("资产绑定条目（没有 deviceId）被跳过，不产生 undefined", () => {
    const ids = mergeFeedDeviceIds(
      [{ deviceId: "d1" }, {} as { deviceId?: string }, { deviceId: undefined }],
      {},
      [],
    );
    expect(ids).toEqual(["d1"]);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("全空时返回空数组，不抛", () => {
    expect(mergeFeedDeviceIds(null, null, null)).toEqual([]);
    expect(mergeFeedDeviceIds(undefined, undefined, undefined)).toEqual([]);
    expect(mergeFeedDeviceIds([], {}, [])).toEqual([]);
  });
});
