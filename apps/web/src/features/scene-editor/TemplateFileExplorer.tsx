import { Button, Empty, Input, Modal, Tag, Tooltip, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSceneTemplateApi,
  type SceneTemplateCard,
  type SceneTemplateFile,
  type SceneTemplateFileContent,
} from "@idt/data-adapter";
import styles from "./TemplateFileExplorer.module.css";

/**
 * 模板文件资源管理器（2026-11-24）。
 *
 * <h2>它解决什么</h2>
 *
 * <p>客户要求：「把模版库里面加一个文件资源管理器功能，可以在线编辑模板的内容，
 * 除非不支持编辑那就算了」。
 *
 * <p>模板的资源（模型 + 风格套装文件）放在对象存储里，之前只能整体上传/下载，
 * 想改一个 css 里的小数值也得本地改完再传一遍。现在可以直接在界面上改。
 *
 * <h2>★ 能编辑什么、不能编辑什么</h2>
 *
 * <p>判据是服务端的**扩展名白名单**（`EDITABLE_EXT`），不是前端猜的：
 * css / js / mjs / json / md / txt / html / svg / csv / map。
 *
 * <p>glb 与 zip 一律只读。不是「懒得做」，是**做了会毁文件**：
 * 二进制按 UTF-8 读出来是一串替换字符，存回去原文件就废了，
 * 而界面上完全看不出发生了什么。
 *
 * <h2>★ 覆盖不可撤销</h2>
 *
 * <p>对象存储没有版本。保存即覆盖，旧内容就没了。所以：
 * <ol>
 *   <li>保存前弹确认，写清「覆盖后无法撤销」；</li>
 *   <li>有未保存改动时切换文件 / 关弹框都要拦一次；</li>
 *   <li>不自动保存、不做定时保存 —— 每一次落盘都要用户明确点一次。</li>
 * </ol>
 *
 * <h2>为什么不用 Monaco</h2>
 *
 * <p>项目没有引入 Monaco / CodeMirror（`ProgramPanel` 也是用 antd TextArea）。
 * 为一个模板资源编辑器引 3MB 的编辑器不值得。这里用 TextArea + 独立行号列，
 * 行号列与文本框同步滚动 —— 足够看清「第几行」，也不会有编辑器组件的
 * JIT / 样式兼容问题（本项目在 TB 部件里有过 A2d 那类教训）。
 */
/**
 * 危险操作确认（异步版）。
 *
 * <h3>为什么不用 window.confirm</h3>
 *
 * <p>第一版用的是 `window.confirm`，理由是「阻断式、任何弹框之上都能弹」。
 * 实测两个问题：
 * <ol>
 *   <li><b>它同步阻塞 JS 主线程</b>。确认框开着时，页面里任何 pending 的
 *       状态更新、任何 await 后续都不会执行 —— 看着像卡死。</li>
 *   <li>在已有的 antd Modal 之上再弹一个原生框，两套观感叠在一起，
 *       用户分不清哪个是哪个。</li>
 * </ol>
 *
 * <p>`Modal.confirm` 是异步的（返回 Promise 化的结果），不阻塞主线程，
 * 也和其他弹框同一套视觉。代价是代码要多一个 await —— 值。
 *
 * <p>`okButtonProps: { danger: true }`：这是**不可撤销**的覆盖操作，
 * 按钮外形要和「确定」区分开，否则会被下意识点掉。
 */
function confirmDanger(options: { title: string; content: string; okText: string }): Promise<boolean> {
  return new Promise((resolve) => {
    Modal.confirm({
      title: options.title,
      content: options.content,
      okText: options.okText,
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

export interface TemplateFileExplorerProps {
  open: boolean;
  template: SceneTemplateCard | null;
  onClose: () => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; files: SceneTemplateFile[] }
  | { kind: "error"; message: string };

export function TemplateFileExplorer({ open, template, onClose }: TemplateFileExplorerProps) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [activeName, setActiveName] = useState<string | null>(null);
  const [file, setFile] = useState<SceneTemplateFileContent | null>(null);
  const [draft, setDraft] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  /*
   * 新建文件（2026-11-24）。
   *
   * <p>为什么必须能新建：实测模板里常常只有一个只读的 `model.glb`
   * （`styleFiles` 为空），文件管理器打开后**一个可编辑项都没有** ——
   * 客户「编辑这个模版」的诉求无从落地。
   */
  /*
   * ★ 「对话框是否打开」与「请求是否在进行」必须是**两个** state（2026-11-24 实测）。
   *
   * <p>第一版用同一个 `creating` 兼作两者，于是点「创建并编辑」时
   * `createFile()` 第一行 `if (... || creating) return` 立刻命中 ——
   * 对话框开着就意味着 creating 为 true，函数直接返回，
   * **请求一个都没发出**。
   *
   * <p>表现为「点按钮完全没反应」：没有 loading、没有 toast、没有网络请求。
   * 这种「什么都不发生」最难查，因为它不产生任何错误信号。
   */
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("main.css");

  const gutterRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const dirty = file != null && draft !== file.content;

  const loadFiles = useCallback(async () => {
    if (!template) return;
    setState({ kind: "loading" });
    try {
      const files = await getSceneTemplateApi().listFiles(template.id);
      setState({ kind: "ready", files });
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : "读取文件清单失败" });
    }
  }, [template]);

  /* 打开时重置并加载 —— 不复用上一次的模板数据 */
  useEffect(() => {
    if (!open) return;
    setActiveName(null);
    setFile(null);
    setDraft("");
    setFileError(null);
    void loadFiles();
  }, [open, loadFiles]);

  const openFile = useCallback(
    async (target: SceneTemplateFile) => {
      if (!template) return;
      if (!target.editable) {
        /* 不可编辑的只解释原因，不做「试着打开看看」—— 那只会得到乱码 */
        message.info(`${target.name} 是二进制或非白名单格式，不支持在线编辑。`);
        return;
      }
      setActiveName(target.name);
      setFileLoading(true);
      setFileError(null);
      setFile(null);
      try {
        const content = await getSceneTemplateApi().readFile(template.id, target.name);
        setFile(content);
        setDraft(content.content);
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "读取文件失败");
      } finally {
        setFileLoading(false);
      }
    },
    [template],
  );

  /**
   * 切文件前的脏检查。
   *
   * <p>脏的时候先问一次，确认才走。不脏直接走 —— 每次都弹确认
   * 会变成肌肉记忆，反而在真的需要拦的时候被点掉。
   */
  const guardDirty = useCallback(
    async (action: () => void | Promise<void>) => {
      if (!dirty) {
        await action();
        return;
      }
      const go = await confirmDanger({
        title: "有未保存的改动",
        content: "切换后这些改动会丢失，且无法恢复。",
        okText: "放弃改动并切换",
      });
      if (go) await action();
    },
    [dirty],
  );

  const save = useCallback(async () => {
    if (!template || !file || saving || !dirty) return;
    /*
     * 覆盖确认。文案必须说「无法撤销」——
     * 「确定保存吗？」会被下意识点掉，而这一步是不可逆的。
     */
    const go = await confirmDanger({
      title: `覆盖保存 ${file.name}？`,
      content:
        "保存会直接覆盖服务器上的文件，没有历史版本，无法撤销。"
        + "已有场景已经拷走自己的副本，不会跟着变；只有之后从该模板新建的场景会用新内容。",
      okText: "覆盖保存",
    });
    if (!go) return;
    setSaving(true);
    try {
      const result = await getSceneTemplateApi().writeFile(template.id, file.name, draft);
      /* 回填 original：保存后 dirty 必须变回 false，否则用户会一直看到「未保存」 */
      setFile({ ...file, content: draft, size: result.size });
      message.success(`已保存 ${file.name}（${(result.size / 1024).toFixed(1)} KB）`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [template, file, draft, saving, dirty]);

  /**
   * 新建并立即打开一个文本文件。
   *
   * <p>默认填 `main.css`：模板最常见的可编辑文件就是样式。
   * 允许改扩展名（白名单由后端校验），但**不在前端再维护一份白名单** ——
   * 两份白名单迟早会分叉，然后出现「前端放行、后端 400」。
   */
  const createFile = useCallback(async () => {
    /* 只防「重复提交」，不能把「对话框打开」也算进来 */
    if (!template || creating) return;
    const name = newName.trim();
    if (!name) {
      message.error("请填写文件名");
      return;
    }
    /* 带空白/换行的文件名在列表里会撑破行高，也容易和别的文件混淆 */
    if (/\s/.test(name)) {
      message.error("文件名不能包含空白字符");
      return;
    }
    setCreating(true);
    try {
      await getSceneTemplateApi().createFile(template.id, name, "");
      await loadFiles();
      /*
       * 建完直接进编辑器。重新走 `openFile` 要多一次网络往返读空文件，
       * 而内容此刻确定是空串 —— 直接置位即可。
       */
      setActiveName(name);
      setFile({ name, ext: extensionOfName(name), size: 0, content: "" });
      setDraft("");
      setFileError(null);
      setNewDialogOpen(false);
      message.success(`已新建 ${name}`);
    } catch (error) {
      /* 失败时不关对话框 —— 用户改个名字就能重试，不用重新打开 */
      const text = error instanceof Error ? error.message : "新建文件失败";
      /*
       * 405 / 404 说人话（2026-11-24 实测）。
       *
       * <p>服务端没更新时这里拿到的是 `Request method 'POST' is not supported`
       * —— 用户看完不知道该怎么办。505/404 在**这个端点**上只有一种解释：
       * 后端还是旧版本，没有「新建模板文件」这个能力。
       */
      message.error(
        /405|404|not supported/i.test(text)
          ? "服务端还不支持新建模板文件（后端需要更新到包含该接口的版本）。"
          : text,
      );
    } finally {
      setCreating(false);
    }
  }, [template, creating, newName, loadFiles]);

  /* Ctrl/Cmd + S 保存 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, save]);

  /* 行号与文本框同步滚动 */
  const onScroll = () => {
    if (gutterRef.current && textRef.current) {
      gutterRef.current.scrollTop = textRef.current.scrollTop;
    }
  };

  const lineCount = useMemo(() => draft.split("\n").length, [draft]);
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1),
    [lineCount],
  );

  const files = state.kind === "ready" ? state.files : [];
  const editableCount = files.filter((f) => f.editable).length;

  const close = () =>
    void guardDirty(() => {
      onClose();
    });

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width={1080}
      centered
      title={null}
      styles={{ body: { padding: 0 } }}
      className={styles.modalShell}
      data-testid="template-file-explorer"
    >
      <div className={styles.shell}>
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.title}>
              模板文件
              <span className={styles.crumb}>{template?.name ?? "—"}</span>
            </h2>
            <p className={styles.lead}>
              资源存放在平台文件服务器。可编辑的只有文本类文件（{editableCount} 个）；
              模型与压缩包只读 —— 二进制按文本保存会损坏文件。
            </p>
          </div>
          <div className={styles.headActions}>
            <Tooltip title="新建一个 css / js / json 等文本文件，创建后可直接编辑">
              <Button
                size="small"
                type="primary"
                disabled={!template}
                onClick={() => setNewDialogOpen(true)}
                data-testid="tpl-file-new"
              >
                新建文件
              </Button>
            </Tooltip>
            <Button size="small" onClick={() => void loadFiles()} loading={state.kind === "loading"}>
              刷新
            </Button>
          </div>
        </header>

        {state.kind === "error" ? (
          <div className={styles.error} data-testid="tpl-files-error">{state.message}</div>
        ) : null}

        <div className={styles.body}>
          {/* ── 文件列表 ── */}
          <aside className={styles.side} data-testid="tpl-file-list">
            {state.kind === "loading" ? (
              <div className={styles.sideHint}>读取中…</div>
            ) : files.length === 0 ? (
              <div className={styles.sideHint}>
                这个模板还没有任何文件
                <span className={styles.sideHintSub}>可以点右上角「新建文件」建一个 css / json</span>
              </div>
            ) : (
              files.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  className={`${styles.fileRow} ${activeName === f.name ? styles.fileRowActive : ""}`}
                  onClick={() => void guardDirty(() => openFile(f))}
                  data-testid="tpl-file-row"
                  data-name={f.name}
                  data-editable={f.editable ? "true" : "false"}
                  title={f.editable ? `编辑 ${f.name}` : `${f.name}（不可编辑）`}
                >
                  <span className={styles.fileIcon} aria-hidden>{iconFor(f.ext)}</span>
                  <span className={styles.fileName}>{f.name}</span>
                  <span className={styles.fileTail}>
                    {f.editable ? (
                      <Tag color="blue" bordered={false} className={styles.fileTag}>可编辑</Tag>
                    ) : (
                      <Tag bordered={false} className={styles.fileTagMuted}>只读</Tag>
                    )}
                  </span>
                </button>
              ))
            )}
          </aside>

          {/* ── 编辑区 ── */}
          <section className={styles.editor}>
            {!activeName ? (
              <div className={styles.placeholder}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span>
                      从左侧选择一个文件
                      <br />
                      <span className={styles.placeholderHint}>只有标记「可编辑」的文本文件能打开</span>
                    </span>
                  }
                />
              </div>
            ) : fileLoading ? (
              <div className={styles.placeholder}>读取 {activeName}…</div>
            ) : fileError ? (
              <div className={styles.error} data-testid="tpl-file-error">{fileError}</div>
            ) : file ? (
              <>
                <div className={styles.editorBar}>
                  <span className={styles.editorName}>{file.name}</span>
                  <span className={styles.editorMeta}>
                    {lineCount} 行 · {(draft.length / 1024).toFixed(1)} KB
                    {dirty ? <em className={styles.dirty}>未保存</em> : null}
                  </span>
                  <span className={styles.editorActions}>
                    <Tooltip title="放弃改动，回到磁盘上的内容">
                      <Button
                        size="small"
                        disabled={!dirty || saving}
                        onClick={() => setDraft(file.content)}
                      >
                        还原
                      </Button>
                    </Tooltip>
                    <Tooltip title="⌘S / Ctrl+S">
                      <Button
                        size="small"
                        type="primary"
                        disabled={!dirty || saving}
                        loading={saving}
                        onClick={() => void save()}
                        data-testid="tpl-file-save"
                      >
                        保存
                      </Button>
                    </Tooltip>
                  </span>
                </div>

                <div className={styles.codeWrap}>
                  <div className={styles.gutter} ref={gutterRef} aria-hidden>
                    {lineNumbers.map((n) => (
                      <div key={n}>{n}</div>
                    ))}
                  </div>
                  <textarea
                    ref={textRef}
                    className={styles.code}
                    value={draft}
                    spellCheck={false}
                    onChange={(e) => setDraft(e.target.value)}
                    onScroll={onScroll}
                    data-testid="tpl-file-editor"
                    /* 关掉自动纠正/自动大写，否则手机与部分浏览器会把 css 的
                       引号改成弯引号、把 .flex 首字母大写 —— 那会让样式直接失效 */
                    autoCapitalize="off"
                    autoCorrect="off"
                    wrap="off"
                  />
                </div>

                <div className={styles.footNote}>
                  {file.name === "style-pack.json" ? (
                    /*
                     * 套装文件与普通文件的行为不同，必须说清（2026-11-24）。
                     *
                     * <p>它是「模板和风格套装合并」的落点：`render` 里的
                     * 流速/阀门颜色/过期淡出会**立即**影响所有用这个套装的场景，
                     * 而不是像其它文件那样只影响「之后新建的场景」。
                     * 说成同一句会让人以为改错了地方。
                     */
                    <>
                      保存即覆盖，无法撤销。这是<b>风格套装定义</b>：`render` 里的
                      管道流速、阀门颜色、数据过期淡出会立即对所有使用该套装的场景生效。
                      同一套装被多个模板配置时，只有第一个模板的配置会被采用。
                    </>
                  ) : (
                    <>
                      保存即覆盖，无法撤销。改动只影响<b>之后</b>从该模板新建的场景；
                      已有场景已经拷走了自己的副本，不会跟着变。
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className={styles.placeholder}>—</div>
            )}
          </section>
        </div>
      </div>

      {/*
       * 新建文件对话框（2026-11-24）。
       *
       * <p>只收一个文件名：内容一律建成空文件再进编辑器 ——
       * 一步做两件事（选名 + 写内容）会让「建错名字」的返工成本变高。
       */}
      <Modal
        open={newDialogOpen}
        title="新建模板文件"
        okText="创建并编辑"
        cancelText="取消"
        confirmLoading={creating}
        onOk={() => void createFile()}
        onCancel={() => {
          /* 请求进行中不允许随手关掉，否则用户会以为取消成功了 */
          if (creating) return;
          setNewDialogOpen(false);
        }}
        data-testid="tpl-file-new-dialog"
      >
        <p className={styles.newHint}>
          支持 css / js / json / html / svg / txt / md 等文本格式。
          模型（glb）与压缩包不能这样新建。
        </p>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={() => void createFile()}
          placeholder="main.css"
          data-testid="tpl-file-new-name"
          autoFocus
        />
      </Modal>
    </Modal>
  );
}

/** 按扩展名给个字符图标，比引图标库轻，也比纯文字好认 */
function iconFor(ext: string): string {
  switch (ext) {
    case "glb":
      return "◇";
    case "css":
      return "#";
    case "js":
    case "mjs":
      return "{}";
    case "json":
    case "map":
      return "{}";
    case "html":
    case "htm":
      return "<>";
    case "svg":
      return "△";
    case "zip":
      return "▣";
    case "md":
    case "txt":
      return "¶";
    default:
      return "·";
  }
}

/** 取小写扩展名（无点）。与后端 `extensionOf` 同语义，仅用于本地置位。 */
function extensionOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}
