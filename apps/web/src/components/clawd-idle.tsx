"use client";

import { useEffect, useRef } from "react";
import { CLAWD_BODY, mountIdleClawd } from "@clawd/scene";

const CELL = 8;
const MARGIN = 2; // logical pixels around the sprite, room for the breath

/** The canonical Clawd, idle: drawn on a canvas by the scene engine, shown at twice its pixel size. */
export function ClawdIdle() {
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
      style={{ width: width * 2, height: height * 2, imageRendering: "pixelated" }}
      aria-label="Clawd, idle"
      role="img"
    />
  );
}
