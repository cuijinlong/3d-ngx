#!/usr/bin/env node
/**
 * 探测大屏里某几块卡内部元素的真实盒模型。
 *
 * <h2>为什么要这个</h2>
 *
 * <p>把底部横向宽卡（893×153）移进右翼竖向窄卡（317×229）后，
 * 原先按宽度设计的内部布局会失效 —— 条形被挤压、图表被裁。
 * 截图能看出「不对劲」，但看不出「哪个元素多宽、被谁挤的」。
 * 这个脚本把候选元素的 rect 打出来，用来定位。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/probe-widget-layout.mjs --widget power-trend
 * node scripts/probe-widget-layout.mjs --widget load-compare --selectors "div,span,b"
 * ```
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = process.env.SCENE_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const WIDGET = readFlag("--widget") || "power-trend";
const SETTLE_MS = Number(process.env.SETTLE_MS || 34_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = 9435;
const profile = "/tmp/pf-probe-widget";
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
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}, sessionId, timeoutMs = 60_000) => {
    const mid = ++id;
    const p = { id: mid, method, params };
    if (sessionId) p.sessionId = sessionId;
    ws.send(JSON.stringify(p));
    return Promise.race([
      new Promise((res) => pending.set(mid, res)),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`CDP 超时 ${method}`)), timeoutMs)),
    ]);
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) { console.error("异常:", r.exceptionDetails.text); return null; }
    return r.result.value;
  };

  await send("Page.navigate", { url: `${APP}/login` }, sessionId);
  for (let i = 0; i < 100; i += 1) {
    await sleep(400);
    if (await evaluate(`!!document.querySelector('#ngx-login-username')`)) break;
  }
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

  await send("Page.navigate", { url: `${APP}/digital-twin/runtime/${SCENE}` }, sessionId);
  await sleep(SETTLE_MS);

  const dump = await evaluate(`(()=>{
    const card = document.querySelector('[data-widget-id="${WIDGET}"]');
    if (!card) return { error: '找不到卡片 ${WIDGET}' };
    const cr = card.getBoundingClientRect();
    const out = [{ tag: '(card)', cls: card.className.slice(0,90), x: Math.round(cr.left), y: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height), text: '' }];
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const txt = (el.childElementCount === 0 ? (el.textContent || '') : '').trim().slice(0, 24);
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 60),
        x: Math.round(r.left), y: Math.round(r.top),
        w: Math.round(r.width), h: Math.round(r.height),
        overflow: r.right > cr.right + 1 || r.bottom > cr.bottom + 1 ? 'OVERFLOW' : '',
        text: txt,
      });
    }
    return out;
  })()`);

  if (dump?.error) { console.error(dump.error); }
  else for (const item of dump) {
    console.log(`${item.tag.padEnd(8)} ${String(item.cls).padEnd(34)} ${String(item.x).padStart(5)},${String(item.y).padStart(5)} ${String(item.w).padStart(4)}×${String(item.h).padStart(4)} ${String(item.overflow ?? "").padEnd(8)} ${item.text}`);
  }
  ws.close();
} finally {
  chrome.kill();
}
