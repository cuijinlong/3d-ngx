# 智慧园区数字孪生可视化大屏模板

这是可放入场景模板库的模板包，包含：
- `index.html`：可直接浏览器预览的完整大屏模板。
- `template.manifest.json`：模板元信息、布局区域、组件清单、React/PlayCanvas 挂载契约、AI 可编辑范围。
- `schema/binding.schema.json`：ThingsBoard 数据绑定描述示例。
- `docs/CampusSceneViewport.example.tsx`：React + PlayCanvas 挂载示例。

## 预览
直接打开 `index.html`。中间 `#pc-canvas-root` 是空白三维视口容器，等待 PlayCanvas Engine 挂载 Canvas。

## 模板库实例化建议
1. 模板库读取 `template.manifest.json`。
2. 创建模板实例时复制 manifest、layout 与 widget props，生成独立 `instanceId`。
3. 场景资源 URL、项目资产 ID、ThingsBoard entityId 在实例级配置，不写死在模板。
4. AI 在线编程只修改 `aiExtension.editableTargets` 允许的内容；对保护字段禁止直接改写。
5. 所有 AI 修改先输出 JSON Patch / diff，经用户确认后应用并形成版本。
6. 发布包应包含 manifest、实例配置、绑定配置、场景资源引用、React 构建产物版本。

## React / PlayCanvas 兼容
- 推荐将此模板的布局迁移为 React 组件树，或在 React 页面中托管模板布局。
- PlayCanvas Canvas 挂载到 `#pc-canvas-root` 对应的 React 容器。
- 不要让 PlayCanvas 接管整个 DOM；它只负责 3D 视口，React 负责 UI、状态、路由、属性面板和数据绑定。
- 通过 CustomEvent 契约演示了 `campus:scene-tab`、`campus:widget-action`、`campus:entity-select`、`campus:data-update`。生产项目建议封装为 typed event bus / Zustand store，不建议长期依赖全局 DOM 事件。

## ThingsBoard 数据绑定
绑定文件中的 entityId 和 telemetryKey 是占位示例。真实部署前应：
- 通过 ThingsBoard API 或受控后端获取可访问实体；
- 探测实体实际存在的 telemetry keys；
- 配置 latest / timeseries / aggregation / unit / staleAfter；
- 对缺失、过期、无权限的数据明确显示“暂无数据 / 数据延迟 / 无权限”，不使用演示数值冒充实测。

## 设计边界
图中的园区、人数、设备数量和面积仅为视觉占位示例，并非真实业务数据。三维区域不含任何模型，后续由 PlayCanvas 加载用户的 GLB/场景资源。
