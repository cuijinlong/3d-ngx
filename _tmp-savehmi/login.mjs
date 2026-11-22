const fs = await import("node:fs/promises");
const credPath = "/Users/cuijinlong/Documents/workspace/3d-ngx/_tmp-savehmi/creds.json";
const shotDir = "/Users/cuijinlong/Documents/workspace/3d-ngx/_tmp-savehmi";
const creds = JSON.parse(await fs.readFile(credPath, "utf8"));
await fs.unlink(credPath);

const task = await taskSpace("savehmi login");
const page = task.page("p1");
console.log(JSON.stringify({ taskSpaceId: task.spaceId, page: page.label }));

await page.goto("https://tool.savehmi.com/", { timeout: 45_000 });
await page.waitForLoadState("domcontentloaded");
try { await page.waitForLoadState("networkidle", { timeout: 15_000 }); } catch {}

const inspect = await page.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inputs = [...document.querySelectorAll("input")].map((el) => ({
    type: el.type,
    name: el.name,
    id: el.id,
    placeholder: el.placeholder,
    autocomplete: el.autocomplete,
    visible: vis(el),
  }));
  const buttons = [...document.querySelectorAll("button, input[type=submit], a")].filter(vis).slice(0, 30).map((el) => ({
    tag: el.tagName,
    type: el.type || "",
    text: (el.innerText || el.value || "").trim().slice(0, 80),
    name: el.name || "",
    href: el.tagName === "A" ? (el.getAttribute("href") || "") : "",
  }));
  return {
    url: location.href,
    title: document.title,
    inputs,
    buttons,
    text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 2500),
  };
});
console.log("PRE_LOGIN");
console.log(JSON.stringify(inspect, null, 2));

const userField = inspect.inputs.find((i) => i.visible && (i.type === "text" || i.type === "tel" || i.type === "email" || /user|phone|account|mobile|name/i.test(`${i.name} ${i.id} ${i.placeholder}`)))
  || inspect.inputs.find((i) => i.visible && i.type !== "password" && i.type !== "hidden" && i.type !== "checkbox" && i.type !== "submit");
const passField = inspect.inputs.find((i) => i.visible && i.type === "password");

if (!userField || !passField) {
  console.log("NO_LOGIN_FORM");
  const shot = await page.screenshot({ path: `${shotDir}/savehmi-pre.png` });
  console.log(JSON.stringify({ screenshot: shot, url: await page.url(), title: await page.title() }));
  console.log(await page.snapshot({ scope: "full_page" }));
} else {
  const userSel = userField.id ? `#${CSS.escape(userField.id)}` : (userField.name ? `input[name="${userField.name}"]` : `input[type="${userField.type}"]`);
  const passSel = passField.id ? `#${CSS.escape(passField.id)}` : (passField.name ? `input[name="${passField.name}"]` : 'input[type="password"]');
  await page.fill(userSel, creds.user, { clearFirst: true, timeout: 8_000 });
  await page.fill(passSel, creds.password, { clearFirst: true, timeout: 8_000 });
  const loginBtn = inspect.buttons.find((b) => /登录|登陆|signin|sign in|log in|login|提交/i.test(b.text));
  if (loginBtn && loginBtn.tag === "BUTTON") {
    await page.click(`text=${JSON.stringify(loginBtn.text).slice(1, -1) ? loginBtn.text : "登录"}`.replace(/^text=$/, "text=登录"), { label: "click sign in" }).catch(async () => {
      await page.click("loc=role:button", { label: "click sign in fallback" });
    });
  } else if (loginBtn && loginBtn.tag === "INPUT") {
    await page.click('input[type="submit"]', { label: "click sign in" });
  } else {
    await page.press(passSel, "Enter");
  }
  try {
    await page.waitForFunction(() => !/login|signin|sign-in/i.test(location.pathname + location.hash) || (document.body && /退出|注销|工作台|项目|控制台|首页/.test(document.body.innerText)), undefined, { timeout: 20_000 });
  } catch {}
  try { await page.waitForLoadState("networkidle", { timeout: 10_000 }); } catch {}
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const stillPassword = [...document.querySelectorAll('input[type="password"]')].some(vis);
    const err = [...document.querySelectorAll("[class*='error'], [class*='err'], .ant-message, .el-message, .toast, [role=alert]")]
      .filter(vis).map((el) => (el.innerText || "").trim()).filter(Boolean).slice(0, 8);
    return {
      url: location.href,
      title: document.title,
      stillPassword,
      errors: err,
      text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 4000),
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
}
