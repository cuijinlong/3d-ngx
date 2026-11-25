#!/usr/bin/env node
/**
 * 验收「铭牌只在点击后出现，鼠标悬停不出现」（2026-11-25 客户要求）。
 *
 * 客户原话：「鼠标指向模块机不要显示铭牌，当时当鼠标点击模块机才要显示铭牌」。
 *
 * <h2>为什么必须实测</h2>
 *
 * <p>这类「该显示却没显示 / 不该显示却显示了」的问题，单元测试只能覆盖过滤函数，
 * 覆盖不到「拾取 → 选中 → 渲染」这条链。历史上就在这条链上踩过：
 * 过滤函数改对了，但 `hoveredNode` 仍从外层传进来，铭牌照样跟着鼠标跑。
 *
 * <h2>判据</h2>
 *
 * <ol>
 *   <li>模型加载完成（否则无从点选）；</li>
 *   <li>**鼠标悬停**到 1# 模块机上 → 铭牌数 = 0；</li>
 *   <li>**点击**同一位置 → 出现且只有 1 张铭牌，`data-node` 就是该机组；</li>
 *   <li>点击空白处 → 铭牌清空（不能「留着上一次的」）。</li>
 * </ol>
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/verify-nameplate-select-only.mjs
 * ```
 *
 * 退出码：0 全过；1 有判据不满足。
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = flag("--app") || process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = flag("--scene") || process.env.SCENE_ID
  || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const SETTLE_MS = Number(process.env.SETTLE_MS || 40_000);
const TARGET = flag("--node") || "1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const failures = [];
function check(ok, label, detail) {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function main() {
  const port = 9461;
  const profile = "/tmp/pf-nameplate";
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
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")), { once: true });
      setTimeout(() => reject(new Error("WebSocket 连接超时")), 15_000);
    });

    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
      }
    });
    const send = (method, params = {}, sessionId, timeoutMs = 60_000) => {
      const messageId = ++id;
      const payload = { id: messageId, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return Promise.race([
        new Promise((resolve) => pending.set(messageId, resolve)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), timeoutMs)),
      ]);
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
      if (result.exceptionDetails) {
        console.error("evaluate 异常:", result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return null;
      }
      return result.result.value;
    };

    console.log("· 登录…");
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

    console.log(`· 进入运行态（等 ${SETTLE_MS / 1000}s 让模型就绪）…`);
    await send("Page.navigate", { url: `${APP}/digital-twin/runtime/${SCENE}` }, sessionId);
    await send("Page.bringToFront", {}, sessionId);
    await sleep(SETTLE_MS);

    const ready = await evaluate(`(async () => {
      const engine = globalThis.__idtEngine;
      return engine?.model ? engine.model.byName.size : 0;
    })()`);
    check(typeof ready === "number" && ready > 1000, "模型已加载", `byName ${ready} 个节点`);
    if (!(typeof ready === "number" && ready > 1000)) throw new Error("model not loaded");

    /*
     * 算出目标机组在页面上的坐标。
     *
     * <p>`worldToScreen` 给的是**画布内**像素，CDP/事件要的是 **viewport** 坐标，
     * 所以必须加上 canvas 的 rect 偏移 —— 漏这一步会点到旁边的卡片上，
     * 然后得出「点击没反应」的错误结论。
     */
    const point = await evaluate(`(() => {
      const engine = globalThis.__idtEngine;
      const screen = engine.worldToScreen(${JSON.stringify(TARGET)});
      if (!screen || !screen.visible) return { error: '节点不在可视区域', screen };
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + screen.x, y: rect.top + screen.y, screen, rect: { left: rect.left, top: rect.top } };
    })()`);
    check(!point?.error, `${TARGET} 在可视区域内`, point?.error ?? `(${Math.round(point?.x)}, ${Math.round(point?.y)})`);
    if (point?.error) throw new Error(point.error);

    /*
     * 用 Canvas 上的 PointerEvent 而不是 CDP 的 Input.dispatchMouseEvent：
     * 后者在 headless + SwiftShader 下有时不派发到 canvas（同 verify-device-focus.mjs 的结论）。
     *
     * <p>必须成对派发 pointerdown/pointerup 且 pointerId 一致 ——
     * EngineBridge 用 pointerId 判断「按下的还是同一个指头」。
     */
    const fire = (type, x, y, pointerId = 7) => `(() => {
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
        bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y},
        pointerId: ${pointerId}, pointerType: 'mouse', button: 0, buttons: ${type === "pointerup" ? 0 : 1},
      }));
      return true;
    })()`;

    const plateCount = () => evaluate(`document.querySelectorAll('[data-testid="device-plate"]').length`);
    const plateNodes = () => evaluate(`[...document.querySelectorAll('[data-testid="device-plate"]')].map((el) => el.dataset.node)`);

    /*
     * 等一个条件成立（最多 timeoutMs）。
     *
     * <p>为什么不能固定 sleep：`onUp` 里是 `pickEntityAt(...).then(...)` ——
     * 拾取是**异步**的（raycast 走 PlayCanvas 的 requestPicker，回调在下一帧）。
     * 固定 sleep(800) 在 CI/headless/SwiftShader 下偶尔不够：实测同一脚本
     * 连跑三次，两次判「点击没反应」，其实是断言跑在回调之前。
     *
     * <p>判据仍然严格（必须最终出现铭牌），只是不再假设「800ms 一定够」。
     * 反过来，真故障时轮询会耗尽超时并如实报失败，不会把 bug 掩盖成超时。
     */
    const waitFor = async (fn, predicate, timeoutMs = 4000, stepMs = 100) => {
      const deadline = Date.now() + timeoutMs;
      let last;
      do {
        last = await fn();
        if (predicate(last)) return last;
        await sleep(stepMs);
      } while (Date.now() < deadline);
      return last;
    };

    /* ---------- 1. 悬停不显示 ---------- */
    await evaluate(fire("pointerdown", 5, 5));
    await evaluate(fire("pointerup", 5, 5));
    await sleep(300);
    const blankBefore = await plateCount();
    check(blankBefore === 0, "初始没有铭牌", `铭牌 ${blankBefore} 张`);

    /*
     * 悬停判据是「**始终**没有铭牌」，所以这里必须给足观察窗口，
     * 不能像别的判据那样一旦条件成立就早退 —— 早退等于没验证。
     */
    await evaluate(fire("pointermove", point.x, point.y));
    await sleep(700);
    await evaluate(fire("pointermove", point.x + 3, point.y + 2));
    await sleep(700);
    const hoverCount = await plateCount();
    check(hoverCount === 0, "★ 鼠标悬停到模块机不显示铭牌", `铭牌 ${hoverCount} 张`);
    const hoverNodes = await plateNodes();
    check(
      Array.isArray(hoverNodes) && hoverNodes.length === 0,
      "悬停时没有任何铭牌节点",
      JSON.stringify(hoverNodes),
    );

    /* ---------- 2. 点击显示 ---------- */
    await evaluate(fire("pointerdown", point.x, point.y));
    await sleep(60);
    await evaluate(fire("pointerup", point.x, point.y));
    const clickNodes = await waitFor(plateNodes, (n) => Array.isArray(n) && n.length === 1);
    check(
      Array.isArray(clickNodes) && clickNodes.length === 1,
      "★ 点击模块机出现且只有一张铭牌",
      JSON.stringify(clickNodes),
    );
    check(
      Array.isArray(clickNodes) && clickNodes[0] === TARGET,
      "铭牌属于被点击的机组",
      `期望 ${TARGET}，实际 ${JSON.stringify(clickNodes)}`,
    );

    /* ---------- 3. 悬停别的机组不新增铭牌 ---------- */
    const other = await evaluate(`(() => {
      const engine = globalThis.__idtEngine;
      const screen = engine.worldToScreen('2');
      if (!screen || !screen.visible) return null;
      const rect = document.querySelector('canvas').getBoundingClientRect();
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    })()`);
    if (other) {
      await evaluate(fire("pointermove", other.x, other.y));
      await sleep(600);
      const afterHoverOther = await plateNodes();
      check(
        Array.isArray(afterHoverOther) && afterHoverOther.length === 1 && afterHoverOther[0] === TARGET,
        "悬停另一台机组时铭牌仍是已选中的那台（不跟着鼠标跑）",
        JSON.stringify(afterHoverOther),
      );
    } else {
      console.log("· 跳过「悬停另一台机组」判据：2# 不在可视区域");
    }

    /* ---------- 4. 点空白清空 ---------- */
    const blank = await evaluate(`(() => {
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + 12, y: rect.top + rect.height - 12 };
    })()`);
    await evaluate(fire("pointerdown", blank.x, blank.y));
    await sleep(60);
    await evaluate(fire("pointerup", blank.x, blank.y));
    const afterBlank = await waitFor(plateCount, (n) => n === 0);
    check(afterBlank === 0, "点空白后铭牌清空", `铭牌 ${afterBlank} 张`);
  } finally {
    chrome.kill();
  }

  console.log("");
  if (failures.length) {
    console.log(`✗ ${failures.length} 条判据未通过：`);
    for (const item of failures) console.log(`  - ${item}`);
    process.exitCode = 1;
  } else {
    console.log("✓ 全部判据通过");
  }
}

main().catch((error) => {
  console.error(`✗ 验证中断：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
