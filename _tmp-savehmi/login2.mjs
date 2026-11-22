const fs = await import("node:fs/promises");
const credPath = "/Users/cuijinlong/Documents/workspace/3d-ngx/_tmp-savehmi/creds.json";
const shotDir = "/Users/cuijinlong/Documents/workspace/3d-ngx/_tmp-savehmi";
const creds = JSON.parse(await fs.readFile(credPath, "utf8"));
await fs.unlink(credPath);

const task = await taskSpace(1);
const page = task.page("p1");
console.log(JSON.stringify({ taskSpaceId: task.spaceId, page: page.label, url: await page.url(), title: await page.title() }));

const state = await page.evaluate(() => {
  const acc = document.querySelector('input[name="account"]');
  const pwd = document.querySelector('input[type="password"]');
  return {
    url: location.href,
    hasAccount: !!(acc && acc.value),
    accountOk: !!(acc && acc.value && acc.value.length >= 8),
    hasPassword: !!(pwd && pwd.value),
    stillLogin: /登录/.test(document.title) || /login/i.test(location.pathname),
  };
});
console.log("STATE", JSON.stringify(state));

if (state.stillLogin) {
  if (!state.accountOk) await page.fill('input[name="account"]', creds.user, { clearFirst: true, timeout: 8_000 });
  if (!state.hasPassword) await page.fill('input[type="password"]', creds.password, { clearFirst: true, timeout: 8_000 });
  await page.click('button[type="submit"]', { label: "click sign in" });
  try {
    await page.waitForFunction(() => {
      const pwd = document.querySelector('input[type="password"]');
      const vis = pwd && pwd.offsetWidth > 0 && getComputedStyle(pwd).display !== "none";
      return !vis || !/登录 ·/.test(document.title);
    }, undefined, { timeout: 25_000 });
  } catch {}
  try { await page.waitForLoadState("networkidle", { timeout: 12_000 }); } catch {}
  await page.waitForTimeout(1200);
}

const after = await page.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const stillPassword = [...document.querySelectorAll('input[type="password"]')].some(vis);
  const err = [...document.querySelectorAll("[class*='error'], [class*='err'], .ant-message, .el-message, .toast, [role=alert], [class*='message']")]
    .filter(vis).map((el) => (el.innerText || "").trim()).filter(Boolean).slice(0, 8);
  const links = [...document.querySelectorAll("a, button")].filter(vis).slice(0, 40).map((el) => (el.innerText || el.getAttribute("aria-label") || "").trim()).filter(Boolean);
  return {
    url: location.href,
    title: document.title,
    stillPassword,
    errors: err,
    links,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000),
  };
});
console.log("POST_LOGIN");
console.log(JSON.stringify(after, null, 2));
if (!after.stillPassword) {
  const shot = await page.screenshot({ path: `${shotDir}/savehmi-after.png`, fullPage: true });
  console.log(JSON.stringify({ screenshot: shot }));
} else {
  console.log("STILL_ON_LOGIN_NO_SHOT");
}
console.log(await page.snapshot({ scope: "full_page" }));
