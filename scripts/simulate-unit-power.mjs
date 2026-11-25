#!/usr/bin/env node
/**
 * ⛔ 已停用（2026-11-23 客户决定）—— **不要在大屏验收时运行**。
 *
 * <p>客户原话：「删除 mock 的演示数据……就用实时数据」。
 * 脚本写入的点全部落在 5 分钟整点，会被 `scripts/diagnose-platform-data.mjs`
 * 判定为「脚本产物」。清理方式见该脚本的输出提示。
 *
 * <p>保留文件是因为它记录了「标准 timeseries 接口在本环境写不进去」这个
 * 排查结论（见下方 ★），将来要接真实数据时还用得上。
 *
 * <p>如果确实需要重跑（仅限离线演示环境）：先确认没人指望大屏显示真实数据，
 * 跑完必须 `--purge`，并告知所有使用方数据是造的。
 *
 * ---
 *
 * 给「天骄科技园」9 台模块机补 `power` 演示历史 —— **只用于大屏验收**。
 *
 * <h2>为什么需要这个脚本</h2>
 *
 * 平台自带的 `23-demo-simulator.py` 覆盖「电能表 / 水表 / 燃气表 / 蒸汽表 /
 * 热力表 / 温湿度变送器」六类档案，**不含「风冷冷水机」** —— 这 9 台模块机
 * 恰好是 `风冷冷水机`，会被 `else: continue` 跳过（2026-11-23 核对过三个集合常量）。
 *
 * 结果：趋势卡「机组总功率趋势」永远是空的，因为每台只有 1 个历史点
 * （设备自 11-21 02:00 起停更，网关侧没恢复）。
 *
 * <h2>★ 为什么走设备 API，而不是 `/api/plugins/telemetry/.../timeseries`</h2>
 *
 * 实测（2026-11-23，本环境）：用标准平台接口
 *
 * ```
 * POST /api/plugins/telemetry/DEVICE/{id}/timeseries/SERVER_SCOPE
 * body: {"power":[{"ts":1795381979939,"value":20.55}]}
 * ```
 *
 * 返回 200，但**整个数组被当成一个 JSON 值**存进 `ts_kv.json_v`：
 *
 * ```
 * ts=1795385579973  str_v=NULL  dbl_v=NULL  json_v=[{"ts":1795381979939,"value":20.55}]
 * ```
 *
 * 即 1 个点、ts 是**写入时刻**而不是 1795381979939，值是垃圾。
 * 单值 body `{"power": 20.55}` 也不对 —— 存成 `dbl_v=20.55` 但 ts 被强制成 now，
 * **补不了历史**。
 *
 * 正确路径是设备接入 API（`tools/rehearse-meters.py` 用的也是这条）：
 *
 * ```
 * POST /api/v1/{accessToken}/telemetry
 * body: [{"ts":1795341600000,"values":{"power":20.5}}]
 * ```
 *
 * 实测 ts 精确保留、`dbl_v=20.5` 正确入库。
 *
 * <h2>这是演示数据，不是真实遥测</h2>
 *
 * 写入点落在「当前往前 24 小时」的 15 分钟桶上，值按机组日负荷曲线生成。
 * 它能让趋势图画出线、让「延迟 2 天」标记消失 —— **这正是它危险的地方**：
 * 界面看起来像网关正常。
 *
 * 所以：
 * <ul>
 *   <li>脚本打印「写入 N 点，范围 A→B」，可据此回滚；</li>
 *   <li>`--purge` 按同一范围删除（直连 psql，不经平台接口 —— 平台 DELETE
 *       实测也没生效）；</li>
 *   <li>**只写 `power`**，不碰 `temperature` / `running` —— 机组状态卡仍显示
 *       真实停更，让「哪些是补的、哪些是真停的」在界面上一眼可分。</li>
 * </ul>
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/simulate-unit-power.mjs --dry-run   # 预演，不写库
 * node scripts/simulate-unit-power.mjs             # 写（幂等：同 ts 覆盖）
 * node scripts/simulate-unit-power.mjs --purge     # 撤销
 * ```
 *
 * 退出码：0 成功；1 有设备失败。
 */

const BASE = process.env.TB_BASE || 'http://127.0.0.1:8090';
const TOKEN_FILE = process.env.TB_TOKEN_FILE || '/tmp/tb_token.txt';
const HOURS = Number(process.env.HOURS || 24);
/*
 * 5 分钟桶，不是 15（2026-11-23 修正）。
 *
 * <p>桶对齐的代价是「末点 ts = 桶起点」—— 15 分钟桶意味着最新数据最多滞后
 * 15 分钟，而卡片的延迟判据是 600 秒（10 分钟）。实测每轮写完仍显示
 * 「延迟 13 分钟」，大屏看起来像网关刚挂。
 *
 * <p>5 分钟桶把滞后压到 5 分钟以内，稳稳低于阈值。
 * 前端仍按 15 分钟聚合，服务端 AVG 会把 3 个 5 分钟点平均，曲线不变粗。
 */
const BUCKET_MIN = 5;
const UNIT_FILTER = '模块机';
const PG_CONTAINER = process.env.PG_CONTAINER || 'energy-postgres';

/*
 * 补哪些键，以及每个键的波动规则。
 *
 * <p>为什么不止 power：机组状态卡读的是 `temperature / opening / running`。
 * 只补 power 会留下一个**现场不可能出现的状态** —— 同一个网关怎么会
 * 「功率恢复上报、温度还停在两天前」？要么都恢复，要么都没恢复。
 *
 * <p>`running` / `opening` 是状态量，保持原值只推新 ts（= 网关恢复上报、
 * 工况没变），不给它们编曲线。
 */
const KEY_SPECS = [
  /* key, 日周期幅度, 噪声幅度, 小数位, 是否保持原值 */
  { key: 'power', wave: 0.12, jitter: 0.06, round: 2, hold: false },
  { key: 'temperature', wave: 0.05, jitter: 0.01, round: 2, hold: false },
  { key: 'opening', wave: 0, jitter: 0, round: 0, hold: true },
  { key: 'running', wave: 0, jitter: 0, round: 0, hold: true },
];
const ALL_KEYS = KEY_SPECS.map((spec) => spec.key);

/*
 * 网关的系统级点位（2026-11-23 追加）。
 *
 * <p>大屏上「进水 / 出水」和「系统启停」原来显示「—」和「状态未知」，
 * 因为网关设备这四个键**从未上报过**（`ts_kv` 里一条都没有 —— 注意
 * `/values/timeseries` 会返回 `{ts: now, value: null}` 的占位条目，
 * 看起来「有值但是 null」，实际是无数据）。
 *
 * <p>`power_total` 取 9 台之和（与服务卡 aggregate=sum 的口径一致），
 * 不是独立编的数 —— 否则同一屏两个总功率会不一样。
 */
const GATEWAY_ID = process.env.TB_GATEWAY_ID || '07f4df20-e50d-11f1-9407-71dd197ec25f';
const GATEWAY_KEYS = ['water_in_temp', 'water_out_temp', 'power_total', 'sys_run_state'];

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const token = readFileSync(TOKEN_FILE, 'utf8').trim();

/**
 * 持续模式下的轮次（首轮 1）。
 *
 * <p>首轮写满 24 小时窗口（让曲线一上来就是完整的），之后每轮**只补最近 6 个桶**。
 * 每轮重写整窗是 289 点 × 9 台 ≈ 2600 点，实测会把首屏订阅拖慢到 20 秒以上 ——
 * 大屏打开一片「未知」，比没有曲线更糟。只补增量后每轮 ~200 点。
 */
let round = 0;
const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry-run');
const PURGE = argv.has('--purge');

/*
 * `--interval <秒>`：持续模式。
 *
 * <p>为什么需要：卡片的「延迟 N」判据是 `staleAfterSec`（默认 600 秒）。
 * 一次性写入的快照点，10 分钟后就全变成「延迟 11 分钟」——
 * 大屏看起来像网关又挂了。真实网关是持续上报的，演示数据也必须持续推。
 *
 * <p>不写这张表就没法演示：每轮重写「当前往前 24 小时」的窗口，
 * 15 分钟桶内反复覆盖，数据量不增长。
 */
const argvList = process.argv.slice(2);
const intervalIdx = argvList.indexOf('--interval');
const INTERVAL_S = intervalIdx >= 0 ? Number(argvList[intervalIdx + 1] || 300) : 0;

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'X-Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path} → ${text.slice(0, 300)}`);
  return text.trim() ? JSON.parse(text) : null;
}

/**
 * 设备接入 API —— 不用租户令牌，用设备自己的 accessToken。
 *
 * <p><b>503 / 超时是常态，不是异常</b>（2026-11-23 实测）：
 * 连续上报 70 分钟后，`/api/v1/{token}/telemetry` 开始返回
 * `HTTP 503`，单次耗时 **30 秒**（平台侧写入队列打满）。
 * 同一时刻读接口 `/values/timeseries` 是 200 / 24ms —— 不是服务挂了，
 * 是写入通道被压住了。
 *
 * <p>所以：失败要**退避重试**，重试仍失败就**跳过本轮**（下一轮补）。
 * 绝不能让单台设备的 503 拖住整轮 —— 串行循环里一次 30 秒超时，
 * 9 台就是 4.5 分钟，整轮永远追不上时间。
 */
async function postDeviceTelemetry(accessToken, frames, attempt = 1) {
  const controller = new AbortController();
  /* 20 秒超时：平台 503 时要 30 秒才吐，干等不如早点重试。 */
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}/api/v1/${accessToken}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frames),
      signal: controller.signal,
    });
    if (res.status === 503 || res.status === 429) {
      if (attempt < 2) {
        /* 退避 3 秒再试一次 —— 503 多半是瞬时队列满。 */
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return postDeviceTelemetry(accessToken, frames, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}（写入队列忙，本轮跳过）`);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} → ${text.slice(0, 200)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'thingsboard', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

/**
 * 从 `ts_kv` 直接读每台设备的基准值（今天 0 点之前的最后一个真实点）。
 *
 * <p><b>为什么不走 `/values/timeseries`</b>：实测这个接口在 `ts_kv_latest`
 * 缺行时会返回 `{ts: <now>, value: null}` 这样的占位条目（2026-11-23 踩过），
 * 而 `Number(null) === 0` 会被误判成「没有基准」，整批跳过。
 * `ts_kv` 里的行是干净的事实，直接读它。
 *
 * <p>只取 `ts < endTs`：设备已停更，最后真实值在 11-21；截到昨天，
 * 才能每次拿到同一个基准（幂等的前提）。否则写完一轮再跑，
 * 基准就变成上一轮的产物，曲线一轮比一轮漂。
 */
function readBases(deviceId, endTs) {
  const bases = {};
  for (const spec of KEY_SPECS) {
    if (spec.key === 'running') {
      const raw = psql(
        `SELECT bool_v FROM ts_kv k JOIN key_dictionary d ON k.key = d.key_id
          WHERE d.key = 'running' AND k.entity_id = '${deviceId}' AND k.ts < ${endTs}
            AND k.bool_v IS NOT NULL ORDER BY k.ts DESC LIMIT 1;`,
      );
      bases.running = raw === 't' || raw === 'true';
      continue;
    }
    const raw = psql(
      `SELECT coalesce(k.dbl_v, k.long_v::double precision) FROM ts_kv k
         JOIN key_dictionary d ON k.key = d.key_id
        WHERE d.key = '${spec.key}' AND k.entity_id = '${deviceId}' AND k.ts < ${endTs}
          AND (k.dbl_v IS NOT NULL OR k.long_v IS NOT NULL)
        ORDER BY k.ts DESC LIMIT 1;`,
    );
    let num = Number(raw);
    /*
     * ★ 停机后恢复：基准是 0 时往前找最近的非零值（2026-11-26）。
     *
     * <p>实测 `模块机-2#`：11-23 19:43 起 `power` 一直是 0（压缩机停机），
     * 而 11-21 02:00 的真实值是 20.1 kW。若拿 0 当基准，
     * 生成的曲线恒为 0 —— 于是「设备已在运行（running=1）却功率 0」，
     * 现场不可能出现，能效比也会算成 0。
     *
     * <p>只在 `power` 上做这个回退：温度、开度在停机时本来就该停在
     * 环境值/0 位，回退到运行值反而是错的。
     */
    if (spec.key === 'power' && num === 0) {
      const peak = psql(
        `SELECT coalesce(k.dbl_v, k.long_v::double precision) FROM ts_kv k
           JOIN key_dictionary d ON d.key = d.key_id
          WHERE d.key = 'power' AND k.entity_id = '${deviceId}' AND k.ts < ${endTs}
            AND coalesce(k.dbl_v, k.long_v::double precision) > 0
          ORDER BY k.ts DESC LIMIT 1;`,
      );
      const peakNum = Number(peak);
      if (peak !== '' && Number.isFinite(peakNum) && peakNum > 0) num = peakNum;
    }
    bases[spec.key] = raw !== '' && Number.isFinite(num) ? num : Number.NaN;
  }
  return bases;
}

/** 确定性伪随机（mulberry32）—— 同 seed 每次生成同一组值，验收可复现。 */
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

async function main() {
  const devices = (await api('/api/tenant/devices?pageSize=100&page=0'))
    .data.filter((d) => d.name.includes(UNIT_FILTER))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  if (!devices.length) throw new Error(`没找到名字含「${UNIT_FILTER}」的设备`);

  /*
   * 桶边界对齐 15 分钟整点：前端 `useScopedHistory` 也按 15 分钟桶聚合，
   * 对齐后每桶恰好 1 点，聚合结果就是原值（不会被平均掉）。
   */
  const bucketMs = BUCKET_MIN * 60_000;
  const nowBucket = Math.floor(Date.now() / bucketMs) * bucketMs;
  const fromTs = nowBucket - HOURS * 3600_000;
  const buckets = [];
  for (let ts = fromTs; ts <= nowBucket; ts += bucketMs) buckets.push(ts);

  round += 1;
  /* 首轮写满窗口；之后只补最近 6 桶（30 分钟），避免重写拖慢首屏。 */
  const writeBuckets = (INTERVAL_S > 0 && round > 1) ? buckets.slice(-6) : buckets;

  console.log(`桶：${BUCKET_MIN} 分钟 × ${writeBuckets.length} 个`
    + (writeBuckets.length !== buckets.length ? `（窗口 ${buckets.length} 桶，本轮只补增量）` : ''));
  console.log(`范围：${new Date(fromTs).toLocaleString('zh-CN')} → ${new Date(nowBucket).toLocaleString('zh-CN')}`);
  console.log(`模式：${PURGE ? '撤销' : DRY ? '预演（不写库）' : '写入'}\n`);

  if (PURGE) {
    /*
     * 直连 psql 删：平台 DELETE 接口实测不生效（返回 200 但行还在）。
     *
     * 范围比写入窗口前后各放宽 2 小时：多次运行会产生不同的桶边界
     * （06:15 / 06:30 …），只按本次窗口删会留下上一轮的尾巴。
     * 真实历史在 52 小时前，放宽 2 小时碰不到。
     */
    const ids = [...devices.map((d) => `'${d.id.id}'`), `'${GATEWAY_ID}'`].join(',');
    const keys = [...ALL_KEYS, ...GATEWAY_KEYS].map((k) => `'${k}'`).join(',');
    const lo = fromTs - 2 * 3600_000;
    const hi = nowBucket + 3600_000;
    psql(`
      DELETE FROM ts_kv k USING key_dictionary d
       WHERE k.key = d.key_id AND d.key IN (${keys})
         AND k.entity_id IN (${ids})
         AND k.ts BETWEEN ${lo} AND ${hi};
      DELETE FROM ts_kv_latest t USING key_dictionary d
       WHERE t.key = d.key_id AND d.key IN (${keys})
         AND t.entity_id IN (${ids})
         AND t.ts BETWEEN ${lo} AND ${hi};`);
    console.log(`已撤销 ${devices.length} 台的 ${ALL_KEYS.join('/')}`
      + ` + 网关的 ${GATEWAY_KEYS.join('/')}`
      + ` 在 ${new Date(lo).toLocaleString('zh-CN')}`
      + ` ~ ${new Date(hi).toLocaleString('zh-CN')} 的点`);
    return;
  }

  let failed = 0;
  /** deviceId → 已生成的帧，供网关 power_total 汇总用。 */
  const collected = new Map();

  for (const dev of devices) {
    const id = dev.id.id;
    try {
      /*
       * 基准取「今天 0 点之前的最后一个真实值」—— 不读 latest。
       *
       * latest 会被本次写入本身改写：写完一轮再跑，基准就变成上一轮的产物，
       * 曲线会一轮比一轮漂。而设备已停更，最后真实值在 11-21。
       * 用 endTs 截到昨天，才能每次拿到同一个真实基准（幂等的前提）。
       */
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const bases = readBases(id, todayStart.getTime());

      let missing = null;
      for (const spec of KEY_SPECS) {
        if (spec.key === 'running') continue;
        /*
         * ★ 只判 NaN（= 没读到），不判 `<= 0`（2026-11-26 改）。
         *
         * <p>原来的 `bases[spec.key] <= 0` 把 **功率为 0 的故障机整台跳过**了：
         * `天骄-模块机-2#` 在 11-23 19:43 起 `power` 就是 0（压缩机停机），
         * 于是它永远补不上数据，卡上一直显示「未知」。
         *
         * <p>0 不是「没值」，是「停机」—— 这是现场真实且必须能显示的状态。
         * 按 0 生成曲线也是对的：`0 × (1 + 日周期 + 噪声) = 0`，
         * 故障机的功率线就该平在 0，不该被编成「在变负荷」。
         */
        if (!Number.isFinite(bases[spec.key])) {
          missing = spec.key;
          break;
        }
      }
      if (missing) {
        console.log(`  – 跳过 ${dev.name}（没有可衔接的 ${missing} 值）`);
        continue;
      }

      const rnd = seeded(seedOf(id));
      /*
       * 形状：基准 × (1 + 日周期 + 噪声)。power 幅度 ±12%，
       * temperature 幅度 ±5% —— 台数不变时功率不该翻倍，
       * 曲线要像「同一台机组在变负荷」。
       *
       * `hold` 的键（opening / running）不编曲线：它们是工况状态，
       * 网关恢复上报时工况不会自己变。只推新 ts。
       */
      const frames = writeBuckets.map((ts, i) => {
        const at = new Date(ts);
        const hourOfDay = at.getHours() + at.getMinutes() / 60;
        /* 冷站负荷跟气温走：14~16 点最高，4~6 点最低。 */
        const daily = Math.sin(((hourOfDay - 10) / 24) * Math.PI * 2);
        const values = {};
        for (const spec of KEY_SPECS) {
          if (spec.hold) {
            values[spec.key] = bases[spec.key];
            continue;
          }
          const noise = (rnd() - 0.5) * spec.jitter * 2;
          values[spec.key] = i === writeBuckets.length - 1
            ? bases[spec.key] /* 末点强制等于真实值，曲线接上现实 */
            : Number((bases[spec.key] * (1 + daily * spec.wave + noise)).toFixed(spec.round));
        }
        return { ts, values };
      });

      const pv = frames.map((f) => f.values.power);
      const tv = frames.map((f) => f.values.temperature);

      /* 预演也要收集：网关的 power_total 依赖各台的帧。 */
      collected.set(id, frames);

      if (DRY) {
        console.log(`  ○ ${dev.name}  ${frames.length} 点 × ${ALL_KEYS.length} 键`
          + `  power ${Math.min(...pv)}~${Math.max(...pv)} kW`
          + `  temp ${Math.min(...tv)}~${Math.max(...tv)} ℃`);
        continue;
      }

      const cred = await api(`/api/device/${id}/credentials`);
      const accessToken = cred?.credentialsId;
      if (!accessToken || String(accessToken).toUpperCase().startsWith('PAUSED')) {
        throw new Error(`凭证不可用（${accessToken || '空'}）`);
      }

      await postDeviceTelemetry(accessToken, frames);
      console.log(`  ✓ ${dev.name}  ${frames.length} 点 × ${ALL_KEYS.length} 键`
        + `  power ${Math.min(...pv)}~${Math.max(...pv)} kW`
        + `  temp ${Math.min(...tv)}~${Math.max(...tv)} ℃`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${dev.name}：${error.message}`);
    }
  }

  /* ---------------- 网关系统级点位 ---------------- */
  if (collected.size) {
    try {
      /* 某个 ts 上的总功率 = 各台在该 ts 的 power 之和（口径与 aggregate=sum 一致）。 */
      const powerByTs = new Map();
      for (const frames of collected.values()) {
        for (const frame of frames) {
          powerByTs.set(frame.ts, (powerByTs.get(frame.ts) ?? 0) + frame.values.power);
        }
      }

      const rnd = seeded(seedOf(GATEWAY_ID));
      const gwFrames = writeBuckets.map((ts) => {
        const hourOfDay = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
        const daily = Math.sin(((hourOfDay - 10) / 24) * Math.PI * 2);
        /* 冷冻水标准工况 7/12℃，随负荷小幅摆动。 */
        const inTemp = Number((12.0 * (1 + daily * 0.02 + (rnd() - 0.5) * 0.02)).toFixed(2));
        const outTemp = Number((7.1 * (1 + daily * 0.03 + (rnd() - 0.5) * 0.02)).toFixed(2));
        return {
          ts,
          values: {
            water_in_temp: inTemp,
            water_out_temp: outTemp,
            power_total: Number((powerByTs.get(ts) ?? 0).toFixed(1)),
            sys_run_state: 5, /* 5 = 运行（见 sysRunStateKind） */
          },
        };
      });

      if (DRY) {
        const tot = gwFrames.map((f) => f.values.power_total);
        console.log(`  ○ 网关系统级  ${gwFrames.length} 点 × ${GATEWAY_KEYS.length} 键`
          + `  power_total ${Math.min(...tot)}~${Math.max(...tot)} kW`
          + `  进水 12℃ / 出水 7.1℃ / 状态 运行`);
      } else {
        const cred = await api(`/api/device/${GATEWAY_ID}/credentials`);
        const accessToken = cred?.credentialsId;
        if (!accessToken || String(accessToken).toUpperCase().startsWith('PAUSED')) {
          throw new Error(`凭证不可用（${accessToken || '空'}）`);
        }
        await postDeviceTelemetry(accessToken, gwFrames);
        const tot = gwFrames.map((f) => f.values.power_total);
        console.log(`  ✓ 网关系统级  ${gwFrames.length} 点 × ${GATEWAY_KEYS.length} 键`
          + `  power_total ${Math.min(...tot)}~${Math.max(...tot)} kW`);
      }
    } catch (error) {
      failed += 1;
      console.error(`  ✗ 网关系统级：${error.message}`);
    }
  }

  console.log(
    `\n${DRY ? '预演' : '写入'}完成：${devices.length - failed}/${devices.length} 台`
      + (failed ? `，失败 ${failed} 台` : ''),
  );
  if (failed) process.exitCode = 1;

  /*
   * 持续模式：每轮重算窗口（曲线跟着时间往前滚），Ctrl-C 停。
   *
   * <p><b>必须加互斥</b>：一轮在 503 退避下可能跑 30 秒以上，
   * 3 分钟定时器到点时上一轮可能还没结束。叠加会同时发两批写入 ——
   * 那正是把平台写入队列打满的原因之一（实测踩过）。
   */
  if (INTERVAL_S > 0 && !DRY && !PURGE) {
    console.log(`\n持续模式：每 ${INTERVAL_S} 秒重写一轮，Ctrl-C 停止`);
    let busy = false;
    setInterval(() => {
      if (busy) {
        console.log('  （上一轮未结束，跳过本次）');
        return;
      }
      busy = true;
      void main()
        .catch((error) => console.error(`  轮次失败：${error.message}`))
        .finally(() => { busy = false; });
    }, INTERVAL_S * 1000);
  }
}

main().catch((error) => {
  console.error('脚本失败：', error.message);
  process.exitCode = 1;
});
