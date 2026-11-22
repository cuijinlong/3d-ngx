import { create } from "zustand";
import type { Device } from "@idt/shared-types";
import { listDevices } from "../services/device/deviceService";
import { useSceneStore } from "./scene.store";

interface DeviceState {
  devices: Device[];
  loading: boolean;
  refresh: () => Promise<void>;
}

let refreshSeq = 0;

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  loading: false,
  refresh: async () => {
    const seq = ++refreshSeq;
    set({ loading: true });
    try {
      const platform = useSceneStore.getState().document?.platform;
      const devices = await listDevices({ siteId: platform?.siteId, topologyId: platform?.topologyId, customerId: platform?.customerId });
      if (seq !== refreshSeq) return;
      set({ devices, loading: false });
    } catch {
      if (seq === refreshSeq) set({ loading: false });
    }
  },
}));
