#!/usr/bin/env node
/**
 * 在平台上模拟 2 台不同运行状态的机组（2026-11-23 客户要求）。
 *
 * <p>客户原话：「给我在平台端模拟2个不同状态的设备」——
 * 目的是让大屏能演示「一台正常、一台故障」，验证 3D 染色、铭牌与告警联动。
 *
 * <h2>写什么</h2>
 *
 * <p>每台设备写三个键，**三个必须一起写**：
 *
 * <table>
 *   <tr><th>键</th><th>含义</th><th>为什么不能只写一个</th></tr>
 *   <tr><td>`sys_run_state`</td><td>0~9 枚举（5=运行，8=故障）</td>
 *       <td>状态列表、3D 染色、铭牌都读它</td></tr>
 *   <tr><td>`water_out_temp`</td><td>出水温度 ℃</td>
 *       <td>列表要显示温度，缺了就只剩一个裸状态</td></tr>
 *   <tr><td>`power`</td><td>功率 kW</td>
 *       <td>排名/趋势要它；缺了排名里那台消失</td></tr>
 * </table>
 *
 * <p>只写 `sys_run_state` 会造成「状态变了、温度还是两天前」这种现场
 * 不可能出现的组合 —— 同一个网关要么都上报、要么都不上报。
 *
 * <h2>为什么走设备接入 API</h2>
 *
 * <p>与 `simulate-unit-power.mjs` 同一个结论（那里有完整实测记录）：
 * 标准 `POST /api/plugins/telemetry/.../timeseries` 在本环境会把
 * 整个数组塞进 `json_v`、ts 被强制成写入时刻，**补不了历史、也写不对值**。
 * 设备接入 API `POST /api/v1/{accessToken}/telemetry` 才能精确保留 ts。
 *
 * <h2>这是演示数据，不是真实遥测</h2>
 *
 * <p>脚本会在写之前打印「设备 / 状态 / 值」，可据此回滚。
 * `--purge` 用当前时间往前 1 小时的时间窗删除这两个键的点
 * （直连 psql —— 平台 DELETE 实测不生效）。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/simulate-device-states.mjs --dry-run   # 预演
 * node scripts/simulate-device-states.mjs             # 写入
 * node scripts/simulate-device-states.mjs --purge     # 撤销
 * ```
 */

const BASE = process.env.GUARD_BASE || "http://127.0.0.1:8090";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const DB_CONTAINER = process.env.TB_DB_CONTAINER || "energy-postgres";
const DB_NAME = process.env.TB_DB_NAME || "thingsboard";

const DRY = process.argv.includes("--dry-run");
const PURGE = process.argv.includes("--purge");

/**
 * 要模拟的两台。
 *
 * <h3>为什么这样选</h3>
 *
 * <p>1# 正常、2# 故障。相邻两台并排出现在机组列表里，
 * **肉眼比对颜色差异最方便**。故障放在 2# 而不是 1#，
 * 是因为 1# 常被当作「首台」参考基准。
 *
 * <h3>★ 为什么要写两套键名</h3>
 *
 * <p>现场存在两层 key，两个都得写：
 *
 * <table>
 *   <tr><th>层</th><th>键</th><th>谁在读</th></tr>
 *   <tr><td>平台列表配置</td><td>`temperature` / `power` / `opening` / `running`</td>
 *       <td>`unit-list` 的 slots（存在 `scene-widgets` 里）</td></tr>
 *   <tr><td>手册协议</td><td>`sys_run_state`</td>
 *       <td>3D 染色、铭牌四态、告警判据</td></tr>
 * </table>
 *
 * <p>实测踩过：只写 `water_out_temp` + `sys_run_state`，结果机组列表
 * 四列里有三列是「未知」—— 因为平台配的是 `temperature` / `running`。
 * 两个键名都对（一个是手册原名、一个是平台别名），只是读的人不同。
 */
const TARGETS = [
  {
    deviceName: "天骄-模块机-1#·生产园区",
    label: "1# 正常运行",
    values: {
      temperature: 7.2,
      power: 21.4,
      opening: 65,
      running: true,
      sys_run_state: 5,
    },
  },
  {
    deviceName: "天骄-模块机-2#·生产园区",
    label: "2# 故障",
    /*
     * 故障机的数值：功率掉到 0、出水温度爬升、开度归零、running=false。
     *
     * 这不是为了「看起来像」，而是**物理上就该这样**：
     * 压缩机停了不出力（power→0），水泵停转后水温向环境温度靠拢（7.2→18.6℃），
     * 阀门失去开度指令（opening→0）。
     *
     * <p>`running=false` 与 `sys_run_state=8` 不矛盾：前者是平台列表的
     * 简化布尔（在跑 / 没在跑），后者是手册枚举（8 = 故障）。
     * 两层描述同一件事的不同粒度。
     */
    values: {
      temperature: 18.6,
      power: 0,
      opening: 0,
      running: false,
      sys_run_state: 8,
    },
  },
];

const WRITE_KEYS = ["temperature", "power", "opening", "running", "sys_run_state"];

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

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

async function findDevice(token, name) {
  const query = new URLSearchParams({ deviceName: name });
  const res = await fetch(`${BASE}/api/tenant/devices?${query.toString()}`, {
    headers: { "X-Authorization": `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`查询设备失败 ${res.status}：${name}`);
  const data = await res.json();
  /*
   * ★ 两种返回形状，实测必需兼容：
   *
   * <ul>
   *   <li>**不带 `deviceName`** → `{ data: [...], totalPages, ... }`（分页包）；</li>
   *   <li>**带 `deviceName`** → 直接是单个设备对象（查不到时 404）。</li>
   * </ul>
   *
   * <p>第一版只写了 `data.data[0]`，于是带名字查询永远拿不到设备、
   * 报「找不到设备」—— 而设备明明存在。这种「接口同一路径两种形状」
   * 在 TB 里很常见（`/api/tenant/customers` 也是）。
   */
  const row = Array.isArray(data?.data) ? data.data[0] : data?.id ? data : null;
  if (!row) throw new Error(`找不到设备：${name}`);
  return { id: row.id?.id ?? row.id, name: row.name };
}

async function readAccessToken(token, deviceId) {
  const res = await fetch(`${BASE}/api/device/${encodeURIComponent(deviceId)}/credentials`, {
    headers: { "X-Authorization": `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`读取凭证失败 ${res.status}`);
  const data = await res.json();
  if (data.credentialsType !== "ACCESS_TOKEN" || !data.credentialsId) {
    throw new Error(`设备 ${deviceId} 不是 ACCESS_TOKEN 凭证（${data.credentialsType}），无法走设备接入 API`);
  }
  return data.credentialsId;
}

async function writeTelemetry(accessToken, values, ts) {
  const res = await fetch(`${BASE}/api/v1/${accessToken}/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ ts, values }]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`写入失败 ${res.status}：${text.slice(0, 200)}`);
  }
}

/** 撤销：直接删这两个键近期写入的点。平台 DELETE 实测不生效，只能直连库。 */
async function purge(deviceId, fromTs, toTs) {
  const keys = WRITE_KEYS.map((k) => `'${k}'`).join(",");
  const sql = `DELETE FROM ts_kv WHERE entity_id = '${deviceId}' AND key IN (${keys}) AND ts >= ${fromTs} AND ts <= ${toTs};`;
  const { execSync } = await import("node:child_process");
  execSync(`docker exec ${DB_CONTAINER} psql -U postgres -d ${DB_NAME} -c ${JSON.stringify(sql)}`, {
    stdio: "inherit",
  });
}

async function main() {
  const token = await login();
  const now = Date.now();
  /* 撤销窗口取「往前 2 小时」：脚本可能连跑过几次，窗口要盖得住。 */
  const PURGE_FROM = now - 2 * 60 * 60 * 1000;

  console.log(PURGE ? "模式：撤销" : DRY ? "模式：预演（不写库）" : "模式：写入");
  console.log("");

  for (const target of TARGETS) {
    const device = await findDevice(token, target.deviceName);
    console.log(`${target.label}`);
    console.log(`  设备：${device.name}（${device.id}）`);

    if (PURGE) {
      await purge(device.id, PURGE_FROM, now);
      console.log(`  已删除 ${WRITE_KEYS.join(" / ")} 在最近 2 小时内的点`);
      console.log("");
      continue;
    }

    /* 状态字翻译成人话，写之前让人能核对该不该这样。 */
    const stateLabel =
      target.values.sys_run_state === 8 ? "故障"
      : target.values.sys_run_state === 5 ? "运行"
      : String(target.values.sys_run_state);
    console.log(`  状态：sys_run_state=${target.values.sys_run_state}（${stateLabel}）`);
    console.log(`  出水温度：${target.values.temperature} ℃`);
    console.log(`  功率：${target.values.power} kW`);
    console.log(`  开度：${target.values.opening} %`);
    console.log(`  running：${target.values.running}`);

    if (DRY) {
      console.log("  （预演，未写入）");
      console.log("");
      continue;
    }

    const accessToken = await readAccessToken(token, device.id);
    await writeTelemetry(accessToken, target.values, now);
    console.log(`  已写入，ts=${now}`);
    console.log("");
  }

  if (!PURGE && !DRY) {
    console.log("✓ 完成。刷新大屏即可看到两台不同状态（1# 运行 / 2# 故障）。");
    console.log("");
    console.log("注意：这些是**演示数据**，不是网关真实上报。");
    console.log("撤销：node scripts/simulate-device-states.mjs --purge");
  }
}

await main();
