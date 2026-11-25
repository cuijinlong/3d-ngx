
import { Button, Input, Upload, message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseHmiGlb } from "@idt/engine-adapter";
import type { ParsedHmiScene, SceneEntity } from "@idt/shared-types";
import { EngineViewport } from "../../engine/react/EngineViewport";
import { WidgetOverlay, hasSummaryCard } from "../scene-widgets/WidgetOverlay";
import { customerScopePath, shouldShowWidgetDraftMark, workbenchChrome } from "../../auth/access";
import { HudSkinProvider } from "../../theme/HudSkin";
import { RuntimeChrome } from "../scene-runtime/RuntimeChrome";
import { ViewportFrame } from "../scene-runtime/ViewportFrame";
import { sceneSurfaceChrome } from "../scene-runtime/runtime-surface";
import { useAuthSession } from "../../auth/AuthSession";
import {
  LOCAL_DRAFT_NOTICE,
  OVERVIEW_SITUATION_REPLACE_CONFIRM,
  OVERVIEW_SITUATION_TEMPLATE_ID,
  adoptScreenTemplate,
  applyScreenTemplate,
  applyScreenWiring,
  getBuiltinScreenTemplate,
  layoutHasWidgets,
  parseScreenWiring,
  pendingBindingsOfLayout,
  summarizeWiringReport,
} from "@idt/data-adapter";
import { ThemeToggle } from "../../theme/ThemeToggle";
import { importAssetFile, importPublicModel, resolveAssetUrl, readAssetBuffer } from "../../services/asset/assetService";
import { attachHmiSnapshot } from "../../services/scene/sceneService";
import { useAppStore } from "../../stores/app.store";
import { useDeviceStore } from "../../stores/device.store";
import { useEditorStore } from "../../stores/editor.store";
import { useSceneStore } from "../../stores/scene.store";
import { useSelectionStore } from "../../stores/selection.store";
import { downloadText } from "../../utils/download";
import { publishSceneAsTemplate } from "../../services/scene/publish-scene-as-template";
import { uniqueEntitiesFromParsed } from "../../utils/hmi-entities";
import { FindObjectPopover } from "./FindObjectPopover";
import { SceneSettingsDrawer } from "./SceneSettingsDrawer";
import { AiBuildPanel } from "./AiBuildPanel";
import { buildAiSceneContext } from "./ai-context";
import { describeSaveTarget } from "./create-scene-messages";
import { captureCanvasThumbnail, findSceneCanvas } from "../../utils/scene-thumbnail";
import { useUnsavedChangesGuard } from "../../hooks/useUnsavedChangesGuard";
import { BindingConfigDrawer, type BindingConfigSection } from "./BindingConfigDrawer";
import { ProgramPanel } from "./ProgramPanel";
import { DataSourcePanel } from "./DataSourcePanel";
import { AlarmList } from "../alarm/AlarmList";
import { TemplateConfigPanel } from "./TemplateConfigPanel";
import { TemplateFilePanel } from "./TemplateFilePanel";
import { describeDroppedBindings, reconcileBindingsOnModelReplace } from "../../utils/reconcile-model-bindings";
import { resolveSceneEntity } from "../../utils/scene-entity";
import { isControlDrawerOpen, resolveSelectableNode } from "../../utils/selectable-node";
import { useStylePackRenderRules } from "../../hooks/useStylePackRenderRules";
import { useTelemetryFeed } from "../../hooks/useTelemetryFeed";
import { useSceneFeedDeviceIds } from "../../hooks/useSceneFeedDeviceIds";
import { useTemplateDocs } from "../../hooks/useTemplateDocs";
import { useCustomerName } from "../../pages/entry/useCustomerName";
import { getGuardStatus, getProviderKind } from "@idt/data-adapter";
import styles from "./EditorShell.module.css";

export function EditorShell() {
  const nav = useNavigate();
  const { role } = useAuthSession();
  const chrome = workbenchChrome(role);
  const document = useSceneStore((s) => s.document);
  const hmi = useSceneStore((s) => s.hmi);
  const setDocument = useSceneStore((s) => s.setDocument);
  const setHmi = useSceneStore((s) => s.setHmi);
  const persist = useSceneStore((s) => s.persist);
  const publish = useSceneStore((s) => s.publish);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const past = useSceneStore((s) => s.past);
  const future = useSceneStore((s) => s.future);
  const dirty = useEditorStore((s) => s.dirty);
  useUnsavedChangesGuard(dirty);
  const persistence = useSceneStore((s) => s.persistence);
  const sceneWidgets = useSceneStore((s) => s.sceneWidgets);
  const setSceneWidgets = useSceneStore((s) => s.setSceneWidgets);
  const selectedNode = useSelectionStore((s) => s.nodeName);
  const selectedEntityId = useSelectionStore((s) => s.entityId);
  const select = useSelectionStore((s) => s.select);
  const [pinnedDrawer, setPinnedDrawer] = useState(false);
  const [workbenchPanel, setWorkbenchPanel] = useState<"closed" | "bindings" | "template" | "program" | "datasources" | "alarms">("closed");
  /* 场景设置抽屉 / AI 搭建面板（2026-11-23） */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  /*
   * 顶栏要显示「还差几块」。放在渲染前算，而不是等打开面板 ——
   * 不打开就看不见的话，用户不会主动去点。
   */
  const pendingReport = pendingBindingsOfLayout(sceneWidgets);
  const [bindingSection, setBindingSection] = useState<BindingConfigSection>("cards");
  const [focusWidgetId, setFocusWidgetId] = useState<string | null>(null);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const previewing = useEditorStore((s) => s.preview);
  const setPreview = useEditorStore((s) => s.setPreview);
  const surface = sceneSurfaceChrome(previewing ? "preview" : "editor", role);

  /*
   * 作用域回显（2026-11-23 客户要求顶栏显示「组织 / 场站 / 分组」）。
   *
   * <p>数据只取 `document.platform` 里**真实存在**的字段：
   * siteName / topologyName / customerId。没有的显示「—」而不是编一个。
   *
   * <p>组织为什么显示 `customerId` 前 8 位而不是客户名：平台接口
   * 没有把客户名带进场景文档（只有 id）。为了不让用户看到一长串 UUID，
   * 截前 8 位 + 悬停给全量 —— 这比编一个「平台演示中心」安全，
   * 因为编的名字在换客户后就是错的。
   */
  /*
   * 组织（客户）名称（2026-11-24 客户报障）。
   *
   * <p>原显示是 `customerId` 前 8 位（`7ce48900…`）。当时的理由写在注释里：
   * 「平台接口没有把客户名带进场景文档（只有 id），为了不让用户看到一长串 UUID
   * 就截前 8 位」。
   *
   * <p>但客户说「组织不应该显示 Id 而是应该名称」—— 这是对的：
   * 顶栏那三格的用途就是让人确认「我在给谁做」，一个 hash 前缀做不到这件事。
   *
   * <p>名字从平台客户名单里解析（`listPlatformCustomers`，与客户选择页同一份数据）。
   * **解析不到时才退回短 id**：名单可能因权限/网络失败，那时显示 id 至少还能区分场站，
   * 显示「—」会让人以为场景没归属。
   */
  const customerName = useCustomerName(document?.platform?.customerId);

  const scopeLabels = useMemo(() => {
    /* document 在这个位置还没被收窄，用可选链取值 */
    const platform = document?.platform;
    const shortId = (id?: string) => (id ? `${id.slice(0, 8)}…` : "");
    const orgName = customerName.trim();
    return {
      org: orgName || (platform?.customerId ? shortId(platform.customerId) : "—"),
      orgFull: orgName
        || (platform?.customerId ? `客户 id ${platform.customerId}` : "场景没有关联客户"),
      site: platform?.siteName || "—",
      siteFull: platform?.siteName || "场景没有关联场站",
      group: platform?.topologyName || platform?.packId || "—",
      groupFull: platform?.topologyName
        || (platform?.packId ? `模板包 ${platform.packId}` : "场景没有关联分组"),
    };
  }, [document?.platform, customerName]);

  /*
   * 草稿状态文案（2026-11-23）。
   *
   * <p>原来它是顶栏上的一个独立小标签（`LOCAL_DRAFT_NOTICE` / 已发布 / 草稿）。
   * 客户要求顶栏只留 11 个入口，标签被移出 —— 但**信息不能丢**：
   * 「这是本地草稿、还没进平台」和「已发布」是两种很不一样的状态，
   * 用户按「保存」时得知道自己存到哪。
   *
   * <p>所以改成「搭建编辑/保存」按钮的 tooltip，并在保存成功提示里带上。
   */
  const draftLabel = useMemo(() => {
    if (role === "customer") return "草稿";
    const localOnly =
      !persistence.available
      || persistence.bindingsSource === "local-draft"
      || shouldShowWidgetDraftMark({
        role,
        showDraftMark: chrome.showWidgetDraftMark,
        widgetsSource: persistence.widgetsSource,
        widgetCount: sceneWidgets?.widgets.length ?? 0,
      });
    if (localOnly) return LOCAL_DRAFT_NOTICE;
    return document?.platform?.publishState === "published" ? "已发布" : "草稿";
  }, [
    role,
    persistence.available,
    persistence.bindingsSource,
    persistence.widgetsSource,
    chrome.showWidgetDraftMark,
    sceneWidgets?.widgets.length,
    document?.platform?.publishState,
  ]);

  /*
   * 保存 / 搭建编辑 的切换（2026-11-23 客户要求）。
   *
   * <p>客户原话是「搭建编辑/保存（切换）」—— 一个按钮两种状态：
   * 有未保存改动时显示「保存」，点它保存；没有改动时显示「搭建编辑」，
   * 点它只提示「已经在编辑态」（画布本来就是可编辑的）。
   *
   * <p>为什么不真做成两个模式：画布一直是编辑态，
   * 强行加一个「只读模式」会和「运行查看」重复。
   */
  const saveOrBuild = useCallback(() => {
    if (!dirty) {
      message.info("当前已是编辑态，画布可以直接调整");
      return;
    }
    void persist("手动保存")
      .then(() => {
        /*
         * 提示必须说清**存到哪了**（2026-11-24 修）。
         *
         * <p>原来这里写死「已保存到本地」，而 `persist()` 在连上平台时
         * 是**真的会 PUT 到平台**（`saveSceneBindings` + `saveSceneWidgets`）。
         * 实测点了保存、提示「已保存到本地」，去查接口却发现数据已经写进去了 ——
         * 提示和事实相反。
         *
         * <p>后果不只是文案不雅：用户以为没入库，会反复点保存；
         * 或者反过来，退出去换台机器发现改动没了（其实是有），
         * 从此不再相信保存按钮。
         */
        message.success(describeSaveTarget(useSceneStore.getState().persistence));
      })
      .catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存失败"));
  }, [dirty, persist]);

  /**
   * 更新缩略图（2026-11-23）。
   *
   * <p>抓当前画布 → 压到 480px 宽 JPEG → 写进 `document.scene.thumbnail`。
   * 必须接着保存，否则刷新就丢 —— 所以这里顺手 `persist` 一次。
   */
  const updateThumbnail = useCallback(() => {
    if (!document) {
      message.warning("场景还没加载完");
      return;
    }
    const result = captureCanvasThumbnail(findSceneCanvas());
    if (!result.ok || !result.dataUrl) {
      message.warning(result.reason ?? "抓取缩略图失败");
      return;
    }
    const next = {
      ...document,
      scene: { ...document.scene, thumbnail: result.dataUrl },
    };
    setDocument(next, "更新缩略图");
    void persist("更新缩略图")
      .then(() => message.success(`缩略图已更新（约 ${Math.round((result.bytes ?? 0) / 1024)} KB）`))
      .catch((error: unknown) => message.error(error instanceof Error ? error.message : "保存缩略图失败"));
  }, [document, setDocument, persist]);

  /** 导出项目 = 导出整份场景文档 JSON（2026-11-23 顶栏入口）。 */
  const exportProject = useCallback(() => {
    if (!document) return;
    downloadText(`${document.scene.name}.json`, JSON.stringify(document, null, 2));
  }, [document]);

  /**
   * 发布为模板（2026-11-23 修正）。
   *
   * <p>★ 原来这里只调 `publish()` —— 那是把**场景**发布（`publishState=published`），
   * 一条模板档案都没建。按钮叫「发布为模板」，行为却是「发布场景」：
   * 用户点完去模板中心找，什么都没有，而且不报错。
   *
   * <p>现在做三件事，顺序不能换：
   * <ol>
   *   <li>先 persist（未保存的改动要进平台，否则模板里的模型是旧的）；</li>
   *   <li>建模板档案 + 上传模型（见 `publishSceneAsTemplate`）；</li>
   *   <li>再把场景本身发布 —— 「发布为模板」隐含「这套东西是定稿的」。</li>
   * </ol>
   *
   * <p>提示文案用返回的 `note`，它会明说「布局与绑定不会进模板」。
   * 不说的后果：用户以为模板存了大屏布局，新建场景发现是空骨架，回头报 bug。
   */
  const publishAsTemplate = useCallback(() => {
    void (async () => {
      /*
       * 「进行中」反馈（2026-11-24 补）。
       *
       * <h3>为什么必须加</h3>
       *
       * <p>实测：点这个按钮后，浏览器依次发 persist（2 个 PUT）→
       * 建模板（POST）→ **下载 10MB 模型再上传 10MB** → update 档案 →
       * publish。本地跑要十几秒，慢网更久。
       *
       * <p>而原来的实现**全程没有任何提示** —— 按钮点下去像没反应，
       * 用户会以为坏了并反复点，于是重复建出多条同名模板。
       * 这比「慢」严重得多：重复的模板档案要手工删，还得逐个清对象存储。
       *
       * <p>用 `message.loading` 拿一个可关闭的句柄，在 finally 里关掉 ——
       * 不能只在成功分支关，抛错时也必须关，否则 loading 会一直转。
       */
      const hint = message.loading("正在发布为模板：保存场景 → 建模板 → 上传模型…", 0);
      try {
        await persist("发布前保存");
        const doc = useSceneStore.getState().document;
        if (!doc) throw new Error("场景不存在");
        const result = await publishSceneAsTemplate(doc);
        await publish();
        hint();
        /*
         * 成功用 success / 部分成功用 warning：note 里会说清
         * 「模型没传上去」或「布局与绑定不进模板」。两种情况都是真的完成了
         * 一次发布，只是结果不完全一样，不能用同一个绿勾含糊过去。
         */
        if (result.modelUploaded) message.success(result.note, 8);
        else message.warning(result.note, 8);
      } catch (error: unknown) {
        hint();
        message.error(error instanceof Error ? error.message : "发布失败");
      }
    })();
  }, [persist, publish]);

  /*
   * 当前场景的在线编程边界（2026-11-24）。
   *
   * <p>取自布局上记录的 `templateId` → 内置模板的 `aiExtension`。
   * 不写死 `DEFAULT_AI_EXTENSION`：模板自己声明「这张大屏允许改什么」，
   * 一张客户成品屏可能只允许改绑定、不允许增删卡片。
   *
   * <p>取不到模板（布局没有 templateId / 模板已下线）时返回 null，
   * 由面板回落到代码默认值 —— 不能因为查不到模板就让 AI 完全不能动。
   */
  const aiExtensionForScene = useMemo(() => {
    const templateId = sceneWidgets?.templateId;
    if (!templateId) return null;
    return getBuiltinScreenTemplate(templateId)?.aiExtension ?? null;
  }, [sceneWidgets?.templateId]);

  /*
   * 模板里的约定文件（2026-11-24）。
   *
   * <p>客户要求：「我可以在文件资源管理器中编辑我的需求，然后让 AI 读取
   * 帮我开发 AI 构建大屏」。
   *
   * <p>`enabled: aiOpen` —— 面板没打开就不该读盘并发请求。
   * 读不到时返回空数组，AI 构建照常可用（少一份需求文档是降级，不是故障）。
   */
  const templateDocsState = useTemplateDocs({
    platform: document?.platform,
    sceneName: document?.scene.name,
    enabled: aiOpen,
  });

  const devices = useDeviceStore((s) => s.devices);
  const refreshDevices = useDeviceStore((s) => s.refresh);
  const ready = useAppStore((s) => s.ready);

  const [modelUrl, setModelUrl] = useState<string>();
  const [loadState, setLoadState] = useState("未加载模型");

  useEffect(() => {
    if (ready) void refreshDevices();
  }, [ready, refreshDevices]);

  useEffect(() => () => setPreview(false), [setPreview]);

  useEffect(() => {
    const id = document?.rootAssetId;
    if (!id) {
      setModelUrl(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { getAsset } = await import("../../services/asset/assetService");
        const asset = await getAsset(id);
        if (!asset || cancelled) return;
        const url = await resolveAssetUrl(asset);
        if (!cancelled) setModelUrl(url);
        const buffer = await readAssetBuffer(id);
        const parsed = parseHmiGlb(buffer);
        if (!cancelled) setHmi(parsed);
      } catch (error) {
        if (!cancelled) message.error(error instanceof Error ? error.message : "模型读取失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [document?.rootAssetId, setHmi]);


  const applyParsedScene = useCallback(
    async (parsed: ParsedHmiScene, assetId: string, sceneName?: string) => {
      if (!document) return;
      const entities: SceneEntity[] = uniqueEntitiesFromParsed(parsed).map((item) => ({
        id: item.node,
        name: item.name,
        nodeName: item.node,
        assetId,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      }));
      const hadModel = Boolean(document.rootAssetId);
      const reconciled = hadModel
        ? reconcileBindingsOnModelReplace({
            previousEntities: document.entities,
            previousBindings: document.bindings,
            nextEntities: entities,
          })
        : { bindings: document.bindings, kept: document.bindings.length, dropped: [] };
      const next = attachHmiSnapshot(
        {
          ...document,
          rootAssetId: assetId,
          scene: {
            ...document.scene,
            name: sceneName || parsed.name || document.scene.name,
          },
          entities,
          bindings: reconciled.bindings,
        },
        parsed,
      );
      setDocument(next, "导入模型");
      setHmi(parsed);
      if (hadModel && (reconciled.dropped.length || reconciled.kept)) {
        if (reconciled.dropped.length) {
          message.warning(
            `已更换模型。按对象名保留了 ${reconciled.kept} 条三维绑定，有 ${reconciled.dropped.length} 条对不上已解绑。${describeDroppedBindings(reconciled.dropped)}`,
          );
        } else {
          message.success(`已更换模型。按对象名保留了 ${reconciled.kept} 条三维绑定。`);
        }
      }
    },
    [document, setDocument, setHmi],
  );

  const importGlb = async (file: File) => {
    try {
      setLoadState("正在解析 GLB…");
      const parsed = await parseHmiGlb(await file.arrayBuffer());
      const asset = await importAssetFile(file, { hmiName: parsed.name, bindables: parsed.bindables.length });
      await applyParsedScene(parsed, asset.id, parsed.name);
      let saved = false;
      try {
        await persist("导入后自动保存");
        saved = true;
      } catch (error) {
        message.warning(error instanceof Error ? `模型已导入，但自动保存失败：${error.message}` : "模型已导入，但自动保存失败，请再点一次保存");
      }
      const objectCount = uniqueEntitiesFromParsed(parsed).length;
      message.success(
        parsed.source === "hmi-extras"
          ? `已从模型读取 ${objectCount} 个对象${saved ? "，并已自动保存" : ""}`
          : `模型没有可用的画面文档${saved ? "，并已自动保存" : ""}`,
      );
      setLoadState(saved ? "模型已导入并保存" : "模型已导入");
    } catch (error) {
      setLoadState("加载失败");
      message.error(error instanceof Error ? error.message : "导入失败");
    }
    return false;
  };

  const importSample = async () => {
    try {
      setLoadState("正在加载示例模型…");
      const asset = await importPublicModel("/models/tianjiao.glb", "天骄科技园");
      const buffer = await readAssetBuffer(asset.id);
      const parsed = parseHmiGlb(buffer);
      await applyParsedScene(parsed, asset.id, parsed.name || "天骄科技园");
      let saved = false;
      try {
        await persist("导入后自动保存");
        saved = true;
      } catch (error) {
        message.warning(error instanceof Error ? `示例模型已导入，但自动保存失败：${error.message}` : "示例模型已导入，但自动保存失败，请再点一次保存");
      }
      message.success(`示例模型已导入，解析到 ${uniqueEntitiesFromParsed(parsed).length} 个对象${saved ? "，并已自动保存" : ""}`);
      setLoadState(saved ? "示例模型已导入并保存" : "示例模型已导入");
    } catch (error) {
      setLoadState("示例模型不可用");
      message.error(error instanceof Error ? error.message : "示例模型加载失败，请直接导入本地 GLB");
    }
  };


  const resolveNode = (raw: string | null) => resolveSelectableNode(hmi, document, raw);

  const onSelect = (nodeName: string | null) => {
    const node = resolveNode(nodeName);
    if (!node) {
      select(null, null);
      setPinnedDrawer(false);
      return;
    }
    const entity = resolveSceneEntity(document, node);
    select(entity?.id ?? node, entity?.nodeName ?? node);
    /*
     * 点选三维对象只负责铭牌和底部启停，**不碰核对抽屉**（2026-11-23 客户要求）。
     *
     * <p>原来这里会「若核对抽屉开着就切到设备页」。虽然不会主动打开，
     * 但用户正在看设备绑定清单时点一下 3D，清单会自己跳走 ——
     * 同样是「点击部件改变了核对面板的状态」。现在完全不联动。
     */
  };

  const selectedEntity = useMemo(() => {
    if (!document) return undefined;
    return resolveSceneEntity(document, selectedNode) ?? document.entities.find((e) => e.id === useSelectionStore.getState().entityId);
  }, [document, selectedNode]);


  /*
   * 订阅范围与大屏共用同一实现（2026-11-23）。
   *
   * <p>原来这里只取 `document.bindings` 的 deviceId，漏了两路：
   *   · 槽位直绑的设备（网关不是 GLB 对象，只在槽里引用）
   *   · scope 解析出的设备
   *
   * <p>后果是编辑器里「进水 / 出水」永远 `—`、「系统启停」永远
   * 「状态未知」，而运行态都有值 —— 设计时看到的不是成品。
   * 这正是「所见即所得」做不到的原因，不是显示层的问题。
   */
  const {
    deviceIds,
    setScopeDevices,
  } = useSceneFeedDeviceIds(document?.bindings, sceneWidgets);

  /*
   * 设计期同样只订阅实时数据（2026-11-23）。
   *
   * <p>去掉演示开关后，这里**必须**和运行时一致：编辑器里看得到的数据
   * 就是交付后大屏上会看到的数据。留着 demo 分支会让「设计时满格、
   * 打开后空白」，正是客户反复说的「所见即所得没做到」。
   */
  useTelemetryFeed(deviceIds);

  /*
   * 设计态也要应用风格套装规则（2026-11-23）。
   *
   * <p>只在运行时生效会让「设计时看不到阀门变色、管道变暗」——
   * 而所见即所得是硬要求：设计师在这里调布局，必须看到交付后的样子。
   * 与 RuntimeShell 调用同一个 hook，改一处两边都变。
   */
  useStylePackRenderRules(
    document?.platform?.stylePack ?? document?.settings?.stylePack,
    /*
     * 编辑器没有 `topologyId` 变量（它从 store 拿 document）。
     * 用 `platform.topologyId` —— 场景文档里存了这个引用。
     */
    document?.platform?.topologyId,
  );

  const drawerOpen = isControlDrawerOpen(selectedNode, pinnedDrawer);
  if (!document) return null;

  const objectCount = hmi ? uniqueEntitiesFromParsed(hmi).length : 0;
  const boundCount = document.bindings.filter((b) => b.deviceId).length;
  const guardStatus = getGuardStatus();
  /* 与运行时同一口径：正常不挂标签，只提示「未连接平台」。 */
  const dataLabel = guardStatus.connected && getProviderKind() === "guard" ? "" : "未连接平台";

  return (
    <HudSkinProvider enabled={previewing}>
    <div className={`${styles.shell} ${previewing ? styles.shellPreview : ""}`} data-ngx-hud={previewing ? "on" : undefined} data-testid={previewing ? "runtime-preview-shell" : "editor-shell"}>
      {previewing ? (
        <RuntimeChrome
          title={document.scene.name}
          dataLabel={dataLabel}
          showExitPreview={surface.showExitPreview}
          onExitPreview={() => setPreview(false)}
          showThemeToggle={surface.showThemeToggle}
          fullscreen={previewFullscreen}
          onToggleFullscreen={() => setPreviewFullscreen((value) => !value)}
        />
      ) : (
      <>
      {/*
       * 顶栏（2026-11-23 客户指定 11 个入口）。
       *
       * <p>客户原话：「设计标题栏只有以下内容：返回，标题，组织,场站,分组
       * (这三处名称字小点)，按钮AI搭建、发布为模板、更新缩略图、导出项目、
       * 保存、场景设置、搭建编辑/保存（切换）、运行查看」。
       *
       * <p>原来这里是 **18 个** 按钮，1920 屏勉强排开、窄屏换行成三层。
       * 这次把「配置类」全部搬进「场景设置」抽屉 —— **功能一个没删**。
       */}
      <div className={styles.toolbar} data-testid="editor-toolbar">
        <button
          type="button"
          className={styles.back}
          data-testid="back-to-scenes"
          onClick={() => nav(customerScopePath(document?.platform?.customerId))}
          title="返回场景管理"
        >
          返回
        </button>
        <Input
          className={styles.name}
          data-testid="scene-title"
          value={document?.scene.name ?? ""}
          onChange={(e) => {
            if (!document) return;
            setDocument({ ...document, scene: { ...document.scene, name: e.target.value } }, "重命名");
          }}
        />
        {/*
         * 作用域面包屑（2026-11-24 客户要求）。
         *
         * <p>客户原话：「左上角组织，场站，分组，这四个字去掉，他们的值用
         * 类似面包屑的方式，但是要好看点」。
         *
         * <h3>为什么去掉标签字之后还要留 title</h3>
         *
         * <p>标签去了以后，三个名字并排放在一起，新用户（特别是客户方的
         * 运维）可能分不出哪一级是哪一级。所以层级信息沉到 `title` 里：
         * 悬停仍然能看到「组织 — 平台演示中心」这种完整说明，
         * 但默认不占顶栏宽度。
         */}
        <nav className={styles.scope} data-testid="scene-scope" aria-label="当前作用域">
          <span className={styles.scopeCrumb} title={`组织 — ${scopeLabels.orgFull}`}>
            {scopeLabels.org}
          </span>
          <span className={styles.scopeSep} aria-hidden="true">›</span>
          <span className={styles.scopeCrumb} title={`场站 — ${scopeLabels.siteFull}`}>
            {scopeLabels.site}
          </span>
          <span className={styles.scopeSep} aria-hidden="true">›</span>
          {/* 最末一级是当前正在编辑的，用主色 + 稍重字重收尾 */}
          <span
            className={`${styles.scopeCrumb} ${styles.scopeCurrent}`}
            title={`分组 — ${scopeLabels.groupFull}`}
          >
            {scopeLabels.group}
          </span>
        </nav>
        <span className={styles.grow} />
        <Button
          data-testid="open-ai-build"
          type={aiOpen ? "primary" : "default"}
          onClick={() => setAiOpen((value) => !value)}
        >
          AI 搭建
        </Button>
        <Button data-testid="publish-as-template" onClick={publishAsTemplate}>
          发布为模板
        </Button>
        <Button data-testid="update-thumbnail" onClick={updateThumbnail}>
          更新缩略图
        </Button>
        <Button data-testid="export-project" onClick={exportProject}>
          导出项目
        </Button>
        <Button
          data-testid="open-scene-settings"
          type={settingsOpen ? "primary" : "default"}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          场景设置
        </Button>
        <Button
          data-testid="build-save-toggle"
          type={dirty ? "primary" : "default"}
          onClick={saveOrBuild}
          title={dirty ? `当前状态：${draftLabel} · 点此保存` : `当前状态：${draftLabel} · 已在编辑态`}
        >
          {dirty ? "保存" : "搭建编辑"}
        </Button>
        <Button
          data-testid="enter-preview"
          type="primary"
          onClick={() => {
            setWorkbenchPanel("closed");
            setPreview(true);
          }}
        >
          运行查看
        </Button>
      </div>
      <SceneSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        history={
          <>
            <Button disabled={!past.length} onClick={undo}>撤销</Button>
            <Button disabled={!future.length} onClick={redo}>重做</Button>
          </>
        }
        object={
          <>
            <FindObjectPopover hmi={hmi} devices={devices} onPick={onSelect} />
          </>
        }
        wiring={
          <>
            <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => {
            void (async () => {
            let raw: unknown;
            try {
            raw = JSON.parse(await file.text());
            } catch {
            message.error("对接文件不是合法 JSON");
            return;
            }
            const wiring = parseScreenWiring(raw);
            if (!wiring) {
            message.error("对不上画面对接文件约定。请按接口说明生成 kind 为 screen-wiring 的文件。");
            return;
            }
            const result = applyScreenWiring({
            wiring,
            layout: sceneWidgets,
            bindings: document.bindings,
            entities: document.entities,
            devices,
            sceneName: document.scene.name,
            });
            setSceneWidgets(result.layout);
            setDocument({ ...document, bindings: result.bindings }, "应用对接结果");
            setBindingSection("cards");
            setWorkbenchPanel("bindings");
            const text = summarizeWiringReport(result.report);
            if (result.report.rejectedInterfaces || result.report.rejectedObjects) message.warning(text);
            else message.success(text);
            })();
            return false;
            }}>
            <Button data-testid="apply-screen-wiring-toolbar">应用对接结果</Button>
            </Upload>
          </>
        }
        appearance={
          <>
            <ThemeToggle />
          </>
        }
        templates={
          <>
            {!sceneWidgets?.templateId ? (
              <Button
                data-testid="choose-screen-template"
                onClick={() => {
                  const builtin = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID);
                  if (!builtin) return;
                  const sceneName = document?.scene.name ?? "未命名场景";
                  if (
                    layoutHasWidgets(sceneWidgets)
                    && typeof window !== "undefined"
                    && !window.confirm(OVERVIEW_SITUATION_REPLACE_CONFIRM)
                  ) {
                    return;
                  }
                  const next = layoutHasWidgets(sceneWidgets)
                    ? adoptScreenTemplate(sceneWidgets!, builtin, sceneName)
                    : applyScreenTemplate(sceneWidgets, builtin, sceneName);
                  setSceneWidgets(next);
                  message.success("已选用综合态势模板");
                }}
              >
                选择画面模板
              </Button>
            ) : null}
          </>
        }
        templateFiles={
          <TemplateFilePanel platform={document?.platform} sceneName={document?.scene.name} />
        }
        assets={
          <>
            <Upload accept=".glb,.gltf" showUploadList={false} beforeUpload={(f) => importGlb(f)}>
              <Button>导入模型</Button>
            </Upload>
            <Button onClick={() => void importSample()}>导入示例</Button>
          </>
        }
        panels={
          <>
            <Button
            data-testid="open-binding-config"
            type={workbenchPanel === "bindings" ? "primary" : "default"}
            danger={pendingReport.items.length > 0}
            onClick={() => {
            /*
            * 有待配置项时直接落到「待配置」页：那是用户此刻最该做的事。
            * 全部配好时才进「画面卡片」复核 —— 默认落在错的地方等于多一次点击。
            */
            if (pendingReport.items.length > 0) setBindingSection("pending");
            setWorkbenchPanel((value) => (value === "bindings" ? "closed" : "bindings"));
            }}
            >
            核对绑定
            {pendingReport.items.length > 0 ? ` · 待配 ${pendingReport.items.length}` : ""}
            </Button>
            <Button
            data-testid="open-template-config"
            type={workbenchPanel === "template" ? "primary" : "default"}
            onClick={() => setWorkbenchPanel((value) => (value === "template" ? "closed" : "template"))}
            >
            模板配置
            </Button>
            <Button
            data-testid="open-datasource-panel"
            type={workbenchPanel === "datasources" ? "primary" : "default"}
            onClick={() => setWorkbenchPanel((value) => (value === "datasources" ? "closed" : "datasources"))}
            >
            数据源
            </Button>
            <Button
            data-testid="open-alarm-panel"
            type={workbenchPanel === "alarms" ? "primary" : "default"}
            onClick={() => setWorkbenchPanel((value) => (value === "alarms" ? "closed" : "alarms"))}
            >
            告警
            </Button>
            <Button
            data-testid="open-program-panel"
            type={workbenchPanel === "program" ? "primary" : "default"}
            onClick={() => setWorkbenchPanel((value) => (value === "program" ? "closed" : "program"))}
            >
            在线编程
            </Button>
          </>
        }
      />
      <AiBuildPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        sceneId={document?.scene.id}
        /*
         * 交给 AI 的场景上下文（2026-11-24 抽出 `ai-context.ts`）。
         *
         * <p>原来这里只有 `id / type / title` 三项。实测后果是 AI
         * **一次也没绑上过数据** —— 它给出了准确的理由「上下文未提供遥测键」。
         * 缺的是两样东西，都属于「不说清就只能猜」：
         * <ul>
         *   <li>每张卡的**槽位键**（`bind-telemetry` 的 `slotKey`）——
         *       猜错就是 `slot-not-found`，整个提案被拒；</li>
         *   <li>场景里**真实存在的遥测键**（从已有绑定推导）——
         *       编出来的键在大屏上永远是空值，而且不报错。</li>
         * </ul>
         *
         * <p>都从场景文档直接读，不发请求，所以打开面板不会多打接口。
         */
        context={{
          ...buildAiSceneContext({ document, layout: sceneWidgets }),
          templateDocs: templateDocsState.docs,
        }}
        /*
         * 让界面能显示「AI 正在参考哪个模板的哪些文件」。
         * 不显示的话，用户改完 requirements.md 却没生效时无从判断
         * 是「AI 没读到」还是「AI 读了没照做」。
         */
        templateDocsMeta={{
          templateName: templateDocsState.template?.name ?? null,
          files: templateDocsState.docs.map((doc) => doc.name),
          error: templateDocsState.error,
          loading: templateDocsState.loading,
          requirements: templateDocsState.requirements ?? null,
          onReload: templateDocsState.reload,
        }}
        /*
         * AI 改动的落点（2026-11-24）。
         *
         * <p>三个 prop 合起来才让「AI 说改好了」变成「布局真的变了」：
         * layout 给它现状、aiExtension 给它边界、onApplyLayout 给它出口。
         * 少任何一个，面板就只会聊天。
         */
        layout={sceneWidgets}
        aiExtension={aiExtensionForScene}
        onApplyLayout={setSceneWidgets}
      />
      </>
      )}
      <div className={`${styles.body} ${!previewing && workbenchPanel !== "closed" ? styles.bodyConfig : ""}`}>
        {/*
         * 画布始终按大屏皮肤渲染（2026-11-23）。
         *
         * <p>「所见即所得」的核心是**画布上就是成品**：卡片、3D 背景、标题
         * 在设计时就该是深色玻璃大屏的样子。原来只有点「预览运行」才切换，
         * 于是设计师整段时间都在看一套浅色 UI，发布出去却是另一套。
         *
         * <p>外层 `HudSkinProvider enabled` 只覆盖画布；顶栏、工作台面板、
         * 状态栏仍是编辑器外观 —— 那些是大屏上不存在的东西，
         * 让它们保持工具的样子更能区分「内容」和「工具」。
         */}
        <HudSkinProvider enabled>
        <div className={styles.viewport} data-ngx-hud="on">
          <EngineViewport
            mode={surface.viewportMode}
            modelUrl={modelUrl}
            emptyText="还没有模型"
            gridEnabled={previewing ? false : document.settings.gridEnabled}
            selectedNode={selectedNode}
            bindings={document.bindings}
            hmi={hmi}
            dataLabel={dataLabel}
            dataSource="live"
            drawerOpen={drawerOpen}
            resolveNode={resolveNode}
            onToggleDrawer={() => {
              if (selectedNode) return;
              setPinnedDrawer((open) => !open);
            }}
            onSelect={onSelect}
            onLoaded={(names) => setLoadState(names.length ? `已加载 ${names.length} 个节点` : "模型无节点")}
            onError={(msg) => {
              setLoadState("加载失败");
              message.error(msg);
            }}
            onOverview={() => {
              const summary = hasSummaryCard(sceneWidgets?.widgets ?? []);
              if (summary) setFocusWidgetId(summary.id);
            }}
          >
            <ViewportFrame variant={surface.frame} />
            <WidgetOverlay
              layout={sceneWidgets}
              surface={surface.widgetSurface}
              arranging={false}
              readOnly={true}
              showDraftMark={surface.showDraftMark}
              role={role}
              widgetsSource={persistence.widgetsSource}
              sceneTitle={document.scene.name}
              bindings={document.bindings}
              devices={devices}
              hmi={hmi}
              selectedNode={selectedNode}
              selectedEntityId={selectedEntityId}
              platform={document.platform}
              focusWidgetId={focusWidgetId}
              activeWidgetId={activeWidgetId}
              onConsumeFocus={() => setFocusWidgetId(null)}
              onScopeDevicesChange={setScopeDevices}
              onChangeLayout={setSceneWidgets}
              onSelectWidget={(id) => {
                /*
                 * 点部件只「选中」，**不自动打开核对绑定**（2026-11-23 客户要求）。
                 *
                 * <p>原来这里会 `setWorkbenchPanel("bindings")` ——
                 * 每次点一张卡片，右侧就弹出整个核对抽屉，把画布压掉一大半。
                 * 而「核对绑定」是低频的配置动作，不该和「看一眼这张卡」绑定。
                 *
                 * <p>现在：点部件 → 高亮 + 聚焦（用于定位），
                 * 要看绑定就走「场景设置 → 核对绑定」。
                 */
                setActiveWidgetId(id);
                setFocusWidgetId(id);
              }}
            />
          </EngineViewport>
        </div>
        </HudSkinProvider>
        {!previewing && workbenchPanel === "bindings" ? (
          <BindingConfigDrawer
            layout={sceneWidgets}
            sceneTitle={document.scene.name}
            platform={document.platform}
            bindings={document.bindings}
            devices={devices}
            hmi={hmi}
            entities={document.entities}
            focusWidgetId={activeWidgetId}
            focusEntity={selectedEntity}
            section={bindingSection}
            onSectionChange={setBindingSection}
            onChangeLayout={setSceneWidgets}
            onChangeBindings={(next) => setDocument({ ...document, bindings: next }, "应用对接结果")}
            onSelectEntity={(entityId, nodeName) => select(entityId, nodeName ?? entityId)}
            onClose={() => setWorkbenchPanel("closed")}
          />
        ) : null}
        {!previewing && workbenchPanel === "datasources" ? (
          <DataSourcePanel
            document={document}
            devices={devices}
            onChangeSources={(sources) => {
              /* 走 setDocument 才进撤销栈 —— 手改字段不会。 */
              setDocument({ ...document, dataSources: sources }, "修改数据源");
            }}
            onClose={() => setWorkbenchPanel("closed")}
          />
        ) : null}
        {!previewing && workbenchPanel === "alarms" ? (
          <aside
            data-testid="alarm-panel"
            style={{
              width: 340,
              flex: "0 0 340px",
              borderLeft: "1px solid var(--ngx-color-border)",
              background: "var(--ngx-color-surface)",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
              <h3 style={{ margin: 0, fontSize: 14, flex: 1 }}>告警</h3>
              <Button size="small" onClick={() => setWorkbenchPanel("closed")}>关闭</Button>
            </div>
            {/*
             * 复用 `AlarmList`：它已经处理了确认/清除、按钮禁用、
             * 处置后立即刷新。不要在面板里再写一套。
             */}
            <AlarmList />
          </aside>
        ) : null}
        {!previewing && workbenchPanel === "program" ? (
          <ProgramPanel
            layout={sceneWidgets}
            document={document}
            onChangeLayout={setSceneWidgets}
            onClose={() => setWorkbenchPanel("closed")}
            /*
             * 把设备表和场景范围传给脚本 —— 「按设备名生成绑定」
             * 这类脚本需要它，否则只能靠人肉抄 id。
             */
            devices={devices}
            platform={document.platform}
          />
        ) : null}
        {!previewing && workbenchPanel === "template" ? (
          <TemplateConfigPanel
            layout={sceneWidgets}
            sceneTitle={document.scene.name}
            onChangeLayout={setSceneWidgets}
            onClose={() => setWorkbenchPanel("closed")}
            onChooseBuiltin={() => {
              const builtin = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID);
              if (!builtin) return;
              setSceneWidgets(applyScreenTemplate(sceneWidgets, builtin, document.scene.name));
              message.success("已选用综合态势模板");
            }}
          />
        ) : null}
      </div>
      {!previewing ? (
      <footer className={styles.status}>
        <span>{document.rootAssetId ? "已导入模型" : "还没有模型"}</span>
        <span>{loadState}</span>
        <span>可点选 {objectCount} 个对象</span>
        <span>已连接 {boundCount} 台设备</span>
        {dirty ? <span>未保存</span> : <span>已保存</span>}
        <span>{dataLabel}</span>
      </footer>
      ) : null}
    </div>
    </HudSkinProvider>
  );
}


