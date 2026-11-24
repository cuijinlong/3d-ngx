import { afterEach, describe, expect, it } from "vitest";
import { createId } from "./id";

const originalRandomUUID = crypto.randomUUID;

afterEach(() => {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: originalRandomUUID,
  });
});

describe("createId", () => {
  it("still returns unique prefix_ + 12 hex ids when randomUUID is missing", () => {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });

    const first = createId("scene");
    const second = createId("scene");

    expect(first).toMatch(/^scene_[0-9a-f]{12}$/);
    expect(second).toMatch(/^scene_[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
  });
});
