# 画面模板接口约定

这份说明给以后用 skill 开发大屏用。改模板时，改的是这里的结构化说明（加区域、改接口），不是到画布上拖卡片，也不是让用户在抽屉里一项项手填绑定。

数据绑定的主路径是：**读这份接口说明 → 生成结构化对接结果 → 场景加载并应用 → 抽屉里核对**。

## skill 该读哪份说明

- 内置「综合态势」：本目录 `overview-situation.json`，稳定 id 是 `overview-situation`。
- 若场景里有在线改过的 `templateDraft`，以场景里那份为准（版本号会升高），但仍是同一套形状。
- 读写用 `@idt/data-adapter` 的 `parseScreenTemplate`、`listBuiltinScreenTemplates`、`resolveScreenTemplate`。

模板里不要写客户的设备、测点或场站。

## 模板里有什么

- 模板 `id`、名称、版本。
- 每个部件区域：稳定 `id`、类型、分区、位置、默认标题；每个接口有稳定 `key`、名称、值类型，以及允许的数据来源（`site` 场站、`scene-topology` 本场景拓扑、`device-point` 实时设备加测点）。
- 三维设备侧：`objectBinding`。按模型里的 `objectName`（对象名 / 节点名）对接，字段是「目标设备」「铭牌测点」「行为」「底部启停命令」「状态规则」。只影响铭牌和底部启停，不改模型里的位置。

### 综合态势区域（稳定 id）

| 区域 id | 类型 | 数据从哪来 | 绑到哪个值 |
| --- | --- | --- | --- |
| `title` | 标题 | 无数据接口 | 默认标题 `{sceneName} · 综合态势`，可在对接结果的 `regionTitles` 里改 |
| `metric-load` | 主指标「实时负荷」 | `filter` 可选场站/本场景拓扑；`main` / `left` / `right` 为实时设备加测点 | `main` 主值（必填），`left` / `right` 分解值（可选） |
| `device-status` | 状态汇总「设备状态」 | 场站或本场景拓扑做汇总 | `scope` |
| `running-count` | 圆环「运行台数」 | `scope` 场站或本场景拓扑；也可选填设备测点 | `scope` 必填；`used-0` / `total-0` / `used-1` / `total-1` 可选 |
| `energy-trend` | 趋势「用能趋势」 | `filter` 可选；`series-0` 实时设备加测点的时间序列 | `series-0` |

平台若还不能按设备分组过滤，不要做假汇总，只按场站或本场景拓扑写 `scope` / `filter`。

### 三维对象接口（`objectBinding`）

每条对接一行，用模型对象名匹配：

- `targetDevice`：平台实时设备 id（必填）
- `nameplatePoints`：`telemetryMappings`（铭牌用到的测点）
- `behaviors`：`actionMappings`（动作 / 行为）
- `controlCommands`：写在对应行为的 `commandId` / `commandParams` 上，给底部启停用
- `status`：可选 `statusMapping`

只绑实时设备。虚拟设备按已有规则失效，不能写进生效结果。

## skill 该写出什么样的对接结果

写一份 JSON，`kind` 必须是 `screen-wiring`，不要把这份结果写进模板文件。形状如下：

```json
{
  "schemaVersion": "1.0.0",
  "kind": "screen-wiring",
  "templateId": "overview-situation",
  "templateVersion": 1,
  "regionTitles": { "title": "某某站 · 综合态势" },
  "interfaceBindings": [
    { "regionId": "device-status", "key": "scope", "source": "scene-topology", "topologyId": "拓扑id", "topologyName": "名称" },
    { "regionId": "metric-load", "key": "main", "source": "device-point", "deviceId": "实时设备id", "telemetryKey": "load" }
  ],
  "objectBindings": [
    {
      "objectName": "模型对象名",
      "deviceId": "实时设备id",
      "deviceName": "设备名称",
      "telemetryMappings": [{ "field": "run", "telemetryKey": "run", "label": "运行", "displayType": "text" }],
      "actionMappings": [{ "actionId": "spin:fan", "label": "风机", "commandId": "start" }]
    }
  ]
}
```

解析和应用用 `parseScreenWiring`、`applyScreenWiring`（也可叫 `applyGeneratedWiring` / `applySceneWiring`，是同一函数）。校验后一次写入 `layout.interfaceBindings`（并 rematerialize 卡片）和 `document.bindings`（按对象名对接目标设备、行为、铭牌测点和启停命令）。不要一项项调用 `upsertInterfaceBinding`，也不要只停在抽屉里手填。场景仍走现有 `saveSceneWidgets` 和场景绑定存储，不另造后端。应用时会丢掉虚拟设备和对不上的对象名，并给出原因。

应用时请按下面理解，不要弄反：

- 画面卡片的 `interfaceBindings` 是整份替换：文件里没写到的卡片接口会变成未对接。
- 三维 `objectBindings` 是按对象名合并：文件没写到的旧三维绑定会留下。
- 实时设备列表尚未就绪时（应用时传入的设备列表为空），会先写入设备 id，并在核对里标「待核对」；列表就绪后，虚拟或不在列表里的设备仍按 fail-closed 视为未生效。
- `kind` 必须是 `screen-wiring`。缺了或写成别的，`parseScreenWiring` 都不会接受。

## 应用后又该在抽屉里看到什么

工作台「核对绑定」抽屉只用来查看和对核对接结果，不是搭屏必填的手工配置向导。

- 「画面卡片」：每个接口一行，写清已对接什么，或「还没有对接结果」。不对的项（虚拟设备、设备不在实时列表、必填接口为空）会标出来。
- 「三维设备」：每个模型对象一行，写清目标设备、铭牌测点、行为、启停命令；对不上或被 fail-closed 的会标出来。
- 用「应用对接结果」加载 skill 生成的 JSON 后，抽屉应马上反映上述结果。

值类型和来源约定不变：`scope` 只能是场站或本场景拓扑；`number` / `number-series` 以实时设备加测点为主；先不用别名。
