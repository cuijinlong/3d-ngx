import { describe, expect, it } from "vitest";
import { PICK_BUFFER_SIZE, mapPointerToPickBuffer } from "./PickingManager";

describe("picking buffer mapping", () => {
  it("maps a pointer into the small shared buffer instead of the canvas pixel size", () => {
    expect(PICK_BUFFER_SIZE).toBeLessThanOrEqual(64);
    expect(PICK_BUFFER_SIZE).toBeGreaterThanOrEqual(1);
    const rect = { left: 100, top: 50, width: 1920, height: 1080 };
    expect(mapPointerToPickBuffer(100, 50, rect)).toEqual({ x: 0, y: 0 });
    const bottomRight = mapPointerToPickBuffer(100 + 1919, 50 + 1079, rect);
    expect(bottomRight.x).toBe(PICK_BUFFER_SIZE - 1);
    expect(bottomRight.y).toBe(PICK_BUFFER_SIZE - 1);
    const mid = mapPointerToPickBuffer(100 + 960, 50 + 540, rect);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(PICK_BUFFER_SIZE);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(PICK_BUFFER_SIZE);
  });
});
