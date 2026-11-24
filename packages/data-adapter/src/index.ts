
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
  getAssetApi,
  listRealtimeDevices,
} from "./registry";
export { PLATFORM_CONNECTION_FAILED_MESSAGE } from "./guard-session";
export type { RealtimeDeviceQuery } from "./registry";
/*
 * 在线编程：提案校验 + 差异预览（2026-11-23）。
 * 只判定「能不能改」「会改成什么」，不落地 —— 落地由调用方在人工确认后做。
 */
export {
  DEFAULT_AI_EXTENSION,
  examineLayoutProposal,
  proposalNeedsReview,
} from "./layout-proposal";
export type {
  AiExtension,
  LayoutOperation,
  LayoutProposal,
  ProposalIssue,
  ProposalIssueCode,
} from "./layout-proposal";

/*
 * 在线编程的脚本模式（2026-11-23）。
 * 只给「构造 ctx / 在当前线程执行」的能力；浏览器侧必须走 Worker 版本
 * （超时强杀与隔离都由 Worker 提供，见 apps/web/.../run-layout-script.ts）。
 */
export {
  SAMPLE_SCRIPT,
  createScriptContext,
  runLayoutScript,
} from "./layout-script";
export type {
  LayoutScriptContext,
  LayoutScriptData,
  LayoutScriptResult,
} from "./layout-script";

/*
 * 场景数据源（2026-11-23）：别名合并、实体解析、保存时校验。
 * 勘察（拉遥测/属性/告警）在应用层，这里只放不联网的纯逻辑。
 */
export {
  mergeSceneDataSources,
  resolveDataSourceEntities,
  resolveSceneDataSources,
  validateSceneDataSources,
} from "./scene-data-sources";
export type { ResolvedDataSource } from "./scene-data-sources";

export { SceneTemplateApi, parseSceneTemplate, parseSceneTemplateList } from "./scene-template-client";
export type { SceneTemplateCard, SceneTemplateAssetRef, SceneTemplateFile, SceneTemplateFileContent } from "./scene-template-client";
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
  TopologyGlbRef,
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
  normalizeBinding,
  parseBindingPoint,
  bindingPoints,
  bindingTargetOf,
  bindingIsDeviceTelemetry,
  bindingIsAssetAttribute,
  bindingHasUnsupportedDerived,
} from "./binding-normalize";
export {
  AssetApi,
  AssetAccessError,
  parsePlatformAsset,
  parseAssetAttributes,
} from "./asset-client";
export {
  pendingBindingOfWidget,
  pendingBindingsOfLayout,
  pendingBindingsSummary,
  PENDING_ISSUE_LABELS,
} from "./pending-bindings";
export type {
  PendingIssue,
  PendingBindingItem,
  PendingBindingsReport,
} from "./pending-bindings";
export {
  sceneRootOf,
  checkSceneRootConflict,
  sceneRootIssueOf,
  SCENE_ROOT_ISSUE_LABELS,
} from "./scene-root";
export type {
  SceneRootRef,
  SceneRootState,
  SceneRootInfo,
  SceneRootConflict,
  SceneRootIssue,
} from "./scene-root";
export type {
  PlatformAsset,
  AssetAttribute,
  AssetAttributeScope,
  AssetListResult,
  AssetAccessErrorKind,
} from "./asset-client";
export {
  SCENE_WIDGET_DRAFT_NOTICE,
  SCENE_WIDGET_DRAFT_STORAGE_KEY,
  widgetDraftKey,
  readSceneWidgetDraft,
  writeSceneWidgetDraft,
  clearSceneWidgetDraft,
} from "./scene-widget-draft";
export type { SceneWidgetDraft, SceneWidgetDraftRef } from "./scene-widget-draft";
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
  HUD_DEFAULT_GLASS_OPACITY,
  GLASS_OPACITY_MIN,
  GLASS_OPACITY_MAX,
  SCENE_WIDGET_TYPE_REGISTRY,
  EMPTY_WIDGET_LAYOUT,
  WIDGET_SAFE_AREA,
  WIDGET_STAGE_FRAME,
  zoneForWidgetType,
  zoneForExistingWidget,
  isWingWidgetType,
  preferredWingZone,
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
  effectiveHudGlassOpacity,
  widgetHasGlassOverride,
  clearWidgetGlassOverride,
  widgetTypeMeta,
  isKnownWidgetType,
  canAddWidgetType,
  placeNewWidget,
  nextWidgetId,
  parseWidgetScope,
  /*
   * 槽位解析器（2026-11-23 导出）。
   *
   * <p>原先是模块内私有。但 `slot.constant` 这类「设计值」字段的解析规则
   * 属于公共契约（AI 生成模板、配置面板、测试都要按同一套规则写），
   * 藏在私有函数里就只能靠复制。
   */
  parseWidgetSlot,
  widgetScopeKey,
  widgetScopeIsBound,
  layoutHasWidgets,
  overviewSituationTitle,
  buildOverviewSituationLayout,
  withWidgetLayout,
  WIDGET_MODEL_BINDING_HINT,
  OVERVIEW_SITUATION_REPLACE_CONFIRM,
  parseSceneWidgetControl,
  parseSceneWidgetControlList,
} from "./scene-widget-layout";
export type {
  SceneWidget,
  SceneWidgetLayout,
  SceneWidgetSlot,
  SceneWidgetStyle,
  SceneWidgetTypeMeta,
  SceneWidgetTypeId,
  WidgetStageZone,
  SceneWidgetScope,
  SceneWidgetScopeKind,
  SceneWidgetControl,
} from "./scene-widget-layout";
export {
  SCREEN_TEMPLATE_SCHEMA,
  OVERVIEW_SITUATION_TEMPLATE_ID,
  TIANJIAO_HEAT_PUMP_TEMPLATE_ID,
  parseScreenTemplate,
  parseScreenTemplateAiExtension,
  parseScreenTemplateRegion,
  parseScreenTemplateInterface,
  parseTemplateInterfaceBinding,
  parseTemplateInterfaceBindings,
  parseRegionTitles,
  listBuiltinScreenTemplates,
  getBuiltinScreenTemplate,
  resolveScreenTemplate,
  expandDefaultTitle,
  materializeScreenTemplate,
  applyScreenTemplate,
  rematerializeLayout,
  upsertInterfaceBinding,
  upsertRegionTitle,
  saveTemplateDraft,
  bindingFromScopeValue,
  extractInterfaceBindingsFromWidgets,
  adoptScreenTemplate,
  parseScreenObjectBindingContract,
  describeWidgetTypeSchemas,
} from "./screen-template";
export type {
  WidgetTypeSchema,
  ScreenTemplate,
  ScreenTemplateAiExtension,
  ScreenTemplateRegion,
  ScreenTemplateInterface,
  ScreenTemplateValueType,
  ScreenTemplateSourceKind,
  TemplateInterfaceBinding,
  ScreenObjectBindingContract,
  ScreenObjectBindingField,
  ScreenObjectBindingFieldKey,
} from "./screen-template";
export {
  SCREEN_WIRING_SCHEMA,
  SCREEN_WIRING_KIND,
  parseScreenWiring,
  parseScreenObjectWiring,
  applyScreenWiring,
  applyGeneratedWiring,
  applySceneWiring,
  reviewScreenWiring,
  summarizeWiringReport,
  describeDeviceBindingIssue,
} from "./screen-wiring";
export type {
  ScreenWiringDocument,
  ScreenObjectWiring,
  ScreenWiringReview,
  ScreenWiringApplyResult,
  ScreenWiringApplyReport,
  WiringReviewItem,
  WiringIssueStatus,
} from "./screen-wiring";

/*
 * 厂商故障码诊断字典（2026-11-23）。
 *
 * 官方手册的「故障代码 / 描述 / 分析 / 解决方案」四列 → 主数据字典，
 * 前端按码查。引擎能力，四个消费方共用一份口径（告警面板、设备专题、
 * 孪生上色、AI 归因）。
 */
export {
  WsTelemetryChannel,
  buildSubscriptionMessage,
  extractRows as extractWsTelemetryRows,
  toWsUrl,
} from "./ws-telemetry";
export type { WsDeviceSubscription, WsTelemetryStatus } from "./ws-telemetry";
export {
  loadFaultCodes,
  indexFaultCodes,
  extractFaultCodes,
  lookupFaultCodes,
  findFaultCode,
  resetFaultCodeCache,
} from "./fault-codes";
export type { FaultCodeEntry, FaultCodeDictionary } from "./fault-codes";

/*
 * 指标诊断依据 + 工况联动判据（2026-11-23）。
 *
 * 「出水温度 25.3℃ 算不算异常？」制冷正常 5~20、制热正常 30~60 ——
 * 必须带工况才有答案。判据只从主数据字典取，不写死任何数字。
 */
export {
  loadMetricDiagnoses,
  extractMetricDiagnoses,
  resetMetricDiagnosisCache,
  pickRanges,
  evaluateRange,
  describeRange,
  judgeMetric,
  inferWorkingMode,
} from "./metric-diagnosis";
export type {
  MetricDiagnosis,
  MetricDiagnosisMap,
  MetricJudgement,
  MetricVerdict,
  NormalRange,
  WorkingMode,
} from "./metric-diagnosis";
