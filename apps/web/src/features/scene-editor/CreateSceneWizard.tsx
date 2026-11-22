import { Button, Form, Input, Modal, Radio, Select, Space, Typography, Upload, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { SceneBaseType, SceneDocument } from "@idt/shared-types";
import {
  GuardHttpError,
  STYLE_PACK_FALLBACK,
  getGuardStatus,
  getProviderKind,
  getTopologyApi,
  type TopologyAssetRef,
  type TopologyBaseType,
  type TopologyCard,
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
  onCancel: () => void;
  onCreated: (doc: SceneDocument) => void;
}

export function CreateSceneWizard({ open, defaultName = "", customerId, onCancel, onCreated }: CreateSceneWizardProps) {
  const connected = getProviderKind() === "guard" && getGuardStatus().connected;
  const [name, setName] = useState(defaultName);
  const [sites, setSites] = useState<TopologySite[]>([]);
  const [topologies, setTopologies] = useState<TopologyCard[]>([]);
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
  const [topologyMode, setTopologyMode] = useState<"create" | "existing">("create");
  const [topologyId, setTopologyId] = useState<string>();
  const [stylePack, setStylePack] = useState<string>(DEFAULT_STYLE_PACK);
  const [baseType, setBaseType] = useState<TopologyBaseType>("auto");
  const [weatherSite, setWeatherSite] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [packFiles, setPackFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  const pack = packs.find((item) => item.stylePack === stylePack) ?? packs[0] ?? FALLBACK_PACK;
  const site = sites.find((item) => item.id === siteId);
  const view = views.find((item) => item.code === viewType);
  const siteTopologies = useMemo(
    () => topologies.filter((item) => !siteId || item.siteId === siteId),
    [topologies, siteId],
  );

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setFile(null);
      setPackFiles([]);
      setRoots([]);
      setLoadError(undefined);
      setStoreHint(undefined);
    }
  }, [open, defaultName]);

  useEffect(() => {
    if (!open || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        const api = getTopologyApi();
        const [list, viewResult, packResult] = await Promise.all([api.list(), api.views(), api.stylePacks()]);
        if (cancelled) return;
        setSites(list.sites);
        setTopologies(list.items);
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
    && stylePack
    && (!needWeather || weatherSite.trim())
    && (!connected || (siteId && viewType)),
  );

  const takeFile = (next: File, kind: "glb" | "pack") => {
    if (next.size > MAX_BYTES) {
      message.error("文件不能超过 48MB");
      return false;
    }
    if (kind === "glb" && !next.name.toLowerCase().endsWith(".glb")) {
      message.error("模型必须是 .glb 文件");
      return false;
    }
    return true;
  };

  const uploadOrSkip = async (next: File, kind: "glb" | "pack", currentTopologyId?: string): Promise<TopologyAssetRef | undefined> => {
    if (!connected) return undefined;
    try {
      return await getTopologyApi().uploadAsset(next, { kind, siteId, topologyId: currentTopologyId });
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
      const uploadedPacks: TopologyAssetRef[] = [];

      let degraded = false;
      if (connected && siteId && file) {
        uploadedGlb = await uploadOrSkip(file, "glb");
        if (!uploadedGlb) degraded = true;
      }
      if (connected && siteId && packFiles.length) {
        for (const item of packFiles) {
          const uploaded = await uploadOrSkip(item, "pack");
          if (uploaded) uploadedPacks.push(uploaded);
          else degraded = true;
        }
      }

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
        let usedTopologyId = topologyMode === "existing" ? topologyId : undefined;
        let usedTopologyName = siteTopologies.find((item) => item.id === usedTopologyId)?.name;
        const sceneMeta = {
          packId,
          packVersion,
          stylePack,
          baseType,
          structurePolicy: baseType,
          weatherSite: needWeather ? weatherSite.trim() : undefined,
          glb: uploadedGlb ? { objectKey: uploadedGlb.objectKey, fileName: uploadedGlb.fileName } : undefined,
          styleFiles: uploadedPacks.map((item) => ({ objectKey: item.objectKey, fileName: item.fileName })),
        };
        if (!usedTopologyId && topologyMode === "create") {
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
        } else if (usedTopologyId && (uploadedGlb || uploadedPacks.length || stylePack)) {
          await getTopologyApi().update(usedTopologyId, sceneMeta);
        }
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
            styleFiles: uploadedPacks.map((item) => ({ objectKey: item.objectKey, fileName: item.fileName, size: item.size, url: item.url })),
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
      const feedback = createdSceneFeedback({ connected, siteId, uploadDegraded: degraded });
      if (feedback.type === "warning") message.warning(feedback.text);
      else message.success(feedback.text);
      onCreated(saved);
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
            <Form.Item label="设备拓扑">
              <Radio.Group value={topologyMode} onChange={(e) => setTopologyMode(e.target.value)}>
                <div>
                  <Radio value="create">{WIZARD_COPY.createTopology}</Radio>
                  <div className={wizardStyles.hint}>{WIZARD_COPY.createTopologyHint}</div>
                  <Radio value="existing">使用已有拓扑</Radio>
                </div>
              </Radio.Group>
              {topologyMode === "existing" ? (
                <Select
                  style={{ marginTop: 8, width: "100%" }}
                  placeholder="选择已有拓扑"
                  value={topologyId}
                  onChange={setTopologyId}
                  options={siteTopologies.map((item) => ({ value: item.id, label: item.name }))}
                />
              ) : null}
            </Form.Item>
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
              if (takeFile(next, "glb")) setFile(next);
              return false;
            }}
            onRemove={() => setFile(null)}
          >
            <Button>选择或拖入 GLB</Button>
          </Upload>
          {file ? (
            <Typography.Text type="secondary">
              {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
            </Typography.Text>
          ) : null}
        </Form.Item>

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

        <Form.Item label="上传套装文件（可选）" extra="支持 .zip / .json / .js / .css，最大 48MB。用于附带自定义套装资源；官方套装只需选择上方卡片。">
          <Upload
            accept=".zip,.json,.js,.css"
            multiple
            fileList={packFiles.map((item, index) => ({ uid: `${item.name}-${index}`, name: item.name, status: "done" }) as UploadFile)}
            beforeUpload={(next) => {
              if (takeFile(next, "pack")) setPackFiles((prev) => [...prev, next]);
              return false;
            }}
            onRemove={(item) => {
              setPackFiles((prev) => prev.filter((fileItem) => fileItem.name !== item.name));
            }}
          >
            <Button>选择套装文件</Button>
          </Upload>
        </Form.Item>
        {storeHint ? <Typography.Paragraph type="secondary">{storeHint}</Typography.Paragraph> : null}
      </Form>
    </Modal>
  );
}
