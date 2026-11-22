const fs = await import("node:fs/promises");
const credPath = "/Users/cuijinlong/Documents/workspace/3d-ngx/_tmp-savehmi/creds.json";
const shotDir = "/Users/cuijinlong/Documents/workspace/3d-ngx/_tmp-savehmi";
const creds = JSON.parse(await fs.readFile(credPath, "utf8"));
await fs.unlink(credPath);

const task = await taskSpace("savehmi open tianjiao");
const page = task.page("p1");
console.log(JSON.stringify({ taskSpaceId: task.spaceId, page: page.label }));

await page.goto("https://tool.savehmi.com/", { timeout: 45_000 });
await page.waitForLoadState("domcontentloaded");
try { await page.waitForLoadState("networkidle", { timeout: 15_000 }); } catch {}
await page.waitForTimeout(800);

let title = await page.title();
let url = await page.url();
console.log("AFTER_GOTO", JSON.stringify({ url, title }));

if (/登录/.test(title)) {
  await page.fill('input[name="account"]', creds.user, { clearFirst: true, timeout: 8_000 });
  await page.fill('input[type="password"]', creds.password, { clearFirst: true, timeout: 8_000 });
  await page.click('button[type="submit"]', { label: "click sign in" });
  try {
    await page.waitForFunction(() => !/登录 ·/.test(document.title), undefined, { timeout: 25_000 });
  } catch {}
  try { await page.waitForLoadState("networkidle", { timeout: 12_000 }); } catch {}
  await page.waitForTimeout(1000);
  title = await page.title();
  url = await page.url();
  console.log("AFTER_LOGIN", JSON.stringify({ url, title }));
}

await page.waitForSelector('button, a', { timeout: 10_000 });
const popupPromise = page.waitForEvent("popup", { timeout: 15_000 }).catch(() => null);
let clicked = false;
try {
  await page.click('loc=role:button[name="打开 天骄科技园"]', { label: "open tianjiao project" });
  clicked = true;
} catch (e) {
  console.log("CLICK_PRIMARY_FAIL", String(e && e.message || e).slice(0, 300));
  try {
    await page.click("text=天骄科技园", { label: "open tianjiao by text" });
    clicked = true;
  } catch (e2) {
    console.log("CLICK_TEXT_FAIL", String(e2 && e2.message || e2).slice(0, 300));
  }
}
const popup = await popupPromise;
if (popup) {
  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  console.log("POPUP", JSON.stringify({ label: popup.label, url: await popup.url(), title: await popup.title() }));
}
const target = popup || page;
try { await target.waitForLoadState("networkidle", { timeout: 20_000 }); } catch {}
// 3D scene may keep loading
try {
  await target.waitForFunction(() => {
    const t = document.body ? document.body.innerText : "";
    return /设备|场景|模型|台|属性|图层|画布/.test(t) && !/正在加载|加载中/.test(t.slice(0, 80));
  }, undefined, { timeout: 40_000 });
} catch {}
await target.waitForTimeout(2500);

const after = await target.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const links = [...document.querySelectorAll("a, button, [role=button], [role=tab]")].filter(vis).slice(0, 60)
    .map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " "))
    .filter(Boolean);
  return {
    url: location.href,
    title: document.title,
    canvas: [...document.querySelectorAll("canvas")].filter(vis).map((c) => ({ w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width), cssH: Math.round(c.getBoundingClientRect().height) })),
    links,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 6000),
  };
});
console.log("INSIDE");
console.log(JSON.stringify(after, null, 2));
const shot = await target.screenshot({ path: `${shotDir}/tianjiao-inside.png`, fullPage: true });
console.log(JSON.stringify({ screenshot: shot, clicked, page: target.label }));
console.log(await target.snapshot({ scope: "full_page" }));
console.log("TABS", JSON.stringify(await task.tabs()));
