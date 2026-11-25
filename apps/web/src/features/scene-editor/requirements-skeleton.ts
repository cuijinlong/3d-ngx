import skeleton from "./templates/requirements-skeleton.md?raw";

/**
 * 生成模板的「现场资料与需求」骨架（2026-11-24）。
 *
 * <h2>为什么需要这一层</h2>
 *
 * <p>客户原话：「每个模板最起码要让用户提供真实的资料信息，这样 AI 才会知道
 * 怎么开发，所以模板是 AI 和用户针对性沟通需求的桥梁」。
 *
 * <p>所以骨架不是「随便写几句」的占位，而是一份**结构化访谈提纲**：
 * 场站信息 / 设备清单 / 每类设备上报什么指标 / 统计口径 / 告警定义 /
 * 布局视觉 / 明确不要什么 / 术语对照。每一节都对应 AI 做决策时必须知道的输入。
 *
 * <h2>为什么是单独的 .md 文件而不是模板字符串</h2>
 *
 * <p>同一份骨架要被两处使用：
 * <ul>
 *   <li>前端「发布为模板」——用 `?raw` 引入（构建期内联）；</li>
 *   <li><code>scripts/seed-style-pack-file.mjs</code>——用 fs 直接读。</li>
 * </ul>
 * 各写一份必然走样（改了前端忘了脚本，老模板补出来的骨架就和新建的不一样）。
 * 放成文件后两边读同一份，脚本不需要 TS 运行时。
 */

/**
 * 把 `{{name}}` 换成模板名。
 *
 * <p>只替换这一个占位符：骨架是给人编辑的 Markdown，
 * 注入太多变量会让它读起来像配置文件而不是文档。
 */
export function buildRequirementsSkeleton(name: string): string {
  const safe = (name ?? "").trim() || "未命名场景";
  return skeleton.replaceAll("{{name}}", safe);
}

/** 骨架里各节的标题 —— 测试与「检查用户填了没有」都从这里取，不另抄一份。 */
export const REQUIREMENTS_SECTIONS = [
  "项目与场站",
  "系统构成",
  "每类设备上报的指标",
  "要统计什么",
  "告警与故障",
  "布局与视觉",
  "明确不要的",
  "术语与叫法",
] as const;

/** 骨架文件放在仓库里的相对路径（给 seed 脚本用，避免它自己拼错）。 */
export const REQUIREMENTS_SKELETON_PATH = "apps/web/src/features/scene-editor/templates/requirements-skeleton.md";

/** 一节资料是否「填了实质内容」。 */
export interface RequirementsSectionStatus {
  /** 节标题（去掉编号，如「统计口径」） */
  title: string;
  filled: boolean;
}

export interface RequirementsAssessment {
  sections: RequirementsSectionStatus[];
  /** 已填 / 总数 */
  filledCount: number;
  total: number;
  /** 用户还没填的节名 —— 界面直接告诉他该补什么 */
  missing: string[];
}

/**
 * 判断一份 `requirements.md` 里哪些小节还空着（2026-11-24）。
 *
 * <h2>为什么需要它</h2>
 *
 * <p>客户定调：模板是「AI 和用户针对性沟通需求的桥梁」。
 * 桥梁要能指出**桥没搭完的地方** —— 用户填了三节就点 AI，
 * AI 只能对着空白的「统计口径」猜，猜出来的东西看着合理但不对。
 *
 * <p>与其让 AI 编，不如明确告诉他「还缺统计口径和告警定义」。
 *
 * <h2>判据</h2>
 *
 * <p>按 `## ` 分节，对每节正文做「实质内容」判定：
 * <ul>
 *   <li>丢掉空行、表格分隔行（`| --- |`）；</li>
 *   <li>丢掉「标签后什么都没有」的模板行（`- 指标：`、`| 示例：xxx |`）；</li>
 *   <li>丢掉 `>` 引用块（那是骨架自带的填写说明，不是用户内容）。</li>
 * </ul>
 *
 * <p>剩下的字符数 ≥ {@link MIN_FILLED_CHARS} 才算填了。
 * 阈值不取 1~2：用户敲个「好」「无」不构成可开发的资料，
 * 那会让界面显示「已填 8/8」而 AI 依然无从下手。
 */
const MIN_FILLED_CHARS = 8;

export function assessRequirements(
  content: string | null | undefined,
  /**
   * 原骨架（可选）。
   *
   * <p>给了它就用**逐行对照**判断：「这一行骨架里也有 → 用户没动过」。
   * 这比任何语法判据都可靠 —— 骨架里的示例行（`| 示例：模块机 | 开利 | 9 |`、
   * `- 指标：温度（℃），正常范围 ____ ~ ____`）在语法上都是"有内容"的，
   * 纯靠正则识别会漏，然后界面误报「资料已填完」。
   *
   * <p>不给时退化为语法判据（只用于没有骨架可比的场合）。
   */
  skeleton?: string | null,
): RequirementsAssessment {
  const text = String(content ?? "");
  const baseline = skeleton == null ? null : sectionBodies(String(skeleton));
  const sections: RequirementsSectionStatus[] = [];

  for (const [title, body] of sectionBodies(text)) {
    const reference = baseline?.get(title);
    const filled = reference ? hasLinesBeyond(body, reference) : hasSubstance(body.join("\n"));
    sections.push({ title, filled });
  }
  const missing = sections.filter((item) => !item.filled).map((item) => item.title);
  return {
    sections,
    filledCount: sections.filter((item) => item.filled).length,
    total: sections.length,
    missing,
  };
}

/**
 * 按 `## ` 小节切开，键是去掉编号的标题。
 *
 * <p>用 Map 而不是数组：骨架与用户文档要**按标题对齐**比对，
 * 顺序变了也不会错位（用户可能调换小节顺序）。
 */
function sectionBodies(md: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const blocks = md.split(/^##\s+/m).slice(1);
  for (const block of blocks) {
    const newline = block.indexOf("\n");
    const heading = (newline < 0 ? block : block.slice(0, newline)).trim();
    const title = heading.replace(/^\d+[.、]\s*/, "").trim();
    if (!title) continue;
    const body = newline < 0 ? "" : block.slice(newline + 1);
    out.set(title, body.split("\n"));
  }
  return out;
}

/**
 * 正文里有没有「骨架里没有的行」。
 *
 * <p>比较用的是 trim 后的整行 —— 用户哪怕只在示例行末尾加了个句号，
 * 也算他确认过这条，不该继续报「未填」。
 *
 * <p>表格分隔行（`| --- |`）与引用块（`>`）不参与：前者是格式，
 * 后者是骨架自带的填写说明。
 */
function hasLinesBeyond(body: string[], reference: string[]): boolean {
  const known = new Set(reference.map((line) => line.trim()));
  let kept = 0;
  for (const rawLine of body) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) continue;
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    /* 骨架里原封不动的那一行 → 用户没动过 */
    if (known.has(line)) continue;
    kept += line.length;
  }
  return kept >= MIN_FILLED_CHARS;
}

/** 一节正文里是否有用户真正写下的内容（无骨架可比时的退化判据）。 */
function hasSubstance(body: string): boolean {
  let kept = 0;
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) continue;
    if (/^\|[\s:|-]+\|$/.test(line)) continue;

    if (line.startsWith("|")) {
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      if (!cells.length) continue;
      /* 表头与示例行都不算用户内容 */
      if (/^(设备类型|大屏位置|现场叫法)$/.test(cells[0] ?? "")) continue;
      if (/^示例\s*[:：]/.test(cells[0] ?? "")) continue;
      kept += cells.join("").length;
      continue;
    }

    const colon = /^[-*]\s*([^:：]*)[:：]\s*(.*)$/.exec(line);
    if (colon) {
      const value = (colon[2] ?? "").trim();
      /* 占位下划线（____）也是骨架的填空提示，不是用户内容 */
      if (!value || /^[_\s~-]+$/.test(value)) continue;
      kept += value.length;
      continue;
    }
    kept += line.replace(/^\d+[.、]\s*/, "").length;
  }
  return kept >= MIN_FILLED_CHARS;
}
