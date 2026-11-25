#!/usr/bin/env node
/**
 * 给大屏编辑态/运行态截一张全屏图，用于人工核对视觉结果。
 *
 * <p>为什么不用「读 DOM 即可」：告警跑马灯的间距、玻璃卡的重叠、
 * 3D 的占比 —— 这些只有在图上才看得出来。DOM rect 相等也可能是
 * 视觉上压住了（z-index、pointer-events、半透明叠加）。
 *
 * 用法：
 *   node scripts/shot-screen.mjs
 *   PAGES=runtime node scripts/shot-screen.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = process.env.SCENE_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const PAGES = (process.env.PAGES || "editor,runtime").split(",").map((s) => s.trim());
const SETTLE_MS = Number(process.env.SETTLE_MS || 45_000);
const OUT = process.env.OUT_DIR || "_tmp-ngx-shots";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9443;
const profile = "/tmp/pf-shot-screen";
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(OUT, { recursive: true });

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
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
  const navigate = async (url) => {
    try { await send("Page.navigate", { url }, sessionId, 12_000); } catch { /* 继续轮询 */ }
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return r?.result?.value;
  };

  await navigate(`${APP}/login`);
  for (let i = 0; i < 100; i += 1) {
    await sleep(400);
    if (await evaluate(`!!document.querySelector('#ngx-login-username')`)) break;
  }
  if (await evaluate(`!!document.querySelector('#ngx-login-username')`)) {
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
  }

  for (const page of PAGES) {
    const url = page === "editor"
      ? `${APP}/studio/editor/${SCENE}`
      : `${APP}/digital-twin/runtime/${SCENE}`;
    await navigate(url);
    await sleep(SETTLE_MS);
    /* PlayCanvas 走 swiftshader 软件渲染，截图可能很慢，给足 180s */
    const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId, 180_000);
    if (!shot?.data) { console.log(`${page}: 截图失败`); continue; }
    const file = `${OUT}/screen-${page}.png`;
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`${page}: ${file}`);
  }
  ws.close();
} finally {
  chrome.kill();
}
