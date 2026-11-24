# 3D 数字孪生的渲染与资源真相（2026-11-23 实测）

> 这份文档回答两个反复踩坑的问题：
> **1. 为什么另一台电脑看不到 3D？  2. 为什么管道不流动？**
>
> 两条都不是「配置没开」这种表层原因。写下来是为了**一次修对**，
> 也为了让 AI 在「一键构建数据孪生」时不会重复这些错。
>
> 每条结论都标了实测证据。没有实测支撑的推断会明确标注「未验证」。

---

## 一、静态资源：真相是「已经存平台，但有一个致命缺口」

### 1.1 两条存储链路，必须分清

| 存什么 | 存哪里 | 是否跨机器 |
| --- | --- | --- |
| **GLB 模型文件** | 平台对象存储，`glb.objectKey` | ✅ 跨机器 |
| **场景文档**（实体、绑定、编辑器状态） | 浏览器 IndexedDB（`idt-3d-ngx`） | ❌ **仅本机** |
| **部件布局 / 数据源** | 平台 `scene-widgets` | ✅ 跨机器 |

**关键**：`SceneDocument` 整体存在 IndexedDB，只有本机可见。
但这不是问题——因为加载时有兜底：

```ts
// apps/web/src/stores/scene.store.ts
if (!local) {
  const inspected = await inspectTopologyScene(id, viewerCustomerId);
  if (inspected.status === "ok") stub = inspected.document;   // ← 从平台拿骨架
}
...
if (!document.rootAssetId && document.platform?.glb?.objectKey) {
  document = await hydrateRootModelFromPlatform(document);    // ← 从平台下载 GLB
}
```

**实测验证（2026-11-23）**：用全新 Chrome profile（IndexedDB 天然为空，
等价于另一台电脑）访问同一场景：

```
canvas        1600x765        ✓ 正常
「还没有模型」 未出现           ✓
GLB 请求      200 /api/energy/topology-assets?objectKey=topology/.../model.glb
```

**结论：模型确实存在平台，全新环境也能加载。**

### 1.2 ★ 真正的缺口：`preview` 没代理 `/api`

`vite.config.ts` 原来只有：

```ts
preview: { host: true, port: 5173 },     // ← 没有 proxy
```

用 `pnpm build && pnpm preview` 在局域网另一台机器访问时：

- 前端从 `http://<ip>:5173` 加载 —— 正常
- 所有 `/api/...` 请求也打到 `5173` —— **没有代理就是 404**
- GLB 靠 `/api/energy/topology-assets` 下载 → 拿不到 → **模型空白**

**这个症状极易误判**：页面能打开、UI 都在、就是没有 3D。
看起来像「模型没存到服务器」，实际是接口根本没通。

**已修**：`preview` 补上与 `server` 相同的 `/api` 代理。

### 1.3 生产部署（nginx）必须做到三件事

开发/预览靠 Vite 代理，生产靠 nginx。仓库里**目前没有 nginx 配置**
（`find . -name "nginx*.conf"` 无结果），部署时要自己写，且必须：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:8090/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # ★ 模型是 10MB 级。默认 client_max_body_size 1m 会让上传直接 413
    client_max_body_size 64m;
    # ★ 大文件下载 + 平台侧可能做聚合查询，默认 60s 容易超时
    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
}
```

漏掉 `client_max_body_size` 的表现：**上传模型失败但前端只提示"保存失败"**。

### 1.4 IndexedDB 存 GLB 的隐患（未修，需知悉）

`importAssetFile` 会把整个 GLB 写进 IndexedDB：

```ts
// apps/web/src/services/asset/assetService.ts
await db.assets.put(asset);   // asset.blob = 10MB File
```

- 好处：同一台机器第二次打开不用再下载
- 风险：浏览器 IndexedDB 配额不足时**写入失败**，而失败点在
  `hydrateRootModelFromPlatform` 的 try 里，错误信息未必指向配额
- 另一台机器首次访问要**完整下载 10MB + 解析**

**未来优化方向**（未实施）：大模型直接用 `objectKey` 走 `blob:` URL 流式加载，
不进 IndexedDB。改动面较大，需要先确认平台下载接口支持 Range。

---

## 二、管道不流动：根因是「动画播放器从未被创建」

### 2.1 先排除的三种猜测（都不是原因）

| 猜测 | 实测结论 |
| --- | --- |
| GLB 里没有流动动画 | ❌ 有 **40 条** `*_flow`（`L-101-1_flow` …） |
| HMI 元数据缺失 | ❌ `hmi.pipes = 40`，`flow.clip` **40/40 全有** |
| 阀门默认关闭 | ❌ 13 个阀门全 `open: true` |

GLB 元数据实测（`nodes[0].extras.hmi`）：

```
devices: 32 | pipes: 40 | valves: 13 | instruments: 2
[{"node":"L-101-1","flow":{"node":"L-101-1_flow","clip":"L-101-1_flow","on":true},"valves":["V-101"]}]
```

### 2.2 真因：`instantiateRenderEntity()` 不建 AnimComponent

PlayCanvas 加载 GLB 后：

```
animAssets: 94            ← 94 条动画全部加载成功
flowAnimAssets: 40        ← 流动动画都在
pipeFound: true           ← 管道节点 L-101-1 存在
pipeHasAnim: false        ← ★ 但它身上没有任何动画组件
```

而 `playNamedAnimation` 只做：

```ts
anim.animation?.play?.(clip);
anim.anim?.baseLayer?.play?.(clip);
```

每一层可选链都命中 `undefined`，被 `try/catch` **静默吞掉**。

**这解释了那个诡异的组合现象**：
- 风扇能转 —— 靠 `setSpin` 手动旋转（代码级回退）
- 指示灯能闪 —— 靠 `setIndicator`
- **管道永远静止** —— 它只能靠动画片段，没有回退

### 2.3 修复：挂载播放器（已实施）

`apps/web/src/engine/core/EngineManager.ts` 的 `loadGlb` 里新增
`attachModelAnimations(app, asset, byName, clipLayer)`。

**命名规律**（94 条动画无一例外）：

```
动画名 = <节点名>_<动作后缀>
后缀集合 = flow | spin_fan | blink_led | swing_gauge | swing_door | open | close | on | off
```

反推节点名**不能用「最后一个下划线之前」**：

| 动画名 | lastIndexOf('_') | 正确结果 |
| --- | --- | --- |
| `1_spin_fan` | `1_spin` ❌ | `1` |
| `L-101-1_flow` | `L-101-1` ✓ | `L-101-1` |
| `立式管道离心泵_2_swing_gauge` | `立式管道离心泵_2` ✓ | 同左 |

必须按**已知后缀**剥（`stripClipSuffix`），剥不掉就返回 null ——
宁可不动，也不要绑错节点。

### 2.4 三个 PlayCanvas API 陷阱（都实测踩过）

```ts
// ① addComponent 第二个参数是 ComponentData 普通对象，不是组件实例
entity.addComponent("anim", { activate: true });     ✓
entity.addComponent("anim", new AnimComponent());    ✗ 类型与运行时都不对

// ② assignAnimation 要求 layer 已存在，否则只打一行 error 然后静默返回
anim.assignAnimation(clip, track);                   // 首次：自动建 "Base" layer
anim.addLayer(clip2, 1);                             // 后续：必须先建 layer
anim.assignAnimation(clip2, track2, clip2);          ✓
anim.assignAnimation(clip2, track2, clip2);          ✗ 未 addLayer → "layer that doesn't exist"

// ③ AnimComponentLayer 没有 stop()，只有 play/pause/reset
layer.pause();                                        ✓
layer.stop?.();                                       ✗ 静默跳过 → layer 一直 playing
```

第 ② 条的后果**特别隐蔽**：日志里一串 `assignAnimation: Trying to assign an
anim track to a layer that doesn't exist`，但页面不报错、只是不动。

第 ③ 条的后果：阀门 `open` 和 `close` 两条动画**同时播放**，视觉上互相顶掉。
`stop?.()` 因为方法不存在被可选链跳过——正是「看不出问题在哪」的典型。

### 2.5 一个 layer 只能播一个 state

同一台设备常有两条动画（`1_spin_fan` + `1_blink_led`，风扇和指示灯要同时动）。
塞进同一个 `baseLayer` 会互相顶掉，只剩最后那条。

**做法**：一段动画一条 layer，state 名与 layer 名都取 clip 名；
用 `clipLayer: Map<clip, layerName>` 记录实际归属，播放时精确查找。

**实测结果（修复后）**：

```
L-101-1  Base(L-101-1_flow)          playing: true    ← 管道流动 ✓
V-101    Base(V-101_open)            playing: true    ← 阀门开着 ✓
V-101    V-101_close                 playing: false   ← 关阀未播 ✓
1        Base(1_spin_fan)            playing: true    ← 风扇转 ✓
1        1_blink_led                 playing: true    ← 指示灯闪 ✓
```

挂载日志：`[engine] 已为 94 段 GLB 动画挂载播放器（68 个节点）`

### 2.6 关于「管道流动该不该由风格套装管」

客户提出「管道不流动和没纳入风格套装有关」。

**实测结论：本次不流动的直接原因不是风格套装，是播放器缺失。**
修好播放器后，`hvac-hud-v1` 套装下管道即流动。

但客户的直觉方向是对的——风格套装本来就该定义「渲染规则」。
现有套装 API（`GET /api/energy/topology-style-packs`）只声明元信息：

```json
{
  "packId": "hvac-hud-v1",
  "label": "HUD套装",
  "description": "可折叠浮层、管三态、自适应底座",
  "suitability": "机房/冷热源",
  "defaultBaseType": "auto"
}
```

`"管三态"` 这个描述**在代码里找不到对应实现**（前端 `grep hvac-hud`
在 `engine/` 下零命中）。也就是说：

> 风格套装目前只是「创建场景时选一个标签」，**没有驱动任何渲染行为**。

**建议（未实施，需产品决策）**：把渲染规则变成套装的真实内容，例如

```json
{
  "packId": "hvac-hud-v1",
  "render": {
    "pipe": { "flowSpeed": 1.2, "idleOpacity": 0.4, "colorByMedium": true },
    "valve": { "closedColor": "#c0392b", "openColor": "#27ae60" },
    "device": { "statusRing": "on", "staleFadeMs": 8000 },
    "base": { "autoType": true }
  }
}
```

前端加载场景时按 `packId` 取这份规则并应用到引擎。
**这才是「一键 AI 构建」真正需要的东西**——模型给几何，套装给语义。

⚠️ 这条是设计建议，没有实现验证。落地前要先确认平台侧
`EnergyTopologyAssetService.stylePacks()` 的返回结构能否扩展。

---

## 三、给「一键构建数据孪生」的输入契约

把上面所有真相收敛成 AI 需要的最小输入集。**缺任何一项都会静默失败**
（这些字段的历史坑：`dataSources` 曾因白名单解析被丢弃）。

### 3.1 必需输入

| 项 | 从哪来 | 缺失后果 |
| --- | --- | --- |
| **GLB 模型** | 平台 `glb.objectKey` | 3D 空白，卡片无对象 |
| **HMI 元数据** | GLB 内 `nodes[0].extras.hmi` | 管道/阀门/仪表全部不动、不可点 |
| **设备映射** | 平台设备 `additionalInfo.siteId` + 名称 | 数据取不到 |
| **遥测键** | `listTimeseriesKeys`（**不是** `listTelemetryKeys`） | 属性会被当遥测读，永远为空 |
| **部件布局** | 平台 `scene-widgets.widgets[]` | 空屏 |
| **数据源** | `scene-widgets.dataSources[]` | 聚合卡算错范围（会把泵算进"9 台之和"） |
| **风格套装** | `packId@version` | 目前只影响标签，不影响渲染 |

### 3.2 验收判据（每条都能一条命令验证）

```bash
# 1. 模型是否真的在平台（换机器也能拿）
node scripts/diagnose-platform-data.mjs          # 看 provider = guard

# 2. 动画播放器是否挂上
#    浏览器 console 应出现：
#    [engine] 已为 94 段 GLB 动画挂载播放器（68 个节点）

# 3. 管道是否在流（状态层，比看画面可靠）
#    L-101-1 的 Base layer playing === true

# 4. 数据是否来自平台
#    kind=guard / GuardServerProvider / 遥测请求 > 0

# 5. 布局与数据源是否落了平台
curl -H "X-Authorization: Bearer $TOKEN" \
  "$API/api/energy/topologies/$SCENE/scene-widgets" | jq '.widgets | length, .dataSources'
```

### 3.3 静默失败清单（这些坑不会报错，只会"看着不对"）

| 现象 | 真实原因 | 判据 |
| --- | --- | --- |
| 3D 空白，但页面正常 | `/api` 没代理（preview / nginx） | 网络面板看 `topology-assets` 是否 404 |
| 管道不动，风扇却转 | 动画播放器未创建 | `entity.anim === undefined` |
| 阀门 open/close 同时动 | 用了 `stop?.()`（方法不存在） | layer.playing 全为 true |
| 卡片数字被裁一位 | 复用三列 grid，主值只占 1/3 宽 | `597.75` 显示成 `7.75` |
| 同一屏数字自己跳 | 统计窗口未对齐周期边界 | 对齐到自然日/月后稳定 |
| 告警列表整页 500 | `alarm` 表时间戳为 NULL | `pageSize=1` 过、`2` 炸 |
| 配置了却看不到 | 白名单解析丢字段 | `parseSceneWidget` 里有没有该字段 |

---

## 四、本轮改动清单

| 文件 | 改了什么 | 为什么 |
| --- | --- | --- |
| `engine/core/EngineManager.ts` | 新增 `attachModelAnimations` + `stripClipSuffix`；重写 `playNamedAnimation` | 管道/阀门/仪表动画从未播放 |
| `apps/web/vite.config.ts` | `preview` 补 `/api` 代理 | LAN 预览时模型与数据全 404 |
| `hooks/useSiteEnergyStats.ts` | 新增，窗口对齐周期边界 | 数字每次刷新跳 3~14% |
| `features/scene-widgets/EnergyCards.tsx` | 新增能耗/碳排/趋势/排名卡 | 客户要求统计维度 |
| `features/scene-widgets/WidgetOverlay.tsx` | 设备聚焦收缩 + 能耗分支 | 点设备后周围统计退到背景 |
| `packages/data-adapter/src/scene-widget-layout.ts` | 加 `dataSource` / `energyMetric` 白名单解析 | 漏解析会被静默丢弃 |

验证：`tsc -b` 0、`vitest run` 67 文件 / 594 测试通过、`pnpm build` 0。
