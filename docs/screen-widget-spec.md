# 大屏部件与在线编程规范（spec）

> 面向：通过「在线编程」面板或脚本修改大屏部件的**人**与**模型**。
> 本文只写代码里真实存在的字段与行为。凡未在 `packages/data-adapter/src/` 里
> 实现的，标为「未实现」，不要用。
>
> 最后核对：2026-11-23，对照 `scene-widget-layout.ts` / `layout-proposal.ts` /
> `screen-template.ts` / `scene-jump-draft.ts`。

---

## 0. 30 秒速览：要改什么，看哪一节

| 我想… | 用哪个操作 | 看 |
| --- | --- | --- |
| 改卡片标题 / 尺寸 / 位置 | `update-widget` | §4.2、§2.2 |
| 改卡片的玻璃质感、透明度 | `update-widget` → `style` / `glassOpacity` | §2.3 |
| 把某个槽位绑到别的测点 | `bind-telemetry` | §4.4 |
| 加一块新卡片 | `add-widget` | §4.1、§3 |
| 删掉一块卡片 | `remove-widget` | §4.3 |
| 加一个控制按钮（启停） | `update-widget` → `controls` | §2.5、§6.1 |
| 让卡片按场站/场景自动凑设备 | `update-widget` → `scope` | §2.4 |
| 让卡片显示 N 台之和而不是单台 | `update-widget` → `slots[].aggregate` | §2.4 |

**做不到的**（不要尝试，会报错或被静默忽略）：

- 改卡片的 `id` / `type`（要换类型 = 删除 + 新增）
- `add-scene-event` / `add-panel` —— 白名单里有，但**没有实现**（见 §7）
- 改 3D 模型的几何、相机、光照

---

## 1. 三层模型：先搞清你改的是哪一层

```
模板（Template）       ── 设计稿：有哪些卡、怎么排版、槽位叫什么
   ↓ 实例化
布局（Layout）         ── 一台场景的 scene-widgets 文档，含坐标与卡片
   ↓ 绑定
实例绑定（Bindings）   ── 哪台设备、哪个测点、哪条命令
```

| 层 | 存放位置 | 谁改 |
| --- | --- | --- |
| 模板 | `packages/data-adapter/src/screen-templates/*.json`，或布局里的 `templateDraft` | 改文件；`templateDraft` 是库里覆盖版，优先级更高 |
| 布局 | 平台 `PUT /api/energy/topologies/{id}/scene-widgets` | 在线编程面板、编辑器拖动、脚本 |
| 绑定 | 布局内 `widgets[].slots[].deviceId` 等字段 | 绑定面板、在线编程（`bind-telemetry`） |

**模板解析优先级**（`resolveScreenTemplate`）：

```
layout.templateDraft  >  layout.templateId 对应的内置模板  >  无
```

> ⚠️ **改模板 JSON 必须同时改布局里的实例**。只改 JSON 不改库，界面不会变；
> 只改库不改 JSON，下次用模板重建场景会把改动抹掉。这是 AGENTS.md A2d
> 「真相源只有一个：模板文件」的具体表现。

**`templateVersion` 只是记录，不参与任何逻辑**（2026-11-23 核对）：没有「模板有新版
就提示更新」的比较代码，`aiExtension` 也总是从当前模板读，不看这个字段。
所以库里显示 `templateVersion: 16` 而模板是 v18，不影响功能 ——
但**不要据此判断「布局是旧的」**。真正决定界面的是 `widgets` 数组本身。

### 模板化的剥离规则

`toTemplateWidgetLayout()` 从实例生成模板时会**故意丢掉**这些（因为它们属于
某一个客户/某一台设备，换客户就失效）：

| 丢弃 | 理由 |
| --- | --- |
| `slot.deviceId` / `assetId` / `attributeKey` / `staleAfterSec` | 实例数据，模板里必须是占位 |
| `widget.scope` | 场站/场景是实例的 |
| `widget.controls` | 按钮绑具体网关，带过去会在新客户下静默失败 |
| `layout.interfaceBindings` / `regionTitles` | 实例配置 |

保留：`key` / `label` / `unit` / `displayType` / `render` / `barMax` / `aggregate`
—— 这些是「这一列怎么显示」，属于设计。

---

## 2. 部件字段全表

### 2.1 顶层

```ts
interface SceneWidget {
  id: string;              // 唯一，不允许改（改 = 换一张卡）
  type: string;            // 见 §3，不允许改
  x: number;               // 左边缘，百分比 0–100
  y: number;               // 上边缘，百分比 0–100
  w: number;               // 宽，百分比
  h: number;               // 高，百分比
  title?: string;
  subtitle?: string;       // 标题右侧小字英文，如 "SYSTEM POWER"
  style?: SceneWidgetStyle;
  slots?: SceneWidgetSlot[];
  scope?: SceneWidgetScope;
  filterText?: string;     // 只对 device-list / bar-compare 生效
  controls?: SceneWidgetControl[];
}
```

坐标是**百分比**，不是像素。1920×1080 下 `w: 11.35` ≈ 218px。

排版经验值（来自 `template01` 对齐实践）：

| 区域 | x | w |
| --- | --- | --- |
| 左栏 | 3.13 | 11.35 |
| 右栏 | 85.51 | 11.35 |
| 底部左 | 3.13 | 46.50 |
| 底部右 | 50.36 | 46.50 |

左右栏的 `y` 从 13.43 开始、底部到 81.20；块间留 0.83 的缝看起来最稳。

### 2.2 布局级字段

```ts
interface SceneWidgetLayout {
  schemaVersion: "1.0.0";       // 不允许改
  glassOpacity?: number;        // 0.25–0.90，默认 0.72；大屏 HUD 默认 0.42
  templateId?: string;
  templateVersion?: number;
  templateDraft?: ScreenTemplate;
  interfaceBindings?: TemplateInterfaceBinding[];
  regionTitles?: Record<string, string>;
  widgets: SceneWidget[];
}
```

> `glassOpacity` 传 72（百分数）会被自动折算成 0.72；超出 0.25–0.90
> 会被钳制，不会报错。

### 2.3 样式

```ts
interface SceneWidgetStyle {
  backgroundToken?: string;  // 默认 "--ngx-glass-bg"
  borderToken?: string;      // 默认 "--ngx-glass-border"
  blurToken?: string;        // 默认 "--ngx-glass-blur"
  textToken?: string;        // 默认 "--ngx-color-text"
  mutedToken?: string;       // 默认 "--ngx-color-muted"
  opacity?: number;          // 单卡覆盖 layout.glassOpacity
}
```

**只能填 CSS 变量名，不能填十六进制色值。** 这是刻意的：同一份布局要能同时
适配浅色编辑器主题和深色大屏皮肤，写死颜色就锁死了一套主题。

可用的 HUD 变量（大屏皮肤下自动生效）：`--ngx-hud-bg`、`--ngx-hud-text`、
`--ngx-hud-muted`、`--ngx-hud-label`、`--ngx-hud-accent`、`--ngx-hud-gold`、
`--ngx-hud-success`、`--ngx-hud-warning`、`--ngx-hud-danger`、
`--ngx-hud-glass-bg`。

### 2.4 数据槽位

```ts
interface SceneWidgetSlot {
  key: string;                    // 槽位标识，如 "main" / "left" / "right"
  label?: string;                 // 显示名，如 "进水"
  unit?: string;                  // 单位，如 "℃"
  displayType?: "number" | "boolean" | "text";
  render?: "value" | "bar";       // bar 只在 device-list 的逐台列生效
  barMax?: number;                // bar 满量程，默认 100
  aggregate?: "sum" | "avg" | "max" | "min";
  telemetryKey?: string;          // 遥测键
  sceneEntityId?: string;
  deviceId?: string;              // 仅实例填写
  assetId?: string;               // 资产属性槽（与 telemetryKey 二选一）
  attributeKey?: string;
  attributeScope?: "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";
  staleAfterSec?: number;         // 超时后仍显示值，只标「更新于 X 前」
}
```

三种槽位的区别（**选错会让卡片永远空着**）：

| 形态 | 判据 | 数据来源 | 典型用法 |
| --- | --- | --- | --- |
| 单设备遥测 | 有 `deviceId` + `telemetryKey` | 该设备的实时遥测 | 「进水温度」 |
| 资产属性 | 有 `assetId` + `attributeKey` | 资产属性，无「实时」概念 | 「额定制冷量 715kW」 |
| 范围聚合 | 有 `aggregate`，**无 `deviceId`** | scope 内所有设备同一键，服务端聚合 | 「9 台机组之和」 |

> ⚠️ **聚合槽必须把口径写进 `label`**。写「总功率」而实际是 9 台之和，
> 现场会把它当成系统总功率（后者还含水泵、风机）。实测口径差 30%+。

`displayType` 优先级：**槽位 > 绑定的 mapping**。开关量（`running` / `door`）
不声明 `displayType: "boolean"` 时，大屏会出现「1」「0」「true」。

### 2.5 范围（scope）

```ts
interface SceneWidgetScope {
  kind: "site" | "topology";
  siteId?: string;    siteName?: string;
  topologyId?: string; topologyName?: string;
}
```

`kind: "site"` 必须有 `siteId`；`kind: "topology"` 必须有 `topologyId`，
否则 `parseWidgetScope` 返回 `undefined`，卡片等于没配范围。

**哪些类型需要 scope**（见 §3 的 `scopeRequired`）：需要「凑一批设备」的类型。
`metric-card` 绑的是单台，不需要。

### 2.6 控制按钮（交互）

```ts
interface SceneWidgetControl {
  key: string;
  label?: string;                       // 如 "系统启停"
  deviceId: string;                     // 必须是平台实时设备
  commandId: string;                    // 来自该设备 SERVER_SCOPE 的 rpcMethods
  kind?: "toggle" | "button";           // toggle = 一个按钮管开和关
  onParams?: Record<string, unknown>;   // toggle：切到「开」发的参数
  offParams?: Record<string, unknown>;  // toggle：切到「关」发的参数
  params?: Record<string, unknown>;     // button：固定参数
  stateKey?: string;                    // toggle 读哪个遥测键判当前状态
  confirmText?: string;                 // 二次确认文案
}
```

> **参数名不要猜。** 真实协议的开关参数名不统一（本环境是 `on`，别的网关
> 可能是 `value`）。必须从设备属性或协议手册确认后写死在配置里。

---

## 3. 部件类型清单

注册表：`SCENE_WIDGET_TYPE_REGISTRY`（`scene-widget-layout.ts`）。
加新类型只改这张表，不要在部件层写 if 链。

| type | 中文 | 默认尺寸 | slots | scope | 必需 scope | 逐台列 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `metric-card` | 主指标 | 20.4×18 | ✓ | ✓ | — | — | 槽位 `main`/`left`/`right` |
| `ratio-ring` | 已用/总数圆环 | 20.4×22 | ✓ | ✓ | ✓ | — | 两个槽画圆环比例 |
| `gauge-ring` | 环形仪表 | 20.4×20 | ✓ | — | — | — | 粗环+渐变+光点+刻度；槽位 `value-N`/`max-N`，量程可用 `constant` |
| `trend-chart` | 趋势小图 | 20.4×22 | ✓ | ✓ | — | — | 单设备走 store 累积；聚合槽走历史接口 |
| `summary-card` | 状态汇总 | 20.4×16 | — | ✓ | ✓ | — | 运行/离线/故障计数 + 在线率 |
| `selection-card` | 选中对象卡 | 20.4×22 | — | — | — | — | 最多 1 块；点击 3D 后显示该对象参数 |
| `device-list` | 设备列表 | 20.4×30 | ✓ | ✓ | ✓ | ✓ | 逐台列名字+值；`render:"bar"` 画进度条 |
| `bar-compare` | 设备对比条 | 42×22 | ✓ | ✓ | ✓ | ✓ | 逐台横向比高低 |
| `control-bar` | 控制条 | 20.4×12 | — | — | — | — | 用 `controls`，不读值 |
| `title` | 标题 | 56×7 | — | — | — | — | 最多 1 块 |
| `caption` | 右上说明 | 20×6 | — | — | — | — | 最多 1 块 |

**「逐台列」**（`scopePerDevice`）：只需 `telemetryKey`，**不需要 `deviceId`**
—— 设备由 scope 决定。给它们填 `deviceId` 不会报错，但也不会被用到。

**`maxCount`**：`selection-card` / `title` / `caption` 各最多 1 块。

> ⚠️ **在线编程不校验 `maxCount`**（2026-11-23 核对）。只有编辑器的
> 「添加卡片」按钮读 `canAddWidgetType()` 来禁用，`add-widget` 提案没有这一道。
> 用提案加第二块 `title` 会成功，然后渲染层照常全部渲染 —— 得到两块重叠的卡，
> **不报错**。加这三类卡片前先确认布局里还没有。

---

## 4. 在线编程操作

### 4.0 提案格式

一个 **JSON 数组**，每条一个操作，顺序执行。整体原子：**任一操作非法则全部不应用**
（不做部分应用）。

```json
[
  { "op": "update-widget", "id": "system-power", "patch": { "title": "系统总功率" } },
  { "op": "bind-telemetry", "id": "system-power", "slotKey": "main", "telemetryKey": "power_total" }
]
```

### 4.1 add-widget

```json
{ "op": "add-widget", "widget": { "id": "...", "type": "...", "x": 0, "y": 0, "w": 20, "h": 18 } }
```

- `id` 不能与现有卡片重复（否则 `widget-duplicate`）
- `type` 必须是 §3 里已知的类型
- 新建的卡片**没有 slots / scope**，需要后续 `update-widget` 或 `bind-telemetry` 补齐

### 4.2 update-widget

```json
{ "op": "update-widget", "id": "power-trend", "patch": { "title": "机组总功率趋势", "subtitle": "POWER TREND" } }
```

- **不允许** `patch` 里出现 `id` / `type`（否则 `protected-field`）
- `patch` 是**浅合并**：`slots` 会整体替换。要改一个槽位用 `bind-telemetry`，
  或先读出原值再整体写回
- 改 `slots` / `controls` / `style` 都走这里

### 4.3 remove-widget

```json
{ "op": "remove-widget", "id": "caption-1" }
```

### 4.4 bind-telemetry

```json
{ "op": "bind-telemetry", "id": "system-power", "slotKey": "main", "telemetryKey": "power_total", "deviceId": "..." }
```

- `slotKey` 必须已存在（否则 `slot-not-found`，错误信息会列出所有现有 key）
- **会清掉 `assetId` / `attributeKey`** —— 遥测与资产属性不能共存，
  否则 `readSlotValue` 走资产分支，用户会以为「换了测点却没生效」
- `deviceId` 可省：省了则保留原设备绑定

---

## 4.5 场景数据源（别名）

> 2026-11-23 新增。此前「这台设备有哪些遥测/属性/告警」**一处都查不到**，
> 写 `bind-telemetry` 只能靠猜键名 —— 而猜错不报错，卡片只是永远「暂无数据」。

### 4.5.1 是什么

场景级的一组「别名」，让脚本和卡片用名字引用实体，而不是硬编码 UUID：

```ts
interface SceneDataSource {
  id: string;              // 短名，脚本里 ctx.src("gw")
  name: string;            // 显示名「网关」
  kind: "device" | "asset" | "scope";
  deviceId?: string;       // kind=device
  assetId?: string;        // kind=asset
  scope?: { kind: "site" | "topology"; siteId?: string; topologyId?: string; ... };
  note?: string;
}
```

存在 `scene.dataSources`（`SceneDocument` 上，zod schema 已包含）。

### 4.5.2 显式 + 隐含

只做显式的话，实际没人会配，清单永远是空的。所以两路合并：

| 来源 | 谁产生 | 标记 |
| --- | --- | --- |
| 显式 | 用户在「数据源」面板新增 | 蓝色「声明」 |
| 隐含 | 从 `scene.bindings` 自动推导（每个绑了设备的 3D 对象） | 灰色「自动」 |

同名时显式优先；隐含源短名与显式撞了会加后缀（`网关2`），不覆盖用户的名字。

### 4.5.3 勘察：遥测 / 属性 / 告警分三栏

**遥测与属性必须分开**（实测踩过）：

| 接口 | 返回 | 用途 |
| --- | --- | --- |
| `listTimeseriesKeys` | 纯时序键 | 「遥测」这一栏 |
| `listAttributeKeys` | 纯属性键 | 「属性」这一栏 |
| `listTelemetryKeys` | 时序 **+ 属性并集** | 绑定面板用，**不要**用它填遥测栏 |

用并集会把 `brand` / `deviceCode` / `model` 列进遥测，用户照着建卡片就是
「把属性当遥测读」，永远没有实时值。

告警走租户级 `/api/alarms`，**拉一次再按 deviceId 分组**，不要每台拉一遍。

### 4.5.4 限量（A5 禁止 N+1）

每源最多勘察 12 台、全局并发 6、按实体 id 缓存。面板明示「1/1 台已勘察」，
超过上限时显示 `checked/total` 让人知道没看全。

### 4.5.4b 范围源展开 + 存平台

**范围源会展开成具体设备。** `kind: "scope"` 的源通过
`listRealtimeDevices({ siteId | topologyId })` 解析出设备清单，
面板显示「范围设备 14 台：天骄-PLC网关、模块机 1#…」，脚本里
`ctx.src("units").entityIds` 也是这 14 个 id。

> ⚠️ **键必须用 `widgetScopeKey` 生成**（`topology:<id>` / `site:<id>`）。
> 自己拼裸 id 会永远查不到 —— 而且不报错，面板只说「范围内暂无设备」，
> 人会去怀疑范围选错了。两边同源才不会漂。

**存平台，不只存本地。** `SceneDocument` 整体在浏览器 IndexedDB，
但数据源是团队共享的施工信息。所以保存时会同步一份到 `scene-widgets`
（平台侧），加载时以平台那份为准。后端实测**原样保留未知字段**，不用改后端。

> ⚠️ **新增场景级字段有两道关，漏一道就静默失效**（2026-11-23 踩到）：
>
> | 关 | 位置 | 漏了会怎样 |
> | --- | --- | --- |
> | ① zod schema | `packages/scene-schema/src/index.ts` | 保存到本地时被剥离 |
> | ② 白名单解析 | `parseSceneWidgetLayout`（`scene-widget-layout.ts`） | **从平台读回时被剥离** |
>
> 第②关尤其阴：后端明明存住了（PUT 后读回还在），前端解析时丢掉，
> 面板永远显示不出来、也不报错，看起来像「用户没配过」。
> `scene-widget-layout.test.ts` 里有 5 个用例锁住这条。

### 4.5.5 脚本里怎么用

```js
ctx.sources              // 全部源（含隐含）
ctx.src("gw")            // 按短名取源，找不到返回 undefined
ctx.keysOf("gw")         // 该源可用的遥测键
ctx.attributesOf("gw")   // 属性键
ctx.alarmsOf("gw")       // 活跃告警
ctx.devices              // 平台设备表
```

顺带修了一个死字段：`ctx.telemetryKeys` 之前**声明了但从没被填**，
脚本拿到的永远是空对象。现在从勘察结果按设备 id 聚合。

## 5. 校验规则（会被拒绝的情况）

| code | 触发 | 怎么办 |
| --- | --- | --- |
| `empty-operation` | 提案是空数组 | 至少写一条 |
| `operation-not-allowed` | 操作不在模板 `aiExtension.operations` 白名单 | 看模板允许什么，或改用允许的操作 |
| `widget-duplicate` | `add-widget` 的 id 已存在 | 换 id，或用 `update-widget` |
| `widget-not-found` | 目标 id 不存在 | 先读出布局确认 id |
| `protected-field` | `update-widget` 改了 `id`/`type` | 删除 + 新增 |
| `slot-not-found` | `bind-telemetry` 的 slotKey 不存在 | 错误信息里有现有 key 列表 |

**白名单来源**：`resolveScreenTemplate(layout)?.aiExtension ?? DEFAULT_AI_EXTENSION`。
不同模板可以允许不同操作 —— 成品大屏可能只许改绑定，空白底稿才允许加卡。

> **天骄热泵模板自 2026-11-23 起自己声明 `aiExtension`**（v18），只列 4 种
> 真正实现的操作。这比回落到 DEFAULT 更准确：DEFAULT 含两个未实现的操作，
> 会让模型以为能做。**模板声明边界 = 模板自带 spec**，读模板就知道能改什么。
>
> 声明位置：`packages/data-adapter/src/screen-templates/tianjiao-heat-pump.json`
> 的 `aiExtension`。改白名单时同步 `IMPLEMENTED_OPERATIONS` 与本文。

`requiresDiffReview = true` 时，**必须先预览差异再点应用**。预览会逐条列出
「本来会改成什么」，越界项在那里被拦下。

> 应用时会用**当前**布局重新校验一遍。预览到应用之间布局可能变了
> （撤销/重做、另一个面板），复用预览结果会把过期内容写回去。

---

## 6. 交互能力

### 6.1 卡片 → 下发命令（`controls`）

只有 `control-bar` 用。流程：

```
读 stateKey 的遥测 → 判当前状态 → 决定发 onParams 还是 offParams
   → 下发 commandId → 等 10 秒回读 stateKey → 校验是否真的变了
```

`sys_run_state` 的枚举（`sysRunStateKind`）：`1` 停机 / `2` 启动中 / `3` 关机中 /
`4` 待机 / `5` 运行 / `6` 水系统 / `7` 防冻 / `8` 故障。
**不按 truthy 判断** —— `0` 和 `"0"` 都不是「运行」。

停机这类动作必须写 `confirmText`，不能一点就发。

### 6.2 3D 对象 → 卡片联动（`selection-card`）

点 3D 中的设备 → `selectedNode` / `selectedEntityId` 变化 →
`selection-card` 按 `selectionBindings()` 找到该对象绑的设备并显示其参数。

这张卡**常驻**（有可点选设备就显示），空态显示准星框 + 「点击三维场景中的机组」。
不要改成「选中后才显示」—— 用户从没见过它就不会去点，形成死循环。

### 6.3 3D 对象 → 跳转另一个场景（scene-jumps）

```ts
interface SceneJumpLink {
  objectId: string;          // 3D 对象
  objectLabel?: string;
  targets: { topologyId: string; label: string }[];
}
```

存储：`PUT /api/energy/topologies/{id}/scene-jumps`。
一个对象可指向多个场景，点击时让用户选（`choose`）；只有一个则直接进入（`enter`）。

**这不在在线编程面板的操作范围里**，走编辑器「场景跳转」面板。

---

## 7. `add-scene-event` / `add-panel`：声明了但未实现

`DEFAULT_AI_EXTENSION.operations` 声明了 6 种操作（与 `template01/template.manifest.json`
同构），但只有 4 种有实现：

```ts
operations: [
  "add-widget", "update-widget", "remove-widget", "bind-telemetry",
  "add-scene-event",   // ← 声明了，没实现
  "add-panel",         // ← 同上
]
```

**现状**：这两个操作会明确报「尚未实现」，不会静默失败。

```
操作「add-panel」已在模板白名单里声明，但当前版本尚未实现。
可用的操作：add-widget / update-widget / remove-widget / bind-telemetry。
```

> 为什么单独写这一节：2026-11-23 之前，这两个操作通过白名单后会落到
> 「其余操作都要求目标存在」，拿一个不存在的 `operation.id` 去查卡片 →
> 报「找不到卡片「undefined」」。**用户会去翻卡片 id，而真正的原因是操作没实现。**
> 指错方向的报错比不报错更浪费时间——这是把它修掉的唯一理由。
>
> 判据来自 `IMPLEMENTED_OPERATIONS`（`layout-proposal.ts`）。加新操作时
> **先在那里加**，再补分支。

需要场景事件请用 §6.3 的「场景跳转」面板，不在在线编程范围内。

## 8. 保存与生效

| 动作 | 通道 | 生效 |
| --- | --- | --- |
| 在线编程「应用」 | 只改内存中的布局 | 未保存，刷新即丢 |
| 编辑器「保存」 | `PUT /api/energy/topologies/{id}/scene-widgets` | 立即（下一次加载读新值） |
| 运行时打开场景 | `GET` 同一路径 | — |

**队列**：编辑器有持久化队列，`PUT` 失败会留本地草稿（`scene-storage.ts`）。
看到「已保存」但内容没变，先查 `persistence.widgetsSource` 是本地还是平台。

---

## 9. 验收：改完怎么确认真的生效

**不要只看编辑器截图。** 编辑器渲染和运行态曾经是两套订阅范围，
设计时看到的可能不是打开后的样子。

```bash
# 1) 两态逐项比对（退出码 0 才算一致）
node scripts/verify-wysiwyg.mjs

# 2) 直接读库确认坐标/槽位
curl -s -H "X-Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8090/api/energy/topologies/<topologyId>/scene-widgets" \
  | python3 -m json.tool

# 3) 提案校验的单测（21 个用例，覆盖每种拒绝）
cd apps/web && ../../node_modules/.bin/vitest run layout-proposal
```

改动涉及字段含义时，同步更新本文与 `.agents/skills/screen-widget-programming/`。

---

## 10. 常见错误对照表

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| 卡片整块消失 | 不可见判据要求「有值」，而该类型本来就无值 | 判据改成「配置完整就显示」，缺数由卡片自己说 |
| 卡片显示「还没有绑定设备」，但明明配了范围 | 该类型 `scopePerDevice`，根本没有 `deviceId` | 走 `describePendingSlot` 的对应分支 |
| 显示「1」「0」而不是「运行」「停止」 | 缺 `displayType: "boolean"` | 在槽位上补 |
| 换了测点没生效 | 槽位同时有 `assetId` 和 `telemetryKey` | 二选一；`bind-telemetry` 会自动清资产字段 |
| 改样式没变化 | `style` 里写了十六进制色值 | 改成 `--ngx-*` token 名 |
| 改了模板 JSON，界面没变 | 只改了文件没推库 | `PUT scene-widgets`，或跑模板应用脚本 |
| 改了库，下次重建场景被覆盖 | 只改了库没改模板 JSON | 两边同步（§1） |

---

## 11. 已知限制（数据源）

| 限制 | 说明 | 影响 |
| --- | --- | --- |
| scope 源勘察上限 12 台 | 范围可能 >12 台（实测拓扑 14 台），面板显示 `12/14` | 超过部分不勘察测点；但设备清单本身是完整的 |
| 勘察上限 12 台/源 | 超大范围只勘察前 12 台，面板显示 `checked/total` | 超过时可能漏掉个别设备的独有测点 |
| 告警无规则编辑 | 只读展示平台活跃告警，不能在此配告警规则 | 配规则要去平台侧 |
| 资产源需手填 id | 面板没有资产选择器（设备有） | 装机参数这类资产属性源要手填 |

前两条是刻意的取舍（A5 禁止 N+1），第三四条是当前范围外。

---

## 12. 科技大屏视觉语言（2026-11-23 对照参考效果图定案）

这一节规定「HUD 皮肤下长什么样」。所有规则都写在
`apps/web/src/features/scene-widgets/WidgetOverlay.module.css` 的
`:global([data-ngx-hud])` 作用域内 —— **只影响运行态大屏，编辑器与亮色主题零改动**。

> 为什么放在样式层而不是模板 JSON 里：同一套视觉要服务所有模板、所有客户。
> 写进某个模板 = 定制；写进 HUD 皮肤 = 模板库能力。

### 12.1 五条必备元素（缺一条就不像专业大屏）

| # | 元素 | 实现位置 | 作用 |
| --- | --- | --- | --- |
| 1 | **四角折线光角** | `.card::after` 8 条 linear-gradient | 一眼认出「仪表盘」而非「网页卡片」 |
| 2 | **标题双斜线** | `.cardTitleMark` 的 `::before/::after` | 参考图 `《 区块名` 的等价物 |
| 3 | **主数值渐变高光** | `.metricValue > span` + `@supports` | LED 大屏感；`color:transparent` 必须有 `@supports` 兜底 |
| 4 | **数据行细分隔线** | `.row` 底边 0.12 透明度 | 让 9 台设备「数得清、不串行」 |
| 5 | **大标题横向光带** | `.titleCard::after` 两端渐隐 | 顶部不再是「一行裸字」 |

### 12.2 实测踩到的四个坑

**① 伪元素只有两个，`::before` 已被占用**

`.card::before` 是顶部彩条。四角光角只能用 `::after`。而标题卡要光带也用 `::after`，
所以 **`titleCard::after` 必须显式覆盖 `display` / `inset` / `opacity`** ——
`.card::after` 上的 `inset:0`、`opacity:0.7`、`display:none`（标题卡关光角）都会继承过来。
漏一个的后果分别是：光带被拉满整卡、光带偏暗、光带完全不显示。**三种都不报错。**

**② 装饰重复：既有竖条 + 新增双斜线**

`.cardTitle::before` 原本就有一条 3px 竖条。加双斜线后变成「两根柱子」。
HUD 下隐藏竖条（`display:none`），保留双斜线。

**③ 标题被延迟标记挤断**

标题条里有三个 flex:none 元素（标题 / 延迟标记 / 英文副标题）争 200px。
实测标题被 ellipsis 切成「场站用电」，用户看不到完整名称。
修法：`.cardTitleText { flex: 1 1 auto }` + 有延迟时用 `:has(.dataStale)` 让副标题让位
—— **延迟是运维关键信息，英文副标题只是装饰，该让位的是装饰**。

**④ 1px 光带在 1920 宽大屏上等于不存在**

实测整屏截图里 1px 光带完全消失（显示器缩放 + 截图压缩）。提到 2px + 两层外发光才看得见。

### 12.3 验收方法（不能只看整屏截图）

整屏截图分辨率压缩后，1px 线、9px 字号、角标细节**全部看不见**。
判断视觉是否生效必须用 `Page.captureScreenshot` 的 `clip` + `scale: 3` 放大单卡：

```js
const r = card.getBoundingClientRect();
await send("Page.captureScreenshot", {
  format: "png",
  clip: { x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12, scale: 3 },
}, sessionId);
```

同时要 probe 伪元素的计算样式，否则「看起来没变」分不清是「没生效」还是「生效了但太小」：

```js
getComputedStyle(card, "::after").backgroundImage   // 应为 8 条 linear-gradient
getComputedStyle(mark).fontSize                      // 应为 0px（原字符已隐藏）
getComputedStyle(mark, "::before").content           // 应为 ""（双斜线已生成）
```

脚本：`/tmp/shot-detail.mjs`（可复用）。

### 12.4 明确不做的事

- **不在样式里写业务数字**：阈值、单位、设备数全部来自数据字典与绑定。
- **不把视觉写进模板 JSON**：模板只声明 `region` + `interfaces` 绑定契约。
- **不用 `color: transparent` 而不加 `@supports`**：不支持 `background-clip: text` 时
  文字会**完全消失**，而大屏上消失的正是最重要的数字。

---

## 13. 环形仪表 `gauge-ring`（2026-11-23）

### 13.1 它和 `ratio-ring` 的区别

两者形状相似，语义和兜底规则**相反**：

| | `ratio-ring` 已用/总数 | `gauge-ring` 当前值/量程 |
| --- | --- | --- |
| 分母语义 | 真实总量（车位总数、房间数） | 设计量程（100%、750kW） |
| 分母来源 | 必须绑测点 | 可绑测点，也可是 `constant` |
| 缺分母时 | 报「未绑定」 | 默认 100（`maxOrigin: "default"`） |
| 配了量程但没值 | — | **不兜底**，判未解析 |
| 视觉 | 细环 + 圆内占比 | 粗环 + 渐变 + 环尾光点 + 刻度 |

> 不要用 `ratio-ring` 冒充仪表：它的「缺分母就报未绑定」会让百分比类指标
> 永远要求一个「上报总量」的假设备。

### 13.2 槽位约定

```jsonc
"slots": [
  { "key": "value-0", "label": "运行功率", "unit": "kW",
    "deviceId": "<id>", "telemetryKey": "power" },
  { "key": "max-0", "label": "满量程", "unit": "kW", "constant": 100 }
]
```

- 命名：`value-N` / `max-N`（也接受 `used-N` / `total-N`，两者语义等价）
- 不写序号时按「偶数位 = 值、奇数位 = 量程」配对
- **量程槽强烈建议写 `constant`**：百分比类不用绑定任何设备就能出环

### 13.3 `slot.constant`：设计值，不属于任何设备

量程、阈值、参考线这类「设计值」用 `constant` 写死：

```ts
interface SceneWidgetSlot {
  constant?: number;   // 优先级最高：填了就不看 device / telemetryKey
}
```

**三个必须知道的行为**：

1. **优先于绑定** —— 同一槽位既填 `constant` 又绑设备时，常量赢。
   这是刻意的：量程是设计值，绑上的测点只可能是误配。
2. **不算「未绑定」** —— `pendingBindings` 里常量槽直接视为已配好。
   不这样做的话仪表会永远挂着「还差 1 项」，用户怎么配都消不掉。
3. **允许 0 和负数** —— 量程可以是 0，温度下限可以是 -25℃。
   但**空字符串不算 0**（`Number("") === 0` 的经典坑，会把「没填」读成「量程 0」）。

### 13.4 模板里声明常量量程

```jsonc
// screen-templates/xxx.json → regions[].interfaces[]
{
  "key": "max-0", "name": "满量程", "valueType": "number",
  "allowedSources": [], "constant": 100
}
```

`constant` 存在时该 interface 不要求绑定，生成的槽位自带常量。

### 13.5 ★ 适用边界：只适合「零基比例型」指标

**实测发现的真实缺陷**（2026-11-23）：温度类指标用仪表会失去意义。

```
出水温度 7.35℃，量程写 50℃ → 环只画到 14.7%，几乎看不见
而它的真实正常范围是 5~20℃，相对该范围其实处于中位
```

原因：当前仪表**只支持 0 ~ max**，没有 `min` 偏移。所以：

| 指标类型 | 适合仪表？ | 该用什么 |
| --- | --- | --- |
| 加载率 / 开度 / 在线率（0~100%） | ✅ 最合适 | 仪表 |
| 台数占比（运行 5 / 共 9 台） | ✅ | 仪表 或 ratio-ring |
| 容量占比（已租 / 总面积） | ✅ | 仪表 |
| 功率（0 ~ 额定功率） | ⚠️ 勉强 | 仪表（量程写额定值） |
| **温度、压力、频率**（非零起点区间） | ❌ | **趋势图**（看走势才有意义） |

要把温度类也做成仪表，需要给 `gauge` 加 `min` 支持（几何上要处理负角度起点）。
**当前不做** —— 温度看趋势比看瞬时占比更有诊断价值，加 `min` 是复杂度换不来收益。

### 13.6 验证方法

```js
// 环是否真的画出来了（CSS Modules 类名带 hash，用 *= 匹配）
document.querySelectorAll('[data-testid="gauge-ring"]').length      // = 组数
card.querySelectorAll('[class*=gaugeProgress]').length              // = 有值的环数
card.querySelectorAll('[class*=gaugeDot]').length                   // = 同上（ratio>0 才有）
[...card.querySelectorAll('[data-testid="gauge-ring"]')].map(e => e.innerText)
// → ["19.3 kW / 100 运行功率", "43 % / 100 阀门开度", ...]
```

⚠️ 探针要在卡片真正渲染后跑（等 `[data-testid^="scene-widget-"]` 数量稳定 + 再等 8 秒）。
实测踩过：DOM 查询写对了但查得太早，返回 0 个环，误判成「没渲染」——
而同一时刻的截图里三个环好端端地在。
