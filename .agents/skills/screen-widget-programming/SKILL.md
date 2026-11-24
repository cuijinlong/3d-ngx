---
name: screen-widget-programming
description: 用「在线编程」提案或脚本改 3d-ngx 大屏部件时使用 —— 调整卡片样式（玻璃质感/透明度/token）、数据绑定（遥测槽/资产属性槽/范围聚合）、交互（启停按钮/3D 选中联动/场景跳转），以及对齐 template01 模板布局。含字段全表、校验规则、常见拒绝原因与验收方法。
---

# 大屏部件在线编程

改 3d-ngx 大屏的卡片样式、数据绑定、交互时用这个 skill。
**完整字段表与校验规则在 `docs/screen-widget-spec.md`** —— 动手前先读它的 §2 和 §4。

## 0. 先确认你改的是哪一层

```
模板 JSON ──设计稿──> 布局(库里 scene-widgets) ──绑定──> 设备/测点/命令
```

| 你要改 | 改哪里 | 别忘了 |
| --- | --- | --- |
| 所有用此模板的场景 | 模板 JSON + 库里布局 | **两边都要改**，只改一边会静默失效 |
| 只这一个场景 | 库里布局（`PUT scene-widgets`） | 下次重建场景会被模板覆盖 |

> 这是 AGENTS.md A2d「真相源只有一个：模板文件」的具体场景。
> 只改 JSON 不改库 → 界面不变；只改库不改 JSON → 重建时被抹掉。

## 1. 工作流

### 1.1 先读现状，不要凭猜

```bash
TOKEN=$(cat /tmp/tb_token.txt)
curl -s -H "X-Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8090/api/energy/topologies/<topologyId>/scene-widgets" \
  | python3 -m json.tool
```

看清每张卡的 `id` / `type` / `slots[].key` / `scope`。
`bind-telemetry` 报 `slot-not-found` 就是因为你写了个不存在的 key。

### 1.2 写提案（JSON 数组）

```json
[
  { "op": "update-widget", "id": "power-trend",
    "patch": { "title": "机组总功率趋势", "subtitle": "POWER TREND" } },
  { "op": "bind-telemetry", "id": "power-trend",
    "slotKey": "series-0", "telemetryKey": "power" }
]
```

**能做什么由模板的 `aiExtension.operations` 决定** —— 天骄热泵模板（v18）自己声明了
边界，只列下面 4 种。读模板就知道能改什么，不用翻代码。

只有 4 种操作真正可用：`add-widget` / `update-widget` / `remove-widget` /
`bind-telemetry`。`add-scene-event` / `add-panel` 虽然出现在模板白名单里，
但**没有实现** —— 提交会得到「尚未实现」的拒绝（spec §7）。
需要场景事件请走编辑器的「场景跳转」面板。

### 1.2b 加卡片前先看 maxCount

`selection-card` / `title` / `caption` 各最多 1 块。**在线编程不校验这条**
（只有编辑器的「添加卡片」按钮会禁用），提案能加成功，然后得到两块重叠的卡，
不报错。加这三类前先确认布局里还没有。

### 1.3 必须走「预览 → 确认」

面板流程刻意分三步，不要跳：

1. 粘贴提案
2. 点「预览差异」—— 逐条列出会改成什么，越界项在这里被拦
3. 确认无误才点「应用」

应用时会用**当前**布局重新校验一遍（预览到应用之间布局可能被撤销改过）。

### 1.4 保存

在线编程「应用」**只改内存**。要落地必须点编辑器「保存」
（`PUT /api/energy/topologies/{id}/scene-widgets`）。

## 1.5 写代码前：先看数据源面板

**不要把键名当成已知的。** 猜错的键不会报错 —— 卡片只是永远显示「暂无数据」。
编辑器工具栏的「数据源」按钮列出本场景所有别名，以及每个别名：

| 栏 | 内容 | 怎么用 |
| --- | --- | --- |
| 遥测 | 真实时序键（如 `power` `temperature` `opening`） | `bind-telemetry` 的 `telemetryKey` |
| 属性 | 一次性属性（如 `deviceCode` `model` `rpcMethods`） | `update-widget` 写 `assetId` + `attributeKey` |
| 告警 | 活跃告警条数 | 判断是否要加告警卡 |

> ⚠️ **遥测和属性是两回事**。属性只有「上次写入」，没有实时值。面板刻意分两栏，
> 就是防你拿属性键当遥测绑 —— 那种卡片永远不刷新。

脚本里直接读，不用抄：

```js
ctx.src("模块机1")           // 按短名取源
ctx.keysOf("模块机1")        // ['opening','power','running','temperature']
ctx.attributesOf("模块机1")  // ['brand','deviceCode','model',...]
ctx.alarmsOf("模块机1")      // [{ type, level, deviceId }]
```

数据源有**两种**：灰色「自动」是从 3D 绑定推导的（零配置就有），
蓝色「声明」是在面板里手工加的（用于起好名字）。同名时声明优先。

**范围源会展开成具体设备**：`kind: "scope"` 的源（场站/场景拓扑）解析出
设备清单后，`ctx.src("units").entityIds` 是真实的一批 id，
`ctx.keysOf("units")` 是这批设备的测点并集。所以「给范围内每台设备生成绑定」
这种脚本可以直接写：

```js
for (const id of ctx.src("units").entityIds) {
  ctx.ops.bind("some-widget", "value", "temperature", id);
}
```

## 2. 三条最容易踩的红线

### 红线一：样式只能填 token 名

```json
{ "style": { "backgroundToken": "--ngx-glass-bg" } }      ✅
{ "style": { "backgroundToken": "#0a1a2e" } }             ❌ 不生效
```

一份布局要同时适配浅色编辑器和深色大屏皮肤，写死颜色就锁死一套主题。
大屏可用 token 见 spec §2.3。

### 红线二：聚合槽必须把口径写进 label

```json
{ "key": "main", "telemetryKey": "power", "aggregate": "sum", "label": "9 台机组之和" }  ✅
{ "key": "main", "telemetryKey": "power", "aggregate": "sum", "label": "总功率" }        ❌
```

`aggregate` 槽没有 `deviceId`，它算的是 scope 内所有设备的和。
写「总功率」会被当成系统总功率（后者还含水泵、风机），实测口径差 30%+。

### 红线三：不要改 `id` / `type`

`update-widget` 的 `patch` 里出现这两个字段会报 `protected-field`。
换类型 = `remove-widget` + `add-widget` —— 否则槽位、绑定、位置全部语义错位。

## 3. 按需求选字段

| 需求 | 字段 | 坑 |
| --- | --- | --- |
| 卡片标题 + 英文副标题 | `title` + `subtitle` | 补了 `subtitle` 才像大屏，否则像后台面板 |
| 位置 / 尺寸 | `x` `y` `w` `h` | **百分比 0–100**，不是像素 |
| 玻璃质感 | `style.*Token` + `glassOpacity` | 布局级 0.25–0.90，默认 0.72；HUD 下 0.42 |
| 绑单台遥测 | `slot.deviceId` + `telemetryKey` | — |
| 绑资产属性 | `slot.assetId` + `attributeKey` | 与 `telemetryKey` **二选一** |
| N 台之和 | `slot.aggregate: "sum"` | 不要填 `deviceId`；label 必须写口径 |
| 开关量显示「运行/停止」 | `slot.displayType: "boolean"` | 不写就显示 1/0/true |
| 进度条 | `slot.render: "bar"` + `barMax` | 只在 `device-list` 的逐台列生效 |
| 按场站/场景凑设备 | `widget.scope` | `site` 要 `siteId`，`topology` 要 `topologyId` |
| 只列某类设备 | `widget.filterText` | 只对 `device-list` / `bar-compare` 生效 |
| 启停按钮 | `widget.controls[]` | 参数名不要猜，从设备属性确认 |

## 4. 对齐 template01 的排版参考值

参考实现在 `packages/data-adapter/src/screen-templates/tianjiao-heat-pump.json`
（v17）。1920×1080 基准：

```
左栏 x=3.13  w=11.35      右栏 x=85.51 w=11.35
底部左 x=3.13  w=46.50    底部右 x=50.36 w=46.50
纵向 13.43 起，底部到 81.20，块间留 0.83
```

高度按**内容量**分配，不要反过来：

| 卡 | 内容 | 合理高度 |
| --- | --- | --- |
| 运行汇总（总数+3格+在线率） | 多 | 26.95 |
| 选中机组（空态准星框） | 中 | 27.50 |
| 系统控制（1 个按钮） | 少 | 11.66 |

反面教材：把只有 1 个按钮的系统控制给 24.52、把 4 个数字块的运行汇总给 17.08
—— 内容最多的最矮，界面会头重脚轻。

## 5. 验收（不能只看截图）

```bash
# 1) 两态逐项比对：编辑器设计态 vs 运行态，退出码 0 = 一致
node scripts/verify-wysiwyg.mjs

# 2) 读库确认字段真的写进去了
curl -s -H "X-Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8090/api/energy/topologies/<id>/scene-widgets" | python3 -m json.tool

# 3) 提案校验的单测
cd apps/web && ../../node_modules/.bin/vitest run layout-proposal
```

**为什么必须两态比对**：编辑器和大屏曾经各写一套订阅范围，编辑器漏了
「槽位直绑的网关」和「scope 设备」，设计时「进水 —／系统启停·状态未知」，
打开后却有值。这类缺陷不报错，只让某几块卡安静地「暂无数据」。

## 6. 出问题先查这张表

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| 卡片整块消失 | 可见性判据要求「有值」 | 判据改「配置完整就显示」，缺数让卡片自己说 |
| 提示「还没有绑定设备」但配了范围 | 该类型 `scopePerDevice`，本来就没 `deviceId` | 走 `describePendingSlot` 对应分支 |
| 换了测点没生效 | 槽位同时有 `assetId` 和 `telemetryKey` | 二选一（`bind-telemetry` 会自动清） |
| 改样式没变化 | 写了十六进制色值 | 换成 `--ngx-*` token |
| 卡片显示「延迟 N」但数据是新的 | 持续上报进程停了 | 重启 `scripts/simulate-unit-power.mjs` |
| 提案被拒但理由看不懂 | 可能是 §7 那两个未实现操作 | 换用 4 种真实操作 |
| 卡片绑了值却一直「暂无数据」 | 键名不存在，或把**属性**当遥测绑了 | 到「数据源」面板对照遥测/属性两栏 |

## 7. 改动落库后

涉及字段含义变更时，**同一个提交里**同步更新：

- `docs/screen-widget-spec.md`（字段表 / 校验规则）
- 本 skill（工作流 / 红线）

这是 AGENTS.md A2h「手册、脚本、代码三者不许断档」的要求：
代码改了行为、文档还是旧的，下一个人照旧文档做反而错。
