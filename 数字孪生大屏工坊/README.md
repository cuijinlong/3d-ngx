# 工业3D场景管理系统 HTML 交互原型

## 页面
- index.html：工作流总览
- templates.html：模板中心
- assets.html：GLB资产与场景实例
- editor.html：提示词驱动的在线编程工作台
- binding.html：ThingsBoard设备与遥测绑定
- publish.html：发布前检查、版本管理与运行预览

## 使用
解压后直接用浏览器打开 `index.html`。各页面顶部和左侧导航可互相跳转。

## 原型边界
这是前端交互设计原型，不是已连接真实 PlayCanvas / ThingsBoard 的生产软件。
- GLB 导入页面目前读取本地文件清单，不执行真实模型解析或渲染。
- 在线编程页面展示受控代码生成和沙箱工作流示意，不执行任意用户代码。
- ThingsBoard 页面中的设备、遥测 key 和连接状态均为示例，不会发起真实网络请求。
- 发布按钮只模拟候选版本生成，不会部署到服务器。
- 示例建筑和管道为界面示意，不代表真实医院工程图纸。

## 建议下一步工程化
1. 将 `SceneSchema` 定义为版本化 JSON 契约。
2. 用 PlayCanvas 实际加载 GLB，并将场景实体 ID 与 schema 对应。
3. 建立组件注册表和受限 Scene SDK，AI 只生成允许调用的组件配置与脚本。
4. 在线编程采用 Worker / iframe 沙箱、依赖白名单、代码审查和版本 diff。
5. ThingsBoard Adapter 实现实体查询、遥测订阅、历史数据和告警映射。
6. 发布时对场景 JSON、模型资源、组件版本和绑定配置进行整体打包。
