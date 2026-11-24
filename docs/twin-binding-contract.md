# 数字孪生绑定契约 P0（决策冻结稿）

- 日期：2026-11-22
- 状态：契约冻结，**尚未开发**
- 范围：3D-NGX 前端 + `@idt/data-adapter` + `@idt/shared-types`；平台侧按第 3 节结论**P0 不改 Java**
- 依据：`template01/template.manifest.json`、`template01/schema/binding.schema.json`、`docs/architecture.md`、`packages/scene-schema`、`packages/data-adapter`、平台 `EnergyTopologyService` / `EnergySceneMeta` / `AssetController` / `TelemetryController`

本文只写契约，不含实现。开发按第 9 节拆任务，每个任务都要能对上第 8 节的单测。

---

## 1. 四条决策与它们的硬影响

| # | 决策 | 由此确定的做法 | 明确不做 |
| --- | --- | --- | --- |
| 1 | 直读资产属性 | 资产侧只支持 `source: "attribute"`，走 `GET /api/plugins/telemetry/ASSET/{id}/values/attributes` | 不做子树设备遥测聚合（SUM/MEAN/MAX），不做「代表设备」，不做隐式回退 |
| 2 | 一资产只挂一个场景 | 场景根固定为该资产，唯一性判据 `(customerId, 场景根资产)` | 不允许同一资产开第二个场景实例；不提供「多视角各开一场景」 |
| 3 | template01 = 客户运行大屏 | 只做 runtime 挂载与只读渲染 | 不做租户编辑器、不做 AI 在线编程、不接管编辑入口 |
| 4 | 不加场景分组字段 | 场景族 = 同客户 + 同场站，靠大屏 tab 手配 | 不加 `sceneGroupId`；不改 `POST/POST /api/energy/topologies` 的字段表 |

第 2 条有个必须写清楚的副作用：**同一资产想看多个视角，不再是多开场景，而是同一场景内切 tab**。template01 底部那排 tab（综合态势 / 智慧安防 / 人车通行 / 能源分析 / 设备设施 / 资产管理）正好承担这件事。这条要写进产品说明，否则实施时一定会有人来问「为什么配电房只能开一个场景」。

---

## 2. 术语与唯一约束

### 2.1 层级

```
租户
 └ 客户（第一维，必选）
    └ 场站（TB ASSET，type 属站点类）
       └ 场景实例（TB ASSET，type=topology，sceneInstance=true）
          ├ 场景根资产 = roots[0]（TB ASSET，恰好一个）
          ├ additionalInfo.sceneBindings  场景对象 / 大屏 slot → 资产属性或设备遥测
          ├ additionalInfo.sceneWidgets   大屏布局
          └ SceneJump                     场景之间的有向边（后端已防环）
```

### 2.2 场景根：只有一个真相

**存储真相是 `additionalInfo.roots`，且 `sceneInstance=true` 时长度必须为 1。**

原因（已核实）：`EnergyTopologyService.create/update` 写 `additionalInfo` 用的是白名单 —— `siteId` / `viewType` / `description` / `roots` / 实例元信息 / scene meta。请求体里多带的字段**不会落库**。所以不能新造 `rootAssetId` 字段；要新字段就必须改 Java，而 P0 不改。

`roots` 复用是天然契合的，不是硬凑：

- `parseRoots` 已经做了客户边界校验（别家资产 id 会被剔除），安全免费；
- 后端 `load()` 用 `roots` 作为 BFS 起点，场景根 = 整棵资产子树，正好是「这个场景看的范围」；
- 列表卡片回包已带 `roots` / `rootNames`（`putRoots`），唯一性检查不需要逐个 `load`。

前端可以派生一个只读字段方便阅读，但**不得回写**：

```ts
// 派生，不落库，不参与序列化
interface SceneRootRef {
  entityType: "ASSET";
  entityId: string;   // = platform.roots[0]
  name?: string;      // = platform.rootNames[0]
}
```

### 2.3 唯一性判据与冲突处理

判据：`(customerId, roots[0])` 在全部 `sceneInstance=true` 的场景里唯一。

检查数据来源（一次请求，不 N+1）：

```
GET /api/energy/topologies?customerId={id}&sceneInstance=true&pageSize=100
→ items[].roots / items[].rootNames / items[].name / items[].publishState
```

三种结果：

| 情况 | 行为 |
| --- | --- |
| 无命中的其它场景 | 允许创建，`roots=[assetId]` |
| 命中一个其它场景 | **不创建**。弹「该资产已有场景：{name}」，主按钮「打开这个场景」，不提供「强制再建」 |
| 命中当前场景自己（编辑态） | 允许，属于原地更新 |

存量兼容（必须有，库里已有数据不满足新约束）：

| `roots` 长度 | 认定 | 唯一性检查 | UI |
| --- | --- | --- | --- |
| 1 | 已声明场景根 | 参与 | 正常 |
| 0 | 未声明 | 不参与 | 场景列表标「未绑定资产」，编辑器提示「补选场景根」 |
| ≥2 | 历史多根 | 不参与 | 同上，并提供「收敛为一个」入口 |

P0 是**前端软约束**：并发创建理论上仍可能撞车。P2 再让后端在 create 时硬校验（返回 409 语义）。这一点要在实施说明里写明，不要当成已保证。

---

## 3. 绑定模型 v2

### 3.1 类型定义（`packages/shared-types/src/device.ts`）

只加可选字段，`schemaVersion` 不变，旧文档照常可读。

```ts
export type AttributeScope = "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";

export interface BindingTarget {
  entityType: "DEVICE" | "ASSET";
  entityId: string;
  name: string;
}

/**
 * source 的语义必须互斥，不允许运行时自动 fallback：
 * - telemetry：DEVICE 的时序键，有 ts，有新鲜度
 * - attribute：ASSET 的属性值，有 lastUpdatedTs，没有「实时」概念
 * - derived：由同一场景内其它 slot 计算，P1 才实现，P0 见即报错
 */
export interface BindingPoint {
  slot: string;                 // "<regionId>.<interfaceKey>"，如 "equipment-status.onlineRate"
  source: "telemetry" | "attribute" | "derived";
  key: string;                  // 遥测键或属性键，禁止翻译
  scope?: AttributeScope;       // 仅 attribute
  unit?: string;
  displayType: "number" | "boolean" | "text";
  staleAfterSec?: number;       // telemetry：按 ts；attribute：按 lastUpdatedTs
  fallback?: string;            // 缺失时的展示文案，默认 "—"
}

export interface DeviceBinding {
  id: string;
  sceneEntityId: string;
  deviceName?: string;

  // v1 字段，保留，读时归一化，写时继续输出
  deviceId?: string;
  telemetryMappings: TelemetryMapping[];
  actionMappings: ActionMapping[];
  statusMapping?: StatusMapping;

  // v2
  target?: BindingTarget;       // DEVICE 或 ASSET
  points?: BindingPoint[];
}
```

`deviceId` 从必填改可选，是为了让资产条目能通过后端现有校验：

```java
// EnergyTopologyService.validateBindings：只校验带 deviceId 的条目，没有的直接跳过
if (b == null || !b.isObject() || !b.hasNonNull("deviceId")) { continue; }
```

这是当前实现的缺口，**P0 期间必须同时补后端一条**：带 `target.entityType=ASSET` 时，校验资产属于该拓扑客户（`sameCustomer`）。改动只在 `validateBindings` 内，不碰内核。补之前，前端不得依赖「后端已经卡住资产越权」。

### 3.2 归一化函数（新增 `packages/data-adapter/src/binding-normalize.ts`）

```ts
export function normalizeBinding(raw: unknown): DeviceBinding | null;
export function bindingPoints(binding: DeviceBinding): BindingPoint[];   // v2 points ?? 由 telemetryMappings 推导
export function bindingTargetOf(binding: DeviceBinding): BindingTarget | null;
```

规则：

1. 有 `points` → 用它；没有 → 由 `telemetryMappings` 逐项推导 `{slot: field, source: "telemetry", key: telemetryKey}`。
2. `deviceId` 存在且无 `target` → `target = {entityType:"DEVICE", entityId: deviceId, name: deviceName ?? ""}`。
3. 两者都没有 → 丢弃该条（现在 `bindingOf` 已这么做）。
4. 写回平台时**保留 v1 字段**，不做迁移式重写。理由：迁移一旦半途而废，会出现「一半设备绑定、一半资产绑定」的脏文档，且无法回滚。

### 3.3 绑定解析优先级

`findBindingForSlot` 现在是 `slot.deviceId` → `slot.sceneEntityId`。新增后顺序为：

```
slot.assetId           → 找 target.entityType=ASSET 且 entityId 匹配
slot.deviceId          → 找 target.entityType=DEVICE 或 v1 deviceId 匹配
slot.sceneEntityId     → 找 sceneEntityId 匹配且已有 target
（都没有）              → 未绑定
```

`slot` 上的键优先于绑定里的映射（现有 `slotKeys()` 已经这么做了，保持一致）。

---

## 4. 资产属性读取契约

### 4.1 平台接口（已存在，P0 无需新增）

| 用途 | 接口 | 权限 |
| --- | --- | --- |
| 客户资产列表 | `GET /api/customer/{customerId}/assets?pageSize=&page=` | 租户 / 客户（客户仅自己） |
| 资产属性（全 scope） | `GET /api/plugins/telemetry/ASSET/{id}/values/attributes?keys=a,b` | `READ_ATTRIBUTES`，`CUSTOMER_USER` 已放行 |
| 资产属性（限定 scope） | `GET /api/plugins/telemetry/ASSET/{id}/values/attributes/{scope}?keys=` | 同上 |
| 资产下设备 | `GET /api/plugins/telemetry/ASSET/{id}/...` 不适用，设备走关系 BFS | — |

返回是数组：`[{ key, value, lastUpdatedTs }]`（`value` 可能是 `{value, ts}` 包装，解析时必须两种都认）。

### 4.2 新增适配器 `packages/data-adapter/src/asset-client.ts`

```ts
export interface PlatformAsset {
  id: string;
  name: string;
  label?: string;
  type: string;
  customerId?: string;
}

export interface AssetAttribute {
  key: string;
  value: number | string | boolean;
  lastUpdatedTs: number;
}

export class AssetApi {
  constructor(private readonly client: GuardClient) {}
  listCustomerAssets(customerId: string): Promise<PlatformAsset[]>;   // 分页拉全，50 页上限
  getAsset(id: string): Promise<PlatformAsset | null>;
  getAttributes(assetId: string, keys: string[], scope?: AttributeScope): Promise<AssetAttribute[]>;
}
```

三条硬规则：

1. **不分页截断静默**：`listCustomerAssets` 触到上限要 `console.warn` 并在返回值带 `truncated`，与 `listSiteDeviceIds` 的处理保持一致。
2. **不做资产遥测**：`AggregationType` 一律不引入。任何 `source:"telemetry"` 的条目，`target.entityType` 必须是 `DEVICE`。
3. **读取范围限定**：只读 `SERVER_SCOPE` / `SHARED_SCOPE`（配置类属性）。`CLIENT_SCOPE` 默认不读 —— 它是设备侧上报的状态，容易被误当成遥测。

### 4.3 三种状态必须区分（禁止合并成「—」）

| 状态 | 展示 | 判据 |
| --- | --- | --- |
| 已配置且有值 | `值 + 单位` | 返回里有该 key |
| 已配置、值陈旧 | `值 + 单位`，右下角灰字「更新于 X 前」 | `now - lastUpdatedTs > staleAfterSec` |
| 已配置但缺失 | `—`，「未上报」 | 返回里没有该 key |
| 无权限 | 「无权限」 | HTTP 401/403 |
| 接口不可用 | 「暂时读不到」+ 重试 | 超时 / 5xx |

这是 AGENTS 里反复强调的那条：缺失、延迟、无权限要分开说，不能用演示值或空横线糊过去。

---

## 5. 大屏 slot 扩展

`packages/data-adapter/src/scene-widget-layout.ts`：

```ts
export interface SceneWidgetSlot {
  key: string;
  label?: string;
  unit?: string;
  telemetryKey?: string;
  sceneEntityId?: string;
  deviceId?: string;          // 仅实例绑定填写；模板布局必须清空

  // v2 新增，同样是实例绑定字段，模板布局必须清空
  assetId?: string;
  attributeKey?: string;
  attributeScope?: AttributeScope;
  staleAfterSec?: number;
}
```

约束：模板布局（`screen-templates/*.json`）里 `deviceId` / `assetId` / `attributeKey` 必须为空。现有 `parseSceneWidget` 已有「模板布局去掉 deviceId」的约定，新字段按同一处处理，不要另写一份过滤。

`readSlotValue`（`features/scene-widgets/widget-values.ts`）增加资产分支，返回结构扩一个字段，别改已有字段语义：

```ts
export type SlotReading = {
  label: string;
  text: string;
  unit?: string;
  bound: boolean;
  missing: boolean;
  source?: TelemetryRecord["source"];
  numeric?: number;
  // v2
  origin?: "device-telemetry" | "asset-attribute";
  staleAt?: number;              // 过期判据用的时间戳
  unavailableReason?: "unbound" | "missing" | "stale" | "forbidden" | "unreachable";
};
```

### 5.2 控制条：发命令，不读值（2026-11-23）

大屏上的「系统启停」不是另一种 slot。槽位的语义是**读一个值**，控制是**发一条命令**，
两者失败代价差一个量级：读失败只是显示「—」，发错命令会让现场设备没按预期动作。
所以 `SceneWidget` 单独有一个 `controls` 字段，`control-bar` 是独立部件类型。

```ts
export interface SceneWidgetControl {
  key: string;                 // React key；缺省用 commandId
  label?: string;
  deviceId: string;            // 必填，缺了整条丢弃
  commandId: string;           // 必填，来自设备 SERVER_SCOPE 的 rpcMethods
  kind?: "toggle" | "button";  // toggle = 一个按钮管开和关
  onParams?: Record<string, unknown>;   // toggle 切到「开」时发的参数
  offParams?: Record<string, unknown>;  // toggle 切到「关」时发的参数
  params?: Record<string, unknown>;     // button 用固定参数
  stateKey?: string;           // toggle 的当前状态从哪个遥测键读
  confirmText?: string;        // 覆盖默认二次确认文案
}
```

**四条硬约束**（都有实测依据）：

| 约束 | 为什么 |
| --- | --- |
| 模板里必须没有 `controls` | `deviceId` 是实例 id。带进模板 → 新客户建场景按钮指向不存在的设备，点了静默失败。`toTemplateWidgetLayout` 已剔除 |
| 双向命令必须由 `params.on` 定方向 | 系统启停是 `setSystemPower` 一条命令写 40051（0/1），不是 start/stop 两条。标签「系统启停」同时含启和停，靠标签猜必错 |
| 状态判定走 `sysRunStateKind` 枚举 | `sys_run_state` 是 0~9，**停机是 1（非零）**。用 `Boolean()` 会把停机读成运行中，按钮一直显示「停」 |
| `stateKey` 要进订阅表 | `collectWidgetSlotKeys` 同时喂实时订阅和演示数据。漏掉它 → 实时模式按钮永远「状态未知」，且不报错 |

**待绑定清单不统计控制条**：它没有槽位，`widgetTypeMeta("control-bar")` 的
`usesSlots`/`usesScope` 都是 falsy，所以不进清单。若给它标上，清单会要求它「绑测点」，
而这个要求无法满足 —— 完成度永远到不了 100%，用户就不再看了。

**已知空缺**：`resetAlarm` 在 `rpcMethods` 里声明要求 `target` 参数，但合法取值手册没写，
所以没有配进大屏。不要凭猜填一个值 —— 网关会拒，而界面看起来是「点了没反应」。

### 5.2b 槽位 displayType：0/1 要显示成「运行/停止」（2026-11-23）

`SceneWidgetSlot` 新增 `displayType?: "number" | "boolean" | "text"`。

**为什么必须有**：`running` / `door` / `led` 这类开关量在网关上常是 0/1。
不声明类型时 `formatTelemetryText` 照数字输出，大屏上出现孤零零的「1」——
现场分不清是「运行」还是「第 1 台」。

**优先级：槽位 > 绑定的 mapping**。槽位是「这一列怎么显示」，绑定是「这个测点是什么」，
前者更贴近具体位置。同一台设备的 `running` 在列表里要文字、在趋势图里要 0/1。

**两个实现陷阱（都踩过）**：

1. `parseWidgetSlot` 只认三种合法值，其他丢弃 —— 不写入未知字符串。
2. `listScopedDevices` 原来只收 `keys: string[]`，内部
   `formatTelemetryText(row.value, undefined, ...)` **把 displayType 写死成 undefined**。
   结果：槽位配了 `displayType: "boolean"`，渲染还是「1」。
   修法：加可选 `slots` 参数，有 slots 时以它为准（带 label 和 displayType）。

**模板化**：`displayType` 跟着模板走（`toTemplateWidgetLayout` 保留），
因为它是「这一列怎么显示」的设计决策，不是实例绑定。

### 5.3 命令回执：不要相信 RPC 返回 200

平台下发走 **oneway RPC**（`/api/rpc/oneway/{deviceId}`）——只保证消息发出，
不等设备响应。网关返回 `unknown method` 时平台同样得到 200。

更麻烦的是 `rpcMethods` 本身不可信：它是 seed 脚本写进设备属性的
「期望支持清单」，不是网关真上报的能力。

**判据只能是设备状态有没有变**，所以 `command-verify.ts` 定义：

```ts
export type CommandOutcome = "confirmed" | "unchanged" | "unexpected" | "unverifiable";
export function verifyCommandOutcome(args: {
  before: boolean | null;    // 发命令前（null = 未知）
  after: boolean | null;     // 回读（null = 读不到）
  targetOn: boolean;
}): CommandOutcome;
```

判定优先级（顺序不能换）：

1. `after === null` → `unverifiable`（**绝不能报成失败**）
2. `after === targetOn` → `confirmed`
3. `before !== null && after !== before` → `unexpected`（要求前态已知，否则「动没动」无从判断）
4. 其余 → `unchanged`

`unchanged` 的文案必须写「状态未变化 + 请现场核实」，不能写「命令失败」——
互锁拒绝、设备本就在该状态、网关没实现，前端分不清是哪一种，写死原因就是编造。

等待 10 秒再回读（`COMMAND_VERIFY_DELAY_MS`）：手册要求 MODBUS 扫描周期 ≥500ms，
加网关处理与 MQTT 往返，短于此会把「慢」误判成「没响应」。

---

## 6. 场景实例化：模板 → 待绑定清单

### 6.1 模板包 v2（`template.manifest.json`）

在现有字段之后追加，不动 `aiExtension`：

```json
{
  "bindingBlueprint": {
    "schemaVersion": "1.0.0",
    "entityRoot": { "entityType": "ASSET", "required": true, "count": 1 },
    "slots": [
      {
        "path": "equipment.onlineRate",
        "regionId": "equipment-status",
        "slotKey": "onlineRate",
        "label": "设备在线率",
        "valueType": "number",
        "unit": "%",
        "allowedSources": ["attribute"],
        "required": true,
        "attributeKeyHint": "onlineRate",
        "staleAfterSec": 3600
      }
    ]
  }
}
```

- `path` 与 template01 `widgets[].bindings` 的字符串一一对应，用于把「模板声明」和「实例落值」对上。
- `count: 1` 是第 2 条决策的落地位置：模板不得声明多根。
- `allowedSources` 在 P0 只允许 `["attribute"]` 或 `["telemetry"]`，混写要报错（混写就是隐式 fallback 的来源）。

### 6.2 实例化产物

```ts
export interface PendingBinding {
  path: string;
  regionId: string;
  slotKey: string;
  label: string;
  required: boolean;
  status: "bound" | "missing" | "forbidden" | "stale" | "no-root";
  detail?: string;
}
```

这就是工坊原型里「未完成绑定 03 项」的真实实现，也让 `template01/README.md` 里那句「对缺失、过期、无权限的数据明确显示」有了承载点。

### 6.3 实例化流程（P1）

1. 选模板（`GET /api/energy/scene-templates`，现有 `SceneTemplateApi`，目前无 UI 使用）
2. 选客户 → 场站 → **场景根资产（单选）**
3. 唯一性检查（第 2.3 节）→ 冲突就停
4. `POST /api/energy/topologies`：`sceneInstance=true`, `roots=[assetId]`, `customerId`, `glb`
5. `PUT .../scene-widgets`：套模板布局（清空实例字段）
6. `PUT .../scene-bindings`：`target={ASSET, assetId}`，`points` 由 `bindingBlueprint.slots` 生成，值为空
7. 展示待绑定清单 → 逐项填 `attributeKey` → 再 PUT

第 6 步「先落骨架再填值」是关键：骨架存在，才能算出「还差几项」；一次性填完则中途退出什么都不剩。

---

## 7. 运行态

### 7.1 URL 带路径（修现有缺陷）

现在面包屑路径只存 `sessionStorage`（`idt-3d-ngx-scene-nav-stack`），新标签页或分享链接进来整条路径丢失。改成：

```
/digital-twin/runtime/:sceneId?trail=<id1>,<id2>,<id3>
```

- UUID 不含逗号，安全；最多 6 级，超出截断并只保留首尾+末级。
- 视角（`SceneViewState`）**仍留 sessionStorage**：视角不值得进 URL，也不需要分享。
- 进入子场景 = `pushSceneNav` + 改 URL；面包屑返回 = `returnToSceneNav` + 改 URL。两者都要走 `replace` 还是 `push` 要区分：**进入子场景用 push（可后退），返回上级用 push（也可后退）**，不要用 replace 把历史吃掉。
- 从 TB 看板链进来只带 `sceneId`，无 `trail` → 用 `startSceneNav` 起新路径，行为与现在一致。

### 7.2 跳转入口三层（都在客户端算，不加表）

| 层 | 数据源 | 说明 |
| --- | --- | --- |
| 客户入口 | `GET /energy/customers/{id}/default-scene` | 已有，保持 |
| 场景内对象 | `scene-jumps` | 已有，`decideObjectClick` 的「1 个直接进 / 多个先选再进」保持 |
| 底部 tab | 同客户 + 同场站、`sceneInstance=true` 的场景列表，按 `listOrder` 排 | template01 那排 tab；不加分组字段 |

tab 与 `scene-jumps` 的区别要说清：tab 是**平级横切**（同一资产的不同关注点，靠大屏内部切换，不换场景），`scene-jumps` 是**纵深下钻**（换场景、换资产）。

### 7.3 失败文案

现有 `SceneOpenFailureKind` 把客户打开草稿场景归到 `not-found`（后端返回 `ITEM_NOT_FOUND`），提示「找不到这个场景」。改成：

| kind | 客户文案 |
| --- | --- |
| `not-found` | 找不到这个场景 |
| `not-published`（新增） | 这个场景还没有发布 |
| `not-owned` | 这个场景不属于当前客户 |
| `unavailable` / `timeout` | 保持现有 |

新增 `not-published` 的判据：租户能读到该场景且 `publishState !== "published"`，而当前身份是客户。不要靠错误码猜。

---

## 8. 待修 bug（阻塞项，P0 第一件事）

`packages/scene-schema/src/index.ts` 的 `platformSchema` 缺少 `customerId` / `sceneInstance` / `publishState` / `templateId` / `templateVersion`，zod 默认 strip。实测：

```
输入：{ siteId, viewType, customerId:"cust-1", topologyId, sceneInstance:true, publishState:"published" }
输出：{ siteId, topologyId, viewType }        ← customerId / sceneInstance / publishState 全部丢失
```

后果：`importSceneJson` 导入的场景变成「无客户归属」，租户列表看不到，客户按 `customerId` 过滤也打不开，且**不报错**。

修法：`platformSchema` 补齐上述字段（类型与 `ScenePlatformRef` 对齐，注意 `sceneInstance` 用 `z.boolean().optional()`），并加一条单测钉住「解析后字段不丢」。

不修的连带风险：模板包导入、场景 JSON 导出再导入、跨机器同步 —— 三条路都会静默失效。

---

## 9. P0 任务拆分与验收

### 9.1 任务（按依赖顺序，每项都要能独立验收）

| # | 任务 | 产出 | 验收 |
| --- | --- | --- | --- |
| P0-1 | 修 `platformSchema` | `packages/scene-schema/src/index.ts` + 单测 | 解析后 `customerId` / `sceneInstance` / `publishState` 保留 |
| P0-2 | 绑定模型 v2 类型与归一化 | `shared-types/device.ts`、`data-adapter/binding-normalize.ts` + 单测 | 旧文档读入不报错、`bindingPoints()` 对 v1 文档推导正确 |
| P0-3 | 资产读取适配器 | `data-adapter/asset-client.ts` + 单测（mock client） | 分页、`truncated` 告警、401/403 与缺失分开 |
| P0-4 | 大屏 slot 扩展 | `scene-widget-layout.ts`、`widget-values.ts` + 单测 | 资产分支取值正确，模板布局过滤掉实例字段 |
| P0-5 | 场景根唯一性 | `data-adapter/scene-root.ts`（判据 + 冲突结果） + 单测 | 三种存量长度都不误判；冲突返回可打开的目标 |
| P0-6 | 启动横幅/场景列表状态 | 只读 UI 标「未绑定资产」 | 存量数据不被误标为正常 |
| P0-7 | 后端 `validateBindings` 补 ASSET 归属校验 | 平台 Java（**唯一一处 P0 后端改动**） | 越权资产被拒；现有设备绑定用例不回归 |

P0 不碰：跳转 URL 改造、模板库 UI、template01 挂载 —— 都属 P1。

### 9.2 单测清单（精确到用例）

`packages/scene-schema`
- `platformSchema 保留 customerId / sceneInstance / publishState / templateId`
- 缺 `customerId` 时仍能解析（老文档兼容）

`data-adapter/binding-normalize`
- v1 文档（只有 `deviceId` + `telemetryMappings`）→ `bindingPoints` 逐项为 `source:"telemetry"`
- 只有 `target` 无 `deviceId` → 保留（资产条目）
- 两者都无 → 丢弃
- 同时有 `deviceId` 与 `target(DEVICE, 同 id)` → 不重复产出

`data-adapter/asset-client`
- 多页拉全；超上限置 `truncated`
- `value` 为 `{value, ts}` 包装时正确解包
- 403 → 抛可识别错误（不是返回空数组）
- 请求不存在的 key → 返回空，不抛

`data-adapter/scene-root`
- `roots.length===1` 参与唯一性
- `roots.length===0` / `>=2` 不参与，且标记 `unresolved`
- 命中其它场景 → 返回 `{ conflict: true, scene: {id,name} }`，不含「强制创建」
- 命中自己 → 允许

`features/scene-widgets/widget-values`
- 资产属性有值 → `origin:"asset-attribute"`
- 缺 key → `unavailableReason:"missing"`，`text` 为 `—`
- 403 → `unavailableReason:"forbidden"`（与 missing 区分）
- `lastUpdatedTs` 超限 → `unavailableReason:"stale"` 但仍给值

### 9.3 本机验收命令

```bash
cd /Users/cuijinlong/Documents/workspace/3d-ngx
pnpm typecheck
pnpm test
```

浏览器手工验收（P0 结束后，接真实后端）：

1. 租户登录 → 客户列表 → 某客户场景列表：存量多根场景显示「未绑定资产」，不显示为正常。
2. 打开一个 `roots` 恰好一个的场景，大屏上资产属性格显示真实值；故意填一个不存在的 key → 显示「未上报」，不是 `0`。
3. 用客户账号打开同一场景 → 属性正常；打开同客户未发布场景 → 文案是「这个场景还没有发布」。
4. 导出场景 JSON 再导入 → 该场景仍出现在原客户下（验证 P0-1）。

第 4 条是回归判据，最容易漏：它不报错，只是场景「消失」到无名客户下。

---

## 10. 留给 P1/P2 的已知事项（不在本轮）

- **P1**：`trail` URL 改造；template01 拆成 `CampusScreenShell` + `campus-screen.json` 模板，中间 `#pc-canvas-root` 换成 `<EngineViewport>`；实例化向导接模板库；待绑定清单 UI；tab 接场景族。
- **P1**：资产属性依赖接口不可用时的重试与缓存（现在每次渲染都读会放大请求）。
- **P2**：后端硬校验场景根唯一性（409），替代前端软约束。
- **P2**：GLB 缓存与进度条（新浏览器首次打开要下 10MB+，现在无进度反馈）。
- **P2**：绑定失效处理（设备变虚拟 / 资产解绑 → 标红、停止订阅、提示重绑）。
- **P2**：发布前检查清单（未绑定项、跳转目标未发布、GLB 超 48MB）。
