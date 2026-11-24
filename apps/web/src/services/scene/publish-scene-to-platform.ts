import {
  getConnectedGuardClient,
  getTopologyApi,
  readSceneJumpDraft,
  clearSceneWidgetDraft,
  SceneStorageApi,
  SCENE_WIDGETS_EMPTY,
  type SceneWidgetsDocument,
} from "@idt/data-adapter";
import type { SceneDocument } from "@idt/shared-types";
import { getAsset, readAssetBuffer } from "../asset/assetService";
import { saveScene } from "./sceneService";

export const PUBLISH_NEED_TOPOLOGY_MESSAGE = "还没有挂到平台拓扑，无法发布到平台";
export const PUBLISH_NEED_CONNECTION_MESSAGE = "尚未连接后端，无法发布到平台";
export const PUBLISH_WRITE_FAILED_MESSAGE = "发布没有写到平台，请稍后重试";
export const PUBLISH_MODEL_TOO_LARGE_MESSAGE = "文件不能超过 48MB";
export const PUBLISH_NEED_MODEL_MESSAGE = "还没有三维模型，无法发布到平台";

const MAX_GLB_BYTES = 48 * 1024 * 1024;

/** 工作台「发布」：把模型、场景属性和已发布状态写到平台，不只改本机标记。 */
export async function publishSceneToPlatform(input: {
  document: SceneDocument;
  widgets?: SceneWidgetsDocument | null;
}): Promise<SceneDocument> {
  const doc = input.document;
  const topologyId = doc.platform?.topologyId?.trim();
  if (!topologyId) throw new Error(PUBLISH_NEED_TOPOLOGY_MESSAGE);

  let api: ReturnType<typeof getTopologyApi>;
  try {
    api = getTopologyApi();
  } catch {
    throw new Error(PUBLISH_NEED_CONNECTION_MESSAGE);
  }
  const client = getConnectedGuardClient();
  if (!client) throw new Error(PUBLISH_NEED_CONNECTION_MESSAGE);

  let glb = doc.platform?.glb;
  if (!glb?.objectKey?.trim() && doc.rootAssetId) {
    const stored = await getAsset(doc.rootAssetId);
    const buffer = await readAssetBuffer(doc.rootAssetId);
    if (buffer.byteLength > MAX_GLB_BYTES) throw new Error(PUBLISH_MODEL_TOO_LARGE_MESSAGE);
    const rawName = stored?.name?.trim() || glb?.fileName?.trim() || "model.glb";
    const fileName = rawName.toLowerCase().endsWith(".glb") ? rawName : `${rawName}.glb`;
    const uploaded = await api.uploadAsset(
      new File([buffer], fileName, { type: "model/gltf-binary" }),
      { kind: "glb", siteId: doc.platform?.siteId, topologyId },
    );
    if (!uploaded?.objectKey) throw new Error(PUBLISH_WRITE_FAILED_MESSAGE);
    glb = {
      objectKey: uploaded.objectKey,
      fileName: uploaded.fileName || fileName,
      size: uploaded.size,
      url: uploaded.url,
    };
  }

  if (!glb?.objectKey?.trim()) {
    throw new Error(PUBLISH_NEED_MODEL_MESSAGE);
  }

  if (glb?.objectKey) {
    const card = await api.update(topologyId, {
      name: doc.scene.name,
      glb: { objectKey: glb.objectKey, fileName: glb.fileName },
    });
    if (card.glb?.objectKey) glb = card.glb;
  }

  const storage = new SceneStorageApi(client);
  const bindings = await storage.putBindings(topologyId, { schemaVersion: "1.0.0", bindings: doc.bindings ?? [] });
  await storage.putWidgets(topologyId, input.widgets ?? { ...SCENE_WIDGETS_EMPTY });
  clearSceneWidgetDraft({ topologyId, sceneId: doc.scene.id });

  const customerId = doc.platform?.customerId?.trim() || "";
  const draftLinks = customerId ? readSceneJumpDraft(customerId, topologyId)?.links : undefined;
  const links = draftLinks ?? (await storage.getJumps(topologyId));
  await storage.putJumps(topologyId, links);

  const published = await api.update(topologyId, { publishState: "published" });
  if (published.publishState && published.publishState !== "published") {
    throw new Error(PUBLISH_WRITE_FAILED_MESSAGE);
  }

  const now = new Date().toISOString();
  const version = doc.scene.publishedVersion ? doc.scene.publishedVersion + 1 : 1;
  const next: SceneDocument = {
    ...doc,
    bindings: bindings.bindings ?? doc.bindings,
    scene: {
      ...doc.scene,
      publishedAt: now,
      publishedVersion: version,
      updatedAt: now,
    },
    platform: {
      ...doc.platform!,
      topologyId,
      publishState: published.publishState || "published",
      ...(glb?.objectKey ? { glb } : {}),
    },
  };
  return saveScene(next, "发布到平台");
}
