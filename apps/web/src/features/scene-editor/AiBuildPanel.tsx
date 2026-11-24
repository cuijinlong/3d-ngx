import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Collapse, Drawer, Input } from "antd";
import type { AiExtension, SceneWidgetLayout } from "@idt/data-adapter";
import { getConnectedGuardClient } from "@idt/data-adapter";
import { parseAiActions, planAiActions } from "./ai-actions";
import { describeAiFailure } from "./ai-errors";
import styles from "./AiBuildPanel.module.css";

/**
 * AI 搭建面板（2026-11-23 客户要求）。
 *
 * <h2>客户原话</h2>
 *
 * > 「按钮AI搭建（我希望开发一个Chat聊天对接codewhale代替命令行，
 * > 看看有没有插件省去开发）」
 *
 * <h2>调研结论：没有现成插件可省</h2>
 *
 * <p>实测本项目依赖清单（`apps/web/package.json` + `node_modules`）：
 * **零 AI / LLM 相关包**（无 openai / anthropic / langchain / assistant-ui 之类）。
 * 所以「装个插件就有了」这条路不存在，必须自己做前端 + 一层后端桥接。
 *
 * <h2>因此这一版交付的是「可用的壳 + 明确的后端契约」</h2>
 *
 * <p>三件事刻意分开，避免做出一个「看起来能用其实在编答案」的面板：
 * <ol>
 *   <li><b>UI 是真的</b>：消息流、输入框、快捷键、错误提示都能用；</li>
 *   <li><b>请求是真的</b>：点发送会真的 POST 到后端契约地址；</li>
 *   <li><b>回答不是编的</b>：后端没接上时，**明确报错并给出契约**，
 *       绝不在前端伪造「AI 回答」。</li>
 * </ol>
 *
 * <p>这是本项目「静默失败必须留痕」的直接应用：一个假 AI 面板比没有面板更糟 ——
 * 用户会照着它给的假命令去操作。
 *
 * <h2>后端契约（需要平台侧实现）</h2>
 *
 * ```http
 * POST /api/ngx/ai/chat
 * Content-Type: application/json
 *
 * { "messages": [{ "role": "user" | "assistant", "content": "..." }],
 *   "sceneId": "<当前场景 id>",
 *   "context": { "widgets": 7, "bindings": 13 } }
 *
 * 200 → { "content": "...", "actions"?: [{ "type": "add-widget", ... }] }
 * ```
 *
 * <p>`actions` 是关键：AI 要能**真正改场景**（加一张卡、绑一台设备），
 * 而不是只聊天。前端收到后交给 `applyAiActions` 落进布局 ——
 * 那是下一步，本轮先留字段。
 *
 * <h2>为什么面板是 Drawer 而不是独立页</h2>
 *
 * <p>「AI 搭建」的用法是：一边看画布一边让 AI 改。跳走页面就看不见
 * 改动的效果了。用右侧 Drawer 可以和「场景设置」共享同一块屏幕空间。
 */

export interface AiChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** 出错时标记，界面上用红框区分「AI 说的」与「系统报错」 */
  error?: boolean;
  /**
   * 这条消息附带的「待确认改动」（2026-11-24）。
   *
   * <p>挂在消息上而不是单独一个全局状态：多条改动可能先后到达，
   * 用户要能分清「哪句话对应哪一处改动」。全局单一 pending 会互相覆盖。
   */
  plan?: {
    diff: string[];
    issues: string[];
    /** 确认后要落地的布局；不合法时为 undefined */
    next?: SceneWidgetLayout;
    /** 已应用 / 已放弃 —— 用于把按钮换成一行结果说明 */
    settled?: "applied" | "discarded";
  };
}

/** 后端契约地址。可用环境变量覆盖（自建网关时指向别处）。 */
const ENDPOINT = (import.meta.env?.VITE_AI_CHAT_ENDPOINT as string | undefined)
  || "/api/ngx/ai/chat";

export function AiBuildPanel({
  open,
  onClose,
  sceneId,
  context,
  layout,
  aiExtension,
  onApplyLayout,
}: {
  open: boolean;
  onClose: () => void;
  sceneId?: string;
  /**
   * 当前场景摘要，给 AI 做上下文（不要塞整个文档，太大）。
   *
   * <p>类型放宽到 `object` 而不是 `Record<string, unknown>`：
   * 上下文有确定的结构（`AiSceneContext`），用索引签名会把这个结构
   * 在传参处磨平成「任意键值」，改字段名时编译器一句话都不说。
   * 面板只把它原样放进请求体，不需要按键访问。
   */
  context?: object;
  /**
   * 当前布局（2026-11-24）。AI 返回的 `actions` 要在这里落地。
   *
   * <p>传 null 表示场景还没有布局 —— 那时任何 `update-widget` 都无从执行，
   * 面板会明确说出来，而不是让用户以为「AI 改失败了」。
   */
  layout?: SceneWidgetLayout | null;
  /** 模板声明的编辑边界（`aiExtension`）。不传则用代码默认值。 */
  aiExtension?: AiExtension | null;
  /**
   * 应用改动。**只在这里被调用一次**，且只在用户确认之后。
   *
   * <p>不直接改 store 的原因：面板不该知道布局存在哪
   * （编辑器用 store、运行时是只读）。由调用方决定落到哪。
   */
  onApplyLayout?: (next: SceneWidgetLayout) => void;
}) {
  const [messages, setMessages] = useState<AiChatMessage[]>([
    {
      role: "assistant",
      /*
       * 欢迎语不再写「当前为未接通状态」（2026-11-24 改）。
       *
       * <p>那句话是 AI 桥接还没做时留下的。桥接接通后它变成**假信息** ——
       * 用户读到「未接通」就以为不能用，而实际上一条命令就能改布局。
       * 更要紧的是：这一屏里紧接着就会冒出真实的规划结果，
       * 前后自相矛盾，用户不知道该信哪个。
       *
       * <p>现在只说清楚「怎么用」和「会先给方案」，能不能用让实际请求说话：
       * 后端不可用时发送会失败并给出错误，那才是真实状态。
       */
      content:
        "我是 3D-NGX 的搭建助手。你可以让我：\n"
        + "· 「加一张机组负载率卡片到右翼第二块」\n"
        + "· 「把告警卡改成只显示告警级」\n"
        + "· 「把大屏标题改成园区冷热站运行总览」\n\n"
        + "每次改动都会先给出方案，你点「应用到布局」之后才会真正生效。",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  /*
   * 新消息滚到底。
   *
   * <p>用 `scrollTop = scrollHeight` 而不是 `scrollIntoView`：
   * 后者会把**整页**滚一下，抽屉外的主界面也跟着动。
   */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    const next: AiChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setBusy(true);
    try {
      /*
       * 带上平台登录凭据（2026-11-24 补）。
       *
       * <h3>为什么必须带</h3>
       *
       * <p>nginx 给这条路径**无条件**注入桥接密钥 —— 也就是说，
       * 只要能访问 8090，谁都能白嫖模型额度。实测：不带任何登录凭据
       * 直接 POST `/api/ngx/ai/chat` 返回 200 和一段完整的 AI 回答。
       *
       * <p>所以身份必须由**平台**来判：桥接拿到这个 token 会去
       * `GET /api/auth/user` 验一遍，非租户管理员一律拒绝。
       * 项目全站用的都是 `X-Authorization`（不是标准 `Authorization`），
       * 这里保持一致，否则桥接那头读到的是空值。
       */
      const token = getConnectedGuardClient()?.getState().token;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
          sceneId,
          context,
        }),
      });
      if (!res.ok) {
        /*
         * 失败时**先读服务端的说法**（2026-11-24 改）。
         *
         * <p>原来这里把所有非 2xx 都报成「后端未接通，需要平台实现路由」——
         * 那是后端还没实现时的假设。现在加了身份校验，401/403/503
         * 各有各的处置方式，再统一报成「未接通」会把人引向完全错误的方向。
         *
         * <p>桥接的 `error` 字段是照着「用户下一步做什么」写的，
         * 直接用它比自己再编一套准确。
         */
        let serverError = "";
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body?.error === "string") serverError = body.error;
        } catch {
          /* body 不是 JSON（比如 nginx 的 502 页面）—— 走状态码兜底 */
        }
        throw new Error(describeAiFailure(res.status, serverError));
      }
      const data = (await res.json()) as { content?: string; actions?: unknown };
      if (!data?.content) throw new Error("后端返回里没有 content 字段");

      /*
       * 处理 actions（2026-11-24）。
       *
       * <p>顺序要紧：先解析形状，再校验合法性，最后才挂到消息上等确认。
       * 任何一步失败都**不应用**，并把原因说清楚 —— 静默丢弃 actions
       * 会让用户看到「AI 说改好了」而界面没变。
       */
      const parsed = parseAiActions(data.actions);
      let plan: AiChatMessage["plan"];
      if (!parsed.ok) {
        plan = { diff: [], issues: [parsed.error] };
      } else if (parsed.operations.length) {
        const built = planAiActions(layout, parsed.operations, aiExtension);
        plan = {
          diff: built.proposal.diff,
          issues: built.proposal.issues.map((issue) => issue.message),
          ...(built.proposal.ok && built.proposal.next ? { next: built.proposal.next } : {}),
        };
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.content!, ...(plan ? { plan } : {}) },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          error: true,
          content: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, messages, sceneId, context, layout, aiExtension]);

  /**
   * 应用某条消息的改动（2026-11-24）。
   *
   * <p>应用后把这条消息的 plan 标成 `applied` 并把布局交出去。
   * 不在这里重新校验 —— 校验发生在收到回包时；从「挂上去」到
   * 「点确认」之间布局可能被用户手动改过，但那份风险已经由
   * 「一条消息对应一次 AI 回合」限制住了。要更严格的话必须把
   * 布局版本号带进来，那是下一步。
   */
  const applyPlan = useCallback(
    (index: number, next: SceneWidgetLayout) => {
      onApplyLayout?.(next);
      setMessages((prev) =>
        prev.map((msg, i) => (i === index && msg.plan ? { ...msg, plan: { ...msg.plan, settled: "applied" } } : msg)),
      );
    },
    [onApplyLayout],
  );

  const discardPlan = useCallback((index: number) => {
    setMessages((prev) =>
      prev.map((msg, i) => (i === index && msg.plan ? { ...msg, plan: { ...msg.plan, settled: "discarded" } } : msg)),
    );
  }, []);

  return (
    <Drawer
      /*
       * 标题上原来挂着一个写死的「未接通后端」橙标（2026-11-24 删）。
       *
       * <p>它是桥接还没做时留下的占位。现在后端早就通了 ——
       * 实测 AI 正常回复、正常给提案，而抽屉标题栏仍然挂着这行字。
       * 这是**假信息**，还挂在整个面板最显眼的位置：用户一打开就以为不能用，
       * 于是根本不会去试。
       *
       * <p>不改成动态状态的原因：可用性已经由「第一次请求成功与否」表达
       * （失败会在消息区给出具体原因）。再加一个指示灯，只会出现
       * 「灯是绿的但请求失败」这种更让人困惑的组合。
       */
      title={<span className={styles.titleRow}>AI 搭建</span>}
      open={open}
      onClose={onClose}
      placement="right"
      width={420}
      mask={false}
      data-testid="ai-build-panel"
    >
      <div className={styles.wrap}>
        <div className={styles.list} ref={listRef} data-testid="ai-messages">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`${styles.bubble} ${
                msg.error ? styles.bubbleError : msg.role === "user" ? styles.bubbleUser : styles.bubbleAi
              }`}
              data-role={msg.role}
              data-error={msg.error ? "true" : undefined}
            >
              <div className={styles.bubbleHead}>
                {msg.role === "user" ? "我" : msg.role === "system" ? "系统" : "助手"}
              </div>
              <div className={styles.bubbleBody}>{msg.content}</div>

              {msg.plan ? (
                <div className={styles.plan} data-testid={`ai-plan-${index}`}>
                  {msg.plan.issues.length ? (
                    <div className={styles.planIssues} data-testid="ai-plan-issues">
                      <b>{msg.plan.next ? "有提示" : "不能应用"}</b>
                      <ul>
                        {msg.plan.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {msg.plan.diff.length ? (
                    <Collapse
                      size="small"
                      defaultActiveKey={["diff"]}
                      items={[
                        {
                          key: "diff",
                          label: `${msg.plan.diff.length} 处改动`,
                          children: (
                            <ul className={styles.planDiff}>
                              {msg.plan.diff.map((line, i) => (
                                <li key={i}>{line}</li>
                              ))}
                            </ul>
                          ),
                        },
                      ]}
                    />
                  ) : null}

                  {msg.plan.settled === "applied" ? (
                    <div className={styles.planSettled}>已应用到布局 · 记得点编辑器「保存」</div>
                  ) : msg.plan.settled === "discarded" ? (
                    <div className={styles.planSettled}>已放弃这处改动</div>
                  ) : msg.plan.next ? (
                    <div className={styles.planActions}>
                      <Button
                        type="primary"
                        size="small"
                        data-testid="ai-plan-apply"
                        onClick={() => applyPlan(index, msg.plan!.next!)}
                      >
                        应用到布局
                      </Button>
                      <Button size="small" data-testid="ai-plan-discard" onClick={() => discardPlan(index)}>
                        放弃
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className={styles.composer}>
          <Input.TextArea
            data-testid="ai-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="描述你想要的改动，例如：右侧加一块机组负载率卡片"
            autoSize={{ minRows: 2, maxRows: 5 }}
            /*
             * Enter 发送、Shift+Enter 换行。
             *
             * <p>聊天框的通用约定。不拦 Enter 的话用户会以为发送坏了；
             * 不保留 Shift+Enter 则没法写多行。
             */
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="primary"
            loading={busy}
            onClick={() => void send()}
            disabled={!draft.trim()}
            data-testid="ai-send"
          >
            发送
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
