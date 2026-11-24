# 数字孪生模板包规范

> 一套模板 ≠ 一张 HTML。它是**引擎可渲染的布局契约 + 施工资料**。
> 本文说明一个模板包里有什么、每份文件解决什么问题、以及怎么交给模型去建。

最后核对：2026-11-23，对照 `screen-template.ts` / `CreateSceneWizard.tsx` /
`template.manifest.json` / 导出脚本 `scripts/export-template-package.mjs`。

---

## 1. 为什么不是 HTML

`template01/index.html` 是**视觉参考稿**：它用 div 摆出一张图，可以浏览器预览，
但引擎不读它。

真正被引擎渲染的是 `template.json`（对应 `ScreenTemplate` 类型）：

| | HTML 模板 | 本模板 |
| --- | --- | --- |
| 谁渲染 | 浏览器直接渲染 DOM | 引擎按 `regions` 生成 widgets |
| 数据 | 写死在 DOM 里 | 每个界面字段（`interfaces`）声明「这里要一个值」 |
| 换现场 | 重做页面 | 只换绑定（`interfaceBindings`） |
| 同一模板多场景 | 复制多份 HTML | 一份模板 + 多份实例绑定 |

所以模板包里**没有 HTML**，取而代之的是「模板 + 绑定清单 + 缺口说明」。

## 2. 包结构

```
<tpl-id>-v<version>/
├── README.md            交接入口：这份包是什么、按什么顺序读
├── manifest.json        包元信息 + 每个文件的 sha256
├── template.json        模板本体，引擎直接渲染
├── binding-plan.json    ★ 待填绑定清单（逐项说明怎么填）
├── scene-form.json      「新建场景」表单逐字段值
├── object-binding.json  3D 对象 ↔ 设备的匹配规则
├── gaps.json            模板结构性覆盖不到、必须实例补齐的部分
└── skills/SKILL.md      给模型的执行提示词
```

导出于：`node scripts/export-template-package.mjs [--template <id>] [-o <dir>]`

## 3. 每份文件

### 3.1 `template.json`

`ScreenTemplate`。字段：

```ts
{
  schemaVersion, id, name, version, description,
  regions: [{
    id, type, zone, x, y, w, h,
    defaultTitle, defaultSubtitle?,
    filterText?,
    interfaces: [{ key, name, valueType, allowedSources, optional? }]
  }],
  objectBinding?: { matchBy, description, fields[] },
  aiExtension?: { operations[], requiresDiffReview, ... }
}
```

`regions[].interfaces` 是这套设计的核心：每个 interface 声明
「这块卡上有一个位置，它要一个什么类型的值」。

`valueType`：

| 值 | 含义 |
| --- | --- |
| `number` | 单个数值（一个槽） |
| `number-series` | 一串时序（趋势图） |
| `scope` | 范围（场站/场景拓扑），不是数值 |

`allowedSources`：这个位置能从哪取值（`device-point` / `asset-attribute` /
`site` / `scene-topology`）。多个来源时选哪个见 binding-plan 的 `preferredSource`。

### 3.2 `binding-plan.json`（最重要）

把 `regions[].interfaces` 摊平成一张待填表。每项：

```json
{
  "regionId": "unit-list", "regionTitle": "机组状态", "regionType": "device-list",
  "key": "opening", "name": "开度", "valueType": "number",
  "allowedSources": ["device-point"], "preferredSource": "device-point",
  "required": false, "blocksCard": false, "showsEmptyWhenMissing": true,
  "guide": { "what": ..., "fill": ..., "howToGet": ..., "warn": ... },
  "example": { "regionId": "unit-list", "key": "opening", "source": "device-point", ... }
}
```

**两档「必填」不能混**（这是实测结论）：

| 字段 | 含义 | 不填的后果 |
| --- | --- | --- |
| `blocksCard: true` | 整张卡依赖它 | 整卡无数据 |
| `showsEmptyWhenMissing: true` | 只是少一路信息 | 该处显示「暂无数据」，其余正常 |

`blocksCard` 的判据来自 `SCENE_WIDGET_TYPE_REGISTRY` 的 `scopeRequired` ——
导出脚本**每次去源码里重新解析**，不在脚本里硬编码，避免 registry 改了包却不变。

天骄热泵模板（v18）的实测分布：16 项待填，其中 3 项 `blocksCard`
（device-list / summary-card / bar-compare 的 scope），13 项可后补。

### 3.3 `scene-form.json`

「新建场景」弹窗的每个字段。`source` 决定怎么填：

| source | 怎么处理 |
| --- | --- |
| `fixed` | 用包里的 `value`（如 templateId） |
| `input` | 用户给 |
| `enum` | 从 `options` 里选 |
| `platform` | ★ **必须从平台 API 读，不能编** |
| `file` | 用户上传 |

`source: "platform"` 的三个字段最容易出错：

- `viewType` —— 来自编辑器内 `getTopologyApi().views()` 的 `options[].code`
- `stylePack` —— 来自 `.stylePacks()` 的 `packs[]`
- `siteId` —— 来自 `/api/tenant/assets`（或 topologies 的 sites）

**没有固定枚举。** 编一个看起来合理的值，只会让创建失败或选错套装。

### 3.4 `object-binding.json`

来自模板的 `objectBinding`，说明 3D 节点怎么和设备对上：

```json
{ "matchBy": "objectName", "description": "...", "fields": [...] }
```

`matchBy: "objectName"` = 按 GLB 节点名匹配设备名。
匹配不上时**铭牌和选中卡没数据，且不报错** —— 这是必须抽查的原因。

### 3.5 `gaps.json`

模板**结构性**覆盖不到的部分。不是写漏了，而是它们承载「这台设备/这条命令」，
每换一个现场都必须重填。

天骄热泵模板实测 5 类：

| 缺口 | 为什么模板管不到 |
| --- | --- |
| 无界面定义的卡片（control-bar / selection-card） | 控制条发命令、选中卡靠点击，不读遥测 |
| 3D 对象 ↔ 设备匹配 | 模板只声明 `matchBy`，具体对应是实例数据 |
| 设备底座 / 风格套装 / 天气地点 | 视觉相关，与数据无关 |
| **资产属性槽（asset-attribute）** | 模板声明支持，但绑定结构里没有对应字段 |
| **范围聚合口径（aggregate）** | 模板 `valueType` 只有 number/series/scope，**没有 aggregate** |

后两条最容易漏，都有实证：

**`aggregate`** —— `screen-template.ts` 全文出现 **0 次**。库里
`system-power.main` 的 `aggregate: "sum"` 是实例层加上的。所以用模板新建场景，
「9 台机组之和」那个槽是空的。

**`asset-attribute`** —— 模板的 `interfaces.allowedSources` 允许它，
但 `TemplateInterfaceBinding` 的字段只有 `deviceId` / `telemetryKey`，
**没有 `assetId` / `attributeKey`**；`materializeScreenTemplate` 也只写这两个。
声明和实现脱节。

天骄模板里「装机参数」三项受影响，其中 `main` **只能**用资产属性
（`allowedSources` 只有它），所以按模板建场景，那张卡必然空 —— 必须后补。

### 3.6 `skills/SKILL.md`

给模型的执行提示词。它把上面所有文件编排成步骤：
读包 → 要三样输入 → 建场景 → **补绑定** → 补 gaps → 三层验收。

### 3.7 `manifest.json`

```json
{ "packageFormat": "idt-twin-template-package/v1",
  "templateId", "templateName", "templateVersion", "generatedAt",
  "counts": { "regions", "interfaces", "gaps" },
  "files": [{ "name", "bytes", "sha256" }] }
```

校验完整性：

```bash
cd <包目录> && python3 -c "
import json, hashlib, pathlib
m = json.load(open('manifest.json'))
bad = []
for f in m['files']:
    p = pathlib.Path(f['name'])
    if not p.exists(): bad.append(f\"{f['name']} 缺失\"); continue
    h = hashlib.sha256(p.read_bytes()).hexdigest()
    if h != f['sha256']: bad.append(f\"{f['name']} 被改动\")
print('✓ 全部一致' if not bad else '\n'.join(bad))
"
```

## 4. 渲染契约：模板怎么变成界面

```
template.json + interfaceBindings
        │
        ▼
materializeScreenTemplate(template, { sceneName, interfaceBindings, regionTitles })
        │
        ▼
SceneWidgetLayout（widgets[]）
        │
        ▼
PUT /api/energy/topologies/{topologyId}/scene-widgets
```

**关键事实**：`applyScreenTemplate(layout, template, sceneName)` 只传了 `sceneName`，
**不传绑定**。所以「用模板新建场景」得到的是**骨架** ——
位置、标题、槽位 key 都在，但每个槽没有 deviceId/telemetryKey。

> 这不是缺陷，是分层：模板是「这类界面长什么样」，绑定是「这个现场用哪个测点」。
> 但接手的人必须知道，否则会以为建完就能用。

要一次成型，直接调用 `materializeScreenTemplate` 并传 `interfaceBindings`。

## 5. 交接流程（用户 → 模型）

用户提供：

1. **模板包目录**（本文 8 个文件）
2. **设备映射**：3D 节点名 / 设备名 → 平台 deviceId
3. **数据绑定要求**：每个界面字段 → 测点键或属性键
4. **新建场景表单项**的值（`viewType` / `stylePack` 可让模型自己读平台）

模型执行（见包内 `skills/SKILL.md`）：

```
读 manifest 校验完整性
 → 读 binding-plan，标出 blocksCard 的几项（通常 3 条）
 → 读 scene-form，platform 类字段去平台取
 → 建场景（templateId 用包里的）
 → 填 interfaceBindings → materializeScreenTemplate → PUT
 → 补 gaps：aggregate / controls / 3D 匹配
 → 三层验收（库字段 / 两态比对 / 数据真在动）
```

## 6. 与 `template01/` 的区别

`template01/` 是**参考稿**：`index.html` + `manifest.json` + 一个 React 挂载示例，
用来照着抠布局（左右翼宽度、卡片头样式、底部模块高度）。

本文说的是**可交付模板包**：能被引擎渲染、能换绑定直接上现场的形态。

两者不冲突：抠样式看 `template01/`，建场景用模板包。

## 7. 导出与维护

```bash
# 导出（默认天骄热泵，输出到 _tmp-template-package/<id>/）
node scripts/export-template-package.mjs
node scripts/export-template-package.mjs --template <id> -o <dir>

# 额外打成一个 .zip —— 「把这套模板下载下来发出去」时用这个
node scripts/export-template-package.mjs --zip
# → _tmp-template-package/tianjiao-heat-pump-v18.zip（约 14 KB，含全部 8 个文件）
```

导出是幂等的：同一模板重复导出，`binding-plan.json` 等文件逐字节相同
（只有 `manifest.json` 的 `generatedAt` 会变）。导出产物在 `.gitignore` 里，
不进仓库 —— 它随时可由源文件重建。

`binding-plan.json` 的 `blocksCard` 判据**从源码解析**，不硬编码。
改了 `SCENE_WIDGET_TYPE_REGISTRY` 的 `scopeRequired`，重新导出即同步。

改模板后必须重新导出 —— `manifest.json` 的校验和会变，
接手方一眼就能看出「包是旧的」。

## 8. 已知边界

| 边界 | 说明 |
| --- | --- |
| 模板不支持 `aggregate` | 聚合口径在实例层配（`gaps.json` 有说明） |
| 模板不支持 `asset-attribute` | 声明允许但无字段；资产属性槽在实例层配 |
| 模板不支持 `controls` | 控制按钮绑具体设备/命令，每现场不同 |
| 模板不支持 `displayType` 的完整枚举 | 导出时按 interface 类型推断，复杂场景需手工核对 |
| 无 HTML 预览 | 要静态预览看 `template01/`，或直接进编辑器 |
