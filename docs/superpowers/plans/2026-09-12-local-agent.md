# Local Agent (`apps/agent`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@clawd/agent`, the local Node process on `127.0.0.1:4750` that receives Claude Code hooks and the status line, redacts at ingest with `@clawd/core`, polls `claude agents --json`, keeps the fleet, serves the snapshot, stream, ticker, command and health endpoints, installs its hooks into `~/.claude/settings.json`, and raises session windows on Windows.

**Architecture:** Raw payloads enter through two HTTP routes and go straight into core's `redact()`; only `RedactedEvent`s travel further. A `FleetHost` owns the fleet, the alias map and the ticker buffers, and calls listeners that feed the event log, the alias store and the SSE hub. Everything with time, processes or files takes an injected dependency so each unit is tested alone, and one end-to-end test proves no canary from a raw payload reaches any sink.

**Tech Stack:** TypeScript 5 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Node 24 (`node:http`, `node:child_process`, `node:fs/promises`), zod 4, Vitest 5, tsx 4 as the runtime, pnpm 12 workspace. No HTTP framework.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-12-local-agent-design.md`. Core contract: `docs/superpowers/specs/2026-09-12-core-contract-design.md`. Read both before starting.
- Work in the worktree `C:\mw\visualiser-agent` on branch `feat/local-agent`. Run commands from that directory unless stated. Package filter: `pnpm --filter @clawd/agent <script>`.
- **Never modify anything under `packages/core`.** Import only from `@clawd/core` (its `src/index.ts` barrel).
- Never modify anything under `C:\git\b2b`.
- Runtime dependencies of `@clawd/agent` are exactly `@clawd/core`, `zod` and `tsx`. Dev dependencies are `typescript`, `vitest`, `@types/node`.
- **Privacy:** a raw payload is never logged, written to disk, echoed in a response, or kept beyond the request that carried it. Every call to `redact()` or `redactPresence()` happens before anything else reads the payload.
- **Logging:** code under `apps/agent/src` writes operational output only through the logger from `src/log.ts` (codes plus numbers and booleans). The only exception is `src/cli.ts`/`src/main.ts`, which print fixed human messages that may include file paths the user supplied, never payload content and never settings content.
- **Tests never touch the real `~/.claude` or `~/.clawd`**: every test passes a temp `home` and a temp settings path. No test binds port 4750; servers listen on port 0. Nobody runs the installer against the real `~/.claude/settings.json`.
- Hook scripts under `apps/agent/hooks/` are plain `.mjs` with no dependencies and no imports outside `node:` and each other.
- Commit locally after each task with a one-line message and **no trailers** (no `Co-Authored-By`). **Never push.**
- Line endings LF (enforced by `.gitattributes`).

---

## File structure

```
apps/agent/
  package.json                     Task 1
  tsconfig.json                    Task 1
  README.md                        Task 14
  hooks/
    clawd-lib.mjs                  Task 11: config, stdin, post, default line, wrapped command runner
    clawd-hook.mjs                 Task 11: SessionStart command hook
    clawd-statusline.mjs           Task 11: status line command
  src/
    version.ts                     Task 1: AGENT_VERSION
    log.ts                         Task 1: typed logger
    json-file.ts                   Task 2: readJsonFile, writeJsonAtomic, isErrno
    stamp.ts                       Task 2: fileStamp
    config.ts                      Task 2: paths, AgentConfig, readConfig, loadOrCreateConfig, saveConfig
    ingest/
      body.ts                      Task 3: readBody
      ingest.ts                    Task 3: ingestHook, ingestStatus, parseJson
    store/
      alias-store.ts               Task 4: createAliasStore
      event-log.ts                 Task 4: createEventLog
    host/
      host.ts                      Task 5: FleetHost
    presence/
      reconcile.ts                 Task 6: reconcile, listedIds
      poller.ts                    Task 6: createPresencePoller, nodeExec
    http/
      sse.ts                       Task 7: createStreamHub
      guards.ts                    Task 8: hostAllowed, checkOrigin, tokenMatches
      server.ts                    Task 8: createAgentServer
    focus/
      focus-script.ts              Task 9: FOCUS_SCRIPT
      focus.ts                     Task 9: createFocus, powershellFocus, folderName
    agent.ts                       Task 10: startAgent
    cli.ts                         Task 10 (serve), Task 13 (install, uninstall)
    main.ts                        Task 10
    install/
      settings.ts                  Task 12: applyInstall, applyUninstall
      installer.ts                 Task 13: install, uninstall, mergeAllowlist
    testing/                       test-only helpers, never imported by production code
      tmp.ts                       Task 2
      raw.ts                       Task 3: canary raw payloads
      events.ts                    Task 5: typed RedactedEvent builder
      http.ts                      Task 8: request, stream and SSE helpers
```

Each `*.test.ts` sits next to the file it tests.

---

### Task 1: Package scaffold, version and typed logger

**Files:**
- Create: `apps/agent/package.json`
- Create: `apps/agent/tsconfig.json`
- Create: `apps/agent/src/version.ts`
- Create: `apps/agent/src/log.ts`
- Test: `apps/agent/src/version.test.ts`, `apps/agent/src/log.test.ts`
- Modify: `pnpm-lock.yaml` (by `pnpm install`)

**Interfaces:**
- Produces: `AGENT_VERSION: "0.1.0"`; `type LogCode` (the union below); `type LogFields = Readonly<Record<string, number | boolean>>`; `type Logger = (code: LogCode, fields?: LogFields) => void`; `createLogger(write?: (line: string) => void, now?: () => number): Logger`; `silentLogger: Logger`.

- [ ] **Step 1: Create the package files**

Create `apps/agent/package.json`:

```json
{
  "name": "@clawd/agent",
  "version": "0.1.0",
  "private": true,
  "description": "The local agent: receives Claude Code hooks, redacts at ingest, keeps the fleet and serves snapshots on 127.0.0.1.",
  "type": "module",
  "scripts": {
    "start": "tsx src/main.ts serve",
    "agent": "tsx src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@clawd/core": "workspace:*",
    "tsx": "^4.23.13",
    "zod": "^4.6.2"
  },
  "devDependencies": {
    "@types/node": "^22.20.2",
    "typescript": "^5",
    "vitest": "^5"
  }
}
```

Create `apps/agent/tsconfig.json`:

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

Run: `pnpm install`
Expected: exits 0; `pnpm-lock.yaml` gains an `apps/agent` importer; `apps/agent/node_modules/@clawd/core` exists.

- [ ] **Step 2: Write the failing tests**

Create `apps/agent/src/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { AGENT_VERSION } from "./version";

describe("AGENT_VERSION", () => {
  it("matches package.json", () => {
    expect(AGENT_VERSION).toBe(pkg.version);
  });
});
```

Create `apps/agent/src/log.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLogger, type LogFields } from "./log";

describe("createLogger", () => {
  it("writes one JSON line with time, code and fields", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), () => Date.UTC(2026, 8, 12, 10, 0, 0));
    log("agent.started", { port: 4750, ok: true });
    expect(lines).toEqual(['{"t":"2026-09-12T10:00:00.000Z","code":"agent.started","port":4750,"ok":true}\n']);
  });

  it("writes a line with no fields", () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => 0)("agent.stopped");
    expect(lines).toEqual(['{"t":"1970-01-01T00:00:00.000Z","code":"agent.stopped"}\n']);
  });

  it("drops any field that is not a number or a boolean, even one smuggled in with a cast", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), () => 0);
    log("ingest.failed", { count: 1, leak: "CANARY prompt", nested: { a: 1 } } as unknown as LogFields);
    expect(lines.join("")).not.toContain("CANARY");
    expect(JSON.parse(lines[0] ?? "")).toEqual({ t: "1970-01-01T00:00:00.000Z", code: "ingest.failed", count: 1 });
  });

  it("never lets a field overwrite the time or the code", () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => 0)("agent.stopped", { t: 5, code: 6 } as unknown as LogFields);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ t: "1970-01-01T00:00:00.000Z", code: "agent.stopped" });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent test`
Expected: FAIL, `./version` and `./log` cannot be resolved.

- [ ] **Step 4: Write the version and the logger**

Create `apps/agent/src/version.ts`:

```ts
/** The agent's own version, reported by GET /api/health. A test keeps it equal to package.json. */
export const AGENT_VERSION = "0.1.0";
```

Create `apps/agent/src/log.ts`:

```ts
/**
 * Operational logging. A closed set of codes and a record of numbers and booleans: there is no
 * parameter a string can travel through, so payload content, paths and error messages cannot be
 * logged. Strings are also dropped at runtime, in case a cast gets one past the type.
 */
export type LogCode =
  | "agent.started"
  | "agent.stopped"
  | "config.emptyAllowlist"
  | "ingest.counts"
  | "ingest.failed"
  | "presence.failed"
  | "privacy.blocked"
  | "store.aliasesRecovered"
  | "store.aliasesSaveFailed"
  | "store.logWriteFailed"
  | "store.retentionFailed"
  | "server.error"
  | "server.portInUse"
  | "stream.clientLimit"
  | "stream.slowClient"
  | "host.listenerFailed"
  | "focus.raised"
  | "focus.flashed"
  | "focus.noWindow"
  | "focus.failed"
  | "focus.notListed"
  | "focus.unsupported";

export type LogFields = Readonly<Record<string, number | boolean>>;
export type Logger = (code: LogCode, fields?: LogFields) => void;

export function createLogger(write: (line: string) => void = (line) => void process.stdout.write(line), now: () => number = Date.now): Logger {
  return (code, fields = {}) => {
    const kept: Record<string, number | boolean> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (key === "t" || key === "code") continue;
      if (typeof value === "number" || typeof value === "boolean") kept[key] = value;
    }
    write(JSON.stringify({ t: new Date(now()).toISOString(), code, ...kept }) + "\n");
  };
}

export const silentLogger: Logger = () => {};
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent test`
Expected: PASS, 5 tests.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/agent pnpm-lock.yaml
git commit -m "feat(agent): package scaffold, version and a logger that cannot carry strings"
```

---

### Task 2: Config, paths and atomic JSON files

**Files:**
- Create: `apps/agent/src/json-file.ts`
- Create: `apps/agent/src/stamp.ts`
- Create: `apps/agent/src/config.ts`
- Create: `apps/agent/src/testing/tmp.ts`
- Test: `apps/agent/src/json-file.test.ts`, `apps/agent/src/stamp.test.ts`, `apps/agent/src/config.test.ts`

**Interfaces:**
- Produces:
  - `type JsonRead = { found: false } | { found: true; ok: false } | { found: true; ok: true; value: unknown }`; `readJsonFile(path: string): Promise<JsonRead>`; `writeJsonAtomic(path: string, value: unknown): Promise<void>`; `isErrno(err: unknown, code: string): boolean`.
  - `fileStamp(ms: number): string` (UTC `YYYYMMDDHHmmss`).
  - `DEFAULT_PORT = 4750`; `type AgentPaths = { home; config; aliases; logs; bin }` (all strings); `agentPaths(home: string): AgentPaths`; `defaultHome(env?: NodeJS.ProcessEnv): string`; `defaultSettingsPath(env?: NodeJS.ProcessEnv): string`.
  - `WrappedStatusLineSchema`, `type WrappedStatusLine = { command: string; [k: string]: unknown }`; `AgentConfigSchema`, `type AgentConfig`; `defaultConfig(token?: string): AgentConfig`; `class ConfigError extends Error`; `readConfig(paths): Promise<AgentConfig | null>`; `loadOrCreateConfig(paths): Promise<AgentConfig>`; `saveConfig(paths, config): Promise<void>`.
  - Test helper `useTempDirs(): () => Promise<string>`.

- [ ] **Step 1: Write the test helper**

Create `apps/agent/src/testing/tmp.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** Call at describe level. Returns a function that makes a fresh temp directory, removed after each test. */
export function useTempDirs(): () => Promise<string> {
  const made: string[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawd-agent-"));
    made.push(dir);
    return dir;
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/agent/src/json-file.test.ts`:

```ts
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isErrno, readJsonFile, writeJsonAtomic } from "./json-file";
import { useTempDirs } from "./testing/tmp";

describe("json files", () => {
  const tempDir = useTempDirs();

  it("reports a missing file", async () => {
    expect(await readJsonFile(join(await tempDir(), "nope.json"))).toEqual({ found: false });
  });

  it("reports a file that is not JSON without throwing", async () => {
    const path = join(await tempDir(), "bad.json");
    await writeFile(path, "{ not json");
    expect(await readJsonFile(path)).toEqual({ found: true, ok: false });
  });

  it("writes two-space JSON with a trailing newline, creating directories, and reads it back", async () => {
    const path = join(await tempDir(), "deep", "dir", "value.json");
    await writeJsonAtomic(path, { a: 1, b: [true] });
    expect(await readFile(path, "utf8")).toBe('{\n  "a": 1,\n  "b": [\n    true\n  ]\n}\n');
    expect(await readJsonFile(path)).toEqual({ found: true, ok: true, value: { a: 1, b: [true] } });
  });

  it("replaces an existing file and leaves no temp files behind", async () => {
    const dir = await tempDir();
    const path = join(dir, "value.json");
    await writeJsonAtomic(path, { n: 1 });
    await writeJsonAtomic(path, { n: 2 });
    expect(await readJsonFile(path)).toEqual({ found: true, ok: true, value: { n: 2 } });
    expect(await readdir(dir)).toEqual(["value.json"]);
  });

  it("recognises errno codes", () => {
    expect(isErrno(Object.assign(new Error("x"), { code: "ENOENT" }), "ENOENT")).toBe(true);
    expect(isErrno(new Error("x"), "ENOENT")).toBe(false);
    expect(isErrno("ENOENT", "ENOENT")).toBe(false);
  });
});
```

Create `apps/agent/src/stamp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fileStamp } from "./stamp";

describe("fileStamp", () => {
  it("is UTC YYYYMMDDHHmmss", () => {
    expect(fileStamp(Date.UTC(2026, 8, 12, 7, 5, 9, 999))).toBe("20260912070509");
  });
});
```

Create `apps/agent/src/config.test.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentConfigSchema,
  ConfigError,
  DEFAULT_PORT,
  agentPaths,
  defaultConfig,
  defaultHome,
  defaultSettingsPath,
  loadOrCreateConfig,
  readConfig,
  saveConfig,
} from "./config";
import { useTempDirs } from "./testing/tmp";

describe("paths", () => {
  it("lays out the home directory", () => {
    expect(agentPaths("/h")).toEqual({
      home: "/h",
      config: join("/h", "config.json"),
      aliases: join("/h", "aliases.json"),
      logs: join("/h", "logs"),
      bin: join("/h", "bin"),
    });
  });

  it("uses CLAWD_HOME when set, else ~/.clawd", () => {
    expect(defaultHome({ CLAWD_HOME: "/custom" })).toBe("/custom");
    expect(defaultHome({ CLAWD_HOME: "  " })).toBe(join(homedir(), ".clawd"));
    expect(defaultHome({})).toBe(join(homedir(), ".clawd"));
  });

  it("finds Claude Code's user settings, honouring CLAUDE_CONFIG_DIR", () => {
    expect(defaultSettingsPath({ CLAUDE_CONFIG_DIR: "/cc" })).toBe(join("/cc", "settings.json"));
    expect(defaultSettingsPath({})).toBe(join(homedir(), ".claude", "settings.json"));
  });
});

describe("config", () => {
  const tempDir = useTempDirs();

  it("defaults to port 4750, an empty allowlist, local web origins and a fresh 64-hex token", () => {
    const a = defaultConfig();
    expect(a).toMatchObject({ version: 1, port: DEFAULT_PORT, allowlist: [], corsOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"], pollIntervalMs: 10_000, claudeCommand: "claude", logRetentionDays: 7 });
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(defaultConfig().token).not.toBe(a.token);
    expect(AgentConfigSchema.parse(a)).toEqual(a);
  });

  it("reads null when there is no file", async () => {
    expect(await readConfig(agentPaths(await tempDir()))).toBeNull();
  });

  it("creates the file on first load and returns the same token afterwards", async () => {
    const paths = agentPaths(await tempDir());
    const first = await loadOrCreateConfig(paths);
    const onDisk: unknown = JSON.parse(await readFile(paths.config, "utf8"));
    expect(onDisk).toEqual(first);
    expect((await loadOrCreateConfig(paths)).token).toBe(first.token);
  });

  it("round-trips a wrapped status line with fields it does not know", async () => {
    const paths = agentPaths(await tempDir());
    const config = { ...defaultConfig(), wrappedStatusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 2, somethingNew: true } };
    await saveConfig(paths, config);
    expect(await readConfig(paths)).toEqual(config);
  });

  it("names the invalid fields but never their values", async () => {
    const paths = agentPaths(await tempDir());
    await writeFile(paths.config, JSON.stringify({ ...defaultConfig(), token: "SECRET-TOKEN-VALUE", port: "SECRET-PORT", allowList: ["x"] }));
    const err = await readConfig(paths).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    const message = (err as Error).message;
    expect(message).toContain("token");
    expect(message).toContain("port");
    expect(message).toContain("allowList");
    expect(message).not.toContain("SECRET");
  });

  it("rejects a file that is not JSON", async () => {
    const paths = agentPaths(await tempDir());
    await writeFile(paths.config, "{");
    await expect(readConfig(paths)).rejects.toBeInstanceOf(ConfigError);
  });

  it("refuses to save an invalid config", async () => {
    const paths = agentPaths(await tempDir());
    await expect(saveConfig(paths, { ...defaultConfig(), port: 0 })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/json-file.test.ts src/stamp.test.ts src/config.test.ts`
Expected: FAIL, `./json-file`, `./stamp` and `./config` cannot be resolved.

- [ ] **Step 4: Write the modules**

Create `apps/agent/src/json-file.ts`:

```ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonRead = { found: false } | { found: true; ok: false } | { found: true; ok: true; value: unknown };

export function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/** Read and parse a JSON file. A missing file and a file that is not JSON are results, not throws. */
export async function readJsonFile(path: string): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return { found: false };
    throw err;
  }
  try {
    return { found: true, ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { found: true, ok: false };
  }
}

/**
 * Write two-space JSON with a trailing newline to a temp file beside the target, then rename it
 * into place, so a crash or a full disk never leaves half a file. Windows briefly refuses a rename
 * while another process (an editor, a virus scanner) has the target open, so that is retried.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path);
      return;
    } catch (err) {
      const busy = isErrno(err, "EPERM") || isErrno(err, "EBUSY") || isErrno(err, "EACCES");
      if (busy && attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      await rm(tmp, { force: true });
      throw err;
    }
  }
}
```

Create `apps/agent/src/stamp.ts`:

```ts
/** UTC `YYYYMMDDHHmmss`, for backup and recovery file names. */
export function fileStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}
```

Create `apps/agent/src/config.ts`:

```ts
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readJsonFile, writeJsonAtomic } from "./json-file";

export const DEFAULT_PORT = 4750;

export type AgentPaths = { home: string; config: string; aliases: string; logs: string; bin: string };

export function agentPaths(home: string): AgentPaths {
  return { home, config: join(home, "config.json"), aliases: join(home, "aliases.json"), logs: join(home, "logs"), bin: join(home, "bin") };
}

/** `CLAWD_HOME` when set, else `~/.clawd`. */
export function defaultHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.CLAWD_HOME?.trim();
  return fromEnv ? fromEnv : join(homedir(), ".clawd");
}

/** Claude Code's user settings file: under `CLAUDE_CONFIG_DIR` when set, else `~/.claude`. */
export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  return join(dir ? dir : join(homedir(), ".claude"), "settings.json");
}

/** The user's previous status line, kept verbatim so uninstall can put it back exactly. */
export const WrappedStatusLineSchema = z.looseObject({ command: z.string().min(1) });
export type WrappedStatusLine = z.infer<typeof WrappedStatusLineSchema>;

export const AgentConfigSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(1).max(65_535),
    allowlist: z.array(z.string()),
    token: z.string().regex(/^[0-9a-f]{64}$/),
    corsOrigins: z.array(z.url()),
    pollIntervalMs: z.number().int().min(1_000),
    claudeCommand: z.string().min(1),
    logRetentionDays: z.number().int().min(1),
    wrappedStatusLine: WrappedStatusLineSchema.optional(),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export function defaultConfig(token: string = randomBytes(32).toString("hex")): AgentConfig {
  return {
    version: 1,
    port: DEFAULT_PORT,
    allowlist: [],
    token,
    corsOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
    pollIntervalMs: 10_000,
    claudeCommand: "claude",
    logRetentionDays: 7,
  };
}

/** A config file that exists but cannot be used. The message names fields, never their values. */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/** The config, or null when the file does not exist yet. */
export async function readConfig(paths: AgentPaths): Promise<AgentConfig | null> {
  const file = await readJsonFile(paths.config);
  if (!file.found) return null;
  if (!file.ok) throw new ConfigError(`${paths.config} is not valid JSON`);
  const parsed = AgentConfigSchema.safeParse(file.value);
  if (parsed.success) return parsed.data;
  const where = parsed.error.issues.map((issue) =>
    issue.code === "unrecognized_keys" ? `unknown ${issue.keys.join(", ")}` : issue.path.map(String).join(".") || "(root)",
  );
  throw new ConfigError(`${paths.config} is invalid at: ${[...new Set(where)].join("; ")}`);
}

/** The config, created with defaults and a fresh token when it does not exist. */
export async function loadOrCreateConfig(paths: AgentPaths): Promise<AgentConfig> {
  const existing = await readConfig(paths);
  if (existing) return existing;
  const config = defaultConfig();
  await saveConfig(paths, config);
  return config;
}

export async function saveConfig(paths: AgentPaths, config: AgentConfig): Promise<void> {
  await writeJsonAtomic(paths.config, AgentConfigSchema.parse(config));
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent test`
Expected: PASS (all files so far).

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0. If `z.looseObject` infers a type that `exactOptionalPropertyTypes` rejects in the test's `saveConfig` call, keep the test and widen nothing in production code; cast only inside the test.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src
git commit -m "feat(agent): config with a generated token, home paths and atomic JSON writes"
```

---

### Task 3: Ingest: bounded body reader and redaction entry points

**Files:**
- Create: `apps/agent/src/testing/raw.ts`
- Create: `apps/agent/src/ingest/body.ts`
- Create: `apps/agent/src/ingest/ingest.ts`
- Test: `apps/agent/src/ingest/body.test.ts`, `apps/agent/src/ingest/ingest.test.ts`

**Interfaces:**
- Consumes: from `@clawd/core`: `redact`, `containsForbidden`, `type IngestContext = { now: number; allowlist: readonly string[] }`, `type RedactedEvent`.
- Produces:
  - `type BodyResult = { ok: true; body: Buffer } | { ok: false; reason: "tooLarge" | "aborted" }`; `readBody(stream: Readable, limit: number): Promise<BodyResult>`.
  - `ingestHook(raw: unknown, ctx: IngestContext): RedactedEvent | null`; `ingestStatus(raw: unknown, ctx: IngestContext): RedactedEvent | null`; `parseJson(body: Buffer): { ok: true; value: unknown } | { ok: false }`.
  - Test helpers: `CANARY = "CANARY"`, `ALLOWED_ROOT = "C:/work"`, `CANARY_CWD = "C:/work/CANARY-repo"`, `OUTSIDE_CWD`, `rawHook(event, sessionId, extra?)`, `rawStatus(sessionId, extra?)`, `rawSessionScript(sessionId)`, `rawAgentEntry(sessionId, extra?)`.

- [ ] **Step 1: Write the canary payload helpers**

Create `apps/agent/src/testing/raw.ts`:

```ts
/**
 * Raw payloads shaped like the ones measured in docs/spike-hooks.md. Every field that must never
 * survive ingest carries the canary marker, and so does the session's directory name, so a test can
 * assert that no sink ever contains the marker.
 */
export const CANARY = "CANARY";
/** The allowlisted root the canary sessions run under. */
export const ALLOWED_ROOT = "C:/work";
export const CANARY_CWD = "C:/work/CANARY-repo";
export const OUTSIDE_CWD = "C:/private/CANARY-elsewhere";

const content = {
  transcript_path: "C:/Users/someone/.claude/projects/CANARY-project/CANARY-transcript.jsonl",
  permission_mode: "default",
  prompt_id: "prompt-1",
  effort: "high",
  prompt: "CANARY prompt: please read the secret file",
  tool_input: { file_path: "C:/work/CANARY-repo/CANARY-secret.ts", command: "cat CANARY-secret" },
  tool_response: { stdout: "CANARY tool output", file: { content: "CANARY file content" } },
  last_assistant_message: "CANARY assistant reply",
  session_name: "CANARY session name",
  agent_transcript_path: "C:/Users/someone/.claude/CANARY-agent.jsonl",
  error: "CANARY error text",
};

export function rawHook(event: string, sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: sessionId, cwd: CANARY_CWD, hook_event_name: event, ...content, ...extra };
}

export function rawStatus(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: CANARY_CWD,
    transcript_path: content.transcript_path,
    session_name: content.session_name,
    workspace: { current_dir: CANARY_CWD, project_dir: CANARY_CWD },
    model: { id: "claude-opus-5", display_name: "Opus 5" },
    context_window: { used_percentage: 42, remaining_percentage: 58, context_window_size: 200_000 },
    cost: { total_cost_usd: 1.25 },
    rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 20 } },
    version: "2.1.205",
    ...extra,
  };
}

/** One entry of `claude agents --json`, with the session name the agent must never keep. */
export function rawAgentEntry(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { pid: 4242, cwd: CANARY_CWD, kind: "interactive", startedAt: 1_757_671_200_000, sessionId, name: "CANARY session name", ...extra };
}

/** Every modelled hook once, in a plausible order, including both failure hooks and an MCP tool. */
export function rawSessionScript(sessionId: string): Record<string, unknown>[] {
  return [
    rawHook("SessionStart", sessionId, { source: "startup" }),
    rawHook("UserPromptSubmit", sessionId),
    rawHook("PreToolUse", sessionId, { tool_name: "Write", tool_use_id: "toolu_1" }),
    rawHook("PermissionRequest", sessionId, { tool_name: "Write" }),
    rawHook("PostToolUse", sessionId, { tool_name: "Write", tool_use_id: "toolu_1", duration_ms: 12 }),
    rawHook("PreToolUse", sessionId, { tool_name: "mcp__CANARY-server__lookup", tool_use_id: "toolu_2" }),
    rawHook("PostToolUseFailure", sessionId, { tool_name: "mcp__CANARY-server__lookup", tool_use_id: "toolu_2" }),
    rawHook("SubagentStart", sessionId, { agent_id: "agent_1", agent_type: "general-purpose" }),
    rawHook("PreToolUse", sessionId, { tool_name: "Read", tool_use_id: "toolu_3", agent_id: "agent_1", agent_type: "general-purpose" }),
    rawHook("SubagentStop", sessionId, { agent_id: "agent_1", agent_type: "general-purpose" }),
    rawHook("Stop", sessionId, {
      stop_hook_active: false,
      background_tasks: [{ id: "b1", type: "shell", status: "running", description: "CANARY shell description", command: "CANARY shell command" }],
    }),
    rawHook("SessionEnd", sessionId, { reason: "prompt_input_exit" }),
  ];
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/agent/src/ingest/body.test.ts`:

```ts
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readBody } from "./body";

describe("readBody", () => {
  it("collects a body under the limit", async () => {
    const result = await readBody(Readable.from([Buffer.from('{"a":'), Buffer.from("1}")]), 100);
    expect(result).toEqual({ ok: true, body: Buffer.from('{"a":1}') });
  });

  it("accepts a body of exactly the limit", async () => {
    expect(await readBody(Readable.from([Buffer.alloc(100)]), 100)).toMatchObject({ ok: true });
  });

  it("drops a body over the limit but still reads the stream to its end", async () => {
    const stream = Readable.from([Buffer.alloc(60), Buffer.alloc(60), Buffer.alloc(60)]);
    expect(await readBody(stream, 100)).toEqual({ ok: false, reason: "tooLarge" });
    expect(stream.readableEnded).toBe(true);
  });

  it("reports a stream that fails part way", async () => {
    const stream = new Readable({ read() {} });
    const pending = readBody(stream, 100);
    stream.push(Buffer.from("{"));
    stream.destroy(new Error("socket reset"));
    expect(await pending).toEqual({ ok: false, reason: "aborted" });
  });
});
```

Create `apps/agent/src/ingest/ingest.test.ts`:

```ts
import { containsForbidden } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { ALLOWED_ROOT, CANARY, OUTSIDE_CWD, rawHook, rawSessionScript, rawStatus } from "../testing/raw";
import { ingestHook, ingestStatus, parseJson } from "./ingest";

const ctx = { now: 1_757_671_200_000, allowlist: [ALLOWED_ROOT] };

describe("ingestHook", () => {
  it("redacts every modelled hook and keeps no canary", () => {
    const events = rawSessionScript("s1").map((raw) => ingestHook(raw, ctx));
    expect(events.map((e) => e?.kind)).toEqual([
      "session.start",
      "prompt",
      "tool.start",
      "permission.request",
      "tool.end",
      "tool.start",
      "tool.end",
      "subagent.start",
      "tool.start",
      "subagent.stop",
      "stop",
      "session.end",
    ]);
    expect(JSON.stringify(events)).not.toContain(CANARY);
    expect(containsForbidden(events)).toBeNull();
  });

  it("reads PostToolUseFailure as the end of that tool call", () => {
    const e = ingestHook(rawHook("PostToolUseFailure", "s1", { tool_name: "Bash", tool_use_id: "toolu_9", is_interrupt: true }), ctx);
    expect(e).toMatchObject({ kind: "tool.end", tool: "Bash", category: "run", toolUseId: "toolu_9", durationMs: 0 });
  });

  it("reads StopFailure as a stop with nothing in the background", () => {
    expect(ingestHook(rawHook("StopFailure", "s1", { error_type: "rate_limit" }), ctx)).toMatchObject({ kind: "stop", backgroundTasks: 0 });
  });

  it("counts only subagent background tasks, never a shell", () => {
    const e = ingestHook(rawHook("Stop", "s1", { background_tasks: [{ type: "shell", command: "CANARY" }, { type: "subagent", agent_type: "x" }] }), ctx);
    expect(e).toMatchObject({ kind: "stop", backgroundTasks: 1 });
  });

  it("drops sessions outside the allowlist", () => {
    expect(ingestHook(rawHook("UserPromptSubmit", "s1", { cwd: OUTSIDE_CWD }), ctx)).toBeNull();
    expect(ingestHook(rawHook("UserPromptSubmit", "s1"), { ...ctx, allowlist: [] })).toBeNull();
  });

  it("drops unmodelled events and anything that is not a hook payload", () => {
    for (const raw of [rawHook("MessageDisplay", "s1", { delta: "CANARY" }), rawHook("Notification", "s1"), rawHook("PreCompact", "s1"), null, 42, "text", [], {}]) {
      expect(ingestHook(raw, ctx)).toBeNull();
    }
  });

  it("never accepts a status line payload on the hook route", () => {
    expect(ingestHook(rawStatus("s1"), ctx)).toBeNull();
  });

  it("stamps the event with the ingest clock", () => {
    expect(ingestHook(rawHook("UserPromptSubmit", "s1"), ctx)?.t).toBe(ctx.now);
  });
});

describe("ingestStatus", () => {
  it("keeps only context, cost, limits and model", () => {
    const e = ingestStatus(rawStatus("s1"), ctx);
    expect(e).toMatchObject({ kind: "status", contextPct: 42, costUsd: 1.25, rateLimit5h: 10, rateLimit7d: 20, model: "Opus 5" });
    expect(JSON.stringify(e)).not.toContain(CANARY);
    expect(containsForbidden(e)).toBeNull();
  });

  it("never accepts a hook payload on the status route", () => {
    expect(ingestStatus(rawHook("UserPromptSubmit", "s1"), ctx)).toBeNull();
    expect(ingestStatus(rawHook("Stop", "s1", { context_window: { used_percentage: 5 } }), ctx)).toBeNull();
  });

  it("drops junk and sessions outside the allowlist", () => {
    expect(ingestStatus(null, ctx)).toBeNull();
    expect(ingestStatus([], ctx)).toBeNull();
    expect(ingestStatus(rawStatus("s1", { cwd: OUTSIDE_CWD }), ctx)).toBeNull();
  });
});

describe("parseJson", () => {
  it("parses JSON and reports anything else without throwing", () => {
    expect(parseJson(Buffer.from('{"a":1}'))).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJson(Buffer.from("{"))).toEqual({ ok: false });
    expect(parseJson(Buffer.alloc(0))).toEqual({ ok: false });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/ingest`
Expected: FAIL, `./body` and `./ingest` cannot be resolved.

- [ ] **Step 4: Write the modules**

Create `apps/agent/src/ingest/body.ts`:

```ts
import type { Readable } from "node:stream";

export type BodyResult = { ok: true; body: Buffer } | { ok: false; reason: "tooLarge" | "aborted" };

/**
 * Collect a request body up to `limit` bytes. Past the limit nothing more is kept, but the stream is
 * still read to its end so the client gets a response rather than a reset.
 */
export function readBody(stream: Readable, limit: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    let settled = false;
    const settle = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    stream.on("data", (chunk: Buffer | string) => {
      if (over) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => settle(over ? { ok: false, reason: "tooLarge" } : { ok: true, body: Buffer.concat(chunks) }));
    stream.on("error", () => settle({ ok: false, reason: "aborted" }));
    stream.on("close", () => settle({ ok: false, reason: "aborted" }));
  });
}
```

Create `apps/agent/src/ingest/ingest.ts`:

```ts
import { redact, type IngestContext, type RedactedEvent } from "@clawd/core";

/**
 * Hooks core does not model but whose meaning it already has. A tool that errors still ends its
 * call, and a turn that ends in an API error still ends the turn. Renamed before redaction, so
 * every other field still goes through redact(). Candidates to move into core.
 */
const FAILURE_HOOKS: Readonly<Record<string, string>> = { PostToolUseFailure: "PostToolUse", StopFailure: "Stop" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A raw hook payload to a redacted event, or null. Status line payloads are refused here. */
export function ingestHook(raw: unknown, ctx: IngestContext): RedactedEvent | null {
  if (!isPlainObject(raw)) return null;
  const name = raw.hook_event_name;
  if (typeof name !== "string") return null;
  const renamed = Object.hasOwn(FAILURE_HOOKS, name) ? FAILURE_HOOKS[name] : undefined;
  const event = redact(renamed ? { ...raw, hook_event_name: renamed } : raw, ctx);
  return event && event.kind !== "status" && event.kind !== "presence" ? event : null;
}

/** A raw status line payload to a `status` event, or null. Hook payloads are refused here. */
export function ingestStatus(raw: unknown, ctx: IngestContext): RedactedEvent | null {
  if (!isPlainObject(raw) || "hook_event_name" in raw) return null;
  const event = redact(raw, ctx);
  return event?.kind === "status" ? event : null;
}

export function parseJson(body: Buffer): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body.toString("utf8")) as unknown };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent test`
Expected: PASS.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src
git commit -m "feat(agent): ingest entry points over redact with failure hooks and canary tests"
```

---

### Task 4: Alias store and redacted event log

**Files:**
- Create: `apps/agent/src/store/alias-store.ts`
- Create: `apps/agent/src/store/event-log.ts`
- Test: `apps/agent/src/store/alias-store.test.ts`, `apps/agent/src/store/event-log.test.ts`

**Interfaces:**
- Consumes: `readJsonFile`, `writeJsonAtomic` (Task 2); `fileStamp` (Task 2); `Logger` (Task 1); from `@clawd/core`: `emptyAliasMap`, `type AliasMap`, `RedactedEventSchema`, `containsForbidden`, `parseFixture`, `type RedactedEvent`.
- Produces:
  - `type AliasStore = { load(): Promise<AliasMap>; save(map: AliasMap): void; flush(): Promise<void> }`; `createAliasStore(path: string, deps: { log: Logger; now: () => number; debounceMs?: number }): AliasStore`.
  - `type EventLog = { append(e: RedactedEvent): void; sweep(): Promise<void>; flush(): Promise<void> }`; `createEventLog(dir: string, deps: { now: () => number; retentionDays: number; log: Logger; sensitive?: () => readonly string[] }): EventLog`; `logFileName(ms: number): string`.

- [ ] **Step 1: Write the failing tests**

Create `apps/agent/src/store/alias-store.test.ts`:

```ts
import { emptyAliasMap, ensureSessionAlias } from "@clawd/core";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readJsonFile } from "../json-file";
import { useTempDirs } from "../testing/tmp";
import { createAliasStore } from "./alias-store";

const NOW = Date.UTC(2026, 8, 12, 10, 0, 0);

describe("alias store", () => {
  const tempDir = useTempDirs();

  it("loads an empty map when there is no file", async () => {
    const store = createAliasStore(join(await tempDir(), "aliases.json"), { log: vi.fn(), now: () => NOW });
    expect(await store.load()).toEqual(emptyAliasMap());
  });

  it("saves the latest map on flush and loads it back", async () => {
    const path = join(await tempDir(), "aliases.json");
    const store = createAliasStore(path, { log: vi.fn(), now: () => NOW, debounceMs: 60_000 });
    const one = ensureSessionAlias(emptyAliasMap(), "s1").map;
    const two = ensureSessionAlias(one, "s2").map;
    store.save(one);
    store.save(two);
    await store.flush();
    expect(await readJsonFile(path)).toEqual({ found: true, ok: true, value: two });
    expect(await createAliasStore(path, { log: vi.fn(), now: () => NOW }).load()).toEqual(two);
  });

  it("writes on its own after the debounce", async () => {
    const path = join(await tempDir(), "aliases.json");
    const store = createAliasStore(path, { log: vi.fn(), now: () => NOW, debounceMs: 5 });
    store.save(ensureSessionAlias(emptyAliasMap(), "s1").map);
    await vi.waitFor(async () => expect((await readJsonFile(path)).found).toBe(true), { timeout: 2000 });
  });

  it("flushes nothing when nothing is pending", async () => {
    const dir = await tempDir();
    await createAliasStore(join(dir, "aliases.json"), { log: vi.fn(), now: () => NOW }).flush();
    expect(await readdir(dir)).toEqual([]);
  });

  it.each([
    ["not JSON", "{"],
    ["the wrong shape", '{"sessions":3}'],
  ])("sets aside a file that is %s and starts empty", async (_label, text) => {
    const dir = await tempDir();
    const path = join(dir, "aliases.json");
    await writeFile(path, text);
    const log = vi.fn();
    expect(await createAliasStore(path, { log, now: () => NOW }).load()).toEqual(emptyAliasMap());
    expect(await readdir(dir)).toEqual(["aliases.json.bad-20260912100000"]);
    expect(log).toHaveBeenCalledWith("store.aliasesRecovered");
  });
});
```

Create `apps/agent/src/store/event-log.test.ts`:

```ts
import { parseFixture, type RedactedEvent } from "@clawd/core";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useTempDirs } from "../testing/tmp";
import { createEventLog, logFileName } from "./event-log";

const DAY1 = Date.UTC(2026, 8, 12, 23, 59, 0);
const DAY2 = Date.UTC(2026, 8, 13, 0, 1, 0);
const prompt = (t: number, sessionId = "s1"): RedactedEvent => ({ v: 1, t, sessionId, paneKey: "0123456789abcdef", kind: "prompt" });

describe("event log", () => {
  const tempDir = useTempDirs();

  it("names files by UTC day", () => {
    expect(logFileName(DAY1)).toBe("events-2026-09-12.jsonl");
    expect(logFileName(DAY2)).toBe("events-2026-09-13.jsonl");
  });

  it("writes one fixture-format file per day that parseFixture reads back", async () => {
    const dir = await tempDir();
    const log = createEventLog(dir, { now: () => DAY2, retentionDays: 7, log: vi.fn() });
    log.append(prompt(DAY1));
    log.append(prompt(DAY1 + 1, "s2"));
    log.append(prompt(DAY2));
    await log.flush();
    expect((await readdir(dir)).sort()).toEqual(["events-2026-09-12.jsonl", "events-2026-09-13.jsonl"]);
    const first = parseFixture(await readFile(join(dir, "events-2026-09-12.jsonl"), "utf8"));
    expect(first.name).toBe("events-2026-09-12");
    expect(first.events).toEqual([prompt(DAY1), prompt(DAY1 + 1, "s2")]);
    expect(parseFixture(await readFile(join(dir, "events-2026-09-13.jsonl"), "utf8")).events).toEqual([prompt(DAY2)]);
  });

  it("appends to a file from an earlier run without a second header", async () => {
    const dir = await tempDir();
    const a = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: vi.fn() });
    a.append(prompt(DAY1));
    await a.flush();
    const b = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: vi.fn() });
    b.append(prompt(DAY1 + 5));
    await b.flush();
    expect(parseFixture(await readFile(join(dir, logFileName(DAY1)), "utf8")).events).toHaveLength(2);
  });

  it("refuses an event that is not a valid redacted event, such as one carrying a cwd", async () => {
    const dir = await tempDir();
    const logger = vi.fn();
    const log = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: logger });
    log.append({ ...prompt(DAY1), cwd: "C:/work/CANARY" } as unknown as RedactedEvent);
    await log.flush();
    expect(await readdir(dir).catch(() => [])).toEqual([]);
    expect(logger).toHaveBeenCalledWith("privacy.blocked");
  });

  it("refuses an event that contains a live working directory", async () => {
    const dir = await tempDir();
    const logger = vi.fn();
    const log = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: logger, sensitive: () => ["C:/work/CANARY-repo"] });
    log.append({ v: 1, t: DAY1, sessionId: "s1", paneKey: "0123456789abcdef", kind: "status", model: "C:/work/CANARY-repo" });
    log.append(prompt(DAY1));
    await log.flush();
    const text = await readFile(join(dir, logFileName(DAY1)), "utf8");
    expect(text).not.toContain("CANARY");
    expect(parseFixture(text).events).toEqual([prompt(DAY1)]);
    expect(logger).toHaveBeenCalledWith("privacy.blocked");
  });

  it("deletes day files older than the retention and nothing else", async () => {
    const dir = await tempDir();
    const now = Date.UTC(2026, 8, 12, 12, 0, 0);
    for (const name of ["events-2026-09-01.jsonl", "events-2026-09-04.jsonl", "events-2026-09-05.jsonl", "events-2026-09-12.jsonl", "notes.txt"]) {
      await writeFile(join(dir, name), "x");
    }
    await createEventLog(dir, { now: () => now, retentionDays: 7, log: vi.fn() }).sweep();
    expect((await readdir(dir)).sort()).toEqual(["events-2026-09-05.jsonl", "events-2026-09-12.jsonl", "notes.txt"]);
  });

  it("sweeps a missing directory without failing", async () => {
    await createEventLog(join(await tempDir(), "absent"), { now: () => DAY1, retentionDays: 7, log: vi.fn() }).sweep();
  });
});
```

The retention case: with `now` at noon on 12 September and seven days, the cutoff is noon on 5 September. A file is deleted when its whole day ended before the cutoff, so 1 and 4 September go and 5 September stays.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/store`
Expected: FAIL, `./alias-store` and `./event-log` cannot be resolved.

- [ ] **Step 3: Write the modules**

Create `apps/agent/src/store/alias-store.ts`:

```ts
import { emptyAliasMap, type AliasMap } from "@clawd/core";
import { rename } from "node:fs/promises";
import { z } from "zod";
import { readJsonFile, writeJsonAtomic } from "../json-file";
import type { Logger } from "../log";
import { fileStamp } from "../stamp";

const EntrySchema = z.object({ alias: z.string().min(1), label: z.string().min(1) }).strict();
const AliasMapSchema = z
  .object({
    sessions: z.record(z.string(), EntrySchema),
    panes: z.record(z.string(), EntrySchema),
    nextSession: z.number().int().min(1),
    nextPane: z.number().int().min(1),
  })
  .strict();

export type AliasStore = {
  load(): Promise<AliasMap>;
  /** Remember the latest map; it is written after the debounce, or on flush. */
  save(map: AliasMap): void;
  flush(): Promise<void>;
};

export function createAliasStore(path: string, deps: { log: Logger; now: () => number; debounceMs?: number }): AliasStore {
  const debounceMs = deps.debounceMs ?? 1_000;
  let pending: AliasMap | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const writeNow = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const map = pending;
    pending = null;
    if (map === null) return chain;
    chain = chain.then(() => writeJsonAtomic(path, map)).catch(() => deps.log("store.aliasesSaveFailed"));
    return chain;
  };

  return {
    async load() {
      const file = await readJsonFile(path);
      if (!file.found) return emptyAliasMap();
      const parsed = file.ok ? AliasMapSchema.safeParse(file.value) : null;
      if (parsed?.success) return parsed.data;
      // Never crash on a damaged file, and never silently destroy it either.
      await rename(path, `${path}.bad-${fileStamp(deps.now())}`);
      deps.log("store.aliasesRecovered");
      return emptyAliasMap();
    },
    save(map) {
      pending = map;
      timer ??= setTimeout(() => {
        timer = null;
        void writeNow();
      }, debounceMs);
    },
    flush: writeNow,
  };
}
```

Create `apps/agent/src/store/event-log.ts`:

```ts
import { RedactedEventSchema, containsForbidden, type RedactedEvent } from "@clawd/core";
import { appendFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isErrno } from "../json-file";
import type { Logger } from "../log";

const DAY_MS = 86_400_000;
const FILE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export type EventLog = {
  append(e: RedactedEvent): void;
  /** Delete day files whose whole day is older than the retention. */
  sweep(): Promise<void>;
  /** Resolves once every append so far has been written. */
  flush(): Promise<void>;
};

export function logFileName(ms: number): string {
  return `events-${new Date(ms).toISOString().slice(0, 10)}.jsonl`;
}

/**
 * The redacted event log: one file per UTC day in core's fixture format, so parseFixture() and
 * createReplaySource() read a day unchanged. Every line is revalidated before it is written.
 */
export function createEventLog(
  dir: string,
  deps: { now: () => number; retentionDays: number; log: Logger; sensitive?: () => readonly string[] },
): EventLog {
  let chain: Promise<void> = Promise.resolve();
  const headed = new Set<string>();

  return {
    append(e) {
      const parsed = RedactedEventSchema.safeParse(e);
      if (!parsed.success || containsForbidden(parsed.data, deps.sensitive?.() ?? []) !== null) {
        deps.log("privacy.blocked");
        return;
      }
      const name = logFileName(parsed.data.t);
      const line = JSON.stringify(parsed.data) + "\n";
      chain = chain
        .then(async () => {
          const path = join(dir, name);
          if (!headed.has(name)) {
            await mkdir(dir, { recursive: true });
            try {
              // "wx" writes the header only when the file is new; a file from an earlier run has one.
              await writeFile(path, JSON.stringify({ fixture: 1, name: name.replace(/\.jsonl$/, "") }) + "\n", { flag: "wx" });
            } catch (err) {
              if (!isErrno(err, "EEXIST")) throw err;
            }
            headed.add(name);
          }
          await appendFile(path, line);
        })
        .catch(() => deps.log("store.logWriteFailed"));
    },
    async sweep() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      const cutoff = deps.now() - deps.retentionDays * DAY_MS;
      for (const name of names) {
        const day = FILE.exec(name)?.[1];
        if (day === undefined) continue;
        if (Date.parse(`${day}T00:00:00.000Z`) + DAY_MS > cutoff) continue;
        await rm(join(dir, name), { force: true }).catch(() => deps.log("store.retentionFailed"));
        headed.delete(name);
      }
    },
    flush: () => chain,
  };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent test`
Expected: PASS.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/store
git commit -m "feat(agent): alias persistence with recovery and a daily redacted event log"
```

---

### Task 5: Fleet host

**Files:**
- Create: `apps/agent/src/testing/events.ts`
- Create: `apps/agent/src/host/host.ts`
- Test: `apps/agent/src/host/host.test.ts`

**Interfaces:**
- Consumes: `Logger`, `silentLogger` (Task 1); from `@clawd/core`: `applyEvent`, `tickFleet`, `deriveSnapshot`, `emptyFleet`, `ensureSessionAlias`, `TickerEventSchema`, `StreamTickerMessageSchema`, `TICKER_BACKFILL`, `DEFAULT_CONFIG`, `emptyAliasMap`, `parseFixture`, `snapshotFrames`, types `AliasMap`, `Fleet`, `RedactedEvent`, `SessionPhase`, `Snapshot`, `SnapshotFrame`, `StateConfig`, `StreamTickerMessage`, `TickerEvent`.
- Produces:
  - `type SessionView = { paneKey: string; state: SessionPhase; firstSeenAt: number; lastEventAt: number }`
  - `type HostListener = { event?(e: RedactedEvent): void; ticker?(m: StreamTickerMessage): void; snapshot?(s: Snapshot): void; aliases?(map: AliasMap): void }`
  - `type HostDeps = { now: () => number; config: StateConfig; aliases: AliasMap; log: Logger }`
  - `DUPLICATE_START_MS = 5_000`
  - `class FleetHost` with `constructor(deps: HostDeps)`, `on(listener): () => void`, `ingest(e: RedactedEvent): void`, `tick(): void`, `snapshot(): Snapshot`, `tickerFor(alias: string): TickerEvent[] | null`, `sessionIdFor(alias: string): string | null`, `sessions(): ReadonlyMap<string, SessionView>`, `sessionCount(): number`, `endedIds(): ReadonlySet<string>`, `forgetEnded(listed: ReadonlySet<string>): void`, `aliases(): AliasMap`.
  - Test helper `T0 = 1_757_671_200_000` and `ev(kind, t, extra, sessionId = "s1", paneKey = "pane-key-1"): RedactedEvent`.

- [ ] **Step 1: Write the event builder**

Create `apps/agent/src/testing/events.ts`:

```ts
import type { RedactedEvent } from "@clawd/core";

/** 12 September 2026 10:00 UTC. */
export const T0 = 1_757_671_200_000;

type Kind = RedactedEvent["kind"];
type Extra<K extends Kind> = Omit<Extract<RedactedEvent, { kind: K }>, "v" | "t" | "sessionId" | "paneKey" | "kind">;

/** A typed redacted event for tests: the kind decides which extra fields are required. */
export function ev<K extends Kind>(kind: K, t: number, extra: Extra<K>, sessionId = "s1", paneKey = "pane-key-1"): RedactedEvent {
  return { v: 1, t, sessionId, paneKey, kind, ...extra } as RedactedEvent;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/agent/src/host/host.test.ts`:

```ts
import {
  DEFAULT_CONFIG,
  SnapshotSchema,
  TICKER_BACKFILL,
  emptyAliasMap,
  parseFixture,
  snapshotFrames,
  type AliasMap,
  type Snapshot,
  type SnapshotFrame,
  type StreamTickerMessage,
} from "@clawd/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../log";
import { T0, ev } from "../testing/events";
import { FleetHost } from "./host";

const FIXTURES = fileURLToPath(new URL("../../../../packages/core/src/fixtures/", import.meta.url));
const iso = (ms: number): string => new Date(ms).toISOString();

function makeHost(start = T0, aliases: AliasMap = emptyAliasMap()) {
  const clock = { now: start };
  const host = new FleetHost({ now: () => clock.now, config: DEFAULT_CONFIG, aliases, log: silentLogger });
  const seen = { events: [] as string[], tickers: [] as StreamTickerMessage[], snapshots: [] as Snapshot[], aliases: [] as AliasMap[] };
  host.on({
    event: (e) => seen.events.push(e.kind),
    ticker: (m) => seen.tickers.push(m),
    snapshot: (s) => seen.snapshots.push(s),
    aliases: (a) => seen.aliases.push(a),
  });
  return { host, clock, seen };
}

const withoutUpdatedAt = (f: SnapshotFrame) => ({ ...f, sessions: f.sessions.map(({ updatedAt: _u, ...s }) => s) });

describe("FleetHost against core's fixtures", () => {
  it.each(["permission-denied", "killed-session", "spike-headless", "spike-interactive"])("%s ends where core's golden sequence ends", (name) => {
    const fixture = parseFixture(readFileSync(join(FIXTURES, `${name}.jsonl`), "utf8"));
    const expected = snapshotFrames(fixture).at(-1);
    expect(expected).toBeDefined();
    const { host, clock } = makeHost(0);
    for (const e of fixture.events) {
      clock.now = e.t;
      host.ingest(e);
      host.tick();
    }
    clock.now = (fixture.events.at(-1)?.t ?? 0) + DEFAULT_CONFIG.minDisplayMs;
    const { generatedAt: _g, ...last } = host.snapshot();
    expect(withoutUpdatedAt(last)).toEqual(withoutUpdatedAt(expected as SnapshotFrame));
  });
});

describe("FleetHost", () => {
  it("reduces an event and emits the event, its ticker lines under the session alias, and a snapshot", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    expect(seen.events).toEqual(["prompt"]);
    expect(seen.tickers).toEqual([{ alias: "agent-1", event: { t: iso(T0), kind: "prompt" } }]);
    expect(seen.snapshots).toHaveLength(1);
    expect(() => SnapshotSchema.parse(seen.snapshots[0])).not.toThrow();
    clock.now = T0 + DEFAULT_CONFIG.minDisplayMs;
    expect(host.snapshot().sessions[0]).toMatchObject({ alias: "agent-1", label: "Otter", state: "working", activity: "think" });
    expect(host.tickerFor("agent-1")).toEqual([{ t: iso(T0), kind: "prompt" }]);
    expect(host.tickerFor("agent-99")).toBeNull();
    expect(host.sessionIdFor("agent-1")).toBe("s1");
    expect(host.sessionIdFor("agent-99")).toBeNull();
    expect(host.sessionCount()).toBe(1);
  });

  it("emits a snapshot only when it changed", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.tick();
    host.tick();
    expect(seen.snapshots).toHaveLength(1);
    clock.now = T0 + DEFAULT_CONFIG.minDisplayMs;
    host.tick();
    expect(seen.snapshots).toHaveLength(2);
  });

  it("keeps the last TICKER_BACKFILL lines per session", () => {
    const { host } = makeHost();
    for (let i = 0; i < 150; i++) {
      host.ingest(ev("tool.start", T0, { tool: "Read", category: "read", toolUseId: `u${i}` }));
      host.ingest(ev("tool.end", T0, { tool: "Read", category: "read", toolUseId: `u${i}`, durationMs: 1 }));
    }
    const lines = host.tickerFor("agent-1");
    expect(lines).toHaveLength(TICKER_BACKFILL);
    expect(lines?.at(-1)).toMatchObject({ kind: "tool.end" });
  });

  it("drops a second session.start inside five seconds and keeps one after", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("session.start", T0, { source: "startup" }));
    clock.now = T0 + 1_000;
    host.ingest(ev("session.start", clock.now, {}));
    expect(seen.tickers.map((m) => m.event.kind)).toEqual(["session.start"]);
    clock.now = T0 + 7_000;
    host.ingest(ev("session.start", clock.now, {}));
    expect(seen.tickers.map((m) => m.event.kind)).toEqual(["session.start", "session.start"]);
  });

  it("drops a status line that does not change the rounded context percentage", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("status", T0, { contextPct: 40.2 }));
    clock.now = T0 + 100;
    host.ingest(ev("status", clock.now, { contextPct: 39.8 }));
    host.ingest(ev("status", clock.now, { costUsd: 2 }));
    expect(seen.events).toEqual(["status"]);
    host.ingest(ev("status", clock.now, { contextPct: 41 }));
    expect(seen.events).toEqual(["status", "status"]);
    expect(seen.tickers.map((m) => m.event)).toEqual([
      { t: iso(T0), kind: "context", contextPct: 40.2 },
      { t: iso(T0 + 100), kind: "context", contextPct: 41 },
    ]);
  });

  it("drops stragglers for an ended session until a session.start reopens it", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("session.end", T0, { reason: "other" }));
    expect(host.endedIds().has("s1")).toBe(true);
    clock.now = T0 + DEFAULT_CONFIG.doneLingerMs;
    host.tick();
    expect(host.sessionCount()).toBe(0);
    const before = seen.events.length;
    host.ingest(ev("status", clock.now, { contextPct: 12 }));
    host.ingest(ev("subagent.stop", clock.now, { agentId: "a1", agentType: "general-purpose" }));
    host.ingest(ev("presence", clock.now, { alive: true }));
    expect(host.sessionCount()).toBe(0);
    expect(seen.events).toHaveLength(before);
    host.ingest(ev("session.start", clock.now, { source: "resume" }));
    expect(host.endedIds().has("s1")).toBe(false);
    expect(host.sessionCount()).toBe(1);
  });

  it("records a session.end for a session it never saw, so a presence poll cannot create it", () => {
    const { host } = makeHost();
    host.ingest(ev("session.end", T0, { reason: "other" }));
    expect(host.sessionCount()).toBe(0);
    host.ingest(ev("presence", T0, { alive: true }));
    expect(host.sessionCount()).toBe(0);
  });

  it("adds a dead presence to the ended set and forgets ended ids the poll no longer lists", () => {
    const { host } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("presence", T0, { alive: false }));
    expect([...host.endedIds()]).toEqual(["s1"]);
    host.forgetEnded(new Set(["s1"]));
    expect([...host.endedIds()]).toEqual(["s1"]);
    host.forgetEnded(new Set());
    expect([...host.endedIds()]).toEqual([]);
  });

  it("writes a state line when a tick changes a session's state", () => {
    const { host, clock, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("stop", T0, { backgroundTasks: 0 }));
    clock.now = T0 + DEFAULT_CONFIG.asleepAfterMs;
    host.tick();
    expect(seen.tickers.at(-1)).toEqual({ alias: "agent-1", event: { t: iso(clock.now), kind: "state", state: "asleep" } });
    clock.now += DEFAULT_CONFIG.minDisplayMs;
    expect(host.snapshot().sessions[0]?.state).toBe("asleep");
  });

  it("drops the ticker of a pruned session but still knows its alias", () => {
    const { host, clock } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    host.ingest(ev("session.end", T0, { reason: "other" }));
    clock.now = T0 + DEFAULT_CONFIG.doneLingerMs;
    host.tick();
    expect(host.tickerFor("agent-1")).toEqual([]);
  });

  it("announces the alias map when a session or pane is first named, not on every event", () => {
    const { host, seen } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    const count = seen.aliases.length;
    expect(count).toBeGreaterThan(0);
    expect(Object.keys(seen.aliases.at(-1)?.sessions ?? {})).toEqual(["s1"]);
    expect(host.aliases()).toBe(seen.aliases.at(-1));
    host.ingest(ev("tool.start", T0, { tool: "Read", category: "read", toolUseId: "u1" }));
    expect(seen.aliases).toHaveLength(count);
  });

  it("starts from a persisted alias map", () => {
    const persisted: AliasMap = { sessions: { s1: { alias: "agent-7", label: "Otter" } }, panes: {}, nextSession: 8, nextPane: 1 };
    const { host, seen } = makeHost(T0, persisted);
    host.ingest(ev("prompt", T0, {}));
    expect(seen.tickers[0]?.alias).toBe("agent-7");
  });

  it("describes sessions for reconciliation", () => {
    const { host, clock } = makeHost();
    host.ingest(ev("prompt", T0, {}));
    clock.now = T0 + 50;
    host.ingest(ev("stop", clock.now, { backgroundTasks: 0 }));
    expect(host.sessions().get("s1")).toEqual({ paneKey: "pane-key-1", state: "idle", firstSeenAt: T0, lastEventAt: T0 + 50 });
  });

  it("keeps going when a listener throws, and stops calling one that unsubscribed", () => {
    const log = vi.fn();
    const host = new FleetHost({ now: () => T0, config: DEFAULT_CONFIG, aliases: emptyAliasMap(), log });
    const snapshots: Snapshot[] = [];
    const events: string[] = [];
    host.on({ event: () => { throw new Error("boom"); } });
    host.on({ snapshot: (s) => snapshots.push(s) });
    const off = host.on({ event: (e) => events.push(e.kind) });
    host.ingest(ev("prompt", T0, {}));
    off();
    host.ingest(ev("stop", T0, { backgroundTasks: 0 }));
    expect(snapshots.length).toBeGreaterThan(0);
    expect(events).toEqual(["prompt"]);
    expect(log).toHaveBeenCalledWith("host.listenerFailed");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @clawd/agent exec vitest run src/host`
Expected: FAIL, `./host` cannot be resolved.

- [ ] **Step 4: Write the host**

Create `apps/agent/src/host/host.ts`:

```ts
import {
  StreamTickerMessageSchema,
  TICKER_BACKFILL,
  TickerEventSchema,
  applyEvent,
  deriveSnapshot,
  emptyFleet,
  ensureSessionAlias,
  tickFleet,
  type AliasMap,
  type Fleet,
  type RedactedEvent,
  type SessionPhase,
  type SessionState,
  type Snapshot,
  type StateConfig,
  type StreamTickerMessage,
  type TickerEvent,
} from "@clawd/core";
import type { Logger } from "../log";

export type SessionView = { paneKey: string; state: SessionPhase; firstSeenAt: number; lastEventAt: number };

export type HostListener = {
  /** An accepted redacted event, for the event log. */
  event?(e: RedactedEvent): void;
  ticker?(m: StreamTickerMessage): void;
  /** Only when the snapshot changed, ignoring generatedAt. */
  snapshot?(s: Snapshot): void;
  /** Only when a session or pane was given a new alias. */
  aliases?(map: AliasMap): void;
};

export type HostDeps = { now: () => number; config: StateConfig; aliases: AliasMap; log: Logger };

/** A second SessionStart this soon after the first is the other hook type reporting the same start. */
export const DUPLICATE_START_MS = 5_000;

const endsSession = (e: RedactedEvent): boolean => e.kind === "session.end" || (e.kind === "presence" && !e.alive);

/**
 * The one owner of agent state: the fleet, the alias map, the ticker buffers and the ended set.
 * No I/O; everything leaves through listeners.
 */
export class FleetHost {
  private fleet: Fleet = emptyFleet();
  private aliasMap: AliasMap;
  private readonly buffers = new Map<string, TickerEvent[]>();
  private readonly lastAccepted = new Map<string, { kind: RedactedEvent["kind"]; at: number }>();
  private readonly ended = new Set<string>();
  private readonly listeners = new Set<HostListener>();
  private lastSnapshotKey: string | null = null;
  private readonly deps: HostDeps;

  constructor(deps: HostDeps) {
    this.deps = deps;
    this.aliasMap = deps.aliases;
  }

  on(listener: HostListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  ingest(e: RedactedEvent): void {
    const now = this.deps.now();
    if (this.isNoise(e, now)) return;
    if (e.kind === "session.start") this.ended.delete(e.sessionId);
    const applied = applyEvent(this.fleet, e, now, this.deps.config);
    this.fleet = applied.fleet;
    if (endsSession(e)) this.ended.add(e.sessionId);
    this.lastAccepted.set(e.sessionId, { kind: e.kind, at: now });
    this.emit((l) => l.event?.(e));
    for (const line of applied.ticker) this.pushTicker(e.sessionId, line);
    this.refresh(now);
  }

  tick(): void {
    const now = this.deps.now();
    const before = this.fleet.sessions;
    this.fleet = tickFleet(this.fleet, now, this.deps.config);
    for (const [id, prev] of Object.entries(before)) {
      const next = this.session(id);
      if (!next) {
        this.buffers.delete(id);
        this.lastAccepted.delete(id);
        continue;
      }
      // tickFleet has no event, so toTickerEvents cannot describe its transitions; the line carries only the state.
      if (next.state !== prev.state) this.pushTicker(id, TickerEventSchema.parse({ t: new Date(now).toISOString(), kind: "state", state: next.state }));
    }
    this.refresh(now);
  }

  snapshot(): Snapshot {
    const { snapshot, aliases } = deriveSnapshot(this.fleet, this.aliasMap, this.deps.now());
    this.setAliases(aliases);
    return snapshot;
  }

  tickerFor(alias: string): TickerEvent[] | null {
    const id = this.sessionIdFor(alias);
    return id === null ? null : [...(this.buffers.get(id) ?? [])];
  }

  sessionIdFor(alias: string): string | null {
    for (const [id, entry] of Object.entries(this.aliasMap.sessions)) if (entry.alias === alias) return id;
    return null;
  }

  sessions(): ReadonlyMap<string, SessionView> {
    const views = new Map<string, SessionView>();
    for (const s of Object.values(this.fleet.sessions)) {
      views.set(s.sessionId, { paneKey: s.paneKey, state: s.state, firstSeenAt: s.firstSeenAt, lastEventAt: s.lastEventAt });
    }
    return views;
  }

  sessionCount(): number {
    return Object.keys(this.fleet.sessions).length;
  }

  endedIds(): ReadonlySet<string> {
    return this.ended;
  }

  /** Forget ended ids the latest successful poll no longer lists: they cannot come back through presence. */
  forgetEnded(listed: ReadonlySet<string>): void {
    for (const id of [...this.ended]) if (!listed.has(id)) this.ended.delete(id);
  }

  aliases(): AliasMap {
    return this.aliasMap;
  }

  private session(id: string): SessionState | undefined {
    return Object.hasOwn(this.fleet.sessions, id) ? this.fleet.sessions[id] : undefined;
  }

  /** Events that would add noise but no information (spec §5.1). */
  private isNoise(e: RedactedEvent, now: number): boolean {
    if (e.kind === "session.start") {
      const last = this.lastAccepted.get(e.sessionId);
      return this.session(e.sessionId) !== undefined && last?.kind === "session.start" && now - last.at < DUPLICATE_START_MS;
    }
    if (this.ended.has(e.sessionId)) return true;
    const existing = this.session(e.sessionId);
    if (e.kind === "status" && existing) {
      return e.contextPct === undefined || (existing.contextPct !== null && Math.round(e.contextPct) === Math.round(existing.contextPct));
    }
    return false;
  }

  private pushTicker(sessionId: string, line: TickerEvent): void {
    const named = ensureSessionAlias(this.aliasMap, sessionId);
    this.setAliases(named.map);
    const buffer = this.buffers.get(sessionId) ?? [];
    buffer.push(line);
    if (buffer.length > TICKER_BACKFILL) buffer.splice(0, buffer.length - TICKER_BACKFILL);
    this.buffers.set(sessionId, buffer);
    const message = StreamTickerMessageSchema.safeParse({ alias: named.alias, event: line });
    if (message.success) this.emit((l) => l.ticker?.(message.data));
  }

  private refresh(now: number): void {
    const { snapshot, aliases } = deriveSnapshot(this.fleet, this.aliasMap, now);
    this.setAliases(aliases);
    const key = JSON.stringify({ ...snapshot, generatedAt: "" });
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.emit((l) => l.snapshot?.(snapshot));
  }

  private setAliases(map: AliasMap): void {
    if (map === this.aliasMap) return;
    this.aliasMap = map;
    this.emit((l) => l.aliases?.(map));
  }

  private emit(call: (listener: HostListener) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        call(listener);
      } catch {
        this.deps.log("host.listenerFailed");
      }
    }
  }
}
```

- [ ] **Step 5: Run the test and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/host`
Expected: PASS, 18 tests.

If a fixture case fails, first check whether the fixture contains an event for a session after its `session.end` or dead `presence` (the host drops those by design, core's `snapshotFrames` does not). If that is the only difference, stop and report it as a spec question rather than changing either side.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/host apps/agent/src/testing/events.ts
git commit -m "feat(agent): fleet host with ticker buffers, noise filtering and change-only snapshots"
```

---

### Task 6: Presence reconcile and poller

**Files:**
- Create: `apps/agent/src/presence/reconcile.ts`
- Create: `apps/agent/src/presence/poller.ts`
- Test: `apps/agent/src/presence/reconcile.test.ts`, `apps/agent/src/presence/poller.test.ts`

**Interfaces:**
- Consumes: `FleetHost`, `SessionView` (Task 5); `Logger`, `silentLogger` (Task 1); test helpers `T0`, `ev` (Task 5), `ALLOWED_ROOT`, `CANARY`, `CANARY_CWD`, `OUTSIDE_CWD`, `rawAgentEntry` (Task 3); from `@clawd/core`: `redactPresence`, `RedactedEventSchema`, `isAllowed`, `paneKey`, `DEFAULT_CONFIG`, `emptyAliasMap`, `type RedactedEvent`.
- Produces:
  - `type ReconcileInput = { entries: readonly unknown[]; sessions: ReadonlyMap<string, SessionView>; lastListedAt: ReadonlyMap<string, number>; ended: ReadonlySet<string>; now: number; allowlist: readonly string[]; graceMs: number }`; `reconcile(input): RedactedEvent[]`; `sessionIdOf(entry: unknown): string | null`; `listedIds(entries: readonly unknown[]): Set<string>`.
  - `type ExecResult = { ok: true; stdout: string } | { ok: false }`; `type Exec = (command: string, opts: { timeoutMs: number; maxBuffer: number }) => Promise<ExecResult>`; `nodeExec: Exec`.
  - `type FocusTarget = { pid: number; cwd: string }`; `type PresencePoller = { pollOnce(): Promise<boolean>; lookup(sessionId: string): FocusTarget | null; liveDirectories(): readonly string[]; start(): void; stop(): void }`; `type PresenceHost = Pick<FleetHost, "ingest" | "sessions" | "endedIds" | "forgetEnded">`; `PRESENCE_GRACE_MS = 15_000`; `createPresencePoller(deps: { host: PresenceHost; exec: Exec; command: string; allowlist: readonly string[]; intervalMs: number; now: () => number; log: Logger; graceMs?: number }): PresencePoller`.

- [ ] **Step 1: Write the failing tests**

Create `apps/agent/src/presence/reconcile.test.ts`:

```ts
import { paneKey } from "@clawd/core";
import { describe, expect, it } from "vitest";
import type { SessionView } from "../host/host";
import { T0 } from "../testing/events";
import { ALLOWED_ROOT, CANARY, CANARY_CWD, OUTSIDE_CWD, rawAgentEntry } from "../testing/raw";
import { listedIds, reconcile, sessionIdOf, type ReconcileInput } from "./reconcile";

const KEY = paneKey(CANARY_CWD);
const view = (over: Partial<SessionView> = {}): SessionView => ({ paneKey: KEY, state: "idle", firstSeenAt: T0, lastEventAt: T0, ...over });
const input = (over: Partial<ReconcileInput> = {}): ReconcileInput => ({
  entries: [],
  sessions: new Map(),
  lastListedAt: new Map(),
  ended: new Set(),
  now: T0 + 60_000,
  allowlist: [ALLOWED_ROOT],
  graceMs: 15_000,
  ...over,
});

describe("reconcile", () => {
  it("brings a listed session the fleet has never seen in as an alive presence, without its name or path", () => {
    const events = reconcile(input({ entries: [rawAgentEntry("s1")] }));
    expect(events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: true }]);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });

  it("says nothing about a listed session it already knows", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], sessions: new Map([["s1", view()]]) }))).toEqual([]);
  });

  it("never brings back an ended session", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], ended: new Set(["s1"]) }))).toEqual([]);
  });

  it("ignores listed sessions outside the allowlist", () => {
    expect(reconcile(input({ entries: [rawAgentEntry("s1", { cwd: OUTSIDE_CWD })] }))).toEqual([]);
  });

  it("skips malformed entries and repeats", () => {
    const entries = [null, 3, {}, { sessionId: 5 }, { sessionId: "no-cwd" }, rawAgentEntry("s1"), rawAgentEntry("s1")];
    expect(reconcile(input({ entries }))).toHaveLength(1);
  });

  it("marks a session gone once nothing has been heard from it for the grace", () => {
    const events = reconcile(input({ sessions: new Map([["s1", view()]]) }));
    expect(events).toEqual([{ v: 1, t: T0 + 60_000, sessionId: "s1", paneKey: KEY, kind: "presence", alive: false }]);
  });

  it("keeps an unlisted session that was listed, first seen, or heard from within the grace", () => {
    const now = T0 + 60_000;
    expect(reconcile(input({ sessions: new Map([["s1", view()]]), lastListedAt: new Map([["s1", now - 10_000]]) }))).toEqual([]);
    expect(reconcile(input({ sessions: new Map([["s1", view({ lastEventAt: now - 10_000 })]]) }))).toEqual([]);
    expect(reconcile(input({ sessions: new Map([["s1", view({ firstSeenAt: now - 10_000, lastEventAt: now - 10_000 })]]) }))).toEqual([]);
  });

  it("never marks a done or a listed session gone", () => {
    expect(reconcile(input({ sessions: new Map([["s1", view({ state: "done" })]]) }))).toEqual([]);
    expect(reconcile(input({ entries: [rawAgentEntry("s1")], sessions: new Map([["s1", view()]]) }))).toEqual([]);
  });
});

describe("listed ids", () => {
  it("reads session ids leniently", () => {
    expect(sessionIdOf(rawAgentEntry("s1"))).toBe("s1");
    expect(sessionIdOf({ sessionId: "" })).toBeNull();
    expect(sessionIdOf("s1")).toBeNull();
    expect([...listedIds([rawAgentEntry("a"), null, rawAgentEntry("b"), rawAgentEntry("a")])]).toEqual(["a", "b"]);
  });
});
```

Create `apps/agent/src/presence/poller.test.ts`:

```ts
import { DEFAULT_CONFIG, emptyAliasMap } from "@clawd/core";
import { describe, expect, it, vi } from "vitest";
import { FleetHost } from "../host/host";
import { silentLogger } from "../log";
import { T0, ev } from "../testing/events";
import { ALLOWED_ROOT, CANARY_CWD, OUTSIDE_CWD, rawAgentEntry } from "../testing/raw";
import { createPresencePoller, type Exec, type ExecResult } from "./poller";

function setup() {
  const clock = { now: T0 };
  const host = new FleetHost({ now: () => clock.now, config: DEFAULT_CONFIG, aliases: emptyAliasMap(), log: silentLogger });
  let reply: ExecResult = { ok: true, stdout: "[]" };
  const exec = vi.fn<Exec>(async () => reply);
  const log = vi.fn();
  const poller = createPresencePoller({ host, exec, command: "claude", allowlist: [ALLOWED_ROOT], intervalMs: 10_000, now: () => clock.now, log });
  return {
    host,
    clock,
    exec,
    log,
    poller,
    list: (...entries: unknown[]) => {
      reply = { ok: true, stdout: JSON.stringify(entries) };
    },
    reply: (r: ExecResult) => {
      reply = r;
    },
  };
}

describe("presence poller", () => {
  it("runs the agents list and brings listed, allowlisted sessions in as idle", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"), rawAgentEntry("s2", { cwd: OUTSIDE_CWD, pid: 7 }));
    expect(await t.poller.pollOnce()).toBe(true);
    expect(t.exec).toHaveBeenCalledWith("claude agents --json", { timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024 });
    expect([...t.host.sessions().keys()]).toEqual(["s1"]);
    expect(t.host.sessions().get("s1")?.state).toBe("idle");
  });

  it("keeps pid and directory for focus, only for allowlisted sessions, and exposes the live directories", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"), rawAgentEntry("s2", { cwd: OUTSIDE_CWD, pid: 7 }), rawAgentEntry("s3", { pid: "not a number" }));
    await t.poller.pollOnce();
    expect(t.poller.lookup("s1")).toEqual({ pid: 4242, cwd: CANARY_CWD });
    expect(t.poller.lookup("s2")).toBeNull();
    expect(t.poller.lookup("s3")).toBeNull();
    expect(t.poller.liveDirectories()).toEqual([CANARY_CWD]);
  });

  it.each([
    ["the command fails", { ok: false } as ExecResult],
    ["the output is not JSON", { ok: true, stdout: "Usage: claude" } as ExecResult],
    ["the output is not an array", { ok: true, stdout: "{}" } as ExecResult],
  ])("marks nothing dead when %s", async (_label, result) => {
    const t = setup();
    t.host.ingest(ev("prompt", T0, {}));
    t.clock.now = T0 + 60_000;
    t.reply(result);
    expect(await t.poller.pollOnce()).toBe(false);
    expect(t.host.sessions().get("s1")?.state).toBe("working");
    expect(t.log).toHaveBeenCalledWith("presence.failed");
  });

  it("marks nothing dead when the command throws", async () => {
    const t = setup();
    t.exec.mockRejectedValueOnce(new Error("spawn failed"));
    expect(await t.poller.pollOnce()).toBe(false);
    expect(t.log).toHaveBeenCalledWith("presence.failed");
  });

  it("marks a session done once it has been missing from the list for the grace", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    t.clock.now = T0 + 5_000;
    t.list();
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("idle");
    t.clock.now = T0 + 16_000;
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("done");
  });

  it("treats a recent hook as proof of life for a session the list does not show", async () => {
    const t = setup();
    t.host.ingest(ev("prompt", T0, {}));
    t.clock.now = T0 + 20_000;
    t.host.ingest(ev("tool.start", t.clock.now, { tool: "Read", category: "read", toolUseId: "u1" }));
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("working");
    t.clock.now = T0 + 36_000;
    await t.poller.pollOnce();
    expect(t.host.sessions().get("s1")?.state).toBe("done");
  });

  it("does not resurrect a session that ended while still listed, and forgets it once unlisted", async () => {
    const t = setup();
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    t.host.ingest(ev("session.end", t.clock.now, { reason: "prompt_input_exit" }));
    t.clock.now += DEFAULT_CONFIG.doneLingerMs;
    t.host.tick();
    await t.poller.pollOnce();
    expect(t.host.sessionCount()).toBe(0);
    expect(t.host.endedIds().has("s1")).toBe(true);
    t.list();
    await t.poller.pollOnce();
    expect(t.host.endedIds().has("s1")).toBe(false);
  });

  it("shares one run between callers that poll at the same time", async () => {
    const t = setup();
    let release: (r: ExecResult) => void = () => {};
    t.exec.mockImplementationOnce(() => new Promise<ExecResult>((resolve) => { release = resolve; }));
    const a = t.poller.pollOnce();
    const b = t.poller.pollOnce();
    expect(t.exec).toHaveBeenCalledTimes(1);
    release({ ok: true, stdout: "[]" });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
  });

  it("polls on its interval until stopped", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.exec).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.exec).toHaveBeenCalledTimes(2);
      t.poller.stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(t.exec).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/presence`
Expected: FAIL, `./reconcile` and `./poller` cannot be resolved.

- [ ] **Step 3: Write the modules**

Create `apps/agent/src/presence/reconcile.ts`:

```ts
import { RedactedEventSchema, redactPresence, type RedactedEvent } from "@clawd/core";
import type { SessionView } from "../host/host";

export type ReconcileInput = {
  /** The parsed agents-list array; entries are unvalidated. */
  entries: readonly unknown[];
  sessions: ReadonlyMap<string, SessionView>;
  /** When each id was last in a successful poll. */
  lastListedAt: ReadonlyMap<string, number>;
  ended: ReadonlySet<string>;
  now: number;
  allowlist: readonly string[];
  graceMs: number;
};

export function sessionIdOf(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const id = (entry as { sessionId?: unknown }).sessionId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function listedIds(entries: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const id = sessionIdOf(entry);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** Pure: one poll against the fleet, as presence events (spec §6.2). */
export function reconcile(input: ReconcileInput): RedactedEvent[] {
  const events: RedactedEvent[] = [];
  const ctx = { now: input.now, allowlist: input.allowlist };
  const listed = new Set<string>();
  for (const entry of input.entries) {
    const id = sessionIdOf(entry);
    if (id === null || listed.has(id)) continue;
    listed.add(id);
    if (input.sessions.has(id) || input.ended.has(id)) continue;
    // A raw agents-list entry: redactPresence applies the allowlist and keeps only id and pane key.
    const alive = redactPresence(entry, true, ctx);
    if (alive) events.push(alive);
  }
  for (const [id, s] of input.sessions) {
    if (s.state === "done" || listed.has(id)) continue;
    const lastSign = Math.max(s.firstSeenAt, s.lastEventAt, input.lastListedAt.get(id) ?? 0);
    if (input.now - lastSign <= input.graceMs) continue;
    // No raw payload exists for a session that left the list; the event is built from fleet state.
    const gone = RedactedEventSchema.safeParse({ v: 1, t: input.now, sessionId: id, paneKey: s.paneKey, kind: "presence", alive: false });
    if (gone.success) events.push(gone.data);
  }
  return events;
}
```

Create `apps/agent/src/presence/poller.ts`:

```ts
import { isAllowed } from "@clawd/core";
import { exec } from "node:child_process";
import { z } from "zod";
import type { FleetHost } from "../host/host";
import type { Logger } from "../log";
import { listedIds, reconcile } from "./reconcile";

export type ExecResult = { ok: true; stdout: string } | { ok: false };
export type Exec = (command: string, opts: { timeoutMs: number; maxBuffer: number }) => Promise<ExecResult>;

/**
 * Runs a constant command through the shell (on Windows `claude` is a .cmd shim). stdout is
 * captured and stderr discarded, never inherited, and the error itself is never looked at.
 */
export const nodeExec: Exec = (command, opts) =>
  new Promise((resolve) => {
    exec(command, { timeout: opts.timeoutMs, maxBuffer: opts.maxBuffer, windowsHide: true, encoding: "utf8" }, (err, stdout) => {
      resolve(err ? { ok: false } : { ok: true, stdout });
    });
  });

export type FocusTarget = { pid: number; cwd: string };
export type PresenceHost = Pick<FleetHost, "ingest" | "sessions" | "endedIds" | "forgetEnded">;
export type PresencePoller = {
  /** One poll; concurrent callers share it. Resolves false when the poll said nothing. */
  pollOnce(): Promise<boolean>;
  /** pid and directory of a listed, allowlisted session from the latest poll. Memory only. */
  lookup(sessionId: string): FocusTarget | null;
  /** Directories of the latest poll's sessions, for the sinks' privacy check. */
  liveDirectories(): readonly string[];
  start(): void;
  stop(): void;
};

export const PRESENCE_GRACE_MS = 15_000;
const POLL_TIMEOUT_MS = 15_000;
const POLL_MAX_BUFFER = 4 * 1024 * 1024;

const TargetSchema = z.object({ sessionId: z.string().min(1), pid: z.number().int().positive(), cwd: z.string().min(1) });

function parseArray(stdout: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(stdout);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function createPresencePoller(deps: {
  host: PresenceHost;
  exec: Exec;
  command: string;
  allowlist: readonly string[];
  intervalMs: number;
  now: () => number;
  log: Logger;
  graceMs?: number;
}): PresencePoller {
  const graceMs = deps.graceMs ?? PRESENCE_GRACE_MS;
  let targets = new Map<string, FocusTarget>();
  const lastListedAt = new Map<string, number>();
  let inFlight: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  async function run(): Promise<boolean> {
    const result = await deps.exec(`${deps.command} agents --json`, { timeoutMs: POLL_TIMEOUT_MS, maxBuffer: POLL_MAX_BUFFER });
    const entries = result.ok ? parseArray(result.stdout) : null;
    if (entries === null) {
      deps.log("presence.failed");
      return false;
    }
    const now = deps.now();
    const listed = listedIds(entries);
    for (const id of listed) lastListedAt.set(id, now);
    const next = new Map<string, FocusTarget>();
    for (const entry of entries) {
      const target = TargetSchema.safeParse(entry);
      if (target.success && isAllowed(target.data.cwd, deps.allowlist)) next.set(target.data.sessionId, { pid: target.data.pid, cwd: target.data.cwd });
    }
    targets = next;
    const sessions = deps.host.sessions();
    for (const e of reconcile({ entries, sessions, lastListedAt, ended: deps.host.endedIds(), now, allowlist: deps.allowlist, graceMs })) {
      deps.host.ingest(e);
    }
    deps.host.forgetEnded(listed);
    for (const id of [...lastListedAt.keys()]) if (!listed.has(id) && !sessions.has(id)) lastListedAt.delete(id);
    return true;
  }

  const pollOnce = (): Promise<boolean> => {
    inFlight ??= run()
      .catch(() => {
        deps.log("presence.failed");
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    pollOnce,
    lookup: (sessionId) => targets.get(sessionId) ?? null,
    liveDirectories: () => [...new Set([...targets.values()].flatMap((t) => [t.cwd, t.cwd.replace(/\\/g, "/")]))],
    start() {
      if (running) return;
      running = true;
      const loop = async (): Promise<void> => {
        await pollOnce();
        if (running) timer = setTimeout(() => void loop(), deps.intervalMs);
      };
      void loop();
    },
    stop() {
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/presence`
Expected: PASS.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/presence
git commit -m "feat(agent): presence poll with a grace that treats hooks as proof of life"
```

---

### Task 7: Stream hub

**Files:**
- Create: `apps/agent/src/http/sse.ts`
- Test: `apps/agent/src/http/sse.test.ts`

**Interfaces:**
- Consumes: `Logger` (Task 1); from `@clawd/core`: `SnapshotSchema`, `StreamTickerMessageSchema`, `STREAM_EVENTS`, `SNAPSHOT_MIN_INTERVAL_MS`, `STREAM_HEARTBEAT_MS`, `containsForbidden`, types `Snapshot`, `StreamTickerMessage`.
- Produces:
  - `interface StreamRequest { on(event: "close", listener: () => void): unknown }`
  - `interface StreamResponse { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): boolean; end(chunk?: string): unknown; readonly writableLength: number; readonly writableEnded: boolean }`
  - `type StreamHub = { connect(req: StreamRequest, res: StreamResponse, headers?: Record<string, string>): void; snapshot(s: Snapshot): void; ticker(m: StreamTickerMessage): void; clientCount(): number; closeAll(): void }`
  - `createStreamHub(opts: { current: () => Snapshot; log: Logger; sensitive?: () => readonly string[]; now?: () => number; maxClients?: number; minIntervalMs?: number; heartbeatMs?: number; maxBufferedBytes?: number }): StreamHub`

- [ ] **Step 1: Write the failing test**

Create `apps/agent/src/http/sse.test.ts`:

```ts
import type { Snapshot } from "@clawd/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamHub, type StreamRequest, type StreamResponse } from "./sse";

class FakeRes implements StreamResponse {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableLength = 0;
  writableEnded = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end(chunk?: string) {
    if (chunk !== undefined) this.chunks.push(chunk);
    this.writableEnded = true;
    return this;
  }
  get text() {
    return this.chunks.join("");
  }
}

class FakeReq implements StreamRequest {
  private listeners: (() => void)[] = [];
  on(_event: "close", listener: () => void) {
    this.listeners.push(listener);
    return this;
  }
  close() {
    for (const l of this.listeners) l();
  }
}

const snap = (generatedAt: string, extra: Partial<Snapshot> = {}): Snapshot => ({ version: 1, generatedAt, panes: [], sessions: [], ...extra });
const frames = (text: string) =>
  text
    .split("\n\n")
    .filter((block) => block.startsWith("event: "))
    .map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null") as unknown }));

describe("stream hub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function hub(over: Partial<Parameters<typeof createStreamHub>[0]> = {}) {
    const log = vi.fn();
    const h = createStreamHub({ current: () => snap("1970-01-01T00:00:00.000Z"), log, ...over });
    return { h, log };
  }

  it("opens an event stream with the extra headers and sends the current snapshot at once", () => {
    const { h } = hub();
    const res = new FakeRes();
    h.connect(new FakeReq(), res, { "access-control-allow-origin": "http://localhost:3000" });
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "http://localhost:3000" });
    expect(frames(res.text)).toEqual([{ event: "snapshot", data: snap("1970-01-01T00:00:00.000Z") }]);
    expect(h.clientCount()).toBe(1);
  });

  it("sends at most one snapshot per interval, then the latest one", async () => {
    const { h } = hub();
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    h.snapshot(snap("1970-01-01T00:00:00.001Z"));
    await vi.advanceTimersByTimeAsync(100);
    h.snapshot(snap("1970-01-01T00:00:00.100Z"));
    await vi.advanceTimersByTimeAsync(100);
    h.snapshot(snap("1970-01-01T00:00:00.200Z"));
    expect(frames(res.text).map((f) => (f.data as Snapshot).generatedAt)).toEqual(["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.001Z"]);
    await vi.advanceTimersByTimeAsync(50);
    expect(frames(res.text).map((f) => (f.data as Snapshot).generatedAt)).toEqual(["1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.001Z", "1970-01-01T00:00:00.200Z"]);
  });

  it("broadcasts valid ticker messages to every client at once and drops invalid ones", () => {
    const { h, log } = hub();
    const a = new FakeRes();
    const b = new FakeRes();
    h.connect(new FakeReq(), a);
    h.connect(new FakeReq(), b);
    h.ticker({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt" } });
    h.ticker({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt", prompt: "CANARY" } } as never);
    for (const res of [a, b]) {
      expect(frames(res.text).filter((f) => f.event === "ticker")).toEqual([{ event: "ticker", data: { alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "prompt" } } }]);
      expect(res.text).not.toContain("CANARY");
    }
    expect(log).toHaveBeenCalledWith("privacy.blocked");
  });

  it("sends a heartbeat comment every fifteen seconds while clients are connected", async () => {
    const { h } = hub();
    const req = new FakeReq();
    const res = new FakeRes();
    h.connect(req, res);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.text).toContain(": heartbeat\n\n");
    req.close();
    expect(h.clientCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses a client over the limit", () => {
    const { h, log } = hub({ maxClients: 1 });
    h.connect(new FakeReq(), new FakeRes());
    const extra = new FakeRes();
    h.connect(new FakeReq(), extra);
    expect(extra.status).toBe(503);
    expect(extra.writableEnded).toBe(true);
    expect(h.clientCount()).toBe(1);
    expect(log).toHaveBeenCalledWith("stream.clientLimit");
  });

  it("closes a client that stops reading", () => {
    const { h, log } = hub({ maxBufferedBytes: 10 });
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    res.writableLength = 11;
    h.ticker({ alias: "agent-1", event: { t: "2026-09-12T10:00:00.000Z", kind: "stop" } });
    expect(res.writableEnded).toBe(true);
    expect(h.clientCount()).toBe(0);
    expect(log).toHaveBeenCalledWith("stream.slowClient");
  });

  it("never sends a snapshot carrying a forbidden key or a live directory", async () => {
    const { h, log } = hub({ sensitive: () => ["C:/work/CANARY-repo"] });
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    h.snapshot(snap("1970-01-01T00:00:01.000Z", { ext: { prompt: "x" } }));
    await vi.advanceTimersByTimeAsync(1_000);
    h.snapshot(snap("1970-01-01T00:00:02.000Z", { panes: [{ pane: "pane-1", label: "C:/work/CANARY-repo" }] }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(frames(res.text)).toHaveLength(1);
    expect(res.text).not.toContain("CANARY");
    expect(log).toHaveBeenCalledWith("privacy.blocked");
  });

  it("ends every client and clears its timers on closeAll", async () => {
    const { h } = hub();
    const res = new FakeRes();
    h.connect(new FakeReq(), res);
    h.snapshot(snap("1970-01-01T00:00:00.001Z"));
    h.snapshot(snap("1970-01-01T00:00:00.002Z"));
    h.closeAll();
    expect(res.writableEnded).toBe(true);
    expect(h.clientCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @clawd/agent exec vitest run src/http/sse.test.ts`
Expected: FAIL, `./sse` cannot be resolved.

- [ ] **Step 3: Write the hub**

Create `apps/agent/src/http/sse.ts`:

```ts
import {
  SNAPSHOT_MIN_INTERVAL_MS,
  STREAM_EVENTS,
  STREAM_HEARTBEAT_MS,
  SnapshotSchema,
  StreamTickerMessageSchema,
  containsForbidden,
  type Snapshot,
  type StreamTickerMessage,
} from "@clawd/core";
import type { Logger } from "../log";

export interface StreamRequest {
  on(event: "close", listener: () => void): unknown;
}

export interface StreamResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(chunk?: string): unknown;
  readonly writableLength: number;
  readonly writableEnded: boolean;
}

export type StreamHub = {
  connect(req: StreamRequest, res: StreamResponse, headers?: Record<string, string>): void;
  /** Broadcast, throttled to one per interval with a trailing send of the latest. */
  snapshot(s: Snapshot): void;
  ticker(m: StreamTickerMessage): void;
  clientCount(): number;
  closeAll(): void;
};

export function createStreamHub(opts: {
  current: () => Snapshot;
  log: Logger;
  /** Strings no frame may contain, such as the live working directories. */
  sensitive?: () => readonly string[];
  now?: () => number;
  maxClients?: number;
  minIntervalMs?: number;
  heartbeatMs?: number;
  maxBufferedBytes?: number;
}): StreamHub {
  const now = opts.now ?? (() => Date.now());
  const maxClients = opts.maxClients ?? 16;
  const minIntervalMs = opts.minIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS;
  const heartbeatMs = opts.heartbeatMs ?? STREAM_HEARTBEAT_MS;
  const maxBufferedBytes = opts.maxBufferedBytes ?? 1024 * 1024;
  const clients = new Set<StreamResponse>();
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: Snapshot | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function frame(event: string, data: unknown): string | null {
    if (containsForbidden(data, opts.sensitive?.() ?? []) !== null) {
      opts.log("privacy.blocked");
      return null;
    }
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function drop(res: StreamResponse): void {
    if (!clients.delete(res)) return;
    if (!res.writableEnded) res.end();
    if (clients.size === 0 && heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function write(res: StreamResponse, text: string): void {
    if (res.writableLength > maxBufferedBytes) {
      opts.log("stream.slowClient");
      drop(res);
      return;
    }
    res.write(text);
  }

  function broadcast(text: string): void {
    for (const res of [...clients]) write(res, text);
  }

  function sendSnapshot(s: Snapshot): void {
    lastSentAt = now();
    const text = frame(STREAM_EVENTS.snapshot, s);
    if (text !== null) broadcast(text);
  }

  return {
    connect(req, res, headers = {}) {
      if (clients.size >= maxClients) {
        opts.log("stream.clientLimit");
        res.writeHead(503, { ...headers, "content-type": "application/json; charset=utf-8" });
        res.end('{"error":"too many streams"}');
        return;
      }
      res.writeHead(200, { ...headers, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      clients.add(res);
      req.on("close", () => drop(res));
      const current = SnapshotSchema.safeParse(opts.current());
      const text = current.success ? frame(STREAM_EVENTS.snapshot, current.data) : null;
      if (text !== null) write(res, text);
      heartbeat ??= setInterval(() => broadcast(": heartbeat\n\n"), heartbeatMs);
    },
    snapshot(s) {
      const parsed = SnapshotSchema.safeParse(s);
      if (!parsed.success) {
        opts.log("privacy.blocked");
        return;
      }
      const wait = minIntervalMs - (now() - lastSentAt);
      if (wait <= 0 && trailing === null) {
        sendSnapshot(parsed.data);
        return;
      }
      pending = parsed.data;
      trailing ??= setTimeout(() => {
        trailing = null;
        const next = pending;
        pending = null;
        if (next !== null) sendSnapshot(next);
      }, Math.max(0, wait));
    },
    ticker(m) {
      const parsed = StreamTickerMessageSchema.safeParse(m);
      if (!parsed.success) {
        opts.log("privacy.blocked");
        return;
      }
      const text = frame(STREAM_EVENTS.ticker, parsed.data);
      if (text !== null) broadcast(text);
    },
    clientCount: () => clients.size,
    closeAll() {
      if (trailing !== null) clearTimeout(trailing);
      trailing = null;
      pending = null;
      for (const res of [...clients]) drop(res);
      if (heartbeat !== null) clearInterval(heartbeat);
      heartbeat = null;
    },
  };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/http/sse.test.ts`
Expected: PASS, 8 tests.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/http/sse.ts apps/agent/src/http/sse.test.ts
git commit -m "feat(agent): SSE hub with throttled snapshots, heartbeat, client limit and privacy check"
```

---

### Task 8: HTTP server

**Files:**
- Create: `apps/agent/src/http/guards.ts`
- Create: `apps/agent/src/http/server.ts`
- Create: `apps/agent/src/testing/http.ts`
- Test: `apps/agent/src/http/guards.test.ts`, `apps/agent/src/http/server.test.ts`

**Interfaces:**
- Consumes: `readBody` (Task 3); `ingestHook`, `ingestStatus`, `parseJson` (Task 3); `FleetHost` (Task 5); `createStreamHub`, `StreamHub` (Task 7); `AgentConfig` (Task 2); `Logger`, `silentLogger` (Task 1); `AGENT_VERSION` (Task 1); test helpers `T0` (Task 5), `ALLOWED_ROOT`, `CANARY`, `rawHook`, `rawStatus` (Task 3); from `@clawd/core`: `CommandSchema`, `ENDPOINTS`, `HealthSchema`, `SnapshotSchema`, `containsForbidden`, `DEFAULT_CONFIG`, `emptyAliasMap`, types `RedactedEvent`, `Snapshot`, `TickerEvent`.
- Produces:
  - `hostAllowed(host: string | undefined, port: number): boolean`; `type OriginCheck = { kind: "none" } | { kind: "allowed"; origin: string } | { kind: "denied" }`; `checkOrigin(origin: string | undefined, allowed: readonly string[]): OriginCheck`; `tokenMatches(given: string | string[] | undefined, expected: string): boolean`.
  - `HOOK_BODY_LIMIT = 8 * 1024 * 1024`, `STATUS_BODY_LIMIT = 1024 * 1024`, `COMMAND_BODY_LIMIT = 4 * 1024`.
  - `type IngestCounts = { accepted: number; dropped: number; tooLarge: number; badJson: number; unauthorised: number }`; `newIngestCounts(): IngestCounts`.
  - `type ServerHost = { ingest(e: RedactedEvent): void; snapshot(): Snapshot; tickerFor(alias: string): TickerEvent[] | null; sessionIdFor(alias: string): string | null; sessionCount(): number }`.
  - `type ServerDeps = { host: ServerHost; config: Pick<AgentConfig, "allowlist" | "token" | "corsOrigins">; stream: Pick<StreamHub, "connect">; focus(sessionId: string): void; now: () => number; log: Logger; counts: IngestCounts; sensitive: () => readonly string[]; limits?: { hook?: number; status?: number; command?: number } }`.
  - `createAgentServer(deps: ServerDeps): Server` (not listening; the caller listens).
  - Test helpers: `type Reply = { status: number; headers: IncomingHttpHeaders; body: string }`; `send(port, { method?, path, headers?, body? }): Promise<Reply>`; `openStream(port, path?, headers?): Promise<OpenStream>` with `OpenStream = { status: number; headers: IncomingHttpHeaders; text(): string; waitFor(pred: (text: string) => boolean, timeoutMs?: number): Promise<void>; close(): void }`; `waitFor(check: () => boolean | Promise<boolean>, timeoutMs?: number): Promise<void>`; `parseSse(text: string): { event: string; data: unknown }[]`.

- [ ] **Step 1: Write the HTTP test helpers**

Create `apps/agent/src/testing/http.ts`:

```ts
import { request, type IncomingHttpHeaders } from "node:http";

export type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

export function send(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, ...(opts.headers ? { headers: opts.headers } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export type OpenStream = {
  status: number;
  headers: IncomingHttpHeaders;
  text(): string;
  waitFor(pred: (text: string) => boolean, timeoutMs?: number): Promise<void>;
  close(): void;
};

export function openStream(port: number, path = "/api/stream", headers: Record<string, string> = {}): Promise<OpenStream> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
      });
      res.on("error", () => {});
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: () => text,
        waitFor: (pred, timeoutMs) => waitFor(() => pred(text), timeoutMs),
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split("\n\n")
    .filter((block) => block.split("\n").some((line) => line.startsWith("data: ")))
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1] ?? "message",
      data: JSON.parse(
        block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("\n"),
      ) as unknown,
    }));
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/agent/src/http/guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkOrigin, hostAllowed, tokenMatches } from "./guards";

describe("guards", () => {
  it("accepts only loopback host names on the agent's port", () => {
    expect(hostAllowed("127.0.0.1:4750", 4750)).toBe(true);
    expect(hostAllowed("localhost:4750", 4750)).toBe(true);
    expect(hostAllowed("LOCALHOST:4750", 4750)).toBe(true);
    expect(hostAllowed("127.0.0.1:4751", 4750)).toBe(false);
    expect(hostAllowed("evil.example:4750", 4750)).toBe(false);
    expect(hostAllowed("127.0.0.1", 4750)).toBe(false);
    expect(hostAllowed(undefined, 4750)).toBe(false);
  });

  it("sorts origins into none, allowed and denied", () => {
    const allowed = ["http://localhost:3000"];
    expect(checkOrigin(undefined, allowed)).toEqual({ kind: "none" });
    expect(checkOrigin("http://localhost:3000", allowed)).toEqual({ kind: "allowed", origin: "http://localhost:3000" });
    expect(checkOrigin("https://evil.example", allowed)).toEqual({ kind: "denied" });
    expect(checkOrigin("null", allowed)).toEqual({ kind: "denied" });
  });

  it("matches the token exactly", () => {
    const token = "a".repeat(64);
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches("a".repeat(63), token)).toBe(false);
    expect(tokenMatches(`${"a".repeat(63)}b`, token)).toBe(false);
    expect(tokenMatches([token], token)).toBe(false);
    expect(tokenMatches(undefined, token)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});
```

Create `apps/agent/src/http/server.test.ts`:

```ts
import { DEFAULT_CONFIG, HealthSchema, SnapshotSchema, emptyAliasMap, type Snapshot } from "@clawd/core";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetHost } from "../host/host";
import { silentLogger } from "../log";
import { T0 } from "../testing/events";
import { openStream, send, waitFor } from "../testing/http";
import { ALLOWED_ROOT, CANARY, rawHook, rawStatus } from "../testing/raw";
import { AGENT_VERSION } from "../version";
import { createAgentServer, newIngestCounts, type ServerDeps, type ServerHost } from "./server";
import { createStreamHub, type StreamHub } from "./sse";

const TOKEN = "a".repeat(64);
const WEB = "http://localhost:3000";
const running: { server: Server; stream: StreamHub }[] = [];

afterEach(async () => {
  for (const { server, stream } of running.splice(0)) {
    stream.closeAll();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function start(over: Partial<ServerDeps> = {}) {
  const clock = { now: T0 };
  const host = new FleetHost({ now: () => clock.now, config: DEFAULT_CONFIG, aliases: emptyAliasMap(), log: silentLogger });
  const stream = createStreamHub({ current: () => host.snapshot(), log: silentLogger });
  host.on({ snapshot: (s) => stream.snapshot(s), ticker: (m) => stream.ticker(m) });
  const focus = vi.fn();
  const log = vi.fn();
  const counts = newIngestCounts();
  const server = createAgentServer({
    host,
    config: { allowlist: [ALLOWED_ROOT], token: TOKEN, corsOrigins: [WEB] },
    stream,
    focus,
    now: () => clock.now,
    log,
    counts,
    sensitive: () => [],
    ...over,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  running.push({ server, stream });
  return { port: (server.address() as AddressInfo).port, host, focus, log, counts };
}

const json = { "content-type": "application/json" };
const hook = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  send(port, { method: "POST", path: "/ingest/hook", headers: { ...json, "x-clawd-token": TOKEN, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("ingest routes", () => {
  it("answers a hook with 200 {} and feeds the redacted event to the host", async () => {
    const { port, host, counts } = await start();
    const reply = await hook(port, rawHook("UserPromptSubmit", "s1"));
    expect(reply.status).toBe(200);
    expect(reply.body).toBe("{}");
    expect(reply.headers["content-type"]).toContain("application/json");
    expect(reply.body).not.toContain(CANARY);
    await waitFor(() => host.sessionCount() === 1);
    expect(counts.accepted).toBe(1);
  });

  it("feeds a status line payload through the status route", async () => {
    const { port, host } = await start();
    const reply = await send(port, { method: "POST", path: "/ingest/status", headers: { ...json, "x-clawd-token": TOKEN }, body: JSON.stringify(rawStatus("s1")) });
    expect(reply.status).toBe(200);
    await waitFor(() => host.sessionCount() === 1);
  });

  it("refuses a wrong or missing token with 401 {} and counts it", async () => {
    const { port, host, counts } = await start();
    expect((await hook(port, rawHook("UserPromptSubmit", "s1"), { "x-clawd-token": "b".repeat(64) })).status).toBe(401);
    const missing = await send(port, { method: "POST", path: "/ingest/hook", headers: json, body: JSON.stringify(rawHook("UserPromptSubmit", "s1")) });
    expect(missing.status).toBe(401);
    expect(missing.body).toBe("{}");
    expect(counts.unauthorised).toBe(2);
    expect(host.sessionCount()).toBe(0);
  });

  it("refuses any request with an Origin, any method but POST, and unknown ingest paths", async () => {
    const { port } = await start();
    expect((await hook(port, rawHook("UserPromptSubmit", "s1"), { origin: WEB })).status).toBe(403);
    expect((await send(port, { path: "/ingest/hook", headers: { "x-clawd-token": TOKEN } })).status).toBe(405);
    expect((await send(port, { method: "POST", path: "/ingest/other", headers: { "x-clawd-token": TOKEN }, body: "{}" })).status).toBe(404);
  });

  it("counts bad JSON and over-limit bodies but still answers 200", async () => {
    const { port, host, counts } = await start({ limits: { hook: 1_024 } });
    expect((await hook(port, "{ not json")).status).toBe(200);
    expect((await hook(port, rawHook("UserPromptSubmit", "s1", { prompt: "x".repeat(2_000) }))).status).toBe(200);
    await waitFor(() => counts.badJson === 1 && counts.tooLarge === 1);
    expect(host.sessionCount()).toBe(0);
  });

  it("counts payloads redaction drops", async () => {
    const { port, counts } = await start();
    await hook(port, rawHook("MessageDisplay", "s1", { delta: "CANARY" }));
    await waitFor(() => counts.dropped === 1);
  });
});

describe("guards", () => {
  it("refuses a forged Host header", async () => {
    const { port } = await start();
    expect((await send(port, { path: "/api/health", headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await send(port, { path: "/api/health", headers: { host: `localhost:${port}` } })).status).toBe(200);
  });

  it("gives an allowed origin CORS headers and refuses any other origin outright", async () => {
    const { port } = await start();
    const allowed = await send(port, { path: "/api/health", headers: { origin: WEB } });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(WEB);
    expect(allowed.headers.vary).toBe("Origin");
    expect((await send(port, { path: "/api/health", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await send(port, { path: "/api/stream", headers: { origin: "https://evil.example" } })).status).toBe(403);
    const none = await send(port, { path: "/api/health" });
    expect(none.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers an allowed preflight, including private network access", async () => {
    const { port } = await start();
    const reply = await send(port, {
      method: "OPTIONS",
      path: "/api/command",
      headers: { origin: WEB, "access-control-request-method": "POST", "access-control-request-private-network": "true" },
    });
    expect(reply.status).toBe(204);
    expect(reply.headers).toMatchObject({
      "access-control-allow-origin": WEB,
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "content-type",
      "access-control-allow-private-network": "true",
    });
    expect((await send(port, { method: "OPTIONS", path: "/api/command", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });
});

describe("api routes", () => {
  it("serves the snapshot", async () => {
    const { port } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    const reply = await send(port, { path: "/api/snapshot" });
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(SnapshotSchema.parse(JSON.parse(reply.body)).sessions).toHaveLength(1);
    expect(reply.body).not.toContain(CANARY);
  });

  it("serves health", async () => {
    const { port } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    const reply = await send(port, { path: "/api/health" });
    expect(HealthSchema.parse(JSON.parse(reply.body))).toEqual({ ok: true, version: AGENT_VERSION, sessions: 1 });
  });

  it("serves a session's ticker backfill and 404 for an unknown alias", async () => {
    const { port, host } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    await waitFor(() => host.sessionCount() === 1);
    const reply = await send(port, { path: "/api/ticker/agent-1" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual([{ t: new Date(T0).toISOString(), kind: "prompt" }]);
    expect((await send(port, { path: "/api/ticker/agent-9" })).status).toBe(404);
    expect((await send(port, { path: "/api/ticker/%E0%A4%A" })).status).toBe(404);
  });

  it("streams the snapshot on connect and ticker lines as they happen", async () => {
    const { port } = await start();
    const stream = await openStream(port);
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    await stream.waitFor((text) => text.includes("event: snapshot"));
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    await stream.waitFor((text) => text.includes("event: ticker"));
    expect(stream.text()).not.toContain(CANARY);
    stream.close();
  });

  it("accepts a ping and a focus for a known alias with 202 and runs the focus after answering", async () => {
    const { port, host, focus } = await start();
    await hook(port, rawHook("UserPromptSubmit", "s1"));
    await waitFor(() => host.sessionCount() === 1);
    const ping = await send(port, { method: "POST", path: "/api/command", headers: json, body: '{"type":"ping"}' });
    expect(ping.status).toBe(202);
    expect(ping.body).toBe("");
    const reply = await send(port, { method: "POST", path: "/api/command", headers: json, body: '{"type":"focus","alias":"agent-1"}' });
    expect(reply.status).toBe(202);
    expect(focus).toHaveBeenCalledWith("s1");
  });

  it("refuses bad commands", async () => {
    const { port, focus } = await start();
    const post = (body: string, headers: Record<string, string> = json) => send(port, { method: "POST", path: "/api/command", headers, body });
    expect((await post('{"type":"ping"}', {})).status).toBe(415);
    expect((await post('{"type":"ping"}', { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("{")).status).toBe(400);
    expect((await post('{"type":"reboot"}')).status).toBe(400);
    expect((await post('{"type":"focus","alias":"agent-404"}')).status).toBe(404);
    expect((await post(JSON.stringify({ type: "ping", pad: "x".repeat(5_000) }))).status).toBe(413);
    expect((await send(port, { path: "/api/command" })).status).toBe(405);
    expect(focus).not.toHaveBeenCalled();
  });

  it("answers 404 for unknown paths and 405 for the wrong method", async () => {
    const { port } = await start();
    expect((await send(port, { path: "/nope" })).status).toBe(404);
    expect((await send(port, { path: "/api/nope" })).status).toBe(404);
    expect((await send(port, { method: "POST", path: "/api/snapshot", headers: json, body: "{}" })).status).toBe(405);
  });

  it("refuses to send a body that carries a forbidden key or a live directory", async () => {
    const base: Snapshot = { version: 1, generatedAt: new Date(T0).toISOString(), panes: [], sessions: [] };
    const stub = (snapshot: Snapshot): ServerHost => ({ ingest: vi.fn(), snapshot: () => snapshot, tickerFor: () => null, sessionIdFor: () => null, sessionCount: () => 0 });
    const a = await start({ host: stub({ ...base, ext: { prompt: "x" } }) });
    expect((await send(a.port, { path: "/api/snapshot" })).status).toBe(500);
    expect(a.log).toHaveBeenCalledWith("privacy.blocked");
    const b = await start({ host: stub({ ...base, panes: [{ pane: "pane-1", label: "C:/work/CANARY-repo" }] }), sensitive: () => ["C:/work/CANARY-repo"] });
    const reply = await send(b.port, { path: "/api/snapshot" });
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain(CANARY);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/http/guards.test.ts src/http/server.test.ts`
Expected: FAIL, `./guards` and `./server` cannot be resolved.

- [ ] **Step 4: Write the guards and the server**

Create `apps/agent/src/http/guards.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/** Only loopback names on our own port: a rebound DNS name pointing at 127.0.0.1 is refused. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const name = host.toLowerCase();
  return name === `127.0.0.1:${port}` || name === `localhost:${port}`;
}

export type OriginCheck = { kind: "none" } | { kind: "allowed"; origin: string } | { kind: "denied" };

export function checkOrigin(origin: string | undefined, allowed: readonly string[]): OriginCheck {
  if (origin === undefined) return { kind: "none" };
  return allowed.includes(origin) ? { kind: "allowed", origin } : { kind: "denied" };
}

/** Constant-time comparison of the hook token header. */
export function tokenMatches(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== "string" || expected.length === 0) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Create `apps/agent/src/http/server.ts`:

```ts
import { CommandSchema, ENDPOINTS, HealthSchema, containsForbidden, type RedactedEvent, type Snapshot, type TickerEvent } from "@clawd/core";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentConfig } from "../config";
import { readBody } from "../ingest/body";
import { ingestHook, ingestStatus, parseJson } from "../ingest/ingest";
import type { Logger } from "../log";
import { AGENT_VERSION } from "../version";
import { checkOrigin, hostAllowed, tokenMatches } from "./guards";
import type { StreamHub } from "./sse";

export const HOOK_BODY_LIMIT = 8 * 1024 * 1024;
export const STATUS_BODY_LIMIT = 1024 * 1024;
export const COMMAND_BODY_LIMIT = 4 * 1024;

export type IngestCounts = { accepted: number; dropped: number; tooLarge: number; badJson: number; unauthorised: number };

export function newIngestCounts(): IngestCounts {
  return { accepted: 0, dropped: 0, tooLarge: 0, badJson: 0, unauthorised: 0 };
}

export type ServerHost = {
  ingest(e: RedactedEvent): void;
  snapshot(): Snapshot;
  tickerFor(alias: string): TickerEvent[] | null;
  sessionIdFor(alias: string): string | null;
  sessionCount(): number;
};

export type ServerDeps = {
  host: ServerHost;
  config: Pick<AgentConfig, "allowlist" | "token" | "corsOrigins">;
  stream: Pick<StreamHub, "connect">;
  /** Runs after the 202 has been sent. */
  focus(sessionId: string): void;
  now: () => number;
  log: Logger;
  counts: IngestCounts;
  /** Strings no response body may contain: the live working directories. */
  sensitive: () => readonly string[];
  limits?: { hook?: number; status?: number; command?: number };
};

type Headers = Record<string, string>;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Headers = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": String(Buffer.byteLength(text)) });
  res.end(text);
}

/** Answer without reading the body; resume() lets any body drain so the socket stays usable. */
function refuse(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, headers: Headers = {}): void {
  req.resume();
  sendJson(res, status, body, headers);
}

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function createAgentServer(deps: ServerDeps): Server {
  const limits = { hook: deps.limits?.hook ?? HOOK_BODY_LIMIT, status: deps.limits?.status ?? STATUS_BODY_LIMIT, command: deps.limits?.command ?? COMMAND_BODY_LIMIT };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      deps.log("server.error");
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
      else if (!res.writableEnded) res.end();
    });
  });

  const port = (): number => (server.address() as AddressInfo | null)?.port ?? 0;

  /** Every API body is checked for forbidden keys and live directories before it is written. */
  function sendApi(res: ServerResponse, status: number, body: unknown, headers: Headers): void {
    if (containsForbidden(body, deps.sensitive()) !== null) {
      deps.log("privacy.blocked");
      sendJson(res, 500, { error: "blocked" }, headers);
      return;
    }
    sendJson(res, status, body, headers);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, port())) return refuse(req, res, 403, {});
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (path.startsWith("/ingest/")) return handleIngest(req, res, path);
    if (path.startsWith("/api/")) return handleApi(req, res, path);
    return refuse(req, res, 404, { error: "not found" });
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.headers.origin !== undefined) return refuse(req, res, 403, {});
    const route = path === "/ingest/hook" ? "hook" : path === "/ingest/status" ? "status" : null;
    if (route === null) return refuse(req, res, 404, {});
    if (req.method !== "POST") return refuse(req, res, 405, {}, { allow: "POST" });
    if (!tokenMatches(req.headers["x-clawd-token"], deps.config.token)) {
      deps.counts.unauthorised++;
      return refuse(req, res, 401, {});
    }
    const body = await readBody(req, route === "hook" ? limits.hook : limits.status);
    // Answer first: {} carries no decision and no context, and nothing below can reach Claude Code.
    sendJson(res, 200, {});
    if (!body.ok) {
      if (body.reason === "tooLarge") deps.counts.tooLarge++;
      return;
    }
    try {
      const parsed = parseJson(body.body);
      if (!parsed.ok) {
        deps.counts.badJson++;
        return;
      }
      const ctx = { now: deps.now(), allowlist: deps.config.allowlist };
      const event = route === "hook" ? ingestHook(parsed.value, ctx) : ingestStatus(parsed.value, ctx);
      if (event === null) {
        deps.counts.dropped++;
        return;
      }
      deps.counts.accepted++;
      deps.host.ingest(event);
    } catch {
      deps.log("ingest.failed");
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const origin = checkOrigin(req.headers.origin, deps.config.corsOrigins);
    if (origin.kind === "denied") return refuse(req, res, 403, { error: "origin not allowed" });
    const cors: Headers = origin.kind === "allowed" ? { "access-control-allow-origin": origin.origin, vary: "Origin" } : {};

    if (req.method === "OPTIONS") {
      const privateNetwork: Headers = req.headers["access-control-request-private-network"] === "true" ? { "access-control-allow-private-network": "true" } : {};
      req.resume();
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600", ...privateNetwork });
      res.end();
      return;
    }

    const onlyGet = (then: () => void): void => {
      if (req.method !== "GET") return refuse(req, res, 405, { error: "method not allowed" }, { ...cors, allow: "GET" });
      then();
    };

    if (path === ENDPOINTS.snapshot) return onlyGet(() => sendApi(res, 200, deps.host.snapshot(), cors));
    if (path === ENDPOINTS.health) {
      return onlyGet(() => sendApi(res, 200, HealthSchema.parse({ ok: true, version: AGENT_VERSION, sessions: deps.host.sessionCount() }), cors));
    }
    if (path === ENDPOINTS.stream) return onlyGet(() => deps.stream.connect(req, res, cors));
    if (path === ENDPOINTS.command) {
      if (req.method !== "POST") return refuse(req, res, 405, { error: "method not allowed" }, { ...cors, allow: "POST" });
      return handleCommand(req, res, cors);
    }
    const ticker = /^\/api\/ticker\/([^/]+)$/.exec(path)?.[1];
    if (ticker !== undefined) {
      return onlyGet(() => {
        const alias = safeDecode(ticker);
        const lines = alias === null ? null : deps.host.tickerFor(alias);
        if (lines === null) sendApi(res, 404, { error: "unknown alias" }, cors);
        else sendApi(res, 200, lines, cors);
      });
    }
    return refuse(req, res, 404, { error: "not found" }, cors);
  }

  async function handleCommand(req: IncomingMessage, res: ServerResponse, cors: Headers): Promise<void> {
    // A JSON content type forces a CORS preflight, so a page elsewhere cannot send this as a simple request.
    const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return refuse(req, res, 415, { error: "content-type must be application/json" }, cors);
    const body = await readBody(req, limits.command);
    if (!body.ok) return sendApi(res, 413, { error: "command too large" }, cors);
    const parsed = parseJson(body.body);
    const command = parsed.ok ? CommandSchema.safeParse(parsed.value) : null;
    if (!command?.success) return sendApi(res, 400, { error: "invalid command" }, cors);
    if (command.data.type === "focus") {
      const sessionId = deps.host.sessionIdFor(command.data.alias);
      if (sessionId === null) return sendApi(res, 404, { error: "unknown alias" }, cors);
      res.writeHead(202, { ...cors, "cache-control": "no-store" });
      res.end();
      try {
        deps.focus(sessionId);
      } catch {
        deps.log("focus.failed");
      }
      return;
    }
    res.writeHead(202, { ...cors, "cache-control": "no-store" });
    res.end();
  }

  return server;
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/http`
Expected: PASS.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0. If `deps.stream.connect(req, res, cors)` does not type-check because `ServerResponse`'s overloaded `writeHead`/`end` are not assignable to `StreamResponse`, adapt at the call site with a small wrapper object in `server.ts` that forwards `writeHead`, `write`, `end`, `writableLength` and `writableEnded` to `res`; do not loosen `StreamResponse`.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/http apps/agent/src/testing/http.ts
git commit -m "feat(agent): loopback HTTP server with host, origin and token guards over ingest and the API"
```

---

### Task 9: Windows focus

**Files:**
- Create: `apps/agent/src/focus/focus-script.ts`
- Create: `apps/agent/src/focus/focus.ts`
- Test: `apps/agent/src/focus/focus.test.ts`

**Interfaces:**
- Consumes: `Logger`, `LogCode` (Task 1); `PresencePoller`, `FocusTarget` (Task 6).
- Produces:
  - `FOCUS_SCRIPT: string` (PowerShell; reads `CLAWD_FOCUS_PID` and `CLAWD_FOCUS_FOLDER`; exits 0 raised, 2 flashed, 3 no window, 1 error).
  - `type FocusResult = "raised" | "flashed" | "noWindow" | "failed"`; `type RunFocusScript = (target: { pid: number; folder: string }) => Promise<FocusResult>`; `FOCUS_TIMEOUT_MS = 10_000`; `folderName(cwd: string): string`; `exitToResult(code: number | null): FocusResult`; `encodeScript(script: string): string`; `powershellFocus: RunFocusScript`; `createFocus(deps: { poller: Pick<PresencePoller, "lookup" | "pollOnce">; run: RunFocusScript; platform: NodeJS.Platform; log: Logger }): (sessionId: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `apps/agent/src/focus/focus.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { FocusTarget } from "../presence/poller";
import { FOCUS_SCRIPT } from "./focus-script";
import { createFocus, encodeScript, exitToResult, folderName, powershellFocus, type FocusResult, type RunFocusScript } from "./focus";

describe("focus helpers", () => {
  it("takes the last segment of a directory", () => {
    expect(folderName("C:\\work\\visualiser")).toBe("visualiser");
    expect(folderName("C:\\work\\visualiser\\")).toBe("visualiser");
    expect(folderName("/home/me/proj")).toBe("proj");
    expect(folderName("")).toBe("");
  });

  it("maps the script's exit codes", () => {
    expect(exitToResult(0)).toBe("raised");
    expect(exitToResult(2)).toBe("flashed");
    expect(exitToResult(3)).toBe("noWindow");
    expect(exitToResult(1)).toBe("failed");
    expect(exitToResult(null)).toBe("failed");
  });

  it("encodes the script for -EncodedCommand as UTF-16LE base64", () => {
    expect(Buffer.from(encodeScript("exit 3"), "base64").toString("utf16le")).toBe("exit 3");
  });

  it("interpolates nothing: the script reads its inputs from the environment only", () => {
    expect(FOCUS_SCRIPT).toContain("$env:CLAWD_FOCUS_PID");
    expect(FOCUS_SCRIPT).toContain("$env:CLAWD_FOCUS_FOLDER");
  });
});

describe("createFocus", () => {
  function setup(platform: NodeJS.Platform = "win32", result: FocusResult = "raised") {
    const targets = new Map<string, FocusTarget>();
    const poller = { lookup: vi.fn((id: string) => targets.get(id) ?? null), pollOnce: vi.fn(async () => true) };
    const run = vi.fn<RunFocusScript>(async () => result);
    const log = vi.fn();
    return { targets, poller, run, log, focus: createFocus({ poller, run, platform, log }) };
  }

  it("raises a listed session's window by pid and folder name", async () => {
    const t = setup();
    t.targets.set("s1", { pid: 4242, cwd: "C:\\work\\visualiser" });
    await t.focus("s1");
    expect(t.run).toHaveBeenCalledWith({ pid: 4242, folder: "visualiser" });
    expect(t.poller.pollOnce).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith("focus.raised");
  });

  it("polls once when the latest poll does not have the session", async () => {
    const t = setup();
    t.poller.pollOnce.mockImplementationOnce(async () => {
      t.targets.set("s1", { pid: 7, cwd: "C:/work/repo" });
      return true;
    });
    await t.focus("s1");
    expect(t.poller.pollOnce).toHaveBeenCalledTimes(1);
    expect(t.run).toHaveBeenCalledWith({ pid: 7, folder: "repo" });
  });

  it("gives up when the session is still not listed", async () => {
    const t = setup();
    await t.focus("s1");
    expect(t.run).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith("focus.notListed");
  });

  it.each([
    ["flashed", "focus.flashed"],
    ["noWindow", "focus.noWindow"],
    ["failed", "focus.failed"],
  ] as const)("logs a %s result", async (result, code) => {
    const t = setup("win32", result);
    t.targets.set("s1", { pid: 1, cwd: "C:/r" });
    await t.focus("s1");
    expect(t.log).toHaveBeenCalledWith(code);
  });

  it("only logs on other platforms", async () => {
    const t = setup("linux");
    t.targets.set("s1", { pid: 1, cwd: "/r" });
    await t.focus("s1");
    expect(t.run).not.toHaveBeenCalled();
    expect(t.log).toHaveBeenCalledWith("focus.unsupported");
  });
});

describe.runIf(process.platform === "win32")("focus script on Windows", () => {
  it("parses without errors", () => {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "$errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($env:CLAWD_SCRIPT, [ref]$null, [ref]$errors); $errors.Count"],
      { env: { ...process.env, CLAWD_SCRIPT: FOCUS_SCRIPT }, encoding: "utf8", windowsHide: true },
    );
    expect(out.trim()).toBe("0");
  }, 30_000);

  it("compiles its helpers and finds no window for a process that does not exist", async () => {
    expect(await powershellFocus({ pid: 4_294_967_000, folder: "nothing-here" })).toBe("noWindow");
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @clawd/agent exec vitest run src/focus`
Expected: FAIL, `./focus-script` and `./focus` cannot be resolved.

- [ ] **Step 3: Write the script and the focus service**

Create `apps/agent/src/focus/focus-script.ts`. The here-string markers `@'` and `'@` must stay at the start of their lines exactly as shown, and the script must not contain the two characters `$` `{` next to each other, since it is a template literal:

```ts
/**
 * Raises the top-level window of a Claude Code session on Windows. The session's pid and the last
 * segment of its working directory arrive in CLAWD_FOCUS_PID and CLAWD_FOCUS_FOLDER; nothing is
 * interpolated into this text. Exit codes: 0 raised, 2 flashed instead, 3 no window found, 1 error.
 */
export const FOCUS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $targetPid = [uint32]$env:CLAWD_FOCUS_PID
  $folder = [string]$env:CLAWD_FOCUS_FOLDER
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ClawdFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO info);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();

  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }

  public static List<KeyValuePair<IntPtr, string>> TopWindows(HashSet<uint> pids) {
    var found = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint owner;
      GetWindowThreadProcessId(h, out owner);
      if (pids.Contains(owner) && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) {
        var title = new StringBuilder(512);
        GetWindowText(h, title, title.Capacity);
        if (title.Length > 0) found.Add(new KeyValuePair<IntPtr, string>(h, title.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static int Raise(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    if (GetForegroundWindow() == h) return 0;
    var info = new FLASHWINFO();
    info.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
    info.hwnd = h;
    info.dwFlags = 3 | 12;
    info.uCount = 3;
    info.dwTimeout = 0;
    FlashWindowEx(ref info);
    return 2;
  }
}
'@
  $procs = @{}
  foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name) { $procs[[uint32]$p.ProcessId] = $p }
  $editors = @('code.exe', 'code - insiders.exe', 'cursor.exe')
  $hwnd = [IntPtr]::Zero
  $current = $targetPid
  for ($i = 0; $i -lt 12 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    if (-not $procs.ContainsKey($current)) { break }
    $p = $procs[$current]
    $name = ([string]$p.Name).ToLowerInvariant()
    if ($editors -contains $name) {
      if ($folder.Length -gt 0) {
        $pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
        foreach ($q in $procs.Values) { if (([string]$q.Name).ToLowerInvariant() -eq $name) { [void]$pids.Add([uint32]$q.ProcessId) } }
        $windows = [ClawdFocus]::TopWindows($pids)
        $exact = @($windows | Where-Object { ($_.Value -split ' [-\u2014] ') -contains $folder })
        $loose = @($windows | Where-Object { $_.Value.IndexOf($folder, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
        if ($exact.Count -gt 0) { $hwnd = $exact[0].Key } elseif ($loose.Count -gt 0) { $hwnd = $loose[0].Key }
      }
      break
    }
    $proc = Get-Process -Id ([int]$current) -ErrorAction SilentlyContinue
    if ($null -ne $proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { $hwnd = $proc.MainWindowHandle; break }
    $current = [uint32]$p.ParentProcessId
  }
  if ($hwnd -eq [IntPtr]::Zero) {
    [void][ClawdFocus]::FreeConsole()
    if ([ClawdFocus]::AttachConsole($targetPid)) {
      $console = [ClawdFocus]::GetConsoleWindow()
      [void][ClawdFocus]::FreeConsole()
      if ($console -ne [IntPtr]::Zero -and [ClawdFocus]::IsWindowVisible($console)) { $hwnd = $console }
    }
  }
  if ($hwnd -eq [IntPtr]::Zero) { exit 3 }
  exit ([ClawdFocus]::Raise($hwnd))
} catch {
  exit 1
}
`;
```

Create `apps/agent/src/focus/focus.ts`:

```ts
import { spawn } from "node:child_process";
import type { LogCode, Logger } from "../log";
import type { PresencePoller } from "../presence/poller";
import { FOCUS_SCRIPT } from "./focus-script";

export type FocusResult = "raised" | "flashed" | "noWindow" | "failed";
export type RunFocusScript = (target: { pid: number; folder: string }) => Promise<FocusResult>;

export const FOCUS_TIMEOUT_MS = 10_000;

const RESULT_CODES: Readonly<Record<FocusResult, LogCode>> = {
  raised: "focus.raised",
  flashed: "focus.flashed",
  noWindow: "focus.noWindow",
  failed: "focus.failed",
};

export function folderName(cwd: string): string {
  return cwd.split(/[\\/]+/).filter((part) => part.length > 0).at(-1) ?? "";
}

export function exitToResult(code: number | null): FocusResult {
  return code === 0 ? "raised" : code === 2 ? "flashed" : code === 3 ? "noWindow" : "failed";
}

export function encodeScript(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Runs the constant script with the target in the environment; its output is discarded. */
export const powershellFocus: RunFocusScript = ({ pid, folder }) =>
  new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: FocusResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(result);
    };
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodeScript(FOCUS_SCRIPT)], {
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, CLAWD_FOCUS_PID: String(pid), CLAWD_FOCUS_FOLDER: folder },
    });
    timer = setTimeout(() => {
      child.kill();
      finish("failed");
    }, FOCUS_TIMEOUT_MS);
    child.on("error", () => finish("failed"));
    child.on("exit", (code) => finish(exitToResult(code)));
  });

/** Focus a session's window by session id (spec §10). Never throws. */
export function createFocus(deps: { poller: Pick<PresencePoller, "lookup" | "pollOnce">; run: RunFocusScript; platform: NodeJS.Platform; log: Logger }): (sessionId: string) => Promise<void> {
  return async (sessionId) => {
    if (deps.platform !== "win32") {
      deps.log("focus.unsupported");
      return;
    }
    let target = deps.poller.lookup(sessionId);
    if (target === null) {
      await deps.poller.pollOnce();
      target = deps.poller.lookup(sessionId);
    }
    if (target === null) {
      deps.log("focus.notListed");
      return;
    }
    deps.log(RESULT_CODES[await deps.run({ pid: target.pid, folder: folderName(target.cwd) })]);
  };
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/focus`
Expected: PASS on Windows including the two Windows-only tests (about five seconds; `Add-Type` compiles). On other platforms those two are skipped.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/focus
git commit -m "feat(agent): raise a session's window on Windows by pid ancestry and folder title"
```

---

### Task 10: Agent composition, serve command and end-to-end privacy test

**Files:**
- Create: `apps/agent/src/agent.ts`
- Create: `apps/agent/src/cli.ts`
- Create: `apps/agent/src/main.ts`
- Test: `apps/agent/src/agent.e2e.test.ts`, `apps/agent/src/agent.recordings.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 9: `agentPaths`, `loadOrCreateConfig`, `ConfigError`, `defaultHome`, `saveConfig`, `defaultConfig` (Task 2); `isErrno` (Task 2); `createAliasStore`, `createEventLog` (Task 4); `FleetHost` (Task 5); `createPresencePoller`, `nodeExec`, `Exec` (Task 6); `createStreamHub` (Task 7); `createAgentServer`, `newIngestCounts`, `IngestCounts` (Task 8); `createFocus`, `powershellFocus`, `RunFocusScript` (Task 9); `createLogger`, `Logger` (Task 1); test helpers from Tasks 2, 3 and 8.
- Produces:
  - `type AgentOptions = { home: string; port?: number; now?: () => number; log?: Logger; exec?: Exec; runFocus?: RunFocusScript; platform?: NodeJS.Platform; stateConfig?: StateConfig; tickMs?: number }`; `type RunningAgent = { port: number; stop(): Promise<void> }`; `TICK_MS = 500`; `startAgent(opts: AgentOptions): Promise<RunningAgent>`; `reportCounts(counts: IngestCounts, log: Logger): void`.
  - `type CliEnv = { serve: () => Promise<number>; printError: (line: string) => void }` (extended in Task 13); `USAGE`; `runCli(argv: readonly string[], env: CliEnv): Promise<number>`.

- [ ] **Step 1: Write the failing end-to-end test**

Create `apps/agent/src/agent.e2e.test.ts`:

```ts
import { DEFAULT_CONFIG, SnapshotSchema, StreamTickerMessageSchema, TickerEventSchema, parseFixture } from "@clawd/core";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAgent, type RunningAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { createLogger } from "./log";
import type { Exec } from "./presence/poller";
import { openStream, parseSse, send, waitFor } from "./testing/http";
import { ALLOWED_ROOT, CANARY, OUTSIDE_CWD, rawAgentEntry, rawHook, rawSessionScript, rawStatus } from "./testing/raw";
import { useTempDirs } from "./testing/tmp";

describe("agent end to end", () => {
  const tempDir = useTempDirs();
  let agent: RunningAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
  });

  it("serves the contract, focuses a session, and lets no canary from any raw payload reach any sink", async () => {
    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT], pollIntervalMs: 1_000 };
    await saveConfig(agentPaths(home), config);
    const logged: string[] = [];
    let listed: unknown[] = [];
    const exec: Exec = async () => ({ ok: true, stdout: JSON.stringify(listed) });
    const focused: number[] = [];
    agent = await startAgent({
      home,
      port: 0,
      log: createLogger((line) => logged.push(line)),
      exec,
      // A long linger keeps the ended session in the snapshot however slowly the test machine runs.
      stateConfig: { ...DEFAULT_CONFIG, doneLingerMs: 60_000 },
      platform: "win32",
      runFocus: async ({ pid }) => {
        focused.push(pid);
        return "raised";
      },
    });
    const { port } = agent;
    const post = (path: string, body: unknown) =>
      send(port, { method: "POST", path, headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(body) });

    const stream = await openStream(port);
    await stream.waitFor((text) => text.includes("event: snapshot"));

    for (const raw of rawSessionScript("e2e-one")) expect((await post("/ingest/hook", raw)).status).toBe(200);
    listed = [rawAgentEntry("e2e-two")];
    await post("/ingest/hook", rawHook("UserPromptSubmit", "e2e-two"));
    await post("/ingest/status", rawStatus("e2e-two"));
    await post("/ingest/hook", rawHook("UserPromptSubmit", "outside", { cwd: OUTSIDE_CWD }));
    await stream.waitFor((text) => text.includes('"contextPct":42'));

    const bodies: string[] = [];
    const snapshot = await send(port, { path: "/api/snapshot" });
    expect(SnapshotSchema.parse(JSON.parse(snapshot.body)).sessions.map((s) => s.alias)).toEqual(["agent-1", "agent-2"]);
    bodies.push(snapshot.body, (await send(port, { path: "/api/health" })).body);
    for (const alias of ["agent-1", "agent-2"]) {
      const reply = await send(port, { path: `/api/ticker/${alias}` });
      expect(reply.status).toBe(200);
      for (const line of JSON.parse(reply.body) as unknown[]) TickerEventSchema.parse(line);
      bodies.push(reply.body);
    }

    const command = await send(port, { method: "POST", path: "/api/command", headers: { "content-type": "application/json" }, body: '{"type":"focus","alias":"agent-2"}' });
    expect(command.status).toBe(202);
    await waitFor(() => focused.length === 1);
    expect(focused).toEqual([4242]);

    const messages = parseSse(stream.text());
    expect(messages.some((m) => m.event === "ticker")).toBe(true);
    for (const message of messages) {
      if (message.event === "snapshot") SnapshotSchema.parse(message.data);
      else if (message.event === "ticker") StreamTickerMessageSchema.parse(message.data);
      else throw new Error(`unexpected stream event ${message.event}`);
    }
    bodies.push(stream.text());
    stream.close();
    await agent.stop();
    agent = null;

    const logFiles: string[] = [];
    for (const name of await readdir(join(home, "logs"))) logFiles.push(await readFile(join(home, "logs", name), "utf8"));
    const events = logFiles.flatMap((text) => parseFixture(text).events);
    expect(events.some((e) => e.sessionId === "e2e-one" && e.kind === "session.end")).toBe(true);
    expect(events.some((e) => e.sessionId === "outside")).toBe(false);

    const sinks: [string, string][] = [
      ["stream and responses", bodies.join("\n")],
      ["event log", logFiles.join("\n")],
      ["aliases.json", await readFile(join(home, "aliases.json"), "utf8")],
      ["config.json", await readFile(join(home, "config.json"), "utf8")],
      ["stdout", logged.join("")],
    ];
    for (const [sink, text] of sinks) expect(text.includes(CANARY), `canary found in ${sink}`).toBe(false);
  }, 20_000);
});
```

Create `apps/agent/src/agent.recordings.test.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startAgent, type RunningAgent } from "./agent";
import { agentPaths, defaultConfig, saveConfig } from "./config";
import { createLogger } from "./log";
import { openStream, send } from "./testing/http";
import { useTempDirs } from "./testing/tmp";

/**
 * Local only. Point CLAWD_SPIKE_DIR at the directory holding the raw spike recordings
 * (tools/hook-spike/*.jsonl, never committed). Every recorded body is posted to a real agent and
 * every sink is searched for every recorded path, prompt and tool payload string. Failures name the
 * field and the sink, never the value.
 */
const SPIKE_DIR = process.env.CLAWD_SPIKE_DIR;

const SECRET_KEYS = new Set([
  "cwd", "transcript_path", "agent_transcript_path", "prompt", "last_assistant_message", "session_name",
  "current_dir", "project_dir", "tool_input", "tool_response", "delta", "message", "description", "command", "error",
]);

type Recorded = { route: "/ingest/hook" | "/ingest/status"; body: unknown };

function recordedPayloads(text: string): Recorded[] {
  const out: Recorded[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let record: { url?: unknown; body?: unknown };
    try {
      record = JSON.parse(line) as { url?: unknown; body?: unknown };
    } catch {
      continue;
    }
    if (typeof record.url !== "string") continue;
    if (record.url.startsWith("/command-hook/")) {
      const payload = (record.body as { payload?: unknown } | undefined)?.payload;
      if (payload !== undefined) out.push({ route: record.url === "/command-hook/statusline" ? "/ingest/status" : "/ingest/hook", body: payload });
    } else {
      out.push({ route: "/ingest/hook", body: record.body });
    }
  }
  return out;
}

function secrets(value: unknown, field: string | null = null, out: { field: string; value: string }[] = []): { field: string; value: string }[] {
  if (typeof value === "string") {
    if (field !== null && value.length >= 8) out.push({ field, value });
  } else if (Array.isArray(value)) {
    for (const v of value) secrets(v, field, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) secrets(v, field ?? (SECRET_KEYS.has(k) ? k : null), out);
  }
  return out;
}

describe.runIf(Boolean(SPIKE_DIR))("raw spike recordings (local only)", () => {
  const tempDir = useTempDirs();
  let agent: RunningAgent | null = null;

  afterEach(async () => {
    await agent?.stop();
    agent = null;
  });

  it("leaks nothing recorded into any sink", async () => {
    const dir = SPIKE_DIR as string;
    const payloads: Recorded[] = [];
    for (const name of (await readdir(dir)).filter((n) => n.endsWith(".jsonl"))) payloads.push(...recordedPayloads(await readFile(join(dir, name), "utf8")));
    expect(payloads.length).toBeGreaterThan(0);
    const found = payloads.flatMap((p) => secrets(p.body));
    const cwds = [...new Set(payloads.map((p) => (p.body as { cwd?: unknown } | null)?.cwd).filter((c): c is string => typeof c === "string"))];
    expect(cwds.length).toBeGreaterThan(0);

    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: cwds };
    await saveConfig(agentPaths(home), config);
    const logged: string[] = [];
    agent = await startAgent({ home, port: 0, log: createLogger((l) => logged.push(l)), exec: async () => ({ ok: true, stdout: "[]" }), platform: "linux" });
    const { port } = agent;
    const stream = await openStream(port);
    for (const p of payloads) {
      await send(port, { method: "POST", path: p.route, headers: { "content-type": "application/json", "x-clawd-token": config.token }, body: JSON.stringify(p.body) });
    }
    const bodies = [(await send(port, { path: "/api/snapshot" })).body, (await send(port, { path: "/api/health" })).body];
    const aliasesText = await readFile(join(home, "aliases.json"), "utf8").catch(() => "{}");
    await agent.stop();
    agent = null;
    const aliasesAfter = await readFile(join(home, "aliases.json"), "utf8");
    const aliasNames = Object.values((JSON.parse(aliasesAfter) as { sessions: Record<string, { alias: string }> }).sessions).map((e) => e.alias);
    expect(aliasNames.length).toBeGreaterThan(0);
    bodies.push(stream.text());
    stream.close();
    const logs: string[] = [];
    for (const name of await readdir(join(home, "logs"))) logs.push(await readFile(join(home, "logs", name), "utf8"));

    const sinks: Record<string, string> = { stream: bodies.join("\n"), logs: logs.join("\n"), aliases: aliasesText + aliasesAfter, stdout: logged.join("") };
    const leaks = new Set<string>();
    for (const [sink, text] of Object.entries(sinks)) {
      for (const s of found) if (text.includes(s.value) || text.includes(JSON.stringify(s.value).slice(1, -1))) leaks.add(`${s.field} in ${sink}`);
    }
    expect([...leaks]).toEqual([]);
  }, 60_000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/agent.e2e.test.ts src/agent.recordings.test.ts`
Expected: FAIL, `./agent` cannot be resolved (the recordings suite is skipped when `CLAWD_SPIKE_DIR` is unset).

- [ ] **Step 3: Write the composition, the CLI and the entry point**

Create `apps/agent/src/agent.ts`:

```ts
import { DEFAULT_CONFIG, type StateConfig } from "@clawd/core";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { agentPaths, loadOrCreateConfig } from "./config";
import { createFocus, powershellFocus, type RunFocusScript } from "./focus/focus";
import { FleetHost } from "./host/host";
import { createAgentServer, newIngestCounts, type IngestCounts } from "./http/server";
import { createStreamHub } from "./http/sse";
import { isErrno } from "./json-file";
import { createLogger, type Logger } from "./log";
import { createPresencePoller, nodeExec, type Exec } from "./presence/poller";
import { createAliasStore } from "./store/alias-store";
import { createEventLog } from "./store/event-log";

export type AgentOptions = {
  home: string;
  /** Overrides the configured port; 0 picks a free one. */
  port?: number;
  now?: () => number;
  log?: Logger;
  exec?: Exec;
  runFocus?: RunFocusScript;
  platform?: NodeJS.Platform;
  stateConfig?: StateConfig;
  tickMs?: number;
};

export type RunningAgent = { port: number; stop(): Promise<void> };

export const TICK_MS = 500;
const SWEEP_MS = 3_600_000;
const COUNTS_MS = 60_000;

export function reportCounts(counts: IngestCounts, log: Logger): void {
  if (Object.values(counts).every((n) => n === 0)) return;
  log("ingest.counts", { ...counts });
  counts.accepted = 0;
  counts.dropped = 0;
  counts.tooLarge = 0;
  counts.badJson = 0;
  counts.unauthorised = 0;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/** Wires the agent together (spec §11). Writes config.json with a fresh token when there is none. */
export async function startAgent(opts: AgentOptions): Promise<RunningAgent> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? createLogger();
  const paths = agentPaths(opts.home);
  const config = await loadOrCreateConfig(paths);
  if (config.allowlist.length === 0) log("config.emptyAllowlist");

  const aliasStore = createAliasStore(paths.aliases, { log, now });
  const host = new FleetHost({ now, config: opts.stateConfig ?? DEFAULT_CONFIG, aliases: await aliasStore.load(), log });
  const poller = createPresencePoller({ host, exec: opts.exec ?? nodeExec, command: config.claudeCommand, allowlist: config.allowlist, intervalMs: config.pollIntervalMs, now, log });
  const sensitive = (): readonly string[] => poller.liveDirectories();
  const eventLog = createEventLog(paths.logs, { now, retentionDays: config.logRetentionDays, log, sensitive });
  const stream = createStreamHub({ current: () => host.snapshot(), log, sensitive, now });
  host.on({
    event: (e) => eventLog.append(e),
    ticker: (m) => stream.ticker(m),
    snapshot: (s) => stream.snapshot(s),
    aliases: (map) => aliasStore.save(map),
  });
  const focus = createFocus({ poller, run: opts.runFocus ?? powershellFocus, platform: opts.platform ?? process.platform, log });
  const counts = newIngestCounts();
  const server = createAgentServer({
    host,
    config,
    stream,
    focus: (sessionId) => {
      focus(sessionId).catch(() => log("focus.failed"));
    },
    now,
    log,
    counts,
    sensitive,
  });

  let port: number;
  try {
    port = await listen(server, opts.port ?? config.port);
  } catch (err) {
    if (isErrno(err, "EADDRINUSE")) log("server.portInUse");
    throw err;
  }

  const tick = setInterval(() => host.tick(), opts.tickMs ?? TICK_MS);
  const sweep = setInterval(() => void eventLog.sweep(), SWEEP_MS);
  const report = setInterval(() => reportCounts(counts, log), COUNTS_MS);
  void eventLog.sweep();
  poller.start();
  log("agent.started", { port });

  return {
    port,
    async stop() {
      clearInterval(tick);
      clearInterval(sweep);
      clearInterval(report);
      poller.stop();
      stream.closeAll();
      await closeServer(server);
      reportCounts(counts, log);
      await aliasStore.flush();
      await eventLog.flush();
      log("agent.stopped");
    },
  };
}
```

Create `apps/agent/src/cli.ts`:

```ts
export type CliEnv = { serve: () => Promise<number>; printError: (line: string) => void };

export const USAGE = "usage: agent serve";

export async function runCli(argv: readonly string[], env: CliEnv): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "serve" && rest.length === 0) return env.serve();
  env.printError(USAGE);
  return 2;
}
```

Create `apps/agent/src/main.ts`:

```ts
import { startAgent } from "./agent";
import { runCli } from "./cli";
import { ConfigError, defaultHome } from "./config";
import { isErrno } from "./json-file";

async function serve(): Promise<number> {
  let agent;
  try {
    agent = await startAgent({ home: defaultHome() });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    if (isErrno(err, "EADDRINUSE")) {
      process.stderr.write("the agent's port is already in use; is another agent running?\n");
      return 1;
    }
    throw err;
  }
  process.stderr.write(`clawd agent listening on http://127.0.0.1:${agent.port}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await agent.stop();
  return 0;
}

runCli(process.argv.slice(2), { serve, printError: (line) => process.stderr.write(`${line}\n`) }).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent test`
Expected: PASS; the recordings suite is reported as skipped.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Smoke the entry point on a temp home**

First check the port is free: `Test-NetConnection 127.0.0.1 -Port 4750 -InformationLevel Quiet` must print `False`. If it prints `True`, skip this step and say so in the report. Otherwise run, in PowerShell from `C:\mw\visualiser-agent\apps\agent`:

```powershell
$env:CLAWD_HOME = Join-Path $env:TEMP "clawd-smoke-$(Get-Random)"
$agent = Start-Process -PassThru -WindowStyle Hidden -FilePath node -ArgumentList "--import", "tsx", "src/main.ts", "serve"
Start-Sleep -Seconds 5
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4750/api/health).Content
taskkill /PID $agent.Id /T /F
Remove-Item Env:CLAWD_HOME
```

Expected: `{"ok":true,"version":"0.1.0","sessions":0}`. The temp home starts with an empty allowlist, so no session is admitted. `taskkill /T` stops only the process tree this step started; never stop any other Node process, since another session runs a dev server on this machine.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/agent.ts apps/agent/src/cli.ts apps/agent/src/main.ts apps/agent/src/agent.e2e.test.ts apps/agent/src/agent.recordings.test.ts
git commit -m "feat(agent): compose and serve the agent, with an end-to-end canary test over every sink"
```

---

### Task 11: Hook scripts

**Files:**
- Create: `apps/agent/hooks/clawd-lib.mjs`
- Create: `apps/agent/hooks/clawd-hook.mjs`
- Create: `apps/agent/hooks/clawd-statusline.mjs`
- Test: `apps/agent/src/hook-scripts.test.ts`

**Interfaces:**
- Consumes: test helpers `useTempDirs` (Task 2), `rawHook`, `rawStatus` (Task 3).
- Produces: three files that the installer (Task 13) copies to `<home>/bin`. `clawd-lib.mjs` exports `POST_TIMEOUT_MS`, `readConfig(url?)`, `readStdin(stream?)`, `post(config, path, body, timeoutMs?)`, `defaultLine(payload)`, `runWrapped(command, input, timeoutMs?)`. The entry scripts read `../config.json` (`port`, `token`, optional `wrappedStatusLine.command`).

- [ ] **Step 1: Write the failing test**

Create `apps/agent/src/hook-scripts.test.ts`:

```ts
import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { rawHook, rawStatus } from "./testing/raw";
import { useTempDirs } from "./testing/tmp";

const HOOKS = fileURLToPath(new URL("../hooks/", import.meta.url));
const SCRIPTS = ["clawd-lib.mjs", "clawd-hook.mjs", "clawd-statusline.mjs"];
const TOKEN = "c".repeat(64);
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

type Received = { path: string; token: string | undefined; body: string };

async function agentStub(respond = true) {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ path: req.url ?? "", token: req.headers["x-clawd-token"] as string | undefined, body });
      if (!respond) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, received };
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function run(script: string, stdin: string): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}

const forward = (p: string): string => p.replace(/\\/g, "/");

describe("hook scripts", () => {
  const tempDir = useTempDirs();

  async function install(config: Record<string, unknown> | null): Promise<string> {
    const home = await tempDir();
    await mkdir(join(home, "bin"));
    for (const file of SCRIPTS) await copyFile(join(HOOKS, file), join(home, "bin", file));
    if (config !== null) await writeFile(join(home, "config.json"), JSON.stringify(config));
    return home;
  }
  const bin = (home: string, file: string): string => join(home, "bin", file);

  it("SessionStart hook: posts its stdin with the token and prints nothing", async () => {
    const agent = await agentStub();
    const home = await install({ port: agent.port, token: TOKEN });
    const payload = JSON.stringify(rawHook("SessionStart", "s1", { source: "startup" }));
    const result = await run(bin(home, "clawd-hook.mjs"), payload);
    expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(agent.received).toEqual([{ path: "/ingest/hook", token: TOKEN, body: payload }]);
  });

  it("SessionStart hook: exits 0 promptly when the agent is down or there is no config", async () => {
    const down = await run(bin(await install({ port: await closedPort(), token: TOKEN }), "clawd-hook.mjs"), "{}");
    expect(down).toMatchObject({ code: 0, stdout: "" });
    expect(down.ms).toBeLessThan(1_500);
    expect(await run(bin(await install(null), "clawd-hook.mjs"), "{}")).toMatchObject({ code: 0, stdout: "" });
  });

  it("SessionStart hook: gives up on an agent that never answers", async () => {
    const agent = await agentStub(false);
    const result = await run(bin(await install({ port: agent.port, token: TOKEN }), "clawd-hook.mjs"), "{}");
    expect(result.code).toBe(0);
    expect(result.ms).toBeLessThan(1_500);
  });

  it("status line: posts its stdin and prints the default line", async () => {
    const agent = await agentStub();
    const home = await install({ port: agent.port, token: TOKEN });
    const payload = JSON.stringify(rawStatus("s1"));
    const result = await run(bin(home, "clawd-statusline.mjs"), payload);
    expect(result).toMatchObject({ code: 0, stdout: "clawd · Opus 5 · ctx 42%\n" });
    expect(agent.received).toEqual([{ path: "/ingest/status", token: TOKEN, body: payload }]);
  });

  it("status line: leaves out what the payload lacks, and still prints with the agent down", async () => {
    const home = await install({ port: await closedPort(), token: TOKEN });
    expect((await run(bin(home, "clawd-statusline.mjs"), "{}")).stdout).toBe("clawd\n");
    expect((await run(bin(home, "clawd-statusline.mjs"), "not json")).stdout).toBe("clawd\n");
  });

  it("status line: prints the wrapped command's output, which reads the same stdin", async () => {
    const agent = await agentStub();
    const home = await install(null);
    const echo = join(home, "echo.mjs");
    await writeFile(echo, 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write("wrapped "+JSON.parse(s).model.display_name+"\\n"));');
    const command = `"${forward(process.execPath)}" "${forward(echo)}"`;
    await writeFile(join(home, "config.json"), JSON.stringify({ port: agent.port, token: TOKEN, wrappedStatusLine: { type: "command", command } }));
    const result = await run(bin(home, "clawd-statusline.mjs"), JSON.stringify(rawStatus("s1")));
    expect(result).toMatchObject({ code: 0, stdout: "wrapped Opus 5\n" });
    expect(agent.received).toHaveLength(1);
  });

  it("status line: falls back to the default line when the wrapped command fails", async () => {
    const home = await install(null);
    const command = `"${forward(process.execPath)}" -e "process.exit(3)"`;
    await writeFile(join(home, "config.json"), JSON.stringify({ port: await closedPort(), token: TOKEN, wrappedStatusLine: { command } }));
    expect((await run(bin(home, "clawd-statusline.mjs"), JSON.stringify(rawStatus("s1")))).stdout).toBe("clawd · Opus 5 · ctx 42%\n");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @clawd/agent exec vitest run src/hook-scripts.test.ts`
Expected: FAIL, copying `clawd-lib.mjs` fails with ENOENT.

- [ ] **Step 3: Write the scripts**

Create `apps/agent/hooks/clawd-lib.mjs`:

```js
// Shared by the Clawd visualiser's Claude Code hook scripts. No dependencies: the installer copies
// these files to ~/.clawd/bin and they must run without this repository. Nothing here prints, logs
// or stores the payload it forwards; the agent redacts it at ingest.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";

export const POST_TIMEOUT_MS = 250;

/** Port and token from ../config.json beside the installed scripts, or null when unusable. */
export function readConfig(url = new URL("../config.json", import.meta.url)) {
  try {
    const config = JSON.parse(readFileSync(url, "utf8"));
    return config && Number.isInteger(config.port) && typeof config.token === "string" ? config : null;
  } catch {
    return null;
  }
}

export function readStdin(stream = process.stdin) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

/** POST a body to the agent. Resolves on response, error or timeout; never rejects. */
export function post(config, path, body, timeoutMs = POST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    const req = request(
      { host: "127.0.0.1", port: config.port, path, method: "POST", headers: { "content-type": "application/json", "content-length": body.length, "x-clawd-token": config.token } },
      (res) => {
        res.resume();
        res.on("end", finish);
        res.on("error", finish);
      },
    );
    timer = setTimeout(() => {
      req.destroy();
      finish();
    }, timeoutMs);
    req.on("error", finish);
    req.end(body);
  });
}

/** The line shown when no wrapped status line produced one. */
export function defaultLine(payload) {
  const parts = ["clawd"];
  const model = payload?.model?.display_name;
  if (typeof model === "string" && model.length > 0) parts.push(model);
  const pct = payload?.context_window?.used_percentage;
  if (typeof pct === "number" && Number.isFinite(pct)) parts.push(`ctx ${Math.round(pct)}%`);
  return parts.join(" · ");
}

/**
 * Claude Code runs status lines through Git Bash on Windows, so a user's command may be bash. A bare
 * `bash` from PATH is avoided on Windows because it can be WSL's, which cannot run Windows paths.
 */
function bashPath() {
  const candidates = process.platform === "win32"
    ? [process.env.CLAUDE_CODE_GIT_BASH_PATH, "C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"]
    : ["/bin/bash"];
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  return null;
}

function runOnce(file, args, shell, input, timeoutMs) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    let timer = null;
    const finish = (output) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(output);
    };
    let child;
    try {
      child = spawn(file, args, { shell, windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      finish(null);
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.on("error", () => finish(null));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("close", (code) => finish(code === 0 ? out : null));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** Run the user's previous status line with the same stdin: its stdout, or null if it failed. */
export function runWrapped(command, input, timeoutMs = 5000) {
  const bash = bashPath();
  return bash ? runOnce(bash, ["-c", command], false, input, timeoutMs) : runOnce(command, [], true, input, timeoutMs);
}
```

Create `apps/agent/hooks/clawd-hook.mjs`:

```js
// Claude Code SessionStart command hook for the Clawd visualiser. Forwards the payload on stdin to
// the local agent, which redacts it at ingest. Prints nothing and always exits 0.
import { post, readConfig, readStdin } from "./clawd-lib.mjs";

setTimeout(() => process.exit(0), 1500).unref();

try {
  const config = readConfig();
  const body = await readStdin();
  if (config && body.length > 0) await post(config, "/ingest/hook", body);
} catch {
  // A hook must never fail the session.
}
process.exit(0);
```

Create `apps/agent/hooks/clawd-statusline.mjs`:

```js
// Claude Code status line command for the Clawd visualiser. Forwards the payload on stdin to the
// local agent and prints a status line: the user's previous status line when one was wrapped, else a
// short default. The status bar never goes blank. Always exits 0.
import { defaultLine, post, readConfig, readStdin, runWrapped } from "./clawd-lib.mjs";

setTimeout(() => process.exit(0), 6000).unref();

let line;
try {
  const config = readConfig();
  const input = await readStdin();
  let payload = null;
  try {
    payload = JSON.parse(input.toString("utf8"));
  } catch {
    payload = null;
  }
  const wrapped = typeof config?.wrappedStatusLine?.command === "string" ? config.wrappedStatusLine.command : null;
  const [output] = await Promise.all([
    wrapped ? runWrapped(wrapped, input) : Promise.resolve(null),
    config && input.length > 0 ? post(config, "/ingest/status", input) : Promise.resolve(),
  ]);
  line = output ?? `${defaultLine(payload)}\n`;
} catch {
  line = "clawd\n";
}
process.stdout.write(line, () => process.exit(0));
```

- [ ] **Step 4: Run the test and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/hook-scripts.test.ts`
Expected: PASS, 7 tests.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/hooks apps/agent/src/hook-scripts.test.ts
git commit -m "feat(agent): dependency-free SessionStart and status line hook scripts"
```

---

### Task 12: Settings transform

**Files:**
- Create: `apps/agent/src/install/settings.ts`
- Test: `apps/agent/src/install/settings.test.ts`

**Interfaces:**
- Consumes: `WrappedStatusLine` (Task 2).
- Produces:
  - `type JsonObject = Record<string, unknown>`; `isJsonObject(value: unknown): value is JsonObject`.
  - `HOOK_EVENTS` (the twelve event names below, in order); `HOOK_TIMEOUT_S = 2`; `HOOK_SCRIPT = "clawd-hook.mjs"`; `STATUS_SCRIPT = "clawd-statusline.mjs"`; `HOOK_SCRIPTS = ["clawd-lib.mjs", "clawd-hook.mjs", "clawd-statusline.mjs"]`; `TOKEN_HEADER = "x-clawd-token"`.
  - `class SettingsShapeError extends Error` (message is the settings path that is malformed, such as `hooks.Stop`).
  - `type InstallOptions = { port: number; token: string; binDir: string; node: string }`; `type InstallResult = { settings: JsonObject; newlyWrapped: WrappedStatusLine | null; statusLine: "wrapped" | "added" | "kept"; events: readonly string[] }`.
  - `hookCommand(opts): string`; `statusCommand(opts): string`; `isOurHook(hook: unknown): boolean`; `isOurStatusLine(value: unknown): boolean`; `applyInstall(settings: JsonObject, opts: InstallOptions): InstallResult`; `applyUninstall(settings: JsonObject, wrapped: WrappedStatusLine | undefined): JsonObject`.

- [ ] **Step 1: Write the failing test**

Create `apps/agent/src/install/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, SettingsShapeError, applyInstall, applyUninstall, isOurHook, isOurStatusLine, type InstallOptions, type JsonObject } from "./settings";

const OPTS: InstallOptions = { port: 4750, token: "t".repeat(64), binDir: "C:\\Users\\me\\.clawd\\bin\\", node: "C:\\Program Files\\nodejs\\node.exe" };
const HTTP = { type: "http", url: "http://127.0.0.1:4750/ingest/hook", headers: { "x-clawd-token": OPTS.token }, timeout: 2 };
const HOOK_CMD = '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.clawd/bin/clawd-hook.mjs"';
const STATUS_CMD = '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.clawd/bin/clawd-statusline.mjs"';
const hooksOf = (settings: JsonObject): JsonObject => settings.hooks as JsonObject;

describe("applyInstall", () => {
  it("adds every modelled event and a status line to empty settings", () => {
    const r = applyInstall({}, OPTS);
    expect(Object.keys(hooksOf(r.settings))).toEqual([...HOOK_EVENTS]);
    expect(hooksOf(r.settings).SessionStart).toEqual([{ hooks: [HTTP, { type: "command", command: HOOK_CMD, timeout: 2 }] }]);
    expect(hooksOf(r.settings).PermissionRequest).toEqual([{ hooks: [HTTP] }]);
    expect(r.settings.statusLine).toEqual({ type: "command", command: STATUS_CMD });
    expect(r).toMatchObject({ newlyWrapped: null, statusLine: "added" });
    expect(HOOK_EVENTS).not.toContain("MessageDisplay");
    expect(HOOK_EVENTS).not.toContain("Notification");
  });

  it("keeps other settings and other hooks, appending its own group after them", () => {
    const settings = {
      env: { SECRET: "x" },
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        Notification: [{ hooks: [{ type: "command", command: "notify.sh" }] }],
      },
    };
    const r = applyInstall(settings, OPTS);
    expect(Object.keys(r.settings)).toEqual(["env", "permissions", "hooks", "statusLine"]);
    expect(r.settings.env).toEqual(settings.env);
    expect(hooksOf(r.settings).PreToolUse).toEqual([settings.hooks.PreToolUse[0], { hooks: [HTTP] }]);
    expect(hooksOf(r.settings).Notification).toEqual(settings.hooks.Notification);
  });

  it("is idempotent and replaces its own hooks when the port changes", () => {
    const once = applyInstall({}, OPTS).settings;
    expect(applyInstall(once, OPTS).settings).toEqual(once);
    const moved = applyInstall(once, { ...OPTS, port: 4800 }).settings;
    expect(hooksOf(moved).Stop).toEqual([{ hooks: [{ ...HTTP, url: "http://127.0.0.1:4800/ingest/hook" }] }]);
  });

  it("wraps an existing status line verbatim and keeps its other fields", () => {
    const original = { type: "command", command: "~/.claude/statusline.sh", padding: 2 };
    const r = applyInstall({ statusLine: original }, OPTS);
    expect(r).toMatchObject({ newlyWrapped: original, statusLine: "wrapped" });
    expect(r.settings.statusLine).toEqual({ type: "command", command: STATUS_CMD, padding: 2 });
    const again = applyInstall(r.settings, OPTS);
    expect(again).toMatchObject({ newlyWrapped: null, statusLine: "kept" });
    expect(again.settings.statusLine).toEqual(r.settings.statusLine);
  });

  it.each([
    [{ hooks: "x" }, "hooks"],
    [{ hooks: [] }, "hooks"],
    [{ hooks: { Stop: {} } }, "hooks.Stop"],
    [{ statusLine: "x" }, "statusLine"],
    [{ statusLine: { type: "command" } }, "statusLine.command"],
  ])("refuses malformed settings %j", (settings, where) => {
    expect(() => applyInstall(settings as JsonObject, OPTS)).toThrow(SettingsShapeError);
    expect(() => applyInstall(settings as JsonObject, OPTS)).toThrow(where);
  });
});

describe("applyUninstall", () => {
  it("restores the original settings exactly, key order included", () => {
    const original = {
      env: { A: "1" },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        Stop: [{ hooks: [{ type: "http", url: "http://127.0.0.1:4747/Stop" }] }],
      },
      statusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 1 },
    };
    const installed = applyInstall(original, OPTS);
    const restored = applyUninstall(installed.settings, installed.newlyWrapped ?? undefined);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
  });

  it("removes its status line and an emptied hooks key when nothing was wrapped", () => {
    expect(applyUninstall(applyInstall({ model: "opus" }, OPTS).settings, undefined)).toEqual({ model: "opus" });
  });

  it("changes nothing in settings that hold none of its entries", () => {
    const settings = { hooks: {}, statusLine: { type: "command", command: "mine.sh" } };
    expect(applyUninstall(settings, undefined)).toEqual(settings);
  });
});

describe("recognising its own entries", () => {
  it("matches only its own hooks and status line", () => {
    expect(isOurHook({ type: "http", url: "http://127.0.0.1:4750/ingest/hook" })).toBe(true);
    expect(isOurHook({ type: "http", url: "http://127.0.0.1:4750/ingest/hookx" })).toBe(false);
    expect(isOurHook({ type: "http", url: "http://localhost:4750/ingest/hook" })).toBe(false);
    expect(isOurHook({ type: "http", url: "http://127.0.0.1:4747/Stop" })).toBe(false);
    expect(isOurHook({ type: "command", command: '"node" "C:/x/clawd-hook.mjs"' })).toBe(true);
    expect(isOurHook({ type: "command", command: "other.mjs" })).toBe(false);
    expect(isOurHook(null)).toBe(false);
    expect(isOurStatusLine({ type: "command", command: '"node" "C:/x/clawd-statusline.mjs"' })).toBe(true);
    expect(isOurStatusLine({ type: "command", command: "mine.sh" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @clawd/agent exec vitest run src/install/settings.test.ts`
Expected: FAIL, `./settings` cannot be resolved.

- [ ] **Step 3: Write the transform**

Create `apps/agent/src/install/settings.ts`:

```ts
import type { WrappedStatusLine } from "../config";

export type JsonObject = Record<string, unknown>;

/** The events the agent models (spec §9.2). MessageDisplay and Notification carry content and change no state. */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd",
] as const;

/** Seconds. Claude Code's default is 600, which would let a hung agent stall a session. */
export const HOOK_TIMEOUT_S = 2;
export const HOOK_SCRIPT = "clawd-hook.mjs";
export const STATUS_SCRIPT = "clawd-statusline.mjs";
export const HOOK_SCRIPTS = ["clawd-lib.mjs", HOOK_SCRIPT, STATUS_SCRIPT] as const;
export const TOKEN_HEADER = "x-clawd-token";

const OUR_HOOK_URL = /^http:\/\/127\.0\.0\.1:\d+\/ingest\/hook$/;

/** Settings whose shape the installer will not guess at. The message is the path, never a value. */
export class SettingsShapeError extends Error {
  override readonly name = "SettingsShapeError";
}

export type InstallOptions = { port: number; token: string; binDir: string; node: string };
export type InstallResult = {
  settings: JsonObject;
  /** The user's status line, when this install wrapped it; null when there was none or it was already ours. */
  newlyWrapped: WrappedStatusLine | null;
  statusLine: "wrapped" | "added" | "kept";
  events: readonly string[];
};

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const forwardSlashes = (p: string): string => p.replace(/\\/g, "/");

function scriptCommand(opts: InstallOptions, script: string): string {
  return `"${forwardSlashes(opts.node)}" "${forwardSlashes(opts.binDir).replace(/\/+$/, "")}/${script}"`;
}

export const hookCommand = (opts: InstallOptions): string => scriptCommand(opts, HOOK_SCRIPT);
export const statusCommand = (opts: InstallOptions): string => scriptCommand(opts, STATUS_SCRIPT);

export function isOurHook(hook: unknown): boolean {
  if (!isJsonObject(hook)) return false;
  if (hook.type === "http") return typeof hook.url === "string" && OUR_HOOK_URL.test(hook.url);
  if (hook.type === "command") return typeof hook.command === "string" && hook.command.includes(HOOK_SCRIPT);
  return false;
}

export function isOurStatusLine(value: unknown): boolean {
  return isJsonObject(value) && typeof value.command === "string" && value.command.includes(STATUS_SCRIPT);
}

/** Remove our hooks; drop groups and events that only we filled. Anything else is left as found. */
function withoutOurHooks(hooks: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      out[event] = groups;
      continue;
    }
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const inner = (group.hooks as unknown[]).filter((hook) => !isOurHook(hook));
      if (inner.length === group.hooks.length) kept.push(group);
      else if (inner.length > 0) kept.push({ ...group, hooks: inner });
    }
    if (kept.length > 0 || groups.length === 0) out[event] = kept;
  }
  return out;
}

export function applyInstall(settings: JsonObject, opts: InstallOptions): InstallResult {
  const current = settings.hooks;
  if (current !== undefined && !isJsonObject(current)) throw new SettingsShapeError("hooks");
  const hooks = withoutOurHooks(current ?? {});
  const http = { type: "http", url: `http://127.0.0.1:${opts.port}/ingest/hook`, headers: { [TOKEN_HEADER]: opts.token }, timeout: HOOK_TIMEOUT_S };
  for (const event of HOOK_EVENTS) {
    const existing = hooks[event];
    if (existing !== undefined && !Array.isArray(existing)) throw new SettingsShapeError(`hooks.${event}`);
    const groups: unknown[] = Array.isArray(existing) ? existing : [];
    const ours = event === "SessionStart" ? [http, { type: "command", command: hookCommand(opts), timeout: HOOK_TIMEOUT_S }] : [http];
    hooks[event] = [...groups, { hooks: ours }];
  }

  const line = settings.statusLine;
  if (line !== undefined && !isJsonObject(line)) throw new SettingsShapeError("statusLine");
  let newlyWrapped: WrappedStatusLine | null = null;
  let statusLine: InstallResult["statusLine"] = "added";
  if (isJsonObject(line)) {
    if (isOurStatusLine(line)) {
      statusLine = "kept";
    } else {
      if (typeof line.command !== "string" || line.command.length === 0) throw new SettingsShapeError("statusLine.command");
      newlyWrapped = { ...line, command: line.command };
      statusLine = "wrapped";
    }
  }
  const nextStatusLine = { ...(isJsonObject(line) ? line : {}), type: "command", command: statusCommand(opts) };
  return { settings: { ...settings, hooks, statusLine: nextStatusLine }, newlyWrapped, statusLine, events: HOOK_EVENTS };
}

export function applyUninstall(settings: JsonObject, wrapped: WrappedStatusLine | undefined): JsonObject {
  const out: JsonObject = { ...settings };
  if (settings.hooks !== undefined) {
    if (!isJsonObject(settings.hooks)) throw new SettingsShapeError("hooks");
    const hooks = withoutOurHooks(settings.hooks);
    if (Object.keys(hooks).length === 0 && Object.keys(settings.hooks).length > 0) delete out.hooks;
    else out.hooks = hooks;
  }
  if (isOurStatusLine(settings.statusLine)) {
    if (wrapped) out.statusLine = wrapped;
    else delete out.statusLine;
  }
  return out;
}
```

- [ ] **Step 4: Run the test and typecheck**

Run: `pnpm --filter @clawd/agent exec vitest run src/install/settings.test.ts`
Expected: PASS.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/install/settings.ts apps/agent/src/install/settings.test.ts
git commit -m "feat(agent): pure settings transform that installs and removes exactly its own hooks"
```

---

### Task 13: Installer and the install and uninstall commands

**Files:**
- Create: `apps/agent/src/install/installer.ts`
- Modify: `apps/agent/src/cli.ts` (replace the whole file)
- Modify: `apps/agent/src/main.ts` (replace the whole file)
- Test: `apps/agent/src/install/installer.test.ts`, `apps/agent/src/cli.test.ts`

**Interfaces:**
- Consumes: `agentPaths`, `defaultConfig`, `readConfig`, `saveConfig`, `ConfigError`, `defaultHome`, `defaultSettingsPath`, `AgentConfig` (Task 2); `readJsonFile`, `writeJsonAtomic`, `isErrno` (Task 2); `fileStamp` (Task 2); `applyInstall`, `applyUninstall`, `HOOK_SCRIPTS`, `SettingsShapeError`, `isJsonObject`, `InstallResult`, `JsonObject` (Task 12); `startAgent` (Task 10); from `@clawd/core`: `normalisePath`.
- Produces:
  - `type Print = (line: string) => void`; `type InstallRequest = { home: string; settingsPath: string; allow: readonly string[]; port?: number; dryRun: boolean; hooksDir: string; cwd: string; node: string; now: () => number; print: Print; probe?: (port: number) => Promise<boolean> }`; `type UninstallRequest = { home: string; settingsPath: string; now: () => number; print: Print }`.
  - `mergeAllowlist(existing: readonly string[], additions: readonly string[], cwd: string): { ok: true; allowlist: string[] } | { ok: false; message: string }`; `probeAgent(port: number, timeoutMs?: number): Promise<boolean>`; `install(req): Promise<number>`; `uninstall(req): Promise<number>` (both return a process exit code).
  - `type CliEnv = { serve: () => Promise<number>; home: string; settingsPath: string; cwd: string; node: string; hooksDir: string; now: () => number; print: Print; printError: Print; probe?: (port: number) => Promise<boolean> }`; `USAGE`; `runCli(argv, env): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/agent/src/install/installer.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentPaths, defaultConfig, readConfig, saveConfig } from "../config";
import { useTempDirs } from "../testing/tmp";
import { install, mergeAllowlist, uninstall } from "./installer";
import { HOOK_SCRIPTS, type JsonObject } from "./settings";

const HOOKS = fileURLToPath(new URL("../../hooks/", import.meta.url));
const NOW = Date.UTC(2026, 8, 12, 10, 0, 0);

describe("mergeAllowlist", () => {
  it("resolves against the working directory and does not repeat a directory", () => {
    const cwd = process.platform === "win32" ? "C:\\base" : "/base";
    const r = mergeAllowlist([join(cwd, "a")], ["a", "b", join(cwd, "B").toUpperCase()], cwd);
    expect(r).toEqual({ ok: true, allowlist: [join(cwd, "a"), join(cwd, "b")] });
  });

  it("refuses blanks, roots and an empty result", () => {
    const cwd = process.platform === "win32" ? "C:\\base" : "/base";
    expect(mergeAllowlist([], ["  "], cwd)).toMatchObject({ ok: false });
    expect(mergeAllowlist([], [parse(cwd).root], cwd)).toMatchObject({ ok: false });
    const empty = mergeAllowlist([], [], cwd);
    expect(empty).toMatchObject({ ok: false });
    expect(empty.ok ? "" : empty.message).toContain("--allow");
  });
});

describe("install and uninstall", () => {
  const tempDir = useTempDirs();

  async function setup(settings?: string) {
    const root = await tempDir();
    const home = join(root, "clawd");
    const settingsPath = join(root, "claude", "settings.json");
    await mkdir(join(root, "work"));
    if (settings !== undefined) {
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, settings);
    }
    const lines: string[] = [];
    const base = {
      home,
      settingsPath,
      hooksDir: HOOKS,
      cwd: root,
      node: "C:\\node\\node.exe",
      now: () => NOW,
      print: (line: string) => lines.push(line),
      probe: async () => false,
    };
    return { root, home, settingsPath, lines, base };
  }

  const readJson = async (path: string): Promise<JsonObject> => JSON.parse(await readFile(path, "utf8")) as JsonObject;

  it("installs into a machine with no settings and no agent home", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(0);
    const config = await readConfig(agentPaths(t.home));
    expect(config?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(config?.allowlist).toEqual([join(t.root, "work")]);
    const settings = await readJson(t.settingsPath);
    const stop = (settings.hooks as JsonObject).Stop as { hooks: { headers: Record<string, string> }[] }[];
    expect(stop[0]?.hooks[0]?.headers["x-clawd-token"]).toBe(config?.token);
    expect((await readdir(join(t.home, "bin"))).sort()).toEqual([...HOOK_SCRIPTS].sort());
    expect(await readdir(dirname(t.settingsPath))).toEqual(["settings.json"]);
    expect(t.lines.join("\n")).toContain("start the agent");
    expect(t.lines.join("\n")).not.toContain(config?.token ?? "no token");
  });

  it("backs up existing settings byte for byte, wraps the status line and prints no settings content", async () => {
    const original = '{\n    "env": { "API_KEY": "SECRET-VALUE" },\n    "statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "padding": 0 }\n}\n';
    const t = await setup(original);
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(0);
    expect(await readFile(`${t.settingsPath}.clawd-backup-20260912100000`, "utf8")).toBe(original);
    const config = await readConfig(agentPaths(t.home));
    expect(config?.wrappedStatusLine).toEqual({ type: "command", command: "~/.claude/statusline.sh", padding: 0 });
    const settings = await readJson(t.settingsPath);
    expect(settings.env).toEqual({ API_KEY: "SECRET-VALUE" });
    expect(t.lines.join("\n")).not.toContain("SECRET-VALUE");
  });

  it.each([
    ["not JSON", "{ nope"],
    ["not an object", "[1, 2]"],
    ["a malformed hooks entry", '{"hooks": {"Stop": {}}}'],
  ])("changes nothing when the settings file is %s", async (_label, text) => {
    const t = await setup(text);
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(1);
    expect(await readFile(t.settingsPath, "utf8")).toBe(text);
    expect(existsSync(t.home)).toBe(false);
    expect(await readdir(dirname(t.settingsPath))).toEqual(["settings.json"]);
  });

  it("writes nothing on a dry run", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: ["work"], dryRun: true })).toBe(0);
    expect(existsSync(t.home)).toBe(false);
    expect(existsSync(t.settingsPath)).toBe(false);
    expect(t.lines.every((line) => line.startsWith("dry run"))).toBe(true);
  });

  it("refuses to install with no allowlist", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(1);
    expect(t.lines.join("\n")).toContain("--allow");
    expect(existsSync(t.settingsPath)).toBe(false);
  });

  it("keeps an existing token and gives each backup its own name", async () => {
    const t = await setup("{}");
    const existing = { ...defaultConfig("f".repeat(64)), allowlist: [join(t.root, "work")] };
    await saveConfig(agentPaths(t.home), existing);
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    const first = await readFile(t.settingsPath, "utf8");
    expect(first).toContain("f".repeat(64));
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    expect(await readFile(t.settingsPath, "utf8")).toBe(first);
    expect((await readdir(dirname(t.settingsPath))).sort()).toEqual([
      "settings.json",
      "settings.json.clawd-backup-20260912100000",
      "settings.json.clawd-backup-20260912100000-2",
    ]);
  });

  it("tells the user to restart an agent that is already running", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: ["work"], dryRun: false, probe: async () => true })).toBe(0);
    expect(t.lines.join("\n")).toContain("restart");
  });

  it("uninstall restores the original settings and forgets the wrapped status line", async () => {
    const original = { env: { A: "1" }, statusLine: { type: "command", command: "mine.sh" } };
    const t = await setup(JSON.stringify(original));
    await install({ ...t.base, allow: ["work"], dryRun: false });
    expect(await uninstall({ home: t.home, settingsPath: t.settingsPath, now: () => NOW + 1_000, print: t.base.print })).toBe(0);
    expect(await readJson(t.settingsPath)).toEqual(original);
    expect((await readConfig(agentPaths(t.home)))?.wrappedStatusLine).toBeUndefined();
    expect(existsSync(t.home)).toBe(true);
  });

  it("uninstall changes nothing when there is nothing to remove", async () => {
    const missing = await setup();
    expect(await uninstall({ home: missing.home, settingsPath: missing.settingsPath, now: () => NOW, print: missing.base.print })).toBe(0);
    const clean = await setup('{"model":"opus"}');
    expect(await uninstall({ home: clean.home, settingsPath: clean.settingsPath, now: () => NOW, print: clean.base.print })).toBe(0);
    expect(await readdir(dirname(clean.settingsPath))).toEqual(["settings.json"]);
  });
});
```

Create `apps/agent/src/cli.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { USAGE, runCli, type CliEnv } from "./cli";
import { useTempDirs } from "./testing/tmp";

const HOOKS = fileURLToPath(new URL("../hooks/", import.meta.url));

describe("runCli", () => {
  const tempDir = useTempDirs();

  async function env(over: Partial<CliEnv> = {}) {
    const root = await tempDir();
    await mkdir(join(root, "work"));
    const out: string[] = [];
    const err: string[] = [];
    const e: CliEnv = {
      serve: vi.fn(async () => 0),
      home: join(root, "clawd"),
      settingsPath: join(root, "claude", "settings.json"),
      cwd: root,
      node: process.execPath,
      hooksDir: HOOKS,
      now: () => 0,
      print: (l) => out.push(l),
      printError: (l) => err.push(l),
      probe: async () => false,
      ...over,
    };
    return { root, e, out, err };
  }

  it("serves", async () => {
    const t = await env();
    expect(await runCli(["serve"], t.e)).toBe(0);
    expect(t.e.serve).toHaveBeenCalled();
  });

  it.each([[[]], [["nope"]], [["serve", "extra"]], [["install", "--bogus"]], [["install", "--port", "abc"]], [["install", "--port", "70000"]], [["uninstall", "stray"]]])(
    "prints usage and exits 2 for %j",
    async (argv) => {
      const t = await env();
      expect(await runCli(argv, t.e)).toBe(2);
      expect(t.err).toEqual([USAGE]);
    },
  );

  it("installs to the given settings path, resolving --allow against the invoking directory, then uninstalls", async () => {
    const t = await env();
    const custom = join(t.root, "custom", "settings.json");
    expect(await runCli(["install", "--allow", "work", "--port", "4799", "--settings", custom], t.e)).toBe(0);
    expect(existsSync(custom)).toBe(true);
    expect(await runCli(["uninstall", "--settings", custom], t.e)).toBe(0);
  });

  it("reports an invalid config and exits 1", async () => {
    const t = await env();
    await mkdir(t.e.home, { recursive: true });
    await writeFile(join(t.e.home, "config.json"), '{"version":2}');
    expect(await runCli(["install", "--allow", "work"], t.e)).toBe(1);
    expect(t.err.join("\n")).toContain("invalid");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @clawd/agent exec vitest run src/install/installer.test.ts src/cli.test.ts`
Expected: FAIL, `./installer` cannot be resolved and `runCli` lacks the install command.

- [ ] **Step 3: Write the installer, the CLI and the entry point**

Create `apps/agent/src/install/installer.ts`:

```ts
import { normalisePath } from "@clawd/core";
import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { request } from "node:http";
import { join, parse, resolve } from "node:path";
import { agentPaths, defaultConfig, readConfig, saveConfig, type AgentConfig } from "../config";
import { isErrno, readJsonFile, writeJsonAtomic } from "../json-file";
import { fileStamp } from "../stamp";
import { HOOK_SCRIPTS, SettingsShapeError, applyInstall, applyUninstall, isJsonObject, type InstallResult, type JsonObject } from "./settings";

export type Print = (line: string) => void;

export type InstallRequest = {
  home: string;
  settingsPath: string;
  allow: readonly string[];
  port?: number;
  dryRun: boolean;
  /** Where the hook scripts are copied from: apps/agent/hooks. */
  hooksDir: string;
  /** The directory the command was typed in, for relative --allow values. */
  cwd: string;
  /** Absolute path of the Node binary the hook commands will run. */
  node: string;
  now: () => number;
  print: Print;
  probe?: (port: number) => Promise<boolean>;
};

export type UninstallRequest = { home: string; settingsPath: string; now: () => number; print: Print };

export function mergeAllowlist(existing: readonly string[], additions: readonly string[], cwd: string): { ok: true; allowlist: string[] } | { ok: false; message: string } {
  const merged = [...existing];
  for (const raw of additions) {
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: false, message: "an --allow directory is blank" };
    const dir = resolve(cwd, trimmed);
    if (parse(dir).root === dir) return { ok: false, message: `refusing to allow a whole filesystem root: ${dir}` };
    if (!merged.some((d) => normalisePath(d) === normalisePath(dir))) merged.push(dir);
  }
  if (merged.length === 0) return { ok: false, message: "the allowlist is empty; pass --allow <dir> for each directory whose sessions should appear" };
  return { ok: true, allowlist: merged };
}

/** True when something answers GET /api/health on the port within the timeout. */
export function probeAgent(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((done) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
    req.end();
  });
}

type SettingsRead = { kind: "missing" } | { kind: "invalid" } | { kind: "ok"; value: JsonObject };

async function readSettings(path: string): Promise<SettingsRead> {
  const file = await readJsonFile(path);
  if (!file.found) return { kind: "missing" };
  return file.ok && isJsonObject(file.value) ? { kind: "ok", value: file.value } : { kind: "invalid" };
}

/** Copy the file beside itself under a name no earlier backup has taken. */
async function backup(path: string, now: number): Promise<string> {
  const base = `${path}.clawd-backup-${fileStamp(now)}`;
  for (let n = 1; ; n++) {
    const target = n === 1 ? base : `${base}-${n}`;
    try {
      await copyFile(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (err) {
      if (!isErrno(err, "EEXIST")) throw err;
    }
  }
}

const STATUS_WORDS: Record<InstallResult["statusLine"], string> = {
  wrapped: "wrap the existing status line",
  added: "add a status line",
  kept: "keep the Clawd status line already installed",
};

const STATUS_DONE: Record<InstallResult["statusLine"], string> = {
  wrapped: "wrapped the existing status line",
  added: "added a status line",
  kept: "kept the Clawd status line already installed",
};

export async function install(req: InstallRequest): Promise<number> {
  const paths = agentPaths(req.home);
  const base: AgentConfig = (await readConfig(paths)) ?? defaultConfig();
  const allow = mergeAllowlist(base.allowlist, req.allow, req.cwd);
  if (!allow.ok) {
    req.print(allow.message);
    return 1;
  }
  const port = req.port ?? base.port;
  const read = await readSettings(req.settingsPath);
  if (read.kind === "invalid") {
    req.print(`${req.settingsPath} is not a JSON object; nothing was changed`);
    return 1;
  }
  let result: InstallResult;
  try {
    result = applyInstall(read.kind === "ok" ? read.value : {}, { port, token: base.token, binDir: paths.bin, node: req.node });
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    req.print(`${req.settingsPath} has an unexpected shape at ${err.message}; nothing was changed`);
    return 1;
  }

  if (req.dryRun) {
    req.print(`dry run: would add hooks to ${req.settingsPath} for ${result.events.join(", ")}`);
    req.print(`dry run: would ${STATUS_WORDS[result.statusLine]}`);
    req.print(`dry run: the allowlist would be ${allow.allowlist.join(", ")}`);
    return 0;
  }

  await mkdir(paths.bin, { recursive: true });
  for (const script of HOOK_SCRIPTS) await copyFile(join(req.hooksDir, script), join(paths.bin, script));
  const wrapped = result.newlyWrapped ?? base.wrappedStatusLine;
  // The config goes first, so the token the new hooks carry is on disk before the hooks exist.
  await saveConfig(paths, { ...base, port, allowlist: allow.allowlist, ...(wrapped ? { wrappedStatusLine: wrapped } : {}) });
  const saved = read.kind === "ok" ? await backup(req.settingsPath, req.now()) : null;
  await writeJsonAtomic(req.settingsPath, result.settings);

  req.print(`installed the Clawd hooks into ${req.settingsPath}; ${STATUS_DONE[result.statusLine]}`);
  req.print(saved ? `backup of the previous settings: ${saved}` : "there were no previous settings to back up");
  req.print(`allowlist: ${allow.allowlist.join(", ")}`);
  const running = await (req.probe ?? probeAgent)(port);
  req.print(running ? `an agent is running on port ${port}; restart it to pick up these changes` : "start the agent with: pnpm --filter @clawd/agent start");
  return 0;
}

export async function uninstall(req: UninstallRequest): Promise<number> {
  const paths = agentPaths(req.home);
  const config = await readConfig(paths);
  const read = await readSettings(req.settingsPath);
  if (read.kind === "missing") {
    req.print(`${req.settingsPath} does not exist; nothing to uninstall`);
    return 0;
  }
  if (read.kind === "invalid") {
    req.print(`${req.settingsPath} is not a JSON object; nothing was changed`);
    return 1;
  }
  let next: JsonObject;
  try {
    next = applyUninstall(read.value, config?.wrappedStatusLine);
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    req.print(`${req.settingsPath} has an unexpected shape at ${err.message}; nothing was changed`);
    return 1;
  }
  if (JSON.stringify(next) === JSON.stringify(read.value)) {
    req.print("no Clawd hooks or status line were found; nothing was changed");
    return 0;
  }
  const saved = await backup(req.settingsPath, req.now());
  await writeJsonAtomic(req.settingsPath, next);
  if (config?.wrappedStatusLine) {
    const { wrappedStatusLine: _wrapped, ...rest } = config;
    await saveConfig(paths, rest);
  }
  req.print(`removed the Clawd hooks from ${req.settingsPath}`);
  req.print(`backup of the previous settings: ${saved}`);
  req.print(`${paths.home} was left in place`);
  return 0;
}
```

Replace `apps/agent/src/cli.ts` with:

```ts
import { parseArgs } from "node:util";
import { ConfigError } from "./config";
import { install, uninstall, type Print } from "./install/installer";

export type CliEnv = {
  serve: () => Promise<number>;
  home: string;
  settingsPath: string;
  /** The directory the command was typed in. */
  cwd: string;
  node: string;
  hooksDir: string;
  now: () => number;
  print: Print;
  printError: Print;
  probe?: (port: number) => Promise<boolean>;
};

export const USAGE = [
  "usage: agent serve",
  "       agent install --allow <dir> [--allow <dir> ...] [--port <n>] [--settings <path>] [--dry-run]",
  "       agent uninstall [--settings <path>]",
].join("\n");

function usage(env: CliEnv): number {
  env.printError(USAGE);
  return 2;
}

function isParseArgsError(err: unknown): boolean {
  return err instanceof TypeError && String((err as { code?: unknown }).code ?? "").startsWith("ERR_PARSE_ARGS");
}

export async function runCli(argv: readonly string[], env: CliEnv): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "serve":
        return rest.length === 0 ? await env.serve() : usage(env);
      case "install": {
        const { values } = parseArgs({
          args: rest,
          options: { allow: { type: "string", multiple: true }, port: { type: "string" }, settings: { type: "string" }, "dry-run": { type: "boolean" } },
          strict: true,
          allowPositionals: false,
        });
        const port = values.port === undefined ? undefined : Number(values.port);
        if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65_535)) return usage(env);
        return await install({
          home: env.home,
          settingsPath: values.settings ?? env.settingsPath,
          allow: values.allow ?? [],
          ...(port !== undefined ? { port } : {}),
          dryRun: values["dry-run"] ?? false,
          hooksDir: env.hooksDir,
          cwd: env.cwd,
          node: env.node,
          now: env.now,
          print: env.print,
          ...(env.probe ? { probe: env.probe } : {}),
        });
      }
      case "uninstall": {
        const { values } = parseArgs({ args: rest, options: { settings: { type: "string" } }, strict: true, allowPositionals: false });
        return await uninstall({ home: env.home, settingsPath: values.settings ?? env.settingsPath, now: env.now, print: env.print });
      }
      default:
        return usage(env);
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      env.printError(err.message);
      return 1;
    }
    if (isParseArgsError(err)) return usage(env);
    throw err;
  }
}
```

Replace `apps/agent/src/main.ts` with:

```ts
import { fileURLToPath } from "node:url";
import { startAgent } from "./agent";
import { runCli } from "./cli";
import { ConfigError, defaultHome, defaultSettingsPath } from "./config";
import { isErrno } from "./json-file";

const HOOKS_DIR = fileURLToPath(new URL("../hooks/", import.meta.url));

async function serve(): Promise<number> {
  let agent;
  try {
    agent = await startAgent({ home: defaultHome() });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    if (isErrno(err, "EADDRINUSE")) {
      process.stderr.write("the agent's port is already in use; is another agent running?\n");
      return 1;
    }
    throw err;
  }
  process.stderr.write(`clawd agent listening on http://127.0.0.1:${agent.port}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await agent.stop();
  return 0;
}

runCli(process.argv.slice(2), {
  serve,
  home: defaultHome(),
  settingsPath: defaultSettingsPath(),
  // pnpm runs package scripts inside apps/agent; INIT_CWD is where the command was typed.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  node: process.execPath,
  hooksDir: HOOKS_DIR,
  now: Date.now,
  print: (line) => process.stdout.write(`${line}\n`),
  printError: (line) => process.stderr.write(`${line}\n`),
}).then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @clawd/agent test`
Expected: PASS.

Run: `pnpm --filter @clawd/agent typecheck`
Expected: exit 0.

- [ ] **Step 5: Dry-run the real command without writing anything**

Run: `pnpm --filter @clawd/agent agent install --allow . --settings "$env:TEMP\clawd-dry-settings.json" --dry-run`
Expected: exit 0 and three lines starting `dry run:`; the allowlist line shows the worktree root (because of `INIT_CWD`), not `apps/agent`. Nothing is written: `Test-Path "$env:TEMP\clawd-dry-settings.json"` prints `False`. Do not run install without `--dry-run` against `~/.claude/settings.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/install apps/agent/src/cli.ts apps/agent/src/cli.test.ts apps/agent/src/main.ts
git commit -m "feat(agent): install and uninstall commands with backups, dry run and a running-agent check"
```

---

### Task 14: Documentation

**Files:**
- Create: `apps/agent/README.md`
- Modify: `README.md` (root)
- Modify: `docs/superpowers/specs/2026-09-12-local-agent-design.md` (§3 layout only)

**Interfaces:**
- Consumes: the finished package.
- Produces: user-facing docs. No code.

- [ ] **Step 1: Write the agent README**

Create `apps/agent/README.md`:

````markdown
# @clawd/agent

The local agent. It receives Claude Code's hooks and status line, strips everything but state,
activity and timing at the door, and serves the snapshot the web app draws. It listens on
`127.0.0.1:4750` only.

Design: `docs/superpowers/specs/2026-09-12-local-agent-design.md`.

## Install the hooks

The installer adds the agent's hooks to `~/.claude/settings.json` (or the file under
`CLAUDE_CONFIG_DIR`) and wraps any status line you already have. It backs the file up first.
User-level hooks fire for every session on the machine, so it also needs the directories whose
sessions you want to see; anything else is dropped at ingest.

```
pnpm --filter @clawd/agent agent install --allow C:\path\to\repos --dry-run
pnpm --filter @clawd/agent agent install --allow C:\path\to\repos
```

Relative `--allow` paths resolve against the directory you typed the command in. Run it again to
add directories; the token is kept. To remove the hooks and restore your status line:

```
pnpm --filter @clawd/agent agent uninstall
```

## Run

```
pnpm --filter @clawd/agent start
```

Restart the agent after changing the allowlist. If Node moves (a version manager, an upgrade), run
install again so the hook commands point at it.

## Endpoints

| Route | What it returns |
| --- | --- |
| `GET /api/snapshot` | the current snapshot |
| `GET /api/stream` | SSE: `snapshot` events (at most four a second) and `ticker` events |
| `GET /api/ticker/:alias` | the last 200 ticker lines for a session |
| `POST /api/command` | `{"type":"focus","alias":"agent-1"}` raises that session's window (Windows); `202` |
| `GET /api/health` | `{ ok, version, sessions }` |

Browsers may call these only from an origin in `corsOrigins`. `/ingest/hook` and `/ingest/status`
are for the hook scripts and need the token from `config.json`.

## Files

`~/.clawd` (or `CLAWD_HOME`):

| File | What it holds |
| --- | --- |
| `config.json` | port, allowlist, token, CORS origins, poll interval, the wrapped status line |
| `aliases.json` | session and pane aliases, so names survive a restart |
| `logs/events-YYYY-MM-DD.jsonl` | the redacted event log, kept seven days; replayable with core's fixture loader |
| `bin/*.mjs` | the hook scripts the settings point at |

## Privacy

Raw payloads live in memory for one request. Prompts, tool input and output, assistant text,
transcript paths, session names and working directories never reach the log, the alias file, any
response or the stream; every outgoing body is checked before it is written, and operational logs
carry codes and numbers only. `src/agent.e2e.test.ts` proves it with canary payloads.

To run the same check over the raw spike recordings, which never leave your machine:

```
$env:CLAWD_SPIKE_DIR = "C:\path\to\tools\hook-spike"; pnpm --filter @clawd/agent exec vitest run src/agent.recordings.test.ts
```

## Develop

```
pnpm --filter @clawd/agent test
pnpm --filter @clawd/agent typecheck
```
````

- [ ] **Step 2: Update the root README**

In `README.md`, add this row to the Layout table after the `apps/web` row:

```markdown
| `apps/agent` | The local agent: hook and status line receivers, redaction at ingest, presence polling, snapshot and ticker streams, the settings installer and Windows window focus. See its README. |
```

Replace the line `The local agent (`apps/agent`) arrives with milestone B1.` with:

```markdown
To see real sessions, install the agent's hooks and start it; see [apps/agent/README.md](apps/agent/README.md).
```

- [ ] **Step 3: Align the spec's layout with the code**

In `docs/superpowers/specs/2026-09-12-local-agent-design.md` §3, replace the `src/` part of the layout block so it lists what was built: add `cli.ts` (argument handling), `stamp.ts` (backup file names) and `testing/` (test-only helpers), add `clawd-lib.mjs` under `hooks/`, and change `main.ts` to "entry point: wires the CLI to the real process". In §11, replace the last paragraph's `createAgent({ home, port, now, exec, spawn })` returning `{ start, stop }` with `startAgent({ home, port, now, log, exec, runFocus, platform, stateConfig, tickMs })`, which resolves to `{ port, stop() }` once listening. Change nothing else in the spec.

- [ ] **Step 4: Run the full checks**

Run: `pnpm --filter @clawd/agent test` and `pnpm --filter @clawd/agent typecheck`
Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/README.md README.md docs/superpowers/specs/2026-09-12-local-agent-design.md
git commit -m "docs(agent): agent README, root layout and spec layout"
```

---

## Final verification (controller, after all tasks)

1. `pnpm -r test` and `pnpm -r typecheck` from the worktree root: every package passes, including `@clawd/core` unchanged (`git diff main -- packages/core` is empty).
2. Run the recordings suite against the raw spike recordings in the main checkout: `$env:CLAWD_SPIKE_DIR = "C:\mw\visualiser\tools\hook-spike"; pnpm --filter @clawd/agent exec vitest run src/agent.recordings.test.ts` — expected PASS with no leaks.
3. Live smoke on a temp home, without touching `~/.claude/settings.json`: write a temp `config.json` with the allowlist set to the parent of the worktrees, start the agent with `CLAWD_HOME` pointing at it, confirm `/api/snapshot` lists the live sessions from the real `claude agents --json` poll as idle, then POST a focus command for one alias and note whether the window came forward. Stop the agent.

