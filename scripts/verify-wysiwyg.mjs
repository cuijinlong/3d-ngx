#!/usr/bin/env node
/**
 * 验收「所见即所得」：分别打开**设计态**和**运行态**，逐项比对卡片文本。
 *
 * <h2>为什么需要自动化</h2>
 *
 * <p>「编辑器看到的和打开后不一样」不是靠肉眼能可靠发现的 —— 两边都像模像样，
 * 差别藏在某几张卡的「—」和「暂无数据」里。而且这类缺陷**不报错**：
 * 编辑器少订阅了两路设备，卡片只是安静地显示「未上报」。
 *
 * <p>2026-11-23 实际踩到的三个：
 * <ol>
 *   <li>编辑器漏订阅「槽位直绑的网关」和「scope 设备」；</li>
 *   <li>订阅启动依赖一个可能永远不发生的状态翻转（时序赌博）；</li>
 *   <li>画布只在「预览运行」后才切 HUD 深色皮肤。</li>
 * </ol>
 *
 * <h2>判据</h2>
 *
 * <p>剥离「延迟 N 分钟/小时/天」之后，两态的全部卡片文本必须逐项相等。
 * 那个标记是**数据新鲜度**提示，只有运行态该有 —— 编辑器是设计工具，
 * 不该被「刚才某台掉线」干扰。这是有意的差异，不算失败。
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/verify-wysiwyg.mjs
 * node scripts/verify-wysiwyg.mjs --scene <topologyId> --app http://127.0.0.1:5173
 * ```
 *
 * 退出码：0 一致；1 有差异（会逐条打印两边文本）。
 *
 * <h2>无界面环境</h2>
 *
 * <p>用 Chrome DevTools Protocol 驱动 headless Chrome，不需要 puppeteer。
 * **必须带 SwiftShader 参数**，否则 PlayCanvas 报
 * `Failed to create a graphics device`（无 GPU 的机器）。
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = readFlag("--app") || process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = readFlag("--scene") || process.env.SCENE_ID
  || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
/**
 * 等多久再抓。首屏出数实测 20~40 秒（SwiftShader 下 3D 启动更慢），
 * 等太短会把「还在加载」误判成「两态不一致」。
 */
const SETTLE_MS = Number(process.env.SETTLE_MS || 38_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function openAndGrab({ port, profile, path }) {
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
      "--hide-scrollbars",
      /* 没有 GPU 时必须走 SwiftShader，否则 PlayCanvas 起不来。 */
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    { stdio: "ignore" },
  );

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
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

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

    await send("Page.navigate", { url: APP + path }, sessionId);
    await sleep(SETTLE_MS);

    const snapshot = await evaluate(`(()=>{
      const cards = [...document.querySelectorAll('[class*="_card_"]')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 100 && box.height > 50;
        });
      const title = document.querySelector('[class*="cardTitle"]');
      return {
        cards: cards.map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim()),
        titleColor: title ? getComputedStyle(title).color : null,
        hud: !!document.querySelector('[data-ngx-hud="on"]'),
      };
    })()`);

    ws.close();
    return snapshot;
  } finally {
    chrome.kill();
  }
}

/** 剥掉「延迟 N 分钟/小时/天」，其余逐字保留。 */
function normalize(cards) {
  return cards
    .filter((text) => text && !text.includes("CHILLED WATER PLANT DIGITAL"))
    .map((text) => text.replace(/延迟\s*\d+\s*(分钟|小时|天)/g, "").replace(/\s+/g, " ").trim());
}

const editor = await openAndGrab({
  port: 9431,
  profile: "/tmp/pf-wysiwyg-editor",
  path: `/studio/editor/${SCENE}`,
});
const runtime = await openAndGrab({
  port: 9432,
  profile: "/tmp/pf-wysiwyg-runtime",
  path: `/digital-twin/runtime/${SCENE}`,
});

console.log("editor  titleColor:", editor.titleColor, "| hud:", editor.hud);
console.log("runtime titleColor:", runtime.titleColor, "| hud:", runtime.hud);

const left = normalize(editor.cards);
const right = normalize(runtime.cards);
console.log("卡片数 editor/runtime:", left.length, "/", right.length);

let differences = 0;
for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
  const a = left[i] || "(缺)";
  const b = right[i] || "(缺)";
  if (a !== b) {
    differences += 1;
    console.log(`  ✗ #${i}\n     edit: ${a.slice(0, 120)}\n     run : ${b.slice(0, 120)}`);
  }
}

if (differences === 0) {
  console.log("\n✓ 全部卡片逐项一致");
} else {
  console.log(`\n✗ ${differences} 处不一致`);
  process.exitCode = 1;
}
