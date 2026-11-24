# 天骄科技园 · 热泵机组监控大屏：主数据与实施规划

- 日期：2026-11-22（v2，按「现场一个可编程网关」修订）
- 状态：规划稿，**未开发**
- 前置：`docs/twin-binding-contract.md`（绑定契约 P0，已冻结）
- 真实资料：
  - 模型 `天骄科技园.glb`（10.1MB，1942 节点，Three.js GLTFExporter r186 导出）
  - 手册 `30RBRQ065-750VHS 2026-04 开机运行维护手册.pdf`（开利变频涡旋式风冷热泵，第 17 章 MODBUS）
  - 后端 `guard-server/guard-energy`（主数据 seed：`energy_library.json` / `vendor_models.json`）
  - 网关 `rtu/main.py` + `gateway/tb_gateway`（已有 TB 网关模式实装）

### 本轮已定

| 决策 | 结论 |
| --- | --- |
| 数据采集/控制方式 | **现场 1 个可编程网关**统一接入 9 台模块机，走 TB 网关模式 |
| 启停 | 由网关实现，前端按网关上报的能力显示 |
| 品种归属 | 环境系统下新增「风冷热泵机组」 |
| 建档范围 | 9 台模块机 **+ 2 台立式泵** |

---

## 1. 真实资料盘点

### 1.1 模型里的对象（实测解析 GLB）

HMI 数据在**根节点**的 `extras.hmi`（schema `hmi-scene/1`），不在顶层 `extras`（顶层 `extras` 为 null，只有 `asset.extras.hmi` 存场景元信息）。

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 模块机 `HMI3D-0004` | **9** | node `1`~`9`，tag `1#`~`9#`，modelName「风冷冷水机」 |
| 立式管道离心泵 `HMI3DR-0273` | 2 | node `立式管道离心泵` / `立式管道离心泵_2`，动作「压力表指针摆动」 |
| PLC控制柜 `HMI3D-0008` | 2 | 无动作、无数据 |
| 阀门 | 13 | `V-101` 等蝶阀，`stopsFlow=true` |
| 管线 | 40 | 带 `flowClip`，可做流动动画 |
| 仪表 | 2 | 随管线流动切换 on/off |
| 管件 | 22 | 三通/弯头，纯几何 |

9 台模块机的 `data` 是**占位演示值**，绝不能当实测：

```
温度 25.0℃ / 功率 15.2kW / 开度 60% / 运行状态「运行」
```

动作：`spin:fan`（风扇转动）、`blink:led`（指示灯闪烁）。9 台的动作 clip 名各不相同（`1_spin_fan` … `9_spin_fan`），绑定时按 node 取，不要硬编码。

### 1.2 手册第 17 章 MODBUS 点表（真实协议）

Modbus RTU，9600-8-N-1，扫描周期 ≥500ms。系统地址 = 主机 SW4 拨码值 + 1（1~16）。**1 个系统 = 1 台主机 + 最多 15 台从机**。

**系统状态（0x04 只读，30001~30011）**

| 地址 | 描述 | 单位 | 备注 |
| --- | --- | --- | --- |
| 30001 | 系统状态 | — | 0初始化 1停机 2启动中 3关机中 4待机 5运行 6水系统 7防冻 8故障 9测试 |
| 30002 | 系统开关 | — | 0关机 1开机 |
| 30003 | 系统模式 | — | 0制冷 1制热 |
| 30004 | 系统故障 | — | 0无故障 1警告 2报警 |
| 30005 | 系统功率 | kW | — |
| 30006 | 系统设定点 | ℃ | — |
| 30007 | 系统进水温度 | ℃ | **×10** |
| 30008 | 系统出水温度 | ℃ | **×10** |
| 30009 | 系统环境温度 | ℃ | **×10** |
| 30010 | 系统加载容量 | % | — |
| 30011 | 系统水泵 | Hz | — |

**外机状态（0x04 只读，30003+100×address 起）**

| 地址 | 描述 |
| --- | --- |
| 30003+100a | 外机开关（0关 1开） |
| 30004+100a | 外机模式（0冷 1热） |
| 30005+100a | 外机故障（0无 1警告 2报警） |
| 30006~30009+100a | 压缩机 A1/A2/B1/B2 状态（0关 1开 2强制/故障/维修） |
| 30020+100a | 进水温度（×10） |
| 30021+100a | 出水温度（×10） |
| 30044~30063+100a | 外机报警代码（8 字节 ASCII） |

**控制（0x03/0x10 读写）**

| 地址 | 描述 | 范围 |
| --- | --- | --- |
| 40051 | **系统开关（启停）** | 0关机 1开机 |
| 40052 | 系统模式 | 0制冷 1制热 |
| 40054 | 水力模块报警复位 | 0正常 1复位 |
| 40057 | 外机报警复位 | bit0~bit15 = 1~16 号外机 |
| 40062 | 制冷设定点 | 50~250（**×10**，实际 5.0~25.0℃） |
| 40063 | 制热设定点 | 150~550（**×10**，实际 15.0~55.0℃） |

**系统配置（0x03/0x10）**：40003 外机数量（1~16）、40004 水泵类型（0无泵 1单定频 2双定频 3变频水力模块）。

**写互锁（网关必须先判、前端也要提示）**

- `30001 ∈ {0,1}` 才允许改 40003 / 40004
- `30001 ∈ {0,1,4,6,7,8,9}` 才允许改 40052
- `40004 = 3` 时改 40054 才有效

### 1.3 机组技术参数（型号建档用）

30RQ750VHS 由 **5 台 30RQ150VHS** 装在一个大底盘组成（手册 3.7 节）。单系统支持 1 台，多系统最大 16 台。

| 项 | 30RQ750VHS | 30RQ150VHS |
| --- | --- | --- |
| 名义制冷量 | 715 kW | 150 kW |
| 名义制热量 | 710 kW | 150 kW |
| 压缩机输入功率（制冷） | 224.3 kW | 46.4 kW |
| 最小水流量 | 26.9 l/s | 5.38 l/s |
| 制冷进/出水 | 12→5~20℃ | 同左 |
| 制热进/出水 | 3/45→30~60℃ | 同左 |

现场是 9 台模块机，装机型号与手册系列不完全对应 —— **建档前必须现场核对每台的实际型号与拨码地址**，不要照抄 750VHS。

### 1.4 后端主数据现状

seed 文件里**已有基础主数据**，缺的是热泵这一类：

| 主数据 | 现状 | 缺口 |
| --- | --- | --- |
| 厂商 | 18 家（威胜/安科瑞/…/其他厂商） | **无开利 Carrier** |
| 型号 | 12 个，**全是电表** | 无任何暖通型号 |
| 用能品种 | 8 个：电能/水表/燃气/蒸汽/热力/环境系统/冷热/压缩空气 | 冷热 `params=[]`；环境系统 `params` 只有温度/湿度 |
| 设备类型 | 品种 `env.deviceTypes` 有 `chiller`；`deviceTypeL1` 的 `env_device.subTypes` **没有** chiller | 两套结构并存，无「风冷热泵」 |
| 标准 key | 155 项，**`direction` 全部是 `read`** | 无任何热泵 key |
| 测点表 | 设备级 `measurePoints` 是运行期唯一权威 | 9 台 + 2 泵一台都没有 |

权威口径（已核实）：设备一级/二级类型读**品种资产的 `device_types`**（新），`deviceTypeL1` 只是 legacy 回退。

---

## 2. 建档结构（按「现场一个可编程网关」）

### 2.1 项目里已有现成的网关模式

`rtu/main.py` 与 `gateway/tb_gateway` 已实装 TB 网关协议：

```python
# rtu/main.py 现有实现
GATEWAY_NAME = "ED1-Gateway"
client.subscribe(b"v1/gateway/rpc")          # 接收平台下发给下游设备的 RPC
client.publish(b"v1/gateway/connect", ...)   # 声明下游设备
client.publish(b"v1/gateway/telemetry", ...) # 上报下游设备遥测
```

所以「1 个网关 + N 台下游设备」不需要新架构，照这套写就行。

### 2.2 建档树

```
客户（第一维）
└ 场站（ASSET）
   └ 热泵系统 1（ASSET，场景根，Contains 挂场站）
      ├ Device 科技园能源网关       ← 网关身份，承载系统级 11 个点 + 系统级命令
      ├ Device 模块机 1# ~ 9#       ← 外机级点（×9）
      └ Device 立式泵 1 / 2         ← 运行状态（×2）
```

关系三套，不要混：

| 关系 | 从 → 到 | 分组 |
| --- | --- | --- |
| TB 网关关系 | 网关 Device → 子设备 | `RelationTypeGroup.GATEWAY` |
| `Contains` | 热泵系统 1 资产 → 各 Device | `COMMON` |
| `ModeledBy` | 各 Device → 型号资产 | 与 `EnergyBootstrapInstaller.MODEL_RELATION_TYPE` 一致 |

### 2.3 为什么系统级点挂网关而不是挂 1# 主机

协议层面 `30001~30011` 是**整个系统**的，不属于任何一台模块机。两条路都可行：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| 挂网关 Device（**本轮采用**） | 语义准确；网关掉线 = 系统数据缺失，判断清晰 | 网关 Device 也会出现在设备列表里，需要标注「网关，非机组」 |
| 挂 1# 主机 | 设备数少一个 | 「1# 故障了系统数据也没了」，且 1# 换机时要迁数据 |

网关 Device 必须注意两点：

1. 它**不是虚拟设备**（`additionalInfo.deviceVirtual` 不能写 `virtual`），否则绑定校验会拒；
2. 界面上要标明它是网关，不要让人以为这是第 10 台机组。

---

## 3. 启停设计（网关能力驱动）

### 3.1 链路（已通，不需要改前端）

```
前端 sendCommand(deviceId, method, params)
  → POST /api/rpc/oneway/{deviceId}
  → 平台识别 deviceId 属网关代理 → MQTT v1/gateway/rpc
  → 网关 dispatch_rpc(method, params)
```

现有 `guard-provider.ts` 的 `sendCommand` 就是这么发的，**平台侧按 deviceId 自动路由**，前端不需要判断「这是不是子设备」。

### 3.2 网关侧需要新增的能力

`rtu/main.py` 的 `dispatch_rpc` 现有：`setRelay` / `setGroupRelay` / `setAllRelay` / `readMeterNow` / `startPqSession` / `stopPqSession` / `pqSessionStatus`。**没有写 MODBUS 寄存器**。

建议新增（签名示意，非现有实现）：

```python
if method == "setSystemPower":
    # 40051：0 关机 / 1 开机
    # 前置：读 30001，必须在 {0,1} 才写；否则返回 busy + 当前状态
    unit, value = int(params["unit"]), 1 if params["on"] else 0
    ok = modbus_write_single(unit, 40051, value)
    return {"success": ok, "state": read_state(unit)}, ok

if method == "setSystemMode":      # 40052
if method == "resetAlarm":         # 40057，bit0~bit15 对应 1~16 号外机
if method == "setSetpoint":        # 40062 / 40063，×10
```

### 3.3 单台启停能不能做

取决于网关对 9 台的控制粒度，两种情形：

| 现场情形 | 能力 | 大屏表现 |
| --- | --- | --- |
| 9 台只经主机 A1/B1 走这份 MODBUS | **只能系统级**（40051 是唯一的写开关） | 一个「系统启停」按钮 |
| 网关还能分别控制每台（独立控制器/接触器/PLC 分路） | 可做单台 | 每台一个按钮 + 系统按钮 |

**建议**：`rpcMethods` 两套都先定义好（`setSystemPower` 挂网关，`setUnitPower` 挂各子设备），由网关在 `v1/gateway/connect` 或设备属性里声明支持哪些。前端按「设备上报了哪些 rpcMethods」决定按钮显隐 —— 这样现场能力变化不用改前端。

这是本方案唯一依赖现场的判断点，需要现场确认后填进 `rpcMethods`。

### 3.4 三个不能省的细节

1. **写后必须回读确认**：RPC 返回 200 只代表指令发出。要等 `30002` 变 0 或 `30001` 变 1 才算成功，大屏状态以回读为准。
2. **互锁提示**：`30001 = 2（启动中）` 时模式按钮置灰并说明原因，不要让用户反复点。
3. **网关未就绪时按钮置灰**，文案写清「启停待网关支持」，不能点了没反应。

---

## 4. 标准 key 扩展

原则：能复用就复用，语义不同才新增。新增 key 一律 `energyKind=env`、`direction=read`（启停走 RPC，不进 key 表）。

### 4.1 复用

| 手册点 | 现有 key | 单位 | 理由 |
| --- | --- | --- | --- |
| 30005 系统功率 | `power_total` | kW | 语义一致（总有功功率），只瞬时值不参与电量累加 |
| 30010 系统加载容量 | `load_rate` | % | 语义一致（负载率） |

### 4.2 新增（10 项）

| code | 名称 | 单位 | 来源 | 说明 |
| --- | --- | --- | --- | --- |
| `sys_run_state` | 系统运行状态 | — | 30001 | 枚举 0~9，值域写 `note` |
| `sys_mode` | 运行模式 | — | 30003 | 0制冷 1制热 |
| `sys_fault_level` | 系统故障等级 | — | 30004 | 0无 1警告 2报警 |
| `sys_setpoint` | 系统设定点 | ℃ | 30006 | 只读反馈，写入走 RPC |
| `water_in_temp` | 进水温度 | ℃ | 30007 / 30020+100a | ×10 |
| `water_out_temp` | 出水温度 | ℃ | 30008 / 30021+100a | ×10 |
| `ambient_temp` | 环境温度 | ℃ | 30009 | ×10 |
| `pump_freq` | 水泵频率 | Hz | 30011 | 泵建档也用得上 |
| `compressor_state` | 压缩机状态 | — | 30006~30009+100a | 0关 1开 2故障 |
| `alarm_code` | 报警代码 | — | 30044~30063+100a | 8 字节 ASCII |

**不复用** `supply_temp` / `return_temp`：那两个是热力表口径（供水/回水），热泵协议写的是「进水/出水」，测点位置和语义方向都不同。混用会让热力账单和机组监控读到同一个 key 的两套值。

### 4.3 泵的 key

用户已定「2 台泵一起建档」。但**手册里没有泵的通讯点表** —— 泵不在 30RQ750VHS 的手册范围内。

最小可用集（由网关提供，需现场确认可用性）：

| code | 名称 | 复用/新增 |
| --- | --- | --- |
| `sys_run_state` | 运行状态 | 复用（同热泵枚举，0/1 即可） |
| `sys_fault_level` | 故障等级 | 复用 |
| `pump_freq` | 频率 | 复用（新增项） |
| `water_pressure` | 水压 | **复用**（现有 key，MPa） |

这 4 项足够支撑「泵在转没转、有没有故障、出力多少」。泵的型号建档可以先不建（不占型号库），在 `additionalInfo` 记 `modelName`。

⚠ 若泵是定频（40004 = 1 或 2），`pump_freq` 无意义，只留运行状态和故障。

### 4.4 存量环境的两处硬约束（2026-11-23 实测后补）

装库前查真实库，发现两个**必须遵守**的事实，否则会破坏客户数据：

**① `env` 的 `paramDict` 里 code=2 / code=3 已被客户占用**

```
code=1 环境参数   [temperature, humidity]
code=2 运行状态   [running, spin, led, door]     ← Java 与 seed 里都搜不到，客户手工加的
code=3 调节参数   [opening]                      ← 同上
```

所以 seed 里新加的四组必须用 **code 4~7**，不能用 2~5 顺推。按 `code` 匹配、不同就新增；
按名字或按位置合并会直接覆盖掉客户的两组配置。

**② `env` 的 `device_types` 里有客户自建类型**

库里 12 项，其中 `plc_cabinet`（PLC控制柜）、`plc_gateway`（PLC网关）在 Java 与 seed 里
都不存在 —— 与模型里那 2 台 PLC 柜对得上，是现场真实在用的。

所以 `device_types` 的升级必须是**逐条按 code 合并**，不能整体写入：

| 情况 | 动作 |
| --- | --- |
| 库里没有的 code | 追加（deepCopy，不挂资源树节点） |
| 库里有的 code | 保留客户版本；仅当库里 `params` 为空且 seed 有值时补全 |
| 库里比 seed 多出的 code | 一律保留 |

`EnergyLibraryInstaller.mergeDeviceTypes` 实现了这套规则，
`DeviceTypesMergeTest` 用 8 个用例钉住（含「plc_cabinet 必须留下」）。

**③ 生效路径：`POST /api/energy/repair-init`，不是重跑 install**

`EnergyLibraryInstaller` 从 **jar 内 classpath** 读 seed（`getResourceAsStream`），
所以改 seed 必须重打包；而装库正确入口是幂等的 `repair-init`
（内部调 `createDefaultEnergyLibrary` → `upgradeKindDeviceTypes` / `upgradeDictionaryParams`），
**不要**用 `docker-01-install.sh`（它有「已有表就 exit 1」的首次安装保护）。

⚠ `repair-init` 不只补字典：它还会跑 `HvacBootstrapInstaller`（暖通演示数据）
与资产汇总遥测重算。实测会看到若干条 `Device with such name already exists` 的
ERROR/WARN —— 那是暖通演示设备重复创建被拒，**属于既有幂等性问题，不影响主数据**。

### 4.5 新增二级设备类型

品种 `env`（环境系统）的 `device_types` 追加两项：

```json
{ "code": "air_cooled_heat_pump", "name": "风冷热泵机组", "role": "control",
  "params": ["sys_run_state","sys_mode","sys_fault_level","sys_setpoint","water_in_temp",
             "water_out_temp","ambient_temp","pump_freq","compressor_state","alarm_code",
             "power_total","load_rate"] },
{ "code": "chilled_water_pump", "name": "冷冻水泵", "role": "control",
  "params": ["sys_run_state","sys_fault_level","pump_freq","water_pressure"] }
```

`role: control` 而不是 `sensor`：它们是可控设备。这直接影响「只看表计」类视图会不会把它们算进去。

### 4.5 型号

型号库只加一条系统级的，9 台单机不各建型号（避免型号库被一部工程塞满）：

```json
{ "vendorCode": "carrier", "name": "30RQ750VHS", "registers": [ ...第 1.2 节点表... ] }
```

两条既有铁律：

1. `registers[].key` **必须**在 `standardKeys` 里。
2. `vendor_models.json` 是「RTU 固件与建档的唯一依据」，**改它必须同步 `rtu/meter_profiles.py`**。热泵走的是可编程网关而非 RTU 抄表档案，要在型号 `note` 里写明「不适用 RTU 抄表档案」，否则会误导现场。

### 4.6 ★ 标准 key 必须携带「诊断依据」（2026-11-23 用户拍板）

用户原话：

> 「你看那两个冷热柜文档中，采集的指标参数中有备注、异常检测的说明指导，把计划中
> 加一条标准 key 的要加一下这个原因说明。现在用户他们在排查问题的时候，就是参考
> 这个手册的说明找原因的。后面的数据孪生、平台异常告警等分析都是要依靠这些
> 官方说明文档的，你要写在计划中别忘了。」

**这不是给这一个屏加注释，是给引擎加一类输入。** 按项目铁律（模板库 + 数据孪生
引擎 + 业务逻辑绑定 + AI 自动化构建 + TB 接口），诊断依据必须是**通用字段**：
谁接入都填，引擎统一消费。写成注释不算，得进主数据结构。

#### 现状缺口

`dictionaries.standardKeys[]` 每条现在只有 `note`（「这是什么」+ 换算/枚举）：

```json
{ "code": "water_out_temp", "name": "出水温度", "unit": "℃",
  "standard": "…", "note": "协议值×10" }
```

`vendor_models.json` 的 `registers[].note` 同样只记「文档出处」。

**两者都回答不了用户最关心的问题**：「这个数不对，是哪儿坏了？该查什么？」
现场排查靠翻 PDF，靠的是老师傅记忆 —— 这正是要固化的东西。

#### 字段设计（新增 `diagnosis`，不动既有字段）

```jsonc
// energy_library.json → dictionaries.standardKeys[]
{
  "code": "water_out_temp",
  "name": "出水温度",
  "diagnosis": {
    "normalRange": [
      { "min": 5,  "max": 20, "unit": "℃", "when": "制冷工况运行中" },
      { "min": 30, "max": 60, "unit": "℃", "when": "制热工况运行中" }
    ],
    "faultCodes": ["TH702"],
    "faultMeaning": "读数恒定不变、跳变或超范围 → 出水温度传感器失效或线路故障",
    "actions": ["检查传感器接线", "检查主板通道", "更换温度传感器"],
    "docRef": "开利 30RQ750VHS 手册 6.1 运行范围 / 18 故障诊断 TH702"
  }
}
```

`when` 是必需的：热泵的同一个温度，制冷与制热两套范围完全不同，缺工况就判错。

#### 故障码字典（单独一张表，不要内联重复）

88 个开利故障码 + 97 个卡乐报警码逐条抄进 standardKey 会严重重复。
单独建 `faultCodes` 字典，`standardKeys[].diagnosis.faultCodes` 只存 code 引用：

```jsonc
"faultCodes": {
  "TH702": {
    "desc": "出水温度传感器失效",
    "analysis": "温度传感器损坏、接线故障、主板通道损坏、电线电缆损坏或短路断路",
    "solution": "更换温度传感器、检查线路/主板",
    "source": "carrier-30rq-750vhs"
  }
}
```

#### 从两份官方文档能直接取到的判据（已实测提取）

**① 开利 30RB 风冷热泵维护手册** —— 运行范围就是天然的阈值判据（手册 6.1）

| 工况 | 参数 | 正常范围 | 备注（原文） |
| --- | --- | --- | --- |
| 制冷 | 进水温度（启动时） | 12~30℃ | — |
| 制冷 | 出水温度（运行时） | 5~20℃ | — |
| 制冷 | 进出水温差 | ≤8℃ | — |
| 制冷 | 冷凝器进风干球温度 | 5~48℃ | — |
| 制热 | 进水温度（启动时） | 3~45℃ | **低于 3℃ 须配防冻液**（备注 *） |
| 制热 | 出水温度（运行时） | 30~60℃（80 机型 30~55℃） | — |
| 制热 | 蒸发器进风干球温度 | -25~35℃ | — |
| 电气 | 电压 | 342~418V | 额定 380V |
| 电气 | **三相不平衡率** | **≤2%** | 原文：超过 2% 或电流不平衡 → 机组报警 |

来源：`风冷热泵机组/30RBRQ065-750VHS 2026-04 开机运行维护手册.pdf`

**② 故障诊断（手册第 18 章）** —— 「故障代码 / 故障描述 / 故障分析 / 解决方案」
四列，共 **110 个代码标识**。但**不是每条都直接给了答案**：

| 族 | 标识数 | 含义 | 文档是否直接给出分析与方案 |
| --- | --- | --- | --- |
| `CM000~CM185` | 12 | 通讯故障（主从机/水力模块/变频器） | ✅ 直接给（查接线、供电、通讯接地） |
| `CF021~CF061` | 7 | 工厂配置/地址/机型不匹配 | ✅ 直接给（重设配置与地址） |
| `TH701~TH722` | 22 | **温度传感器失效** | ✅ 直接给（换传感器、查线路/主板） |
| `PR731~PR740` | 10 | **压力传感器失效** | ✅ 直接给（换传感器、查线路） |
| `VF501` / `VF601` | 2 | 变频水泵报警 | ✅ 直接给（水泵故障 → 检查水泵） |
| `VF101~VF432` | 45 | 压缩机/风机变频器报警 | ❌ **区间引用**（「参考压缩机报警代码」「参考表十四」）|
| `VW201~VW464` | 12 | 变频器警告 | ❌ **区间引用**（「参考表十四」）|

**能直接落库的只有 53 条**（CM/CF/TH/PR + VF501/VF601）；
其余 57 条要先拿到压缩机/风机变频器手册（表十四）才能填。
这一条必须写进计划 —— 否则 P0 会按「110 条都填」估工时，做到一半才发现卡住。

**关键映射（指标 ↔ 故障码的因果链）**：温度类 key 读数异常，对应的故障码是
`TH7xx`。例如 `water_out_temp` 恒定不变 → `TH702` → 「传感器损坏/接线/主板」→
「换传感器、查线路」。**这就是用户要的「照手册找原因」**。

**③ 卡乐 OPTIMA/CYBERCOOL 机房空调协议** —— 寄存器表覆盖 10002~10102 共 100 个条目
（去重后 97），分两段：

| 段 | 范围 | 条数 | 内容 |
| --- | --- | --- | --- |
| 状态/数字量输入输出 | 10002~10035 | 34 | 运行/报警状态位（烟感、地板漏水、风机过载…）|
| 报警信息 | 10036~10102 | **66** | 逐条中文描述（室内温度过高/缺水/加湿罐损坏…）|

报警段 66 条**每条自带中文描述**，是「报警码 → 人话」的直接字典，无引用缺口。

源：`风冷热泵机组/OPTIMA-CYBERCOOL通讯协议（卡乐通用）.pdf`

#### 四个消费方（为什么必须进主数据而不是写注释）

| 消费方 | 用它做什么 |
| --- | --- |
| 现场排查 | 告警面板直接显示「故障分析 + 解决方案」，不用翻 PDF |
| 数据孪生 | 用 `normalRange` 判定 3D 场景里设备该绿还是该红 |
| 平台异常告警 | `normalRange` → TB 告警规则的阈值来源（不凭感觉拍阈值） |
| AI 分析 | `faultMeaning` 做归因，避免编造原因 |

#### 落地约束

1. **`when` 不许省** —— 制冷/制热两套范围，缺工况必然误判。
2. **`docRef` 必须能回溯到具体条款**（手册章节号 / 协议表页码），
   否则无法核对，也无法在文档改版时更新。
3. **没有官方依据的 key 留空 `diagnosis`，不要编造**。宁缺勿假 ——
   编造的阈值会直接变成误报，比没有更糟。
4. **`normalRange` 与设定点区分开**：`sys_setpoint` 是人工设定（40062 范围
   5.0~25.0℃），`water_out_temp` 是物理量正常范围。两者混用会让「用户设了个
   低设定点」被判成异常。

---

## 5. 需要初始化的完整清单

| # | 项 | 落点 | 数量 |
| --- | --- | --- | --- |
| 1 | 标准 key | `energy_library.json` → `dictionaries.standardKeys` | +10 |
| 2 | 品种参数 `env.params` | `energy_library.json` → `kinds[env].params` | 扩到 ~12 项 |
| 3 | 二级设备类型 | `kinds[env].deviceTypes` | +2 |
| 4 | 厂商「开利」 | `vendor_models.json` → `vendors` | +1 |
| 5 | 型号 30RQ750VHS | `vendor_models.json` → `models` | +1 |
| 5b | **`faultCodes` 故障码字典** | `energy_library.json` → `dictionaries.faultCodes` | **119 条**（开利 53 + 卡乐 66）|
| 5c | **10 个新 key 的 `diagnosis`** | `standardKeys[].diagnosis` | 10 份（含 `normalRange` + `when`）|
| 6 | 网关 Device | TB Device | 1 |
| 7 | 9 台模块机 Device | TB Device | 9 |
| 8 | 2 台泵 Device | TB Device | 2 |
| 9 | 网关关系 | `RelationTypeGroup.GATEWAY` | 11 条 |
| 10 | 热泵系统资产 + Contains | ASSET + 关系 | 1 + 12 |
| 11 | 设备 measurePoints | SERVER_SCOPE | 12 份 |
| 12 | 设备 → 型号 `ModeledBy` | 关系 | 6 条（网关+9机，泵不建型号） |
| 13 | rpcMethods | SERVER_SCOPE | 网关 4 条 + 子设备视能力 |
| 14 | 场景实例 + 场景根 | `POST /api/energy/topologies` | 1 |
| 15 | 场景绑定 + 大屏布局 | `scene-bindings` / `scene-widgets` | 1 套 |

第 1~5 项是**租户级主数据**，走装库流程；第 6~15 项是**实例数据**，做成幂等脚本，不要手工点 12 遍。

---

## 6. 大屏设计（对照 template01）

template01 的骨架是「左右翼 + 中间 3D + 底部两图 + 中间底部 tab」，正好装得下。

```
┌─────────────────────────────────────────────────────────────┐
│ 顶栏：科技园冷热站 · 系统状态(运行) · 模式(制冷) · 总功率    │
├──────────┬──────────────────────────────┬───────────────────┤
│ 左翼      │                              │ 右翼               │
│ 机组总览  │      PlayCanvas 3D           │ 选中对象           │
│ 9 台列表  │      天骄科技园.glb          │ 铭牌：进出水温     │
│ 运行/停机 │      9 台+泵+阀+管路流动      │ 功率/加载/压缩机   │
│ /故障    │                              │ [启停]             │
├──────────┴──────────────────────────────┴───────────────────┤
│ 底部左：总功率趋势（24h）   底部右：9 台加载率对比（柱状）    │
└─────────────────────────────────────────────────────────────┘
```

### 6.1 数据映射

| 区域 | 数据源 | 绑定方式 |
| --- | --- | --- |
| 顶栏系统状态 | **网关 Device**：`sys_run_state` / `sys_mode` / `power_total` | `source: telemetry` |
| 左翼 9 台列表 | 9 台子 Device：各自 `sys_run_state`（外机级再用 30003+100a） | 逐台 telemetry |
| 右翼铭牌 | 选中那台的 `water_in_temp` / `water_out_temp` / `power_total` / `load_rate` / `compressor_state` | 选中即换 target |
| 3D 风扇/指示灯 | `sys_run_state` → `spin:fan` / `blink:led` | `actionMappings`（现有能力） |
| 3D 管路流动 | 阀门 `stopsFlow` + 系统运行 | 现有 `parse-hmi-glb` 的 rules |
| 底部趋势 | 网关 `power_total` 历史 | timeseries 查询 |
| 底部对比 | 9 台 `load_rate` 最新值 | 批量 latest |

### 6.2 启停交互

```
点按 → 二次确认（「确定停机？9 台机组将全部停机」）
    → sendCommand(网关deviceId, "setSystemPower", {on:false})
    → 等 30002 回读变 0 才更新状态
```

按钮显隐由 `rpcMethods` 决定（见 3.3），不写死在界面里。

### 6.2b 图表列与协议点位的对应关系（2026-11-23 实测后补）

大屏用的列必须能对上手册 §17 的点位，否则真实数据接进来会是空的：

| 大屏用法 | 读的键 | 手册依据 | 结论 |
| --- | --- | --- | --- |
| 系统功率（卡 + 趋势） | `power_total` | 30005（系统级） | ✅ 有 |
| 机组列表副列 | `water_out_temp` | 30021+100×a（外机级） | ✅ 有 |
| 机组运行状态 | `sys_run_state` | 30001 / 30003+100×a | ✅ 有 |
| 机组加载率对比 | `load_rate` | **只有 30010 系统级** | ⚠ 单台数不在协议里 |

**`load_rate` 的约束**：手册只给了「系统加载容量」（30010），**没有单台加载率**。
所以「9 台加载率对比」这张图：

- 演示模式下能出数（演示数据按每台造）；
- 真实数据下要**网关自己算**（用该台压缩机运行台数 / 系统容量折算），
  或者把这个列换成协议直接支持的项（如每台出水温度、压缩机运行台数）。

建档时的折中：模块机的 `measurePoints` 里**不写** `load_rate`
——不把手册没有的点位写成协议点位，避免现场照着核对时找不到依据。
网关若实现了该派生量，再按 `deviceField=load_rate` 上报即可，平台侧不用改。

### 6.2c 大屏启停（2026-11-23 已落地）

`control-bar` 是独立部件类型（不读值、发命令），配置在 `widgets[].controls`。
模板里为空，实例由装配脚本注入（`deviceId` 不能进模板）。

**已实现**：
- `SceneWidgetControl` 类型 + `parseSceneWidgetControl`（缺 deviceId/commandId 整条丢弃）
- `ControlBarCardBody`：二次确认、状态按 `sysRunStateKind` 枚举判、演示模式真切换
- `collectWidgetSlotKeys` 收 `controls[].stateKey`（否则 `sys_run_state` 不被订阅）
- `toTemplateWidgetLayout` 剔除 `controls`
- 装配脚本 `68-apply-heat-pump-screen.mjs` 的 `buildControlBar`
- 右翼重排：selected-unit 9..33 / unit-summary 34..47 / control-bar 48..59

**网关侧没实现，且不在本仓库（重要澄清，2026-11-23 查证）**

先纠正一个容易走错方向的判断：**不要去改 `rtu/main.py`**。

| 证据 | 结论 |
| --- | --- |
| `rtu/main.py:116-127` 只定义 `ED1-Gateway` / `PowerMeter-DDSU666` / `Sensor-HZ8706` / `Relay-8CH`，从站 1 是电表、2 是温湿度 | 这条 RS485 上**没有机组** |
| `vendor_models.json` 的 note 明写「本型号**不走 RTU 抄表档案**（由现场可编程网关接入）」 | 机组由另一台现场网关接 |
| `gateway/` 目录是通用 MQTT 连接器框架，`config/tb_gateway.json` 的 connectors 只有一个 `5555`，不接机组 | 也不是它 |
| 全仓库 `grep setSystemPower` 只命中两个 `.mjs` 装配脚本，无任何 Python 实现 | **机组网关程序不在本仓库** |

另外 `rpcMethods` 里那些命令（`setSystemPower` 等）是**我们自己 seed 进去的**
——`46-seed-heat-pump-rig.mjs` 的 `GATEWAY_RPC`，注释写着「网关侧需实现同名方法」。
它表达「我们希望网关支持什么」，**不是**「网关真的支持什么」。

**所以在平台侧做了「命令回执校验」**（`command-verify.ts`）：
oneway RPC 只保证消息发出，唯一真相是设备状态有没有变。点完按钮等 10 秒
（手册要求扫描周期 ≥500ms，加上网关处理与 MQTT 往返）回读 `sys_run_state`：

| 结果 | 含义 | 提示 |
| --- | --- | --- |
| `confirmed` | 到了目标态 | 成功 |
| `unchanged` | 状态没变 | 警告，指向人工核实（**不报「失败」**——互锁拒绝也长这样） |
| `unexpected` | 动了但到别的状态（如转故障） | 错误，要求立即核实 |
| `unverifiable` | 读不到状态 | 警告，提示查上报 |

按钮在等待期显示「核实中…」，避免操作员看不到动静而重复点击。

**机组网关侧要做的（在它能被编辑之后）**：
1. 实现 `setSystemPower` → 写 40051（0 关机 / 1 开机）
2. 写前判互锁：`30001 ∈ {0,1}` 才允许启停
3. 写后回读 30001，把结果写进 RPC 响应

这三件事做不做的判据是「大屏点完，按钮从『核实中』变成『运行中』」——
现在会停在「状态未变化」。

**没有配 `resetAlarm`**：它的 rpcMethods 声明要 `target` 参数，合法取值手册没写。
不猜值 —— 猜错网关直接拒，界面上看起来是「点了没反应」。

### 6.2d 浏览器实测发现的两个「卡片消失」bug（2026-11-23）

第一次在真实浏览器里跑大屏，**9 块卡只渲染出 2 块**，而所有单测是绿的。
两个 bug 都属于「数据层判据把整张卡隐掉」，单测覆盖不到
（因为没人在测「这张卡该不该显示」）：

**① `control-bar` 被「只显示有值卡」过滤**

```ts
const first = widget.slots?.[0];
if (!first) return false;   // 控制条没有 slots → 永远不显示
```

控制条发命令、不读值，本来就没有 slots。修法：单独分支，判 `controls.length > 0`。

**② `device-list` / `bar-compare` 被同一个兜底分支隐掉**

这两类的槽**没有 deviceId**（语义是「范围内每台各自读这一列」），
`readSlotValue` 找不到 deviceId 就返回 `bound:false` → 整卡判为无值。

判据改成：范围绑定 + 范围内有设备 + 这一列至少一台读得出值。
实测修复后：机组状态（9 台出水温度 6.4~7.6℃）与加载率对比（56%~80%）都出数了。

**③ 布局脚本会冲掉模板里没配的卡**

`plant-capacity`（装机参数）在模板里有，但装配脚本的 `INSTANCE_BINDINGS`
没有它 —— 每次 `--force` 重排都刷成空 slots，运行态直接消失。
另外槽位过滤只收 `device-point`，把资产卡的 `asset-attribute` 接口也滤掉了。

两条都修了：`INSTANCE_BINDINGS` 补资产绑定，槽位过滤收两种来源。
**教训：模板里每张要数据的卡都必须在实例脚本里有对应配置，否则「重跑一次」= 「丢配置」。**

### 6.2d-2 深色大屏 3D 区域发白：两个独立原因（2026-11-23 定位）

上一轮我把「3D 区域是白的」判成 headless swiftshader 渲染偏差，**判断错了**。
真实浏览器同样会白，因为有两个独立的真因：

**① `<Camera clearColor={...}/>` 完全不生效（静默）**

`node_modules/@playcanvas/react/dist/utils/validation.js` 的 `getPseudoPublicProps`：

```js
if (hasSetter && !hasGetter) return;   // 只有 setter、没有 getter → 跳过
```

PlayCanvas 的 `CameraComponent.clearColor` **恰好只有 setter 没有 getter**
（`set clearColor(v) { this._camera.clearColor = v }`，没有对应 get），
于是不进 schema；`applyProps` 里 `if (key in schema)` 不命中 → **静默跳过，无警告**。

后果：清屏色一直用 `Scene` 默认值 `new Color(0.75, 0.75, 0.75, 1)`（灰白）。

修法：清屏色必须设在 scene 上 —— `app.scene.clearColor = new Color().fromString(hex)`，
放在 `SceneLights`（已用 `useApp()`）。`<Camera>` 上的 clearColor 已删除。

**② 地面材质写死浅色，铺满整个视野**

`SceneLights` 里那块 `200×200` 的地面：

```js
mat.diffuse = new Color().fromString(DEFAULT_ENGINE_CONFIG.clearColor);  // "#eef2f6"
```

相机俯视时这块浅灰白平面占满视野，**即使清屏色改对了也看不到**。

**排错的关键一步**：临时在 `SceneLights` 打探针，实测
`scene.clearColor = {r:0.027, g:0.063, b:0.094}`（= #071018，设置成功），
但截图 (960,140) 仍是纯白 `(255,255,255)` —— 才定位到是地面盖住了。
`#eef2f6` 经 ACES 色调映射后正好接近 255，与像素值吻合。

修法：地面与网格跟随主题（`groundColor` prop）。
**清屏色和地面是两回事，改一个不影响另一个。**

### 6.2e 浏览器验证方法（可复用）

Chrome headless + CDP 直接驱动，不引入 puppeteer（Node 22 自带 WebSocket）：

```
--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

**必须加 swiftshader 三件套**，否则 PlayCanvas 报
`Failed to create a graphics device`，3D 区域全黑。

登录要绕过 React 受控输入：用原生 setter + 派发 `input` 事件，
直接赋 `value` 不会触发 onChange。

**已定论**（原判断「swiftshader 渲染偏差」是错的）：3D 发白是真 bug，
两个原因见 §6.2d-2（Camera.clearColor 静默失效 + 地面写死浅色）。

**环境注意**：headless Chrome + swiftshader 是纯软件渲染，很吃 CPU。
连续跑多次验证会把机器 load 拉到 180+，之后连 `--dump-dom` 都返回空 ——
这时**先 `pkill -f remote-debugging-port` 再等负载下降**，
不要误判成「代码把页面搞死了」。

### 6.2f 在线编程（2026-11-23 新增）

**规格来源**：`template01/template.manifest.json` 的 `aiExtension`：

```json
{
  "editableTargets": ["widget.props","widget.layout","widget.style","widget.binding","scene.interaction","scene.layer"],
  "protectedTargets": ["templateId","mountPoints.scene","runtime.eventContract"],
  "operations": ["add-widget","update-widget","remove-widget","bind-telemetry","add-scene-event","add-panel"],
  "requiresDiffReview": true
}
```

**实现**（`packages/data-adapter/src/layout-proposal.ts`）：

```ts
examineLayoutProposal(layout, operations, extension) → { ok, issues, diff, next? }
```

纯函数，**不落地**。四条硬规则：

| 规则 | 理由 |
| --- | --- |
| 操作必须在 `operations` 白名单 | 不在名单的操作一律拒绝 |
| 不许改 `id` / `type` | 改 type 等于换部件，槽位与绑定的语义全错位；换类型请 remove + add |
| 一条非法 → 整体拒绝 | 提案是「一次意图」。允许一半生效会得到中间态，而提案方以为全成功 |
| 拒绝时仍给 diff | 让人看到「本来会改成什么」，否则无从判断为什么被拒 |

**UI**：编辑器顶栏「在线编程」（`ProgramPanel.tsx`）——
输入 JSON 提案 → 预览差异（越界逐条说明原因）→ 确认应用。

**应用时用当前 layout 重新校验**，不复用预览结果：
预览到应用之间布局可能被别处改过（撤销/重做），写回过期的 `next` 会覆盖别人的改动。

**边界来自模板**：`ScreenTemplate.aiExtension`（新字段）。
不同模板该允许的改动不同 —— 客户成品大屏可能只许改绑定，空白底稿允许自由加卡。
缺省退回 `DEFAULT_AI_EXTENSION`，所以存量模板不用改。

> `operations` 为空数组会被**整条丢弃**：空的边界等于「这个模板什么都改不了」，
> 几乎一定是写漏了，锁死整屏比退回默认值更糟。

### 6.2g 信息密度与视觉对齐（2026-11-23）

对比 `template01` 后修的五处：

| 项 | 改前 | 改后 | 依据 |
| --- | --- | --- | --- |
| device-list 每行 | 只显示 `readings[0]` | 显示全部列（主值突出+副值小字） | 参考每行 2~3 项 |
| unit-list | 单列（温度） | 温度 + 运行状态 | 9 行 × 2 = 18 个数字 |
| unit-list 行数 | 9 台只显示 7 台 | 9 台全显示 | 行距 3px→2px，标题说「机组状态」就不能少 |
| 卡片标题 | 与次要信息同色 `#7f9bb0` | `#b3d2ea` + 600 字重 | 参考的 panel-head 明显亮一档 |
| 3D 视口 | 只有光晕+渐变 | 加 48px 全息网格 | 参考 `#app:before` |

**网格三要点**（缺一不可，见 `EngineViewport.module.css`）：
叠在 canvas 之上（z-index）、mask 上实下虚（只在天区可见）、opacity ≤ 0.13（是氛围不是内容）。

**相机**：`fitDistanceFactor` 1.85 → 1.55。原值让模型只占视野宽度约 1/5，
3D 像插图而不是主视觉。仍保留余量（设备是细长一排）。

### 6.2h 运行态判据改语义：配置完整就显示（2026-11-23）

**这是本轮最重要的改动**，直接回应「页面太简单」。

**改前**：`widgetHasResolvableValue` 判据是「绑了 **且** 有值」。
网关一没上报，整张卡从大屏消失。实测实时模式下 8 块卡只显示 4 块。

三种状态被压成两种，用户分不清：

| 实际状态 | 改前表现 | 改后表现 |
| --- | --- | --- |
| 没配（漏配） | 消失 | 消失（运行态不露半成品） |
| 配了、网关没上报 | **消失** | 显示 + 「暂无数据」 |
| 配了、有数 | 显示 | 显示 |

**代价与收益**：改后会看到几块「暂无数据」的卡。但那恰恰是**真相** ——
有 4 块卡在等数据，而不是「页面只有 4 块卡」。参考模板（template01 README）也是这个要求：
「对缺失、过期、无权限的数据明确显示『暂无数据 / 数据延迟 / 无权限』」。

逐个类型的新判据：

| 类型 | 旧判据 | 新判据 |
| --- | --- | --- |
| metric-card | main 有值 | main/left/right 任一 **bound** |
| ratio-ring | 组 resolved（两侧都有值） | 任一组 used/total **bound** |
| trend-chart | 累积 ≥2 个点 | 任一槽位 **bound** |
| summary-card | boundCount > 0 | 范围解析出设备 |
| device-list / bar-compare | 至少一台读得出值 | 范围有设备 + 配了列 |
| 兜底 | bound && !missing | **bound** |

> trend-chart 特别值得一提：原来要求「攒够 2 个点」才渲染，
> 刚打开页面的最初几秒趋势图整个不存在 —— 用户以为这块卡没做。
> 卡片体本来就有「暂无历史数据」的空态，不需要用隐藏来表达「还没攒够」。

**同时补的两处「数字对不上」**：

1. **运行汇总缺「未知」**：9 台里 1 台有状态、8 台没上报时，卡片显示
   「运行 1 / 离线 0 / 故障 0」，加起来 1 ≠ 9。补上第四格「未知」后四项能加回总数。
2. **metric-card 侧边缺单位**：装机参数卡显示「制热量 710 / 制冷量 715 kW / 压缩机 224.3」——
   两侧光秃秃没量纲。改成 `${text}${unit}`。

### 6.2i 「没有数据」提示条（2026-11-23）

即便卡片保留 + 显示「暂无数据」，用户仍可能以为「页面就这么简单」。
所以在整屏**完全收不到遥测**时弹一条提示：

> 还没有收到设备数据（网关未上报）。画面上的卡片位是配置好的，缺的是数据 —— 不是页面缺内容。
> ［先用演示数据预览］

- 延迟 10 秒（刚打开页面遥测在路上，立刻提示是误报）
- 一旦来数立即收起；演示模式不弹
- 琥珀色不是红色：这不是错误，是「还没到」

**判空函数 `screenHasAnyTelemetry` 必须覆盖两类键**，只查一类会误报：

```ts
// ① 有 deviceId 的槽位：精确匹配 deviceId + key
// ② 逐台键（device-list / bar-compare）：没有 deviceId，
//    collectWidgetSlotKeys 根本不收 —— 必须额外扫一遍 latest
```

实测踩过：只做 ① 时，网关那 3 个系统级点位是 null 就判「整屏无数据」，
而左边「机组状态」9 台明明都有状态，提示条照样弹出来说「还没有收到设备数据」。
**在明明有数时说「没数据」，比不提示更糟。**

### 6.2j 对齐 template01 的视觉细节（2026-11-23）

对着 `template01/index.html` 逐项抄的，都是「看起来像不像」的直接来源：

| 元素 | template01 原值 | 落点 |
| --- | --- | --- |
| 卡片头 `⌜` 前缀 | `.panel-head span` 开头 `⌜` | `cardTitleMark`（装饰，`aria-hidden`） |
| 卡片头高度 | `31px` | `[data-ngx-hud] .cardTitle { height:31px }` |
| 卡片头下边线 | `1px solid rgba(100,178,239,.27)` | 同左 |
| 卡片头渐变 | `linear-gradient(90deg,rgba(35,111,183,.24),transparent)` | 同左 |
| 字距 | `letter-spacing:1px` | 同左 |
| 英文副标题 | `.panel-head .en{font-size:7px;letter-spacing:1px}` | `cardSubtitle` |
| 大标题英文 | `.top-center div{font-size:8px;letter-spacing:2px}` | `titleSubtitle` |
| 面板内子块 | `.traffic-box{border:1px solid rgba(67,137,197,.42);background:rgba(7,27,50,.4)}` | `[data-ngx-hud] .metricSide` |

**数据链路**：`ScreenTemplateRegion.defaultSubtitle` → `SceneWidget.subtitle`。
两者都要：模板记「英文怎么写」，实例记「渲染用哪个」。
存量布局没有 `subtitle` 时完全不渲染，不受影响。

> `toTemplateWidgetLayout` 要保留 `subtitle`（它是标题设计的一部分，
> 不像 `controls` / `deviceId` 那样是实例绑定）。

### 6.2k 空卡说清「在等什么」（2026-11-23）

参考模板没有空态（全是写死的演示值），我们是真实接入，**空态本身就是信息**。
所以 `describePendingSlot()` 把「暂无数据」拆成两行：

```
暂无数据
等待 天骄-PLC网关·生产园区 上报 power_total
```

或（有历史但停了）：

```
暂无数据
天骄-PLC网关·生产园区 的 power_total 已 2 天没有新数据
```

**为什么不直接拿模块机功率求和顶上**：实测 9 台模块机 `power` 有值
（19.3/20.1/20.9…），求和约 180 kW，看起来正好能填「系统功率」。
但那些值的**时间戳是 50 小时前**，而且口径不同（外机功率 ≠ 系统输入功率 30005）。
拿它顶上就是编造 —— 用户会看到「系统功率 180 kW」而不知道那是两天前的、还是另一个口径。

**实现要点**：时间戳必须从**原始记录**取，不能用 `readLatest` ——
它会滤掉 `value: null` 的占位记录，而那正是「最近一次尝试」的唯一证据。

### 6.2l 3D 视口 HUD 与顶栏（2026-11-23，验收前自查补）

对着 `template01/index.html` 的 3D 区域逐层抄的。原来我们的 3D 只有一块画布，
参考模板在 canvas 之上叠了四层信息：

| 参考元素 | 我们落成 | 数据来源 |
| --- | --- | --- |
| `.scene-topline` 场景名 + 英文 | `ViewportHud` 顶部 | 真实场景名 |
| `.viewport-hud` 左上 chip | `SCENE：xxx` / `LAYER：ALL OBJECTS` | 真实 |
| `.viewport-hud` 右上 chip | `FPS：58` / `CAM：PERSPECTIVE` | rAF 实时计数 |
| `.hud-bottom` 坐标系 | `X/Y/Z` 相机世界坐标 | `entity.getPosition()` |
| `.top-actions` 右上时间 | `RuntimeClock` | 真实时间，每秒刷新 |

**两个实现坑**（都实测踩过）：

1. **`useFrame` 采不到样**。它是 `useAppEvent('update', cb)`，内部
   `useCallback(..., [cb])`。回调里 setState → 重渲染 → 新回调 → 重新订阅，
   实测一次都没执行，HUD 上永远是 `FPS：--`。
   `app.stats.frame.fps` 同理为空（PlayCanvas 的 stats 采样默认没开）。
   最后用独立 rAF 计数器，只数帧不干预渲染。

2. **chip 贴在视口边缘会压在卡片上**。template01 是「三列并排」，
   3D 在中间列，贴 14px 没问题；我们是「3D 占满全屏 + 卡片浮层」，
   实测 chip 直接盖住左侧「系统功率」和右侧「运行汇总」。
   改成 `left/right: 24%` 收进中间卡片安全区，窄屏（<1400px）直接隐藏 ——
   留半截被压住的文字比不显示更难看。

**天气不显示**：参考模板 header 有 `☀ 22℃ 晴`，我们没有气象数据源。
写死一个假气温看起来就和模板一模一样，但值班员会当成实测天气。
所以只显示真实时间，等接了气象源再加。

### 6.2m 布局比例按模板精确换算（2026-11-23）

不再凭感觉调，直接把 `template01/index.html` 的 CSS 换算成百分比坐标（1920×1080 基准）：

```
.layout{inset:91px 2.3% 13px}          → x=44.2 w=1831.7
.side{top:54;bottom:190;width:218}     → x=3.13% w=11.35% y=13.43% h=67.78%
.bottom-zone{left:16;right:16;bottom:13;height:153}
                                       → x=3.13% y=84.63% h=14.17%，两块各 46.50%
左栏 flex 1.12/.9/1.05，右栏 1.12/.78/1.12，gap 9px
```

**结果：3D 净宽 59% → 71%**（模板的比例）。这才是「3D 是主视觉」的观感来源。

**三处连带改动**（不改就跑不通）：

1. **`WIDGET_SAFE_AREA.bottom` 18 → 3**。
   18% 的原始理由是「给底部抽屉留位」，但抽屉是**按需展开的浮层**
   （默认只有 22px 的 handle）。留 18% 会把底部卡钳到 y=67.8，
   与左右栏重叠 —— 而模板的底部是直接到底的。

2. **右下角「总览」按钮移到顶栏**。
   它固定在视口右下 12px，正好压住模板布局里占满到 97% 的「加载率对比」卡。
   为一个小按钮（4%×2.6%）牺牲整块卡的位置不划算。
   顶栏本来就是操作区（全屏 / 返回 / 退出），按钮改名「视角复位」放那里更自然。
   连带把 `WIDGET_SAFE_AREA.overview` 置 0（不再避让）。

3. **窄卡的内容适配**。侧栏 219px 后有几处放不下，都实测确认过：
   | 问题 | 修法 |
   | --- | --- |
   | 汇总 4 格挤成一条（每格 48px） | 「未知」并入总数行：`设备总数（5 台未知）9`，下面固定 3 列（同模板 `device-split`） |
   | 对比条 9 行只显示 7 行 | 行距 3px→1px、字号 10→9 |
   | 抽屉折叠态是纯白胶囊，在深色底上突兀 | 跟随 HUD 配色 + 收小到 56px |

> 「未知」并入总数行而不是独占一格，除了宽度限制，语义上也更对：
> 它是「其余 n 台没状态」，跟总数并排放正好说明差值。

### 6.2n 进度条 + 数据契约 + 订阅性能（2026-11-23）

这一轮是「按模板做」的最后一批，但也挖出三个真问题。

#### ① 进度条（模板 `.bar-row`）

`SceneWidgetSlot` 新增 `render?: "value" | "bar"` + `barMax`。

模板里 `.bar` 是 `height:4px` + `linear-gradient(90deg,#2878e8,#55dcff)` + 外发光，
4 处用到 —— 它是「信息密度高但不杂乱」的关键：一排数字看不出哪台在出力，一排条子一眼就看出来。

落成：`unit-list` 每台 = `● 模块机 1# ▬▬▬░░ 7.4℃`。
条的颜色跟随状态（运行青 / 停机灰 / 故障红 / 未知暗灰）。

**宽度是硬约束**：卡片按模板收到 219px 后放不下「名称 | 条 | 温度 | 状态」四段。
按参考模板的结构（名称 | 条 | 数值）**去掉状态文字**，状态由 dot 颜色 + title 承载。

#### ② 数据契约不匹配（真 bug）

建档脚本给模块机定义的是 `water_out_temp`（手册 30021+100a），
但**现场网关实际上报的键是 `temperature`**。

后果：配置好的温度列永远是空的，而演示模式下又显示（demoValue 按 key 造数）——
造成「演示有、真实没有」的错觉，是最难排查的一类。

已改为 `temperature`，并把演示数据也加上 `temperature`（两边必须一致）。
⚠️ 待现场确认 `temperature` 到底是出水还是别的温度（7.35℃ 在制冷工况下符合出水特征，未证实）。

#### ③ 订阅循环太慢 —— 14 台 18 秒只跑完 4 台

原实现：`for (设备) { fetchRawDevice → listTelemetryKeys → getTelemetry }` 全串行，
每台 **6 个请求**（device + keys + 3 个属性 scope + values），14 台 = 84 个往返。
实测 18 秒只跑完 4 台 —— 大屏上 5#~9# 永远「未知」，而后端 `values/timeseries` 明明有值。

更糟：`setInterval(3000)` 不管上一轮跑没跑完就再起一轮，多轮叠加成请求风暴。

三处修正（`guard-provider.ts`）：

| 修法 | 效果 |
| --- | --- |
| 键列表缓存 60 秒，**放实例上** | 每台 6 请求 → 2 请求 |
| 分批并发（6 台） | 14 台 3 批完成 |
| 单轮锁（`inFlight`） | 不再叠加 |

> 缓存必须放**实例**上，不能放 `subscribeTelemetry` 闭包里：
> `useTelemetryFeed` 的依赖是 `deviceIds.join("|")`，而范围设备异步解析 ——
> 一次页面加载会重订阅好几次，闭包缓存每次清零，优化白做。

同一类问题还有一处：`useTelemetryFeed` 用**白名单**过滤
（`devices.filter(isRealtime).map(id)` 取交集），隐含假设 deviceStore 有全部设备。
实测不成立 —— 改成黑名单（只排除已知虚拟设备），`subscribeTelemetry` 内部本来就有第二道判定。

**验证**：9 台全部有值（7.4~8.6℃），汇总 `运行 5 / 离线 4 / 故障 0`，四项加回 9。

### 6.2o 数据新鲜度 + 范围聚合 + 订阅根因（2026-11-23）

这一轮把「卡片全空」彻底解决了。挖出的订阅 bug 是整场最难定位的一个。

#### ① 数据滞后 51 小时，界面显示得像实时（安全风险）

`staleAfterSec` 逻辑一直存在，但**只有槽位显式配了才判过期**，实际一个都没配 ——
于是库里数据停了 51 小时，大屏照样显示「7.4℃」，和实时数据长得一模一样。
值班员据此以为设备在运行，可能做出完全错误的判断。

两处修正：

| 修法 | 说明 |
| --- | --- |
| 默认阈值 `DEFAULT_TELEMETRY_STALE_SEC = 600` | 配漏了也不会静默显示假实时 |
| 卡片头渲染「延迟 N 天」琥珀标记 | 只在运行态；值仍保留（抹掉会让人以为测点丢了） |

槽位仍可用 `staleAfterSec` 覆盖默认值。

#### ② 范围聚合：用真实数据填满空卡

网关的 `power_total`（30005）实测一直是 null，但 9 台机组各有 `power`（19.3~25.7 kW）。

`SceneWidgetSlot.aggregate: "sum" | "avg" | "max" | "min"` + `readScopedAggregate()`：
把 scope 范围内所有设备的同一测点聚合成一个值。

**两条硬约束**：

1. **必须先按 `filterText` 收窄**。scope 指向场景拓扑时有 14 台设备
   （9 模块机 + 2 泵 + 2 PLC + 网关），直接求和会把泵算进去 ——
   混合口径的数字比空着更糟。复用 `listScopedDevices` + `filterRowsByName`，
   和 device-list 用同一套过滤，保证同屏数字不打架。
2. **label 必须写清口径**。现在是「9 台机组之和」——它**不等于**系统总功率 30005
   （后者还含水泵、风机，差 10%~20% 很正常）。不写清就是骗人。

实测核对：19.3+20.1+20.9+21.7+22.5+23.3+24.1+24.9+25.7 = **202.5 kW**，
界面显示 203（≥100 取整）—— 分毫不差。

只统计**有值**的设备，不按 0 算（按 0 会让总数凭空变小，看起来像负荷下降）。
过期判定取**最老**的那条（短板效应）：一台停更，整个聚合就不该算实时。

#### ③ `load_rate` 挂羊头 → 改成功率对比

手册里**没有单台加载率**（只有 30010 系统加载容量）。
这张图接真实数据后一直是「—」，标题却写着「加载率」。

改用 `power`（9 台都有值），标题同步改「机组功率对比 / UNIT POWER」。
同一量纲、同一范围，对比条才有意义 —— 最长的那根就是吃电最多的那台。

#### ④ ★ 订阅根因：`stopped` 时丢弃了已拉到的数据

这是整场最难定位的 bug。症状：**9 台里稳定只有前 6 台有数据**（正好是并发度），
而且每次刷新停在不同设备上。

排查路径：
1. `data-subscribed = 14` → 设备列表是对的
2. 抓网络 → 后几台的 `/api/device/`、`keys/timeseries` 都 200，但**没有 `values/timeseries`**
3. 加探针打日志 → 看到 `[SUB-OK] 449b keys=22 rows=13 stopped= true`

**根因**（`guard-provider.ts`）：

```ts
const rows = await this.getTelemetry(id, keys);
if (stopped) return;              // ← 请求回来时 stopped 已 true
for (const row of rows) callback(row);
```

`useTelemetryFeed` 的 effect 会重建订阅（范围设备异步到达 → `deviceIds` 变化），
cleanup 把 `stopped` 置 true 时请求往往还在路上。回来一看 stopped 已 true，
**整批数据丢掉**。

为什么原来会写这个检查：担心旧订阅污染新视图。但 `callback` 写的是**全局 store** ——
数据本身与订阅实例无关，同一台设备同一个键，谁写进去都是同一份真相。丢掉是纯损失。

同一处还有两个连带问题，一起修了：

| 问题 | 修法 |
| --- | --- |
| effect 依赖 `devices` / `loading`，deviceStore 一变就重建订阅 | 改用 ref，依赖只留 `deviceIds.join("|")` |
| 批次循环里 `if (stopped) return` 让后续批次直接放弃 | 去掉，让本轮跑完（多几个请求 vs 漏数据） |
| 键列表缓存放闭包里，每次重订阅清零 | 移到**实例**上（`telemetryKeyCache`） |

**验证**：9 台温度 7.4~8.6℃ 全有值，功率 19.3~25.7 kW 全有值，
汇总 `运行 5 / 离线 4 / 故障 0`（加回 9）。

### 6.2p 趋势图历史聚合（2026-11-23）

最后一块空卡「总功率趋势」。原来只画「本次打开页面后 store 累积的点」，
刷新就从头开始 —— 而且网关 `power_total` 从没上报过，永远是空的。

**新增能力**：

| 层 | 内容 |
| --- | --- |
| `DeviceDataProvider.getTelemetryHistory` | 拉一段历史，平台按 `interval` + `agg=AVG` 做服务端聚合 |
| `mergeHistoryAggregate()` | 多台设备的历史按时间桶合并（sum/avg/max/min） |
| `useScopedHistory()` | 逐台拉 24h（15 分钟桶），合并成一条 |
| `buildTrendSeries()` | 构造 ECharts 序列（从组件里抽出来，为了可测） |
| `TrendCardWithHistory` | 包装组件 —— **循环里不能调 hook** |

**三条设计约束**：

1. **按时间桶对齐，不按下标对齐**。各台采样时刻有抖动（1# 在 10:00:01、
   2# 在 10:03:00），按下标会把不同时刻当成同一时刻相加。
2. **缺桶不补 0**。某台在某小时掉线时，那个桶只有其余设备的和。
   补 0 会让曲线出现假的「负荷骤降」，而实际是掉线 —— 这类假谷底最难分辨。
3. **聚合槽与单设备槽不能混**。聚合槽只认 `scopedHistory`（多台之和），
   单设备槽只认 store 累积（这一台）。混用会把量纲差 9 倍的两条线画在一张图上。

**两个连带 bug**（都是改完聚合配置才暴露的）：

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| 趋势卡整张消失（8 块变 7 块） | 聚合槽没有 `deviceId`，`readSlotValue` 返回 `bound:false` → 判「没配」 | `widgetHasResolvableValue` 给聚合槽单独分支：配了 + 范围绑了就显示 |
| 空态文案写「还没有绑定设备」 | 落在 `<Empty>` 默认文案，让用户去找不存在的设备选择项 | 聚合槽一律走 `pendingBlock`，说「等待范围内设备上报 power 的历史（用于求和）」 |

**为什么没造测试数据验证曲线**：每台模块机只有 1 个历史点（设备 2 天前上报过一次）。
往生产库写假历史能让曲线画出来，但现场看到假数据比没数据更糟。
改为把「能不能画线」的逻辑抽成 `buildTrendSeries` 并单测（5 个用例覆盖两条分支）。

### 6.2q 首屏出数时间：10 秒 → 3 秒

订阅并发度 6 → 10。原来 14 台分 3 批，首屏要 15~20 秒才全部出数，
期间大屏显示一片「未知」—— 用户会以为系统卡了。
改后 2 批完成，实测连跑三次都是 0 未知。

同一轮还把「还没有收到数据」提示条的阈值从 10 秒放宽到 25 秒：
14 台首轮订阅最坏 20 秒，10 秒阈值会在数据到达前触发 —— 而一弹出来，
用户第一反应是「系统坏了」，误报比不提示更糟。

### 6.2r 演示数据注入：`scripts/simulate-unit-power.mjs`（2026-11-23）

趋势图画不出线，最后卡在**没有历史数据**：9 台模块机自 11-21 02:00 起停更，
每台只有 1 个点。功能链路早就通了，缺的是数据。

**为什么不能用平台自带的模拟器**：

`23-demo-simulator.py` 覆盖六类档案（电能表 / 水表 / 燃气表 / 蒸汽表 /
热力表 / 温湿度变送器），而 9 台模块机是 **`风冷冷水机`** —— 落进
`else: continue` 被跳过。不是配置问题，是那个脚本压根没这一类。

**★ 写入路径的坑：平台接口会把数组存成一个 JSON 值**

按 TB 文档走标准接口：

```bash
POST /api/plugins/telemetry/DEVICE/{id}/timeseries/SERVER_SCOPE
{"power":[{"ts":1795381979939,"value":20.55}]}
```

返回 200，但库里的实际结果：

```
ts=1795385579973  str_v=NULL  dbl_v=NULL  json_v=[{"ts":1795381979939,"value":20.55}]
```

**整个数组被当成一个 JSON 值**，ts 是写入时刻、值是垃圾。
换成单值 `{"power": 20.55}` 则存进 `dbl_v` 正确，但 **ts 被强制成 now** ——
补不了历史。

正确路径是**设备接入 API**（`tools/rehearse-meters.py` 用的也是这条）：

```bash
POST /api/v1/{accessToken}/telemetry
[{"ts":1795341600000,"values":{"power":20.5}}]
```

实测 ts 精确保留、`dbl_v` 正确。

**★ 第二个坑：`/values/timeseries` 会返回不存在的 `null` 条目**

网关的 `water_in_temp` 在 `ts_kv` 里一条都没有，但接口返回：

```json
{"water_in_temp": [{"ts": 1795386095200, "value": null}]}
```

ts 是「刚才」。**看起来像有数据但是 null，实际是零条**。
脚本里若用 `Number(null)` 判断就会得到 0，误判成「没有基准」。
基准一律直接查 `ts_kv`（`readBases()`），不信这个接口。

**补了哪些、没补哪些**：

| 键 | 设备 | 为什么 |
| --- | --- | --- |
| `power` / `temperature` / `opening` / `running` | 9 台模块机 | 只补 power 会留下「功率恢复、温度还停在两天前」这种现场不可能的状态 —— 同一个网关要么都恢复要么都不恢复 |
| `water_in_temp` / `water_out_temp` / `power_total` / `sys_run_state` | 网关 | 大屏的「进水 / 出水」「系统启停」原本是空的 |

`power_total` 取 9 台之和，**不是独立编的数** —— 否则同一屏两个总功率对不上。
`opening` / `running` 是工况状态，只推新 ts、不编曲线。

**用法**：

```bash
node scripts/simulate-unit-power.mjs --dry-run   # 预演
node scripts/simulate-unit-power.mjs             # 写入（同 ts 覆盖，幂等）
node scripts/simulate-unit-power.mjs --purge     # 撤销
```

`--purge` 直连 psql：平台 DELETE 接口实测返回 200 但行还在。

**★ 第三个坑：一次性快照 10 分钟后就「延迟」**

卡片的延迟判据是 `staleAfterSec`（默认 600 秒）。一次性写入的快照点，
10 分钟后每张卡都会挂上「延迟 11 分钟」—— 大屏看起来像网关又挂了。

演示必须持续上报：

```bash
node scripts/simulate-unit-power.mjs --interval 180   # 每 3 分钟一轮
```

两个连带设计（都是实测调出来的）：

| 设计 | 为什么 |
| --- | --- |
| 桶是 **5 分钟**，不是 15 | 桶对齐意味着「末点 ts = 桶起点」，15 分钟桶会让最新数据最多滞后 15 分钟 > 600 秒阈值，实测写完仍显示「延迟 13 分钟」 |
| 首轮写满 24h，之后只补最近 6 桶 | 每轮重写整窗是 289 点 × 9 台 ≈ 2600 点，实测把首屏订阅拖慢到 20 秒以上 —— 大屏打开一片「未知」，比没有曲线更糟 |

> **macOS 没有 `setsid`**。要让它长期跑，在一个终端里直接执行上面那条命令
> （Ctrl-C 停），或者用 `launchd`。`nohup ... &` 在会话结束时会被清理掉。

**这是演示数据，不是真实遥测。** 写完「延迟 2 天」标记会消失、界面看起来像
网关正常 —— 这正是它的危险。撤销用 `--purge`。

### 6.2s 右栏补齐与内容密度（2026-11-23）

对照 `template01/template.manifest.json` 的 `regions`，模板是
**左 3 块 + 右 3 块 + 底 2 块**。而大屏右栏只有 2 块 —— 差在「选中机组」。

**根因是一个逻辑闭环**：`selection-card` 的可见性判据是
「已选中对象且该对象绑定了设备」。打开大屏时什么都没选中 → 卡片不显示 →
用户从没见过它 → 不知道能点 → 永远不会选中 → **它永远不显示**。

判据改成「场景里有可选中设备」，卡片常驻。空态给准星框 + 「点击三维场景中的机组」——
准星是科技大屏通用的「此处可交互」语言，只表示可以点，不承诺任何数量。

> **中间走过一个弯路**：先做了「13 个对象可点击」的计数。13 是场景里所有带
> `sceneEntityId` 的绑定（含非机组对象），而标题写着「机组」——
> 用户会以为有 13 台机组。**这个数无法保证准确表达机组数，就不该以数字形态出现**，
> 于是收回，改成准星框。

**运行汇总补在线率**：模板「设备设施」有「设备在线率 96.8%」。
这边算的是**真实值**：

```
在线率 = (运行 + 故障) / 设备总数
       = (5 + 0) / 9 = 56%
```

故障机仍能通信，算在线；离线与未知算不在线。所以它与上面三格数字**永远自洽**——
不会出现「离线 4 台但在线率 100%」这种自相矛盾的画面。

**高度按内容量重排**（原来是反的）：

| 卡 | 原 h | 新 h | 内容量 |
| --- | --- | --- | --- |
| 选中机组 | 24.52 | 27.50 | 空态准星；选中后多行参数 |
| 运行汇总 | **17.08** | 26.95 | 设备总数 + 3 格 + 在线率（内容最多的反而最矮） |
| 系统控制 | **24.52** | 11.66 | 1 个按钮（内容最少反而最高） |

**两个连带修复**（改高度后暴露的）：

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| 三个状态块被拉成又细又高的竖条，数字沉底 | `.summaryStatuses { flex: 1 }` 撑满剩余高度 | 固定行高 58px + `flex: 0 0 auto`，`.summaryLayout` 整体 `justify-content: center` |
| 控制按钮贴顶，下方一百多像素空白 | `.controlBar` 没有 `flex: 1`，容器高度=按钮高度，`align-content: center` 无处可居中 | 加 `flex: 1` 撑满再居中 |

### 6.2t 顶栏品牌图标（2026-11-23）

模板顶栏左侧是「发光菱形图标 + 中文名 + 英文副标题」，这边只有一行白字。
补了图标（CSS 画：圆角描边方块 + 45° 菱形，HUD 模式下带外发光），
`aria-hidden` 让读屏器跳过 —— 纯装饰，不承载数据。

英文副标题没补：大标题区已经有 `CHILLED WATER PLANT DIGITAL TWIN`，
顶栏再加一条是同义重复。

> **模板文件同步（重要）**：右栏布局改在库里之后，**必须同时改模板源文件**
> `packages/data-adapter/src/screen-templates/tianjiao-heat-pump.json`（v16 → v17）。
> `68-apply-heat-pump-screen.mjs` 是从这个 JSON 生成布局再 PUT 到平台的 ——
> 只改库不改 JSON，下次 `run --force` 会把布局刷回旧值，而且不会有任何报错。
> 这正是 AGENTS.md A2d「看板的真相源只有一个：模板文件」说的情况。
>
> 验证方式（默认就是 dry-run，不写库）：
> ```bash
> cd iot-rule-engine/nenghaobao/energy-config
> node 68-apply-heat-pump-screen.mjs   # 应显示「模板：… v17（9 块）」
> ```

### 6.2u 所见即所得：编辑器看到的必须就是打开后的样子（2026-11-23）

用户原话：「场景的打开和设计没有做到位所见即所得」。

拆开看是**两个独立缺陷**，都不是显示层的问题。

#### 缺陷一：编辑器和运行态的订阅范围不一致（真 bug）

两边都把「要订阅哪些设备」各写了一份。运行态三路来源，编辑器只有一路：

| 来源 | 运行态 | 编辑器（改前） |
| --- | --- | --- |
| `document.bindings` 的 deviceId | ✓ | ✓ |
| 槽位直绑的设备（**网关**） | ✓ | ✗ |
| scope 解析出的设备 | ✓ | ✗ |

**网关不是 GLB 对象**，不在 `document.bindings` 里，只被槽位直接引用
（`water_in_temp` / `water_out_temp` / `sys_run_state` 都挂在网关上）。

实测后果：

```
编辑器：进水 —  出水 —  系统启停·状态未知   ← 设计时看到的
运行态：进水 11.9℃  出水 6.9℃  系统启停·运行中  ← 真打开时看到的
```

修法：抽 `useSceneFeedDeviceIds`（`apps/web/src/hooks/`），两处共用。
内部 `mergeFeedDeviceIds` 是纯函数，5 个用例逐个验证「漏了哪一路会怎样」——
这类 bug 不会报错，只会让某几块卡片安静地显示「暂无数据」。

#### 缺陷二：画布不是成品的样子（设计问题）

编辑器原来只在点「预览运行」之后才切 HUD 深色皮肤。也就是说设计师
整段时间面对的是**白底浅灰卡片**，发布出去却是**深海军蓝玻璃幕**。

修法：`EditorShell` 里把画布区（`.viewport`）单独包一层 `HudSkinProvider enabled`
并加 `data-ngx-hud="on"`，**始终**按大屏皮肤渲染。
顶栏、工作台面板、状态栏保持编辑器外观 —— 那些是大屏上不存在的东西，
让它们保持工具的样子，反而更能区分「内容」和「工具」（Figma 的做法）。

> 注意 `HudSkinProvider` 是嵌套使用：外层仍是 `enabled={previewing}`
> （管顶栏），内层新增的 `enabled` 只管画布。CSS 侧靠 `data-ngx-hud` 属性选择器生效。

#### 验证判据（不能只看截图好不好看）

```
编辑器设计态与运行态的卡片文本逐项一致：
  进水 11.9℃ / 出水 6.9℃ / 138 kW / 在线率 56% / 运行中
标题色都是 rgb(179,210,234)（HUD 标题色），不是 rgb(95,110,132)（编辑器色）
```

改完实测：编辑器里 9 张卡的文本与运行态逐项相同。

### 6.2v 所见即所得：三个根因（2026-11-23）

用户原话：「场景的打开和设计没有做到位所见即所得」。
拆开是**三个独立缺陷**，其中两个是真 bug。

#### 根因一：编辑器和运行态的订阅范围不一致

两边各写一份「要订阅哪些设备」。运行态三路来源，编辑器只有一路：

| 来源 | 运行态 | 编辑器（改前） |
| --- | --- | --- |
| `document.bindings` 的 deviceId | ✓ | ✓ |
| 槽位直绑的设备（**网关**） | ✓ | ✗ |
| scope 解析出的设备 | ✓ | ✗ |

**网关不是 GLB 对象**，只在槽位里被引用（`water_in_temp` / `water_out_temp` /
`sys_run_state` 全挂在网关上）。实测：

```
编辑器：进水 —  出水 —  系统启停·状态未知   ← 设计时
运行态：进水 11.8℃  出水 6.9℃  系统启停·运行中  ← 打开时
```

修法：抽 `useSceneFeedDeviceIds`（`apps/web/src/hooks/`），两处共用。
`mergeFeedDeviceIds` 是纯函数，5 个用例逐个验证「漏了哪一路会怎样」。
这类 bug 不报错，只让某几块卡安静地「暂无数据」。

#### 根因二：订阅启动是一个时序赌博

`useTelemetryFeed` 里原来写：

```ts
if (kind === "guard" && loadingRef.current && devicesRef.current.length === 0) return;
```

而 `loading` / `devices` 都**不在 effect 依赖里**（放进去会因 store 频繁变化
重建订阅、打断轮询，这是之前修过的另一个坑）。于是：页面加载时若设备表还在读，
effect 跑一次就 return，**之后再也没有理由重跑** —— 订阅压根不启动。

首屏能不能出数，取决于 `deviceIds` 会不会碰巧变一次（scope 设备异步解析到位）。
不变就永远「未知」。**这是赌博，不是性能问题。**

修法：`feedReady` 改成 state，只在「未就绪 → 就绪」翻转一次。

#### 根因三：画布不是成品的样子

编辑器只在点「预览运行」后才切 HUD 深色。设计师整段时间面对白底浅灰卡片，
发布出去是深海军蓝玻璃幕。

修法：`EditorShell` 把画布区单独包一层 `HudSkinProvider enabled` + `data-ngx-hud="on"`，
**始终**按大屏皮肤渲染。顶栏 / 工作台 / 状态栏保持编辑器外观 ——
它们是大屏上不存在的东西，保持工具样子更能区分「内容」和「工具」。

#### 验收判据（不是看截图好不好看）

已做成脚本，可重复执行：

```bash
node scripts/verify-wysiwyg.mjs        # 退出码 0 = 两态一致
```

它分别打开两态、等首屏出数后抓全部卡片文本，逐项比对（结果示例）：

```
editor  titleColor: rgb(179,210,234) | hud: true
runtime titleColor: rgb(179,210,234) | hud: true
卡片数 editor/runtime: 8 / 8
✓ 全部卡片逐项一致
```

脚本会剥掉「延迟 N 分钟」再比 —— 那个标记是数据新鲜度提示，
只有运行态该有（编辑器是设计工具，不该被「刚才某台掉线」干扰），
属于**有意的差异**。

#### 顺带发现：持续上报会把平台写入队列打满

连续上报 70 分钟后，`/api/v1/{token}/telemetry` 开始返回 `HTTP 503`，
单次耗时 **30 秒**；同一时刻读接口是 `200 / 24ms`。不是服务挂了，是写入通道被压住。

模拟器的三个修正：

| 问题 | 修法 |
| --- | --- |
| 单次请求可能挂 30 秒，串行 9 台就是 4.5 分钟 | 20 秒超时 + 503 退避 3 秒重试一次 |
| 上一轮没跑完，定时器又叠一轮 —— 同时两批写入 | 轮次互斥（`busy` 标志） |
| 间隔 180 秒太密 | 默认改 240 秒（仍低于 600 秒 stale 阈值） |

### 6.2w 平台数据接入核实 + 精度对齐 + 告警处置（2026-11-23）

#### 一、平台数据确实接入了（四路证据）

用户问「guard-server 的平台数据到底接没接入」。这不是靠看界面能回答的 ——
mock provider 和大屏皮肤长得一模一样，数值也在合理范围。

**踩过一个坑**：探针写 `import('/@fs/.../registry.ts')`，拿到的是**另一个模块实例**，
`getProviderKind()` 报 `mock`，而应用跑的其实是 `guard`。结论完全反了。
正确路径是 `/@id/@idt/data-adapter`（Vite 的裸包解析，唯一实例）。

四路交叉验证（`scripts/diagnose-platform-data.mjs`）：

| 判据 | 结果 |
| --- | --- |
| provider 实现类 | `GuardServerProvider`（不是 `MockDataProvider`） |
| 连接状态 / 账户 | connected，`/api`，`tenant@126.com` |
| 平台设备数 | 51 台（mock 里没有这些） |
| 遥测类网络请求 | 336 个打到 `/api/plugins/telemetry/` |
| **改库值 → 界面** | 把模块机 1# 温度改成 `42.42`，界面立刻显示 `42.42 ℃`，其余 8 台不变 |

最后一条无法造假：值是我直接写进 `ts_kv` 的，mock 不可能知道。

#### 二、★ 但平台上的数据是脚本写的

**这两件事必须分开**：

- 前端从平台取数 → **真**（上面已证）
- 平台上的值从哪来 → **假**（脚本写的）

实测数据形态：

```
全库 359 个点
非整点点 2 个：11-23 12:08:21（排查时手工写入）、11-21 02:00:24（网关原始）
其余 357 个全部落在 5 分钟整点 → scripts/simulate-unit-power.mjs 特征
```

**真实网关最后一次上报：2026-11-21 02:00:24**，之后再无数据。

要让数据变真：恢复网关上报，然后 `node scripts/simulate-unit-power.mjs --purge`。
这不是 3d-ngx 仓库能修的 —— 网关在 `iot-rule-engine` 侧。

#### 三、精度对齐（用户原话：「有四舍五入的问题，你对准了」）

改之前有三套规则互相打架：

| 真实值 | 单设备槽 | 聚合槽 |
| --- | --- | --- |
| 5.97 | 6.0 | 6.0 |
| 119.9 | 119.9 | **120** |
| 20 | **20** | **20.0** |

根源：

- `formatTelemetryText` 一律 `toFixed(1)`，丢掉第二位小数；
- 聚合槽 `abs >= 100 ? 0 : 1`，按数值大小决定精度 —— 119.9 被抹成 120；
- 趋势卡大数字 `Math.round()`，122.4 → 122。

统一成一个 `formatMetricNumber`：**按数据本身精度显示，最多 2 位，去尾随 0**。

```
5.97 → 5.97    119.9 → 119.9    20 → 20    0.004 → 0.004    7.130000000000001 → 7.13
```

比率/百分比仍取整（`56%` 取整是对的，`56.3%` 在大屏上没有意义）。

改完实测界面：`114.35 kW`、`12.02℃`、`7.16℃`、`5.77℃` —— 与库值逐位一致。

#### 四、告警：接收 + 下发处置（不做规则配置）

用户明确：「不用配置告警规则，只是接收告警和下发处置告警就行了」。

**修了一个静默 bug**：`AlarmList` 组件存在，但 `BrowsePanel` **从未被挂载** ——
告警功能对用户不可见。同时 guard 没有 `subscribeAlarms`（只有 mock 有），
所以 `alarms` 永远是空数组。

四处补齐：

| 问题 | 修法 |
| --- | --- |
| 告警从不进 store | guard 无 `subscribeAlarms` → 加 60 秒轮询 `refreshAlarms` |
| UI 没有入口 | 编辑器工具栏加「告警」按钮 + 独立面板 |
| 无法处置 | `ackAlarm` / `clearAlarm`（`POST /api/alarm/{id}/ack|clear`） |
| 点完看不到变化 | 处置成功后立即 `refreshAlarms`（不等 60 秒） |

**确认与清除分开**是刻意的：合成一个「处理」会让「谁在跟进」无从追溯。
实测闭环：`ACTIVE_UNACK` → 点确认 → `ACTIVE_ACK`（ackTs 有值）→ 清除 → `CLEARED_ACK`。

> **活跃告警为 0 ≠ 没接入**。平台 1447 条告警里绝大多数是 `CLEARED_*`；
> 默认排序可能把它们排在前面，看起来「没有活跃告警」。
> 查的时候要按 `startTs DESC` 并过滤 `status`。

### 6.2x 删除模拟数据 · 只留实时 · 实时监测可改（2026-11-23）

客户要求：「删除 mock 的演示数据，同时大屏上面实时数据/演示数据去掉，就用实时数据，
而且设备的实时监测加一个修改功能。然后做 3 个排查」。

#### 一、删数据：只删脚本产物，保留真实上报

判据是 **ts 是否落在 5 分钟整点**：

| 类型 | 特征 | 处置 |
| --- | --- | --- |
| 脚本写入 | `ts % 300000 == 0`，每 5 分钟一条 | 删（1920 条） |
| 真实上报 | `ts` 带秒，如 `02:00:24` | 留 |

删除前先备份到 `ts_kv_backup_20261123`（1920 行），并重建 `ts_kv_latest`。

结果：9 台模块机各自只剩 `11-21 02:00:24` 那一个真实点。

> **`--purge` 只清 24 小时窗口，不够**。`simulate-unit-power.mjs --purge` 删的是
> 「最近 24h」，而脚本已经跑了几天。要彻底清理必须按整点特征全量删，
> 否则会以为清干净了、其实 11-22 的数据还在。

#### 二、去掉演示开关：不只删按钮

删 UI 容易，难的是**演示模式的副作用**：

| 位置 | 演示模式做了什么 | 只删按钮的后果 |
| --- | --- | --- |
| `useDemoTelemetry` | 定时器持续往 store 写假值 | 没开关但 localStorage 残留 `demo` → 继续显示假数 |
| `ControlBarCardBody` | 指令只改本地状态、**不发给后端** | 点启停看着成功，设备毫不知情 |
| `useNameplateCommands` | 同上 | 同上 |
| `ActionCommandBar` | 提示「已在演示数据中切换启停」 | 文案与实际不符 |

所以 `loadTelemetrySource()` 直接**钉死返回 `"live"`**，并顺手清掉 localStorage
里的残留值。5 处下游分支全部随之失效，不需要逐个改。

这是本轮最重要的判断：**开关是表象，下游分支才是真实行为**。

顺带修掉三个「假陈述」：

| 位置 | 原来写的 | 实际 |
| --- | --- | --- |
| `DeviceDetailPage` | 卡片标题「实时演示」+ 硬编码「演示数据」标签 | `TelemetryPanel` 读的是真实 telemetry store |
| `DeviceListPage` | 「第一阶段全部为演示数据」 | 已接 guard-server |
| `EngineViewport` | `dataLabel ?? (guard ? "后端数据" : "演示数据")` | `dataLabel=""` 时渲染成**空白方块** |

最后一条是典型的 `??` 误用：`""` 不是 `null`，不会触发回退，于是渲染一个空 span。
看起来像渲染坏了。

#### 三、设备运维 · 实时监测加「修改」

行内编辑，不弹对话框 —— TB 部件模板是 JIT 编译，`MatDialog` 要把组件工厂
送进作用域（A2d 那类静默空白风险）。原生 `input` 零依赖。

**踩到的坑：TB 的 timeseries 接口不接受对象数组。**

```js
// ✗ 不报错，但整个数组被当字符串塞进 json_v
{ energy: [{ ts: 123, value: 0.777 }] }
//   → 回读 "[{\"ts\":123,\"value\":0.777}]"，Number() = NaN，界面显示「/」

// ✓ 按 JSON 类型推断成 dbl_v
{ energy: 0.777 }
```

代价是**新增一个点**而不是替换旧点（时序库不覆盖）。回读取最新值，界面表现正确。

其他设计：
- 同一时刻只允许一行进入编辑态（否则保存时分不清改哪条）
- 初值填当前值，不清空（现场常见操作是「在现有读数上校准零头」）
- 保存成功后**回读一次**，而不是把输入值直接塞进 `measureRows` ——
  平台会做类型转换，以前端输入为准会出现「界面 12.345、库里 12.35」
- `scope=ANY`：同一 key 在不同设备上类型可能不同，让平台按值推断

#### 四、三项排查：为什么 11-21 之后没有数据

| # | 查什么 | 结论 |
| --- | --- | --- |
| ① | 网关设备本体 | `天骄-PLC网关` 标着 `demo:true, simulated:true`；token `uJ5h…` **有效**；下挂 13 台子设备 |
| ② | 平台接入层 | MQTT 1883 正常；`energy-server` 健康 12h；**用网关凭证发一条数据 → 2 秒落库** |
| ③ | 谁在发 / 为什么停 | 见下 |

第 ② 项是决定性的：既然同一条链路能写进去，就排除「平台配置坏了 / 令牌失效 / 规则链断了」，
问题只能在**数据源端**。

第 ③ 项的发现：

- `launchd` 有常驻任务 `com.guard.scada-sim`（PID 483，`KeepAlive=true`），
  跑 `scada-simulator.py`，**一直 MQTT `rc=5`（未授权）**，每 3 秒重连失败。
- 它用的 token `ZLNNsUviqoXSZmgXyqge` 在库中**不存在** —— 设备被重建过，token 变了。
- 但它走的是 `v1/devices/me`（**直连**协议），而模块机走 `v1/gateway/telemetry`（**网关**协议）。
  所以它**不是**那批模块机数据的来源，也**不影响 3d-ngx 大屏**。
- 11-21 02:00:24~02:05:56 那批模块机数据是逐台按秒递增的（02:00:24、25、26…），
  符合网关批量上报特征，每个 key 只有 1 个点 —— **一次性联调后中断**。
- 没有 `48-pause-rtu-reporting.sh` 的令牌备份，说明暂停脚本没跑过。

结论：**平台侧无阻断，是数据源端（RTU/网关进程）停了。**
恢复需要在设备侧处理，3d-ngx 与 guard-server 都无需改动。

> 排查时踩过一个坑：看到 `12:35` 之后持续有非整点数据，以为是别的进程在造数。
> 实际是 TB 内核自己的 CPU/内存监控（`cpuCount`、`memoryUsage`、`discUsage`），
> entity 是系统监控实体。**不要把 TB 自监控当成业务数据。**

#### 五、页面顶部那条红条：已修复（2026-11-23）

**症状**：打开「设备运维」页，顶部弹红条：

```
Cannot invoke "java.lang.Long.longValue()" because
the return value of "java.util.Map.get(Object)" is null
```

**我先查错了文件。** 一开始搜 `@GetMapping("/energy/alarms")`，
在 `AlarmEventController` 里找到一段很像的代码，翻遍了它的
`longValue()` 调用点（4 处都有 null 守卫）—— 全是白费。
实际映射在 **`SiteAlarmListController`**，两个类都有类似职责，
只按路径关键字搜会搜到错的那个。

**真正的定位过程**（记下来，因为方法论可复用）：

| 步骤 | 做法 | 收获 |
| --- | --- | --- |
| 1 | 在日志里搜异常 | **零字节**——异常被全局处理器静默包装成 JSON，不打日志 |
| 2 | 拆分参数组合 | 只有 `siteId` + `statusList=ACTIVE` 会 500，其余全 200 |
| 3 | ★ 按 `pageSize` 二分 | `pageSize=1` → 200，`pageSize=2` → 500 |
| 4 | ★ `page=1&pageSize=1` | **500** —— 证明是「第 2 行本身」有问题，不是多行聚合 |
| 5 | 对照实验（写 4 种 NPE 模式跑一遍） | 确认这条消息只可能来自 `Map<...,Long>.get(k).longValue()` 或 `((Long)m.get(k)).longValue()` |
| 6 | 按第 5 步的类型特征定向搜 | 命中 `AlarmDataAdapter.toEntityData` |

第 5 步是转折点。JDK 的 helpful NPE 会区分 `Number.longValue()` 和
`Long.longValue()`——前者是 `(Number)` 强转，后者是 `(Long)` 或泛型本身就是 Long。
**光看消息就能排除掉绝大多数候选代码。**

**根因**（TB 4.4.0 内核，`AlarmDataAdapter.java:52-56`）：

```java
alarm.setAckTs((long) row.get(ModelConstants.ALARM_ACK_TS_PROPERTY));
alarm.setClearTs((long) row.get(...));
alarm.setAssignTs((long) row.get(...));
alarm.setEndTs((long) row.get(...));
```

`(long) Object` 先 checkcast 成 `Long` 再拆箱。列值是 SQL NULL 时
`Map.get` 返回 null → NPE。

数据层面的证据：

```
总告警 1447 条
ack_ts   NULL = 4
clear_ts NULL = 3
end_ts   NULL = 3
assign_ts NULL = 0

正常告警里 ack_ts = 0 的有 1438 条（TB 的标准写法）
```

**只有那 3~4 条历史脏数据**（11-16 ~ 11-19 创建，之后 4 天无新增），
不是系统性问题。

**修法：改数据，不改内核。**

按 AGENTS.md A4（不污染 TB 内核），`AlarmDataAdapter` 是 TB 原生类，
加 null 守卫属于改内核 —— 不采用。TB 的语义本身允许 0 表示"未设置"
（`acknowledged` / `cleared` 另有布尔列），所以归 0 是与平台约定一致的最小修复：

```
ack_ts   NULL → 0           从未确认
clear_ts NULL → 0           从未清除
end_ts   NULL → start_ts    end_ts 语义是"最后活跃时间"，从未更新即等于开始时间
```

`end_ts = start_ts` 的依据：正常活跃告警 72130388 的 `end_ts` 与 `start_ts`
完全相等（`1795096591598`），印证这个语义。

**修复工具**：`scripts/49-fix-alarm-null-ts.sh`

```bash
bash scripts/49-fix-alarm-null-ts.sh --check   # 只报数，退出码 1 = 有脏数据
bash scripts/49-fix-alarm-null-ts.sh --fix     # 备份 + 事务修复
```

备份表名带时间戳，可回滚。脚本会先列出行明细再动手。

**验证**：

```
pageSize=1/100 + statusList=ACTIVE + siteId  → 全 200
severityList=WARNING + ACTIVE + siteId       → 200
浏览器打开设备运维                            → 零 4xx/5xx，红条消失，表格 3 行
```

> **为什么这事值得记下来**：一个"某几行数据有问题导致整页 500"的 bug，
> 表现却像"某个筛选组合不支持"。判据是 **pageSize** 而不是参数组合 ——
> `pageSize=1` 能过、`pageSize=2` 炸，说明问题在**第 2 行数据**上。
> 先做这个二分，比读一万行代码快。

> **另一个教训**：异常不上日志时，先怀疑"有一个我没想到的 handler 吃掉了它"。
> 这次连 `docker logs --since` 都是 0 行——不是日志没刷新，是压根没人打。

#### 六、★ 大屏怎么拿到数据：HTTP 轮询，不是 WebSocket

客户问「大屏和平台是 socket 协议吧？」。**不是。**

`packages/data-adapter/src/guard-provider.ts`：

```ts
subscribeTelemetry(deviceIds, callback) {
  const tick = async () => { /* 每台 getTelemetry() → REST */ };
  void tick();
  const timer = setInterval(() => void tick(), 3000);   // ← 3 秒轮询
  return () => { stopped = true; clearInterval(timer); };
}
```

每轮对每台设备发 `GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries?keys=...`。
全仓 `grep -i "websocket" packages/data-adapter/src` **零命中**。

**端到端实测**（2026-11-23）：

```
① 大屏打开，等首轮订阅完成 → 模块机 1# 显示 7.35 ℃
② 直接 POST {"temperature": 8.88} 到平台
③ 不刷新页面、不做任何操作
④ 数秒后大屏「机组状态」第一行变成 8.88 ℃
```

截图存 `_tmp-ngx-shots/`。测试点已删除，库中恢复为 11-21 的原始 7.35。

**两个必须知道的边界**：

| 事实 | 影响 |
| --- | --- |
| 首轮订阅要 25~50 秒（14 台 × 2 请求，10 并发） | 刚打开大屏时不可能立刻有数，别误判成"不刷新" |
| 只订阅**本场景拓扑内**的设备 | 改别的场站的设备，大屏不会变 |

第二条尤其容易踩：场景「天骄科技园」的数据源是
`{kind:"scope", scope:{kind:"topology", topologyId:"dfbc1da0…"}}`，
订阅范围 = 该拓扑下 14 台（9 台模块机 + 网关 + PLC 等）。

**不在范围内**的例子：设备运维默认页选的是「办公园区」，
那里的 `WaterMeter-SIM` 属于别的场站 —— 改它的用水量，天骄大屏不会有任何变化。

验收时要么把顶栏场站切到「生产园区」改模块机，
要么先在场景的数据源里把目标设备加进范围。

**要不要改成 WebSocket？**

TB 原生有 `/api/ws`（订阅命令 + 推送），换成它可以把延迟从 3 秒降到亚秒级。
但代价是：

- 要处理断线重连、订阅命令构造（`WsCommandsWrapper` 的 `entityFilter` 必须是合法 UUID，
  否则整批命令被丢弃 —— A2a「★ 看板 entityAlias 的 id 必须是合法 UUID」记过这个坑）；
- 现在的轮询已有 key 缓存、分批并发、单轮锁，稳定；
- 大屏是**监控**用途，3 秒延迟不影响判断。

结论：**暂不改**。真要亚秒级实时（比如联动控制反馈），再评估。

### 6.3 图表取舍

两块就够，每块回答一个问题：

- 左：**总功率 24h 趋势** —— 「今天负荷怎么样」
- 右：**9 台加载率对比** —— 「哪几台在出力、哪几台闲着」

用现有 `trend-chart` + `bar` 部件，不新增图表类型。

---

## 7. 分期

### P0 · 主数据 —— ✅ 已完成（2026-11-23）

1. ✅ `standardKeys` +10
2. ✅ `env.params` 扩到 12 项（code 4~7）、`deviceTypes` +2（`air_cooled_heat_pump` / `chilled_water_pump`）
3. ✅ 厂商「开利」+ 型号 `30RQ750VHS`（registers 10 项，`×10` 系数已写进 note）
4. ✅ **`diagnosis` 10 个 key** + **`faultCodes` 字典 118 条记录 / 151 个码**
   （开利 53 条覆盖 86 码 + 卡乐 65 条；剩余开利 VF/VW 变频器码待变频器手册）
5. ✅ 装库生效（`dictionaries.version` 13 → **14**）+ 新接口 `GET /api/energy/fault-codes`

**实测证据**：

```
GET /api/energy/core-dictionaries      → version=14, standardKeys=165, 含 diagnosis=10
GET /api/energy/fault-codes            → total=118
GET /api/energy/fault-codes?code=TH702 → 出水温度传感器失效 / 更换温度传感器、检查线路·主板
GET /api/energy/fault-codes?code=10044 → 室内温度过高（卡乐）
```

**★ 埋过的坑**：`installCoreDictionaries` 按 `dictionaries.version` 判断「已是最新」
就直接跳过 —— **改了内容不升 version，等于没改**。

**前端消费**（后端有数据没人用等于没做）：

| 能力 | 文件 | 作用 |
| --- | --- | --- |
| 故障码字典 | `packages/data-adapter/src/fault-codes.ts` | 拉字典 + 从告警文本抽码（认 `TH702`/`10036`，**不误吞 `30001` 寄存器地址**）|
| 工况联动判据 | `packages/data-adapter/src/metric-diagnosis.ts` | 同一个 25.3℃：制冷判高、制热判低 |
| 告警面板 | `apps/web/src/features/alarm/AlarmList.tsx` | 每条告警下显示「原因 + 处理」|
| 设备专题 | `apps/web/src/features/scene-widgets/WidgetCards.tsx` | 异常行标「偏高/偏低」+ 底部说明 |

测试：`fault-codes.test.ts` 18 例 + `metric-diagnosis.test.ts` 26 例。

验收：租户登录 → 品种指标页 → 环境系统下 12 个参数；设备建档下拉有「风冷热泵机组」「冷冻水泵」；
`water_out_temp` 等温度/压力类 key 能查到 `normalRange` + 对应 `faultCodes` + 解决方案。

> 第 4 项不要往后推。它是数据孪生、告警、AI 分析的**共同输入**，
> 现在不填，后面每个消费方都得各自重新翻 PDF 一次，且口径必然不一致。

### P1 · 设备建档 —— ✅ 存量环境已就绪（2026-11-23 实测核对）

1. ✅ 「热泵系统 1」资产 = `天骄冷热站·生产园区`（`type=场站分组`）
2. ✅ 网关 1 + 模块机 9 + 泵 2（+ PLC 控制柜 2，现场真实在用，见 §9-4）
3. ✅ measurePoints：网关 13 项 / 模块机 14 项 / 泵 5 项（均带 `source` 溯源）
4. ✅ GATEWAY 关系（网关 `childDevices` 11 台）、Contains、ModeledBy、客户归属
5. ✅ rpcMethods：网关含 `startAll` 等（`id`/`label`，部分带 `params`）
6. ⚠️ 幂等脚本：存量环境已建好；**新建客户仍需脚本**（未验证，属未完成项）

**实测证据**：

```
模块机1#  measurePoints 14 项 · 网关 13 项 + childDevices 11 台 · 泵 5 项
全部设备 deviceVirtual = "real"  → 没有一台虚拟设备 ✅
```

验收：设备列表 12 台（1 网关 + 9 机 + 2 泵）；网关有 4 条命令；9 台模块机都能读到测点表；**没有一台是虚拟设备**。

### P2 · 网关对接（现场，不在前端范围）

1. `dispatch_rpc` 新增写寄存器方法
2. 按协议上报系统级 + 外机级遥测
3. 回读确认与互锁

验收：写 40051 → 30002 变 0 → 大屏状态同步。

### P3 · 大屏（3–5 天，可与 P2 并行）

1. `campus-screen.json` 模板（9 台列表 + 铭牌 + 2 图表）
2. 场景实例（场景根 = 热泵系统 1 资产）
3. 3D 绑定：9 台风扇/指示灯、阀门、管路
4. 启停按钮（含置灰与确认）

---

## 8. 验收判据（浏览器实测）

1. 中间是**真实 GLB**（不是截图），9 台模块机和 2 台泵可点选
2. 点 1# → 右翼显示 1# 的进出水温、功率、加载率；点 2# → 数据换成 2#，**不是同一份**
3. 顶栏总功率来自网关设备的系统级点，与 9 台之和**不要求相等**，页面上不许暗示相等
4. 无数据时显示「未上报」，**不许显示 0 或 25.0℃**（GLB 占位值必须清掉或标演示）
5. 启停按钮：`rpcMethods` 未就绪时置灰 + 说明；就绪后点按有二次确认，成功后状态以回读为准
6. 管路流动随系统运行变化，阀门关闭时对应管线停流
7. 任意一台故障（`sys_fault_level>0`）→ 列表该项标红，**不掩盖**其它台
8. 网关设备在列表里明确标「网关」，不被误认为第 10 台机组
9. **点开任意一条故障 → 能看到官方依据的「故障分析 + 解决方案」**（4.6 的
   `faultCodes` 字典），不是只给一个裸代码
10. **出水温度超出当前工况范围 → 界面能说清为什么算异常**（制冷 5~20℃ /
    制热 30~60℃），且随 `sys_mode` 切换判据

第 3、4、8、9 条最容易糊过去，也最容易被当场抓到。

> 第 9、10 条是 4.6 的验收口。只看「有没有填字段」会漏 ——
> 必须看到**用户能读懂的排查指引**，且工况切换后判据跟着变。

---

## 9. 仍需现场确认（不阻塞 P0/P1，但阻塞 P2/P3）

1. **网关控制粒度**：9 台是只能整系统启停，还是能分别控制？决定 `setUnitPower` 是否上线（见 3.3）。
2. **泵的接入方式**：定频还是变频？有没有独立控制器能读到运行/故障？决定泵的测点表最终几项（见 4.3）。
3. **每台模块机的实际型号与 MODBUS 拨码地址**：手册是 30RQ750VHS 系列，现场 9 台不一定同一型号，建档前要现场核对。
4. **PLC 控制柜角色**：模型里 2 台 PLC 柜本轮不建档，需确认它们是否参与泵/机组控制（若参与，可能改变 3.3 的结论）。

---

## 10. 待优化 · 3D 周围部件：放大 + 不遮挡 + 更透明（2026-11-23 客户提出）

客户两次原话，是同一件事的三个面：

> **「现在 3D 周围的统计卡片太小了」**
>
> **「把 3D 周围的部件尽量大点，但是也并太遮挡 3D，而且部件的透明度也尽量调的透明一些」**

**★ 这三条有内在张力，必须一起设计，不能分开做**：

```
放大  ──→  信息看得清（好）  ──→  但遮住更多模型（坏）
透明  ──→  模型透出来（好）    ──→  但文字对比度下降（坏）
```

单独放大 = 挡住 3D；单独透明 = 数字看不清。**正解是「变宽 + 变透」同时做**：
卡片占更多横向面积（数字有地方排），但玻璃更透（背后的模型轮廓仍可见）。
只做一半必然翻车，所以合成一节。

### 实测数据（不是感觉，是量出来的）

| 位置 | 模板给的宽度 | 1920 屏实际像素 | 骨架定义 `WIDGET_STAGE_FRAME` |
| --- | --- | --- | --- |
| 左翼（系统功率 / 装机参数 / 机组状态） | **11.3%** | **≈ 217 px** | `leftCol.w = 20.4%` |
| 右翼（选中机组 / 运行汇总 / 系统控制） | **11.3%** | **≈ 217 px** | `rightCol.w = 20.4%` |
| 顶部标题 | 60% | 1152 px | `title.w = 56%` |
| 底部（趋势 / 负载对比） | 46.5% | 893 px | `bottomBase.w = 52.4%` |

**根因**：`screen-templates/tianjiao-heat-pump.json` 里左右翼 `w` 写 11.3%，
而布局骨架 `WIDGET_STAGE_FRAME` 定义 20.4% —— 模板比骨架窄了近一半。
两个数各说各话，谁也没校验谁。

### 为什么小卡片问题严重（不只是不好看）

1. **数字读不出**：217px 装「62.51万 kWh + 单位 + 标签 + 占比」，主数值被压到
   30px 以下，3 米外看不清 —— 大屏第一职责就是远程可读。
2. **信息被挤压折叠**：机组状态卡 9 台只能显示 5 行，其余折成「另有 4 项无数据」
   （其实是**显示不下**，不是无数据），误导运维。
3. **环形仪表放不下**：`gauge-ring` 在 217px 宽里环径不足 100px，刻度全糊在一起。

### ★ 遮挡的真正元凶是 `backdrop-filter`，不是背景透明度

实测当前 HUD 卡片的三层「遮挡源」：

| 层 | 当前值 | 对「能否看到模型」的影响 |
| --- | --- | --- |
| 背景渐变 alpha | `0.42` → `0.328`（渐变末端） | 中等：降低它能让颜色透过来 |
| **`backdrop-filter: blur(9px)`** | **9px** | **决定性**：9px 把背后的模型完全糊成色斑 |
| `saturate(135%)` | 135% | 次要：让背后颜色更艳，反而更抢眼 |

**关键结论**：只降背景 alpha 是无效的。alpha 从 0.42 降到 0.25，
卡片**看起来还是实心毛玻璃** —— blur(9px) 已经把模型细节抹掉，
透出来的是模糊色块而不是「模型轮廓」。客户说的「太遮挡」主要是这个。

**所以透明化必须动 blur**：

```
blur(9px) → blur(2px)     ← 主改动：模型轮廓可辨
saturate(135%) → 110%      ← 减弱背后颜色的抢夺
alpha 0.42 → 0.30          ← 配合微调，文字靠深色底 + 亮字保持可读
```

> 为什么 blur 不能直接去掉（0px）：完全透时，3D 场景的亮色地面/高光会直接透到
> 文字下面，数字读不清。2px 是「模型轮廓可辨 + 文字底噪可控」的平衡点。
> **这个值必须实测调**，不能拍 —— 大屏投影亮度、现场环境光都会影响可读性。

### 修改方向（三目标联合设计）

#### ① 放大：拓宽左右翼，但不侵占 3D 主体视野

| 项 | 现在 | 目标 | 依据 |
| --- | --- | --- | --- |
| 左/右翼卡片宽 | 11.3%（217px） | **17~18%**（326~346px） | 骨架写 20.4%，但直接到 20.4% 后中央只剩 59%，3D 被压窄 |
| 中央 3D 区 | 74.8% | ≥ 64% | 低于 60% 时 9 台机排一列看不全（实测约占 55% 宽度）|
| 主数值字号 | 30px | **38~42px** | 3 米外可读下限约 36px |

**为什么不是「尽量大」**：客户同时要求「别太遮挡 3D」。左右翼合计从 22.6% 提到
35% 已是 3D 视野极限 —— 再宽就与「别遮挡」直接冲突。冲突时以 3D 为准，
因为大屏的主体是孪生模型，卡片是注解。

#### ② 不遮挡：改 blur（决定性）+ 收内边距

见上一节。补充两条结构性的：

- **卡片内边距收窄**（`padding: 10px 12px` → `8px 10px`）：同尺寸下多出内容空间，
  等价于「不放大也更大」。
- **标题条高度 31px → 26px**：当前标题条占卡片高度 1/6，小卡上尤其浪费。

#### ③ 更透明：三层一起调，缺一层就白调

```
--widget-glass-alpha: 0.42 → 0.30
backdrop-filter: blur(9px) saturate(135%) → blur(2px) saturate(110%)
box-shadow: 去掉 inset 内发光
```

**内发光也要去**：`inset 0 0 20px rgba(42,130,211,0.07)` 在边缘形成一圈淡蓝雾，
视觉上增加「厚度」。大屏上「薄」比「厚」更高级，也更不遮挡。

#### ④ 模型层配合（可能比调 CSS 更有效）

卡片遮不遮挡，有一半取决于 3D 模型在画面里的位置和大小：

- **模型适当放大 / 居中偏移**：如果模型主要落在中央 64% 区域，
  左右翼再宽也不挡它。当前模型偏小（9 台机只占画面对角线一条）。
- **相机默认视角**：把默认机位调近一点，让模型先占满中央，
  卡片就自然成了「外围信息」，而不是压在模型上。

> 这条比调透明度收益更大，但属于 3D 侧的改动（`EngineManager` 的默认相机、
> GLB 初始缩放）。要和 ② 一起做才有意义 —— 只调 CSS 时模型太小，
> 透明了也还是「看着空」。

### 必须一起验证的三件事（缺一个就是翻车）

| 验证项 | 判据 | 为什么单独验 |
| --- | --- | --- |
| 文字可读 | 最暗的 3D 区域上，数值仍能辨认 | 透明化的直接代价 |
| 3D 可见 | 机组轮廓/管路在卡片背后**肉眼可辨** | 客户的核心诉求 |
| 9 台全显 | 机组状态卡不出现「另有 N 项」折叠 | 放大的目的 |

**这三条互相拉扯**，必须同时满足才算做完。只满足两条的方案都不接受。

### 验收判据

**放大**：
- 1920 屏下左翼卡片实测宽度 ≥ 326px（当前 217px）
- 主数值字号 ≥ 38px（当前约 30px）
- 机组状态卡 9 台全部一屏可见，**不出现**「另有 N 项无数据」折叠
- 中央 3D 区域宽度 ≥ 64%

**不遮挡**：
- 3D 机组轮廓/管路在卡片背后**肉眼可辨**（看出形状，不是一片色斑）
- `backdrop-filter` 实测 blur ≤ 2px

**更透明**：
- 卡片背景实测 alpha ≤ 0.30
- 最暗的 3D 区域上，卡片内数值仍清晰可读

**★ 最容易糊过去的一条**：「3D 可见」不能只看「卡片变透了」。
必须看**卡片覆盖的那块区域** —— 把截图裁到卡片矩形，里面要能看出模型形状。
实测做法：`Page.captureScreenshot` 的 `clip` 对准卡片矩形，放大后肉眼确认。

### 涉及的代码位置

| 改什么 | 文件 |
| --- | --- |
| 左右翼宽度 | `screen-templates/tianjiao-heat-pump.json` 的 `regions[].w/x` |
| 骨架定义 | `scene-widget-layout.ts` 的 `WIDGET_STAGE_FRAME` |
| 玻璃透明度 / blur | `WidgetOverlay.module.css` 的 `[data-ngx-hud] .card` |
| 主数值字号 | 同上 `.metricValue` |
| 内边距 / 标题条 | 同上 `.card` / `.cardTitle` |
| 默认相机 / 模型大小 | `apps/web/src/engine/core/EngineManager.ts` |

### 状态

**未做**。本轮已把需求与实测数据记录完整（含「blur 才是元凶」这个关键结论）。
建议与 §13 环形仪表的宽度需求一起改 —— 卡片变宽后仪表的环径才有意义。

---

## 11. 可视化基准分辨率：1920 × 1080（2026-11-23 客户定）

客户原话：**「分辨率默认 1920*1080 的可视化」**。

### 为什么必须把这条写死成基准

大屏所有尺寸都是**百分比**（`x/y/w/h` 都是 0~100），
而百分比在不同分辨率下换算出的像素**完全不同**。没有基准就会出现：

```
同一套布局
  · 1920 屏：卡片 317px，主数值 50px —— 合适
  · 3840 屏：卡片 634px，主数值 50px —— 数字像蚂蚁，卡片大片空白
  · 1366 屏：卡片 225px，主数值 50px —— 数字溢出
```

所以「卡片够不够大」「字号够不够看」这些判断，**离开基准分辨率就没有意义**。
以前靠 `clamp()` 硬扛，但那只能保证不溢出，保证不了「比例好看」。

### 硬规则

1. **验收一律在 1920×1080 下做**。说「卡片 317px」就是这个分辨率下的实测值，
   换分辨率要重新换算，不能直接引用。
2. **设计稿按 1920 出**。客户给的参考效果图、我们自己画的布局，都以 1920 为准。
3. **`clamp()` 的最小值按 1920 定**。最小值是「1920 下刚好不挤」，
   最大值是「2K/4K 下不至于太大」。当前主数值 `clamp(34px, 3.4vw, 50px)`
   → 1920 下 = 34px（3.4vw = 65px，被 50px 上限截住，实际取 50px）。

   > ⚠ 这里有个坑：`3.4vw` 在 1920 下是 65px，**超过上限 50px**，
   > 所以 1920 实际生效的是 50px，`34px` 这个下限永远轮不到。
   > 下限只在 1000px 以下的窄屏（如编辑器侧栏）才起作用。

4. **新增大屏不接非标分辨率需求**。客户如果要用 2K/4K 屏，
   走「同一套百分比 + clamp 上限」，不另做一套布局。

### 当前实测（1920×1080）

| 项 | 值 |
| --- | --- |
| 左/右翼卡片宽 | 317px（16.5%）|
| 主数值字号 | 50px（clamp 上限截住）|
| 标题条高 | 26px |
| 中央 3D 区 | 62%（1190px）|
| 卡片背景 alpha | 0.30 |
| `backdrop-filter` | `blur(2px) saturate(110%)` |

### 与 §10 的关系

§10 里「卡片 ≥326px」「主数值 ≥38px」这些判据，**默认都在 1920 下量**。
本节的基准是那些判据的前提 —— 不写清基准，判据就是浮动的。

> 顺带修正 §10 一处：按「中央 ≥62%」的约束，卡片实际只能到 16.5%（317px），
> 达不到原文写的 326px。取舍理由：317px 已比原来的 217px 提升 **46%**，
> 9 台机组全部一屏可见；再宽就要把中央压到 60% 以下，直接违反「别太遮挡 3D」。
> **两条要求冲突时，以「不遮挡 3D」为准** —— 大屏主体是孪生模型，卡片是注解。

---

## 12. 默认视角放大 + 点击设备进入「专题模式」（2026-11-23 客户提出）

客户原话：

> **「3D 的刚进入默认视角大一点」**
>
> **「点击里面的设备，要把周围的统计部件缩回去，然后把设备维度相关的统计部件和操作部件抽屉出来的效果」**

### 12.1 第一条：默认视角放大

现状：`DEFAULT_ENGINE_CONFIG.fitDistanceFactor = 1.55`（已从 1.85 收过一次）。
实测 1920 屏上 9 台机组仍只占视野宽度约 1/3，两侧大片空白。

| 项 | 现在 | 目标 | 风险 |
| --- | --- | --- | --- |
| `fitDistanceFactor` | 1.55 | **1.25~1.35** | 太近会裁掉首尾两端（设备是细长一排）|
| `fov` | 32 | 保持 | 改 fov 会改变透视感，视觉上「变形」比「变小」更难接受 |

**判据**：进入大屏时 9 台机组的整体宽度占视野 **≥ 45%**，且首尾两台完整可见。

> 这条与 §10「别太遮挡 3D」是同一诉求的两面：模型越大，卡片相对占比越小，
> 「被卡片压住」的感觉就越弱。所以放大模型比单纯调 CSS 更能解决遮挡感。

### 12.2 第二条：点击设备 → 专题模式

**现状（已实现一半）**：点设备后 `selection-card` 高亮（`cardSpotlight`），
其余统计卡淡出（`cardReceded`）。但只是**变暗**，位置不动 —— 空间没让出来。

**客户要的是**：
```
点击设备前：左翼 3 块 + 右翼 3 块 + 底部 2 块，围成一圈
点击设备后：外围统计「缩回去」（收起/滑出视野）
            设备专题「抽屉出来」（从侧边滑入，占据腾出的空间）
```

**三个必须定清的设计点**（否则做出来是另一个 bug）：

| 问题 | 决策 | 理由 |
| --- | --- | --- |
| 「缩回去」是收起还是变暗？ | **向左/右滑出视野 + 淡出** | 只变暗等于「还占着位置」，3D 仍被压住。滑出才真正腾出空间 |
| 抽屉从哪边出来？ | **右侧**（与 `selection-card` 现有位置一致） | 用户注意力在点中的设备上，右侧滑入最自然；左侧留给「返回全景」 |
| 抽屉里放什么？ | **设备参数 + 24h 趋势 + 该设备的控制命令** | 这三样是「设备维度」的全部信息，缺一样就得切回全景 |

**抽屉内容必须来自数据，不能写死**：

- 参数：`binding.telemetryMappings`（该设备绑了什么就显示什么）
- 趋势：`useDeviceHistory`（已有）
- 操作：该设备 `rpcMethods`（`ControlBarCardBody` 已有能力，复用即可）

**退出方式**：抽屉顶部给明确的「×」+ 点空白 3D 区域也退出。
两种都要有 —— 有人习惯找按钮，有人习惯点空白。

### 12.3 与 §10 的关系

§10 是「静态布局」的优化（卡片多大、多透），§12 是「交互态」的优化。
两者叠加才是完整答案：

```
静态：卡片够大、够透、模型够大  →  平时围着看不挡事
交互：点设备后外围让位           →  需要细看时空间全给设备
```

### 12.4 验收判据

**默认视角**：
- 进入大屏（未点击任何对象）时，9 台机组整体宽度占视野 ≥ 45%
- 首尾两台（1# / 9#）完整可见，不被裁切

**专题模式**：
- 点击任意设备 → 外围统计卡**滑出视野**（不是只变暗）
- 同时右侧抽屉滑入，内容包含：该设备的参数、趋势、可用命令
- 点「×」或点空白 3D 区域 → 恢复全景，外围卡片滑回原位
- **抽屉里显示的是被点中的那台**（点 2# 再点 3#，数据必须换，不能是同一份）

### 状态

**部分落地（2026-11-23）**。交互层（外围滑出 + 抽屉滑入 + 「×」退出）代码已在，
但客户同日要求删掉「选中机组」卡，专题模式因此**失去载体**：
`deviceFocused` 已加上「布局存在 selection-card」前提，当前母屏不触发。
要重新启用，把这张卡加回右侧即可（其余逻辑不用改）。详见 §13。

---

## 13. 右翼改版：删「选中机组 / 系统控制」，底部两块上移（2026-11-23 客户要求）

客户原话：

> **「把选中机组和系统控制去掉，把下面的那两个移到右侧」**

### 13.1 改成了什么

```
改前（9 块）                        改后（7 块）
左翼  系统功率 / 装机参数 / 机组状态   左翼  系统功率 / 装机参数 / 机组状态   （不变）
右翼  选中机组 / 运行汇总 / 系统控制   右翼  运行汇总 / 功率趋势 / 功率对比
底部  功率趋势 / 功率对比              底部  （空）
```

右翼三块纵向等分：`y` 依次 13.43 / 36.47 / 59.51，各 `h = 22.21%`，
与左翼上下边界对齐（13.43 → 81.72）。底部清空后 3D 主视觉完整。

### 13.2 连带修的一个缺陷：没有「选中机组」卡时，点设备会把屏幕清空

`deviceFocused` 原本只判「运行态 + 有选中对象」。专题模式是**成对动作**：
外围卡滑出 + 抽屉补位。删掉 selection-card 后只剩前半截 ——
点一台设备，右翼全部飞走，屏幕上没有新信息、也没有返回提示。

修法：`deviceFocused` 增加前提「布局里存在 selection-card」。
将来谁把这张卡加回来，专题模式自动恢复，不用改两处。

> 这不是需求变更，是删卡的必然后果。只删卡不改判据的话，
> 交付出去就是一个「点一下屏幕就空」的版本。

### 13.3 真相源：模板 JSON 与平台布局必须一起改

| 位置 | 作用 | 不同步的后果 |
| --- | --- | --- |
| `packages/data-adapter/src/screen-templates/tianjiao-heat-pump.json`（v18 → v19）| 新建场景 / 应用对接结果的初始布局 | 新客户拿到 9 块旧版 |
| 平台 `GET /api/energy/topologies/{id}/scene-widgets` | **当前运行的大屏** | 界面不变 |

脚本（幂等、带备份与回读校验）：

```bash
node scripts/apply-heat-pump-layout.mjs --check   # 只看差异
node scripts/apply-heat-pump-layout.mjs --apply   # 写库
```

它只改 `x/y/w/h` 与增删部件，**标题、绑定槽位、数据源一律原样保留**。

### 13.4 验收

```bash
node scripts/verify-device-focus.mjs
```

布局里没有 selection-card 时，脚本会明说「专题模式不适用 —— 跳过」，
并验证一条替代判据：**点设备后外围统计卡不能被赶走**（`left > -10` 且宽度正常）。

模板侧由 `packages/data-adapter/src/tianjiao-template.test.ts` 锁定：
7 块、无 selection-card / control-bar、底部为空、右翼三块同宽同高不重叠。

### 13.5 一个必须说清的取舍

「选中机组」原本是**点设备看详情**的唯一入口（参数 / 24h 趋势 / 命令）。
删掉之后，点击 3D 设备仍会高亮对象，但**看不到那台机的实时参数与趋势**，
启停也失去入口（系统控制卡同时被删）。

客户明确要求删这两块，本轮回按此执行；如果后续需要「点设备看详情」，
正确做法是加回一张卡（或改用悬浮抽屉），而不是恢复旧布局 ——
旧布局的问题是底部两块占掉 3D 视野，这一点不要退回去。

---

## 14. 第二轮右翼改版 + 部件内部扩充（2026-11-23 客户要求）

客户原话：

> **「把右侧第2个场站用电趋势内部去掉左侧的数字，然后把它挪到左侧第二的位置，
> 把右侧第3个部件挪到左侧第3个位置，然后，把之前的左侧第2和第3挪到右侧，
> 最后，深挖我给你的参照图片里面原型，扩充各个部件里面的元素，然后让各个部件再大一点。」**

### 14.1 布局：左右换了位置

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 左 1 | 场站用电量 | 场站用电量（不变） |
| 左 2 | 碳排放核算 | **场站用电趋势**（原右 2） |
| 左 3 | 机组状态 | **设备用电排名**（原右 3） |
| 右 1 | 运行汇总 | 运行汇总（不变） |
| 右 2 | 场站用电趋势 | **碳排放核算**（原左 2） |
| 右 3 | 设备用电排名 | **机组状态**（原左 3） |

效果上等价于「整列交换」，但客户是逐块点名的，所以按块执行、按块验证。

### 14.2 尺寸：底部清空的空间全给卡片

上一轮把底部两块上移后，**底部整条 153px 空出来了**。这部分是白送的 ——
加高不侵占 3D 宽度，加宽会。

| 项 | 上轮 | 本轮 | 说明 |
| --- | --- | --- | --- |
| 侧栏宽 | 16.5%（317px）| **17.0%（326px）** | 只加 9px，中央仍有 61.2% |
| 卡片高 | 22.21%（240px）| **24%（259px）/ 30%（324px）** | 第三行更高，装 9 台列表 |
| 中央 3D | 62.0% | 61.2% | 守住 ≥60% 底线 |

第三行必须更高：9 行设备 × 约 30px ≈ 270px，24% 装不下会折成「另有 N 项」。

### 14.3 趋势卡：去掉左侧大数字

那张卡内部的「62.51万 kW·h + 电能用量」占着左边一列，图表只剩 167/295。
而且它与**同一列上一张卡**（场站用电量）显示的是同一个总量 —— 一屏两遍。

去掉后图表横跨整卡（实测 304/304 = 100%）。总量没丢：上一张卡就是它。

> **连带修复**：`.trendRow` 是**遥测趋势卡与能耗趋势卡共用的类**。
> 直接把它改成网格会连累遥测卡（它的 `.trendKpi` 没有 `grid-area`，
> 两个子元素会挤到一行）。所以拆成 `.trendRow`（flex，遥测）
> + `.energyTrendRow`（网格，能耗）两个类。

### 14.4 ★ 一个会让整页崩掉的坑：hook 不能放在早退之后

扩充卡片内容时，把两个 `useMemo` 写在了 `if (!view.hasData) return ...` **之后**：

```
首屏还没取到场站数据 → 走早退，只调 1 个 useMemo
数据到达              → 多调 2 个 useMemo
→ React: Rendered more hooks than during the previous render
→ 整个路由被错误边界接住，变成「页面出了点问题」卡片
```

**为什么难查**：首屏是**空白而不是报错**，要等数据回来才崩；
截图看像「加载失败」，很容易误判成后端问题或缓存问题。

判据：`probe-console-errors.mjs` 里能看到
`React has detected a change in the order of Hooks called by EnergyMetricBody`。

> 这个坑在项目里已经不是第一次（见 §6.2v 的 `useTelemetryFeed` 时序问题）。
> 规则：**组件里所有 hook 必须在任何 `return` 之前**，无条件、按固定顺序调用。

### 14.5 对照原型扩充的内部元素

参照 `template01/index.html`（292px 侧栏、信息密度远高于我们）补了两块：

| 部件 | 新增元素 | 数据来源 |
| --- | --- | --- |
| 场站用电量 | **分品种明细**：每个品种一行（名称 / 占比条 / 用量+单位），当前品种高亮 | `stats.kinds[]`（平台已返回） |
| 碳排放核算 | **三格指标**：折标煤 / 排放强度 / 计量品种 | `kpi.tce`、`kpi.co2 ÷ electricityKwh`、`kinds.length` |

两条硬约束：

- **只用平台已返回的字段**，不推导、不造数。排放强度拿不到电量时
  **不显示那一格**（`auto-fit` 自动收成两列），不写 0。
- 只有**一个**用能品种时不展开分品种明细 —— 单品种占比恒为 100%，
  列一行没有信息量。

### 14.6 验收

```bash
node scripts/verify-device-focus.mjs --shot /tmp/shot.png
```

覆盖：左右各三块、**按部件 id 验左右归属**、侧栏宽 ≥320px、
底部无宽卡、9 台全显无折叠、趋势图占满卡片、趋势卡无左侧大数字、标题条不重叠。

配套工具：
- `scripts/apply-heat-pump-layout.mjs`（幂等改布局，带备份 + 回读校验）
- `scripts/probe-widget-layout.mjs`（打印卡内每个元素的盒模型，定位挤压）
- `scripts/probe-console-errors.mjs`（抓运行时异常 + 控制台 error）

### 14.7 实测（1920×1080）

| 部件 | 位置 | 尺寸 |
| --- | --- | --- |
| 场站用电量 | x=46 y=187 | 326×248 |
| 场站用电趋势 | x=46 y=444 | 326×248 |
| 设备用电排名 | x=46 y=701 | 326×310 |
| 运行汇总 | x=1548 y=187 | 326×248 |
| 碳排放核算 | x=1548 y=444 | 326×248 |
| 机组状态 | x=1548 y=701 | 326×310 |

趋势图 304/304（占满），9 台全部可见，无「另有 N 项」折叠。

---

## 15. 告警跑马灯 + 设备状态可视化（2026-11-23 客户要求）

客户四句话，合成一轮：

> **「我需要在3D周围加一个告警列表跑马灯效果，还有设备中有一个是故障的红色的GLB应该有不同颜色的设备状态，
> 给我在平台端模拟2个不同状态的设备，同时把我之前说的设备手册的原型写在告警中，并且，设备的铭牌上也要提示」**
>
> **「右侧第一个换成告警的跑马灯，然后把它移动到右侧第3个位置」**
>
> **「告警右上角有个等级筛选，把最严重的常驻，然后其他的跑马灯」**
>
> **「点击3d中的每个设备的时候，下面抽屉出来的统计维度可视化要改成和业务场景匹配的，现在这个肯定不合理」**

### 15.1 布局：右翼三块重排

| 位置 | 改前 | 改后 |
| --- | --- | --- |
| 右 1 | 碳排放核算 | 碳排放核算（h 24 → 20）|
| 右 2 | 机组状态 | 机组状态（h 30 → 28）|
| 右 3 | 告警跑马灯（新增）| **告警跑马灯**（h 18.5）|

「运行汇总」被替换掉（客户说「右侧第一个换成告警跑马灯」）。
机组状态卡里已经逐台列了运行/离线/故障，汇总的四格是同一份信息的二次汇总。

### 15.2 告警跑马灯：三段结构

```
┌─ 全部 8 | 告警 2 | 预警 6 ──────────┐  ← 右上角等级筛选（带计数）
├─ [告警] 模块机 3# CM071  26 分钟前  ┤  ← 常驻：最严重的那条，不滚动
│  主机与1#变频水泵通讯故障           │
│  原因：…  处理：…                   │  ← 手册原文（字典查得）
├─ [告警] 模块机 2# TH702 …  ┐        │
│  …                          │ 滚动  │  ← 其余条目向下循环
└──────────────────────────────┴──────┘
```

**为什么最严重的那条必须常驻**：跑马灯在动，最要紧的那条会滚出视野。
值班员多数时间只是扫一眼屏幕 —— 那条必须一直在。

**筛选为什么带计数**：只剩「告警」时用户要知道有没有被筛掉的预警。
不带计数会以为告警自己消失了。

### 15.3 ★ 四个会让功能静默失效的坑（都实测踩过）

| # | 坑 | 表现 | 判据 |
| --- | --- | --- | --- |
| 1 | `EntityType` 是 **0 起索引**，DEVICE = **5** 不是 6 | 告警插进去了、API 也返回，但 `originatorName` 全是 `Deleted` | `GET /api/alarms` 返回的 `originator.entityType` 必须是 `DEVICE` |
| 2 | 插 `alarm` 表漏写 `propagate_to_owner_hierarchy` | 该字段是 `Boolean`（非原始），NULL → 反序列化 NPE → **整个 `/api/alarms` 返 500** | 告警面板整个打不开，而不是少几条 |
| 3 | 模板字符串里写反引号做行内代码 | `SyntaxError: Unexpected identifier` | 模板字符串内的注释不能用反引号 |
| 4 | 设备遥测写入是**最终一致**的 | 写完立刻读还是旧值/旧 ts，几秒后才生效 | 写入后等 2–3 秒再回读 |

### 15.4 3D 染色：旧实现根本没在判故障

```ts
// 改前
if (!binding?.statusMapping) return "normal";   // ← 没配映射就一律染绿
```

2# 机组 `sys_run_state = 8`（故障）、告警挂着 TH702，**3D 里和旁边正常机一模一样**。
因为那台没配 `statusMapping`。

改成三级回退（`utils/status.ts`）：

1. 配了 `statusMapping` → 按规则阈值判（原行为不变）
2. 没配但报了 `sys_run_state` → 按手册枚举判（1=停机 5=运行 8=故障）
3. 都没有 → `normal`（保守，不制造假告警）

同时染色强度也改了：`emissive` 0.4 → 0.7，**并新增 `diffuse` 混色 45%**。
只调 emissive 对浅色/金属材质几乎无效（GLB 里 emissive 常为黑），
这是「看不到红色」的直接原因。恢复时按材质存档精确写回。

### 15.5 铭牌：从两态到四态

`DevicePlate` 新增 `status: running | stopped | fault | offline | unknown` 与 `faultCode`。

| 旧 | 新 |
| --- | --- |
| `running: boolean` → 运行/停止 | 运行 / 停止 / **故障 TH702** / 离线 |

**关键**：故障停机与正常停机在旧模型里都是 `running=false`，现场分不出来。

### 15.6 底部抽屉：从「全场统计」改成「这台设备」

| 旧四格（全场） | 新四格（选中设备）|
| --- | --- |
| 运行设备 5 | 运行状态（含故障码）|
| 设备总数 9 | 该设备的遥测（温度 / 功率 / 开度…）|
| 系统告警 3 | 该设备的遥测（继续）|
| 总消耗量 10.6 kW | **功率排名 第 3 / 9** |

还修了一个概念错误：旧卡把各设备的 `power`（瞬时 kW）相加却叫「总消耗量」。
功率相加不等于用电量，差一个时间积分 —— 现场拿它对电表必然对不上。

`chips` 也从「全场」改成只统计选中设备。

### 15.7 平台模拟（客户要求）

两个脚本，都幂等、可撤销、明确标注是演示数据：

```bash
# 2 台不同状态：1# 运行（5）/ 2# 故障（8）
node scripts/simulate-device-states.mjs            # 写入
node scripts/simulate-device-states.mjs --purge    # 撤销

# 3 条告警：CRITICAL TH702 / MAJOR CM071 / MINOR 上报中断
node scripts/simulate-alarms.mjs
node scripts/simulate-alarms.mjs --purge
```

**★ 设备遥测要写两套键名**，否则列表三列全是「未知」：

| 层 | 键 | 谁读 |
| --- | --- | --- |
| 平台列表配置 | `temperature` / `power` / `opening` / `running` | `unit-list` 的 slots |
| 手册协议 | `sys_run_state` | 3D 染色、铭牌四态、告警判据 |

### 15.8 验收

```bash
cd apps/web && tsc -b && vitest run          # 719 测试
node scripts/verify-device-focus.mjs          # 浏览器实测
```

实测结果（1920×1080）：

```
右翼 3 块：plant-capacity / unit-list / alarm-ticker
告警跑马灯 11 条目、常驻=alarm 级、3 个筛选（全部8/告警2/预警6）
条目内含手册「原因」「处理」
左 1 峰谷 / 左 3 排名，形态不重复
机组列表 9 台全显，1# 21.4kW 7.2℃ / 2# 0kW 18.6℃
```

**未自动验证（需人工看一眼）**：

- 3D 里 2# 是否真的显示为红色 —— `Page.captureScreenshot` 在本机 headless +
  SwiftShader 下会随机挂住（多次实测超时 60–120 秒），已改为不阻断脚本。
  染色判据 `evalStatus` 与颜色差异已由 `status.test.ts` 锁住（10 条），
  但「肉眼是否够红」必须人看。
- 铭牌徽标与底部抽屉的实际观感 —— 铭牌默认隐藏（指向/选中才出现），
  headless 下 `Input.dispatchMouseEvent` 会挂住，无法稳定触发。
  两者逻辑均已单测覆盖。

---

## 16. 告警详情弹层 + 部件放大（2026-11-23 第三轮）

客户原话：

> **「告警里面的每一条太复杂了，点击告警在出现类似TB的告警详情弹出层，还可以分配处理人，
> 把告警的高度尽量高一些，我发现可视化的大屏的周围的部件的宽高再正价30px都可以，
> 然后里面的内容也自适应放大，特别一些条形图和进度条图，比如设备用电排名和机组状态是特殊的小，
> 应该大点，数据多的话可以用纵向滚动条，再优化一下，看看能不能在从原型图片中挖掘一些好看样式了」**

### 16.1 尺寸：宽 +31px，告警卡 +150px

| 卡 | 改前 | 改后 | 说明 |
| --- | --- | --- | --- |
| 侧栏宽 | 326px (17%) | **357px (18.6%)** | +31px |
| 设备用电排名 | 310px | **352px** | +42px |
| 机组状态 | 289px | **313px** | +24px |
| 告警跑马灯 | 191px | **341px** | **+150px**（客户要求「尽量高」）|
| 碳排放核算 | 206px | 194px | 让位（只 3 个大数字）|
| 中央 3D | 61.2% | **58%** | 仍过半边 |

两边底部对齐在 93%，视觉上不会一高一低。

### 16.2 列表给摘要，详情给全文

上一版把手册的「原因 / 处理」铺在每条告警上，一条 5~6 行 ——
341px 高的卡片只装得下两条，其余全被截。现在：

| 列表（一条 33px） | 弹层（点开）|
| --- | --- |
| 等级徽标 + 设备名 + 故障码 + 时间 | 属性表：设备/严重程度/状态/发生时间/故障码 |
| 一句描述（单行截断） | 手册块：描述 + 原因 + 处理 + 出处 |
| — | 指派处理人（下拉 + 指派）|
| — | 操作：确认告警 / 清除告警 |

弹层用 `createPortal` 挂到 `document.body` —— **卡片有 `clip-path` 切角与
`overflow: hidden`，弹层放在卡片里会被裁掉且不报错**，只是看起来「没弹出来」。

### 16.3 ★ 处理人列表拿不全，但必须说出来

实测：`TENANT_ADMIN` 调 `GET /api/tenant/{id}/users` 返回 **403**
（该部署的 RBAC 只允许系统管理员列租户用户）。而
`POST /api/alarm/{id}/assign/{userId}` 是**可用**的（200 + 回读生效）。

所以 `listAlarmAssignees()` 返回 `{ users, restricted, note }` 而不是裸数组：

```
restricted: true
note: 平台未开放人员列表（TENANT_ADMIN 列租户用户返回 403），当前仅可分配给自己。
```

界面把这句**直接显示在下拉下方**。只返回一个选项而不解释，
值班员会以为「系统里只有我一个人」。

> 要拿到完整人员下拉，需要在 energy 后端加一个只读接口
> （`GET /api/energy/assignees`，用租户管理员权限直查 `tb_user` + 租户归属）。
> 那是 Java 改动 + 重编 jar + 重启容器，本轮未做。

### 16.4 ★ 两个 CSS 坑：条高改了不生效

**坑一：同一个类被写了两遍，后面的覆盖前面**

`.barTrack` / `.barFill` 在样式表里各出现两次。第一份改成 10px 后，
后文那份（给 `.deviceBars` 写的，但**选择器没加作用域**）仍把高度覆盖回 4px。
表现：代码里明明写了 10px，量出来还是 4px。

**坑二：`span` 是 inline，`height` 直接被忽略**

进度条是 `<span class="barTrack">`。inline 元素的 `height` 无效 ——
必须 `display: block`。只改 height 不改 display，条高永远是 0。

实测判据：`getBoundingClientRect().height`。改前 4px，改后 10px。

### 16.5 从原型挖的样式

`template01/index.html` 里能直接用、之前没实现的：

- **进度条发光**：`.bar i` 的 `box-shadow: 0 0 7px #4ccaff77` —— 深色玻璃上
  没发光的彩条会「陷进背景」
- **轨道凹槽**：`rgba(23,52,81,.85)` —— 透明轨道在 3D 亮背景上会消失，
  看不出「占了多少比例」
- **前三名配色**（原型没有，但同一套语言）：金/银/铜渐变 + 名称提亮，
  一屏 9 行只有前 3 行抢眼
- **滚动条收窄**：4px、强调色，`scrollbar-width: thin` + `::-webkit-scrollbar`
  两个都写才在 Chromium/Firefox 都生效

### 16.6 实测数据（1920×1080）

```
侧栏卡片最窄 357px
排名行：字号 12px / 行高 24px / 条高 10px / 名称列 127px / 全部 4 行（真实计量设备数）
      第 1 名 fill 实测 linear-gradient(90deg, rgb(184,121,31), rgb(230,162,60), rgb(255,213,128))
机组状态：字号 12.5px / 行高 28px / 9 行 / 内容 259px 不溢出（数据再多自动出滚动条）
告警条目 33px × 11 条，常驻 alarm 级，筛选 全部8/告警2/预警6
弹层：属性区 ✓ 手册块 ✓ 含原因/处理 ✓ 指派下拉 ✓（候选 1 个，受限已提示）✓ 确认/清除 ✓
```

### 16.7 未验证部分

- **弹层截图**：`Page.captureScreenshot` 在本机 headless + SwiftShader 下反复超时
  （本轮又试了 3 次，90–120 秒仍超时）。弹层的存在与内容全部由 DOM 判据覆盖，
  但「好不好看」需要人打开浏览器看一眼。
- **3D 点击**：`Input.dispatchMouseEvent` 同样会挂住。验收脚本已改为
  `element.click()`（DOM 点击走同一套 React 事件），并把它降级为
  「辅助判据」—— 失败只提示，不阻断其他 30 余条判据。

---

## 17. 「3D 里只有一个绿的」——染色判据缺一级回退（2026-11-23 客户报障）

客户原话：

> **「看一下3d的机组中设备为什么绿色就一个，实际运行的不只是1个啊？我怀疑你的数据是从平台获取的接口数据渲染的么？」**

### 17.1 先说数据来源：是平台接口，有证据

平台库实测（`GET /api/plugins/telemetry/DEVICE/{id}/values/timeseries`）：

| 机组 | running | sys_run_state | 功率 / 温度 | 数据滞后 |
| --- | --- | --- | --- | --- |
| 1# | true | **5** | 21.4 kW / 7.2℃ | 1.0 h |
| 2# | false | **8** | 0 kW / 18.6℃ | 1.0 h |
| 3# | true | — | 20.9 kW / 7.65℃ | 66.7 h |
| 4# | false | — | 21.7 kW / 7.8℃ | 66.7 h |
| 5# | true | — | 22.5 kW / 7.95℃ | 66.7 h |
| 6# | false | — | 23.3 kW / 8.1℃ | 66.7 h |
| 7# | true | — | 24.1 kW / 8.25℃ | 66.7 h |
| 8# | false | — | 24.9 kW / 8.4℃ | 66.7 h |
| 9# | true | — | 25.7 kW / 8.55℃ | 66.7 h |

**5 台在运行**（1/3/5/7/9），4 台未运行，其中 2# 是故障。客户说的「不只 1 个」是对的。

页面 DOM 实测（机组列表圆点颜色）也印证了同一份数据：

```
1# 绿 rgb(25,179,125)   2# 红 rgb(229,72,77)   3# 绿
4# 橙 rgb(232,147,12)   5# 绿                    6# 橙
7# 绿                   8# 橙                    9# 绿
```

**列表和 3D 读的是同一份 `telemetryRuntime.latest`**，数据确实来自平台接口，
没有本地造数（1#/2# 的数值是 §15.7 那个可撤销脚本写进平台的，3#~9# 是平台历史值）。

### 17.2 根因：两条判定链，只有一条会回退

| 用途 | 函数 | `statusMapping` 键无值时 |
| --- | --- | --- |
| 列表卡 / 排名 | `classifyBindingStatus` | ✅ 继续读 `running` |
| **3D 染色** | `evalStatus` | ❌ `return "offline"` |

13 条绑定的 `statusMapping.telemetryKey` 全都写的是 `sys_run_state`
（手册 30001 枚举），而库里**只有 1#/2# 有该键**。于是：

```
1# sys_run_state=5 → normal → 绿     ← 客户看到的「唯一的绿」
2# sys_run_state=8 → alarm  → 红
3#~9# 无该键       → offline → 灰     ← 4 台在跑的机组被染成"离线"
```

这就是「只有一个绿」的全部原因。

### 17.3 修法

`evalStatus` 补一级回退，复用已有的 `bindingRunningState`
（它本身就实现了「sys_run_state 优先，否则找 running，且 1/8 是非零不能当 true」）：

```ts
if (binding.statusMapping) {
  const row = latest.get(`${deviceId}:${statusMapping.telemetryKey}`);
  if (row) { /* 按规则判，原行为不变 */ }
  const running = bindingRunningState(binding, latest);   // ← 新增
  if (running === true) return "normal";
  if (running === false) return "offline";
  return "offline";   // 真没上报任何状态
}
```

判据顺序保持不变：**枚举优先于布尔**。两者同时存在且矛盾时（`running=true` 但
`sys_run_state=8`）必须以枚举为准 —— 否则故障机会在 3D 里看着像在正常运行。

回归测试 `status.test.ts` 新增 4 条，锁住：

- 有 `running=true`、无 `sys_run_state` → `normal`（**本次缺陷**）
- 有 `running=false`、无 `sys_run_state` → `offline`
- 两者都有且矛盾 → 以 `sys_run_state` 为准 → `alarm`
- 两者都没有 → `offline`

### 17.4 一个必须说清的遗留风险

3#~9# 的 `running=true` 是 **66.7 小时前**的数据。修复后 3D 会显示为绿色「运行中」，
而实际上这些数据已经停了两天多 —— 与 §6.2o 记录的「数据滞后 51 小时却显示得像实时」
是同一个安全风险。

当前 3D 染色**不看数据新鲜度**（只看有没有值）。列表卡标题上有「延迟 2 天」标记，
能提示，但机组本身仍是绿色。

如果要彻底解决，应加一条：超过阈值（如 30 分钟）未更新的数据不参与染色判定，
染成 `offline` 或单独的「未知/陈旧」色。**这需要客户确认阈值与配色**，
本轮未擅自改 —— 因为把一批「有历史数据的设备」直接染灰，会让现场以为设备停了，
而实际只是网关没上报。

---

## 18. 场站用电量：四区间汇总替换峰谷（2026-11-23 客户要求）

客户原话：

> **「场站用电量中增加今日用电、本周、本月、本年的用电汇总数字卡，峰值和谷值先去掉」**

### 18.1 布局

左 1「场站用电量」的下半区，原来两行「峰值 / 谷值」换成 2×2 四格：

```
⌜ 场站用电量  62.51万 kW·h
   场站用电量   占比 99.08%
   ─────────────────────────
   今日  —        本周  —
   本月  62.51万kW·h   本年  62.51万kW·h
```

**为什么 2×2 不是一行四格**：正文可用宽约 335px，四格并排每格只剩 ~80px，
`625135.88` 这类数字必然折行或被截。2×2 每格 ~165px 够用。

### 18.2 ★ 「0」与「没有数据」必须分开

实测这个场站最近两天没有上报。于是「今日」「本周」窗口内**一个数据桶都没有**。

如果显示 `0 kW·h`，值班员会以为「今天到现在一度电都没用」——
而实际是网关没上报。所以 `usage` 类型是 `number | null`：

- `null` → 界面显示「—」+ 灰色 + 悬停说明「窗口内没有任何用电数据」
- `0` → 真实读数为零

判据用 `series` 长度而不是 `byKind`：`byKind` 即使没数据也可能返回一行
（`usage: 0`），而 `series` 为空才代表该窗口**一个桶都没有**。

### 18.3 四个窗口必须嵌套

```
今日 ⊆ 本周 ⊆ 本月 ⊆ 本年
```

四个区间的 `to` **统一都是明天 0 点**（不是「现在」，也不是「下周一」）：

- 取「现在」→ 今天这个桶被截断在查询时刻，同一份数据隔几分钟再查又变一次，
  数字会自己跳（与 `windowFor` 里记录过的坑同源）；
- 本周取「下周一」→ 周三查时 `本周.to`(11-30) 会**超过** `本月.to`(11-26)，
  区间不再嵌套，会出现「本周 100、本月 80」这种自相矛盾的组合。

单测 `useEnergyRollup.test.ts` 9 条，含「周日属于本周」（`getDay()` 周日返 0
的经典坑）与「区间嵌套」断言。

### 18.4 四次请求，不是 N+1

平台现有接口一次只能算一个窗口。并发发 4 次：

- 固定 4 个请求（设备涨到 100 台还是 4 个），不是按设备数的 N+1；
- 按「场站 + 分钟」做进程内缓存，同一分钟内重复渲染不重复打平台；
- 60 秒刷新一次，与统计主链路同频；
- 某一个区间失败只让那一格显示「—」，不拖垮另外三格。

> 要一次拿四个区间得改 Java 侧加新接口（重编 jar + 重启容器），
> 本轮用并发规避，影响面更小。

### 18.5 ★ 两个会把功能做成「全空」的坑（都实测踩过）

**坑一：解构类方法丢了 `this`**

```ts
const requestJson = provider.requestJson;   // ❌ this 变成 undefined
const requestJson = provider.requestJson.bind(provider);   // ✅
```

四个请求全部抛 `TypeError: Cannot read properties of undefined (reading 'client')`，
被 catch 吞成 `usage: null` → 界面上四个「—」。

**为什么难查**：`useSiteEnergyStats` 写的是 `provider.requestJson(...)`（点调用，
`this` 正确），所以同一张卡的**大数字有值、四格全空** —— 看起来像「接口不通」，
而实际是调用方式不一致。

**坑二：自制的 `useCallbackRef` 只在首次渲染跑**

第一版为了「少维护依赖表」，写了个用 `ref` 拿最新值的包装：

```ts
const load = useCallbackRef(async () => { ... });   // ❌ 只跑一次
useEffect(() => { void load(); }, [load]);          // load 永远不变
```

大屏加载时 `platform.siteId` 还是 `null`，那一次直接走「没有场站」早退，
**之后再也不会重跑**。改成标准 `useCallback` + 依赖 `[enabled, knownSiteId, topologyId]`。

> 教训：`useCallback` 的依赖表是该写的。用 ref 绕过去，
> 会把「少写一行依赖」换成「功能完全不工作且不报错」。

### 18.6 实测（1920×1080，真实平台数据）

```
峰值/谷值块：已移除 ✓
今日  —            ← 窗口内无数据（数据断档两天），显示「—」不是 0
本周  —
本月  62.51万 kW·h  ← 与接口直查 625135.88 kW·h 一致
本年  62.51万 kW·h
```

接口直查对照（`gran=day`）：本月/本年 `elec.usage = 625135.88`、`series` 6 个桶。

`tsc` 退出码 0；`vitest` **732 个测试通过**（新增 9 条窗口测试）；
`verify-device-focus.mjs` 全部判据通过、退出码 0。

---

## 19. 设备控制：大圆按钮 + 数值滑块（2026-11-23 客户要求）

客户原话：

> **「设备控制中如果只有启停，那么就做成大圆按钮绿色和红色的。如果是控制开度的那么看文档是接收什么数字，然后做成形象的按钮，我没想好你凭经验把」**

### 19.1 两种控制形态

| 设备能力 | 界面 | 判据 |
| --- | --- | --- |
| 只有启停 | 两颗 **56px 圆钮**：绿=启动 / 红=停止 | `setRunning(boolean)` 一类 |
| 有数值控制 | 圆钮 **+ 滑块**：显示人类单位，下发协议整数 | 单 `number` 参数命令 |

**为什么不做「一个按钮来回切」**：运行中再点一下就停机，而操作员很可能
只是想「确认它在运行」。两颗独立按钮误触成本从「停了一台机」降到「点了没反应」。

**为什么圆形**：工业控制面板的通用语言（按钮/指示灯/急停）。圆角矩形
看起来像普通网页按钮，操作员会当成「切换视图」这类无害操作。

尺寸 56px 是在「1080p 大屏 3 米外能点到」与「两颗并排不吃掉设备数据栏」
之间取的平衡。

### 19.2 ★ 手册里到底「接收什么数字」

这是客户问题的核心。手册（30RBRQ065-750VHS 第 17 章）的可写数值点位：

| 地址 | 含义 | 接收范围 | 换算 | 显示 |
| --- | --- | --- | --- | --- |
| 40062 | 制冷设定点 | **50 ~ 250** | ÷10 | 5.0 ~ 25.0 ℃ |
| 40063 | 制热设定点 | **150 ~ 550** | ÷10 | 15.0 ~ 55.0 ℃ |
| 40052 | 系统模式 | 0 / 1 | — | 制冷 / 制热 |
| 40051 | 系统开关 | 0 / 1 | — | 关机 / 开机 |

**开度在手册里没有写点位**：`30010 系统加载容量 %` 是**只读**。
设备上登记的 `setOpening(value: number)` 是网关侧能力，口径取 **0~100**，
与遥测 `opening` 同口径 —— 设 70 后读到 70，现场能对上。

> 这就是为什么界面上要**把协议原始值写出来**：
> ```
> 下发原始值：50（范围 0~100）· 开度按百分比下发（0~100），与遥测「开度」同口径
> ```
> 设定点则显示 `20.0 ℃` → 「下发原始值：200（范围 50~250）」。
> 操作员当场能看到换算，不必翻手册或问开发。

### 19.3 换算只做一处

`utils/control-range.ts` 提供四个函数，组件里**不出现任何 `/10` 或 `*10`**：

| 函数 | 用途 |
| --- | --- |
| `fromWire(range, wire)` | 协议值 → 显示值（200 → 20.0） |
| `toWire(range, display)` | 显示值 → 协议值（20.0 → 200），**必须取整** |
| `clampWire(range, wire)` | 夹进范围 + 对齐步长（设备可能报 999） |
| `initialWireValue(range, current)` | 滑块初始位置（读得到用当前值，读不到用中点） |

**为什么退中点而不是最小值**：滑块停在 0 看起来像「设备被关到全关」（故障态），
而实际只是「没读到」。中点是中性位置。

**`toWire` 必须 `Math.round`**：手册那几个点位只收整数。
发 `20.4` 会被设备当非法值或截断成 20（=2.0℃）。

### 19.4 ★ 为什么拖动过程不下发

`onChange` 在拖动时连续触发。边拖边发意味着一次拖动就是几十条 RPC ——
网关侧命令队列会被打满（与本项目记录过的「模拟器把平台写入队列压满」同类问题）。

所以：拖动只改本地草稿，`onPointerUp` 松手才发一次；键盘操作（方向键）
用 `onKeyUp` 兜住，因为键盘没有 pointerup。

### 19.5 实测（1920×1080，真实平台数据）

用 DOM `PointerEvent` 在 canvas 上派发来触发拾取（CDP 输入通道在本机会挂），
点中一台设备后量到：

```
mode          = start-stop
启动钮         56 × 56 px, border-radius 50%, rgb(31,157,107)  ← 绿
停止钮         rgb(217,58,63)                                   ← 红
滑块           min=0 max=100 step=1
下发原始值：50（范围 0~100）· 开度按百分比下发…
```

**一个必须说清的观察**：滑块初值是 **50（中点）**，不是 65。
说明点中的那台设备**没有上报 `opening`** —— 大概率是立式泵（有阀门开度命令，
但遥测侧没有 `opening` 键）。这是 `initialWireValue` 的预期降级行为，不是 bug。

但也正因为如此，**「读到当前值时滑块停在当前值」这条路径没有在浏览器里实测到**。
它由 `control-range.test.ts` 的 4 条用例锁住（读得到用当前值 / 读不到用中点 /
脏值按读不到 / 越界夹回）。

### 19.6 未验证部分

- **滑块下发是否真的到达设备**：`sendNumeric` 走
  `getCommandProvider().sendCommand`，只在 live + guard 模式下真发。
  本轮没有对现场设备真下发（按项目约定「不对现场设备真下发验收」）。
- **3D 拾取一次要几十秒**：headless + SwiftShader 下拾取走 WebGL `readPixels`。
  验收脚本因此只验证「未选中时不显示圆钮/滑块」这条静态判据，
  选中后的形态用一次性探测脚本取证据。

---

## 20. 卡片样式 / 排名维度 / 顶栏重构（2026-11-23 第四轮）

客户四条：

> **「问题1：左侧第一个样式有问题，参考原型图的好看样式部件替换一下」**
> **「问题2：设备用电排行没有用，换一下维度统计，你根据经验来替换换吧」**
> **「问题3：右侧第一个部件样式有问题，里面内容超出边界」**
> **「问题4：设计标题栏只有以下内容：返回，标题，组织,场站,分组(这三处名称字小点)，
> 按钮AI搭建（我希望开发一个Chat聊天对接codewhale代替命令行，看看有没有插件省去开发）、
> 发布为模板、更新缩略图、导出项目、保存、场景设置、搭建编辑/保存（切换）、运行查看」**

### 20.1 问题 1 与 3：同一张卡的两个症状

左 1（场站用电量）与右 1（碳排放核算）**用同一个组件** `EnergyMetricBody`。
实测两张卡 `overflow` 都是 **0** —— 并没有真的溢出。

**真正的病因是内容重复**：碳排放卡的「折标煤 77.54 tce」出现**两次**
（副标题一次、下方三格第一格一次）。视觉上像一坨挤在一起的东西，
用户描述成「超出边界」。这是**症状描述准确、归因不同**的典型情况 ——
按「加 overflow: hidden」去修会掩盖问题而不是解决问题。

修法两处：

1. 碳排卡副标题从「折标煤 77.54 tce」改成「核算口径 · 3 项能源品种」，
   信息不重复；
2. 主体区按原型重构层级：

```
改前：大数字 / 标签 / 占比说明 —— 三行独立文本，垂直占位多、中间大片留白
改后：energyHero = 大数字（含小单位）+ 一行「标签 · 说明」
      ─── 分隔线 ───
      指标网格（原型 .info-metrics）
```

同时给 `.energyKpi` 加 `overflow: hidden` 作兜底：卡片有 `clip-path` 切角，
溢出内容会被切掉一半、看起来像排版错乱。宁可裁一点，不能压出边框。

**实测**：右 1 `折标煤` 出现次数 2 → **1**；两张卡 `overflow` 仍为 0。

### 20.2 问题 2：排名为什么「没用」——它把不同单位混在一起排

原「设备用电排名」实测输出：

```
正泰三相电表 DTSD3366D   61.31万 kW·h
雅达三相电表 YDPQ200-A    1.21万 kW·h
热力表                   12.59 GJ
蒸汽表                    2.99 t
```

两个致命问题：

1. **单位不可比**：kW·h / GJ / t 三种物理量，条长按原始数值算，
   于是「2.99 t 蒸汽」的条比「1.21万 kW·h 电」还长 —— 视觉上完全误导；
2. **排的是计量表不是设备**：运维看不出任何可行动的结论
   （「某某电表排第一」既不能巡检也不能优化）。

**换成「用能分项占比」**，这是能源管理系统的标准维度，且天然解决混单位：

| 方面 | 设备排名 | 用能分项占比 |
| --- | --- | --- |
| 条长口径 | 原始数值（单位不可比） | `pct`（平台按折标煤统一折算） |
| 数值展示 | 混排 | 各自带自己单位，不混算 |
| 可行动性 | 「某表排第一」 | 「热力占了近三成」 |
| 合计 | 无 | **合计折标煤**（唯一可跨品种相加的量纲） |

实测：`电能 62.51万kW·h / 热力 12.59GJ / 蒸汽 2.99t` + `合计折标煤 77.54 tce`。

标题同步改成「用能分项占比 / ENERGY BREAKDOWN」。

> **踩到的坑**：`apply-heat-pump-layout.mjs` 只改几何、不改标题，于是出现
> 「卡里是用能分项、标题写着设备用电排名」。已给脚本加 `TITLES` 映射并把
> 标题纳入回读校验 —— 几何和标题是同一件事，必须一起改、一起验。

### 20.3 问题 4：顶栏 18 → 11 项

| 改动 | 详情 |
| --- | --- |
| 顶栏保留 | 返回 / 标题 / 组织 · 场站 · 分组 / AI 搭建 / 发布为模板 / 更新缩略图 / 导出项目 / 场景设置 / 搭建编辑·保存 / 运行查看 |
| 搬进「场景设置」抽屉 | 撤销 / 重做 / 查找画面对象 / 应用对接结果 / 核对绑定 / 模板配置 / 数据源 / 告警 / 在线编程 / 选择画面模板 / 主题 / 导入模型 / 导入示例 |

**功能一个没删**，只是按「频繁 vs 低频」分组。抽屉里的 13 个按钮再按
「改什么」分了 7 组（编辑历史 / 画面对象 / 对接结果 / 配置面板 / 画面模板 / 外观 / 模型与示例）。

**组织 / 场站 / 分组**：标签 10.5px 弱色、名称 12px 常规色 —— 客户要求
「名称字小点」，所以两者字号接近但有区分。

> 组织显示的是 `customerId` 前 8 位（`7ce48900…`），**不是客户名** ——
> 场景文档里只存了 id，平台接口没带名字。截断 + 悬停显示全量，
> 比编一个「平台演示中心」安全（编的名字换客户后就是错的）。

**草稿状态信息没丢**：原来顶栏有个独立小标签（本地草稿 / 已发布 / 草稿），
搬走后会丢，所以改成「搭建编辑·保存」按钮的 tooltip。

### 20.4 AI 搭建：调研结论是没有插件可省

实测依赖清单：**零 AI/LLM 包**（无 openai / anthropic / langchain / assistant-ui）。
「装个插件就有了」这条路不存在。

所以本轮交付的是**可用的壳 + 明确的后端契约**，三件事刻意分开：

| 层 | 状态 |
| --- | --- |
| UI（消息流 / 输入 / Enter 发送 / Shift+Enter 换行 / 错误气泡） | ✅ 真能用 |
| 请求 | ✅ 真 POST 到 `/api/ngx/ai/chat` |
| 回答 | ❌ 后端未接，**明确报错并给出契约**，绝不在前端伪造 |

> 一个假 AI 面板比没有面板更糟 —— 用户会照着它给的假命令去操作。
> 这是本项目「静默失败必须留痕」的直接应用。

契约（需平台侧实现）：

```http
POST /api/ngx/ai/chat
{ "messages": [{ "role": "user", "content": "..." }],
  "sceneId": "...", "context": { "widgets": 7, "bindings": 13 } }
200 → { "content": "...", "actions": [{ "type": "add-widget", ... }] }
```

`actions` 是关键：AI 要能**真正改场景**而不只是聊天。前端收到后交给
`applyAiActions` 落进布局 —— 那是下一步，本轮先留字段。

### 20.5 缩略图与导出

**更新缩略图**新增能力 `utils/scene-thumbnail.ts`：

- 压到 480px 宽 JPEG q0.72（约 25~40KB；原图 PNG 常有 2~4MB）
- **空白检测**：WebGL 未开 `preserveDrawingBuffer` 时 `toDataURL` 得到全透明图
  （不报错，只是存下来是空白）。检测依据是编码后大小 < 6KB
- `SceneMeta.thumbnail` 用 `data:image/` 前缀校验（防 `javascript:` 注入）

**发布为模板** = 先存再发布；**导出项目** = 导出整份场景 JSON。

### 20.6 实测（1920×1080）

```
顶栏：48px 高、单行不换行、11 项、宽度 1920 刚好容纳
      按钮 84px 宽、32px 高；scope 名称 12px / 标签 10.5px
左 1：227px 高，overflow 0，四格汇总在
左 3：336px 高，overflow 0，电能/热力/蒸汽 + 合计折标煤 77.54 tce
右 1：186px 高，overflow 0，「折标煤」出现 1 次（改前 2 次）
场景设置抽屉：7 组、13 个按钮
AI 面板：消息流 + 输入框 + 发送按钮，1 条初始消息
```

`tsc` 0；`vitest` **760 通过**（新增 6 条缩略图尺寸测试）。

### 20.7 未验证

- **点击「更新缩略图」的实际产物**：headless + SwiftShader 下 WebGL 画布
  可能读不回像素，脚本会走「空白检测」分支报错 —— 那是预期行为，
  但**真实浏览器里是否成功没测到**。
- **AI 面板的真实对话**：后端契约未实现，必然报错（设计如此）。

### 21 运行时交互五修（2026-11-23）

客户一次提了五条，全部来自实际操作：

> 「核对绑定抽到不随点击部件来显示，把它移动到场景设置中。场景中周围部件由于冒泡的原因
> 导致鼠标滚动机组状态没有滚动效果。3D设备点击下面的启停按钮要互斥不能同时可点。
> 启停按钮下面运行状态就是属于那个状态那个亮就行了，但是我在平台端设备运维-实时监测中
> 不知道哪个遥测跟这个运行状态绑定。告警跑马灯中的样式不好看，因为每个告警有边线和
> 底色的原因导致看起来很乱。」

#### 21.1 点部件不再自动打开核对绑定

`EditorShell` 的 `onSelectWidget` 原来做三件事：选中、聚焦、**打开核对抽屉并切到卡片页**。
第三条是错的 —— 「看一眼这张卡长什么样」和「改它的绑定」是两种意图，
低频配置动作绑架了高频浏览动作，点一下画布就被抽屉压掉一半。

现在 `onSelectWidget` 只做选中 + 聚焦。另一处「点 3D 对象时若抽屉开着就切到设备页」
也一并去掉：用户正在看设备绑定清单，点一下 3D 清单就自己跳走，同样是「点击改变核对面板状态」。

「核对绑定」入口保留在 **场景设置 → 面板** 组，需要改绑定时主动去。

#### 21.2 滚轮失效的根因：PlayCanvas 把 wheel 挂在 window

客户说「因为冒泡的原因」，方向对，但冒泡只是表象。实测（headless 里派发 `WheelEvent`）：

```
wheelDefaultPrevented: true     ← 有代码阻止了默认滚动
scrollTopAfter: 0
```

翻 PlayCanvas 源码：

```js
// playcanvas/build/playcanvas.mjs · Mouse.attach()
window.addEventListener("wheel", this._wheelHandler, { passive: false });
```

监听挂在 **`window`**，而 `OrbitCamera.onMouseWheel` **不判断坐标是否在 canvas 内** ——
只要事件到达 window，它就改相机距离并 `preventDefault()`。

于是同时有两个症状，客户只报了第一个：
1. 列表滚不动（默认滚动被吃掉）；
2. 在卡片上滚轮**还会把 3D 缩放一次**，而人以为自己在滚列表。

修法：卡片 `article` 上 `onWheel={(e) => e.stopPropagation()}`。

**为什么拦整张卡而不是只拦可滚动容器**：卡片是大屏的信息层，用户在卡片上滚动
的意图是「看这条卡里的更多内容」，不是「拉远镜头」。只拦列表的话，卡片内不可滚的
区域仍会把滚轮漏给 3D，表现为「有的地方能滚、有的地方镜头会动」—— 更难理解。

#### 21.3 启停互斥

原来 `start` / `stop` 各自只判断「设备上有没有这条命令」，两个都 enabled。
运行中的机组「启动」照样可点 —— 点下去要么被网关拒绝（界面看不出），要么真的重启机组。

判据改成铭牌状态 `plate.status`（与列表圆点、3D 染色同源）：

| 当前状态 | 启动 | 停止 | 理由 |
| --- | --- | --- | --- |
| running | 禁用 | 可点 | 已在运行，再发启动无意义 |
| stopped / fault / offline | 可点 | 禁用 | 没在运行，停它无意义 |
| unknown | 可点 | 可点 | 不知道状态时不该锁死任一方向 |

`fault` 允许「启动」：现场常见做法是重启一次尝试恢复；真正的清故障走告警处置。
把启动也禁掉会让值班员无从下手。

#### 21.4 运行状态：只有一个亮

原来 `chips` 同时给「运行 1」「停止 0」两枚，都带底色 —— 一台设备时读不出当前状态。

`ControlDrawerModel` 新增 `status` 字段（`kind` / `label` / `faultCode`），
从 `plate.status` 取，**运行/停止这对键从 chips 里剔除**（其余维度如故障计数仍走 chips）。
界面上渲染成单一 pill，五态五色、只有当前那一个存在。

`status.kind === "unknown"` 时圆点不发光 —— 未知恰恰是「不知道」，发光会让人以为有活跃状态。

#### 21.5 「不知道哪个遥测绑了运行状态」—— 这个缺口是真的

客户这句点出的是实际问题：**实时监测页只列「设备上报了哪些遥测」，不告诉你哪一列
被拿来判断运行状态**。而判据分散在三处：

1. `statusMapping.telemetryKey`（显式配置，优先级最高）
2. `telemetryMappings` 里 label 含「状态 / running」且不含「启停」的项
3. 代码约定 `sys_run_state`（手册 30001 枚举）

现场从遥测清单里**推不出来**这三层。

新增 `explainRunningState(binding)`（`utils/device-plates.ts`），在绑定面板渲染
「运行状态判据」只读小节：实际生效的键、语义（枚举 / 布尔）、**是否会自动回退**。

> ★ 顺序必须与 `bindingRunningState` 一致。这里只是「解释」，判据本身仍然只有
> `bindingRunningState` 一份 —— 两边顺序分叉会出现「界面说读 A、3D 实际按 B 染色」，
> 比不解释更糟。

回退提示为什么必须显示：`statusMapping` 指定的键经常只有部分网关上报
（本轮实测 3#~9# 只有布尔），这种情况下回退是**常态**，不是配置错误。
不说明的话，用户会以为「配错了还在用」。

#### 21.6 告警跑马灯：去掉色块

原来每条带「左侧 2px 彩条 + 整条半透明底色」，条间只有 5px 间隙。在 341px 高、
装着 8+ 条滚动告警的卡里就是**一排密集彩色色块** —— 眼睛找不到起点。

和「表格每行都加边框」是同一类问题：分隔靠底色堆叠，密度一高就成噪声。

改法参考原型 `.side .panel`：面板本身有边框，内部靠留白和极细分隔线组织信息。

| 项 | 改前 | 改后 |
| --- | --- | --- |
| 条目底色 | 每条都有 | 无（仅 hover 时给 8%） |
| 分隔 | 5px 间隙 | 1px `color-mix` 12% 细线 |
| 左侧彩条 | 2px（常驻容器**另有一条**） | 2px（常驻 3px），容器不再画 |
| 圆角 | 有 | 0 |

★ 常驻容器原来自己有一层 2px 红线 + 5px padding，里面的 `.tickerItem` 也有左边框 ——
常驻那条显示成**双线**，正是客户说的「每个告警有边线」的一部分。容器现在只做布局约束。

全卡唯一保留底色的是**常驻的最严重那条**（`tickerPinned .tickerItem`）：它需要被立刻找到，
和滚动内容在视觉上必须不同。去掉它，用户就不知道哪条是固定的。

#### 21.7 ★ 滚轮还有第二层原因：flex 子项会被压扁

改完 `stopPropagation` 之后仍然滚不动，实测发现行高被压缩：

```
9 行 × 28px = 252px，容器 clientHeight = 259px
scrollHeight = 259 = clientHeight      ← 永远相等，滚动条永不出现
```

`.deviceList` 是 `display: flex; flex-direction: column`，行作为 flex item
默认 `flex-shrink: 1` —— **内容超出时行被压扁，而不是溢出**。
所以「滚动条不出现」不是事件被吃掉，而是根本没有可滚的内容。

加 `flex: none` 后行高锁定，超出部分才真正溢出。

> 这类问题只在**数据变多**时暴露：9 台正好装满时看不出来，
> 20 台时行会一路压到文字重叠。客户说「滚不动」，两种原因同时存在。

#### 21.8 验证

```
tsc -b                → 0
vitest run            → 768 通过（新增 control-drawer 3 条 + device-plates 5 条
                        + useNameplateCommands 8 条互斥）
```

**浏览器实测（1920×1080，headless + SwiftShader）**：

```
滚轮
  wheelDefaultPrevented        → false（改前 true）★ 根因证据
  .deviceRow flexShrink        → "0"（改前 1）
  行高（容器压到 120px 后）     → 28/28/…/27 与压缩前一致 ★ 没有被压扁
  clientH / scrollH            → 120 / 250
  list.scrollTop = 60 后       → 60 ★ 真的能滚

抽屉（点中一台 running 机组）
  status pill 数量              → 1
  statusKind / statusText      → "running" / "运行"
  drawer-start.disabled        → true   ★ 互斥
  drawer-stop.disabled         → false  ★ 互斥
  chips                        → ["故障 0", "报警 0"]（运行/停止已移出）

告警跑马灯（11 条）
  第 1 条（常驻）              → backgroundColor rgba(217,72,77,0.09)、borderLeft 3px
  其余 10 条                   → transparent、borderLeft 2px ★ 无底色块
  条目高度                     → 40~42px 均匀（未被压缩）
  圆角                         → 0px
```

**未验证**：

- **真实鼠标滚轮的连续滚动**：`Input.dispatchMouseEvent type=mouseWheel` 在
  headless + SwiftShader 下超时（本仓库已知环境限制）。已用「合成 `WheelEvent`
  的 `defaultPrevented` + 直接设置 `scrollTop` 生效」两条替代证据。
- **`fault` 状态下重启的实际下发结果**：需要真实 PLC 响应。
- **设备铭牌（3D 标签）在 headless 下 `placed` 为空**，所以抽屉是通过点击
  canvas 拾取打开的，不是点铭牌。铭牌本身的观感未在本次验证覆盖。

### 22 模板中心：从平台模板库建场景（2026-11-23）

客户要求：

> 「平台应该有一个地方存储公共的场景模板，3d-ngx 在创建场景的时候从模板库中选择模板，
> 具体样式参考 `数字孪生大屏工坊/templates.html` 的样式（不用考虑左侧和上面的菜单）。
> 3d-ngx 创建场景表单中点击选择模板应该出现弹出框，弹出的就是刚才那个 .html 原型图。」

前置确认（客户追问「是不是还用资产存储，不单独建表」）—— **是**，已核实
`iot-rule-engine` 后端：

| | 实体 | type | customerId |
| --- | --- | --- | --- |
| 公共场景模板 | TB ASSET | `scene_template` | `NULL_UUID`（租户级） |
| 场站场景实例 | TB ASSET | `topology` | 客户 id |

`EnergySceneTemplateService.create()` 走 `assetService.saveAsset()`，元信息全在
`additionalInfo`（`templateVersion` / `description` / `glb` / `styleFiles` / `packId`）。
**没有 `scene_template` 表。**

模型文件在对象存储：`scene-template/{tenant}/{templateId}/model.glb`，
下载走 `GET /api/energy/scene-template-assets?objectKey=`（带租户鉴权）。
换机器、换浏览器都不会丢。

顺带纠正我上一轮的两个错误判断（都是查了后端源码才发现的）：

1. 「模板资产会混进资产树」—— **不会**。`EnergyTopologyService.CONFIG_ASSET_TYPES`
   已把 `SCENE_TEMPLATE_TYPE` 列进排除集合。
2. 「删除引用检查需要补」—— **已实现**。`delete()` 扫所有 topology 的
   `additionalInfo.templateId`，被已发布实例引用时拒绝删除；
   有草稿引用时**删档案但保留对象文件**（避免画面 404）。

#### 22.1 发现的真缺口：客户角色调不到模板清单

`EnergySceneTemplateController` 所有端点都是：

```java
hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN')
```

而**客户建场景是主路径**。客户登录时 `GET /api/energy/scene-templates` 必然 403 ——
客户永远看不到你们准备好的公共模板。

三条路权衡后选第三条（权限最小、字段也最小）：

| 方案 | 问题 |
| --- | --- |
| 放宽 `list` 到 `CUSTOMER_USER` | 顺带把 `glb.objectKey` / `styleFiles[].objectKey` 发出去 —— 那是对象存储的内部布局 |
| 客户端自己拼 objectKey 下载 | 把目录结构变成对外契约，且客户端可构造任意 key |
| **新增只读接口（采用）** | 见下 |

#### 22.2 后端新增（`iot-rule-engine`）

```
GET /api/energy/scene-template-options                  READ_AUTHORITIES
GET /api/energy/scene-template-options/{id}/model       READ_AUTHORITIES
```

`READ_AUTHORITIES` = `SYS_ADMIN / TENANT_ADMIN / CUSTOMER_USER`。

**清单字段只有**：`id` / `label` / `description` / `templateVersion` /
`stylePack` / `hasModel`。**没有 objectKey。**

`hasModel` 是服务端算的布尔 —— 判据是「档案里有 glb 记录」，**不 HEAD 对象存储**
（每次列清单都去 HEAD 是 N+1，违反项目铁律）。文件真缺失由下载端点返回 404。

**模型下载按 templateId 取**，服务端自己拼 canonical key：

```java
String key = "scene-template/" + tenantId + "/" + tmpl.getId().getId() + "/model.glb";
```

客户端能取到的范围严格等于「清单里看得见的模板」，不依赖目录布局，
也拿不到 `inbox/` 暂存对象。

⚠ 这两个端点**不调 `requireTenantWriter`**，但 `requireTemplate` 仍然校验
「这个 id 是本租户的 `scene_template` 资产」—— 别的租户的 id 过来会被拒。

#### 22.3 前端（`apps/web`）

新增两个文件 + 改造向导：

| 文件 | 作用 |
| --- | --- |
| `features/scene-editor/template-picker.ts` | 纯逻辑：布局映射 / 预览区 / 搜索 / 内置卡片 |
| `features/scene-editor/TemplatePickerDialog.tsx` | 模板中心弹框（视觉对齐原型） |
| `TemplatePickerDialog.module.css` | 自绘深色玻璃样式 |
| `CreateSceneWizard.tsx` | Radio 换成「选择模板」入口 + 挂弹框 |

**视觉**：色值直接取自原型 `:root`（`#050b16` / `#0b1729` / `#1d3b5d` /
`#278cff` / `#38d9ef`）。内层全部自绘，只借 antd `Modal` 的 portal 与 ESC。

**卡片预览是真实布局线框，不是示意图**：取内置 `ScreenTemplate.regions`
的 `x/y/w/h` 百分比画。实测「冷热站标准版」7 个区、「园区总览底稿」5 个区，
和建完之后的大屏骨架一致。

#### 22.4 ★ 平台模板没有布局字段 —— 这个映射是约定，必须说清

平台模板存的是「模型 + 风格套装」，**没有 `regions`**。布局来自代码里的
两个内置 `ScreenTemplate`。所以「选了模板 → 用哪套布局」是一条**约定**：

```
stylePack / packId / name / description 命中 /热泵|冷热|hvac|cooling|chiller/i
  → 天骄冷热站布局
否则
  → 综合态势（默认）
```

界面照实显示 `matchedBy`：命中写「按风格套装匹配」，兜底写「默认」。
不标注的话，用户会以为模板自带布局，布局不对时以为是模板坏了。

#### 22.5 内置布局也进网格，但 id 带前缀

`builtin:overview-situation` / `builtin:tianjiao-heat-pump`。

前缀的作用是**防止写错库**：向导提交时

```ts
templateId: pickedTemplate && !isBuiltinLayoutCard(pickedTemplate)
  ? pickedTemplate.id : undefined
```

不加这个判断，`builtin:xxx` 会被写进场景 meta，后端「删除模板时检查引用」
就找不到那条记录，场景列表也会显示一个不存在的模板版本。

#### 22.6 三个容易漏掉的坑（都已被测试钉住）

**① `hasModel` 只认布尔。** 客户端接口不返回 objectKey，卡片上「含模型 / 仅布局」
只能靠后端给的布尔。若按 `Boolean("false")` 判断，字符串 `"false"` 会变成 true ——
「仅布局」的模板显示成「含模型」，建完发现没模型。

**② 模型下载双路径。** 有 objectKey 走老的 `downloadAsset`（租户端模板库自己用）；
没有 objectKey 走 `downloadModel(templateId)`。客户这条路**只能**走后者。

**③ 404 不是故障。** 模板可以只有布局没有模型，下载返回 404。这时该说
「该模板没有上传模型」，不是「下载失败」—— 后者会让人以为是网络问题，反复重试。

#### 22.7 部署顺序问题（真实存在）

`scene-template-options` 是新接口。若**前端先上、后端后上**，接口就是 404。
所以 `TemplatePickerDialog` 把 404 单独识别为：

> 「平台尚未提供模板清单接口（/api/energy/scene-template-options 返回 404）。
> 后端升级后点「刷新」即可看到公共模板；现在只能用内置布局。」

而**不是**「模板库读取失败」。后者会让运维去查网关、查权限，白花半天。

#### 22.8 验证

```
前端 tsc -b                     → 0
前端 vitest run                 → 798 通过 / 80 文件（新增 template-picker 18 条
                                  + scene-template-client 4 条）
后端 mvn -pl guard-app -am package → 0
jar 内校验 javap                → options() / downloadModel(String) 都在
```

**浏览器实测（1600×1000，注入模拟回包）**：

```
勾选框入口     → 「场景模板 / 未选择模板 / 默认布局：综合态势 / 选择模板」
弹框           → 高 515px（非 172px —— 那是 headless 下 antd zoom 动画停在起始帧）
卡片 4 张      → 2 张平台模板（含模型 / 仅布局）+ 2 张内置布局
预览线框       → 7 / 5 个 region，与布局 JSON 一致
布局映射       → 「冷热站标准版」→「天骄冷热站（按风格套装匹配）」
               → 「园区总览底稿」→「综合态势（默认）」
选完回填       → 名称「冷热站标准版」、布局说明跟着变
弹框关闭       → DOM 带 ant-zoom-leave（正在离场）
404 分支       → degraded 文案准确、2 张内置布局仍可选、error 为 null
```

**未验证**：

- **真实后端联调**：8090 还是旧 jar（本地服务由用户启动，按 A3 不自行重启）。
  新接口实测返回 404，前端 404 分支已验证 —— 但「真回包 → 真下载 → 建场景」
  这条完整链路要等后端重启后才能跑。
- **真实 GLB 下载**：模板 `冷热站标准版` 的模型下载未跑（依赖上一条）。
- **客户角色（CUSTOMER_USER）**：本轮全程用 TENANT_ADMIN 测。
  `READ_AUTHORITIES` 是否真的放客户进来，要等后端重启后用客户账号验。

### 23 新建场景表单收敛（2026-11-24）

客户要求四条：

> 「把新建场景中"场景模板"和"风格套装"整合在一起，把"风格套装"放在"场景模板"资源。
> "设备拓扑"的选择干掉，让 3d-ngx 的场景不在平台的"设备拓扑"中显示，
> 删除最下面的"上传套装文件（可选)"」

#### 23.1 表单最终顺序

```
场景名称
场景模板          ← 从平台模板库选（弹框）
风格套装          ← 紧跟模板
场站
视图类型
（范围）          ← 仅非 physical 视图时出现
上传模型
设备底座
（天气地点）      ← 仅全景套装时出现
```

实测（1280×1000，`.ant-form-item-label` 按 DOM 顺序）：

```
["场景名称","场景模板","风格套装","场站","视图类型","上传模型","设备底座"]
场景模板 idx=1 · 风格套装 idx=2
```

#### 23.2 为什么套装紧跟模板

两者是一对：模板带过来默认套装，用户可在此改。位置也说明层级 ——
**先有模板（模型 + 默认套装），再调套装**。原来套装排在「上传模型」之后，
中间隔着场站/视图/拓扑，要往上翻才知道模板已经给过一个值。

#### 23.3 ★ 删掉「设备拓扑」不只是少一个控件

原来有两个选项，其中「使用已有拓扑」允许把场景写进一个**普通设备拓扑**
（`sceneInstance=false`）。后果：

| 后果 | 说明 |
| --- | --- |
| 一个拓扑两种身份 | 它同时出现在平台「设备拓扑」页和大屏场景列表，字段互相看不懂 |
| 改大屏 = 改拓扑 | 在大屏里改布局/绑定，等于改了那个拓扑本身 |

现在**一律新建** `sceneInstance=true` 的场景拓扑，这条约束变成结构性的，
不再依赖用户选对选项。

**平台「设备拓扑」页请求带 `sceneInstance=false`**（`device-topology.component.ts:194`），
所以只要场景始终是 `sceneInstance=true` 就不会在那边出现。

实测（2026-11-24，新 jar）：

```
GET /api/energy/topologies?sceneInstance=false  → 5 条，全部 sceneInstance=false
GET /api/energy/topologies                        → 7 条（含 2 条场景）
```

#### 23.4 删「上传套装文件（可选）」

引擎按 `packId` 取内置 render 规则，上传的自定义套装文件**没有消费方** ——
传了也不生效。留一个「传了但没用」的入口比没有更糟：用户会以为它在起作用。

连带简化：`uploadOrSkip` 去掉 `kind` 参数（只剩 glb），`takeFile` 去掉 pack 分支。

#### 23.5 遗留数据（未处理，需客户确认）

库里还有 **2 条 3d-ngx 早期向导建的 `sceneInstance=false` 拓扑**，
它们会显示在平台「设备拓扑」页：

```
验收测试-天骄科技园-20261121 拓扑   d3981b60   0 widgets · 0 bindings · 无模型 · 无 roots
新建工业场景 拓扑                   9f41d9d0   0 widgets · 0 bindings · 无模型 · roots=1
```

两条都是空壳。**删除是不可逆动作，未执行** —— 等客户确认。
处置选项：删除（推荐，空数据无价值）／改成 `sceneInstance=true`（改变数据语义，不建议）。

#### 23.6 验证

```
tsc -b         → 0
vitest run     → 798 通过 / 80 文件
浏览器实测      → 表单 7 项、顺序正确；「设备拓扑」「使用已有拓扑」「上传套装文件」均不存在
```

`create-scene-messages.test.ts` 里原先断言 `WIZARD_COPY.createTopology` 存在，
现改为**断言它不存在** —— 留着常量会让人以为向导还有那个分支。

### 24 平台设备运维：设备属性页（2026-11-24）

客户要求：

> 「清台的设备运维的实时监测里面除了新增了维护功能，还有把设备属性各加一个与实时监测同级选项卡，
> 可以看客户端属性，服务端属性和共享属性，同时支持修改功能」

改动在 **`iot-rule-engine`**（不是本仓库）：
`guard-server/src/main/data/json/system/widget_types/energy_device_ops_page.json`
（fqn `energy_device.ops_page`）。

#### 24.1 页签结构

抽屉里的 tab 从 2 个变 3 个：

```
实时监测 | 历史参数 | 设备属性
```

属性页内部再分三档作用域（同级按钮，不是下拉）：

| 作用域 | 谁写 | 界面说明 |
| --- | --- | --- |
| 服务端属性 SERVER_SCOPE | 服务端写、设备可读 | 品种 `type1`、台账、模型 key 在这里 |
| 客户端属性 CLIENT_SCOPE | 设备端自己读写 | 在服务端改只改记录，设备下次上报可能覆盖 |
| 共享属性 SHARED_SCOPE | 双方可读，写入需规则链 | 保存成功 ≠ 设备已收到 |

按客户写在前面的顺序：服务端 → 客户端 → 共享。

#### 24.2 ★ 为什么必须给每一档写说明

三档的区别不是"分类"，是**语义差异**，从名字完全看不出来。
不写说明会有两种误判：

- **共享属性**：改完设备行为没变 → 以为保存失败 → 反复重试。实际是规则链没分发。
- **客户端属性**：改完过一会儿被覆盖 → 以为改丢了。实际是设备端上报覆盖。

所以说明条只在有语义差异的那两档出现，服务端属性不显示 ——
常驻说明会变成噪音，看两眼就被忽略。

#### 24.3 ★ 类型还原：字符串原值不动

属性值可能是 string / number / boolean / object。全部当字符串写回去会把
`reportPeriod: 60` 变成 `"60"`，规则链做数值比较就失败，**且不报错**。

所以编辑时把"看起来像字面量"的输入还原成对应类型（`parseAttrInput`）：

1. 输入是合法 JSON（对象/数组/数字/布尔/null）→ 用解析结果；
2. 否则按字符串（`JSON.parse('照明')` 抛异常，自然落到字符串）。

**例外：原值本来是字符串就保持字符串。** 否则想给某个 key 存 `"123"`
的场合（设备编号）会被静默改成数字 123 —— 界面上完全看不出来。

已用 11 条边界案例验证（含 `'123'` vs `"123"`、`'0'`、`'false'`、带空格数字）。

#### 24.4 与实时监测「修改」的关键区别

| | 实时监测 | 设备属性 |
| --- | --- | --- |
| 写入路径 | `/timeseries/ANY` | `/attributes/{SCOPE}` |
| 语义 | 新增一个时序点，不覆盖 | 覆盖同一个 key |
| 状态字段 | `editingKey` / `opSaving` | `attrEditingKey` / `attrSaving`（**不共用**） |

不共用状态的理由：在属性页点编辑、切回实时页还留着半个编辑框 ——
这种"状态串页"比功能缺失更难理解。

#### 24.5 缓存与刷新

- 三个作用域**各存一份**缓存，切换不重新请求（数据量小，来回切各请求一次反而慢）
- 切换**设备**时清空全部缓存（`resetAttributes`）——
  不清的话看完 A 的属性切到 B，显示的还是 A 的键值，而且界面上没有任何提示
- 手动刷新走工具栏「刷新」（`loadAttributes(scope, true)` 强制绕过缓存）
- key 排序固定：平台返回顺序不保证稳定，不排的话每切一次顺序就变一次

#### 24.6 部署与验证

```bash
bash shiyongshouce/downloads/scripts/31-deploy-widget.sh energy_device.ops_page --yes
```

改部件 JSON **不重启服务**，推库即生效（A1 铁律）。

实测（1920×1300，平台前端 8090，headless Chrome）：

```
页签          实时监测 / 历史参数 / 设备属性
服务端属性    10 条，首行 active=false / brand=宁波水表 / deviceType1=water_meter
切换按钮      服务端属性 10（高亮）· 客户端属性 · 共享属性 · 刷新
客户端属性    0 条 → 「这一档没有属性（客户端属性为空是正常情况，不是读取失败）」+ 说明条
编辑按钮      10 个，opacity 0（hover 才出现）
异常          无
写入链路      POST attributes/SERVER_SCOPE 200，lastUpdateTs 从 1793635461032 → 1795455370107
```

#### 24.7 顺手发现的既有问题（本轮未改）

该部件的「历史参数」页仍用了 `<tb-datetime>`。按 AGENTS.md A2d3，
`tb-datetime` 是 `standalone: false` 的 TB 组件，在 JIT 部件里会被当成未知元素 ——
DOM 在、高度 0、不报错。应换成自研的 `<energy-date-picker>`。
这属于另一个改动，未纳入本轮。

### 25 计划收尾：修误报 + 补 AI 动作落地 + 开户幂等验证（2026-11-24）

按「之前的计划还有没有没做的」清了一轮。下面每一条都是**先复现、再定性、再改**，
其中两条推翻了我自己上一轮的判断。

#### 25.1 部件「三段不一致」：一条是误报，一条是真的

`verify-deploy.mjs` 报 2 个部件不一致：`sankey_flow` / `sites_page`。

**根因（sankey_flow 是误报）**：`widget_type` 表**没有** `(tenant_id, fqn)` 唯一约束，
同一 fqn 可同时存在于系统租户与业务租户：

```
fba25340…  13814000-…（系统租户）  99842
4445f3c0…  709215f0-…（业务租户）  96865   ← 早期直接改库留下的副本
```

`dbDescriptors()` 的 SQL 没按 `tenant_id` 过滤，`map.set(fqn, …)` 后被覆盖的顺序
取决于 PG 返回顺序。于是**逐字段一致的部件被判成不一致**。

而 `31-deploy-widget.sh` 推的是**系统租户**（脚本 2026-11-15 就修过），
所以校验必须用同一口径 —— 否则会出现「推库成功了但自检说没成功」。

已修：`dbDescriptors` 与【4】的 `known` 集合都加 `tenant_id = <SYSTEM_TENANT_ID>`。

**sites_page 是真的落后**：源码比库多 1121 字符 controllerScript（网关支持实时/虚拟设备）。
已推库。修完：

```
【1】部件：源码 → 数据库           49 个，一致 49
【2】部件：源码 → 部署物料         49 个，内容不同 0
【3】看板模板：源码 → 部署物料      29 个，内容不同 0
━━ ✅ 三段链路全部一致
```

#### 25.2 ★ 纠正：`<tb-datetime>` 在这个部件里是正常的

我在 §24.7 写过「该部件的 `<tb-datetime>` 会变成未知元素、高度 0、不报错」——
**实测不成立，这条建议撤回。**

```
tb-datetime 高度 56px、宽 180px、内部 mat-form-field 已编译
点开花生：mat-datetimepicker-content 出现，内部 mat-datetimepicker-calendar
期间标签「十一月」，31 个可点单元格
选 15 号 → 输入框 2026-11-22 → 2026-11-15
           弹层自动关闭、曲线重绘（6 → 3 个图元）
           正确显示「所选日期没有数据」
```

**为什么我判断错了两次**：前两次用 `.mat-calendar` / `mat-calendar` 作判据，
而 `@mat-datetimepicker/core` 用的是 `mat-datetimepicker-calendar` ——
选择器写错就把「正常」读成「坏了」。

> 教训：A2d3 说的是「JIT 部件里**直接**用 `<tb-datetime>` 不行」。
> 这里的 `tb-datetime` 是**被 AOT 编译好的组件**，它的依赖在编译期已静态写入 ——
> 属于那条规则的例外，不是违反。判据必须是实测 DOM，不能是规则推断。

#### 25.3 ★ AI 动作落地：`applyAiActions` 从来没实现过

`AiBuildPanel` 的注释一直写着「前端收到后交给 `applyAiActions` 落进布局」，
但全仓库搜下来只有那一行注释。**后端即使返回 `actions`，界面也不会有任何变化。**

新增 `features/scene-editor/ai-actions.ts`（纯前端，不依赖 LLM）：

```
parseAiActions(raw) → 校验形状，认 {op:…} 与 {type:…} 两种写法
planAiActions(layout, ops, extension) → examineLayoutProposal 校验 + 算差异
```

三条硬规则：

| 规则 | 理由 |
| --- | --- |
| 不直接改布局，先出差异给人看 | 大屏改动立刻被现场看到，宁可多一次点击 |
| 整份接受或整份拒绝 | 部分应用会得到「一半新一半旧」，AI 说的话和布局对不上 |
| 操作白名单来自模板 `aiExtension` | 模板声明「这张大屏不许加卡」，AI 就不该能加 |

**形状不对必须报错，不能静默过滤**：过滤掉之后用户看到「AI 说改好了」但界面没变 ——
那是最难查的一类。所以报错时连「期望字段名」一起给出。

接入：`EditorShell` 传 `layout={sceneWidgets}` / `aiExtension={aiExtensionForScene}` /
`onApplyLayout={setSceneWidgets}`。`aiExtension` 取自布局的 `templateId` → 内置模板，
取不到时回落到代码默认值（查不到模板不该让 AI 完全不能动）。

**浏览器实测**（注入假回包，因为后端还没实现 `/api/ngx/ai/chat`）：

```
AI 面板打开                ✓
改动卡片                   `~ 修改卡片「场站用电趋势」(power-trend) 标题: 场站用电趋势 → 机组功率趋势`
                           `- 删除卡片「机组状态」(unit-list)`
应用前 / 后卡片数           7 → 6
标题真的变成               「机组功率趋势」，机「组状态」卡消失
状态提示                   「已应用到布局 · 记得点编辑器「保存」」
库未被改                    widgets=7，power-trend 标题仍是「场站用电趋势」★ 只在内存
```

最后一条是设计：AI 应用只改内存，落地必须点「保存」。

#### 25.4 ★ 开户脚本「开通失败」是误报 —— 两处断言过时

用 `09-onboard-customer.sh` 真实开了一个客户验证，脚本报：

```
! 拓扑只有 2 张，但场站有 3 个
! 客户名下仪表板只有 0 个
✗ 存在验证失败项 → 开通失败
```

但**客户实际完全正常**：

```
拓扑：3 张（与 3 个场站一致）        ← 脚本查早了，异步初始化未完成
菜单看板入口：26 个，逐个 GET → 26/26 HTTP 200
左侧菜单：13 项，第一项是 home
```

两个根因：

**① 拓扑查得太早**。建客户后的初始化是异步的。同一个客户，脚本读 2 张，
十几秒后是 3 张。而且原判据数的是 `/api/customer/{id}/assets` 里 `type=='topology'`，
口径本身也不对。

改为：走 `/api/energy/topologies?customerId=` 权威接口 + 最多等 30 秒。

**② 看板数按 `customer_id` 查，永远 0**。2026-11-13 起客户看板改成
「共享租户级看板」（客户明确要求：不要每个客户建一套同名看板）。
`/api/customer/{id}/dashboards` 按 `customer_id` 查，副本已不再创建，所以恒为 0。
客户的真实入口是左侧菜单，打开权限由 `checkDashboardIdOrAssigned` 按
`assigned_customers` 放行。

改为：数 `/api/tenant/dashboards` 里 `assignedCustomers` 含该客户的数量。

> 误报的「开通失败」比真失败更糟 —— 会让人以为开户坏了并重复执行脚本。

#### 25.5 开户幂等：实测通过

同一邮箱连跑 5 次，逐次校验：

```
客户          1 → 2（只多这一个）
该客户资产     3 场站 / 13 分项 / 3 topology / 12 场站分组 / 19 账单 … = 76
重名资产      0        ← 关键：没有重复建
重名设备      0        设备 39 台，跑 5 次仍是 39
看板总数      31（未变，共享不复制）
```

清理（`10-cleanup-customer.sh --yes`）也可用：

```
预检：39 台设备全部属于该客户、租户归属一致
删后：客户 / 资产 / 设备 / 看板 / 用户 全为 0
隔离：其他客户 217 个实体与租户级数据未受影响（1820255 个遥测点一个没少）
```

#### 25.6 顺手跑了 repair-init

`POST /api/energy/repair-init` → 200，`repaired=true`，耗时 85.6s：

```
labelsFixed 17 · assetTotalsFixed 30 · hvacCreated 22 · demoWindowFixed 1
其余项 0（说明本来就一致，没有需要补的）
```

#### 25.7 验证汇总

```
apps/web     tsc -b → 0 … vitest run → 811 通过 / 81 文件
             （新增 ai-actions 13 条）
iot-rule-engine  verify-deploy → 三段链路全部一致（49/49/29）
                 09-onboard-customer.sh → 客户已开通（全部 ✓）
                 10-cleanup-customer.sh → 清理完成，隔离校验通过
```

#### 25.8 仍然没做的（需要外部条件，不是遗漏）

| 项 | 卡在哪 |
| --- | --- |
| `POST /api/ngx/ai/chat` 后端 | 需要 LLM 接入决策（选哪家、密钥、计费）。**前端已就绪**，后端一接上就能用 |
| 「更新缩略图」真实产物 | headless 下 WebGL 未开 `preserveDrawingBuffer`，必然得到透明图 —— 那是**预期行为**，真浏览器里才成功 |
| 滑块指令真下发到设备 | 按项目约定「不对现场设备真下发验收」 |

### 26 AI 搭建接通 codewhale（2026-11-24）

客户最初的需求终于落地了：

> 「我希望开发一个 Chat 聊天对接 codewhale 代替命令行，看看有没有插件省去开发」

上一轮我给的结论是「零 AI 依赖，装插件省开发不存在」——
插件确实不存在，但**直接对接 codewhale CLI 是可行的**，我漏了这条路。
实测 `codewhale exec --json` 返回结构化 JSON，完全够用。

#### 26.1 链路

```
浏览器 AiBuildPanel
   │ POST /api/ngx/ai/chat
   ▼
nginx (energy-gateway)  ── /api/ngx/ai/ ──▶ 宿主机 127.0.0.1:8092
                                              │ spawn
                                              ▼
                                 codewhale exec --json --permission-mode plan
```

#### 26.2 为什么是宿主机上的独立进程

codewhale 是宿主机 CLI（Rust 二进制 + 用户自己的 API key）。
Java 后端在容器里：既没有这个二进制，也不该拿到用户凭据。

往容器里塞 Node + 用户密钥比多一个进程危险得多。

#### 26.3 ★ 踩到的第一个坑：进程被 shell 带走

`nohup node server.js &` 之后 curl 通了，但**下一条命令再测就 connection refused**，
日志里只有启动那三行。

不是代码问题 —— 后台进程挂在启动它的 shell 上，shell 退出时进程组被清理。
用户在自己的终端里跑也会这样（关掉终端就没了）。

解法：`install-service.sh` 注册成 **launchd（macOS）/ systemd（Linux）** 服务。
副作用是还白得了崩溃自愈和开机自启。

#### 26.4 ★ 第二个坑：launchd 里 node 版本不对

服务起来后每次对话都失败：

```
codewhale: Node.js 22 or newer is required for npm installation.
Current Node.js version is 20.12.2.
```

根因：codewhale 的 wrapper 是 `#!/usr/bin/env node`，按 PATH 找 node。
手工跑时 PATH 里是 nvm 的 v22；launchd 的 PATH 里 `/usr/local/bin/node` 是 v20，
而我把 nvm 目录放在了 PATH **最后**。

修：`dirname(node)` 放 PATH 最前。这条写进 README 的排查表。

> 教训：服务化之后「手工能跑」不再等于「服务能跑」。PATH、locale、
> 工作目录、HOME 都可能不同。要按服务环境验，不是按终端验。

#### 26.5 前后端契约

请求：

```json
{ "messages": [{"role":"user","content":"…"}],
  "context": { "name":"天骄科技园", "widgets":7, "bindings":13,
               "widgetList": [{"id":"power-trend","type":"trend-chart","title":"场站用电趋势"}] } }
```

响应：

```json
{ "content": "把「场站用电趋势」卡片改名为「机组功率趋势」。",
  "actions": [
    {"op":"update-widget","id":"power-trend","patch":{"title":"机组功率趋势"}},
    {"op":"remove-widget","id":"unit-list"}
  ],
  "model": "deepseek-v4-pro", "elapsedMs": 5993 }
```

`widgetList` 是这轮补的：不给 id↔title 对应关系，模型只能凭标题猜 id，
提案必然报「找不到卡片」，而用户看到的是「AI 改失败了」。

#### 26.6 安全边界（这一段比功能重要）

| 边界 | 做法 | 理由 |
| --- | --- | --- |
| 只读 | 固定 `--permission-mode plan` | AI 不改文件、不跑写命令 |
| 工作目录 | 每轮 `mkdtempSync` 空目录 | 即使换模式也读不到源码 |
| 鉴权 | `X-Ngx-Ai-Key`，`timingSafeEqual` | 必须监听 0.0.0.0（容器走宿主 IP），靠密钥兜底 |
| 并发 | 上限 2 | 每次是独立进程，并发放开会打满机器 |
| 超时 | 桥接 150s / nginx 180s | 让桥接先超时返回结构化错误，而不是 nginx 先断给个 504 |
| 注入 | `spawn(bin, [args])` 数组 | 用户输入里的引号/分号/反引号都只是普通字符 |

**没有让 AI 直接调用工具改布局**：那等于把平台操作权交给可能理解错需求的模型。
现在 AI 只产提案，提案过 `examineLayoutProposal`（16 条测试），
再由人点「应用到布局」。出错代价是一份被拒的提案，不是一次误操作。

#### 26.7 实测（真实模型，非 mock）

**接口层**：

```
POST /api/ngx/ai/chat "用一句话说明你是谁"
→ 200，5.4s，"我是「3D-NGX 工业三维数字孪生大屏」的搭建助手…"，model=deepseek-v4-pro

POST "把「场站用电趋势」改名，并去掉「机组状态」"
→ 200，6.0s
  actions: [{"op":"update-widget","id":"power-trend","patch":{"title":"机组功率趋势"}},
            {"op":"remove-widget","id":"unit-list"}]
```

**浏览器全链路**（真实输入 → 真实模型 → 点应用）：

```
网络        POST /api/ngx/ai/chat → 200（5.2s）
面板        3 条消息（欢迎 / 用户 / AI）
AI 回复      「已把「场站用电趋势」卡片改名为「机组功率趋势」。」
改动卡片      ~ 修改卡片「场站用电趋势」(power-trend) 标题: 场站用电趋势 → 机组功率趋势
应用前/后     7 张 → 7 张（改名不增删）
标题          有「机组功率趋势」，**没有**「场站用电趋势」★ 布局真的变了
状态          「已应用到布局 · 记得点编辑器「保存」」
```

#### 26.8 测试工具自身的坑（记下来别再踩）

第一次浏览器验证等了 124 秒没结果，最后一条消息还是欢迎语。

根因：脚本用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set`
赋值 —— **React 的受控组件不吃这一套**，onChange 不触发，
`send()` 里 `if (!text) return` 直接返回，请求根本没发出去。

改用 CDP `Input.insertText`（模拟真人输入）后立刻正常。

> 教训：验证 React 受控输入必须用真实输入事件，不能改 DOM value。
> 这个假失败让我差点以为桥接是坏的。

#### 26.9 交付物

| 文件 | 作用 |
| --- | --- |
| `shiyongshouce/downloads/ai-bridge/server.js` | 桥接服务（零依赖 Node） |
| `shiyongshouce/downloads/ai-bridge/start.sh` | 手工启停 / 状态 / 生成密钥 |
| `shiyongshouce/downloads/ai-bridge/install-service.sh` | 注册 launchd / systemd |
| `shiyongshouce/downloads/ai-bridge/wire-nginx.sh` | 幂等维护 nginx 配置块 |
| `shiyongshouce/downloads/ai-bridge/README.md` | 部署与排查 |
| `shiyongshouce/content/admin/02-deploy.md` | 手册新增一节 |
| `apps/web/src/features/scene-editor/ai-actions.ts` | 前端校验（上一轮） |
| `apps/web/src/services/scene/publish-scene-as-template.ts` | 「发布为模板」修正（上一轮） |

#### 26.10 验证

```
apps/web         tsc 0 · vitest 814 通过 / 81 文件（ai-actions 16 条）
桥接             node --check 通过 · /healthz 通
nginx            nginx -t 通过并重载
服务             launchctl 已加载，跨命令存活
端到端           真实模型 → 提案 → 应用 → 布局变化（见 26.7）
```

#### 26.11 仍然要你知道的

- **模型是 DeepSeek（codewhale 默认）**。要换供应商，在 codewhale 侧配，桥接不用改。
- **每次对话 5~20 秒**，取决于问题复杂度。前端有 loading，没有流式输出 ——
  要流式得改成 SSE，那是另一轮的事。
- **AI 只看得到 40 张卡片的 id/type/title**，看不到槽位和样式细节。
  所以它擅长「改名/增删/移动」，不擅长「把第 3 个槽位的遥测换成 X」——
  后者需要传完整 layout，prompt 会很大，效果未必好。

### 27 模板文件资源管理器（2026-11-24）

客户要求：

> 「把模版库里面加一个文件资源管理器功能，可以在线编辑模板的内容，除非不支持编辑那就算了」

结论：**支持，但只对文本类文件**。glb / zip 保持只读 —— 不是偷懒，是做了会毁文件。

#### 27.1 能改什么

判据是服务端的**扩展名白名单**（`EDITABLE_EXT`）：

```
css · js · mjs · json · md · txt · html · htm · svg · csv · map
```

glb / zip / 图片一律 `editable=false`，界面上标「只读」，点了只提示不打开。

**为什么用白名单而不是黑名单**：黑名单（排除 glb/zip）会让任何没预料到的二进制格式
（ttf、woff2、png、wasm）被当文本读进编辑器 —— 用户看到一屏乱码，
存回去原文件就废了，**而界面上看不出毁了**。

#### 27.2 后端（`iot-rule-engine`）

三个新端点，全部 `SYS_ADMIN / TENANT_ADMIN`（客户角色 403 已实测）：

```
GET  /api/energy/scene-templates/{id}/files                  文件清单
GET  /api/energy/scene-templates/{id}/files/content?name=x   读文本
POST /api/energy/scene-templates/{id}/files/content          覆盖写
```

**文件清单的数据来源是档案，不是对象存储的目录列举。**
本项目的 `S3ObjectStore` 只实现了 PUT/GET/HEAD/DELETE，**没有 LIST**。
硬加 ListObjectsV2 也能做，但没必要 —— 模板的 `additionalInfo` 里已经记录了
每个文件（`glb` 一项 + `styleFiles` 若干），那就是模板的全部内容。
按档案列比按目录列更准：目录里可能有上传失败的残留。

**★ 文件名 → objectKey 必须来自档案**（`findFileKey`）。这意味着：

- 传 `../../etc/passwd` → 档案里没有这个名字 → 404（已实测）
- 传一个不存在的新文件名 → 404，**不能通过编辑接口新建任意文件**

第二点是关键：模板目录会被实例化，能在里面凭空写一个同名 `model.glb`
就能劫持所有新场景的模型。

**写之前还有一道 `store.exists` 校验**：只允许覆盖已存在的对象。

#### 27.3 前端

`TemplateFileExplorer.tsx` + `.module.css`，从模板库卡片上的「文件」按钮打开。

布局：左侧文件列表（名称 + 可编辑/只读标签），右侧深色代码区（行号列 + TextArea）。

**没有引入 Monaco / CodeMirror**：项目里没有（`ProgramPanel` 也是 antd TextArea），
为这个功能引 3MB 编辑器不值得。行号列与文本框分离、同步 `scrollTop` ——
比「每行一个 div」省节点，而且 `wrap="off"` 时行号与内容行天然一一对应。

`autoCapitalize="off" autoCorrect="off"`：否则手机与部分浏览器会把 css 的
直引号改成弯引号、把 `.flex` 首字母大写 —— 样式直接失效且看不出原因。

#### 27.4 ★ 第一版用了 window.confirm，是错的

初版在「覆盖保存」和「有未保存改动时切换文件」两处用 `window.confirm`，
理由是「阻断式，任何弹框之上都能弹」。

实测两个问题：

| 问题 | 表现 |
| --- | --- |
| **同步阻塞 JS 主线程** | 确认框开着时页面里任何 pending 更新都不执行，看着像卡死 |
| **观感断裂** | 已有一层 antd Modal，再叠一个原生框，用户分不清 |

改用 `Modal.confirm` 包成 Promise（`confirmDanger`）。异步、不阻塞、同一套视觉。
`okButtonProps: { danger: true }` —— 不可撤销的覆盖操作，按钮外形要和「确定」分开，
否则会被下意识点掉。

> 这个改动也是被测试逼出来的：用 `window.confirm` 时 headless 里保存一直不落盘，
> 排查后确认是同步阻塞把 CDP 的推进卡住了。**换实现之后一次通过。**

#### 27.5 实测

**接口层（tenant 账号）**：

```
清单          files: [hud-override.css(pack,css,editable=true), model.glb(glb,editable=false)]
读 css        name=hud-override.css size=275，内容完整（中文注释正确）
读 glb        400「glb 格式不支持在线编辑（仅支持 css / csv / …）」
读 ../..      404「模板里没有这个文件：../../etc/passwd」★ 路径穿越被拦
写 css        200 ok=true size=217
写 glb        400「glb 格式不支持在线编辑」
写不存在      404「模板里没有这个文件：evil.js」★ 不能凭空新建
缺 content    400「缺少参数: content」
content=""    200 size=0  ★ 清空是合法操作，与「忘了传」区分开
客户角色      files=403 write=403
```

**浏览器（1600×1100）**：

```
模板库           2 张卡片，各有「文件」按钮
弹框标题         「模板文件 · 天骄科技园标准版」
文件列表         # hud-override.css [可编辑] / ◇ model.glb [只读]
点 glb           不打开编辑器（只提示）
点 css           188 字符、12 行、行号 12 个、保存按钮禁用（无改动）
改动后           保存可点、「未保存」标记出现
点保存           确认框：「覆盖保存 hud-override.css？」
确认后           保存按钮重新禁用、脏标记消失、确认框关闭
对象存储直查      /buckets/energy-waveform/…/style/hud-override.css  217 字节
内容             --ngx-panel-radius: 66px → 42px 已落盘
```

最后一行的 `weed shell` 直查是决定性的：改动**真的进了文件服务器**，
不是只改了前端状态。

#### 27.6 一个必须说清的语义

> 改动只影响**之后**从该模板新建的场景。已有场景已经拷走自己的副本，不会跟着变。

这条写在编辑器的底部提示里。不写的话，用户改完模板发现已有大屏没变，
会以为保存失败并反复重试（和 §24 里「共享属性改完设备没反应」是同类误判）。

#### 27.7 测试文件说明（2026-11-24 已删除）

为了验证「可编辑」路径，当时给「天骄科技园标准版」模板传了一个
`hud-override.css`（217 字节）。

**已于 §28.7 删除。** 原因是它里面的内容是刻意做的假值
（`--ngx-panel-radius: 42px`），本意是「改得明显一点好验证」。
但模板会被实例化 —— 留着它，新客户建出来的大屏就会带着 42px 圆角，
而且**看不出这是测试残留**。

教训：验证用的假数据不能留在会被下游消费的位置。
真要验证可编辑，应该写成一个语义正确的值，或者验完立刻删。

#### 27.8 验证

```
apps/web  tsc 0 · vitest 819 通过 / 81 文件（新增 scene-template-client 5 条）
后端      mvn package 0 · jar 已部署 · 容器 healthy
接口      8 个分支逐一实测（见 27.5）
UI        完整流程实测（见 27.5）
```

### 28 模板实例化闭环：客户可建场景 + 模型服务端搬运（2026-11-24）

客户要求：

> 「我都是 docker 部署运行的，你去验证一下模版库到模版实例化的整个逻辑是否正确，
> 是否是走文件服务器存储文件了，同时把天骄科技园的模版发布成模版，
> 然后在基于模版看能不能为新客户 AI 构建大屏」

结论：**闭环跑通了**，模型确实走对象存储、跨机器可渲染、AI 能基于模板构建。
过程中挖出 3 个「静默产出坏数据 / 没有反馈」的问题。

#### 28.1 ★ 一段被推翻的判断：客户不需要、也不应该能建场景

这一节原本写的是「客户建场景一直 403，是最严重的问题」，并据此把 `create`
放开到了 `CUSTOMER_USER`。**那个判断是错的，代码已撤回**（见 §30.1）。

错在哪：`CustomerScenesPage`（`/customers/:customerId/scenes`）是**租户**
管理客户场景的页面，不是客户自己的页面。`resolveAccess()` 里写得很清楚：

```ts
if (input.role === "customer" && isManagementPath(path)) return { type: "block" };
```

客户的落点永远是运行态（`routes.runtime`，见 `homePath` / `postLoginPath`），
页面副标题也写着「客户打开后只会进入默认场景，看不到本页」。
`access.test.ts` 早就有断言钉着这件事。

所以「新客户的大屏」是**租户代建**，不是客户自助。把 `create` 放开给客户，
等于开了一个没有前端入口、也没有产品意图的写通道。

实测（撤回并重新部署后）：

```
客户 POST /api/energy/topologies   → 403   ← 正确
租户 POST /api/energy/topologies   → 200
客户 GET  /api/energy/scene-template-options → 200  ← 只读、脱敏、无 objectKey
```

**留下来的一课**：判断「界面有按钮、后端 403 就是 bug」之前，先确认
**那个界面到底给谁看**。`requireSite()` / `resolveCreateCustomerId()`
里那些 `isCustomerUser()` 分支不是为「客户自助建场景」准备的，
而是为租户代建时算归属用的。

#### 28.2 ★ 客户上传模型 403，链路断在中间

原链路是「客户端下载模板模型 → 再上传成场景模型」。而上传端点
（`POST /api/energy/topology-assets`）同样只给租户。实测客户身份：

```
GET  /api/energy/scene-template-options/{id}/model   → 200（10,113,456 字节，glTF v2）
POST /api/energy/topology-assets?kind=glb&siteId=…   → 403
```

后果是**场景建出来了但没有模型**，而且前端还会把它报成
「模板模型下载失败」—— 下载明明成功了，报错指错了方向。

修法不是放宽上传权限（那会让客户能往任意 key 写对象），而是
**让选了模板的客户根本不需要上传**：服务端自己搬。

```java
// applySceneMeta：body 没有 glb、但 ai 里有 templateId、且 topologyId 已知
if (!ai.has("glb") && topologyId != null && !topologyId.isBlank()) {
    ObjectNode fromTemplate = copyModelFromTemplate(tenantId, ai, topologyId);
    if (fromTemplate != null) { ai.set("glb", fromTemplate); }
}
```

要点：

| | |
| --- | --- |
| 源 | 模板档案里的 `glb.objectKey`（`scene-template/{tenant}/{tid}/model.glb`） |
| 目标 | `topology/{tenant}/{topologyId}/model.glb` |
| **只复制、不删源** | 用 `promote()` 会把模板模型搬走，第二个客户就 404 |
| 档案留痕 | 写入 `fromTemplate`，能看出这个场景的模型来自哪个模板 |
| 失败就保持「无模型」 | 不写一个指向空对象的假档案 |

**同名函数的坑（已修）**：`copyModelFromTemplate` 里 `byte[] data` 声明在 `try` 内，
而 `n.put("size", data.length)` 在 `try` 外 —— 编译期就报错，不会带到线上。
记这一条是因为它正好说明「编译器能拦的错就别靠 review」。

**显示名用模板名，不用档案里的 fileName**：模板档案里的 `fileName` 常是
`model.glb`（上传默认名，零信息量）。照抄过去，客户在场景里看到「模型：model.glb」，
认不出是哪个模板来的 —— 而他可能同时有十几个场景。实测现在给出的是
`冷热站标准版.glb`。

#### 28.3 文件名被压成 `_____.glb`（历史脏数据）

`safeFileName` 曾用 `[^A-Za-z0-9._-]` 把中文全换下划线。上传侧已改为
「路径 ASCII、显示名保留中文」，但**已经存进去的不会自己变**：

```
冷热站标准版    glb.fileName = _____.glb      ← 库里至今是这样
天骄科技园      glb.fileName = _____.glb      ← 场景侧同样
```

修法：读取时按实体名重建，不动库。

```java
public static String repairFileName(String raw, String fallbackName, String defaultName)
```

**只改显示名，objectKey 一个字不动** —— 所以读多少次都安全，也不影响下载/渲染。

**★ 抽成公共函数的原因（这条是踩出来的）**：第一版只改了
`writeSceneMeta`（模板列表 / 场景详情走它），结果「模板卡片显示正常、
点进文件资源管理器还是 `_____.glb`」—— 而文件资源管理器恰恰是用户
唯一会盯着文件名看的地方。`listFiles` 走的是 `addFileEntry`，两处各写一份
就一定会漂移。现在两处调同一个 `repairFileName`。

#### 28.4 前端「发布为模板」没有任何进行中反馈

实测这个按钮的操作序列是：`PUT scene-bindings` → `PUT scene-widgets`
→ `POST scene-templates` → **上传 10MB 模型** → `POST scene-templates/{id}` → `publish`。

原实现全程零提示，按钮点下去像没反应。用户会以为坏了并反复点 ——
**重复建出多条同名模板**（我实测时就撞出了两条「天骄科技园」）。

已加 `message.loading(...)`，并在 `finally` 关闭。注意**不能只在成功分支关**，
抛错时也必须关，否则 loading 会一直转。

顺带纠正一个我自己的误判：一度以为 antd 的 toast 不渲染。实际是
**我的探测脚本选择器错了** —— antd 6 里 notice 文本直接挂在
`.ant-message-notice` 上，没有 `-content` 子元素。抓真实 DOM 才看到：

```
ant-message-notice ant-message-notice-loading   → 正在发布为模板：…
ant-message-notice ant-message-notice-success   → 已发布为模板：模型与风格套装已存入平台文件服务器…
```

整个流程实测 **6 秒**走完（模型已在浏览器缓存中）。

#### 28.5 AI 面板欢迎语说「当前为未接通状态」

桥接早就接通了（`/api/ngx/ai/chat` 200），但那句静态欢迎语还写着
「需要后端接通后才能回答（当前为未接通状态）」。它和紧接着出现的
真实规划结果自相矛盾，用户不知道该信哪个。

已改为只说「怎么用」和「会先给方案」，能不能用让实际请求说话。

#### 28.6 端到端验证（模板 → 新客户场景 → AI 构建）

全部实测，不是推演。**执行者是租户**（客户代建模型，见 §28.1）：

| 步骤 | 结果 |
| --- | --- |
| 客户（`demo@126.com`）读模板清单 | `200`，2 个模板，**不含 objectKey** |
| 客户下载模板模型 | `200`，10,113,456 字节，`file` 确认为 glTF v2 |
| 租户建场景（只传 templateId） | `200`，`glb.fromTemplate` 有值，`size` 10.1MB |
| 对象存储落地 | `topology/{tenant}/{id}/model.glb` 存在；**模板源仍在** |
| 浏览器渲染 | 日志 `已为 94 段 GLB 动画挂载播放器（68 个节点）`；截图见 9 台模块机 + 2 台泵 + 管道 + PLC 柜 |
| 布局骨架 | HUD「画面上的卡片位是配置好的，缺的是数据」——模板→内置布局映射生效 |
| AI 规划 | `POST /api/ngx/ai/chat` `200`，给出 2 处改动（整屏标题 + 趋势卡） |
| 应用到布局 | 卡片数 **0 → 2**，标题变为「园区冷热站运行总览」 |

AI 的一个好行为值得记：它主动说「当前场景 0 条设备绑定、上下文未提供
『机组功率』的遥测键，趋势卡暂不绑定数据」—— 没有假装绑定成功。

#### 28.7 清理与更正

- 「天骄科技园」场景已发布为模板（名称「天骄科技园标准版」`986c2ac0`），
  实测模型 10.1MB 落在 `scene-template/{tenant}/986c2ac0…/model.glb`
- 验证中产生的 2 个测试场景（`dcd2c430` / `53fa7580`）已删除；
  对象存储里留下**空目录**（`total 0`），SeaweedFS 删文件不删父目录，无害
- **§27.7 更正**：为验证在线编辑加的 `hud-override.css` **已删除**。
  它的内容里有刻意改的假值（`--ngx-panel-radius: 42px`），留着会被
  新客户实例化时当真实样式消费 —— 那种「测试数据进入生产」比没有测试文件糟得多

#### 28.8 验证命令与结果

```
后端  EnergySceneFileNameRepairTest        9 通过
      EnergySceneModelFromTemplateTest     9 通过
      mvn package 0 · jar 已部署 · 容器 healthy
前端  tsc 0 · vitest 826 通过 / 82 文件
接口  客户建场景 403（正确，租户代建）；客户读模板清单 200（只读脱敏）
UI    toast 捕获、发布为模板、AI 应用布局、新场景渲染
```

### 29 尚未解决的问题（诚实清单）

这轮把「新客户能不能自己建大屏」跑通了，但下面这些还没做完，
不写出来下次又会当成「已实现」：

1. ~~前端仍走「下载 10MB → 上传 10MB」~~ —— **已修（见 29.1）**。
2. ~~客户在这条前端链路上仍是坏的~~ —— **已修（见 29.1）**。
3. **缩略图**：headless 下 WebGL 未开 `preserveDrawingBuffer`，
   抓出来必然透明 —— 环境限制，未解决。
4. **场景删除后的空目录**：SeaweedFS 行为，功能上无害，没有清理任务。
5. **模板发布不带走布局**（§22.4 的约定）：AI 构建需要用户再走一步。
   这是设计选择，不是缺陷，但客户容易误以为模板自带大屏。
6. ~~客户身份下「上传模型」控件仍显示~~ —— **前提不成立，撤销**：
   客户进不到这个向导（§28.1），控件对客户不可见，无需隐藏。

#### 29.1 前端改为「下载照旧、上传跳过」

`CreateSceneWizard` 新增 `fileFromTemplate` 状态：

| 来源 | 上传吗 | 为什么 |
| --- | --- | --- |
| 从模板下载 | **否** | 服务端 `copyModelFromTemplate` 会复制 |
| 用户手动选文件 | 是 | 内容可能被用户改过，只能他自己传 |

**但下载不能省**：`parseHmiGlb` 要靠模型算出可连对象清单，
那是编辑器做绑定的前提（新场景截图里「可选 109 个对象」就是它算出来的）。
所以是「读照旧、写跳过」。

> 这条修正的价值与身份无关：**租户**建场景也同样省掉一次
> 「10MB 下载后再 10MB 上传」。当初是在排查客户 403 时顺手发现的，
> 但它本身就是合理的 —— 模型已经在服务器上了，没必要绕浏览器一圈。

实测（租户身份，走客户场景管理页 → 新建场景 → 选「冷热站标准版」→ 提交）：

```
MUTATIONS  = [POST /api/energy/topologies, PUT …/scene-widgets]
HAS_UPLOAD = false                       ← 没有任何 POST /topology-assets
toast      = 「已创建场景并记下场站/拓扑引用」
```

建出来的场景：`glb.fileName = 冷热站标准版.glb`、`size = 10113456`、
`fromTemplate = 134b61b0…`，对象在 `topology/{tenant}/52243540…/model.glb`。

**顺带修掉的过时文案**（两处都写于「客户端上传」时代）：

- 模板中心底部：~~「新建场景时按需下载到本场景」~~
  → 「由服务端复制一份到该场景名下，之后改模型不会影响模板本身」
- 这个区别对用户有意义：复制之后场景与模板是两份独立对象。

#### 29.2 上传失败按原因分文案

`describeUploadFallback` 原来忽略入参，一律说「仅保存在本机 IndexedDB」。
403 是**身份限制**，与环境问题混在一起说，用户只会反复重试注定失败的操作。

现在 403 → 「当前身份不能上传模型（只有租户可以）。请改选平台模板 ——
模板里的模型会由服务端自动复制到新场景。」其余状态仍走存储降级文案。

配两条单测钉住这两档（`create-scene-messages.test.ts`）。

### 30 让 AI 真的能绑数据（2026-11-24 第二轮）

客户要求：

> 「接受建议继续开发计划没完成的」

上一轮把「模板 → 新场景 → AI 加卡片」打通了，但 AI **一次也没成功绑过数据**。
它给出的理由很准确：「当前场景 0 条设备绑定、上下文未提供『机组功率』的遥测键」。

#### 30.1 先撤回一个误判（比新功能更重要）

上一轮我把 `POST /api/energy/topologies` 放开到了 `CUSTOMER_USER`，
理由是「客户侧页面挂着新建场景按钮，点了 403」。**这个理由是错的**，
已撤回并重新部署（细节见 §28.1）。

复核方法值得记：判断「界面有按钮 + 后端 403」是不是 bug，先问
**那个界面给谁看**。`resolveAccess()` 一行就否定了整条推断：

```ts
if (input.role === "customer" && isManagementPath(path)) return { type: "block" };
```

撤回后实测：客户建场景 `403`、租户建场景 `200`、客户读模板清单 `200`。

#### 30.2 根因：上下文缺两样东西，AI 只能猜

`bind-telemetry` 要两个参数，AI 都不知道：

| 缺少 | 后果 |
| --- | --- |
| 卡片的**槽位键**（`slotKey`） | 猜错就是 `slot-not-found`，**整个提案被整体拒绝**（提案不做部分应用） |
| 场景里**真实存在的遥测键** | 编一个键名，大屏上永远是空值 —— **而且不报错** |

原来只传了 `id / type / title`。标题和槽位键毫无关系（`main` / `limit` / `series-0`），
模型没有依据，只能猜。

#### 30.3 修法：新增 `ai-context.ts`，从场景文档推导

```ts
buildAiSceneContext({ document, layout }): AiSceneContext
  ├─ widgetList:  [{ id, type, title, slots:[{key,label,unit,telemetryKey}] }]
  ├─ telemetryKeys: [{ key, label, unit, deviceCount }]   ← 从 bindings 推导
  └─ devices:      [{ id, name }]                          ← 从 bindings 推导
```

三个决定：

**① 遥测键只从「已有绑定」推导，不额外查平台。**
那些绑定是用户配好、正在刷数的，所以键**一定真实存在**。
反过来「问平台有哪些键」要按设备逐个查 —— N+1，而这个是每次打开面板都要跑。

**② 新场景（0 绑定）如实给空，并让模型说清楚。**
prompt 里明写：

```
【可用遥测键】无。本场景还没有任何设备绑定，不知道设备上报哪些键。
涉及数据的改动请在 content 里说明「需要先在绑定面板配好设备」，
actions 只做不依赖数据的部分。
```

不给它留「努力编一个」的余地。空清单是**正确**的状态，不是缺陷。

**③ 都限量**（40 卡 / 12 槽位 / 60 键 / 24 设备）。
prompt 有成本，而且大段清单会让模型忽略真正的指令。

#### 30.4 桥接 prompt 同步扩展

`ai-bridge/server.js` 的 `buildPrompt` 增加三段，并在「硬性规则」里钉住：

```
【现有卡片】（id | 类型 | 标题）
  power-trend | trend-chart | 机组功率趋势
      槽位 main（标签「功率」，单位 kW，已绑 power）
      槽位 limit（标签「上限」，单位 kW，未绑）
【可用遥测键】（只能从这里挑，不要编）
  power（标签「功率」，单位 kW，9 台设备有）
【可绑定设备】（id | 名称）
```

规则新增：

- `slotKey` 必须是上面列出的该卡片槽位之一
- `telemetryKey` 只能从【可用遥测键】里挑，`deviceId` 只能从【可绑定设备】里挑
- 【可用遥测键】为空时说明原因，不要用占位键名凑提案

**踩到的坑**：这些规则写在 `SYSTEM_PROMPT` 模板字符串里，第一版用了 Markdown
反引号包 `bind-telemetry` —— 反引号提前结束了模板字符串，`node --check` 直接报错。
改用中文引号即可。

#### 30.5 实测（两段，都是真实数据）

**桥接层**（curl 直打 8092，绕过前端）：

```
输入：把 power-trend 卡片的『上限』槽位绑到 power 这个遥测键上，用第一台设备
输出：{"op":"bind-telemetry","id":"power-trend","slotKey":"limit",
       "telemetryKey":"power","deviceId":"dev-aaaa"}
```

`slotKey` 精确取到了 `limit`（不是猜的 `main`），`deviceId` 是清单里的真实 id。

**浏览器端到端**（天骄科技园，13 条绑定 / 7 张卡）：

输入「把 plant-capacity 这张卡的『制冷量』槽位绑到 water_in_temp 遥测键」后，
AI 输出：

> 将「碳排放核算」卡（plant-capacity）的「制冷量」槽位（main）绑定到遥测键
> water_in_temp（进水温度）。**提示：该槽位原标注单位为 kW，而进水温度单位为 ℃，
> 两者语义不一致，请确认后再应用。**

这句提示是它自己加的，没人要求。**它没有因为「键存在」就假装合适** ——
这正是我们想要的行为。

应用并保存后查平台：

```
plant-capacity  槽位 main   telemetryKey = water_in_temp     ← 真的写进去了
```

**已还原**：这个绑定语义不对（制冷量 kW 绑到水温 ℃），验证完即把
`main.telemetryKey` 清空，天骄场景恢复原样（三个槽位均未绑）。

#### 30.6 顺带修掉：保存提示与事实相反

验证 AI 绑定时发现的：点「保存」提示 **「已保存到本地」**，而同一时刻
`persist()` 已经 `PUT` 了两个接口到平台：

```
PUT /api/energy/topologies/{id}/scene-bindings
PUT /api/energy/topologies/{id}/scene-widgets
toast = 「已保存到本地」        ← 与事实相反
```

后果不只是文案不雅：用户以为没入库，会反复点保存；或者反过来，
换台机器发现改动还在（其实是有），从此不信保存按钮。

修法：判断落点后再说。判据是 `persist()` 自己算出来的 `persistence.available`
（`saveSceneWidgets` 成功返回 `source: "platform"`，否则 `"local-draft"`），
抽成纯函数 `describeSaveTarget()` 以便单测：

```ts
available ? "已保存到平台" : "已保存到本机草稿"
```

> **已于 §31.1 完成浏览器复验**：点击保存后提示「已保存到平台」，
> 同时抓到 `PUT /api/energy/topologies/{id}/scene-widgets`。

#### 30.7 验证

```
前端  tsc 0 · vitest 849 通过 / 84 文件（新增 ai-errors 6 条）（ai-context 12 条 + 保存文案 3 条）
桥接  node --check 通过 · 已同步到 ~/energy-app/ai-bridge/ 并 launchd 重启
后端  jar 重新打包部署 · 容器 healthy
权限  客户建场景 403 / 租户建场景 200 / 客户读模板清单 200
复制  租户建场景带 templateId → fileName「冷热站标准版.glb」· 10,113,456 字节
AI    桥接层与浏览器端各一次真实 bind-telemetry，slotKey 取自真实槽位
数据  天骄场景 7 卡 / 标题原值 / plant-capacity.main 已还原为未绑
```

#### 30.8 仍未做的

1. **AI 不知道「槽位该绑哪个键」的语义**。它只能从标签和单位上做弱判断，
   实测会主动提示单位冲突，但不会拒绝。更强的做法是把
   `telemetryKeys[].label` 与槽位 `label` 做匹配排序后再喂给模型 —— 没做。
2. **新场景仍然是 0 绑定**，AI 只能加卡片。要从模板带出绑定，
   需要模板里存「设备槽位 → 遥测键」的映射，而模板刻意不含实例数据（§22.4）。
   这是个产品决策，不是技术债 —— 但值得和客户确认「新客户到底希望 AI 帮到哪一步」。
3. 缩略图 headless 透明、SeaweedFS 空目录两条维持原状（环境/存储行为）。

### 31 身份校验补全 + 两个真 bug（2026-11-24 第三轮）

客户要求：「有问题继续处理问题」。

#### 31.1 先闭环上一轮的未验证项

上一轮「保存提示改成『已保存到平台』」只用单测覆盖，浏览器没验成。
这次做完了 —— 卡住的根因也不是产品问题：

**headless 里 `Input.insertText` 会被静默丢弃。** 焦点在 DOM 上
（`document.activeElement` 确实是输入框），但浏览器认为整页未被聚焦，
注入的文字进不去 React 状态。两种写入方式都失败：

```
FOCUS_OK = "ai-input"      ← 焦点确实在
A_VALUE  = ""              ← insertText 没进去
B_VALUE  = ""              ← prototype setter 也没进去
SEND_BTN = {disabled: true} ← 因为 draft 为空
```

加两行就好：

```js
await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
await send("Page.bringToFront", {}, sessionId);
```

> 上一轮我两次以为「AI 桥接超时了」，实际是**这个**。
> 桥接实测只要 4~7 秒。教训：探针里输入为空时应该**立刻报错退出**，
> 而不是继续点一个 disabled 的按钮、再干等 200 秒—— 那会把测试工具
> 的缺陷伪装成产品故障，还会让我去查根本不存在的问题。

复验结果：

```
DIRTY_BTN   = "保 存"          ← 制造 dirty 成功
SAVE_TOAST  = "已保存到平台"    ← 新文案生效
SAVED_NET   = ["PUT /api/energy/topologies/..."]  ← 提示与事实一致
```

#### 31.2 ★ 真问题：AI 接口没有任何身份校验

**这个比前两轮修的都严重。** 实测（改之前）：

```bash
curl -X POST http://127.0.0.1:8090/api/ngx/ai/chat \
     -H 'Content-Type: application/json' \
     -d '{"messages":[{"role":"user","content":"hi"}]}'
# → 200，{"content":"你好！我是 3D-NGX 的...","model":"deepseek-v4-pro"}
```

不带任何登录凭据、不带密钥，直接拿到完整的 AI 回答。

**为什么会这样**：nginx 给这条路径**无条件**注入 `X-Ngx-Ai-Key`。
那个密钥的设计意图是「证明请求来自自家网关」，它确实做到了 ——
但它挡不住「任何能访问 8090 的人」，因为 nginx 会给**所有**到达
这条 location 的请求都盖上这个章。

**后果**：这是台给客户用的机器，codewhale 花的是用户自己的模型额度。
任何能碰到 8090 的人（局域网、误暴露的公网）都能免费调用。

**修法**：加第二道闸门，让桥接自己去问平台「调用者是谁」。

```js
// ai-bridge/server.js
const PLATFORM_BASE = process.env.NGX_AI_PLATFORM || "http://127.0.0.1:8090";
const ALLOWED_AUTHORITIES = ["TENANT_ADMIN", "SYS_ADMIN"];

async function verifyCaller(req) {
  const token = String(req.headers["x-authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "未授权：缺少平台登录凭据…" };
  const res = await fetch(`${PLATFORM_BASE}/api/auth/user`, {
    headers: { "X-Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, status: 401, error: "登录已失效…" };
  const user = await res.json();
  if (!ALLOWED_AUTHORITIES.includes(String(user?.authority || ""))) {
    return { ok: false, status: 403, error: `只有租户管理员可以使用 AI 搭建（当前身份：${...}）` };
  }
  return { ok: true, user };
}
```

三个细节：

| 细节 | 为什么 |
| --- | --- |
| 用 `X-Authorization` 而非 `Authorization` | 全站都是这个头（见 `guard-client.ts`），用标准头会读到空值 |
| 把 401/403/503 分成三种文案 | 用户处置完全不同：重登 / 找管理员 / 找运维 |
| 平台不可达时返回 503，**不放行** | 宁可不可用，也不留一条绕过校验的路 |

前端同步带上凭据（`getConnectedGuardClient()?.getState().token`），
nginx 显式 `proxy_set_header X-Authorization $http_x_authorization`。

**四态验证**（直连 8092 与经 nginx 各一遍，结果一致）：

| 凭据 | 结果 |
| --- | --- |
| 无 | `401` 未授权：缺少平台登录凭据 |
| 伪造 token | `401` 登录已失效（平台返回 401） |
| 客户 `CUSTOMER_USER` | `403` 只有租户管理员可以使用 |
| 租户 `TENANT_ADMIN` | `200` 正常返回 |

浏览器回归：`hasAuth: true` → `200` → 计划卡正常生成。

#### 31.3 ★ 真问题：`wire-nginx.sh` 根本跑不通

```
ai-bridge/wire-nginx.sh: line 205: NGINX_CONF�: unbound variable
```

原因：`green "  ✓ 已写入 $NGINX_CONF（原文件已备份…"`——
**bash 把后面那个全角括号当成了变量名的一部分**，于是变量变成
`NGINX_CONF（原文件…`，配合 `set -u` 直接报 unbound。

`$VAR）` 这种写法在中文环境里是**系统性陷阱**：
中文标点紧贴变量名，bash 不会把它当分隔符。全仓扫出两处：

```
wire-nginx.sh:205       $NGINX_CONF（   ← 跑不通
install-service.sh:152  $LABEL）        ← 同样
```

修法：`${NGINX_CONF}` / `${LABEL}` 加花括号。

**为什么这条要紧**：这是「装 AI 桥接」的第 3 步（接进 nginx）。
脚本跑不通 = 部署文档断档（AGENTS.md A2h）。
而它的表现是「一行报错后什么都没发生」，很容易被当成环境问题。

修完实跑通过：

```
✓ 已写入 /Users/cuijinlong/energy-app/nginx/energy.conf（原文件已备份 .bak-*，权限 600）
nginx: signal process started
✓ nginx 校验通过并已重载
```

#### 31.4 桥接必须监听 0.0.0.0 —— 不能收紧

顺手查了暴露面：`lsof` 显示 `*:8092`，局域网 `192.168.31.198:8092/healthz`
返回 200。看着像配置失误，但**不能改**：

```
nginx 容器 ── host.docker.internal:8092 ──▶ 宿主桥接
```

绑 `127.0.0.1` 容器就访问不到。所以这层靠 ② 的共享密钥挡住
（48 位十六进制随机串）。已在 README 里写明这个取舍，
免得下次有人「顺手收紧」把 AI 弄挂。

#### 31.5 ★ 顺带修好：手册自检的 12 项长期形同虚设

跑 `check-docs.py` 发现它一直在报 12 项 `[Errno 2]`，而脚本仍以 0 退出：

```
资产档案     提取失败  [Errno 2] No such file or directory   ERR
设备档案     提取失败  [Errno 2] ...                          ERR
...（共 12 项）
```

**根因是两层目录漂移**：

```python
# 原代码
GS = REPO / 'guard-server' / 'src' / 'main'      # 少了模块层
JAVA_INSTALL = GS / 'java' / '...' / 'install'
```

实际结构早已拆成 `guard-server/guard-core/`、`guard-energy/`、`guard-app/`。
更细的一层：`service/install/` 这个包**被拆到两个模块**：

```
guard-core/.../service/install/    AssetProfileInstaller
guard-energy/.../service/install/  EnergyMenuInstaller、DeviceRuleInstaller、…
```

所以只把路径加一层模块名还不够 —— 5 项仍然 404。

**为什么这条比「少 12 项检查」更糟**：`✗ 12 项不一致` 长期存在，
人就不看了。AGENTS.md 把 `check-docs.py` 列为发版前必跑，
一旦变成噪音，“手册与代码不许断档”这条铁律就失去了执行手段。

修法：

```python
def _locate(*rel):        # 先试老路径，再在各 guard-* 子模块里找
def _java_file(name):     # 按文件名找 —— install 类属于哪个模块是细节
```

修完 12 项 ERR 归零，**并立刻暴露了一个真实的断档**：

```
标准 key 总数   代码 165   手册 155    DIFF
```

电能 140 两边一致，差在非电能品种（15 → 25）。多出来的 10 项是
热泵/HVAC 机组点位（`water_in_temp` / `compressor_state` / `sys_run_state` /
`sys_setpoint` / `pump_freq` / `alarm_code` …），与上一轮实测到的遥测键吻合，
属于真实业务扩展。已把手册 5 处 `155` 改为 `165`，并补上构成明细：

```
标准 key **165** 个（电能 140 / 环境 12 / 热力 6 / 水 4 / 蒸汽 2 / 燃气 1）
```

现在 `check-docs.py` **13 项全 OK**，`sync.sh` 两处 110 个文件完全一致。

> 这 12 项 ERR 不是本轮引入的，是长期存在。发现它纯属偶然 ——
> 因为我要改手册里 AI 章节的过时说法，顺手跑了自检。
> 「跑一下再说」在这类工具上几乎总有回报。

#### 31.6 ★ 顺带修好：前端把 401 报成「后端未接通」

加上身份校验后，又牵出一个**旧假设留下的误导**。前端原来这么写：

```ts
if (!res.ok) {
  throw new Error(`后端未接通（HTTP ${res.status}）。需要平台实现 ${ENDPOINT}…`);
}
```

那是「后端还没实现这个路由」时的文案。现在 401 / 403 / 503 都是
有明确含义的业务错误，却仍被说成「需要平台实现路由」—— 用户会去提需求，
而实际要做的只是重新登录。

改法：**先读服务端的说法，再按状态码兜底**。

```ts
let serverError = "";
try { serverError = (await res.json())?.error ?? ""; } catch { /* 非 JSON，如 nginx 502 页 */ }
throw new Error(describeAiFailure(res.status, serverError));
```

`describeAiFailure` 优先返回桥接给的 `error`（那是照着「下一步做什么」
写的），没有才按码兜底；404 保留旧文案（它确实最常意味着路由不存在）。

> 前端再编一套说法，两边迟早不一致 —— 能读到服务端的就用它的。

**UI 层实证**（CDP `Fetch.fulfillRequest` 伪造 401）：

```
UI: 系统 未授权：缺少平台登录凭据。请先登录 3D-NGX 再使用 AI 搭建。
HAS_ERROR_STYLE: 1        ← 有错误样式，不是普通回复
```

不再是「后端未接通」。单测另覆盖 6 种情形（含「空白 error 不算有说法」）。

#### 31.7 手册同步（AI 章节三处过时）

加了身份校验之后，手册 `02-deploy.md` 的 AI 章节有三处会**直接误导读者**：

| 位置 | 旧内容 | 后果 |
| --- | --- | --- |
| 验证 | curl 不带凭据 | 照抄 → 401，以为装坏了 |
| 安全边界 | 只写 `X-Ngx-Ai-Key` | 读者以为密钥就是全部鉴权 |
| 排查 | 无 401/403/503 条目 | 遇到新错误码无从下手 |

都已补。排查表新增 4 条，其中一条是 `wire-nginx.sh` 的
`unbound variable`（§31.3），写明「旧版脚本 bug，已修」。

#### 31.8 验证

```
前端  tsc 0 · vitest 843 通过 / 83 文件
桥接  node --check 通过 · launchd 重启 · /healthz ok
脚本  bash -n 三个脚本全部通过 · wire-nginx.sh 实跑成功
接口  直连 8092 与经 nginx 各 4 种身份，结果一致
浏览器 hasAuth=true → 200 → 计划卡生成（未应用，数据未动）
数据  天骄场景 7 卡标题未变
自检  check-docs.py 13 项全 OK（原 12 项 ERR + 1 项 DIFF）
手册  sync.sh 两处完全一致（110 个文件）· 未推送（见下）
部署  verify-deploy.mjs 三段链路一致
```

> **手册未推送**：`sync.sh` 只把文件拷进本地 `guard_help/`，
> 它不 commit、不 push。推到 Cloudflare Pages 属于对外发布，
> 按规矩留给用户决定：
> `cd ~/Documents/workspace/guard_help && git add -A && git commit -m 'update manual' && git push`

#### 31.9 仍未做的

1. **AI 不懂「槽位该绑哪个键」的语义**（上轮 §30.8 第 1 条，未做）。
2. **新场景 0 绑定** → AI 只能加卡片。需产品决策。
3. 缩略图 headless 透明、SeaweedFS 空目录（环境/存储行为）。
4. `X-Authorization` 每次请求都去平台验一遍（约 10ms）。
   量小时不值得加缓存；真要优化可以按 token 前缀做短 TTL 缓存 —— 没做。

### 32 遥测从轮询换成 WebSocket 推送（2026-11-24）

前一轮查到：`subscribeTelemetry` 名字叫订阅，实际是 `setInterval(3000)` 轮询
`values/timeseries`。14 台设备 = 每 3 秒 14 个请求，一天几十万次，
而绝大多数返回的是同一份没变的数据。

平台本身有 WebSocket（`/api/ws`），推的就是「有变化才发」。

#### 32.1 协议是实测出来的，不是照文档写的

**握手**：`ws://host/api/ws?token=<平台令牌>` → `101 Switching Protocols`
（经 nginx 与 Vite 代理都通）。

**★ 订阅命令是 v2 格式，不是老的 `tsSubCmds`**：

```json
{ "cmds": [{ "type": "ENTITY_DATA", "cmdId": 1, "query": {
    "entityFilter": { "type": "entityList", "entityType": "DEVICE", "entityList": ["<id>"] },
    "pageLink": { "pageSize": 10, "page": 0, "textSearch": null, "sortOrder": null },
    "entityFields": [],
    "latestValues": [{ "type": "TIME_SERIES", "key": "sys_run_state" }]
} }] }
```

用老格式会收到：

```
{"subscriptionId":1,"errorCode":2,"errorMsg":"Failed to parse the payload"}
```

**★ 一次订阅只能拿「显式列出的键」**。实测 `latestValues: []` 返回空 ——
平台不会替你「全拿」。所以订阅前得先把每台设备的键查出来（复用 `telemetryKeyCache`）。

**★ 每台设备一个 cmdId，全部塞进同一个 `cmds` 数组发一次**。
实测 2 个 cmd 各自独立回包，互不影响，比逐台建连接省得多。

#### 32.2 实现

新增 `packages/data-adapter/src/ws-telemetry.ts`：

| 导出 | 作用 |
| --- | --- |
| `toWsUrl(baseUrl, token)` | http→ws / https→wss，处理相对 `/api` 与子路径 |
| `buildSubscriptionMessage(devices)` | 每台一个 ENTITY_DATA cmd |
| `extractRows(message)` | 从初值/增量里抽遥测 |
| `WsTelemetryChannel` | 连接、订阅、解析、关闭 |

`guard-provider.subscribeTelemetry` 改为：**WS 拿初值 + 轮询降频兜底**。

三处必须小心的点：

**① `apiBase` 默认是相对路径 `/api`** —— WS 构造器不接受相对 URL，
必须补成 `location.origin`。而且 `apiBase` 末尾自带 `/api`，
直接拼会得到 `/api/api/ws`（404），要先剥掉。

**② Vite 必须 `ws: true`**。不代理升级请求时，浏览器建连直接失败，
而 HTTP 那条照常工作 —— 表现为「页面有数，但每 3 秒还在轮询」，
很难联想到是 dev server 的问题。

**③ 非浏览器环境（vitest/SSR）没有 WebSocket** —— 必须提前判掉，
否则 `new WebSocket` 抛 ReferenceError，而订阅是热路径，会白屏。

#### 32.3 ★ 增量推送：没能验证，所以保留了轮询

这是本轮最需要如实说明的一条。

**实测**：握手成功、初值正常（74ms 拿到全部设备），但**用 REST 写入遥测
没能收到 `update`**。试着写一个新键、写已有键的新值、等 20 秒，都没有增量帧。

**根因查到一半**：后端 `DefaultTelemetrySubscriptionService` 里推送受

```java
if (strategy.sendWsUpdate()) {
    addWsCallback(resultFuture, success -> onTimeSeriesUpdate(tenantId, entityId, request.getEntries()));
}
```

控制，而 `TimeseriesSaveRequest` 的默认 strategy 是 `PROCESS_ALL`
（`sendWsUpdate = true`）—— 也就是说**代码路径本应支持**。
REST 写入为什么不推，属于后端本地订阅与写入线程之间的时序问题，
不在「前端接 WS」的范围内，没有继续深挖。

**生产环境的写入路径是网关/MQTT**，与 REST 不同，**可能**会推送 ——
但设备当前离线，无法验证。这一条**未验证**。

**所以决定：轮询不删，只降频。**

```
WS 连上   → 轮询 20 秒（兜底）
WS 没连上 → 轮询 3 秒（原样）
```

为什么是 20 秒而不是 60：它是「增量推送无声失效」时能被容忍的最长滞后。
超过这个数，值班员会开始怀疑大屏卡了。真要更激进，必须先确认增量推送可靠。

#### 32.4 实测数据（天骄场景，12 台设备）

CDP 注入 hook 统计（只统计 `/api/ws` 与 `/values/timeseries`）：

```
wsOpen = 1                     ← WS 建立
frames 5 → 14（45 秒）          ← 持续收到数据帧
45 秒内 HTTP 轮询 28 次
```

**28 次 / 12 台 ≈ 2.3 轮 / 45 秒 ≈ 20 秒一轮** —— 正好等于 `POLL_WS_OPEN_MS`。

对比：3 秒一轮时 45 秒应是 15 轮 × 12 = **180 次**。
实测 28 次，**请求量降 84%**。

> 我一开始把这 28 次误判成「降频没生效」。正确的算法是
> 「请求数 ÷ 设备数 = 轮数」，而不是「请求数 ÷ 时间」。
> 这个错误值得记：数字看着像「每 3 秒一次」，实际是「每 20 秒 12 次」。

数据正确性：卡片显示 62.51 万 kW·h / 99.08% 等真实数值，无「未知」。

#### 32.5 验证

```
前端  tsc 0 · vitest 880 通过 / 88 文件（新增 ws-telemetry 13 条）
浏览器 WS 握手 101 · 订阅消息正确发出 · 收到真实遥测初值
降频  45 秒 28 次请求（原 180 次）· 数据正常
```

#### 32.6 仍未做的

1. **增量推送未验证**（见 32.3）。要在网关设备在线时再测一次；
   若确认可用，轮询可降到 60 秒甚至关掉。
2. **WS 断线重连没做**。连接断了目前只靠轮询兜底（20 秒），
   不会自动重连。要加退避重连，需要先确认增量推送，否则重连意义有限。
3. 属性类数据（`CLIENT_SCOPE`）不在本次范围 —— 上一轮讨论过，
   需要网关侧改造（53 台设备当前 0 条客户端属性）。

### 33 故障码入库到型号 + 可视化配置（2026-11-24）

客户指出：

> 「冷热机组的故障码和原因说明在平台的厂商和型号中要有配置和可视化，
> 后面设备客户端属性或遥测数据可以对应的翻译，目前告警中是通过接口翻译的，
> 说明故障码的原因已经进库了，但平台还没有可以看到和配置的入库」

#### 33.1 原来的状态：数据在库里，但没有界面

118 条故障码全塞在「能源参数字典」资产的 `dictionaries.faultCodes` 数组里，
靠 `source` 字符串指认型号：

```json
{ "codes": ["CM000"], "desc": "主机通讯故障", "source": "carrier-30rq-750vhs" }
```

`GET /api/energy/fault-codes` 能读，告警详情能翻译 —— 所以「已经进库了」是对的。
但**平台没有任何界面能看、能改**：只能改 `energy_library.json` 再重装。

而故障码本来就是**厂商手册给某个型号**的。客户买了新机组，就是要自己录。

#### 33.2 改成挂在型号上

「厂商与型号」页编辑型号时新增「故障码字典」区块，与报文映射、寄存器表放在一起
—— 同一个型号的全部技术事实都在一处。

存储：型号资产的 `SERVER_SCOPE` 属性 `faultCodes`（与 `vendorKeys` 同级，
规则链归化节点读的就是这个 scope）。

数据结构：

```java
class FaultCodeEntry {
    List<String> codes;   // ["CM001","CM002",…] 一个条目可覆盖多个码
    String desc;          // 必填：只存码不存说明，现场看到还是不知道什么意思
    String analysis;      // 可能原因
    String solution;      // 处理建议
}
```

**为什么 `codes` 是数组**：厂商手册常写「E1/E2/E3 均为主机通讯故障」，
拆成三条会让同一段文字重复三遍、改一处要改三处。
实测迁移过来的 118 条里有 33 条是多码条目（86 码 + 65 码）。

#### 33.3 两个来源合并，型号优先

`GET /api/energy/fault-codes` 现在是「型号级 + 历史字典」的并集：

| 情况 | 动作 |
| --- | --- |
| 型号有该码 | 用型号的（**型号优先**） |
| 只有字典有 | 用字典的，`source` 保留原值 |
| 两者都有 | 字典条目**跳过**并计数（`legacySkippedCodes`） |

为什么型号优先：型号是用户当前维护的事实，字典是待迁移的副本。
反过来会让客户刚改的说明被旧副本顶掉，看起来像「保存没生效」。

实测迁移后：`total=118`、`modelEntryCount=118`、`legacySkippedCodes=151`
—— 全部来自型号，字典条目一条没混进来，也没丢。

> 顺带修正一个语义：`total` 一直是**条目数**（118），不是码数（151）。
> 我一度改成码数，前端「共 N 条」会突然变大而列表长度不变，像分页坏了。
> 码总数另给 `codeCount`。

#### 33.4 ★ 一天之内踩了两次的坑：整体覆盖语义

`POST /tech-profile` 是**整体覆盖**：传什么就是什么，没传的字段被清空。
而它长得太像「只更新我传的那几个字段」。

**第一次**：为验证写入路径只传了一条测试故障码 →
型号上原有 **53 条全部消失**，响应 200、界面无提示。

**第二次**：只传 `{"wiring":""}` 想测接线方式 →
把品种、设备类型、**10 项报文映射**一起清空了。

两次都是事后查接口才发现的。用户写脚本时做同样的事，
会以同样方式丢掉几十条手工录入的内容。

**修法：所有字段都区分「没传」与「传空值」**

```java
// 之前：键缺失时 asText("") 返回空串 → 被当成「清空」
profile.setEnergyTypeCode(body.path(ATTR_KIND).asText("").trim());

// 现在
if (body.has(ATTR_KIND)) {
    profile.setEnergyTypeCode(body.path(ATTR_KIND).asText("").trim());
}
```

| 请求体 | 含义 |
| --- | --- |
| 没有该键 | 保留库里原值 |
| 传空串 / 空数组 | 明确清空 |
| 传了值 | 替换 |

前端页面本来就传全量（读出来什么就传什么），所以语义不变 ——
**这是兼容性关键**：改的是 API 对「漏传」的容忍度，不是前端行为。

实测验证：`POST {"wiring":""}` → 200，且
`energy='env' / deviceType='env_device' / vendorKeys=10 项 / faultCodes=53 条`
全部保留。

#### 33.5 顺带修掉：读取侧 NPE 让整个接口 500

字段默认值从 `""` / `new LinkedHashMap<>()` 改成 `null` 之后，
`readTechProfile` 没有初始化它们 —— 而 `applyTechProfile` 里直接
`profile.getVendorKeys().forEach(...)`。

```
500 Cannot invoke "java.util.Map.forEach(...)" because the return value of
    "TechProfile.getVendorKeys()" is null
```

整个「厂商与型号」页空白。修法：**读取时初始化成空容器**（读取语义里 null 没意义），
并在 `applyTechProfile` 里加 null 判。

> 这条值得记：把字段默认值改成「未传」语义时，
> 一定要同时检查**所有读取侧**是否假定它非空。

#### 33.6 迁移

一次性脚本把 118 条按 `source` 归到型号：

| source | 型号 | 结果 |
| --- | --- | --- |
| `carrier-30rq-750vhs` | 30RQ750VHS（开利，已有） | 53 条 / 86 码 |
| `carel-optima-cybercool` | Optima CyberCool（**新建**，厂商「卡乐」） | 65 条 / 65 码 |

`carel-optima-cybercool` 原来没有对应型号，视为卡乐控制板，新建了厂商与型号。

**恢复用的兜底路径值得记**：数据被我误清两次，两次都恢复了 ——
因为**全局字典是完整的历史副本**，型号清空后它会自动兜底露出来。
最终恢复是从源文件 `energy_library.json` 直接读的（接口有「型号优先」抑制，筛不到）。

#### 33.7 顺带修掉：4 处部件模板用了禁用的 `tb-*` 组件

改之前 `npm run build:prod` 直接**卡在第一步**（`check:widgets` 退出码 1），
前端产物一直是 11-23 的旧文件：

```
[TB 组件(非standalone)] <tb-datetime>  → 3 个部件
[TB 组件(非standalone)] <tb-details-panel> → 1 个部件
```

按 AGENTS.md A2d3 换成 standalone 等价物：`tb-datetime → energy-date-picker`
（9 处）、`tb-details-panel → energy-details-panel`（1 处），
并把 `[ngModel]/(ngModelChange)` 改成 `[value]/(valueChange)` —— 后者不能用
`NgModel`（属于 FormsModule，JIT 展不开）。

修完 `check:widgets` 通过，构建 732 秒完成。
部件已用 `31-deploy-widget.sh` 推库，`verify-deploy` 三段一致。

#### 33.8 验证

```
后端  FaultCodeValidationTest 17 条通过（含 4 条覆盖「未传不清空」语义）
前端  vitest 880 通过 / 88 文件 · tsc 0 · UI build:prod 成功
接口  型号接口返回 faultCodes · 按码翻译 matched=1
界面  徽章「86 个故障码」· 抽屉 53 行 · 品种/类型/映射全部正确显示
数据  两次误清均已恢复：53 条 / 86 码 · vendorKeys 10 项
```

#### 33.9 仍未做的

1. **设备侧还没接**：设备上报 `alarm_code` / `fault_code` 时前端能翻译
   （`extractFaultCodes` + `loadFaultCodes` 已存在），但那台模块机
   三个故障码键全是 `null`，也没有告警 —— 数据侧没上来。这是网关的事。
2. **Optima CyberCool 的品种/设备类型为空**：迁移时没设。它是控制板不是整机，
   归属需要业务确认，没有猜。
3. **故障码按型号隔离查询**：现在一次扫全部型号（14 条，够快）。
   上千型号时要改成按设备→型号反查。

## 34. 3D 只给告警/故障上色 + 铭牌数据行改为设备文档驱动（2026-11-24）

客户两条要求（原话）：

> 「你说的是不是 3d 铭牌下面的两个数据指标没统计到，如果设备文档没有该指标就去掉，
> 还有我希望 3d 中的设备告警和故障才有对应的颜色，其他的状态在 3d 里面不要颜色」

### 34.1 那两个「没统计到」的指标是什么

查设备文档（`model.glb` 的节点 extras `hmi.devices[].data`）：
9 台模块机都是 **温度 / 功率 / 开度 / 运行状态** 四项。泵、三通、弯头、PLC 柜
`data` 为 `null` —— 本来就没有指标。

而铭牌原来的数据行取自「绑定的前 4 个 telemetryMapping」，实测前四项是
**运行 / 开度 / 风机状态 / 指示灯**。「风机状态」「指示灯」在设备文档里根本没有，
于是永远显示「暂无数据」—— 客户看到的正是这两行。

### 34.2 修法：数据行以设备文档为准

`apps/web/src/utils/device-plates.ts`：

- 新增 `docMetricNames(device)`：取文档 `data[].name`，**过滤掉状态类**
  （`状态|运行|停机|故障|开关|报警|告警|status|running|state|...`）——
  状态已经由铭牌徽标表达，再占一行只是重复。
- 新增 `mappingMatchesMetric(mapping, name)`：文档名 ↔ 映射的
  `label / field / telemetryKey`，先精确、再互相包含（要求 ≥2 字符，
  避免「水」「in」这类片段把所有映射都捞进来）。文档写「温度」、绑定写
  「进水温度」，靠这一条才对得上。
- 数据行改为遍历文档指标，匹配不到映射就显示「暂无数据」；
  **文档里没有的指标不再出现**。

实测（2# 模块机，真实绑定 + 真实文档）：

```
温度 → 进水温度 water_in_temp ℃   （有值 18.6）
功率 → 未匹配                      （显示「暂无数据」）
开度 → 开度 opening %              （有值 0）
风机状态 / 指示灯 → 不再出现        （文档没有）
```

`功率` 这一行是**如实提示**：设备文档里有它、设备也上报了 `power`，
但平台测点字典（`measurePoints`）和场景绑定里都没有这条，
前端不猜中英文对应关系。要让它出数，补一条 `power ↔ 功率` 的测点/绑定配置即可。

### 34.3 颜色：只有告警/故障

`apps/web/src/engine/animation/DeviceStateAnimator.ts` 新增 `statusTint(status)`：

| 状态 | 染色 |
| --- | --- |
| `alarm`（故障/告警） | `#e5484d` |
| `warning`（预警） | `#e8930c` |
| `normal` | `null` → 恢复模型原材质 |
| `offline` | `null` → 恢复模型原材质 |

原来四种状态全染（正常=绿、离线=灰），整排机组都是色块，故障反而要仔细找。
`tintStatus(s, null)` 会按首次染色前存档的原色写回，不是假设原色是黑/白。

铭牌上的「运行」徽标也从实心绿改成中性半透明底（`EngineViewport.module.css`），
红色只留给故障 —— 运行/停止/离线靠文字区分。

阀门开闭色与停流变暗不动：那是工艺状态，不是设备健康度。

### 34.4 验证

```
tsc -b                    0 错误
vitest run                882 通过 / 88 文件（新增 2 条：文档白名单、statusTint）
浏览器实测（runtime 大屏） 2# 故障机组整机红色，其余 8 台保持模型原色
```

截图证据：改动前 9 台全白/绿、无红；改动后仅 2#（`sys_run_state=8`）为红色。
