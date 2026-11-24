import { getTopologyApi } from "@idt/data-adapter";
import { parseHmiGlb } from "@idt/engine-adapter";
import type { SceneDocument } from "@idt/shared-types";
import { importAssetFile } from "../asset/assetService";
import { uniqueEntitiesFromParsed } from "../../utils/hmi-entities";
import { attachHmiSnapshot } from "./sceneService";

export const SCENE_NO_MODEL_MESSAGE = "还没有模型";
export const SCENE_MODEL_LOAD_FAILED_MESSAGE = "暂时无法加载三维模型，请稍后重试";

/** 本地还没有 rootAssetId、平台已有 objectKey 时，按已有下载接口拉 GLB、解析 HMI 再挂到场景文档。 */
export async function hydrateRootModelFromPlatform(doc: SceneDocument): Promise<SceneDocument> {
  if (doc.rootAssetId) return doc;
  const objectKey = doc.platform?.glb?.objectKey?.trim();
  if (!objectKey) return doc;

  let api: ReturnType<typeof getTopologyApi>;
  try {
    api = getTopologyApi();
  } catch {
    return doc;
  }

  try {
    const buffer = await api.downloadAsset(objectKey);
    const rawName = doc.platform?.glb?.fileName?.trim() || "model.glb";
    const fileName = rawName.toLowerCase().endsWith(".glb") ? rawName : `${rawName}.glb`;
    const file = new File([buffer], fileName, { type: "model/gltf-binary" });
    const parsed = parseHmiGlb(await file.arrayBuffer());
    const asset = await importAssetFile(file, {
      hmiName: parsed.name,
      bindables: parsed.bindables.length,
      objectKey,
      source: "platform",
    });
    const entities = uniqueEntitiesFromParsed(parsed).map((item) => ({
      id: item.node,
      name: item.name,
      nodeName: item.node,
      assetId: asset.id,
      transform: {
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      visible: true,
    }));
    return attachHmiSnapshot(
      {
        ...doc,
        rootAssetId: asset.id,
        entities: entities.length ? entities : doc.entities,
        scene: { ...doc.scene, name: doc.scene.name || parsed.name || "未命名场景" },
      },
      parsed,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("还没有模型") || message.includes("无法加载三维模型")) {
      throw new Error(message);
    }
    throw new Error(SCENE_MODEL_LOAD_FAILED_MESSAGE);
  }
}
