#!/usr/bin/env node
/**
 * 诊断大屏「部件不显示内容 / 告警偏移」。
 *
 * <p>抓四类事实，不猜：
 * <ol>
 *   <li>控制台 error / warn（被可选链吞掉的失败只留痕在控制台）</li>
 *   <li>每张卡：rect、标题、body 文本长度、是否 0 尺寸、是否越界</li>
 *   <li>overlay layer 与 canvas 的 rect（判断百分比坐标基准）</li>
 *   <li>告警卡 rect 与 stage 右下的几何关系</li>
 * </ol>
 *
 * 用法：
 *   node scripts/probe-screen-diagnose.mjs
 *   PAGES=editor,runtime node scripts/probe-screen-diagnose.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = process.env.SCENE_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const PAGES = (process.env.PAGES || "editor,runtime").split(",").map((s) => s.trim());
const SETTLE_MS = Number(process.env.SETTLE_MS || 30_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9441;
const profile = "/tmp/pf-probe-diagnose";
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--headless=new", "--no-first-run", "--window-size=1920,1080", "--hide-scrollbars",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
], { stdio: "ignore" });

try {
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* 等 */ }
    await sleep(250);
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));

  let id = 0;
  const pending = new Map();
  const logs = [];
  const netFails = [];
  const reqs = [];
  const apiCalls = [];
  const wsFrames = [];
  const sent = new Set();
  const inflight = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Network.webSocketCreated") {
      apiCalls.push(`WS-OPEN ${String(m.params?.url || "").slice(0, 90)}`);
    }
    if (m.method === "Network.webSocketFrameReceived") {
      const len = (m.params?.response?.payloadData || "").length;
      wsFrames.push(len);
    }
    if (m.method === "Network.webSocketFrameError") {
      apiCalls.push(`WS-ERR ${String(m.params?.errorMessage || "").slice(0, 80)}`);
    }
    if (m.method === "Network.webSocketClosed") {
      apiCalls.push("WS-CLOSED");
    }
    if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") {
      inflight.delete(m.params?.requestId);
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params?.response || {};
      const u = r.url || "";
      if (u.includes("/api/")) {
        apiCalls.push(`${r.status} ${u.replace(/^https?:\/\/[^/]+/, "").slice(0, 110)}`);
      }
    }
    if (m.method === "Network.loadingFailed") {
      const u = m.params?.errorText || "";
      apiCalls.push(`FAILED ${u}`);
    }
    if (m.method === "Network.requestWillBeSent") {
      const u = m.params?.request?.url || "";
      if (u.includes("/api/")) {
        inflight.set(m.params.requestId, u.replace(/^https?:\/\/[^/]+/, "").slice(0, 100));
      }
      if (u.includes("values/timeseries")) {
        const dev = (u.match(/DEVICE\/([0-9a-f-]{36})/) || [])[1] || "";
        const keys = (u.match(/keys=([^&]*)/) || [])[1] || "(无 keys)";
        reqs.push(dev.slice(0, 8) + " keys=" + decodeURIComponent(keys));
      }
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const t = m.params.type;
      if (t !== "error" && t !== "warning") return;
      const text = (m.params.args || [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
        .join(" ").slice(0, 400);
      if (!text.trim()) return;
      logs.push(`[${t}] ${text}`);
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      logs.push(`[exception] ${d.text} ${d.exception?.description?.slice(0, 300) ?? ""}`);
    }
  });

  const send = (method, params = {}, sessionId, timeoutMs = 60_000) => {
    const mid = ++id;
    const p = { id: mid, method, params };
    if (sessionId) p.sessionId = sessionId;
    ws.send(JSON.stringify(p));
    return Promise.race([
      new Promise((res) => pending.set(mid, res)),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`CDP 超时 ${method}`)), timeoutMs)),
    ]).then((m) => m?.result);
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r?.exceptionDetails) { console.error("异常:", r.exceptionDetails.text); return null; }
    return r?.result?.value;
  };

  const navigate = async (url) => {
    try { await send("Page.navigate", { url }, sessionId, 12_000); }
    catch { console.log("· navigate 响应超时（页面可能已开始加载，继续轮询）"); }
  };

  await navigate(`${APP}/login`);
  for (let i = 0; i < 100; i += 1) {
    await sleep(400);
    if (await evaluate(`!!document.querySelector('#ngx-login-username')`)) break;
  }
  const hasLogin = await evaluate(`!!document.querySelector('#ngx-login-username')`);
  if (!hasLogin) {
    console.log("· 已是登录态，跳过登录");
  } else {
    await evaluate(`(()=>{
      const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
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
    console.log("· 登录后路径:", await evaluate(`location.pathname`));
  }

  const dump = `(()=>{
    const r=(el)=>{const b=el.getBoundingClientRect();return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
    const out={ url: location.pathname + location.search, vw: innerWidth, vh: innerHeight };
    const layer=document.querySelector('[data-testid="widget-overlay"]');
    out.layer = layer ? r(layer) : null;
    const cv=document.querySelector('canvas');
    out.canvas = cv ? r(cv) : null;
    const cards=[...document.querySelectorAll('[data-widget-id]')].map((el)=>{
      const b=r(el);
      const titleEl=el.querySelector('[class*="cardTitle"]');
      const bodyEl=el.querySelector('[class*="cardBody"]');
      const bodyText=(bodyEl?bodyEl.textContent:'').replace(/\\s+/g,' ').trim();
      return {
        id: el.getAttribute('data-widget-id'),
        type: el.getAttribute('data-testid'),
        cls: String(el.className).slice(0,120),
        ...b,
        visible: b.w>0&&b.h>0,
        inView: b.x < innerWidth && b.y < innerHeight && b.x+b.w>0 && b.y+b.h>0,
        title: titleEl?titleEl.textContent.replace(/\\s+/g,' ').trim().slice(0,40):'',
        bodyLen: bodyText.length,
        bodyHead: bodyText.slice(0,80),
        bodyKids: bodyEl?bodyEl.querySelectorAll('*').length:0,
      };
    });
    out.cards=cards;
    out.cardCount=cards.length;
    out.bodyText=(document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,600);
    out.testids=[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')).slice(0,40);
    out.rootHtml=(document.querySelector('#root')?.innerHTML||'').slice(0,300);
    const pw=document.querySelector('[data-widget-id="power-trend"]');
    out.trendInner = pw ? pw.innerHTML.replace(/\s+/g,' ').slice(0,900) : null;
    return out;
  })()`;

  for (const page of PAGES) {
    const url = page === "editor"
      ? `${APP}/studio/editor/${SCENE}`
      : `${APP}/digital-twin/runtime/${SCENE}`;
    logs.length = 0; netFails.length = 0; reqs.length = 0;
    await navigate(url);
    await sleep(SETTLE_MS);
    const info = await evaluate(dump);
    console.log(`\n${"=".repeat(78)}\n== ${page} :: ${info?.url ?? url}\n${"=".repeat(78)}`);
    if (!info) { console.log("!! 抓取失败"); continue; }
    console.log(`视口 ${info.vw}×${info.vh}`);
    console.log("layer ", JSON.stringify(info.layer));
    console.log("canvas", JSON.stringify(info.canvas));
    console.log(`卡片数 ${info.cardCount}`);
    const empty = [];
    for (const c of info.cards) {
      const flags = [
        c.visible ? "" : "ZERO",
        c.inView ? "" : "OFFSCREEN",
        c.bodyLen === 0 ? "EMPTY-BODY" : "",
      ].filter(Boolean).join(",");
      console.log(`  ${String(c.id).padEnd(18)} ${String(c.type||"").replace("scene-widget-","").padEnd(16)} ${String(c.x).padStart(4)},${String(c.y).padStart(4)} ${String(c.w).padStart(4)}×${String(c.h).padStart(3)} ${flags.padEnd(26)} 标题「${c.title}」 body ${c.bodyLen}字/${c.bodyKids}节点 「${c.bodyHead}」`);
      if (c.bodyLen === 0 || !c.visible || !c.inView) empty.push(c);
    }
    console.log(`\n异常卡片: ${empty.length} / ${info.cardCount}`);
    const storeInfo = await evaluate(`(async () => {
      try {
        const t = await import('/src/stores/telemetry.store.ts');
        const d = await import('/src/stores/device.store.ts');
        const ds = d.useDeviceStore.getState();
        const ts = t.useTelemetryStore.getState();
        const keys = Object.keys(ts.latest || {});
        const byDevice = {};
        for (const k of keys) { const id = k.split(':')[0]; byDevice[id] = (byDevice[id]||0)+1; }
        return { deviceCount: (ds.devices||[]).length, loading: ds.loading,
                 latestKeys: keys.length, devicesWithData: Object.keys(byDevice).length,
                 sample: keys.filter(k=>k.includes(':power')||k.includes(':temperature')).slice(0,6) };
      } catch (e) { return { error: String(e).slice(0,160) }; }
    })()`);
    const probeFetch = await evaluate(`(async () => {
      try {
        const tok = localStorage.getItem('ngx.token') || localStorage.getItem('token') || document.cookie.match(/token=([^;]+)/)?.[1];
        const longKeys = 'power,temperature,running,opening,water_in_temp,water_out_temp,sys_mode,compressor_state,alarm_code,sys_run_state,ambient_temp,status,online,rpcCount,led,door,gauge,frequency,pump_freq,sys_run_state,alarm_code,running,power,temperature';
        const url = '/api/plugins/telemetry/DEVICE/4402d2e9-e50c-11f1-9407-71dd197ec25f/values/timeseries?keys=' + longKeys + '&useStrictDataTypes=true';
        const t0 = performance.now();
        const ac = new AbortController(); const tm = setTimeout(()=>ac.abort(), 8000);
        const r = await fetch(url, { headers: tok ? { 'X-Authorization': 'Bearer ' + tok } : {}, signal: ac.signal });
        clearTimeout(tm);
        const txt = await r.text();
        return { status: r.status, ms: Math.round(performance.now()-t0), hasToken: !!tok, body: txt.slice(0,120) };
      } catch (e) { return { error: String(e).slice(0,120) }; }
    })()`);
    console.log(`\n浏览器内直测: ${JSON.stringify(probeFetch)}`);
    console.log(`\nstore 状态: ${JSON.stringify(storeInfo)}`);
    console.log(`\n页面可见文本: 「${info.bodyText}」`);
    console.log(`data-testid: ${JSON.stringify(info.testids)}`);
    console.log(`#root 片段: ${(info.rootHtml || '').slice(0, 200)}`);
    console.log(`trend 内部: ${(info.trendInner || '').slice(0, 700)}`);
    const bad = [...new Set(apiCalls)].filter((c) => !/^2\d\d /.test(c));
    console.log(`\nAPI 失败/异常 (${bad.length}):`);
    for (const b of bad.slice(0, 15)) console.log("  " + b);
    console.log(`\nAPI 请求总数: ${apiCalls.length}`);
    console.log(`\n★ 请求已发出但从未返回（${inflight.size}）:`);
    for (const [, u] of [...inflight].slice(0, 10)) console.log("  " + u);
    console.log(`实际发出的 API（去重 ${sent.size}）:`);
    for (const x of [...sent].slice(0, 25)) console.log("  " + x);
    const ws = apiCalls.filter((c) => c.startsWith("WS-"));
    console.log(`WebSocket: ${JSON.stringify([...new Set(ws)].slice(0, 6))}  收到帧数=${wsFrames.length}`);
    console.log(`\nvalues/timeseries 请求 (${reqs.length}):`);
    for (const r of [...new Set(reqs)].slice(0, 12)) console.log("  " + r);
    console.log(`\n控制台 error/warn (${logs.length}):`);
    for (const l of [...new Set(logs)].slice(0, 30)) console.log("  " + l);
    console.log(`\n网络失败 (${netFails.length}):`);
    for (const l of [...new Set(netFails)].slice(0, 20)) console.log("  " + l);
  }
  ws.close();
} finally {
  chrome.kill();
}
