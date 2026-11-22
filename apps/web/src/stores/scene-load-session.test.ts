import { describe, expect, it } from "vitest";
import { createLoadSession } from "./scene-load-session";

describe("scene load session", () => {
  it("ignores an expired ticket after timeout, and does not cancel a newer load", () => {
    const session = createLoadSession();
    const first = session.begin();
    expect(first.isCurrent()).toBe(true);
    first.expire();
    expect(first.isCurrent()).toBe(false);

    const second = session.begin();
    first.expire();
    expect(second.isCurrent()).toBe(true);
    expect(first.isCurrent()).toBe(false);
  });

  it("invalidates an in-flight ticket when leaving the page", () => {
    const session = createLoadSession();
    const ticket = session.begin();
    session.invalidate();
    expect(ticket.isCurrent()).toBe(false);
  });
});
