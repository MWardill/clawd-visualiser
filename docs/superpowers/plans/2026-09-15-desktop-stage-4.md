# Desktop Stage 4 (Tray) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app lives in the tray: closing the window keeps the agent running, only one copy runs at a time, the tray shows the session counts and a waiting badge, and the app can start hidden at login.

**Architecture:** Four Electron-free modules carry the logic, each tested: `icons.ts` draws the tray icons from the canonical Clawd sprite and encodes them as PNG; `desktop-state.ts` and `bounds.ts` remember the window and the login choice in `~/.clawd/desktop.json`; `login.ts` decides what the login item needs at launch; `tray.ts` and `keys.ts` hold the tray menu and the quit shortcut as data. `build/icons.mjs` renders the icons into `resources/tray`, where they are checked in. `main.ts` takes the single-instance lock, then wires the tray, the hide-on-close window, the quit flag and the login item to Electron.

**Tech Stack:** Electron 44, esbuild 0.28, vitest 5, TypeScript 5.9, pnpm 12 workspaces, `node:zlib`.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, sections 3, 4, 7 (bounds), 10 (tray and login item), 11 (appId), 13 and stage 4 of section 12.

**Stage idea:** until now the window was the app: close it and everything stopped. A tray app turns that around. The process, the agent and a small icon by the clock are the app, and the window is a view you open and put away. That brings four Electron ideas. A `Tray` and its `Menu` are made in main and kept referenced. Closing a window becomes a choice main makes, so quitting needs a flag that says "this close is for real". A second launch has to find the first, which is what the single-instance lock is for. And a login item is a Windows Run key entry that Electron writes for you, pointing at an exe and its arguments.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The desktop package has no runtime dependencies. `@clawd/agent`, `@clawd/core` and, from this stage, `@clawd/scene` are dev dependencies, bundled by esbuild.
- Startup (spec §4): `app.requestSingleInstanceLock()` first, and a second instance exits; the scheme is registered before `ready`; on `ready`, in order: the scheme handler, the agent host, the tray, the login item re-applied, and the window unless `--hidden`.
- Closing the window hides it. Quit (tray menu or Ctrl+Q) sets a quitting flag, hides the window, awaits `host.stop()` and calls `app.exit(0)`. `will-quit` is held until the stop resolves, capped at five seconds (stage 2's `createQuitHandler`, unchanged).
- Tray icon: the canonical Clawd at 16 and 32 px, rendered from the matrix by `build/icons.mjs`, plus a variant with an amber dot for waiting above zero. Tooltip: `Clawd Visualiser · 3 sessions · 1 waiting`, with `· agent attached` or `· agent failed` appended in those states (`statusText` in `agent-host.ts`, unchanged). Menu: Open, Settings, Start on login (checkbox), Quit. Clicking the icon opens the window.
- Settings joins the tray menu in stage 5, with the settings window. This stage's menu is Open, Start on login, Quit.
- Login item: `app.setLoginItemSettings({ openAtLogin, args: ["--hidden"] })`. Turned on the first time the packaged app runs (a flag in `desktop.json`). The tray checkbox reads `getLoginItemSettings()`. On every launch, when it is on, it is applied again so the registered path follows a moved folder, logged as `desktop.loginItemReapplied`.
- The app's id is `io.github.mwardill.clawd-visualiser` (spec §11 `appId`). Main sets it as the AppUserModelId, which also names the login item's Run key entry, so development and the packaged app agree on the name.
- Window bounds persist in `~/.clawd/desktop.json` (spec §7). The stages table lists no stage for this; it lands here because `desktop.json` does.
- Generated icons are checked in under `apps/desktop/resources/` (spec §3).
- Log lines carry a time, a code and numbers or booleans only. New code this stage: `desktop.loginItemReapplied`.
- Each stage note explains the Electron idea it introduces, in plain words, for a maintainer learning Electron.
- Check listening ports with `netstat -ano`. `Get-NetTCPConnection` printed nothing for listening ports in stage 3's shells.
- An agent started before stage 3 refuses `app://clawd`. Stop any such CLI agent before running the app for this stage's checks.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-4` in the worktree `C:\mw\visualiser-desktop`, cut from `main` (stage 3 is merged). Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/icons.ts` | Draws a tray icon from a sprite on a 16-pixel grid at 1× and 2×, with an optional badge; encodes RGBA as PNG. |
| `apps/desktop/build/icons.mjs` | Bundles the scene's sprite and palette with `icons.ts`, writes `resources/tray/*.png`. |
| `apps/desktop/resources/tray/` | The four checked-in tray PNGs. |
| `apps/desktop/build/bundle.mjs` | Also copies `resources/tray` to `dist/tray`. |
| `apps/agent/src/index.ts` | Exports `readJsonFile` and `writeJsonAtomic`. |
| `apps/agent/src/log.ts` | `desktop.loginItemReapplied` joins the closed set. |
| `apps/desktop/src/desktop-state.ts` | `desktop.json`: its path, a tolerant parser, and a store that loads, merges, writes in order and flushes. |
| `apps/desktop/src/bounds.ts` | Whether remembered bounds can still be reached on today's displays. |
| `apps/desktop/src/login.ts` | The app id, what the Run key entry launches, and the decision at launch. |
| `apps/desktop/src/tray.ts` | The tray icon file for a waiting count, and the menu template. |
| `apps/desktop/src/keys.ts` | The Ctrl+Q check. |
| `apps/desktop/src/window.ts` | The window takes remembered bounds. |
| `apps/desktop/src/main.ts` | The lock, the tray, hide on close, the quit flag, the login item, `--hidden`, second launches. |
| `apps/desktop/README.md` | Run notes for the tray; the stage 4 note. |
| `README.md` (root) | The `apps/desktop` row says what stage 4 adds. |

---

### Task 1: Tray icons drawn from the canonical Clawd

**Files:**
- Modify: `apps/desktop/package.json` (devDependencies, scripts)
- Create: `apps/desktop/src/icons.ts`
- Test: `apps/desktop/src/icons.test.ts`
- Create: `apps/desktop/build/icons.mjs`
- Create: `apps/desktop/resources/tray/tray.png`, `tray@2x.png`, `tray-waiting.png`, `tray-waiting@2x.png` (generated)
- Modify: `apps/desktop/build/bundle.mjs`

**Interfaces:**
- Consumes: `CLAWD_BODY` and `PALETTE` from `@clawd/scene` (in `build/icons.mjs` only).
- Produces: `Sprite`; `IconColours = { body: string; eye: string; badge: string }`; `ICON_GRID = 16`; `SPRITE_ORIGIN`; `BADGE_ORIGIN`; `TRAY_ICONS` (the four `{ file, scale, badge }` entries); `renderTrayIcon(sprite, colours, scale, badge): Uint8Array`; `encodePng(width, height, rgba): Buffer`; the files in `dist/tray` after `pnpm bundle`.

`@clawd/scene`'s engine names `CanvasRenderingContext2D`, a DOM type this package's type check does not load, so `src/` never imports the scene. `icons.ts` takes the sprite and colours as arguments, and `build/icons.mjs` has esbuild bundle the scene and `icons.ts` together, since esbuild does not type-check. A prototype on 15 September 2026 confirmed both: esbuild bundles the sprite and palette to a 2 KB module Node imports from a `data:` URL, and the drawing below gives a legible coral Clawd at 16 px with an amber dot.

- [ ] **Step 1: Add the scene as a dev dependency and install**

In `apps/desktop/package.json`, add to `devDependencies`, after `"@clawd/core"`:

```json
    "@clawd/scene": "workspace:*",
```

and to `scripts`, after `"renderer"`:

```json
    "icons": "node build/icons.mjs",
```

Run from the repository root: `pnpm install`
Expected: the lockfile's `apps/desktop` importer gains the `@clawd/scene` link; nothing is downloaded.

- [ ] **Step 2: Write the failing tests**

`apps/desktop/src/icons.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BADGE_ORIGIN, ICON_GRID, SPRITE_ORIGIN, TRAY_ICONS, encodePng, renderTrayIcon, type Sprite } from "./icons";

const COLOURS = { body: "#cd6e58", eye: "#000000", badge: "#f2c35b" };
const BODY = [205, 110, 88, 255];
const EYE = [0, 0, 0, 255];
const AMBER = [242, 195, 91, 255];
const CLEAR = [0, 0, 0, 0];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A 3×2 sprite: a full top row with an eye at each end, and a bottom row with a gap in the middle. */
const SPRITE: Sprite = {
  width: 3,
  height: 2,
  data: [
    [1, 1, 1],
    [1, 0, 1],
  ],
  anchors: { eyeLeft: { x: 0, y: 0 }, eyeRight: { x: 2, y: 0 } },
};

const pixel = (rgba: Uint8Array, size: number, x: number, y: number): number[] => Array.from(rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
const opaque = (rgba: Uint8Array): number => rgba.filter((_, i) => i % 4 === 3 && rgba[i] === 255).length;

type Chunk = { type: string; data: Buffer; crc: number; typeAndData: Buffer };
function chunks(png: Buffer): Chunk[] {
  const out: Chunk[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    out.push({ type: png.toString("ascii", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length), crc: png.readUInt32BE(at + 8 + length), typeAndData: png.subarray(at + 4, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

describe("renderTrayIcon", () => {
  it("draws the sprite's body and eyes at the origin on a clear 16-pixel grid", () => {
    const rgba = renderTrayIcon(SPRITE, COLOURS, 1, false);
    expect(rgba.length).toBe(ICON_GRID * ICON_GRID * 4);
    const { x, y } = SPRITE_ORIGIN;
    expect(pixel(rgba, 16, x, y)).toEqual(EYE);
    expect(pixel(rgba, 16, x + 1, y)).toEqual(BODY);
    expect(pixel(rgba, 16, x + 2, y)).toEqual(EYE);
    expect(pixel(rgba, 16, x, y + 1)).toEqual(BODY);
    expect(pixel(rgba, 16, x + 1, y + 1)).toEqual(CLEAR);
    expect(pixel(rgba, 16, 0, 0)).toEqual(CLEAR);
    expect(opaque(rgba)).toBe(5);
  });

  it("draws each grid cell as a 2×2 block at 2×", () => {
    const rgba = renderTrayIcon(SPRITE, COLOURS, 2, false);
    expect(rgba.length).toBe(32 * 32 * 4);
    const { x, y } = SPRITE_ORIGIN;
    expect(pixel(rgba, 32, 2 * x + 1, 2 * y + 1)).toEqual(EYE);
    expect(pixel(rgba, 32, 2 * (x + 1), 2 * y)).toEqual(BODY);
    expect(opaque(rgba)).toBe(20);
  });

  it("adds a rounded amber dot in the top-right corner only when asked", () => {
    const plain = renderTrayIcon(SPRITE, COLOURS, 1, false);
    const badged = renderTrayIcon(SPRITE, COLOURS, 1, true);
    const { x, y } = BADGE_ORIGIN;
    expect(pixel(plain, 16, x + 1, y)).toEqual(CLEAR);
    expect(pixel(badged, 16, x + 1, y)).toEqual(AMBER);
    expect(pixel(badged, 16, x, y)).toEqual(CLEAR);
    expect(opaque(badged) - opaque(plain)).toBe(12);
  });

  it("refuses a sprite that does not fit, a colour that is not #rrggbb, and a scale that is not a whole number above zero", () => {
    expect(() => renderTrayIcon({ ...SPRITE, width: 16, data: [Array<number>(16).fill(1), Array<number>(16).fill(1)] }, COLOURS, 1, false)).toThrow();
    expect(() => renderTrayIcon(SPRITE, { ...COLOURS, body: "coral" }, 1, false)).toThrow();
    expect(() => renderTrayIcon(SPRITE, COLOURS, 0, false)).toThrow();
    expect(() => renderTrayIcon(SPRITE, COLOURS, 1.5, false)).toThrow();
  });
});

describe("encodePng", () => {
  it("writes an 8-bit RGBA PNG whose chunks check out and whose rows inflate back to the pixels", () => {
    const rgba = renderTrayIcon(SPRITE, COLOURS, 1, true);
    const png = encodePng(16, 16, rgba);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    for (const part of parts) expect(part.crc).toBe(crc32(part.typeAndData));
    const header = parts[0]!.data;
    expect([header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9], header[10], header[11], header[12]]).toEqual([16, 16, 8, 6, 0, 0, 0]);
    const rows = inflateSync(parts[1]!.data);
    expect(rows.length).toBe(16 * (16 * 4 + 1));
    for (let row = 0; row < 16; row++) {
      const start = row * (16 * 4 + 1);
      expect(rows[start]).toBe(0);
      expect(rows.subarray(start + 1, start + 1 + 16 * 4).equals(Buffer.from(rgba.subarray(row * 64, (row + 1) * 64)))).toBe(true);
    }
  });

  it("refuses pixel data of the wrong length", () => {
    expect(() => encodePng(16, 16, new Uint8Array(10))).toThrow();
  });
});

describe("the checked-in tray icons", () => {
  it("are PNGs at 16 and 32 pixels, a plain pair and a badged pair", async () => {
    expect(TRAY_ICONS.map((icon) => icon.file)).toEqual(["tray.png", "tray@2x.png", "tray-waiting.png", "tray-waiting@2x.png"]);
    for (const icon of TRAY_ICONS) {
      const png = await readFile(new URL(`../resources/tray/${icon.file}`, import.meta.url));
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([ICON_GRID * icon.scale, ICON_GRID * icon.scale]);
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/icons.test.ts`
Expected: FAIL, "Failed to resolve import ./icons".

- [ ] **Step 4: Write the module**

`apps/desktop/src/icons.ts`:

```ts
// The tray icons: the canonical Clawd drawn on a 16-pixel grid at 1× and 2×, with an amber dot while
// sessions wait, encoded as PNG with nothing but node:zlib. The sprite and colours come in as
// arguments: build/icons.mjs takes them from @clawd/scene, whose engine needs DOM types this package
// does not load. Pure, so the drawing and the encoding are tested.
import { deflateSync } from "node:zlib";

export type Sprite = {
  width: number;
  height: number;
  data: readonly (readonly number[])[];
  anchors: { eyeLeft: { x: number; y: number }; eyeRight: { x: number; y: number } };
};

export type IconColours = { body: string; eye: string; badge: string };

/** The icon's logical grid, in pixels at 1×. */
export const ICON_GRID = 16;
/** The sprite's top-left cell: a clear column each side of the 14-wide Clawd, clear rows above it for the badge. */
export const SPRITE_ORIGIN = { x: 1, y: 5 } as const;
/** The badge's top-left cell, in the top-right corner. */
export const BADGE_ORIGIN = { x: 12, y: 0 } as const;
const BADGE = [
  [0, 1, 1, 0],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [0, 1, 1, 0],
] as const;

/** The files the tray loads. Electron picks the @2x file beside a name on a display scaled to 200%. */
export const TRAY_ICONS = [
  { file: "tray.png", scale: 1, badge: false },
  { file: "tray@2x.png", scale: 2, badge: false },
  { file: "tray-waiting.png", scale: 1, badge: true },
  { file: "tray-waiting@2x.png", scale: 2, badge: true },
] as const;

function rgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error("a colour must be #rrggbb");
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** RGBA pixels, row by row: clear except the sprite, its eyes and, when asked, the badge. */
export function renderTrayIcon(sprite: Sprite, colours: IconColours, scale: number, badge: boolean): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1) throw new Error("the scale must be a whole number above zero");
  if (SPRITE_ORIGIN.x + sprite.width > ICON_GRID || SPRITE_ORIGIN.y + sprite.height > ICON_GRID) throw new Error("the sprite does not fit the icon grid");
  const body = rgb(colours.body);
  const eye = rgb(colours.eye);
  const amber = rgb(colours.badge);
  const size = ICON_GRID * scale;
  const pixels = new Uint8Array(size * size * 4);
  const cell = (gx: number, gy: number, [r, g, b]: readonly [number, number, number]): void => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((gy * scale + dy) * size + gx * scale + dx) * 4;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      }
    }
  };
  for (let row = 0; row < sprite.height; row++) {
    for (let col = 0; col < sprite.width; col++) {
      if (sprite.data[row]?.[col] === 1) cell(SPRITE_ORIGIN.x + col, SPRITE_ORIGIN.y + row, body);
    }
  }
  cell(SPRITE_ORIGIN.x + sprite.anchors.eyeLeft.x, SPRITE_ORIGIN.y + sprite.anchors.eyeLeft.y, eye);
  cell(SPRITE_ORIGIN.x + sprite.anchors.eyeRight.x, SPRITE_ORIGIN.y + sprite.anchors.eyeRight.y, eye);
  if (badge) {
    for (let row = 0; row < BADGE.length; row++) {
      for (let col = 0; col < BADGE[row]!.length; col++) {
        if (BADGE[row]![col] === 1) cell(BADGE_ORIGIN.x + col, BADGE_ORIGIN.y + row, amber);
      }
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG chunk: the data's length, the type, the data, and a CRC over type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(typed.length + 8);
  out.writeUInt32BE(data.length, 0);
  typed.copy(out, 4);
  out.writeUInt32BE(crc32(typed), typed.length + 4);
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An 8-bit RGBA PNG: a header, one compressed block of unfiltered rows, and the end marker. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("the pixel data does not match the size");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // colour type 6: red, green, blue and alpha
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    // Each row starts with its filter type, and 0 means none; Buffer.alloc has already written it.
    rows.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array(0))]);
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/desktop && npx vitest run src/icons.test.ts`
Expected: every test passes except `the checked-in tray icons`, which fails reading `resources/tray/tray.png` (ENOENT): the files come in the next step.

- [ ] **Step 6: Write the icon build and run it**

`apps/desktop/build/icons.mjs`:

```js
// Draws the tray icons from the canonical Clawd sprite and writes them to resources/tray, where they
// are checked in. Run it when the sprite or the palette changes: pnpm --filter @clawd/desktop icons
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// The sprite lives in @clawd/scene and the drawing in src/icons.ts, both TypeScript, so esbuild
// bundles the two into one module first and Node imports it from memory.
const bundled = await build({
  stdin: {
    contents: 'export { CLAWD_BODY, PALETTE } from "@clawd/scene";\nexport { ICON_GRID, TRAY_ICONS, encodePng, renderTrayIcon } from "./src/icons.ts";',
    resolveDir: root,
    sourcefile: "icons-entry.mjs",
    loader: "js",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
});
const { CLAWD_BODY, PALETTE, ICON_GRID, TRAY_ICONS, encodePng, renderTrayIcon } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const colours = { body: PALETTE.clawd.body, eye: PALETTE.clawd.eye, badge: PALETTE.state.amber };
const outDir = join(root, "resources", "tray");
await mkdir(outDir, { recursive: true });
for (const icon of TRAY_ICONS) {
  const size = ICON_GRID * icon.scale;
  await writeFile(join(outDir, icon.file), encodePng(size, size, renderTrayIcon(CLAWD_BODY, colours, icon.scale, icon.badge)));
  console.log(`icons: wrote resources/tray/${icon.file} (${size}x${size})`);
}
```

Run from the repository root: `pnpm --filter @clawd/desktop icons`
Expected: four `icons: wrote resources/tray/...` lines, at 16x16, 32x32, 16x16 and 32x32.

Open `apps/desktop/resources/tray/tray-waiting@2x.png` in an image viewer (or the Read tool). Expected: a coral Clawd with two black eye pixels, its legs at the bottom, and a rounded amber dot in the top-right corner, on a transparent background.

- [ ] **Step 7: Copy the icons beside the bundle**

`apps/desktop/build/bundle.mjs`, replacing the whole file:

```js
// Bundles the main process into one CommonJS file. Electron loads `main` from package.json as a
// plain Node module, and the workspace packages export TypeScript, so a bundler has to run first.
import { build } from "esbuild";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here("../src/main.ts")],
  outfile: here("../dist/main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // The runtime provides Electron's module; bundling it would break it.
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

// The tray loads its icons from beside main.cjs, as the window loads the export.
await cp(here("../resources/tray"), here("../dist/tray"), { recursive: true });
```

- [ ] **Step 8: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit && pnpm bundle`
Expected: PASS, no type errors, and esbuild writes `dist/main.cjs`.

Run: `Get-ChildItem apps/desktop/dist/tray | Select-Object Name, Length` from the repository root.
Expected: the four PNG files.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/icons.ts apps/desktop/src/icons.test.ts apps/desktop/build/icons.mjs apps/desktop/build/bundle.mjs apps/desktop/resources/tray
git commit -m "feat(desktop): tray icons drawn from the canonical Clawd at 16 and 32 px, with an amber waiting badge, checked in"
```

---

### Task 2: `desktop.json` and window bounds that survive a change of displays

**Files:**
- Modify: `apps/agent/src/index.ts`
- Create: `apps/desktop/src/desktop-state.ts`
- Test: `apps/desktop/src/desktop-state.test.ts`
- Create: `apps/desktop/src/bounds.ts`
- Test: `apps/desktop/src/bounds.test.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `writeJsonAtomic` from `apps/agent/src/json-file.ts`.
- Produces: `readJsonFile`, `writeJsonAtomic`, `type JsonRead` from `@clawd/agent`; `Bounds = { x: number; y: number; width: number; height: number }`; `DesktopState = { bounds?: Bounds; openAtLogin?: boolean }`; `desktopStatePath(home: string): string`; `parseDesktopState(value: unknown): DesktopState`; `DesktopStore = { load(): Promise<void>; get(): DesktopState; update(patch: DesktopState): void; flush(): Promise<void> }`; `createDesktopStore(path: string): DesktopStore`; `GRAB_STRIP`; `restoredBounds(saved: Bounds | undefined, workAreas: readonly Bounds[]): Bounds | null`.

The file on disk is `{ "version": 1, "bounds": { "x", "y", "width", "height" }, "openAtLogin": true }`, both fields optional. `openAtLogin` records what the user chose; its absence is the first-run flag spec §10 asks for. The store is made synchronously, before `ready`, and loads later, so main can hand its `flush` to the quit handler at startup; an `update` made before the load finishes wins over the file.

- [ ] **Step 1: Export the JSON helpers from the agent**

In `apps/agent/src/index.ts`, add this line after the `./config` export:

```ts
export { readJsonFile, writeJsonAtomic, type JsonRead } from "./json-file";
```

- [ ] **Step 2: Write the failing tests**

`apps/desktop/src/desktop-state.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopStore, desktopStatePath, parseDesktopState } from "./desktop-state";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-desktop-state-"));
  made.push(dir);
  return dir;
}

const BOUNDS = { x: 100, y: 80, width: 1280, height: 800 };

describe("desktopStatePath", () => {
  it("is desktop.json in the home directory", () => {
    expect(desktopStatePath(join("C:", "home"))).toBe(join("C:", "home", "desktop.json"));
  });
});

describe("parseDesktopState", () => {
  it("keeps valid bounds and a boolean openAtLogin from a version 1 file", () => {
    expect(parseDesktopState({ version: 1, bounds: BOUNDS, openAtLogin: false })).toEqual({ bounds: BOUNDS, openAtLogin: false });
    expect(parseDesktopState({ version: 1 })).toEqual({});
  });

  it("drops each invalid field on its own, and everything from another version or a non-object", () => {
    expect(parseDesktopState({ version: 1, bounds: { ...BOUNDS, x: "100" }, openAtLogin: true })).toEqual({ openAtLogin: true });
    expect(parseDesktopState({ version: 1, bounds: { ...BOUNDS, width: 0 }, openAtLogin: "yes" })).toEqual({});
    expect(parseDesktopState({ version: 1, bounds: { ...BOUNDS, height: 10.5 } })).toEqual({});
    expect(parseDesktopState({ version: 2, bounds: BOUNDS })).toEqual({});
    expect(parseDesktopState(null)).toEqual({});
    expect(parseDesktopState([BOUNDS])).toEqual({});
  });
});

describe("createDesktopStore", () => {
  it("reads nothing remembered from a missing or damaged file", async () => {
    const dir = await tempDir();
    const missing = createDesktopStore(join(dir, "desktop.json"));
    await missing.load();
    expect(missing.get()).toEqual({});

    await writeFile(join(dir, "desktop.json"), "{ not json");
    const damaged = createDesktopStore(join(dir, "desktop.json"));
    await damaged.load();
    expect(damaged.get()).toEqual({});
  });

  it("loads what was saved, merges each update and writes the whole file as version 1", async () => {
    const path = join(await tempDir(), "desktop.json");
    await writeFile(path, JSON.stringify({ version: 1, bounds: BOUNDS }));
    const store = createDesktopStore(path);
    await store.load();
    expect(store.get()).toEqual({ bounds: BOUNDS });

    store.update({ openAtLogin: true });
    store.update({ bounds: { ...BOUNDS, x: 200 } });
    await store.flush();
    expect(store.get()).toEqual({ bounds: { ...BOUNDS, x: 200 }, openAtLogin: true });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, bounds: { ...BOUNDS, x: 200 }, openAtLogin: true });
  });

  it("lets an update made before the load finishes win over the file", async () => {
    const path = join(await tempDir(), "desktop.json");
    await writeFile(path, JSON.stringify({ version: 1, bounds: BOUNDS, openAtLogin: false }));
    const store = createDesktopStore(path);
    const loading = store.load();
    store.update({ openAtLogin: true });
    await loading;
    await store.flush();
    expect(store.get()).toEqual({ bounds: BOUNDS, openAtLogin: true });
  });

  it("never rejects a flush, even when the file cannot be written", async () => {
    const inTheWay = join(await tempDir(), "a-file");
    await writeFile(inTheWay, "");
    const store = createDesktopStore(join(inTheWay, "desktop.json"));
    await store.load();
    store.update({ openAtLogin: true });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.get()).toEqual({ openAtLogin: true });
  });
});
```

`apps/desktop/src/bounds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GRAB_STRIP, restoredBounds } from "./bounds";

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT = { x: 1920, y: 0, width: 2560, height: 1400 };

describe("restoredBounds", () => {
  it("has nothing to restore when nothing was saved", () => {
    expect(restoredBounds(undefined, [PRIMARY])).toBeNull();
  });

  it("restores bounds whose title strip is on a display, including a second one", () => {
    const onPrimary = { x: 100, y: 80, width: 1280, height: 800 };
    const onRight = { x: 2200, y: 100, width: 1280, height: 800 };
    expect(restoredBounds(onPrimary, [PRIMARY])).toEqual(onPrimary);
    expect(restoredBounds(onRight, [PRIMARY, RIGHT])).toEqual(onRight);
  });

  it("drops bounds left on a display that is no longer there", () => {
    expect(restoredBounds({ x: 2200, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBeNull();
  });

  it("drops bounds whose title strip is above the top of every display", () => {
    expect(restoredBounds({ x: 100, y: -20, width: 1280, height: 800 }, [PRIMARY])).toBeNull();
  });

  it("needs enough of the title strip's width on a display to grab it", () => {
    const edge = PRIMARY.width;
    expect(restoredBounds({ x: edge - (GRAB_STRIP.width - 1), y: 100, width: 1280, height: 800 }, [PRIMARY])).toBeNull();
    expect(restoredBounds({ x: edge - GRAB_STRIP.width, y: 100, width: 1280, height: 800 }, [PRIMARY])).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/desktop-state.test.ts src/bounds.test.ts`
Expected: FAIL, "Failed to resolve import ./desktop-state" and "./bounds".

- [ ] **Step 4: Write the modules**

`apps/desktop/src/desktop-state.ts`:

```ts
// ~/.clawd/desktop.json: what the app remembers between runs that is not the agent's config. The
// window's bounds, and whether the user wants the app at login, absent until a first packaged run or
// the tray decides. A missing or damaged file reads as nothing remembered; a failed write is dropped,
// since the next change writes the whole file again.
import { readJsonFile, writeJsonAtomic } from "@clawd/agent";
import { join } from "node:path";

export type Bounds = { x: number; y: number; width: number; height: number };
export type DesktopState = { bounds?: Bounds; openAtLogin?: boolean };

const VERSION = 1;

export function desktopStatePath(home: string): string {
  return join(home, "desktop.json");
}

const whole = (value: unknown): value is number => Number.isInteger(value);

/** The valid fields of a version 1 file, each judged on its own; anything else is dropped. */
export function parseDesktopState(value: unknown): DesktopState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const file = value as { version?: unknown; bounds?: unknown; openAtLogin?: unknown };
  if (file.version !== VERSION) return {};
  const state: DesktopState = {};
  const b = file.bounds;
  if (typeof b === "object" && b !== null) {
    const { x, y, width, height } = b as Record<string, unknown>;
    if (whole(x) && whole(y) && whole(width) && whole(height) && width > 0 && height > 0) state.bounds = { x, y, width, height };
  }
  if (typeof file.openAtLogin === "boolean") state.openAtLogin = file.openAtLogin;
  return state;
}

export type DesktopStore = {
  /** Reads the file once. Until then, and if it cannot be read, nothing is remembered. */
  load(): Promise<void>;
  get(): DesktopState;
  /** Merges the patch now, and writes the whole file after any write already queued. */
  update(patch: DesktopState): void;
  /** Resolves once every queued write has finished or failed. Never rejects. */
  flush(): Promise<void>;
};

export function createDesktopStore(path: string): DesktopStore {
  let state: DesktopState = {};
  let chain: Promise<void> = Promise.resolve();
  return {
    async load() {
      try {
        const file = await readJsonFile(path);
        // What was updated while the file was being read is newer than the file.
        if (file.found && file.ok) state = { ...parseDesktopState(file.value), ...state };
      } catch {
        // Unreadable, say locked by another process: start with nothing remembered.
      }
    },
    get: () => state,
    update(patch) {
      state = { ...state, ...patch };
      const snapshot = { version: VERSION, ...state };
      chain = chain.then(() => writeJsonAtomic(path, snapshot)).catch(() => {});
    },
    flush: () => chain,
  };
}
```

`apps/desktop/src/bounds.ts`:

```ts
// Whether remembered window bounds can still be used. Displays change between runs (a laptop
// undocked, a monitor unplugged), and a window restored where no display is cannot be reached.
import type { Bounds } from "./desktop-state";

/** How much of the window's top strip, where the title bar is, must lie on one display to grab it. */
export const GRAB_STRIP = { width: 100, height: 32 } as const;

/** The saved bounds when their title strip is on one of the work areas; null to open at the default size. */
export function restoredBounds(saved: Bounds | undefined, workAreas: readonly Bounds[]): Bounds | null {
  if (saved === undefined) return null;
  const reachable = workAreas.some((area) => {
    const wide = Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x);
    const tall = Math.min(saved.y + GRAB_STRIP.height, area.y + area.height) - Math.max(saved.y, area.y);
    return wide >= GRAB_STRIP.width && tall >= GRAB_STRIP.height;
  });
  return reachable ? saved : null;
}
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS, including Task 1's tests.

Run: `cd apps/agent && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/index.ts apps/desktop/src/desktop-state.ts apps/desktop/src/desktop-state.test.ts apps/desktop/src/bounds.ts apps/desktop/src/bounds.test.ts
git commit -m "feat(desktop): desktop.json remembers the window's bounds and the login choice, and bounds off every display are dropped"
```

---

### Task 3: The login item's target and the decision at launch

> **Erratum, found running Task 5.** Electron 44 quotes each login item argument itself, so a path the code has already quoted arrives with literal quote marks, and the development login item fails to start the app. Commit `0ab9acc` passes the path unquoted: `args: [appPath, "--hidden"]`, with the test expecting `["C:\\repo\\apps\\desktop", "--hidden"]` and a second case for a path with a space. The code below is as first planned; `apps/desktop/src/login.ts` is current.

**Files:**
- Modify: `apps/agent/src/log.ts:16`
- Create: `apps/desktop/src/login.ts`
- Test: `apps/desktop/src/login.test.ts`

**Interfaces:**
- Produces: `"desktop.loginItemReapplied"` in `LogCode`; `APP_ID = "io.github.mwardill.clawd-visualiser"`; `LoginItemTarget = { path: string; args: string[] }`; `loginItemTarget(packaged: boolean, execPath: string, appPath: string): LoginItemTarget`; `LoginOnLaunch = "none" | "enableFirstRun" | "reapply"`; `loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean }): LoginOnLaunch`.

On Windows, `setLoginItemSettings` writes a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, named by the AppUserModelId, holding the exe and its arguments. `getLoginItemSettings({ path, args })` answers `openAtLogin: true` only when a value holds exactly that exe and those arguments. So after the folder moves, Windows no longer has an entry for the new path, and `desktop.json` is what still knows the user wanted one. An entry Windows already has is left alone, so turning the app off in Task Manager's startup list, which Electron's call would otherwise switch back on, sticks.

- [ ] **Step 1: Add the log code**

In `apps/agent/src/log.ts`, in `LogCode`, after `| "desktop.stopTimedOut"`:

```ts
  | "desktop.loginItemReapplied"
```

- [ ] **Step 2: Write the failing tests**

`apps/desktop/src/login.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APP_ID, loginItemTarget, loginOnLaunch } from "./login";

describe("APP_ID", () => {
  it("is the design's appId", () => {
    expect(APP_ID).toBe("io.github.mwardill.clawd-visualiser");
  });
});

describe("loginItemTarget", () => {
  it("starts the packaged exe hidden", () => {
    expect(loginItemTarget(true, "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe", "C:\\Apps\\Clawd Visualiser\\resources\\app.asar")).toEqual({
      path: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe",
      args: ["--hidden"],
    });
  });

  it("in development, starts Electron on the app's folder, quoted, then hidden", () => {
    expect(loginItemTarget(false, "C:\\repo\\node_modules\\electron\\dist\\electron.exe", "C:\\repo\\apps\\desktop")).toEqual({
      path: "C:\\repo\\node_modules\\electron\\dist\\electron.exe",
      args: ['"C:\\repo\\apps\\desktop"', "--hidden"],
    });
  });
});

describe("loginOnLaunch", () => {
  it("turns the login item on at the packaged app's first run, and not in development", () => {
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: false })).toBe("enableFirstRun");
    expect(loginOnLaunch({ packaged: false, remembered: undefined, registered: false })).toBe("none");
  });

  it("writes the entry again when the user wants it and Windows has none for this path", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: false })).toBe("reapply");
    expect(loginOnLaunch({ packaged: false, remembered: true, registered: false })).toBe("reapply");
  });

  it("leaves an entry Windows already has, and a choice of off, alone", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: false, registered: false })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: false, registered: true })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: true })).toBe("enableFirstRun");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/login.test.ts`
Expected: FAIL, "Failed to resolve import ./login".

- [ ] **Step 4: Write the module**

`apps/desktop/src/login.ts`:

```ts
// The login item: a Windows Run key entry that starts the app, hidden, when the user signs in. Pure
// decisions; main makes the Electron calls.

/**
 * The app's id (spec §11 appId). Main sets it as the AppUserModelId, which names the Run key entry,
 * so development and the packaged app use one name. Stage 6's electron-builder appId is the same.
 */
export const APP_ID = "io.github.mwardill.clawd-visualiser";

export type LoginItemTarget = { path: string; args: string[] };

/**
 * What the Run key entry launches. Packaged, the exe itself. In development the exe is Electron's,
 * so the app's folder comes first, quoted as Windows needs, just as `electron .` passes it.
 */
export function loginItemTarget(packaged: boolean, execPath: string, appPath: string): LoginItemTarget {
  return { path: execPath, args: packaged ? ["--hidden"] : [`"${appPath}"`, "--hidden"] };
}

export type LoginOnLaunch = "none" | "enableFirstRun" | "reapply";

/**
 * What the login item needs at launch. `remembered` is desktop.json's openAtLogin, absent until the
 * first packaged run or the tray decides; `registered` is whether Windows has an entry for this exe
 * and these arguments. The first packaged run turns it on. After that, an entry the user wants but
 * Windows lacks for this path, as after the folder moved, is written again. An entry Windows already
 * has, and a choice of off, are left alone.
 */
export function loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean }): LoginOnLaunch {
  if (s.remembered === undefined) return s.packaged ? "enableFirstRun" : "none";
  if (s.remembered && !s.registered) return "reapply";
  return "none";
}
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

Run: `cd apps/agent && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/log.ts apps/desktop/src/login.ts apps/desktop/src/login.test.ts
git commit -m "feat(desktop): the login item starts the app hidden, turns on at the first packaged run, and is rewritten when the folder moves"
```

---

### Task 4: The tray menu and the quit shortcut, as data

**Files:**
- Create: `apps/desktop/src/tray.ts`
- Test: `apps/desktop/src/tray.test.ts`
- Create: `apps/desktop/src/keys.ts`
- Test: `apps/desktop/src/keys.test.ts`

**Interfaces:**
- Consumes: `TRAY_ICONS` from `./icons` (Task 1), in the test only.
- Produces: `trayIconFile(waiting: number): string`; `TrayActions = { open(): void; setOpenAtLogin(on: boolean): void; quit(): void }`; `trayMenuTemplate(openAtLogin: boolean, actions: TrayActions): MenuItemConstructorOptions[]`; `KeyInput = { type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }`; `isQuitShortcut(input: KeyInput): boolean`.

`tray.ts` imports only Electron's types, which vanish when compiled, so vitest loads it without Electron. The tooltip needs nothing new: `statusText` in `agent-host.ts` already produces the spec's text and is tested there.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/tray.test.ts`:

```ts
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { TRAY_ICONS } from "./icons";
import { trayIconFile, trayMenuTemplate } from "./tray";

const click = (item: MenuItemConstructorOptions | undefined): void => (item?.click as (() => void) | undefined)?.();

function recorder() {
  const calls: string[] = [];
  return { calls, actions: { open: () => void calls.push("open"), setOpenAtLogin: (on: boolean) => void calls.push(`login ${on}`), quit: () => void calls.push("quit") } };
}

describe("trayIconFile", () => {
  it("is the badged icon while any session waits, and a file the icon build writes", () => {
    expect(trayIconFile(0)).toBe("tray.png");
    expect(trayIconFile(1)).toBe("tray-waiting.png");
    expect(trayIconFile(3)).toBe("tray-waiting.png");
    const files = TRAY_ICONS.map((icon) => icon.file as string);
    expect(files).toContain(trayIconFile(0));
    expect(files).toContain(trayIconFile(1));
  });
});

describe("trayMenuTemplate", () => {
  it("is Open, Start on login as a checkbox, a separator, then Quit", () => {
    const { actions } = recorder();
    const menu = trayMenuTemplate(true, actions);
    expect(menu.map((item) => item.label ?? item.type)).toEqual(["Open", "Start on login", "separator", "Quit"]);
    expect(menu[1]).toMatchObject({ type: "checkbox", checked: true });
    expect(trayMenuTemplate(false, actions)[1]).toMatchObject({ type: "checkbox", checked: false });
  });

  it("opens, flips the login choice from what the menu showed, and quits", () => {
    const on = recorder();
    const menu = trayMenuTemplate(true, on.actions);
    click(menu[0]);
    click(menu[1]);
    click(menu[3]);
    expect(on.calls).toEqual(["open", "login false", "quit"]);

    const off = recorder();
    click(trayMenuTemplate(false, off.actions)[1]);
    expect(off.calls).toEqual(["login true"]);
  });
});
```

`apps/desktop/src/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isQuitShortcut, type KeyInput } from "./keys";

const key = (over: Partial<KeyInput>): KeyInput => ({ type: "keyDown", key: "q", control: true, shift: false, alt: false, meta: false, ...over });

describe("isQuitShortcut", () => {
  it("is Ctrl+Q pressed, in either case", () => {
    expect(isQuitShortcut(key({}))).toBe(true);
    expect(isQuitShortcut(key({ key: "Q" }))).toBe(true);
  });

  it("is not a release, another key, Q without Ctrl, or Ctrl+Q with another modifier", () => {
    expect(isQuitShortcut(key({ type: "keyUp" }))).toBe(false);
    expect(isQuitShortcut(key({ key: "w" }))).toBe(false);
    expect(isQuitShortcut(key({ control: false }))).toBe(false);
    expect(isQuitShortcut(key({ shift: true }))).toBe(false);
    expect(isQuitShortcut(key({ alt: true }))).toBe(false);
    expect(isQuitShortcut(key({ meta: true }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/tray.test.ts src/keys.test.ts`
Expected: FAIL, "Failed to resolve import ./tray" and "./keys".

- [ ] **Step 3: Write the modules**

`apps/desktop/src/tray.ts`:

```ts
// The tray's icon choice and menu, as data. Main turns the template into a Menu and the file name
// into an image; the tooltip is statusText from agent-host.ts. Only Electron's types are imported,
// so this is tested without Electron.
import type { MenuItemConstructorOptions } from "electron";

/** The icon for a waiting count: the amber-dot variant while any session waits. */
export function trayIconFile(waiting: number): string {
  return waiting > 0 ? "tray-waiting.png" : "tray.png";
}

export type TrayActions = {
  open(): void;
  setOpenAtLogin(on: boolean): void;
  quit(): void;
};

/** Open, Start on login, Quit. Settings joins it in stage 5, with the settings window. */
export function trayMenuTemplate(openAtLogin: boolean, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: "Open", click: () => actions.open() },
    { label: "Start on login", type: "checkbox", checked: openAtLogin, click: () => actions.setOpenAtLogin(!openAtLogin) },
    { type: "separator" },
    { label: "Quit", click: () => actions.quit() },
  ];
}
```

`apps/desktop/src/keys.ts`:

```ts
// The keyboard shortcut main handles in the window. Pure.

/** The fields of Electron's `Input` a shortcut needs. */
export type KeyInput = { type: string; key: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };

/** Ctrl+Q pressed, with no other modifier: quit the app, not just hide the window. */
export function isQuitShortcut(input: KeyInput): boolean {
  return input.type === "keyDown" && input.control && !input.shift && !input.alt && !input.meta && input.key.toLowerCase() === "q";
}
```

- [ ] **Step 4: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/tray.ts apps/desktop/src/tray.test.ts apps/desktop/src/keys.ts apps/desktop/src/keys.test.ts
git commit -m "feat(desktop): the tray menu and the Ctrl+Q shortcut as data"
```

---

### Task 5: Wire the tray into the main process, run the app, and write the stage note

> **Erratum, found in review.** Commit `081cb88` removed the window's `query-session-end` handler: at sign-out Windows sends no close, and a cancelled sign-out left `quitting` stuck. The same commit made the ready handler `const started = app.whenReady().then(...)`, has `second-instance` wait on `started`, and returns early after `await store.load()` when quitting. The final review's commit adds `if (quitting) return;` at the top of `showWindow()` and ignores a failed `started` in `second-instance`. The code below is as first planned; `apps/desktop/src/main.ts` is current.

**Files:**
- Modify: `apps/desktop/src/window.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/README.md`
- Modify: `README.md` (root)

**Interfaces:**
- Consumes: `trayIconFile`, `trayMenuTemplate` (Task 4); `isQuitShortcut` (Task 4); `APP_ID`, `loginItemTarget`, `loginOnLaunch` (Task 3); `createDesktopStore`, `desktopStatePath`, `restoredBounds` (Task 2); `dist/tray/*.png` (Task 1); `statusText`, `type HostState` from `./agent-host`; `createQuitHandler` from `./quit`.
- Produces: `createMainWindow(url: string, title: string, bounds: Bounds | null): BrowserWindow`.

As in stages 1 to 3, these two files have no unit tests on purpose: they only connect the tested modules to Electron. The check is running the app (step 4).

- [ ] **Step 1: Let the window open where it was**

`apps/desktop/src/window.ts`, replacing the whole file:

```ts
import { BrowserWindow } from "electron";
import type { Bounds } from "./desktop-state";
import { sameOrigin } from "./navigation";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

/**
 * The one visualiser window. The renderer is sandboxed with no Node access and no preload: a web
 * page that talks to the agent over HTTP, as a browser tab does. It may not open windows and may
 * not navigate away from the origin it was loaded from. `bounds` puts it back where it was; without
 * them it opens at the default size, centred.
 */
export function createMainWindow(url: string, title: string, bounds: Bounds | null): BrowserWindow {
  const win = new BrowserWindow({
    ...(bounds ?? WINDOW_SIZE),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // A page's <title> replaces the window's by default; main sets the title from the agent's state instead.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(url, target)) event.preventDefault();
  });
  void win.loadURL(url);
  return win;
}
```

- [ ] **Step 2: Wire the main process**

`apps/desktop/src/main.ts`, replacing the whole file:

```ts
// The main process: the one Node program in the app. It owns the lifecycle, the window and the tray,
// and runs the agent itself; Chromium draws, in a sandboxed renderer process per window.
import { DEFAULT_PORT, agentPaths, createLogger, defaultHome, startAgent } from "@clawd/agent";
import { Menu, Tray, app, nativeImage, protocol, screen, type BrowserWindow, type NativeImage } from "electron";
import { join } from "node:path";
import { fetchCounts, probeHealth } from "./agent-client";
import { createAgentHost, statusText, type HostState } from "./agent-host";
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";
import { restoredBounds } from "./bounds";
import { createDesktopStore, desktopStatePath } from "./desktop-state";
import { isQuitShortcut } from "./keys";
import { createFileSink, readRetentionDays } from "./log";
import { APP_ID, loginItemTarget, loginOnLaunch } from "./login";
import { createQuitHandler } from "./quit";
import { APP_SCHEME, createSchemeHandler } from "./scheme";
import { trayIconFile, trayMenuTemplate } from "./tray";
import { createMainWindow } from "./window";

// One copy of the app per user. The first launch holds the lock; a second one hands its command
// line to the first, through `second-instance`, and exits here before doing anything else.
if (app.requestSingleInstanceLock()) run();
else app.exit(0);

function run(): void {
  const args = parseArgs(ownArgs(process.argv, app.isPackaged));
  const url = resolveRendererUrl(args, process.env);
  const home = defaultHome();

  // The id names the login item's Run key entry and groups the app in the taskbar. electron-builder
  // sets the same id in the packaged app.
  app.setAppUserModelId(APP_ID);

  // A custom scheme is declared before `ready`, with what it may do. `standard` makes app://clawd/
  // behave like http: relative and root-relative URLs resolve under it and the page's origin is
  // app://clawd. `secure` makes the page a secure context. `supportFetchAPI` lets fetch reach the scheme,
  // though the CSP's connect-src currently allows fetch to the agent only.
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

  // The agent's own logger, writing to a dated file: codes and numbers only. In development the
  // lines also reach the terminal that ran the dev command.
  const sink = createFileSink(agentPaths(home).logs, { now: Date.now, retentionDays: () => readRetentionDays(home) });
  const log = createLogger((line) => {
    sink.write(line);
    if (!app.isPackaged) process.stdout.write(line);
  });

  const store = createDesktopStore(desktopStatePath(home));
  const login = loginItemTarget(app.isPackaged, process.execPath, app.getAppPath());

  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let trayFile = "";
  // Set once quitting has begun, so that closing the window really closes it rather than hiding it.
  let quitting = false;

  const host = createAgentHost({
    start: (onSnapshot) => startAgent({ home, log, onSnapshot }),
    probe: (port) => probeHealth(port),
    counts: (port) => fetchCounts(port),
    log,
    onChange: (state) => {
      if (win !== null && !win.isDestroyed()) win.setTitle(statusText(state));
      refreshTray(state);
    },
  });

  // Without these, an error nothing caught ends the app behind Electron's crash dialog. The host
  // logs it by code and restarts the agent when the app owns it.
  process.on("uncaughtException", () => host.fault());
  process.on("unhandledRejection", () => host.fault());

  /** Shows the window, making it the first time; from the tray, a second launch, or startup. */
  function showWindow(): void {
    if (win !== null) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    const created = createMainWindow(url, statusText(host.state()), restoredBounds(store.get().bounds, workAreas));
    // Closing hides the window, and the app and its agent carry on in the tray. Once quitting has
    // begun the close goes through. Either way the bounds are remembered.
    created.on("close", (event) => {
      store.update({ bounds: created.getNormalBounds() });
      if (quitting) return;
      event.preventDefault();
      created.hide();
    });
    // Windows is signing out or shutting down: let the window close rather than hold the session up.
    created.on("query-session-end", () => {
      quitting = true;
    });
    created.webContents.on("before-input-event", (event, input) => {
      if (!isQuitShortcut(input)) return;
      event.preventDefault();
      app.quit();
    });
    created.on("closed", () => {
      win = null;
    });
    win = created;
  }

  /** Electron loads the @2x file beside the named one on a display scaled to 200%. */
  function trayImage(file: string): NativeImage {
    return nativeImage.createFromPath(join(__dirname, "tray", file));
  }

  function refreshTray(state: HostState): void {
    if (tray === null) return;
    tray.setToolTip(statusText(state));
    const file = trayIconFile(state.waiting);
    if (file !== trayFile) {
      trayFile = file;
      tray.setImage(trayImage(file));
    }
  }

  function openAtLogin(): boolean {
    return app.getLoginItemSettings(login).openAtLogin;
  }

  function setOpenAtLogin(on: boolean): void {
    app.setLoginItemSettings({ ...login, openAtLogin: on });
    store.update({ openAtLogin: on });
    refreshMenu();
  }

  /** The menu is rebuilt whenever the login checkbox could have changed. */
  function refreshMenu(): void {
    tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(openAtLogin(), { open: showWindow, setOpenAtLogin, quit: () => app.quit() })));
  }

  // A second launch. One started at login while the app already runs passes --hidden and changes nothing.
  app.on("second-instance", (_event, argv) => {
    if (parseArgs(argv).hidden) return;
    void app.whenReady().then(showWindow);
  });

  // `ready` fires once Electron has initialised; no window or tray can be made before it.
  void app.whenReady().then(async () => {
    // Every app:// request is answered from the export beside main.cjs, under a CSP that lets the
    // page reach only the agent in use.
    protocol.handle(APP_SCHEME, createSchemeHandler({ rendererDir: join(__dirname, "renderer"), port: () => host.state().port ?? DEFAULT_PORT }));
    log("desktop.started", { packaged: app.isPackaged });
    host.start();
    await store.load();

    // The tray has to stay referenced for as long as the app runs; `tray` in this closure is that reference.
    trayFile = trayIconFile(0);
    tray = new Tray(trayImage(trayFile));
    tray.on("click", () => showWindow());
    refreshTray(host.state());
    refreshMenu();

    const action = loginOnLaunch({ packaged: app.isPackaged, remembered: store.get().openAtLogin, registered: openAtLogin() });
    if (action !== "none") {
      app.setLoginItemSettings({ ...login, openAtLogin: true });
      store.update({ openAtLogin: true });
      refreshMenu();
    }
    if (action === "reapply") log("desktop.loginItemReapplied");

    if (!args.hidden) showWindow();
  });

  // The tray keeps the app running with no window open. Without a listener here, Electron would quit
  // as soon as the last window closed.
  app.on("window-all-closed", () => {});

  // Quitting, from the tray, Ctrl+Q or Ctrl+C in the terminal: set the flag so the window's close goes
  // through, and take the window and the tray icon away at once while the agent stops.
  app.on("before-quit", () => {
    quitting = true;
    win?.hide();
    tray?.destroy();
    tray = null;
  });

  // `will-quit` comes after every window has closed. The handler holds it until the agent has stopped
  // (at most five seconds), writes out the log and desktop.json, then exits.
  app.on("will-quit", createQuitHandler({ stop: () => host.stop(), flush: () => Promise.all([sink.flush(), store.flush()]).then(() => {}), exit: (code) => app.exit(code), log }));

  // Ctrl+C in the terminal asks for the same sequence.
  process.on("SIGINT", () => app.quit());
  process.on("SIGTERM", () => app.quit());
}
```

- [ ] **Step 3: Bundle and type-check**

Run: `cd apps/desktop && npx tsc --noEmit && npx vitest run && pnpm bundle`
Expected: no type errors, every test passes, and esbuild writes `dist/main.cjs` with no warnings.

Run from the repository root: `grep -cE 'require\("(zod|@clawd/[a-z]+)"\)' apps/desktop/dist/main.cjs`
Expected: `0`.

- [ ] **Step 4: Run the app and walk the checklist (pause here for the maintainer)**

Stop any CLI agent started before stage 3 and any running copy of the app. Check with `netstat -ano | findstr ":4750"` that nothing listens on the agent's port. Then, from the repository root: `pnpm --filter @clawd/desktop start`

Check each:

- **The tray.** A coral Clawd appears by the clock (it may start in the overflow area behind the `^`). Hovering it shows `Clawd Visualiser · N sessions`, the same text as the window title.
- **Close hides.** Close the window with its X. The window goes, the tray icon stays, and `netstat -ano | findstr ":4750"` still shows the port listening, owned by an `electron.exe` process (`tasklist /FI "PID eq <pid>"`). The log (`Get-Content "$HOME\.clawd\logs\desktop-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log" -Tail 5`) has no `agent.stopped`.
- **Open.** Click the tray icon: the window comes back where it was. Right-click, Open: the same.
- **The waiting badge.** In an allowlisted folder, ask Claude Code to do something that needs a permission prompt and leave the prompt open. The tray icon gains the amber dot and the tooltip ends `· 1 waiting`. Answer the prompt: the dot goes.
- **Bounds.** Move and resize the window, then quit from the tray menu. `Get-Content "$HOME\.clawd\desktop.json"` shows `"version": 1` and the new bounds. Start the app again: the window opens at those bounds.
- **Quit.** Tray menu, Quit: the window and the tray icon go at once; the log gains `agent.stopped` with no `desktop.stopTimedOut`; the port is free. Start again, focus the window, press Ctrl+Q: the same.
- **One copy.** With the app running and its window hidden, run `pnpm --filter @clawd/desktop exec electron .` in another terminal. No second tray icon appears, the first app's window shows and takes focus, and the second command returns within a few seconds.
- **Hidden.** Quit. From `apps/desktop`, run `npx electron . --hidden`. Only the tray icon appears; clicking it opens the window. With that copy running, `npx electron . --hidden` again changes nothing.
- **The login item.** Tray menu, Start on login. Then:

  ```
  reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v io.github.mwardill.clawd-visualiser
  Get-Content "$HOME\.clawd\desktop.json"
  ```

  The value holds Electron's `electron.exe`, the quoted `apps\desktop` path and `--hidden`; `desktop.json` has `"openAtLogin": true`; reopening the tray menu shows the box ticked. Quit, then press Win+R, paste the command from the registry value exactly as printed, and press Enter (PowerShell would only echo the quoted text): the app starts with only the tray icon, as it would at sign-in.
- **Re-applied after a move.** With Start on login ticked, delete the value, standing in for a moved folder: `reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v io.github.mwardill.clawd-visualiser /f`. Quit and start the app. The value is back, and the log has `desktop.loginItemReapplied`.
- **Off.** Untick Start on login. The `reg query` above reports that the value cannot be found, and `desktop.json` has `"openAtLogin": false`. Leave it off, so development Electron does not start at every sign-in.
- **The dev loop.** Quit. With `pnpm dev` running, `pnpm --filter @clawd/desktop dev` opens the window on `http://localhost:3000` with the tray, and closing the window hides it there too.

Record anything that differed in the stage note.

- [ ] **Step 5: Update the READMEs**

In `apps/desktop/README.md`, in the `## Run` section, after the paragraph that begins "The export talks to the agent at", add:

```markdown
The app lives in the tray. Closing the window hides it and the agent keeps running; click the tray
icon to bring it back, and quit from the tray menu or with Ctrl+Q. Only one copy runs: starting it
again shows the running copy's window. `--hidden` starts it with only the tray icon, as the login
item does. The window's position and the login choice are kept in `~/.clawd/desktop.json`.
```

Append after the Stage 3 note:

```markdown
### Stage 4: the tray

Until now the window was the app: close it and everything stopped. Now the process, the agent and an
icon by the clock are the app, and the window is a view you open and put away.

**The tray.** `new Tray(image)` puts an icon in the notification area, with a tooltip and a context
menu built with `Menu.buildFromTemplate`. A tray that nothing references any more can be garbage
collected and vanish, so main keeps it in a variable for the life of the app. The icons are PNGs
drawn from the canonical Clawd sprite by `build/icons.mjs` and checked in under `resources/tray`;
`tray@2x.png` beside `tray.png` is picked up automatically on a display scaled to 200%. While any
session waits, the icon is the variant with an amber dot.

**Close and quit are now different things.** Electron's default is to quit when the last window
closes. The app listens for `window-all-closed` and does nothing, and the window's `close` handler
calls `event.preventDefault()` and hides the window instead. Quitting (the tray's Quit, Ctrl+Q, or
Ctrl+C in the terminal) goes through `app.quit()`, which fires `before-quit` first; main sets a
`quitting` flag there, so the window's `close` is let through, and then stage 2's `will-quit`
handler stops the agent. Windows signing out fires the window's `query-session-end`, which sets the
same flag, so the app never holds a sign-out up.

**One copy.** `app.requestSingleInstanceLock()` is the first thing main does. The first launch
gets the lock. Any later launch does not, exits at once, and Electron passes its command line to
the first copy as a `second-instance` event, which shows the window unless the line has `--hidden`.
This also ends stage 2's "a second copy attaches to the first copy's agent".

**The login item.** `app.setLoginItemSettings({ openAtLogin, path, args })` writes a value under the
current user's `Run` registry key; Windows starts that command line at sign-in. The value is named
by the app's AppUserModelId, which main sets to `io.github.mwardill.clawd-visualiser`. In
development the command is Electron's `electron.exe` with this folder and `--hidden`; packaged, it
is the app's own exe. `getLoginItemSettings({ path, args })` only reports a value holding exactly
that command, so after the folder moves Windows has no entry for the new path. `desktop.json`
remembers that the user wanted one, and the next launch writes it again
(`desktop.loginItemReapplied`). The packaged app turns the login item on at its first run.

What stage 4 leaves in place: the tray menu is Open, Start on login and Quit; Settings joins it with
the settings window in stage 5.
```

In the root `README.md` layout table, replace the `apps/desktop` row with:

```markdown
| `apps/desktop` | The Electron app, built in stages: the agent and the visualiser in one window and the tray, run from a folder. Stage 4 adds the tray: closing the window keeps the agent running, one copy runs at a time, and it can start hidden at login. See its README. |
```

- [ ] **Step 6: Run every check and commit**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add apps/desktop/src/window.ts apps/desktop/src/main.ts apps/desktop/README.md README.md
git commit -m "feat(desktop): the app lives in the tray; closing hides the window, one copy runs, and the login item starts it hidden"
```

Then hand the branch back with the finishing-a-development-branch skill. Stage 5 (settings) starts from `main` once this is merged.
