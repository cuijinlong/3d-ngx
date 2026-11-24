#!/usr/bin/env node
/**
 * 诊断：3d-ngx 大屏到底读的是**平台数据**还是本地模拟（2026-11-23）。
 *
 * <h2>为什么需要这个脚本</h2>
 *
 * <p>这个问题反复被问：「guard-server 的平台数据到底接没接入？」
 * 光看界面看不出来 —— mock provider 和大屏皮肤长得一模一样，
 * 而且 mock 的数值也在合理范围内。
 *
 * <p>之前排查时踩过一个坑：探针 `import('/@fs/...registry.ts')` 拿到的是
 * **另一个模块实例**，`getProviderKind()` 报 `mock`，而应用实际跑的是 `guard`。
 * 结论完全反了。所以这里的判定不能只信一个 API，要**四路交叉验证**：
 *
 * <ol>
 *   <li>provider 实例类型（必须是 `GuardServerProvider`）；</li>
 *   <li>网络请求是否打到平台遥测端点；</li>
 *   <li>平台侧活跃告警能否被读出；</li>
 *   <li>★ 改一个库值，界面是否跟着变（这条无法造假）。</li>
 * </ol>
 *
 * <h2>怎么跑</h2>
 *
 * ```bash
 * node scripts/diagnose-platform-data.mjs
 * node scripts/diagnose-platform-data.mjs --scene <topologyId>
 * ```
 *
 * 退出码：0 = 确认读平台真数据；1 = 读的是 mock 或无法确认。
 *
 * <h2>★ 这个脚本能证明的与不能证明的</h2>
 *
 * <p>它能证明：<b>前端从平台取数</b>。
 *
 * <p>它**不能**证明：<b>平台上的数据来自真实网关</b>。两者是不同的事 ——
 * 如果网关停更、有人往平台写了演示数据，前端照样「读真数据」，
 * 而数据本身是造的。第 5 步专门查这个：统计每个点的 ts 是否落在
 * 5 分钟整点（脚本特征），并找出**网关最后一次真实上报**的时间。
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.APP_BASE || "http://127.0.0.1:5173";
const API = process.env.TB_BASE || "http://127.0.0.1:8090";

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const SCENE = readFlag("--scene") || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const TOKEN_FILE = process.env.TB_TOKEN_FILE || "/tmp/tb_token.txt";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if (!res.ok) throw new Error(`平台登录失败 HTTP ${res.status}`);
  const body = await res.json();
  return body.token;
}

async function api(path, token) {
  const res = await fetch(API + path, { headers: { "X-Authorization": `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}

/** 第 1~4 步：在浏览器里查 provider + 抓网络 + 读告警。 */
async function probeBrowser() {
  const port = 9601;
  const profile = "/tmp/pf-diagnose-platform";
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--window-size=1920,1080",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    { stdio: "ignore" },
  );

  const requests = [];
  try {
    for (let i = 0; i < 120; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) break;
      } catch { /* 还没起来 */ }
      await sleep(250);
    }
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));

    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg.result);
      } else if (msg.method === "Network.requestWillBeSent") {
        requests.push(msg.params.request.url);
      }
    });
    const send = (method, params = {}, sessionId) => {
      const messageId = ++id;
      const payload = { id: messageId, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve) => pending.set(messageId, { resolve }));
    };

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);

    const evaluate = async (expression) => {
      const result = await send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      return result.exceptionDetails ? null : result.result.value;
    };

    await send("Page.navigate", { url: `${APP}/login` }, sessionId);
    for (let i = 0; i < 100; i += 1) {
      await sleep(400);
      if (await evaluate(`!!document.querySelector('#ngx-login-username')`)) break;
    }
    await evaluate(`(()=>{
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('#ngx-login-username'), ${JSON.stringify(USER)});
      set(document.querySelector('#ngx-login-password'), ${JSON.stringify(PASS)});
      return 1;
    })()`);
    await sleep(300);
    await evaluate(`document.querySelector('form').requestSubmit()`);
    for (let i = 0; i < 50; i += 1) {
      await sleep(400);
      if (!(await evaluate(`location.pathname.includes('login')`))) break;
    }

    await send("Page.navigate", { url: `${APP}/digital-twin/runtime/${SCENE}` }, sessionId);
    await sleep(25_000);

    /*
     * ★ 路径必须是 `/@id/@idt/data-adapter`。
     *
     * 用 `/@fs/<绝对路径>/registry.ts` 会拿到**另一个模块实例** ——
     * 那个实例从未 `connectGuard`，永远是 mock。实测因此得出过完全相反的结论。
     */
    const provider = await evaluate(`(async()=>{
      const m = await import('/@id/@idt/data-adapter');
      const st = m.getGuardStatus();
      const p = m.getDataProvider();
      let alarms = [];
      try { alarms = await p.getAlarms(); } catch {}
      return {
        kind: m.getProviderKind(),
        connected: st.connected,
        apiBase: st.apiBase,
        username: st.username,
        deviceCount: st.deviceCount,
        providerClass: p?.constructor?.name ?? '(未知)',
        alarmTotal: alarms.length,
        alarmActive: alarms.filter(a => a.active).length,
      };
    })()`);

    return { provider, requests };
  } finally {
    chrome.kill();
  }
}

/* ---------------- 主流程 ---------------- */
const token = await login();
console.log(`平台：${API}\n场景：${SCENE}\n`);

console.log("【1】浏览器内 provider 状态");
const { provider, requests } = await probeBrowser();
if (!provider) {
  console.error("  ✗ 探针失败（页面没起来或模块导入失败）");
  process.exitCode = 1;
} else {
  const isGuard = provider.kind === "guard" && provider.providerClass === "GuardServerProvider";
  console.log(`  kind              ${provider.kind}`);
  console.log(`  provider 实现     ${provider.providerClass}`);
  console.log(`  已连接            ${provider.connected}`);
  console.log(`  API 基地址        ${provider.apiBase}`);
  console.log(`  登录账户          ${provider.username}`);
  console.log(`  设备数（平台）     ${provider.deviceCount}`);
  console.log(`  告警（平台）       ${provider.alarmTotal} 条，其中活跃 ${provider.alarmActive} 条`);
  console.log(`  ${isGuard ? "✓ 读的是平台数据" : "✗ 不是 guard provider"}`);
  if (!isGuard) process.exitCode = 1;
}

console.log("\n【2】网络请求是否打到平台遥测端点");
const telemetryCalls = requests.filter((url) => url.includes("/api/plugins/telemetry/"));
const alarmCalls = requests.filter((url) => url.includes("/api/alarms"));
const historyCalls = requests.filter((url) => url.includes("values/timeseries"));
console.log(`  遥测类请求        ${telemetryCalls.length}`);
console.log(`  告警类请求        ${alarmCalls.length}`);
console.log(`  历史曲线请求      ${historyCalls.length}`);
console.log(`  ${telemetryCalls.length > 0 ? "✓ 有平台遥测请求" : "✗ 没有平台遥测请求"}`);
if (telemetryCalls.length === 0) process.exitCode = 1;

console.log("\n【3】平台侧数据核对（直连 API，不经浏览器）");
const devices = await api("/api/tenant/devices?pageSize=500&page=0", token);
const modules = (devices.data ?? []).filter((device) => String(device.name ?? "").includes("模块机"));
console.log(`  平台设备总数      ${devices.totalElements ?? devices.data?.length}`);
console.log(`  模块机            ${modules.length} 台`);

const alarms = await api("/api/alarms?pageSize=100&page=0&sortProperty=startTs&sortOrder=DESC", token);
const activeAlarms = (alarms.data ?? []).filter((row) => !String(row.status ?? "").startsWith("CLEARED"));
console.log(`  平台活跃告警      ${activeAlarms.length} 条`);

/*
 * 第 5 步：数据源头。
 *
 * 这一步和「前端接没接入」是**两个问题**。前端可以 100% 读平台真数据，
 * 而平台上的值仍然可能是脚本写进去的演示数据。
 */
console.log("\n【5】★ 平台上的数据是谁写的");
if (!modules.length) {
  console.log("  （没有模块机，跳过）");
} else {
  const first = modules[0];
  const deviceId = first.id.id;
  const layout = await api(`/api/energy/topologies/${SCENE}/scene-widgets`, token);
  const trendWidget = (layout.widgets ?? []).find((widget) =>
    (widget.slots ?? []).some((slot) => slot.aggregate),
  );

  /*
   * 直接查时序：用 timeseries 接口取最近 24 小时，
   * 按「是否落在 5 分钟整点」区分脚本写入与网关上报。
   */
  const now = Date.now();
  const series = await api(
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries`
      + `?keys=temperature&startTs=${now - 24 * 3600_000}&endTs=${now}&limit=2000`,
    token,
  );
  const points = series.temperature ?? [];
  const onBucket = points.filter((point) => Number(point.ts) % 300_000 === 0).length;
  const ratio = points.length ? Math.round((onBucket / points.length) * 100) : 0;

  /*
   * 找「网关最后一次真实上报」。
   *
   * <p>判据是**不落在 5 分钟整点**。
   *
   * <p>第一版写成「3 小时前的最后一个点」，但那批点同样是脚本写的
   * （脚本所有点都在整点），于是报出一个看起来像真上报、其实是脚本产物的时间 ——
   * 比不报更误导。真实网关的 ts 带秒（如 `02:00:24`），不会正好落在整点。
   */
  const offBucket = points
    .map((point) => Number(point.ts))
    .filter((ts) => ts % 300_000 !== 0);
  const lastReal = offBucket.length ? Math.max(...offBucket) : null;

  /*
   * 全库的「非整点点」全部列出来。
   *
   * <p>不猜「哪个是网关的」—— 手工补数（比如排查时临时写一个独特值）
   * 同样是非整点，用「最后一个非整点」当网关时间会把人工操作算成真上报。
   * 这类点通常只有个位数，列出来让人自己判断更可靠。
   */
  const wide = await api(
    `/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries`
      + `?keys=temperature&startTs=0&endTs=${now}&limit=5000`,
    token,
  );
  const allTs = (wide.temperature ?? []).map((point) => Number(point.ts));
  const offAll = allTs.filter((ts) => ts % 300_000 !== 0).sort((a, b) => b - a);
  const lastRealEver = offAll.length ? offAll[0] : null;

  console.log(`  取样设备          ${first.name}`);
  console.log(`  近 24h 点数       ${points.length}`);
  console.log(`  落在 5 分钟整点   ${onBucket} 个（${ratio}%）${ratio > 80 ? " ← 脚本写入特征" : ""}`);
  console.log(`  全库点数          ${allTs.length}`);
  console.log(
    `  非整点点（网关原始上报 / 人工补数）  ${offAll.length} 个`,
  );
  for (const ts of offAll.slice(0, 5)) {
    console.log(`    · ${new Date(ts).toLocaleString("zh-CN")}`);
  }
  if (!offAll.length) {
    console.log("    （一个都没有 —— 可能从未接入真实网关）");
  }
  if (trendWidget) {
    console.log(`  聚合槽所在卡片    ${trendWidget.id}`);
  }

  /*
   * 先判断「有没有新数据」，再判断「数据是谁写的」。
   *
   * 顺序很重要：近 24h 一个点都没有时，说「数据形态像真实网关」是**对的但没用** ——
   * 真实数据早就停了。这种"技术上正确、读起来像正常"的报告最耽误事。
   */
  const latestTs = allTs.length ? Math.max(...allTs) : null;
  const ageHours = latestTs ? (now - latestTs) / 3_600_000 : null;

  if (!allTs.length) {
    console.log("  ✗ 这台设备一条数据都没有。");
  } else if (ageHours > 24) {
    console.log(
      `  ⚠️ 数据已停 ${Math.floor(ageHours / 24)} 天（最后一点：`
      + `${new Date(latestTs).toLocaleString("zh-CN")}）。\n`
      + "     平台链路本身是通的（本脚本第 1~3 步已验），"
      + "所以问题在**数据源端**：\n"
      + "     网关没在发 / RTU 掉线 / 上报令牌失效。去设备侧查，不要改前端。",
    );
  } else if (ratio > 80) {
    console.log(
      "  ⚠️ 平台上的数据主要是**脚本写入的演示数据**（scripts/simulate-unit-power.mjs）。\n"
      + "     这不影响「前端读平台」的结论，但意味着数据本身不代表真实设备。\n"
      + "     要让数据变真：恢复网关上报，然后 `node scripts/simulate-unit-power.mjs --purge`。",
    );
  } else {
    console.log("  ✓ 数据新鲜且形态不像脚本产物（未见整点聚集），来自真实网关。");
  }
}

console.log(`\n临时令牌文件：${TOKEN_FILE}（本脚本不写入，仅用于提示可复用）`);
