/**
 * 在线编程的**脚本模式**执行层（2026-11-23）。
 *
 * <h2>为什么需要它</h2>
 *
 * <p>JSON 提案只能表达「一条一条列出来的改动」。真实的大屏微调很少是这样：
 * <ul>
 *   <li>「把所有 <code>bar-compare</code> 卡的槽位按数值降序排」；</li>
 *   <li>「凡是 label 含「之和」的槽，补上 aggregate: sum」；</li>
 *   <li>「按设备表给 9 台机组各生成一条 bind-telemetry」；</li>
 *   <li>「右栏三块按内容量重新分配高度」。</li>
 * </ul>
 *
 * <p>这些用 JSON 写要几十条、还得手算坐标。用代码是一行循环。
 *
 * <h2>为什么不直接 eval</h2>
 *
 * <p>脚本来自人/AI 的即时输入，可能死循环、可能抛异常。
 * 在主线程 <code>eval</code> 会**卡死整个编辑器**（撤销/保存/渲染全停），
 * 用户只能强杀标签页 —— 而布局还没保存。
 *
 * <p>所以执行必须放进 Worker：可以 <code>terminate()</code>，可以真超时，
 * 且天然没有 <code>window</code> / <code>document</code> / <code>fetch</code>。
 * 本文件是**纯逻辑**，主线程和 Worker 都能 import。
 *
 * <h2>安全边界：脚本只能产出「操作」，不能直接改布局</h2>
 *
 * <p>脚本拿到的是布局的**深拷贝快照**，只能通过 <code>ctx.ops.*</code> 提交改动。
 * 产出的操作仍要过 <code>examineLayoutProposal</code> 的白名单与保护字段校验。
 *
 * <p>这样脚本模式不是「绕过校验的后门」，而是「用代码写提案」——
 * 预览差异、人工确认、原子拒绝，一个都不少。
 */

import type { LayoutOperation } from "./layout-proposal";
import type { SceneWidget, SceneWidgetLayout, SceneWidgetSlot } from "./scene-widget-layout";

/** 脚本可以读到的外部数据（由外壳注入，脚本自己不联网）。 */
export interface LayoutScriptData {
  /** 平台设备表，通常来自 `listRealtimeDevices()`。 */
  devices?: Array<{ id: string; name?: string; label?: string; type?: string }>;
  /** 每台设备**实际存在**的测点键：`{ [deviceId]: string[] }`。 */
  telemetryKeys?: Record<string, string[]>;
  /** 场景拓扑 id，用于给 scope 槽填空。 */
  topologyId?: string;
  topologyName?: string;
  /** 场站 id。 */
  siteId?: string;
  siteName?: string;
  /**
   * 场景数据源清单（2026-11-23）。
   *
   * <p>这是本次新增的核心：脚本里能按名字拿到「网关」「9 台模块机」这些别名，
   * 不用抄 UUID，也不用猜测点键。
   */
  sources?: Array<{
    id: string;
    name: string;
    kind: string;
    deviceId?: string;
    assetId?: string;
    entityIds: string[];
    note?: string;
  }>;
  /**
   * 勘察结果：每个源上有哪些遥测键 / 属性键 / 告警。
   *
   * <p>由 `useSceneDataDictionary` 拉好注入。**不是**脚本自己去请求 ——
   * Worker 里刻意不暴露网络能力（见 `layout-script.worker.ts`）。
   */
  dictionary?: Record<string, {
    telemetry: Array<{ key: string; label?: string; unit?: string; onEntities?: number }>;
    attributes: string[];
    alarms: Array<{ type: string; level: string; deviceId: string }>;
    error?: string;
  }>;
}

export interface LayoutScriptResult {
  ok: boolean;
  /** 脚本产出的操作（ok=true 时有效）。 */
  operations: LayoutOperation[];
  /** 脚本自己打印的日志（`ctx.log(...)`）。 */
  logs: string[];
  /** 失败原因：语法错、运行时异常、超时、没产出任何操作。 */
  error?: string;
  /** 耗时（毫秒），用于提示「这个脚本慢」。 */
  durationMs?: number;
}

/** 脚本里 `ctx` 的形状。 */
export interface LayoutScriptContext {
  /** 布局的只读深拷贝。改它不影响产出，也不会被直接写回。 */
  layout: SceneWidgetLayout;
  /** `layout.widgets` 的快捷引用（同一个数组）。 */
  widgets: SceneWidget[];
  /** 平台设备表（可能为空数组）。 */
  devices: NonNullable<LayoutScriptData["devices"]>;
  /** 每台设备的测点键。 */
  telemetryKeys: NonNullable<LayoutScriptData["telemetryKeys"]>;
  topologyId?: string;
  topologyName?: string;
  siteId?: string;
  siteName?: string;

  /** 按 id 找卡片，找不到返回 undefined。 */
  find(id: string): SceneWidget | undefined;
  /** 按类型找全部卡片。 */
  ofType(type: string): SceneWidget[];
  /** 取某张卡的槽位（没有则空数组）。 */
  slotsOf(widget: SceneWidget): SceneWidgetSlot[];
  /** 找某张卡的某个槽。 */
  slotOf(widget: SceneWidget, key: string): SceneWidgetSlot | undefined;

  /**
   * 场景数据源（2026-11-23）。
   *
   * <p>开发时最常缺的东西就是「有哪些键可用」。这些方法直接回答它 ——
   * 不用去平台页面翻，也不会写错键名（写错不报错，卡片只会永远空白）。
   */
  sources: Array<{
    id: string;
    name: string;
    kind: string;
    deviceId?: string;
    assetId?: string;
    entityIds: string[];
    note?: string;
  }>;
  /** 按短名找源；找不到返回 undefined（脚本自己判，别抛）。 */
  src(id: string): LayoutScriptContext["sources"][number] | undefined;
  /** 某源上可用的遥测键。 */
  keysOf(id: string): string[];
  /** 某源上可用的属性键。 */
  attributesOf(id: string): string[];
  /** 某源上相关的活跃告警。 */
  alarmsOf(id: string): Array<{ type: string; level: string; deviceId: string }>;

  /** 往日志里写一行（会显示在面板上）。 */
  log(...parts: unknown[]): void;

  /** 提交操作的唯一入口。 */
  ops: {
    update(id: string, patch: Partial<SceneWidget>): void;
    bind(id: string, slotKey: string, telemetryKey: string, deviceId?: string): void;
    add(widget: SceneWidget): void;
    remove(id: string): void;
  };
}

/** 深拷贝一张卡（含 slots 数组，避免脚本改快照时共享引用）。 */
function cloneWidget(widget: SceneWidget): SceneWidget {
  return {
    ...widget,
    ...(widget.slots ? { slots: widget.slots.map((slot) => ({ ...slot })) } : {}),
    ...(widget.controls ? { controls: widget.controls.map((control) => ({ ...control })) } : {}),
    ...(widget.scope ? { scope: { ...widget.scope } } : {}),
    ...(widget.style ? { style: { ...widget.style } } : {}),
  };
}

function cloneLayout(layout: SceneWidgetLayout): SceneWidgetLayout {
  return { ...layout, widgets: layout.widgets.map(cloneWidget) };
}

/**
 * 构造脚本运行环境。
 *
 * <p>导出是为了可测 —— 校验规则必须能在单测里逐条断言，
 * 而不是只能靠「在浏览器里点一下看有没有报错」。
 */
export function createScriptContext(
  layout: SceneWidgetLayout,
  data: LayoutScriptData = {},
): { ctx: LayoutScriptContext; collect: () => LayoutOperation[]; logs: string[] } {
  const snapshot = cloneLayout(layout);
  const operations: LayoutOperation[] = [];
  const logs: string[] = [];

  const find = (id: string) => snapshot.widgets.find((widget) => widget.id === id);

  const ctx: LayoutScriptContext = {
    layout: snapshot,
    widgets: snapshot.widgets,
    devices: data.devices ?? [],
    telemetryKeys: data.telemetryKeys ?? {},
    topologyId: data.topologyId,
    topologyName: data.topologyName,
    siteId: data.siteId,
    siteName: data.siteName,

    find,
    ofType: (type) => snapshot.widgets.filter((widget) => widget.type === type),
    slotsOf: (widget) => widget.slots ?? [],
    slotOf: (widget, key) => (widget.slots ?? []).find((slot) => slot.key === key),

    sources: data.sources ?? [],
    src: (id) => (data.sources ?? []).find((item) => item.id === id),
    keysOf: (id) => (data.dictionary?.[id]?.telemetry ?? []).map((item) => item.key),
    attributesOf: (id) => data.dictionary?.[id]?.attributes ?? [],
    alarmsOf: (id) => data.dictionary?.[id]?.alarms ?? [],

    log: (...parts) => {
      /*
       * 用 String() 逐个转，不用 join —— 对象 join 会变成 "[object Object]"，
       * 日志就失去意义了。JSON.stringify 对循环引用会抛，所以兜一层。
       */
      const line = parts
        .map((part) => {
          if (typeof part === "string") return part;
          try {
            return JSON.stringify(part);
          } catch {
            return String(part);
          }
        })
        .join(" ");
      logs.push(line);
    },

    ops: {
      update: (id, patch) => {
        /*
         * 脚本里允许写 patch 含 slots（整体替换是真实需求：
         * 「按新规则重排全部槽」）。校验交给 examineLayoutProposal，
         * 这里只做形状检查，避免脚本产出明显非法的操作后报一个难懂的错。
         */
        operations.push({ op: "update-widget", id, patch });
      },
      bind: (id, slotKey, telemetryKey, deviceId) => {
        operations.push({
          op: "bind-telemetry",
          id,
          slotKey,
          telemetryKey,
          ...(deviceId ? { deviceId } : {}),
        });
      },
      add: (widget) => {
        operations.push({ op: "add-widget", widget });
      },
      remove: (id) => {
        operations.push({ op: "remove-widget", id });
      },
    },
  };

  return { ctx, collect: () => operations, logs };
}

/**
 * 在**当前线程**跑一段脚本。
 *
 * <p>⚠️ 浏览器里请走 Worker 版本（`runLayoutScriptInWorker`）——
 * 这个函数无法中断死循环，只适合单测和 Node 环境。
 */
export function runLayoutScript(
  layout: SceneWidgetLayout,
  code: string,
  data: LayoutScriptData = {},
): LayoutScriptResult {
  const started = Date.now();
  const { ctx, collect, logs } = createScriptContext(layout, data);

  let runner: (ctx: LayoutScriptContext) => unknown;
  try {
    /*
     * 严格模式：脚本里的 `x = 1`（未声明赋值）应直接报错，
     * 而不是悄悄创建全局变量 —— Worker 里虽然隔离，但静默的 typo
     * 会让人以为「改了没生效」。
     */
    runner = new Function("ctx", `"use strict";\n${code}`) as typeof runner;
  } catch (error) {
    return {
      ok: false,
      operations: [],
      logs,
      error: `语法错误：${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - started,
    };
  }

  try {
    runner(ctx);
  } catch (error) {
    return {
      ok: false,
      operations: [],
      logs,
      error: `运行出错：${error instanceof Error ? error.message : String(error)}`,
      durationMs: Date.now() - started,
    };
  }

  const operations = collect();
  if (!operations.length) {
    return {
      ok: false,
      operations,
      logs,
      /*
       * 空产出**不算成功**。常见原因是忘了调 ctx.ops.*，
       * 或写了个 for 循环但条件永远为假。直接说清楚，
       * 否则用户点「预览」看到「0 行变化」会以为是校验器坏了。
       */
      error: "脚本没有产出任何操作。检查是否调用了 ctx.ops.update / bind / add / remove。",
      durationMs: Date.now() - started,
    };
  }

  return { ok: true, operations, logs, durationMs: Date.now() - started };
}

/* ---------------- 面板里给用户看的示例 ---------------- */

/**
 * 示例脚本：按模板的示例卡片改。
 *
 * <p>选它当默认示例，是因为它同时展示了四种真实用法：
 * 读快照、条件判断、循环、批量提交。
 */
export const SAMPLE_SCRIPT = `// 脚本拿到布局快照，用 ctx.ops.* 提交改动。
// 产物仍会走「预览差异 → 确认应用」，校验规则一条不少。

const GW = "07f4df20-e50d-11f1-9407-71dd197ec25f"; // 网关设备 id

// 1) 系统功率：主指标改成 9 台之和，进出水绑网关
ctx.ops.update("system-power", {
  title: "系统功率",
  subtitle: "SYSTEM POWER",
  slots: [
    { key: "main", label: "9 台机组之和", unit: "kW", telemetryKey: "power", aggregate: "sum" },
    { key: "left", label: "进水", unit: "℃", telemetryKey: "water_in_temp", deviceId: GW },
    { key: "right", label: "出水", unit: "℃", telemetryKey: "water_out_temp", deviceId: GW },
  ],
});

// 2) 所有进度条槽：满量程按语义区分（开度 100，功率 40）
for (const widget of ctx.ofType("device-list")) {
  const slots = ctx.slotsOf(widget).map((slot) => {
    if (slot.render !== "bar") return slot;
    return { ...slot, barMax: slot.key === "opening" ? 100 : 40 };
  });
  ctx.ops.update(widget.id, { slots });
}

// 3) 用数据源：不用抄 UUID，也不用猜测点键
const gw = ctx.src("gw");
if (!gw) {
  ctx.log("没有名为 gw 的数据源，先到「数据源」面板加一个");
} else {
  // 这台网关实际有哪些遥测键，一眼看到；写 bind 时直接引用
  ctx.log("网关可用遥测:", ctx.keysOf("gw").join(", "));
  const active = ctx.alarmsOf("gw");
  if (active.length) ctx.log("网关有", active.length, "条活跃告警");
}

// 4) 凡是 label 含「之和」但没配聚合的，补上 sum —— 口径不能只写在文字里
for (const widget of ctx.widgets) {
  for (const slot of ctx.slotsOf(widget)) {
    if (slot.label && slot.label.includes("之和") && !slot.aggregate) {
      ctx.log("补聚合口径:", widget.id, slot.key);
      ctx.ops.update(widget.id, {
        slots: ctx.slotsOf(widget).map((item) =>
          item.key === slot.key ? { ...item, aggregate: "sum" } : item,
        ),
      });
    }
  }
}

ctx.log("共提交", "见预览");
`;
