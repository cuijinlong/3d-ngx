import { describe, expect, it } from "vitest";
import { normalizeTemplateDocs, TEMPLATE_DOC_FILES } from "./useTemplateDocs";

/*
 * 模板文档整理（2026-11-24）。
 *
 * <p>钉住的是「AI 到底读到什么内容」—— 客户要求「在文件资源管理器里编辑我的需求，
 * 让 AI 读取帮我开发」。这里错一步，AI 就会在**没有需求**的情况下自由发挥，
 * 而界面上看起来一切正常。
 */

describe("TEMPLATE_DOC_FILES", () => {
  it("★ requirements.md 排第一（模型对 prompt 前部更敏感）", () => {
    expect(TEMPLATE_DOC_FILES[0]).toBe("requirements.md");
    expect([...TEMPLATE_DOC_FILES]).toEqual([
      "requirements.md",
      "SKILL.md",
      "schema.json",
      "style-pack.json",
    ]);
  });

  it("只认约定文件 —— 不把 glb 之类二进制当文档读", () => {
    /* 二进制进 prompt 既浪费 token 又会得到乱码 */
    expect(TEMPLATE_DOC_FILES).not.toContain("model.glb");
    expect(TEMPLATE_DOC_FILES.some((name) => name.endsWith(".md") || name.endsWith(".json"))).toBe(true);
  });
});

describe("normalizeTemplateDocs", () => {
  it("★ 空内容丢弃（占位空文件不等于「有要求」）", () => {
    /*
     * 模板里常见「建了但没写」的空 requirements.md。
     * 把它当需求发给模型，与「没有这份文件」同效，但白占 prompt 预算。
     */
    const out = normalizeTemplateDocs([
      { name: "requirements.md", content: "   \n\t  " },
      { name: "SKILL.md", content: "按步骤做" },
    ]);
    expect(out.map((d) => d.name)).toEqual(["SKILL.md"]);
  });

  it("保持传入顺序（顺序由 TEMPLATE_DOC_FILES 决定，这里不能再排）", () => {
    const out = normalizeTemplateDocs([
      { name: "requirements.md", content: "需求" },
      { name: "style-pack.json", content: "{}" },
      { name: "SKILL.md", content: "步骤" },
    ]);
    expect(out.map((d) => d.name)).toEqual(["requirements.md", "style-pack.json", "SKILL.md"]);
  });

  it("内容前后空白被裁掉（模型不需要缩进噪声）", () => {
    const out = normalizeTemplateDocs([{ name: "requirements.md", content: "\n\n  要三块卡  \n" }]);
    expect(out[0]?.content).toBe("要三块卡");
  });

  it("缺 name 或 content 为 null 时不产生垃圾条目", () => {
    const out = normalizeTemplateDocs([
      { name: "", content: "x" },
      { name: "a.md", content: null },
      { name: "b.md" },
    ]);
    expect(out).toEqual([]);
  });

  it("空数组返回空数组", () => {
    expect(normalizeTemplateDocs([])).toEqual([]);
  });
});
