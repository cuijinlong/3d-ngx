# AGENTS.md · 3d-ngx 项目给 AI 的入口

## ★ 第一件事：读产品铁律

**动手之前先读 [`docs/PRODUCT-CHARTER.md`](./docs/PRODUCT-CHARTER.md)。**

那是本项目的最高优先级指令。客户原话立下的铁律：

> 「我们不是定制化的开发页面，我们是要做一个模板库 + 数据孪生引擎 +
> 业务逻辑绑定 + AI 自动化构建 + ThingsBoard 的接口的整个闭环。」

一句话判据：**你写的这行代码，换一个客户、换一套设备、换一个 GLB，
还能用吗？** 不能，就说明它被做成了定制，要改成配置/规则驱动。

---

## 这个仓库是什么

3D 数字孪生大屏的**运行时 + 编辑器**，跑在 ThingsBoard（guard-server）之上。

```
apps/web            React 前端（Studio 编辑态 + Runtime 运行态）
packages/
  engine-adapter    GLB/HMI 解析、PlayCanvas 绑定
  data-adapter      provider 抽象（guard / mock）、场景布局、模板
  scene-schema      zod schema
  shared-types      跨包类型
scripts/            诊断与验收工具
docs/               规范与真相文档
.agents/skills/     AI 可执行技能
```

## 必读文档（按场景挑，不必全读）

| 你要做的事 | 读这个 |
| --- | --- |
| 判断该不该这样改 | `docs/PRODUCT-CHARTER.md`（铁律） |
| 改 3D 渲染 / 模型加载 / 动画 | `docs/3d-rendering-and-assets.md` |
| 改部件（卡片）样式或数据 | `docs/screen-widget-spec.md` |
| 用模板包建场景 | `docs/template-package-spec.md` |
| 声明设备↔3D 的绑定契约 | `docs/twin-binding-contract.md` |
| 排查「大屏没数据 / 数据是假的」 | `scripts/diagnose-platform-data.mjs` |

## 硬性约束

1. **不污染 ThingsBoard 内核**：业务走自研部件/服务，不改 TB 原生类。
   接口缺字段就**补平台**（加法），不要在前端造平行实现。
2. **数据一律来自平台**：不存在"演示数据开关"。唯一例外是明确的离线开发场景，
   且必须可见标注。
3. **所见即所得**：设计态与运行态用同一个订阅实现（`useSceneFeedDeviceIds`），
   改一处两边都变。
4. **接口禁 N+1**：批量取数要并发 + 缓存 + 上限保护。
5. **静默失败必须留痕**：可选链吞掉的错误要打一次 warn；配置读不到要显式提示。
6. **改完必须验证**：`tsc -b` + `vitest run` + 浏览器实测（headless CDP）。
   只看退出码不够，要看真实渲染结果。

## 验证命令

```bash
cd apps/web
../../node_modules/.bin/tsc -b --pretty false
../../node_modules/.bin/vitest run
cd ../.. && pnpm build

# 平台数据链是否真的通（四路交叉验证）
node scripts/diagnose-platform-data.mjs
```

## 环境约定

- 后端 8090（Docker `energy-server`）、前端 5173 由用户本人启动，不要自行重启。
- 平台凭证：`tenant@126.com` / `12345678`（令牌会过期，需重新登录）。
- 天骄场景：`dfbc1da0-e66c-11f1-9554-01523035eefa`（仅用于本机测试，
  **不要写进代码**）。
