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

export function applyDemoCommand(deviceId: string, commandId: string, label = ""): boolean | null {
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
