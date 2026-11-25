import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assessRequirements,
  buildRequirementsSkeleton,
  REQUIREMENTS_SECTIONS,
  REQUIREMENTS_SKELETON_PATH,
} from "./requirements-skeleton";

/*
 * 「现场资料」骨架与完整度评估（2026-11-24）。
 *
 * <p>客户定调：模板是「AI 和用户针对性沟通需求的桥梁」。
 * 桥梁要能指出没搭完的地方 —— 用户填三节就点 AI，AI 只能对着
 * 空白的「统计口径」猜，猜出来看着合理但不对。
 */

/** 骨架就在同目录的 templates/ 下 —— 用 import.meta.url 定位（ESM 下没有 __dirname）。 */
const SKELETON_ABS = fileURLToPath(new URL("./templates/requirements-skeleton.md", import.meta.url));

describe("骨架文件", () => {
  it("★ 覆盖 8 类现场资料，缺一类 AI 就少一个决策依据", () => {
    /*
     * 每一节都对应 AI 必须知道的输入：
     *   场站 → 文案与口径；设备清单 → 3D 对象与绑定点；
     *   上报指标 → 槽位能绑什么；统计口径 → 卡片怎么算；
     *   告警定义 → 什么该标红；布局视觉 → 摆在哪、什么颜色；
     *   禁忌 → 不要做什么；术语 → 别理解偏。
     */
    const md = buildRequirementsSkeleton("测试模板");
    for (const section of REQUIREMENTS_SECTIONS) {
      expect(md).toContain(section);
    }
    expect(REQUIREMENTS_SECTIONS).toHaveLength(8);
  });

  it("占位符被替换成模板名，且不残留 {{name}}", () => {
    const md = buildRequirementsSkeleton("天骄科技园");
    expect(md).toContain("# 天骄科技园 · 现场资料与需求");
    expect(md).not.toContain("{{name}}");
  });

  it("名称为空时给一个可读的默认名（不留空白标题）", () => {
    expect(buildRequirementsSkeleton("").startsWith("# 未命名场景")).toBe(true);
  });

  it("★ 同一份文件也被 seed 脚本读取（单一来源，不走样）", () => {
    /*
     * 各写一份的后果：前端改了骨架、脚本没跟上，
     * 「新建的模板」有 8 节，「补出来的老模板」还是旧版 ——
     * 用户以为这是 bug。
     */
    const onDisk = readFileSync(SKELETON_ABS, "utf8");
    expect(onDisk).toContain("{{name}}");
    expect(onDisk).toContain("统计口径");
    /* 常量是给 seed 脚本用的仓库相对路径，必须与真实位置一致 */
    expect(REQUIREMENTS_SKELETON_PATH).toBe(
      "apps/web/src/features/scene-editor/templates/requirements-skeleton.md",
    );
  });
});

describe("assessRequirements", () => {
  it("★ 未填的骨架 → 全部小节都是 missing", () => {
    /*
     * 这是「桥梁」的核心用法：新建模板后 AI 面板直接告诉用户
     * 「资料还差 8 项，先填统计口径和告警定义」。
     */
    const skeleton = buildRequirementsSkeleton("测试");
    const out = assessRequirements(skeleton, skeleton);
    expect(out.total).toBeGreaterThanOrEqual(8);
    expect(out.filledCount).toBe(0);
    expect(out.missing.length).toBe(out.total);
  });

  it("用户填了统计口径 → 该项变 filled，其余仍 missing", () => {
    const md = [
      "# 某场景 · 现场资料与需求",
      "",
      "## 1. 项目与场站",
      "",
      "- 项目名称：",
      "",
      "## 4. 要统计什么（统计口径）",
      "",
      "| 大屏位置 | 展示内容 | 数据来源 | 统计项 |",
      "| --- | --- | --- | --- |",
      "| 左翼第一块 | 场站用电量 | 场站能耗 | 用量·电 |",
      "",
    ].join("\n");
    const out = assessRequirements(md);
    const stats = out.sections.find((s) => s.title.includes("统计口径"));
    const site = out.sections.find((s) => s.title.includes("项目与场站"));
    expect(stats?.filled).toBe(true);
    expect(site?.filled).toBe(false);
    expect(out.missing).toContain("项目与场站");
    expect(out.missing).not.toContain("要统计什么（统计口径）");
  });

  it("★ 只填「无」「好」这类两字不算完成（阈值 8 字）", () => {
    /*
     * 否则界面显示「已填 8/8」而 AI 依然无从下手 —— 那比不显示更糟。
     */
    const md = "## 1. 告警与故障\n\n- 哪些情况算「故障」：无\n";
    const out = assessRequirements(md);
    expect(out.sections[0]?.filled).toBe(false);
  });

  it("骨架自带的说明（> 引用块）不算用户内容", () => {
    const md = [
      "## 1. 系统构成（有哪些设备）",
      "",
      "> 关键：指标名必须与设备文档里的名字一致，AI 靠名字匹配数据。",
      "",
    ].join("\n");
    expect(assessRequirements(md).sections[0]?.filled).toBe(false);
  });

  it("空内容 / null 不抛错", () => {
    expect(assessRequirements("").total).toBe(0);
    expect(assessRequirements(null).filledCount).toBe(0);
  });
});
