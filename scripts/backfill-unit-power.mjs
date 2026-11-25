#!/usr/bin/env node
/**
 * 给指定几台机组补 power/temperature 演示数据（小批量，逐台串行）。
 *
 * <h2>为什么单独有这个脚本</h2>
 *
 * <p>`simulate-unit-power.mjs` 一次推 9 台 × 289 点 ≈ 5200 点。
 * 2026-11-26 实测：平台写入队列积压 250 万条时，**大批量会被静默丢弃**
 * （`/api/v1/{token}/telemetry` 返回 200，但 `ts_kv` 里没有行；
 * 日志是 `TbSqlBlockingQueue ... is falling behind`）。
 *
 * <p>本脚本只补「没写进去的那几台」，**一次一台、每台之间等 3 秒**，
 * 把瞬时压力降到最低。仍然走平台接口（不直连库）。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/backfill-unit-power.mjs --units 3,5,6,8 --dry-run
 * node scripts/backfill-unit-power.mjs --units 3,5,6,8
 * ```
 *
 * <p>写完会回读 `ts_kv` 确认行数，而不是信 HTTP 200 —— 这点是本脚本
 * 与 `simulate-unit-power.mjs` 的关键区别（那个只报「已发送」）。
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const BASE = process.env.GUARD_BASE || "http://127.0.0.1:8090";
const PG = process.env.PG_CONTAINER || "energy-postgres";
const UNITS = (readFlag("--units") || "3").split(",").map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry-run");
const HOURS = Number(process.env.HOURS || 24);
const BUCKET_MIN = 5;

/** 只补用户要看的两列（机组状态卡的「温度」「功率」）。 */
const KEYS = ["power", "temperature"];

function readFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const token = readFileSync(process.env.TB_TOKEN_FILE || "/tmp/tb_token.txt", "utf8").trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      "X-Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path} → ${text.slice(0, 200)}`);
  return text.trim() ? JSON.parse(text) : null;
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", PG, "psql", "-U", "postgres", "-d", "thingsboard", "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}

/** 确定性伪随机，与 simulate-unit-power 同算法 —— 两边生成的值可对齐。 */
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

/** 读「今天 0 点前最后一个真实值」作基准（与 simulate-unit-power 一致）。 */
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
  let n = Number(raw);
  if (!Number.isFinite(n)) return null;
  /*
   * 停机后恢复：power 基准为 0 时回退到最近的非零值（2026-11-26）。
   * 设备已 running=1 却按 0 生成曲线，会得到「运行中功率 0」这种
   * 现场不可能的状态。温度不回退（停机时就该停在环境值）。
   */
  if (key === "power" && n === 0) {
    const peak = psql(
      `SELECT coalesce(k.dbl_v, k.long_v::double precision) FROM ts_kv k
         JOIN key_dictionary kd ON kd.key_id = k.key
        WHERE kd.key = 'power' AND k.entity_id = '${deviceId}'
          AND k.ts < (extract(epoch from date_trunc('day', now()))*1000)::bigint
          AND coalesce(k.dbl_v, k.long_v::double precision) > 0
        ORDER BY k.ts DESC LIMIT 1;`,
    );
    const pn = Number(peak);
    if (peak !== "" && Number.isFinite(pn) && pn > 0) n = pn;
  }
  return n;
}

/** 回读实际落库点数 —— 这是唯一可信的成功判据。 */
function countSaved(deviceId, fromTs) {
  const keys = KEYS.map((k) => `'${k}'`).join(",");
  const raw = psql(
    `SELECT count(*) FROM ts_kv k JOIN key_dictionary kd ON kd.key_id = k.key
      WHERE k.entity_id = '${deviceId}' AND kd.key IN (${keys}) AND k.ts >= ${fromTs};`,
  );
  return Number(raw) || 0;
}

async function main() {
  const devices = (await api("/api/tenant/devices?pageSize=100&page=0")).data;
  const bucketMs = BUCKET_MIN * 60_000;
  const nowBucket = Math.floor(Date.now() / bucketMs) * bucketMs;
  const fromTs = nowBucket - HOURS * 3600_000;
  const buckets = [];
  for (let ts = fromTs; ts <= nowBucket; ts += bucketMs) buckets.push(ts);

  console.log(`模式：${DRY ? "预演" : "写入"}｜桶 ${BUCKET_MIN} 分钟 × ${buckets.length}`
    + `｜目标 ${UNITS.length} 台\n`);

  let okCount = 0;
  for (const unit of UNITS) {
    const dev = devices.find((d) => new RegExp(`模块机-${unit}#`).test(d.name));
    if (!dev) { console.log(`  ✗ 找不到模块机-${unit}#`); continue; }
    const id = dev.id.id;

    const bases = {};
    for (const key of KEYS) {
      bases[key] = readBase(id, key);
      if (bases[key] == null) throw new Error(`${dev.name} 没有 ${key} 基准值`);
    }

    const rnd = seeded(seedOf(id));
    const wave = { power: 0.12, temperature: 0.05 };
    const jitter = { power: 0.06, temperature: 0.01 };
    const frames = buckets.map((ts, i) => {
      const at = new Date(ts);
      const hourOfDay = at.getHours() + at.getMinutes() / 60;
      const daily = Math.sin(((hourOfDay - 10) / 24) * Math.PI * 2);
      const values = {};
      for (const key of KEYS) {
        const noise = (rnd() - 0.5) * jitter[key] * 2;
        values[key] = i === buckets.length - 1
          ? bases[key]
          : Number((bases[key] * (1 + daily * wave[key] + noise)).toFixed(2));
      }
      return { ts, values };
    });

    if (DRY) {
      const pv = frames.map((f) => f.values.power);
      console.log(`  ○ ${dev.name} ${frames.length} 点  power ${Math.min(...pv)}~${Math.max(...pv)} kW`
        + `  temp ${bases.temperature} ℃ 基准`);
      continue;
    }

    const cred = await api(`/api/device/${id}/credentials`);
    const accessToken = cred?.credentialsId;
    if (!accessToken) throw new Error(`${dev.name} 没有接入令牌`);

    await fetch(`${BASE}/api/v1/${accessToken}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(frames),
    });

    /* 等队列落库，再回读。只信库里的行数，不信 200。 */
    await sleep(6000);
    const saved = countSaved(id, fromTs);
    const expect = frames.length * KEYS.length;
    if (saved >= expect) {
      okCount += 1;
      console.log(`  ✓ ${dev.name}  ${saved}/${expect} 点已落库`);
    } else {
      console.log(`  ! ${dev.name}  只落库 ${saved}/${expect} 点（队列积压丢了其余）`);
    }
    await sleep(3000);
  }

  console.log(`\n完成：${okCount}/${UNITS.length} 台完整落库`);
  if (okCount < UNITS.length) process.exitCode = 1;
}

main().catch((e) => { console.error("失败：", e.message); process.exitCode = 1; });
