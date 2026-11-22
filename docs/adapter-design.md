# 适配器设计

`DeviceDataProvider` 提供设备查询和遥测订阅。`DeviceCommandProvider` 提供指令下发，为后续网关控制预留。

当前实现：`MockDataProvider`。不要在页面里写死模拟数据，也不要在业务代码里直接依赖 Mock 类的内部字段。

接入 guard-server 时新增 `GuardServerProvider`，在 `packages/data-adapter` 中注册，不改绑定面板。绑定字段始终来自 GLB 解析结果。
