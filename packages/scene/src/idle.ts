import { CLAWD_BODY, createEngine, type EyeVariant } from "./engine";

export type IdleClawdOptions = {
  /** Canvas pixels per logical pixel. Default 8. */
  cellSize?: number;
  /** Frames per second, as in the template. Default 30. */
  fps?: number;
};

/**
 * One idle Clawd, centred on the canvas: breathing gently and blinking every few seconds, the
 * template's demo scene. Returns a function that stops the loop. The canvas keeps its own
 * background, so the page behind shows through.
 */
export function mountIdleClawd(canvas: HTMLCanvasElement, options: IdleClawdOptions = {}): () => void {
  const PX = options.cellSize ?? 8;
  const fps = options.fps ?? 30;
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const engine = createEngine(ctx, PX);

  const cols = Math.floor(canvas.width / PX);
  const rows = Math.floor(canvas.height / PX);
  const ox = Math.floor((cols - CLAWD_BODY.width) / 2);
  const oy = Math.floor((rows - CLAWD_BODY.height) / 2);

  let frame = 0;
  let last: number | null = null;
  let acc = 0;
  let handle = 0;
  let stopped = false;

  function render(f: number) {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    // blink for 5 frames out of every 80 as in the template's demo; lift one cell on the rising part of a slow sine to breathe
    const eyes: EyeVariant = f % 80 >= 75 ? "blink" : "forward";
    const breath = Math.sin(f * 0.12) > 0.3 ? -1 : 0;
    engine.drawClawd(ox, oy + breath, { eyes });
    engine.tickParticles();
  }

  function loop(ts: number) {
    if (stopped) return;
    if (last === null) last = ts;
    acc += Math.min(0.1, (ts - last) / 1000);
    last = ts;
    if (acc >= 1 / fps) { acc = 0; frame++; render(frame); }
    handle = requestAnimationFrame(loop);
  }

  render(0);
  handle = requestAnimationFrame(loop);
  return () => { stopped = true; cancelAnimationFrame(handle); };
}
