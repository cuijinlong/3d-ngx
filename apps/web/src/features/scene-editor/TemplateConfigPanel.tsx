import { Button, Input, InputNumber, Select, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  OVERVIEW_SITUATION_TEMPLATE_ID,
  SCENE_WIDGET_TYPE_REGISTRY,
  getBuiltinScreenTemplate,
  resolveScreenTemplate,
  saveTemplateDraft,
  type SceneWidgetLayout,
  type ScreenTemplate,
  type ScreenTemplateInterface,
  type ScreenTemplateRegion,
  type ScreenTemplateSourceKind,
  type ScreenTemplateValueType,
  type WidgetStageZone,
} from "@idt/data-adapter";
import styles from "./BindingConfigDrawer.module.css";

const ZONES: WidgetStageZone[] = ["title", "caption", "left", "right", "bottom"];
const VALUE_TYPES: ScreenTemplateValueType[] = ["number", "number-series", "scope"];
const SOURCES: Array<{ value: ScreenTemplateSourceKind; label: string }> = [
  { value: "site", label: "场站" },
  { value: "scene-topology", label: "本场景拓扑" },
  { value: "device-point", label: "实时设备加测点" },
];

interface TemplateConfigPanelProps {
  layout: SceneWidgetLayout | null;
  sceneTitle?: string;
  onChangeLayout?: (layout: SceneWidgetLayout) => void;
  onClose: () => void;
  onChooseBuiltin?: () => void;
}

function cloneTemplate(template: ScreenTemplate): ScreenTemplate {
  return structuredClone(template);
}

export function TemplateConfigPanel(props: TemplateConfigPanelProps) {
  const resolved = resolveScreenTemplate(props.layout) ?? getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID);
  const [draft, setDraft] = useState<ScreenTemplate | undefined>(resolved ? cloneTemplate(resolved) : undefined);

  useEffect(() => {
    const next = resolveScreenTemplate(props.layout) ?? getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID);
    setDraft(next ? cloneTemplate(next) : undefined);
  }, [props.layout?.templateId, props.layout?.templateDraft, props.layout?.templateVersion]);

  const typeOptions = useMemo(
    () => SCENE_WIDGET_TYPE_REGISTRY.map((item) => ({ value: item.type, label: item.label })),
    [],
  );

  if (!draft) {
    return (
      <aside className={styles.panel} data-testid="template-config-panel">
        <div className={styles.head}>
          <h2>模板配置</h2>
          <Button type="text" onClick={props.onClose}>关闭</Button>
        </div>
        <div className={styles.body}>
          <p className={styles.empty}>还没有可用的画面模板。</p>
        </div>
      </aside>
    );
  }

  const updateRegion = (id: string, patch: Partial<ScreenTemplateRegion>) => {
    setDraft({
      ...draft,
      regions: draft.regions.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  };

  const updateInterface = (regionId: string, key: string, patch: Partial<ScreenTemplateInterface>, nextKey?: string) => {
    setDraft({
      ...draft,
      regions: draft.regions.map((region) => {
        if (region.id !== regionId) return region;
        return {
          ...region,
          interfaces: region.interfaces.map((item) => (item.key === key ? { ...item, ...patch, key: nextKey ?? patch.key ?? item.key } : item)),
        };
      }),
    });
  };

  const addRegion = () => {
    const id = `region-${Date.now().toString(36)}`;
    const meta = SCENE_WIDGET_TYPE_REGISTRY.find((item) => item.type === "metric-card");
    setDraft({
      ...draft,
      regions: [
        ...draft.regions,
        {
          id,
          type: "metric-card",
          zone: "left",
          x: 2,
          y: 50,
          w: meta?.defaultSize.w ?? 20.4,
          h: meta?.defaultSize.h ?? 16,
          defaultTitle: "新卡片",
          interfaces: [{ key: "main", name: "主值", valueType: "number", allowedSources: ["device-point"] }],
        },
      ],
    });
  };

  const save = () => {
    if (!props.layout && !draft) return;
    const current = props.layout ?? { schemaVersion: "1.0.0" as const, widgets: [] };
    const next = saveTemplateDraft(current, draft, props.sceneTitle);
    props.onChangeLayout?.(next);
    message.success("模板说明已保存到当前场景（本地草稿或现有场景存储）");
  };

  const restoreBuiltin = () => {
    const builtin = getBuiltinScreenTemplate(OVERVIEW_SITUATION_TEMPLATE_ID);
    if (builtin) setDraft(cloneTemplate(builtin));
  };

  return (
    <aside className={styles.panel} data-testid="template-config-panel">
      <div className={styles.head}>
        <h2>模板配置</h2>
        <Button type="text" onClick={props.onClose} data-testid="close-template-config">关闭</Button>
      </div>
      <div className={styles.body}>
        <p className={styles.note}>
          以后用 skill 开发大屏，读的是仓库 packages/data-adapter/src/screen-templates/README.md 和这份模板说明，写出 kind 为 screen-wiring 的对接结果，再在工作台用「应用对接结果」加载。不要让用户在抽屉里一项项手填。保存模板说明只写到当前场景或本地草稿，不会改仓库里的内置文件，也不另造后端。
        </p>
        <label className={styles.field}>
          <span>模板名称</span>
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <p className={styles.hint}>稳定 id：{draft.id}，当前版本：{draft.version}</p>
        {draft.regions.map((region) => (
          <div key={region.id} className={styles.regionBlock} data-testid={`template-region-${region.id}`}>
            <div className={styles.regionHead}>
              <span>{region.defaultTitle || region.id}</span>
              <Button
                size="small"
                danger
                onClick={() => setDraft({ ...draft, regions: draft.regions.filter((item) => item.id !== region.id) })}
              >
                删除区域
              </Button>
            </div>
            <label className={styles.field}>
              <span>稳定 id</span>
              <Input value={region.id} onChange={(event) => updateRegion(region.id, { id: event.target.value.trim() || region.id })} />
            </label>
            <div className={styles.row}>
              <label className={styles.field}>
                <span>类型</span>
                <Select
                  value={region.type}
                  options={typeOptions}
                  onChange={(value) => updateRegion(region.id, { type: value })}
                />
              </label>
              <label className={styles.field}>
                <span>分区</span>
                <Select
                  value={region.zone}
                  options={ZONES.map((item) => ({ value: item, label: item }))}
                  onChange={(value) => updateRegion(region.id, { zone: value })}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span>默认标题</span>
              <Input value={region.defaultTitle} onChange={(event) => updateRegion(region.id, { defaultTitle: event.target.value })} />
            </label>
            <div className={styles.row}>
              {(["x", "y", "w", "h"] as const).map((field) => (
                <label key={field} className={styles.field}>
                  <span>{field}</span>
                  <InputNumber
                    value={region[field]}
                    min={0}
                    max={100}
                    step={0.2}
                    onChange={(value) => updateRegion(region.id, { [field]: Number(value ?? region[field]) })}
                  />
                </label>
              ))}
            </div>
            {region.interfaces.map((iface) => (
              <div key={iface.key} className={styles.iface}>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span>接口 key</span>
                    <Input value={iface.key} onChange={(event) => updateInterface(region.id, iface.key, {}, event.target.value.trim() || iface.key)} />
                  </label>
                  <label className={styles.field}>
                    <span>名称</span>
                    <Input value={iface.name} onChange={(event) => updateInterface(region.id, iface.key, { name: event.target.value })} />
                  </label>
                </div>
                <label className={styles.field}>
                  <span>值类型</span>
                  <Select
                    value={iface.valueType}
                    options={VALUE_TYPES.map((item) => ({ value: item, label: item }))}
                    onChange={(value) => updateInterface(region.id, iface.key, { valueType: value })}
                  />
                </label>
                <label className={styles.field}>
                  <span>允许的数据来源</span>
                  <Select
                    mode="multiple"
                    value={iface.allowedSources}
                    options={SOURCES}
                    onChange={(value) => updateInterface(region.id, iface.key, { allowedSources: value })}
                  />
                </label>
                <Button
                  size="small"
                  onClick={() => updateRegion(region.id, { interfaces: region.interfaces.filter((item) => item.key !== iface.key) })}
                >
                  删除接口
                </Button>
              </div>
            ))}
            <Button
              size="small"
              onClick={() => {
                const key = `iface-${region.interfaces.length + 1}`;
                updateRegion(region.id, {
                  interfaces: [...region.interfaces, { key, name: "新接口", valueType: "number", allowedSources: ["device-point"] }],
                });
              }}
            >
              添加接口
            </Button>
          </div>
        ))}
        <div className={styles.actions}>
          <Button onClick={addRegion} data-testid="template-add-region">添加部件区域</Button>
          {draft.id === OVERVIEW_SITUATION_TEMPLATE_ID ? (
            <Button onClick={restoreBuiltin} data-testid="template-restore-builtin">恢复内置综合态势</Button>
          ) : null}
          {!props.layout?.templateId && props.onChooseBuiltin ? (
            <Button onClick={props.onChooseBuiltin}>选用综合态势模板</Button>
          ) : null}
          <Button type="primary" onClick={save} data-testid="template-save">保存模板说明</Button>
        </div>
      </div>
    </aside>
  );
}
