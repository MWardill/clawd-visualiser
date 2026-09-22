# @clawd/scene

The canvas renderer. Framework-free: give it a canvas and snapshots, it draws frames.

| Module | What it holds |
| --- | --- |
| `engine.ts` | The clawd-animation skill's pixel engine, unchanged: palette, the 14 by 8 Clawd, eyes, particles, easing. |
| `idle.ts` | One idle Clawd, breathing and blinking; the app's avatar. |
| `sprites.ts` | Accessories drawn over a Clawd: walking legs, a waving claw, the exclamation mark, sweat, zZ, sparkles, the 7 by 4 mini Clawd, box outlines. |
| `atmosphere.ts` | Seeded stars and drifting clouds. |
| `layout.ts` | Cell geometry: seats, panes, doors, mini slots, the pane flow. Pure. |
| `actors.ts` | The world: panes with seats and actors that walk in, sit, wave and leave. `reconcile()` with a snapshot, `tick()` with the clock. Deterministic; mutates the world it is given. |
| `poses.ts` | What a Clawd looks like this frame from its state. Pure. |
| `text.ts` | Nameplates, titles, `mmss`, and the one text-drawing function. |
| `panes.ts` | `mountPanesScene(canvas, options)`: the loop, drawing, pointer events, visibility pause. |

```ts
const scene = mountPanesScene(canvas, { font: "JetBrains Mono", onSelect: (alias) => open(alias) });
scene.resize(width, height);   // CSS pixels; call again from a ResizeObserver
scene.setSnapshot(snapshot);   // as often as snapshots arrive

// One pane as a widget on the desktop: a transparent canvas, the box filled, its Clawds clipped to it.
mountPanesScene(canvas, { background: "none", clipActors: true, emptyState: false, margin: 1, onContentSize: (size) => fitWindow(size) });
scene.setSnapshot(snapshot, { seated: true });   // the sessions were already there: no walk in
scene.destroy();
```

Design: `docs/superpowers/specs/2026-09-12-web-app-design.md`, section 4.

```
pnpm --filter @clawd/scene test
pnpm --filter @clawd/scene typecheck
```
