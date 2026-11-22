# 渲染内核

PlayCanvas 是唯一主 3D 引擎。一个工作区只创建一个 Application，由 `EngineViewport` 挂载，`EngineManager` 统一管理模型加载、拾取、变换和资源释放。

不要在普通 React 组件里直接 `new Application`，也不要把引擎对象放进 Zustand 做高频更新。遥测动画走 `telemetryRuntime` 映射，UI 面板再订阅节流后的 store。
