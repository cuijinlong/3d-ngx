
export { MOCK_PROFILES, profileByType } from "./profiles";
export { MockDataProvider, createMockDataProvider } from "./mock-provider";
export { GuardServerProvider, createGuardProvider } from "./guard-provider";
export { GuardClient, GuardHttpError } from "./guard-client";
export {
  initProviders,
  getDataProvider,
  getCommandProvider,
  getMockController,
  getProviderKind,
  getGuardStatus,
  connectGuard,
  disconnectGuard,
  restoreGuardConnection,
  loadSavedGuardSettings,
  clearSavedGuardSettings,
  hasRefreshSession,
  getConnectedGuardClient,
  getTopologyApi,
  getSceneStorageApi,
  getSceneTemplateApi,
  listRealtimeDevices,
} from "./registry";
export { PLATFORM_CONNECTION_FAILED_MESSAGE } from "./guard-session";
export type { RealtimeDeviceQuery } from "./registry";
export { SceneTemplateApi, parseSceneTemplate, parseSceneTemplateList } from "./scene-template-client";
export type { SceneTemplateCard, SceneTemplateAssetRef } from "./scene-template-client";
export {
  TopologyApi,
  devicesFromTopologyNodes,
  filterTopologiesForCustomer,
  filterCustomerSceneInstanceCards,
  isSceneInstanceCard,
  VIEW_FALLBACK,
  STYLE_PACK_FALLBACK,
} from "./topology-client";
export {
  parseCommands,
  commandHasRequiredParams,
  describeCommandError,
  toCommandError,
  RealtimeDeviceError,
  VIRTUAL_DEVICE_UNBOUND_MESSAGE,
} from "./commands";
export { intersectRealtimeDevices } from "./list-realtime";
export type {
  TopologyViewType,
  TopologySite,
  TopologyViewOption,
  TopologyScopeOption,
  TopologyScopeOptions,
  TopologyCard,
  TopologyListResult,
  TopologyListQuery,
  TopologyDeviceNode,
  TopologyGraph,
  TopologyBaseType,
  TopologyStylePack,
  TopologyBaseTypeOption,
  TopologyStylePackCatalog,
  TopologyAssetRef,
} from "./topology-client";

export {
  isVirtualDeviceVirtualValue,
  readDeviceVirtualFlag,
  isVirtualAdditionalInfo,
  isVirtualPlatformDevice,
  isRealtimePlatformDevice,
} from "./device-virtual";

export { formatPlatformDeviceName } from "./device-display";
export { toGuardDevice } from "./guard-device";

export {
  PLATFORM_AUTHORITY,
  decodeJwtPayload,
  authorityFromJwt,
  resolvePlatformAuthority,
  isTenantAdmin,
  isCustomerUser,
  sessionRole,
} from "./authority";
export type { SessionRole } from "./authority";
export { listPlatformCustomers, listCustomerPlatformDevices } from "./customers";
export type { PlatformCustomer } from "./customers";
export {
  DEFAULT_SCENE_DRAFT_NOTICE,
  DEFAULT_SCENE_DRAFT_STORAGE_KEY,
  readDefaultSceneDraft,
  writeDefaultSceneDraft,
  clearDefaultSceneDraft,
} from "./default-scene-draft";
export type { DefaultSceneDraft } from "./default-scene-draft";
export {
  SCENE_JUMP_DRAFT_NOTICE,
  SCENE_JUMP_DRAFT_STORAGE_KEY,
  readSceneJumpDraft,
  writeSceneJumpDraft,
  setObjectJumpTargets,
  resolveJumpTargets,
  decideObjectClick,
} from "./scene-jump-draft";
export type { SceneJumpDraft, SceneJumpLink, SceneJumpTarget, ObjectClickDecision } from "./scene-jump-draft";
export {
  SCENE_WIDGET_DRAFT_NOTICE,
  SCENE_WIDGET_DRAFT_STORAGE_KEY,
  readSceneWidgetDraft,
  writeSceneWidgetDraft,
  clearSceneWidgetDraft,
} from "./scene-widget-draft";
export type { SceneWidgetDraft } from "./scene-widget-draft";
export { getAuthSnapshot } from "./auth-snapshot";
export type { AuthSnapshot } from "./auth-snapshot";
export { LOCAL_DRAFT_NOTICE, isSceneStorageUnmounted, isSceneStorageUnavailable, isDefaultSceneEmptyPointer, guardErrorCode } from "./scene-storage-errors";
export { jumpsFromObjectLinks, objectLinksFromJumps, parseSceneJumpRows } from "./scene-jump-adapter";
export type { SceneJumpApiRow, SceneJumpApiTarget, SceneJumpPutBody } from "./scene-jump-adapter";
export { sceneRowMark } from "./scene-row-mark";
export type { SceneRowMark, SceneRowMarkKind } from "./scene-row-mark";
export {
  SceneStorageApi,
  probeSceneStorage,
  resolveDefaultScene,
  saveDefaultScene,
  removeDefaultScene,
  resolveSceneJumps,
  saveSceneJumps,
  resolveSceneBindings,
  saveSceneBindings,
  resolveSceneWidgets,
  saveSceneWidgets,
  parseDefaultScene,
  parseBindings,
  parseWidgets,
  resetSceneStorageAvailabilityForTests,
  SCENE_BINDINGS_EMPTY,
  SCENE_WIDGETS_EMPTY,
} from "./scene-storage";
export type {
  DefaultScenePointer,
  SceneJumpsResult,
  BindingsResult,
  WidgetsResult,
  SceneBindingsDocument,
  SceneWidgetsDocument,
} from "./scene-storage";
export {
  DEFAULT_WIDGET_STYLE_TOKENS,
  DEFAULT_GLASS_OPACITY,
  GLASS_OPACITY_MIN,
  GLASS_OPACITY_MAX,
  SCENE_WIDGET_TYPE_REGISTRY,
  EMPTY_WIDGET_LAYOUT,
  WIDGET_SAFE_AREA,
  WIDGET_STAGE_FRAME,
  zoneForWidgetType,
  nextSlotInZone,
  relayoutStageFrame,
  isLockedStageType,
  contentBottom,
  stageFrameRects,
  parseSceneWidgetLayout,
  parseSceneWidget,
  toTemplateWidgetLayout,
  clampWidgetRect,
  clampGlassOpacity,
  parseOptionalGlassOpacity,
  layoutGlassOpacity,
  effectiveGlassOpacity,
  widgetHasGlassOverride,
  clearWidgetGlassOverride,
  widgetTypeMeta,
  isKnownWidgetType,
  canAddWidgetType,
  placeNewWidget,
  nextWidgetId,
} from "./scene-widget-layout";
export type {
  SceneWidget,
  SceneWidgetLayout,
  SceneWidgetSlot,
  SceneWidgetStyle,
  SceneWidgetTypeMeta,
  SceneWidgetTypeId,
  WidgetStageZone,
} from "./scene-widget-layout";
