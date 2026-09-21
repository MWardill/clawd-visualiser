// The Clawd pixel engine, ported from the clawd-animation skill's template (references/template.html).
// The sprite, palette, eye variants, particle system and easing are the template's own; the only
// change is that drawing goes through a factory bound to a canvas context and a cell size, instead
// of module-level globals, so many scenes can share it. Keep this file faithful to the template.

// ─── PALETTE ─────────────────────────────────────────────────
export const PALETTE = {
  background: { bg: "#F9F7F4", dot: "#E0DDD8", page: "#E8E5E0" },
  stars: { dark: "#333333", mid: "#888888", light: "#BBBBBB" },
  clawd: { body: "#CD6E58", eye: "#000000" },
  ui: { white: "#FFFFFF", bubbleBorder: "#888888", textDark: "#333333" },
  // the visualiser's night terminal atmosphere
  night: { bg: "#0a0b10", cloud: "#141721", starDim: "#2c3040", starMid: "#5a6076", starBright: "#d9dbe6", line: "#262a3a", path: "#1f2330", text: "#5d6274", textBright: "#c9ccd6" },
  state: { amber: "#f2c35b", green: "#8fd18a", blue: "#7fa6f0", pink: "#F06090" },
} as const;

// ─── SPRITES ─────────────────────────────────────────────────

/** Clawd body (14×8): 1 = body pixel. Eyes are drawn on top at the anchors. */
export const CLAWD_BODY = {
  width: 14,
  height: 8,
  data: [
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
    [0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0],
  ],
  anchors: {
    eyeLeft: { x: 4, y: 1 },
    eyeRight: { x: 9, y: 1 },
    hatTop: { x: 7, y: -1 },
    handLeft: { x: 0, y: 2 },
    handRight: { x: 13, y: 2 },
    sitBottom: { x: 7, y: 8 },
  },
} as const;

export type EyeVariant = "forward" | "look_right" | "look_left" | "look_down" | "blink";

/** Eye variants: an offset per eye, or hidden for a blink. */
export const EYES: Record<EyeVariant, { left: { dx: number; dy: number }; right: { dx: number; dy: number } } | { type: "hidden" }> = {
  forward: { left: { dx: 0, dy: 0 }, right: { dx: 0, dy: 0 } },
  look_right: { left: { dx: 1, dy: 0 }, right: { dx: 1, dy: 0 } },
  look_left: { left: { dx: -1, dy: 0 }, right: { dx: -1, dy: 0 } },
  look_down: { left: { dx: 0, dy: 1 }, right: { dx: 0, dy: 1 } },
  blink: { type: "hidden" },
};

/** Heart sprite (5×4). */
export const HEART = [
  [1, 0, 1, 0, 0],
  [1, 1, 1, 1, 0],
  [0, 1, 1, 1, 0],
  [0, 0, 1, 0, 0],
] as const;

// ─── EASING FUNCTIONS ────────────────────────────────────────
export function easeOut(t: number): number { return 1 - Math.pow(1 - t, 3); }
export function easeInOut(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

// ─── ENGINE ──────────────────────────────────────────────────

/** The subset of a 2D context the pixel functions need; a fake of it makes the engine testable. */
export type PixelContext = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "font" | "textAlign" | "textBaseline" | "fillText" | "globalAlpha" | "clearRect" | "save" | "restore" | "beginPath" | "rect" | "clip">;

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; col: string };

export type Engine = ReturnType<typeof createEngine>;

/**
 * Bind the engine to a context and a cell size. `PX` is the size of one logical pixel in canvas
 * pixels; the template uses 20 on a 36×36 grid, scenes with many Clawds use smaller cells.
 */
export function createEngine(ctx: PixelContext, PX: number) {
  function px(gx: number, gy: number, col: string) {
    ctx.fillStyle = col;
    ctx.fillRect(gx * PX, gy * PX, PX, PX);
  }

  function drawClawd(ox: number, oy: number, opts: { eyes?: EyeVariant; body?: string } = {}) {
    const bodyCol = opts.body ?? PALETTE.clawd.body;
    const eyeCol = PALETTE.clawd.eye;
    for (let r = 0; r < CLAWD_BODY.height; r++) {
      const row = CLAWD_BODY.data[r]!;
      for (let c = 0; c < CLAWD_BODY.width; c++) {
        if (row[c] === 1) px(ox + c, oy + r, bodyCol);
      }
    }
    const ev = EYES[opts.eyes ?? "forward"];
    if (!("type" in ev)) {
      const el = CLAWD_BODY.anchors.eyeLeft;
      const er = CLAWD_BODY.anchors.eyeRight;
      px(ox + el.x + ev.left.dx, oy + el.y + ev.left.dy, eyeCol);
      px(ox + er.x + ev.right.dx, oy + er.y + ev.right.dy, eyeCol);
    }
  }

  function drawHeart(hx: number, hy: number, col: string) {
    for (let r = 0; r < HEART.length; r++) {
      const row = HEART[r]!;
      for (let c = 0; c < row.length; c++) if (row[c] === 1) px(hx + c - 1, hy + r, col);
    }
  }

  function drawBubble(bx: number, by: number, text: string) {
    const tw = text.length + 2;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < tw; x++) {
        const isEdge = y === 0 || y === 2 || x === 0 || x === tw - 1;
        if ((y === 0 || y === 2) && (x === 0 || x === tw - 1)) continue;
        px(bx + x, by + y, isEdge ? PALETTE.stars.mid : PALETTE.ui.white);
      }
    }
    px(bx + 1, by + 3, PALETTE.stars.mid);
    ctx.fillStyle = PALETTE.stars.dark;
    ctx.font = "bold 12px Courier New";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(text, (bx + 1) * PX + 3, by * PX + 7);
  }

  // ─── PARTICLE SYSTEM ───────────────────────────────────────
  const particles: Particle[] = [];

  function addParticle(x: number, y: number, col: string) {
    particles.push({ x, y, vx: (Math.random() - 0.5) * 0.8, vy: -Math.random() * 0.8 - 0.3, life: 1.0, col });
  }

  function tickParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.life -= 0.02;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      if (p.life > 0.15) px(Math.round(p.x), Math.round(p.y), p.col);
    }
  }

  function clearParticles() { particles.length = 0; }

  return { PX, px, drawClawd, drawHeart, drawBubble, addParticle, tickParticles, clearParticles, particles };
}
