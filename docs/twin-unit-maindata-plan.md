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

### P0 · 主数据（2–3 天，阻塞后面全部）

1. `standardKeys` +10
2. `env.params` 扩到 12 项、`deviceTypes` +2（热泵 / 冷冻水泵）
3. 厂商「开利」+ 型号（registers 按真实点表，**×10 系数写清楚**）
4. **★ 给 10 个新 key 填 `diagnosis`**（见 4.6）+ 建 `faultCodes` 字典
   （开利 **53 条可直接落库** + 卡乐报警段 **66 条**；剩余 57 条开利变频器代码
   等拿到变频器手册再补，**不要卡在这里不往下走**）
5. 跑装库流程，验证品种指标页能看到新 key，设备建档能选到「风冷热泵机组」

验收：租户登录 → 品种指标页 → 环境系统下 12 个参数；设备建档下拉有「风冷热泵机组」「冷冻水泵」；
`water_out_temp` 等温度/压力类 key 能查到 `normalRange` + 对应 `faultCodes` + 解决方案。

> 第 4 项不要往后推。它是数据孪生、告警、AI 分析的**共同输入**，
> 现在不填，后面每个消费方都得各自重新翻 PDF 一次，且口径必然不一致。

### P1 · 设备建档（2–3 天）

1. 建「热泵系统 1」资产（挂场站）
2. 建网关 Device + 9 模块机 + 2 泵
3. 写 measurePoints（网关 12 项 / 模块机 9 项 / 泵 4 项）
4. 挂 GATEWAY 关系、Contains、ModeledBy、归属客户
5. 写 rpcMethods（网关 4 条）
6. 幂等脚本，可重复执行

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
