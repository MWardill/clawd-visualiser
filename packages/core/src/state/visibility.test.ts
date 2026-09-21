import { describe, expect, it } from "vitest";
import { T0 } from "../testing/events";
import { DEFAULT_CONFIG } from "./config";
import { newSession, type SessionState } from "./session";
import { isShown } from "./visibility";

const HOUR = 3_600_000;
const quiet = (prompts: number, over: Partial<SessionState> = {}): SessionState => ({ ...newSession("s1", "k1", T0), state: "asleep", prompts, lastActiveAt: T0, ...over });

describe("isShown", () => {
  it("always shows a working session, prompted or not", () => {
    expect(isShown(quiet(0, { state: "working" }), T0 + 1_000 * HOUR, DEFAULT_CONFIG)).toBe(true);
  });

  it("shows a waiting session until it has waited 36 hours, measured from when the wait began, whatever its prompts", () => {
    for (const prompts of [0, 1, 9]) {
      // Something else in the session was active 30 hours in (a subagent stopping, say): the wait is still dated from `since`.
      const waiting = quiet(prompts, { state: "waiting", since: T0, lastActiveAt: T0 + 30 * HOUR });
      expect(isShown(waiting, T0 + 36 * HOUR - 1, DEFAULT_CONFIG)).toBe(true);
      expect(isShown(waiting, T0 + 36 * HOUR, DEFAULT_CONFIG)).toBe(false);
    }
  });

  it("never shows a session nobody has prompted", () => {
    expect(isShown(quiet(0, { state: "idle" }), T0, DEFAULT_CONFIG)).toBe(false);
  });

  it("shows a one-prompt session until three hours after its last activity", () => {
    expect(isShown(quiet(1), T0 + 3 * HOUR - 1, DEFAULT_CONFIG)).toBe(true);
    expect(isShown(quiet(1), T0 + 3 * HOUR, DEFAULT_CONFIG)).toBe(false);
  });

  it("shows a session with two to eight prompts until a day after its last activity", () => {
    for (const prompts of [2, 8]) {
      expect(isShown(quiet(prompts), T0 + 24 * HOUR - 1, DEFAULT_CONFIG)).toBe(true);
      expect(isShown(quiet(prompts), T0 + 24 * HOUR, DEFAULT_CONFIG)).toBe(false);
    }
  });

  it("always shows a session with more than eight prompts", () => {
    expect(isShown(quiet(9), T0 + 1_000 * HOUR, DEFAULT_CONFIG)).toBe(true);
  });

  it("judges a done session like a quiet one, so a long-hidden session plays no exit", () => {
    expect(isShown(quiet(1, { state: "done" }), T0 + HOUR, DEFAULT_CONFIG)).toBe(true);
    expect(isShown(quiet(1, { state: "done" }), T0 + 4 * HOUR, DEFAULT_CONFIG)).toBe(false);
  });
});
