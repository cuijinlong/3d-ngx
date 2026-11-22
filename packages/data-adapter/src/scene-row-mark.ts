import { LOCAL_DRAFT_NOTICE } from "./scene-storage-errors";

export type SceneRowMarkKind = "local-draft" | "draft" | "published";

export interface SceneRowMark {
  kind: SceneRowMarkKind;
  label: string;
  /** 已落库行上的本地缓存提示，不是「未落库」。 */
  localNote?: string;
}

/**
 * 对接成功后按 hasLocalDraft / publishState 区分；
 * 接口失败或尚未夹上，一律标明未落库 / 本地草稿。
 * 已在平台落库的行不再一律打「未落库」。
 */
export function sceneRowMark(input: {
  storageAvailable: boolean;
  fromPlatform: boolean;
  hasLocalDraft: boolean;
  publishState?: string;
}): SceneRowMark {
  if (!input.storageAvailable || !input.fromPlatform) {
    return { kind: "local-draft", label: LOCAL_DRAFT_NOTICE };
  }
  const published = input.publishState === "published";
  const mark: SceneRowMark = published
    ? { kind: "published", label: "已发布" }
    : { kind: "draft", label: "草稿" };
  if (input.hasLocalDraft) mark.localNote = "有本地缓存";
  return mark;
}
