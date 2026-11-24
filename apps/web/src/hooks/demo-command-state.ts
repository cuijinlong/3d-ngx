/**
 * 演示模式下启停的本地运行状态。
 * 数值仍由演示测点生成，但运行/停止必须能被指令改写，不能写死为始终运行。
 */

const running = new Map<string, boolean>();

export function getDemoRunning(deviceId: string, fallback = true): boolean {
  return running.get(deviceId) ?? fallback;
}

export function setDemoRunning(deviceId: string, value: boolean): void {
  running.set(deviceId, value);
}

export function clearDemoRunning(): void {
  running.clear();
}

export function isStartCommand(commandId: string, label = ""): boolean {
  const id = commandId.toLowerCase();
  if (id === "startall") return false;
  return id === "start" || id.startsWith("start:") || id.startsWith("start/") || /启动/.test(label);
}

export function isStopCommand(commandId: string, label = ""): boolean {
  const id = commandId.toLowerCase();
  if (id === "stopall") return false;
  return id === "stop" || id.startsWith("stop:") || id.startsWith("stop/") || /停止/.test(label);
}

/**
 * 演示模式下模拟一次命令的效果。
 *
 * <h2>为什么必须看 params.on</h2>
 *
 * 真实协议里「系统启停」是**一条双向命令**（`setSystemPower`，写 40051，
 * 0 关机 / 1 开机），方向和 start/stop 两条命令的形态根本不同。
 *
 * 旧实现只按 id/标签猜方向：`setSystemPower` 的标签是「系统启停」，
 * `/启动/` 匹配不上 → 返回 null → 演示状态不变 → **界面看着「点了没反应」**。
 *
 * <p>反过来也不能靠标签里有没有「启」来猜：启停是一个词，既含启也含停，
 * 猜哪边都是错的。双向命令必须由参数决定方向，没参数就返回 null（不猜）。
 *
 * @param params 命令参数。带 `on: boolean` 时以它为准。
 */
export function applyDemoCommand(
  deviceId: string,
  commandId: string,
  label = "",
  params?: Record<string, unknown>,
): boolean | null {
  const on = params?.on;
  if (typeof on === "boolean") {
    setDemoRunning(deviceId, on);
    return on;
  }
  if (isStartCommand(commandId, label)) {
    setDemoRunning(deviceId, true);
    return true;
  }
  if (isStopCommand(commandId, label)) {
    setDemoRunning(deviceId, false);
    return false;
  }
  return null;
}
