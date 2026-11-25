#!/usr/bin/env node
/**
 * 直连 ts_kv 补 power/temperature 演示数据 —— **仅用于平台写入队列积压时的应急**。
 *
 * <h2>为什么不走平台接口</h2>
 *
 * <p>2026-11-26 实测：`energy-server` 的遥测写入队列 `Queue-0 [TS]` 积压
 * **252 万条**（20:13 起，写入 1675/s vs 消费 1000/s）。落在该分片的设备
 * （`模块机-3#/5#/6#/8#`）通过 `/api/v1/{token}/telemetry` 写入时
 * **返回 200 但一行都不落库**，而 `模块机-1#/2#/4#/7#/9#` 正常。
 *
 * <p>已验证：直接 `INSERT INTO ts_kv` 成功 → 是平台层丢弃，不是库层拒绝。
 *
 * <p>**这是演示数据的应急补写，不是常规做法。** 正常情况请用
 * `simulate-unit-power.mjs`（走平台接口）。队列积压本身是独立问题，
 * 需要运维单独排查，本脚本不修它。
 *
 * <h2>写什么</h2>
 *
 * <p>只写两张表的 power / temperature：
 * <ul>
 *   <li>`ts_kv`（历史，主键 entity_id+key+ts）</li>
 *   <li>`ts_kv_latest`（最新值，主键 entity_id+key）—— 漏了它卡片仍显示旧值</li>
 * </ul>
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/direct-seed-unit-power.mjs --units 3,5,6,8 --dry-run
 * node scripts/direct-seed-unit-power.mjs --units 3,5,6,8
 * node scripts/direct-seed-unit-power.mjs --units 3,5,6,8 --purge
 * ```
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = process.env.GUARD_BASE || "http://127.0.0.1:8090";
const PG = process.env.PG_CONTAINER || "energy-postgres";
const DRY = process.argv.includes("--dry-run");
const PURGE = process.argv.includes("--purge");
const HOURS = Number(process.env.HOURS || 24);
const BUCKET_MIN = 5;
const KEYS = ["power", "temperature"];

const UNITS = (readFlag("--units") || "3,5,6,8").split(",").map((s) => s.trim()).filter(Boolean);

function readFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function psql(sql, { stdin } = {}) {
  const args = ["exec", "-i", PG, "psql", "-U", "postgres", "-d", "thingsboard"];
  /*
   * 大段 SQL 走 stdin，不用 -f：
   * 宿主机写的 /tmp 文件容器里看不到（不同文件系统），
   * `psql -f /tmp/x.sql` 会报 No such file or directory。
   */
  if (stdin != null) {
    args.push("-v", "ON_ERROR_STOP=1");
    return execFileSync("docker", args, { encoding: "utf8", input: stdin }).trim();
  }
  args.push("-tAc", sql);
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: process.env.TB_USER || "tenant@126.com",
      password: process.env.TB_PASS || "12345678",
    }),
  });
  if (!res.ok) throw new Error(`登录失败 ${res.status}`);
  return (await res.json()).token;
}

function readBase(deviceId, key) {
  const raw = psql(
    `SELECT coalesce(k.dbl_v, k.long_v::double precision) FROM ts_kv k
       JOIN key_dictionary kd ON kd.key_id = k.key
      WHERE kd.key = '${key}' AND k.entity_id = '${deviceId}'
        AND k.ts < (extract(epoch from date_trunc('day', now()))*1000)::bigint
        AND (k.dbl_v IS NOT NULL OR k.long_v IS NOT NULL)
      ORDER BY k.ts DESC LIMIT 1;`,
  );
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const token = await login();
  const devices = (await fetch(`${BASE}/api/tenant/devices?pageSize=100&page=0`, {
    headers: { "X-Authorization": `Bearer ${token}` },
  }).then((r) => r.json())).data;

  const bucketMs = BUCKET_MIN * 60_000;
  const nowBucket = Math.floor(Date.now() / bucketMs) * bucketMs;
  const fromTs = nowBucket - HOURS * 3600_000;
  const buckets = [];
  for (let ts = fromTs; ts <= nowBucket; ts += bucketMs) buckets.push(ts);

  const targets = [];
  for (const unit of UNITS) {
    const dev = devices.find((d) => new RegExp(`模块机-${unit}#`).test(d.name));
    if (!dev) { console.log(`  ✗ 找不到模块机-${unit}#`); continue; }
    targets.push({ id: dev.id.id, name: dev.name });
  }

  if (PURGE) {
    const ids = targets.map((t) => `'${t.id}'`).join(",");
    const keys = KEYS.map((k) => `'${k}'`).join(",");
    const sql = `
      DELETE FROM ts_kv k USING key_dictionary kd
       WHERE kd.key_id = k.key AND kd.key IN (${keys})
         AND k.entity_id IN (${ids}) AND k.ts BETWEEN ${fromTs} AND ${nowBucket + 3600_000};
      DELETE FROM ts_kv_latest t USING key_dictionary kd
       WHERE kd.key_id = t.key AND kd.key IN (${keys})
         AND t.entity_id IN (${ids});`;
    if (DRY) { console.log("预演：将删除\n" + sql); return; }
    psql(sql);
    console.log(`已撤销 ${targets.length} 台的 ${KEYS.join("/")}`);
    return;
  }

  const WAVE = { power: 0.12, temperature: 0.05 };
  const JITTER = { power: 0.06, temperature: 0.01 };

  const lines = ["BEGIN;"];
  const summary = [];
  for (const t of targets) {
    const bases = {};
    for (const key of KEYS) {
      bases[key] = readBase(t.id, key);
      if (bases[key] == null) throw new Error(`${t.name} 没有 ${key} 基准值`);
    }
    const rnd = seeded(seedOf(t.id));
    const rows = [];
    for (let i = 0; i < buckets.length; i += 1) {
      const ts = buckets[i];
      const at = new Date(ts);
      const hourOfDay = at.getHours() + at.getMinutes() / 60;
      const daily = Math.sin(((hourOfDay - 10) / 24) * Math.PI * 2);
      for (const key of KEYS) {
        const noise = (rnd() - 0.5) * JITTER[key] * 2;
        const value = i === buckets.length - 1
          ? bases[key]
          : Number((bases[key] * (1 + daily * WAVE[key] + noise)).toFixed(2));
        rows.push({ key, ts, value });
      }
    }
    const keyId = (k) => Number(psql(`SELECT key_id FROM key_dictionary WHERE key='${k}';`));
    const kid = { power: keyId("power"), temperature: keyId("temperature") };

    const values = rows.map((r) => `('${t.id}'::uuid, ${kid[r.key]}, ${r.ts}, ${r.value})`).join(",\n");
    lines.push(`INSERT INTO ts_kv (entity_id, key, ts, dbl_v) VALUES\n${values}\n`
      + "ON CONFLICT (entity_id, key, ts) DO UPDATE SET dbl_v = EXCLUDED.dbl_v;");

    const lastOf = {};
    for (const r of rows) lastOf[r.key] = r;
    const latestValues = KEYS.map((k) => `('${t.id}'::uuid, ${kid[k]}, ${lastOf[k].ts}, ${lastOf[k].value})`).join(",");
    lines.push(`INSERT INTO ts_kv_latest (entity_id, key, ts, dbl_v) VALUES ${latestValues}\n`
      + "ON CONFLICT (entity_id, key) DO UPDATE SET ts = EXCLUDED.ts, dbl_v = EXCLUDED.dbl_v;");

    const pv = rows.filter((r) => r.key === "power").map((r) => r.value);
    summary.push(`  ${t.name}  ${buckets.length} 桶 × ${KEYS.length} 键  power ${Math.min(...pv)}~${Math.max(...pv)} kW`
      + `  temp 基准 ${bases.temperature}`);
  }
  lines.push("COMMIT;");

  if (DRY) {
    console.log(`预演：${targets.length} 台 × ${buckets.length} 桶`);
    for (const s of summary) console.log(s);
    console.log(`\nSQL 行数：${lines.length}`);
    return;
  }

  const script = lines.join("\n") + "\n";
  writeFileSync("/tmp/direct-seed-unit-power.sql", script); /* 留一份便于人工核对 */
  psql(null, { stdin: script });

  /* 回读：只信库里的行数 */
  for (const t of targets) {
    const keys = KEYS.map((k) => `'${k}'`).join(",");
    const n = Number(psql(
      `SELECT count(*) FROM ts_kv k JOIN key_dictionary kd ON kd.key_id = k.key
        WHERE k.entity_id='${t.id}' AND kd.key IN (${keys}) AND k.ts >= ${fromTs};`,
    ));
    const expect = buckets.length * KEYS.length;
    console.log(`  ${n >= expect ? "✓" : "✗"} ${t.name}  ${n}/${expect} 点已落库`);
    if (n < expect) process.exitCode = 1;
  }
}

main().catch((e) => { console.error("失败：", e.message); process.exitCode = 1; });
