// The panes scene: one canvas, one loop. Takes snapshots, draws frames. Everything with a side
// effect lives here; the thinking is in layout.ts, actors.ts, poses.ts and text.ts.
import type { Snapshot } from "@clawd/core";
import { emptyWorld, reconcile, seatsUsed, tick, type Actor, type ScenePane, type World } from "./actors";
import { createAtmosphere, drawNight, type Atmosphere } from "./atmosphere";
import { CLAWD_BODY, PALETTE, createEngine, type EyeVariant, type PixelContext } from "./engine";
import { CELL, CONTEXT_ROW, CONTEXT_W, NAME_ROW, SEAT_H, SEAT_W, SPRITE_DX, SPRITE_DY, STATUS_ROW, layoutPanes, type PaneRect } from "./layout";
import { poseFor } from "./poses";
import { drawBox, drawClawdWalking, drawClawdWave, drawExclaim, drawMini, drawSparkle, drawSweat, drawZzz } from "./sprites";
import { drawText, nameplate, paneTitle } from "./text";

export type PanesSceneOptions = {
  /** CSS pixels per cell. Default 6. */
  cellSize?: number;
  /** Frames per second. Default 30. */
  fps?: number;
  /** Canvas font family for text. Default the system monospace stack. */
  font?: string;
  /** Wall clock, for time-in-state and tweens. Default Date.now. */
  now?: () => number;
  /** A Clawd or its nameplate was clicked. */
  onSelect?: (alias: string) => void;
  /** Injection points; tests use them, hosts leave them alone. */
  devicePixelRatio?: number;
  requestAnimationFrame?: (fn: (ts: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
  /** Where visibilitychange is listened for; null disables the listener. Default the global document. */
  document?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> | null;
};

export type PanesScene = {
  /** Reconcile the world with a snapshot: arrivals walk in, departures walk out. */
  setSnapshot(s: Snapshot): void;
  /** Drop every pane and actor at once, for a source switch. */
  clear(): void;
  /** CSS size of the canvas; the backing store is scaled by the pixel ratio. */
  resize(cssWidth: number, cssHeight: number): void;
  setPaused(paused: boolean): void;
  /** The alias under a point in CSS pixels, or null. */
  hitTest(cssX: number, cssY: number): string | null;
  destroy(): void;
};

const DEFAULT_FONT = 'ui-monospace, "Cascadia Mono", Consolas, monospace';
const TEXT_CSS_PX = 11;
/** Share of the remaining distance a pane's drawn origin closes each frame: about 400 ms to settle at 30 fps. */
const SLIDE = 0.25;
/** Monospace glyph width as a share of the font size, for the title's backing rectangle. */
const GLYPH_W = 0.65;

const NOOP_SCENE: PanesScene = { setSnapshot() {}, clear() {}, resize() {}, setPaused() {}, hitTest: () => null, destroy() {} };

export function mountPanesScene(canvas: HTMLCanvasElement, opts: PanesSceneOptions = {}): PanesScene {
  const maybeCtx = canvas.getContext("2d") as PixelContext | null;
  if (!maybeCtx) return NOOP_SCENE;
  // Rebound to a non-nullable const: TypeScript's control-flow narrowing above does not extend
  // into the function declarations below (they are hoisted), so a fresh binding is needed for
  // its type, not just its narrowed flow type, to be non-null everywhere it is captured.
  const ctx: PixelContext = maybeCtx;
  const cell = opts.cellSize ?? CELL;
  const fps = opts.fps ?? 30;
  const now = opts.now ?? (() => Date.now());
  const font = opts.font ?? DEFAULT_FONT;
  const raf = opts.requestAnimationFrame ?? ((fn) => requestAnimationFrame(fn));
  const caf = opts.cancelAnimationFrame ?? ((h) => cancelAnimationFrame(h));
  const doc = opts.document === undefined ? (typeof document === "undefined" ? null : document) : opts.document;

  let dpr = opts.devicePixelRatio ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
  let PX = Math.max(1, Math.round(cell * dpr));
  let textPx = Math.max(6, Math.round(TEXT_CSS_PX * (PX / cell)));
  let engine = createEngine(ctx, PX);
  const world: World = emptyWorld();
  /** CSS size last passed to resize(); used to map a click through the backing store. */
  let cssWidth = 0;
  let cssHeight = 0;

  /**
   * Re-reads the pixel ratio -- a browser zoom can change it after mount -- and recomputes the
   * backing-store cell size and text size from it. The drawing engine is recreated only when the
   * backing cell size actually changed, so an unrelated resize does not churn it.
   */
  function applyRatio(): void {
    dpr = opts.devicePixelRatio ?? (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
    const nextPX = Math.max(1, Math.round(cell * dpr));
    textPx = Math.max(6, Math.round(TEXT_CSS_PX * (nextPX / cell)));
    if (nextPX !== PX) {
      engine.clearParticles();
      PX = nextPX;
      engine = createEngine(ctx, PX);
    }
  }
  /** Drawn pane origins, easing toward the layout's targets. */
  const origins = new Map<string, { x: number; y: number }>();
  let rects = new Map<string, PaneRect>();
  let atmo: Atmosphere = createAtmosphere(1, 1);
  let gridW = 1;
  let gridH = 1;
  let frame = 0;
  let acc = 0;
  let last: number | null = null;
  let handle: number | null = null;
  let stopped = false;
  let paused = false;
  let hidden = doc?.hidden ?? false;
  let hover: string | null = null;

  function paneRects(): Map<string, PaneRect> {
    const laid = layoutPanes(world.panes.map((p) => ({ alias: p.alias, seatsUsed: seatsUsed(p) })), gridW);
    const out = new Map<string, PaneRect>();
    for (const r of laid) {
      const cur = origins.get(r.alias) ?? { x: r.x, y: r.y };
      const next = { x: cur.x + (r.x - cur.x) * SLIDE, y: cur.y + (r.y - cur.y) * SLIDE };
      if (Math.abs(next.x - r.x) < 0.05) next.x = r.x;
      if (Math.abs(next.y - r.y) < 0.05) next.y = r.y;
      origins.set(r.alias, next);
      out.set(r.alias, { ...r, x: next.x, y: next.y });
    }
    for (const alias of [...origins.keys()]) if (!out.has(alias)) origins.delete(alias);
    return out;
  }

  function drawPane(p: ScenePane, r: PaneRect): void {
    const waiting = world.actors.some((a) => a.pane === p.alias && a.state === "waiting" && (a.phase === "entering" || a.phase === "seated"));
    const line = waiting ? PALETTE.state.amber : PALETTE.night.line;
    const x = Math.round(r.x);
    const y = Math.round(r.y);
    drawBox(engine, x, y, r.w, r.h, line);
    const title = paneTitle(p.label);
    ctx.fillStyle = PALETTE.night.bg;
    ctx.fillRect((x + 2) * PX, (y - 1) * PX, Math.ceil((title.length + 1) * textPx * GLYPH_W), 3 * PX);
    drawText(ctx, PX, title, x + 3, y + 0.5, waiting ? PALETTE.state.amber : PALETTE.night.text, { size: textPx, font, baseline: "middle" });
    if (p.collision) {
      ctx.fillStyle = PALETTE.night.bg;
      ctx.fillRect((x + r.w - 5) * PX, (y - 1) * PX, 3 * PX, 3 * PX);
      drawText(ctx, PX, "!", x + r.w - 3, y + 0.5, PALETTE.state.amber, { size: textPx, font, bold: true, align: "right", baseline: "middle" });
    }
  }

  function drawActor(a: Actor, r: PaneRect, t: number): void {
    const pose = poseFor(a, t, frame);
    const sx = Math.round(r.x + a.pos.x);
    const sy = Math.round(r.y + a.pos.y);
    const ox = sx + SPRITE_DX;
    const oy = sy + SPRITE_DY + pose.bounce;
    ctx.globalAlpha = pose.alpha;
    if (pose.moving) drawClawdWalking(engine, ox, oy, pose.eyes, pose.step, PALETTE.night.bg);
    else if (pose.wave) drawClawdWave(engine, ox, oy, pose.eyes, pose.wave);
    else engine.drawClawd(ox, oy, { eyes: pose.eyes });
    if (pose.exclaim) drawExclaim(engine, ox, oy, PALETTE.state.amber);
    if (pose.sweat) drawSweat(engine, ox, oy);
    if (pose.zzz) drawZzz(engine, ox, oy, frame);
    if (pose.sparkle) drawSparkle(engine, ox, oy);
    if (pose.particle) engine.addParticle(ox + pose.particle.dx, oy + pose.particle.dy, pose.particle.col);
    if (pose.heart) engine.drawHeart(ox + 16, oy - 3, PALETTE.state.pink);
    const stepping = Math.floor(frame / 4) % 2 === 0;
    for (const m of a.subs) drawMini(engine, Math.round(r.x + a.pos.x + m.pos.x), Math.round(r.y + a.pos.y + m.pos.y), m.move !== null && stepping);

    // A walking Clawd starts below the pane; its nameplate would print over the next band, so
    // only a seated (non-moving) Clawd gets one.
    if (!pose.moving) {
      const np = nameplate(a, t);
      const cx = sx + SPRITE_DX + CLAWD_BODY.width / 2;
      if (np.subs) {
        drawText(ctx, PX, np.name, cx, sy + NAME_ROW, PALETTE.night.textBright, { size: textPx, font, bold: true, align: "right" });
        drawText(ctx, PX, np.subs, cx, sy + NAME_ROW, PALETTE.clawd.body, { size: textPx, font, bold: true, align: "left" });
      } else {
        drawText(ctx, PX, np.name, cx, sy + NAME_ROW, PALETTE.night.textBright, { size: textPx, font, bold: true, align: "center" });
      }
      drawText(ctx, PX, np.status, cx, sy + STATUS_ROW, np.colour, { size: textPx, font, align: "center" });
      if (a.contextPct !== null) {
        const filled = Math.round((CONTEXT_W * a.contextPct) / 100);
        const bx = sx + SPRITE_DX + Math.floor((CLAWD_BODY.width - CONTEXT_W) / 2);
        const col = a.contextPct >= 80 ? PALETTE.state.amber : PALETTE.night.starMid;
        for (let i = 0; i < CONTEXT_W; i++) engine.px(bx + i, sy + CONTEXT_ROW, i < filled ? col : PALETTE.night.path);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawEmpty(): void {
    const ox = Math.floor((gridW - CLAWD_BODY.width) / 2);
    const oy = Math.floor((gridH - CLAWD_BODY.height) / 2) - 2;
    const eyes: EyeVariant = frame % 80 >= 75 ? "blink" : "forward";
    engine.drawClawd(ox, oy + Math.round(Math.sin(frame * 0.12) * 0.5), { eyes });
    drawText(ctx, PX, "no sessions", ox + CLAWD_BODY.width / 2, oy + CLAWD_BODY.height + 3, PALETTE.night.text, { size: textPx, font, align: "center" });
  }

  function render(): void {
    const t = now();
    tick(world, t);
    drawNight(ctx, engine, atmo, frame);
    if (world.panes.length === 0) drawEmpty();
    rects = paneRects();
    for (const p of world.panes) {
      const r = rects.get(p.alias);
      if (!r) continue;
      drawPane(p, r);
      const actors = world.actors
        .filter((a) => a.pane === p.alias)
        .sort((a, b) => {
          const la = a.phase === "leaving" ? 1 : 0;
          const lb = b.phase === "leaving" ? 1 : 0;
          return la - lb || a.pos.y - b.pos.y;
        });
      for (const a of actors) drawActor(a, r, t);
    }
    engine.tickParticles();
  }

  function schedule(): void {
    if (!stopped && !paused && !hidden && handle === null) handle = raf(loop);
  }

  function halt(): void {
    if (handle !== null) {
      caf(handle);
      handle = null;
    }
    last = null;
  }

  function loop(ts: number): void {
    handle = null;
    if (stopped) return;
    if (last === null) last = ts;
    acc += Math.min(0.1, (ts - last) / 1000);
    last = ts;
    if (acc >= 1 / fps) {
      acc = 0;
      frame++;
      render();
    }
    schedule();
  }

  function resize(cssW: number, cssH: number): void {
    applyRatio();
    cssWidth = cssW;
    cssHeight = cssH;
    canvas.width = Math.max(PX, Math.round(cssW * dpr));
    canvas.height = Math.max(PX, Math.round(cssH * dpr));
    gridW = Math.floor(canvas.width / PX);
    gridH = Math.floor(canvas.height / PX);
    atmo = createAtmosphere(gridW, gridH);
    render();
  }

  function hitTest(cssX: number, cssY: number): string | null {
    if (cssWidth === 0 || cssHeight === 0) return null;
    const gx = (cssX * (canvas.width / cssWidth)) / PX;
    const gy = (cssY * (canvas.height / cssHeight)) / PX;
    for (const a of world.actors) {
      if (a.phase !== "entering" && a.phase !== "seated" && a.phase !== "waving") continue;
      const r = rects.get(a.pane);
      if (!r) continue;
      const x = r.x + a.pos.x;
      const y = r.y + a.pos.y;
      if (gx >= x && gx < x + SEAT_W && gy >= y && gy < y + SEAT_H) return a.alias;
    }
    return null;
  }

  const localPoint = (e: MouseEvent): { x: number; y: number } => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const onClick = (e: MouseEvent): void => {
    const p = localPoint(e);
    const alias = hitTest(p.x, p.y);
    if (alias) opts.onSelect?.(alias);
  };
  const onMove = (e: MouseEvent): void => {
    const p = localPoint(e);
    const alias = hitTest(p.x, p.y);
    if (alias !== hover) {
      hover = alias;
      canvas.style.cursor = alias ? "pointer" : "";
    }
  };
  const onVisibility = (): void => {
    hidden = doc?.hidden ?? false;
    if (hidden) halt();
    else schedule();
  };
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("pointermove", onMove);
  doc?.addEventListener("visibilitychange", onVisibility);

  applyRatio();
  resize(canvas.width / dpr, canvas.height / dpr);
  schedule();

  return {
    setSnapshot(s) {
      reconcile(world, s, now());
    },
    clear() {
      world.panes.length = 0;
      world.actors.length = 0;
      origins.clear();
      engine.clearParticles();
      render();
    },
    resize,
    setPaused(p) {
      paused = p;
      if (paused) halt();
      else schedule();
    },
    hitTest,
    destroy() {
      stopped = true;
      halt();
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("pointermove", onMove);
      doc?.removeEventListener("visibilitychange", onVisibility);
      engine.clearParticles();
      canvas.style.cursor = "";
    },
  };
}
