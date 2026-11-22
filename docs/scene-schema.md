# 场景文件规范

场景 JSON 必须包含 `schemaVersion`。当前版本为 `1.0.0`。

字段：

- `scene` 元数据
- `settings` 背景、网格、吸附
- `rootAssetId` 整场景 GLB 资产
- `entities` 实体（`transform` 仅为占位，不作为权威位置数据）
- `platform` 可选，场站 / 拓扑 / 视图 / roots 引用，不含拓扑整图
- `settings.stylePack` 可选，风格套装 id（HUD / 全景），完整皮肤待设计落地
- `bindings` 设备绑定、测点映射、动作映射
- `hmiSnapshot` 仅作提示，重新导入时以 GLB 重新解析为准

校验实现见 `@idt/scene-schema`。导入时校验失败会拒绝写入。
