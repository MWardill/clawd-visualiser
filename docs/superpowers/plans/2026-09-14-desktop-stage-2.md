# Desktop Stage 2 (Agent inside) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app runs the agent inside its own main process, attaching to an agent that is already serving and taking over when it stops, restarting after faults, logging to a dated file, and quitting cleanly.

**Architecture:** `agent-host.ts` is the supervisor: an Electron-free state machine over injected `start`, `probe` and `counts` functions, tested with vitest's fake clock. `agent-client.ts` asks an agent on a port for its health and its counts. `log.ts` is the dated file sink for the agent's own `createLogger`. `quit.ts` holds `will-quit` until the host has stopped, capped at five seconds. `main.ts` only wires these to Electron. The agent gains a public entry, the `onSnapshot` option and the `desktop.*` log codes.

**Tech Stack:** Electron 44, esbuild 0.28, vitest 5, TypeScript 5, pnpm 12 workspaces; `@clawd/agent` and `@clawd/core` bundled into `dist/main.cjs`.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, sections 3, 4, 5, 6, 10 and stage 2 of section 12.

**Stage idea:** the main process is Node. Stage 1 used it only to open a window; this stage runs a whole HTTP server, a poller and a file log in it, beside the window code, on one event loop. That brings two things a web page never has to think about: how the process ends (Electron's quit sequence, and holding it open while the agent writes out its log) and what happens when something throws with nobody to catch it (by default Electron shows a crash dialog; here the fault goes to a supervisor that restarts the agent).

## Global Constraints

- Windows only. Nothing is built or tested elsewhere.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The package has no runtime dependencies. `@clawd/agent` and `@clawd/core` are dev dependencies, bundled by esbuild.
- Log lines carry a time, a code and numbers or booleans only. A `ConfigError` message may be shown in the app, never logged.
- Host states: `starting → own | attached | failed`; `own → restarting → own | failed`; `attached → own`. The attached poll is every 10 s; the health probe answers within 500 ms or counts as silent.
- Restart backoff: 1, 2, 4, 8 then 16 s, indexed by the faults already inside the last five minutes. A fault that finds five there goes to failed. (The spec says "five faults inside five minutes lead to failed" and also lists a 16 s step; this reading keeps both: five restarts, and the sixth fault fails.)
- Quit: `will-quit` is held until `host.stop()` resolves, capped at five seconds, then `app.exit(0)`.
- Log file: `~/.clawd/logs/desktop-YYYY-MM-DD.log` (UTC day), retention from `logRetentionDays`, seven days when the config is missing or unusable.
- New log codes this stage: `desktop.started`, `desktop.attached`, `desktop.takeover`, `desktop.agentFault`, `desktop.agentFailed`, `desktop.stopTimedOut`. Stages 4 and 5 add `desktop.loginItemReapplied` and `desktop.hooksRepaired`.
- The window still loads the Next dev server; stage 3 replaces it. "No other process runs" in the done-when means no agent process: the Next dev server is still expected.
- Each stage note explains the Electron idea it introduces, in plain words, for a maintainer learning Electron.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-2` in the worktree `C:\mw\visualiser-desktop`, cut from `main` with `feat/desktop-stage-1` merged in (stage 1 was not yet on `main`). Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/agent/src/index.ts` | The agent's public entry for hosts other than the CLI. |
| `apps/agent/package.json` | `main`, `types` and `exports` point at `src/index.ts`, as core's do. |
| `apps/agent/src/agent.ts` | `AgentOptions.onSnapshot`, wired as one more host listener. |
| `apps/agent/src/log.ts` | The `desktop.*` codes join the closed set. |
| `apps/desktop/package.json` | `@clawd/agent` and `@clawd/core` as dev dependencies. |
| `apps/desktop/src/log.ts` | The dated file sink with retention, and reading the retention from the config. |
| `apps/desktop/src/agent-client.ts` | Health probe and session counts from an agent on a port; `countsOf(snapshot)`. |
| `apps/desktop/src/testing/snapshot.ts` | A valid snapshot for tests. |
| `apps/desktop/src/quit.ts` | `settleWithin` and the `will-quit` handler. |
| `apps/desktop/src/agent-host.ts` | The supervisor: states, attach and takeover, backoff, stop; `statusText` for the title. |
| `apps/desktop/src/window.ts` | The window takes its title from main and ignores the page's `<title>`. |
| `apps/desktop/src/main.ts` | Wiring: logger, host, error handlers, quit handler, window title. |
| `apps/desktop/README.md` | Run without the CLI agent; the stage 2 note. |
| `README.md` (root) | The `apps/desktop` row says what stage 2 adds. |

---

### Task 1: The agent's public entry, `onSnapshot` and the desktop log codes

**Files:**
- Create: `apps/agent/src/index.ts`
- Modify: `apps/agent/package.json`
- Modify: `apps/agent/src/agent.ts:16-29` (options) and `:99-104` (listeners)
- Modify: `apps/agent/src/log.ts:6-30`
- Test: `apps/agent/src/agent.test.ts`

**Interfaces:**
- Produces: `import { startAgent, PortInUseError, ConfigError, agentPaths, defaultConfig, defaultHome, readConfig, saveConfig, createLogger, silentLogger, type AgentOptions, type RunningAgent, type AgentConfig, type AgentPaths, type LogCode, type LogFields, type Logger } from "@clawd/agent"`; `AgentOptions.onSnapshot?: (s: Snapshot) => void`; the six `desktop.*` codes in `LogCode`.

- [ ] **Step 1: Write the failing test**

In `apps/agent/src/agent.test.ts`, add `import type { Snapshot } from "@clawd/core";` below the first import, and add this test inside `describe("startAgent")`, after the restart test:

```ts
  it("hands each changed snapshot to onSnapshot, as the stream gets it", async () => {
    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT] };
    await saveConfig(agentPaths(home), config);
    const seen: Snapshot[] = [];
    const agent = await startAgent({ home, port: 0, exec: async () => ({ ok: true, stdout: "[]" }), log: silentLogger, platform: "linux", transcriptsDir: await tempDir(), onSnapshot: (s) => seen.push(s) });
    try {
      await send(agent.port, { method: "POST", path: "/ingest/hook", headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(rawHook("UserPromptSubmit", "s1")) });
      await waitFor(() => seen.some((s) => s.sessions.length === 1));
    } finally {
      await agent.stop();
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/agent && npx vitest run src/agent.test.ts`
Expected: FAIL. `tsc` would reject `onSnapshot`; vitest does not type-check, so the failure is `condition not met in time` from `waitFor`.

- [ ] **Step 3: Add the option and wire it**

In `apps/agent/src/agent.ts`, add `type Snapshot` to the `@clawd/core` import:

```ts
import { DEFAULT_CONFIG, type Snapshot, type StateConfig } from "@clawd/core";
```

In `AgentOptions`, after `transcriptsDir`:

```ts
  /** Each changed snapshot, as the stream receives it. The desktop app counts sessions from it. */
  onSnapshot?: (s: Snapshot) => void;
```

After the existing `host.on({ ... });` block:

```ts
  // One more listener, so a throwing callback is caught and logged by the host like any other.
  if (opts.onSnapshot) host.on({ snapshot: opts.onSnapshot });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/agent && npx vitest run src/agent.test.ts`
Expected: PASS, four tests.

- [ ] **Step 5: Add the desktop codes**

In `apps/agent/src/log.ts`, in `LogCode`, after `| "config.emptyAllowlist"`:

```ts
  | "desktop.started"
  | "desktop.attached"
  | "desktop.takeover"
  | "desktop.agentFault"
  | "desktop.agentFailed"
  | "desktop.stopTimedOut"
```

- [ ] **Step 6: Give the package an entry**

`apps/agent/src/index.ts`:

```ts
// The agent's public surface for hosts other than the CLI. The desktop app runs the agent in its
// own main process through these.
export { PortInUseError, startAgent, type AgentOptions, type RunningAgent } from "./agent";
export { ConfigError, agentPaths, defaultConfig, defaultHome, readConfig, saveConfig, type AgentConfig, type AgentPaths } from "./config";
export { createLogger, silentLogger, type LogCode, type LogFields, type Logger } from "./log";
```

In `apps/agent/package.json`, after `"type": "module",`:

```json
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
```

- [ ] **Step 7: Run the agent's checks**

Run: `cd apps/agent && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/agent/src/index.ts apps/agent/package.json apps/agent/src/agent.ts apps/agent/src/agent.test.ts apps/agent/src/log.ts
git commit -m "feat(agent): a public entry for in-process hosts, the onSnapshot option and the desktop log codes"
```

---

### Task 2: The desktop's file log

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/log.ts`
- Test: `apps/desktop/src/log.test.ts`

**Interfaces:**
- Consumes: `agentPaths`, `readConfig`, `defaultConfig`, `saveConfig` from `@clawd/agent` (Task 1).
- Produces: `logFileName(ms: number): string`; `FileSink = { write(line: string): void; flush(): Promise<void> }`; `createFileSink(dir: string, deps: { now: () => number; retentionDays: () => Promise<number> }): FileSink`; `readRetentionDays(home: string): Promise<number>`; `DEFAULT_RETENTION_DAYS`.

The agent's `createLogger(write)` already turns a code and numbers into one JSON line; it takes any `write`. This task gives it a file to write to. Retention is read lazily, at the first write, so main can make the logger synchronously before `ready`.

- [ ] **Step 1: Add the workspace packages and install**

In `apps/desktop/package.json`, at the top of `devDependencies`:

```json
    "@clawd/agent": "workspace:*",
    "@clawd/core": "workspace:*",
```

Run from the repository root: `pnpm install`
Expected: the lockfile's `apps/desktop` importer gains both links; nothing is downloaded.

- [ ] **Step 2: Write the failing tests**

`apps/desktop/src/log.test.ts`:

```ts
import { agentPaths, defaultConfig, saveConfig } from "@clawd/agent";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_DAYS, createFileSink, logFileName, readRetentionDays } from "./log";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-desktop-"));
  made.push(dir);
  return dir;
}

const DAY_MS = 86_400_000;
const T = Date.UTC(2026, 8, 14, 10, 0, 0);
const sevenDays = async (): Promise<number> => 7;

describe("createFileSink", () => {
  it("appends lines in order to the UTC day's file, making the directory", async () => {
    const dir = join(await tempDir(), "logs");
    const sink = createFileSink(dir, { now: () => T, retentionDays: sevenDays });
    sink.write("a\n");
    sink.write("b\n");
    await sink.flush();
    expect(logFileName(T)).toBe("desktop-2026-09-14.log");
    expect(await readFile(join(dir, "desktop-2026-09-14.log"), "utf8")).toBe("a\nb\n");
  });

  it("starts a new file when the day changes", async () => {
    const dir = await tempDir();
    let now = T;
    const sink = createFileSink(dir, { now: () => now, retentionDays: sevenDays });
    sink.write("today\n");
    now = T + DAY_MS;
    sink.write("tomorrow\n");
    await sink.flush();
    expect((await readdir(dir)).sort()).toEqual(["desktop-2026-09-14.log", "desktop-2026-09-15.log"]);
  });

  it("removes its own day files older than the retention when it opens a day, and nothing else", async () => {
    const dir = await tempDir();
    for (const name of ["desktop-2026-09-01.log", "desktop-2026-09-13.log", "events-2026-09-01.jsonl", "notes.txt"]) {
      await writeFile(join(dir, name), "x\n");
    }
    const sink = createFileSink(dir, { now: () => T, retentionDays: sevenDays });
    sink.write("a\n");
    await sink.flush();
    expect((await readdir(dir)).sort()).toEqual(["desktop-2026-09-13.log", "desktop-2026-09-14.log", "events-2026-09-01.jsonl", "notes.txt"]);
  });

  it("never rejects, even when it cannot write", async () => {
    const inTheWay = join(await tempDir(), "a-file");
    await writeFile(inTheWay, "");
    const sink = createFileSink(join(inTheWay, "logs"), { now: () => T, retentionDays: sevenDays });
    sink.write("a\n");
    await expect(sink.flush()).resolves.toBeUndefined();
  });
});

describe("readRetentionDays", () => {
  it("reads logRetentionDays from the agent's config, and falls back to seven days when it is missing or unusable", async () => {
    const home = await tempDir();
    expect(await readRetentionDays(home)).toBe(DEFAULT_RETENTION_DAYS);
    await saveConfig(agentPaths(home), { ...defaultConfig(), logRetentionDays: 3 });
    expect(await readRetentionDays(home)).toBe(3);
    await writeFile(agentPaths(home).config, "{ not json");
    expect(await readRetentionDays(home)).toBe(7);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/log.test.ts`
Expected: FAIL, "Failed to resolve import ./log".

- [ ] **Step 4: Write the module**

`apps/desktop/src/log.ts`:

```ts
// Where the app's log lines go: one file per UTC day under ~/.clawd/logs, beside the agent's event
// log. The lines themselves come from the agent's createLogger, so they hold codes and numbers only.
import { agentPaths, readConfig } from "@clawd/agent";
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const DAY_MS = 86_400_000;
const FILE = /^desktop-(\d{4}-\d{2}-\d{2})\.log$/;

/** The agent's default, used when its config is missing or cannot be read. */
export const DEFAULT_RETENTION_DAYS = 7;

export function logFileName(ms: number): string {
  return `desktop-${new Date(ms).toISOString().slice(0, 10)}.log`;
}

export type FileSink = {
  write(line: string): void;
  /** Resolves once every line written so far is on disk, or has failed. Never rejects. */
  flush(): Promise<void>;
};

/**
 * Appends each line to the day's file, in order. Opening a day's file first removes this sink's
 * own files older than the retention. A write that fails is dropped: there is nowhere to log it.
 */
export function createFileSink(dir: string, deps: { now: () => number; retentionDays: () => Promise<number> }): FileSink {
  let chain: Promise<void> = Promise.resolve();
  let opened: string | null = null;
  return {
    write(line) {
      const name = logFileName(deps.now());
      chain = chain
        .then(async () => {
          if (name !== opened) {
            opened = name;
            await mkdir(dir, { recursive: true });
            try {
              await sweep(dir, deps.now(), await deps.retentionDays());
            } catch {
              // Retention is housekeeping; the line still goes in.
            }
          }
          await appendFile(join(dir, name), line);
        })
        .catch(() => {});
    },
    flush: () => chain,
  };
}

async function sweep(dir: string, now: number, retentionDays: number): Promise<void> {
  const cutoff = now - retentionDays * DAY_MS;
  for (const name of await readdir(dir)) {
    const day = FILE.exec(name)?.[1];
    if (day === undefined) continue;
    if (Date.parse(`${day}T00:00:00.000Z`) + DAY_MS > cutoff) continue;
    await rm(join(dir, name), { force: true });
  }
}

/** `logRetentionDays` from the agent's config; the default when there is no usable config yet. */
export async function readRetentionDays(home: string): Promise<number> {
  try {
    return (await readConfig(agentPaths(home)))?.logRetentionDays ?? DEFAULT_RETENTION_DAYS;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS. The type check now follows `@clawd/agent` into the agent's sources; it resolves `zod` from the agent's own `node_modules`, since pnpm links are followed to their real paths.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/log.ts apps/desktop/src/log.test.ts
git commit -m "feat(desktop): a dated file sink for the agent's logger, with retention from the agent's config"
```

---

### Task 3: Asking an agent on a port for its health and its counts

**Files:**
- Create: `apps/desktop/src/agent-client.ts`
- Create: `apps/desktop/src/testing/snapshot.ts`
- Test: `apps/desktop/src/agent-client.test.ts`

**Interfaces:**
- Consumes: `ENDPOINTS`, `SnapshotSchema`, `type Snapshot`, `type SessionPhase` from `@clawd/core`.
- Produces: `Counts = { sessions: number; waiting: number }`; `countsOf(s: Snapshot): Counts`; `probeHealth(port: number, timeoutMs?: number): Promise<boolean>`; `fetchCounts(port: number, timeoutMs?: number): Promise<Counts | null>`; `PROBE_TIMEOUT_MS = 500`; test helper `snapshot(states: readonly SessionPhase[]): Snapshot`.

The host uses these when the port is taken: is it an agent, and how many sessions does it have? Both run in the main process with Node's global `fetch`, which sends no `Origin` header, so the agent's CORS check lets them through as it does `curl`. The probe accepts any body with `ok: true` rather than parsing `HealthSchema`, which is strict: a newer CLI agent with one more field would otherwise look silent and the app would try to take over a live agent.

- [ ] **Step 1: Write the test helper**

`apps/desktop/src/testing/snapshot.ts`:

```ts
import type { SessionPhase, Snapshot } from "@clawd/core";

/** A valid snapshot with one pane and one session per state given. */
export function snapshot(states: readonly SessionPhase[]): Snapshot {
  const t = new Date(0).toISOString();
  return {
    version: 1,
    generatedAt: t,
    panes: [{ pane: "p1", label: "repo" }],
    sessions: states.map((state, i) => ({ alias: `agent-${i + 1}`, label: `Agent ${i + 1}`, pane: "p1", state, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t })),
  };
}
```

- [ ] **Step 2: Write the failing tests**

`apps/desktop/src/agent-client.test.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { countsOf, fetchCounts, probeHealth } from "./agent-client";
import { snapshot } from "./testing/snapshot";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** A server on a free port, closed after the test. */
async function serve(handler: Handler): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  return (server.address() as AddressInfo).port;
}

/** A port that was free a moment ago and has nothing listening now. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const reply =
  (body: unknown, status = 200): Handler =>
  (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

describe("countsOf", () => {
  it("counts every session and those waiting", () => {
    expect(countsOf(snapshot(["working", "waiting", "idle", "waiting"]))).toEqual({ sessions: 4, waiting: 2 });
    expect(countsOf(snapshot([]))).toEqual({ sessions: 0, waiting: 0 });
  });
});

describe("probeHealth", () => {
  it("is true when the health endpoint answers ok, whatever else the body carries", async () => {
    let path = "";
    const port = await serve((req, res) => {
      path = req.url ?? "";
      reply({ ok: true, version: "9.9.9", sessions: 2, somethingNewer: 1 })(req, res);
    });
    expect(await probeHealth(port)).toBe(true);
    expect(path).toBe("/api/health");
  });

  it("is false for an error status, a body that is not ok, a body that is not JSON, a closed port or a reply too slow", async () => {
    expect(await probeHealth(await serve(reply({ error: "not found" }, 404)))).toBe(false);
    expect(await probeHealth(await serve(reply({ ok: false })))).toBe(false);
    expect(await probeHealth(await serve(reply("<html>")))).toBe(false);
    expect(await probeHealth(await closedPort())).toBe(false);
    expect(await probeHealth(await serve(() => {}), 50)).toBe(false);
  });
});

describe("fetchCounts", () => {
  it("counts from the agent's snapshot", async () => {
    const port = await serve((req, res) => (req.url === "/api/snapshot" ? reply(snapshot(["waiting", "working"])) : reply({}, 404))(req, res));
    expect(await fetchCounts(port)).toEqual({ sessions: 2, waiting: 1 });
  });

  it("is null when the reply is not a snapshot or nothing answers", async () => {
    expect(await fetchCounts(await serve(reply({ version: 2 })))).toBeNull();
    expect(await fetchCounts(await closedPort())).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/agent-client.test.ts`
Expected: FAIL, "Failed to resolve import ./agent-client".

- [ ] **Step 4: Write the module**

`apps/desktop/src/agent-client.ts`:

```ts
// What the main process asks of an agent it does not own: is it there, and how many sessions has
// it? Plain HTTP to 127.0.0.1, as any client of the agent would. Neither function ever rejects.
import { ENDPOINTS, SnapshotSchema, type Snapshot } from "@clawd/core";

export type Counts = { sessions: number; waiting: number };

/** An agent that has not answered its health check in this long counts as not there. */
export const PROBE_TIMEOUT_MS = 500;
const COUNTS_TIMEOUT_MS = 2_000;

export function countsOf(s: Snapshot): Counts {
  return { sessions: s.sessions.length, waiting: s.sessions.filter((session) => session.state === "waiting").length };
}

async function getJson(port: number, path: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

/**
 * True when an agent's health endpoint on the port answers `ok: true` in time. Only `ok` is read,
 * so a newer agent with more fields still counts as an agent.
 */
export async function probeHealth(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const body = await getJson(port, ENDPOINTS.health, timeoutMs);
    return typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
}

/** The session counts of the agent on the port, or null when it does not answer with a snapshot. */
export async function fetchCounts(port: number, timeoutMs = COUNTS_TIMEOUT_MS): Promise<Counts | null> {
  try {
    const parsed = SnapshotSchema.safeParse(await getJson(port, ENDPOINTS.snapshot, timeoutMs));
    return parsed.success ? countsOf(parsed.data) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS. `fetch` and `AbortSignal.timeout` are typed by `@types/node`; the package needs no DOM library.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/agent-client.ts apps/desktop/src/agent-client.test.ts apps/desktop/src/testing/snapshot.ts
git commit -m "feat(desktop): probe an agent's health within 500 ms and read its session counts"
```

---

### Task 4: The quit sequence

**Files:**
- Create: `apps/desktop/src/quit.ts`
- Test: `apps/desktop/src/quit.test.ts`

**Interfaces:**
- Consumes: `type Logger` from `@clawd/agent`.
- Produces: `settleWithin(work: Promise<unknown>, ms: number): Promise<boolean>`; `QUIT_CAP_MS = 5_000`; `QuitDeps = { stop(): Promise<void>; flush(): Promise<void>; exit(code: number): void; log: Logger }`; `createQuitHandler(deps: QuitDeps): (event: { preventDefault(): void }) => void`.

Electron quits in steps: `before-quit`, then every window closes, then `will-quit`, then the process ends. Calling `preventDefault()` on `will-quit` cancels the quit. The handler does that on every call, starts the stop once, and when the stop has finished (or five seconds have passed) flushes the log and calls `app.exit(0)`, which ends the process without firing the quit events again. The handler takes `{ preventDefault }` rather than Electron's event type, so it is tested without Electron.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/quit.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUIT_CAP_MS, createQuitHandler, settleWithin } from "./quit";

/** Runs every queued promise callback. setImmediate is left real by the fake timers below. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("settleWithin", () => {
  it("is true when the work settles in time, whether it resolves or rejects", async () => {
    await expect(settleWithin(Promise.resolve(), 100)).resolves.toBe(true);
    await expect(settleWithin(Promise.reject(new Error("boom")), 100)).resolves.toBe(true);
  });

  it("is false when the cap passes first", async () => {
    const result = settleWithin(new Promise(() => {}), 100);
    vi.advanceTimersByTime(100);
    await expect(result).resolves.toBe(false);
  });
});

describe("createQuitHandler", () => {
  it("holds every quit, stops once, then flushes the log and exits", async () => {
    const order: string[] = [];
    let prevented = 0;
    let finishStop: () => void = () => {};
    const handler = createQuitHandler({
      stop: () =>
        new Promise<void>((resolve) => {
          order.push("stop");
          finishStop = resolve;
        }),
      flush: async () => {
        order.push("flush");
      },
      exit: (code) => {
        order.push(`exit ${code}`);
      },
      log: (code) => {
        order.push(code);
      },
    });
    const event = { preventDefault: () => void prevented++ };
    handler(event);
    handler(event);
    await flush();
    expect(prevented).toBe(2);
    expect(order).toEqual(["stop"]);
    finishStop();
    await flush();
    expect(order).toEqual(["stop", "flush", "exit 0"]);
  });

  it("exits after five seconds when the stop hangs, and logs that it did", async () => {
    const order: string[] = [];
    const handler = createQuitHandler({
      stop: () => new Promise<void>(() => {}),
      flush: async () => {
        order.push("flush");
      },
      exit: (code) => {
        order.push(`exit ${code}`);
      },
      log: (code) => {
        order.push(code);
      },
    });
    handler({ preventDefault: () => {} });
    await flush();
    vi.advanceTimersByTime(QUIT_CAP_MS - 1);
    await flush();
    expect(order).toEqual([]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(order).toEqual(["desktop.stopTimedOut", "flush", "exit 0"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/quit.test.ts`
Expected: FAIL, "Failed to resolve import ./quit".

- [ ] **Step 3: Write the module**

`apps/desktop/src/quit.ts`:

```ts
// The quit sequence. Electron fires `will-quit` once every window has closed; preventDefault()
// there keeps the process alive while the agent stops, and app.exit() then ends it without firing
// the quit events again. Electron-free, so it is tested with fakes.
import type { Logger } from "@clawd/agent";

/** How long quitting waits for the agent to stop before exiting anyway. */
export const QUIT_CAP_MS = 5_000;
const FLUSH_CAP_MS = 1_000;

/** Resolves true when the work settles (either way) within the time, false when the time runs out first. */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void work
      .then(
        () => {},
        () => {},
      )
      .then(() => {
        clearTimeout(timer);
        resolve(true);
      });
  });
}

export type QuitDeps = {
  /** Stops the agent host. */
  stop(): Promise<void>;
  /** Writes out the log lines still queued. */
  flush(): Promise<void>;
  /** app.exit: ends the process now. */
  exit(code: number): void;
  log: Logger;
};

/** The `will-quit` listener: hold the quit, stop once, flush, exit. Later calls only hold. */
export function createQuitHandler(deps: QuitDeps): (event: { preventDefault(): void }) => void {
  let quitting = false;
  return (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      // Promise.resolve().then() turns a stop that throws synchronously into a rejection.
      if (!(await settleWithin(Promise.resolve().then(deps.stop), QUIT_CAP_MS))) deps.log("desktop.stopTimedOut");
      await settleWithin(deps.flush(), FLUSH_CAP_MS);
      deps.exit(0);
    })();
  };
}
```

- [ ] **Step 4: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/quit.ts apps/desktop/src/quit.test.ts
git commit -m "feat(desktop): quitting holds will-quit until the agent stops, capped at five seconds, then exits"
```

---

### Task 5: The agent host

**Files:**
- Create: `apps/desktop/src/agent-host.ts`
- Test: `apps/desktop/src/agent-host.test.ts`

**Interfaces:**
- Consumes: `ConfigError`, `PortInUseError`, `type LogFields`, `type Logger`, `type RunningAgent` from `@clawd/agent` (Task 1); `countsOf`, `type Counts` from `./agent-client` (Task 3); `settleWithin` from `./quit` (Task 4).
- Produces: `HostMode`; `HostState = { mode: HostMode; port: number | null; sessions: number; waiting: number; error: string | null }`; `AgentHostDeps = { start(onSnapshot: (s: Snapshot) => void): Promise<RunningAgent>; probe(port: number): Promise<boolean>; counts(port: number): Promise<Counts | null>; log: Logger; onChange?(state: HostState): void; now?(): number }`; `AgentHost = { state(): HostState; start(): void; fault(): void; retry(): void; stop(): Promise<void> }`; `createAgentHost(deps: AgentHostDeps): AgentHost`; `statusText(state: HostState): string`; `ATTACHED_POLL_MS`, `FAULT_WINDOW_MS`, `BACKOFF_MS`.

The host never imports Electron and never calls `startAgent` itself: main hands it `start`, `probe` and `counts`, and the tests hand it fakes. Transitions run one at a time through a promise queue, so a fault arriving while a start is in flight waits its turn instead of racing it. Every step after an `await` checks whether `stop()` has been called, so nothing starts once quitting has begun. The tests use vitest's fake `setTimeout` and `Date`, so ten-second polls and sixteen-second backoffs run instantly.

`statusText` lives here because it is a view of the host's state. Stage 2 shows it in the window title, which makes attach, takeover and failure visible while running the app; stage 4 reuses it for the tray tooltip. The spec gives the tooltip as `Clawd Visualiser · 3 sessions · 1 waiting`; the waiting part is shown only above zero, where the tray badge also appears.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/agent-host.test.ts`:

```ts
import { ConfigError, PortInUseError, type RunningAgent } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHED_POLL_MS, FAULT_WINDOW_MS, createAgentHost, statusText, type AgentHostDeps, type HostState } from "./agent-host";
import { snapshot } from "./testing/snapshot";

/** Runs every queued promise callback. setImmediate is left real by the fake timers below. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flush();
}

type FakeAgent = RunningAgent & { stopped: boolean; emit(s: Snapshot): void };

/** A host over fakes. Each start throws the next error in `fail`, then succeeds on port 4750. */
function harness(opts: { fail?: unknown[]; probe?: AgentHostDeps["probe"]; counts?: AgentHostDeps["counts"] } = {}) {
  const fail = [...(opts.fail ?? [])];
  const codes: string[] = [];
  const agents: FakeAgent[] = [];
  let starts = 0;
  const host = createAgentHost({
    start: async (onSnapshot) => {
      starts++;
      const error = fail.shift();
      if (error !== undefined) throw error;
      const agent: FakeAgent = {
        port: 4750,
        stopped: false,
        emit: onSnapshot,
        async stop() {
          agent.stopped = true;
        },
      };
      agents.push(agent);
      return agent;
    },
    probe: opts.probe ?? (async () => false),
    counts: opts.counts ?? (async () => null),
    log: (code) => void codes.push(code),
    now: () => Date.now(),
  });
  return { host, codes, agents, starts: () => starts };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createAgentHost", () => {
  it("owns the agent it starts and counts sessions from its snapshots", async () => {
    const { host, agents } = harness();
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "own", port: 4750, sessions: 0, waiting: 0 });
    agents[0]?.emit(snapshot(["working", "waiting", "waiting"]));
    expect(host.state()).toMatchObject({ sessions: 3, waiting: 2 });
  });

  it("attaches to an agent already answering on the port, polls it, and takes over when it goes quiet", async () => {
    let answering = true;
    const { host, codes, agents, starts } = harness({ fail: [new PortInUseError(4750)], probe: async () => answering, counts: async () => ({ sessions: 2, waiting: 1 }) });
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "attached", port: 4750, sessions: 2, waiting: 1 });
    expect(codes).toEqual(["desktop.attached"]);

    await advance(ATTACHED_POLL_MS);
    expect(host.state().mode).toBe("attached");
    expect(starts()).toBe(1);

    answering = false;
    await advance(ATTACHED_POLL_MS);
    expect(codes).toEqual(["desktop.attached", "desktop.takeover"]);
    expect(host.state()).toMatchObject({ mode: "own", port: 4750 });
    expect(agents).toHaveLength(1);
  });

  it("treats a port held by something that is not an agent as a fault, and tries again after a second", async () => {
    const { host, codes, starts } = harness({ fail: [new PortInUseError(4750)] });
    host.start();
    await flush();
    expect(host.state().mode).toBe("restarting");
    expect(codes).toEqual(["desktop.agentFault"]);
    await advance(999);
    expect(starts()).toBe(1);
    await advance(1);
    expect(starts()).toBe(2);
    expect(host.state().mode).toBe("own");
  });

  it("fails at once on an unusable config, keeping its message to show, and starts again on retry", async () => {
    const { host, codes, starts } = harness({ fail: [new ConfigError("config.json is invalid at: port")] });
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "failed", error: "config.json is invalid at: port" });
    expect(codes).toEqual(["desktop.agentFailed"]);
    await advance(60_000);
    expect(starts()).toBe(1);

    host.retry();
    await flush();
    expect(host.state()).toMatchObject({ mode: "own", error: null });
  });

  it("backs off 1, 2, 4, 8 then 16 seconds between restarts, and fails when a sixth fault comes inside five minutes", async () => {
    const boom = new Error("boom");
    const { host, codes, starts } = harness({ fail: Array.from({ length: 6 }, () => boom) });
    host.start();
    await flush();
    for (const [delay, total] of [[1_000, 2], [2_000, 3], [4_000, 4], [8_000, 5], [16_000, 6]] as const) {
      await advance(delay - 1);
      expect(starts()).toBe(total - 1);
      await advance(1);
      expect(starts()).toBe(total);
    }
    expect(host.state().mode).toBe("failed");
    expect(codes).toEqual([...Array.from({ length: 5 }, () => "desktop.agentFault"), "desktop.agentFailed"]);
    await advance(FAULT_WINDOW_MS);
    expect(starts()).toBe(6);
  });

  it("forgets faults older than five minutes, so an occasional one restarts after a second", async () => {
    const { host, starts } = harness();
    host.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      host.fault();
      await flush();
      expect(host.state().mode).toBe("restarting");
      await advance(1_000);
      expect(host.state().mode).toBe("own");
      await advance(FAULT_WINDOW_MS);
    }
    expect(starts()).toBe(4);
  });

  it("on an uncaught error while it owns the agent, stops that agent, starts a fresh one and ignores the old one's snapshots", async () => {
    const { host, codes, agents } = harness();
    host.start();
    await flush();
    host.fault();
    await flush();
    expect(agents[0]?.stopped).toBe(true);
    await advance(1_000);
    expect(agents).toHaveLength(2);
    agents[0]?.emit(snapshot(["waiting"]));
    expect(host.state()).toMatchObject({ mode: "own", sessions: 0 });
    agents[1]?.emit(snapshot(["waiting"]));
    expect(host.state()).toMatchObject({ sessions: 1, waiting: 1 });
    expect(codes).toEqual(["desktop.agentFault"]);
  });

  it("logs an uncaught error while attached and changes nothing", async () => {
    const { host, codes, starts } = harness({ fail: [new PortInUseError(4750)], probe: async () => true });
    host.start();
    await flush();
    host.fault();
    await advance(1_000);
    expect(host.state().mode).toBe("attached");
    expect(starts()).toBe(1);
    expect(codes).toEqual(["desktop.attached", "desktop.agentFault"]);
  });

  it("stops the agent it owns, and starts nothing after stop, even with a restart pending", async () => {
    const owning = harness();
    owning.host.start();
    await flush();
    await owning.host.stop();
    expect(owning.agents[0]?.stopped).toBe(true);

    const restarting = harness({ fail: [new Error("boom")] });
    restarting.host.start();
    await flush();
    expect(restarting.host.state().mode).toBe("restarting");
    await restarting.host.stop();
    await advance(60_000);
    expect(restarting.starts()).toBe(1);
  });

  it("stops an agent that finishes starting after stop was called", async () => {
    let resolveStart: (agent: RunningAgent) => void = () => {};
    let stopped = false;
    const host = createAgentHost({
      start: () =>
        new Promise<RunningAgent>((resolve) => {
          resolveStart = resolve;
        }),
      probe: async () => false,
      counts: async () => null,
      log: () => {},
    });
    host.start();
    await flush();
    const stopping = host.stop();
    resolveStart({
      port: 4750,
      async stop() {
        stopped = true;
      },
    });
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe("statusText", () => {
  const base: HostState = { mode: "own", port: 4750, sessions: 3, waiting: 1, error: null };

  it("names the sessions and those waiting, and says when the agent is not the app's own", () => {
    expect(statusText(base)).toBe("Clawd Visualiser · 3 sessions · 1 waiting");
    expect(statusText({ ...base, sessions: 1, waiting: 0 })).toBe("Clawd Visualiser · 1 session");
    expect(statusText({ ...base, mode: "attached" })).toBe("Clawd Visualiser · 3 sessions · 1 waiting · agent attached");
    expect(statusText({ ...base, mode: "failed", sessions: 0, waiting: 0 })).toBe("Clawd Visualiser · 0 sessions · agent failed");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/agent-host.test.ts`
Expected: FAIL, "Failed to resolve import ./agent-host".

- [ ] **Step 3: Write the module**

`apps/desktop/src/agent-host.ts`:

```ts
// The agent host: runs the agent inside the main process and keeps it running. It owns the agent
// when the port is free, attaches to one already serving it (the CLI's, say) and takes over when
// that one stops answering, restarts after faults with a backoff, and gives up after too many.
// Electron-free, so every transition is tested.
import { ConfigError, PortInUseError, type LogFields, type Logger, type RunningAgent } from "@clawd/agent";
import type { Snapshot } from "@clawd/core";
import { countsOf, type Counts } from "./agent-client";
import { settleWithin } from "./quit";

export type HostMode = "starting" | "own" | "attached" | "restarting" | "failed";

export type HostState = {
  mode: HostMode;
  /** The port of the agent in use, the app's own or the one attached to; null until one is known. */
  port: number | null;
  sessions: number;
  waiting: number;
  /** A ConfigError's message, which names a field and never a value. Shown, never logged. */
  error: string | null;
};

export type AgentHostDeps = {
  /** Starts an agent in this process. Main passes startAgent with the home and the logger. */
  start(onSnapshot: (s: Snapshot) => void): Promise<RunningAgent>;
  /** Whether an agent's health endpoint on the port answers in time. Never rejects. */
  probe(port: number): Promise<boolean>;
  /** The session counts of the agent on the port, or null. Never rejects. */
  counts(port: number): Promise<Counts | null>;
  log: Logger;
  onChange?(state: HostState): void;
  now?(): number;
};

export type AgentHost = {
  state(): HostState;
  /** Begins starting. Call once, after `ready`; later calls do nothing. */
  start(): void;
  /** An uncaught error reached main. Restarts the agent when the app owns it. */
  fault(): void;
  /** From failed, starts again with the fault history cleared. */
  retry(): void;
  /** Stops for good: cancels any wait and stops the agent the app owns. */
  stop(): Promise<void>;
};

export const ATTACHED_POLL_MS = 10_000;
export const FAULT_WINDOW_MS = 300_000;
/** The wait before restarting, by how many faults the window already held. A fault finding all five used fails. */
export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;
/** How long a faulted agent gets to stop before the host moves on without it. */
const AGENT_STOP_CAP_MS = 5_000;

export function createAgentHost(deps: AgentHostDeps): AgentHost {
  const now = deps.now ?? (() => Date.now());
  let state: HostState = { mode: "starting", port: null, sessions: 0, waiting: 0, error: null };
  let agent: RunningAgent | null = null;
  let faults: number[] = [];
  /** Which start is current, so snapshots from an agent already replaced are ignored. */
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let work: Promise<void> = Promise.resolve();
  let begun = false;
  let stopping: Promise<void> | null = null;

  const stopped = (): boolean => stopping !== null;

  const set = (patch: Partial<HostState>): void => {
    state = { ...state, ...patch };
    deps.onChange?.(state);
  };

  /** One transition at a time: each task starts once the one before it has settled. */
  const queue = (task: () => Promise<void>): void => {
    work = work.then(task).catch(() => {});
  };

  const wait = (ms: number, task: () => Promise<void>): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      queue(task);
    }, ms);
  };

  const release = async (): Promise<void> => {
    const current = agent;
    agent = null;
    if (current) await settleWithin(current.stop(), AGENT_STOP_CAP_MS);
  };

  const attempt = async (): Promise<void> => {
    if (stopped()) return;
    set({ mode: "starting", error: null });
    const mine = ++run;
    try {
      const running = await deps.start((s) => {
        if (mine === run && !stopped()) set(countsOf(s));
      });
      if (stopped()) {
        await settleWithin(running.stop(), AGENT_STOP_CAP_MS);
        return;
      }
      agent = running;
      set({ mode: "own", port: running.port });
    } catch (err) {
      if (stopped()) return;
      if (err instanceof ConfigError) {
        deps.log("desktop.agentFailed", { config: true });
        set({ mode: "failed", error: err.message });
        return;
      }
      if (err instanceof PortInUseError) {
        if (!(await deps.probe(err.port))) return faulted({ portInUse: true });
        if (stopped()) return;
        deps.log("desktop.attached", { port: err.port });
        set({ mode: "attached", port: err.port });
        return refresh(err.port);
      }
      return faulted({});
    }
  };

  /** While attached: take the counts now and look again in ten seconds. */
  const refresh = async (port: number): Promise<void> => {
    const counts = await deps.counts(port);
    if (stopped()) return;
    if (counts !== null) set(counts);
    wait(ATTACHED_POLL_MS, () => poll(port));
  };

  const poll = async (port: number): Promise<void> => {
    if (stopped() || state.mode !== "attached") return;
    if (await deps.probe(port)) return refresh(port);
    if (stopped()) return;
    deps.log("desktop.takeover", { port });
    return attempt();
  };

  const faulted = async (fields: LogFields): Promise<void> => {
    const t = now();
    faults = faults.filter((at) => t - at < FAULT_WINDOW_MS);
    if (faults.length >= BACKOFF_MS.length) {
      deps.log("desktop.agentFailed", { faults: faults.length + 1 });
      await release();
      set({ mode: "failed" });
      return;
    }
    const delay = BACKOFF_MS[faults.length] ?? 16_000;
    faults.push(t);
    deps.log("desktop.agentFault", { ...fields, restartMs: delay });
    set({ mode: "restarting" });
    await release();
    wait(delay, attempt);
  };

  return {
    state: () => state,
    start() {
      if (begun) return;
      begun = true;
      queue(attempt);
    },
    fault() {
      queue(async () => {
        if (stopped()) return;
        if (state.mode === "own") return faulted({ uncaught: true });
        deps.log("desktop.agentFault", { uncaught: true });
      });
    },
    retry() {
      queue(async () => {
        if (stopped() || state.mode !== "failed") return;
        faults = [];
        return attempt();
      });
    },
    stop() {
      stopping ??= (async () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        await work;
        await release();
      })();
      return stopping;
    },
  };
}

/** One line for the window title now and the tray tooltip in stage 4. */
export function statusText(state: HostState): string {
  const parts = ["Clawd Visualiser", `${state.sessions} ${state.sessions === 1 ? "session" : "sessions"}`];
  if (state.waiting > 0) parts.push(`${state.waiting} waiting`);
  if (state.mode === "attached") parts.push("agent attached");
  if (state.mode === "failed") parts.push("agent failed");
  return parts.join(" · ");
}
```

- [ ] **Step 4: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/agent-host.ts apps/desktop/src/agent-host.test.ts
git commit -m "feat(desktop): the agent host owns the agent, attaches to one already serving, takes over, and restarts with a backoff"
```

---

### Task 6: Wire the host into the main process, run the app, and write the stage note

**Files:**
- Modify: `apps/desktop/src/window.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/README.md`
- Modify: `README.md` (root)

**Interfaces:**
- Consumes: `createLogger`, `defaultHome`, `agentPaths`, `startAgent` from `@clawd/agent` (Task 1); `createFileSink`, `readRetentionDays` (Task 2); `probeHealth`, `fetchCounts` (Task 3); `createQuitHandler` (Task 4); `createAgentHost`, `statusText` (Task 5).
- Produces: `createMainWindow(url: string, title: string): BrowserWindow`; a `dist/main.cjs` that carries the agent and core.

As in stage 1, these two files have no unit tests on purpose: they only connect the tested modules to Electron. The check is running the app (step 4).

- [ ] **Step 1: Let main own the window title**

`apps/desktop/src/window.ts`, replacing the whole file:

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
export function createMainWindow(url: string, title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
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
// The main process: the one Node program in the app. It owns the lifecycle and the windows and,
// from stage 2, runs the agent itself; Chromium draws, in a sandboxed renderer process per window.
import { agentPaths, createLogger, defaultHome, startAgent } from "@clawd/agent";
import { app, type BrowserWindow } from "electron";
import { fetchCounts, probeHealth } from "./agent-client";
import { createAgentHost, statusText } from "./agent-host";
import { ownArgs, parseArgs, resolveDevUrl } from "./args";
import { createFileSink, readRetentionDays } from "./log";
import { createQuitHandler } from "./quit";
import { createMainWindow } from "./window";

const args = parseArgs(ownArgs(process.argv, app.isPackaged));
const url = resolveDevUrl(args, process.env);
const home = defaultHome();

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
  log("desktop.started", { packaged: app.isPackaged });
  host.start();
  win = createMainWindow(url, statusText(host.state()));
  win.on("closed", () => {
    win = null;
  });
});

// Stage 2 still quits when the window closes; stage 4 hides it instead and keeps the tray.
app.on("window-all-closed", () => app.quit());

// `will-quit` comes after every window has closed. The handler holds it until the agent has stopped
// (at most five seconds), writes out the log, then exits.
app.on("will-quit", createQuitHandler({ stop: () => host.stop(), flush: () => sink.flush(), exit: (code) => app.exit(code), log }));

// Ctrl+C in the terminal asks for the same sequence.
process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());
```

- [ ] **Step 3: Bundle and check the agent is inside**

Run: `cd apps/desktop && npx tsc --noEmit && pnpm bundle`
Expected: esbuild prints `dist/main.cjs` (now a few hundred kilobytes, since it carries the agent, core and zod) and its map, with no warnings.

Run: `grep -cE 'require\("(zod|@clawd/[a-z]+)"\)' apps/desktop/dist/main.cjs` from the repository root
Expected: `0`. The only modules left to `require` at runtime are Node's own and `electron`, which is what "no runtime dependencies" needs.

- [ ] **Step 4: Run the app and walk the checklist (pause here for the maintainer)**

Stop any CLI agent. Start the web app in one terminal and the desktop app in another, from the repository root:

```
pnpm dev
pnpm --filter @clawd/desktop dev
```

Check each:

- The window opens with a title like `Clawd Visualiser · 2 sessions` and shows the panes scene with your live sessions. The badge at the top right reads `live · 127.0.0.1:4750`. Send a prompt in an allowlisted Claude Code session: its Clawd starts working, and the title's counts follow.
- Only the app serves the agent's port, and no agent process runs. The first command prints `electron`; the second prints nothing (the Next dev server's `node.exe` is expected until stage 3):

  ```
  Get-Process -Id (Get-NetTCPConnection -LocalPort 4750 -State Listen).OwningProcess | Select-Object -ExpandProperty ProcessName
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -match 'main\.ts serve'
  ```

- The log has the app's and the agent's lines, and nothing but codes and numbers: `desktop.started`, `agent.restored`, `agent.started` with `"port":4750`. The terminal shows the same lines.

  ```
  Get-Content "$HOME\.clawd\logs\desktop-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).log"
  ```

- Close the window. The log gains `agent.stopped`, with no `desktop.stopTimedOut`, and the terminal prompt returns within a second or two. `Get-NetTCPConnection -LocalPort 4750 -State Listen` then reports that nothing is listening.
- Attach: start the CLI agent (`pnpm --filter @clawd/agent start`) in a third terminal, then the app. The title ends `· agent attached`, the log has `desktop.attached`, and the scene is live, served by the CLI's agent.
- Takeover: press Ctrl+C in the CLI agent's terminal. Within ten seconds the title loses `· agent attached`, the log shows `desktop.takeover` then `agent.started`, and the badge returns to `live` after its reconnect.
- A second copy: with the app running on its own agent, run `pnpm --filter @clawd/desktop dev` again in another terminal. The second window's title ends `· agent attached`. Close it; the first carries on. Stage 4's single-instance lock replaces this with one app.
- An unusable config, in a scratch home so the real one is untouched. The title ends `· agent failed`; that home's log has `desktop.agentFailed` with `"config":true` and no message text. Close the app, then `Remove-Item Env:CLAWD_HOME` and delete the folder.

  ```
  $env:CLAWD_HOME = "$env:TEMP\clawd-bad-config"
  New-Item -ItemType Directory -Force $env:CLAWD_HOME | Out-Null
  Set-Content "$env:CLAWD_HOME\config.json" '{ "version": 1 }'
  pnpm --filter @clawd/desktop dev
  ```

- Ctrl+C in the desktop app's terminal: note whether the log gains `agent.stopped` before the process ends. On Windows, pnpm's shim may end Electron before the signal reaches it; the port is freed either way because the process is gone, and only the last event log lines can be lost. Record which happened in the stage note.
- A restart after a fault has no manual trigger; the host's unit tests cover the backoff and the failed state.

- [ ] **Step 5: Update the READMEs**

In `apps/desktop/README.md`, replace the opening of the Run section, from `Start the agent and the web app as usual` through the first command block, with:

````markdown
Start the web app, then the desktop app. The agent runs inside the desktop app:

```
pnpm dev
pnpm --filter @clawd/desktop dev
```

If an agent is already serving its port (the CLI's `pnpm --filter @clawd/agent start`), the app
attaches to it instead and starts its own when that one stops; the window title says which. The
app's log is `~/.clawd/logs/desktop-YYYY-MM-DD.log`, and in development the same lines print to the
terminal.
````

Append after the Stage 1 note:

```markdown
### Stage 2: the agent inside

The main process is Node, all of it: `http`, `fs`, timers, `fetch`. So the agent needs no process of
its own. `main.ts` calls the same `startAgent()` the CLI's `serve` calls, and the agent's server, its
poller and its event log run on the main process's event loop, beside the code that manages windows.
The renderer does not notice: it still talks to `127.0.0.1:4750` over HTTP. One thing follows from
sharing that loop: anything that blocks it, such as a long synchronous loop or a synchronous read of
a large file, freezes the agent and the window frame together, so main-process code stays
asynchronous.

`agent-host.ts` decides which agent the app uses. If the port is free, the app owns the agent. If an
agent already answers on the port (the CLI's, or a second copy of the app until stage 4), the app
attaches to it, checks it every ten seconds, and starts its own when it stops answering. A fault
while owning it stops what it can and starts again after 1, 2, 4, 8 then 16 seconds; a sixth fault
inside five minutes gives up. An unusable `config.json` fails at once. The window title shows the
counts and says `agent attached` or `agent failed`; stage 4 moves that text to the tray tooltip.

**The quit sequence.** Electron quits in steps, and main can listen to each: `window-all-closed`
(the last window has closed; this stage calls `app.quit()` there), `before-quit`, the windows
closing, then `will-quit`. Calling `event.preventDefault()` in `will-quit` cancels the quit, which is
how the app keeps the process alive while the agent closes its server and writes out its event log.
When that is done, `app.exit(0)` ends the process at once, without firing the quit events again. A
stop that hangs is abandoned after five seconds and logged as `desktop.stopTimedOut`, so quitting
always ends.

**Error handling.** By default, an exception nothing catches in the main process shows Electron's
"A JavaScript error occurred in the main process" dialog. Listening for `uncaughtException` and
`unhandledRejection` on `process` replaces that: the host logs a code and restarts the agent it owns.
Errors in the renderer belong to another process and only reach its DevTools console. `startAgent`
rejecting is ordinary control flow rather than a crash: `PortInUseError` means look for an agent to
attach to, `ConfigError` means failed, and anything else is a fault.

**Logs.** The app writes through the agent's own `createLogger`, so the agent's lines and the app's
`desktop.*` lines share one file and one rule: a time, a code and numbers, never a string. Day files
older than the config's `logRetentionDays` are removed when a new day's file opens.

What stage 2 leaves in place: launching the app is enough for live sessions; the Next dev server is
still needed for the page, until stage 3 bundles it. Closing the window stops the agent and quits.
```

Root `README.md`, in the layout table, replace the `apps/desktop` row with:

```markdown
| `apps/desktop` | The Electron app, built in stages: the agent and the visualiser in one window and the tray, run from a folder. Stage 2 runs the agent inside the app's main process; the window still loads the dev server. See its README. |
```

- [ ] **Step 6: Run every check and commit**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit && cd ../.. && pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add apps/desktop/src/window.ts apps/desktop/src/main.ts apps/desktop/README.md README.md
git commit -m "feat(desktop): the agent runs inside the main process; quitting stops it and uncaught errors reach the host"
```

Then hand the branch back with the finishing-a-development-branch skill. The branch carries stage 1's merge too, so merging it to `main` brings both stages. Stage 3 (the packaged UI) starts from `main` once this is merged.
