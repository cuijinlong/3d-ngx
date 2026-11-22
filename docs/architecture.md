# 架构说明

平台分为 Studio 编辑模式和 Runtime 运行模式，共用同一套 PlayCanvas 渲染内核，编辑逻辑与运行逻辑分离。

- React 负责页面、表单和状态。
- `EngineManager` 负责 Application 生命周期、模型加载与释放。
- 场景描述是与引擎解耦的 JSON（`schemaVersion: 1.0.0`），保存模型引用、平台场站/拓扑引用和绑定。`entity.transform` 只是兼容旧 JSON 的占位，加载后不会回放到 GLB 节点。
- 数据层通过 Adapter 接口访问。第一阶段是 `MockDataProvider`，日后可替换为 guard-server 的远程实现。
