#!/usr/bin/env node
/*
 * 删除场景卡片里「绑不出数据」的槽位（2026-11-24 客户确认）。
 *
 * 背景：`system-power`（场站用电量）卡上有两个侧槽位
 *
 *   left  = 进水 water_in_temp  → 绑在 PLC 网关上
 *   right = 出水 water_out_temp → 同一台网关
 *
 * 实测：那台网关四个键（water_in_temp / water_out_temp / temperature / power）
 * **全是 null**。九台模块机里 `water_in_temp` 也全无数据，
 * 有数据的是 `temperature`（单一「温度」，没有进/出水之分）。
 *
 * 客户定调：「system-power 的问题接受你的建议删掉」。
 * 与 §34「铭牌数据行以设备文档为准」同源 —— 设备文档里模块机只有「温度」，
 * 所以大屏不该虚构出「进水 / 出水」两个口径。
 *
 * 删槽位不影响布局：`metric-card` 的渲染对缺失的 left/right 有 `<span />` 兜底。
 *
 * 用法：
 *   node scripts/prune-dead-slots.mjs            # 预览
 *   node scripts/prune-dead-slots.mjs --apply    # 写入
 */
import { readFileSync } from "node:fs";

const API = process.env.NGX_API_BASE || "http://127.0.0.1:8090";
const TOKEN =
  process.env.TB_TOKEN ||
  (process.env.TB_TOKEN_FILE ? readFileSync(process.env.TB_TOKEN_FILE, "utf8").trim() : "") ||
  readFileSync("/tmp/tb-token", "utf8").trim();

const SCENE_ID = process.env.SCENE_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const APPLY = process.argv.includes("--apply");

/**
 * 要删的槽位：按「卡片 id → 槽位 key」列，不用通配。
 *
 * <p>为什么不用「删掉所有读不到值的槽位」这种自动判据：
 * 那会在设备临时离线时把**有用**的槽位也删掉，而配置删了不会自己长回来。
 * 这里只删经过实测确认的两个。
 */
const PRUNE = {
  "system-power": ["left", "right"],
};

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

function readValue(rows, key) {
  const row = rows.find((item) => item.key === key);
  if (!row) return undefined;
  const value = row.value;
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function main() {
  if (!TOKEN) throw new Error("没有平台令牌：设 TB_TOKEN 或确认 /tmp/tb-token");
  console.log(APPLY ? "写入模式" : "预览模式（加 --apply 才写）");

  const rows = await api("GET", `/api/plugins/telemetry/ASSET/${SCENE_ID}/values/attributes/SERVER_SCOPE`);
  const layout = readValue(rows, "sceneWidgets");
  if (!layout?.widgets) throw new Error("sceneWidgets 读不到，已中止");

  let changed = 0;
  for (const widget of layout.widgets) {
    const keys = PRUNE[widget.id];
    if (!keys?.length) continue;
    const before = (widget.slots ?? []).map((s) => s.key);
    const dropped = (widget.slots ?? []).filter((s) => keys.includes(s.key));
    if (dropped.length === 0) {
      console.log(`  ${widget.id}：槽位已不含 ${keys.join("/")}，跳过`);
      continue;
    }
    widget.slots = (widget.slots ?? []).filter((s) => !keys.includes(s.key));
    console.log(
      `  ${widget.id}：slots [${before.join(", ")}] → [${widget.slots.map((s) => s.key).join(", ")}]` +
        `（删 ${dropped.map((s) => `${s.key}=${s.telemetryKey}`).join(", ")}）`,
    );
    changed += 1;
  }

  if (changed === 0) {
    console.log("\n无需改动");
    return;
  }
  if (APPLY) {
    await api("POST", `/api/plugins/telemetry/ASSET/${SCENE_ID}/attributes/SERVER_SCOPE`, { sceneWidgets: layout });
    console.log(`\n已写入 ${changed} 张卡片`);
  } else {
    console.log(`\n待写入 ${changed} 张卡片；确认后加 --apply`);
  }
}

main().catch((error) => {
  console.error("失败：", error.message);
  process.exit(1);
});
