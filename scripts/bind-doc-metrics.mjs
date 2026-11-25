#!/usr/bin/env node
/*
 * 按设备文档补齐天骄模块机的测点绑定（2026-11-24 客户要求）。
 *
 * 背景：设备文档（model.glb 的 `hmi.devices[].data`）里 9 台模块机都是
 * 「温度 / 功率 / 开度 / 运行状态」，设备也在上报 `temperature` / `power`。
 * 但平台的测点字典（measurePoints）和场景绑定（sceneBindings）里都没有这两条，
 * 于是 3D 铭牌只能显示「暂无数据」。
 *
 * 这个脚本补两处：设备测点字典 + 场景绑定遥测映射。
 * 幂等：已经有了就跳过；不会删除或改写任何既有条目。
 *
 * 用法：
 *   node scripts/bind-doc-metrics.mjs            # 预览（不写）
 *   node scripts/bind-doc-metrics.mjs --apply    # 写入平台
 */
import { readFileSync } from "node:fs";

const API = process.env.NGX_API_BASE || "http://127.0.0.1:8090";
const TOKEN =
  process.env.TB_TOKEN ||
  (process.env.TB_TOKEN_FILE ? readFileSync(process.env.TB_TOKEN_FILE, "utf8").trim() : "") ||
  readFileSync("/tmp/tb-token", "utf8").trim();

const SCENE_ID = "dfbc1da0-e66c-11f1-9554-01523035eefa";
const APPLY = process.argv.includes("--apply");

/** 模块机节点 → 设备 id。只处理设备文档里确实有「温度/功率」的那 9 台。 */
const MODULES = [
  ["1", "4402d2c7-e50c-11f1-9407-71dd197ec25f"],
  ["2", "4402d2d8-e50c-11f1-9407-71dd197ec25f"],
  ["3", "4402d2e9-e50c-11f1-9407-71dd197ec25f"],
  ["4", "4402d2fa-e50c-11f1-9407-71dd197ec25f"],
  ["5", "4402d30b-e50c-11f1-9407-71dd197ec25f"],
  ["6", "4402d31c-e50c-11f1-9407-71dd197ec25f"],
  ["7", "442575f0-e50c-11f1-9407-71dd197ec25f"],
  ["8", "44642ca0-e50c-11f1-9407-71dd197ec25f"],
  ["9", "449b9050-e50c-11f1-9407-71dd197ec25f"],
];

/**
 * 要补的指标。`label` 必须与设备文档里的 `data[].name` **逐字相同** ——
 * 铭牌是拿文档名去精确匹配绑定映射的（精确优先，见 device-plates.ts）。
 */
const METRICS = [
  {
    key: "temperature",
    label: "温度",
    unit: "℃",
    measurePoint: { deviceField: "temperature", standardField: "temperature", standardName: "温度", unit: "℃", ratio: "" },
  },
  {
    key: "power",
    label: "功率",
    unit: "kW",
    measurePoint: { deviceField: "power", standardField: "power", standardName: "功率", unit: "kW", ratio: "" },
  },
];

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

async function ensureMeasurePoints() {
  let changed = 0;
  for (const [tag, deviceId] of MODULES) {
    const rows = await api("GET", `/api/plugins/telemetry/DEVICE/${deviceId}/values/attributes/SERVER_SCOPE`);
    const points = readValue(rows, "measurePoints");
    if (!Array.isArray(points)) {
      console.log(`  模块机 ${tag}#：没有 measurePoints，跳过（不凭空造点表）`);
      continue;
    }
    const missing = METRICS.filter((m) => !points.some((p) => p?.deviceField === m.key));
    if (missing.length === 0) {
      console.log(`  模块机 ${tag}#：测点字典已齐，跳过`);
      continue;
    }
    const next = [...points, ...missing.map((m) => ({ ...m.measurePoint }))];
    console.log(
      `  模块机 ${tag}#：measurePoints ${points.length} → ${next.length} 条（+${missing.map((m) => m.label).join("、")}）`,
    );
    changed += 1;
    if (APPLY) {
      await api("POST", `/api/plugins/telemetry/DEVICE/${deviceId}/attributes/SERVER_SCOPE`, { measurePoints: next });
    }
  }
  return changed;
}

async function ensureSceneBinding() {
  const rows = await api("GET", `/api/plugins/telemetry/ASSET/${SCENE_ID}/values/attributes/SERVER_SCOPE`);
  const doc = readValue(rows, "sceneBindings");
  if (!doc?.bindings) throw new Error("场景 sceneBindings 读不到，已中止");
  const byNode = new Set(MODULES.map(([node]) => node));
  let changed = 0;
  for (const binding of doc.bindings) {
    if (!byNode.has(binding.sceneEntityId)) continue;
    if (!Array.isArray(binding.telemetryMappings)) binding.telemetryMappings = [];
    const list = binding.telemetryMappings;
    const missing = METRICS.filter((m) => !list.some((item) => item?.telemetryKey === m.key));
    if (missing.length === 0) {
      console.log(`  绑定 ${binding.sceneEntityId}：已有 ${METRICS.map((m) => m.label).join("/")}，跳过`);
      continue;
    }
    /*
     * 插在「运行」「开度」之后，状态类之前 —— 与设备文档的阅读顺序一致
     * （温度 / 功率 / 开度 / 运行状态）。铭牌按文档顺序取行，
     * 绑定顺序只影响绑定面板的观感，但两者对齐后排查时不容易看岔。
     */
    let at = list.findIndex((item) => item?.telemetryKey === "opening");
    at = at >= 0 ? at + 1 : list.length;
    list.splice(
      at,
      0,
      ...missing.map((m) => ({
        field: m.key,
        telemetryKey: m.key,
        label: m.label,
        unit: m.unit,
        displayType: "number",
      })),
    );
    console.log(`  绑定 ${binding.sceneEntityId}：telemetryMappings → ${list.length} 条（+${missing.map((m) => m.label).join("、")}）`);
    changed += 1;
  }
  if (APPLY && changed > 0) {
    await api("POST", `/api/plugins/telemetry/ASSET/${SCENE_ID}/attributes/SERVER_SCOPE`, { sceneBindings: doc });
  }
  return changed;
}

async function main() {
  if (!TOKEN) throw new Error("没有平台令牌：设 TB_TOKEN 或确认 /tmp/tb-token");
  console.log(APPLY ? "写入模式" : "预览模式（加 --apply 才写）");
  console.log("① 设备测点字典：");
  const a = await ensureMeasurePoints();
  console.log("② 场景绑定：");
  const b = await ensureSceneBinding();
  console.log(`\n合计：测点字典 ${a} 台、场景绑定 ${b} 条${APPLY ? " 已写入" : " 待写入"}`);
  if (!APPLY && (a || b)) console.log("确认无误后重跑并加 --apply");
}

main().catch((error) => {
  console.error("失败：", error.message);
  process.exit(1);
});
