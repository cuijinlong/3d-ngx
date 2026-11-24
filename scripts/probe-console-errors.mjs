#!/usr/bin/env node
/**
 * 抓运行态页面上的 JS 运行时错误（含 React 错误边界文案）。
 *
 * <h2>为什么需要这个</h2>
 *
 * <p>大屏崩了只显示一张「页面出了点问题」的卡片 —— 卡片本身不含错误原因。
 * 而错误发生在 PlayCanvas / React 组件树里，`Page.captureScreenshot` 只能看到结果，
 * 看不到堆栈。这个脚本挂 `Runtime.consoleAPICalled` + `Runtime.exceptionThrown`，
 * 把第一条真正的异常打出来。
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = process.env.SCENE_ID || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const PATH = readFlag("--path") || `/digital-twin/runtime/${SCENE}`;
const SETTLE_MS = Number(process.env.SETTLE_MS || 30_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readFlag(n) {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = 9437;
const profile = "/tmp/pf-console";
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
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      console.log("\n=== EXCEPTION ===");
      console.log(d.exception?.description || d.text);
      const frame = (d.stackTrace?.callFrames ?? []).slice(0, 6)
        .map((f) => `    at ${f.functionName || "(anon)"} ${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1}`);
      if (frame.length) console.log(frame.join("\n"));
    }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
      if (text && !/Download the React DevTools|Powered by PlayCanvas/.test(text)) {
        console.log(`\n[console.${m.params.type}] ${text.slice(0, 1200)}`);
      }
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
    if (r.exceptionDetails) return null;
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

  console.log("· 进入运行态，收集控制台…");
  await send("Page.navigate", { url: APP + PATH }, sessionId);
  await sleep(SETTLE_MS);

  const state = await evaluate(`(()=>{
    const cards = document.querySelectorAll('[data-testid^="scene-widget-"]').length;
    const errCard = /页面出了点问题/.test(document.body.innerText || "");
    return { cards, errCard, path: location.pathname };
  })()`);
  console.log("\n=== 页面状态 ===");
  console.log(JSON.stringify(state, null, 1));

  ws.close();
} finally {
  chrome.kill();
}
