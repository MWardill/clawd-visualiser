import { describe, expect, it } from "vitest";
import { isQuitShortcut, type KeyInput } from "./keys";

const key = (over: Partial<KeyInput>): KeyInput => ({ type: "keyDown", key: "q", code: "KeyQ", control: true, shift: false, alt: false, meta: false, ...over });

describe("isQuitShortcut", () => {
  it("is Ctrl+Q pressed, in either case", () => {
    expect(isQuitShortcut(key({}))).toBe(true);
    expect(isQuitShortcut(key({ key: "Q" }))).toBe(true);
  });

  it("is not a release, another key, Q without Ctrl, or Ctrl+Q with another modifier", () => {
    expect(isQuitShortcut(key({ type: "keyUp" }))).toBe(false);
    expect(isQuitShortcut(key({ key: "w" }))).toBe(false);
    expect(isQuitShortcut(key({ control: false }))).toBe(false);
    expect(isQuitShortcut(key({ shift: true }))).toBe(false);
    expect(isQuitShortcut(key({ alt: true }))).toBe(false);
    expect(isQuitShortcut(key({ meta: true }))).toBe(false);
  });

  it("goes by the physical key only on a layout with no Latin letters, so Ctrl+A stays select-all on AZERTY", () => {
    // Russian: the Q key types й, so `key` never says q.
    expect(isQuitShortcut(key({ key: "й", code: "KeyQ" }))).toBe(true);
    // AZERTY: the physical Q key types a, and the key that types q is physical A.
    expect(isQuitShortcut(key({ key: "a", code: "KeyQ" }))).toBe(false);
    expect(isQuitShortcut(key({ key: "q", code: "KeyA" }))).toBe(true);
    // Dvorak: the physical Q key types an apostrophe.
    expect(isQuitShortcut(key({ key: "'", code: "KeyQ" }))).toBe(false);
    expect(isQuitShortcut(key({ key: "й", code: "KeyW" }))).toBe(false);
  });
});
