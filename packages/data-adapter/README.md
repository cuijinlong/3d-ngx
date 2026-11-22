# data-adapter

业务模块只依赖 `DeviceDataProvider` 与 `DeviceCommandProvider`。第一阶段实现为 `MockDataProvider`，所有数据标记为演示数据。

控制台（暂停、加速、离线）通过 `getMockController()` 访问；订阅和下发指令必须走接口方法。未来 guard-server 接入时新增 Adapter，不改业务调用点。
