// The widgets' controller: which windows exist, what each was last sent, where each is, which are
// raised, and what a page may ask of main. One window per pane, keyed by the pane's label, which
// outlives an agent restart where its alias does not. Electron-free: main hands in a window
// factory, the cursor, the displays and whether the full window has the keyboard, so every rule
// here is tested over doubles.
import type { Logger } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import type { MenuItemConstructorOptions } from "electron";
import type { Bounds, Placement, View } from "../desktop-state";
import type { WidgetSize, WidgetState } from "../widget/state";
import { finishedTurns, stillRaising } from "./finished";
import { widgetMenuTemplate } from "./menu";
import { DEFAULT_WIDGET_SIZE, clampDrop, placeWidget } from "./placement";
import { emptied, paneSnapshot, planWidgets } from "./plan";

/** How a widget sits among other windows: an ordinary window; above ordinary ones, pinned; above everything, raised. Each is a band, not a nudge. */
export type WidgetLevel = "normal" | "pinned" | "raised";

/** A widget's window, as much of it as the controller uses. `window.ts` fits a BrowserWindow to it. */
export type WidgetWindow = {
  /** The id of the window's webContents: how a message's sender is matched to its window. */
  readonly id: number;
  bounds(): Bounds;
  setBounds(bounds: Bounds): void;
  setLevel(level: WidgetLevel): void;
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
  /** Whether the full window has the keyboard: then the maintainer is already looking, and no popup is made. */
  windowFocused(): boolean;
  /** A Clawd was clicked: bring that session's terminal to the front, as the sheet's focus button does. The full window stays where it is. */
  focusSession(alias: string): void;
  openWindow(): void;
  openSettings(): void;
  log: Logger;
};

export type WidgetController = {
  setView(view: View): void;
  /** Whether a finished turn raises its pane's box. Off lowers every raised one. */
  setPopup(on: boolean): void;
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
  /** Its label is in the raised set: on top at the highest level and drawn green. */
  raised: boolean;
  /** A popup in window view: made for a raise, closed once lowered, never pinned. */
  temporary: boolean;
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

const levelOf = (e: Entry): WidgetLevel => (e.raised ? "raised" : e.pinned ? "pinned" : "normal");

export function createWidgetController(deps: ControllerDeps): WidgetController {
  let view: View = "window";
  let popup = false;
  let snapshot: Snapshot | null = null;
  /** The snapshot before `snapshot`, from the same source: what a finish is measured against. Null at a source's first. */
  let previous: Snapshot | null = null;
  let source: string | null = null;
  let generation = 0;
  // Set by shutdown, for the quit: once true, nothing here opens a window again.
  let down = false;
  const entries = new Map<string, Entry>();
  const tries = new Map<string, number>();
  /** The panes where a turn has finished and nobody has looked: the label, and the sessions holding the raise. */
  const raised = new Map<string, Set<string>>();

  const bySender = (sender: number): Entry | undefined => {
    for (const e of entries.values()) if (e.win.id === sender) return e;
    return undefined;
  };

  const stateOf = (e: Entry): WidgetState => ({ snapshot: e.shown, generation, pinned: e.pinned, raised: e.raised, temporary: e.temporary });

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

  const open = (label: string, pane: string, temporary: boolean): Entry | undefined => {
    if ((tries.get(label) ?? 0) >= MAX_TRIES) return undefined;
    const remembered = deps.placement(label);
    const bounds = placeWidget({
      // A popup is always at the bottom right, wherever the folder's own widget lives.
      remembered: temporary ? undefined : remembered,
      size: DEFAULT_WIDGET_SIZE,
      workAreas: deps.workAreas(),
      primary: deps.primaryWorkArea(),
      taken: [...entries.values()].map((other) => other.win.bounds()),
      // A popup comes up from the bottom right, away from where the widgets stack.
      stack: temporary ? "up" : "down",
    });
    const win = deps.createWindow(bounds);
    // A temporary widget has no pin, so a remembered one is not honoured; its level is raised anyway.
    const pinned = !temporary && (remembered?.pinned ?? false);
    const e: Entry = { label, win, pane, size: DEFAULT_WIDGET_SIZE, pinned, raised: false, temporary, ready: false, revealed: false, shown: null, sent: "", closing: null, drag: null };
    entries.set(label, e);
    if (pinned) win.setLevel("pinned");
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

  /**
   * The bottom-right corner of the primary work area, stacking up over the boxes already raised: the
   * one place a finish is looked for. Other widgets are not counted, so a raised box keeps the corner
   * even where the widgets are parked around it; being raised, it sits above them.
   */
  const popupSlot = (e: Entry): Bounds =>
    placeWidget({
      remembered: undefined,
      size: e.size,
      workAreas: deps.workAreas(),
      primary: deps.primaryWorkArea(),
      taken: [...entries.values()].filter((other) => other !== e && other.raised).map((other) => other.win.bounds()),
      stack: "up",
    });

  /**
   * Puts an entry's level where the raised set says, and brings a newly raised box to the corner:
   * a pinned one stays where it was pinned, since the pin is a promise about where it sits. Answers
   * whether a reveal is due: newly raised and already shown, so the caller can bring it forward once
   * its new state has been pushed, and the cue (green, raised) and the rise reach the page in the
   * same moment. A box lowered afterwards stays in the corner; only a drag is remembered.
   */
  const settleLevel = (e: Entry): boolean => {
    const shouldRaise = raised.has(e.label);
    if (shouldRaise === e.raised) return false;
    e.raised = shouldRaise;
    e.win.setLevel(levelOf(e));
    if (!shouldRaise) return false;
    if (!e.pinned) {
      const slot = popupSlot(e);
      const now = e.win.bounds();
      if (slot.x !== now.x || slot.y !== now.y) e.win.setBounds(slot);
    }
    deps.log("desktop.popupRaised", { temporary: e.temporary });
    // Not yet revealed: the first size report shows it, raised already.
    return e.revealed;
  };

  const reconcile = (leaving: Snapshot | null = snapshot): void => {
    if (down) return;
    const current = snapshot;
    const wanted = new Set<string>();
    if (current !== null) {
      for (const w of planWidgets({ snapshot: current, view, raised: new Set(raised.keys()) })) {
        const e = entries.get(w.label) ?? open(w.label, w.pane, w.temporary);
        if (e === undefined) continue;
        wanted.add(w.label);
        if (e.closing !== null) clearTimeout(e.closing);
        e.closing = null;
        e.pane = w.pane;
        e.shown = paneSnapshot(current, w.pane);
        const rise = settleLevel(e);
        push(e);
        if (rise) e.win.reveal();
      }
    }
    for (const e of [...entries.values()]) {
      if (wanted.has(e.label)) continue;
      // Its pane has left (or there is no source at all): the page plays the walk out and then says it has nothing left to draw.
      const rise = settleLevel(e);
      if (leaving !== null) {
        e.shown = emptied(leaving);
        push(e);
      }
      if (rise) e.win.reveal();
      if (e.closing === null) e.closing = setTimeout(() => close(e), CLOSE_CAP_MS);
    }
  };

  const closeAll = (): void => {
    for (const e of [...entries.values()]) close(e);
  };

  /** Forgets every raise. The entries follow on the next reconcile. */
  const lowerAll = (): void => {
    raised.clear();
  };

  /**
   * A press on a raised box lowers it: the maintainer has looked. The label leaves the set, so the
   * next snapshot does not raise it again, until a new turn finishes there. A temporary widget goes
   * at once; an ordinary one drops to its own level where it stands.
   */
  const lowerByPress = (e: Entry): void => {
    // Already lowered, walking out or otherwise: nothing to do.
    if (!e.raised) return;
    raised.delete(e.label);
    if (e.temporary) {
      close(e);
      return;
    }
    e.raised = false;
    e.win.setLevel(levelOf(e));
    push(e);
  };

  const togglePin = (e: Entry): void => {
    // The menu's closure may outlive its entry.
    if (entries.get(e.label) !== e) return;
    // A temporary widget goes when it is pressed; a pin on it would promise something it cannot keep.
    if (e.temporary) return;
    e.pinned = !e.pinned;
    e.win.setLevel(levelOf(e));
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
      // A raise belongs to the view it happened in: never carried across, and never a popup left behind.
      lowerAll();
      closeAll();
      if (view === "widgets") reconcile();
    },
    setPopup(on) {
      if (on === popup) return;
      popup = on;
      if (on) return;
      lowerAll();
      reconcile();
    },
    setSnapshot(s, from) {
      if (from !== source) {
        source = from;
        generation++;
        // A new agent: its aliases and states owe nothing to the last one's, so nothing has finished and nothing is raised.
        previous = null;
        lowerAll();
      }
      if (popup) {
        const turns = finishedTurns(previous, s);
        if (turns.length > 0) {
          // In window view the box would pop up over what the maintainer is looking at; a finish seen
          // then is a finish seen. Checked once per snapshot, not once per turn.
          const skip = view === "window" && deps.windowFocused();
          if (!skip) {
            for (const turn of turns) {
              const holders = raised.get(turn.label) ?? new Set<string>();
              holders.add(turn.alias);
              raised.set(turn.label, holders);
            }
          }
        }
      }
      // A raise holds while any of its sessions is not working again, and still there.
      for (const [label, holders] of [...raised]) {
        const kept = stillRaising(holders, s);
        if (kept.size === 0) raised.delete(label);
        else raised.set(label, kept);
      }
      previous = s;
      snapshot = s;
      reconcile();
    },
    noSource() {
      const leaving = snapshot;
      source = null;
      snapshot = null;
      previous = null;
      lowerAll();
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
      lowerAll();
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
      // A box grows from its top-left corner, except while it is raised: that one is held at the
      // corner it was raised to, so a session joining its folder cannot grow it off the bottom edge.
      e.win.setBounds(e.raised && !e.pinned ? popupSlot(e) : { x: b.x, y: b.y, ...size });
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
      if (moved) {
        const b = e.win.bounds();
        const kept = clampDrop({ x: b.x, y: b.y, ...e.size }, deps.workAreas());
        if (kept.x !== b.x || kept.y !== b.y) e.win.setBounds(kept);
        // A popup is always made at the corner, so where one was dragged is nobody's place to keep:
        // saving it would move the folder's own widget instead.
        if (!e.temporary) deps.savePlacement(e.label, { x: kept.x, y: kept.y, pinned: e.pinned });
      }
      // Every press ends here, moved or not: the one place a press lowers anything. After the save, so a dragged widget is remembered before a press can close it.
      lowerByPress(e);
    },
    togglePin(sender) {
      const e = bySender(sender);
      if (e !== undefined) togglePin(e);
    },
    select(sender, alias) {
      const e = bySender(sender);
      // Only an alias main itself sent this window.
      if (e?.shown?.sessions.some((session) => session.alias === alias)) deps.focusSession(alias);
    },
    menu(sender) {
      const e = bySender(sender);
      if (e === undefined) return;
      e.win.popupMenu(widgetMenuTemplate(e.pinned, { togglePin: () => togglePin(e), openWindow: deps.openWindow, settings: deps.openSettings }, e.temporary));
    },
  };
}
