# Desktop Stage 6 (Package) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teammate unzips one folder, runs `Clawd Visualiser.exe`, sets up the hooks from the settings window, and can move the folder and relaunch with the hooks and the login item repaired.

**Architecture:** electron-builder packages the esbuild output into an asar with the `dir` and `zip` targets and sets three fuses. The tray icons and the hook scripts, which the app uses as files rather than reads, are placed beside the archive with `extraResources`, and `paths.ts` learns where they are. The icons become ICO files at every size Windows asks for, drawn from the canonical sprite by `build/icons.mjs` and checked against it by `pnpm test`. Development runs stop touching what the packaged app owns: the login item gets its own name, hooks are never rewritten unattended, and dev URLs are ignored when packaged. Two small fixes from the stage 5 review that touch this stage's code come along. A smoke script runs the packaged app once against scratch folders.

**Tech Stack:** Electron 44, electron-builder 26, esbuild 0.28, vitest 5, TypeScript 5.9, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, sections 3, 7, 8, 10, 11, 13, 14, stage 6 of section 12, and these items of 12.1: the stage 4 login item collision (which blocks this stage's "done when"), tray icon scaling, the export build, dev URLs in a packaged app, and from the 17 September 2026 review the launch repair in development, the folder picker's parent window and the detail setter's catch.

**Stage idea:** so far the app has been a repository: `electron .` on a folder of source. Packaging turns it into a thing a teammate can run with nothing installed. electron-builder copies Electron's own binary, renames it, stamps the icon and version into it, and puts the app's files in one archive, `resources/app.asar`, which Node inside Electron reads as if it were a directory. Two things follow. The archive is read-only and transparent only to Node's read calls, so anything the app touches as a file, an icon loaded by path or a script copied into the user's home, has to live beside the archive instead. And `process.execPath` is now the app's own exe, which is what the hooks and the login item point at: the app can be moved, and the next launch points them at the new place. Fuses are switches baked into the binary: the app keeps `runAsNode`, because the hooks depend on it, and gains `onlyLoadAppFromAsar` and cookie encryption.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first. `main.ts`, the build scripts and the smoke script are glue.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The desktop package has no runtime dependencies. electron-builder joins the dev dependencies; nothing else is added.
- electron-builder: `appId: io.github.mwardill.clawd-visualiser`, `productName: Clawd Visualiser`, `win.target: ["dir", "zip"]`, asar on, fuses `runAsNode: true`, `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true`. The artifact is `Clawd-Visualiser-<version>-win-x64.zip`. Windows' Extract All puts its files in a folder named after the zip.
- The packager writes to `apps/desktop/release/`, ignored by git. `dist/` stays the bundle's directory. The two never mix: electron-builder's default output directory is also called `dist`, which is why the output is set.
- The archive holds `dist/main.cjs`, `dist/renderer/` and `dist/settings/`. The tray icons and the hook scripts go beside it, under `resources/tray/` and `resources/hooks/`, because the tray loads its icon by path and the installer copies the scripts as files.
- Icons are ICO files drawn from the canonical Clawd sprite in `@clawd/scene` by `build/icons.mjs` and checked in. The tray ICOs hold 16, 20, 24 and 32 px images (100, 125, 150 and 200% scaling); the app ICO holds 16, 24, 32, 48, 64, 128 and 256 px. `pnpm test` fails if a checked-in icon no longer matches the sprite.
- Development runs never disturb the packaged app: the login item has its own Run value name (`<appId>.dev`), a development toggle is not remembered in `desktop.json`, nothing is enabled or re-applied at launch when not packaged, a development launch never rewrites the hooks unattended, and a packaged app ignores `--dev-url` and `CLAWD_DESKTOP_URL`.
- Log lines carry a time, a code and numbers or booleans only. New code this stage: `desktop.detailFailed`.
- Automated checks never run the packaged app against the real `~/.clawd` or `~/.claude`: the smoke script and the checklist use `CLAWD_HOME` and `CLAUDE_CONFIG_DIR` scratch folders, except the final walk on a second account.
- Each stage note explains the Electron idea it introduces, in plain words, for a maintainer learning Electron.
- Check listening ports with `netstat -ano`. Stop processes by exact process id; never by process tree, which on this machine also stopped unrelated processes.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-6` in the worktree `C:\mw\visualiser-desktop`, cut from `main` (stage 5 is merged at `634cb65`). That worktree still has `feat/desktop-stage-5` checked out, which is merged: `git -C C:\mw\visualiser-desktop checkout -b feat/desktop-stage-6 main`. Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app or the packager.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/icons.ts` | `renderIcon` at any size, `encodeIco`, the icon sets. `renderTrayIcon` stays for the whole-number case. |
| `apps/desktop/src/tray.ts` | ICO file names; the tooltip with the version. |
| `apps/desktop/build/icons.mjs` | Writes `resources/tray/*.ico` and `resources/icon.ico`; `--check` compares them with a fresh render. |
| `apps/desktop/resources/` | The checked-in ICOs. The four PNGs go. |
| `apps/desktop/src/paths.ts` | Where the pages, the icons and the scripts are, in development and packaged. |
| `apps/desktop/src/login.ts` | `appUserModelId(packaged)`; `loginOnLaunch` acts only when packaged. |
| `apps/desktop/src/hooks.ts` | `repairOnLaunch(status, packaged)`. |
| `apps/desktop/src/args.ts` | `resolveRendererUrl` ignores dev URLs when packaged. |
| `apps/agent/src/log.ts` | `desktop.detailFailed` joins the closed set. |
| `apps/desktop/src/main.ts` | Wiring: the paths, the id, the login store, the repair gate, the tooltip, the two action fixes. |
| `apps/desktop/electron-builder.yml` | The package. |
| `apps/desktop/build/renderer.mjs` | Removes a stale export first and prints a spawn error. |
| `apps/desktop/build/smoke-packaged.mjs` | Runs the packaged app once against scratch folders. |
| `apps/desktop/package.json`, `.gitignore` | `package` and `smoke` scripts, the icon check in `test`, `release/` ignored. |
| `docs/superpowers/specs/2026-09-14-desktop-app-design.md` | The decisions above, the done items, the stage 5 review's remaining findings. |
| `apps/desktop/README.md`, `README.md`, `docs/PRD.md`, `apps/agent/README.md` | The stage 6 note, the Run section, the PRD's fourth component and M8, the runtime prefix. |

---

### Task 1: Icons as ICO files, at every size Windows asks for

**Files:**
- Modify: `apps/desktop/src/icons.ts`
- Modify: `apps/desktop/src/tray.ts`
- Modify: `apps/desktop/build/icons.mjs`
- Modify: `apps/desktop/package.json` (the `test` script)
- Delete: `apps/desktop/resources/tray/tray.png`, `tray@2x.png`, `tray-waiting.png`, `tray-waiting@2x.png`
- Create (generated): `apps/desktop/resources/tray/tray.ico`, `apps/desktop/resources/tray/tray-waiting.ico`, `apps/desktop/resources/icon.ico`
- Test: `apps/desktop/src/icons.test.ts`, `apps/desktop/src/tray.test.ts`

**Interfaces:**
- Consumes: `Sprite`, `IconColours`, `encodePng` as they are; `statusText(state: HostState): string` from `agent-host.ts`.
- Produces: `renderIcon(sprite: Sprite, colours: IconColours, size: number, badge: boolean): Uint8Array`; `renderTrayIcon(sprite, colours, scale, badge)` unchanged in signature; `encodeIco(images: readonly { size: number; png: Buffer }[]): Buffer`; `TRAY_ICONS = [{ file: "tray.ico", badge: false }, { file: "tray-waiting.ico", badge: true }]`; `TRAY_SIZES = [16, 20, 24, 32]`; `APP_ICON = { file: "icon.ico", sizes: [16, 24, 32, 48, 64, 128, 256] }`; `trayIconFile(waiting): "tray.ico" | "tray-waiting.ico"`; `trayTooltip(state: HostState, version: string): string`; `node build/icons.mjs --check` exits 1 when a checked-in icon differs from the sprite.

Why ICO: at 125% and 150% scaling Windows resamples a 16 or 32 px PNG and blurs the pixel art (design §12.1). An ICO holds one image per size and Windows picks the matching one. 20 and 24 are not multiples of 16, so cells come out one or two pixels wide; every edge stays sharp, which is what pixel art wants.

- [ ] **Step 1: Write the failing tests for rendering at any size and for the ICO encoder**

In `apps/desktop/src/icons.test.ts`, replace the import line with:

```ts
import { APP_ICON, BADGE_ORIGIN, ICON_GRID, SPRITE_ORIGIN, TRAY_ICONS, TRAY_SIZES, encodeIco, encodePng, renderIcon, renderTrayIcon, type Sprite } from "./icons";
```

After the `chunks` helper, add:

```ts
type IcoEntry = { size: number; bytes: number; offset: number };
/** The directory of an ICO: one entry per image, width 0 meaning 256. */
function icoEntries(ico: Buffer): IcoEntry[] {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    const width = ico[at]!;
    return { size: width === 0 ? 256 : width, bytes: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) };
  });
}
```

After the `renderTrayIcon` describe, add:

```ts
describe("renderIcon", () => {
  it("at 24 pixels, gives each grid cell one or two pixels a side and keeps every edge sharp", () => {
    const rgba = renderIcon(SPRITE, COLOURS, 24, false);
    expect(rgba.length).toBe(24 * 24 * 4);
    // Cell x=1 covers pixel 2 only, cell x=2 covers 3 and 4, cell x=3 covers 5; row y=5 is pixel 8, row y=6 is 9 and 10.
    expect(pixel(rgba, 24, 2, 8)).toEqual(EYE);
    expect(pixel(rgba, 24, 3, 8)).toEqual(BODY);
    expect(pixel(rgba, 24, 4, 8)).toEqual(BODY);
    expect(pixel(rgba, 24, 5, 8)).toEqual(EYE);
    expect(pixel(rgba, 24, 2, 9)).toEqual(BODY);
    expect(pixel(rgba, 24, 2, 10)).toEqual(BODY);
    expect(pixel(rgba, 24, 3, 9)).toEqual(CLEAR);
    expect(opaque(rgba)).toBe(8);
  });

  it("at 32 pixels is exactly the 2× tray render", () => {
    expect(Buffer.from(renderIcon(SPRITE, COLOURS, 32, true)).equals(Buffer.from(renderTrayIcon(SPRITE, COLOURS, 2, true)))).toBe(true);
  });

  it("refuses a size below the grid or not a whole number", () => {
    expect(() => renderIcon(SPRITE, COLOURS, 8, false)).toThrow();
    expect(() => renderIcon(SPRITE, COLOURS, 20.5, false)).toThrow();
  });
});

describe("encodeIco", () => {
  it("writes a directory of PNG entries, 256 spelled as 0, at the offsets where the images sit", () => {
    const small = encodePng(16, 16, renderIcon(SPRITE, COLOURS, 16, false));
    const large = encodePng(256, 256, renderIcon(SPRITE, COLOURS, 256, false));
    const ico = encodeIco([
      { size: 16, png: small },
      { size: 256, png: large },
    ]);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
    expect([ico[6], ico[7], ico[8], ico[9], ico.readUInt16LE(10), ico.readUInt16LE(12)]).toEqual([16, 16, 0, 0, 1, 32]);
    expect([ico[22], ico[23]]).toEqual([0, 0]);
    const entries = icoEntries(ico);
    expect(entries).toEqual([
      { size: 16, bytes: small.length, offset: 6 + 32 },
      { size: 256, bytes: large.length, offset: 6 + 32 + small.length },
    ]);
    expect(ico.subarray(entries[0]!.offset, entries[0]!.offset + entries[0]!.bytes).equals(small)).toBe(true);
    expect(ico.subarray(entries[1]!.offset, entries[1]!.offset + entries[1]!.bytes).equals(large)).toBe(true);
    expect(ico.length).toBe(6 + 32 + small.length + large.length);
  });

  it("refuses no images, and an image larger than an entry can describe", () => {
    const png = encodePng(16, 16, renderIcon(SPRITE, COLOURS, 16, false));
    expect(() => encodeIco([])).toThrow();
    expect(() => encodeIco([{ size: 512, png }])).toThrow();
  });
});
```

Replace the whole `describe("the checked-in tray icons", ...)` block with:

```ts
describe("the checked-in icons", () => {
  const pngSize = (png: Buffer): number => png.readUInt32BE(16);

  it("are two tray ICOs holding 16, 20, 24 and 32 pixel PNGs, plain and badged", async () => {
    expect(TRAY_ICONS.map((icon) => icon.file)).toEqual(["tray.ico", "tray-waiting.ico"]);
    for (const icon of TRAY_ICONS) {
      const ico = await readFile(new URL(`../resources/tray/${icon.file}`, import.meta.url));
      const entries = icoEntries(ico);
      expect(entries.map((entry) => entry.size)).toEqual([...TRAY_SIZES]);
      for (const entry of entries) {
        const png = ico.subarray(entry.offset, entry.offset + entry.bytes);
        expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(pngSize(png)).toBe(entry.size);
      }
    }
  });

  it("include the app icon up to 256 pixels, which the packager needs", async () => {
    const ico = await readFile(new URL(`../resources/${APP_ICON.file}`, import.meta.url));
    expect(icoEntries(ico).map((entry) => entry.size)).toEqual([...APP_ICON.sizes]);
  });
});
```

In `apps/desktop/src/tray.test.ts`, replace the import of `./tray` with `import { trayIconFile, trayMenuTemplate, trayTooltip } from "./tray";`, change the two expectations in the `trayIconFile` test to `"tray.ico"` and `"tray-waiting.ico"` (three lines: `toBe("tray.ico")`, `toBe("tray-waiting.ico")` twice), and add:

```ts
describe("trayTooltip", () => {
  it("is the status line with the app's version after it", () => {
    expect(trayTooltip({ mode: "own", port: 4750, sessions: 2, waiting: 1, error: null }, "0.1.0")).toBe("Clawd Visualiser · 2 sessions · 1 waiting · v0.1.0");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/icons.test.ts src/tray.test.ts`
Expected: FAIL. `renderIcon`, `encodeIco`, `APP_ICON`, `TRAY_SIZES` and `trayTooltip` are not exported; the icon files do not exist.

- [ ] **Step 3: Write the renderer at any size and the ICO encoder**

Replace `apps/desktop/src/icons.ts` with:

```ts
// The app's icons: the canonical Clawd drawn on a 16-cell grid at any pixel size Windows asks for,
// with an amber dot while sessions wait, encoded as PNG with nothing but node:zlib and gathered into
// ICO files, which hold one image per size so Windows picks a crisp one at every display scale. The
// sprite and colours come in as arguments: build/icons.mjs takes them from @clawd/scene, whose engine
// needs DOM types this package does not load. Pure, so the drawing and both encodings are tested.
import { deflateSync } from "node:zlib";

export type Sprite = {
  width: number;
  height: number;
  data: readonly (readonly number[])[];
  anchors: { eyeLeft: { x: number; y: number }; eyeRight: { x: number; y: number } };
};

export type IconColours = { body: string; eye: string; badge: string };

/** The icon's logical grid, in cells. */
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

/** The tray's two ICO files: plain, and with the badge while sessions wait. Windows picks the size from the file. */
export const TRAY_ICONS = [
  { file: "tray.ico", badge: false },
  { file: "tray-waiting.ico", badge: true },
] as const;
/** The images in each tray ICO: 16 px at 100% scaling, 20 at 125%, 24 at 150%, 32 at 200%. */
export const TRAY_SIZES = [16, 20, 24, 32] as const;
/** The app's own icon, stamped into the exe by the packager, which needs the 256 px image. */
export const APP_ICON = { file: "icon.ico", sizes: [16, 24, 32, 48, 64, 128, 256] } as const;
/** The largest image an ICO directory entry can describe. */
const ICO_MAX = 256;

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error("a colour must be #rrggbb");
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** One colour per grid cell, or null where the icon is clear: the sprite, its eyes and, when asked, the badge. */
function cellGrid(sprite: Sprite, colours: IconColours, badge: boolean): (Rgb | null)[] {
  if (SPRITE_ORIGIN.x + sprite.width > ICON_GRID || SPRITE_ORIGIN.y + sprite.height > ICON_GRID) throw new Error("the sprite does not fit the icon grid");
  const body = rgb(colours.body);
  const eye = rgb(colours.eye);
  const amber = rgb(colours.badge);
  const cells: (Rgb | null)[] = Array.from({ length: ICON_GRID * ICON_GRID }, () => null);
  const set = (gx: number, gy: number, colour: Rgb): void => {
    cells[gy * ICON_GRID + gx] = colour;
  };
  for (let row = 0; row < sprite.height; row++) {
    for (let col = 0; col < sprite.width; col++) {
      if (sprite.data[row]?.[col] === 1) set(SPRITE_ORIGIN.x + col, SPRITE_ORIGIN.y + row, body);
    }
  }
  set(SPRITE_ORIGIN.x + sprite.anchors.eyeLeft.x, SPRITE_ORIGIN.y + sprite.anchors.eyeLeft.y, eye);
  set(SPRITE_ORIGIN.x + sprite.anchors.eyeRight.x, SPRITE_ORIGIN.y + sprite.anchors.eyeRight.y, eye);
  if (badge) {
    for (let row = 0; row < BADGE.length; row++) {
      for (let col = 0; col < BADGE[row]!.length; col++) {
        if (BADGE[row]![col] === 1) set(BADGE_ORIGIN.x + col, BADGE_ORIGIN.y + row, amber);
      }
    }
  }
  return cells;
}

/**
 * RGBA pixels, row by row, `size` pixels a side. Each pixel takes the colour of the grid cell it falls
 * in, so a size that is not a multiple of 16 gives cells of uneven width but every edge stays sharp,
 * which is what pixel art wants; 20 and 24 px are what Windows asks for at 125% and 150% scaling.
 */
export function renderIcon(sprite: Sprite, colours: IconColours, size: number, badge: boolean): Uint8Array {
  if (!Number.isInteger(size) || size < ICON_GRID) throw new Error("the size must be a whole number of pixels, at least the grid's 16");
  const cells = cellGrid(sprite, colours, badge);
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const gy = Math.floor((py * ICON_GRID) / size);
    for (let px = 0; px < size; px++) {
      const cell = cells[gy * ICON_GRID + Math.floor((px * ICON_GRID) / size)];
      if (cell === null || cell === undefined) continue;
      const i = (py * size + px) * 4;
      pixels[i] = cell[0];
      pixels[i + 1] = cell[1];
      pixels[i + 2] = cell[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** The grid at a whole-number scale: 16 px at 1×, 32 at 2×. */
export function renderTrayIcon(sprite: Sprite, colours: IconColours, scale: number, badge: boolean): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1) throw new Error("the scale must be a whole number above zero");
  return renderIcon(sprite, colours, ICON_GRID * scale, badge);
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

/**
 * An ICO file: a six-byte header, one sixteen-byte directory entry per image, then the images, each
 * a whole PNG, which Windows has accepted inside an ICO since Vista. A 256 px image is written with
 * width and height 0, the format's spelling for 256.
 */
export function encodeIco(images: readonly { size: number; png: Buffer }[]): Buffer {
  if (images.length === 0) throw new Error("an ICO needs at least one image");
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1: an icon, not a cursor
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    if (!Number.isInteger(size) || size < 1 || size > ICO_MAX) throw new Error("an ICO image is between 1 and 256 pixels a side");
    const entry = Buffer.alloc(16);
    entry[0] = size === ICO_MAX ? 0 : size; // width
    entry[1] = size === ICO_MAX ? 0 : size; // height
    entry[2] = 0; // colours in a palette: none, the image is true colour
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}
```

Replace `apps/desktop/src/tray.ts` with:

```ts
// The tray's icon choice, tooltip and menu, as data. Main turns the template into a Menu and the file
// name into an image. Only Electron's types are imported, so this is tested without Electron.
import type { MenuItemConstructorOptions } from "electron";
import { statusText, type HostState } from "./agent-host";

/** The icon for a waiting count: the badged ICO while any session waits. Windows picks the size from the file. */
export function trayIconFile(waiting: number): string {
  return waiting > 0 ? "tray-waiting.ico" : "tray.ico";
}

/** The tooltip: the status line with the app's version after it (design §11). The window title keeps the status line alone. */
export function trayTooltip(state: HostState, version: string): string {
  return `${statusText(state)} · v${version}`;
}

export type TrayActions = {
  open(): void;
  settings(): void;
  setOpenAtLogin(on: boolean): void;
  quit(): void;
};

/** Open, Settings, Start on login, Quit. */
export function trayMenuTemplate(openAtLogin: boolean, actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: "Open", click: () => actions.open() },
    { label: "Settings", click: () => actions.settings() },
    { label: "Start on login", type: "checkbox", checked: openAtLogin, click: () => actions.setOpenAtLogin(!openAtLogin) },
    { type: "separator" },
    { label: "Quit", click: () => actions.quit() },
  ];
}
```

- [ ] **Step 4: Write the icon script with its check, and generate the files**

Replace `apps/desktop/build/icons.mjs` with:

```js
// Draws the icons from the canonical Clawd sprite and writes them under resources, where they are
// checked in: two tray ICOs (plain and badged) at the sizes Windows asks for, and the app's ICO up to
// 256 px for the packager. `--check` renders them again and exits 1 if a checked-in file differs, so
// the icons cannot drift from the sprite. Run it when the sprite or the palette changes:
// pnpm --filter @clawd/desktop icons
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");

// The sprite lives in @clawd/scene and the drawing in src/icons.ts, both TypeScript, so esbuild
// bundles the two into one module first and Node imports it from memory.
const bundled = await build({
  stdin: {
    contents: 'export { CLAWD_BODY, PALETTE } from "@clawd/scene";\nexport { APP_ICON, TRAY_ICONS, TRAY_SIZES, encodeIco, encodePng, renderIcon } from "./src/icons.ts";',
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
const { CLAWD_BODY, PALETTE, APP_ICON, TRAY_ICONS, TRAY_SIZES, encodeIco, encodePng, renderIcon } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const colours = { body: PALETTE.clawd.body, eye: PALETTE.clawd.eye, badge: PALETTE.state.amber };
const ico = (sizes, badge) => encodeIco(sizes.map((size) => ({ size, png: encodePng(size, size, renderIcon(CLAWD_BODY, colours, size, badge)) })));

const files = [...TRAY_ICONS.map((icon) => ({ path: join("tray", icon.file), bytes: ico(TRAY_SIZES, icon.badge) })), { path: APP_ICON.file, bytes: ico(APP_ICON.sizes, false) }];

let differ = 0;
for (const file of files) {
  const target = join(root, "resources", file.path);
  if (check) {
    const current = await readFile(target).catch(() => null);
    const same = current !== null && current.equals(file.bytes);
    if (!same) differ++;
    console.log(`icons: resources/${file.path} ${same ? "matches the sprite" : "DIFFERS from the sprite; run pnpm --filter @clawd/desktop icons (a new Node can also change zlib's output)"}`);
  } else {
    await mkdir(join(root, "resources", "tray"), { recursive: true });
    await writeFile(target, file.bytes);
    console.log(`icons: wrote resources/${file.path} (${file.bytes.length} bytes)`);
  }
}
if (differ > 0) process.exit(1);
```

In `apps/desktop/package.json`, change the `test` script to `"test": "node build/icons.mjs --check && vitest run --passWithNoTests"`.

Run from `apps/desktop`: `git rm resources/tray/tray.png resources/tray/tray@2x.png resources/tray/tray-waiting.png resources/tray/tray-waiting@2x.png && pnpm icons`
Expected: four `git rm` lines, then three `icons: wrote` lines for `resources/tray/tray.ico`, `resources/tray/tray-waiting.ico` and `resources/icon.ico`.

Run: `node build/icons.mjs --check`
Expected: three `matches the sprite` lines, exit 0.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/icons.test.ts src/tray.test.ts`
Expected: PASS. The existing `renderTrayIcon` and `encodePng` tests still pass, since the 1× and 2× renders are unchanged.

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS. `main.ts` still compiles: it calls `trayIconFile` and reads `dist.tray`, neither of which changed shape.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/icons.ts apps/desktop/src/icons.test.ts apps/desktop/src/tray.ts apps/desktop/src/tray.test.ts apps/desktop/build/icons.mjs apps/desktop/package.json apps/desktop/resources
git commit -m "feat(desktop): the tray and app icons are ICO files at every size Windows asks for, drawn from the sprite and checked against it"
```

---

### Task 2: The icons and the scripts live beside the archive

**Files:**
- Modify: `apps/desktop/src/paths.ts`
- Modify: `apps/desktop/src/main.ts` (one line: `const dist = distPaths(__dirname);`, and the tooltip line in `refreshTray`)
- Test: `apps/desktop/src/paths.test.ts`

**Interfaces:**
- Produces: `distPaths(dir: string, resources: string): DistPaths` with `DistPaths = { renderer: string; tray: string; settings: string; hooks: string }`. `renderer` and `settings` are under `dir`; `tray` and `hooks` under `resources`. Task 5's `extraResources` puts `tray/` and `hooks/` in the packaged app's `resources/` directory, which is `process.resourcesPath`.

Why: an asar is read-only and Node's read calls see through it, but `nativeImage.createFromPath` loads the tray icon as a file and the installer copies the hook scripts with `copyFile`. Rather than depend on which calls Electron patches, the two directories the app uses as files are placed beside the archive, and this function is the one place that knows.

- [ ] **Step 1: Write the failing test**

Replace `apps/desktop/src/paths.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { distPaths } from "./paths";

describe("distPaths", () => {
  it("in development, finds everything beside the bundle", () => {
    const dir = "C:\\repo\\apps\\desktop\\dist";
    expect(distPaths(dir, dir)).toEqual({
      renderer: "C:\\repo\\apps\\desktop\\dist\\renderer",
      settings: "C:\\repo\\apps\\desktop\\dist\\settings",
      tray: "C:\\repo\\apps\\desktop\\dist\\tray",
      hooks: "C:\\repo\\apps\\desktop\\dist\\hooks",
    });
  });

  it("packaged, keeps the pages in the archive and looks for the icons and the scripts beside it", () => {
    expect(distPaths("C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist", "C:\\Apps\\Clawd Visualiser\\resources")).toEqual({
      renderer: "C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist\\renderer",
      settings: "C:\\Apps\\Clawd Visualiser\\resources\\app.asar\\dist\\settings",
      tray: "C:\\Apps\\Clawd Visualiser\\resources\\tray",
      hooks: "C:\\Apps\\Clawd Visualiser\\resources\\hooks",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/paths.test.ts`
Expected: FAIL. `distPaths` takes one argument and puts `tray` and `hooks` under `dir`.

- [ ] **Step 3: Write the implementation and wire it**

Replace `apps/desktop/src/paths.ts` with:

```ts
// What sits beside the bundle, and what sits beside the archive. esbuild writes dist/main.cjs and
// build/bundle.mjs fills four directories next to it. Packaged, main.cjs and the two pages travel
// inside app.asar, which Node's read calls see through; the tray icons and the hook scripts are used
// as files (an image loaded by path, scripts copied into the user's home), so the packager puts them
// beside the archive in the resources directory, and main passes that directory in.
import { join } from "node:path";

export type DistPaths = { renderer: string; tray: string; settings: string; hooks: string };

/**
 * `dir` is the bundle's directory. `resources` is where the icons and the scripts are: the same
 * directory in development, `process.resourcesPath` when packaged.
 */
export function distPaths(dir: string, resources: string): DistPaths {
  return { renderer: join(dir, "renderer"), settings: join(dir, "settings"), tray: join(resources, "tray"), hooks: join(resources, "hooks") };
}
```

In `apps/desktop/src/main.ts`, change `const dist = distPaths(__dirname);` to:

```ts
  // Packaged, the bundle and the pages are inside resources/app.asar and the icons and scripts beside it.
  const dist = distPaths(__dirname, app.isPackaged ? process.resourcesPath : __dirname);
```

In the same file, add `trayTooltip` to the import from `./tray` (`import { trayIconFile, trayMenuTemplate, trayTooltip } from "./tray";`) and in `refreshTray` change `tray.setToolTip(statusText(state));` to `tray.setToolTip(trayTooltip(state, app.getVersion()));`. `statusText` stays imported for the window title.

- [ ] **Step 4: Run the tests and the type check**

Run: `cd apps/desktop && npx vitest run src/paths.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/paths.ts apps/desktop/src/paths.test.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): the tray icons and the hook scripts are looked for beside the archive when packaged, and the tooltip carries the version"
```

---

### Task 3: Development stays out of the packaged app's way

**Files:**
- Modify: `apps/desktop/src/login.ts`
- Modify: `apps/desktop/src/hooks.ts`
- Modify: `apps/desktop/src/args.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: `apps/desktop/src/login.test.ts`, `apps/desktop/src/hooks.test.ts`, `apps/desktop/src/args.test.ts`

**Interfaces:**
- Produces: `appUserModelId(packaged: boolean): string` (`APP_ID` packaged, `${APP_ID}.dev` otherwise); `loginOnLaunch` returns `"none"` whenever `packaged` is false; `repairOnLaunch(status: HookStatus, packaged: boolean): boolean`; `resolveRendererUrl(args: Args, env, packaged: boolean): string` returning `APP_URL` whenever packaged.

Why: the design's §12.1 records that a development run and the packaged app share one login item and overwrite each other's Run entry, and that this blocks stage 6's "done when". The 17 September review found the same shape for the hooks: the launch repair rewrites `~/.claude/settings.json` on every development launch, because the CLI's install and each checkout's `electron.exe` all count as "stale" against the running binary; the maintainer's Claude folder already holds two backups from it. The rule this task sets: a development run keeps its own Run value under its own name and never remembers the choice, never enables or re-applies at launch, never rewrites hooks unattended (the settings window still shows `stale` and offers Reinstall), and a packaged app loads only the export. The packaged app still repairs anything of ours that differs, which is what a teammate's machine needs after moving the folder.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/login.test.ts`, change the import to `import { APP_ID, appUserModelId, loginItemTarget, loginOnLaunch } from "./login";` and add after the `APP_ID` describe:

```ts
describe("appUserModelId", () => {
  it("names the packaged app's Run entry after the id, and a development run's after its own name", () => {
    expect(appUserModelId(true)).toBe("io.github.mwardill.clawd-visualiser");
    expect(appUserModelId(false)).toBe("io.github.mwardill.clawd-visualiser.dev");
  });
});
```

In the `loginOnLaunch` describe, replace the second test with:

```ts
  it("writes the entry again when the user wants it and Windows has none for this path, packaged only", () => {
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: false })).toBe("reapply");
    expect(loginOnLaunch({ packaged: false, remembered: true, registered: false })).toBe("none");
  });
```

In `apps/desktop/src/hooks.test.ts`, replace the `repairOnLaunch` describe with:

```ts
describe("repairOnLaunch", () => {
  it("rewrites only hooks of ours that point somewhere else, and only from the packaged app", () => {
    expect(repairOnLaunch("stale", true)).toBe(true);
    expect(repairOnLaunch("current", true)).toBe(false);
    expect(repairOnLaunch("missing", true)).toBe(false);
    expect(repairOnLaunch("stale", false)).toBe(false);
  });
});
```

In `apps/desktop/src/args.test.ts`, replace the `resolveRendererUrl` describe with:

```ts
describe("resolveRendererUrl", () => {
  it("in development, prefers the flag, then the environment, then the static export over app://clawd/", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" }, false)).toBe("http://a");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "http://b" }, false)).toBe("http://b");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "  " }, false)).toBe("app://clawd/");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, {}, false)).toBe("app://clawd/");
  });

  it("packaged, loads the export whatever the flag or the environment says", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" }, true)).toBe("app://clawd/");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/login.test.ts src/hooks.test.ts src/args.test.ts`
Expected: FAIL. `appUserModelId` is not exported; `loginOnLaunch` returns `reapply` for a development run; `repairOnLaunch` and `resolveRendererUrl` ignore their new argument.

- [ ] **Step 3: Write the implementations**

In `apps/desktop/src/login.ts`, after `APP_ID`, add:

```ts
/**
 * The name of the Run key entry, which is the AppUserModelId main sets. The packaged app uses the id;
 * a development run uses its own name, so the two never read or overwrite each other's entry.
 */
export function appUserModelId(packaged: boolean): string {
  return packaged ? APP_ID : `${APP_ID}.dev`;
}
```

Replace the `loginOnLaunch` function and its comment with:

```ts
/**
 * What the login item needs at launch, packaged only: a development run never touches the entry at
 * launch, since its toggle is a testing convenience and the packaged app owns the real choice.
 * `remembered` is desktop.json's openAtLogin, absent until the first packaged run or a packaged toggle;
 * `registered` is whether Windows has an entry for this exe and these arguments. The first packaged
 * run turns it on. After that, an entry the user wants but Windows lacks for this path, as after the
 * folder moved, is written again. An entry Windows already has, and a choice of off, are left alone.
 */
export function loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean }): LoginOnLaunch {
  if (!s.packaged) return "none";
  if (s.remembered === undefined) return "enableFirstRun";
  if (s.remembered && !s.registered) return "reapply";
  return "none";
}
```

In `apps/desktop/src/hooks.ts`, replace `repairOnLaunch` and its comment with:

```ts
/**
 * Only our own hooks pointing elsewhere are rewritten, and only by the packaged app: on the
 * maintainer's machine the hooks may belong to the CLI's install or to another checkout, and a
 * development launch rewriting them unattended would flip them on every run and leave a backup each
 * time. A development run still shows `stale` in the settings window, where Reinstall is a choice.
 * Missing hooks wait for the settings window either way.
 */
export function repairOnLaunch(status: HookStatus, packaged: boolean): boolean {
  return packaged && status === "stale";
}
```

In `apps/desktop/src/args.ts`, replace `resolveRendererUrl` and its comment with:

```ts
/**
 * Where the window loads from: packaged, always the static export over app://clawd/, so no flag or
 * environment variable can point a teammate's app elsewhere; in development the flag, else the
 * environment, else the export.
 */
export function resolveRendererUrl(args: Args, env: Readonly<Record<string, string | undefined>>, packaged: boolean): string {
  if (packaged) return APP_URL;
  const fromEnv = env.CLAWD_DESKTOP_URL?.trim();
  return args.devUrl ?? (fromEnv ? fromEnv : APP_URL);
}
```

In `apps/desktop/src/main.ts`:

1. Change the import `import { APP_ID, loginItemTarget, loginOnLaunch } from "./login";` to `import { appUserModelId, loginItemTarget, loginOnLaunch } from "./login";`.
2. Change `const url = resolveRendererUrl(args, process.env);` to `const url = resolveRendererUrl(args, process.env, app.isPackaged);`.
3. Replace the two lines that set the id (the comment beginning `// The id names the login item's Run key entry` and `app.setAppUserModelId(APP_ID);`) with:

```ts
  // The id names the login item's Run key entry and groups the app in the taskbar. electron-builder
  // sets the same id in the packaged app; a development run gets its own, so the two never share an entry.
  app.setAppUserModelId(appUserModelId(app.isPackaged));
```

4. In `setOpenAtLogin`, change `store.update({ openAtLogin: on });` to:

```ts
    // Only the packaged app's choice is remembered; a development toggle is a testing convenience.
    if (app.isPackaged) store.update({ openAtLogin: on });
```

5. Change `if (repairOnLaunch(status)) {` to `if (repairOnLaunch(status, app.isPackaged)) {`, and the comment above it to `// Our hooks pointing at another folder are rewritten by the packaged app, so a moved app keeps receiving events.`

- [ ] **Step 4: Run the tests and the type check**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS across the package, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/login.ts apps/desktop/src/login.test.ts apps/desktop/src/hooks.ts apps/desktop/src/hooks.test.ts apps/desktop/src/args.ts apps/desktop/src/args.test.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): a development run keeps its own login item, never rewrites hooks unattended, and a packaged app ignores dev URLs"
```

---

### Task 4: Two settings actions from the stage 5 review

**Files:**
- Modify: `apps/agent/src/log.ts`
- Modify: `apps/desktop/src/main.ts` (the `addFolder` and `setDetail` actions)

**Interfaces:**
- Produces: `desktop.detailFailed` in `LogCode`.

Why: the review found that `setDetail` is the one action outside the try/catch-and-log pattern the comment above the actions promises, so a failed detail save is swallowed with no log line; and that the folder picker opens with no parent window, so it is not modal to the settings window and a second click during it opens a second picker. Passing the window makes the picker modal. The page's own busy guard, which a state push can drop, is recorded in §12.1 for the hardening pass.

- [ ] **Step 1: Add the log code**

In `apps/agent/src/log.ts`, after `| "desktop.folderFailed"`, add `| "desktop.detailFailed"`.

- [ ] **Step 2: Fix the two actions**

In `apps/desktop/src/main.ts`, add `type OpenDialogOptions` to the `electron` import (`import { Menu, Tray, app, dialog, ipcMain, nativeImage, protocol, screen, shell, type BrowserWindow, type NativeImage, type OpenDialogOptions } from "electron";`).

In the `addFolder` action, replace the line `const picked = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Watch a folder" });` with:

```ts
              // The picker belongs to the settings window, so it is modal to it and a second click cannot open another.
              const options: OpenDialogOptions = { properties: ["openDirectory"], title: "Watch a folder" };
              const parent = settingsWin !== null && !settingsWin.isDestroyed() ? settingsWin : null;
              const picked = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
```

Replace the `setDetail` action with:

```ts
          async setDetail(level) {
            try {
              await setDetail({ home, level, print: () => {} });
              host.restart();
            } catch {
              log("desktop.detailFailed");
            }
            return await currentState();
          },
```

- [ ] **Step 3: Type check and run the agent's log test**

Run: `cd apps/desktop && pnpm typecheck && cd ../agent && npx vitest run src/log.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/log.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): the folder picker belongs to the settings window, and a failed detail save is logged like the other writes"
```

---

### Task 5: The package

**Files:**
- Modify: `apps/desktop/package.json` (electron-builder, the `package` and `smoke` scripts)
- Create: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/build/renderer.mjs`
- Create: `apps/desktop/build/smoke-packaged.mjs`
- Modify: `.gitignore` (root)

**Interfaces:**
- Consumes: `dist/` from `build/bundle.mjs` and `build/renderer.mjs`; `resources/icon.ico` from Task 1; the `tray` and `hooks` locations from Task 2.
- Produces: `release/win-unpacked/Clawd Visualiser.exe` and `release/Clawd-Visualiser-<version>-win-x64.zip`; `pnpm --filter @clawd/desktop package` and `pnpm --filter @clawd/desktop smoke`.

- [ ] **Step 1: Add electron-builder**

Run from the repository root: `pnpm --filter @clawd/desktop add -D electron-builder@^26.15.3`
Expected: `apps/desktop/package.json` gains `"electron-builder": "^26.15.3"` under `devDependencies` and the lockfile updates. If pnpm prints `Ignored build scripts:` naming any package, add each name under `allowBuilds` in `pnpm-workspace.yaml` with a one-line comment saying what it builds, and run `pnpm install` again.

Run: `cd apps/desktop && npx electron-builder --version`
Expected: `26.15.3` or later in the 26 line.

- [ ] **Step 2: Write the packager's configuration**

Create `apps/desktop/electron-builder.yml`:

```yaml
# electron-builder: the unpacked folder teammates get, and that folder zipped. No installer, no
# updater, no signing (design §11). Run through `pnpm --filter @clawd/desktop package`.
appId: io.github.mwardill.clawd-visualiser
productName: Clawd Visualiser
directories:
  # Not the default `dist`, which is the bundle's own directory.
  output: release
  buildResources: resources
# Only the bundle's output goes into the archive; the package has no runtime dependencies. The
# source maps stay out: the app logs codes, never stack traces, so nothing reads them.
files:
  - dist/**
  - "!dist/tray/**"
  - "!dist/hooks/**"
  - "!dist/**/*.map"
# The tray icons and the hook scripts are used as files, so they live beside the archive, where
# paths.ts looks for them under process.resourcesPath.
extraResources:
  - from: dist/tray
    to: tray
  - from: dist/hooks
    to: hooks
asar: true
# No native modules and no dependencies to rebuild.
npmRebuild: false
# Fuses are switches baked into the binary. runAsNode stays on because every installed hook runs
# the exe as Node; the other two close doors the app never uses.
electronFuses:
  runAsNode: true
  enableCookieEncryption: true
  onlyLoadAppFromAsar: true
win:
  target:
    - dir
    - zip
  icon: resources/icon.ico
  artifactName: Clawd-Visualiser-${version}-win-${arch}.${ext}
```

In `apps/desktop/package.json`, add to `scripts`:

```json
    "package": "node build/renderer.mjs && node build/bundle.mjs && electron-builder --win",
    "smoke": "node build/smoke-packaged.mjs",
```

In the root `.gitignore`, after the `dist/` line, add:

```
release/
```

- [ ] **Step 3: Make the export build fail loudly and never package a stale export**

In `apps/desktop/build/renderer.mjs`, replace the two lines

```js
const result = spawnSync(process.execPath, [nextBin, "build"], { cwd: webDir, env: { ...process.env, CLAWD_TARGET: "desktop" }, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);
```

with:

```js
// A stale export would pass the check below, so the previous one goes first.
await rm(exportDir, { recursive: true, force: true });
const result = spawnSync(process.execPath, [nextBin, "build"], { cwd: webDir, env: { ...process.env, CLAWD_TARGET: "desktop" }, stdio: "inherit" });
if (result.error) {
  console.error(`renderer: could not start the Next build: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
```

`rm` is already imported in that file.

- [ ] **Step 4: Package, and look at what came out**

Run from the repository root, in a shell where `ELECTRON_RUN_AS_NODE` is not set: `pnpm --filter @clawd/desktop package`
Expected: the Next export builds, esbuild writes the bundle, and electron-builder prints `packaging platform=win32 arch=x64 electron=44.3.0 appOutDir=release\win-unpacked`, then `building target=zip`. It downloads Electron 44.3.0 once into its cache the first time. A warning that `author` is missing from `package.json` is fine for the `dir` and `zip` targets.

Run from `apps/desktop`:

```
ls release; ls "release/win-unpacked"; ls "release/win-unpacked/resources"; ls "release/win-unpacked/resources/tray" "release/win-unpacked/resources/hooks"
```

Expected: `release/Clawd-Visualiser-0.1.0-win-x64.zip` and `release/win-unpacked/`; the unpacked folder holds `Clawd Visualiser.exe` and Electron's files; `resources/` holds `app.asar`, `tray/` and `hooks/`; `tray/` holds `tray.ico` and `tray-waiting.ico`; `hooks/` holds `clawd-hook.mjs`, `clawd-lib.mjs` and `clawd-statusline.mjs`. There is no `app.asar.unpacked`.

Run from `apps/desktop`: `pnpm dlx @electron/fuses read --app "release/win-unpacked/Clawd Visualiser.exe"`
Expected: a list in which `RunAsNode is Enabled`, `EnableCookieEncryption is Enabled` and `OnlyLoadAppFromAsar is Enabled`. If `dlx` cannot fetch the package, the smoke script's first line covers `runAsNode`, and the app starting at all covers `onlyLoadAppFromAsar`.

- [ ] **Step 5: Write the smoke script and run it**

Create `apps/desktop/build/smoke-packaged.mjs`:

```js
// Runs the packaged app once, hidden, against scratch folders: the exe must run as plain Node (the
// hooks depend on it), the app must start as packaged, and its agent must answer the health check
// from the visualiser's origin. Then the process is stopped by its own id. Nothing under the real
// ~/.clawd or ~/.claude is touched. pnpm --filter @clawd/desktop smoke
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exe = fileURLToPath(new URL("../release/win-unpacked/Clawd Visualiser.exe", import.meta.url));
const home = await mkdtemp(join(tmpdir(), "clawd-smoke-home-"));
const claudeDir = await mkdtemp(join(tmpdir(), "clawd-smoke-claude-"));
const env = { ...process.env, CLAWD_HOME: home, CLAUDE_CONFIG_DIR: claudeDir };
delete env.ELECTRON_RUN_AS_NODE;

const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `read` gives something other than null, undefined or false. */
async function waitFor(what, read, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await read().catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    await sleep(250);
  }
  throw new Error(`gave up waiting for ${what} after ${timeoutMs} ms; is another copy of the app running, or its port held?`);
}

async function newestLog() {
  const dir = join(home, "logs");
  const names = (await readdir(dir)).filter((name) => name.startsWith("desktop-")).sort();
  const name = names.at(-1);
  return name === undefined ? "" : readFile(join(dir, name), "utf8");
}

const before = Date.now();
const asNode = spawnSync(exe, ["-e", "process.exit(0)"], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 10_000 });
if (asNode.status !== 0) fail(`the exe did not run as Node (exit ${asNode.status}); is the runAsNode fuse on?`);
else console.log(`smoke: the exe ran as Node and exited in ${Date.now() - before} ms`);

const app = spawn(exe, ["--hidden"], { env, stdio: "ignore" });
try {
  await waitFor("desktop.started in the log", async () => (await newestLog()).includes('"code":"desktop.started","packaged":true'), 20_000);
  console.log("smoke: the app started, and knows it is packaged");
  const port = await waitFor("config.json", async () => JSON.parse(await readFile(join(home, "config.json"), "utf8")).port, 10_000);
  const health = await waitFor(`health on port ${port}`, async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { origin: "app://clawd" } });
    return res.ok ? res.json() : null;
  }, 10_000);
  console.log(`smoke: the agent on port ${port} answers ${JSON.stringify(health)} to the visualiser's origin`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  // The app's own process id, nothing else. No quit sequence: the scratch home is about to go.
  app.kill();
  await sleep(1_000);
  await rm(home, { recursive: true, force: true });
  await rm(claudeDir, { recursive: true, force: true });
}
```

Run from the repository root, with no other copy of the app running: `pnpm --filter @clawd/desktop smoke`
Expected:

```
smoke: the exe ran as Node and exited in <n> ms
smoke: the app started, and knows it is packaged
smoke: the agent on port 4750 answers {"ok":true,...} to the visualiser's origin
```

with exit code 0. Record `<n>`: it is the packaged binary's Node start-up cost, which the design's §8 estimated at about 100 ms. If a CLI agent holds port 4750 the app attaches to it and the third line still appears, since the health answer comes from that agent.

- [ ] **Step 6: Run every check and commit**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace, including the icon check.

```bash
git add apps/desktop/package.json pnpm-lock.yaml pnpm-workspace.yaml apps/desktop/electron-builder.yml apps/desktop/build/renderer.mjs apps/desktop/build/smoke-packaged.mjs .gitignore
git commit -m "feat(desktop): electron-builder packages the app as an unpacked folder and a zip, with the fuses set and the icons, scripts and export in place"
```

(`pnpm-workspace.yaml` only if Step 1 changed it.)

---

### Task 6: The documents, the checklist, and the hand-off

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-desktop-app-design.md`
- Modify: `apps/desktop/README.md`
- Modify: `README.md`
- Modify: `docs/PRD.md`
- Modify: `apps/agent/README.md`

- [ ] **Step 1: The design records the decisions**

In `docs/superpowers/specs/2026-09-14-desktop-app-design.md`:

1. In §3's layout block, replace the line `  electron-builder.yml` with `  electron-builder.yml    dir and zip targets, asar, fuses, extraResources for the icons and the scripts`, and the `icons.mjs` line with `    icons.mjs             renders the canonical Clawd matrix to ICO files, dependency-free; --check compares them`. After the `icons.mjs` line, add:

```
    renderer.mjs          the Next static export, copied to dist/renderer
    smoke-packaged.mjs    runs the packaged app once against scratch folders
```

Replace `  resources/              generated icons, checked in` with `  resources/              the tray ICOs and the app icon, generated and checked in` and `  dist/                   build output, ignored` with `  dist/                   build output, ignored; release/ is the packager's, also ignored`.

2. In §7, after the sentence ending `and \`start\` loads the export (changed in the stage 3 plan, so the export runs before packaging).`, add: `Packaged, both the flag and the variable are ignored and the export is loaded, so nothing in a teammate's environment can point the app elsewhere (stage 6).`

3. In §8, in the bullet beginning `On launch, \`hooks.ts\` reads the settings file.`, after `logged as \`desktop.hooksRepaired\`.`, add: `Only the packaged app rewrites unattended: on the maintainer's machine the hooks may belong to the CLI's install or to another checkout, and a development launch would otherwise flip them on every run and leave a backup each time. A development run still shows \`stale\` in the settings window, where Reinstall is a choice (stage 6).`

4. In §10, replace the tray icon bullet's first sentence, `Tray icon: the canonical Clawd at 16 and 32 px, rendered from the matrix by \`build/icons.mjs\`, plus a variant with an amber dot for waiting above zero.`, with: `Tray icon: the canonical Clawd rendered from the matrix by \`build/icons.mjs\` into an ICO holding 16, 20, 24 and 32 px images, so Windows picks a crisp one at 100, 125, 150 and 200% scaling, plus a variant with an amber dot for waiting above zero. The app's own icon is an ICO up to 256 px from the same sprite. \`pnpm test\` fails if a checked-in icon no longer matches the sprite.` In the login item bullet, after `so the registered path follows a moved folder.`, add: `In development the Run value has its own name (\`<appId>.dev\`), the toggle is not remembered in \`desktop.json\`, and nothing is enabled or re-applied at launch, so a development run cannot disturb the packaged app's entry (stage 6).`

5. In §11, replace the first bullet with:

```markdown
- electron-builder, configured in `electron-builder.yml`: `appId: io.github.mwardill.clawd-visualiser`,
  `productName: Clawd Visualiser`, `win.target: ["dir", "zip"]`, output in `release/` (its default,
  `dist`, is the bundle's directory), asar on, `npmRebuild: false`, fuses `runAsNode: true`,
  `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true`. The archive holds `dist/main.cjs`,
  `dist/renderer/` and `dist/settings/`, without source maps; the tray icons and the hook scripts go
  beside it through `extraResources`, under `resources/tray/` and `resources/hooks/`, because the tray
  loads its icon by path and the installer copies the scripts as files, and an asar is read-only and
  transparent only to Node's read calls. `paths.ts` finds them under `process.resourcesPath`. The
  artifact is `Clawd-Visualiser-<version>-win-x64.zip`, holding the unpacked folder's files; Windows'
  Extract All puts them in a folder named after the zip.
```

Replace the `pnpm --filter @clawd/desktop package` bullet with: `- \`pnpm --filter @clawd/desktop package\` runs the export, the bundle (§3) and electron-builder. \`pnpm --filter @clawd/desktop smoke\` runs the packaged app once against scratch folders: the exe as Node, the packaged start, the agent's health from the visualiser's origin. The zip is shared by hand or attached to a GitHub release by the maintainer; nothing is automated.`

Replace the Version bullet with: `- Version: \`apps/desktop/package.json\`, shown in the settings window and after the status in the tray tooltip.`

- [ ] **Step 2: The design records what stage 6 closed and what the stage 5 review left**

In §12.1, append a sentence to each of these items:

- `The export build.`: append ` Done in stage 6: the previous export is removed first and a spawn failure is printed.`
- `Dev URLs in a packaged app.`: append ` Done in stage 6: both are ignored when packaged.`
- `Development and packaged builds share one login item.`: append ` Done in stage 6: a development run has its own value name, its toggle is not remembered, and nothing is applied at launch unless packaged.`
- `Tray icon scaling.`: append ` Done in stage 6: ICOs at 16, 20, 24 and 32 px, and \`pnpm test\` checks the files against the sprite.`

Then, before the paragraph beginning `Asked for while stage 5 was finishing`, insert:

```markdown
Found in the overall review of the desktop app at stage 5 (17 September 2026). Three were taken into
stage 6: the launch repair no longer runs unattended in development, the folder picker belongs to the
settings window, and the detail setter is caught and logged. The rest wait for the hardening pass.

- **Attached mode applies nothing.** `addFolder`, `removeFolder` and `setDetail` save the config and
  call `host.restart()`, but while the host is attached to another process's agent `release()` is a
  no-op and `attempt()` re-attaches, so the other agent keeps its allowlist and detail level while the
  page lists the change as applied, with no log code. Detect attached in the actions, log a code, and
  carry a notice into the state when the bridge next changes.
- **An unreadable config or settings file reads as "not installed".** `hookOptions()` maps a
  `ConfigError` to null, and `currentHookStatus()` maps that, an invalid-JSON settings file, or a
  settings file that is a JSON array (cast without `isJsonObject`) to `missing`. The page then hides
  Remove, the launch repair is skipped, and the offered Install fails silently. Add an `unreadable`
  status and use `isJsonObject` on the read.
- **`install()` saves the config before the hooks can still fail.** The allowlist and port are written
  through `setAllowlist()` before `installHooks()` copies the scripts and re-reads the settings file;
  a copy failure, or a settings file rewritten between the dry-run check and the real read, leaves
  the config changed while "nothing was changed" is printed, and a config change between the two reads
  can save the empty allowlist the pre-check meant to forbid. Save the config once inside
  `installHooks` after the copy, passing the merged allowlist in; that also removes the four config
  reads per install, the second merge, the unreachable guard after `setAllowlist`, and the unread
  `HooksResult.allowlist` field.
- **An install from the app can mint a token the serving agent lacks.** With no config in the app's
  home the installer falls back to a default config with a fresh token, and the agent is not
  restarted; attached to an agent running from a different home, the written hooks carry a token that
  agent refuses while the page says installed. Refuse or warn when installing hooks without owning the
  agent, and never create a config from the settings window.
- **The settings page rebuilds itself on every push.** `render()` replaces every node when the text
  differs, which is what drops the button's `aria-busy` guard (a second Add folder during the picker,
  now modal but still a second request once it closes), resets an in-flight radio for the moment
  between a coalesced push and the answer, wipes a text selection, and swallows a click split across
  old and new nodes. Patch counters and `checked` in place and rebuild only the folder list, with the
  page test harness this list already calls for.
- **Every state build reads the config twice.** `currentState()` reads and parses `config.json`, then
  `currentHookStatus()` reads it again before the settings file, in series; at startup the fallback
  build is followed by a second `currentHookStatus()` for the launch repair. Read once and pass the
  config into a `hookStatusFor(config)`, and reuse the startup state's `hooks` for the repair.
- **The login toggle from the page builds the state twice.** `setOpenAtLogin()` ends with
  `pushState()`, and the IPC action then returns a second `currentState()`; the page renders both.
  Split apply from push.
- **The bridge is typed by hand in three places.** `Api` in the page, `SettingsActions` in the
  handlers and an untyped literal in the preload, with nothing linking them; the unions copied into
  `settings/state.ts` are checked one way only. One `SettingsApi` in the import-free `settings/state.ts`,
  `satisfies` on the preload literal, and `Omit` for the actions.
- **Two copies of the window hardening and of show-or-create.** `createSettingsWindow` repeats
  `createMainWindow`'s options and guards, and `showWindow` and `showSettings` already diverge
  (`showSettings` has no quitting guard and no `restore()`). One hardened-window factory and one
  show-or-create helper.
- **The desktop calls the CLI-shaped uninstall with a no-op printer.** `uninstall()` returns 0 for
  three outcomes and reports refusals only through `print`, so the desktop cannot tell removed from
  nothing-to-remove or log which refusal happened. Split it the way install was: a result-returning
  core with the CLI's printing on top, and the same for `setDetail`.
- **Two host tables in `scheme.ts`.** Host to directory and host to policy are two ternaries, the URL
  is parsed twice per request, and `settingsPolicy()` rebuilds a constant. One per-host table
  consulted once, which is also where the "handler that can reject" item above belongs.
- **The detail default duplicates `detailLevel()`.** `currentState` writes `config?.detail ?? "none"`
  while the agent uses `detailLevel()`, which the agent package does not export. Export it and call it.
```

- [ ] **Step 3: The desktop README**

In `apps/desktop/README.md`, after the Run section's last paragraph (the one ending `A change under \`src/\` needs the command run again.`) and its test/typecheck block, add before `## Stage notes`:

````markdown
## Package

```
pnpm --filter @clawd/desktop package
```

builds the export, bundles main and runs electron-builder: `release/win-unpacked/` is the folder
teammates get, and `release/Clawd-Visualiser-<version>-win-x64.zip` is that folder zipped. Unzip it
anywhere, a folder under your user profile is best since the hooks will point at it, and run
`Clawd Visualiser.exe`. `pnpm --filter @clawd/desktop smoke` starts the packaged app once against
scratch folders and checks that the exe runs as Node, that the app starts as packaged and that its
agent answers. `pnpm --filter @clawd/desktop icons` redraws the tray and app icons from the sprite;
`pnpm test` fails if the checked-in files no longer match it.

A development run and the packaged app stay out of each other's way: the development login item has
its own name and is never remembered, a development launch never rewrites the hooks unattended (the
settings window shows `stale` and offers Reinstall), and the packaged app ignores `--dev-url` and
`CLAWD_DESKTOP_URL`.
````

Append after the Stage 5 note:

```markdown
### Stage 6: the package

Until now the app was a repository: `electron .` on a folder of source, with the repository's own
`electron.exe`. Packaging makes it a folder a teammate can run with nothing installed.

**What electron-builder does.** It copies Electron's binary and its support files into
`release/win-unpacked/`, renames the exe to `Clawd Visualiser.exe`, stamps the icon and the version
into it, and puts the app's own files, `dist/main.cjs` and the two pages, into one archive,
`resources/app.asar`. The `zip` target then zips that folder. There is no installer and no updater:
the folder is the install, and a new version is unzipped over it.

**asar.** The archive is a read-only bundle of files with an index. Node inside Electron reads it as
if it were a directory: `require`, `readFile` and `readdir` see through it, which is how the scheme
handler serves the export and the settings page from inside it. Anything that uses a file as a file
does not: the tray loads its icon by path, and the installer copies the hook scripts into `~/.clawd/bin`.
Those two directories go beside the archive with `extraResources`, and `paths.ts` finds them under
`process.resourcesPath` when packaged. The `onlyLoadAppFromAsar` fuse means the app's code can come
only from the archive, never from a loose `resources/app` folder someone drops beside it.

**Fuses.** Switches baked into the binary itself, flipped by the packager after the copy.
`runAsNode` stays on: every installed hook runs this exe with `ELECTRON_RUN_AS_NODE=1`, and turning
it off would break them all. `enableCookieEncryption` and `onlyLoadAppFromAsar` close doors the app
never uses. `pnpm dlx @electron/fuses read --app <exe>` shows what is set.

**`process.execPath` in a packaged app.** In development it was the repository's `electron.exe`; now
it is `Clawd Visualiser.exe` wherever the folder was unzipped. The hook commands and the login item
are written from it, and at each launch the packaged app compares them with what it would write now:
after the folder moves, both are repaired. A development run no longer does this unattended, since on
the maintainer's machine the hooks may belong to the CLI or to another checkout.

**Icons.** Windows resamples a PNG at 125% and 150% scaling and blurs the pixel art, so the tray
icons are ICO files holding 16, 20, 24 and 32 px images and Windows picks the matching one; the app
icon is an ICO up to 256 px, which the packager needs. Both are drawn from the canonical sprite by
`build/icons.mjs` with nothing but `node:zlib`, and `pnpm test` fails if a checked-in file no longer
matches the sprite.

**SmartScreen.** The exe is unsigned, so Windows warns once for an exe extracted from a downloaded
zip: More info, then Run anyway. A certificate is the fix, not a code change (design §11).

What stage 6 leaves in place: the whole design. What the stage reviews deferred is listed in the
design's §12.1 for the hardening pass.
```

- [ ] **Step 4: The root README, the PRD and the agent README**

In the root `README.md`, replace the Status section's paragraph with:

```markdown
The contract (`packages/core`), the web app (the panes scene, the simulated and live feeds, the
detail ticker), the local agent and the desktop app are built. The desktop app ships as a zipped
folder; see Run below. The product requirements are in [docs/PRD.md](docs/PRD.md), and the measured
facts about Claude Code's hooks that the design rests on are in [docs/spike-hooks.md](docs/spike-hooks.md).
```

Before `## Layout`, add:

```markdown
## Run

Download `Clawd-Visualiser-<version>-win-x64.zip`, unzip it anywhere (a folder under your user
profile is best, since the hooks will point at it), and run `Clawd Visualiser.exe`. The app sits in
the tray; open Settings from its menu to watch your repositories and install Claude Code's hooks.
Nothing else is installed, and the app runs from wherever it was unzipped. To update, quit, unzip the
new version over the folder and launch. Details in [apps/desktop/README.md](apps/desktop/README.md).
```

In the layout table, replace the `apps/desktop` row with:

```markdown
| `apps/desktop` | The Electron app: the agent and the visualiser in one window and the tray, with a settings window that installs the hooks under the app's own binary, packaged as a zipped folder. See its README. |
```

In `docs/PRD.md`:

1. In §6, after item 3 (`**Web app** (Next.js). ...`), add:

```markdown
4. **Desktop app** (Electron). The agent and the web app's static export in one process, run from an unzipped folder: the agent in the main process, the visualiser in a sandboxed window over a custom scheme, a tray icon, and a settings window that watches folders and installs the hooks under the app's own binary. See `docs/superpowers/specs/2026-09-14-desktop-app-design.md`.
```

2. In §11, after the `- **Deployment.**` bullet, add:

```markdown
- **Desktop deployment.** `apps/desktop` packages the agent and the web app's export into one folder, zipped, with electron-builder: `Clawd-Visualiser-<version>-win-x64.zip`. Unzipped and run; no installer, no updater, no signing. The hooks run under the app's own binary with `ELECTRON_RUN_AS_NODE=1`, so teammates need no Node install.
```

3. In §12, after the `M7` row's table, add:

```markdown
**Desktop**

| # | Milestone | Outcome |
|---|---|---|
| M8 | Desktop | The Electron app in six stages, one Electron idea each: the window, the agent inside, the packaged UI over `app://`, the tray, the settings window, the package. Done when a teammate unzips the folder, runs the exe and sets up the hooks from the settings window, and moving the folder and relaunching repairs the hooks and the login item. |
```

4. In §16, append:

```markdown
| 14 Sep 2026 | Desktop app: the agent runs in Electron's main process; the UI is the static export over a custom scheme; the hooks run under the app's own binary; shipped as a zipped folder with no installer, electron-builder's `portable` target ruled out. |
```

In `apps/agent/README.md`, in the Run section after `run install again so the hook commands point at it.`, add:

```markdown
The desktop app installs the same hooks with a different command prefix, `ELECTRON_RUN_AS_NODE=1
"<its exe>"` in place of Node's path, so teammates need no Node install. Either install overwrites
the other's commands; the last one run wins, and the packaged app rewrites ours at launch if they
point elsewhere.
```

- [ ] **Step 5: Run every check and commit the documents**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md apps/desktop/README.md README.md docs/PRD.md apps/agent/README.md
git commit -m "docs: the design, the READMEs and the PRD record the package, what stage 6 closed, and what the stage 5 review left"
```

- [ ] **Step 6: Walk the checklist (pause here for the maintainer)**

This is the design's §13 checklist for stage 6, plus the stage 4 item worth repeating once packaged. Use a second Windows account if one is available; otherwise a PowerShell with the two scratch variables set, which keeps the real `~/.clawd` and `~/.claude` untouched:

```
$env:CLAWD_HOME = "$env:TEMP\clawd-stage6"
$env:CLAUDE_CONFIG_DIR = "$env:TEMP\clawd-stage6-claude"
New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null
Expand-Archive apps\desktop\release\Clawd-Visualiser-0.1.0-win-x64.zip "$env:USERPROFILE\Apps\Clawd Visualiser"
& "$env:USERPROFILE\Apps\Clawd Visualiser\Clawd Visualiser.exe"
```

Stop any CLI agent and any development run of the app first. Check each:

- **First run.** SmartScreen warns once (More info, Run anyway). The tray icon appears with the Clawd, and its tooltip ends in `· v0.1.0`. The window opens on the scene. `Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` shows `io.github.mwardill.clawd-visualiser` naming the exe with `--hidden`: the first packaged run turned the login item on.
- **Set up from the app alone.** Settings: add a repository folder, install the hooks. `$env:CLAUDE_CONFIG_DIR\settings.json` holds commands beginning `ELECTRON_RUN_AS_NODE=1 "C:/Users/<you>/Apps/Clawd Visualiser/Clawd Visualiser.exe"`. Start a Claude Code session in that folder with the scratch Claude directory: its Clawd appears, and the status line renders. Time one hook under the packaged exe with `Measure-Command { "" | & "...\Clawd Visualiser.exe" "$env:CLAWD_HOME\bin\clawd-hook.mjs" }` with `$env:ELECTRON_RUN_AS_NODE = "1"` set for that command only; record the number.
- **Tray icon scaling.** Settings, Display, Scale at 125% and then 150%: the tray Clawd stays crisp, plain and with the waiting dot (leave a session waiting on a permission prompt to see it). Back to 100%.
- **Move the folder and relaunch.** Quit from the tray. Rename the folder to `Clawd Visualiser 2` and run the exe from there. The log (`$env:CLAWD_HOME\logs\desktop-<date>.log`) gains `desktop.hooksRepaired` and `desktop.loginItemReapplied`; the settings file's commands and the Run value both name the new place.
- **Sign out and in** with the login item on: the app returns with only the tray icon, and the agent is up (the tooltip counts sessions once one starts). Task Manager's Startup apps list shows Clawd Visualiser.
- **Remove the hooks** from Settings: the settings file is restored and a backup sits beside it.
- **Delete the folder** while a Claude Code session runs: the session carries on and no error dialog appears; the hooks fail quietly. Turn the login item off first from the tray, or remove the Run value by hand afterwards.
- **A development run afterwards**, from the repository with the real environment (`Remove-Item Env:CLAWD_HOME, Env:CLAUDE_CONFIG_DIR`): `pnpm --filter @clawd/desktop start` does not rewrite the hooks (no `desktop.hooksRepaired` in the log; the settings window says `stale` if the real settings file holds hooks from elsewhere), and the packaged app's Run value is untouched while the development toggle writes `io.github.mwardill.clawd-visualiser.dev`.
- Delete both scratch folders and the unzipped folders.

- [ ] **Step 7: Record the checks and hand the branch back**

In the design's §12.1, after the `Tray icon scaling` item, add a bullet in the form the earlier stages used:

```markdown
- **Stage 6's manual checks: done.** On <date> the maintainer unzipped and ran the package, set the
  hooks up from the settings window, saw the tray icon crisp at 125% and 150%, moved the folder and
  saw the hooks and the login item repaired, signed out and in with the login item on, removed the
  hooks, and deleted the folder with a session running. One hook under the packaged exe took <n> ms;
  the exe starts as Node in <m> ms.
```

with the real date and numbers, then:

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md
git commit -m "docs: stage 6's manual checks are done, with the hook timing under the packaged exe"
```

Then hand the branch back with the finishing-a-development-branch skill. The maintainer merges from `C:\mw\visualiser`, as the earlier stages were merged:

```bash
git merge --no-ff feat/desktop-stage-6 -m "Merge branch 'feat/desktop-stage-6' (desktop stage 6: the package)"
```

The post-dev hardening pass starts from `main` once this is merged, working through §12.1.
