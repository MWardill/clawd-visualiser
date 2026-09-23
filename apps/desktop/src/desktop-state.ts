// ~/.clawd/desktop.json: what the app remembers between runs that is not the agent's config. The
// window's bounds, and whether the user wants the app at login, absent until a first packaged run or
// a toggle, the view (one window or a widget per pane), whether a finished turn pops its box up,
// and where each folder's widget was left, absent until a widget is placed. A missing or damaged file
// reads as nothing remembered. A file that is there but cannot be read (locked, say) is different:
// what it holds is unknown, so nothing is written over it for the rest of the run. A failed write is
// logged and dropped, since the next change writes the whole file again. A development run keeps its
// own file, so what it remembers never steers the packaged app.
import { readJsonFile, silentLogger, writeJsonAtomic, type Logger } from "@clawd/agent";
import { join } from "node:path";

export type Bounds = { x: number; y: number; width: number; height: number };
/** The one scene window, or one frameless window per pane. */
export type View = "window" | "widgets";
/** Where a folder's widget was left, and whether it was pinned on top. */
export type Placement = { x: number; y: number; pinned: boolean };
/**
 * One folder's place as the file holds it; the list is in the order written, newest last. A list,
 * not an object keyed by label, because an object lists number-like keys first whatever order they
 * were written in, and a folder may be called `2024`.
 */
export type StoredPlacement = Placement & { label: string };
export type DesktopState = { bounds?: Bounds; maximized?: boolean; openAtLogin?: boolean; view?: View; finishedPopup?: boolean; popupInCorner?: boolean; widgets?: StoredPlacement[] };

/** Folders come and go; the file does not grow for ever. */
export const MAX_PLACEMENTS = 200;
/** Longer than any directory name Windows allows. */
const MAX_LABEL = 300;

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

/**
 * The valid places in a `widgets` list, each judged on its own. A label that appears twice keeps
 * its last occurrence, in that occurrence's position. Then the last 200 written.
 */
function parsePlacements(value: unknown): StoredPlacement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept: StoredPlacement[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { label, x, y, pinned } = raw as Record<string, unknown>;
    if (typeof label !== "string" || label.length === 0 || label.length > MAX_LABEL) continue;
    if (!whole(x) || !whole(y) || typeof pinned !== "boolean") continue;
    const duplicate = kept.findIndex((entry) => entry.label === label);
    if (duplicate !== -1) kept.splice(duplicate, 1);
    kept.push({ label, x, y, pinned });
  }
  return kept.slice(-MAX_PLACEMENTS);
}

/** The place of the entry with this label; undefined when there is none. */
export function placementOf(state: DesktopState, label: string): Placement | undefined {
  const found = state.widgets?.find((entry) => entry.label === label);
  return found === undefined ? undefined : { x: found.x, y: found.y, pinned: found.pinned };
}

/** The list without that label, then this place last, then the last 200 written. Never mutates `all`. */
export function withPlacement(all: readonly StoredPlacement[] | undefined, label: string, placement: Placement): StoredPlacement[] {
  const rest = (all ?? []).filter((entry) => entry.label !== label);
  return [...rest, { label, x: placement.x, y: placement.y, pinned: placement.pinned }].slice(-MAX_PLACEMENTS);
}

/** The valid fields of a version 2 file, each judged on its own; anything else is dropped. */
export function parseDesktopState(value: unknown): DesktopState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const file = value as { version?: unknown; bounds?: unknown; maximized?: unknown; openAtLogin?: unknown; view?: unknown; finishedPopup?: unknown; popupInCorner?: unknown; widgets?: unknown };
  if (file.version !== VERSION) return {};
  const state: DesktopState = {};
  const b = file.bounds;
  if (typeof b === "object" && b !== null) {
    const { x, y, width, height } = b as Record<string, unknown>;
    if (whole(x) && whole(y) && whole(width) && whole(height) && width > 0 && height > 0) state.bounds = { x, y, width, height };
  }
  if (typeof file.maximized === "boolean") state.maximized = file.maximized;
  if (typeof file.openAtLogin === "boolean") state.openAtLogin = file.openAtLogin;
  if (file.view === "window" || file.view === "widgets") state.view = file.view;
  if (typeof file.finishedPopup === "boolean") state.finishedPopup = file.finishedPopup;
  if (typeof file.popupInCorner === "boolean") state.popupInCorner = file.popupInCorner;
  const widgets = parsePlacements(file.widgets);
  if (widgets !== undefined) state.widgets = widgets;
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
