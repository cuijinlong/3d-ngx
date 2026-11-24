import type { ScreenTemplate, TemplateInterfaceBinding } from "./screen-template";
import type { SceneDataSource } from "@idt/shared-types";

/** 布局样式只引用 --ngx-* token 名，不写死某一套主题的十六进制色。 */
export const DEFAULT_WIDGET_STYLE_TOKENS = {
  backgroundToken: "--ngx-glass-bg",
  borderToken: "--ngx-glass-border",
  blurToken: "--ngx-glass-blur",
  textToken: "--ngx-color-text",
  mutedToken: "--ngx-color-muted",
} as const;

/** 与 --ngx-glass-bg 的默认 alpha 一致。布局 JSON 只存 0.50–0.90 或 50–90 的百分比。 */
export const DEFAULT_GLASS_OPACITY = 0.72;
/*
 * 透明度下限 0.5 → 0.25（2026-11-23）。
 *
 * 客户要求「3D 周围透明」。原来下限 0.5 时，无论怎么调卡片都是半实心，
 * 模型被压住、没有「浮在场景上」的感觉。下限放到 0.25 才够透。
 * 上限保持 0.9：再高就完全看不见模型了。
 */
export const GLASS_OPACITY_MIN = 0.25;
export const GLASS_OPACITY_MAX = 0.9;
/** 运行态玻璃默认建议值。布局若已存百分比则两套皮共用该百分比。 */
/*
 * 运行态默认 0.64 → 0.42 → 0.30（2026-11-23 两次调整）。
 *
 * <p>0.64 时卡片是「磨砂玻璃板」而不是「悬浮信息层」，3D 基本透不出来；
 * 0.42 是「能看到模型轮廓」的基准；客户第二次要求「透明度尽量调透」后降到 0.30。
 *
 * <p>★ **只降 alpha 不够**：实测遮挡的主要来源是 `backdrop-filter: blur(9px)`
 * —— 9px 已把背后的模型糊成色斑，alpha 再低透出来的也只是模糊色块。
 * 所以本次同时把 CSS 里的 blur 降到 2px（见 `WidgetOverlay.module.css`）。
 * 两个必须一起改，只改这里等于白调（实测过）。
 */
export const HUD_DEFAULT_GLASS_OPACITY = 0.3;

export type SceneWidgetTypeId =
  | "metric-card"
  | "ratio-ring"
  | "gauge-ring"
  | "trend-chart"
  | "summary-card"
  | "selection-card"
  | "device-list"
  | "bar-compare"
  | "control-bar"
  | "title"
  | "caption"
  | (string & {});

export interface SceneWidgetTypeMeta {
  type: string;
  label: string;
  defaultSize: { w: number; h: number };
  maxCount?: number;
  /** 该类型是否需要实例测点槽位。模板里槽位不含 customer 的 deviceId。 */
  usesSlots?: boolean;
  /**
   * 该类型是否依赖「范围」（场站 / 场景拓扑）。
   *
   * <p>声明在这里而不是在部件层写 if 链：原来 WidgetOverlay 用
   * `type === "summary-card" || ...` 硬编码四种类型，加了 device-list /
   * bar-compare 之后忘了同步 —— 后果是编辑器里选中这两种卡**没有范围选择器**，
   * 而运行时它们又真的按 scope 取设备，等于配不出来。
   *
   * <p>加新类型时只改这张表，不用去部件层找散落的 if。
   */
  usesScope?: boolean;
  /**
   * 该类型是否**必需**范围才能出数（与「可配但非必需」区分）。
   *
   * <p>典型差异：metric-card 绑的是某台具体设备，没选范围照样能读它的测点；
   * summary-card / device-list / bar-compare 则是「按范围去凑一批设备」，
   * 没范围就一台都拿不到。待绑定清单只把后者算作「未选范围」，
   * 否则前者会挂一条永远不消失、也不影响显示的噪音。
   */
  scopeRequired?: boolean;
  /**
   * 该类型是否「按设备逐台读同一列」，而不是「绑一台代表设备」。
   *
   * <p>device-list / bar-compare 的语义是「9 台各自的出水温度」，
   * 它们只需要 telemetryKey，**不需要** deviceId。待绑定判定必须区分这两种，
   * 否则会把「已配好列」误报成未绑定。
   */
  scopePerDevice?: boolean;
}

export const SCENE_WIDGET_TYPE_REGISTRY: SceneWidgetTypeMeta[] = [
  { type: "metric-card", label: "主指标", defaultSize: { w: 20.4, h: 18 }, usesSlots: true, usesScope: true },
  { type: "ratio-ring", label: "已用/总数圆环", defaultSize: { w: 20.4, h: 22 }, usesSlots: true, usesScope: true, scopeRequired: true },
  { type: "trend-chart", label: "趋势小图", defaultSize: { w: 20.4, h: 22 }, usesSlots: true, usesScope: true },
  { type: "summary-card", label: "状态汇总", defaultSize: { w: 20.4, h: 16 }, usesScope: true, scopeRequired: true },
  { type: "selection-card", label: "选中对象卡", defaultSize: { w: 20.4, h: 22 }, maxCount: 1 },
  /*
   * 下面两个是 2026-11-23 接天骄热泵大屏时加的（template01 的左右翼/底部）。
   *
   * 为什么不能用现有类型拼：
   *   · device-list —— 9 台机组要**逐台**列名字+状态，summary-card 只给合计；
   *   · bar-compare —— 9 台加载率要横向比高低，trend-chart 是时间序列。
   * 用 scope 取设备（与 summary-card 同一套 scopeDeviceIds），不另建取数链路。
   */
  { type: "device-list", label: "设备列表", defaultSize: { w: 20.4, h: 30 }, usesSlots: true, usesScope: true, scopeRequired: true, scopePerDevice: true },
  { type: "bar-compare", label: "设备对比条", defaultSize: { w: 42, h: 22 }, usesSlots: true, usesScope: true, scopeRequired: true, scopePerDevice: true },
  /*
   * 控制条（2026-11-23）。不用的 slots / scope 都是刻意留空：
   * 它发命令、不读值，也不按范围凑设备 —— 设备在 controls[].deviceId 里写死。
   * 若标上 usesSlots，待绑定清单会要求它「绑测点」，那是错的。
   */
  { type: "control-bar", label: "控制条", defaultSize: { w: 20.4, h: 12 } },
  /*
   * 告警跑马灯（2026-11-23）。不用的 slots / scope 都是刻意留空：
   * 告警是**租户级**数据（平台活跃告警列表），不按场站范围凑设备。
   * 若标上 usesScope，编辑器会要求先选范围 —— 而告警本来就不分场站取。
   */
  { type: "alarm-ticker", label: "告警跑马灯", defaultSize: { w: 20.4, h: 30 } },
  /*
   * 环形仪表（2026-11-23）。
   *
   * <h3>与 ratio-ring 的区别</h3>
   *
   * <p>ratio-ring 的语义是「**已用 / 总数**」（车位、房间），两边都得绑真实测点；
   * gauge-ring 的语义是「**当前值 / 量程**」，量程通常是个**设计值**
   * （加载率 0~100%、功率 0~750kW），用 `slot.constant` 写，不绑设备。
   *
   * <p>视觉也完全不同：ratio-ring 是细环 + 圆内占比；
   * gauge-ring 是粗渐变环 + 环尾光点 + 刻度 + 中心大数字，
   * 参考效果图里的「人车通行 / 出租状态」就是这一种。
   *
   * <p>为什么单独一个类型而不是给 ratio-ring 加个样式开关：
   * 给同一个类型加两种视觉分支，配置面板、待绑定清单、AI 生成都会变模糊
   * （「这块到底要不要绑 total？」）。类型分开，语义就清楚。
   */
  { type: "gauge-ring", label: "环形仪表", defaultSize: { w: 20.4, h: 20 }, usesSlots: true },
  { type: "title", label: "标题", defaultSize: { w: 56, h: 7 }, maxCount: 1 },
  { type: "caption", label: "右上说明", defaultSize: { w: 20, h: 6 }, maxCount: 1 },
];

export interface SceneWidgetStyle {
  backgroundToken?: string;
  borderToken?: string;
  blurToken?: string;
  textToken?: string;
  mutedToken?: string;
  /** 单卡覆盖。缺省则继承 layout.glassOpacity。 */
  opacity?: number;
}

export interface SceneWidgetSlot {
  key: string;
  label?: string;
  unit?: string;
  /**
   * 显示类型（2026-11-23）。
   *
   * <p>为什么槽位需要它：`running` / `door` / `led` 这类开关量，网关上报的是
   * **0/1 或 true/false**。不声明类型时 `formatTelemetryText` 会照着数字/布尔原样输出，
   * 大屏上出现「1」「0」甚至「true」—— 现场看不出是运行还是停机。
   *
   * <p>配成 `"boolean"` 就会走「运行 / 停止」的文案。
   * 优先级：**槽位 > 绑定的 mapping**。槽位是「这一列怎么显示」，
   * 绑定是「这个测点是什么」，前者更贴近具体位置。
   */
  displayType?: "number" | "boolean" | "text";
  /**
   * 渲染形态（2026-11-23）。
   *
   * <p>`"bar"` = 画成进度条而不是文字。对齐 `template01` 的 `.bar-row` ——
   * 参考模板里 4 处用到进度条，它是「信息密度高但不杂乱」的关键：
   * 一排数字看不出哪台在出力，一排条子一眼就看出来。
   *
   * <p>只在 `device-list` 的逐台列里生效（每行一根）。
   * `max` 用来把原始值映射成 0~1，缺省按 100 算（开度/百分比类）。
   * 值超范围会被钳到 0~1，不会画出格。
   */
  render?: "value" | "bar";
  /** bar 形态的满量程，缺省 100。 */
  barMax?: number;
  /**
   * 静态值（不绑设备，2026-11-23）。
   *
   * <h2>为什么槽位需要「常量」这个形态</h2>
   *
   * <p>仪表类部件的**量程是设计值，不是测点**：
   * 「加载率 0~100%」「功率 0~750kW」—— 分母由机型手册决定，
   * 平台没有任何设备会把这个数当遥测上报。
   *
   * <p>没有这个字段时，`gauge-ring` 的量程只能绑一个假设备，
   * 或者写死在渲染代码里 —— 前者要造数据，后者等于把业务编进代码，
   * 两样都违反产品铁律（模板库 + AI 可构建）。
   *
   * <h2>优先级最高</h2>
   *
   * <p>填了 `constant` 就不再看绑定/设备/属性 —— 它是「这一格的字面值」。
   * 所以同一个字段也能用来做「阈值标注」「参考线」这类纯展示槽位。
   */
  constant?: number;
  /**
   * 按范围聚合（2026-11-23）。
   *
   * <p>语义：这个槽位**不绑具体设备**，而是把 `widget.scope` 范围内所有设备的
   * 同一测点聚合成一个值。
   *
   * <p>用途：网关还没有上报系统级点位（`power_total` 实测为 null）时，
   * 「系统功率」可以先显示 9 台机组 `power` 之和 —— 那是真实数据，
   * 比空着有用。但**必须在 label 里写明口径**（如「9 台机组之和」），
   * 否则会被当成系统总功率 30005，而后者还包含水泵、风机。
   *
   * <p>`avg` / `max` / `min` 同理，语义自明。
   */
  aggregate?: "sum" | "avg" | "max" | "min";
  telemetryKey?: string;
  sceneEntityId?: string;
  /** 仅实例绑定填写；模板布局必须去掉。 */
  deviceId?: string;
  /*
   * v2：资产属性槽位（docs/twin-binding-contract.md §5）。
   * 同样是「仅实例绑定填写」—— toTemplateWidgetLayout 只保留 key/label/unit，
   * 所以这些字段天然不会进模板。
   *
   * 与 telemetryKey 的区别：属性没有「实时」概念，只有「上次写入」，
   * 所以用 staleAfterSec 判新鲜度时拿的是 lastUpdatedTs，不是 ts。
   */
  assetId?: string;
  attributeKey?: string;
  attributeScope?: "SERVER_SCOPE" | "SHARED_SCOPE" | "CLIENT_SCOPE";
  /** 超过这个秒数没更新就标「更新于 X 前」，但仍然显示值 */
  staleAfterSec?: number;
}

export type SceneWidgetScopeKind = "site" | "topology";

/** 卡片自己的汇总范围。和模型上的「目标设备」分开，未选则这张卡未绑定。 */
export interface SceneWidgetScope {
  kind: SceneWidgetScopeKind;
  siteId?: string;
  siteName?: string;
  topologyId?: string;
  topologyName?: string;
}

export interface SceneWidget {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  /**
   * 标题右侧的小字英文副标题（2026-11-23）。
   *
   * <p>来自 template01 的 `panel-head`：左侧 `⌜ 园区简介`、右侧 `CAMPUS PROFILE`。
   * 中文 11px + 英文 7px 的字号对比是这块「像不像」的关键之一 ——
   * 只有中文标题时，卡片看起来是普通后台面板而不是大屏。
   *
   * <p>缺省时不渲染，不影响存量布局。
   */
  subtitle?: string;
  style?: SceneWidgetStyle;
  slots?: SceneWidgetSlot[];
  scope?: SceneWidgetScope;
  /**
   * 设备名包含过滤，只对 device-list / bar-compare 生效。
   *
   * <p>为什么需要：scope 按场站/拓扑取设备，冷暖站拓扑内同时有
   * 网关、9 台模块机、2 台泵、2 台 PLC 柜。大屏要的是「只看 9 台机组」，
   * 靠 `filterText: "模块机"` 收窄，而不是把 14 台全列出来。
   *
   * <p>空值 = 不过滤（保持既有行为）。
   */
  filterText?: string;
  /**
   * 部件的**数据口径**（2026-11-23）。
   *
   * <ul>
   *   <li>{@code "telemetry"}（默认，可省略）—— 读设备遥测点位，
   *       走 `latest` + 槽位绑定。原来的行为，不受影响。</li>
   *   <li>{@code "energy"} —— 读**场站能耗统计**
   *       （`/api/energy/comprehensive`），值是聚合量而不是点位量。</li>
   * </ul>
   *
   * <p>为什么用配置而不是新增部件类型：客户要求「样式不变，只调统计维度」。
   * 新类型意味着新的一套 CSS 和新的默认尺寸，视觉上必然漂移；
   * 同一个组件换数据口径，外观天然一致。
   *
   * <p>必须在 `parseSceneWidget` 里显式解析 —— 那里是白名单，
   * 漏一个字段就会被静默丢弃（此前 `dataSources` 就是这么丢的）。
   */
  dataSource?: "telemetry" | "energy";
  /**
   * `dataSource: "energy"` 时，这块卡展示哪一项统计。
   *
   * <h3>★ 为什么不是枚举「耗电/碳排」这种具体口径（2026-11-23 重构）</h3>
   *
   * <p>第一版写的是 `"electricity" | "carbon"` —— 那等于把「这块卡显示耗电」
   * 这件事**编进了代码**。下一个客户要看「用水量」「蒸汽量」「成本」
   * 就得改代码，违反产品铁律（见 `docs/PRODUCT-CHARTER.md`）。
   *
   * <p>现在拆成两个正交维度：
   * <ul>
   *   <li>{@code energyMetric} —— 看哪一类**量**（用量/成本/碳排/折标煤/趋势/排名）</li>
   *   <li>{@code energyKind} —— 看哪个**品种**（elec/heat/water/gas/steam…），
   *       品种列表由平台 `byKind[].code` 决定，不是这里硬编码的</li>
   * </ul>
   *
   * <p>于是「用水量」「蒸汽用量」「热力成本」都只是配置，不是新代码。
   *
   * <p>不填时按部件类型给默认值（见 `energyMetricOf`）：
   * metric-card → usage（默认品种 elec），trend-chart → trend，bar-compare → ranking。
   */
  energyMetric?: "usage" | "cost" | "carbon" | "tce" | "trend" | "ranking";
  /**
   * 统计品种（`byKind[].code`）：`elec` / `heat` / `water` / `gas` / `steam`…
   *
   * <p>只对 {@code usage} 与 {@code trend} 生效。留空时取 `elec`
   * （绝大多数场景最先关心的是电）。
   *
   * <p>**不校验取值**：平台可能新增品种（比如将来有「压缩空气」），
   * 这里用白名单会把新品种挡在外面。取不到时卡片显式提示
   * 「该场站没有 X 品种数据」，而不是空白。
   */
  energyKind?: string;
  /**
   * 告警跑马灯最多显示多少条（2026-11-23）。
   *
   * <p>为什么可配：不同现场的告警频率差很多 —— 热泵站可能一天 1 条，
   * 配电房可能同时挂 20 条。写死 6 条会让高频现场看不到最新的，
   * 也会让低频现场留一大块空。
   *
   * <p>留空时用卡片内置默认值（见 `AlarmTickerCardBody`）。
   */
  alarmLimit?: number;
  /**
   * 控制按钮（2026-11-23）。目前只给 control-bar 用。
   *
   * <p>为什么不复用 slots：slots 的语义是「读一个值」，控制是「发一条命令」。
   * 混在一起会让 `readSlotValue` 收到没有 telemetryKey 的槽，
   * 也会让待绑定清单把按钮算成「未配置测点」。
   *
   * <p>设备必须是平台实时设备；命令来自该设备 SERVER_SCOPE 的 rpcMethods，
   * 不在这里写死命令名 —— 换网关、换协议时只改设备属性。
   */
  controls?: SceneWidgetControl[];
}

/**
 * 一个控制按钮。
 *
 * <p>`kind` 决定交互形态：
 * <ul>
 *   <li>`toggle` —— 一个按钮管开和关（如 setSystemPower 写 40051）。
 *       参数由当前状态推出：运行中 → 发 offParams，停机 → 发 onParams。</li>
 *   <li>`button` —— 单向下发（如报警复位、设定点）。</li>
 * </ul>
 *
 * <p>为什么 toggle 要显式给出 onParams/offParams 而不是猜：
 * 真实协议的开关命令参数名不统一（我们这里是 `on`，别的网关可能是 `value`），
 * 由配置写明，代码不去猜。
 */
export interface SceneWidgetControl {
  key: string;
  label?: string;
  deviceId: string;
  commandId: string;
  kind?: "toggle" | "button";
  /** toggle 用：切到「开」时发的参数 */
  onParams?: Record<string, unknown>;
  /** toggle 用：切到「关」时发的参数 */
  offParams?: Record<string, unknown>;
  /** button 用：固定参数 */
  params?: Record<string, unknown>;
  /**
   * toggle 的当前状态从哪个遥测键读。
   * 判定走 `sys_run_state` 枚举（1停机/5运行），不靠 truthy。
   */
  stateKey?: string;
  /** 二次确认文案。停机这种动作必须确认，不能一点就发。 */
  confirmText?: string;
}

export interface SceneWidgetLayout {
  schemaVersion: "1.0.0";
  /** 整屏玻璃默认透明度，缺省 0.72。 */
  glassOpacity?: number;
  /** 场景选中的画面模板。布局和接口以模板为准，客户绑定另存在 interfaceBindings。 */
  templateId?: string;
  templateVersion?: number;
  /** 在线改过的模板说明，按场景或本地草稿保存，不写回仓库内置文件。 */
  templateDraft?: import("./screen-template").ScreenTemplate;
  interfaceBindings?: import("./screen-template").TemplateInterfaceBinding[];
  regionTitles?: Record<string, string>;
  /**
   * 场景数据源别名（2026-11-23）。
   *
   * <h2>为什么放在布局里</h2>
   *
   * <p>`SceneDocument` 整体存在浏览器 IndexedDB（`saveScene`），
   * 而 `scene-widgets` 是**平台侧**存储。只存本地意味着换台机器
   * 就看不到别的同事配的数据源 —— 但数据源恰恰是团队共享的施工信息。
   *
   * <p>所以保存时把 `document.dataSources` 同步一份到这里。
   * 实测后端会**原样保留未知字段**（PUT 后读回仍在），
   * 不会像某些 POJO 反序列化那样丢掉。
   *
   * <p>加载时的优先级：平台布局里的这份 > 本地 document 里的。
   * 见 `EditorShell` 的加载回填。
   */
  dataSources?: SceneDataSource[];
  widgets: SceneWidget[];
}

export const EMPTY_WIDGET_LAYOUT: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets: [] };

/** 画布百分比安全区：给底部抽屉和右下「总览」留空，拖到附近弹开。 */
export const WIDGET_SAFE_AREA = {
  top: 2,
  left: 2,
  right: 2,
  /*
   * 底部安全区 18 → 3（2026-11-23，对齐 template01）。
   *
   * <p>18% 的原始理由是「给底部操作抽屉留位置」。但实测抽屉是
   * **按需展开的浮层**（默认只有 22px 的 handle），不是常驻占位。
   * 留 18% 的后果是底部两块卡被钳到 y=67.8，与左右栏重叠 ——
   * 而模板的底部区域是直接到底的（`bottom:13px;height:153px`）。
   *
   * <p>3% 只保留抽屉收起时 handle 的高度，抽屉展开时浮在卡片之上
   * （它本来 z-index 更高，且是用户主动点出来的）。
   */
  bottom: 3,
  /*
   * 右下角避让区已禁用（2026-11-23）。
   *
   * <p>原来这里给「总览」按钮留了 12%×10% 的空位，任何卡片进到该区域
   * 会被整体左移。但模板的底部卡占满到 97%，而「总览」按钮只有 4%×2.6% ——
   * 为一个小按钮牺牲一整块卡片的位置不划算。
   *
   * <p>按钮已移到顶栏（和「全屏展示」等按钮并列），所以这里不需要避让。
   * 保持字段结构（宽高为 0 = 不触发）以便将来需要时恢复。
   */
  overview: { right: 0, bottom: 0, width: 0, height: 0 },
} as const;

/**
 * 整屏分区：顶中标题、左右翼透明卡、中央 3D 主视觉。
 * 四种数据卡默认落在左右翼，不要自动堆到 3D 下面。底部仍躲开抽屉和右下「总览」。
 */
export const WIDGET_STAGE_FRAME = {
  title: { x: 22, y: 2, w: 56, h: 7 },
  caption: { x: 78, y: 2, w: 20, h: 6 },
  leftCol: { x: 2, y: 10.2, w: 20.4 },
  rightCol: { x: 77.6, y: 10.2, w: 20.4 },
  bottomBase: { x: 23.8, y: 66, w: 52.4, h: 16 },
  columnGap: 1.4,
  baseGap: 1.2,
} as const;

export type WidgetStageZone = "title" | "caption" | "left" | "right" | "bottom";

export function contentBottom(): number {
  return 100 - WIDGET_SAFE_AREA.bottom;
}

export function stageFrameRects() {
  const bottomLimit = contentBottom();
  const left = { ...WIDGET_STAGE_FRAME.leftCol, h: bottomLimit - WIDGET_STAGE_FRAME.leftCol.y };
  const right = { ...WIDGET_STAGE_FRAME.rightCol, h: bottomLimit - WIDGET_STAGE_FRAME.rightCol.y };
  const bottom = { ...WIDGET_STAGE_FRAME.bottomBase };
  const stage = {
    x: left.x + left.w + WIDGET_STAGE_FRAME.columnGap,
    y: WIDGET_STAGE_FRAME.leftCol.y,
    w: WIDGET_STAGE_FRAME.rightCol.x - (left.x + left.w) - WIDGET_STAGE_FRAME.columnGap * 2,
    h: WIDGET_STAGE_FRAME.bottomBase.y - WIDGET_STAGE_FRAME.leftCol.y - WIDGET_STAGE_FRAME.baseGap,
  };
  return {
    title: { ...WIDGET_STAGE_FRAME.title },
    caption: { ...WIDGET_STAGE_FRAME.caption },
    left,
    right,
    bottom,
    stage,
  };
}

export function isWingWidgetType(type: string): boolean {
  return type === "metric-card" || type === "ratio-ring" || type === "gauge-ring" || type === "trend-chart" || type === "summary-card" || type === "selection-card";
}

export function zoneForWidgetType(type: string): WidgetStageZone {
  if (type === "title") return "title";
  if (type === "caption") return "caption";
  if (type === "selection-card") return "right";
  return "left";
}

/** 已有卡片按当前位置归区，避免「按整屏分区整理」把左右翼的卡强行堆到底部。 */
export function zoneForExistingWidget(widget: Pick<SceneWidget, "type" | "x" | "y">): WidgetStageZone {
  if (widget.type === "title") return "title";
  if (widget.type === "caption") return "caption";
  const leftEnd = WIDGET_STAGE_FRAME.leftCol.x + WIDGET_STAGE_FRAME.leftCol.w;
  const rightStart = WIDGET_STAGE_FRAME.rightCol.x;
  if (widget.x >= rightStart - 2) return "right";
  if (widget.x <= leftEnd) return "left";
  if (widget.y >= WIDGET_STAGE_FRAME.bottomBase.y - 2) return "bottom";
  return widget.x >= 50 ? "right" : "left";
}

export function preferredWingZone(layout: SceneWidgetLayout): "left" | "right" {
  const left = layout.widgets.filter((item) => zoneForExistingWidget(item) === "left").length;
  const right = layout.widgets.filter((item) => zoneForExistingWidget(item) === "right").length;
  return left <= right ? "left" : "right";
}

export function isLockedStageType(type: string): boolean {
  return type === "title" || type === "caption";
}

export function widgetTypeMeta(type: string): SceneWidgetTypeMeta | undefined {
  return SCENE_WIDGET_TYPE_REGISTRY.find((item) => item.type === type);
}

export function isKnownWidgetType(type: string): boolean {
  return SCENE_WIDGET_TYPE_REGISTRY.some((item) => item.type === type);
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tokenName(value: unknown, fallback: string): string {
  const raw = text(value) || fallback;
  if (raw.startsWith("--")) return raw;
  if (raw.startsWith("ngx-")) return `--${raw}`;
  if (raw.startsWith("var(")) {
    const inner = raw.slice(4, -1).trim();
    return inner || fallback;
  }
  // 拒绝把十六进制色写进布局
  if (raw.startsWith("#") || raw.startsWith("rgb")) return fallback;
  return fallback;
}

/** 接受 0.50–0.90 或 50–90；写出两位小数。超出范围就夹到 50%–90%。 */
export function clampGlassOpacity(value: unknown, fallback = DEFAULT_GLASS_OPACITY): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  const ratio = !Number.isFinite(n) ? fallback : n > 1 && n <= 100 ? n / 100 : n;
  const stepped = Math.round(ratio * 100) / 100;
  return Math.min(GLASS_OPACITY_MAX, Math.max(GLASS_OPACITY_MIN, stepped));
}

export function parseOptionalGlassOpacity(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  if (typeof value === "string" && !Number.isFinite(Number(value))) return undefined;
  return clampGlassOpacity(value);
}

export function layoutGlassOpacity(layout: Pick<SceneWidgetLayout, "glassOpacity"> | null | undefined): number {
  return clampGlassOpacity(layout?.glassOpacity, DEFAULT_GLASS_OPACITY);
}

/** 单卡 style.opacity 覆盖整屏默认；未设置则跟随 layout.glassOpacity。 */
export function effectiveGlassOpacity(
  layout: Pick<SceneWidgetLayout, "glassOpacity"> | null | undefined,
  widget?: Pick<SceneWidget, "style"> | null,
): number {
  if (widget?.style && Object.prototype.hasOwnProperty.call(widget.style, "opacity") && widget.style.opacity != null) {
    return clampGlassOpacity(widget.style.opacity);
  }
  return layoutGlassOpacity(layout);
}

/** 运行态 / 预览：已存的百分比两套皮共用；未存时用 0.64 建议值，不把该默认写进布局。 */
export function effectiveHudGlassOpacity(
  layout: Pick<SceneWidgetLayout, "glassOpacity"> | null | undefined,
  widget?: Pick<SceneWidget, "style"> | null,
): number {
  if (widget?.style && Object.prototype.hasOwnProperty.call(widget.style, "opacity") && widget.style.opacity != null) {
    return clampGlassOpacity(widget.style.opacity);
  }
  if (layout?.glassOpacity != null) return layoutGlassOpacity(layout);
  return HUD_DEFAULT_GLASS_OPACITY;
}

export function widgetHasGlassOverride(widget: Pick<SceneWidget, "style"> | null | undefined): boolean {
  return Boolean(widget?.style && Object.prototype.hasOwnProperty.call(widget.style, "opacity") && widget.style.opacity != null);
}

export function clearWidgetGlassOverride(widget: SceneWidget): SceneWidget {
  if (!widgetHasGlassOverride(widget) || !widget.style) return widget;
  const { opacity: _removed, ...rest } = widget.style;
  return { ...widget, style: rest };
}

export function parseWidgetSlot(raw: unknown): SceneWidgetSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  /*
   * 槽位键（2026-11-24 加 slotKey 容错）。
   *
   * <p>`bind-telemetry` 操作里这个字段叫 `slotKey`，而 `SceneWidgetSlot`
   * 自己叫 `key` —— AI 混淆是**系统性**的，实测它 add-widget 时给出
   * `{slotKey:"series-0", telemetryKey:"energy"}`。
   *
   * <p>不认 `slotKey` 的后果比「键丢了」更糟：下面会退到 telemetryKey，
   * 于是槽位键变成 `energy` —— 一个跟槽位毫无关系的名字。
   * 渲染层找不到 `series-0`，卡片**空白且不报错**。
   */
  const key = text(row.key) || text(row.slotKey) || text(row.telemetryKey) || "value";
  const slot: SceneWidgetSlot = { key };
  const label = text(row.label);
  const unit = text(row.unit);
  const telemetryKey = text(row.telemetryKey);
  const sceneEntityId = text(row.sceneEntityId);
  const deviceId = text(row.deviceId);
  if (label) slot.label = label;
  if (unit) slot.unit = unit;
  const displayType = text(row.displayType);
  if (displayType === "number" || displayType === "boolean" || displayType === "text") {
    slot.displayType = displayType;
  }
  const render = text(row.render);
  if (render === "bar") slot.render = "bar";
  const barMax = Number(row.barMax);
  if (Number.isFinite(barMax) && barMax > 0) slot.barMax = barMax;
  /*
   * 静态值（2026-11-23）。
   *
   * ★ 用 `Number.isFinite` 而不是 `> 0`：量程可以是 0（「0 台故障」的基准），
   * 也可以是负数（温度下限 -25℃）。只排除 NaN / Infinity / 空字符串
   * （`Number("")` 是 0，会把「没填」误读成「量程 0」—— 必须先确认原值存在）。
   */
  const rawConstant = row.constant;
  if (rawConstant !== undefined && rawConstant !== null && rawConstant !== "") {
    const constant = Number(rawConstant);
    if (Number.isFinite(constant)) slot.constant = constant;
  }
  const aggregate = text(row.aggregate);
  if (aggregate === "sum" || aggregate === "avg" || aggregate === "max" || aggregate === "min") {
    slot.aggregate = aggregate;
  }
  if (telemetryKey) slot.telemetryKey = telemetryKey;
  if (sceneEntityId) slot.sceneEntityId = sceneEntityId;
  if (deviceId) slot.deviceId = deviceId;
  /* v2 资产属性槽。scope 只认三种合法值，其他当没写。 */
  const assetId = text(row.assetId);
  const attributeKey = text(row.attributeKey);
  if (assetId) slot.assetId = assetId;
  if (attributeKey) slot.attributeKey = attributeKey;
  const scope = text(row.attributeScope);
  if (scope === "SERVER_SCOPE" || scope === "SHARED_SCOPE" || scope === "CLIENT_SCOPE") {
    slot.attributeScope = scope;
  }
  const staleAfterSec = Number(row.staleAfterSec);
  if (Number.isFinite(staleAfterSec) && staleAfterSec > 0) slot.staleAfterSec = staleAfterSec;
  return slot;
}

export function parseWidgetScope(raw: unknown): SceneWidgetScope | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const kind = text(row.kind);
  if (kind === "site") {
    const siteId = text(row.siteId);
    if (!siteId) return undefined;
    const scope: SceneWidgetScope = { kind: "site", siteId };
    const siteName = text(row.siteName);
    if (siteName) scope.siteName = siteName;
    return scope;
  }
  if (kind === "topology") {
    const topologyId = text(row.topologyId);
    if (!topologyId) return undefined;
    const scope: SceneWidgetScope = { kind: "topology", topologyId };
    const topologyName = text(row.topologyName);
    if (topologyName) scope.topologyName = topologyName;
    const siteId = text(row.siteId);
    if (siteId) scope.siteId = siteId;
    const siteName = text(row.siteName);
    if (siteName) scope.siteName = siteName;
    return scope;
  }
  return undefined;
}

export function widgetScopeKey(scope?: SceneWidgetScope | null): string | undefined {
  if (!scope) return undefined;
  if (scope.kind === "site" && scope.siteId) return `site:${scope.siteId}`;
  if (scope.kind === "topology" && scope.topologyId) return `topology:${scope.topologyId}`;
  return undefined;
}

export function widgetScopeIsBound(scope?: SceneWidgetScope | null): boolean {
  return Boolean(widgetScopeKey(scope));
}

export function layoutHasWidgets(layout: SceneWidgetLayout | null | undefined): boolean {
  return Boolean(layout?.widgets.length);
}

/** 改 widgets 或透明度时保留模板 id、草稿和接口绑定。 */
export function withWidgetLayout(
  layout: SceneWidgetLayout,
  widgets: SceneWidget[],
  glassOpacity = layout.glassOpacity,
): SceneWidgetLayout {
  const next: SceneWidgetLayout = { schemaVersion: "1.0.0", widgets };
  if (glassOpacity != null) next.glassOpacity = glassOpacity;
  if (layout.templateId) next.templateId = layout.templateId;
  if (layout.templateVersion != null) next.templateVersion = layout.templateVersion;
  if (layout.templateDraft) next.templateDraft = layout.templateDraft;
  if (layout.interfaceBindings) next.interfaceBindings = layout.interfaceBindings;
  if (layout.regionTitles) next.regionTitles = layout.regionTitles;
  return next;
}

export function overviewSituationTitle(sceneName?: string): string {
  const name = (sceneName ?? "").trim();
  return name ? `${name} · 综合态势` : "综合态势";
}

/** 模型绑定区和卡片绑定区共用的人话说明。 */
export const WIDGET_MODEL_BINDING_HINT =
  "三维模型上的绑定只管铭牌和底部抽屉启停。左右翼卡片上的数字由对接结果按模板接口一次写入，两套不要混在一起。工作台「核对绑定」只用来查看结果，不是手工一项项填写的步骤。";

export const OVERVIEW_SITUATION_REPLACE_CONFIRM =
  "当前画面上已有小部件。用综合态势样板替换后，现有卡片和绑定都会被清掉。确定要替换吗？";

export function clampWidgetRect(input: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const minW = 8;
  const minH = 6;
  const w = Math.min(80, Math.max(minW, input.w));
  const h = Math.min(70, Math.max(minH, input.h));
  const maxX = 100 - WIDGET_SAFE_AREA.right - w;
  const maxY = 100 - WIDGET_SAFE_AREA.bottom - h;
  let x = Math.min(Math.max(WIDGET_SAFE_AREA.left, input.x), Math.max(WIDGET_SAFE_AREA.left, maxX));
  let y = Math.min(Math.max(WIDGET_SAFE_AREA.top, input.y), Math.max(WIDGET_SAFE_AREA.top, maxY));
  const ov = WIDGET_SAFE_AREA.overview;
  const overviewLeft = 100 - ov.right - ov.width;
  const overviewTop = 100 - ov.bottom - ov.height;
  const overlapsOverview = x + w > overviewLeft && x < 100 - ov.right && y + h >= overviewTop && y < 100 - ov.bottom;
  if (overlapsOverview) {
    x = Math.min(x, Math.max(WIDGET_SAFE_AREA.left, overviewLeft - w));
  }
  return { x, y, w, h };
}

/**
 * 解析一条控制配置。
 *
 * <p>校验要点：deviceId 与 commandId 必填 —— 缺任何一个这条按钮都发不出去。
 * 宁可整条丢掉，也不要留一个「点下去没反应」的空按钮。
 */
export function parseSceneWidgetControl(raw: unknown): SceneWidgetControl | null {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const deviceId = text(row.deviceId);
  const commandId = text(row.commandId);
  if (!deviceId || !commandId) return null;
  const key = text(row.key) || commandId;
  const control: SceneWidgetControl = { key, deviceId, commandId };
  const label = text(row.label);
  if (label) control.label = label;
  const kind = text(row.kind);
  if (kind === "toggle" || kind === "button") control.kind = kind;
  const onParams = plainParams(row.onParams);
  if (onParams) control.onParams = onParams;
  const offParams = plainParams(row.offParams);
  if (offParams) control.offParams = offParams;
  const params = plainParams(row.params);
  if (params) control.params = params;
  const stateKey = text(row.stateKey);
  if (stateKey) control.stateKey = stateKey;
  const confirmText = text(row.confirmText);
  if (confirmText) control.confirmText = confirmText;
  return control;
}

function plainParams(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

export function parseSceneWidgetControlList(raw: unknown): SceneWidgetControl[] {
  return Array.isArray(raw)
    ? raw.map(parseSceneWidgetControl).filter((item): item is SceneWidgetControl => Boolean(item))
    : [];
}

export function parseSceneWidget(raw: unknown, index = 0): SceneWidget | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = text(row.type) || "metric-card";
  const meta = widgetTypeMeta(type);
  const size = meta?.defaultSize ?? { w: 18, h: 16 };
  const rect = clampWidgetRect({
    x: num(row.x, 4 + (index % 3) * 20),
    y: num(row.y, 4 + Math.floor(index / 3) * 18),
    w: num(row.w, size.w),
    h: num(row.h, size.h),
  });
  const styleRaw = row.style && typeof row.style === "object" ? (row.style as Record<string, unknown>) : {};
  const override = parseOptionalGlassOpacity(styleRaw.opacity ?? row.opacity);
  const slots = Array.isArray(row.slots)
    ? row.slots.map((item) => parseWidgetSlot(item)).filter((item): item is SceneWidgetSlot => Boolean(item))
    : Array.isArray(row.bindings)
      ? row.bindings.map((item, i) => parseWidgetSlot({ ...(item as object), key: `binding-${i}` })).filter((item): item is SceneWidgetSlot => Boolean(item))
      : [];
  const widget: SceneWidget = {
    id: text(row.id) || `widget-${index}`,
    type,
    ...rect,
    style: {
      backgroundToken: tokenName(styleRaw.backgroundToken, DEFAULT_WIDGET_STYLE_TOKENS.backgroundToken),
      borderToken: tokenName(styleRaw.borderToken, DEFAULT_WIDGET_STYLE_TOKENS.borderToken),
      blurToken: tokenName(styleRaw.blurToken, DEFAULT_WIDGET_STYLE_TOKENS.blurToken),
      textToken: tokenName(styleRaw.textToken, DEFAULT_WIDGET_STYLE_TOKENS.textToken),
      mutedToken: tokenName(styleRaw.mutedToken, DEFAULT_WIDGET_STYLE_TOKENS.mutedToken),
      ...(override != null ? { opacity: override } : {}),
    },
  };
  const title = text(row.title);
  if (title) widget.title = title;
  if (slots.length) widget.slots = slots;
  const filterText = text(row.filterText);
  if (filterText) widget.filterText = filterText;
  /*
   * 数据口径（2026-11-23）：白名单解析，非法值一律回落 telemetry。
   * 回落而不是报错 —— 一个手改坏的布局不该让整屏打不开。
   */
  const dataSource = text(row.dataSource);
  if (dataSource === "energy") widget.dataSource = "energy";
  else if (dataSource === "telemetry") widget.dataSource = "telemetry";
  const energyMetric = text(row.energyMetric);
  /*
   * 兼容早期的 "electricity"：它是第一版的写法，存量布局里有。
   * 映射成 usage + elec，行为不变。
   */
  if (energyMetric === "electricity") {
    widget.energyMetric = "usage";
    widget.energyKind = "elec";
  } else if (
    energyMetric === "usage" || energyMetric === "cost" || energyMetric === "carbon"
    || energyMetric === "tce" || energyMetric === "trend" || energyMetric === "ranking"
  ) {
    widget.energyMetric = energyMetric;
  }
  const energyKind = text(row.energyKind);
  if (energyKind) widget.energyKind = energyKind;
  /* 告警跑马灯的条数上限（2026-11-23）：只收正整数，0 / 负数 / 非数字一律忽略 */
  const alarmLimit = Number(row.alarmLimit);
  if (Number.isFinite(alarmLimit) && alarmLimit > 0) widget.alarmLimit = Math.floor(alarmLimit);
  const subtitle = text(row.subtitle);
  if (subtitle) widget.subtitle = subtitle;
  const controls = parseSceneWidgetControlList(row.controls);
  if (controls.length) widget.controls = controls;
  const scope = parseWidgetScope(row.scope);
  if (scope) widget.scope = scope;
  return widget;
}

function parseStoredInterfaceBinding(raw: unknown): TemplateInterfaceBinding | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const regionId = text(row.regionId);
  const key = text(row.key);
  if (!regionId || !key) return null;
  const binding: TemplateInterfaceBinding = { regionId, key };
  const source = text(row.source);
  if (source === "site" || source === "scene-topology" || source === "device-point") binding.source = source;
  const siteId = text(row.siteId);
  const siteName = text(row.siteName);
  const topologyId = text(row.topologyId);
  const topologyName = text(row.topologyName);
  const deviceId = text(row.deviceId);
  const telemetryKey = text(row.telemetryKey);
  const unit = text(row.unit);
  const label = text(row.label);
  if (siteId) binding.siteId = siteId;
  if (siteName) binding.siteName = siteName;
  if (topologyId) binding.topologyId = topologyId;
  if (topologyName) binding.topologyName = topologyName;
  if (deviceId) binding.deviceId = deviceId;
  if (telemetryKey) binding.telemetryKey = telemetryKey;
  if (unit) binding.unit = unit;
  if (label) binding.label = label;
  return binding;
}

export function parseSceneWidgetLayout(payload: unknown): SceneWidgetLayout {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const rawWidgets = Array.isArray(row.widgets) ? row.widgets : Array.isArray(payload) ? payload : [];
  const widgets = rawWidgets.map((item, index) => parseSceneWidget(item, index)).filter((item): item is SceneWidget => Boolean(item));
  const glassOpacity = parseOptionalGlassOpacity(row.glassOpacity);
  const layout: SceneWidgetLayout = glassOpacity != null
    ? { schemaVersion: "1.0.0", glassOpacity, widgets }
    : { schemaVersion: "1.0.0", widgets };
  const templateId = text(row.templateId);
  if (templateId) layout.templateId = templateId;
  if (row.templateVersion != null && num(row.templateVersion, 0) > 0) layout.templateVersion = Math.floor(num(row.templateVersion, 1));
  if (row.templateDraft && typeof row.templateDraft === "object") layout.templateDraft = row.templateDraft as ScreenTemplate;
  if (Array.isArray(row.interfaceBindings)) {
    const bindings = row.interfaceBindings.map((item) => parseStoredInterfaceBinding(item)).filter((item): item is TemplateInterfaceBinding => Boolean(item));
    if (bindings.length) layout.interfaceBindings = bindings;
  }
  if (row.regionTitles && typeof row.regionTitles === "object" && !Array.isArray(row.regionTitles)) {
    const titles: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.regionTitles as Record<string, unknown>)) {
      const title = text(value);
      if (key && title) titles[key] = title;
    }
    if (Object.keys(titles).length) layout.regionTitles = titles;
  }
  /*
   * 数据源（2026-11-23）。
   *
   * <p>★ 本函数是**白名单**解析：没被这里挑出来的字段一律丢弃。
   * 踩过一次 —— 后端存了 `dataSources`（PUT 后读回还在），
   * 但前端解析时丢了，面板永远显示不出来。所以「新增场景级字段」
   * 有两道关：① zod schema（保存本地时）② 这里（读平台时）。漏一道就静默失效。
   */
  if (Array.isArray(row.dataSources)) {
    const sources = row.dataSources.map((item) => parseSceneDataSource(item)).filter((item): item is SceneDataSource => Boolean(item));
    if (sources.length) layout.dataSources = sources;
  }
  return layout;
}

/**
 * 解析一个数据源条目。形状不对就返回 undefined（丢弃该条，不拖垮整个布局）。
 *
 * <p>`kind` 与必填字段的对应关系**不在这里校验** —— 那是
 * `validateSceneDataSources` 的职责（保存时给人话提示）。
 * 这里只管「能不能安全地变成对象」。
 */
function parseSceneDataSource(payload: unknown): SceneDataSource | undefined {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const id = text(row.id);
  const name = text(row.name);
  const kind = text(row.kind);
  if (!id || !name) return undefined;
  if (kind !== "device" && kind !== "asset" && kind !== "scope") return undefined;

  const source: SceneDataSource = { id, name, kind };
  const deviceId = text(row.deviceId);
  const assetId = text(row.assetId);
  const note = text(row.note);
  if (deviceId) source.deviceId = deviceId;
  if (assetId) source.assetId = assetId;
  if (note) source.note = note;

  if (row.scope && typeof row.scope === "object" && !Array.isArray(row.scope)) {
    const scopeRow = row.scope as Record<string, unknown>;
    const scopeKind = text(scopeRow.kind);
    if (scopeKind === "site" || scopeKind === "topology") {
      const scope: NonNullable<SceneDataSource["scope"]> = { kind: scopeKind };
      const siteId = text(scopeRow.siteId);
      const topologyId = text(scopeRow.topologyId);
      const siteName = text(scopeRow.siteName);
      const topologyName = text(scopeRow.topologyName);
      if (siteId) scope.siteId = siteId;
      if (topologyId) scope.topologyId = topologyId;
      if (siteName) scope.siteName = siteName;
      if (topologyName) scope.topologyName = topologyName;
      source.scope = scope;
    }
  }
  return source;
}

/** 模板只复用布局、透明度和未绑定槽位；去掉客户 deviceId、测点键和场景对象。 */
export function toTemplateWidgetLayout(layout: SceneWidgetLayout): SceneWidgetLayout {
  const widgets = layout.widgets.map((widget) => ({
    ...widget,
    slots: widget.slots
      ?.map((slot) => {
        const next: SceneWidgetSlot = { key: slot.key };
        if (slot.label) next.label = slot.label;
        if (slot.unit) next.unit = slot.unit;
        /* displayType / render 是「这一列怎么显示」，属于模板设计，跟着模板走。 */
        if (slot.displayType) next.displayType = slot.displayType;
        if (slot.render) next.render = slot.render;
        if (slot.barMax != null) next.barMax = slot.barMax;
        /*
         * constant 跟着模板走：它是**设计值**（量程/参考线），
         * 不是某台设备的数据 —— 换客户、换场站都不该变。
         */
        if (slot.constant != null) next.constant = slot.constant;
        if (slot.aggregate) next.aggregate = slot.aggregate;
        return next;
      })
      .filter((slot) => slot.key),
    scope: undefined,
    /*
     * 控制按钮绑的是具体设备（deviceId），属于实例配置，不进模板。
     * 不删的话，「用模板建场景」会把上个客户的网关 id 带过去 ——
     * 那台设备在新客户下不存在，按钮点了静默失败。
     */
    controls: undefined,
  }));
  const next = withWidgetLayout(layout, widgets, layout.glassOpacity != null ? clampGlassOpacity(layout.glassOpacity) : undefined);
  delete next.interfaceBindings;
  delete next.regionTitles;
  return next;
}

export function nextWidgetId(existing: SceneWidget[]): string {
  return `widget-${Date.now().toString(36)}-${existing.length}`;
}

export function canAddWidgetType(layout: SceneWidgetLayout, type: string): boolean {
  const meta = widgetTypeMeta(type);
  if (!meta?.maxCount) return true;
  return layout.widgets.filter((item) => item.type === type).length < meta.maxCount;
}

export function placeNewWidget(layout: SceneWidgetLayout, type: string, partial?: Partial<SceneWidget>): SceneWidget {
  const meta = widgetTypeMeta(type);
  const size = meta?.defaultSize ?? { w: 18, h: 16 };
  const zone = isWingWidgetType(type) && type !== "selection-card" ? preferredWingZone(layout) : zoneForWidgetType(type);
  const slot = nextSlotInZone(layout, zone, size);
  const widget = parseSceneWidget(
    {
      id: nextWidgetId(layout.widgets),
      type,
      ...slot,
      ...partial,
    },
    layout.widgets.length,
  )!;
  return widget;
}

function widgetsInZone(layout: SceneWidgetLayout, zone: WidgetStageZone): SceneWidget[] {
  return layout.widgets.filter((item) => zoneForExistingWidget(item) === zone);
}

function packColumn(items: SceneWidget[], col: { x: number; y: number; w: number; h: number }): SceneWidget[] {
  if (!items.length) return [];
  const gap = WIDGET_STAGE_FRAME.columnGap;
  const h = Math.max(6, (col.h - gap * (items.length - 1)) / items.length);
  return items.map((widget, index) => ({
    ...widget,
    ...clampWidgetRect({ x: col.x, y: col.y + index * (h + gap), w: col.w, h }),
  }));
}

function packBottomBase(items: SceneWidget[], base: { x: number; y: number; w: number; h: number }): SceneWidget[] {
  if (!items.length) return [];
  const gap = WIDGET_STAGE_FRAME.baseGap;
  const cols = items.length <= 3 ? items.length : 3;
  const rows = Math.ceil(items.length / cols);
  const natural = (base.w - gap * (cols - 1)) / cols;
  const w = Math.max(8, items.length < 3 ? Math.min(22, natural) : natural);
  const h = Math.max(6, (base.h - gap * (rows - 1)) / rows);
  const used = cols * w + gap * (cols - 1);
  const originX = base.x + Math.max(0, (base.w - used) / 2);
  return items.map((widget, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      ...widget,
      ...clampWidgetRect({ x: originX + col * (w + gap), y: base.y + row * (h + gap), w, h }),
    };
  });
}

/** 在标题栏、右上说明、左右翼或底部底座里取下一个空位。 */
export function nextSlotInZone(
  layout: SceneWidgetLayout,
  zone: WidgetStageZone,
  size: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const rects = stageFrameRects();
  if (zone === "title") {
    return clampWidgetRect({ ...rects.title, h: size.h || rects.title.h });
  }
  if (zone === "caption") {
    return clampWidgetRect({ ...rects.caption, h: size.h || rects.caption.h });
  }
  if (zone === "bottom") {
    const preview = packBottomBase(
      [...widgetsInZone(layout, "bottom"), { id: "next", type: "metric-card", x: 0, y: 0, w: size.w, h: size.h } as SceneWidget],
      rects.bottom,
    );
    const last = preview[preview.length - 1]!;
    return { x: last.x, y: last.y, w: last.w, h: last.h };
  }
  const col = zone === "right" ? rects.right : rects.left;
  const existing = widgetsInZone(layout, zone);
  const y = existing.length
    ? Math.max(...existing.map((item) => item.y + item.h)) + WIDGET_STAGE_FRAME.columnGap
    : col.y;
  const h = Math.min(size.h, Math.max(6, col.y + col.h - y));
  return clampWidgetRect({ x: col.x, y, w: col.w, h });
}

/** 按封面骨架整理：标题锁顶中，说明锁右上，左右翼按现有左右位置对齐。不改 type 和绑定，不把翼上的卡强行堆到 3D 下。 */
export function relayoutStageFrame(layout: SceneWidgetLayout): SceneWidgetLayout {
  const rects = stageFrameRects();
  const byZone: Record<WidgetStageZone, SceneWidget[]> = { title: [], caption: [], left: [], right: [], bottom: [] };
  for (const widget of layout.widgets) {
    byZone[zoneForExistingWidget(widget)].push(widget);
  }
  const widgets: SceneWidget[] = [
    ...byZone.title.map((widget) => ({ ...widget, ...clampWidgetRect({ ...rects.title, h: widget.h || rects.title.h }) })),
    ...byZone.caption.map((widget) => ({ ...widget, ...clampWidgetRect({ ...rects.caption, h: widget.h || rects.caption.h }) })),
    ...packColumn(byZone.left, rects.left),
    ...packColumn(byZone.right, rects.right),
    ...packBottomBase(byZone.bottom, rects.bottom),
  ];
  return withWidgetLayout(layout, widgets, layout.glassOpacity);
}

/** 按综合态势稿图一次摆好：顶中标题，左翼主指标+状态汇总，右翼圆环+趋势。全部未绑定。 */
export function buildOverviewSituationLayout(sceneName?: string): SceneWidgetLayout {
  const left = WIDGET_STAGE_FRAME.leftCol;
  const right = WIDGET_STAGE_FRAME.rightCol;
  const ringSlots = [
    { key: "used-0", label: "已用 1" },
    { key: "total-0", label: "总数 1" },
    { key: "used-1", label: "已用 2" },
    { key: "total-1", label: "总数 2" },
  ];
  const raw = [
    { type: "title", title: overviewSituationTitle(sceneName), ...WIDGET_STAGE_FRAME.title },
    { type: "metric-card", title: "实时负荷", x: left.x, y: left.y, w: left.w, h: 18 },
    { type: "summary-card", title: "设备状态", x: left.x, y: left.y + 19.4, w: left.w, h: 16 },
    { type: "ratio-ring", title: "运行台数", x: right.x, y: right.y, w: right.w, h: 22, slots: ringSlots },
    { type: "trend-chart", title: "用能趋势", x: right.x, y: right.y + 23.4, w: right.w, h: 22 },
  ];
  const widgets = raw.map((item, index) => parseSceneWidget({ id: `overview-${item.type}`, ...item }, index)!);
  return { schemaVersion: "1.0.0", templateId: "overview-situation", templateVersion: 1, widgets };
}
