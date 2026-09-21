import { describe, expect, it } from "vitest";
import { showOrCreate, type Revealable } from "./reveal";

function fakeWindow(over: { destroyed?: boolean; minimized?: boolean } = {}) {
  const calls: string[] = [];
  const win: Revealable = {
    isDestroyed: () => over.destroyed === true,
    isMinimized: () => over.minimized === true,
    restore: () => void calls.push("restore"),
    show: () => void calls.push("show"),
    focus: () => void calls.push("focus"),
  };
  return { win, calls };
}

describe("showOrCreate", () => {
  it("makes the window when there is none, or the one there was is destroyed", () => {
    const made = fakeWindow();
    expect(showOrCreate(null, false, () => made.win)).toBe(made.win);
    expect(showOrCreate(fakeWindow({ destroyed: true }).win, false, () => made.win)).toBe(made.win);
    // Creating shows: nothing more is asked of a new window.
    expect(made.calls).toEqual([]);
  });

  it("shows and focuses the window there is, restoring it first when minimised, and makes nothing", () => {
    const plain = fakeWindow();
    const create = (): Revealable => {
      throw new Error("must not create");
    };
    expect(showOrCreate(plain.win, false, create)).toBe(plain.win);
    expect(plain.calls).toEqual(["show", "focus"]);
    const minimised = fakeWindow({ minimized: true });
    showOrCreate(minimised.win, false, create);
    expect(minimised.calls).toEqual(["restore", "show", "focus"]);
  });

  it("does nothing once quitting has begun, for either window", () => {
    const open = fakeWindow();
    const create = (): Revealable => {
      throw new Error("must not create");
    };
    expect(showOrCreate(open.win, true, create)).toBe(open.win);
    expect(showOrCreate(null, true, create)).toBeNull();
    expect(open.calls).toEqual([]);
  });
});
