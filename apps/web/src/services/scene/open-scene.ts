
import type { SessionRole } from "@idt/data-adapter";
import type { SceneDocument } from "@idt/shared-types";

export type SceneOpenFailureKind = "not-found" | "not-owned" | "not-scene" | "unavailable" | "timeout";

export const SCENE_OPEN_ERRORS: Record<SceneOpenFailureKind, string> = {
  "not-found": "找不到这个场景",
  "not-owned": "这个场景不属于当前客户",
  "not-scene": "这不是三维场景，或还没有标记为三维实例。",
  unavailable: "暂时连不上服务，请稍后重试",
  timeout: "打开超时，请刷新或返回场景管理",
};

export const SCENE_OPEN_UNKNOWN_MESSAGE = "打不开这个场景，请返回后重试";

/** @deprecated 使用 SCENE_OPEN_ERRORS 中的具体原因 */
export const SCENE_OPEN_FAILED_MESSAGE = SCENE_OPEN_ERRORS["not-found"];

export interface SceneOpenAccess {
  role: SessionRole;
  customerId?: string;
}

export type SceneOpenResult =
  | { ok: true; document: SceneDocument }
  | { ok: false; error: string; kind: SceneOpenFailureKind };

function ownedByCustomer(doc: SceneDocument | null | undefined, customerId?: string): SceneDocument | undefined {
  if (!doc || !customerId) return undefined;
  if (doc.platform?.customerId !== customerId) return undefined;
  if (!doc.platform?.topologyId) return undefined;
  return doc;
}

export function resolveOpenScene(input: {
  access: SceneOpenAccess;
  local?: SceneDocument | null;
  stub?: SceneDocument | null;
  cause?: SceneOpenFailureKind;
}): SceneOpenResult {
  const { access, local, stub, cause } = input;
  if (access.role === "customer") {
    const foreign = [local, stub].find((doc) => doc && access.customerId && doc.platform?.customerId && doc.platform.customerId !== access.customerId);
    if (foreign && !ownedByCustomer(local, access.customerId) && !ownedByCustomer(stub, access.customerId)) {
      return { ok: false, error: SCENE_OPEN_ERRORS["not-owned"], kind: "not-owned" };
    }
    const mine = ownedByCustomer(local, access.customerId) ?? ownedByCustomer(stub, access.customerId);
    if (mine) return { ok: true, document: mine };
    const kind = cause && cause !== "not-owned" ? cause : "not-found";
    return { ok: false, error: SCENE_OPEN_ERRORS[kind], kind };
  }
  if (access.role === "tenant") {
    if (local?.platform?.topologyId) return { ok: true, document: local };
    if (stub?.platform?.topologyId) return { ok: true, document: stub };
    const kind = cause ?? "not-found";
    return { ok: false, error: SCENE_OPEN_ERRORS[kind], kind };
  }
  return { ok: false, error: SCENE_OPEN_ERRORS["not-found"], kind: "not-found" };
}
