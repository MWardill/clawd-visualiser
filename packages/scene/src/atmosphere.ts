// The night: a filled background, seeded twinkling stars and block clouds that drift and wrap.
import { PALETTE, type Engine, type PixelContext } from "./engine";

export type Star = { x: number; y: number; ph: number; sp: number; big: boolean };
export type Cloud = { x: number; y: number; sp: number; rows: readonly (readonly [number, number])[] };
export type Atmosphere = { width: number; height: number; stars: Star[]; clouds: Cloud[] };

/** The proof of concept's generator: a 31-bit LCG, good enough for stars. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Each row is [left offset, width]; the shapes from the proof of concept. */
const CLOUD_SHAPES: readonly (readonly (readonly [number, number])[])[] = [
  [[4, 6], [2, 12], [0, 16], [0, 16]],
  [[3, 5], [1, 10], [0, 12]],
  [[5, 7], [2, 14], [0, 18], [0, 18]],
  [[2, 5], [0, 9], [0, 9]],
];

/** One star per 114 cells (140 on the proof of concept's 160 by 100 grid) and four clouds, seeded. */
export function createAtmosphere(width: number, height: number, seed = 11): Atmosphere {
  const rnd = lcg(seed);
  const stars: Star[] = [];
  const count = Math.round((width * height) / 114);
  for (let i = 0; i < count; i++) {
    stars.push({ x: Math.floor(rnd() * width), y: 4 + Math.floor(rnd() * Math.max(1, height - 8)), ph: rnd() * Math.PI * 2, sp: 0.03 + rnd() * 0.05, big: rnd() < 0.08 });
  }
  const clouds: Cloud[] = CLOUD_SHAPES.map((rows) => ({ x: Math.floor(rnd() * width), y: 4 + Math.floor(rnd() * Math.max(1, height - 12)), sp: 0.012 + rnd() * 0.014, rows }));
  return { width, height, stars, clouds };
}

/** Fills the night background and draws this frame's stars and clouds. */
export function drawNight(ctx: PixelContext, engine: Engine, atmo: Atmosphere, frame: number): void {
  ctx.fillStyle = PALETTE.night.bg;
  ctx.fillRect(0, 0, atmo.width * engine.PX, atmo.height * engine.PX);
  for (const s of atmo.stars) {
    const tw = Math.sin(frame * s.sp + s.ph);
    const col = s.big ? (tw > 0 ? PALETTE.night.starBright : PALETTE.night.starMid) : tw > 0.3 ? PALETTE.night.starMid : PALETTE.night.starDim;
    engine.px(s.x, s.y, col);
    if (s.big && tw > 0.6) {
      engine.px(s.x - 1, s.y, PALETTE.night.starDim);
      engine.px(s.x + 1, s.y, PALETTE.night.starDim);
      engine.px(s.x, s.y - 1, PALETTE.night.starDim);
      engine.px(s.x, s.y + 1, PALETTE.night.starDim);
    }
  }
  // Clouds drift right for ever and wrap 10 cells past either edge, so one is never cut off abruptly.
  const span = atmo.width + 20;
  for (const c of atmo.clouds) {
    const ox = Math.floor(c.x + frame * c.sp);
    c.rows.forEach(([off, w], r) => {
      for (let i = 0; i < w; i++) engine.px(((ox + off + i) % span) - 10, c.y + r, PALETTE.night.cloud);
    });
  }
}
