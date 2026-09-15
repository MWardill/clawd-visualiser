import { describe, expect, it } from "vitest";
import { isQuitShortcut, type KeyInput } from "./keys";

const key = (over: Partial<KeyInput>): KeyInput => ({ type: "keyDown", key: "q", control: true, shift: false, alt: false, meta: false, ...over });

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
});
