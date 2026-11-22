import { describe, expect, it } from "vitest";
import { LOCAL_DRAFT_NOTICE } from "./scene-storage-errors";
import { sceneRowMark } from "./scene-row-mark";

describe("sceneRowMark", () => {
  it("keeps local-draft notice when storage is down or the row is only a local draft", () => {
    expect(sceneRowMark({ storageAvailable: false, fromPlatform: true, hasLocalDraft: false, publishState: "published" })).toEqual({
      kind: "local-draft",
      label: LOCAL_DRAFT_NOTICE,
    });
    expect(sceneRowMark({ storageAvailable: true, fromPlatform: false, hasLocalDraft: true })).toEqual({
      kind: "local-draft",
      label: LOCAL_DRAFT_NOTICE,
    });
  });

  it("uses publishState for platform rows and does not stamp 未落库 on already persisted scenes", () => {
    expect(sceneRowMark({ storageAvailable: true, fromPlatform: true, hasLocalDraft: false, publishState: "published" })).toEqual({
      kind: "published",
      label: "已发布",
    });
    expect(sceneRowMark({ storageAvailable: true, fromPlatform: true, hasLocalDraft: true, publishState: "draft" })).toEqual({
      kind: "draft",
      label: "草稿",
      localNote: "有本地缓存",
    });
    expect(sceneRowMark({ storageAvailable: true, fromPlatform: true, hasLocalDraft: true, publishState: "published" }).label).toBe("已发布");
    expect(sceneRowMark({ storageAvailable: true, fromPlatform: true, hasLocalDraft: true, publishState: "published" }).label).not.toContain("未落库");
  });
});
