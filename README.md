# 3D-NGX 工业三维数字孪生

独立运行的工业 3D 软件前端框架。技术路线：React + TypeScript + Vite + PlayCanvas Engine。

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
