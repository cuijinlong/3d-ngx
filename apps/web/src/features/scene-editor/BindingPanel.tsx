
import { Alert, Button, Checkbox, Input, Popover, Select, message } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionMapping,
  CommandDef,
  Device,
  DeviceBinding,
  DevicePoint,
  ParsedHmiScene,
  SceneEntity,
  TelemetryMapping,
} from "@idt/shared-types";
import { describeCommandError, formatPlatformDeviceName, getCommandProvider, getDataProvider, getProviderKind, isRealtimePlatformDevice, isVirtualPlatformDevice, WIDGET_MODEL_BINDING_HINT } from "@idt/data-adapter";
import { useDeviceStore } from "../../stores/device.store";
import { useSceneStore } from "../../stores/scene.store";
import { createId } from "../../utils/id";
import { buildDeviceBinding, signalsForEntity, suggestPoint } from "../../utils/bind-by-name";
import { explainRunningState } from "../../utils/device-plates";
import { uniqueEntitiesFromParsed } from "../../utils/hmi-entities";
import { SceneJumpSection } from "./SceneJumpSection";
import styles from "./BindingPanel.module.css";

type SourceOp = "none" | "timeseries" | "attribute" | "alarm";

function isValveAction(kind?: string, name?: string): boolean {
  return kind === "valve" && (name === "open" || name === "close");
}

function mappingForAction(binding: DeviceBinding | undefined, actionId: string): ActionMapping | undefined {
  return binding?.actionMappings.find((item) => item.actionId === actionId);
}

function mappingForField(binding: DeviceBinding | undefined, field: string): TelemetryMapping | undefined {
  return binding?.telemetryMappings.find((item) => item.field === field);
}

function actionSummary(mapping: ActionMapping | undefined, commands: CommandDef[]): { text: string; auto: boolean } {
  if (!mapping) return { text: "—", auto: false };
  const parts: string[] = [];
  if (mapping.telemetryKey) parts.push(`使用时间序列“${mapping.telemetryKey}”`);
  else if (mapping.whenValue !== undefined && mapping.whenValue !== null && mapping.whenValue !== "") {
    parts.push(String(mapping.whenValue) === "true" || mapping.whenValue === true ? "True" : String(mapping.whenValue) === "false" || mapping.whenValue === false ? "False" : String(mapping.whenValue));
  }
  if (mapping.commandId) {
    const current = commands.find((item) => item.id === mapping.commandId);
    const label = current?.label || mapping.commandId;
    parts.push(current ? `下发命令“${label}”` : `下发命令“${mapping.commandId}”（失效）`);
  }
  return { text: parts.join(" · ") || "—", auto: false };
}

function dataSummary(mapping: TelemetryMapping | undefined, suggested?: string): { text: string; auto: boolean } {
  if (!mapping?.telemetryKey) return { text: "—", auto: false };
  return { text: `使用时间序列“${mapping.telemetryKey}”`, auto: Boolean(suggested && mapping.telemetryKey === suggested) };
}

export function BindingPanel({
  entity,
  hmi,
  devices,
  embedded = false,
}: {
  entity?: SceneEntity;
  hmi: ParsedHmiScene | null;
  devices: Device[];
  embedded?: boolean;
}) {
  const document = useSceneStore((s) => s.document);
  const setDocument = useSceneStore((s) => s.setDocument);
  const refresh = useDeviceStore((s) => s.refresh);
  const kind = getProviderKind();

  const [points, setPoints] = useState<DevicePoint[]>([]);
  const [commands, setCommands] = useState<CommandDef[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [virtualBound, setVirtualBound] = useState(false);

  const bindableDevices = useMemo(() => devices.filter(isRealtimePlatformDevice), [devices]);

  const triedRefresh = useRef(false);
  useEffect(() => {
    if (devices.length === 0 && !triedRefresh.current) {
      triedRefresh.current = true;
      void refresh();
    }
  }, [devices.length, refresh]);

  const binding = useMemo(() => {
    if (!document || !entity) return undefined;
    return document.bindings.find((b) => b.sceneEntityId === entity.id || b.sceneEntityId === entity.nodeName);
  }, [document, entity]);

  const boundRealtime = bindableDevices.find((item) => item.id === binding?.deviceId);

  useEffect(() => {
    const deviceId = binding?.deviceId;
    if (!deviceId) {
      setPoints([]);
      setCommands([]);
      setVirtualBound(false);
      return;
    }
    if (boundRealtime) {
      setVirtualBound(false);
      let cancelled = false;
      setLoadingMaps(true);
      Promise.all([getDataProvider().listTelemetryKeys(deviceId), getCommandProvider().listCommands(deviceId)])
        .then(([nextPoints, nextCommands]) => {
          if (cancelled) return;
          setPoints(nextPoints);
          setCommands(nextCommands);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            const text = describeCommandError(error).message;
            message.warning("命令或测点列表暂时读不到，已保留上次选项。" + text);
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingMaps(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (kind !== "guard") {
      setVirtualBound(false);
      return;
    }
    let cancelled = false;
    setLoadingMaps(true);
    getDataProvider()
      .getDevice(deviceId)
      .then((device) => {
        if (cancelled) return;
        if (device && isVirtualPlatformDevice(device)) {
          setVirtualBound(true);
          setPoints([]);
          setCommands([]);
          return;
        }
        setVirtualBound(false);
      })
      .catch(() => {
        if (!cancelled) setVirtualBound(false);
      })
      .finally(() => {
        if (!cancelled) setLoadingMaps(false);
      });
    return () => {
      cancelled = true;
    };
  }, [binding?.deviceId, boundRealtime, kind]);

  if (!document) return null;

  if (!entity) return null;

  const signals = signalsForEntity(hmi?.bindables ?? [], entity);
  const actionSignals = signals.filter((s) => s.kind === "action");
  const dataSignals = signals.filter((s) => s.kind === "telemetry");
  const hmiDevice = hmi?.devices.find((item) => item.node === entity.nodeName || item.node === entity.id);
  const selectable = hmi ? uniqueEntitiesFromParsed(hmi).find((item) => item.node === entity.nodeName || item.node === entity.id) : undefined;
  const displayName = selectable?.name ?? entity.name;
  const emptyModel = actionSignals.length === 0 && (hmiDevice ? hmiDevice.data.length === 0 : dataSignals.length === 0);
  const showBoard = (hmiDevice ? hmiDevice.data.length > 0 : dataSignals.length > 0);
  const showStartStop = Boolean(hmiDevice?.hasNameplateControls);
  const isPipeOrInstrument = actionSignals.some((s) => s.entityKind === "pipe" || s.entityKind === "instrument");

  const patchBindings = (next: DeviceBinding[]) => {
    const entities = document.entities.map((e) => {
      if (e.id !== entity.id) return e;
      const found = next.find((b) => b.sceneEntityId === e.id || b.sceneEntityId === e.nodeName);
      /*
       * SceneEntity.binding 只表达「这个实体挂在哪台设备上」，所以必须要有 deviceId。
       * v2 的资产绑定条目没有 deviceId —— 它绑的是资产属性，不是设备实体，
       * 在这里留 undefined，不要拿资产的 id 冒充 deviceId。
       */
      return found?.deviceId
        ? { ...e, binding: { deviceId: found.deviceId } }
        : { ...e, binding: undefined };
    });
    setDocument({ ...document, bindings: next, entities }, "更新设备绑定");
  };

  const replaceBinding = (next: DeviceBinding | null) => {
    const rest = document.bindings.filter((b) => b.sceneEntityId !== entity.id && b.sceneEntityId !== entity.nodeName);
    patchBindings(next ? [...rest, next] : rest);
  };

  const bindDevice = async (deviceId: string | undefined) => {
    if (!deviceId) {
      replaceBinding(null);
      return;
    }
    const device = bindableDevices.find((d) => d.id === deviceId);
    if (!device || isVirtualPlatformDevice(device)) {
      message.warning("只能绑定平台实时设备");
      return;
    }
    setLoadingMaps(true);
    try {
      const nextPoints = await getDataProvider().listTelemetryKeys(deviceId);
      const nextCommands = await getCommandProvider().listCommands(deviceId);
      setPoints(nextPoints);
      setCommands(nextCommands);
      replaceBinding(
        buildDeviceBinding({
          existingId: binding?.id,
          createId: () => createId("bind"),
          entity,
          device,
          signals,
          points: nextPoints,
          commands: nextCommands,
          devices: bindableDevices,
        }),
      );
    } catch (error) {
      message.error(describeCommandError(error).message);
    } finally {
      setLoadingMaps(false);
    }
  };

  const ensureBinding = (): DeviceBinding | undefined => binding;

  const pointOptions = points.map((p) => ({ value: p.key, label: p.unit ? `${p.key}（${p.unit}）` : p.key }));

  return (
    <div
      className={styles.panel}
      data-device-count={devices.length}
      data-provider-kind={kind}
      data-bound-device-id={binding?.deviceId ?? ""}
      data-bound-device-name={formatPlatformDeviceName({ ...boundRealtime, deviceName: binding?.deviceName }) ?? ""}
    >
      {embedded ? null : <div className={styles.title}>{displayName}</div>}

      <div className={styles.section}>
        <div className={styles.sectionLabel}>目标设备</div>
        <Select
          showSearch
          allowClear
          loading={loadingMaps}
          placeholder="选择实时设备"
          style={{ width: "100%" }}
          value={boundRealtime?.id}
          optionFilterProp="label"
          options={bindableDevices.map((item) => ({ value: item.id, label: formatPlatformDeviceName(item) }))}
          onChange={(value) => void bindDevice(value)}
        />
        {boundRealtime ? (
          <div className={styles.muted}>
            {formatPlatformDeviceName(boundRealtime)}
            <span className={styles.realtime}>实时</span>
          </div>
        ) : null}
        {virtualBound ? <Alert type="warning" showIcon message="绑定已失效（虚拟设备），请解绑后重选实时设备" /> : null}
        <div className={styles.muted} data-testid="model-binding-hint">{WIDGET_MODEL_BINDING_HINT}</div>
      </div>

      {emptyModel ? (
        <div className={styles.muted}>这个对象在模型里没有可绑定的行为或看板数据，但仍可选择目标设备。</div>
      ) : null}

      {actionSignals.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>行为</div>
          {actionSignals.map((signal) => {
            const current = mappingForAction(binding, signal.name);
            const summary = actionSummary(current, commands);
            return (
              <div className={styles.row} key={signal.id}>
                <div className={styles.rowName}>{signal.label}</div>
                <div className={styles.rowSummary}>
                  {summary.text}
                  {current?.commandId && !commands.some((item) => item.id === current.commandId) && commands.length > 0 ? (
                    <span className={styles.auto}>失效</span>
                  ) : null}
                </div>
                <ActionEditor
                  signal={signal}
                  mapping={current}
                  disabled={!boundRealtime || virtualBound}
                  commands={commands}
                  pointOptions={pointOptions}
                  onApply={(next) => {
                    const base = ensureBinding();
                    if (!base) return;
                    const rest = base.actionMappings.filter((item) => item.actionId !== signal.name);
                    replaceBinding({ ...base, actionMappings: next ? [...rest, next] : rest });
                  }}
                />
              </div>
            );
          })}
          {isPipeOrInstrument ? (
            <div className={styles.muted}>未单独绑定时，按画面规则随阀门开闭联动；单独绑定后以这里为准。</div>
          ) : null}
        </div>
      ) : null}

      {showBoard ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>看板数据</div>
          {(hmiDevice?.data ?? dataSignals.map((s) => ({ name: s.name, unit: s.unit }))).map((item) => {
            const signal = dataSignals.find((s) => s.name === item.name) ?? {
              id: item.name,
              name: item.name,
              label: item.unit ? `${item.name} ${item.unit}` : item.name,
              unit: item.unit,
            };
            const current = mappingForField(binding, item.name);
            const suggested = boundRealtime ? suggestPoint(item.name, points)?.key : undefined;
            const summary = dataSummary(current, suggested);
            return (
              <div className={styles.row} key={item.name}>
                <div className={styles.rowName}>{signal.label}</div>
                <div className={styles.rowSummary}>
                  {summary.text}
                  {summary.auto ? <span className={styles.auto}>自动</span> : null}
                </div>
                <DataEditor
                  title={item.unit ? `${item.name} ${item.unit}` : item.name}
                  field={item.name}
                  mapping={current}
                  disabled={!boundRealtime || virtualBound}
                  pointOptions={pointOptions}
                  onApply={(next) => {
                    const base = ensureBinding();
                    if (!base) return;
                    const rest = base.telemetryMappings.filter((row) => row.field !== item.name);
                    replaceBinding({ ...base, telemetryMappings: next ? [...rest, next] : rest });
                  }}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {/*
       * 运行状态判据（2026-11-23 新增）。
       *
       * <p>客户原话：「启停按钮下面运行状态就是属于那个状态那个亮就行了，
       * 但是我在平台端设备运维-实时监测中不知道哪个遥测跟这个运行状态绑定」。
       *
       * <p>这句话点出的缺口是真实的：实时监测页只列「设备上报了哪些遥测」，
       * 不告诉你**哪一列被拿来判断运行状态**。而判据分散在
       * `statusMapping.telemetryKey` / `telemetryMappings` 的 label 匹配 /
       * 代码里的 `sys_run_state` 约定三处 —— 现场从遥测清单里推不出来。
       *
       * <p>所以在这里直接写出「实际读哪个键、什么语义、会不会回退」。
       * 只读，不提供编辑：改它要走上面的「看板数据」或场景设置，
       * 多一个入口只会让配置漂移。
       */}
      {boundRealtime && !virtualBound ? (() => {
        const explain = explainRunningState(binding);
        return (
          <div className={styles.section} data-testid="running-state-explain">
            <div className={styles.sectionLabel}>运行状态判据</div>
            <div className={styles.row}>
              <div className={styles.rowName}>判定依据</div>
              <div className={styles.rowSummary}>{explain.text}</div>
            </div>
            {explain.fallsBack ? (
              <div className={styles.muted}>
                该键没有数据时会自动退回「运行」布尔遥测 —— 部分网关只上报布尔值，
                这不是配置错误。3D 染色、状态格、机组状态列表三处用的是同一份判据。
              </div>
            ) : null}
            {explain.source === "none" ? (
              <div className={styles.muted}>
                在「看板数据」里为「运行状态」选择时间序列键后，状态格才会有「运行 / 停机」；
                在此之前显示「未知」，不会猜成运行。
              </div>
            ) : null}
          </div>
        );
      })() : null}

      {showStartStop ? (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>底部控制面板</div>
          <div className={styles.muted}>该对象的底部控制面板提供启动 / 停止，不按远程方法列表生成，也不写入上方行为表。</div>
        </div>
      ) : null}

      {entity ? (
        <SceneJumpSection objectId={entity.nodeName || entity.id} objectLabel={entity.name} />
      ) : null}

      {binding ? (
        <Button size="small" danger onClick={() => replaceBinding(null)}>
          解绑
        </Button>
      ) : null}
    </div>
  );
}

function ActionEditor({
  signal,
  mapping,
  disabled,
  commands,
  pointOptions,
  onApply,
}: {
  signal: { name: string; label: string; clip?: string; entityKind: string };
  mapping?: ActionMapping;
  disabled: boolean;
  commands: CommandDef[];
  pointOptions: Array<{ value: string; label: string }>;
  onApply: (next: ActionMapping | null) => void;
}) {
  const valve = isValveAction(signal.entityKind, signal.name);
  const [open, setOpen] = useState(false);
  const [telemetryOn, setTelemetryOn] = useState(true);
  const [commandOn, setCommandOn] = useState(false);
  const [op, setOp] = useState<SourceOp>("timeseries");
  const [telemetryKey, setTelemetryKey] = useState("");
  const [whenValue, setWhenValue] = useState<string>("true");
  const [converter, setConverter] = useState<"none" | "function">("none");
  const [commandId, setCommandId] = useState<string | undefined>();

  const reset = () => {
    const hasCommand = Boolean(mapping?.commandId);
    const hasTelemetry = Boolean(mapping?.telemetryKey) || mapping?.whenValue !== undefined;
    setTelemetryOn(valve ? hasTelemetry || !hasCommand : true);
    setCommandOn(valve ? hasCommand : false);
    setOp(mapping?.telemetryKey ? "timeseries" : mapping?.whenValue !== undefined ? "none" : "timeseries");
    setTelemetryKey(mapping?.telemetryKey ?? "");
    setWhenValue(mapping?.whenValue === undefined || mapping?.whenValue === null ? "true" : String(mapping.whenValue));
    setConverter("none");
    setCommandId(mapping?.commandId);
  };

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) reset();
      }}
      placement="leftTop"
      title={signal.label}
      content={
        <div className={styles.form}>
          {valve ? (
            <div className={styles.formRow}>
              <span className={styles.formLabel}>绑定方式</span>
              <div className={styles.modes}>
                <Checkbox checked={telemetryOn} onChange={(e) => setTelemetryOn(e.target.checked)}>
                  遥测驱动动画
                </Checkbox>
                <Checkbox checked={commandOn} onChange={(e) => setCommandOn(e.target.checked)}>
                  下发命令
                </Checkbox>
              </div>
            </div>
          ) : null}
          {(!valve || telemetryOn) ? (
            <>
              <div className={styles.formRow}>
                <span className={styles.formLabel}>操作</span>
                <Select
                  value={op}
                  options={[
                    { value: "none", label: "不执行操作" },
                    { value: "timeseries", label: "获取时间序列" },
                    { value: "attribute", label: "获取属性" },
                    { value: "alarm", label: "获取告警状态" },
                  ]}
                  onChange={(value) => setOp(value)}
                />
              </div>
              {op === "timeseries" ? (
                <div className={styles.formRow}>
                  <span className={styles.formLabel}>时间序列键</span>
                  <Select
                    showSearch
                    allowClear
                    value={telemetryKey || undefined}
                    options={pointOptions}
                    onChange={(value) => setTelemetryKey(value ?? "")}
                  />
                </div>
              ) : null}
              {op === "attribute" || op === "alarm" ? (
                <div className={styles.muted}>暂未支持</div>
              ) : null}
              {op === "timeseries" || op === "none" ? (
                <div className={styles.formRow}>
                  <span className={styles.formLabel}>操作结果转换器</span>
                  <Select
                    value={converter}
                    options={[
                      { value: "none", label: "无" },
                      { value: "function", label: "函数" },
                    ]}
                    onChange={(value) => setConverter(value)}
                  />
                </div>
              ) : null}
              {converter === "function" ? <div className={styles.muted}>暂未支持</div> : null}
              {op === "none" ? (
                <div className={styles.formRow}>
                  <span className={styles.formLabel}>当结果为「{signal.label}」时</span>
                  <Select
                    value={whenValue}
                    options={[
                      { value: "true", label: "True" },
                      { value: "false", label: "False" },
                    ]}
                    onChange={setWhenValue}
                  />
                </div>
              ) : (
                <div className={styles.formRow}>
                  <span className={styles.formLabel}>当结果为「{signal.label}」时</span>
                  <Input value={whenValue} onChange={(e) => setWhenValue(e.target.value)} placeholder="True / False 或测点值" />
                </div>
              )}
            </>
          ) : null}
          {(valve ? commandOn : false) ? (
            <div className={styles.formRow}>
              <span className={styles.formLabel}>下发命令</span>
              <Select
                showSearch
                allowClear
                disabled={commands.length === 0}
                placeholder={commands.length === 0 ? "当前设备没有可下发命令" : "选择命令"}
                value={commandId}
                options={commands.map((item) => ({ value: item.id, label: item.label || item.id }))}
                onChange={(value) => setCommandId(value)}
              />
            </div>
          ) : null}
          {valve && commandOn && commandId && commands.length > 0 && !commands.some((item) => item.id === commandId) ? (
            <div className={styles.muted}>已选命令已失效，请重新选择</div>
          ) : null}
          <div className={styles.actions}>
            <Button size="small" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                if (converter === "function" || op === "attribute" || op === "alarm") {
                  message.info("该项暂未支持，未写入");
                }
                const useTelemetry = !valve || telemetryOn;
                const useCommand = valve && commandOn;
                if (!useTelemetry && !useCommand) {
                  onApply(null);
                  setOpen(false);
                  return;
                }
                const parsedWhen = whenValue === "true" ? true : whenValue === "false" ? false : whenValue;
                const selected = commands.find((item) => item.id === commandId);
                onApply({
                  actionId: signal.name,
                  label: signal.label,
                  clip: signal.clip,
                  telemetryKey: useTelemetry && op === "timeseries" ? telemetryKey || undefined : undefined,
                  whenValue: useTelemetry ? parsedWhen : undefined,
                  commandId: useCommand ? commandId : undefined,
                  commandParams: useCommand && selected && (selected.params?.length ?? 0) === 0 ? {} : undefined,
                });
                setOpen(false);
              }}
            >
              应用
            </Button>
          </div>
        </div>
      }
    >
      <Button type="link" size="small" disabled={disabled}>
        编辑
      </Button>
    </Popover>
  );
}

function DataEditor({
  title,
  field,
  mapping,
  disabled,
  pointOptions,
  onApply,
}: {
  title: string;
  field: string;
  mapping?: TelemetryMapping;
  disabled: boolean;
  pointOptions: Array<{ value: string; label: string }>;
  onApply: (next: TelemetryMapping | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<SourceOp>("timeseries");
  const [telemetryKey, setTelemetryKey] = useState("");
  const [converter, setConverter] = useState<"none" | "function">("none");

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (next) {
          setOp(mapping?.telemetryKey ? "timeseries" : "none");
          setTelemetryKey(mapping?.telemetryKey ?? "");
          setConverter("none");
        }
      }}
      placement="leftTop"
      title={title}
      content={
        <div className={styles.form}>
          <div className={styles.formRow}>
            <span className={styles.formLabel}>操作</span>
            <Select
              value={op}
              options={[
                { value: "none", label: "不执行操作" },
                { value: "timeseries", label: "获取时间序列" },
                { value: "attribute", label: "获取属性" },
              ]}
              onChange={(value) => setOp(value)}
            />
          </div>
          {op === "timeseries" ? (
            <div className={styles.formRow}>
              <span className={styles.formLabel}>时间序列键</span>
              <Select showSearch allowClear value={telemetryKey || undefined} options={pointOptions} onChange={(value) => setTelemetryKey(value ?? "")} />
            </div>
          ) : null}
          {op === "attribute" ? <div className={styles.muted}>暂未支持</div> : null}
          {op === "timeseries" ? (
            <div className={styles.formRow}>
              <span className={styles.formLabel}>操作结果转换器</span>
              <Select
                value={converter}
                options={[
                  { value: "none", label: "无" },
                  { value: "function", label: "函数" },
                ]}
                onChange={(value) => setConverter(value)}
              />
            </div>
          ) : null}
          {converter === "function" ? <div className={styles.muted}>暂未支持</div> : null}
          <div className={styles.actions}>
            <Button size="small" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                if (op !== "timeseries" || !telemetryKey) {
                  onApply(null);
                  setOpen(false);
                  return;
                }
                if (converter === "function") message.info("函数转换暂未支持，已按无转换保存");
                onApply({
                  field,
                  telemetryKey,
                  label: title,
                  displayType: "text",
                });
                setOpen(false);
              }}
            >
              应用
            </Button>
          </div>
        </div>
      }
    >
      <Button type="link" size="small" disabled={disabled}>
        编辑
      </Button>
    </Popover>
  );
}

