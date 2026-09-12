"use client";

import type { Snapshot } from "@clawd/core";
import { mountPanesScene, type PanesScene } from "@clawd/scene";
import { useEffect, useRef } from "react";
import { sceneLabel, type Counts } from "@/lib/labels";

type Props = {
  snapshot: Snapshot | null;
  /** Changes when the feed changes; the scene clears rather than walking a whole fleet out. */
  generation: number;
  counts: Counts;
  onSelect: (alias: string) => void;
};

/** The one canvas. Mounts the panes scene once fonts are ready, forwards snapshots, resizes with its host. */
export function SceneCanvas({ snapshot, generation, counts, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PanesScene | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    if (snapshot) sceneRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    sceneRef.current?.clear();
  }, [generation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let cancelled = false;
    let scene: PanesScene | null = null;
    const fit = (): void => scene?.resize(host.clientWidth, host.clientHeight);
    const mount = (): void => {
      if (cancelled) return;
      scene = mountPanesScene(canvas, { font: getComputedStyle(canvas).fontFamily, onSelect: (alias) => onSelectRef.current(alias) });
      sceneRef.current = scene;
      fit();
      if (snapshotRef.current) scene.setSnapshot(snapshotRef.current);
    };
    const ready = "fonts" in document ? document.fonts.ready : Promise.resolve();
    void ready.then(mount, mount);
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      scene?.destroy();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <canvas ref={canvasRef} role="img" aria-label={sceneLabel(counts)} className="absolute inset-0 block h-full w-full [image-rendering:pixelated]" />
    </div>
  );
}
