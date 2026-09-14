# Desktop Stage 1 (Window) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An `apps/desktop` Electron package that opens the visualiser in a sandboxed window against the Next dev server and a CLI-started agent, with the bundle and the dev loop every later stage builds on.

**Architecture:** `main.ts` owns the app lifecycle and nothing else. `window.ts` makes the one `BrowserWindow` with the security defaults and a navigation guard. `args.ts` and `navigation.ts` are pure and tested. `build/bundle.mjs` runs esbuild once, producing one CommonJS file Electron loads. No preload, no IPC, no agent in-process yet: the renderer is a web page that talks to the agent over HTTP exactly as a browser tab does.

**Tech Stack:** Electron 44, esbuild 0.28, vitest 5, TypeScript 5, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, sections 3, 4, 7 and stage 1 of section 12.

**Stage idea:** the process model. The main process is a Node program; each window is a Chromium renderer in its own sandboxed process; they share nothing unless a preload bridge is added on purpose (stage 5). Everything in this stage follows from that split.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere.
- The renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload. New windows are denied. Navigation is allowed only within the origin the window was loaded from.
- Development URL precedence: `--dev-url`, then `CLAWD_DESKTOP_URL`, then `http://localhost:3000`.
- Main-process code stays thin; logic lives in pure modules with tests, as in the agent.
- The package has no runtime dependencies. `main` in `package.json` is `dist/main.cjs`; `dist/` is already ignored by the root `.gitignore`.
- Each task's README note explains the Electron idea it introduces, in plain words, for a maintainer learning Electron.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-1` in the worktree `C:\mw\visualiser-desktop`. Run package commands from that directory. The detail levels plan runs elsewhere on its own branch; nothing here touches its files.
- Run package tests from the package directory: `npx vitest run <file>`.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/desktop/package.json` | The package: scripts, Electron and esbuild as dev dependencies, `main` pointing at the bundle. |
| `apps/desktop/tsconfig.json` | Type checking only; esbuild does the compiling. |
| `apps/desktop/README.md` | What the package is, how to run it, and the stage notes. |
| `apps/desktop/build/bundle.mjs` | esbuild: `src/main.ts` to `dist/main.cjs`, `electron` external. |
| `apps/desktop/src/args.ts` | Pure: the app's own arguments, `--hidden` and `--dev-url`, and the dev URL precedence. |
| `apps/desktop/src/navigation.ts` | Pure: whether a navigation stays on the loaded origin. |
| `apps/desktop/src/window.ts` | The `BrowserWindow` with the security defaults, the deny-all window opener and the navigation guard. |
| `apps/desktop/src/main.ts` | Lifecycle: parse arguments, wait for `ready`, make the window, quit when it closes. |
| `pnpm-workspace.yaml` | Allows Electron's postinstall, which downloads the binary. |
| `README.md` (root) | One row for `apps/desktop` in the layout table. |

---

### Task 1: Scaffold the package and install Electron

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/README.md`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Produces: the `@clawd/desktop` workspace package with `bundle`, `dev`, `test` and `typecheck` scripts.

- [ ] **Step 1: Write the package manifest**

`apps/desktop/package.json`:

```json
{
  "name": "@clawd/desktop",
  "version": "0.1.0",
  "private": true,
  "description": "The desktop app: the agent and the visualiser in one window and the tray, run from a folder.",
  "main": "dist/main.cjs",
  "scripts": {
    "bundle": "node build/bundle.mjs",
    "dev": "node build/bundle.mjs && electron .",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^22.20.2",
    "electron": "^44.3.0",
    "esbuild": "^0.28.2",
    "typescript": "^5",
    "vitest": "^5"
  }
}
```

No `"type": "module"`: Electron loads `main` as CommonJS, which is why the bundle is a `.cjs` file. The build script is `.mjs`, so Node runs it as a module regardless.

- [ ] **Step 2: Write the TypeScript config**

`apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Electron's own types come with the `electron` package, so `import { app } from "electron"` type-checks without anything more.

- [ ] **Step 3: Allow Electron's install script**

`pnpm-workspace.yaml`, in `allowBuilds`, add with its reason:

```yaml
  # electron downloads its binary in a postinstall step.
  electron: true
```

- [ ] **Step 4: Write the README with the first stage note**

`apps/desktop/README.md`:

```markdown
# @clawd/desktop

The desktop app: the agent and the visualiser in one window and the tray, run from a folder.
Built in stages, one Electron idea at a time. Design:
`docs/superpowers/specs/2026-09-14-desktop-app-design.md`.

## Run (development)

Start the agent and the web app as usual, then the desktop app:

```
pnpm --filter @clawd/agent start
pnpm dev
pnpm --filter @clawd/desktop dev
```

The window loads `http://localhost:3000` by default. `--dev-url <url>` or `CLAWD_DESKTOP_URL`
point it elsewhere, for example `--dev-url "http://localhost:3000/?source=simulated"`.

Renderer changes hot-reload through Next. A change under `src/` needs the dev command run again:
it bundles `src/main.ts` into `dist/main.cjs` and starts Electron on it.

```
pnpm --filter @clawd/desktop test
pnpm --filter @clawd/desktop typecheck
```

## Stage notes

### Stage 1: the window

Electron is two kinds of process. The **main process** is one Node program: it starts first, owns
the app lifecycle (`ready`, windows closing, quit) and makes windows. It never draws anything. Each
window is a **renderer**: a Chromium page in its own process, and in this app a sandboxed one with
no Node access and no preload, so it is a web page that talks to the agent over HTTP exactly as a
browser tab does. The two kinds share nothing unless a preload bridge is added on purpose, which
stage 5 does for the settings window.

Because Electron loads `main` from `package.json` as a plain Node module, and the workspace
packages export TypeScript, a bundler runs first: esbuild turns `src/main.ts` into one CommonJS
file with `electron` left external, since the runtime provides it.
```

- [ ] **Step 5: Install and check the binary arrived**

Run from the repository root: `pnpm install`
Expected: the lockfile gains `@clawd/desktop`; Electron's postinstall downloads the binary (about 100 MB, once). Behind a proxy that blocks it, set `ELECTRON_MIRROR` to a reachable mirror and run `pnpm install` again.

Run: `pnpm --filter @clawd/desktop exec electron --version`
Expected: `v44.3.0` or a later 44.

Run: `pnpm --filter @clawd/desktop test && pnpm --filter @clawd/desktop typecheck`
Expected: vitest reports no test files and exits 0; `tsc` finds nothing to check yet and exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/README.md pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(desktop): scaffold the Electron package; the main process is one Node program and each window a sandboxed renderer"
```

---

### Task 2: The app's arguments and the development URL

**Files:**
- Create: `apps/desktop/src/args.ts`
- Test: `apps/desktop/src/args.test.ts`

**Interfaces:**
- Produces: `Args = { hidden: boolean; devUrl: string | null }`; `parseArgs(argv): Args`; `ownArgs(argv, packaged): string[]`; `resolveDevUrl(args, env): string`; `DEFAULT_DEV_URL`.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/args.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_URL, ownArgs, parseArgs, resolveDevUrl } from "./args";

describe("parseArgs", () => {
  it("reads --hidden and --dev-url in both spellings, ignoring anything else", () => {
    expect(parseArgs([])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--hidden"])).toEqual({ hidden: true, devUrl: null });
    expect(parseArgs(["--dev-url", "http://localhost:3001"])).toEqual({ hidden: false, devUrl: "http://localhost:3001" });
    expect(parseArgs(["--dev-url=http://localhost:3001", "--hidden", "--other"])).toEqual({ hidden: true, devUrl: "http://localhost:3001" });
    expect(parseArgs(["--dev-url"])).toEqual({ hidden: false, devUrl: null });
    expect(parseArgs(["--dev-url="])).toEqual({ hidden: false, devUrl: null });
  });
});

describe("ownArgs", () => {
  it("drops the executable, and the app path too in development", () => {
    expect(ownArgs(["C:/app/Clawd Visualiser.exe", "--hidden"], true)).toEqual(["--hidden"]);
    expect(ownArgs(["C:/x/electron.exe", ".", "--hidden"], false)).toEqual(["--hidden"]);
    expect(ownArgs(["C:/x/electron.exe"], false)).toEqual([]);
  });
});

describe("resolveDevUrl", () => {
  it("prefers the flag, then the environment, then the Next dev server", () => {
    expect(resolveDevUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" })).toBe("http://a");
    expect(resolveDevUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "http://b" })).toBe("http://b");
    expect(resolveDevUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "  " })).toBe(DEFAULT_DEV_URL);
    expect(resolveDevUrl({ hidden: false, devUrl: null }, {})).toBe("http://localhost:3000");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/args.test.ts`
Expected: FAIL, "Failed to resolve import ./args".

- [ ] **Step 3: Write the module**

`apps/desktop/src/args.ts`:

```ts
// The app's own command line. Pure, so the main process stays a few lines.

/** `hidden` is read from stage 4 (start at login without a window); parsed now so the shape is settled. */
export type Args = { hidden: boolean; devUrl: string | null };

export const DEFAULT_DEV_URL = "http://localhost:3000";

/** The app's own arguments: Electron puts its executable first, and `electron .` adds the app path after it. */
export function ownArgs(argv: readonly string[], packaged: boolean): string[] {
  return argv.slice(packaged ? 1 : 2);
}

/** `--hidden`, and `--dev-url <url>` or `--dev-url=<url>`. Anything else is ignored. */
export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { hidden: false, devUrl: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--hidden") args.hidden = true;
    else if (a === "--dev-url") args.devUrl = argv[++i] ?? null;
    else if (a.startsWith("--dev-url=")) args.devUrl = a.slice("--dev-url=".length) || null;
  }
  return args;
}

/** Where the renderer loads from in development: the flag, else the environment, else the Next dev server. */
export function resolveDevUrl(args: Args, env: Readonly<Record<string, string | undefined>>): string {
  const fromEnv = env.CLAWD_DESKTOP_URL?.trim();
  return args.devUrl ?? (fromEnv ? fromEnv : DEFAULT_DEV_URL);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/args.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/args.ts apps/desktop/src/args.test.ts
git commit -m "feat(desktop): parse the app's own arguments and resolve the development URL"
```

---

### Task 3: The navigation guard

**Files:**
- Create: `apps/desktop/src/navigation.ts`
- Test: `apps/desktop/src/navigation.test.ts`

**Interfaces:**
- Produces: `sameOrigin(current: string, target: string): boolean`.

Why this exists: a renderer can be navigated by anything it renders. The guard keeps the window on the origin it was loaded from, so a link in a page, or a bug, cannot turn the app into a browser of somewhere else. It compares scheme and host itself rather than `URL.origin`, because for a custom scheme such as `app://` (stage 3) Node reports the origin as the string `"null"`, which would make every `app://` URL look alike.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sameOrigin } from "./navigation";

describe("sameOrigin", () => {
  it("allows the same scheme and host whatever the path or query", () => {
    expect(sameOrigin("http://localhost:3000/", "http://localhost:3000/?source=simulated")).toBe(true);
    expect(sameOrigin("http://localhost:3000/", "http://LOCALHOST:3000/other")).toBe(true);
    expect(sameOrigin("app://clawd/", "app://clawd/settings.html")).toBe(true);
  });

  it("refuses another host, port, scheme, or anything that does not parse", () => {
    expect(sameOrigin("http://localhost:3000/", "http://localhost:3001/")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "https://localhost:3000/")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "http://example.com/")).toBe(false);
    expect(sameOrigin("app://clawd/", "app://other/")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "javascript:alert(1)")).toBe(false);
    expect(sameOrigin("http://localhost:3000/", "not a url")).toBe(false);
    expect(sameOrigin("not a url", "http://localhost:3000/")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/navigation.test.ts`
Expected: FAIL, "Failed to resolve import ./navigation".

- [ ] **Step 3: Write the module**

`apps/desktop/src/navigation.ts`:

```ts
// Whether the renderer may go somewhere. Pure, so it is tested without a window.

/** Scheme and host of a URL, compared without case; null when it does not parse. */
function site(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when a renderer loaded from `current` may navigate to `target`: the same scheme and host
 * only. Compared by hand rather than through `URL.origin`, which is the string "null" for a
 * custom scheme and so would make every `app://` URL alike.
 */
export function sameOrigin(current: string, target: string): boolean {
  const a = site(current);
  const b = site(target);
  return a !== null && b !== null && a === b;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/navigation.ts apps/desktop/src/navigation.test.ts
git commit -m "feat(desktop): a renderer may only navigate within the scheme and host it was loaded from"
```

---

### Task 4: The window, the main process, the bundle and the dev loop

**Files:**
- Create: `apps/desktop/src/window.ts`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/build/bundle.mjs`
- Modify: `apps/desktop/README.md`
- Modify: `README.md` (root)

**Interfaces:**
- Consumes: `parseArgs`, `ownArgs`, `resolveDevUrl` from Task 2; `sameOrigin` from Task 3.
- Produces: `createMainWindow(url: string): BrowserWindow`; `WINDOW_SIZE`; `BACKGROUND`; the `dist/main.cjs` bundle; `pnpm --filter @clawd/desktop dev`.

There is no unit test for these two files on purpose: they are the thin edge where Electron is called, and the spec keeps them free of logic. The check is running the app (step 4).

- [ ] **Step 1: Write the window module**

`apps/desktop/src/window.ts`:

```ts
import { BrowserWindow } from "electron";
import { sameOrigin } from "./navigation";

export const WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The scene's night background, so the window never flashes white before the page paints. */
export const BACKGROUND = "#0a0b10";

/**
 * The one visualiser window. The renderer is sandboxed with no Node access and no preload: a web
 * page that talks to the agent over HTTP, as a browser tab does. It may not open windows and may
 * not navigate away from the origin it was loaded from.
 */
export function createMainWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: "Clawd Visualiser",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(url, target)) event.preventDefault();
  });
  void win.loadURL(url);
  return win;
}
```

- [ ] **Step 2: Write the main process**

`apps/desktop/src/main.ts`:

```ts
// The main process: the one Node program in the app. It owns the lifecycle and the windows and
// draws nothing itself; Chromium does that, in a sandboxed renderer process per window.
import { app } from "electron";
import { ownArgs, parseArgs, resolveDevUrl } from "./args";
import { createMainWindow } from "./window";

const args = parseArgs(ownArgs(process.argv, app.isPackaged));
const url = resolveDevUrl(args, process.env);

// `ready` fires once Electron has initialised; no window can be made before it.
void app.whenReady().then(() => {
  createMainWindow(url);
});

// Stage 1 quits when the window closes. Stage 4 replaces this: the tray keeps the app alive.
app.on("window-all-closed", () => app.quit());
```

- [ ] **Step 3: Write the bundle script**

`apps/desktop/build/bundle.mjs`:

```js
// Bundles the main process into one CommonJS file. Electron loads `main` from package.json as a
// plain Node module, and the workspace packages export TypeScript, so a bundler has to run first.
import { build } from "esbuild";
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
```

Run: `cd apps/desktop && pnpm bundle`
Expected: esbuild prints `dist/main.cjs` with its size and `dist/main.cjs.map`, in well under a second.

- [ ] **Step 4: Run the app and walk the checklist**

Start the agent and the web app in two terminals from the repository root, then the app in a third:

```
pnpm --filter @clawd/agent start
pnpm dev
pnpm --filter @clawd/desktop dev
```

Check each:

- A window titled Clawd Visualiser opens on a dark background with no menu bar, and shows the panes scene with your live sessions. The badge at the top right reads `live · 127.0.0.1:4750`.
- Click a Clawd: the sheet opens and the ticker streams. Focus window works, since the agent is the CLI's and unchanged.
- Press Ctrl+Shift+I: DevTools opens on the renderer. In the Network tab, `stream` is an open EventSource to the agent. In the Console, `typeof require` is `"undefined"` and `typeof process` is `"undefined"`: the sandbox is on.
- Close the window: the process exits and the terminal prompt returns.
- Run `pnpm --filter @clawd/desktop dev -- --dev-url "http://localhost:3000/?source=simulated"`: the badge reads `simulated · forced`.
- Stop the web dev server and run the app: the window shows Chromium's connection error page. That is expected in stage 1; stage 3 replaces the dev server with the bundled export.

- [ ] **Step 5: Finish the stage note and the root README**

Append to the Stage 1 note in `apps/desktop/README.md`:

```markdown
What stage 1 leaves in place: `pnpm --filter @clawd/desktop dev` bundles and starts the app;
`--dev-url` and `CLAWD_DESKTOP_URL` choose the page; the window is sandboxed, denies new windows
and refuses to leave its origin. The main process quits when the window closes, which stage 4
changes when the tray arrives. The agent is still the CLI's; stage 2 brings it inside.
```

Root `README.md`, in the layout table after the `apps/agent` row:

```markdown
| `apps/desktop` | The Electron app, built in stages: the agent and the visualiser in one window and the tray, run from a folder. Stage 1 opens the visualiser in a sandboxed window against the dev server. See its README. |
```

- [ ] **Step 6: Run the package checks and commit**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit && cd ../.. && pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add apps/desktop/src/window.ts apps/desktop/src/main.ts apps/desktop/build/bundle.mjs apps/desktop/README.md README.md
git commit -m "feat(desktop): a sandboxed window on the dev server; esbuild bundles the main process and the app quits with its window"
```

Then hand the branch back with the finishing-a-development-branch skill. Stage 2 (the agent inside the main process) starts from this branch once it is merged.
