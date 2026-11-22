# engine-adapter

从 GLB/GLTF 动态读取可绑定参数。优先解析 `extras.hmi`（`hmi-scene/1`）中的设备、阀门、仪表、管道流动和动作剪辑；没有 HMI extras 时回退为节点清单。

绑定界面必须使用这里的解析结果，禁止在前端写死设备测点。
