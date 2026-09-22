// The widgets' controller: which windows exist, what each was last sent, where each is, and what a
// page may ask of main. One window per pane, keyed by the pane's label, which outlives an agent
// restart where its alias does not. Electron-free: main hands in a window factory, the cursor and
// the displays, so every rule here is tested over doubles.
import type { Logger } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import type { MenuItemConstructorOptions } from "electron";
import type { Bounds, Placement, View } from "../desktop-state";
import type { WidgetSize, WidgetState } from "../widget/state";
import { widgetMenuTemplate } from "./menu";
import { DEFAULT_WIDGET_SIZE, clampDrop, placeWidget } from "./placement";
import { emptied, paneSnapshot, planWidgets } from "./plan";

/** A widget's window, as much of it as the controller uses. `window.ts` fits a BrowserWindow to it. */
export type WidgetWindow = {
  /** The id of the window's webContents: how a message's sender is matched to its window. */
  readonly id: number;
  bounds(): Bounds;
  setBounds(bounds: Bounds): void;
  setPinned(on: boolean): void;
  /** Shows the window, or brings it above its neighbours, without giving it the keyboard. */
  reveal(): void;
  send(state: WidgetState): void;
  popupMenu(template: MenuItemConstructorOptions[]): void;
  close(): void;
  /** The page failed to load, or its renderer went. */
  onFailed(cb: () => void): void;
  /** The window is gone, whoever closed it. */
  onClosed(cb: () => void): void;
};

export type ControllerDeps = {
  createWindow(bounds: Bounds): WidgetWindow;
  /** Where the cursor is, in the units `setBounds` takes. */
  cursor(): { x: number; y: number };
  workAreas(): Bounds[];
  primaryWorkArea(): Bounds;
  placement(label: string): Placement | undefined;
  savePlacement(label: string, placement: Placement): void;
  /** A Clawd was clicked: the full window, on that session. */
  openSession(alias: string): void;
  openWindow(): void;
  openSettings(): void;
  log: Logger;
};

export type WidgetController = {
  setView(view: View): void;
  /** `source` names the agent the snapshot came from (`own:<run>`, `attached:<port>`); a new name is a new generation. */
  setSnapshot(s: Snapshot, source: string): void;
  /** There is no agent to hear from: the Clawds walk out, same as any pane that leaves, and what is shown goes after the cap. */
  noSource(): void;
  /** Brings every widget already shown forward; answers how many are showing. */
  showAll(): number;
  closeAll(): void;
  /**
   * Closes every window and ignores everything after: snapshots, view changes and page calls that
   * would make a window. For the quit, when the agent may still emit.
   */
  shutdown(): void;
  // What a page may ask, each with its sender's id. A sender no window has is ignored.
  ready(sender: number): WidgetState | null;
  resize(sender: number, size: WidgetSize | null): void;
  dragStart(sender: number): void;
  dragMove(sender: number): void;
  dragEnd(sender: number): void;
  togglePin(sender: number): void;
  select(sender: number, alias: string): void;
  menu(sender: number): void;
};

/** How long a window outlives its pane, for the walk out, when its page never says it has finished. */
export const CLOSE_CAP_MS = 5_000;
/** How often one label's widget may fail in a run of the app before it is left alone. */
export const MAX_TRIES = 3;

type Entry = {
  label: string;
  win: WidgetWindow;
  pane: string;
  size: WidgetSize;
  pinned: boolean;
  /** The page has asked for its state. Nothing is sent before that: it would arrive before the page listens. */
  ready: boolean;
  /** Shown once its page has reported a size, so it never appears empty or at the wrong size. */
  revealed: boolean;
  /** The snapshot the page was last given: what it draws, and the only aliases `select` accepts from it. */
  shown: Snapshot | null;
  /** The state last sent, as text, so a snapshot that changes nothing for this pane sends nothing. */
  sent: string;
  closing: ReturnType<typeof setTimeout> | null;
  drag: { dx: number; dy: number; moved: boolean } | null;
};

/**
 * A state as text, less the time the snapshot was made, which changes with every snapshot and draws
 * nothing. Compares JSON text, which is order-sensitive: the attached feed's snapshots are normalised
 * by core's SnapshotSchema.parse (through fetchSnapshot), and the app's own agent's arrive in-process
 * from core's builder, unparsed, whose key order is stable too; paneSnapshot/emptied spread that same
 * object either way, so key order never drifts in practice. The worst case of a differently ordered
 * snapshot is one extra push, not a wrong one.
 */
const keyOf = (state: WidgetState): string => JSON.stringify({ ...state, snapshot: state.snapshot === null ? null : { ...state.snapshot, generatedAt: "" } });

export function createWidgetController(deps: ControllerDeps): WidgetController {
  let view: View = "window";
  let snapshot: Snapshot | null = null;
  let source: string | null = null;
  let generation = 0;
  // Set by shutdown, for the quit: once true, nothing here opens a window again.
  let down = false;
  const entries = new Map<string, Entry>();
  const tries = new Map<string, number>();

  const bySender = (sender: number): Entry | undefined => {
    for (const e of entries.values()) if (e.win.id === sender) return e;
    return undefined;
  };

  const stateOf = (e: Entry): WidgetState => ({ snapshot: e.shown, generation, pinned: e.pinned });

  const push = (e: Entry): void => {
    if (!e.ready) return;
    const state = stateOf(e);
    const key = keyOf(state);
    if (key === e.sent) return;
    e.sent = key;
    e.win.send(state);
  };

  /** Forgets a window. Safe to call twice: closing one calls back here through onClosed. */
  const drop = (e: Entry): void => {
    if (e.closing !== null) clearTimeout(e.closing);
    e.closing = null;
    if (entries.get(e.label) === e) entries.delete(e.label);
  };

  const close = (e: Entry): void => {
    drop(e);
    e.win.close();
  };

  const open = (label: string, pane: string): Entry | undefined => {
    if ((tries.get(label) ?? 0) >= MAX_TRIES) return undefined;
    const remembered = deps.placement(label);
    const bounds = placeWidget({
      remembered,
      size: DEFAULT_WIDGET_SIZE,
      workAreas: deps.workAreas(),
      primary: deps.primaryWorkArea(),
      taken: [...entries.values()].map((other) => other.win.bounds()),
    });
    const win = deps.createWindow(bounds);
    const e: Entry = { label, win, pane, size: DEFAULT_WIDGET_SIZE, pinned: remembered?.pinned ?? false, ready: false, revealed: false, shown: null, sent: "", closing: null, drag: null };
    entries.set(label, e);
    if (e.pinned) win.setPinned(true);
    win.onFailed(() => {
      if (entries.get(label) !== e) return;
      const n = (tries.get(label) ?? 0) + 1;
      tries.set(label, n);
      deps.log("desktop.widgetFailed", { tries: n });
      close(e);
    });
    win.onClosed(() => drop(e));
    return e;
  };

  const reconcile = (leaving: Snapshot | null = snapshot): void => {
    if (down) return;
    const current = snapshot;
    const wanted = new Set<string>();
    if (current !== null) {
      for (const w of planWidgets({ snapshot: current, view, raised: new Set() })) {
        const e = entries.get(w.label) ?? open(w.label, w.pane);
        if (e === undefined) continue;
        wanted.add(w.label);
        if (e.closing !== null) clearTimeout(e.closing);
        e.closing = null;
        e.pane = w.pane;
        e.shown = paneSnapshot(current, w.pane);
        push(e);
      }
    }
    for (const e of [...entries.values()]) {
      if (wanted.has(e.label)) continue;
      // Its pane has left (or there is no source at all): the page plays the walk out and then says it has nothing left to draw.
      if (leaving !== null) {
        e.shown = emptied(leaving);
        push(e);
      }
      if (e.closing === null) e.closing = setTimeout(() => close(e), CLOSE_CAP_MS);
    }
  };

  const closeAll = (): void => {
    for (const e of [...entries.values()]) close(e);
  };

  const togglePin = (e: Entry): void => {
    // The menu's closure may outlive its entry.
    if (entries.get(e.label) !== e) return;
    e.pinned = !e.pinned;
    e.win.setPinned(e.pinned);
    // A pinned widget should be where it was pinned next time too, dragged or not.
    const b = e.win.bounds();
    deps.savePlacement(e.label, { x: b.x, y: b.y, pinned: e.pinned });
    push(e);
  };

  return {
    setView(next) {
      if (down) return;
      if (next === view) return;
      view = next;
      if (view === "window") closeAll();
      else reconcile();
    },
    setSnapshot(s, from) {
      if (from !== source) {
        source = from;
        generation++;
      }
      snapshot = s;
      reconcile();
    },
    noSource() {
      const leaving = snapshot;
      source = null;
      snapshot = null;
      reconcile(leaving);
    },
    showAll() {
      let showing = 0;
      for (const e of entries.values()) {
        if (!e.revealed || e.closing !== null) continue;
        e.win.reveal();
        showing++;
      }
      return showing;
    },
    closeAll,
    shutdown() {
      down = true;
      closeAll();
    },
    ready(sender) {
      const e = bySender(sender);
      if (e === undefined) return null;
      const state = stateOf(e);
      e.ready = true;
      e.sent = keyOf(state);
      return state;
    },
    resize(sender, size) {
      const e = bySender(sender);
      if (e === undefined) return;
      if (size === null) {
        // Nothing left to draw. Only a window whose pane has left is waiting for that; a page also says it when it clears its scene.
        if (e.closing !== null) close(e);
        return;
      }
      e.size = size;
      const b = e.win.bounds();
      e.win.setBounds({ x: b.x, y: b.y, ...size });
      if (e.revealed) return;
      e.revealed = true;
      e.win.reveal();
    },
    dragStart(sender) {
      const e = bySender(sender);
      if (e === undefined) return;
      const at = deps.cursor();
      const b = e.win.bounds();
      e.drag = { dx: at.x - b.x, dy: at.y - b.y, moved: false };
    },
    dragMove(sender) {
      const e = bySender(sender);
      if (e === undefined || e.drag === null) return;
      const at = deps.cursor();
      const x = at.x - e.drag.dx;
      const y = at.y - e.drag.dy;
      const b = e.win.bounds();
      if (x === b.x && y === b.y) return;
      e.drag.moved = true;
      // The size goes with every move: a position alone lets the window's size drift on a scaled display.
      e.win.setBounds({ x, y, ...e.size });
    },
    dragEnd(sender) {
      const e = bySender(sender);
      if (e === undefined || e.drag === null) return;
      const moved = e.drag.moved;
      e.drag = null;
      if (!moved) return;
      const b = e.win.bounds();
      const kept = clampDrop({ x: b.x, y: b.y, ...e.size }, deps.workAreas());
      if (kept.x !== b.x || kept.y !== b.y) e.win.setBounds(kept);
      deps.savePlacement(e.label, { x: kept.x, y: kept.y, pinned: e.pinned });
    },
    togglePin(sender) {
      const e = bySender(sender);
      if (e !== undefined) togglePin(e);
    },
    select(sender, alias) {
      const e = bySender(sender);
      // Only an alias main itself sent this window.
      if (e?.shown?.sessions.some((session) => session.alias === alias)) deps.openSession(alias);
    },
    menu(sender) {
      const e = bySender(sender);
      if (e === undefined) return;
      e.win.popupMenu(widgetMenuTemplate(e.pinned, { togglePin: () => togglePin(e), openWindow: deps.openWindow, settings: deps.openSettings }));
    },
  };
}
