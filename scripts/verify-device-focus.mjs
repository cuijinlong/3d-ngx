#!/usr/bin/env node
/**
 * 验收「点击设备进入专题模式」+「默认视角不要太小」（docs/twin-unit-maindata-plan.md §12）。
 *
 * <h2>为什么必须自动化</h2>
 *
 * <p>专题模式是**几何 + 过渡 + 选中态**三件事叠出来的：
 * 外围卡滑出、选中卡变抽屉、退出后要回到原坐标。任何一环坏了都不报错 ——
 * 卡片只是停在错的位置，或点了「×」没反应。靠肉眼看截图很容易漏掉
 * 「退出后位置差了几像素」这类问题。
 *
 * <h2>前提：布局里要有「选中机组」卡</h2>
 *
 * <p>2026-11-23 客户要求从大屏删掉「选中机组」与「系统控制」，专题模式因此**失去了载体**：
 * 外围卡滑出后没有抽屉补位，比不滑更糟。所以 `WidgetOverlay` 的 `deviceFocused`
 * 加了「布局里存在 selection-card」这个前提。
 *
 * <p>本脚本会先检测这张卡：
 * <ul>
 *   <li>**有** → 跑全部判据；</li>
 *   <li>**没有** → 打印「专题模式不适用」并退出 0（不是失败）——
 *       当前布局本来就不该出现抽屉，硬把它当失败会让人以为功能坏了。</li>
 * </ul>
 *
 * <h2>判据（逐条对应 §12.4）</h2>
 *
 * <ol>
 *   <li>未选中时：选中卡在原布局位（右侧窄卡），无关闭按钮；</li>
 *   <li>点击 3D 机组 → 进入专题：选中卡几何变为抽屉（x≥60%、w≈31.5%）；</li>
 *   <li>外围统计卡**滑出视野**（rect 整体移出视口，或位移超过卡片宽度一半）——
 *       只变暗不算，那还占着位置；</li>
 *   <li>抽屉里出现该设备名 / 参数 / 操作区；</li>
 *   <li>点「×」→ 关闭按钮消失，选中卡回到原布局位，外围卡回位；</li>
 *   <li>连续点两台不同机组 → 抽屉里的设备名必须跟着换（不能一直是第一台）。</li>
 * </ol>
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/verify-device-focus.mjs
 * node scripts/verify-device-focus.mjs --scene <topologyId> --shot /tmp/focus.png
 * ```
 *
 * 退出码：0 全过；1 有判据不满足（逐条打印实测值）。
 *
 * <h2>无界面环境</h2>
 *
 * <p>Chrome DevTools Protocol + headless Chrome，且必须带 SwiftShader 参数，
 * 否则 PlayCanvas 起不来（与 verify-wysiwyg.mjs 同一套限制）。
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const APP = readFlag("--app") || process.env.APP_BASE || "http://127.0.0.1:5173";
const SCENE = readFlag("--scene") || process.env.SCENE_ID
  || "dfbc1da0-e66c-11f1-9554-01523035eefa";
const USER = process.env.TB_USER || "tenant@126.com";
const PASS = process.env.TB_PASS || "12345678";
const SHOT = readFlag("--shot");
const SETTLE_MS = Number(process.env.SETTLE_MS || 38_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const failures = [];
function check(ok, label, detail) {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/**
 * 打印汇总并设置退出码。
 *
 * <p>必须是一个函数：跳过分支要 `return`（不跑专题判据），
 * 但**不能连失败汇总一起跳过** —— 第一版就是直接 `return`，
 * 结果跳过分支里的 check 失败时退出码仍是 0，属于静默失败。
 */
function summarize() {
  console.log("");
  if (failures.length) {
    console.log(`✗ ${failures.length} 条判据未通过：`);
    for (const item of failures) console.log(`  - ${item}`);
    process.exitCode = 1;
  } else {
    console.log("✓ 全部判据通过");
  }
}

async function main() {
  const port = 9433;
  const profile = "/tmp/pf-device-focus";
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
    console.log("· 启动 headless Chrome…");
    for (let i = 0; i < 120; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) break;
      } catch { /* 还没起来 */ }
      await sleep(250);
    }

    console.log("· 连接调试端口…");
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")), { once: true });
      setTimeout(() => reject(new Error("WebSocket 连接超时")), 15_000);
    });
    console.log("· 调试通道已连接");

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
    /*
     * 每个 CDP 请求都要有超时。
     *
     * <p>第一版没有超时，实测在 headless + SwiftShader 下**整个脚本卡死 8 分钟**
     * 且不报任何错 —— 某一个请求（多半是导航后的 evaluate）永远等不到响应，
     * `await` 就挂在那里。超时让「卡住」变成「一条明确的失败」，
     * 否则只能靠 ps 看 Chrome 还在跑来猜。
     */
    const send = (method, params = {}, sessionId, timeoutMs = 60_000) => {
      const messageId = ++id;
      const payload = { id: messageId, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return Promise.race([
        new Promise((resolve) => pending.set(messageId, { resolve })),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), timeoutMs),
        ),
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
        console.error("evaluate 异常:", result.exceptionDetails.text);
        return null;
      }
      return result.result.value;
    };

    /* ---------- 登录 ---------- */
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

    /* ---------- 进入运行态 ---------- */
    console.log(`· 进入运行态（等 ${SETTLE_MS / 1000}s 首屏）…`);
    await send("Page.navigate", { url: `${APP}/digital-twin/runtime/${SCENE}` }, sessionId);
    await sleep(SETTLE_MS);
    console.log("· 首屏已等够，开始度量");

    const rectOf = (testId) => `(()=>{
      const el = document.querySelector('[data-testid="${testId}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`;

    const vw = 1920;

    /* ---------- 布局快照（与专题模式无关，总是可验） ---------- */
    /*
     * 直接量 DOM 而不是读平台 JSON：JSON 对只证明「库里对」，
     * 而用户看到的是浏览器渲染结果。两者之间隔着解析、surface 过滤、
     * 百分比换算 —— 每一步都可能让某块卡不出现。
     */
    const snapshot = await evaluate(`(()=>{
      const nodes = [...document.querySelectorAll('[data-testid^="scene-widget-"]')];
      return nodes.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          type: el.getAttribute('data-testid').replace('scene-widget-', ''),
          id: el.getAttribute('data-widget-id'),
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
          text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        };
      });
    })()`);
    console.log("\n· 屏幕上的部件：");
    for (const item of snapshot ?? []) {
      console.log(`    ${item.id ?? "?"} [${item.type}] x=${item.x} y=${item.y} ${item.w}×${item.h} | ${item.text}`);
    }
    const rightColumn = (snapshot ?? []).filter((item) => item.x >= vw * 0.75);
    const leftColumn = (snapshot ?? []).filter((item) => item.x < vw * 0.25 && item.type !== "title");
    check(
      rightColumn.length >= 3,
      "右翼至少 3 块（碳排放 / 机组状态 / 告警跑马灯）",
      `实际 ${rightColumn.length} 块：${rightColumn.map((i) => i.id).join(", ")}`,
    );
    check(
      leftColumn.length >= 3,
      "左翼至少 3 块（用电量 / 趋势 / 排名）",
      `实际 ${leftColumn.length} 块：${leftColumn.map((i) => i.id).join(", ")}`,
    );
    /*
     * 客户点名说了“哪个移到左边/右边”，所以按**部件 id**验位置，
     * 不只看“左右各三块”—— 两边数量都对你也不能证明谁在谁那边。
     */
    const placeOf = (id) => (snapshot ?? []).find((item) => item.id === id);
    const expectations = [
      ["power-trend", "left", "场站用电趋势"],
      ["load-compare", "left", "设备用电排名"],
      ["plant-capacity", "right", "碳排放核算"],
      ["unit-list", "right", "机组状态"],
      ["alarm-ticker", "right", "告警跑马灯"],
      ["system-power", "left", "场站用电量"],
    ];
    for (const [id, side, label] of expectations) {
      const item = placeOf(id);
      if (!item) { check(false, `${label}（${id}）在屏幕上`); continue; }
      const onLeft = item.x < vw / 2;
      check(onLeft === (side === "left"), `${label} 在${side === "left" ? "左" : "右"}翼`,
        `x=${item.x}px`);
    }

    /*
     * 「各个部件再大一点」：实测宽度 ≥ 17% 视口（1920 下 ≥326px）。
     * 上一版是 16.5%（317px），17% 是这一轮的底线。
     */
    const sideCards = [...leftColumn, ...rightColumn].filter((i) => i.type !== "title");
    if (sideCards.length) {
      const minW = Math.min(...sideCards.map((i) => i.w));
      check(minW >= 350, "侧栏卡片宽度 ≥350px（1920 下）", `最窄 ${minW}px`);
    }
    /*
     * 「移过来的两块」必须在右侧，且不能再有底部卡。
     * 只判「有 3 块在右侧」不够 —— 旧布局的底部两块也是宽卡，
     * 如果只是被追加到右翼而没真正换列，位置会错得很明显。
     */
    const bottomCards = (snapshot ?? []).filter((item) => item.y > 1080 * 0.78 && item.w > vw * 0.3);
    check(bottomCards.length === 0, "底部不再有宽卡（趋势/对比已上移）",
      bottomCards.length ? `仍有：${bottomCards.map((i) => i.id).join(", ")}` : "无");

    /*
     * 机组列表 9 台全显（§10 验收判据）。
     *
     * <p>「另有 N 项无数据」这个折叠文案本来是「显示不下」的遮羞布，
     * 写成了「无数据」—— 会让人以为设备掉线。放大卡片的目的就是消掉它。
     * 所以只看宽高不够，必须看完整文本。
     */
    const listText = await evaluate(`(()=>{
      const el = document.querySelector('[data-widget-id="unit-list"]');
      return el ? (el.innerText || '').replace(/\\s+/g, ' ') : null;
    })()`);
    if (listText) {
      const shown = new Set((listText.match(/模块机\s*(\d+)#/g) ?? []).map((m) => m.replace(/\D/g, "")));
      check(shown.size >= 9, "机组列表 9 台全部可见", `识别到 ${shown.size} 台：${[...shown].sort((a, b) => a - b).join(",")}`);
      check(!listText.includes("另有"), "机组列表没有「另有 N 项」折叠", "无折叠");
    }

    /*
     * 截图必须在这里拍，**不能**放到专题模式判据之后。
     *
     * <p>实测踩过：布局无 selection-card 时脚本在 300 行左右就 `return` 了，
     * 而截图代码在 424 行 —— 传了 `--shot` 却什么都没生成，脚本还报「全部通过」。
     * 「验收工具不产出证据」比不验收更坑人。
     */
    if (SHOT) {
      const shot = await send("Page.captureScreenshot", { format: "png" }, sessionId, 90_000);
      if (shot?.data) {
        writeFileSync(SHOT, Buffer.from(shot.data, "base64"));
        console.log(`  截图已存：${SHOT}`);
      } else {
        check(false, "截图生成", "Page.captureScreenshot 未返回数据");
      }
    }

    /*
     * 趋势卡：图表必须占满卡片宽度（2026-11-23）。
     *
     * <p>把底部横卡移到右翼后，`.trendRow` 原来还是横向 flex，
     * KPI 吃掉一半宽度，图表只剩 **167px/295px**。截图看着像「图被挤没了」，
     * 但没有任何报错 —— 曲线只是变窄。所以量一下比例。
     */
    const trendProbe = await evaluate(`(()=>{
      const card = document.querySelector('[data-widget-id="power-trend"]');
      if (!card) return null;
      const body = card.querySelector('[class*="cardBody"]');
      const chart = card.querySelector('canvas');
      if (!body || !chart) return null;
      const b = body.getBoundingClientRect();
      const c = chart.getBoundingClientRect();
      return { bodyW: Math.round(b.width), chartW: Math.round(c.width), chartH: Math.round(c.height) };
    })()`);
    if (trendProbe) {
      const ratio = trendProbe.chartW / trendProbe.bodyW;
      check(ratio >= 0.85, "趋势图横向占满卡片（≥85%）",
        `${trendProbe.chartW}/${trendProbe.bodyW} = ${(ratio * 100).toFixed(0)}%`);
      check(trendProbe.chartH >= 90, "趋势图有可用高度（≥90px）", `${trendProbe.chartH}px`);
    }

    /*
     * 趋势卡里不得再有左侧大数字（2026-11-23 客户明确要求去掉）。
     *
     * <p>它与同一列的上一张卡（场站用电量）显示同一个总量，
     * 重复占位且挤掉图表宽度。用文本断言，不靠肉眼看截图。
     */
    const trendKpiGone = await evaluate(`(()=>{
      const card = document.querySelector('[data-widget-id="power-trend"]');
      if (!card) return null;
      const body = card.querySelector('[class*="cardBody"]');
      const text = body ? (body.innerText || '').replace(/\\s+/g, ' ') : '';
      /* 「62.51万」「62.51万kW·h」这类大数字会带「万」或在首行，属于「左侧大数字」 */
      const hasKpiBlock = !!card.querySelector('[class*="trendKpi"]');
      return { hasKpiBlock, text: text.slice(0, 80) };
    })()`);
    if (trendKpiGone) {
      check(!trendKpiGone.hasKpiBlock, "趋势卡内部已无左侧大数字块",
        trendKpiGone.hasKpiBlock ? "仍存在 trendKpi" : "已移除");
    }

    /*
     * 标题条内元素不得重叠（2026-11-23）。
     *
     * <p>粒度切换原本是 `position: absolute; top:2; right:6`，在窄卡的标题行上
     * 与「延迟 N 天」标记真重叠（实测 1787~1865 vs 1815~1861）。
     * 文字压文字，两个信息都不能完整读。
     *
     * <p>★ 只比较**兄弟节点**。第一版写的是 `[class*="cardTitle"] > *`，
     * 于是把 `.cardTitleText` 和它自己的子元素 `.cardTitleMark` 也当成一对 ——
     * 父子自然重叠，判据永远报错。这类「选择器写宽了」的假阳性比漏报更费时间：
     * 看起来像真问题，但截图里什么都看不出来。
     */
    const overlap = await evaluate(`(()=>{
      const card = document.querySelector('[data-widget-id="power-trend"]');
      if (!card) return null;
      const title = card.querySelector('[class*="cardTitle"]');
      if (!title) return null;
      /* 只看 title 的直接子元素：它们才是并排摆放、可能互相压住的 */
      const siblings = [...title.children]
        .map((el) => ({
          cls: (String(el.className) || el.tagName).replace(/_\\w+$/, ''),
          r: el.getBoundingClientRect(),
        }))
        .filter((item) => item.r.width > 2 && item.r.height > 2);
      const hits = [];
      for (let i = 0; i < siblings.length; i += 1) {
        for (let j = i + 1; j < siblings.length; j += 1) {
          const a = siblings[i].r; const b = siblings[j].r;
          const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (dx > 2 && dy > 2) hits.push(siblings[i].cls + " × " + siblings[j].cls);
        }
      }
      return hits;
    })()`);
    check((overlap ?? []).length === 0, "标题条内元素不重叠",
      (overlap ?? []).length ? (overlap ?? []).join("; ") : "无重叠");

    /*
     * ★ 左 1 与左 3 不得长得一样（2026-11-23 客户反馈）。
     *
     * <p>客户原话：「左侧第 3 个和第一个有重复设备用电排名」。
     * 根因：左 1 当时列的是「品种 + 用量」逐行列表，与左 3 的
     * 「设备 + 用量」在 326px 宽里形态完全一样。
     *
     * <p>2026-11-23 客户改口径：左 1 去掉峰谷，改成「今日/本周/本月/本年」
     * 四格汇总；左 3 仍是逐台排名。这条断言直接查 DOM：
     * 左 1 必须有四格汇总且**不能**有排名块，反之亦然。
     *
     * <p>同时锁住「峰谷已移除」—— 客户明确说「峰值和谷值先去掉」，
     * 它要是又被加回来，两条卡会重新长成一个样子。
     */
    const leftShape = await evaluate(`(()=>{
      const card1 = document.querySelector('[data-widget-id="system-power"]');
      const card3 = document.querySelector('[data-widget-id="load-compare"]');
      if (!card1 || !card3) return null;
      return {
        card1Rollup: !!card1.querySelector('[data-testid="energy-rollup"]'),
        card1RollupCells: card1.querySelectorAll('[data-testid="energy-rollup"] > *').length,
        card1Peak: !!card1.querySelector('[data-testid="energy-peak-trough"]'),
        card1Ranking: !!card1.querySelector('[data-testid^="energy-ranking-"]'),
        /* 2026-11-23 起左 3 是「用能分项占比」，不再是设备排名 */
        card3Breakdown: !!card3.querySelector('[data-testid^="energy-breakdown-"]'),
        card3Ranking: !!card3.querySelector('[data-testid^="energy-ranking-"]'),
      };
    })()`);
    if (leftShape) {
      check(leftShape.card1Rollup, "左 1 有今日/本周/本月/本年四格汇总");
      check(leftShape.card1RollupCells === 4, "四格汇总正好 4 项",
        `实际 ${leftShape.card1RollupCells} 项`);
      check(!leftShape.card1Peak, "★ 峰值/谷值已按客户要求移除");
      check(!leftShape.card1Ranking, "★ 左 1 不含设备排名列表（与左 3 不重复）");
      check(leftShape.card3Breakdown, "左 3 是「用能分项占比」（客户：「设备用电排行没有用」）");
      check(!leftShape.card3Ranking, "左 3 不再是逐台设备排名（单位不可比的旧逻辑已移除）");
    }

    /*
     * 卡片内容不溢出 + 内容不重复（2026-11-23 客户报障）。
     *
     * <p>客户原话：「左侧第一个样式有问题」「右侧第一个部件样式有问题，
     * 里面内容超出边界」。实测两张卡都不溢出（overflow=0），
     * 但**碳排放卡把「折标煤 77.54 tce」写了两遍**（副标题 + 三格），
     * 看起来就像「内容挤在一起出了界」。
     *
     * <p>所以判据不是只看 overflow，还要看同一句关键信息出现了几次。
     */
    const cardFit = await evaluate(`(()=>{
      const inspect = (id) => {
        const c = document.querySelector('[data-widget-id="' + id + '"]');
        if (!c) return null;
        const body = c.querySelector('[class*="cardBody"]');
        const text = (c.innerText || '').replace(/\\s+/g, ' ');
        return {
          overflow: body ? body.scrollHeight - Math.round(body.getBoundingClientRect().height) : 0,
          /* 「折标煤」在碳排卡正文里应只出现 1 次（三格第一格） */
          tceMentions: (text.match(/折标煤/g) || []).length,
          hasRollup: !!c.querySelector('[data-testid="energy-rollup"]'),
          hasBreakdown: !!c.querySelector('[data-testid^="energy-breakdown"]'),
          /* 旧的「设备用电排名」判据：不应再出现计量表名 */
          hasMeterName: /电表|热力表|蒸汽表/.test(text),
        };
      };
      return { left1: inspect('system-power'), right1: inspect('plant-capacity'), left3: inspect('load-compare') };
    })()`);

    for (const [key, label] of [["left1", "左 1 场站用电量"], ["right1", "右 1 碳排放核算"], ["left3", "左 3 用能分项"]]) {
      const item = cardFit?.[key];
      if (!item) { check(false, `${label} 在屏幕上`); continue; }
      check(item.overflow <= 2, `${label} 内容不溢出`, `溢出 ${item.overflow}px`);
    }
    if (cardFit?.right1) {
      check(cardFit.right1.tceMentions <= 1, "★ 右 1 不再重复显示「折标煤」",
        `出现 ${cardFit.right1.tceMentions} 次`);
    }
    if (cardFit?.left3) {
      check(cardFit.left3.hasBreakdown, "★ 左 3 已换成用能分项占比");
      check(!cardFit.left3.hasMeterName, "左 3 不再按计量表排名（单位不可比的旧逻辑）");
    }

    /*
     * 告警跑马灯（2026-11-23）。
     *
     * <p>四条判据，对应客户的三句话：
     * <ol>
     *   <li>「加一个告警列表跑马灯效果」—— 有卡片、有滚动轨道；</li>
     *   <li>「把设备手册的原型写在告警中」—— 条目里有「原因 / 处理」；</li>
     *   <li>「右上角有个等级筛选」—— 三个筛选按钮存在；</li>
     *   <li>「把最严重的常驻」—— 常驻区的那条 severity 高于滚动区的。</li>
     * </ol>
     */
    const ticker = await evaluate(`(()=>{
      const card = document.querySelector('[data-widget-id="alarm-ticker"]');
      if (!card) return null;
      const pinned = card.querySelector('[data-testid="alarm-ticker-pinned"]');
      const items = [...card.querySelectorAll('[data-testid="alarm-ticker-item"]')];
      const filters = [...card.querySelectorAll('[data-testid^="alarm-filter-"]')];
      const text = (card.innerText || '').replace(/\\s+/g, ' ');
      return {
        hasPinned: !!pinned,
        pinnedLevel: pinned ? pinned.getAttribute('data-level') : null,
        pinnedText: pinned ? (pinned.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) : null,
        itemCount: items.length,
        hasTrack: !!card.querySelector('[data-testid="alarm-ticker-track"]'),
        filterCount: filters.length,
        filterLabels: filters.map((el) => (el.innerText || '').replace(/\\s+/g, '').trim()),
        hasCause: text.includes('原因'),
        hasFix: text.includes('处理'),
        text: text.slice(0, 200),
      };
    })()`);

    if (ticker) {
      check(ticker.itemCount > 0, "告警跑马灯有条目", `实际 ${ticker.itemCount} 条`);
      check(ticker.hasPinned, "★ 最严重的那条常驻（不参与滚动）", ticker.pinnedLevel ?? "无");
      check(ticker.hasTrack, "跑马灯轨道存在（其余条目在此滚动）");
      check(ticker.filterCount === 3, "右上角有 3 个等级筛选（全部/告警/预警）",
        ticker.filterLabels.join(" / "));
      /*
       * 条目简化（2026-11-23）：客户原话「告警里面的每一条太复杂了」。
       * 列表里只留摘要，手册的「原因 / 处理」搬进详情弹层。
       */
      check(!ticker.hasCause && !ticker.hasFix,
        "★ 列表条目已简化（原因/处理不再铺在列表上）",
        ticker.hasCause || ticker.hasFix ? "仍显示原因/处理" : "已移除");
      /* 常驻的那条必须是 alarm 级（若存在 alarm 级告警的话） */
      const hasAlarmLevel = await evaluate(`(()=>{
        const card = document.querySelector('[data-widget-id="alarm-ticker"]');
        if (!card) return false;
        return [...card.querySelectorAll('[data-testid="alarm-ticker-item"]')]
          .some((el) => el.getAttribute('data-level') === 'alarm');
      })()`);
      if (hasAlarmLevel) {
        check(ticker.pinnedLevel === "alarm",
          "★ 存在告警级条目时，常驻的确是告警级（不是最新的预警）",
          ticker.pinnedLevel ?? "无");
      } else {
        console.log("· 当前没有告警级条目，跳过「常驻必须是最严重」判据");
      }
    } else {
      check(false, "告警跑马灯卡片存在");
    }

    /*
     * 告警详情弹层（2026-11-23）。
     *
     * <p>★ 用 `element.click()` 而不是 CDP 的 `Input.dispatchMouseEvent`：
     * 后者在 headless + SwiftShader 下会随机挂住几十秒（实测多次）。
     * DOM 点击走的是同一套 React 事件，也能验证弹层逻辑，
     * 只是不经过「浏览器把坐标投到最上层元素」这一步 ——
     * 而那一步在本机 3D 场景下并不稳定。
     */
    const dialog = await evaluate(`(async()=>{
      const item = document.querySelector('[data-testid="alarm-ticker-item"]');
      if (!item) return { error: '没有告警条目' };
      item.click();
      /* React 状态更新到 DOM 需要一帧，给 250ms */
      await new Promise((r) => setTimeout(r, 250));
      const dlg = document.querySelector('[data-testid="alarm-detail-dialog"]');
      if (!dlg) return { error: '点击后弹层没出现' };
      const text = (dlg.innerText || '').replace(/\\s+/g, ' ');
      const props = dlg.querySelector('[data-testid="alarm-detail-props"]');
      const manual = dlg.querySelector('[data-testid="alarm-detail-manual"]');
      const select = dlg.querySelector('[data-testid="alarm-assignee-select"]');
      const restricted = dlg.querySelector('[data-testid="alarm-assign-restricted"]');
      return {
        hasProps: !!props,
        hasManual: !!manual,
        hasCause: text.includes('原因'),
        hasFix: text.includes('处理'),
        hasAssigneeSelect: !!select,
        assigneeOptions: select ? select.options.length : 0,
        restrictedNote: restricted ? (restricted.innerText || '').trim() : null,
        hasAck: !!dlg.querySelector('[data-testid="alarm-detail-ack"]'),
        hasClear: !!dlg.querySelector('[data-testid="alarm-detail-clear"]'),
        coversScreen: dlg.getBoundingClientRect().width > 380,
        text: text.slice(0, 200),
      };
    })()`);

    if (dialog?.error) {
      check(false, "点击告警弹出详情层", dialog.error);
    } else {
      check(dialog.coversScreen, "★ 点击告警弹出详情层（类 TB）");
      check(dialog.hasProps, "弹层有属性区（设备/严重程度/状态/时间/故障码）");
      check(dialog.hasManual, "★ 弹层里有设备手册块");
      check(dialog.hasCause, "★ 手册含「原因」");
      check(dialog.hasFix, "★ 手册含「处理」");
      check(dialog.hasAssigneeSelect, "★ 弹层可分配处理人（有下拉）",
        `候选 ${dialog.assigneeOptions} 个${dialog.restrictedNote ? "（受限）" : ""}`);
      check(dialog.hasAck || dialog.hasClear, "弹层有处置按钮（确认/清除）");
      if (dialog.restrictedNote) {
        console.log(`· 处理人列表受限已如实提示：${dialog.restrictedNote}`);
      }
      /* 关掉弹层，避免影响后续判据 */
      await evaluate(`(()=>{const b=document.querySelector('[data-testid="alarm-detail-close"]'); if(b) b.click(); return 1;})()`);
      await sleep(200);
    }

    /*
     * 设备控制：大圆按钮 + 数值滑块（2026-11-23）。
     *
     * <p>客户原话：「设备控制中如果只有启停，那么就做成大圆按钮绿色和红色的。
     * 如果是控制开度的那么看文档是接收什么数字，然后做成形象的按钮」。
     *
     * <p>★ 这里**不点 3D**：拾取走 WebGL `readPixels`，在本机 headless +
     * SwiftShader 下点一次要好几十秒（实测 24 点会超 5 分钟）。
     * 所以只验证「抽屉存在且未选中时不出按钮」这一条静态判据 ——
     * 选中后的圆钮/滑块形态由 `control-range.test.ts` 与
     * 单独的一次性探测脚本（见 §19.5）覆盖。
     */
    const drawerProbe = await evaluate(`(()=>{
      const d = document.querySelector('[data-testid="control-drawer"]');
      if (!d) return null;
      return {
        mode: d.getAttribute('data-mode'),
        hasStart: !!d.querySelector('[data-testid="drawer-start"]'),
        hasSlider: !!d.querySelector('[data-testid="drawer-numeric-slider"]'),
      };
    })()`);
    check(Boolean(drawerProbe), "底部设备抽屉已渲染");
    if (drawerProbe && drawerProbe.mode === "unselected") {
      check(!drawerProbe.hasStart, "未选中设备时不显示启停圆钮（不会误触）");
      check(!drawerProbe.hasSlider, "未选中设备时不显示数值滑块");
    }

    /* ---------- 先判断专题模式是否适用 ---------- */
    const hasSelectionCard = await evaluate(`!!document.querySelector('[data-testid="scene-widget-selection-card"]')`);
    if (!hasSelectionCard) {
      console.log("\n· 当前布局没有「选中机组」卡（客户 2026-11-23 要求删除），专题模式不适用 —— 跳过");
      /*
       * 不算失败，但也不假装「验过了」。明确说明跳过了什么、为什么。
       * 顺带验一条真正相关的：点设备后外围卡**不能**滑走（否则屏幕会空掉）。
       */
      const canvasProbe = await evaluate(`(()=>{
        const el = document.querySelector('canvas');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      })()`);
      if (canvasProbe) {
        const cx = canvasProbe.x + canvasProbe.w * 0.5;
        const cy = canvasProbe.y + canvasProbe.h * 0.5;
        /*
         * 点击包 try/catch：headless + SwiftShader 下 `Input.dispatchMouseEvent`
         * 会偶发挂住（实测超过 60 秒无响应）。它只是**辅助判据**，
         * 挂住不该让整个验收脚本报错退出 —— 那会掩盖前面已经跑过的几十条结果。
         *
         * <p>包住之后超时变成一条明确的「无法验证」提示，而不是崩溃。
         */
        try {
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", clickCount: 1 }, sessionId, 15_000);
          await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", clickCount: 1 }, sessionId, 15_000);
          await sleep(900);
          const outerAfter = await evaluate(`(()=>{
            const cards = [...document.querySelectorAll('[data-testid="scene-widget-metric-card"]')];
            if (!cards.length) return null;
            const r = cards[0].getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width };
          })()`);
          check(
            Boolean(outerAfter && outerAfter.x > -10 && outerAfter.w > 100),
            "★ 无选中机组卡时，点设备不会把外围统计卡赶走",
            outerAfter ? `left=${Math.round(outerAfter.x)}px, w=${Math.round(outerAfter.w)}px` : "未找到",
          );
        } catch (error) {
          console.log(`· 跳过「点设备」派生判据：CDP 输入事件无响应（${error instanceof Error ? error.message : error}）`);
        }
      }
      console.log("✓ 跳过专题模式判据（布局无载体）");
      ws.close();
      summarize();
      return;
    }

    /* ---------- 判据 1：初始态 ---------- */
    const before = await evaluate(rectOf("scene-widget-selection-card"));
    const closeBefore = await evaluate(`!!document.querySelector('[data-testid="selection-drawer-close"]')`);

    check(Boolean(before), "选中卡已渲染（运行态有 widget 布局）", before ? `${Math.round(before.w)}×${Math.round(before.h)}` : "未找到");
    check(closeBefore === false, "未选中时没有抽屉关闭按钮");
    /*
     * 初始窄卡：宽度应在 16.5% 附近（1920 × 0.165 ≈ 317px）。
     * 给 40px 容差 —— 抓取时机可能在过渡中。
     */
    if (before) {
      check(before.w < 400, "初始选中卡是窄卡（不是抽屉）", `w=${Math.round(before.w)}px`);
    }

    /* ---------- 找一台机组（在画布网格上点） ---------- */
    const canvas = await evaluate(`(()=>{
      const el = document.querySelector('canvas');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    if (!canvas) {
      check(false, "找到 3D 画布");
      throw new Error("canvas 不存在，后续判据无法执行");
    }
    check(canvas.w > 600, "3D 画布占据主要视野", `${Math.round(canvas.w)}×${Math.round(canvas.h)}`);

    const click = async (x, y) => {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, sessionId);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, sessionId);
      await sleep(700);
    };

    const drawerState = async () => {
      const hasClose = await evaluate(`!!document.querySelector('[data-testid="selection-drawer-close"]')`);
      const name = await evaluate(`(()=>{
        const el = document.querySelector('[data-testid="selection-device-name"]');
        return el ? (el.innerText || '').replace(/\\s+/g,' ').trim() : null;
      })()`);
      const rect = await evaluate(rectOf("scene-widget-selection-card"));
      return { hasClose: Boolean(hasClose), name, rect };
    };

    /*
     * 在画布中央 30%~70% 区域按 **4×3** 网格点击。
     * 第一版用 6×4=24 点，在 SwiftShader 下每次点击后的 evaluate 往返很慢，
     * 整体拖到 8 分钟以上。12 点已足够命中居中的机组阵列。
     */
    const targets = [];
    for (let gy = 0; gy < 3; gy += 1) {
      for (let gx = 0; gx < 4; gx += 1) {
        targets.push({
          x: canvas.x + canvas.w * (0.34 + 0.10 * gx),
          y: canvas.y + canvas.h * (0.46 + 0.08 * gy),
        });
      }
    }

    let first = null;
    for (const point of targets) {
      await click(point.x, point.y);
      const state = await drawerState();
      if (state.hasClose && state.rect) {
        first = { ...state, point };
        break;
      }
    }

    check(Boolean(first), "点击 3D 机组能进入专题模式");
    if (!first) throw new Error("未能选中任何机组，无法继续验收（可能是首屏未出数或模型不在网格上）");

    /* ---------- 判据 2/3/4：抽屉几何 + 外围滑出 + 内容 ---------- */
    const drawer = first.rect;
    const leftPct = (drawer.x / vw) * 100;
    const widthPct = (drawer.w / vw) * 100;
    check(leftPct >= 58, "抽屉左边界 ≥58%（给 3D 留出视野）", `left=${leftPct.toFixed(1)}%`);
    check(widthPct >= 28, "抽屉比原窄卡明显更宽", `w=${widthPct.toFixed(1)}%`);

    /*
     * 外围卡是否真的「滑出」：取一张左侧 metric-card，看它的 left 是否
     * 离开视口（负值）或偏移超过自身宽度一半。只淡出不位移 = 没腾出空间。
     */
    const outer = await evaluate(`(()=>{
      const cards = [...document.querySelectorAll('[data-testid="scene-widget-metric-card"]')];
      if (!cards.length) return null;
      const r = cards[0].getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    check(Boolean(outer), "找到外围统计卡");
    if (outer) {
      const slidOut = outer.x + outer.w <= 4 || outer.x < -outer.w * 0.5;
      check(slidOut, "外围统计卡滑出视野（不是只变暗）",
        `left=${Math.round(outer.x)}px, w=${Math.round(outer.w)}px`);
    }

    const name1 = first.name;
    check(Boolean(name1 && name1.length > 0), "抽屉里显示设备名", name1 ?? "(空)");
    const hasActions = await evaluate(`!!document.querySelector('[data-testid="selection-actions"]')`);
    check(hasActions, "抽屉里有「操作」区（命令来自设备 rpcMethods）");

    /* ---------- 判据 5：点「×」退出 ---------- */
    const closeRect = await evaluate(rectOf("selection-drawer-close"));
    check(Boolean(closeRect), "抽屉上有「×」按钮");
    if (closeRect) {
      await click(closeRect.x + closeRect.w / 2, closeRect.y + closeRect.h / 2);
      await sleep(900);
      const afterClose = await drawerState();
      check(!afterClose.hasClose, "点「×」后关闭按钮消失");
      check(
        afterClose.rect && afterClose.rect.w < 400,
        "退出后选中卡回到窄卡形态",
        afterClose.rect ? `w=${Math.round(afterClose.rect.w)}px` : "未找到",
      );
      const outerBack = await evaluate(`(()=>{
        const cards = [...document.querySelectorAll('[data-testid="scene-widget-metric-card"]')];
        if (!cards.length) return null;
        const r = cards[0].getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      })()`);
      check(
        Boolean(outerBack && outerBack.x > -10),
        "退出后外围卡回到视野内",
        outerBack ? `left=${Math.round(outerBack.x)}px` : "未找到",
      );
    }

    /* ---------- 判据 6：换一台，内容跟着换 ---------- */
    let second = null;
    for (const point of targets) {
      if (first.point && Math.abs(point.x - first.point.x) < 2 && Math.abs(point.y - first.point.y) < 2) continue;
      await click(point.x, point.y);
      const state = await drawerState();
      if (state.hasClose && state.name && state.name !== name1) {
        second = state;
        break;
      }
    }
    if (second) {
      check(true, "点另一台机组后抽屉内容跟着换", `${name1} → ${second.name}`);
    } else {
      /*
       * 点不到第二台不等于功能坏了：可能网格点都落在同一台、或点了空白
       * （点空白是**合法退出**，不是失败）。所以这一条只提示，不计失败。
       */
      console.log("· 未能点中第二台不同机组（网格覆盖有限），跳过「内容跟随」判据");
    }

    /* ---------- 默认视角占比（§12.1） ---------- */
    const spread = await evaluate(`(()=>{
      const plates = [...document.querySelectorAll('[class*="nameplate"]')];
      return plates.length;
    })()`);
    console.log(`· 铭牌元素数：${spread}（默认视角占比需人工看图确认，脚本只留截图）`);

    ws.close();
  } finally {
    chrome.kill();
  }

  summarize();
}

await main();
