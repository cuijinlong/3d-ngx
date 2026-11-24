import { Input, Modal, Button } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GuardHttpError,
  getGuardStatus,
  getProviderKind,
  getSceneTemplateApi,
  type SceneTemplateCard,
} from "@idt/data-adapter";
import {
  builtinLayoutCards,
  builtinLayoutId,
  filterSceneTemplates,
  isBuiltinLayoutCard,
  previewRegions,
  resolveLayoutForSceneTemplate,
  templateHasModel,
} from "./template-picker";
import styles from "./TemplatePickerDialog.module.css";

/**
 * 模板中心（弹框形态，2026-11-23）。
 *
 * <h2>客户要求</h2>
 *
 * <p>「平台应该有一个地方存储公共的场景模板，3d-ngx 在创建场景的时候从模板库中选择模板，
 * 具体样式参考 templates.html 的样式（不用考虑左侧和上面的菜单）。3d-ngx 创建场景表单中
 * 点击选择模板应该出现弹出框，弹出的就是刚才那个 .html 原型图。」
 *
 * <h2>为什么是弹框而不是页面</h2>
 *
 * <p>创建场景的表单已经填了一半（名称、场站、视图、范围），跳到另一个页面选模板
 * 会把表单状态丢掉。弹框不动路由，选完接着填。
 *
 * <h2>视觉为什么照原型重做一遍</h2>
 *
 * <p>原型是深色玻璃质感的卡片网格，而本项目用的是 antd 亮色主题 ——
 * 直接塞 `List` 会得到一个「表单里的表格」，和原型差得远。
 * 所以这里内层完全自绘（见 `TemplatePickerDialog.module.css`），
 * 只借用 antd `Modal` 的 portal / 焦点陷阱 / ESC 关闭。
 *
 * <h2>★ 卡片上的线框是真实布局，不是示意图</h2>
 *
 * <p>模板库的记录没有缩略图字段（只有模型和风格套装）。与其画一张假的场景截图，
 * 不如按内置布局真实的 `regions` 画线框 —— 用户看到的就是选完之后大屏的骨架。
 * 这符合本项目一贯的做法：宁可显示得朴素一点，也不给看起来像真的假信息。
 */
export interface TemplatePickerDialogProps {
  open: boolean;
  /** 当前已选中的卡片 id（平台模板 id 或 `builtin:xxx`） */
  selectedId?: string | null;
  onClose: () => void;
  /**
   * 选模板。
   *
   * <p>`layoutId` 已经由 `resolveLayoutForSceneTemplate` 定好 ——
   * 调用方不需要再自己映射一遍，两处各算一次必然分叉。
   */
  onPick: (template: SceneTemplateCard, layoutId: string) => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; templates: SceneTemplateCard[]; degradedNote?: string }
  | { kind: "error"; message: string };

export function TemplatePickerDialog({ open, selectedId, onClose, onPick }: TemplatePickerDialogProps) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [query, setQuery] = useState("");

  const connected = getProviderKind() === "guard" && getGuardStatus().connected;

  const load = useCallback(async () => {
    if (!connected) {
      /*
       * 未连平台时不去调接口（必然 401/404），直接给内置布局。
       *
       * <p>但必须**说清楚**这是降级：不然用户会以为平台模板库里就这几条。
       * 场景创建本身是允许离线试建的（向导里其他字段也有同样的降级），
       * 所以这里不禁用，只标注。
       */
      setState({
        kind: "ready",
        templates: [],
        degradedNote: "未连接平台：只显示内置布局。连上平台后这里会列出公共场景模板。",
      });
      return;
    }
    setState({ kind: "loading" });
    try {
      /*
       * 用 options 而不是 list（2026-11-23）。
       *
       * <p>`list` 后端限 TENANT_ADMIN，客户登录时必然 403 ——
       * 而客户建场景正是这个弹框的主路径。`options` 是专为此加的只读接口：
       * 含 CUSTOMER_USER 权限，且不返回 objectKey。
       */
      const templates = await getSceneTemplateApi().options();
      setState({ kind: "ready", templates });
    } catch (error) {
      /*
       * 404 单独识别为「平台还没有这个接口」（2026-11-23）。
       *
       * <p>`GET /scene-template-options` 是这一轮新加的。部署顺序上很可能
       * 前端先上、后端后上 —— 那时接口就是 404。把它当成普通故障显示
       * 「模板库读取失败」，运维会去查网关、查权限，白花半天。
       *
       * <p>这里照实说：接口不存在，所以只能用内置布局。等后端升级后点「刷新」即可。
       */
      const status = error instanceof GuardHttpError ? error.status : undefined;
      if (status === 404) {
        setState({
          kind: "ready",
          templates: [],
          degradedNote:
            "平台尚未提供模板清单接口（/api/energy/scene-template-options 返回 404）。" +
            "后端升级后点「刷新」即可看到公共模板；现在只能用内置布局。",
        });
        return;
      }
      const message = error instanceof Error ? error.message : "网络异常";
      /*
       * 其他失败时**仍然给内置布局**，否则弹框整个不能用，
       * 连「用默认布局建个场景」都做不到。错误照实显示在顶部。
       */
      setState({ kind: "error", message });
    }
  }, [connected]);

  /* 只在打开时加载一次；关闭后不清空，下次打开先显示上次内容再刷新 */
  useEffect(() => {
    if (!open) return;
    if (state.kind === "idle") void load();
  }, [open, state.kind, load]);

  const platformTemplates = state.kind === "ready" ? state.templates : [];
  const builtins = useMemo(() => builtinLayoutCards(), []);

  /*
   * 内置布局永远排在后面：它们是「没有模板时的底」，不是推荐项。
   * 合并后一起过搜索，否则搜索时内置项会「消失」（它不在 templates 里）。
   */
  const visible = useMemo(() => {
    const filteredPlatform = filterSceneTemplates(platformTemplates, query);
    const filteredBuiltin = filterSceneTemplates(builtins, query);
    return [...filteredPlatform, ...filteredBuiltin];
  }, [platformTemplates, builtins, query]);

  const counts = {
    platform: platformTemplates.length,
    builtin: builtins.length,
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1180}
      centered
      destroyOnClose={false}
      className={styles.modalShell}
      styles={{ body: { padding: 0 } }}
      title={null}
    >
      <div className={styles.shell} data-testid="template-picker-dialog">
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>
              模板中心
              <span className={styles.titleMark} aria-hidden>⌜</span>
            </h2>
            <p className={styles.lead}>
              选择、导入和管理可复用的场景模板。模板定义结构和能力，不包含某个项目的真实设备数据。
            </p>
          </div>
          <div className={styles.headRight}>
            <Input.Search
              allowClear
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模板名称、风格套装"
              className={styles.search}
            />
            <Button size="small" onClick={() => void load()} loading={state.kind === "loading"}>
              刷新
            </Button>
          </div>
        </header>

        {/* 降级 / 错误提示：必须显式，静默降级会让人以为模板库是空的 */}
        {state.kind === "ready" && state.degradedNote ? (
          <div className={styles.notice} data-testid="template-picker-degraded">
            {state.degradedNote}
          </div>
        ) : null}
        {state.kind === "error" ? (
          <div className={`${styles.notice} ${styles.noticeError}`} data-testid="template-picker-error">
            模板库读取失败：{state.message}。下面只列出内置布局，仍可继续创建场景。
          </div>
        ) : null}

        {state.kind === "loading" ? (
          <div className={styles.skeletonGrid} aria-busy="true">
            {[0, 1, 2].map((key) => (
              <div key={key} className={styles.skeletonCard} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon} aria-hidden>▦</div>
            <b>没有匹配「{query}」的模板</b>
            <span className={styles.emptyHint}>换个关键词，或清空搜索框查看全部。</span>
          </div>
        ) : (
          <div className={styles.grid} data-testid="template-picker-grid">
            {visible.map((template) => {
              const layout = isBuiltinLayoutCard(template)
                ? { layoutId: builtinLayoutId(template), note: "内置布局", matchedBy: "keyword" as const }
                : resolveLayoutForSceneTemplate(template);
              const regions = previewRegions(layout.layoutId);
              const active = template.id === selectedId;
              return (
                <article
                  key={template.id}
                  className={`${styles.card} ${active ? styles.cardActive : ""}`}
                  data-testid="template-picker-card"
                  data-template-id={template.id}
                  data-active={active ? "true" : "false"}
                >
                  <div className={styles.cardTop}>
                    {isBuiltinLayoutCard(template) ? (
                      <span className={`${styles.tag} ${styles.tagMuted}`}>内置布局</span>
                    ) : (
                      <span className={`${styles.tag} ${templateHasModel(template) ? styles.tagGreen : styles.tagGold}`}>
                        {templateHasModel(template) ? "含模型" : "仅布局"}
                      </span>
                    )}
                    {template.templateVersion ? (
                      <span className={styles.cardVersion}>{template.templateVersion}</span>
                    ) : null}
                  </div>

                  {/* 预览：真实布局的线框，色系随布局区分 */}
                  <div
                    className={styles.preview}
                    data-layout={layout.layoutId}
                    role="img"
                    aria-label={`${template.name} 布局预览`}
                  >
                    <div className={styles.previewBar}>
                      <span>{layout.layoutId.toUpperCase().replace(/-/g, " ")}</span>
                      <span className={styles.previewDots} aria-hidden>●●●</span>
                    </div>
                    <div className={styles.previewStage}>
                      {regions.map((region) => (
                        <span
                          key={region.id}
                          className={`${styles.previewRegion} ${region.isTitle ? styles.previewTitle : ""}`}
                          style={{
                            left: `${region.x}%`,
                            top: `${region.y}%`,
                            width: `${region.w}%`,
                            height: `${region.h}%`,
                          }}
                          title={region.title}
                        />
                      ))}
                      {regions.length === 0 ? (
                        <span className={styles.previewEmpty}>无布局信息</span>
                      ) : null}
                    </div>
                  </div>

                  <h3 className={styles.cardName}>{template.name}</h3>
                  <p className={styles.cardDesc}>
                    {template.description || (isBuiltinLayoutCard(template) ? "内置大屏布局，可直接使用。" : "这个模板还没有填写描述。")}
                  </p>

                  <div className={styles.cardMeta}>
                    <span className={styles.layoutNote}>{layout.note}</span>
                    {!isBuiltinLayoutCard(template) && template.stylePack ? (
                      <span className={styles.packNote} title="风格套装会一并带到新场景">
                        {template.stylePack}
                      </span>
                    ) : null}
                  </div>

                  <div className={styles.cardFoot}>
                    <span className={styles.cardCount}>{counts.platform > 0 ? "平台模板" : ""}</span>
                    <Button
                      type="primary"
                      size="small"
                      className={styles.pickButton}
                      onClick={() => onPick(template, layout.layoutId)}
                      data-testid="template-picker-use"
                    >
                      {active ? "已选择" : "使用模板"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <footer className={styles.foot}>
          <span>
            模型与风格套装存放在平台文件服务器（对象存储 <code>scene-template/</code> 前缀），
            换机器或换浏览器都不会丢；新建场景时由服务端复制一份到该场景名下，
            之后改模型不会影响模板本身。
          </span>
          <span className={styles.footCount}>
            平台模板 {counts.platform} · 内置布局 {counts.builtin}
          </span>
        </footer>
      </div>
    </Modal>
  );
}
