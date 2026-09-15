# Desktop Stage 3 (Packaged UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app shows the visualiser from the web app's static export over `app://clawd/`, with a Content Security Policy, so nothing but the app has to be running.

**Architecture:** `apps/web` builds a static export when `CLAWD_TARGET=desktop`; `build/renderer.mjs` runs that build and copies the export to `dist/renderer`. `scheme.ts` is Electron-free: a pure mapper from `app://clawd/<path>` to a file, a fixed MIME table, the CSP text and a handler that reads the file. `main.ts` registers the scheme before `ready` and hands it to `protocol.handle` after. The agent accepts the page's origin, `app://clawd`, as a built-in.

**Tech Stack:** Electron 44, Next 16.3 (Turbopack, `output: "export"`), esbuild 0.28, vitest 5, TypeScript 5.9, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, sections 6 (origins), 7 (renderer), 13 (tests) and stage 3 of section 12.

**Stage idea:** a web page normally comes from a server. Here there is none: Chromium asks the main process for every `app://` URL and main answers from files on disk. That brings three things a dev server hid. A custom protocol has to be declared, with what it may do, before the app is ready. The page now has its own origin, `app://clawd`, which the agent must recognise. And because main writes every response, main also sets the security policy the page runs under: which scripts, styles and fonts it may load, and which addresses it may reach.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The desktop package has no runtime dependencies. `@clawd/agent` and `@clawd/core` are dev dependencies, bundled by esbuild.
- Scheme `app`, host `clawd`. The origin `app://clawd` is core's `DESKTOP_ORIGIN`; the desktop derives its URL from it.
- Privileges, registered before `ready`: `{ standard: true, secure: true, supportFetchAPI: true }`.
- The mapper maps `app://clawd/<path>` to `<renderer dir>/<path>` and `/` to `index.html`. It decodes, normalises, refuses `..` and absolute paths, and returns null for anything outside the renderer directory.
- MIME comes from a fixed table (html, js, css, json, png, ico, svg, woff2, txt, map); anything else is 404. `txt` is `text/plain`: Next's router accepts an export's page payloads only with that type.
- Every response carries `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src http://127.0.0.1:<port> http://localhost:<port>; frame-ancestors 'none'`, with the agent's port.
- `BUILTIN_ORIGINS` in the agent: `http://localhost:3000`, `http://127.0.0.1:3000` and `DESKTOP_ORIGIN`. `checkOrigin` receives the built-ins plus `config.corsOrigins`; the config default becomes `[]`. Existing config files that list the localhost origins keep working.
- The private-network preflight answer is already in the agent (`apps/agent/src/http/server.ts:137-141`, tested at `server.test.ts:124-139`). This stage changes nothing there.
- Next: `output: "export"` and `images: { unoptimized: true }` when `CLAWD_TARGET=desktop`. The web app's source is otherwise untouched.
- Private network checks, tried in this order, keeping the one that works: nothing; `session.setPermissionRequestHandler` granting the app origin; `app.commandLine.appendSwitch("disable-features", "PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks")` before `ready`.
- The window loads `--dev-url`, else `CLAWD_DESKTOP_URL`, else `app://clawd/`. The `dev` script passes `--dev-url http://localhost:3000`. This moves spec §7's development fallback into the script, because the stage's done-when needs the export to run before packaging exists.
- The export talks to the agent URL fixed at build time: `http://127.0.0.1:4750` unless `NEXT_PUBLIC_AGENT_URL` is set. An agent on another port is out of scope.
- Not in this stage: `app://settings/` (stage 5), `paths.ts` with `desktop.json` (stage 4), electron-builder (stage 6). The export is built by `build/renderer.mjs`, separate from `bundle.mjs`, so the `dev` loop stays fast; stage 6's `package` script runs both.
- Each stage note explains the Electron idea it introduces, in plain words, for a maintainer learning Electron.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-3` in the worktree `C:\mw\visualiser-desktop`, cut from `main` once `feat/desktop-stage-2` is merged. Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/schema/transport.ts` | `DESKTOP_ORIGIN`. |
| `apps/agent/src/http/guards.ts` | `BUILTIN_ORIGINS` and `allowedOrigins`. |
| `apps/agent/src/http/server.ts` | The API's origin check uses the built-ins plus the config. |
| `apps/agent/src/config.ts` | `corsOrigins` defaults to `[]`. |
| `apps/agent/src/index.ts` | Exports `DEFAULT_PORT` for the desktop's CSP. |
| `apps/agent/README.md` | The built-in origins. |
| `apps/web/next.config.ts` | The export when `CLAWD_TARGET=desktop`. |
| `apps/desktop/build/renderer.mjs` | Runs the desktop build of the web app and copies the export to `dist/renderer`. |
| `apps/desktop/package.json` | `renderer` and `start` scripts; `dev` passes the dev server URL. |
| `apps/desktop/src/scheme.ts` | The scheme's constants, the mapper, the MIME table, the CSP and the handler. |
| `apps/desktop/src/args.ts` | `resolveRendererUrl` replaces `resolveDevUrl`. |
| `apps/desktop/src/main.ts` | Registers and handles the scheme; the private-network rung that works. |
| `apps/desktop/README.md` | Run with `start` or `dev`; the stage 3 note. |
| `README.md` (root) | The `apps/desktop` row says what stage 3 adds. |

---

### Task 1: The desktop origin and the agent's built-in origins

**Files:**
- Modify: `packages/core/src/schema/transport.ts:5-6`
- Modify: `apps/agent/src/http/guards.ts`
- Modify: `apps/agent/src/http/server.ts:9` (import) and `:133` (origin check)
- Modify: `apps/agent/src/config.ts:76`
- Modify: `apps/agent/src/index.ts`
- Modify: `apps/agent/README.md:62-63` and `:71`
- Test: `apps/agent/src/http/guards.test.ts`, `apps/agent/src/http/server.test.ts`, `apps/agent/src/config.test.ts`

**Interfaces:**
- Produces: `DESKTOP_ORIGIN = "app://clawd"` from `@clawd/core`; `BUILTIN_ORIGINS: readonly string[]` and `allowedOrigins(configured: readonly string[]): string[]` in `apps/agent/src/http/guards.ts`; `DEFAULT_PORT` from `@clawd/agent`.

The agent refuses any browser request whose `Origin` it does not know. The desktop's page has the origin `app://clawd`, so every agent must know it: the one inside the app, and the CLI's one the app attaches to. Built-ins need no config entry, so no user edits a file for it.

- [ ] **Step 1: Add the origin to core**

In `packages/core/src/schema/transport.ts`, after the `DEFAULT_AGENT_URL` line:

```ts
/** The desktop app's page origin: its static export is served over app://clawd/ (desktop design §6, §7). */
export const DESKTOP_ORIGIN = "app://clawd";
```

- [ ] **Step 2: Write the failing tests**

In `apps/agent/src/http/guards.test.ts`, change the import to:

```ts
import { BUILTIN_ORIGINS, allowedOrigins, checkOrigin, hostAllowed, tokenMatches } from "./guards";
```

and add this test after `sorts origins into none, allowed and denied`:

```ts
  it("allows the local web origins and the desktop app's before any configured ones", () => {
    expect(BUILTIN_ORIGINS).toEqual(["http://localhost:3000", "http://127.0.0.1:3000", "app://clawd"]);
    expect(allowedOrigins([])).toEqual(BUILTIN_ORIGINS);
    expect(allowedOrigins(["https://clawd.example"])).toEqual([...BUILTIN_ORIGINS, "https://clawd.example"]);
  });
```

In `apps/agent/src/http/server.test.ts`, add `DESKTOP_ORIGIN` to the `@clawd/core` import on line 1:

```ts
import { DEFAULT_CONFIG, DESKTOP_ORIGIN, HealthSchema, SnapshotSchema, emptyAliasMap, type Snapshot } from "@clawd/core";
```

and add this test after `gives an allowed origin CORS headers and refuses any other origin outright`:

```ts
  it("allows the built-in origins, the desktop app's among them, with no origins configured", async () => {
    const { port } = await start({ config: { allowlist: [ALLOWED_ROOT], token: TOKEN, corsOrigins: [] } });
    for (const origin of [DESKTOP_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"]) {
      const reply = await send(port, { path: "/api/health", headers: { origin } });
      expect(reply.status).toBe(200);
      expect(reply.headers["access-control-allow-origin"]).toBe(origin);
    }
    expect((await send(port, { path: "/api/stream", headers: { origin: "app://other" } })).status).toBe(403);
  });
```

In `apps/agent/src/config.test.ts`, replace the first test in `describe("config")`, lines 52-58, with:

```ts
  it("defaults to port 4750, an empty allowlist, no extra origins and a fresh 64-hex token", () => {
    const a = defaultConfig();
    expect(a).toMatchObject({ version: 1, port: DEFAULT_PORT, allowlist: [], corsOrigins: [], pollIntervalMs: 10_000, claudeCommand: "claude", logRetentionDays: 7 });
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(defaultConfig().token).not.toBe(a.token);
    expect(AgentConfigSchema.parse(a)).toEqual(a);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/http/guards.test.ts src/http/server.test.ts src/config.test.ts`
Expected: FAIL, three tests. The guards test finds `BUILTIN_ORIGINS` undefined, the server test gets `403` for `app://clawd`, and the config test finds the two localhost origins in `corsOrigins`.

- [ ] **Step 4: Build the origins in**

In `apps/agent/src/http/guards.ts`, add at the top:

```ts
import { DESKTOP_ORIGIN } from "@clawd/core";
```

and after `checkOrigin`:

```ts
/** Origins every agent accepts with no configuration: the web app's dev server and the desktop app's page. */
export const BUILTIN_ORIGINS: readonly string[] = ["http://localhost:3000", "http://127.0.0.1:3000", DESKTOP_ORIGIN];

/** The built-in origins, then those the config adds. A config that still lists a built-in one is harmless. */
export function allowedOrigins(configured: readonly string[]): string[] {
  return [...BUILTIN_ORIGINS, ...configured];
}
```

In `apps/agent/src/http/server.ts`, change the guards import to:

```ts
import { allowedOrigins, checkOrigin, hostAllowed, tokenMatches } from "./guards";
```

and the first line of `handleApi` to:

```ts
    const origin = checkOrigin(req.headers.origin, allowedOrigins(deps.config.corsOrigins));
```

In `apps/agent/src/config.ts`, in `defaultConfig`, replace the `corsOrigins` line with:

```ts
    // Added to the built-in origins (http/guards.ts), which need no entry here.
    corsOrigins: [],
```

In `apps/agent/src/index.ts`, add `DEFAULT_PORT` to the names exported from `./config`, so that line reads:

```ts
export { ConfigError, DEFAULT_PORT, agentPaths, defaultConfig, defaultHome, readConfig, saveConfig, type AgentConfig, type AgentPaths } from "./config";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/agent && npx vitest run src/http/guards.test.ts src/http/server.test.ts src/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Update the agent README**

In `apps/agent/README.md`, replace lines 62-63:

```markdown
Browsers may call these only from a built-in origin (`http://localhost:3000`, `http://127.0.0.1:3000`
and the desktop app's `app://clawd`) or one added to `corsOrigins`. `/ingest/hook` and `/ingest/status`
are for the hook scripts and need the token from `config.json`.
```

and in the files table, change the `config.json` row's `CORS origins` to `extra CORS origins`.

- [ ] **Step 7: Run every check**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/schema/transport.ts apps/agent/src/http/guards.ts apps/agent/src/http/guards.test.ts apps/agent/src/http/server.ts apps/agent/src/http/server.test.ts apps/agent/src/config.ts apps/agent/src/config.test.ts apps/agent/src/index.ts apps/agent/README.md
git commit -m "feat(agent): the desktop app's origin and the local web origins are built in; corsOrigins defaults to empty"
```

---

### Task 2: The static export

**Files:**
- Modify: `apps/web/next.config.ts`
- Create: `apps/desktop/build/renderer.mjs`
- Modify: `apps/desktop/package.json` (scripts)

**Interfaces:**
- Produces: `pnpm --filter @clawd/desktop renderer`, which leaves the export in `apps/desktop/dist/renderer` with `index.html` at its root.

Nothing here has unit tests: it is build configuration, and the check is the build's output. A trial export on 15 September 2026 built cleanly, prerendered `/` and `/_not-found` as static, and produced only `.css`, `.html`, `.ico`, `.js`, `.txt` and `.woff2` files, 1.7 MB in all. `index.html` has two inline scripts, which is why the CSP allows inline scripts.

- [ ] **Step 1: Give Next the desktop target**

`apps/web/next.config.ts`, replacing the whole file:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace packages export TypeScript source; Next compiles them as part of the app.
  transpilePackages: ["@clawd/core", "@clawd/scene"],
};

// The desktop app serves a static export over app://clawd/ with no Next server (desktop design §7).
// The cloud build and the dev server are unchanged.
if (process.env.CLAWD_TARGET === "desktop") {
  nextConfig.output = "export";
  nextConfig.images = { unoptimized: true };
}

export default nextConfig;
```

- [ ] **Step 2: Check the cloud build is unchanged**

Run from the repository root:

```
if (Test-Path apps/web/out) { Remove-Item apps/web/out -Recurse -Force }
pnpm --filter web build
Test-Path apps/web/out
```

Expected: the build succeeds and `Test-Path` prints `False`: without the flag there is no export.

- [ ] **Step 3: Write the renderer build**

`apps/desktop/build/renderer.mjs`:

```js
// Builds the web app as a static export and copies it to dist/renderer, where the app:// handler
// serves it from. The Next build runs in apps/web with CLAWD_TARGET=desktop.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const webDir = here("../../web");
const exportDir = join(webDir, "out");
const rendererDir = here("../dist/renderer");

// Next's own CLI, run with this Node and no shell, so the environment variable is set the same way on Windows.
const nextBin = createRequire(join(webDir, "package.json")).resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextBin, "build"], { cwd: webDir, env: { ...process.env, CLAWD_TARGET: "desktop" }, stdio: "inherit" });
if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(join(exportDir, "index.html"))) {
  console.error("renderer: the build finished without apps/web/out/index.html; check next.config.ts sets output: \"export\" for CLAWD_TARGET=desktop");
  process.exit(1);
}
await rm(rendererDir, { recursive: true, force: true });
await cp(exportDir, rendererDir, { recursive: true });
console.log("renderer: copied the export to dist/renderer");
```

- [ ] **Step 4: Add the script**

In `apps/desktop/package.json`, in `scripts`, after `"bundle"`:

```json
    "renderer": "node build/renderer.mjs",
```

- [ ] **Step 5: Build the export and look at it**

Run from the repository root: `pnpm --filter @clawd/desktop renderer`
Expected: Next's route table lists `○ /` and `○ /_not-found` as static, then `renderer: copied the export to dist/renderer`.

Run:

```
Get-ChildItem apps/desktop/dist/renderer -Recurse -File | Group-Object Extension | Sort-Object Name | Select-Object Name, Count
Test-Path apps/desktop/dist/renderer/index.html
```

Expected: only `.css`, `.html`, `.ico`, `.js`, `.txt` and `.woff2`, then `True`. The counts change with the build. If any other extension appears, add it to `MIME_TYPES` in Task 3 with its type and a line in the `mimeFor` test.

- [ ] **Step 6: Check nothing built is tracked**

Run: `git status --short`
Expected: only `apps/web/next.config.ts`, `apps/desktop/build/renderer.mjs` and `apps/desktop/package.json`. `apps/web/out` and `apps/desktop/dist` are ignored.

- [ ] **Step 7: Commit**

```bash
git add apps/web/next.config.ts apps/desktop/build/renderer.mjs apps/desktop/package.json
git commit -m "feat(desktop): CLAWD_TARGET=desktop builds the web app as a static export, copied to dist/renderer"
```

---

### Task 3: The `app://` scheme

**Files:**
- Create: `apps/desktop/src/scheme.ts`
- Test: `apps/desktop/src/scheme.test.ts`

**Interfaces:**
- Consumes: `DESKTOP_ORIGIN` from `@clawd/core` (Task 1).
- Produces: `APP_SCHEME = "app"`; `APP_HOST = "clawd"`; `APP_URL = "app://clawd/"`; `MIME_TYPES: Readonly<Record<string, string>>`; `mapRequest(url: string, rendererDir: string): string | null`; `mimeFor(file: string): string | null`; `contentSecurityPolicy(port: number): string`; `SchemeDeps = { rendererDir: string; port(): number; readFile?(path: string): Promise<Uint8Array> }`; `createSchemeHandler(deps: SchemeDeps): (request: { url: string }) => Promise<Response>`.

`protocol.handle` gives main a `Request` for each URL under the scheme and takes back a `Response`. Both are the standard Fetch types, which Node has as globals, so the handler is tested with plain objects and a temporary directory. The handler takes `{ url }` rather than a `Request`, so a test needs nothing more.

How Node's URL parser treats these URLs matters to the tests, and was checked on 15 September 2026. It resolves literal and `%2e` dot segments before the mapper sees the path, so `app://clawd/../../secret.txt` arrives as `/secret.txt`. It leaves `%2F`, `%5C` and `%00` encoded, so the mapper refuses what they decode to. It keeps the host's case, so the mapper lowercases it. It drops the query and hash from `pathname`, which Next's favicon link needs (`/favicon.ico?favicon.<hash>.ico`).

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/scheme.test.ts`:

```ts
import { DESKTOP_ORIGIN } from "@clawd/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_HOST, APP_SCHEME, APP_URL, contentSecurityPolicy, createSchemeHandler, mapRequest, mimeFor } from "./scheme";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-scheme-"));
  made.push(dir);
  return dir;
}

const ROOT = resolve("renderer-root");

describe("the app origin", () => {
  it("is core's desktop origin, so the window and the agent's CORS check agree", () => {
    expect(`${APP_SCHEME}://${APP_HOST}`).toBe(DESKTOP_ORIGIN);
    expect(APP_URL).toBe("app://clawd/");
  });
});

describe("mapRequest", () => {
  it("maps the root to index.html and any other path to that file under the renderer directory", () => {
    expect(mapRequest("app://clawd/", ROOT)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd", ROOT)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd/_next/static/chunks/a.js", ROOT)).toBe(join(ROOT, "_next", "static", "chunks", "a.js"));
    expect(mapRequest("app://CLAWD/index.txt", ROOT)).toBe(join(ROOT, "index.txt"));
  });

  it("ignores the query and the hash, and decodes the path", () => {
    expect(mapRequest("app://clawd/favicon.ico?favicon.2vob68tjqpejf.ico", ROOT)).toBe(join(ROOT, "favicon.ico"));
    expect(mapRequest("app://clawd/index.html#top", ROOT)).toBe(join(ROOT, "index.html"));
    expect(mapRequest("app://clawd/media/a%20b.woff2", ROOT)).toBe(join(ROOT, "media", "a b.woff2"));
  });

  it("keeps a path whose dot segments the URL parser resolved inside the directory", () => {
    expect(mapRequest("app://clawd/../../secret.txt", ROOT)).toBe(join(ROOT, "secret.txt"));
    expect(mapRequest("app://clawd/%2e%2e/secret.txt", ROOT)).toBe(join(ROOT, "secret.txt"));
  });

  it("refuses other schemes and hosts, encoded traversal, backslashes, drive letters, NUL, bad escapes and non-URLs", () => {
    for (const url of [
      "http://clawd/index.html",
      "app://settings/index.html",
      "app://clawd/..%2F..%2Fsecret.txt",
      "app://clawd/%5C..%5Csecret.txt",
      "app://clawd/C:/Windows/win.ini",
      "app://clawd/index.html%00.js",
      "app://clawd/%E0%A4%A",
      "not a url",
    ]) {
      expect(mapRequest(url, ROOT), url).toBeNull();
    }
  });
});

describe("mimeFor", () => {
  it("types the export's files from a fixed table, and nothing else", () => {
    expect(mimeFor(join(ROOT, "index.html"))).toBe("text/html; charset=utf-8");
    expect(mimeFor("a.JS")).toBe("text/javascript; charset=utf-8");
    expect(mimeFor("a.css")).toBe("text/css; charset=utf-8");
    expect(mimeFor("font.woff2")).toBe("font/woff2");
    expect(mimeFor("index.txt")).toBe("text/plain; charset=utf-8");
    expect(mimeFor("favicon.ico")).toBe("image/x-icon");
    expect(mimeFor("a.js.map")).toBe("application/json; charset=utf-8");
    expect(mimeFor("setup.exe")).toBeNull();
    expect(mimeFor("README")).toBeNull();
    expect(mimeFor("x.constructor")).toBeNull();
  });
});

describe("contentSecurityPolicy", () => {
  it("is the design's policy with the agent's port", () => {
    expect(contentSecurityPolicy(4750)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src http://127.0.0.1:4750 http://localhost:4750; frame-ancestors 'none'",
    );
  });
});

describe("createSchemeHandler", () => {
  it("serves a file with its type and the policy, and answers 404 with the policy for anything unmapped, untyped or missing", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>hi</p>");
    await writeFile(join(dir, "setup.exe"), "MZ");
    const handle = createSchemeHandler({ rendererDir: dir, port: () => 4750 });

    const page = await handle({ url: "app://clawd/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));
    expect(await page.text()).toBe("<p>hi</p>");

    for (const url of ["app://clawd/setup.exe", "app://clawd/missing.js", "app://clawd/..%2Fsecret.txt", "app://settings/"]) {
      const res = await handle({ url });
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));
    }
  });

  it("reads the port for each response, so the policy follows the agent in use", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "");
    let port = 4750;
    const handle = createSchemeHandler({ rendererDir: dir, port: () => port });
    port = 4800;
    expect((await handle({ url: "app://clawd/" })).headers.get("content-security-policy")).toContain("connect-src http://127.0.0.1:4800 http://localhost:4800;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/scheme.test.ts`
Expected: FAIL, "Failed to resolve import ./scheme".

- [ ] **Step 3: Write the module**

`apps/desktop/src/scheme.ts`:

```ts
// The app:// scheme: how the window's page and its files are served with no web server. Chromium
// hands main each request for app://clawd/<path>, and main answers from the static export copied to
// dist/renderer, with a Content Security Policy on every response. Electron-free, so it is tested.
import { DESKTOP_ORIGIN } from "@clawd/core";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "clawd";
/** Where the window loads the visualiser from when no dev URL is given. */
export const APP_URL = `${DESKTOP_ORIGIN}/`;

/** The only file types served. Anything else is 404, so a stray file in the export is never run. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  // Next's export writes its page payloads as .txt, and its router accepts them only as text/plain.
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

/**
 * The file an app:// URL names inside the renderer directory, or null. The URL parser has already
 * resolved dot segments; what decoding reveals (an encoded slash or backslash, a `..`, a drive
 * letter, a NUL) is refused, and the result must still lie inside the directory.
 */
export function mapRequest(url: string, rendererDir: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host.toLowerCase() !== APP_HOST) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  // ":" would let a segment name a drive or an alternate data stream on Windows.
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) return null;
  if (segments.length === 0) segments.push("index.html");
  const root = resolve(rendererDir);
  const file = resolve(root, ...segments);
  const inside = relative(root, file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return null;
  return file;
}

/** The served type of a file, by extension; null for any type not in the table. */
export function mimeFor(file: string): string | null {
  const ext = extname(file).slice(1).toLowerCase();
  return Object.hasOwn(MIME_TYPES, ext) ? (MIME_TYPES[ext] ?? null) : null;
}

/**
 * The page may load its own files, run the inline scripts Next's export emits, and reach only the
 * agent. The renderer is sandboxed too; the network limit is where this policy earns its keep.
 */
export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src http://127.0.0.1:${port} http://localhost:${port}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

export type SchemeDeps = {
  /** The directory holding the export: dist/renderer beside main.cjs. */
  rendererDir: string;
  /** The port of the agent in use, read for each response. */
  port(): number;
  readFile?(path: string): Promise<Uint8Array>;
};

/** The protocol.handle callback. Never rejects: anything it cannot serve is a 404. */
export function createSchemeHandler(deps: SchemeDeps): (request: { url: string }) => Promise<Response> {
  const read = deps.readFile ?? ((path: string) => readFile(path));
  return async (request) => {
    const policy = { "content-security-policy": contentSecurityPolicy(deps.port()) };
    const file = mapRequest(request.url, deps.rendererDir);
    const type = file === null ? null : mimeFor(file);
    if (file !== null && type !== null) {
      try {
        return new Response(await read(file), { status: 200, headers: { ...policy, "content-type": type } });
      } catch {
        // Missing or unreadable: the same 404 as a path that maps nowhere.
      }
    }
    return new Response("not found", { status: 404, headers: { ...policy, "content-type": "text/plain; charset=utf-8" } });
  };
}
```

- [ ] **Step 4: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS. Building a `Response` from `readFile`'s bytes type-checks under this package's TypeScript 5.9 and `@types/node`; this was checked on 15 September 2026.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/scheme.ts apps/desktop/src/scheme.test.ts
git commit -m "feat(desktop): the app:// scheme maps paths into the export, types files from a fixed table and sets the CSP"
```

---

### Task 4: Serve the export in the app, find the private-network rung, and write the stage note

**Files:**
- Modify: `apps/desktop/src/args.ts`
- Test: `apps/desktop/src/args.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/package.json` (scripts)
- Modify: `apps/desktop/README.md`
- Modify: `README.md` (root)

**Interfaces:**
- Consumes: `DEFAULT_PORT` from `@clawd/agent` (Task 1); `pnpm --filter @clawd/desktop renderer` (Task 2); `APP_SCHEME`, `APP_URL`, `createSchemeHandler` from `./scheme` (Task 3).
- Produces: `resolveRendererUrl(args: Args, env: Readonly<Record<string, string | undefined>>): string`, replacing `resolveDevUrl` and `DEFAULT_DEV_URL`; `pnpm --filter @clawd/desktop start`.

`main.ts` has no unit tests on purpose, as in stages 1 and 2. The check is running the app in step 7, which is also the design's smoke test: does the event stream connect from `app://clawd`?

- [ ] **Step 1: Write the failing test**

In `apps/desktop/src/args.test.ts`, change the import to:

```ts
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";
```

add this line at the end of the `parseArgs` test:

```ts
    expect(parseArgs(["--dev-url", "http://localhost:3000", "--dev-url", "http://localhost:3001"])).toEqual({ hidden: false, devUrl: "http://localhost:3001" });
```

and replace the `describe("resolveDevUrl", ...)` block with:

```ts
describe("resolveRendererUrl", () => {
  it("prefers the flag, then the environment, then the static export over app://clawd/", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" })).toBe("http://a");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "http://b" })).toBe("http://b");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "  " })).toBe("app://clawd/");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, {})).toBe("app://clawd/");
  });
});
```

The new `parseArgs` line documents what the `dev` script relies on: a `--dev-url` given after the script's own wins.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/args.test.ts`
Expected: FAIL, `resolveRendererUrl is not a function`.

- [ ] **Step 3: Change the fallback**

In `apps/desktop/src/args.ts`, add below the header comment:

```ts
import { APP_URL } from "./scheme";
```

delete `DEFAULT_DEV_URL`, and replace `resolveDevUrl` with:

```ts
/** Where the window loads from: the flag, else the environment, else the static export over app://clawd/. */
export function resolveRendererUrl(args: Args, env: Readonly<Record<string, string | undefined>>): string {
  const fromEnv = env.CLAWD_DESKTOP_URL?.trim();
  return args.devUrl ?? (fromEnv ? fromEnv : APP_URL);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/args.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the scheme into the main process**

`apps/desktop/src/main.ts`, replacing the whole file:

```ts
// The main process: the one Node program in the app. It owns the lifecycle and the windows and,
// from stage 2, runs the agent itself; Chromium draws, in a sandboxed renderer process per window.
import { DEFAULT_PORT, agentPaths, createLogger, defaultHome, startAgent } from "@clawd/agent";
import { app, protocol, type BrowserWindow } from "electron";
import { join } from "node:path";
import { fetchCounts, probeHealth } from "./agent-client";
import { createAgentHost, statusText } from "./agent-host";
import { ownArgs, parseArgs, resolveRendererUrl } from "./args";
import { createFileSink, readRetentionDays } from "./log";
import { createQuitHandler } from "./quit";
import { APP_SCHEME, createSchemeHandler } from "./scheme";
import { createMainWindow } from "./window";

const args = parseArgs(ownArgs(process.argv, app.isPackaged));
const url = resolveRendererUrl(args, process.env);
const home = defaultHome();

// A custom scheme is declared before `ready`, with what it may do. `standard` makes app://clawd/
// behave like http: relative and root-relative URLs resolve under it and the page's origin is
// app://clawd. `secure` makes the page a secure context. `supportFetchAPI` lets it fetch its own files.
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// The agent's own logger, writing to a dated file: codes and numbers only. In development the
// lines also reach the terminal that ran the dev command.
const sink = createFileSink(agentPaths(home).logs, { now: Date.now, retentionDays: () => readRetentionDays(home) });
const log = createLogger((line) => {
  sink.write(line);
  if (!app.isPackaged) process.stdout.write(line);
});

let win: BrowserWindow | null = null;

const host = createAgentHost({
  start: (onSnapshot) => startAgent({ home, log, onSnapshot }),
  probe: (port) => probeHealth(port),
  counts: (port) => fetchCounts(port),
  log,
  onChange: (state) => {
    if (win !== null && !win.isDestroyed()) win.setTitle(statusText(state));
  },
});

// Without these, an error nothing caught ends the app behind Electron's crash dialog. The host
// logs it by code and restarts the agent when the app owns it.
process.on("uncaughtException", () => host.fault());
process.on("unhandledRejection", () => host.fault());

// `ready` fires once Electron has initialised; no window can be made before it.
void app.whenReady().then(() => {
  // Every app:// request is answered from the export beside main.cjs, under a CSP that lets the
  // page reach only the agent in use.
  protocol.handle(APP_SCHEME, createSchemeHandler({ rendererDir: join(__dirname, "renderer"), port: () => host.state().port ?? DEFAULT_PORT }));
  log("desktop.started", { packaged: app.isPackaged });
  host.start();
  win = createMainWindow(url, statusText(host.state()));
  win.on("closed", () => {
    win = null;
  });
});

// Stage 3 still quits when the window closes; stage 4 hides it instead and keeps the tray.
app.on("window-all-closed", () => app.quit());

// `will-quit` comes after every window has closed. The handler holds it until the agent has stopped
// (at most five seconds), writes out the log, then exits.
app.on("will-quit", createQuitHandler({ stop: () => host.stop(), flush: () => sink.flush(), exit: (code) => app.exit(code), log }));

// Ctrl+C in the terminal asks for the same sequence.
process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());
```

- [ ] **Step 6: Point the scripts at the right page, then bundle**

In `apps/desktop/package.json`, set `scripts.dev` and add `scripts.start` after it:

```json
    "dev": "node build/bundle.mjs && electron . --dev-url http://localhost:3000",
    "start": "node build/renderer.mjs && node build/bundle.mjs && electron .",
```

Run: `cd apps/desktop && npx tsc --noEmit && pnpm bundle`
Expected: no type errors; esbuild writes `dist/main.cjs` and its map with no warnings.

Run from the repository root: `grep -cE 'require\("(zod|@clawd/[a-z]+)"\)' apps/desktop/dist/main.cjs`
Expected: `0`.

- [ ] **Step 7: The smoke test: run from the export and find the private-network rung (pause here for the maintainer)**

Stop the Next dev server and any CLI agent. Confirm nothing serves either port. Both commands print nothing:

```
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 4750 -State Listen -ErrorAction SilentlyContinue
```

Run from the repository root: `pnpm --filter @clawd/desktop start`

The window title shows the counts, as in stage 2. Wait a few seconds, then read the badge at the top right.

- **Rung 1, nothing added.** The badge reads `live · 127.0.0.1:4750`, and sending a prompt in an allowlisted Claude Code session sets its Clawd working. Keep `main.ts` as it is and go to step 8.
- **Otherwise** the badge reads simulated. Press Ctrl+Shift+I to open DevTools and read the Console. A message naming the loopback or local address space, a private network or a local network permission means Chromium blocked the page from reaching the agent. Close the app and try rung 2.

**Rung 2, grant the permission to the app's page.** In `main.ts`, add `session` to the Electron import, and add these imports:

```ts
import { DESKTOP_ORIGIN } from "@clawd/core";
import { APP_SCHEME, APP_URL, createSchemeHandler } from "./scheme";
```

replacing the existing `./scheme` import. Then add at the start of the `whenReady` callback, before `protocol.handle`:

```ts
  // Chromium asks before a page reaches a loopback address. The app's own page may; every other
  // permission keeps Electron's default, which is to allow.
  const LOCAL_NETWORK: ReadonlySet<string> = new Set(["local-network-access", "local-network", "loopback-network"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(!LOCAL_NETWORK.has(permission) || details.requestingUrl.startsWith(APP_URL));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => !LOCAL_NETWORK.has(permission) || requestingOrigin === DESKTOP_ORIGIN);
```

The three names are the local-network permissions in Electron 44's typings. Run `cd apps/desktop && npx tsc --noEmit && pnpm bundle && npx electron .`. The export is already built, so this skips the renderer build. If the badge reads live, keep this code and go to step 8. Otherwise, close the app, remove the rung 2 code and imports, and try rung 3.

**Rung 3, turn the checks off.** In `main.ts`, directly after the `protocol.registerSchemesAsPrivileged` line:

```ts
// On this Electron, Chromium's private and local network checks block the page from reaching the
// agent even with the preflight answered. The CSP's connect-src still limits the page to the agent.
app.commandLine.appendSwitch("disable-features", "PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks");
```

Run `cd apps/desktop && npx tsc --noEmit && pnpm bundle && npx electron .`. If the badge reads live, keep this and go to step 8. If it still reads simulated, stop and report the Console's messages to the maintainer. The design has no fourth rung.

Write down which rung worked. Step 9 needs it.

- [ ] **Step 8: Walk the rest of the checklist**

With the app running on the export and the badge live:

- The DevTools Console shows no `Refused to` lines from the Content Security Policy while the scene runs and the detail sheet opens on a session.
- In the Console, each of these gives the result shown:

  ```js
  location.origin                                               // "app://clawd"
  (await fetch("app://clawd/index.txt")).headers.get("content-type")   // "text/plain; charset=utf-8"
  (await fetch("app://clawd/..%2F..%2Fmain.cjs")).status        // 404
  await fetch("https://example.com").catch((e) => e.name)       // "TypeError", with a "Refused to connect" line above it
  ```

- The log has `desktop.started` and `agent.started`, and nothing new: `Get-Content "$HOME\.clawd\logs\desktop-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log"`.
- Attach through the new origin. Close the app, start the CLI agent (`pnpm --filter @clawd/agent start`), then `cd apps/desktop && npx electron .`. The title ends `· agent attached` and the badge reads live. The CLI's agent runs the same code, so it accepts `app://clawd` with no config change.
- The dev loop is unchanged. Close the app and the CLI agent. Run `pnpm dev` and then `pnpm --filter @clawd/desktop dev`. The window loads `http://localhost:3000`, the badge reads live, and a change to a web component hot-reloads.

- [ ] **Step 9: Update the READMEs**

In `apps/desktop/README.md`, replace the whole `## Run (development)` section, from its heading to just before `## Stage notes`, with:

````markdown
## Run

Build the web app into the desktop app and open it. Nothing else needs to be running:

```
pnpm --filter @clawd/desktop start
```

`start` builds the web app as a static export, copies it to `dist/renderer`, bundles `src/main.ts`
into `dist/main.cjs` and opens the window on `app://clawd/`. The agent runs inside the app. If an
agent is already serving its port (the CLI's `pnpm --filter @clawd/agent start`), the app attaches
to it instead and starts its own when that one stops; the window title says which. The app's log is
`~/.clawd/logs/desktop-YYYY-MM-DD.log`, and in development the same lines print to the terminal.

For work on the page, the dev loop loads the Next dev server instead, with hot reload:

```
pnpm dev
pnpm --filter @clawd/desktop dev
```

`--dev-url <url>` or `CLAWD_DESKTOP_URL` point the window elsewhere, for example
`pnpm --filter @clawd/desktop dev --dev-url "http://localhost:3000/?source=simulated"`. A change
under `src/` needs the command run again.

```
pnpm --filter @clawd/desktop test
pnpm --filter @clawd/desktop typecheck
```
````

Append after the Stage 2 note. Replace the bracketed sentence with the one line below the block that matches the rung from step 7, and delete the other two:

```markdown
### Stage 3: the packaged UI

A web page usually comes from a server. This one comes from files on disk: the web app's static
export, copied to `dist/renderer`. `protocol.handle("app", handler)` lets the main process answer
every request for an `app://` URL itself, so there is no server and no extra port. Chromium asks,
main maps the path to a file, and the answer is a standard `Response`.

**Declaring the scheme.** Chromium has to know a scheme's rules before it starts, so
`protocol.registerSchemesAsPrivileged` runs before `ready`. `standard` makes `app://clawd/` behave
like `http`: the export's root-relative links, such as `/_next/static/...`, resolve under it, and
the page gets a real origin. `secure` makes the page a secure context, as `https` would.
`supportFetchAPI` lets the page `fetch` its own files, which Next's router does. `scheme.ts` refuses
any path that decodes to somewhere outside the export, and serves only the file types in its table.

**Origins.** The page's origin is `app://clawd`, and Chromium sends it in the `Origin` header when the
page calls the agent. The agent refuses origins it does not know, so `app://clawd` is now one of its
built-ins beside the Next dev server's, for the CLI's agent too. One trap: Node's
`new URL("app://clawd").origin` is the string `"null"` for any custom scheme, which is why
`navigation.ts` compares scheme and host by hand.

**Content Security Policy.** Because main writes every response, it also sets the page's security
policy in a header. The policy lets the page load its own scripts, styles and fonts, and reach only
the agent's port; `fetch("https://example.com")` from DevTools is refused. Inline scripts are
allowed because Next's export writes two into `index.html`.

**Private network checks.** Chromium treats a page calling a loopback address as reaching into a
more private network, and may send a preflight first or ask for a permission. The agent already
answers that preflight. [Rung sentence.]

Two ways to run it follow from this: `start` builds the export and loads `app://clawd/`, and `dev`
loads the Next dev server for hot reload. What stage 3 leaves in place: launching the app is enough;
no dev server and no CLI agent are needed. Closing the window still stops the agent and quits, until
stage 4's tray.
```

- Rung 1: `On Electron 44 that was enough: the event stream connected with nothing added in main.`
- Rung 2: `On Electron 44 Chromium also asked for its local network permission, so main grants it to app://clawd, and only to that page, in setPermissionRequestHandler and setPermissionCheckHandler.`
- Rung 3: `On Electron 44 the checks blocked the stream even with the permission granted, so main turns them off with the disable-features switch before ready. The policy's connect-src still limits the page to the agent.`

In the root `README.md` layout table, replace the `apps/desktop` row with:

```markdown
| `apps/desktop` | The Electron app, built in stages: the agent and the visualiser in one window and the tray, run from a folder. Stage 3 serves the web app's static export over `app://clawd/`, so launching the app is enough; the dev loop still loads the Next dev server. See its README. |
```

- [ ] **Step 10: Run every check and commit**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add apps/desktop/src/args.ts apps/desktop/src/args.test.ts apps/desktop/src/main.ts apps/desktop/package.json apps/desktop/README.md README.md
git commit -m "feat(desktop): the window loads the static export over app://clawd/ with no dev server; start builds it"
```

Then hand the branch back with the finishing-a-development-branch skill. Stage 4 (the tray) starts from `main` once this is merged.
