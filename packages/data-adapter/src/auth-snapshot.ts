import { resolvePlatformAuthority, sessionRole, type SessionRole } from "./authority";
import { getConnectedGuardClient, getGuardStatus } from "./registry";

export interface AuthSnapshot {
  connected: boolean;
  authority?: string;
  customerId?: string;
  username?: string;
  role: SessionRole;
}

export function getAuthSnapshot(): AuthSnapshot {
  const status = getGuardStatus();
  const state = getConnectedGuardClient()?.getState();
  const connected = Boolean(status.connected && status.kind === "guard");
  const authority = resolvePlatformAuthority(state) ?? status.authority;
  return {
    connected,
    authority,
    customerId: state?.customerId,
    username: state?.username ?? status.username,
    role: sessionRole(authority, connected),
  };
}
