import { describe, expect, it } from "vitest";
import {
  assertNoLegacyStoreCopy,
  assertNoRootsInWizardCopy,
  createdSceneFeedback,
  describeSaveTarget,
  describeUploadFallback,
  scopeOptionsExtra,
  scopeOptionsPlaceholder,
  shouldDegradeUploadOnError,
  stylePackLoadHint,
  stylePackSelectExtra,
  WIZARD_COPY,
} from "./create-scene-messages";

describe("保存提示按落点区分", () => {
  /*
   * 原来写死「已保存到本地」，而 persist() 在连上平台时是真的写到平台的（2026-11-24）。
   * 提示与事实相反 → 用户以为没入库、反复点保存；或换台机器发现有改动、从此不信保存。
   */
  it("落到平台时说「已保存到平台」", () => {
    expect(describeSaveTarget({
      available: true, bindingsSource: "platform", widgetsSource: "platform",
    })).toBe("已保存到平台");
  });

  it("只有本地草稿时如实说「已保存到本机草稿」", () => {
    expect(describeSaveTarget({
      available: false, bindingsSource: "local-draft", widgetsSource: "empty",
    })).toBe("已保存到本机草稿");
    expect(describeSaveTarget({
      available: false, bindingsSource: "platform", widgetsSource: "local-draft",
    })).toBe("已保存到本机草稿");
  });

  it("拿不到状态时按本地处理（宁可说得保守）", () => {
    expect(describeSaveTarget(undefined)).toBe("已保存到本机草稿");
  });
});

describe("上传失败文案按原因区分", () => {
  /*
   * 403 = 身份限制，不是环境问题（2026-11-24）。
   *
   * 上传端点只对租户开放，客户身份必然 403。原来这种情况也说
   * 「仅保存在本机」「不要当成已经上传到平台」—— 用户会以为是网络问题，
   * 反复重试一件注定失败的事。
   */
  it("403 说清是身份限制，并给出可执行的办法", () => {
    const text = describeUploadFallback({ status: 403, message: "Forbidden" });
    expect(text).toContain("当前身份不能上传模型");
    expect(text).toContain("平台模板");
    expect(text).not.toContain("仅保存在本机");
  });

  it("其它失败仍是存储/网络降级", () => {
    for (const status of [400, 404, 500, undefined]) {
      const text = describeUploadFallback(status == null ? undefined : { status });
      expect(text).toContain("仅保存在本机");
    }
  });
});

describe("create-scene wizard copy", () => {
  it("does not use the old “尚未上线 / topologyId” wording", () => {
    const texts = [
      ...Object.values(WIZARD_COPY),
      stylePackLoadHint(true, 404) ?? "",
      stylePackLoadHint(true, 500) ?? "",
      stylePackSelectExtra(true) ?? "",
      scopeOptionsExtra(true) ?? "",
      scopeOptionsPlaceholder(true),
      describeUploadFallback({ status: 404, message: "参数非法: topologyId" }),
      describeUploadFallback({ status: 403, message: "You don't have permission" }),
      describeUploadFallback({ status: 400, message: "参数非法: topologyId" }),
      describeUploadFallback({ status: 500, message: "对象存储未配置或不可用" }),
      createdSceneFeedback({ connected: true, siteId: "s1", uploadDegraded: true }).text,
      createdSceneFeedback({ connected: true, siteId: "s1", uploadDegraded: false }).text,
      WIZARD_COPY.uploadExtra,
    ];
    for (const text of texts) {
      expect(() => assertNoLegacyStoreCopy(text)).not.toThrow();
      expect(() => assertNoRootsInWizardCopy(text)).not.toThrow();
    }
    expect(WIZARD_COPY.namePlaceholder).toBe("给这个场景起个名字");
    /*
     * 2026-11-24：`createTopology` / `createTopologyHint` 随「设备拓扑」选项一起删掉了。
     * 这里改成钉住「它们确实不在了」—— 留着常量会有两个坏处：
     * ① 有人以为向导还有那个分支；② 文案与界面不一致时没人发现。
     */
    expect("createTopology" in WIZARD_COPY).toBe(false);
    expect("createTopologyHint" in WIZARD_COPY).toBe(false);
  });

  it("explains IndexedDB fallback as not stored on the platform", () => {
    const hint = describeUploadFallback({ status: 404 });
    expect(hint).toContain("尚未入库");
    expect(hint).toContain("IndexedDB");
    expect(shouldDegradeUploadOnError({ status: 404 })).toBe(true);
    expect(shouldDegradeUploadOnError({ status: 400, message: "参数非法: topologyId" })).toBe(true);
    expect(shouldDegradeUploadOnError({ status: 500 })).toBe(true);
  });

  it("warns when a connected create had to keep the model local", () => {
    const degraded = createdSceneFeedback({ connected: true, siteId: "site-1", uploadDegraded: true });
    expect(degraded.type).toBe("warning");
    expect(degraded.text).toContain("尚未入库");
    const ok = createdSceneFeedback({ connected: true, siteId: "site-1", uploadDegraded: false });
    expect(ok.type).toBe("success");
    expect(ok.text).not.toContain("IndexedDB");
  });
});
