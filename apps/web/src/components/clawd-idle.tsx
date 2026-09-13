"use client";

import { useEffect, useRef } from "react";
import { CLAWD_BODY, mountIdleClawd } from "@clawd/scene";

const CELL = 8;
const MARGIN = 2; // logical pixels around the sprite, room for the breath

/** The canonical Clawd, idle: drawn on a canvas by the scene engine, shown at `scale` times its pixel size. */
export function ClawdIdle({ scale = 2 }: { scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = (CLAWD_BODY.width + MARGIN * 2) * CELL;
  const height = (CLAWD_BODY.height + MARGIN * 2) * CELL;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    return mountIdleClawd(canvas, { cellSize: CELL });
  }, []);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ width: width * scale, height: height * scale, imageRendering: "pixelated" }}
      aria-label="Clawd, idle"
      role="img"
    />
  );
}
