import { describe, expect, it } from "vitest";
import { flushTelemetryTick, telemetryRuntime, useTelemetryStore } from "./telemetry.store";

describe("telemetry tick merge", () => {
  it("writes into the runtime map immediately but merges UI store updates on a tick", () => {
    useTelemetryStore.getState().clear();
    const startGen = telemetryRuntime.generation;
    useTelemetryStore.getState().apply({
      deviceId: "dev-1",
      key: "power",
      value: 10,
      timestamp: 1,
      source: "guard",
    });
    useTelemetryStore.getState().apply({
      deviceId: "dev-1",
      key: "power",
      value: 12,
      timestamp: 2,
      source: "guard",
    });
    useTelemetryStore.getState().apply({
      deviceId: "dev-2",
      key: "temp",
      value: 18,
      timestamp: 2,
      source: "guard",
    });

    expect(telemetryRuntime.latest.get("dev-1:power")?.value).toBe(12);
    expect(telemetryRuntime.latest.get("dev-2:temp")?.value).toBe(18);
    expect(telemetryRuntime.generation).toBeGreaterThan(startGen);
    expect(useTelemetryStore.getState().latest["dev-1:power"]).toBeUndefined();

    flushTelemetryTick();

    const snap = useTelemetryStore.getState();
    expect(snap.latest["dev-1:power"]?.value).toBe(12);
    expect(snap.latest["dev-2:temp"]?.value).toBe(18);
    expect(snap.history["dev-1:power"]?.map((item) => item.value)).toEqual([12]);
    expect(Object.keys(snap.latest)).toHaveLength(2);
  });
});
