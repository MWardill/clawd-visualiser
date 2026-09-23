// The one z-order move Electron has no call for: to the bottom of the stack. `blur()` only swaps a
// window with the next visible one, which may be another widget, so Win32's SetWindowPos does it.
import type { BrowserWindow } from "electron";

const HWND_BOTTOM = 1;
const SWP_NOSIZE_NOMOVE_NOACTIVATE = 0x0001 | 0x0002 | 0x0010;

type SetWindowPos = (hwnd: bigint, after: number, x: number, y: number, cx: number, cy: number, flags: number) => boolean;

let setWindowPos: SetWindowPos | null | undefined;

/**
 * Loaded on first use, not at startup: koffi's native binary sits beside the archive (see
 * electron-builder.yml), and an app that cannot find it should still run, only without this move.
 */
function load(): SetWindowPos | null {
  if (setWindowPos !== undefined) return setWindowPos;
  try {
    const koffi = require("koffi") as typeof import("koffi");
    const user32 = koffi.load("user32.dll");
    setWindowPos = user32.func("bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)") as SetWindowPos;
  } catch {
    setWindowPos = null;
  }
  return setWindowPos;
}

/** Answers false when the move could not be made: not Windows, or koffi would not load. */
export function sendToBack(win: BrowserWindow): boolean {
  if (process.platform !== "win32") return false;
  const move = load();
  if (move === null) return false;
  return move(win.getNativeWindowHandle().readBigUInt64LE(0), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE_NOMOVE_NOACTIVATE);
}
