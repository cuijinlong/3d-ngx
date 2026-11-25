#!/usr/bin/env node
/**
 * 给场站 / 组织写「行政区划」地址，供大屏顶栏天气使用（2026-11-24）。
 *
 * <h2>为什么需要这个脚本</h2>
 *
 * 天气要真实数据，就必须知道场站在哪个城市。而库里的场站资产
 * （生产园区 / 办公园区 / 质量示范站）和组织（总部·平台演示中心）
 * **都没有地址属性** —— 建库时没这个字段，也没有任何界面能填。
 *
 * <p>客户的原话是「用场站或组织的行政区划」。所以这个脚本把地址
 * 写进 `<场站资产>.address`，没填的场站回落 `<客户>.address`。
 *
 * <h2>为什么写 SHARED_SCOPE 而不是 SERVER_SCOPE</h2>
 *
 * 大屏可能是**客户角色**（CUSTOMER_USER）打开的，而 TB 的 SERVER_SCOPE
 * 属性对客户角色默认不可读。写 SERVER_SCOPE 的结果是：租户账号能看到天气、
 * 客户账号看不到 —— 这种「一半人能用」的问题最难查。
 *
 * <p>地址不是敏感数据（就是城市名），放 SHARED_SCOPE 让客户端可见是合适的。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * # 看当前配置
 * node scripts/set-scope-address.mjs --list
 *
 * # 给某个场站设地址（名字或 id 都行）
 * node scripts/set-scope-address.mjs --site 生产园区 --address "南京市江宁区"
 *
 * # 给组织设地址（全场站共用的回落值）
 * node scripts/set-scope-address.mjs --org --address "南京市江宁区"
 *
 * # 清掉某个场站的地址（回落组织）
 * node scripts/set-scope-address.mjs --site 生产园区 --clear
 * ```
 *
 * <p>幂等：先读当前值，相同就跳过，不产生多余的审计记录。
 */
import { readFileSync } from "node:fs";

const BASE = process.env.TB_URL || "http://127.0.0.1:8090";
const SCOPE = "SHARED_SCOPE";

function token() {
  const env = process.env.TB_TOKEN;
  if (env) return env.trim();
  try {
    return readFileSync("/tmp/tb-token", "utf8").trim();
  } catch {
    console.error("✗ 找不到令牌：设置 TB_TOKEN 或把令牌写进 /tmp/tb-token");
    process.exit(1);
  }
}

const TOKEN = token();

async function api(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "X-Authorization": `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${path} → HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function parseArgs(argv) {
  const args = { sites: [], org: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--site") args.sites.push(next());
    else if (a === "--org") args.org = true;
    else if (a === "--address") args.address = next();
    else if (a === "--clear") args.clear = true;
    else if (a === "--list") args.list = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return args;
}

const HELP = `
给场站 / 组织写行政区划（大屏天气用）

  node scripts/set-scope-address.mjs --list
  node scripts/set-scope-address.mjs --site <场站名或id> --address "南京市江宁区"
  node scripts/set-scope-address.mjs --org --address "南京市江宁区"
  node scripts/set-scope-address.mjs --site <场站名或id> --clear

环境变量：TB_URL（默认 http://127.0.0.1:8090）、TB_TOKEN（默认读 /tmp/tb-token）
`;

async function readAddress(entityType, id) {
  const rows = await api("GET", `/api/plugins/telemetry/${entityType}/${id}/values/attributes?key=address`);
  const row = Array.isArray(rows) ? rows.find((r) => r?.key === "address") : null;
  return typeof row?.value === "string" ? row.value : "";
}

async function writeAddress(entityType, id, value) {
  await api("POST", `/api/plugins/telemetry/${entityType}/${id}/attributes/${SCOPE}`, { address: value });
}

async function resolveSites(wanted) {
  const page = await api("GET", "/api/tenant/assets?pageSize=500&page=0");
  const sites = (page?.data ?? []).filter((a) => a?.type === "场站");
  const resolved = [];
  for (const key of wanted) {
    const hit =
      sites.find((s) => s.id.id === key) ||
      sites.find((s) => s.name === key) ||
      sites.find((s) => s.label === key) ||
      sites.find((s) => (s.name ?? "").includes(key));
    if (!hit) {
      console.error(`✗ 找不到场站「${key}」。可选：${sites.map((s) => s.name).join(" / ")}`);
      process.exitCode = 1;
      continue;
    }
    resolved.push({ id: hit.id.id, label: `${hit.name}（${hit.label ?? ""}）` });
  }
  return resolved;
}

async function resolveCustomer() {
  const page = await api("GET", "/api/customers?pageSize=100&page=0");
  const customers = page?.data ?? [];
  if (customers.length === 0) throw new Error("租户下没有客户");
  /*
   * 只有一个客户时直接用；多个时取名字含「演示」的那个 —— 这套环境
   * 的组织就是「平台演示中心」。真要给别的客户设，用 --customer 指定（见下）。
   */
  const demo = customers.find((c) => String(c.title ?? "").includes("演示")) ?? customers[0];
  return { id: demo.id.id, title: demo.title };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.list) {
    const page = await api("GET", "/api/tenant/assets?pageSize=500&page=0");
    const sites = (page?.data ?? []).filter((a) => a?.type === "场站");
    console.log("场站地址（SHARED_SCOPE.address）：");
    for (const site of sites) {
      const value = await readAddress("ASSET", site.id.id);
      console.log(`  ${value ? "✓" : "·"} ${site.name}  ${value || "（未配置，回落组织）"}`);
    }
    const customer = await resolveCustomer();
    const orgValue = await readAddress("CUSTOMER", customer.id);
    console.log(`\n组织地址（${customer.title}）：${orgValue || "（未配置）"}`);
    return;
  }

  if (!args.clear && !args.address) {
    console.error("✗ 需要 --address \"行政区划\" 或 --clear");
    process.exit(1);
  }
  const value = args.clear ? "" : args.address.trim();
  if (!args.clear && !value) {
    console.error("✗ 地址不能为空");
    process.exit(1);
  }

  let changed = 0;
  if (args.org) {
    const customer = await resolveCustomer();
    const current = await readAddress("CUSTOMER", customer.id);
    if (current === value) {
      console.log(`· 组织「${customer.title}」地址已是「${value}」，跳过`);
    } else {
      await writeAddress("CUSTOMER", customer.id, value);
      console.log(`✓ 组织「${customer.title}」地址：${current || "（空）"} → ${value || "（清空）"}`);
      changed += 1;
    }
  }

  if (args.sites.length) {
    const sites = await resolveSites(args.sites);
    for (const site of sites) {
      const current = await readAddress("ASSET", site.id);
      if (current === value) {
        console.log(`· 场站「${site.label}」地址已是「${value}」，跳过`);
        continue;
      }
      await writeAddress("ASSET", site.id, value);
      console.log(`✓ 场站「${site.label}」地址：${current || "（空）"} → ${value || "（清空）"}`);
      changed += 1;
    }
  }

  console.log(`\n完成：${changed} 项变更。大屏刷新即生效（前端直连气象源，无需重启服务）。`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
