# Session Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave dormant sessions out of the snapshot by prompt count and quiet time, with prompt counts read from transcripts.

**Architecture:** Core gains a prompt count and a last-active time per session, a `history` redacted event that raises the count, and an `isShown` rule that `deriveSnapshot` applies. The agent's poller reads each listed session's transcript once per run and ingests a `history` event. The snapshot format does not change.

**Tech Stack:** TypeScript, zod 4, vitest, pnpm workspaces (`@clawd/core`, `@clawd/agent`).

**Spec:** `docs/superpowers/specs/2026-09-13-session-visibility-design.md`

## Global Constraints

- Limits: `oneShotHideMs` = 3 hours, `fewPromptsHideMs` = 24 hours, `fewPrompts` = 8.
- Working and waiting sessions are always shown; sessions with no prompts are never shown.
- A typed prompt is a transcript line with `type: "user"`, `origin.kind: "human"`, and neither `isMeta` nor `isSidechain` true.
- Only a count and a modified time leave the transcript reader. No path, content or error is logged or served.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Run package tests from the package directory: `npx vitest run <file>`. Whole repo: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`.

---

### Task 1: Prompt count, last activity and the `history` event

**Files:**
- Modify: `packages/core/src/schema/events.ts`
- Modify: `packages/core/src/state/session.ts`
- Modify: `packages/core/src/state/fleet.ts`
- Modify: `packages/core/src/state/ticker.ts`
- Test: `packages/core/src/schema/events.test.ts`, `packages/core/src/state/session.test.ts`, `packages/core/src/state/fleet.test.ts`, `packages/core/src/state/ticker.test.ts`

**Interfaces:**
- Produces: `RedactedEvent` kind `history` with `prompts: number`; `SessionState.prompts: number`; `SessionState.lastActiveAt: number`.

- [ ] **Step 1: Write the failing tests**

`events.test.ts`, add to the accepted list and add a bounds test:

```ts
      { ...base, kind: "history", prompts: 12 },
```

```ts
  it("takes a transcript count only as a whole, non-negative number", () => {
    expect(() => RedactedEventSchema.parse({ ...base, kind: "history" })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "history", prompts: -1 })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "history", prompts: 2.5 })).toThrow();
  });
```

`session.test.ts`, append:

```ts
describe("prompts and activity", () => {
  it("starts with no prompts, last active when it went idle", () => {
    expect(newSession("s1", "k1", T0)).toMatchObject({ prompts: 0, lastActiveAt: T0 });
    expect(newSession("s1", "k1", T0, T0 - 5_000)).toMatchObject({ prompts: 0, lastActiveAt: T0 - 5_000 });
  });

  it("counts prompts and dates activity by what the session did, not by its start, status or presence", () => {
    let s = run([ev("prompt", T0 + 10), ev("tool.start", T0 + 20, { tool: "Read", category: "read", toolUseId: "u1" }), ev("stop", T0 + 30, { backgroundTasks: 0 })]);
    expect(s).toMatchObject({ prompts: 1, lastActiveAt: T0 + 30 });
    s = run([ev("status", T0 + 40, { contextPct: 5 }), ev("presence", T0 + 50, { alive: true }), ev("session.start", T0 + 60, {})], s);
    expect(s.lastActiveAt).toBe(T0 + 30);
    s = run([ev("prompt", T0 + 70)], s);
    expect(s).toMatchObject({ prompts: 2, lastActiveAt: T0 + 70 });
  });

  it("raises the count to a transcript's without treating it as an event, and never lowers it", () => {
    const s = run([ev("prompt", T0 + 10), ev("stop", T0 + 20, { backgroundTasks: 0 })]);
    const raised = run([ev("history", T0 + 99, { prompts: 12 })], s);
    expect(raised).toEqual({ ...s, prompts: 12 });
    expect(run([ev("history", T0 + 120, { prompts: 3 })], raised)).toBe(raised);
  });
});
```

`fleet.test.ts`, add:

```ts
  it("ignores a transcript count for a session it has never seen", () => {
    expect(reduceFleet(emptyFleet(), event("history", T0, { prompts: 3 }, { sessionId: "ghost", paneKey: "k1" }), T0, DEFAULT_CONFIG)).toEqual(emptyFleet());
  });
```

`ticker.test.ts`, in the "emits nothing" test:

```ts
    expect(toTickerEvents(event("history", T0, { prompts: 3 }), s, { ...s, prompts: 3 })).toEqual([]);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/schema/events.test.ts src/state/session.test.ts src/state/fleet.test.ts src/state/ticker.test.ts`
Expected: FAIL. The schema rejects `history`; sessions have no `prompts` or `lastActiveAt`; the fleet creates a ghost session.

- [ ] **Step 3: Implement**

`events.ts`, after the `presence` member:

```ts
  // A session's typed prompt count from its transcript, read by the agent once per session per run.
  // It can raise the session's count, never lower it, and describes a session rather than creating one.
  z.object({ ...base, kind: z.literal("history"), prompts: z.number().int().nonnegative() }).strict(),
```

`session.ts`, add to `SessionState` after `contextPct`:

```ts
  /** Typed prompts: one per prompt event, raised to the transcript's count by a `history` event. */
  prompts: number;
  /** When the session last did something: a prompt, a tool call, a permission request or denial, a stop, a subagent change. */
  lastActiveAt: number;
```

In `newSession`, after `contextPct: null,`:

```ts
    prompts: 0,
    lastActiveAt: Math.min(since, now),
```

Before `reduceSession`:

```ts
/** Events that mean the session did something. A start, an end, a presence poll or a status line does not. */
const ACTIVE: ReadonlySet<RedactedEvent["kind"]> = new Set(["prompt", "tool.start", "tool.end", "permission.request", "permission.denied", "stop", "subagent.start", "subagent.stop"]);
```

The head of `reduceSession` and its `prompt` case:

```ts
  if (prev.state === "done") return prev;
  // A transcript count is not something the session did: lastEventAt, activity and state stay as they are.
  if (e.kind === "history") return e.prompts > prev.prompts ? { ...prev, prompts: e.prompts } : prev;
  let s: SessionState = { ...prev, lastEventAt: now, ...(ACTIVE.has(e.kind) ? { lastActiveAt: Math.max(prev.lastActiveAt, now) } : {}) };
```

```ts
    case "prompt":
      return settle(transition(endWait({ ...s, prompts: s.prompts + 1 }), "working", now, cfg));
```

`fleet.ts`, replace `endsSession` and its use:

```ts
/** An event that only ends or describes a session says nothing about one we have never seen. */
const createsNothing = (e: RedactedEvent): boolean => e.kind === "session.end" || e.kind === "history" || (e.kind === "presence" && !e.alive);
```

```ts
  if (!existing && createsNothing(e)) return f;
```

`ticker.ts`:

```ts
    case "presence":
    case "history":
      return null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: PASS, apart from golden snapshot tests if any frame changed (none should in this task).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema/events.ts packages/core/src/schema/events.test.ts packages/core/src/state/session.ts packages/core/src/state/session.test.ts packages/core/src/state/fleet.ts packages/core/src/state/fleet.test.ts packages/core/src/state/ticker.ts packages/core/src/state/ticker.test.ts
git commit -m "feat(core): sessions count prompts and date their last activity, and a history event raises the count"
```

### Task 2: The visibility rule in the snapshot

**Files:**
- Modify: `packages/core/src/state/config.ts`
- Create: `packages/core/src/state/visibility.ts`, `packages/core/src/state/visibility.test.ts`
- Modify: `packages/core/src/state/snapshot.ts`, `packages/core/src/state/snapshot.test.ts`, `packages/core/src/state/index.ts`
- Regenerate: `packages/core/src/fixtures/golden/*.json`
- Docs: `docs/superpowers/specs/2026-09-12-core-contract-design.md`, `docs/PRD.md`

**Interfaces:**
- Consumes: `SessionState.prompts`, `SessionState.lastActiveAt` (Task 1).
- Produces: `StateConfig.oneShotHideMs`, `StateConfig.fewPromptsHideMs`, `StateConfig.fewPrompts`; `isShown(s: SessionState, now: number, cfg: StateConfig): boolean`; `deriveSnapshot(f, aliases, now, cfg = DEFAULT_CONFIG)`.

- [ ] **Step 1: Write the failing tests**

`visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { T0 } from "../testing/events";
import { DEFAULT_CONFIG } from "./config";
import { newSession, type SessionState } from "./session";
import { isShown } from "./visibility";

const HOUR = 3_600_000;
const quiet = (prompts: number, over: Partial<SessionState> = {}): SessionState => ({ ...newSession("s1", "k1", T0), state: "asleep", prompts, lastActiveAt: T0, ...over });

describe("isShown", () => {
  it("always shows a working or waiting session, prompted or not", () => {
    for (const state of ["working", "waiting"] as const) expect(isShown(quiet(0, { state }), T0 + 1_000 * HOUR, DEFAULT_CONFIG)).toBe(true);
  });

  it("never shows a session nobody has prompted", () => {
    expect(isShown(quiet(0, { state: "idle" }), T0, DEFAULT_CONFIG)).toBe(false);
  });

  it("shows a one-prompt session until three hours after its last activity", () => {
    expect(isShown(quiet(1), T0 + 3 * HOUR - 1, DEFAULT_CONFIG)).toBe(true);
    expect(isShown(quiet(1), T0 + 3 * HOUR, DEFAULT_CONFIG)).toBe(false);
  });

  it("shows a session with two to eight prompts until a day after its last activity", () => {
    for (const prompts of [2, 8]) {
      expect(isShown(quiet(prompts), T0 + 24 * HOUR - 1, DEFAULT_CONFIG)).toBe(true);
      expect(isShown(quiet(prompts), T0 + 24 * HOUR, DEFAULT_CONFIG)).toBe(false);
    }
  });

  it("always shows a session with more than eight prompts", () => {
    expect(isShown(quiet(9), T0 + 1_000 * HOUR, DEFAULT_CONFIG)).toBe(true);
  });

  it("judges a done session like a quiet one, so a long-hidden session plays no exit", () => {
    expect(isShown(quiet(1, { state: "done" }), T0 + HOUR, DEFAULT_CONFIG)).toBe(true);
    expect(isShown(quiet(1, { state: "done" }), T0 + 4 * HOUR, DEFAULT_CONFIG)).toBe(false);
  });
});
```

`snapshot.test.ts`, add:

```ts
  it("leaves out hidden sessions and the panes left with none, and brings a session back on its next prompt", () => {
    let f = reduceFleet(emptyFleet(), event("presence", T0, { alive: true }, { sessionId: "unprompted", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("prompt", T0, {}, { sessionId: "used", paneKey: "k2" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 1, { backgroundTasks: 0 }, { sessionId: "used", paneKey: "k2" }), T0 + 1, DEFAULT_CONFIG);
    const soon = deriveSnapshot(f, emptyAliasMap(), T0 + DEFAULT_CONFIG.minDisplayMs);
    expect(soon.snapshot.sessions.map((s) => s.alias)).toEqual(["agent-1"]);
    expect(soon.snapshot.panes).toHaveLength(1);
    const later = deriveSnapshot(f, soon.aliases, T0 + 1 + DEFAULT_CONFIG.oneShotHideMs);
    expect(later.snapshot.sessions).toEqual([]);
    expect(later.snapshot.panes).toEqual([]);
    const promptAt = T0 + 2 + DEFAULT_CONFIG.oneShotHideMs;
    f = reduceFleet(f, event("prompt", promptAt, {}, { sessionId: "unprompted", paneKey: "k1" }), promptAt, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, later.aliases, promptAt + DEFAULT_CONFIG.minDisplayMs).snapshot.sessions.map((s) => s.state)).toEqual(["working"]);
  });

  it("takes the hiding limits from the config it is given", () => {
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, { sessionId: "s1", paneKey: "k1" }), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("stop", T0 + 1, { backgroundTasks: 0 }, { sessionId: "s1", paneKey: "k1" }), T0 + 1, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, emptyAliasMap(), T0 + 10_000, { ...DEFAULT_CONFIG, oneShotHideMs: 5_000 }).snapshot.sessions).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/state/visibility.test.ts src/state/snapshot.test.ts`
Expected: FAIL. `./visibility` does not exist; the snapshot still shows the unprompted and the quiet session.

- [ ] **Step 3: Implement**

`config.ts`, add to `StateConfig` and `DEFAULT_CONFIG`:

```ts
  /** A quiet session with exactly one prompt leaves the view this long after its last activity. */
  oneShotHideMs: number;
  /** A quiet session with up to `fewPrompts` prompts leaves the view this long after its last activity. */
  fewPromptsHideMs: number;
  /** A session with more prompts than this stays in view however quiet it is. */
  fewPrompts: number;
```

```ts
  oneShotHideMs: 3 * 3_600_000,
  fewPromptsHideMs: 24 * 3_600_000,
  fewPrompts: 8,
```

`visibility.ts`:

```ts
import type { StateConfig } from "./config";
import type { SessionState } from "./session";

/**
 * Whether a session belongs in the snapshot. A working or waiting session always does, and one
 * nobody has prompted never does. A quiet session stays longer the more it has been used: one prompt
 * keeps it `oneShotHideMs` past its last activity, up to `fewPrompts` keep it `fewPromptsHideMs`, and
 * more keep it for good. A hidden session stays in the fleet, so its next prompt brings it back.
 */
export function isShown(s: SessionState, now: number, cfg: StateConfig): boolean {
  if (s.state === "working" || s.state === "waiting") return true;
  if (s.prompts === 0) return false;
  if (s.prompts > cfg.fewPrompts) return true;
  return now - s.lastActiveAt < (s.prompts === 1 ? cfg.oneShotHideMs : cfg.fewPromptsHideMs);
}
```

`snapshot.ts`: import `DEFAULT_CONFIG, type StateConfig` from `./config` and `isShown` from `./visibility`; take `cfg: StateConfig = DEFAULT_CONFIG` as the fourth parameter; filter before aliasing:

```ts
  const shown = Object.values(f.sessions).filter((s) => isShown(s, now, cfg));
  const shownPanes = new Set(shown.map((s) => s.paneKey));
  const panes = Object.values(f.panes)
    .filter((p) => shownPanes.has(p.paneKey))
    .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
```

and sort and map `shown` instead of `Object.values(f.sessions)`.

`index.ts`: `export * from "./visibility";`

- [ ] **Step 4: Run the tests, regenerate the goldens, review**

Run: `cd packages/core && npx vitest run src/state && pnpm fixtures && git diff --stat src/fixtures && npx vitest run && npx tsc --noEmit`
Expected: state tests PASS. The script prints `skip` for both raw recordings and rewrites the four golden files. The diff only removes sessions from frames before their first prompt. All core tests PASS.

- [ ] **Step 5: Docs**

Core design: add `history` to the event table; add `prompts` and `lastActiveAt` to the §5.1 `SessionState` block; add `history` to §5.3's creates-nothing sentence; give §5.4's `deriveSnapshot` its `cfg` parameter and a paragraph on `isShown`. PRD: FR-3 panes also close when their last session leaves the view; new FR-7a states the rule.

- [ ] **Step 6: Commit**

```bash
git add packages/core docs/superpowers/specs/2026-09-12-core-contract-design.md docs/PRD.md
git commit -m "feat(core): the snapshot leaves out sessions nobody prompted and quiet ones by how much they were used"
```

### Task 3: The transcript reader counts typed prompts

**Files:**
- Modify: `apps/agent/src/presence/transcripts.ts`, `apps/agent/src/presence/transcripts.test.ts`

**Interfaces:**
- Produces: `type TranscriptStats = { lastWriteAt: number; prompts: number }`; `createTranscriptReader(projectsDir: string): (sessionId: string) => Promise<TranscriptStats | null>`. Replaces `createTranscriptClock`.

- [ ] **Step 1: Write the failing tests**

Replace `transcripts.test.ts`:

```ts
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { T0 } from "../testing/events";
import { useTempDirs } from "../testing/tmp";
import { createTranscriptReader } from "./transcripts";

const line = (entry: Record<string, unknown>): string => JSON.stringify(entry);
const typed = (text: string): string => line({ type: "user", promptSource: "sdk", origin: { kind: "human" }, message: { role: "user", content: [{ type: "text", text }] } });

describe("transcript reader", () => {
  const tempDir = useTempDirs();

  async function transcript(root: string, project: string, name: string, mtimeMs: number, lines: string[] = []): Promise<void> {
    await mkdir(join(root, project), { recursive: true });
    const path = join(root, project, name);
    await writeFile(path, lines.map((l) => `${l}\n`).join(""));
    await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
  }

  it("finds a session's transcript by id in whichever project folder holds it", async () => {
    const root = await tempDir();
    await transcript(root, "c--work-one", "s1.jsonl", T0 - 60_000);
    await transcript(root, "c--work-two", "s2.jsonl", T0);
    const read = createTranscriptReader(root);
    expect(await read("s1")).toEqual({ lastWriteAt: T0 - 60_000, prompts: 0 });
    expect(await read("s2")).toEqual({ lastWriteAt: T0, prompts: 0 });
  });

  it("reads the newest when more than one project folder holds the id", async () => {
    const root = await tempDir();
    await transcript(root, "a", "s1.jsonl", T0 - 60_000, [typed("old")]);
    await transcript(root, "b", "s1.jsonl", T0, [typed("one"), typed("two")]);
    expect(await createTranscriptReader(root)("s1")).toEqual({ lastWriteAt: T0, prompts: 2 });
  });

  it("counts only prompts a person typed", async () => {
    const root = await tempDir();
    await transcript(root, "p", "s1.jsonl", T0, [
      line({ type: "summary", summary: "CANARY" }),
      typed("CANARY first prompt"),
      line({ type: "assistant", message: { content: [{ type: "text", text: "CANARY reply" }] } }),
      line({ type: "user", toolUseResult: {}, message: { content: [{ type: "tool_result", content: "CANARY output" }] } }),
      line({ type: "user", promptSource: "sdk", origin: { kind: "task-notification" }, message: { content: "<task-notification>" } }),
      line({ type: "user", isMeta: true, promptSource: "sdk", origin: { kind: "human" }, message: { content: "CANARY caveat" } }),
      line({ type: "user", isSidechain: true, promptSource: "sdk", origin: { kind: "human" }, message: { content: "CANARY subagent" } }),
      line({ type: "user", message: { content: "<local-command-stdout>CANARY</local-command-stdout>" } }),
      "not json, cut short by a crash {",
      typed("CANARY second prompt"),
    ]);
    expect(await createTranscriptReader(root)("s1")).toEqual({ lastWriteAt: T0, prompts: 2 });
  });

  it("answers null for an unknown id, a missing root, a folder named like a transcript, and an id that is not a plain name", async () => {
    const root = await tempDir();
    await transcript(root, "p", "s1.jsonl", T0);
    await mkdir(join(root, "p", "dir.jsonl"));
    await writeFile(join(root, "escape.jsonl"), "{}\n");
    const read = createTranscriptReader(root);
    expect(await read("unknown")).toBeNull();
    expect(await read("dir")).toBeNull();
    expect(await read("../escape")).toBeNull();
    expect(await read("..")).toBeNull();
    expect(await read("")).toBeNull();
    expect(await createTranscriptReader(join(root, "absent"))("s1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/agent && npx vitest run src/presence/transcripts.test.ts`
Expected: FAIL, `createTranscriptReader` is not exported.

- [ ] **Step 3: Implement**

Replace `transcripts.ts`:

```ts
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** What the agent takes from a transcript: when it was last written, and how many prompts were typed into it. */
export type TranscriptStats = { lastWriteAt: number; prompts: number };
export type TranscriptReader = (sessionId: string) => Promise<TranscriptStats | null>;

/** A session id as the agents list prints it. Anything else could name a path outside the folders. */
const PLAIN_ID = /^[A-Za-z0-9_-]+$/;

/**
 * A prompt a person typed: a user entry Claude Code marks as coming from a human. Tool results,
 * command output and background-task notifications carry no such mark. Only these fields are named,
 * so nothing of an entry's content survives parsing.
 */
const TypedPromptSchema = z.object({
  type: z.literal("user"),
  origin: z.object({ kind: z.literal("human") }),
  isMeta: z.boolean().optional(),
  isSidechain: z.boolean().optional(),
});

function isTypedPrompt(line: string): boolean {
  if (!line.includes('"human"')) return false;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return false;
  }
  const entry = TypedPromptSchema.safeParse(value);
  return entry.success && entry.data.isMeta !== true && entry.data.isSidechain !== true;
}

/**
 * Reads `<projects>/<folder>/<sessionId>.jsonl`. Claude Code appends to it whenever the session does
 * anything, so its modified time is when the session was last active. The folder name is derived
 * from the working directory in ways that vary (drive-letter case, for one), so the id is looked for
 * in every folder and the newest file wins. Content is read only to count typed prompts: the two
 * numbers are all that leave this function, and no path or error does.
 */
export function createTranscriptReader(projectsDir: string): TranscriptReader {
  return async (sessionId) => {
    if (!PLAIN_ID.test(sessionId)) return null;
    let folders: string[];
    try {
      folders = (await readdir(projectsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return null;
    }
    let newest: { path: string; mtimeMs: number } | null = null;
    for (const folder of folders) {
      const path = join(projectsDir, folder, `${sessionId}.jsonl`);
      const found = await stat(path).catch(() => null);
      if (found?.isFile() && (newest === null || found.mtimeMs > newest.mtimeMs)) newest = { path, mtimeMs: found.mtimeMs };
    }
    if (newest === null) return null;
    try {
      const text = await readFile(newest.path, "utf8");
      let prompts = 0;
      for (const line of text.split("\n")) if (isTypedPrompt(line)) prompts++;
      return { lastWriteAt: newest.mtimeMs, prompts };
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/agent && npx vitest run src/presence/transcripts.test.ts`
Expected: PASS. (`agent.ts` still imports `createTranscriptClock` until Task 4, so typecheck waits for Task 4.)

- [ ] **Step 5: Commit** together with Task 4, since `agent.ts` depends on the rename.

### Task 4: The poller counts each session once per run

**Files:**
- Modify: `apps/agent/src/presence/poller.ts`, `apps/agent/src/presence/poller.test.ts`
- Modify: `apps/agent/src/host/host.ts`, `apps/agent/src/host/host.test.ts`
- Modify: `apps/agent/src/agent.ts`
- Docs: `docs/superpowers/specs/2026-09-12-local-agent-design.md`

**Interfaces:**
- Consumes: `createTranscriptReader`, `TranscriptStats` (Task 3); `history` event, `deriveSnapshot(..., cfg)` (Tasks 1 and 2).
- Produces: poller dependency `readTranscript?: (sessionId: string) => Promise<TranscriptStats | null>`, replacing `lastWrite`.

- [ ] **Step 1: Write the failing tests**

`poller.test.ts`: `setup(readTranscript?: (sessionId: string) => Promise<TranscriptStats | null>)`, passing `...(readTranscript ? { readTranscript } : {})`, with `import type { TranscriptStats } from "./transcripts";`. Replace the first-sight dating test and add a recount test:

```ts
  it("reads each listed, allowlisted session's transcript once per run, so a long-quiet one sleeps at once", async () => {
    const asked: string[] = [];
    const t = setup(async (id) => {
      asked.push(id);
      return { lastWriteAt: T0 - DEFAULT_CONFIG.asleepAfterMs - 1, prompts: 2 };
    });
    t.host.ingest(ev("prompt", T0, {}, "known"));
    t.list(rawAgentEntry("s1", { startedAt: T0 - 86_400_000 }), rawAgentEntry("known"), rawAgentEntry("outside", { cwd: OUTSIDE_CWD }));
    await t.poller.pollOnce();
    await t.poller.pollOnce();
    expect(asked).toEqual(["s1", "known"]);
    t.host.tick();
    expect(t.host.sessions().get("s1")?.state).toBe("asleep");
  });

  it("raises a session's prompt count from its transcript, and counts it again after it leaves the fleet and returns", async () => {
    const asked: string[] = [];
    const t = setup(async (id) => {
      asked.push(id);
      return { lastWriteAt: T0, prompts: 12 };
    });
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    expect(t.host.snapshot().sessions).toHaveLength(1);
    t.host.ingest(ev("session.end", t.clock.now, { reason: "other" }));
    t.clock.now += DEFAULT_CONFIG.doneLingerMs;
    t.host.tick();
    t.list();
    await t.poller.pollOnce();
    t.host.ingest(ev("session.start", t.clock.now, { source: "resume" }));
    expect(t.host.snapshot().sessions).toHaveLength(0);
    t.list(rawAgentEntry("s1"));
    await t.poller.pollOnce();
    expect(asked).toEqual(["s1", "s1"]);
    expect(t.host.snapshot().sessions).toHaveLength(1);
  });
```

`host.test.ts`, in `describe("FleetHost")`:

```ts
  it("leaves hidden sessions out of its snapshot, judged by its own config", () => {
    const clock = { now: T0 };
    const host = new FleetHost({ now: () => clock.now, config: { ...DEFAULT_CONFIG, oneShotHideMs: 60_000 }, aliases: emptyAliasMap(), log: silentLogger });
    host.ingest(ev("presence", T0, { alive: true }, "unprompted"));
    host.ingest(ev("prompt", T0, {}, "once"));
    host.ingest(ev("stop", T0 + 1, { backgroundTasks: 0 }, "once"));
    clock.now = T0 + 30_000;
    expect(host.snapshot().sessions).toHaveLength(1);
    clock.now = T0 + 61_000;
    expect(host.snapshot().sessions).toHaveLength(0);
    expect(host.sessionCount()).toBe(2);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/agent && npx vitest run src/presence/poller.test.ts src/host/host.test.ts`
Expected: FAIL. The poller never asks for `known` or raises counts; the host judges with the default config.

- [ ] **Step 3: Implement**

`host.ts`: pass `this.deps.config` as the fourth argument to both `deriveSnapshot` calls.

`poller.ts`: replace the `lastWrite` dependency with `readTranscript?: (sessionId: string) => Promise<TranscriptStats | null>`; import `RedactedEventSchema` from `@clawd/core` and `type TranscriptStats` from `./transcripts`; keep `const counted = new Set<string>();`; replace `lastWrites` with:

```ts
  /**
   * Transcript figures for the allowlisted, listed sessions not counted in this run and not ended, read
   * one at a time: a first poll after a restart may read every transcript, and some are tens of
   * megabytes. Counted ids that have left the fleet are forgotten first, so a returning session is
   * counted again.
   */
  async function readUncounted(allowed: ReadonlySet<string>): Promise<Map<string, TranscriptStats | null>> {
    const read = new Map<string, TranscriptStats | null>();
    const reader = deps.readTranscript;
    if (!reader) return read;
    const known = deps.host.sessions();
    for (const id of [...counted]) if (!known.has(id)) counted.delete(id);
    const ended = deps.host.endedIds();
    for (const id of allowed) {
      if (counted.has(id) || ended.has(id)) continue;
      read.set(id, await reader(id).catch(() => null));
    }
    return read;
  }
```

and in `run()`, from `settleRestored` to the reconcile loop and after it:

```ts
    deps.host.settleRestored(allowed);
    const read = await readUncounted(allowed);
    if (stopped) return false;
    const lastWriteAt = new Map<string, number>();
    for (const [id, stats] of read) if (stats) lastWriteAt.set(id, stats.lastWriteAt);
    const sessions = deps.host.sessions();
    for (const e of reconcile({ entries, sessions, lastListedAt, ended: deps.host.endedIds(), now, allowlist: deps.allowlist, graceMs, lastWriteAt })) {
      deps.host.ingest(e);
    }
    const fleet = deps.host.sessions();
    for (const [id, stats] of read) {
      const view = fleet.get(id);
      if (!view) continue;
      counted.add(id);
      if (!stats || stats.prompts === 0) continue;
      const history = RedactedEventSchema.safeParse({ v: 1, t: now, sessionId: id, paneKey: view.paneKey, kind: "history", prompts: stats.prompts });
      if (history.success) deps.host.ingest(history.data);
    }
```

`agent.ts`: import `createTranscriptReader` instead of `createTranscriptClock`, and pass `readTranscript: createTranscriptReader(opts.transcriptsDir ?? defaultTranscriptsDir())`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/agent && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Docs**

Agent design: privacy rule 7 (transcripts are read to count; only counts leave); §6.4 becomes "Transcripts" and describes counting, `history`, and recounting; §13's transcript bullet covers counting and the poller's once-per-run reads.

- [ ] **Step 6: Commit**

```bash
git add apps/agent docs/superpowers/specs/2026-09-12-local-agent-design.md
git commit -m "feat(agent): count typed prompts in each session's transcript once per run and pass the count to core"
```

### Task 5: Verify and merge

- [ ] **Step 1:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build` in the worktree. Expected: all pass.
- [ ] **Step 2:** Run the branch against a private copy of `~/.clawd` with the scratchpad trial script and compare the shown sessions with the rule applied by hand.
- [ ] **Step 3:** Merge `feat/session-visibility` into main from `C:\mw\visualiser` with `--no-ff`, rerun the Step 1 checks on main, remove the worktree. Do not push.

### Amendment: `history` carries the last write

Found on real data at Task 5 Step 2: a restored session created by a replayed presence from an older log had `lastActiveAt` set to when that presence was logged, so two long-quiet sessions stayed shown. `history` now also carries `lastActiveAt`, the transcript's last write floored to whole milliseconds, and the reducer sets the session's `lastActiveAt` to it while still only raising `prompts`. Tests: the schema requires both numbers; a session test for the correction; a poller test for the restored case.
