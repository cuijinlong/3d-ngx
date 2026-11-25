import { useCallback, useEffect, useRef, useState } from "react";
import { getSceneTemplateApi, type SceneTemplateCard } from "@idt/data-adapter";
import type { ScenePlatformRef } from "@idt/shared-types";
import { matchTemplateForScene } from "../features/scene-editor/TemplateFilePanel";
import {
  assessRequirements,
  buildRequirementsSkeleton,
  type RequirementsAssessment,
} from "../features/scene-editor/requirements-skeleton";

/**
 * 读出「这个场景所属模板」里给 AI 看的文档（2026-11-24）。
 *
 * <h2>它解决什么</h2>
 *
 * <p>客户要求：「我可以在文件资源管理器中编辑我的需求，然后让 AI 读取
 * 帮我开发 AI 构建大屏」。
 *
 * <p>此前 AI 只拿得到**当前场景的结构**（有哪些卡、哪些遥测键）——
 * 它知道现状，不知道作者的**意图**。意图本来就应该由人写在文件里，
 * 而不是让模型每轮从卡片标题里反推。
 *
 * <h2>读哪些文件</h2>
 *
 * <p>只读「约定文件」，不是把模板目录整个拉下来：
 *
 * <table>
 *   <tr><td><code>requirements.md</code></td><td>人写的需求 —— 这是客户最直接的诉求</td></tr>
 *   <tr><td><code>SKILL.md</code></td><td>给模型的执行提示词</td></tr>
 *   <tr><td><code>schema.json</code></td><td>字段契约（能填什么、必填什么）</td></tr>
 *   <tr><td><code>style-pack.json</code></td><td>风格套装定义（流速/阀门颜色/过期淡出）</td></tr>
 * </table>
 *
 * <p>`template.json`（布局本体）**故意不读**：它体积大，而且当前权威
 * 仍是前端内置常量（见 §39.6 的决策待定项）。把一份可能过期的布局塞进
 * prompt，模型会以为自己看到的是现状 —— 而真正的现状已经在
 * `context.widgetList` 里了，那份才是实时的。
 *
 * <h2>为什么失败全部静默</h2>
 *
 * <p>模板读不到（客户身份 403、没配模板、网络失败）时返回空数组，
 * **不让 AI 构建不可用**。AI 构建本身有场景上下文，能独立工作；
 * 少一份需求文档是降级，不是故障。
 *
 * <p>但会记录原因到 `error`，界面可以显示一行小字 ——
 * 「我以为 AI 读了需求，其实没有」是最难发现的错。
 */

/** 约定文件及其在 prompt 里的显示顺序（需求排第一，最该被看到）。 */
export const TEMPLATE_DOC_FILES = ["requirements.md", "SKILL.md", "schema.json", "style-pack.json"] as const;

export interface TemplateDoc {
  name: string;
  content: string;
}

export interface TemplateDocsState {
  /** 读到的文档。空数组 = 没有或读不到。 */
  docs: TemplateDoc[];
  /** 猜到的模板（用于界面显示「AI 正在参考：xxx」）。 */
  template: SceneTemplateCard | null;
  loading: boolean;
  /** 读不到的原因（权限/网络）。有值且 docs 为空时界面要说明。 */
  error: string | null;
  /**
   * `requirements.md` 的填写完整度（2026-11-24）。
   *
   * <p>客户定调：模板是「AI 和用户针对性沟通需求的桥梁」。
   * 桥梁要能指出没搭完的地方 —— 用户填了三节就点 AI，
   * AI 只能对着空白的「统计口径」猜，猜出来看着合理但不对。
   *
   * <p>没有 requirements.md 时为 null（界面提示"去建一个"）。
   */
  requirements?: RequirementsAssessment | null;
}

/**
 * 模块级缓存。
 *
 * <p>键是 `templateId`。AI 面板每次打开都读一遍会把同一个接口打很多次，
 * 而需求文档是**人偶尔才改**的内容 —— 面板生命周期内缓存完全够。
 * 刷新（用户重开面板）时由 `reload` 显式清。
 */
const cache = new Map<string, Promise<TemplateDoc[]>>();

/** 测试用：清空缓存。 */
export function resetTemplateDocsCache(): void {
  cache.clear();
}

/**
 * 把读到的原始内容整理成文档列表（纯函数，便于测试）。
 *
 * <p>两条规则：
 *   · **空内容丢弃** —— 模板里常见「占位空文件」，把它当需求发给模型
 *     等于告诉它「作者没要求」，与「文件不存在」同效，但多占 prompt；
 *   · **保持传入顺序** —— requirements.md 必须排在最前，
 *     模型对 prompt 前部更敏感（这是「需求优先于默认假设」的落实）。
 */
export function normalizeTemplateDocs(
  raw: Array<{ name: string; content?: string | null }>,
): TemplateDoc[] {
  const out: TemplateDoc[] = [];
  for (const item of raw) {
    const name = String(item?.name ?? "").trim();
    const content = String(item?.content ?? "").trim();
    if (!name || !content) continue;
    out.push({ name, content });
  }
  return out;
}

async function loadDocs(templateId: string, files: string[]): Promise<TemplateDoc[]> {
  const api = getSceneTemplateApi();
  const raw: Array<{ name: string; content?: string | null }> = [];
  for (const name of files) {
    try {
      const file = await api.readFile(templateId, name);
      raw.push({ name, content: file?.content });
    } catch {
      /*
       * 单份失败不影响其它：模板里通常只有其中一两份。
       * 404（文件不存在）是**常态**，不是错误。
       */
      continue;
    }
  }
  return normalizeTemplateDocs(raw);
}

/**
 * 从读到的文档里算出「资料填了多少」。
 *
 * <p>对照基准是**同一份骨架**（用模板名生成）：骨架里的示例行不算用户内容，
 * 所以「建了但没填」会被准确判成 0/8，而不是看起来已经填满。
 */
export function assessDocs(
  docs: TemplateDoc[],
  templateName: string,
): RequirementsAssessment | null {
  const requirements = docs.find((doc) => doc.name === "requirements.md");
  if (!requirements) return null;
  return assessRequirements(requirements.content, buildRequirementsSkeleton(templateName));
}

export function useTemplateDocs(input: {
  platform?: ScenePlatformRef;
  sceneName?: string;
  /** 关掉时不发任何请求（AI 面板没打开就不该读盘）。 */
  enabled?: boolean;
}): TemplateDocsState & { reload: () => void } {
  const { platform, sceneName, enabled = true } = input;
  const [state, setState] = useState<TemplateDocsState>({
    docs: [],
    template: null,
    loading: false,
    error: null,
    requirements: null,
  });
  /** 防止「组件已卸载/参数已变」时用旧结果 setState。 */
  const alive = useRef(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => {
    /* 清掉这次要用的那个模板的缓存，让下一次真的重新读 */
    cache.clear();
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ docs: [], template: null, loading: false, requirements: null, error: null });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    void (async () => {
      let templates: SceneTemplateCard[];
      try {
        templates = await getSceneTemplateApi().list();
      } catch (error) {
        if (cancelled) return;
        const text = error instanceof Error ? error.message : String(error);
        setState({
          docs: [],
          template: null,
          loading: false,
          requirements: null,
          error: /403|forbidden|权限/i.test(text)
            ? "当前身份不能读取场景模板（只有租户管理员可以）。"
            : text,
        });
        return;
      }
      const guess = matchTemplateForScene(templates, platform, sceneName);
      const template = guess.template ?? templates[0] ?? null;
      if (!template) {
        if (cancelled) return;
        setState({ docs: [], template: null, loading: false, requirements: null, error: null });
        return;
      }
      let pending = cache.get(template.id);
      if (!pending) {
        pending = loadDocs(template.id, [...TEMPLATE_DOC_FILES]);
        cache.set(template.id, pending);
      }
      const docs = await pending;
      if (cancelled) return;
      setState({
        docs,
        template,
        loading: false,
        error: null,
        requirements: assessDocs(docs, template.name ?? ""),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, platform, sceneName, tick]);

  return { ...state, reload };
}
