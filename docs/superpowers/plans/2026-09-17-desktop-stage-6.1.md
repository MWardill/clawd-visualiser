# Desktop Stage 6.1 (The stage 6 review's fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the thirteen findings of the 17 September 2026 review of stage 6's merge: a development run's old login choice no longer decides the packaged app's first run, the smoke script runs in its own profile and cleans up reliably, the poller ends its child on stop, the icon check compares pixels after vitest, the build cleans once, the product name is written once, the tray is touched only on change, the dead 2× renderer goes, and the README's stage 4 note tells the truth.

**Architecture:** `desktop.json` moves to version 2 and development keeps `desktop-dev.json`. The poller's `Exec` gains an abort signal. `build/icons.mjs --check` decodes the checked-in ICOs and compares pixels; `build/clean.mjs` runs before every build; `electron-builder.yml` names the product in `extraMetadata` alone; the smoke script bundles the app's own helpers, spawns with `--user-data-dir`, watches for exit, fails on an attached agent, and removes its scratch folders with retries. `main.ts` caches the tray's tooltip and images.

**Tech Stack:** Electron 44, electron-builder 26, esbuild 0.28, vitest 5, TypeScript 5.9, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, §10, §11, and the thirteen findings of the 17 September 2026 review of stage 6's merge, which Task 6 records in §12.1. Stage 7 follows this stage and takes the hooks, the install and the bridge.

**Stage idea:** none new. This is the review's fixes, taken before stage 7 so that stage builds on a clean base.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere; a test may spell Windows paths.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first.
- The desktop package has no runtime dependencies. No dependency is added this stage.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- `desktop.json` is version 2. A version 1 file, which only development runs before stage 6 ever wrote, reads as nothing remembered. Development uses `desktop-dev.json`; the packaged app uses `desktop.json`. `loginOnLaunch` still acts only when packaged.
- The launch repair of the hooks stays as stage 6 left it: only the packaged app rewrites unattended. What `stale` means is stage 7's.
- Automated checks never run the packaged app against the real `~/.clawd` or `~/.claude`: the smoke script uses scratch folders and its own profile directory.
- Log lines carry a time, a code and numbers or booleans only. No new code this stage.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-6.1` in the worktree `C:\mw\visualiser-desktop`, cut from `main` (stage 6 is merged at `5aa85ee`; this plan is committed on `main` after it). That worktree has `feat/desktop-stage-6` checked out, which is merged: `git -C C:\mw\visualiser-desktop checkout -b feat/desktop-stage-6.1 main`. Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app or the packager.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/desktop-state.ts` | Version 2; `desktopStatePath(home, packaged)`. |
| `apps/agent/src/presence/poller.ts` | `Exec` takes a signal; `stop()` aborts the list command in flight. |
| `apps/desktop/src/icons.ts` | `renderTrayIcon` goes. |
| `apps/desktop/build/icons.mjs` | `--check` compares decoded pixels. |
| `apps/desktop/build/clean.mjs`, `bundle.mjs`, `package.json` | One clean step before every build; the three `rm` calls go; the icon check follows vitest. |
| `apps/desktop/electron-builder.yml` | The product name once. |
| `apps/desktop/src/main.ts` | The store's path; the tray's tooltip and images cached. |
| `apps/desktop/build/smoke-packaged.mjs` | Own profile directory, exit watch, bundled helpers, attached check, retrying cleanup. |
| `apps/desktop/README.md` | The stage 4 note corrected; the development note; a stage 6.1 note. |
| `docs/superpowers/specs/2026-09-14-desktop-app-design.md` | The review's findings and what closed them; the layout; the login item's own file. |

---

### Task 1: Development leaves nothing behind

**Files:**
- Modify: `apps/desktop/src/desktop-state.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/README.md`
- Test: `apps/desktop/src/desktop-state.test.ts`

**Interfaces:**
- Produces: `desktopStatePath(home: string, packaged: boolean): string` (`desktop.json` packaged, `desktop-dev.json` in development); the file's `version` is 2 and a version 1 file reads as nothing remembered.

Why: this machine's `~/.clawd/desktop.json` holds `openAtLogin: false` from a development run before stage 6, and the packaged app's first-run rule reads it, so the documented "first packaged run turns the login item on" would never fire here. Only development runs ever wrote version 1, so version 2 is a clean line: the packaged app starts from nothing remembered, and development gets a file of its own, so its toggle can be remembered again without steering the packaged app. The Run value a pre-stage-6 development run may have left under the bare id is out of the app's reach since the `.dev` rename; the README says how to remove it.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/desktop-state.test.ts`, replace the `desktopStatePath` describe and the `parseDesktopState` describe with:

```ts
describe("desktopStatePath", () => {
  it("is desktop.json for the packaged app and desktop-dev.json for a development run, in the home directory", () => {
    expect(desktopStatePath(join("C:", "home"), true)).toBe(join("C:", "home", "desktop.json"));
    expect(desktopStatePath(join("C:", "home"), false)).toBe(join("C:", "home", "desktop-dev.json"));
  });
});

describe("parseDesktopState", () => {
  it("keeps valid bounds and a boolean openAtLogin from a version 2 file", () => {
    expect(parseDesktopState({ version: 2, bounds: BOUNDS, openAtLogin: false })).toEqual({ bounds: BOUNDS, openAtLogin: false });
    expect(parseDesktopState({ version: 2 })).toEqual({});
  });

  it("reads a version 1 file, which only development runs before stage 6 wrote, as nothing remembered", () => {
    expect(parseDesktopState({ version: 1, bounds: BOUNDS, openAtLogin: false })).toEqual({});
  });

  it("drops each invalid field on its own, and everything from another version or a non-object", () => {
    expect(parseDesktopState({ version: 2, bounds: { ...BOUNDS, x: "100" }, openAtLogin: true })).toEqual({ openAtLogin: true });
    expect(parseDesktopState({ version: 2, bounds: { ...BOUNDS, width: 0 }, openAtLogin: "yes" })).toEqual({});
    expect(parseDesktopState({ version: 2, bounds: { ...BOUNDS, height: 10.5 } })).toEqual({});
    expect(parseDesktopState({ version: 3, bounds: BOUNDS })).toEqual({});
    expect(parseDesktopState(null)).toEqual({});
    expect(parseDesktopState([BOUNDS])).toEqual({});
  });
});
```

In the `createDesktopStore` describe, change every `version: 1` in a written file or an expected file to `version: 2`, and the test name `writes the whole file as version 1` to `writes the whole file as version 2`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/desktop-state.test.ts`
Expected: FAIL. `desktopStatePath` takes one argument and the version is 1.

- [ ] **Step 3: Write the implementation**

In `apps/desktop/src/desktop-state.ts`, replace the header comment, `VERSION` and `desktopStatePath` with:

```ts
// ~/.clawd/desktop.json: what the app remembers between runs that is not the agent's config. The
// window's bounds, and whether the user wants the app at login, absent until a first packaged run or
// a toggle. A missing or damaged file reads as nothing remembered; a failed write is dropped, since
// the next change writes the whole file again. A development run keeps its own file, so what it
// remembers never steers the packaged app.
import { readJsonFile, writeJsonAtomic } from "@clawd/agent";
import { join } from "node:path";

export type Bounds = { x: number; y: number; width: number; height: number };
export type DesktopState = { bounds?: Bounds; openAtLogin?: boolean };

/**
 * Version 2 since stage 6.1. Version 1 files were only ever written by development runs before
 * stage 6, when both shared one file, and their login choice must not decide the packaged app's
 * first run; they read as nothing remembered, which costs the saved bounds once.
 */
const VERSION = 2;

export function desktopStatePath(home: string, packaged: boolean): string {
  return join(home, packaged ? "desktop.json" : "desktop-dev.json");
}
```

In `apps/desktop/src/main.ts`, change `const store = createDesktopStore(desktopStatePath(home));` to `const store = createDesktopStore(desktopStatePath(home, app.isPackaged));`, and in `setOpenAtLogin` replace the two lines

```ts
    // Only the packaged app's choice is remembered; a development toggle is a testing convenience.
    if (app.isPackaged) store.update({ openAtLogin: on });
```

with `store.update({ openAtLogin: on });` (each build has its own file now). `loginOnLaunch` keeps returning `none` in development.

- [ ] **Step 4: Correct the README's stage 4 note and add the development note**

In `apps/desktop/README.md`, in the stage 4 note, replace the sentences from `The icons are PNGs` to `stage 6's icon file fixes that.` with:

```markdown
The icons are ICO files drawn from the canonical Clawd sprite by `build/icons.mjs` and checked in
under `resources/tray`, each holding 16, 20, 24 and 32 px images so Windows picks a crisp one at
every display scale (stage 6 replaced the PNGs). While any session waits, the icon is the variant
with an amber dot.
```

and replace `which main sets to \`io.github.mwardill.clawd-visualiser\`. In` with `which main sets to \`io.github.mwardill.clawd-visualiser\` when packaged and to that id with \`.dev\` appended in development, so the two never share an entry (stage 6). In`.

In the Package section, after the paragraph beginning `A development run and the packaged app stay out of each other's way`, add:

```markdown
Two things a development run from before stage 6 may have left behind. A Run value named
`io.github.mwardill.clawd-visualiser` pointing at this repository's `electron.exe`: the development
toggle no longer sees it, so remove it by hand (`Remove-ItemProperty
HKCU:\Software\Microsoft\Windows\CurrentVersion\Run io.github.mwardill.clawd-visualiser`) or let a
packaged run overwrite it. And a `~/.clawd/desktop.json` at version 1: the packaged app ignores it,
and development keeps `desktop-dev.json` since stage 6.1.
```

- [ ] **Step 5: Run the tests and commit**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS.

```bash
git add apps/desktop/src/desktop-state.ts apps/desktop/src/desktop-state.test.ts apps/desktop/src/main.ts apps/desktop/README.md
git commit -m "fix(desktop): desktop.json moves to version 2 and a development run keeps its own file, so an old toggle cannot steer the packaged first run"
```

---

### Task 2: The poller ends its child on stop

**Files:**
- Modify: `apps/agent/src/presence/poller.ts`
- Test: `apps/agent/src/presence/poller.test.ts`

**Interfaces:**
- Produces: `Exec = (command: string, opts: { timeoutMs: number; maxBuffer: number; signal?: AbortSignal }) => Promise<ExecResult>`; `stop()` aborts the list command in flight.

Why: `stop()` only set a flag, so a `claude agents --json` call in flight kept running until its own timeout and could write into the Claude directory after the app had stopped. The smoke script's twenty-second re-delete loop existed to outlast it; Task 5 removes that loop.

- [ ] **Step 1: Write the failing tests**

In `apps/agent/src/presence/poller.test.ts`, in the first test change the `toHaveBeenCalledWith` line to:

```ts
    expect(t.exec).toHaveBeenCalledWith("claude agents --json", { timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024, signal: expect.any(AbortSignal) });
```

and add, after the test `discards a poll that finishes after stop, so nothing reaches the host`:

```ts
  it("aborts the list command in flight when stopped, so no child outlives the poller", async () => {
    const t = setup();
    let seen: AbortSignal | undefined;
    t.exec.mockImplementationOnce(
      (_command, opts) =>
        new Promise((resolve) => {
          seen = opts.signal;
          opts.signal?.addEventListener("abort", () => resolve({ ok: false }));
        }),
    );
    const pending = t.poller.pollOnce();
    t.poller.stop();
    expect(seen?.aborted).toBe(true);
    expect(await pending).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/presence/poller.test.ts`
Expected: FAIL on both: no `signal` is passed, and nothing aborts.

- [ ] **Step 3: Write the implementation**

In `apps/agent/src/presence/poller.ts`:

1. Change the `Exec` type and `nodeExec` to:

```ts
export type ExecResult = { ok: true; stdout: string } | { ok: false };
export type Exec = (command: string, opts: { timeoutMs: number; maxBuffer: number; signal?: AbortSignal }) => Promise<ExecResult>;

/**
 * Runs a constant command through the shell (on Windows `claude` is a .cmd shim). stdout is
 * captured and stderr discarded, never inherited, and the error itself is never looked at. An
 * aborted signal ends the child, so a stopped poller leaves nothing running.
 */
export const nodeExec: Exec = (command, opts) =>
  new Promise((resolve) => {
    exec(command, { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer, windowsHide: true, encoding: "utf8", ...(opts.signal ? { signal: opts.signal } : {}) }, (err, stdout) => {
      resolve(err ? { ok: false } : { ok: true, stdout });
    });
  });
```

2. After `let stopped = false;`, add `let listing: AbortController | null = null;`.
3. In `run()`, replace the first line, `const result = await deps.exec(...)`, with:

```ts
    const aborter = new AbortController();
    listing = aborter;
    let result: ExecResult;
    try {
      result = await deps.exec(`${deps.command} agents --json`, { timeoutMs: POLL_TIMEOUT_MS, maxBuffer: POLL_MAX_BUFFER, signal: aborter.signal });
    } finally {
      if (listing === aborter) listing = null;
    }
```

4. In `stop()`, after `stopped = true;`, add:

```ts
      listing?.abort();
      listing = null;
```

- [ ] **Step 4: Run the tests and commit**

Run: `cd apps/agent && npx vitest run && pnpm typecheck`
Expected: PASS.

```bash
git add apps/agent/src/presence/poller.ts apps/agent/src/presence/poller.test.ts
git commit -m "fix(agent): stopping the presence poller ends the agents-list command in flight"
```

---

### Task 3: The icon check compares pixels and follows vitest, and the 2× renderer goes

**Files:**
- Modify: `apps/desktop/src/icons.ts`
- Modify: `apps/desktop/build/icons.mjs`
- Modify: `apps/desktop/package.json` (the `test` script)
- Test: `apps/desktop/src/icons.test.ts`

**Interfaces:**
- Produces: `renderTrayIcon` is removed; `node build/icons.mjs --check` decodes each checked-in image and compares pixels with a fresh render; `pnpm test` runs vitest first and the check after.

Why: the check compared bytes, and the PNGs inside the ICOs come from `node:zlib`, so a Node whose zlib packs identical pixels differently failed the check, and because the check ran before vitest with `&&`, it hid every unit test result. `renderTrayIcon` had no caller left, and the test pinning the 32 px render compared the function with itself.

- [ ] **Step 1: Remove the renderer and move its tests onto `renderIcon`**

In `apps/desktop/src/icons.ts`, delete the `renderTrayIcon` function and its comment.

In `apps/desktop/src/icons.test.ts`: remove `renderTrayIcon` from the import; rename the `describe("renderTrayIcon", ...)` block to `describe("renderIcon at the grid's own sizes", ...)`; replace every `renderTrayIcon(SPRITE, COLOURS, 1, ` with `renderIcon(SPRITE, COLOURS, 16, ` and every `renderTrayIcon(SPRITE, COLOURS, 2, ` with `renderIcon(SPRITE, COLOURS, 32, `; in that block's last test replace the two `scale` expectations (`0` and `1.5`) with `expect(() => renderIcon(SPRITE, COLOURS, 0, false)).toThrow();` and `expect(() => renderIcon(SPRITE, COLOURS, 24.5, false)).toThrow();`; delete the test `at 32 pixels is exactly the 2× tray render` from the `renderIcon` describe; and in the `encodePng` describe replace `renderTrayIcon(SPRITE, COLOURS, 1, true)` with `renderIcon(SPRITE, COLOURS, 16, true)`.

Run: `cd apps/desktop && npx vitest run src/icons.test.ts && pnpm typecheck`
Expected: PASS. The 1× and 2× pixel assertions still hold against `renderIcon(16)` and `renderIcon(32)`.

- [ ] **Step 2: Compare pixels in the check**

Replace `apps/desktop/build/icons.mjs` with:

```js
// Draws the icons from the canonical Clawd sprite and writes them under resources, where they are
// checked in: two tray ICOs (plain and badged) at the sizes Windows asks for, and the app's ICO up to
// 256 px for the packager. `--check` decodes each checked-in image and compares its pixels with a
// fresh render, so the icons cannot drift from the sprite, and a Node whose zlib packs the same
// pixels differently does not fail it. Run it when the sprite or the palette changes:
// pnpm --filter @clawd/desktop icons
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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
const files = [...TRAY_ICONS.map((icon) => ({ path: join("tray", icon.file), sizes: TRAY_SIZES, badge: icon.badge })), { path: APP_ICON.file, sizes: APP_ICON.sizes, badge: false }];
const render = (size, badge) => Buffer.from(renderIcon(CLAWD_BODY, colours, size, badge));

/** The directory of an ICO: one entry per image, width 0 meaning 256. */
function icoEntries(ico) {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    return { size: ico[at] === 0 ? 256 : ico[at], bytes: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) };
  });
}

/** The RGBA pixels of one of our PNGs: 8-bit, unfiltered rows, as encodePng writes them; null for anything else. */
function decodeRgba(png) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    if (rows[row * (stride + 1)] !== 0) return null;
    rows.copy(out, row * stride, row * (stride + 1) + 1, (row + 1) * (stride + 1));
  }
  return { width, height, rgba: out };
}

/** Whether a checked-in ICO holds exactly these sizes, each decoding to the fresh render. */
async function matches(target, sizes, badge) {
  const ico = await readFile(target).catch(() => null);
  if (ico === null) return false;
  const entries = icoEntries(ico);
  if (entries.length !== sizes.length) return false;
  for (let i = 0; i < sizes.length; i++) {
    const entry = entries[i];
    const image = decodeRgba(ico.subarray(entry.offset, entry.offset + entry.bytes));
    if (entry.size !== sizes[i] || image === null || image.width !== sizes[i] || image.height !== sizes[i]) return false;
    if (!image.rgba.equals(render(sizes[i], badge))) return false;
  }
  return true;
}

let differ = false;
for (const file of files) {
  const target = join(root, "resources", file.path);
  if (check) {
    const same = await matches(target, file.sizes, file.badge);
    if (!same) differ = true;
    console.log(`icons: resources/${file.path} ${same ? "matches the sprite" : "DIFFERS from the sprite; run pnpm --filter @clawd/desktop icons"}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encodeIco(file.sizes.map((size) => ({ size, png: encodePng(size, size, render(size, file.badge)) }))));
    console.log(`icons: wrote resources/${file.path}`);
  }
}
if (differ) process.exit(1);
```

In `apps/desktop/package.json`, change the `test` script to `"test": "vitest run --passWithNoTests && node build/icons.mjs --check"`.

Run: `cd apps/desktop && node build/icons.mjs --check`
Expected: three `matches the sprite` lines and exit 0, without regenerating the files. Then, to see the check bite: append a byte to `resources/tray/tray.ico`, run it again (exit 1 and `DIFFERS`), and restore the file with `git checkout resources/tray/tray.ico`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/icons.ts apps/desktop/src/icons.test.ts apps/desktop/build/icons.mjs apps/desktop/package.json
git commit -m "fix(desktop): the icon check compares decoded pixels and runs after vitest, and the unused 2x renderer goes"
```

---

### Task 4: One clean step, the product name once, the tray cached

**Files:**
- Create: `apps/desktop/build/clean.mjs`
- Modify: `apps/desktop/build/bundle.mjs`
- Modify: `apps/desktop/package.json` (the `dev`, `start` and `package` scripts)
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/main.ts`

**Interfaces:**
- Produces: `dev`, `start` and `package` begin with `node build/clean.mjs`, which removes `dist`; `bundle.mjs` no longer removes anything; the product name lives in `extraMetadata` alone; `refreshTray` touches the tray only when its text or image changes.

- [ ] **Step 1: One clean step**

Create `apps/desktop/build/clean.mjs`:

```js
// Removes the build output, so nothing from an older build is bundled or packaged beside the new one.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

await rm(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true, force: true });
```

In `apps/desktop/package.json`, change the three scripts:

```json
    "dev": "node build/clean.mjs && node build/bundle.mjs && electron . --dev-url http://localhost:3000",
    "start": "node build/clean.mjs && node build/renderer.mjs && node build/bundle.mjs && electron .",
    "package": "node build/clean.mjs && node build/renderer.mjs && node build/bundle.mjs && electron-builder --win",
```

In `apps/desktop/build/bundle.mjs`, remove the three `await rm(...)` lines and the sentences of the comments that explain them (`Cleared first so a leftover settings file from an older build is never packaged (electron-builder takes dist/**).`, `The target is cleared first so a leftover from an older icon set is never packaged alongside the new one.`, `Cleared first for the same reason.`), and change the import back to `import { cp } from "node:fs/promises";`.

- [ ] **Step 2: The product name once**

In `apps/desktop/electron-builder.yml`, delete the line `productName: Clawd Visualiser` that sits directly under `appId`, and change the comment above `extraMetadata` to:

```yaml
# The app's name, in the archive's own package.json, which is where electron-builder reads it from
# for the exe and the folder and where Electron reads it for the profile folder and the
# single-instance lock. Only the archive's copy gets it, so a development run keeps @clawd/desktop
# and the two never block or share with each other.
```

- [ ] **Step 3: The tray cached**

In `apps/desktop/src/main.ts`, replace the `trayImage` and `refreshTray` functions with:

```ts
  const version = app.getVersion();
  let trayTip = "";
  /** The two images, loaded once: a waiting flip swaps them rather than reading the ICO again. */
  const trayImages = new Map<string, NativeImage>();
  function trayImage(file: string): NativeImage {
    let image = trayImages.get(file);
    if (image === undefined) {
      image = nativeImage.createFromPath(join(dist.tray, file));
      trayImages.set(file, image);
    }
    return image;
  }

  /** The host's change callback fires on every snapshot; the tray is touched only when its text or its image changes. */
  function refreshTray(state: HostState): void {
    if (tray === null) return;
    const tip = trayTooltip(state, version);
    if (tip !== trayTip) {
      trayTip = tip;
      tray.setToolTip(tip);
    }
    const file = trayIconFile(state.waiting);
    if (file !== trayFile) {
      trayFile = file;
      tray.setImage(trayImage(file));
    }
  }
```

- [ ] **Step 4: Check, package, and commit**

Run: `cd apps/desktop && pnpm typecheck && npx vitest run && pnpm bundle`
Expected: PASS; `dist` holds `main.cjs`, `settings/`, `tray/` and `hooks/` (no `renderer/`, since `bundle` alone does not build it).

Run from the repository root: `pnpm --filter @clawd/desktop package`
Expected: `release/win-unpacked/Clawd Visualiser.exe` and `release/Clawd-Visualiser-0.1.0-win-x64.zip`, named as before from `extraMetadata` alone.

```bash
git add apps/desktop/build/clean.mjs apps/desktop/build/bundle.mjs apps/desktop/package.json apps/desktop/electron-builder.yml apps/desktop/src/main.ts
git commit -m "fix(desktop): the build cleans once before it starts, the product name is written once, and the tray is touched only on change"
```

---

### Task 5: The smoke script

**Files:**
- Modify: `apps/desktop/build/smoke-packaged.mjs`

**Interfaces:**
- Consumes: `desktopStatePath(home, packaged)` and `createDesktopStore` from Task 1; the poller's abort from Task 2, which lets the re-delete loop go.
- Produces: the smoke spawns the packaged app with `--user-data-dir=<scratch>`, stops waiting the moment the process exits, reads the config, the health route, the origin and the log file's name from the app's and the agent's own modules, fails when the log shows `desktop.attached`, and removes its scratch folders with retries.

- [ ] **Step 1: Rewrite the script**

Replace `apps/desktop/build/smoke-packaged.mjs` with:

```js
// Runs the packaged app once, hidden, against scratch folders and its own profile directory: the exe
// must run as plain Node (the hooks depend on it), the app must start as packaged and own its agent,
// and that agent must answer the health check from the visualiser's origin. Then the process is
// stopped by its own id. Nothing under the real ~/.clawd or ~/.claude is touched, and the installed
// copy of the app, if it is running, is neither disturbed nor mistaken for the one under test.
// pnpm --filter @clawd/desktop smoke
import { build } from "esbuild";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const exe = join(root, "release", "win-unpacked", "Clawd Visualiser.exe");
if (!existsSync(exe)) {
  console.error(`smoke: no packaged app at ${exe}; run pnpm --filter @clawd/desktop package first`);
  process.exit(1);
}

// The file formats and names this script touches belong to the app and the agent: bundled from their
// TypeScript, as build/icons.mjs does, so a change there reaches here.
const bundled = await build({
  stdin: {
    contents: [
      'export { agentPaths, readConfig } from "@clawd/agent";',
      'export { DESKTOP_ORIGIN, ENDPOINTS } from "@clawd/core";',
      'export { createDesktopStore, desktopStatePath } from "./src/desktop-state.ts";',
      'export { logFileName } from "./src/log.ts";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "smoke-entry.mjs",
    loader: "js",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
});
const { agentPaths, readConfig, DESKTOP_ORIGIN, ENDPOINTS, createDesktopStore, desktopStatePath, logFileName } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const home = await mkdtemp(join(tmpdir(), "clawd-smoke-home-"));
const claudeDir = await mkdtemp(join(tmpdir(), "clawd-smoke-claude-"));
const profile = await mkdtemp(join(tmpdir(), "clawd-smoke-profile-"));
// A remembered choice of off keeps the packaged app's first-run rule from writing a real Run key entry.
const seed = createDesktopStore(desktopStatePath(home, true));
seed.update({ openAtLogin: false });
await seed.flush();
const env = { ...process.env, CLAWD_HOME: home, CLAUDE_CONFIG_DIR: claudeDir };
delete env.ELECTRON_RUN_AS_NODE;

const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const before = Date.now();
const asNode = spawnSync(exe, ["-e", "process.exit(0)"], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 10_000 });
if (asNode.status !== 0) {
  const cause = asNode.error?.message ?? (asNode.signal ? `signal ${asNode.signal}` : undefined);
  fail(`the exe did not run as Node (exit ${asNode.status}${cause ? `, ${cause}` : ""}); is the runAsNode fuse on?`);
} else console.log(`smoke: the exe ran as Node and exited in ${Date.now() - before} ms`);

// Its own profile directory: Electron derives the single-instance lock from it, so the installed copy's lock is not this one's.
const app = spawn(exe, ["--hidden", `--user-data-dir=${profile}`], { env, stdio: "ignore" });
/** Set once the app is gone: a spawn error, or its exit code and signal. The waits below stop on it at once. */
let ended = null;
app.on("error", (err) => {
  ended ??= err;
});
app.on("exit", (code, signal) => {
  ended ??= { code, signal };
});

/** Polls until `read` gives something truthy. */
async function waitFor(what, read, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (ended !== null) throw new Error(ended instanceof Error ? `the app failed to start: ${ended.message}` : `the app exited with code ${ended.code} before ${what}`);
    const value = await read().catch(() => null);
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`gave up waiting for ${what} after ${timeoutMs} ms`);
}

const logPath = join(agentPaths(home).logs, logFileName(Date.now()));
const logText = () => readFile(logPath, "utf8").catch(() => "");

try {
  await waitFor("desktop.started in the log", async () => (await logText()).includes('"code":"desktop.started","packaged":true'), 20_000);
  console.log("smoke: the app started, and knows it is packaged");
  const config = await waitFor("config.json", () => readConfig(agentPaths(home)), 10_000);
  const health = await waitFor(`health on port ${config.port}`, async () => {
    const res = await fetch(`http://127.0.0.1:${config.port}${ENDPOINTS.health}`, { headers: { origin: DESKTOP_ORIGIN } });
    return res.ok ? res.json() : null;
  }, 10_000);
  if ((await logText()).includes('"code":"desktop.attached"')) throw new Error(`another agent holds port ${config.port} and answered instead; stop it (the CLI's, or a development run) and run the smoke again`);
  console.log(`smoke: the app's own agent on port ${config.port} answers ${JSON.stringify(health)} to the visualiser's origin`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  // The app's own process id, nothing else. No quit sequence: the scratch home is about to go.
  if (ended === null) {
    app.kill();
    await once(app, "exit", { signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
  for (const dir of [home, claudeDir, profile]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((err) => console.warn(`smoke: could not remove ${dir} (${err.code ?? err.message}); delete it by hand`));
  }
}
```

- [ ] **Step 2: Run it three ways**

Run from the repository root, with no CLI agent and no development run on the port: `pnpm --filter @clawd/desktop smoke`
Expected:

```
smoke: the exe ran as Node and exited in <n> ms
smoke: the app started, and knows it is packaged
smoke: the app's own agent on port 4750 answers {"ok":true,...} to the visualiser's origin
```

with exit code 0 and no scratch folders left under `%TEMP%` (`ls $env:TEMP | Select-String clawd-smoke` prints nothing).

Then start the packaged app from `release/win-unpacked` by hand, leave it in the tray, and run the smoke again: it must still pass, since the test instance has its own profile. The log line `desktop.attached` will not appear, because the tray copy's agent holds port 4750 only if its config says so; if it does hold the port, the smoke must fail with the `another agent holds port` message rather than pass, which is the third way to run it. Quit the tray copy afterwards.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/build/smoke-packaged.mjs
git commit -m "fix(desktop): the smoke runs in its own profile, stops when the app exits, fails on an attached agent, and cleans up with retries"
```

---

### Task 6: The documents and the hand-off

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-desktop-app-design.md`
- Modify: `apps/desktop/README.md`

- [ ] **Step 1: The design**

In `docs/superpowers/specs/2026-09-14-desktop-app-design.md`:

1. In §3's layout block, after the `    bundle.mjs` line, add `    clean.mjs             removes dist before every build`.

2. In §10, in the login item bullet, the sentence beginning `In development the Run value has its own name` says the toggle is not remembered in `desktop.json` (it wraps across lines, around line 228). Change that clause so the sentence reads: `In development the Run value has its own name (\`<appId>.dev\`), its toggle is remembered in its own \`desktop-dev.json\`, and nothing is enabled or re-applied at launch, so a development run cannot disturb the packaged app's entry (stages 6 and 6.1). \`desktop.json\` is version 2 since stage 6.1; a version 1 file, which only development runs before stage 6 wrote, reads as nothing remembered.`

3. In §12's stages table, after the `6 Package` row, add:

```markdown
| 6.1 Review fixes | The thirteen findings of the review of stage 6's merge (§12.1) | None new | Each is done or recorded with a reason |
```

4. In §12.1, after the `Found in the final review of stage 6` list, insert:

```markdown
Found in the review of stage 6's merge (17 September 2026), and taken as stage 6.1.

- **A stale development login choice steered the packaged first run.** Development runs before
  stage 6 wrote `openAtLogin` into the one `desktop.json`, and this machine's held `false`, so the
  packaged app's first run would never have enabled the login item. Done: version 2, and
  `desktop-dev.json` for development.
- **A pre-stage-6 development Run value is orphaned by the `.dev` rename.** Nothing in the app can
  see it now. Recorded in the desktop README's development note with the one-line removal.
- **The smoke shared the installed app's lock and missed an early exit.** Done: its own profile
  directory, and the waits stop when the process exits.
- **The smoke's cleanup could throw out of its `finally`.** Done: `rm` retries and warns.
- **The smoke re-spelled five private formats.** Done: bundled from the TypeScript.
- **The smoke could be answered by another agent.** Done: it fails on `desktop.attached`.
- **The poller's stop left an in-flight CLI call running.** Done: an abort signal ends it, and the
  smoke's re-delete loop went with it.
- **The icon check compared bytes and gated the whole test run.** Done: pixels, after vitest.
- **The 2× renderer had no caller and its test compared it with itself.** Done: gone.
- **Three targeted `rm` calls instead of one clean step.** Done: `build/clean.mjs` first.
- **The product name was typed twice in `electron-builder.yml`.** Done: `extraMetadata` alone.
- **The tray was rebuilt on every snapshot.** Done: the tooltip is compared and the two images
  are cached.
- **The stage 4 README note still described PNG icons and the bare id.** Done.
- **`packaged` stands in for "the only installer on this machine".** The launch repair rewrites any
  hook of ours whose command is not this exe's, so two packaged copies, or a packaged app beside the
  CLI's install, take turns rewriting the hooks and leaving a backup each. Accepted for now: the
  package is for teammates without the CLI, and the maintainer's machine runs one or the other. The
  cure, if wanted, goes with stage 7's hook-status rework: repair only when the installed command's
  exe is this one or no longer exists, and otherwise show `stale` and offer Reinstall.
- **The `distPaths` tests spell Windows paths.** By the design's rule that nothing is tested
  elsewhere. Accepted.
```

Also mark done, by appending `Done in stage 6.1: pixels, after vitest.` to the stage 6 final review's `The icon check compares bytes` item, and `Done in stage 6.1.` to its `The smoke check can be answered by another agent` item.

- [ ] **Step 2: The README**

In `apps/desktop/README.md`, append after the stage 6 note:

```markdown
### Stage 6.1: the review's fixes

Nothing new in Electron. Two things worth knowing. A development run and the packaged app now keep
separate state files (`desktop-dev.json` and `desktop.json`, version 2), so a toggle made in one
never decides the other's behaviour; the old version 1 file is ignored. And the smoke script runs the
packaged app with `--user-data-dir` pointing at a scratch profile: Electron derives the
single-instance lock from that directory, so the copy under test never collides with an installed
copy sitting in the tray.
```

- [ ] **Step 3: Run every check and commit**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace, with the icon check's three lines after the desktop tests.

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md apps/desktop/README.md
git commit -m "docs: the design records the stage 6 review's findings and what closed them, and the state file's version"
```

- [ ] **Step 4: One check by hand, then hand the branch back**

Run the packaged app once against the real home, with no scratch variables set, from `release/win-unpacked`: `Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` shows `io.github.mwardill.clawd-visualiser`, the first-run rule that stage 6 could not show on this machine, and `~/.clawd/desktop.json` is at version 2. Turn the login item off from the tray afterwards if it is not wanted yet, and quit. Then a development run (`pnpm --filter @clawd/desktop start`) with the tray toggle on and off leaves `desktop.json` alone and writes `desktop-dev.json`.

Then hand the branch back with the finishing-a-development-branch skill. The maintainer merges from `C:\mw\visualiser`:

```bash
git merge --no-ff feat/desktop-stage-6.1 -m "Merge branch 'feat/desktop-stage-6.1' (desktop stage 6.1: the stage 6 review's fixes)"
```

Stage 7's plan, `2026-09-17-desktop-stage-7.md`, starts from `main` once this is merged.
