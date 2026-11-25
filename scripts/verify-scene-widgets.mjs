#!/usr/bin/env node
/**
 * 校验大屏布局有没有丢掉模板的设计字段（2026-11-25）。
 *
 * <h2>为什么需要这个</h2>
 *
 * <p>实测事故：`scene-widgets` 里 4 张能耗卡的 `dataSource` / `energyMetric`
 * / `energyKind` 全部消失，卡片标题还在、位置也正常，但内容区一片空白
 * （写着「还没有绑定设备」）。原因是布局被某次操作整体重写过，只留下了
 * `id/type/x/y/w/h/title/slots`。
 *
 * <p>这类丢失**不报错**：渲染层拿到没有 `dataSource` 的卡就按遥测卡处理，
 * 而能耗卡的槽本来就没有 `deviceId`（数据由能耗接口按范围给），于是判定
 * 为「未绑定」。看起来像绑定坏了，实际是设计字段没了。
 *
 * <h2>判据</h2>
 *
 * <p>模板 `tianjiao-heat-pump.json` 的 `regions[].settings` 是设计稿：
 * `dataSource` / `energyMetric` / `energyKind` / `filterText`。
 * 布局里同一 `id` 的部件必须带着这些字段（值相同），否则就是被抹掉了。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/verify-scene-widgets.mjs          # 只看差异
 * ```
 *
 * 退出码：0 = 一致；1 = 有字段丢失（说明布局被重写过）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

const BASE = process.env.GUARD_BASE || "http://127.0.0.1:8090";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const TOPOLOGY = process.env.SCENE_TOPOLOGY_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const TEMPLATE = process.env.TEMPLATE_FILE
  || resolve(ROOT, "packages/data-adapter/src/screen-templates/tianjiao-heat-pump.json");

/** 必须与设计稿一致的设计字段（少一个就渲染成另一种卡）。 */
const DESIGN_KEYS = ["dataSource", "energyMetric", "energyKind", "filterText"];

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  const data = await res.json();
  if (!data.token) throw new Error("登录响应没有 token");
  return data.token;
}

async function main() {
  const token = await login();
  const url = `${BASE}/api/energy/topologies/${encodeURIComponent(TOPOLOGY)}/scene-widgets`;
  const res = await fetch(url, { headers: { "X-Authorization": `Bearer ${token}` } });
  if (!res.ok) throw new Error(`读取布局失败 ${res.status}`);
  const layout = await res.json();
  const widgets = new Map((layout.widgets || []).map((w) => [w.id, w]));

  const template = JSON.parse(readFileSync(TEMPLATE, "utf8"));
  const regions = template.regions || [];

  const problems = [];
  for (const region of regions) {
    const design = region.settings || {};
    const expected = {};
    for (const key of DESIGN_KEYS) {
      if (design[key] != null) expected[key] = design[key];
    }
    if (!Object.keys(expected).length) continue;

    const widget = widgets.get(region.id);
    if (!widget) {
      problems.push(`${region.id}: 布局里没有这块卡（模板有）`);
      continue;
    }
    for (const [key, value] of Object.entries(expected)) {
      const actual = widget[key];
      if (actual === undefined) {
        problems.push(`${region.id}.${key}: 丢失（模板要求 "${value}"）→ 会渲染成另一种卡，内容区空白`);
      } else if (actual !== value) {
        problems.push(`${region.id}.${key}: 是 "${actual}"，模板是 "${value}"`);
      }
    }
  }

  /* 能耗卡必须有范围或聚合，否则「按范围取数」无从谈起。 */
  for (const region of regions) {
    const widget = widgets.get(region.id);
    if (!widget || widget.dataSource !== "energy") continue;
    const hasScope = Boolean(widget.scope);
    if (!hasScope) problems.push(`${region.id}: 是能耗卡但没有 scope（取数范围）`);
  }

  if (!problems.length) {
    console.log(`✓ 布局与模板设计一致（${widgets.size} 块卡，检查 ${regions.length} 个 region）`);
    return 0;
  }
  console.log(`✗ 发现 ${problems.length} 处设计字段不一致：\n`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log("\n修法：按模板把这个部件的 settings 字段补回 scene-widgets（不要只改标题/位置）。");
  return 1;
}

process.exitCode = await main();
