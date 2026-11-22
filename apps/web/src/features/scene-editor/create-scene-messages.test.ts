import { describe, expect, it } from "vitest";
import {
  assertNoLegacyStoreCopy,
  assertNoRootsInWizardCopy,
  createdSceneFeedback,
  describeUploadFallback,
  scopeOptionsExtra,
  scopeOptionsPlaceholder,
  shouldDegradeUploadOnError,
  stylePackLoadHint,
  stylePackSelectExtra,
  WIZARD_COPY,
} from "./create-scene-messages";

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
    expect(WIZARD_COPY.createTopology).toBe("创建新拓扑");
    expect(WIZARD_COPY.createTopologyHint).toBe("用上面选的场站和分组作为这个场景的范围。");
    expect(() => assertNoRootsInWizardCopy(WIZARD_COPY.createTopology)).not.toThrow();
    expect(() => assertNoRootsInWizardCopy(WIZARD_COPY.createTopologyHint)).not.toThrow();
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
