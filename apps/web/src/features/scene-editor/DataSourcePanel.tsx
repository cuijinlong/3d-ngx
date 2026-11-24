import { Button, Empty, Input, Select, Tag, message } from "antd";
import { useMemo, useState } from "react";
import { resolveSceneDataSources, validateSceneDataSources, widgetScopeKey } from "@idt/data-adapter";
import type { SceneDataSource, SceneDocument } from "@idt/shared-types";
import { useSceneDataDictionary } from "../../hooks/useSceneDataDictionary";
import { useSceneDataSourceScopeDevices } from "../../hooks/useSceneDataSourceScopeDevices";
import styles from "./BindingConfigDrawer.module.css";
import { displayNameOf } from "../../utils/display-name";

/**
 * 场景数据源面板（2026-11-23）。
 *
 * <h2>它解决什么</h2>
 *
 * <p>写在线编程时，`bind-telemetry` 要填 `telemetryKey`。那个键在不在？
 * 这台设备有哪些属性？有没有活跃告警？**之前一处都查不到** ——
 * 只能去平台页面翻，或者猜。而猜错的键不报错，卡片只是永远显示「暂无数据」。
 *
 * <p>这个面板把答案摆出来：每个数据源能绑什么，当场可见，还能一键复制到脚本。
 *
 * <h2>两种源，一眼可分</h2>
 *
 * <p><b>隐含源</b>（灰色标记）从 3D 绑定自动推导 —— 零配置就有内容；
 * <b>声明源</b>（蓝色标记）是用户起的名字，用于脚本里 `ctx.src("gw")`。
 * 只做显式的话，实际没人会配，清单永远是空的。
 */

interface DataSourcePanelProps {
  document: SceneDocument | null;
  /** 整体替换 `document.dataSources`。走 setDocument 才能进撤销栈。 */
  onChangeSources?: (sources: SceneDataSource[]) => void;
  devices?: Array<{ id: string; name?: string; label?: string; type?: string }>;
  onClose: () => void;
  /** 「复制到脚本」的回调 —— 由外壳决定粘到哪。 */
  onInsertToScript?: (snippet: string) => void;
}

/** 取一个 scope 源的范围键（与 `WidgetOverlay` 同源，保证能查到）。 */
function widgetScopeKeyOf(source: { scope?: { kind: "site" | "topology"; siteId?: string; topologyId?: string } }): string {
  return widgetScopeKey(source.scope as never) ?? "";
}

export function DataSourcePanel(props: DataSourcePanelProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<"device" | "asset" | "scope">("device");
  const [draftDevice, setDraftDevice] = useState<string | undefined>();
  const [draftAsset, setDraftAsset] = useState("");
  const [draftScope, setDraftScope] = useState<"topology" | "site">("topology");

  const platform = props.document?.platform;

  /*
   * 先解析范围设备，再解析数据源（2026-11-23）。
   *
   * <p>顺序不能反：`resolveSceneDataSources` 要靠 `scopeDeviceIds` 才能把
   * `kind: "scope"` 的源展开成具体设备。不传的话范围源永远是 0 台 ——
   * 面板只能写「在运行态按范围解析」，脚本里 `ctx.keysOf("units")` 也是空。
   *
   * <p>hook 内部用 `widgetScopeKey` 生成键，与 `WidgetOverlay` 同源，
   * 不会出现「键名不一致导致查不到」的静默失败。
   */
  const scopeResolution = useSceneDataSourceScopeDevices(props.document);

  const sources = useMemo(() => {
    if (!props.document) return [];
    return resolveSceneDataSources(props.document, {
      scopeDeviceIds: scopeResolution.scopeDeviceIds,
    });
  }, [props.document, scopeResolution.scopeDeviceIds]);

  const { dictionary, loading } = useSceneDataDictionary(sources);

  const validation = validateSceneDataSources(props.document?.dataSources);

  const addSource = () => {
    if (!props.onChangeSources || !props.document) return;
    const name = draftName.trim();
    if (!name) {
      message.error("先填一个名字");
      return;
    }

    const base: SceneDataSource = {
      id: name.replace(/[^\p{L}\p{N}_-]/gu, "") || `src${Date.now() % 1000}`,
      name,
      kind: draftKind,
    };
    if (draftKind === "device") {
      if (!draftDevice) {
        message.error("选一台设备");
        return;
      }
      base.deviceId = draftDevice;
    }
    if (draftKind === "asset") {
      if (!draftAsset.trim()) {
        message.error("填资产 id");
        return;
      }
      base.assetId = draftAsset.trim();
    }
    if (draftKind === "scope") {
      if (draftScope === "topology" && platform?.topologyId) {
        base.scope = { kind: "topology", topologyId: platform.topologyId, topologyName: platform.topologyName };
      } else if (draftScope === "site" && platform?.siteId) {
        base.scope = { kind: "site", siteId: platform.siteId, siteName: platform.siteName };
      } else {
        message.error(draftScope === "site" ? "当前场景没有场站信息" : "当前场景没有拓扑信息");
        return;
      }
    }

    const next = [...(props.document.dataSources ?? []), base];
    /* 先用校验挡一道：重复短名、缺字段都在这里暴露，不必等运行时。 */
    const problems = validateSceneDataSources(next);
    if (problems.length) {
      message.error(problems[0] as string);
      return;
    }
    props.onChangeSources(next);
    setAdding(false);
    setDraftName("");
    setDraftAsset("");
    setDraftDevice(undefined);
  };

  const removeSource = (id: string) => {
    if (!props.onChangeSources || !props.document) return;
    props.onChangeSources((props.document.dataSources ?? []).filter((item) => item.id !== id));
  };

  if (!props.document) {
    return (
      <aside className={styles.panel} data-testid="datasource-panel">
        <div className={styles.head}>
          <h3>数据源</h3>
          <Button size="small" onClick={props.onClose}>关闭</Button>
        </div>
        <div className={styles.body}>
          <p className={styles.muted}>还没有打开场景。</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.panel} data-testid="datasource-panel">
      <div className={styles.head}>
        <h3>数据源</h3>
        <Button size="small" data-testid="datasource-add" onClick={() => setAdding((open) => !open)}>
          {adding ? "取消" : "新增"}
        </Button>
        <Button size="small" onClick={props.onClose}>关闭</Button>
      </div>
      <div className={styles.body}>
        <p className={styles.note}>
          这些是在线编程能用的东西。脚本里用 <code>ctx.src("短名")</code> 取源、
          <code>ctx.keysOf("短名")</code> 看可用测点。
          灰色是「从 3D 绑定自动推导」，蓝色是你声明的。
        </p>

        {validation.length ? (
          <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12, color: "var(--ngx-color-danger)" }}>
            {validation.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        ) : null}

        {adding ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            <Input
              placeholder="名字，如「网关」"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              data-testid="datasource-name"
            />
            <Select
              value={draftKind}
              onChange={(value) => setDraftKind(value)}
              options={[
                { value: "device", label: "设备" },
                { value: "scope", label: "范围（本场景设备）" },
                { value: "asset", label: "资产（填 id）" },
              ]}
            />
            {draftKind === "device" ? (
              <Select
                showSearch
                placeholder="选择设备"
                value={draftDevice}
                onChange={setDraftDevice}
                optionFilterProp="label"
                options={(props.devices ?? []).map((device) => ({
                  value: device.id,
                  label: displayNameOf(device, device.id.slice(0, 8)),
                }))}
              />
            ) : null}
            {draftKind === "asset" ? (
              <Input
                placeholder="资产 id"
                value={draftAsset}
                onChange={(event) => setDraftAsset(event.target.value)}
              />
            ) : null}
            {draftKind === "scope" ? (
              <Select
                value={draftScope}
                onChange={(value) => setDraftScope(value)}
                options={[
                  { value: "topology", label: `本场景拓扑${platform?.topologyName ? `（${platform.topologyName}）` : ""}` },
                  { value: "site", label: `本场景场站${platform?.siteName ? `（${platform.siteName}）` : ""}` },
                ]}
              />
            ) : null}
            <Button type="primary" size="small" data-testid="datasource-save" onClick={addSource}>
              保存
            </Button>
          </div>
        ) : null}

        {!sources.length ? (
          <Empty description="还没有数据源。给三维对象绑设备后会自动出现，也可以手动新增。" />
        ) : null}

        {loading ? <p className={styles.muted}>正在勘察可用测点…</p> : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sources.map((source) => {
            const caps = dictionary[source.id];
            const isImplicit = source.origin === "implicit";
            return (
              <div
                key={source.id}
                data-testid={`datasource-${source.id}`}
                style={{
                  border: "1px solid var(--ngx-color-border)",
                  borderRadius: 6,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>{source.name}</b>
                  <Tag color={isImplicit ? "default" : "blue"}>
                    {isImplicit ? "自动" : "声明"}
                  </Tag>
                  <code style={{ fontSize: 11, color: "var(--ngx-color-muted)" }}>
                    ctx.src("{source.id}")
                  </code>
                  <span style={{ flex: 1 }} />
                  {!isImplicit ? (
                    <Button size="small" type="link" onClick={() => removeSource(source.id)}>
                      删除
                    </Button>
                  ) : null}
                </div>

                {source.note ? (
                  <div style={{ fontSize: 11, color: "var(--ngx-color-muted)" }}>{source.note}</div>
                ) : null}

                {source.kind === "scope" ? (
                  <div style={{ fontSize: 11, color: "var(--ngx-color-muted)" }}>
                    {source.entityIds.length ? (
                      <>
                        范围设备 {source.entityIds.length} 台：
                        {scopeResolution.names[widgetScopeKeyOf(source)]?.slice(0, 6).join("、") ?? ""}
                        {source.entityIds.length > 6 ? " …" : ""}
                      </>
                    ) : scopeResolution.loading ? (
                      "正在解析范围内的设备…"
                    ) : (
                      "范围内暂无设备（或范围未选全）"
                    )}
                  </div>
                ) : null}

                {source.problems.length ? (
                  <div style={{ fontSize: 11, color: "var(--ngx-color-danger)" }}>
                    {source.problems.join("；")}
                  </div>
                ) : null}

                {caps?.error ? (
                  <div style={{ fontSize: 11, color: "var(--ngx-color-danger)" }}>{caps.error}</div>
                ) : null}

                {caps && caps.telemetry.length ? (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ngx-color-muted)", marginBottom: 3 }}>
                      遥测（{caps.checked}/{caps.total} 台已勘察）
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {caps.telemetry.map((key) => (
                        <Tag
                          key={key.key}
                          title={`${key.onEntities}/${caps.checked} 台有此键${key.unit ? ` · ${key.unit}` : ""}`}
                          style={{ fontSize: 11, margin: 0 }}
                        >
                          {key.key}
                        </Tag>
                      ))}
                    </div>
                  </div>
                ) : null}

                {caps && caps.attributes.length ? (
                  <div>
                    <div style={{ fontSize: 11, color: "var(--ngx-color-muted)", marginBottom: 3 }}>
                      属性
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {caps.attributes.slice(0, 24).map((key) => (
                        <Tag key={key} style={{ fontSize: 11, margin: 0, opacity: 0.8 }}>{key}</Tag>
                      ))}
                      {caps.attributes.length > 24 ? (
                        <span style={{ fontSize: 11, color: "var(--ngx-color-muted)" }}>
                          …共 {caps.attributes.length} 个
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {caps && caps.alarms.length ? (
                  <div style={{ fontSize: 11, color: "var(--ngx-color-warning)" }}>
                    活跃告警 {caps.alarms.length} 条：
                    {caps.alarms.slice(0, 3).map((alarm) => alarm.type).join("、")}
                  </div>
                ) : null}

                {props.onInsertToScript ? (
                  <Button
                    size="small"
                    type="link"
                    style={{ alignSelf: "flex-start", padding: 0 }}
                    onClick={() => {
                      const keys = caps?.telemetry.map((key) => key.key) ?? [];
                      /* 生成的片段直接可粘进脚本，省去手抄键名。 */
                      const snippet = keys.length
                        ? `// ${source.name}：可用测点\n// ${keys.join(", ")}\nctx.log("${source.id}", ctx.keysOf("${source.id}").length, "个测点");`
                        : `ctx.log("${source.id} 还没有勘察到测点");`;
                      props.onInsertToScript?.(snippet);
                    }}
                  >
                    复制片段到脚本
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
