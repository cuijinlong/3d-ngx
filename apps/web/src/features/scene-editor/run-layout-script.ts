/**
 * 在 Worker 里跑在线编程脚本（2026-11-23）。
 *
 * <h2>三个职责</h2>
 *
 * <ol>
 *   <li><b>执行超时强杀</b> —— 到点 `terminate()`，不跟脚本讲道理。
 *       同步死循环里 `Promise.race` 无效（事件循环被占死），只有杀线程能恢复。</li>
 *   <li><b>把「加载」和「执行」分开计时</b> —— 见下方 `started` 说明。
 *       踩过一次：计时器从建 Worker 起算，而 dev 模式下 Vite 现场转译 worker
 *       要好几百毫秒甚至几秒，示例脚本本身只跑 5ms 却被判「超时」。</li>
 *   <li><b>每次新建 Worker</b> —— 复用会带着上一轮的全局状态，
 *       上一轮脚本留下的变量会影响下一轮，排查时极难理解。</li>
 * </ol>
 */

import type { LayoutScriptData, LayoutScriptResult } from "@idt/data-adapter";
import type {
  LayoutScriptRequest,
  LayoutScriptResponse,
  LayoutScriptStarted,
} from "./layout-script.worker";

/**
 * 脚本**执行**超时。
 *
 * <p>3 秒不是拍脑袋：正常脚本（遍历几十个卡片、几层循环）在 10ms 量级完成。
 * 3 秒还没结束，几乎一定是死循环或指数级遍历 —— 早杀早让用户改。
 */
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * 沙盒**加载**超时。
 *
 * <p>只防「Worker 起不来 / 模块加载失败」这种情况，
 * 所以给得比执行超时宽松得多 —— dev 模式转译 + 冷启动可能几秒。
 * 分不清这两者，就会出现「脚本明明没问题却报超时」。
 */
const LOAD_TIMEOUT_MS = 15_000;

export interface RunScriptOptions {
  timeoutMs?: number;
}

/**
 * 执行脚本并返回结果。
 *
 * <p>**永不抛异常** —— 失败都通过 `result.ok=false` + `result.error` 返回。
 * 面板只关心「成不成、为什么不成」，不想再套一层 try。
 */
export function runLayoutScriptInWorker(
  layout: unknown,
  code: string,
  data: LayoutScriptData = {},
  options: RunScriptOptions = {},
): Promise<LayoutScriptResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  return new Promise((resolve) => {
    let worker: Worker | null = null;
    let settled = false;
    let runTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: LayoutScriptResult) => {
      if (settled) return;
      settled = true;
      if (loadTimer) clearTimeout(loadTimer);
      if (runTimer) clearTimeout(runTimer);
      /* 一定要 terminate：正常结束时 Worker 也别忘了回收。 */
      worker?.terminate();
      worker = null;
      resolve({ ...result, durationMs: result.durationMs ?? Date.now() - started });
    };

    /* 加载超时：一直没收到 start，说明沙盒没起来。 */
    const loadTimer = setTimeout(() => {
      finish({
        ok: false,
        operations: [],
        logs: [],
        error:
          `脚本沙盒在 ${LOAD_TIMEOUT_MS} ms 内没有启动。`
          + `通常是构建产物缺失或 worker 加载失败，刷新页面后重试。`,
        durationMs: Date.now() - started,
      });
    }, LOAD_TIMEOUT_MS);

    /** 收到 start 后才开始算「执行」超时。 */
    const startRunTimer = () => {
      if (runTimer || settled) return;
      runTimer = setTimeout(() => {
        finish({
          ok: false,
          operations: [],
          logs: [],
          error:
            `脚本执行超过 ${timeoutMs} ms 已强制中止。`
            + `常见原因是循环没有退出条件（例如 while 里忘了 i++），或遍历量过大。`,
          durationMs: Date.now() - started,
        });
      }, timeoutMs);
    };

    try {
      worker = new Worker(new URL("./layout-script.worker.ts", import.meta.url), {
        type: "module",
        name: "layout-script",
      });
    } catch (error) {
      finish({
        ok: false,
        operations: [],
        logs: [],
        error: `无法启动脚本沙盒：${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - started,
      });
      return;
    }

    worker.onmessage = (event: MessageEvent<LayoutScriptResponse | LayoutScriptStarted>) => {
      const message = event.data;
      if (message.type === "start") {
        startRunTimer();
        return;
      }
      finish(message.result);
    };

    worker.onerror = (event) => {
      /*
       * Worker 内的未捕获异常走到这里（比如 import 失败）。
       * 不用 event.message 直接当结论 —— 它有时是空的，
       * 那样用户只会看到「脚本失败」四个字。
       */
      const detail = event.message || "Worker 内部错误（可能是依赖加载失败）";
      finish({ ok: false, operations: [], logs: [], error: detail, durationMs: Date.now() - started });
    };

    const request: LayoutScriptRequest = {
      id: 0,
      code,
      /* 结构化克隆会深拷贝，Worker 里改不到主线程的布局。 */
      layout,
      data,
    };
    worker.postMessage(request);
  });
}
