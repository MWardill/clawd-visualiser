// ~/.clawd/desktop.json: what the app remembers between runs that is not the agent's config. The
// window's bounds, and whether the user wants the app at login, absent until a first packaged run or
// the tray decides. A missing or damaged file reads as nothing remembered; a failed write is dropped,
// since the next change writes the whole file again.
import { readJsonFile, writeJsonAtomic } from "@clawd/agent";
import { join } from "node:path";

export type Bounds = { x: number; y: number; width: number; height: number };
export type DesktopState = { bounds?: Bounds; openAtLogin?: boolean };

const VERSION = 1;

export function desktopStatePath(home: string): string {
  return join(home, "desktop.json");
}

const whole = (value: unknown): value is number => Number.isInteger(value);

/** The valid fields of a version 1 file, each judged on its own; anything else is dropped. */
export function parseDesktopState(value: unknown): DesktopState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const file = value as { version?: unknown; bounds?: unknown; openAtLogin?: unknown };
  if (file.version !== VERSION) return {};
  const state: DesktopState = {};
  const b = file.bounds;
  if (typeof b === "object" && b !== null) {
    const { x, y, width, height } = b as Record<string, unknown>;
    if (whole(x) && whole(y) && whole(width) && whole(height) && width > 0 && height > 0) state.bounds = { x, y, width, height };
  }
  if (typeof file.openAtLogin === "boolean") state.openAtLogin = file.openAtLogin;
  return state;
}

export type DesktopStore = {
  /** Reads the file once. Until then, and if it cannot be read, nothing is remembered. */
  load(): Promise<void>;
  get(): DesktopState;
  /** Merges the patch now, and writes the whole file after any write already queued. */
  update(patch: DesktopState): void;
  /** Resolves once every queued write has finished or failed. Never rejects. */
  flush(): Promise<void>;
};

export function createDesktopStore(path: string): DesktopStore {
  let state: DesktopState = {};
  let chain: Promise<void> = Promise.resolve();
  return {
    async load() {
      try {
        const file = await readJsonFile(path);
        // What was updated while the file was being read is newer than the file.
        if (file.found && file.ok) state = { ...parseDesktopState(file.value), ...state };
      } catch {
        // Unreadable, say locked by another process: start with nothing remembered.
      }
    },
    get: () => state,
    update(patch) {
      state = { ...state, ...patch };
      const snapshot = { version: VERSION, ...state };
      chain = chain.then(() => writeJsonAtomic(path, snapshot)).catch(() => {});
    },
    flush: () => chain,
  };
}
