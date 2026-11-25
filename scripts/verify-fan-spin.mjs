#!/usr/bin/env node
/**
 * 验收「3D 里的冷热机风扇两个都在转，且绕正确的轴」。
 *
 * <h2>为什么必须实测</h2>
 *
 * <p>2026-11-24 客户反馈「冷热机的转动风扇只有一半」。
 * 静态读代码只能看到「绕 Z 转」，但读不出**GLB 的动画到底有没有绑上**：
 * PlayCanvas 的动画绑定失败是**静默的** —— layer 显示 `playing: true`，
 * 画面一动不动。两条线索只有一条算数，必须分开验。
 *
 * <h2>判据（每条都要能指出错在哪）</h2>
 *
 * <ol>
 *   <li><b>播放器挂上了</b>：`1_spin_fan` / `1_spin_fan_2` 节点上有 anim 组件；</li>
 *   <li><b>绑定生效</b>：播放后两个节点的 `localRotation` 在相邻两帧真的变了
 *       —— 只看「layer playing」会被假阳性骗（这正是历史坑）；</li>
 *   <li><b>轴向正确</b>：帧间旋转的轴接近 **Y**（模型里叶片盘面在 XZ 平面）。
 *       轴是 Z 就说明还在翻跟头，那正是「只转一半」的成因；</li>
 *   <li><b>两个都在转</b>：不是「一个转一个不转」；</li>
 *   <li><b>没有手动兜底覆盖</b>：`spinNodes` 里不含这两个节点 ——
 *       手动 `rotateLocal` 与动画通道写同一份 `localRotation`，会互相顶。</li>
 * </ol>
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/verify-fan-spin.mjs        # 需要 5173 dev server + 8090 平台
 * ```
 *
 * 退出码：0 全过；1 有判据不满足（逐条打印实测值）。
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
  const port = 9451;
  const profile = "/tmp/pf-fan-spin";
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
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) console.error(`  CDP 错误 ${msg.error.code}: ${msg.error.message}`);
        resolve(msg.result);
      }
    });
    const send = (method, params = {}, sessionId, timeoutMs = 60_000) => {
      const messageId = ++id;
      const payload = { id: messageId, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return Promise.race([
        new Promise((resolve) => pending.set(messageId, { resolve })),
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

    console.log(`· 进入运行态（等 ${SETTLE_MS / 1000}s 让模型与动画就绪）…`);
    await send("Page.navigate", { url: `${APP}/digital-twin/runtime/${SCENE}` }, sessionId);
    /*
     * ★ 必须把标签页带到前台（2026-11-24 实测）。
     *
     * <p>headless 下新开的 target 可能是 hidden，而 `hidden` 的页面
     * **rAF 完全停摆** —— PlayCanvas 的 update 也就停了。
     * 表现是「风扇一动不动」，但页面自己没事，很容易误判成渲染 bug。
     */
    await send("Page.bringToFront", {}, sessionId);
    await sleep(SETTLE_MS);
    const visibility = await evaluate(`document.visibilityState`);
    check(
      visibility === "visible",
      "页面处于 visible（hidden 时 rAF 会停，测不出动画）",
      String(visibility),
    );

    /*
     * 拿引擎单例（见下方 `globalThis.__idtEngine` 的说明）。
     */
    /*
     * 从 dev-only 句柄拿引擎单例。
     *
     * <p>`import('/src/engine/...')` 拿到的是**另一个模块实例**（Vite 的 URL 带时间戳），
     * `model` 永远 null。所以引擎在 `DEV` 下把单例挂到 `globalThis.__idtEngine`，
     * 生产构建不挂。
     */
    const engineExpr = `globalThis.__idtEngine`;
    const handleReady = await evaluate(`Boolean(globalThis.__idtEngine)`);
    check(
      handleReady === true,
      "拿到页面内真实的引擎单例",
      handleReady ? "globalThis.__idtEngine" : "未挂载（仅 dev）",
    );

    const ready = await evaluate(`(async () => {
      const engine = ${engineExpr};
      return engine.model ? engine.model.byName.size : 0;
    })()`);
    check(typeof ready === "number" && ready > 1000, "模型已加载", `byName ${ready} 个节点`);
    if (!(typeof ready === "number" && ready > 1000)) {
      console.log("  模型没加载完，后续判据无法进行");
      throw new Error("model not loaded");
    }

    /* ---------- 0. 动态发现全部风扇节点 ---------- */
    /*
     * ★ 不硬编码「1 号机组」的两个风扇（2026-11-25 改）。
     *
     * 原来这里写死 `['1_spin_fan', '1_spin_fan_2']`，只能证明第 1 台机组好使。
     * 实测该 GLB 有 **18 个** 风扇节点（9 台 × 2）：
     *   1_spin_fan / 1_spin_fan_2 … 9_spin_fan / 9_spin_fan_2
     * 而动画只有 **9 个 clip**（X_spin_fan，没有 X_spin_fan_2）——
     * 每台第二风扇靠同一 clip 的 path 驱动（实测每个 clip 的 targets 都是
     * `[X_spin_fan, X_spin_fan_2]`）。
     *
     * 若只有 1 号验证，2~9 号的挂载一旦坏掉（例如 mount 选错祖先、
     * clip 映射漏了一半）脚本照样全绿 —— 客户看到的就是「一半机组不转」。
     */
    const fanNames = await evaluate(`(() => {
      const engine = ${engineExpr};
      const names = [];
      /*
       * ★ 必须同时匹配 X_spin_fan 与 X_spin_fan_2。
       *
       * 原来写的是 /spin_fans?$/ —— 只认以 spin_fan 结尾的名字，
       * 第二风扇 1_spin_fan_2 结尾是 _2，被漏掉 9 个。
       * 而「客户说只转一半」恰恰就是这 9 个在不在转。
       */
      engine.model.byName.forEach((_node, name) => {
        if (/^[0-9]+_spin_fan(_[0-9]+)?$/i.test(name)) names.push(name);
      });
      names.sort();
      return names;
    })()`);
    check(
      Array.isArray(fanNames) && fanNames.length >= 2,
      "模型里发现风扇节点",
      Array.isArray(fanNames) ? `${fanNames.length} 个：${fanNames.slice(0, 4).join("、")}…` : "未发现",
    );
    if (!Array.isArray(fanNames) || !fanNames.length) throw new Error("no fan nodes");

    /* ---------- 1. 每个风扇都有播放器与 clip ---------- */
    const perNode = await evaluate(`(() => {
      const engine = ${engineExpr};
      const names = ${JSON.stringify(fanNames)};
      const out = {};
      for (const name of names) {
        const entity = engine.findEntity(name);
        out[name] = {
          exists: Boolean(entity),
          hasAnim: Boolean(entity && entity.anim),
          clip: entity && engine.spinClipByNode ? (engine.spinClipByNode.get(entity) || null) : null,
          /* 挂载点：往上找第一个带 anim 的祖先 */
          mount: (() => {
            let node = entity;
            while (node && !node.anim) node = node.parent;
            return node ? node.name : null;
          })(),
        };
      }
      return out;
    })()`);
    console.log("· 节点/播放器：", JSON.stringify(perNode));

    const missing = Object.entries(perNode ?? {})
      .filter(([, info]) => !info.exists)
      .map(([name]) => name);
    check(missing.length === 0, "风扇节点全部存在", missing.length ? `缺失 ${missing.join("、")}` : `${fanNames.length} 个都在`);

    const mountNames = [...new Set(Object.values(perNode ?? {}).map((info) => info.mount).filter(Boolean))];
    check(
      mountNames.length > 0,
      "风扇祖先链上有 AnimComponent（播放器已挂）",
      mountNames.length ? `挂载点 ${mountNames.join(" / ")}` : "整条链上没有 anim 组件",
    );

    /* 每个节点都必须有 clip —— 少一个就是「那台机组永远不转」 */
    const noClip = Object.entries(perNode ?? {})
      .filter(([, info]) => !info.clip)
      .map(([name]) => name);
    check(
      noClip.length === 0,
      "每个风扇都有关联的转动 clip",
      noClip.length ? `没有 clip：${noClip.join("、")}` : `${Object.keys(perNode ?? {}).length} 个节点全部有 clip`,
    );
    if (noClip.length) throw new Error("fan without clip");

    /* clip 去重：每台机组的两个风扇应共用同一个 clip */
    const clipSet = [...new Set(Object.values(perNode).map((i) => i.clip))].sort();
    console.log("· clip 分布：", JSON.stringify(clipSet));

    /* ---------- 2. 逐个 clip 推进，验证它驱动的全部节点都在动 ---------- */
    /*
     * 采样前把「业务状态驱动」摘掉。
     *
     * <p>applyBindingsToScene 每个 update 都会按遥测把动画 play/pause 一次
     * （停机就 pause）。凌晨跑这个脚本时设备确实停机，直接看页面会发现
     * 「18 个风扇一个都不转」—— 那是**正确行为**，不是渲染 bug。
     * 本判据只回答「这段动画能不能驱动这些节点」，
     * 业务状态是否该停由现场数据决定。
     *
     * <p>同步推进，不依赖 rAF：headless 下页面常是 hidden，rAF 完全停摆。
     */
    const motion = await evaluate(`(() => {
      const engine = ${engineExpr};
      const sys = engine.app?.systems?.anim;
      if (!sys?.onAnimationUpdate) return { error: '拿不到动画系统' };

      const perNode = ${JSON.stringify(perNode)};
      const byClip = {};
      for (const [name, info] of Object.entries(perNode)) {
        const clip = info.clip;
        if (!clip) continue;
        (byClip[clip] = byClip[clip] || []).push(name);
      }

      const quatOf = (name) => {
        const e = engine.findEntity(name);
        if (!e) return null;
        const q = e.localRotation;
        return [q.x, q.y, q.z, q.w];
      };
      const delta = (p, q) => {
        if (!p || !q) return null;
        const dot = p[0]*q[0] + p[1]*q[1] + p[2]*q[2] + p[3]*q[3];
        const angle = 2 * Math.acos(Math.min(1, Math.abs(dot))) * 180 / Math.PI;
        if (angle < 0.01) return { axis: null, angle };
        const inv = [-p[0], -p[1], -p[2], p[3]];
        const x0 = inv[3]*q[0] + inv[0]*q[3] + inv[1]*q[2] - inv[2]*q[1];
        const y0 = inv[3]*q[1] - inv[0]*q[2] + inv[1]*q[3] + inv[2]*q[0];
        const z0 = inv[3]*q[2] + inv[0]*q[1] - inv[1]*q[0] + inv[2]*q[3];
        const len = Math.hypot(x0, y0, z0) || 1;
        return { axis: [x0/len, y0/len, z0/len].map((v) => +v.toFixed(3)), angle: +angle.toFixed(3) };
      };

      const results = [];
      for (const [clip, nodes] of Object.entries(byClip)) {
        const layer = engine.clipLayerRef?.get(clip) || null;
        if (!layer) { results.push({ clip, nodes, error: '没有 clip 的 layer' }); continue; }
        layer.play(clip.split('.')[0]);
        const frames = [];
        for (let i = 0; i < 5; i += 1) {
          sys.onAnimationUpdate(1 / 60);
          const row = {};
          for (const n of nodes) row[n] = quatOf(n);
          frames.push(row);
        }
        /* 每个节点取位移最大的一对相邻帧 */
        const perNodeBest = {};
        for (const n of nodes) {
          let best = null;
          for (let i = 1; i < frames.length; i += 1) {
            const d = delta(frames[i-1][n], frames[i][n]);
            if (d && (d.axis || d.angle > 0.01) && (!best || d.angle > best.angle)) best = d;
          }
          perNodeBest[n] = best;
        }
        results.push({ clip, nodes, perNodeBest });
      }
      return { results, clipCount: Object.keys(byClip).length };
    })()`);

    console.log("· 运动采样：", JSON.stringify(motion?.results?.map((r) => ({
      clip: r.clip, nodes: r.nodes, moved: r.error ? null : Object.values(r.perNodeBest).filter((b) => b?.axis).length,
    }))));

    if (motion?.error) {
      check(false, "能推进动画系统", motion.error);
      throw new Error(motion.error);
    }

    const stillNodes = [];
    const wrongAxis = [];
    for (const r of motion.results ?? []) {
      for (const n of r.nodes ?? []) {
        const best = r.perNodeBest?.[n];
        if (!best?.axis) { stillNodes.push(`${n}（clip ${r.clip}）`); continue; }
        /* 叶片盘面法线是 Y：|y| 应接近 1 */
        if (Math.abs(best.axis[1]) <= 0.9) wrongAxis.push(`${n}=${JSON.stringify(best.axis)}`);
      }
    }
    check(
      stillNodes.length === 0,
      `全部 ${fanNames.length} 个风扇都被动画驱动`,
      stillNodes.length ? `不转：${stillNodes.join("、")}` : `${fanNames.length} 个全部在转`,
    );
    check(
      wrongAxis.length === 0,
      "全部风扇绕 Y 轴（叶片盘面法线）",
      wrongAxis.length ? wrongAxis.join("、") : "轴向一致",
    );

    /* 手动兜底集合里不该有任何风扇节点 */
    const fallbackHit = await evaluate(`(() => {
      const engine = ${engineExpr};
      const names = ${JSON.stringify(fanNames)};
      return names.filter((name) => {
        const e = engine.findEntity(name);
        return e ? engine.spinNodes.has(e) : false;
      });
    })()`);
    check(
      Array.isArray(fallbackHit) && fallbackHit.length === 0,
      "动画驱动的节点没有被手动旋转覆盖",
      fallbackHit?.length ? `被手动接管：${fallbackHit.join("、")}` : "spinNodes 里没有风扇",
    );
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
