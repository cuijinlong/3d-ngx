#!/usr/bin/env node
/*
 * 给现有场景模板补一份 `style-pack.json`（2026-11-24）。
 *
 * <h2>为什么需要这个脚本</h2>
 *
 * <p>客户提出：「风格套装看看有没有相关的文件方式…要不怎么实现 AI 编程」。
 *
 * <p>实测两个模板的 `additionalInfo.styleFiles` 都是空的，文件管理器里
 * 只有 `model.glb`（只读）—— 没有任何可编辑文件，AI 也就无从下手。
 * 套装定义（label / description / render 规则）此前是 Java 硬编码，
 * 改不了、也看不见。
 *
 * <p>这个脚本把「模板当前用的套装」落成一个真实文件：
 * `style-pack.json`。之后：
 *   · 文件管理器里能看到并编辑它；
 *   · 保存时后端同步进 `additionalInfo.stylePackConfig`；
 *   · `GET /energy/topology-style-packs` 用模板里的配置覆盖官方默认。
 *
 * <p>**幂等**：已有该文件的模板跳过，不覆盖用户改过的内容。
 *
 * 用法：
 *   node scripts/seed-style-pack-file.mjs            # 预览
 *   node scripts/seed-style-pack-file.mjs --apply    # 写入
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.NGX_API_BASE || "http://127.0.0.1:8090";
const TOKEN =
  process.env.TB_TOKEN ||
  (process.env.TB_TOKEN_FILE ? readFileSync(process.env.TB_TOKEN_FILE, "utf8").trim() : "") ||
  readFileSync("/tmp/tb-token", "utf8").trim();

const APPLY = process.argv.includes("--apply");
const STYLE_PACK_FILE = "style-pack.json";
const REQUIREMENTS_FILE = "requirements.md";
const SKILL_FILE = "SKILL.md";
const SCHEMA_FILE = "schema.json";
/** 与 apps/web/src/features/scene-editor/requirements-skeleton.ts 里的常量同值。 */
const REQUIREMENTS_SKELETON_PATH = "apps/web/src/features/scene-editor/templates/requirements-skeleton.md";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** 仓库里现成的契约文件。优先用它们，避免脚本里再抄一份（必然走样）。 */
const REPO_SKILL = join(REPO_ROOT, ".agents/skills/twin-from-template-package/SKILL.md");
const REPO_SCHEMA = join(REPO_ROOT, "template01/schema/binding.schema.json");

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "X-Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * 从官方套装清单里取某个 stylePack 的完整定义。
 *
 * <p>不硬编码内容：官方清单是唯一权威，抄一份到脚本里必然与它走样。
 */
async function officialPack(stylePack) {
  const catalog = await api("GET", "/api/energy/topology-style-packs");
  const packs = catalog?.packs ?? [];
  const packId = String(stylePack ?? "").split("@")[0]?.trim();
  return packs.find((item) => item?.packId === packId) ?? null;
}

/**
 * 需求骨架：**直接读前端那份 md**，不在这里再抄一遍（2026-11-24）。
 *
 * <p>抄一份的后果很具体：前端（发布为模板）改了骨架、脚本没跟上，
 * 于是「新建的模板」有 8 节资料表，「补出来的老模板」还是旧的 4 行 ——
 * 用户会以为两者不一样是 bug。
 *
 * <p>用 fs 读而不是 import：这是 node 脚本，没有 TS 运行时；
 * 而 .md 是纯文本，两边都能读。
 */
function requirementsSkeleton(name) {
  const path = join(REPO_ROOT, REQUIREMENTS_SKELETON_PATH);
  if (!existsSync(path)) {
    console.log(`  ! 找不到骨架文件 ${REQUIREMENTS_SKELETON_PATH}，跳过 requirements.md`);
    return null;
  }
  const safe = String(name ?? "").trim() || "未命名场景";
  return readFileSync(path, "utf8").replaceAll("{{name}}", safe);
}

/**
 * 补齐「约定文件」。
 *
 * <p>客户要求「放在资产中，可以跨电脑共享」—— 所以这些文件必须真的
 * 存在于模板资产里，而不是只在某台开发机的仓库里。
 *
 * <p>幂等：已有就跳过。**不覆盖** —— 用户改过的 requirements.md
 * 是他们的资产，脚本没有资格刷新它。
 */
async function seedDocs(template, existingNames) {
  const plan = [];
  if (!existingNames.has(REQUIREMENTS_FILE)) {
    const content = requirementsSkeleton(template.name ?? template.id);
    if (content) plan.push({ name: REQUIREMENTS_FILE, content });
  }
  if (!existingNames.has(SKILL_FILE) && existsSync(REPO_SKILL)) {
    plan.push({ name: SKILL_FILE, content: readFileSync(REPO_SKILL, "utf8") });
  }
  if (!existingNames.has(SCHEMA_FILE) && existsSync(REPO_SCHEMA)) {
    plan.push({ name: SCHEMA_FILE, content: readFileSync(REPO_SCHEMA, "utf8") });
  }
  return plan;
}

async function main() {
  if (!TOKEN) throw new Error("没有平台令牌：设 TB_TOKEN 或确认 /tmp/tb-token");
  console.log(APPLY ? "写入模式" : "预览模式（加 --apply 才写）");

  const list = await api("GET", "/api/energy/scene-templates?page=0&pageSize=100");
  const rows = list?.data ?? list?.templates ?? [];
  if (!rows.length) {
    console.log("没有场景模板，无需处理");
    return;
  }

  let changed = 0;
  for (const template of rows) {
    const id = template.id ?? template.templateId;
    const name = template.name ?? template.label ?? id;
    const stylePack = template.stylePack;
    if (!stylePack) {
      console.log(`  ${name}：没有 stylePack，跳过`);
      continue;
    }
    let files = [];
    try {
      const res = await api("GET", `/api/energy/scene-templates/${encodeURIComponent(id)}/files`);
      files = res?.files ?? [];
    } catch (error) {
      console.log(`  ${name}：读文件清单失败（${error.message}），跳过`);
      continue;
    }
    const existing = new Set(files.map((f) => f?.name).filter(Boolean));
    const writes = [];

    /* ① 风格套装文件 */
    if (!existing.has(STYLE_PACK_FILE)) {
      const pack = await officialPack(stylePack);
      if (!pack) {
        console.log(`  ${name}：官方清单里找不到 ${stylePack}，跳过套装文件`);
      } else {
        /* 只取「定义」字段，不带 source/templateId 这类运行时补的 */
        const config = {
          packId: pack.packId,
          packVersion: pack.packVersion ?? "1.0.0",
          stylePack: pack.stylePack ?? stylePack,
          label: pack.label ?? pack.packId,
          description: pack.description ?? "",
          suitability: pack.suitability ?? "",
          defaultBaseType: pack.defaultBaseType ?? "auto",
          requireWeatherSite: Boolean(pack.requireWeatherSite),
          render: pack.render ?? {},
        };
        writes.push({ name: STYLE_PACK_FILE, content: JSON.stringify(config, null, 2) });
      }
    }

    /* ② 需求 / 提示词 / 契约（AI 构建要读的就是这三份 + 上面那份） */
    writes.push(...(await seedDocs(template, existing)));

    if (!writes.length) {
      console.log(`  ${name}：约定文件已齐，跳过`);
      continue;
    }
    for (const item of writes) {
      console.log(`  ${name} → 写入 ${item.name}（${item.content.length} 字节）`);
    }
    changed += 1;
    if (APPLY) {
      for (const item of writes) {
        try {
          await api("POST", `/api/energy/scene-templates/${encodeURIComponent(id)}/files`, item);
        } catch (error) {
          console.log(`     ${item.name} 写入失败：${error.message}`);
        }
      }
    }
  }

  console.log(`\n合计 ${changed} 个模板${APPLY ? " 已写入" : " 待写入"}`);
  if (!APPLY && changed) console.log("确认无误后重跑并加 --apply");
}

main().catch((error) => {
  console.error("失败：", error.message);
  process.exit(1);
});
