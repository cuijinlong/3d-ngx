
import type {
  DataProviderKind,
  DeviceCommandProvider,
  DeviceDataProvider,
  GuardConnectionSettings,
  GuardConnectionStatus,
} from "@idt/shared-types";
import { MockDataProvider, createMockDataProvider } from "./mock-provider";
import { GuardClient } from "./guard-client";
import { TopologyApi } from "./topology-client";
import { SceneStorageApi } from "./scene-storage";
import { SceneTemplateApi } from "./scene-template-client";
import { listRealtimeDevicesFrom, type RealtimeDeviceQuery } from "./list-realtime";
import { GuardServerProvider, createGuardProvider } from "./guard-provider";
import {
  adoptGuardSession,
  browserLocalStorage,
  browserSessionStorage,
  clearRefreshToken,
  GUARD_SETTINGS_KEY,
  persistGuardProfile,
  PLATFORM_CONNECTION_FAILED_MESSAGE,
  toPublicGuardSettings,
  writeRefreshToken,
} from "./guard-session";

let dataProvider: DeviceDataProvider | null = null;
let commandProvider: DeviceCommandProvider | null = null;
let mock: MockDataProvider | null = null;
let kind: DataProviderKind = "mock";
let guardClient: GuardClient | null = null;
let guardStatus: GuardConnectionStatus = { connected: false, kind: "mock" };

const disconnectedPlatformProvider: DeviceDataProvider & DeviceCommandProvider = {
  async getDevices() {
    return [];
  },
  async getDevice() {
    return null;
  },
  async getTelemetry() {
    return [];
  },
  subscribeTelemetry() {
    return () => {};
  },
  async listTelemetryKeys() {
    return [];
  },
  async listCommands() {
    return [];
  },
  async sendCommand() {
    throw new Error("平台未连接，请重新登录");
  },
};

function notifyProviderChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("idt-provider-changed"));
  }
}

function attachMock(): void {
  const created = createMockDataProvider() as MockDataProvider;
  dataProvider = created;
  commandProvider = created;
  mock = created;
  kind = "mock";
  guardClient = null;
}

function attachDisconnectedPlatform(status: GuardConnectionStatus): void {
  dataProvider = disconnectedPlatformProvider;
  commandProvider = disconnectedPlatformProvider;
  mock = null;
  kind = "guard";
  guardClient = null;
  guardStatus = { ...status, connected: false, kind: "guard" };
}

function persistConnectedSession(settings: { apiBase: string; username: string; refreshToken?: string }): void {
  persistGuardProfile({ apiBase: settings.apiBase || "/api", username: settings.username }, browserLocalStorage());
  writeRefreshToken(settings.refreshToken, browserSessionStorage());
}

export function initProviders(): {
  data: DeviceDataProvider;
  command: DeviceCommandProvider;
} {
  if (!dataProvider || !commandProvider) {
    attachMock();
  }
  return { data: dataProvider!, command: commandProvider! };
}

export function getDataProvider(): DeviceDataProvider {
  return initProviders().data;
}

export function getCommandProvider(): DeviceCommandProvider {
  return initProviders().command;
}

export function getProviderKind(): DataProviderKind {
  initProviders();
  return kind;
}

export function getGuardStatus(): GuardConnectionStatus {
  initProviders();
  return { ...guardStatus };
}

export function hasRefreshSession(): boolean {
  return Boolean(adoptGuardSession(browserLocalStorage(), browserSessionStorage()).refreshToken);
}

export function loadSavedGuardSettings(): GuardConnectionSettings | null {
  const adopted = adoptGuardSession(browserLocalStorage(), browserSessionStorage());
  return toPublicGuardSettings(adopted.profile);
}

export function clearSavedGuardSettings(): void {
  const local = browserLocalStorage();
  const profile = adoptGuardSession(local, browserSessionStorage()).profile;
  clearRefreshToken(browserSessionStorage());
  if (profile) persistGuardProfile(profile, local);
  else local?.removeItem(GUARD_SETTINGS_KEY);
}

/**
 * 仅供模拟控制台（暂停、加速、离线）使用。
 * 业务绑定、遥测订阅、指令下发必须走 getDataProvider / getCommandProvider 接口。
 */
export function getMockController(): MockDataProvider {
  initProviders();
  if (!mock || kind !== "mock") {
    throw new Error("当前不是 Mock 数据源");
  }
  return mock;
}

export async function connectGuard(settings: GuardConnectionSettings): Promise<GuardConnectionStatus> {
  initProviders();
  const { provider, client } = await createGuardProvider({
    apiBase: settings.apiBase || "/api",
    username: settings.username,
    password: settings.password,
    token: settings.token,
    refreshToken: settings.refreshToken,
  });
  const state = client.getState();
  const devices = await provider.getDevices();
  dataProvider = provider;
  commandProvider = provider;
  mock = null;
  kind = "guard";
  guardClient = client;
  guardStatus = {
    connected: true,
    kind: "guard",
    apiBase: state.apiBase,
    username: state.username,
    authority: state.authority,
    deviceCount: devices.length,
  };
  persistConnectedSession({
    apiBase: state.apiBase,
    username: state.username,
    refreshToken: state.refreshToken,
  });
  notifyProviderChanged();
  return { ...guardStatus };
}

export async function disconnectGuard(): Promise<void> {
  const client = guardClient;
  if (client?.getState().token) {
    try {
      await client.logout();
    } catch {
      /* 登出接口失败仍要清掉本机会话 */
    }
  }
  clearRefreshToken(browserSessionStorage());
  const local = browserLocalStorage();
  const profile = adoptGuardSession(local, browserSessionStorage()).profile;
  if (profile) persistGuardProfile(profile, local);
  attachMock();
  guardStatus = { connected: false, kind: "mock" };
  notifyProviderChanged();
}

export async function restoreGuardConnection(): Promise<GuardConnectionStatus> {
  const adopted = adoptGuardSession(browserLocalStorage(), browserSessionStorage());
  if (!adopted.profile?.username || (!adopted.refreshToken && !adopted.accessToken)) {
    initProviders();
    return getGuardStatus();
  }
  try {
    return await connectGuard({
      apiBase: adopted.profile.apiBase || "/api",
      username: adopted.profile.username,
      token: adopted.accessToken,
      refreshToken: adopted.refreshToken,
    });
  } catch (error) {
    clearRefreshToken(browserSessionStorage());
    const detail = error instanceof Error && error.message ? error.message : PLATFORM_CONNECTION_FAILED_MESSAGE;
    const message = detail.includes("演示数据") ? PLATFORM_CONNECTION_FAILED_MESSAGE : `${PLATFORM_CONNECTION_FAILED_MESSAGE}（${detail}）`;
    attachDisconnectedPlatform({
      connected: false,
      kind: "guard",
      apiBase: adopted.profile.apiBase,
      username: adopted.profile.username,
      message,
    });
    notifyProviderChanged();
    return { ...guardStatus };
  }
}

export function getConnectedGuardClient(): GuardClient | null {
  initProviders();
  return kind === "guard" && guardStatus.connected ? guardClient : null;
}

export function getTopologyApi(): TopologyApi {
  const client = getConnectedGuardClient();
  if (!client) {
    throw new Error("尚未连接后端，无法读取设备拓扑");
  }
  return new TopologyApi(client);
}

export function getSceneStorageApi(): SceneStorageApi | null {
  const client = getConnectedGuardClient();
  return client ? new SceneStorageApi(client) : null;
}

export function getSceneTemplateApi(): SceneTemplateApi {
  const client = getConnectedGuardClient();
  if (!client) {
    throw new Error("尚未连接后端，无法读取场景模板");
  }
  return new SceneTemplateApi(client);
}

export type { GuardClient, GuardServerProvider };

export async function listRealtimeDevices(query?: RealtimeDeviceQuery): Promise<import("@idt/shared-types").Device[]> {
  return listRealtimeDevicesFrom(getDataProvider(), getConnectedGuardClient(), query);
}

export type { RealtimeDeviceQuery };

/** 单测重置模块级连接状态，业务代码不要调用。 */
export function resetProvidersForTests(): void {
  dataProvider = null;
  commandProvider = null;
  mock = null;
  kind = "mock";
  guardClient = null;
  guardStatus = { connected: false, kind: "mock" };
}
