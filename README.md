# 3D-NGX 工业三维数字孪生

独立运行的工业 3D 软件前端框架。技术路线：React + TypeScript + Vite + PlayCanvas Engine。

cd /Users/cuijinlong/Documents/workspace/3d-ngx && codewhale --model deepseek-flash

场景和模型可保存在浏览器 IndexedDB。设备数据在已连接平台时走后端实时源，未连接时使用演示数据源。样式对齐工业设计平台的浅色中性界面与蓝色强调，但使用本产品名称 3D-NGX。

## 启动

本机需要 Node.js 20+ 和 pnpm 10。

```bash
cd /Users/cuijinlong/Documents/workspace/3d-ngx
pnpm install
pnpm dev
```

浏览器打开 http://localhost:5173

## 推荐验收路径

1. 打开工作室（/studio/scenes），新建场景，进入编辑。不要再从首页、模拟设备、运行列表或资源页进入。
2. 点击「导入示例」加载「天骄科技园」GLB，或导入任意 SaveHMI 导出的 `.glb`。
3. 系统会从文件的 `extras.hmi` 动态读取设备、测点、动作、阀门和管道流动，不会写死参数。
4. 在顶栏「查找画面对象」里可用「按名称自动连接」匹配实时设备。绑定写入本地场景，不会改 GLB 里的位置和变量。浏览态不再出现右侧栏，不要在右侧找这个入口，也不再使用「按模型创建模拟设备」。
5. 浮动铭牌默认隐藏，只在指向或选中时出现，内容为名称、运行徽标和已绑遥测，没有启停按钮。点击对象后，启停和状态在底部抽屉里：只有同时有控制面板和屏幕的对象提供启动 / 停止；指向不会升起抽屉。
6. 浏览/预览模式下右侧整栏不出现，画布铺满。点顶栏「编辑」后右侧才出现绑定配置（目标设备 / 行为 / 看板数据）。编辑态若未选中对象，只提示「未选中设备」，不摊开绑定表。点「退出编辑」后右侧再收起。不要再找「实时检测」「历史数据」两个选项卡。
7. 保存场景，点「预览运行」进入 Runtime。运行态同样没有右侧栏，也不再为告警或测点留一栏；用底部抽屉查看状态和启停（不对现场设备真下发验收）。
8. 导出 JSON 后再从场景列表导入，确认可以重新打开。

## 工程结构

- `apps/web` 前端应用
- `packages/shared-types` 公共类型
- `packages/scene-schema` 场景 JSON 校验（Zod）
- `packages/engine-adapter` GLB 可绑定参数解析
- `packages/data-adapter` 数据与指令 Provider（Mock 演示源与平台适配）
- `packages/config` 主题
- `docs` 架构说明

## 约定

- PlayCanvas 是唯一主 3D 引擎，不要再引入 Three.js / Babylon.js 作为第二套主引擎。
- 业务模块只依赖 `DeviceDataProvider` / `DeviceCommandProvider`，不要在非 Mock 场景直接调用 Mock 内部方法（例如 `getMockController()`）。
- 不要提交 `150-server-skill`、私钥、逆向包和 `_tmp-savehmi`。
- 演示数据必须显示「演示数据」标记；已连接平台时不要写死「演示数据」。

平台接入走同一套 Provider 接口，不要在业务模块里绕开它。







所见即所得这一轮做完了。

## 你的判断是对的，有三个根因

不是一个问题，是三个独立缺陷，其中两个是真 bug。

### 根因一：编辑器和运行态订阅的设备不一样

两边各写一份「要订阅哪些设备」。运行态三路来源，编辑器只有一路：

| 来源 | 运行态 | 编辑器（改前） |
| --- | --- | --- |
| 3D 绑定的设备 | ✓ | ✓ |
| 槽位直绑的设备（**网关**） | ✓ | ✗ |
| scope 解析出的设备 | ✓ | ✗ |

**网关不是 3D 模型对象**，只在槽位里被引用。所以设计时：

```
编辑器：进水 —  出水 —  系统启停·状态未知
运行态：进水 11.9℃  出水 7.0℃  系统启停·运行中
```

抽成 `useSceneFeedDeviceIds` 两处共用。这类 bug 不报错，只让某几块卡安静地「暂无数据」。

### 根因二：订阅启动是个时序赌博

`useTelemetryFeed` 里写着「设备表还在加载就直接 return」，但 `loading`/`devices` **不在依赖里**。

结果：页面加载时若设备表在读，effect 跑一次就 return，**之后没有任何理由重跑** —— 订阅压根不启动。首屏能不能出数，取决于 `deviceIds` 会不会碰巧变一次。

改成 state，只在「未就绪 → 就绪」翻转一次。

### 根因三：画布不是成品的样子

原来只有点「预览运行」才切深色 HUD。设计师整段时间面对白底浅灰卡片，发布出去是深海军蓝玻璃幕。

改成画布**始终**按大屏皮肤渲染。顶栏、工作台、状态栏保持编辑器外观 —— 那些是大屏上不存在的东西。

## 验收不是看截图，是逐项比对

写成了脚本，可重复跑：

```bash
node scripts/verify-wysiwyg.mjs      # 退出码 0 = 两态一致
```

它会分别打开两态、等首屏出数、抓全部卡片文本逐项比对：

```
editor  titleColor: rgb(179, 210, 234) | hud: true
runtime titleColor: rgb(179, 210, 234) | hud: true
卡片数 editor/runtime: 8 / 8
✓ 全部卡片逐项一致
```

`rgb(179,210,234)` 是 HUD 标题色；改前编辑器是 `rgb(95,110,132)`（浅色）。

**一处有意的差异**：运行态的机组状态卡带「延迟 N 分钟」，编辑器不带。那是数据新鲜度提示，编辑器是设计工具，不该被「刚才某台掉线」干扰。脚本会剥掉它再比。

## 顺带发现：我的模拟器把平台写入队列压满了

连续上报 70 分钟后，`/api/v1/{token}/telemetry` 开始返回 **HTTP 503，单次 30 秒**。同一时刻读接口是 200 / 24ms —— 不是服务挂了，是写入通道被压住。

这是我上一轮埋的隐患，三个修正：

- 20 秒超时 + 503 退避 3 秒重试（原来一次 30 秒，串行 9 台就是 4.5 分钟）
- 轮次互斥（原来上一轮没跑完，定时器又叠一轮，同时两批写入）
- 间隔 180 → 240 秒

改后连跑两轮，**0 失败**。

## 验证

```
tsc -b         退出码 0
vitest run     65 文件 / 528 测试通过（新增 5 个，锁住三路来源合并）
pnpm build     3.79s
verify-wysiwyg 8/8 卡片逐项一致
大屏           9 卡 / 无延迟标记 / 120 kW / 在线率 56% / 运行中
```

## 改动文件

新增：
- `apps/web/src/hooks/useSceneFeedDeviceIds.ts` + `.test.ts`
- `scripts/verify-wysiwyg.mjs`

修改：
- `apps/web/src/hooks/useTelemetryFeed.ts`（时序）
- `apps/web/src/features/scene-editor/EditorShell.tsx`（皮肤 + 订阅）
- `apps/web/src/features/scene-runtime/RuntimeShell.tsx`（接入共享 hook）
- `scripts/simulate-unit-power.mjs`（退避 + 互斥）
- 两个 `*.module.css`（品牌图标、品牌色）

**两个新文件都不在 git 里**（`??`），要提交得先 `git add`。

## 一点必须说清

`node scripts/simulate-unit-power.mjs --interval 240` 这个进程还挂在当前会话里，**会话结束就停**，届时大屏 10 分钟后会重新显示「延迟」。

长期演示要在终端里自己跑，或者用 `launchd`。macOS 没有 `setsid`，`nohup &` 会被会话清理 —— 这条我实测过。
