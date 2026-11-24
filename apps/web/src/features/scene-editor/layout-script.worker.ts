/// <reference lib="webworker" />
/**
 * 脚本模式的 Worker 宿主（2026-11-23）。
 *
 * <h2>为什么必须在 Worker 里跑</h2>
 *
 * <p>在线编程的脚本是人/AI 现写的，最常见的错误就是死循环
 * （`while (i < widgets.length)` 忘了 `i++`）。在主线程执行会**冻结整个编辑器**：
 * 撤销栈、保存队列、3D 渲染全停，用户只能强杀标签页 —— 而此刻布局还没保存。
 *
 * <p>Worker 的唯一价值是 **`terminate()`**：主线程超时后直接杀掉，
 * 不用和脚本讲道理。这是同步代码唯一可靠的超时手段
 * （`Promise.race` 对同步死循环无效，事件循环根本没机会跑）。
 *
 * <h2>隔离带来的额外好处</h2>
 *
 * <p>Worker 里没有 `window`、`document`、`localStorage`。
 * 脚本即使写了 `localStorage.clear()` 也只是 `ReferenceError`，
 * 碰不到用户的编辑器状态。
 *
 * <p>注意：Worker **有** `fetch`。所以 `<code>ctx</code>` 里刻意不暴露任何网络能力，
 * 需要外部数据时由主线程通过 `data` 注入（设备表、测点键）。
 */

import { runLayoutScript, type LayoutScriptData, type LayoutScriptResult } from "@idt/data-adapter";

export interface LayoutScriptRequest {
  id: number;
  code: string;
  layout: unknown;
  data: LayoutScriptData;
}

export interface LayoutScriptResponse {
  type: "result";
  id: number;
  result: LayoutScriptResult;
}

/** Worker 报告「脚本即将开始执行」——主线程据此才启动执行超时。 */
export interface LayoutScriptStarted {
  type: "start";
  id: number;
}

self.onmessage = (event: MessageEvent<LayoutScriptRequest>) => {
  const { id, code, layout, data } = event.data;
  /*
   * 先报一声「要开始跑了」，再执行。
   *
   * <p>主线程的 3 秒超时**必须只覆盖脚本执行**，不能覆盖 Worker 的模块加载 ——
   * dev 模式下 Vite 要现场转译这个 worker，首次可能就要好几秒。
   * 实测（2026-11-23）：计时器从建 Worker 就开始算，结果示例脚本
   * 本身只跑 5ms，却被误判「执行超过 3000ms」。
   *
   * <p>postMessage 是异步投递：这条 start 会先到主线程排队，
   * 即使紧接着进入死循环，主线程也能收到它并开始计时。
   */
  self.postMessage({ type: "start", id });

  let result: LayoutScriptResult;
  try {
    result = runLayoutScript(layout as never, code, data);
  } catch (error) {
    /*
     * 兜底：runLayoutScript 内部已经 try/catch 了脚本本身，
     * 走到这里说明我们的执行器自己出了问题（比如 layout 形状不对）。
     * 明确说是「执行器异常」而不是「你的脚本错了」，避免误导排查方向。
     */
    result = {
      ok: false,
      operations: [],
      logs: [],
      error: `执行器异常：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const response: LayoutScriptResponse = { type: "result", id, result };
  self.postMessage(response);
};
