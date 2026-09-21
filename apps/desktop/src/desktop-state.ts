// ~/.clawd/desktop.json: what the app remembers between runs that is not the agent's config. The
// window's bounds, and whether the user wants the app at login, absent until a first packaged run or
// a toggle. A missing or damaged file reads as nothing remembered. A file that is there but cannot
// be read (locked, say) is different: what it holds is unknown, so nothing is written over it for
// the rest of the run. A failed write is logged and dropped, since the next change writes the whole
// file again. A development run keeps its own file, so what it remembers never steers the packaged app.
import { readJsonFile, silentLogger, writeJsonAtomic, type Logger } from "@clawd/agent";
import { join } from "node:path";

export type Bounds = { x: number; y: number; width: number; height: number };
export type DesktopState = { bounds?: Bounds; maximized?: boolean; openAtLogin?: boolean };

/**
 * Version 2 since stage 6.1. Version 1 files were only ever written by development runs before
 * stage 6, when both shared one file, and their login choice must not decide the packaged app's
 * first run; they read as nothing remembered, which costs the saved bounds once.
 */
const VERSION = 2;

export function desktopStatePath(home: string, packaged: boolean): string {
  return join(home, packaged ? "desktop.json" : "desktop-dev.json");
}

const whole = (value: unknown): value is number => Number.isInteger(value);

/** The valid fields of a version 2 file, each judged on its own; anything else is dropped. */
export function parseDesktopState(value: unknown): DesktopState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const file = value as { version?: unknown; bounds?: unknown; maximized?: unknown; openAtLogin?: unknown };
  if (file.version !== VERSION) return {};
  const state: DesktopState = {};
  const b = file.bounds;
  if (typeof b === "object" && b !== null) {
    const { x, y, width, height } = b as Record<string, unknown>;
    if (whole(x) && whole(y) && whole(width) && whole(height) && width > 0 && height > 0) state.bounds = { x, y, width, height };
  }
  if (typeof file.maximized === "boolean") state.maximized = file.maximized;
  if (typeof file.openAtLogin === "boolean") state.openAtLogin = file.openAtLogin;
  return state;
}

export type DesktopStore = {
  /** Reads the file once. Until then, and if it cannot be read, nothing is remembered. */
  load(): Promise<void>;
  get(): DesktopState;
  /** False after a load that found a file it could not read. Nothing is written then, and main skips the first-run login item, since a stored choice of off may be in that file. */
  usable(): boolean;
  /** Merges the patch now, and writes the whole file after any write already queued. */
  update(patch: DesktopState): void;
  /** Resolves once every queued write has finished or failed. Never rejects. */
  flush(): Promise<void>;
};

export function createDesktopStore(path: string, log: Logger = silentLogger): DesktopStore {
  let state: DesktopState = {};
  let usable = true;
  let chain: Promise<void> = Promise.resolve();
  return {
    async load() {
      try {
        const file = await readJsonFile(path);
        // What was updated while the file was being read is newer than the file.
        if (file.found && file.ok) state = { ...parseDesktopState(file.value), ...state };
      } catch {
        // There is a file and it cannot be read now. What it holds is unknown, so it must not be replaced by a guess.
        usable = false;
        log("desktop.stateUnreadable");
      }
    },
    get: () => state,
    usable: () => usable,
    update(patch) {
      state = { ...state, ...patch };
      if (!usable) return;
      const snapshot = { version: VERSION, ...state };
      chain = chain.then(() => writeJsonAtomic(path, snapshot)).catch(() => log("desktop.stateWriteFailed"));
    },
    flush: () => chain,
  };
}
