#!/usr/bin/env node
/**
 * 把内置大屏模板导出成**自包含可交付包** —— 一套数字孪生的完整施工资料。
 *
 * <h2>它解决什么</h2>
 *
 * <p>模板不是一张 HTML 静态图，而是「引擎可渲染的布局契约」。但只给一份
 * `template.json`，接手的人/模型还得自己去翻代码才知道：
 * <ul>
 *   <li>每个界面字段该填什么、哪些必填；</li>
 *   <li>新建场景表单的那些字段从哪来（哪些是平台动态取的）；</li>
 *   <li>模板管不到的地方（控制按钮、3D 对象匹配）要怎么补；</li>
 *   <li>改完怎么验证。</li>
 * </ul>
 *
 * <p>这个脚本把这些全部产出来，形成一个可以直接丢给模型的目录。
 *
 * <h2>产出结构</h2>
 *
 * ```
 * <outDir>/
 *   README.md            交接入口：这份包是什么、按什么顺序读
 *   manifest.json        包元信息 + 文件校验和（确认没被改过）
 *   template.json        模板本体，引擎直接渲染
 *   binding-plan.json    ★ 待填绑定清单，逐项说明怎么填
 *   scene-form.json      「新建场景」表单逐字段说明
 *   object-binding.json  3D 对象 ↔ 设备的匹配规则
 *   gaps.json            模板覆盖不到、必须实例补齐的部分
 *   skills/SKILL.md      给模型的提示词
 * ```
 *
 * <h2>用法</h2>
 *
 * ```bash
 * node scripts/export-template-package.mjs                       # 默认天骄热泵
 * node scripts/export-template-package.mjs --template <id> -o <dir>
 * node scripts/export-template-package.mjs --zip                 # 额外打成一个 .zip
 * ```
 *
 * <p>`--zip` 用于「把这套模板下载下来发给别人」。不用 Node 里手写 zip ——
 * 调系统 `zip` 更可靠，失败时明确提示手工压缩，不假装成功。
 *
 * 退出码：0 成功；1 模板不存在参数错误。
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const TEMPLATE_DIR = join(REPO_ROOT, "packages/data-adapter/src/screen-templates");
const SKILL_SRC = join(REPO_ROOT, ".agents/skills/twin-from-template-package/SKILL.md");

function readFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const templateId = readFlag("--template", "tianjiao-heat-pump");
const outDir = resolve(readFlag("-o", join(REPO_ROOT, "_tmp-template-package", templateId)));
const wantZip = process.argv.includes("--zip");

const template = JSON.parse(readFileSync(join(TEMPLATE_DIR, `${templateId}.json`), "utf8"));

/**
 * 每种取值来源的填写说明。
 *
 * <p>这些是**契约**，不是示例值 —— 写清楚「去哪拿、填什么形态」，
 * 而不是给一个看起来对、换客户就错的 id。
 */
const SOURCE_GUIDE = {
  "device-point": {
    what: "某台设备的某个遥测键",
    fill: "填 deviceId（平台设备 UUID）+ telemetryKey（该设备实际存在的测点键）",
    howToGet: "GET /api/tenant/devices?pageSize=500 → 取 id；测点键走 GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries?keys=<候选>",
    warn: "测点键必须在该设备上真实存在。填一个不存在的键不会报错，卡片只会永远显示「暂无数据」。",
  },
  "asset-attribute": {
    what: "某个资产上的一次性属性（额定值这类，没有实时概念）",
    fill: "填 assetId（资产 UUID）+ attributeKey（SERVER_SCOPE 属性键）",
    howToGet: "GET /api/tenant/assets → 取 id；属性走 GET /api/plugins/telemetry/ASSET/{id}/values/attributes/SERVER_SCOPE",
    warn: "属性与遥测不能同时填。同时存在时读值会走属性分支，看起来像「换了测点没生效」。",
  },
  site: {
    what: "按场站圈定设备范围",
    fill: "填 siteId（场站资产 UUID）",
    howToGet: "GET /api/tenant/assets 里 type=场站分组 的资产",
    warn: "范围决定 device-list / bar-compare / summary-card 能列出哪些设备。填错会列出别的场站的设备。",
  },
  "scene-topology": {
    what: "按当前场景拓扑圈定设备范围（推荐）",
    fill: "填 topologyId（场景 id），或留空表示「跟随本场景」",
    howToGet: "场景创建后由 create-scene 返回；也可用 GET /api/energy/topologies 列表",
    warn: "留空是常见正确做法 —— 新建场景时直接用它自己的拓扑。",
  },
};

/**
 * 从 `scene-widget-layout.ts` 读每种卡片的 `scopeRequired`。
 *
 * <p>不在脚本里硬编码这张表 —— 硬编码会漂移（改了 registry 忘了改这里，
 * 导出的包就开始骗人）。所以**每次导出都去源码里数一遍**，
 * 数不出来就报错退出，而不是悄悄用一份过时的表。
 *
 * <p>判据：`scopeRequired: true` 的卡片，缺少范围就一台设备都拿不到。
 */
function readScopeRequiredTypes() {
  const source = readFileSync(join(REPO_ROOT, "packages/data-adapter/src/scene-widget-layout.ts"), "utf8");
  const start = source.indexOf("SCENE_WIDGET_TYPE_REGISTRY");
  if (start < 0) throw new Error("找不到 SCENE_WIDGET_TYPE_REGISTRY，无法判断哪些类型必需范围");
  const region = source.slice(start, source.indexOf("];", start));
  const types = new Set();
  /* 逐条 { type: "x", ... } 地看，避免跨条目误匹配。 */
  for (const line of region.split("\n")) {
    const typeMatch = line.match(/type:\s*"([a-z-]+)"/);
    if (typeMatch && /scopeRequired:\s*true/.test(line)) types.add(typeMatch[1]);
  }
  /*
   * 一条都没抓到说明正则过时了（比如格式变了）。
   * 这时宁可失败也不要导出一份「什么都必填」的错包。
   */
  if (!types.size) throw new Error("没能从 registry 解析出任何 scopeRequired 类型，格式可能已变");
  return types;
}

/** 把模板的 region.interfaces 摊平成待填清单。 */
function buildBindingPlan(tpl) {
  const scopeRequiredTypes = readScopeRequiredTypes();
  const rows = [];
  for (const region of tpl.regions ?? []) {
    for (const iface of region.interfaces ?? []) {
      const sources = iface.allowedSources ?? [];
      /* 有多个来源时，优先推荐能实时取数的那种。 */
      const preferred = sources.includes("device-point")
        ? "device-point"
        : sources.includes("asset-attribute")
          ? "asset-attribute"
          : sources.includes("scene-topology")
            ? "scene-topology"
            : sources[0];
      rows.push({
        regionId: region.id,
        regionTitle: region.defaultTitle,
        regionType: region.type,
        key: iface.key,
        name: iface.name,
        valueType: iface.valueType,
        allowedSources: sources,
        preferredSource: preferred,
        /*
         * 「必填」分两档，不能合成一个布尔（2026-11-23）。
         *
         * 模板里 16 个界面字段一个 `optional` 都没标。直接按「没标就是必填」
         * 会声称「开度必须填」，而实际不填只是那一行少个数字；反过来，
         * `scope` 不填对 summary-card / device-list 这类是**整卡无数据**。
         */
        required: iface.optional === true
          ? false
          : (iface.valueType === "scope" && scopeRequiredTypes.has(region.type)),
        blocksCard: iface.optional !== true
          && iface.valueType === "scope"
          && scopeRequiredTypes.has(region.type),
        showsEmptyWhenMissing: iface.optional === true
          || !(iface.valueType === "scope" && scopeRequiredTypes.has(region.type)),
        guide: SOURCE_GUIDE[preferred] ?? null,
        /*
         * 多来源槽要说明「另一个也能用」。
         *
         * 实例里 plant-capacity 用的是资产属性，而这里 preferred 选了
         * device-point（有实时优先）—— 只给一个来源会让接手方以为另一种不行。
         */
        alternatives: sources.filter((item) => item !== preferred),
        /*
         * ★ 模板能不能直接生成这一项。
         *
         * `TemplateInterfaceBinding` 只有 deviceId / telemetryKey，
         * **没有 assetId / attributeKey**；`materializeScreenTemplate` 也只写这两个。
         * 所以资产属性槽**无法**由模板生成，必须在实例层补。
         */
        templateSupported: preferred !== "asset-attribute",
        example: preferred === "device-point"
          ? { regionId: region.id, key: iface.key, source: "device-point",
              deviceId: "<设备UUID>", telemetryKey: "<测点键>" }
          : preferred === "asset-attribute"
            ? {
                regionId: region.id,
                key: iface.key,
                source: "asset-attribute",
                _note:
                  "模板 interfaceBindings 不支持资产属性（无 assetId/attributeKey 字段）。"
                  + "这一项要建完场景后用 update-widget 在实例层写 slots[]："
                  + "{ assetId: '<资产UUID>', attributeKey: '<属性键>' }",
                assetId: "<资产UUID>",
                attributeKey: "<属性键>",
              }
            : preferred === "site"
              ? { regionId: region.id, key: iface.key, source: "site", siteId: "<场站UUID>" }
              : { regionId: region.id, key: iface.key, source: "scene-topology",
                  topologyId: "<本场景拓扑id 或留空>" },
      });
    }
  }
  return {
    templateId: tpl.id,
    templateVersion: tpl.version,
    howToUse:
      "这是**待填清单**。每项对应模板里一个界面字段。填完后作为 interfaceBindings 交给 "
      + "materializeScreenTemplate(template, { interfaceBindings }) 就能生成带绑定的完整布局。"
      + "也可以用在线编程的 bind-telemetry 逐项绑定（模板先生成骨架，再补绑定）。",
    note:
      "两档语义：blocksCard=true 不填则整张卡没数据（scope 类对 summary-card /"
      + " device-list / bar-compare 就是这种）；showsEmptyWhenMissing=true 不填则那一处"
      + " 显示「暂无数据」，卡片其余部分正常。两种都不会报错，所以必须按清单填全。",
    items: rows,
    summary: {
      total: rows.length,
      blocksCard: rows.filter((row) => row.blocksCard).length,
      showsEmptyWhenMissing: rows.filter((row) => row.showsEmptyWhenMissing).length,
      templateUnsupported: rows.filter((row) => !row.templateSupported).length,
      bySource: rows.reduce((acc, row) => {
        acc[row.preferredSource] = (acc[row.preferredSource] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}

/**
 * 「新建场景」表单字段。
 *
 * <p><b>每个字段都对照过 CreateSceneWizard.tsx</b>（2026-11-23）。
 * `source: "platform"` 的字段是从平台 API 动态取的，**不要写死枚举** ——
 * 不同客户/版本的选项不一样，编一个值只会让创建失败。
 */
function buildSceneForm(tpl) {
  return {
    note: "这些是「新建场景」弹窗的字段。交给模型时把这些值填好，它能一次建对场景。",
    fields: [
      {
        key: "name",
        label: "场景名称",
        required: true,
        source: "input",
        constraint: "最长 80 字",
        hint: "同时会作为标题卡里的 {sceneName} 占位符内容（如「天骄科技园 · 冷热站监控」）。",
      },
      {
        key: "templateId",
        label: "画面模板",
        required: true,
        source: "fixed",
        value: tpl.id,
        hint: `本包就是这套模板，填 "${tpl.id}"。`,
      },
      {
        key: "siteId",
        label: "场站",
        required: true,
        source: "platform",
        endpoint: "GET /api/energy/topologies（sites）或 /api/tenant/assets（type=场站分组）",
        hint: "决定「客户 → 场站」的第一级归属。选错会把别的场站的设备带进来。",
      },
      {
        key: "viewType",
        label: "视图类型",
        required: true,
        source: "platform",
        endpoint: "编辑器内 getTopologyApi().views() 的 options[].code",
        hint: "★ 运行时从平台取，没有固定枚举。不要编造值，先读 options。",
      },
      {
        key: "topologyId",
        label: "设备拓扑（范围）",
        required: false,
        source: "platform",
        endpoint: "GET /api/energy/topologies",
        hint: "选已有拓扑，或留空让新建流程自动建一个。模板卡片的 scope 默认跟这个拓扑。",
      },
      {
        key: "glb",
        label: "上传模型",
        required: false,
        source: "file",
        constraint: "GLB；导入后按节点名生成可绑定对象",
        hint: "不传则场景没有 3D 模型，只有卡片。对象匹配见 object-binding.json 的 matchBy。",
      },
      {
        key: "stylePack",
        label: "风格套装",
        required: true,
        source: "platform",
        endpoint: "编辑器内 getTopologyApi().stylePacks() 的 packs[]",
        hint: "★ 同样运行时取值，不要写死。选「全景」类套装时必须同时填 weatherSite。",
      },
      {
        key: "baseType",
        label: "设备底座",
        required: false,
        source: "enum",
        options: ["auto", "steel-rail", "concrete-pad", "none"],
        default: "auto",
        hint: "auto = 模块机/冷机用钢结构、水泵/冷却塔用混凝土。",
      },
      {
        key: "weatherSite",
        label: "天气地点",
        required: "conditional",
        condition: "所选风格套装属于「全景」类时必填",
        source: "input",
        example: "南京市江宁区",
        hint: "用于天气与昼夜光照。不填会导致全景套装校验不过。",
      },
      {
        key: "styleFiles",
        label: "上传套装文件",
        required: false,
        source: "file",
        constraint: ".zip / .json / .js / .css，单个最大 48MB",
        hint: "只有自定义套装才需要；官方套装选上面的卡片即可。",
      },
    ],
  };
}

/** 模板管不到、必须实例补齐的部分。 */
function buildGaps(tpl) {
  const noInterfaceRegions = (tpl.regions ?? [])
    .filter((region) => !(region.interfaces ?? []).length)
    .map((region) => ({ id: region.id, type: region.type, title: region.defaultTitle }));

  return {
    note:
      "这些是模板**结构性覆盖不到**的部分。不是模板写漏了，是它们承载的是"
      + "「这台设备/这条命令」而非「这类界面」—— 每换一个现场都必须重填。",
    gaps: [
      {
        what: "无界面定义的卡片",
        regions: noInterfaceRegions,
        why: "这些卡片不读遥测（控制条发命令、选中卡靠点击 3D），模板里没有可绑的界面字段。",
        how:
          "control-bar 用 widget.controls[] 逐条写 deviceId + commandId + onParams/offParams。"
          + "命令名来自该设备 SERVER_SCOPE 的 rpcMethods，**不要猜**。"
          + "selected-unit 无需配置，点击 3D 对象后自动显示。",
      },
      {
        what: "3D 对象 ↔ 设备匹配",
        source: "object-binding.json",
        why: "模板只声明按什么匹配（matchBy），具体哪个节点对哪台设备是实例数据。",
        how: "按 GLB 节点名匹配设备（天骄：模块机节点 1~9）。匹配不上则铭牌和选中卡无数据。",
      },
      {
        what: "★ 资产属性槽（asset-attribute）",
        why:
          "模板的 interfaces 允许 `allowedSources: [\"asset-attribute\"]`，"
          + "但 `TemplateInterfaceBinding` 的字段里**没有 assetId / attributeKey**，"
          + "`materializeScreenTemplate` 也只写 deviceId + telemetryKey。"
          + "声明和实现脱节。",
        how:
          "这些槽模板生成不出来 —— 建完场景后必须用 update-widget 在实例层写"
          + " slots[]: { assetId, attributeKey }。"
          + "天骄模板的「装机参数」三项全是这种（main 更只有 asset 一个来源）。",
        evidence:
          "screen-template.ts 全文 0 次出现 assetId / attributeKey；"
          + "库里 plant-capacity 的槽是脚本直接配的，不是模板产物。",
      },
      {
        what: "★ 范围聚合口径（aggregate: sum / avg / max / min）",
        why:
          "模板的界面类型只有 number / number-series / scope，**没有 aggregate 字段**；"
          + "materializeScreenTemplate 也只写 deviceId + telemetryKey。"
          + "而「9 台机组之和」恰恰靠 aggregate 表达。",
        how:
          "模板生成的骨架里该槽是「无 deviceId、无 aggregate」——运行态会显示"
          + "「还没有选择设备」。必须实例层补：在线编程 update-widget 写"
          + " slots[].aggregate，或脚本直接配。同时把口径写进 label（如「9 台机组之和」）。",
        evidence:
          "screen-template.ts 全文出现 aggregate 0 次；库里 system-power.main / "
          + "power-trend.series-0 的 aggregate 都是实例配置加上的，不是模板产物。",
      },
      {
        what: "设备底座与风格套装",
        why: "视觉相关，与数据无关，但影响「像不像大屏」。",
        how: "见 scene-form.json 的 baseType / stylePack / weatherSite。",
      },
    ],
  };
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function writeFileSafe(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return { path, bytes: Buffer.byteLength(content), sha256: sha256(content) };
}

/* ---------------- 生成 ---------------- */
const bindingPlan = buildBindingPlan(template);
const sceneForm = buildSceneForm(template);
const gaps = buildGaps(template);
const objectBinding = template.objectBinding ?? null;

const files = [];

files.push({
  name: "template.json",
  ...writeFileSafe(join(outDir, "template.json"), JSON.stringify(template, null, 2)),
});
files.push({
  name: "binding-plan.json",
  ...writeFileSafe(join(outDir, "binding-plan.json"), JSON.stringify(bindingPlan, null, 2)),
});
files.push({
  name: "scene-form.json",
  ...writeFileSafe(join(outDir, "scene-form.json"), JSON.stringify(sceneForm, null, 2)),
});
files.push({
  name: "object-binding.json",
  ...writeFileSafe(join(outDir, "object-binding.json"), JSON.stringify(objectBinding, null, 2)),
});
files.push({
  name: "gaps.json",
  ...writeFileSafe(join(outDir, "gaps.json"), JSON.stringify(gaps, null, 2)),
});

/* skill 从仓库读；没有就跳过并明确告警，不编一份出来。 */
let skillNote = "";
try {
  const skill = readFileSync(SKILL_SRC, "utf8");
  files.push({
    name: "skills/SKILL.md",
    ...writeFileSafe(join(outDir, "skills/SKILL.md"), skill),
  });
} catch {
  skillNote = "\n> ⚠️ 未找到 skills/SKILL.md 源文件，本包不含提示词。";
}

const readme = `# ${template.name} · 数字孪生模板包

> 版本 v${template.version} · 模板 id \`${template.id}\`
> 由 \`scripts/export-template-package.mjs\` 生成，**不要手改**（改源文件后重新导出）。

这不是一张 HTML 静态页，而是**引擎可渲染的布局契约** + 施工说明。
拿到这个目录，按下面顺序读，就能把一整套数字孪生建起来。

## 按这个顺序读

| 顺序 | 文件 | 你要拿到什么 |
| --- | --- | --- |
| 1 | \`README.md\` | 本文件：整体怎么用 |
| 2 | \`template.json\` | 有哪些卡片、怎么排、每张卡要什么字段 |
| 3 | \`binding-plan.json\` | **待填清单**：每个字段填什么、去哪取 |
| 4 | \`scene-form.json\` | 「新建场景」表单逐字段值 |
| 5 | \`object-binding.json\` | 3D 对象怎么和设备对上 |
| 6 | \`gaps.json\` | 模板管不到、必须实例补的部分 |
| 7 | \`skills/SKILL.md\` | 编排上述文件的执行步骤 |

## 三句话讲清这套东西

1. **模板定义界面，不定义设备。** \`template.json\` 的每个 region 声明「这里要一个数字」，
   具体是哪台设备的哪个测点，在 \`binding-plan.json\` 里填。
2. **新建场景生成的是骨架。** \`applyScreenTemplate()\` 只吃模板 + 场景名，
   **不带绑定** —— 所以建完场景后卡片是空的，必须用 binding-plan 补齐（或用在线编程
   \`bind-telemetry\` 逐项绑）。
3. **两个东西模板永远管不到**：控制按钮的命令名（每台网关协议不同）、
   3D 节点与设备的对应关系（每个模型不同）。见 \`gaps.json\`。

## 数据流

\`\`\`
template.json ──materializeScreenTemplate(bindings)──> 布局(widgets)
                                     ↑
                          binding-plan.json 填好的值
                                     ↓
                        PUT /api/energy/topologies/{id}/scene-widgets
\`\`\`

## 校验和

见 \`manifest.json\`。任何文件被改动，比对 sha256 就能发现。

## 配套文档

仓库内另有：

- \`docs/screen-widget-spec.md\` —— 部件字段与在线编程的完整规范
- \`docs/template-package-spec.md\` —— 本包结构的说明
${skillNote}
`;

files.push({ name: "README.md", ...writeFileSafe(join(outDir, "README.md"), readme) });

const manifest = {
  packageFormat: "idt-twin-template-package/v1",
  templateId: template.id,
  templateName: template.name,
  templateVersion: template.version,
  generatedAt: new Date().toISOString(),
  generator: "scripts/export-template-package.mjs",
  counts: {
    regions: (template.regions ?? []).length,
    interfaces: bindingPlan.summary.total,
    requiredInterfaces: bindingPlan.summary.required,
    gaps: gaps.gaps.length,
  },
  files: files.map((file) => ({ name: file.name, bytes: file.bytes, sha256: file.sha256 })),
};
writeFileSafe(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

/* ---------------- 报告 ---------------- */
console.log(`模板：${template.name} v${template.version}`);
console.log(`输出：${outDir}\n`);
for (const file of files) {
  console.log(`  ${file.name.padEnd(22)} ${String(file.bytes).padStart(7)} B`);
}
console.log(`  ${"manifest.json".padEnd(22)} ${String(Buffer.byteLength(JSON.stringify(manifest, null, 2))).padStart(7)} B`);
console.log(`\n待填界面字段 ${bindingPlan.summary.total} 项`
  + `（缺了整卡无数据 ${bindingPlan.summary.blocksCard}，`
  + `缺了该处显示暂无数据 ${bindingPlan.summary.showsEmptyWhenMissing}）`);
console.log(`分布：${JSON.stringify(bindingPlan.summary.bySource)}`);
console.log(`其中模板无法直接生成（需实例补）：${bindingPlan.summary.templateUnsupported} 项`);
console.log(`模板管不到的缺口：${gaps.gaps.length} 类`);
if (skillNote) console.log("\n⚠️ 本包不含 skills/SKILL.md（源文件缺失）");

/*
 * 打包成单个 .zip。
 *
 * 放在 manifest 写完之后 —— zip 里要包含 manifest，顺序错了收件方校验不到。
 * 失败时不静默：可能是没装 zip、或权限问题，说清楚让人手工压。
 */
if (wantZip) {
  const zipName = `${template.id}-v${template.version}.zip`;
  const zipPath = join(outDir, "..", zipName);
  try {
    execFileSync("zip", ["-rq", zipName, template.id], {
      cwd: join(outDir, ".."),
      stdio: "pipe",
    });
    console.log(`\n已打包：${resolve(zipPath)}`);
  } catch (error) {
    console.error(`\n打包失败（可手工执行：zip -r ${zipName} ${template.id}）`);
    console.error(`  ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    process.exitCode = 1;
  }
}
