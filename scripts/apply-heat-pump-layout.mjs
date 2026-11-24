#!/usr/bin/env node
/**
 * 天骄冷热站大屏 · 右翼改版：删「选中机组 / 系统控制」，底部两块上移到右翼。
 *
 * <h2>为什么要有脚本（而不是手改库）</h2>
 *
 * <p>大屏布局的真相源是**平台上的 `scene-widgets`**（`GET /api/energy/topologies/{id}/scene-widgets`），
 * 不是仓库里的模板 JSON —— 模板只在「新建场景」和「应用对接结果」时用一次。
 * 手改库的问题和 AGENTS.md A2d 记载的一样：改完没人记得它和模板已经不一致，
 * 下次谁重跑一次模板应用就回去了，而且不报错。
 *
 * <p>所以这个脚本做两件事，且**幂等**：
 * <ol>
 *   <li>删掉指定部件（选中机组 / 系统控制）；</li>
 *   <li>把底部两块按目标几何挪到右翼，与「运行汇总」纵向等分。</li>
 * </ol>
 *
 * <h2>不动的东西</h2>
 *
 * <p>只改 `x/y/w/h` 与 `widgets` 数组本身。标题、绑定槽位、数据源、样式一律原样保留 ——
 * 那些是平台上配好的施工信息，不是本脚本的职责。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/apply-heat-pump-layout.mjs --check   # 只看会改什么（默认）
 * node scripts/apply-heat-pump-layout.mjs --apply   # 写库
 * ```
 *
 * 退出码：0 一致或已应用；1 有差异（--check 时）。
 */

import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.GUARD_BASE || "http://127.0.0.1:8090";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const TOPOLOGY = process.env.SCENE_TOPOLOGY_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";

const APPLY = process.argv.includes("--apply");

/** 要删掉的部件：客户明确要求去掉「选中机组」和「系统控制」。 */
const REMOVE = ["selected-unit", "control-bar", "unit-summary"];

/** 要新增的部件（客户要求新增告警跑马灯）。几何在 `GEOMETRY` 里。 */
const ADD = [
  {
    id: "alarm-ticker",
    type: "alarm-ticker",
    title: "告警",
    subtitle: "ALARMS",
  },
];

/**
 * 目标几何（2026-11-23 第二轮改版）。
 *
 * <h2>客户要求</h2>
 *
 * <ol>
 *   <li>右侧第2（场站用电趋势）→ 左翼第2；</li>
 *   <li>右侧第3（设备用电排名）→ 左翼第3；</li>
 *   <li>原左侧第2（碳排放核算）/ 第3（机组状态）→ 右翼；</li>
 *   <li>「各个部件再大一点」。</li>
 * </ol>
 *
 * <p>结果：左翼 = 用电量 / 趋势 / 排名，右翼 = 运行汇总 / 碳排放 / 机组状态。
 *
 * <h2>为什么主要靠高度放大，而不是继续加宽</h2>
 *
 * <p>上一轮把底部两块上移后，**底部整条 153px 的空间空出来了**。
 * 这部分是白送的 —— 加高卡片不侵占 3D 宽度，而加宽会。
 *
 * <p>2026-11-23 第三轮（客户：「宽高再增加30px都可以」「告警的高度尽量高一些」）：
 * 宽度 17% → **18.6%**（326 → 357px），高度按内容量重新分配。
 *
 * <table>
 *   <tr><th>卡</th><th>改前高</th><th>改后高</th><th>理由</th></tr>
 *   <tr><td>设备用电排名</td><td>310px</td><td><b>352px</b></td><td>逐台条形图，最挤</td></tr>
 *   <tr><td>机组状态</td><td>289px</td><td><b>313px</b></td><td>9 行 × 3 列</td></tr>
 *   <tr><td>告警跑马灯</td><td>191px</td><td><b>341px</b></td><td>客户要求「尽量高」，要点开详情</td></tr>
 *   <tr><td>碳排放核算</td><td>206px</td><td>194px</td><td>只有 3 个大数字，可让位</td></tr>
 * </table>
 *
 * <p>中央 3D 从 61.2% → **58%**。仍过半边，是「卡片放大」的必然代价；
 * 两边底部对齐在 93%，视觉上不会一高一低。
 */
/**
 * 要同步的标题（2026-11-23）。
 *
 * <p>为什么要放进这个脚本：布局改了几何、但标题还是旧的，就会出现
 * 「卡里面在用能分项、标题写着设备用电排名」—— 比没改更让人困惑。
 *
 * <p>几何和标题是同一件事（这块卡是干什么的），必须一起改、一起验。
 */
const TITLES = {
  "load-compare": { title: "用能分项占比", subtitle: "ENERGY BREAKDOWN" },
};

const GEOMETRY = {
  /* 左翼：用电量 / 趋势 / 排名（排名逐台列表，给最高） */
  "system-power": { x: 2.4, y: 12.6, w: 18.6, h: 22 },
  "power-trend": { x: 2.4, y: 35.5, w: 18.6, h: 24 },
  "load-compare": { x: 2.4, y: 60.4, w: 18.6, h: 32.6 },
  /* 右翼：碳排放 / 机组状态 / 告警跑马灯 */
  "plant-capacity": { x: 79.0, y: 12.6, w: 18.6, h: 18 },
  "unit-list": { x: 79.0, y: 31.5, w: 18.6, h: 29 },
  "alarm-ticker": { x: 79.0, y: 61.4, w: 18.6, h: 31.6 },
};

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
  const auth = { "X-Authorization": `Bearer ${token}` };
  const url = `${BASE}/api/energy/topologies/${encodeURIComponent(TOPOLOGY)}/scene-widgets`;

  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`读取布局失败 ${res.status}`);
  const document = await res.json();
  const widgets = Array.isArray(document.widgets) ? document.widgets : [];
  console.log(`平台布局：${widgets.length} 块`);

  /* 备份一份原始 JSON —— 布局改错时能原样推回，不用重新配绑定。 */
  const backup = `/tmp/scene-widgets-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(document, null, 2));
  console.log(`已备份：${backup}`);

  const changes = [];
  const nextWidgets = [];

  for (const widget of widgets) {
    if (REMOVE.includes(widget.id)) {
      changes.push(`删除 ${widget.id}（${widget.title ?? widget.type}）`);
      continue;
    }
    const target = GEOMETRY[widget.id];
    if (!target) {
      nextWidgets.push(widget);
      continue;
    }
    const retitle = TITLES[widget.id];
    const titleChanged = Boolean(
      retitle && (widget.title !== retitle.title || widget.subtitle !== retitle.subtitle),
    );
    const moved =
      widget.x !== target.x || widget.y !== target.y
      || widget.w !== target.w || widget.h !== target.h;
    if (moved) {
      changes.push(
        `移动 ${widget.id}：(${widget.x}, ${widget.y}, ${widget.w}×${widget.h})`
        + ` → (${target.x}, ${target.y}, ${target.w}×${target.h})`,
      );
    }
    if (titleChanged && retitle) {
      changes.push(`改标题 ${widget.id}：「${widget.title ?? ""}」 → 「${retitle.title}」`);
    }
    nextWidgets.push({ ...widget, ...target, ...(retitle ?? {}) });
  }

  const expectedIds = Object.keys(GEOMETRY);
  /* 屏幕上应有、但布局里缺失的 id。先收集，再统一处理（ADD 里的会被新建）。 */
  const requiredMissing = [];
  for (const id of expectedIds) {
    if (!widgets.some((w) => w.id === id)) requiredMissing.push(id);
  }
  for (const item of ADD) {
    if (widgets.some((w) => w.id === item.id)) continue;
    changes.push(`新增 ${item.id}（${item.title}）`);
    nextWidgets.push({ ...item, ...GEOMETRY[item.id] });
  }
  for (const id of requiredMissing) {
    if (ADD.some((item) => item.id === id)) continue;
    console.log(`⚠ 平台布局里没有 ${id}，跳过（不在本次新建清单里）`);
  }

  if (!changes.length) {
    console.log("✓ 布局已经是目标状态，无需改动");
    return;
  }

  console.log("\n将执行：");
  for (const line of changes) console.log(`  · ${line}`);

  if (!APPLY) {
    console.log("\n（--check 模式，未写入。加 --apply 执行）");
    process.exitCode = 1;
    return;
  }

  const next = { ...document, widgets: nextWidgets };
  const put = await fetch(url, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new Error(`写入失败 ${put.status}：${text.slice(0, 300)}`);
  }
  console.log(`\n✓ 已写入，现有 ${nextWidgets.length} 块`);

  /* 回读校验：PUT 成功不等于库里就是新的（曾见过服务端忽略未知字段）。 */
  const verify = await (await fetch(url, { headers: auth })).json();
  const ids = (verify.widgets ?? []).map((w) => w.id);
  const leftovers = REMOVE.filter((id) => ids.includes(id));
  if (leftovers.length) throw new Error(`回读发现应删除的部件仍在：${leftovers.join(", ")}`);
  const mismatched = expectedIds.filter((id) => {
    const w = (verify.widgets ?? []).find((item) => item.id === id);
    const t = GEOMETRY[id];
    if (!w || w.x !== t.x || w.y !== t.y || w.w !== t.w || w.h !== t.h) return true;
    const want = TITLES[id];
    return Boolean(want && (w.title !== want.title || w.subtitle !== want.subtitle));
  });
  if (mismatched.length) throw new Error(`回读几何不一致：${mismatched.join(", ")}`);
  console.log(`✓ 回读校验通过（${ids.length} 块）：${ids.join(", ")}`);
}

await main();
