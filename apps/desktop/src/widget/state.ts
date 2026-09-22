// What a widget page draws, and the bridge it talks to main through. Imports a type from core and
// nothing else: the page is sandboxed browser code, checked by tsconfig.page.json with no Node
// types, and core is pure TypeScript with none either.
import type { Snapshot } from "@clawd/core";

export type WidgetSize = { width: number; height: number };

export type WidgetState = {
  /** The snapshot cut down to this window's pane; null before the first one. */
  snapshot: Snapshot | null;
  /** Rises when snapshots start coming from another agent; the page clears its scene, as the visualiser's does. */
  generation: number;
  pinned: boolean;
  /** A turn in this pane has finished and nobody has looked yet: the box is on top and drawn green. */
  raised: boolean;
  /** A popup in window view: made for the raise and gone once lowered. It has no pin. */
  temporary: boolean;
};

/**
 * The bridge: what the preload publishes as `window.clawdWidget`. Only `ready` has an answer; the
 * rest are one-way. The page never learns which pane it is: it draws the snapshot it is sent.
 */
export type WidgetApi = {
  /** Asked once the scene is mounted. Null to a window main does not know. */
  ready(): Promise<WidgetState | null>;
  /** Subscribes to the states main pushes; returns the unsubscribe. */
  onState(cb: (s: WidgetState) => void): () => void;
  /** The CSS pixels the contents need, or null once there is nothing left to draw. */
  resize(size: WidgetSize | null): void;
  /** A press began; main notes where the cursor is on the window. No coordinates cross the bridge. */
  dragStart(): void;
  /** The pointer moved past a click's slop; main moves the window to the cursor. */
  dragMove(): void;
  dragEnd(): void;
  togglePin(): void;
  /** A Clawd was clicked. */
  select(alias: string): void;
  /** The right button: main pops the native menu. */
  menu(): void;
};
