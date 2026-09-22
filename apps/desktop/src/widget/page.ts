// A widget: one pane of the scene in a frameless, transparent window. It draws the snapshot main
// sends and nothing else; it opens no connection and does not know which pane it is. With no title
// bar there is nothing for Windows to drag, and CSS `-webkit-app-region: drag` would swallow every
// click in the region, so the page reports a press and main moves the window.
import { mountPanesScene, type PanesScene } from "@clawd/scene";
import type { WidgetApi, WidgetState } from "./state";

declare const window: { clawdWidget: WidgetApi } & Window;

/** A press that moves less than this, measured on the screen, is a click. The window follows the cursor, so in the page's own coordinates a drag barely moves at all. */
const CLICK_SLOP = 4;
const FACE = '"JetBrains Mono"';

/** Runs `onChange` whenever the display's scale changes, as it does when the window is dragged to another display: the CSS size stays the same then, so no resize event says so. */
function watchRatio(onChange: () => void): void {
  if (typeof matchMedia !== "function") return;
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    "change",
    () => {
      onChange();
      watchRatio(onChange);
    },
    { once: true },
  );
}

function start(canvas: HTMLCanvasElement, pin: HTMLElement): void {
  const api = window.clawdWidget;
  let scene: PanesScene | null = null;
  let generation: number | null = null;
  /** The next snapshot is the first since the scene was mounted or cleared: its sessions were already there, so they do not walk in. */
  let fresh = true;

  const draw = (state: WidgetState): void => {
    pin.setAttribute("aria-pressed", String(state.pinned));
    // A temporary widget goes when it is pressed; a pin on it would promise something it cannot keep.
    pin.hidden = state.temporary;
    if (scene === null) return;
    if (generation !== null && state.generation !== generation) {
      // Snapshots now come from another agent: nothing on screen is known to it.
      scene.clear();
      fresh = true;
    }
    generation = state.generation;
    if (state.snapshot === null) return;
    scene.setSnapshot(state.snapshot, { seated: fresh });
    fresh = false;
    // The snapshot holds this window's one pane, so that is the pane the cue names.
    scene.setFinished(state.raised ? state.snapshot.panes.map((p) => p.pane) : []);
  };

  const mount = (): void => {
    const family = getComputedStyle(canvas).fontFamily;
    const mounted = mountPanesScene(canvas, {
      ...(family === "" ? {} : { font: family }),
      background: "none",
      clipActors: true,
      emptyState: false,
      margin: 1,
      onContentSize: (size) => api.resize(size),
    });
    scene = mounted;
    const fit = (): void => mounted.resize(document.documentElement.clientWidth, document.documentElement.clientHeight);
    fit();
    window.addEventListener("resize", fit);
    watchRatio(fit);
    // Only now: main sends nothing before it is asked, so no state arrives with no scene to draw it.
    api.onState(draw);
    void api.ready().then(
      (state) => {
        if (state !== null) draw(state);
      },
      () => {},
    );
  };

  // No text in the page uses the face, so nothing would load it; the canvas would then draw its first frames in the fallback.
  const faces = typeof document.fonts?.load === "function" ? Promise.all([document.fonts.load(`11px ${FACE}`), document.fonts.load(`bold 11px ${FACE}`)]) : Promise.resolve();
  void faces.then(mount, mount);

  let press: { id: number; x: number; y: number; moved: boolean } | null = null;
  let moveFrame: number | null = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || press !== null) return;
    press = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false };
    // Captured, so the release reaches the canvas wherever the pointer has got to by then.
    canvas.setPointerCapture?.(e.pointerId);
    api.dragStart();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (press === null || e.pointerId !== press.id) return;
    if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) < CLICK_SLOP) return;
    press.moved = true;
    if (moveFrame !== null) return;
    // One per frame. No coordinates: main reads the cursor itself, in the units it moves the window in.
    moveFrame = requestAnimationFrame(() => {
      moveFrame = null;
      if (press !== null) api.dragMove();
    });
  });

  const release = (e: PointerEvent, click: boolean): void => {
    if (press === null || e.pointerId !== press.id) return;
    const moved = press.moved;
    press = null;
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    api.dragEnd();
    if (!click || moved) return;
    const box = canvas.getBoundingClientRect();
    const alias = scene?.hitTest(e.clientX - box.left, e.clientY - box.top) ?? null;
    if (alias !== null) api.select(alias);
  };
  canvas.addEventListener("pointerup", (e) => release(e, true));
  canvas.addEventListener("pointercancel", (e) => release(e, false));
  // A press the window loses (Alt+Tab mid-drag) has no release of its own.
  window.addEventListener("blur", () => {
    if (press === null) return;
    press = null;
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    api.dragEnd();
  });

  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    api.menu();
  });
  pin.addEventListener("click", () => api.togglePin());
}

const canvas = document.getElementById("scene");
const pin = document.getElementById("pin");
if (canvas instanceof HTMLCanvasElement && pin !== null) start(canvas, pin);
