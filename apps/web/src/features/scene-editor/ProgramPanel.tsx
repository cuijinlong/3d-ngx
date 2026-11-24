import { Button, Input, Segmented, message } from "antd";
import { useMemo, useRef, useState } from "react";
import {
  DEFAULT_AI_EXTENSION,
  SAMPLE_SCRIPT,
  examineLayoutProposal,
  proposalNeedsReview,
  resolveSceneDataSources,
  resolveScreenTemplate,
  type LayoutOperation,
  type LayoutProposal,
  type SceneWidgetLayout,
} from "@idt/data-adapter";
import type { SceneDocument } from "@idt/shared-types";
import { useSceneDataDictionary } from "../../hooks/useSceneDataDictionary";
import { useSceneDataSourceScopeDevices } from "../../hooks/useSceneDataSourceScopeDevices";
import styles from "./BindingConfigDrawer.module.css";

/**
 * 在线编程面板（2026-11-23）。
 *
 * <h2>两种输入，一条流水线</h2>
 *
 * <p>左边「JSON 提案」适合精确改动两三处；右边「脚本」适合成批处理 ——
 * 「所有进度条的满量程按语义分」「凡是 label 含「之和」的槽补上聚合」
 * 这类用 JSON 要几十条、还要手算，用代码是一行循环。
 *
 * <p><b>但产物是同一种东西</b>：都变成 `LayoutOperation[]`，
 * 都过 `examineLayoutProposal` 的白名单/保护字段校验，
 * 都要「预览差异 → 人工确认 → 应用」。脚本模式不是绕过校验的后门，
 * 只是「用代码写提案」。
 *
 * <h2>为什么是「提案 → 差异 → 确认」而不是「直接改」</h2>
 *
 * <p>大屏配置一旦被脚本或 AI 直接改掉，人就看不出发生了什么：
 * 改对了没人知道该夸哪、改错了没人知道从哪回退。
 * 参考模板的 `aiExtension.requiresDiffReview = true` 说的就是这件事。
 *
 * <h2>为什么应用时必须重新校验</h2>
 *
 * <p>预览到应用之间，布局可能被别处改过（撤销/重做、另一个面板）。
 * 应用时**用当前 layout 重新算一遍**，而不是复用预览结果 ——
 * 否则会把过期的 `next` 写回去，覆盖掉别人的改动。
 */

interface ProgramPanelProps {
  layout: SceneWidgetLayout | null;
  onChangeLayout?: (layout: SceneWidgetLayout) => void;
  onClose: () => void;
  /** 供脚本 `ctx.devices` 读取；用于「按设备名生成绑定」这类脚本。 */
  devices?: Array<{ id: string; name?: string; label?: string; type?: string }>;
  /** 供脚本 `ctx.topologyId` / `ctx.siteId` 填空 scope。 */
  platform?: { topologyId?: string; topologyName?: string; siteId?: string; siteName?: string };
  /**
   * 场景文档（2026-11-23）：脚本从中拿**数据源清单**。
   *
   * <p>没有它，脚本只能靠人肉抄 UUID 和测点键 ——
   * 而写错的键不报错，卡片只是永远「暂无数据」。
   */
  document?: SceneDocument | null;
}

type Mode = "json" | "script";

const SAMPLE_JSON = `[
  { "op": "update-widget", "id": "system-power", "patch": { "title": "系统总功率" } },
  { "op": "bind-telemetry", "id": "system-power", "slotKey": "main", "telemetryKey": "power_total" }
]`;

export function ProgramPanel(props: ProgramPanelProps) {
  const [mode, setMode] = useState<Mode>("json");
  const [jsonText, setJsonText] = useState(SAMPLE_JSON);
  const [scriptText, setScriptText] = useState(SAMPLE_SCRIPT);
  const [preview, setPreview] = useState<LayoutProposal | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [scriptLogs, setScriptLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  /*
   * 脚本产出的操作暂存。
   *
   * <p>为什么不直接塞进 preview：`preview` 是**校验结果**，而这里是**待校验的输入**。
   * 两者混在一起，应用时就分不清「要不要重新跑脚本」。
   */
  const pendingOps = useRef<LayoutOperation[] | null>(null);

  const layout = props.layout;

  /*
   * 数据源清单 + 勘察结果。
   *
   * <p>放在面板内而不是外壳里：勘察会发请求（每源最多 12 台 × 2），
   * 常驻在编辑器上就是持续负载。只有打开在线编程时才需要它。
   */
  /*
   * 范围源要先展开成设备清单，否则脚本里 `ctx.keysOf("units")` 永远是空。
   *
   * <p>顺序不能反：`resolveSceneDataSources` 靠 `scopeDeviceIds`
   * 才能把 `kind: "scope"` 的源变成具体 entityIds。
   */
  const scopeResolution = useSceneDataSourceScopeDevices(props.document);

  const sources = useMemo(
    () =>
      props.document
        ? resolveSceneDataSources(props.document, { scopeDeviceIds: scopeResolution.scopeDeviceIds })
        : [],
    [props.document, scopeResolution.scopeDeviceIds],
  );
  const { dictionary, loading: dictionaryLoading } = useSceneDataDictionary(sources);
  /*
   * 编辑边界优先取**模板里声明的**，没有才用全局默认（2026-11-23）。
   *
   * 为什么不能只用默认：不同模板该允许的改动不同 ——
   * 客户成品大屏可能只许改绑定、不许增删卡片；
   * 空白底稿则允许自由加卡。写死一个默认值就区分不了。
   */
  const extension = useMemo(
    () => resolveScreenTemplate(layout)?.aiExtension ?? DEFAULT_AI_EXTENSION,
    [layout],
  );
  const needsReview = useMemo(() => proposalNeedsReview(extension), [extension]);

  /** 清掉上一轮结果 —— 切换模式/改代码后旧差异就不再代表当前输入。 */
  const resetResult = () => {
    setPreview(null);
    pendingOps.current = null;
    setScriptLogs([]);
  };

  const parseJson = (): LayoutOperation[] | null => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        setParseError("提案必须是一个数组（每条一个操作）。");
        return null;
      }
      setParseError(null);
      return parsed as LayoutOperation[];
    } catch (error) {
      /* 报出解析器的原始信息：说不出哪一行错，用户只能全文重看。 */
      setParseError(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /**
   * 在 Worker 里跑脚本，拿到操作后立刻校验并展示差异。
   *
   * <p>Worker 的引入是必需的：脚本死循环在主线程会冻结整个编辑器，
   * 而此刻布局还没保存。见 `run-layout-script.ts`。
   */
  const runScript = async () => {
    if (!layout) return;
    setRunning(true);
    resetResult();
    try {
      /*
       * 动态 import：Worker 封装只在真正用脚本模式时才加载。
       * 纯 JSON 用户不必为它付首屏成本。
       */
      const { runLayoutScriptInWorker } = await import("./run-layout-script");
      const result = await runLayoutScriptInWorker(layout, scriptText, {
        devices: props.devices ?? [],
        topologyId: props.platform?.topologyId,
        topologyName: props.platform?.topologyName,
        siteId: props.platform?.siteId,
        siteName: props.platform?.siteName,
        /*
         * 按设备 id 的遥测键表。
         *
         * <p>这是 `ctx.telemetryKeys` 的正式来源 —— 之前这个字段声明了却
         * 从来没被填过（脚本拿到的永远是空对象）。现在从勘察结果聚合出来，
         * 按 entityIds 铺平：同一台设备在多个源里出现时取并集。
         */
        telemetryKeys: sources.reduce<Record<string, string[]>>((acc, source) => {
          const keys = dictionary[source.id]?.telemetry.map((item) => item.key) ?? [];
          for (const entityId of source.entityIds) {
            acc[entityId] = [...new Set([...(acc[entityId] ?? []), ...keys])];
          }
          return acc;
        }, {}),
        /* 数据源：脚本用 ctx.src / ctx.keysOf 读，不用抄 UUID 和键名。 */
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          kind: source.kind,
          ...(source.deviceId ? { deviceId: source.deviceId } : {}),
          ...(source.assetId ? { assetId: source.assetId } : {}),
          entityIds: source.entityIds,
          ...(source.note ? { note: source.note } : {}),
        })),
        dictionary,
      });
      setScriptLogs(result.logs);
      if (!result.ok) {
        setParseError(result.error ?? "脚本执行失败");
        return;
      }
      setParseError(null);
      pendingOps.current = result.operations;
      /* 与 JSON 模式共用同一套校验 —— 脚本不走捷径。 */
      setPreview(examineLayoutProposal(layout, result.operations, extension));
    } finally {
      setRunning(false);
    }
  };

  const doPreview = () => {
    if (!layout) return;
    const operations = parseJson();
    if (!operations) {
      resetResult();
      return;
    }
    pendingOps.current = operations;
    setPreview(examineLayoutProposal(layout, operations, extension));
  };

  const doApply = () => {
    if (!layout || !props.onChangeLayout) return;
    const operations = pendingOps.current;
    if (!operations?.length) {
      message.error("还没有可应用的改动，先预览一次。");
      return;
    }
    /*
     * 用**当前** layout 重新校验，不复用 preview.next ——
     * 预览之后布局可能已经变了，写回过期的结果会覆盖别人的改动。
     */
    const fresh = examineLayoutProposal(layout, operations, extension);
    if (!fresh.ok || !fresh.next) {
      setPreview(fresh);
      message.error("提案被拒绝，未应用任何改动。");
      return;
    }
    props.onChangeLayout(fresh.next);
    pendingOps.current = null;
    setPreview(null);
    message.success(`已应用 ${operations.length} 条改动`);
  };

  if (!layout) {
    return (
      <aside className={styles.panel} data-testid="program-panel">
        <div className={styles.head}>
          <h3>在线编程</h3>
          <Button size="small" onClick={props.onClose}>关闭</Button>
        </div>
        <div className={styles.body}>
          <p className={styles.muted}>还没有布局，先导入模型或选择画面模板。</p>
        </div>
      </aside>
    );
  }

  const monospace = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
  } as const;

  return (
    <aside className={styles.panel} data-testid="program-panel">
      <div className={styles.head}>
        <h3>在线编程</h3>
        <Segmented
          size="small"
          value={mode}
          data-testid="program-mode"
          onChange={(value) => {
            setMode(value as Mode);
            resetResult();
            setParseError(null);
          }}
          options={[
            { label: "JSON 提案", value: "json" },
            { label: "脚本", value: "script" },
          ]}
        />
        <Button size="small" onClick={props.onClose}>关闭</Button>
      </div>
      <div className={styles.body}>
        <p className={styles.note}>
          允许的操作：<code>{extension.operations.join(" / ")}</code>
          。不可改 <code>id</code> / <code>type</code> / <code>templateId</code>。
        </p>

        {mode === "json" ? (
          <>
            <Input.TextArea
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                resetResult();
              }}
              rows={10}
              data-testid="program-input"
              placeholder="提交编辑提案（JSON 数组）"
              style={monospace}
            />
            <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
              <Button data-testid="program-preview" onClick={doPreview}>预览差异</Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.note}>
              用 JS 写改动。可用：
              <code>ctx.layout</code>（只读快照）、<code>ctx.widgets</code>、
              <code>ctx.find(id)</code>、<code>ctx.ofType(type)</code>、
              <code>ctx.slotsOf(w)</code>、<code>ctx.devices</code>、
              <code>ctx.src(id)</code> / <code>ctx.keysOf(id)</code>（数据源与可用测点）、
              <code>ctx.log(...)</code>，
              提交用 <code>ctx.ops.update / bind / add / remove</code>。
              脚本在沙盒里跑，超过 3 秒会被强制中止。
            </p>
            <Input.TextArea
              value={scriptText}
              onChange={(event) => {
                setScriptText(event.target.value);
                resetResult();
                setParseError(null);
              }}
              rows={16}
              data-testid="program-script"
              spellCheck={false}
              style={monospace}
            />
            <div style={{ display: "flex", gap: 8, margin: "10px 0", alignItems: "center" }}>
              <Button
                data-testid="program-run"
                loading={running}
                /*
                 * 勘察没完成时禁用运行。
                 *
                 * <p>否则会跑出一个「键全是空」的结果 —— 脚本本身没错，
                 * 但 `ctx.keysOf()` 返回 []，用户会以为数据源没配好，
                 * 而实际只是面板还在拉键（实测踩过）。
                 */
                disabled={dictionaryLoading || scopeResolution.loading}
                onClick={() => void runScript()}
              >
                {dictionaryLoading || scopeResolution.loading ? "正在勘察数据源…" : "运行并预览差异"}
              </Button>
              {dictionaryLoading ? (
                <span style={{ fontSize: 11, color: "var(--ngx-color-muted)" }}>
                  勘察完成后才能运行（脚本要读可用测点）
                </span>
              ) : null}
            </div>
            {scriptLogs.length ? (
              <pre
                data-testid="program-logs"
                style={{
                  ...monospace,
                  margin: 0,
                  padding: 8,
                  maxHeight: 120,
                  overflow: "auto",
                  borderRadius: 6,
                  background: "var(--ngx-color-surface-sunken, rgba(0,0,0,.04))",
                }}
              >
                {scriptLogs.join("\n")}
              </pre>
            ) : null}
          </>
        )}

        {parseError ? (
          <p className={styles.muted} data-testid="program-parse-error" style={{ color: "var(--ngx-color-danger)" }}>
            {parseError}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
          <Button
            type="primary"
            data-testid="program-apply"
            disabled={!preview?.ok || (needsReview && !preview)}
            onClick={doApply}
          >
            应用
          </Button>
        </div>

        {preview ? <ProposalView proposal={preview} /> : null}
      </div>
    </aside>
  );
}

function ProposalView({ proposal }: { proposal: LayoutProposal }) {
  return (
    <div data-testid="program-diff">
      {proposal.issues.length ? (
        <div style={{ marginBottom: 8 }}>
          <p className={styles.note} style={{ color: "var(--ngx-color-danger)" }}>
            提案被拒绝（未做任何改动）：
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {proposal.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className={styles.note} style={{ color: "var(--ngx-color-success)" }}>
          校验通过，共 {proposal.diff.length} 行变化：
        </p>
      )}

      <pre
        style={{
          margin: 0,
          padding: 10,
          maxHeight: 260,
          overflow: "auto",
          fontSize: 12,
          lineHeight: 1.6,
          borderRadius: 6,
          background: "var(--ngx-color-surface-sunken, rgba(0,0,0,.04))",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {proposal.diff.map((line, index) => (
          <div
            key={index}
            style={{
              color: line.startsWith("+")
                ? "var(--ngx-color-success)"
                : line.startsWith("-")
                  ? "var(--ngx-color-danger)"
                  : line.startsWith("~")
                    ? "var(--ngx-color-primary)"
                    : undefined,
            }}
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}
