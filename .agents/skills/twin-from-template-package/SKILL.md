---
name: twin-from-template-package
description: 拿到一套数字孪生模板包（template.json + binding-plan.json + scene-form.json + object-binding.json + gaps.json）后，据此在 3d-ngx 里把整套大屏建起来时使用 —— 包含新建场景各表单项取值、逐字段数据绑定、模板覆盖不到的聚合口径与控制按钮补齐、以及建完的验收。用户说「模板下载下来了，帮我建数字孪生」时用这个。
---

# 从模板包创建整套数字孪生

用户给你一个模板包目录 + 一套后端设备映射关系 + 数据绑定要求。
目标：在 3d-ngx 里建出一个**能出数**的大屏，不是建一个空骨架。

## 0. 先读包，别急着动手

按顺序读，每份都有不可替代的信息：

| 文件 | 你要读出什么 |
| --- | --- |
| `manifest.json` | 版本、文件校验和。先确认包完整 |
| `template.json` | 有哪些 region、每个 region 的 interfaces |
| `binding-plan.json` | **待填清单**：16 项左右，每项要填什么、去哪取 |
| `scene-form.json` | 新建场景表单逐字段值 |
| `object-binding.json` | 3D 节点怎么对设备 |
| `gaps.json` | ★ 模板管不到的，必须你补 |

`gaps.json` 是最容易漏的。模板只定义「这里要一个数字」，不定义「这个数字怎么算」。

## 1. 先向用户要这三样，缺一不可

不要自己猜设备 id 和测点键 —— 猜出来的不会报错，只会让卡片永远「暂无数据」。

```
① 设备映射：3D 节点名 / 设备名 → 平台 deviceId
② 数据绑定要求：每个界面字段 → (deviceId 或 assetId) + (telemetryKey 或 attributeKey)
③ 新建场景表单项：场景名称、场站、视图类型、风格套装、（全景套装的）天气地点
```

`scene-form.json` 里标 `source: "platform"` 的字段（`viewType`、`stylePack`、`siteId`）
**必须从平台读**，不能编：

```bash
TOKEN=$(cat /tmp/tb_token.txt)
curl -s -H "X-Authorization: Bearer $TOKEN" "http://127.0.0.1:8090/api/tenant/assets" | head -c 800   # 场站
# viewType / stylePack 走编辑器内的 getTopologyApi().views() / .stylePacks()
```

用户没给 `②` 时，逐项问 `binding-plan.json` 里 `blocksCard: true` 的那几条
（通常是 3 条：device-list / summary-card / bar-compare 的 scope）——
这些不填，整张卡没数据。`showsEmptyWhenMissing: true` 的可以后补。

## 2. 建场景（用 scene-form.json 的值）

```
POST/PUT 走编辑器新建流程（CreateSceneWizard → saveScene）
关键：templateId = template.json 的 id
```

**建完场景，卡片是空的** —— 这是设计如此，不是失败。

原因：`applyScreenTemplate()` 只吃「模板 + 场景名」，**不带绑定**
（见 `screen-template.ts` 的 `materializeScreenTemplate(template, { sceneName })`）。
它产出的是**骨架**：位置、标题、槽位 key 都在，但每个槽没有 deviceId/telemetryKey。

> 别把「骨架」当成「建完了」。这一步的验收只看一件事：
> `GET .../scene-widgets` 里 widgets 数量 = `template.json` 的 region 数量。

## 3. 把 binding-plan 填成正式布局

有两条路，优先第一条（一次成型，少十几轮请求）：

### 路 A：直接生成完整布局并 PUT（推荐）

按 `binding-plan.json` 的 items 组装 `interfaceBindings`，格式见
`docs/screen-widget-spec.md` 与 `TemplateInterfaceBinding`：

```json
[
  { "regionId": "system-power", "key": "left", "source": "device-point",
    "deviceId": "<网关UUID>", "telemetryKey": "water_in_temp" },
  { "regionId": "unit-list", "key": "scope", "source": "scene-topology",
    "topologyId": "<本场景拓扑>" }
]
```

然后 `materializeScreenTemplate(template, { sceneName, interfaceBindings })`
→ `PUT /api/energy/topologies/{topologyId}/scene-widgets`。

### 路 B：在线编程逐项 bind-telemetry

适合只改几处。提案必须走「预览 → 应用」，且只有 4 种操作可用
（见 skill `screen-widget-programming`）。

## 4. 补 gaps.json 里的东西（这步决定能不能真出数）

### 4.0 资产属性槽（模板声明支持，但生成不出来）

`binding-plan.json` 里 `templateSupported: false` 的项就是这种。

原因：模板的 `allowedSources` 允许 `asset-attribute`，但
`TemplateInterfaceBinding` 只有 `deviceId`/`telemetryKey`，**没有资产字段**，
`materializeScreenTemplate` 也只写这两个。声明和实现脱节。

处置：建完场景后用 `update-widget` 在实例层写：

```json
{ "op": "update-widget", "id": "plant-capacity",
  "patch": { "slots": [
    { "key": "main", "label": "制冷量", "unit": "kW",
      "assetId": "<资产UUID>", "attributeKey": "rated_cooling_capacity" },
    { "key": "left", "label": "制热量", "unit": "kW",
      "assetId": "<资产UUID>", "attributeKey": "rated_heating_capacity" },
    { "key": "right", "label": "压缩机功率", "unit": "kW",
      "assetId": "<资产UUID>", "attributeKey": "compressor_power" }
  ] } }
```

天骄模板的「装机参数」整张卡都是这种。**不补就是空的**，而且不报错。

### 4.1 聚合口径（最容易漏）

模板**没有 aggregate 字段**，`materializeScreenTemplate` 也不写它。
所以「9 台机组之和」这种必须在实例层补：

```json
{ "op": "update-widget", "id": "system-power",
  "patch": { "slots": [
    { "key": "main", "label": "9 台机组之和", "unit": "kW", "telemetryKey": "power", "aggregate": "sum" },
    { "key": "left", "label": "进水", "unit": "℃", "telemetryKey": "water_in_temp", "deviceId": "<网关>" },
    { "key": "right", "label": "出水", "unit": "℃", "telemetryKey": "water_out_temp", "deviceId": "<网关>" }
  ] } }
```

**注意 `update-widget` 的 `patch` 是浅合并**：`slots` 会整体替换。
改一个槽要先读出现有三个再整体写回，否则另外两个会丢。

`label` 必须写口径（「9 台之和」而不是「总功率」）—— 后者会被当成系统总功率，
实际差 30%+（还包含水泵、风机）。

### 4.2 控制按钮（`controls`）

模板的 `control-bar` 没有 interface，因为命令名每台网关不同。
从设备属性读，不要猜：

```bash
curl -s -H "X-Authorization: Bearer $TOKEN" \
  ".../DEVICE/<网关>/values/attributes/SERVER_SCOPE?keys=rpcMethods"
```

然后写 `controls[]`：`deviceId` + `commandId` + `onParams`/`offParams` + `stateKey`。
`stateKey` 若是 `sys_run_state`，取值是数字枚举（1 停机 / 5 运行 / 8 故障），
**不是 truthy**。停机类动作必须写 `confirmText`。

### 4.3 3D 对象匹配

按 `object-binding.json` 的 `matchBy`（通常是 `objectName`）。
节点名和设备名对不上 → 铭牌和选中卡无数据，**不报错**。
建完抽查一台：点 3D 里的机组，看「选中机组」卡是否有值。

## 5. 验收（三层，缺一层都不算完）

```bash
# ① 布局字段真的写进库了
TOKEN=$(cat /tmp/tb_token.txt)
curl -s -H "X-Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8090/api/energy/topologies/<id>/scene-widgets" | python3 -m json.tool

# ② 设计态 == 运行态（这是「所见即所得」的硬判据）
node scripts/verify-wysiwyg.mjs        # 退出码 0

# ③ 数据真的在动（不是空骨架）
#    运行态每张卡都该有值或明确的「等待…」说明，不能是笼统的「暂无数据」
```

判据表：

| 现象 | 说明 |
| --- | --- |
| 卡片显示「还没有选择设备」，但 binding-plan 已填 | `patch` 整体替换把 slots 冲掉了，回去核对 |
| 「9 台之和」显示单台值 | 缺 `aggregate: "sum"` |
| 系统启停显示「状态未知」 | `stateKey` 没配，或网关没上报该键 |
| 3D 有模型、卡片全空 | 少填了 scope（`blocksCard` 那 3 条） |
| 卡片显示数字但明显偏小 | 填了单台而不是聚合，或测点选错 |

## 6. 交付前检查

- [ ] `scene-widgets` 的 widgets 数量 = 模板 region 数量
- [ ] `binding-plan.json` 里 `blocksCard: true` 的全部填了
- [ ] 聚合槽都有 `aggregate` 且 `label` 写了口径
- [ ] `templateSupported: false` 的项（资产属性）都在实例层补齐了
- [ ] `controls` 的命令名来自设备 `rpcMethods`，不是猜的
- [ ] `verify-wysiwyg` 退出码 0
- [ ] 模板 JSON 与库里布局一致（只改库不改模板，下次重建会被覆盖）

最后一条最容易忘：**模板是设计稿，库是实例**。两处不同步，下一次
「用模板重建场景」就把手工补的绑定全冲掉，而且不报错。

## 7. 3D 渲染：建完一定验证这三件（2026-11-23 补）

大屏「看着建好了」但 3D 是死的，是这个项目最常返工的地方。
以下三条**不会报错**，只能主动验证。

### 7.1 模型必须在平台，不能只在浏览器

`SceneDocument` 存 IndexedDB（仅本机），但模型走平台 `glb.objectKey`。
换一台电脑访问时，`hydrateRootModelFromPlatform` 会从
`/api/energy/topology-assets?objectKey=...` 拉 GLB。

**验收**：用无痕窗口（或清空 IndexedDB）打开场景，3D 必须正常。

**若空白**，先查 `/api` 代理，不要怀疑模型丢失：
- 开发：`vite.config.ts` 的 `server.proxy` 有 `/api`
- 预览：`preview.proxy` 也必须有（2026-11-23 前缺失，LAN 访问模型全空）
- 生产：nginx 必须转发 `/api`、`client_max_body_size ≥ 64m`

### 7.2 管道流动依赖播放器，而 PlayCanvas 不会自动建

`instantiateRenderEntity()` **只造渲染实体，不建 AnimComponent**。
必须调 `attachModelAnimations`（已在 `EngineManager.loadGlb` 里）。

**验收判据**：浏览器 console 有

```
[engine] 已为 94 段 GLB 动画挂载播放器（68 个节点）
```

没有这行 = 动画一个都没挂 → 管道不动、阀门不动、仪表摆针不动，
但**风扇仍会转**（那是 `setSpin` 代码回退，不用动画）。
「风扇转、管道不流」正是播放器缺失的指纹。

### 7.3 三个 PlayCanvas API 陷阱

```ts
entity.addComponent("anim", { activate: true });      // 数据对象，不是 new AnimComponent()
anim.assignAnimation(c, t);                           // 首次自动建 Base layer
anim.addLayer(c2, 1);                                 // 后续必须先建 layer
anim.assignAnimation(c2, t2, c2);                     // 否则静默 "layer doesn't exist"
layer.pause();                                        // AnimComponentLayer 没有 stop()
```

动画名规律：`<节点名>_<后缀>`，后缀
`flow|spin_fan|blink_led|swing_gauge|swing_door|open|close|on|off`。
反推节点名要按**已知后缀**剥，不能取最后一个下划线之前
（`1_spin_fan` 会变成 `1_spin`）。

### 7.4 风格套装目前不影响渲染

`GET /api/energy/topology-style-packs` 返回的 `description`（如「管三态」）
**在引擎代码里没有对应实现**。选套装目前只记录一个标签。

要让套装真正驱动渲染（流速、关阀颜色、状态环），需要平台侧扩展
`stylePacks()` 返回结构 + 前端按 `packId` 取规则。见
`docs/3d-rendering-and-assets.md` §三。

**不要因为「选中了套装」就认为渲染规则已生效。**

## 8. 相关 skill

- `screen-widget-programming` —— 字段全表、校验规则、在线编程提案怎么写
- 规范：`docs/screen-widget-spec.md`、`docs/template-package-spec.md`
- 3D 渲染与资源真相：`docs/3d-rendering-and-assets.md`（必读，含静默失败清单）
