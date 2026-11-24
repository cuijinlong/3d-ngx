import { Button, Form, Input, Modal, Radio, Select, Space, Typography, Upload, message } from "antd";
import { useEffect, useState } from "react";
import type { SceneBaseType, SceneDocument } from "@idt/shared-types";
import {
  GuardHttpError,
  getSceneTemplateApi,
  type SceneTemplateCard,
  OVERVIEW_SITUATION_TEMPLATE_ID,
  STYLE_PACK_FALLBACK,
  applyScreenTemplate,
  getBuiltinScreenTemplate,
  getConnectedGuardClient,
  getGuardStatus,
  getProviderKind,
  getTopologyApi,
  saveSceneWidgets,
  type TopologyAssetRef,
  type TopologyBaseType,
  type TopologyScopeOptions,
  type TopologySite,
  type TopologyStylePack,
  type TopologyViewOption,
} from "@idt/data-adapter";
import { emptyScene, saveScene } from "../../services/scene/sceneService";
import { importAssetFile } from "../../services/asset/assetService";
import { parseHmiGlb } from "@idt/engine-adapter";
import { attachHmiSnapshot } from "../../services/scene/sceneService";
import { uniqueEntitiesFromParsed } from "../../utils/hmi-entities";
import type { UploadFile } from "antd/es/upload/interface";
import { TemplatePickerDialog } from "./TemplatePickerDialog";
import { isBuiltinLayoutCard, resolveLayoutForSceneTemplate } from "./template-picker";
import {
  createdSceneFeedback,
  describeUploadFallback,
  scopeOptionsExtra,
  scopeOptionsPlaceholder,
  stylePackLoadHint,
  stylePackSelectExtra,
  WIZARD_COPY,
} from "./create-scene-messages";
import wizardStyles from "./CreateSceneWizard.module.css";

const MAX_BYTES = 48 * 1024 * 1024;
const FALLBACK_PACK = STYLE_PACK_FALLBACK.packs[0]!;
const DEFAULT_STYLE_PACK = FALLBACK_PACK.stylePack;

const PEDESTAL_OPTIONS: Array<{ value: TopologyBaseType; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "steel-rail", label: "钢结构" },
  { value: "concrete-pad", label: "混凝土" },
  { value: "none", label: "无" },
];

interface CreateSceneWizardProps {
  open: boolean;
  defaultName?: string;
  customerId?: string;
  /**
   * 从模板库实例化时传入。会预填名称/套装，并自动下载模板模型。
   *
   * <p>注意模型是「下载再上传」：模板的对象在 `scene-template/` 前缀下，
   * 而场景模型必须在 `topology/` 下，平台不允许直接引用。所以这里把模板
   * GLB 拉成本地 File，走和手动上传完全相同的路径 —— 不另开一条捷径，
   * 避免两条路的降级行为不一致。
   */
  template?: SceneTemplateCard | null;
  onCancel: () => void;
  onCreated: (doc: SceneDocument, template?: SceneTemplateCard | null) => void;
}

export function CreateSceneWizard({ open, defaultName = "", customerId, template, onCancel, onCreated }: CreateSceneWizardProps) {
  const connected = getProviderKind() === "guard" && getGuardStatus().connected;
  const [name, setName] = useState(defaultName);
  const [sites, setSites] = useState<TopologySite[]>([]);
  const [views, setViews] = useState<TopologyViewOption[]>([]);
  const [viewsFallback, setViewsFallback] = useState(false);
  const [packs, setPacks] = useState<TopologyStylePack[]>(STYLE_PACK_FALLBACK.packs);
  const [packsFallback, setPacksFallback] = useState(false);
  const [storeHint, setStoreHint] = useState<string>();
  const [siteId, setSiteId] = useState<string>();
  const [viewType, setViewType] = useState<string>();
  const [scope, setScope] = useState<TopologyScopeOptions | null>(null);
  const [scopeMissing, setScopeMissing] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
  const [stylePack, setStylePack] = useState<string>(DEFAULT_STYLE_PACK);
  const [baseType, setBaseType] = useState<TopologyBaseType>("auto");
  const [weatherSite, setWeatherSite] = useState("");
  const [file, setFile] = useState<File | null>(null);
  /*
   * 这个 file 是「从模板下载来的」，还是「用户自己选的」（2026-11-24）。
   *
   * <h3>为什么必须区分</h3>
   *
   * <p>模板模型早就躺在对象存储里，服务端建场景时会自己复制一份
   * （`copyModelFromTemplate`）。**客户端根本不需要再上传一次** ——
   * 客户身份也确实没有上传权限（上传端点只给租户，实测 403）。
   *
   * <p>但前端仍然要**下载**模板模型：`parseHmiGlb` 靠它算出可连对象清单，
   * 那是编辑器里做绑定的前提。所以「下载照旧、上传跳过」。
   *
   * <p>不区分的话只有两种结果：租户白传 10MB，客户直接 403。
   */
  const [fileFromTemplate, setFileFromTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [templateId, setTemplateId] = useState(OVERVIEW_SITUATION_TEMPLATE_ID);
  /*
   * 选中的模板（2026-11-23）。
   *
   * <p>原来模板只能由父组件通过 `template` prop 传进来（`?templateId=` 跳转），
   * 表单里根本没有「挑模板」的入口 —— 用户只能用默认布局建场景。
   * 现在向导内部自己持有选中项，`template` prop 只是初值。
   */
  const [pickedTemplate, setPickedTemplate] = useState<SceneTemplateCard | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const pack = packs.find((item) => item.stylePack === stylePack) ?? packs[0] ?? FALLBACK_PACK;
  const site = sites.find((item) => item.id === siteId);
  const view = views.find((item) => item.code === viewType);

  useEffect(() => {
    if (!open) return;
    setName(template?.name || defaultName);
    setFile(null);
    setFileFromTemplate(false);
    setRoots([]);
    setLoadError(undefined);
    setStoreHint(undefined);
    setPickedTemplate(template ?? null);
    /*
     * 布局跟着模板走。
     *
     * <p>父组件传进来的模板也要过一遍映射 —— 从 `?templateId=` 进来的场景
     * 同样是「平台模板」，布局该按同一套约定决定，不能因为入口不同就
     * 落到默认布局。这也让「外部直达」和「弹框选」两条路的结果一致。
     */
    setTemplateId(resolveLayoutForSceneTemplate(template).layoutId);
    if (template?.stylePack) setStylePack(template.stylePack);
  }, [open, defaultName, template]);

  /*
   * 模型下载独立成一条 effect，依赖 `pickedTemplate`（2026-11-23）。
   *
   * <p>原来它和「打开时重置」写在同一个 effect 里，依赖 `template` prop ——
   * 用户在弹框里换了模板，prop 没变，模型就不会重新下载，
   * 建出来的场景是「新模板的布局 + 上一个模板的模型」。
   */
  useEffect(() => {
    if (!open) return;
    /*
     * 内置布局卡片没有模型可下 —— 它不是平台模板，只是一套区域布局。
     * 提前返回，避免拿 `builtin:xxx` 去请求后端（必然 400）。
     */
    if (!pickedTemplate || isBuiltinLayoutCard(pickedTemplate)) return;

    let cancelled = false;
    (async () => {
      try {
        /*
         * 两条下载路径（2026-11-23）：
         *
         * ① 有 objectKey → 走老的 `downloadAsset`（租户端模板库自己用，
         *    它能拿到档案里的 objectKey）；
         * ② 没有 objectKey → 走 `downloadModel(templateId)`。
         *
         * <p>客户端的 `scene-template-options` 故意不返回 objectKey
         * （那是对象存储的内部布局），所以客户这条路**只能**走 ②。
         * 服务端按 templateId 自己拼 canonical key，客户端不需要知道目录结构。
         */
        const buffer = pickedTemplate.glbObjectKey
          ? await getSceneTemplateApi().downloadAsset(pickedTemplate.glbObjectKey)
          : await getSceneTemplateApi().downloadModel(pickedTemplate.id);
        if (cancelled) return;
        const fileName = `${pickedTemplate.name}.glb`;
        setFile(new File([buffer], fileName, { type: "model/gltf-binary" }));
        /* 标记来源：submit 时据此跳过上传，交给服务端复制 */
        setFileFromTemplate(true);
      } catch (err) {
        if (cancelled) return;
        /*
         * 404 是**正常状态**：模板只有布局没有模型。
         * 这时不该报「下载失败」，而该说清楚「这个模板本来就没模型」——
         * 前者会让人以为是网络问题，反复重试。
         */
        const status = err instanceof GuardHttpError ? err.status : undefined;
        const hasModelHint = pickedTemplate.hasModel;
        if (status === 404) {
          setStoreHint(
            "该模板没有上传模型（只有布局）。可以继续建场景，之后在场景设置里导入模型。",
          );
          return;
        }
        setStoreHint(
          `模板模型下载失败（${err instanceof Error ? err.message : "网络异常"}）。` +
            (hasModelHint
              ? "可以继续建场景，但需要手动上传模型。"
              : "该模板可能未上传模型，可继续建场景后手动导入。"),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pickedTemplate]);

  useEffect(() => {
    if (!open || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        const api = getTopologyApi();
        const [list, viewResult, packResult] = await Promise.all([api.list(), api.views(), api.stylePacks()]);
        if (cancelled) return;
        setSites(list.sites);
        /*
         * 不再保存 `list.items`（2026-11-24）：「使用已有拓扑」选项删掉后，
         * 向导不再需要拓扑清单。`api.list()` 仍然要调 —— `sites` 从同一个回包里来。
         */
        setViews(viewResult.options);
        setViewsFallback(viewResult.usedFallback);
        setPacks(packResult.packs);
        setPacksFallback(Boolean(packResult.usedFallback));
        const packHint = stylePackLoadHint(Boolean(packResult.usedFallback), packResult.status);
        if (packHint) setStoreHint(packHint);
        if (!siteId && list.sites[0]) setSiteId(list.sites[0].id);
        if (!viewType && viewResult.options[0]) setViewType(viewResult.options[0].code);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "读取场站列表失败");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connected]);

  useEffect(() => {
    if (!open || !connected || !siteId || !viewType) {
      setScope(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await getTopologyApi().scopeOptions(siteId, viewType);
      if (cancelled) return;
      setScope(result.data);
      setScopeMissing(result.missing);
      setRoots([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, connected, siteId, viewType]);

  useEffect(() => {
    setBaseType(pack.defaultBaseType);
  }, [pack]);

  const needWeather = pack.requireWeatherSite;
  const canSubmit = Boolean(
    name.trim()
    && templateId
    && stylePack
    && (!needWeather || weatherSite.trim())
    && (!connected || (siteId && viewType)),
  );

  /**
   * 只校验 GLB（2026-11-24）。
   *
   * <p>原来还带一个 `kind === "pack"` 分支，但套装文件上传入口已删掉，
   * 留着参数只会让人以为还有别的调用方。
   */
  const takeFile = (next: File) => {
    if (next.size > MAX_BYTES) {
      message.error("文件不能超过 48MB");
      return false;
    }
    if (!next.name.toLowerCase().endsWith(".glb")) {
      message.error("模型必须是 .glb 文件");
      return false;
    }
    return true;
  };

  const uploadOrSkip = async (next: File): Promise<TopologyAssetRef | undefined> => {
    if (!connected) return undefined;
    try {
      return await getTopologyApi().uploadAsset(next, { kind: "glb", siteId });
    } catch (error) {
      const status = error instanceof GuardHttpError ? error.status : undefined;
      const msg = error instanceof Error ? error.message : "";
      setStoreHint(describeUploadFallback({ status, message: msg }));
      return undefined;
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const [packId, packVersion] = stylePack.includes("@") ? (stylePack.split("@") as [string, string]) : [stylePack, "1.0.0"];
      let uploadedGlb: TopologyAssetRef | undefined;

      let degraded = false;
      /*
       * 只有「用户自己选的模型」才上传（2026-11-24）。
       *
       * <p>模板来的模型不上传：服务端建场景时会从模板复制一份
       * （`copyModelFromTemplate`）。客户端照旧下载它 —— `parseHmiGlb`
       * 要靠它算出可连对象，那是编辑器绑定的前提 —— 但**不再回传**。
       *
       * <p>这一步同时解决两件事：租户白传 10MB；客户身份 403。
       */
      if (connected && siteId && file && !fileFromTemplate) {
        uploadedGlb = await uploadOrSkip(file);
        if (!uploadedGlb) degraded = true;
      }
      /*
       * 套装文件上传已移除（2026-11-24 客户要求删掉「上传套装文件（可选）」）。
       *
       * <p>官方套装只需要选卡片；自定义套装资源没有实际的消费方
       * （引擎按 `packId` 取内置 render 规则），传了也不会生效。
       * 留一个「传了但没用」的入口，比没有更糟 —— 用户会以为它在起作用。
       */

      let next = emptyScene(name.trim());
      next = {
        ...next,
        settings: {
          ...next.settings,
          stylePack,
          packId,
          packVersion,
          baseType: baseType as SceneBaseType,
          pedestal: baseType,
          weatherSite: needWeather ? weatherSite.trim() : undefined,
          weatherPlace: needWeather ? weatherSite.trim() : undefined,
        },
      };

      if (connected && siteId && viewType) {
        let usedTopologyId: string | undefined;
        let usedTopologyName: string | undefined;
        const sceneMeta = {
          packId,
          packVersion,
          stylePack,
          baseType,
          structurePolicy: baseType,
          weatherSite: needWeather ? weatherSite.trim() : undefined,
          glb: uploadedGlb ? { objectKey: uploadedGlb.objectKey, fileName: uploadedGlb.fileName } : undefined,
          styleFiles: [],
          /*
           * 记录「这个场景来自哪个模板」。后端据此在删除模板时拒绝
           * （避免把已被引用模板删掉），也让场景列表能显示模板版本。
           */
          /*
           * 只记录**平台模板库**的 id（2026-11-23）。
           * 内置布局卡片的 id 形如 `builtin:overview-situation`，不是库里的记录 ——
           * 写进后端会让「删除模板时检查引用」找不到那条记录，
           * 也会让场景列表显示一个不存在的模板版本。
           */
          templateId: pickedTemplate && !isBuiltinLayoutCard(pickedTemplate) ? pickedTemplate.id : undefined,
          templateVersion:
            pickedTemplate && !isBuiltinLayoutCard(pickedTemplate) ? pickedTemplate.templateVersion : undefined,
        };
        /*
         * 一律新建一个 `sceneInstance=true` 的场景拓扑（2026-11-24 客户要求）。
         *
         * <h3>为什么删掉「使用已有拓扑」</h3>
         *
         * <p>那个选项允许把场景写进一个**普通设备拓扑**（`sceneInstance=false`）。
         * 后果有两个，都很难看：
         * <ul>
         *   <li>那个拓扑会同时出现在平台「设备拓扑」页和大屏场景列表里，
         *       右侧字段互相看不懂（一个没有 layout，一个有）;</li>
         *   <li>在大屏里改布局/绑定，等于改了这个拓扑本身 ——
         *       别人在设备拓扑页看它，内容已经被大屏覆盖过。</li>
         * </ul>
         *
         * <p>平台「设备拓扑」页请求时带的是 `sceneInstance=false`，
         * 所以只要场景始终是 `sceneInstance=true`，就**不会**在那边出现。
         * 这条约束现在是结构性的，不再依赖用户选对选项。
         */
        const created = await getTopologyApi().create({
          siteId,
          name: `${name.trim()} 拓扑`,
          viewType,
          customerId,
          sceneInstance: true,
          roots,
          ...sceneMeta,
        });
        usedTopologyId = created.id;
        usedTopologyName = created.name;
        const rootNames = (scope?.options ?? []).filter((item) => roots.includes(item.id)).map((item) => item.name);
        next = {
          ...next,
          platform: {
            siteId,
            siteName: site?.name,
            customerId,
            topologyId: usedTopologyId,
            topologyName: usedTopologyName,
            viewType,
            roots,
            rootNames,
            sceneInstance: true,
            publishState: "draft",
            packId,
            packVersion,
            stylePack,
            baseType: baseType as SceneBaseType,
            weatherSite: needWeather ? weatherSite.trim() : undefined,
            glb: uploadedGlb ? { objectKey: uploadedGlb.objectKey, fileName: uploadedGlb.fileName, size: uploadedGlb.size, url: uploadedGlb.url } : undefined,
            styleFiles: [],
          },
        };
      }

      if (file) {
        const parsed = parseHmiGlb(await file.arrayBuffer());
        const asset = await importAssetFile(file, { hmiName: parsed.name, bindables: parsed.bindables.length });
        const entities = uniqueEntitiesFromParsed(parsed).map((item) => ({
          id: item.node,
          name: item.name,
          nodeName: item.node,
          assetId: asset.id,
          transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
          visible: true,
        }));
        next = attachHmiSnapshot(
          {
            ...next,
            rootAssetId: asset.id,
            scene: { ...next.scene, name: name.trim() || parsed.name || next.scene.name },
            entities,
          },
          parsed,
        );
      }

      const saved = await saveScene(next, "新建场景");
      /*
       * 变量名不能叫 template：外层的 template prop 表示「来源模板库」，
       * 这里的是「大屏布局模板」，两者语义不同。旧代码用 template 作局部名，
       * 加了 prop 之后会遮蔽，导致 applyScreenTemplate 收到模板库对象而崩。
       */
      const screenTemplate = getBuiltinScreenTemplate(templateId);
      if (screenTemplate) {
        const layout = applyScreenTemplate(null, screenTemplate, saved.scene.name);
        await saveSceneWidgets(getConnectedGuardClient(), saved.platform?.topologyId, layout, undefined, saved.scene.id);
      }
      const feedback = createdSceneFeedback({ connected, siteId, uploadDegraded: degraded });
      if (feedback.type === "warning") message.warning(feedback.text);
      else message.success(feedback.text);
      onCreated(saved, pickedTemplate);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "创建场景失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新建场景"
      open={open}
      onCancel={onCancel}
      width={640}
      centered
      className={wizardStyles.modal}
      styles={{
        root: { paddingBottom: 0 },
        body: { overflowY: "auto", flex: 1, minHeight: 0 },
        footer: { marginTop: 0, flex: "none" },
      }}
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
            创建场景
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="场景名称" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={WIZARD_COPY.namePlaceholder} maxLength={80} />
        </Form.Item>
        {/*
         * 模板选择（2026-11-23 改）。
         *
         * <p>客户要求：「平台应该有一个地方存储公共的场景模板，3d-ngx 在创建场景的时候
         * 从模板库中选择模板……点击选择模板应该出现弹出框」。
         *
         * <p>原来是两个 Radio（综合态势 / 天骄冷热站），只能选代码里的内置布局，
         * 平台模板库里的模板**在建场景时根本看不到**。现在换成一个入口：
         * 显示当前选中项，点「选择模板」开模板中心弹框。
         *
         * <p>为什么不再保留 Radio：布局已经由所选模板决定（见 template-picker.ts
         * 的映射规则），再给一组 Radio 就会出现「选了热泵模板却手动改成综合态势」
         * 这种自相矛盾的组合，而系统还得决定听谁的。
         */}
        <Form.Item
          label="场景模板"
          required
          extra="从平台模板库选择。选中后会带过来模型、风格套装和对应的画面布局。"
        >
          <div className={wizardStyles.templateRow} data-testid="wizard-template-row">
            <div className={wizardStyles.templateCurrent}>
              <b>{pickedTemplate?.name ?? "未选择模板"}</b>
              <span>
                {pickedTemplate
                  ? resolveLayoutForSceneTemplate(pickedTemplate).note
                  : `默认布局：${resolveLayoutForSceneTemplate(null).layoutName}`}
              </span>
            </div>
            <Button
              data-testid="wizard-open-template-picker"
              onClick={() => setPickerOpen(true)}
            >
              选择模板
            </Button>
          </div>
        </Form.Item>

        {/*
         * 风格套装紧跟在场景模板下面（2026-11-24 客户要求「把风格套装放在场景模板
         * 资源」）。两者本来就是一对：模板带过来默认套装，用户可以在这里改。
         *
         * <p>位置也说明层级关系：**先有模板（模型 + 默认套装），再调套装**。
         * 以前套装排在模型上传之后，中间隔着场站/视图/拓扑，读者要往上翻
         * 才知道模板已经给过一个值了。
         */}
        <Form.Item label="风格套装" required extra={stylePackSelectExtra(packsFallback)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {packs.map((item) => {
              const active = stylePack === item.stylePack;
              return (
                <button
                  key={item.stylePack}
                  type="button"
                  onClick={() => setStylePack(item.stylePack)}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: active ? "2px solid var(--ngx-color-primary)" : "1px solid var(--ngx-color-border)",
                    background: "var(--ngx-color-surface)",
                    color: "var(--ngx-color-text)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 650 }}>{item.label}</div>
                  <div style={{ color: "var(--ngx-color-muted)", fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
                    {item.description}
                    {item.suitability ? `（${item.suitability}）` : ""}
                  </div>
                  <div style={{ color: "var(--ngx-color-muted)", fontSize: 11, marginTop: 6 }}>{item.stylePack}</div>
                </button>
              );
            })}
          </div>
        </Form.Item>

        {connected ? (
          <>
            {loadError ? <Typography.Paragraph type="danger">{loadError}</Typography.Paragraph> : null}
            <Form.Item label="场站" required>
              <Select
                placeholder="选择场站"
                value={siteId}
                onChange={setSiteId}
                options={sites.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            <Form.Item
              label="视图类型"
              required
              extra={viewsFallback ? "视图字典接口不可用，已用内置类型兜底" : undefined}
            >
              <Select
                placeholder="选择视图类型"
                value={viewType}
                onChange={setViewType}
                options={views.map((item) => ({ value: item.code, label: item.label }))}
              />
            </Form.Item>
            {viewType && viewType !== "physical" ? (
              <Form.Item
                label={scope?.scopeLabel || view?.scopeLabel || "范围"}
                extra={scopeOptionsExtra(scopeMissing, scope?.allLabel)}
              >
                <Select
                  mode="multiple"
                  allowClear
                  disabled={scopeMissing || !(scope?.options.length)}
                  placeholder={scopeOptionsPlaceholder(scopeMissing, scope?.allLabel)}
                  value={roots}
                  onChange={setRoots}
                  options={(scope?.options ?? []).map((item) => ({
                    value: item.id,
                    label: item.path ? `${item.name}（${item.path}）` : item.name,
                  }))}
                />
              </Form.Item>
            ) : null}
          </>
        ) : (
          <Typography.Paragraph type="secondary">
            尚未连接后端。现在可以先建本地场景、导入模型做可视化。要按场站和设备拓扑筛选设备，请先到「设置」连接 guard-server。
          </Typography.Paragraph>
        )}

        <Form.Item label="上传模型" extra={WIZARD_COPY.uploadExtra}>
          <Upload
            accept=".glb"
            maxCount={1}
            fileList={file ? ([{ uid: "glb", name: file.name, status: "done" }] as UploadFile[]) : []}
            beforeUpload={(next) => {
              if (takeFile(next)) {
                setFile(next);
                /* 用户手动挑的模型 —— 得自己上传（只有租户能做） */
                setFileFromTemplate(false);
              }
              return false;
            }}
            onRemove={() => {
              setFile(null);
              setFileFromTemplate(false);
            }}
          >
            <Button>选择或拖入 GLB</Button>
          </Upload>
          {file ? (
            <Typography.Text type="secondary">
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </Typography.Text>
          ) : null}
        </Form.Item>

        <Form.Item label="设备底座" extra={baseType === "auto" ? "模块机和冷机用钢结构，水泵和冷却塔用混凝土" : undefined}>
          <Radio.Group value={baseType} onChange={(e) => setBaseType(e.target.value)}>
            {PEDESTAL_OPTIONS.map((item) => (
              <Radio key={item.value} value={item.value}>
                {item.label}
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>

        {needWeather ? (
          <Form.Item label="天气地点" required validateStatus={!weatherSite.trim() ? "error" : undefined} help={!weatherSite.trim() ? "全景套装必须填写 weatherSite" : undefined}>
            <Input value={weatherSite} onChange={(e) => setWeatherSite(e.target.value)} placeholder="例如：南京市江宁区" />
          </Form.Item>
        ) : null}

        {storeHint ? <Typography.Paragraph type="secondary">{storeHint}</Typography.Paragraph> : null}
      </Form>

      {/*
       * 模板中心弹框（2026-11-23）。
       *
       * <p>挂在向导 Modal 内部：选完立刻写回本表单，不走路由 ——
       * 跳页面会把已填的名称/场站/视图丢掉。
       */}
      <TemplatePickerDialog
        open={pickerOpen}
        selectedId={pickedTemplate?.id ?? null}
        onClose={() => setPickerOpen(false)}
        onPick={(next, layoutId) => {
          setPickedTemplate(next);
          setTemplateId(layoutId);
          /*
           * 套装跟着模板走。不跟的话会建出「热泵模板 + 上次选的套装」——
           * 模型是热泵、HUD 配色是别的站，现场一眼就看出不对。
           * 内置布局卡片没有套装字段，这种情况保留用户已选的套装不动。
           */
          if (next.stylePack) setStylePack(next.stylePack);
          /*
           * 名称只在用户还没填时自动带上。
           * 覆盖用户已经敲进去的名字比「没自动填」更让人恼火 ——
           * 尤其先填名再回头挑模板的时候。
           */
          setName((current) => (current.trim() ? current : next.name));
          setPickerOpen(false);
        }}
      />
    </Modal>
  );
}
