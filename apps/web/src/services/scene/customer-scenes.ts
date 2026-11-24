import {
  filterCustomerSceneInstanceCards,
  filterTopologiesForCustomer,
  getConnectedGuardClient,
  getTopologyApi,
  isSceneInstanceCard,
  probeSceneStorage,
  sceneRowMark,
  sceneRootIssueOf,
  type SceneRootIssue,
  type SceneRowMark,
  type TopologyCard,
} from "@idt/data-adapter";
import type { SceneDocument } from "@idt/shared-types";
import { listLocalScenesForCustomer } from "./sceneService";

export interface CustomerSceneRow {
  topologyId: string;
  name: string;
  siteName?: string;
  rootNames?: string[];
  packVersion?: string;
  hasLocalDraft: boolean;
  fromPlatform: boolean;
  publishState?: string;
  mark: SceneRowMark;
  /**
   * 场景根状态。存量数据里大量场景 roots 为空或多个（历史 viewType 圈范围用法），
   * 它们不满足「一资产一场景」，界面上必须标出来 —— 否则用户以为配置是好的。
   */
  rootIssue: SceneRootIssue;
}

export function mergeCustomerSceneRows(
  cards: TopologyCard[],
  local: SceneDocument[],
  customerId: string,
  storageAvailable: boolean,
): CustomerSceneRow[] {
  const mine = filterCustomerSceneInstanceCards(cards, customerId);
  const byId = new Map<string, CustomerSceneRow>();
  for (const card of mine) {
    byId.set(card.id, makeRow({
      topologyId: card.id,
      name: card.name,
      siteName: card.siteName,
      rootNames: card.rootNames,
      packVersion: card.packVersion,
      hasLocalDraft: false,
      fromPlatform: true,
      publishState: card.publishState,
      rootIssue: sceneRootIssueOf({ roots: card.roots }),
      storageAvailable,
    }));
  }
  for (const doc of local) {
    if (doc.platform?.customerId && doc.platform.customerId !== customerId) continue;
    const id = doc.platform?.topologyId;
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, makeRow({
      topologyId: id,
      name: prev?.name || doc.platform?.topologyName || doc.scene.name,
      siteName: prev?.siteName || doc.platform?.siteName,
      rootNames: prev?.rootNames || doc.platform?.rootNames,
      packVersion: prev?.packVersion || doc.platform?.packVersion,
      hasLocalDraft: true,
      fromPlatform: Boolean(prev?.fromPlatform),
      publishState: prev?.publishState || doc.platform?.publishState,
      rootIssue: prev ? prev.rootIssue : sceneRootIssueOf({ roots: doc.platform?.roots }),
      storageAvailable,
    }));
  }
  return [...byId.values()];
}

function makeRow(input: Omit<CustomerSceneRow, "mark"> & { storageAvailable: boolean }): CustomerSceneRow {
  const { storageAvailable, ...row } = input;
  return {
    ...row,
    mark: sceneRowMark({
      storageAvailable,
      fromPlatform: row.fromPlatform,
      hasLocalDraft: row.hasLocalDraft,
      publishState: row.publishState,
    }),
  };
}

export interface CustomerSceneListStats {
  customerTotal: number;
  sceneTotal: number;
  twoDTotal: number;
  otherSceneTotal: number;
}

export interface CustomerSceneListResult {
  rows: CustomerSceneRow[];
  sourceError?: string;
  stats: CustomerSceneListStats;
}

export function customerCardHints(input: { count: number; defaultName?: string }): { defaultHint: string; countHint: string } {
  const name = input.defaultName?.trim();
  return {
    defaultHint: name ? `默认场景：${name}` : "还没有指定默认场景",
    countHint: `${input.count} 个可管理的三维场景`,
  };
}

export function defaultSceneBanner(input: { defaultId?: string; defaultName?: string }): string {
  if (!input.defaultId) return "还没有指定默认场景";
  const name = input.defaultName?.trim();
  return name ? `默认场景：${name}` : "还没有指定默认场景";
}

export function emptySceneListMessage(result: Pick<CustomerSceneListResult, "rows" | "sourceError" | "stats">): string | null {
  if (result.rows.length) return null;
  if (result.sourceError) {
    return "暂时无法读取平台上的场景列表（接口不可用或超时）。本地草稿若存在仍会列出，并标明未落库 / 本地草稿。";
  }
  if (result.stats.twoDTotal > 0) {
    return "该客户下有设备图，但它们是普通二维图，没有出现在这里。这里只列出三维场景。";
  }
  if (result.stats.otherSceneTotal > 0) {
    return "平台上能看到三维场景，但没有挂靠到这个客户。";
  }
  return "该客户还没有可管理的三维场景，可以新建一个。";
}

export async function listCustomerScenes(customerId: string): Promise<CustomerSceneListResult> {
  let items: TopologyCard[] = [];
  let sourceError: string | undefined;
  let storageAvailable = false;
  const client = getConnectedGuardClient();
  let twoDItems: TopologyCard[] = [];
  try {
    const listed = await getTopologyApi().listAll({ customerId, sceneInstance: true });
    items = listed.items;
  } catch (error) {
    items = [];
    sourceError = error instanceof Error && error.message ? error.message : "暂时无法读取平台上的场景列表";
  }
  if (!sourceError) {
    try {
      const graphs = await getTopologyApi().listAll({ customerId, sceneInstance: false });
      twoDItems = graphs.items;
    } catch {
      twoDItems = [];
    }
  }
  try {
    storageAvailable = await probeSceneStorage(client, customerId);
  } catch {
    storageAvailable = false;
  }
  const forCustomer = filterTopologiesForCustomer(items, customerId);
  const sceneCards = forCustomer.filter(isSceneInstanceCard);
  const twoDForCustomer = filterTopologiesForCustomer(twoDItems, customerId).filter((item) => !isSceneInstanceCard(item));
  const stats: CustomerSceneListStats = {
    customerTotal: forCustomer.length + twoDForCustomer.length,
    sceneTotal: sceneCards.length,
    twoDTotal: twoDForCustomer.length,
    otherSceneTotal: items.filter((item) => item.customerId && item.customerId !== customerId && isSceneInstanceCard(item)).length,
  };
  const local = await listLocalScenesForCustomer(customerId);
  const rows = mergeCustomerSceneRows(items, local, customerId, storageAvailable);
  return sourceError ? { rows, sourceError, stats } : { rows, stats };
}
