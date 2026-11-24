
import type { ParsedHmiScene, SceneDocument, SceneListItem, SceneVersion } from "@idt/shared-types";
import { parseSceneDocument, safeParseSceneDocument, SCHEMA_VERSION } from "@idt/scene-schema";
import { getTopologyApi, type TopologyCard, type TopologyGraph } from "@idt/data-adapter";
import { db, patchPrefs } from "../storage/db";
import { createId } from "../../utils/id";

export function emptyScene(name = "未命名场景"): SceneDocument {
  const now = new Date().toISOString();
  const id = createId("scene");
  return {
    schemaVersion: SCHEMA_VERSION,
    scene: {
      id,
      name,
      description: "",
      createdAt: now,
      updatedAt: now,
    },
    settings: {
      background: "#dce3ed",
      environment: null,
      gridEnabled: true,
      snapEnabled: false,
      snapSize: 0.1,
      coordinateSpace: "world",
    },
    entities: [],
    bindings: [],
  };
}

export async function listScenes(): Promise<SceneListItem[]> {
  const rows = await db.scenes.toArray();
  return rows
    .map((doc) => ({
      id: doc.scene.id,
      name: doc.scene.name,
      description: doc.scene.description,
      updatedAt: doc.scene.updatedAt,
      publishedAt: doc.scene.publishedAt,
      entityCount: doc.entities.length,
      hasRootModel: Boolean(doc.rootAssetId),
      siteName: doc.platform?.siteName,
      topologyName: doc.platform?.topologyName,
      topologyId: doc.platform?.topologyId,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getScene(id: string): Promise<SceneDocument | undefined> {
  const all = await db.scenes.toArray();
  return all.find((s) => s.scene.id === id);
}

export async function getSceneByTopologyId(
  topologyId: string,
  customerId?: string,
): Promise<SceneDocument | undefined> {
  if (!topologyId) return undefined;
  const all = await db.scenes.toArray();
  const matches = all.filter((doc) => {
    if (doc.platform?.topologyId !== topologyId) return false;
    if (customerId && doc.platform?.customerId !== customerId) return false;
    return true;
  });
  return matches.sort((a, b) => b.scene.updatedAt.localeCompare(a.scene.updatedAt))[0];
}

export async function listLocalScenesForCustomer(customerId: string): Promise<SceneDocument[]> {
  if (!customerId) return [];
  const all = await db.scenes.toArray();
  return all.filter((doc) => doc.platform?.customerId === customerId && doc.platform?.topologyId);
}

export function resolveTopologyIdFromLegacyScene(docs: SceneDocument[], sceneId: string): string | undefined {
  const doc = docs.find((item) => item.scene.id === sceneId);
  return doc?.platform?.topologyId;
}

export function openSceneKey(doc: SceneDocument): string | undefined {
  return doc.platform?.topologyId;
}

export async function saveScene(doc: SceneDocument, note?: string): Promise<SceneDocument> {
  const next: SceneDocument = {
    ...doc,
    schemaVersion: SCHEMA_VERSION,
    scene: { ...doc.scene, updatedAt: new Date().toISOString() },
  };
  await db.scenes.put(next);
  const versions = await db.versions.where("sceneId").equals(next.scene.id).toArray();
  const version = (versions.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
  const record: SceneVersion = {
    id: createId("ver"),
    sceneId: next.scene.id,
    version,
    createdAt: next.scene.updatedAt,
    note,
    document: next,
  };
  await db.versions.put(record);
  await patchPrefs({ lastSceneId: next.scene.id });
  return next;
}

export async function deleteScene(id: string): Promise<void> {
  const all = await db.scenes.toArray();
  const row = all.find((s) => s.scene.id === id);
  if (row) await db.scenes.delete(row.scene.id);
  await db.versions.where("sceneId").equals(id).delete();
}

export async function duplicateScene(id: string): Promise<SceneDocument> {
  const src = await getScene(id);
  if (!src) throw new Error("场景不存在");
  const now = new Date().toISOString();
  const copy: SceneDocument = {
    ...structuredClone(src),
    scene: {
      ...src.scene,
      id: createId("scene"),
      name: `${src.scene.name} 副本`,
      createdAt: now,
      updatedAt: now,
      publishedAt: undefined,
      publishedVersion: undefined,
    },
  };
  await db.scenes.put(copy);
  return copy;
}

export async function publishScene(id: string): Promise<SceneDocument> {
  const src = await getScene(id);
  if (!src) throw new Error("场景不存在");
  const versions = await db.versions.where("sceneId").equals(id).toArray();
  const version = src.scene.publishedVersion ? src.scene.publishedVersion + 1 : 1;
  const next: SceneDocument = {
    ...src,
    scene: {
      ...src.scene,
      publishedAt: new Date().toISOString(),
      publishedVersion: version,
      updatedAt: new Date().toISOString(),
    },
  };
  await db.scenes.put(next);
  await patchPrefs({ lastRuntimeId: id });
  void versions;
  return next;
}

export async function importSceneJson(data: unknown): Promise<SceneDocument> {
  const parsed = parseSceneDocument(data);
  const now = new Date().toISOString();
  const doc: SceneDocument = {
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    scene: {
      ...parsed.scene,
      id: createId("scene"),
      createdAt: now,
      updatedAt: now,
      publishedAt: undefined,
      publishedVersion: undefined,
    },
  };
  await db.scenes.put(doc);
  return doc;
}

export function validateSceneJson(data: unknown) {
  return safeParseSceneDocument(data);
}

export function attachHmiSnapshot(doc: SceneDocument, hmi: ParsedHmiScene): SceneDocument {
  return {
    ...doc,
    hmiSnapshot: {
      source: hmi.source,
      name: hmi.name,
      bindableCount: hmi.bindables.length,
    },
  };
}

export async function listVersions(sceneId: string): Promise<SceneVersion[]> {
  return db.versions.where("sceneId").equals(sceneId).reverse().sortBy("version");
}

/** 平台已有拓扑但还没有本地草稿时，先打开一份未保存的挂靠文档，不假装已经落库。 */
export type TopologySceneInspect =
  | { status: "ok"; document: SceneDocument }
  | { status: "not-found" }
  | { status: "not-scene" }
  | { status: "unavailable"; error: string };

export function sceneDocumentFromTopologyInspect(input: {
  topologyId: string;
  card?: Pick<TopologyCard, "name" | "siteId" | "siteName" | "customerId" | "viewType" | "roots" | "rootNames" | "packId" | "packVersion" | "stylePack" | "publishState" | "glb"> | null;
  graph?: Pick<
    TopologyGraph,
    | "name" | "siteId" | "siteName" | "customerId" | "viewType" | "roots"
    | "publishState" | "glb" | "packId" | "packVersion" | "stylePack"
  > | null;
}): SceneDocument {
  const { topologyId, card, graph } = input;
  const name = card?.name || graph?.name || "未命名场景";
  const doc = emptyScene(name);
  const glb = card?.glb || graph?.glb;
  return {
    ...doc,
    platform: {
      siteId: card?.siteId || graph?.siteId || "",
      siteName: card?.siteName || graph?.siteName,
      customerId: card?.customerId || graph?.customerId,
      topologyId,
      topologyName: name,
      viewType: card?.viewType || graph?.viewType || "",
      roots: card?.roots || graph?.roots,
      rootNames: card?.rootNames,
      /*
       * ★ 四项都要 `card ?? graph` 回落（2026-11-23）。
       *
       * <p>实测：天骄场景的平台拓扑返回了 `stylePack: 'hvac-hud-v1@1.0.0'`，
       * 但前端 `document.platform.stylePack` 是 null —— 因为原来只读 `card`，
       * 而这个场景走的是 graph 那条路径。
       *
       * <p>后果很隐蔽：风格套装的渲染规则链路（取 render → 应用流速/阀门颜色）
       * 全部写好了、日志也对，但因为 stylePack 是 null，规则回落到默认值，
       * **看起来像"套装没生效"**，实际是字段没读到。
       *
       * <p>`roots` 那行本来就有回落，`packId/packVersion/stylePack` 三条漏了。
       * 这类"部分字段有回落、部分没有"是白名单解析最典型的坑。
       */
      packId: card?.packId ?? graph?.packId,
      packVersion: card?.packVersion ?? graph?.packVersion,
      stylePack: card?.stylePack ?? graph?.stylePack,
      sceneInstance: true,
      publishState: card?.publishState || graph?.publishState,
      ...(glb ? { glb } : {}),
    },
  };
}

/** 纯函数：根据 load/list 结果判断打开结果。有三维实例时即使列表漏卡、也没有模型，也不能判成找不到。 */
export function inspectTopologySceneResult(input: {
  topologyId: string;
  graph?: TopologyGraph | null;
  loadFailed?: unknown;
  sceneCard?: TopologyCard | null;
  graphCard?: TopologyCard | null;
}): TopologySceneInspect {
  if (!input.topologyId) return { status: "not-found" };
  const { graph, loadFailed, sceneCard, graphCard } = input;
  const isScene = sceneCard?.sceneInstance === true || graph?.sceneInstance === true;
  if (isScene) {
    return {
      status: "ok",
      document: sceneDocumentFromTopologyInspect({ topologyId: input.topologyId, card: sceneCard, graph }),
    };
  }
  if (graphCard) return { status: "not-scene" };
  if (sceneCard && sceneCard.sceneInstance !== true) return { status: "not-scene" };
  if (loadFailed) {
    const message = loadFailed instanceof Error ? loadFailed.message : "";
    const missing = /404|not found|不存在|找不到/i.test(message);
    return missing
      ? { status: "not-found" }
      : { status: "unavailable", error: message || "暂时无法打开该场景，平台服务不可用或超时。" };
  }
  if (graph) return { status: "not-scene" };
  return { status: "not-found" };
}

export async function inspectTopologyScene(topologyId: string, customerId?: string): Promise<TopologySceneInspect> {
  if (!topologyId) return { status: "not-found" };
  try {
    const api = getTopologyApi();
    let graph: Awaited<ReturnType<typeof api.load>> | undefined;
    let loadFailed: unknown;
    try {
      graph = await api.load(topologyId);
    } catch (error) {
      loadFailed = error;
    }
    const query = customerId ? { customerId } : undefined;
    const listed = await api.listAll({ ...query, sceneInstance: true });
    const sceneCard = listed.items.find((item) => item.id === topologyId);
    let graphCard: TopologyCard | undefined;
    if (!sceneCard) {
      const graphs = await api.listAll({ ...query, sceneInstance: false });
      graphCard = graphs.items.find((item) => item.id === topologyId);
    }
    return inspectTopologySceneResult({
      topologyId,
      graph,
      loadFailed,
      sceneCard,
      graphCard,
    });
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error && error.message ? error.message : "暂时无法打开该场景，平台服务不可用或超时。",
    };
  }
}

export async function createTopologySceneStub(topologyId: string): Promise<SceneDocument | undefined> {
  const result = await inspectTopologyScene(topologyId);
  return result.status === "ok" ? result.document : undefined;
}
