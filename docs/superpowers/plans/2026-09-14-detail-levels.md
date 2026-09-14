# Detail Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent setting `detail` with levels `none`, `hints` and `paths` that lets the local view say what each session is working on, while the event log and the cloud stay at level `none` by construction.

**Architecture:** Every contract type gains an optional `detail` object. Ingest fills it according to the level; the reducers carry it into the session state, the snapshot and the ticker; one core function `stripDetail` removes every `detail` key, and the log, the sinks' privacy checks and the future cloud publisher go through it. The web app and the scene render detail when present and nothing otherwise.

**Tech Stack:** TypeScript, zod 4, vitest, pnpm workspaces (`@clawd/core`, `@clawd/agent`, `@clawd/scene`, `web`).

**Spec:** `docs/superpowers/specs/2026-09-14-detail-levels-design.md`

## Global Constraints

- Levels are `none`, `hints`, `paths`, in that order, cumulative. Default `none`. Absent config means `none`.
- Never read at any level: `prompt`, `tool_input.prompt`, `tool_input.pattern`, `tool_input.query`, `tool_response`, `last_assistant_message`, `transcript_path`, `agent_transcript_path`. `description` is read only from the Agent tool's input, at `paths`.
- Level `none` output is byte-identical to today: no `detail` key anywhere. The golden fixtures do not change.
- The event log and `toCloudSnapshot` always strip `detail`. Every sink check is `containsForbidden(stripDetail(x), sensitive)`.
- `FORBIDDEN_KEYS` is unchanged. Detail field names are `program`, `ext`, `host`, `agent`, `permissionMode`, `shells`, `file`, `dir`, `name`, `description`, `subject`; never a raw payload key.
- Bounds: `program` 32 chars `^[A-Za-z0-9._+-]+$`; `ext` `^[a-z0-9]{1,16}$`; `host` 253; `agent` 64 `^[A-Za-z0-9._:-]+$`; `permissionMode` `^[a-zA-Z]{1,32}$`; `file` and `dir` 512; `name` and `description` 120; no control characters in any string.
- `tsconfig.base.json` has `exactOptionalPropertyTypes`: build optional fields with `...(x === undefined ? {} : { x })`, never `{ x: undefined }`.
- `packages/core/src/index.test.ts` pins the package's export list by name; every task that adds a core export updates that list.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch: `feat/detail-levels` from `docs/desktop-and-detail-levels`.
- Run package tests from the package directory: `npx vitest run <file>`. Whole repo before the final task: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/schema/detail.ts` (new) | The level enum, the detail schemas per contract type, `stripDetail`, `containsDetail`. |
| `packages/core/src/schema/raw.ts` | The raw shapes that name the detail fields, used only above `none`. |
| `packages/core/src/ingest/detail.ts` (new) | Pure derivations: `program`, `ext`, `host`, `relative`, `dir`, `label`; `hookDetail`, `statusDetail`, `presenceDetail`. Internal, not exported from the package index. |
| `packages/core/src/ingest/redact.ts` | Parses with the detail schemas above `none` and attaches `detail`. |
| `packages/core/src/state/detail.ts` (new) | `subjectOf` and `mergeSessionDetail`. Internal. |
| `packages/core/src/state/session.ts`, `snapshot.ts`, `ticker.ts` | Carry detail into the state, the snapshot and the ticker lines. |
| `packages/core/src/state/cloud.ts` (new) | `toCloudSnapshot`. |
| `apps/agent/src/config.ts`, `detail.ts` (new), `cli.ts` | The setting, its default, and the `detail` subcommand. |
| `apps/agent/src/http/server.ts`, `http/sse.ts`, `store/event-log.ts` | Level into ingest, health reports it, sinks check through `stripDetail`, the log strips. |
| `apps/agent/src/testing/raw.ts`, `agent.e2e.test.ts` | Two canary families; the end-to-end test runs at every level. |
| `apps/web/src/lib/feed/agent.ts`, `policy.ts`, `types.ts`, `hooks/use-feed.ts`, `lib/labels.ts` | The level from health to the source badge. |
| `apps/web/src/lib/ticker/format.ts`, `components/detail-sheet.tsx` | Subject column; name, directory, permission mode and shells in the header. |
| `packages/scene/src/text.ts`, `layout.ts`, `actors.ts`, `panes.ts` | Real name on the nameplate, the caption row. |

---

### Task 1: Detail schemas and the strip function

**Files:**
- Create: `packages/core/src/schema/detail.ts`
- Modify: `packages/core/src/schema/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Test: `packages/core/src/schema/detail.test.ts`

**Interfaces:**
- Produces: `DETAIL_LEVELS`, `DetailLevelSchema`, `DetailLevel`, `atLeast(level, min)`, `HintsDetailSchema`, `PathsDetailSchema`, `EventDetailSchema`/`EventDetail`, `SubjectSchema`/`Subject`, `SessionDetailSchema`/`SessionDetail`, `PaneDetailSchema`/`PaneDetail`, `TickerDetailSchema`/`TickerDetail`, `DETAIL_KEY`, `stripDetail<T>(value: T): T`, `containsDetail(value: unknown): boolean`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/schema/detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DETAIL_LEVELS,
  DetailLevelSchema,
  HintsDetailSchema,
  PaneDetailSchema,
  PathsDetailSchema,
  SessionDetailSchema,
  SubjectSchema,
  TickerDetailSchema,
  atLeast,
  containsDetail,
  stripDetail,
} from "./detail";

describe("detail levels", () => {
  it("orders none, hints, paths", () => {
    expect(DETAIL_LEVELS).toEqual(["none", "hints", "paths"]);
    expect(atLeast("paths", "hints")).toBe(true);
    expect(atLeast("hints", "hints")).toBe(true);
    expect(atLeast("hints", "paths")).toBe(false);
    expect(atLeast("none", "hints")).toBe(false);
    expect(() => DetailLevelSchema.parse("content")).toThrow();
  });

  it("hints refuse anything path-shaped or unknown", () => {
    const full = { program: "git", ext: "ts", host: "example.com", agent: "general-purpose", permissionMode: "acceptEdits", shells: 1 };
    expect(HintsDetailSchema.parse(full)).toEqual(full);
    expect(HintsDetailSchema.parse({ host: "[::1]" })).toEqual({ host: "[::1]" });
    for (const bad of [
      { program: "a/b" },
      { program: "a\\b" },
      { program: "" },
      { ext: "TS" },
      { ext: "ts/x" },
      { host: "a/b" },
      { agent: "x y" },
      { permissionMode: "plan-mode" },
      { shells: -1 },
      { file: "src/a.ts" },
      { dir: "C:/mw" },
      { prompt: "secret" },
    ]) {
      expect(() => HintsDetailSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("paths add file, dir, name and description, bounded and free of control characters", () => {
    const value = { ext: "ts", file: "src/a.ts", dir: "C:/mw/visualiser", name: "Fix login", description: "Review the diff" };
    expect(PathsDetailSchema.parse(value)).toEqual(value);
    expect(() => PathsDetailSchema.parse({ file: "" })).toThrow();
    expect(() => PathsDetailSchema.parse({ name: "a\u0000b" })).toThrow();
    expect(() => PathsDetailSchema.parse({ dir: "x".repeat(513) })).toThrow();
    expect(() => PathsDetailSchema.parse({ description: "x".repeat(121) })).toThrow();
    expect(() => PathsDetailSchema.parse({ tool_input: "x" })).toThrow();
  });

  it("types the session, pane and ticker detail", () => {
    expect(SubjectSchema.parse({ kind: "file", text: "src/a.ts" })).toEqual({ kind: "file", text: "src/a.ts" });
    expect(() => SubjectSchema.parse({ kind: "prompt", text: "x" })).toThrow();
    expect(() => SubjectSchema.parse({ kind: "file", text: "" })).toThrow();
    expect(SessionDetailSchema.parse({ name: "Fix login", shells: 2, subject: { kind: "program", text: "git" } })).toMatchObject({ name: "Fix login", shells: 2 });
    expect(() => SessionDetailSchema.parse({ file: "x" })).toThrow();
    expect(PaneDetailSchema.parse({ dir: "C:/mw" })).toEqual({ dir: "C:/mw" });
    expect(() => PaneDetailSchema.parse({ name: "x" })).toThrow();
    expect(TickerDetailSchema.parse({ permissionMode: "plan", subject: { kind: "host", text: "example.com" } })).toMatchObject({ permissionMode: "plan" });
    expect(() => TickerDetailSchema.parse({ file: "x" })).toThrow();
  });

  it("strips every detail key at any depth and reports whether one is present", () => {
    const value = { a: 1, detail: { file: "x" }, list: [{ detail: { dir: "y" }, keep: true }, 2], nested: { deeper: { detail: {} } } };
    expect(stripDetail(value)).toEqual({ a: 1, list: [{ keep: true }, 2], nested: { deeper: {} } });
    expect(value.detail).toEqual({ file: "x" });
    expect(containsDetail(value)).toBe(true);
    expect(containsDetail(stripDetail(value))).toBe(false);
    expect(containsDetail({ detailed: 1, details: { detail: 1 } })).toBe(true);
    expect(containsDetail({ detailed: 1 })).toBe(false);
    expect(stripDetail("text")).toBe("text");
    expect(stripDetail(null)).toBeNull();
    expect(stripDetail([1, "detail"])).toEqual([1, "detail"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/schema/detail.test.ts`
Expected: FAIL, "Failed to resolve import ./detail".

- [ ] **Step 3: Write the module**

`packages/core/src/schema/detail.ts`:

```ts
import { z } from "zod";

/**
 * How much of a session's activity the agent keeps beyond states, categories and tool names
 * (detail levels design §2). `none` is the wire format the cloud and the event log always get.
 */
export const DETAIL_LEVELS = ["none", "hints", "paths"] as const;
export const DetailLevelSchema = z.enum(DETAIL_LEVELS);
export type DetailLevel = z.infer<typeof DetailLevelSchema>;

/** True when `level` carries at least what `min` does. */
export function atLeast(level: DetailLevel, min: DetailLevel): boolean {
  return DETAIL_LEVELS.indexOf(level) >= DETAIL_LEVELS.indexOf(min);
}

const NO_CONTROL = /^[^\x00-\x1f\x7f]+$/;
const text = (max: number) => z.string().min(1).max(max).regex(NO_CONTROL);
const permissionMode = z.string().regex(/^[a-zA-Z]{1,32}$/);
const shells = z.number().int().nonnegative();

/** Hints: nothing here can hold a path, so every string refuses separators. */
export const HintsDetailSchema = z
  .object({
    program: z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/).optional(),
    ext: z.string().regex(/^[a-z0-9]{1,16}$/).optional(),
    host: z.string().regex(/^[A-Za-z0-9.:[\]-]{1,253}$/).optional(),
    agent: z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/).optional(),
    permissionMode: permissionMode.optional(),
    shells: shells.optional(),
  })
  .strict();
export type HintsDetail = z.infer<typeof HintsDetailSchema>;

/** Paths: the file or directory a tool touches, the working directory, the session's own name. */
export const PathsDetailSchema = HintsDetailSchema.extend({
  file: text(512).optional(),
  dir: text(512).optional(),
  name: text(120).optional(),
  description: text(120).optional(),
}).strict();
export type PathsDetail = z.infer<typeof PathsDetailSchema>;

/** What a redacted event may carry: the paths shape. Ingest fills only what the level allows. */
export const EventDetailSchema = PathsDetailSchema;
export type EventDetail = z.infer<typeof EventDetailSchema>;

/** What a tool call is about: a file (or its extension at hints), a program, a host, an agent. */
export const SubjectSchema = z.object({ kind: z.enum(["file", "program", "host", "agent"]), text: text(512) }).strict();
export type Subject = z.infer<typeof SubjectSchema>;

export const SessionDetailSchema = z
  .object({ name: text(120).optional(), dir: text(512).optional(), permissionMode: permissionMode.optional(), shells: shells.optional(), subject: SubjectSchema.optional() })
  .strict();
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const PaneDetailSchema = z.object({ dir: text(512).optional() }).strict();
export type PaneDetail = z.infer<typeof PaneDetailSchema>;

export const TickerDetailSchema = z.object({ subject: SubjectSchema.optional(), permissionMode: permissionMode.optional() }).strict();
export type TickerDetail = z.infer<typeof TickerDetailSchema>;

/** The one key detail travels under, so one rule strips every level back to `none`. */
export const DETAIL_KEY = "detail";

/** A copy of `value` with every `detail` key removed at any depth. The input is not touched. */
export function stripDetail<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => stripDetail(v)) as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (k !== DETAIL_KEY) out[k] = stripDetail(v);
    return out as T;
  }
  return value;
}

/** True when a `detail` key exists anywhere in `value`. */
export function containsDetail(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((v) => containsDetail(v));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([k, v]) => k === DETAIL_KEY || containsDetail(v));
  }
  return false;
}
```

`packages/core/src/schema/index.ts`, add:

```ts
export * from "./detail";
```

`packages/core/src/index.test.ts`, add to the sorted list (keep it sorted; the test compares exactly):

```ts
      "DETAIL_KEY",
      "DETAIL_LEVELS",
      "DetailLevelSchema",
      "EventDetailSchema",
      "HintsDetailSchema",
      "PaneDetailSchema",
      "PathsDetailSchema",
      "SessionDetailSchema",
      "SubjectSchema",
      "TickerDetailSchema",
      "atLeast",
      "containsDetail",
      "stripDetail",
```

Sorted position: `DETAIL_KEY` and `DETAIL_LEVELS` go after `DEFAULT_CONFIG` and before `ENDPOINTS`; `DetailLevelSchema` after `DETAIL_LEVELS`; `EventDetailSchema` after `ENDPOINTS` and before `EVENT_SCHEMA_VERSION`? No: JavaScript's default sort is by UTF-16 code unit, so upper-case letters sort before lower-case. Run the test, copy the sorted order it prints into the list, and read it once to check nothing unexpected appeared.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run src/schema/detail.test.ts src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema/detail.ts packages/core/src/schema/detail.test.ts packages/core/src/schema/index.ts packages/core/src/index.test.ts
git commit -m "feat(core): detail level enum, the per-type detail schemas and stripDetail"
```

---

### Task 2: Detail on the wire types

**Files:**
- Modify: `packages/core/src/schema/events.ts`
- Modify: `packages/core/src/schema/snapshot.ts`
- Modify: `packages/core/src/schema/ticker.ts`
- Test: `packages/core/src/schema/events.test.ts`, `packages/core/src/schema/wire.test.ts`

**Interfaces:**
- Consumes: the schemas from Task 1.
- Produces: `RedactedEvent.detail?: EventDetail` on every kind; `SessionSnapshot.detail?: SessionDetail`; `PaneSnapshot.detail?: PaneDetail`; `TickerEvent.detail?: TickerDetail`.

- [ ] **Step 1: Write the failing tests**

`events.test.ts`, add to the `describe`:

```ts
  it("carries detail on any kind, bounded by the paths schema", () => {
    expect(RedactedEventSchema.parse({ ...base, kind: "tool.start", tool: "Bash", category: "run", toolUseId: "toolu_1", detail: { program: "git", permissionMode: "default" } })).toMatchObject({ detail: { program: "git" } });
    expect(RedactedEventSchema.parse({ ...base, kind: "presence", alive: true, detail: { dir: "C:/mw/visualiser", name: "Fix login" } })).toMatchObject({ detail: { name: "Fix login" } });
    expect(() => RedactedEventSchema.parse({ ...base, kind: "prompt", detail: { prompt: "secret" } })).toThrow();
    expect(() => RedactedEventSchema.parse({ ...base, kind: "prompt", detail: { program: "a/b" } })).toThrow();
  });
```

`wire.test.ts`, add:

```ts
  it("carries detail on sessions, panes and ticker lines, and rejects a raw key inside it", () => {
    const session = { ...validSnapshot.sessions[0], detail: { name: "Fix login", dir: "C:/mw/visualiser", permissionMode: "plan", shells: 1, subject: { kind: "file", text: "src/app.ts" } } };
    const pane = { pane: "pane-1", label: "Oak", detail: { dir: "C:/mw/visualiser" } };
    const parsed = SnapshotSchema.parse({ ...validSnapshot, panes: [pane], sessions: [session] });
    expect(parsed.sessions[0]?.detail?.subject).toEqual({ kind: "file", text: "src/app.ts" });
    expect(parsed.panes[0]?.detail).toEqual({ dir: "C:/mw/visualiser" });
    expect(() => SnapshotSchema.parse({ ...validSnapshot, sessions: [{ ...validSnapshot.sessions[0], detail: { cwd: "C:/mw" } }] })).toThrow();
    expect(TickerEventSchema.parse({ t: "2026-09-12T10:00:00.000Z", kind: "tool.start", tool: "Bash", activity: "run", detail: { subject: { kind: "program", text: "git" } } }).detail?.subject?.text).toBe("git");
    expect(() => TickerEventSchema.parse({ t: "2026-09-12T10:00:00.000Z", kind: "tool.start", detail: { file: "x" } })).toThrow();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/schema/events.test.ts src/schema/wire.test.ts`
Expected: FAIL. The strict schemas reject `detail` as an unknown key.

- [ ] **Step 3: Add the fields**

`events.ts`, import and base:

```ts
import { EventDetailSchema } from "./detail";
```

```ts
  paneName: z.string().min(1).max(255).regex(/^[^\\/]+$/).optional(),
  // What the agent's detail level lets the event say beyond its kind (detail levels design §3).
  // Absent at level none, so that level's wire format is unchanged.
  detail: EventDetailSchema.optional(),
};
```

`snapshot.ts`, import and the two objects:

```ts
import { PaneDetailSchema, SessionDetailSchema } from "./detail";
```

In `PaneSnapshotSchema`, after `collision`:

```ts
    /** At the paths level, the pane's working directory. */
    detail: PaneDetailSchema.optional(),
```

In `SessionSnapshotSchema`, after `updatedAt`:

```ts
    /** Local only: never in a cloud snapshot (toCloudSnapshot strips it). */
    detail: SessionDetailSchema.optional(),
```

`ticker.ts`, import and field after `reason`:

```ts
import { TickerDetailSchema } from "./detail";
```

```ts
    detail: TickerDetailSchema.optional(),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS, including `fixtures/golden.test.ts`, since no fixture carries detail.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema
git commit -m "feat(core): events, snapshots and ticker lines may carry an optional detail object"
```

---

### Task 3: The raw detail shapes and the pure derivations

**Files:**
- Modify: `packages/core/src/schema/raw.ts`
- Create: `packages/core/src/ingest/detail.ts`
- Test: `packages/core/src/ingest/detail.test.ts`

**Interfaces:**
- Consumes: `DetailLevel`, `EventDetail`, `atLeast` from Task 1.
- Produces: `RawHookDetailSchema`/`RawHookDetail`, `RawStatusLineDetailSchema`/`RawStatusLineDetail`, `RawAgentEntryDetailSchema`/`RawAgentEntryDetail` in `raw.ts`; `program`, `ext`, `host`, `agentType`, `permissionMode`, `dir`, `relative`, `label`, `hookDetail(level, raw)`, `statusDetail(level, raw)`, `presenceDetail(level, raw)` in `ingest/detail.ts`. Not exported from the package index.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/ingest/detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RawAgentEntryDetailSchema, RawHookDetailSchema, RawStatusLineDetailSchema } from "../schema/raw";
import { agentType, dir, ext, hookDetail, host, label, permissionMode, presenceDetail, program, relative, statusDetail } from "./detail";

const cwd = "C:\\mw\\visualiser";
const hook = (extra: Record<string, unknown>) => RawHookDetailSchema.parse({ session_id: "s1", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t1", ...extra });

describe("derivations", () => {
  it("names the program a shell command runs", () => {
    expect(program("git status")).toBe("git");
    expect(program("  pnpm  test")).toBe("pnpm");
    expect(program("FOO=1 BAR=x node script.js")).toBe("node");
    expect(program('"C:\\Program Files\\Git\\bin\\git.exe" log')).toBe("git");
    expect(program("'./scripts/run.sh' --flag")).toBe("run.sh");
    expect(program("C:/tools/build.cmd all")).toBe("build");
    expect(program("cd x && git status")).toBe("cd");
    expect(program("")).toBeUndefined();
    expect(program("FOO=1")).toBeUndefined();
    expect(program("a".repeat(33))).toBeUndefined();
    expect(program("we!rd")).toBeUndefined();
  });

  it("takes a file's extension, lower case, and none for dotfiles or bare names", () => {
    expect(ext("C:\\mw\\visualiser\\src\\App.TSX")).toBe("tsx");
    expect(ext("notes.md")).toBe("md");
    expect(ext("archive.tar.gz")).toBe("gz");
    expect(ext(".env")).toBeUndefined();
    expect(ext("Makefile")).toBeUndefined();
    expect(ext("trailing.")).toBeUndefined();
    expect(ext("x.this-has-a-dash")).toBeUndefined();
  });

  it("takes a URL's hostname and nothing else", () => {
    expect(host("https://example.com/secret/path?q=secret")).toBe("example.com");
    expect(host("http://[::1]:8080/x")).toBe("[::1]");
    expect(host("not a url")).toBeUndefined();
    expect(host("mailto:someone@example.com")).toBeUndefined();
  });

  it("bounds the agent type and the permission mode", () => {
    expect(agentType("general-purpose")).toBe("general-purpose");
    expect(agentType("engg-skills-generic:engg-qa")).toBe("engg-skills-generic:engg-qa");
    expect(agentType("bad type")).toBeUndefined();
    expect(permissionMode("acceptEdits")).toBe("acceptEdits");
    expect(permissionMode("bypass-permissions")).toBeUndefined();
  });

  it("normalises a directory and makes a file relative to it", () => {
    expect(dir("C:\\mw\\visualiser\\")).toBe("C:/mw/visualiser");
    expect(dir("/home/me/repo")).toBe("/home/me/repo");
    expect(dir("/")).toBe("/");
    expect(relative("C:\\mw\\visualiser\\src\\app.ts", cwd)).toBe("src/app.ts");
    expect(relative("c:/MW/Visualiser/src/app.ts", cwd)).toBe("src/app.ts");
    expect(relative("C:\\mw\\visualiser", cwd)).toBe(".");
    expect(relative("C:\\mw\\visualiser-web\\src\\app.ts", cwd)).toBe("C:/mw/visualiser-web/src/app.ts");
    expect(relative("\\\\server\\share\\file.txt", cwd)).toBe("//server/share/file.txt");
    expect(relative("", cwd)).toBeUndefined();
    expect(relative(`C:\\mw\\visualiser\\${"x".repeat(600)}`, cwd)).toHaveLength(512);
  });

  it("cleans free text: no control characters, trimmed, cut, none when empty", () => {
    expect(label("  Fix login \u001b[2J ")).toBe("Fix login [2J");
    expect(label("\u0000")).toBeUndefined();
    expect(label("x".repeat(200))).toHaveLength(120);
  });
});

describe("hookDetail", () => {
  it("yields nothing at none", () => {
    expect(hookDetail("none", hook({ tool_input: { command: "git status" }, permission_mode: "default" }))).toBeUndefined();
  });

  it("yields hints from the input's shape, never its content", () => {
    expect(hookDetail("hints", hook({ tool_input: { command: "git status secret-arg", description: "Show status" }, permission_mode: "default" }))).toEqual({ program: "git", permissionMode: "default" });
    expect(hookDetail("hints", hook({ tool_name: "Write", tool_input: { file_path: "C:\\mw\\visualiser\\src\\app.ts", content: "secret" } }))).toEqual({ ext: "ts" });
    expect(hookDetail("hints", hook({ tool_name: "NotebookEdit", tool_input: { notebook_path: "C:\\mw\\visualiser\\nb.ipynb" } }))).toEqual({ ext: "ipynb" });
    expect(hookDetail("hints", hook({ tool_name: "WebFetch", tool_input: { url: "https://example.com/secret", prompt: "secret" } }))).toEqual({ host: "example.com" });
    expect(hookDetail("hints", hook({ tool_name: "Agent", tool_input: { subagent_type: "Explore", description: "Find the thing", prompt: "secret" } }))).toEqual({ agent: "Explore" });
    expect(hookDetail("hints", hook({ hook_event_name: "Stop", background_tasks: [{ type: "shell" }, { type: "subagent" }, { type: "shell" }] }))).toEqual({ shells: 2 });
    expect(hookDetail("hints", hook({ tool_name: "Grep", tool_input: { pattern: "secret", path: "C:\\mw\\visualiser\\src" } }))).toBeUndefined();
    expect(hookDetail("hints", hook({}))).toBeUndefined();
  });

  it("yields paths relative to the working directory, the directory and an Agent call's description", () => {
    expect(hookDetail("paths", hook({ tool_name: "Write", tool_input: { file_path: "C:\\mw\\visualiser\\src\\app.ts" }, permission_mode: "plan" }))).toEqual({ ext: "ts", permissionMode: "plan", file: "src/app.ts", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_name: "Grep", tool_input: { pattern: "secret", path: "C:\\mw\\visualiser\\src" } }))).toEqual({ file: "src", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_name: "Agent", tool_input: { subagent_type: "Explore", description: "Find the thing", prompt: "secret" } }))).toEqual({ agent: "Explore", description: "Find the thing", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_input: { command: "git status", description: "Show status" } }))).toEqual({ program: "git", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ hook_event_name: "UserPromptSubmit", prompt: "secret" }))).toEqual({ dir: "C:/mw/visualiser" });
  });

  it("drops tool input it cannot read rather than the event", () => {
    expect(hookDetail("paths", hook({ tool_input: "junk" }))).toEqual({ dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_input: { file_path: 42 } }))).toEqual({ dir: "C:/mw/visualiser" });
  });
});

describe("statusDetail and presenceDetail", () => {
  const status = RawStatusLineDetailSchema.parse({ session_id: "s1", cwd, session_name: "Run whoami", context_window: { used_percentage: 5 } });
  const entry = RawAgentEntryDetailSchema.parse({ sessionId: "s1", cwd, name: "Run whoami", pid: 4 });

  it("yield nothing below paths", () => {
    expect(statusDetail("hints", status)).toBeUndefined();
    expect(presenceDetail("hints", entry)).toBeUndefined();
  });

  it("yield the directory and the session's name at paths", () => {
    expect(statusDetail("paths", status)).toEqual({ dir: "C:/mw/visualiser", name: "Run whoami" });
    expect(presenceDetail("paths", entry)).toEqual({ dir: "C:/mw/visualiser", name: "Run whoami" });
    expect(statusDetail("paths", { ...status, session_name: null })).toEqual({ dir: "C:/mw/visualiser" });
    expect(presenceDetail("paths", RawAgentEntryDetailSchema.parse({ sessionId: "s1", cwd }))).toEqual({ dir: "C:/mw/visualiser" });
  });
});

describe("raw detail schemas", () => {
  it("still strip everything they do not name", () => {
    const parsed = hook({ tool_input: { command: "x", prompt: "secret", pattern: "secret", query: "secret" }, tool_response: { out: "secret" }, last_assistant_message: "secret" });
    expect(parsed.tool_input).toEqual({ command: "x" });
    expect(parsed).not.toHaveProperty("tool_response");
    expect(parsed).not.toHaveProperty("last_assistant_message");
    expect(RawStatusLineDetailSchema.parse({ session_id: "s1", cwd, session_name: "n", transcript_path: "secret" })).not.toHaveProperty("transcript_path");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx vitest run src/ingest/detail.test.ts`
Expected: FAIL, "Failed to resolve import ./detail".

- [ ] **Step 3: Add the raw shapes**

`packages/core/src/schema/raw.ts`, append:

```ts
/**
 * The detail fields, named only above level none (detail levels design §5). Still strip mode:
 * `prompt`, `pattern`, `query` and everything else in the tool input never become values. A tool
 * input that is not an object reads as empty rather than failing the event.
 */
const ToolInputDetailSchema = z
  .object({
    file_path: z.string().optional().catch(undefined),
    notebook_path: z.string().optional().catch(undefined),
    path: z.string().optional().catch(undefined),
    command: z.string().optional().catch(undefined),
    url: z.string().optional().catch(undefined),
    subagent_type: z.string().optional().catch(undefined),
    description: z.string().optional().catch(undefined),
  })
  .catch({});

export const RawHookDetailSchema = RawHookSchema.extend({ tool_input: ToolInputDetailSchema.optional(), permission_mode: z.string().optional() });
export type RawHookDetail = z.infer<typeof RawHookDetailSchema>;

export const RawStatusLineDetailSchema = RawStatusLineSchema.extend({ session_name: z.string().nullish() });
export type RawStatusLineDetail = z.infer<typeof RawStatusLineDetailSchema>;

export const RawAgentEntryDetailSchema = RawAgentEntrySchema.extend({ name: z.string().optional().catch(undefined) });
export type RawAgentEntryDetail = z.infer<typeof RawAgentEntryDetailSchema>;
```

Also change the comment at the top of `raw.ts` so it stays true: after "except `cwd`, which ingest reads only to hash and to check against the allowlist." add " The `*Detail` schemas at the bottom name more, and are used only above level none."

- [ ] **Step 4: Write the derivations**

`packages/core/src/ingest/detail.ts`:

```ts
// The detail an event may carry at each level, derived from a raw payload's shape and paths.
// Pure; every function bounds what it returns so the schemas in schema/detail.ts accept it.
import { atLeast, type DetailLevel, type EventDetail } from "../schema/detail";
import type { RawAgentEntryDetail, RawHookDetail, RawStatusLineDetail } from "../schema/raw";

const cut = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);
const segments = (p: string): string[] => p.split(/[\\/]+/).filter((s) => s.length > 0);

/** The program a shell command runs: its first token after any `NAME=value` prefixes, without directory or Windows extension. */
export function program(command: string): string | undefined {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const first = tokens.find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  if (first === undefined) return undefined;
  const last = segments(first.replace(/^["']|["']$/g, "")).at(-1) ?? "";
  const name = last.replace(/\.(exe|cmd|bat)$/i, "");
  return /^[A-Za-z0-9._+-]{1,32}$/.test(name) ? name : undefined;
}

/** A file's extension, lower case; none for a dotfile, a bare name or one that is not letters and digits. */
export function ext(path: string): string | undefined {
  const last = segments(path).at(-1) ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return undefined;
  const e = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(e) ? e : undefined;
}

/** A URL's hostname, or none when it has none or does not parse. */
export function host(url: string): string | undefined {
  try {
    const h = new URL(url).hostname;
    return h.length >= 1 && h.length <= 253 ? h : undefined;
  } catch {
    return undefined;
  }
}

export function agentType(subagentType: string): string | undefined {
  return /^[A-Za-z0-9._:-]{1,64}$/.test(subagentType) ? subagentType : undefined;
}

export function permissionMode(mode: string): string | undefined {
  return /^[a-zA-Z]{1,32}$/.test(mode) ? mode : undefined;
}

/** A directory with forward slashes and no trailing slash, except a bare root. */
export function dir(cwd: string): string {
  const s = cwd.replace(/\\/g, "/");
  const stripped = s.replace(/\/+$/, "");
  return cut(stripped === "" ? "/" : stripped, 512);
}

/** `file` relative to `cwd` when it lies inside it (compared without case), else as given, with forward slashes. */
export function relative(file: string, cwd: string): string | undefined {
  const f = file.replace(/\\/g, "/");
  const root = dir(cwd);
  if (f.toLowerCase() === root.toLowerCase()) return ".";
  const prefix = `${root}/`;
  const inside = f.length > prefix.length && f.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
  const rel = inside ? f.slice(prefix.length) : f;
  return rel.length === 0 ? undefined : cut(rel, 512);
}

/** Free text for the wire: control characters removed, trimmed, cut; none when nothing is left. */
export function label(s: string, max = 120): string | undefined {
  const clean = s.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return clean.length === 0 ? undefined : cut(clean, max);
}

type Fields = { [K in keyof EventDetail]: EventDetail[K] | undefined };

/** Drops the absent fields; none when nothing is left, so an event never carries an empty detail. */
function pruned(fields: Fields): EventDetail | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length === 0 ? undefined : (out as EventDetail);
}

const shells = (tasks: readonly { type?: string | undefined }[] | undefined): number | undefined =>
  tasks === undefined ? undefined : tasks.filter((t) => t.type === "shell").length;

/** What a hook payload yields at `level`: hints from the tool input's shape, paths from its paths. */
export function hookDetail(level: DetailLevel, raw: RawHookDetail): EventDetail | undefined {
  if (!atLeast(level, "hints")) return undefined;
  const input = raw.tool_input ?? {};
  const filePath = input.file_path ?? input.notebook_path ?? input.path;
  const paths = atLeast(level, "paths");
  return pruned({
    program: input.command === undefined ? undefined : program(input.command),
    ext: filePath === undefined ? undefined : ext(filePath),
    host: input.url === undefined ? undefined : host(input.url),
    agent: input.subagent_type === undefined ? undefined : agentType(input.subagent_type),
    permissionMode: raw.permission_mode === undefined ? undefined : permissionMode(raw.permission_mode),
    shells: shells(raw.background_tasks),
    file: paths && filePath !== undefined ? relative(filePath, raw.cwd) : undefined,
    dir: paths ? dir(raw.cwd) : undefined,
    // Only an Agent call's description: a shell command's describes the command, which is content.
    description: paths && raw.tool_name === "Agent" && input.description !== undefined ? label(input.description) : undefined,
  });
}

/** A status line yields the session's directory and name, at paths only. */
export function statusDetail(level: DetailLevel, raw: RawStatusLineDetail): EventDetail | undefined {
  if (!atLeast(level, "paths")) return undefined;
  return pruned({ dir: dir(raw.cwd), name: raw.session_name ? label(raw.session_name) : undefined });
}

/** An agents-list entry yields the same, at paths only. */
export function presenceDetail(level: DetailLevel, raw: RawAgentEntryDetail): EventDetail | undefined {
  if (!atLeast(level, "paths")) return undefined;
  return pruned({ dir: dir(raw.cwd), name: raw.name ? label(raw.name) : undefined });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run src/ingest/detail.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If `Fields` upsets `exactOptionalPropertyTypes`, the mapped type above is the fix already: it makes each value `T | undefined` explicitly.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema/raw.ts packages/core/src/ingest/detail.ts packages/core/src/ingest/detail.test.ts
git commit -m "feat(core): raw detail shapes and the pure derivations for hints and paths"
```

---

### Task 4: Ingest at a level

**Files:**
- Modify: `packages/core/src/ingest/redact.ts`
- Test: `packages/core/src/ingest/redact.test.ts`

**Interfaces:**
- Consumes: Task 3's schemas and `hookDetail`, `statusDetail`, `presenceDetail`.
- Produces: `IngestContext.detail?: DetailLevel` (absent means `none`); `redact()` and `redactPresence()` attach `detail` above `none`.

- [ ] **Step 1: Write the failing tests**

`redact.test.ts`, add a `describe` at the end:

```ts
describe("redact at a detail level", () => {
  const hints = { ...ctx, detail: "hints" as const };
  const paths = { ...ctx, detail: "paths" as const };
  const write = { ...common, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "C:\\mw\\visualiser\\src\\app.ts", content: "secret body" }, tool_use_id: "toolu_10" };
  const fetch = { ...common, hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://example.com/private?token=secret", prompt: "secret" }, tool_use_id: "toolu_11" };
  const agent = { ...common, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "Explore", description: "Find the login form", prompt: "secret" }, tool_use_id: "toolu_12" };
  const shellStop = { ...common, hook_event_name: "Stop", last_assistant_message: "secret", background_tasks: [{ id: "b", type: "shell", status: "running", command: "secret", description: "secret" }] };
  const entry = { pid: 4242, cwd, kind: "interactive", startedAt: 1_757_671_200_000, sessionId: "e82c9e2a", name: "Run whoami bash command" };

  it("adds nothing at none, whether the level is absent or explicit", () => {
    for (const payload of [...Object.values(raw), write, fetch, agent, shellStop]) {
      expect(redact(payload, ctx)).not.toHaveProperty("detail");
      expect(redact(payload, { ...ctx, detail: "none" })).not.toHaveProperty("detail");
    }
    expect(redactPresence(entry, true, ctx)).not.toHaveProperty("detail");
  });

  it("adds hints from the shape of the input and the permission mode", () => {
    expect(redact(raw.preTool, hints)).toMatchObject({ kind: "tool.start", detail: { program: "whoami", permissionMode: "default" } });
    expect(redact(write, hints)).toMatchObject({ detail: { ext: "ts", permissionMode: "default" } });
    expect(redact(fetch, hints)).toMatchObject({ detail: { host: "example.com" } });
    expect(redact(agent, hints)).toMatchObject({ detail: { agent: "Explore" } });
    expect(redact(agent, hints)?.detail).not.toHaveProperty("description");
    expect(redact(shellStop, hints)).toMatchObject({ kind: "stop", backgroundTasks: 0, detail: { shells: 1 } });
    expect(redact(raw.sessionStart, hints)).toMatchObject({ detail: { permissionMode: "default" } });
    expect(redact(raw.statusLine, hints)).not.toHaveProperty("detail");
    expect(redactPresence(entry, true, hints)).not.toHaveProperty("detail");
  });

  it("adds paths, the directory, the session name and an Agent description at paths", () => {
    expect(redact(write, paths)).toMatchObject({ detail: { ext: "ts", file: "src/app.ts", dir: "C:/mw/visualiser" } });
    expect(redact(agent, paths)).toMatchObject({ detail: { agent: "Explore", description: "Find the login form", dir: "C:/mw/visualiser" } });
    expect(redact(raw.statusLine, paths)).toMatchObject({ kind: "status", detail: { dir: "C:/mw/visualiser", name: "Run whoami bash command" } });
    expect(redactPresence(entry, true, paths)).toMatchObject({ kind: "presence", detail: { dir: "C:/mw/visualiser", name: "Run whoami bash command" } });
  });

  it("never lets content through at any level, and keeps paths only inside detail", () => {
    const content = ["e82c9e2a.jsonl", "secret body", "token=secret", "Find the login form", "MWardill", "Which colour?", "Blue it is"];
    for (const level of [hints, paths]) {
      for (const payload of [...Object.values(raw), write, fetch, shellStop]) {
        const event = redact(payload, level);
        if (!event) continue;
        expect(containsForbidden(stripDetail(event), [...content, cwd, "C:/mw/visualiser"]), JSON.stringify(event)).toBeNull();
        expect(JSON.stringify(event)).not.toContain("secret");
      }
    }
    expect(containsForbidden(redact(write, paths), ["C:/mw/visualiser"])).toBe("C:/mw/visualiser");
    expect(containsForbidden(redact(write, hints), ["C:/mw/visualiser", "app.ts"])).toBeNull();
  });
});
```

Add `stripDetail` to the imports at the top of the test file:

```ts
import { stripDetail } from "../schema/detail";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/ingest/redact.test.ts`
Expected: FAIL. `IngestContext` has no `detail`, and no event carries one.

- [ ] **Step 3: Implement**

`redact.ts`, imports:

```ts
import { atLeast, type DetailLevel, type EventDetail } from "../schema/detail";
import {
  RawAgentEntryDetailSchema,
  RawAgentEntrySchema,
  RawHookDetailSchema,
  RawHookSchema,
  RawStatusLineDetailSchema,
  RawStatusLineSchema,
  type RawHook,
  type RawStatusLine,
} from "../schema/raw";
import { hookDetail, presenceDetail, statusDetail } from "./detail";
```

`IngestContext`:

```ts
export type IngestContext = {
  now: number;
  allowlist: readonly string[];
  /** Keep the working directory's last segment on every event as `paneName`, for pane labels. Off unless set. */
  paneNames?: boolean;
  /** How much of a payload's shape and paths to keep (detail levels design §2). Absent means none. */
  detail?: DetailLevel;
};
```

`redact()`:

```ts
export function redact(raw: unknown, ctx: IngestContext): RedactedEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const level = ctx.detail ?? "none";
  if (level === "none") {
    const hook = RawHookSchema.safeParse(raw);
    if (hook.success) return redactHook(hook.data, ctx);
    const status = RawStatusLineSchema.safeParse(raw);
    if (status.success && isStatusLine(status.data)) return redactStatus(status.data, ctx);
    return null;
  }
  // Above none the wider shapes are parsed, still in strip mode; the level decides what is kept.
  const hook = RawHookDetailSchema.safeParse(raw);
  if (hook.success) return redactHook(hook.data, ctx, hookDetail(level, hook.data));
  const status = RawStatusLineDetailSchema.safeParse(raw);
  if (status.success && isStatusLine(status.data)) return redactStatus(status.data, ctx, statusDetail(level, status.data));
  return null;
}
```

`redactPresence()`:

```ts
export function redactPresence(entry: unknown, alive: boolean, ctx: IngestContext, lastWriteAt?: number | null): RedactedEvent | null {
  const paths = atLeast(ctx.detail ?? "none", "paths");
  const parsed = paths ? RawAgentEntryDetailSchema.safeParse(entry) : RawAgentEntrySchema.safeParse(entry);
  if (!parsed.success) return null;
  const base = envelope(parsed.data.sessionId, parsed.data.cwd, ctx);
  if (!base) return null;
  const detail = paths ? presenceDetail("paths", parsed.data) : undefined;
  const known = [lastWriteAt, parsed.data.startedAt].filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
  const lastActiveAt = alive && known.length > 0 ? Math.floor(Math.max(...known)) : undefined;
  return validate({ ...base, ...(detail === undefined ? {} : { detail }), kind: "presence", alive, ...(lastActiveAt === undefined ? {} : { lastActiveAt }) });
}
```

`redactHook()` signature and `base`:

```ts
function redactHook(p: RawHook, ctx: IngestContext, detail?: EventDetail): RedactedEvent | null {
  // Internal helpers (the session-naming helper) have an empty agent_type. Nothing of theirs is ours.
  if (p.agent_id && !p.agent_type) return null;
  const env = envelope(p.session_id, p.cwd, ctx);
  if (!env) return null;
  const base = { ...env, ...(p.agent_id ? { agentId: p.agent_id } : {}), ...(detail === undefined ? {} : { detail }) };
```

The rest of `redactHook` is unchanged: every `validate({ ...base, ... })` call now carries `detail` when there is one.

`redactStatus()` signature and `base`:

```ts
function redactStatus(p: RawStatusLine, ctx: IngestContext, detail?: EventDetail): RedactedEvent | null {
  const env = envelope(p.session_id, p.cwd, ctx);
  if (!env) return null;
  const base = { ...env, ...(detail === undefined ? {} : { detail }) };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: PASS. The golden fixtures still pass because the fixture loader never sets a level.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/redact.ts packages/core/src/ingest/redact.test.ts
git commit -m "feat(core): ingest attaches detail at the configured level, none by default"
```

---

### Task 5: The state carries detail into the snapshot and the ticker

**Files:**
- Create: `packages/core/src/state/detail.ts`
- Modify: `packages/core/src/state/session.ts`
- Modify: `packages/core/src/state/snapshot.ts`
- Modify: `packages/core/src/state/ticker.ts`
- Test: `packages/core/src/state/detail.test.ts`, `packages/core/src/state/session.test.ts`, `packages/core/src/state/snapshot.test.ts`, `packages/core/src/state/ticker.test.ts`

**Interfaces:**
- Consumes: `SessionDetail`, `Subject`, `TickerDetail` from Task 1; `RedactedEvent.detail` from Task 2.
- Produces: `subjectOf(e): Subject | undefined`; `mergeSessionDetail(prev, e): SessionDetail`; `SessionState.detail: SessionDetail` (`{}` for a new session); snapshot sessions and panes carry `detail` only when it has a field; `tool.start`, `tool.end` and `permission` ticker lines carry `detail` when the event has a subject or a permission mode.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/state/detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EventDetail } from "../schema/detail";
import { T0, event } from "../testing/events";
import { mergeSessionDetail, subjectOf } from "./detail";

const tool = (category: "read" | "edit" | "run" | "web" | "spawn" | "other", detail: EventDetail) =>
  event("tool.start", T0, { tool: "X", category, toolUseId: "u1", detail });

describe("subjectOf", () => {
  it("picks the file, the extension, the program, the host or the agent by category", () => {
    expect(subjectOf(tool("edit", { file: "src/app.ts", ext: "ts" }))).toEqual({ kind: "file", text: "src/app.ts" });
    expect(subjectOf(tool("read", { ext: "ts" }))).toEqual({ kind: "file", text: "ts" });
    expect(subjectOf(tool("run", { program: "git" }))).toEqual({ kind: "program", text: "git" });
    expect(subjectOf(tool("web", { host: "example.com" }))).toEqual({ kind: "host", text: "example.com" });
    expect(subjectOf(tool("spawn", { agent: "Explore", description: "Find the form" }))).toEqual({ kind: "agent", text: "Find the form" });
    expect(subjectOf(tool("spawn", { agent: "Explore" }))).toEqual({ kind: "agent", text: "Explore" });
  });

  it("has nothing to say without detail, for the other category, or for events without a category", () => {
    expect(subjectOf(tool("other", { permissionMode: "default" }))).toBeUndefined();
    expect(subjectOf(tool("run", { permissionMode: "default" }))).toBeUndefined();
    expect(subjectOf(event("tool.start", T0, { tool: "X", category: "run", toolUseId: "u1" }))).toBeUndefined();
    expect(subjectOf(event("prompt", T0, { detail: { program: "git" } }))).toBeUndefined();
  });
});

describe("mergeSessionDetail", () => {
  it("copies the session fields when present and sets the subject on a tool start, returning prev when nothing changed", () => {
    const a = mergeSessionDetail({}, event("prompt", T0, { detail: { permissionMode: "plan", dir: "C:/mw" } }));
    expect(a).toEqual({ permissionMode: "plan", dir: "C:/mw" });
    const b = mergeSessionDetail(a, tool("run", { program: "git", permissionMode: "plan", shells: 1 }));
    expect(b).toEqual({ permissionMode: "plan", dir: "C:/mw", shells: 1, subject: { kind: "program", text: "git" } });
    expect(mergeSessionDetail(b, tool("run", { program: "git", permissionMode: "plan", shells: 1 }))).toBe(b);
    expect(mergeSessionDetail(b, event("stop", T0, { backgroundTasks: 0 }))).toBe(b);
    const c = mergeSessionDetail(b, event("status", T0, { detail: { name: "Fix login" } }));
    expect(c).toEqual({ ...b, name: "Fix login" });
  });

  it("keeps the last subject through tool ends and stops", () => {
    const s = mergeSessionDetail({}, tool("edit", { file: "src/app.ts" }));
    expect(mergeSessionDetail(s, event("tool.end", T0, { tool: "X", category: "edit", toolUseId: "u1", durationMs: 1, detail: { file: "other.ts" } }))).toBe(s);
  });
});
```

`session.test.ts`, append:

```ts
describe("detail", () => {
  it("starts empty and folds each event's detail in, without touching the rest of the state", () => {
    expect(newSession("s1", "k1", T0).detail).toEqual({});
    const plain = run([ev("prompt", T0 + 10), ev("tool.start", T0 + 20, { tool: "Bash", category: "run", toolUseId: "u1" })]);
    const detailed = run([
      ev("prompt", T0 + 10, { detail: { permissionMode: "acceptEdits", dir: "C:/mw/visualiser" } }),
      ev("tool.start", T0 + 20, { tool: "Bash", category: "run", toolUseId: "u1", detail: { program: "git", permissionMode: "acceptEdits" } }),
    ]);
    expect(detailed.detail).toEqual({ permissionMode: "acceptEdits", dir: "C:/mw/visualiser", subject: { kind: "program", text: "git" } });
    expect({ ...detailed, detail: {} }).toEqual({ ...plain, detail: {} });
  });

  it("leaves a done session and a history event alone", () => {
    const done = run([ev("session.end", T0, { reason: "x" })]);
    expect(run([ev("prompt", T0 + 1, { detail: { name: "late" } })], done)).toBe(done);
    const s = run([ev("prompt", T0)]);
    expect(run([ev("history", T0 + 1, { prompts: 3, lastActiveAt: T0 })], s).detail).toEqual({});
  });
});
```

`snapshot.test.ts`, add:

```ts
  it("carries session detail and the pane's directory only when there is any", () => {
    const ids = { sessionId: "s1", paneKey: "k1", paneName: "visualiser" };
    let f = reduceFleet(emptyFleet(), event("prompt", T0, { detail: { permissionMode: "plan", dir: "C:/mw/visualiser", name: "Fix login" } }, ids), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("tool.start", T0 + 1, { tool: "Edit", category: "edit", toolUseId: "u1", detail: { file: "src/app.ts", ext: "ts" } }, ids), T0 + 1, DEFAULT_CONFIG);
    const { snapshot } = deriveSnapshot(f, emptyAliasMap(), T0 + 5000);
    expect(snapshot.sessions[0]?.detail).toEqual({ permissionMode: "plan", dir: "C:/mw/visualiser", name: "Fix login", subject: { kind: "file", text: "src/app.ts" } });
    expect(snapshot.sessions[0]?.label).toBe("Otter");
    expect(snapshot.panes[0]).toEqual({ pane: "pane-1", label: "visualiser", detail: { dir: "C:/mw/visualiser" } });
    const bare = reduceFleet(emptyFleet(), event("prompt", T0, {}, ids), T0, DEFAULT_CONFIG);
    const plain = deriveSnapshot(bare, emptyAliasMap(), T0 + 5000).snapshot;
    expect(plain.sessions[0]).not.toHaveProperty("detail");
    expect(plain.panes[0]).not.toHaveProperty("detail");
  });
```

`ticker.test.ts`, add:

```ts
  it("puts the subject and the permission mode on tool and permission lines, and nothing on the rest", () => {
    const s = newSession("s1", "k1", T0);
    const line = (e: RedactedEvent) => toTickerEvents(e, s, s)[0];
    const detail = { file: "src/app.ts", ext: "ts", permissionMode: "plan" };
    expect(line(event("tool.start", T0, { tool: "Edit", category: "edit", toolUseId: "u", detail }))).toMatchObject({ kind: "tool.start", detail: { subject: { kind: "file", text: "src/app.ts" }, permissionMode: "plan" } });
    expect(line(event("tool.end", T0, { tool: "Edit", category: "edit", toolUseId: "u", durationMs: 1, detail: { ext: "ts" } }))).toMatchObject({ detail: { subject: { kind: "file", text: "ts" } } });
    expect(line(event("permission.request", T0, { tool: "Bash", category: "run", detail: { program: "rm" } }))).toMatchObject({ kind: "permission", detail: { subject: { kind: "program", text: "rm" } } });
    expect(line(event("tool.start", T0, { tool: "Edit", category: "edit", toolUseId: "u" }))).not.toHaveProperty("detail");
    expect(line(event("tool.start", T0, { tool: "X", category: "other", toolUseId: "u", detail: { dir: "C:/mw" } }))).not.toHaveProperty("detail");
    expect(line(event("prompt", T0, { detail: { permissionMode: "plan" } }))).toEqual({ t: new Date(T0).toISOString(), kind: "prompt" });
  });
```

`detail` sits on the event base, so the typed `event()` helper accepts it without a cast.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/state`
Expected: FAIL. No `./detail` module; sessions have no `detail`; snapshots and ticker lines carry none.

- [ ] **Step 3: Write `state/detail.ts`**

```ts
// How an event's detail becomes the session's: the copied fields, and the subject of a tool call.
import type { SessionDetail, Subject } from "../schema/detail";
import type { RedactedEvent } from "../schema/events";

/** What a tool event is about, as far as its detail says: the file (or its extension), the program, the host, the agent. */
export function subjectOf(e: RedactedEvent): Subject | undefined {
  if (e.detail === undefined || !("category" in e)) return undefined;
  const d = e.detail;
  switch (e.category) {
    case "read":
    case "edit": {
      const text = d.file ?? d.ext;
      return text === undefined ? undefined : { kind: "file", text };
    }
    case "run":
      return d.program === undefined ? undefined : { kind: "program", text: d.program };
    case "web":
      return d.host === undefined ? undefined : { kind: "host", text: d.host };
    case "spawn": {
      const text = d.description ?? d.agent;
      return text === undefined ? undefined : { kind: "agent", text };
    }
    case "other":
      return undefined;
    default:
      e.category satisfies never;
      return undefined;
  }
}

/**
 * Folds an event's detail into the session's: the session-wide fields whenever an event carries
 * them, the subject on a tool start only, so it names the newest call and survives its end.
 * Returns `prev` itself when nothing changed.
 */
export function mergeSessionDetail(prev: SessionDetail, e: RedactedEvent): SessionDetail {
  const d = e.detail;
  if (d === undefined) return prev;
  let next = prev;
  if (d.permissionMode !== undefined && d.permissionMode !== next.permissionMode) next = { ...next, permissionMode: d.permissionMode };
  if (d.shells !== undefined && d.shells !== next.shells) next = { ...next, shells: d.shells };
  if (d.name !== undefined && d.name !== next.name) next = { ...next, name: d.name };
  if (d.dir !== undefined && d.dir !== next.dir) next = { ...next, dir: d.dir };
  if (e.kind === "tool.start") {
    const subject = subjectOf(e);
    if (subject !== undefined && (next.subject?.kind !== subject.kind || next.subject.text !== subject.text)) next = { ...next, subject };
  }
  return next;
}
```

- [ ] **Step 4: Thread it through the session, the snapshot and the ticker**

`session.ts`, imports and the state type:

```ts
import type { SessionDetail } from "../schema/detail";
import { mergeSessionDetail } from "./detail";
```

Add to `SessionState` after `displayHold`:

```ts
  /** What the agent's detail level lets the session say about itself (detail levels design §3). Empty at level none. */
  detail: SessionDetail;
```

In `newSession`, after `displayHold: null,`:

```ts
    detail: {},
```

In `reduceSession`, the line that builds `s`:

```ts
  let s: SessionState = { ...prev, lastEventAt: now, detail: mergeSessionDetail(prev.detail, e), ...(ACTIVE.has(e.kind) ? { lastActiveAt: Math.max(prev.lastActiveAt, now) } : {}) };
```

`snapshot.ts` (state), the pane map and the session map:

```ts
    .map((p) => {
      const r = ensurePaneAlias(map, p.paneKey);
      map = r.map;
      const dir = shown.find((s) => s.paneKey === p.paneKey && s.detail.dir !== undefined)?.detail.dir;
      return { pane: r.alias, label: folders.get(p.paneKey) ?? r.label, ...(dir === undefined ? {} : { detail: { dir } }) };
    });
```

```ts
      const { state, activity } = displayed(s, now);
      return {
        alias: sr.alias,
        label: sr.label,
        pane: pr.alias,
        state,
        activity,
        subagents: s.subagents.length,
        contextPct: s.contextPct,
        since: new Date(s.since).toISOString(),
        updatedAt: new Date(s.lastEventAt).toISOString(),
        // Only when there is something to say, so level none stays byte for byte what it was.
        ...(Object.keys(s.detail).length === 0 ? {} : { detail: s.detail }),
      };
```

`ticker.ts` (state), import and a helper before `ownLine`, then the three cases:

```ts
import type { TickerDetail } from "../schema/detail";
import { subjectOf } from "./detail";
```

```ts
/** The subject and permission mode a tool or permission line carries, when the event has either. */
function lineDetail(e: RedactedEvent): { detail: TickerDetail } | Record<string, never> {
  const subject = subjectOf(e);
  const permissionMode = e.detail?.permissionMode;
  if (subject === undefined && permissionMode === undefined) return {};
  return { detail: { ...(subject === undefined ? {} : { subject }), ...(permissionMode === undefined ? {} : { permissionMode }) } };
}
```

```ts
    case "tool.start":
      return { t, kind: "tool.start", tool: e.tool, activity: e.category, ...lineDetail(e) };
    case "tool.end":
      return { t, kind: "tool.end", tool: e.tool, activity: e.category, durationMs: e.durationMs, ...lineDetail(e) };
    case "permission.request":
      return { t, kind: "permission", tool: e.tool, ...lineDetail(e) };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: PASS, golden fixtures included. If `session.test.ts` has an `expect(...).toEqual(...)` over a whole `SessionState` that now fails only on `detail: {}`, add `detail: {}` to that expected object; that is the one legitimate change.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state
git commit -m "feat(core): sessions keep their detail; snapshots and ticker lines carry it when present"
```

---

### Task 6: `toCloudSnapshot` and the four invariants

**Files:**
- Create: `packages/core/src/state/cloud.ts`
- Modify: `packages/core/src/state/index.ts`
- Modify: `packages/core/src/index.test.ts`
- Test: `packages/core/src/state/cloud.test.ts`, `packages/core/src/ingest/levels.test.ts`

**Interfaces:**
- Produces: `toCloudSnapshot(s: Snapshot): Snapshot`, exported from the package.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/state/cloud.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { containsDetail } from "../schema/detail";
import type { Snapshot } from "../schema/snapshot";
import { toCloudSnapshot } from "./cloud";

const T = "2026-09-12T10:00:00.000Z";
const local: Snapshot = {
  version: 1,
  generatedAt: T,
  panes: [{ pane: "pane-1", label: "Oak", detail: { dir: "C:/mw/visualiser" } }],
  sessions: [{ alias: "agent-1", label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 0, contextPct: null, since: T, updatedAt: T, detail: { name: "Fix login", subject: { kind: "file", text: "src/app.ts" } } }],
};

describe("toCloudSnapshot", () => {
  it("returns a valid snapshot with every detail key removed and the input untouched", () => {
    const cloud = toCloudSnapshot(local);
    expect(containsDetail(cloud)).toBe(false);
    expect(cloud.sessions[0]).toEqual({ alias: "agent-1", label: "Otter", pane: "pane-1", state: "working", activity: "edit", subagents: 0, contextPct: null, since: T, updatedAt: T });
    expect(cloud.panes[0]).toEqual({ pane: "pane-1", label: "Oak" });
    expect(JSON.stringify(cloud)).not.toContain("visualiser");
    expect(containsDetail(local)).toBe(true);
  });

  it("refuses something that is not a snapshot even after stripping", () => {
    expect(() => toCloudSnapshot({ ...local, version: 2 } as unknown as Snapshot)).toThrow();
  });
});
```

`packages/core/src/ingest/levels.test.ts`, the invariants over a whole session at each level:

```ts
// The four invariants of the detail levels design (§4), over one session's worth of raw payloads.
// CANARY marks content that must never appear anywhere; LOCALONLY marks paths and names that may
// appear only inside `detail`, only at paths, and never after stripDetail.
import { describe, expect, it } from "vitest";
import { emptyAliasMap } from "../alias/names";
import { HintsDetailSchema, containsDetail, stripDetail, type DetailLevel } from "../schema/detail";
import type { RedactedEvent } from "../schema/events";
import type { Snapshot } from "../schema/snapshot";
import type { TickerEvent } from "../schema/ticker";
import { applyEvent } from "../state/apply";
import { toCloudSnapshot } from "../state/cloud";
import { DEFAULT_CONFIG } from "../state/config";
import { emptyFleet, type Fleet } from "../state/fleet";
import { deriveSnapshot } from "../state/snapshot";
import { containsForbidden, redact, redactPresence, type IngestContext } from "./redact";

const T0 = 1_757_671_200_000;
const CWD = "C:\\work\\LOCALONLY-parent\\repo";
const LIVE = [CWD, "C:/work/LOCALONLY-parent/repo"];
const FILE = "C:\\work\\LOCALONLY-parent\\repo\\src\\LOCALONLY-file.ts";
const common = { session_id: "s1", transcript_path: "C:/x/CANARY-transcript.jsonl", cwd: CWD, prompt_id: "p1", permission_mode: "acceptEdits" };
const script: Record<string, unknown>[] = [
  { ...common, hook_event_name: "UserPromptSubmit", prompt: "CANARY prompt" },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Write", tool_use_id: "t1", tool_input: { file_path: FILE, content: "CANARY content" } },
  { ...common, hook_event_name: "PostToolUse", tool_name: "Write", tool_use_id: "t1", tool_input: { file_path: FILE }, tool_response: { ok: "CANARY output" }, duration_ms: 3 },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "git status CANARY-arg", description: "CANARY shell description" } },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Grep", tool_use_id: "t3", tool_input: { pattern: "CANARY pattern", path: "C:\\work\\LOCALONLY-parent\\repo\\src" } },
  { ...common, hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_use_id: "t4", tool_input: { url: "https://example.test/CANARY-path?q=CANARY", prompt: "CANARY fetch prompt" } },
  { ...common, hook_event_name: "PreToolUse", tool_name: "Agent", tool_use_id: "t5", tool_input: { subagent_type: "Explore", description: "LOCALONLY task", prompt: "CANARY agent prompt" } },
  { ...common, hook_event_name: "Stop", last_assistant_message: "CANARY reply", background_tasks: [{ id: "b", type: "shell", status: "running", command: "CANARY cmd", description: "CANARY desc" }] },
  { session_id: "s1", cwd: CWD, transcript_path: "C:/x/CANARY-transcript.jsonl", session_name: "LOCALONLY session", workspace: { current_dir: CWD }, context_window: { used_percentage: 12 } },
];
const entry = { pid: 1, cwd: CWD, kind: "interactive", startedAt: T0, sessionId: "s1", name: "LOCALONLY session" };

type Run = { events: RedactedEvent[]; ticker: TickerEvent[]; snapshot: Snapshot; all: unknown[] };

function run(level: DetailLevel): Run {
  const ctx: IngestContext = { now: T0, allowlist: ["C:\\work"], paneNames: true, detail: level };
  let fleet: Fleet = emptyFleet();
  const events: RedactedEvent[] = [];
  const ticker: TickerEvent[] = [];
  let t = T0;
  const feed = (e: RedactedEvent | null): void => {
    if (!e) return;
    events.push(e);
    const applied = applyEvent(fleet, e, e.t, DEFAULT_CONFIG);
    fleet = applied.fleet;
    ticker.push(...applied.ticker);
  };
  for (const raw of script) feed(redact(raw, { ...ctx, now: (t += 1000) }));
  feed(redactPresence(entry, true, { ...ctx, now: (t += 1000) }));
  const { snapshot } = deriveSnapshot(fleet, emptyAliasMap(), t + 5000);
  return { events, ticker, snapshot, all: [events, ticker, snapshot] };
}

describe("detail level invariants", () => {
  it("1: level none produces no detail key anywhere and no local string", () => {
    const r = run("none");
    expect(r.events).toHaveLength(script.length + 1);
    expect(containsDetail(r.all)).toBe(false);
    expect(JSON.stringify(r.all)).not.toContain("LOCALONLY");
  });

  it("2: outside detail nothing forbidden and no content appears at any level", () => {
    for (const level of ["none", "hints", "paths"] as const) {
      const r = run(level);
      expect(JSON.stringify(r.all), level).not.toContain("CANARY");
      for (const value of r.all) expect(containsForbidden(stripDetail(value), LIVE), level).toBeNull();
    }
  });

  it("3: the cloud snapshot is level none whatever the level, and the strip is what makes it so", () => {
    const r = run("paths");
    expect(containsForbidden(r.snapshot, LIVE)).not.toBeNull();
    const cloud = toCloudSnapshot(r.snapshot);
    expect(containsDetail(cloud)).toBe(false);
    expect(JSON.stringify(cloud)).not.toContain("LOCALONLY");
    expect(containsForbidden(cloud, LIVE)).toBeNull();
    expect(cloud.sessions[0]?.label).toBe(r.snapshot.sessions[0]?.label);
  });

  it("4: hints are bounded by the hints schema and carry no path", () => {
    const r = run("hints");
    expect(JSON.stringify(r.all)).not.toContain("LOCALONLY");
    for (const e of r.events) if (e.detail !== undefined) expect(() => HintsDetailSchema.parse(e.detail), e.kind).not.toThrow();
    const by = (tool: string) => r.events.find((e) => e.kind === "tool.start" && e.tool === tool)?.detail;
    expect(by("Write")).toEqual({ ext: "ts", permissionMode: "acceptEdits" });
    expect(by("Bash")).toEqual({ program: "git", permissionMode: "acceptEdits" });
    expect(by("Grep")).toEqual({ permissionMode: "acceptEdits" });
    expect(by("WebFetch")).toEqual({ host: "example.test", permissionMode: "acceptEdits" });
    expect(by("Agent")).toEqual({ agent: "Explore", permissionMode: "acceptEdits" });
    expect(r.events.find((e) => e.kind === "stop")?.detail).toEqual({ shells: 1, permissionMode: "acceptEdits" });
    expect(r.snapshot.sessions[0]?.detail).toEqual({ permissionMode: "acceptEdits", shells: 1, subject: { kind: "agent", text: "Explore" } });
    expect(r.snapshot.panes[0]).not.toHaveProperty("detail");
  });

  it("paths carry relative files, the directory, the name and the agent description, inside detail only", () => {
    const r = run("paths");
    const by = (tool: string) => r.events.find((e) => e.kind === "tool.start" && e.tool === tool)?.detail;
    expect(by("Write")).toEqual({ ext: "ts", permissionMode: "acceptEdits", file: "src/LOCALONLY-file.ts", dir: "C:/work/LOCALONLY-parent/repo" });
    expect(by("Grep")).toEqual({ permissionMode: "acceptEdits", file: "src", dir: "C:/work/LOCALONLY-parent/repo" });
    expect(by("Agent")).toMatchObject({ description: "LOCALONLY task" });
    expect(r.events.find((e) => e.kind === "status")?.detail).toEqual({ dir: "C:/work/LOCALONLY-parent/repo", name: "LOCALONLY session" });
    expect(r.events.find((e) => e.kind === "presence")?.detail).toEqual({ dir: "C:/work/LOCALONLY-parent/repo", name: "LOCALONLY session" });
    expect(r.snapshot.sessions[0]?.detail).toEqual({ permissionMode: "acceptEdits", shells: 1, dir: "C:/work/LOCALONLY-parent/repo", name: "LOCALONLY session", subject: { kind: "agent", text: "LOCALONLY task" } });
    expect(r.snapshot.panes[0]?.detail).toEqual({ dir: "C:/work/LOCALONLY-parent/repo" });
    expect(r.ticker.find((l) => l.kind === "tool.start")?.detail).toEqual({ subject: { kind: "file", text: "src/LOCALONLY-file.ts" }, permissionMode: "acceptEdits" });
    expect(JSON.stringify(stripDetail(r.all))).not.toContain("LOCALONLY");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/state/cloud.test.ts src/ingest/levels.test.ts`
Expected: both fail to resolve `../state/cloud`.

- [ ] **Step 3: Write `state/cloud.ts` and export it**

```ts
import { stripDetail } from "../schema/detail";
import { SnapshotSchema, type Snapshot } from "../schema/snapshot";

/**
 * The only snapshot a cloud publisher may send (detail levels design §4): level none, whatever
 * the agent's setting. Validated after the strip, so a publisher cannot pass anything else off as one.
 */
export function toCloudSnapshot(s: Snapshot): Snapshot {
  return SnapshotSchema.parse(stripDetail(s));
}
```

`state/index.ts`, add:

```ts
export * from "./cloud";
```

`index.test.ts`: add `"toCloudSnapshot"` to the pinned list in sorted position (after `"tickSession"`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: PASS. `ext("...\\src")` is undefined for a directory, which is why the Grep hint carries only the permission mode.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/cloud.ts packages/core/src/state/cloud.test.ts packages/core/src/state/index.ts packages/core/src/index.test.ts packages/core/src/ingest/levels.test.ts
git commit -m "feat(core): toCloudSnapshot strips detail, with the four level invariants under test"
```

---

### Task 7: The agent setting, the level into ingest, health, and sinks that strip

**Files:**
- Modify: `apps/agent/src/testing/raw.ts`
- Modify: `apps/agent/src/config.ts`
- Modify: `packages/core/src/schema/transport.ts`
- Modify: `apps/agent/src/http/server.ts`
- Modify: `apps/agent/src/http/sse.ts`
- Modify: `apps/agent/src/store/event-log.ts`
- Test: `apps/agent/src/config.test.ts`, `apps/agent/src/http/server.test.ts`, `apps/agent/src/http/sse.test.ts`, `apps/agent/src/store/event-log.test.ts`

**Interfaces:**
- Consumes: `DetailLevelSchema`, `stripDetail`, `containsDetail` from core.
- Produces: `AgentConfig.detail?: DetailLevel`, `defaultConfig().detail === "none"`, `detailLevel(config): DetailLevel`; `Health.detail?: DetailLevel` (the agent always sends it); `LOCAL_ONLY` and `SESSION_CWD` in `testing/raw.ts`.

- [ ] **Step 1: Split the canaries in the raw test payloads**

`apps/agent/src/testing/raw.ts` becomes:

```ts
/**
 * Raw payloads shaped like the ones measured in docs/spike-hooks.md, carrying two marker families.
 * CANARY marks content: it must never reach any sink at any detail level. LOCAL_ONLY marks paths
 * and names: they may reach responses and the stream inside `detail` at the paths level, and never
 * the event log, the alias file, the config or stdout. The session's directory name, `repo`, is the
 * one part of the path the agent keeps at level none, as the pane label.
 */
export const CANARY = "CANARY";
export const LOCAL_ONLY = "LOCALONLY";
/** The allowlisted root the sessions run under. */
export const ALLOWED_ROOT = "C:/work";
export const SESSION_CWD = "C:/work/LOCALONLY-parent/repo";
export const OUTSIDE_CWD = "C:/private/CANARY-elsewhere";

const content = {
  transcript_path: "C:/Users/someone/.claude/projects/CANARY-project/CANARY-transcript.jsonl",
  permission_mode: "default",
  prompt_id: "prompt-1",
  effort: "high",
  prompt: "CANARY prompt: please read the secret file",
  tool_input: {
    file_path: "C:/work/LOCALONLY-parent/repo/src/LOCALONLY-secret.ts",
    command: "cat CANARY-secret",
    prompt: "CANARY agent prompt",
    pattern: "CANARY pattern",
    query: "CANARY query",
    url: "https://example.test/CANARY-path?q=CANARY",
    subagent_type: "general-purpose",
    description: "LOCALONLY description",
    content: "CANARY file content",
  },
  tool_response: { stdout: "CANARY tool output", file: { content: "CANARY file content" } },
  last_assistant_message: "CANARY assistant reply",
  session_name: "LOCALONLY session name",
  agent_transcript_path: "C:/Users/someone/.claude/CANARY-agent.jsonl",
  error: "CANARY error text",
};

export function rawHook(event: string, sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { session_id: sessionId, cwd: SESSION_CWD, hook_event_name: event, ...content, ...extra };
}

export function rawStatus(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: sessionId,
    cwd: SESSION_CWD,
    transcript_path: content.transcript_path,
    session_name: content.session_name,
    workspace: { current_dir: SESSION_CWD, project_dir: SESSION_CWD },
    model: { id: "claude-opus-5", display_name: "Opus 5" },
    context_window: { used_percentage: 42, remaining_percentage: 58, context_window_size: 200_000 },
    cost: { total_cost_usd: 1.25 },
    rate_limits: { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 20 } },
    version: "2.1.205",
    ...extra,
  };
}

/** One entry of `claude agents --json`, with a session name the agent keeps only at the paths level. */
export function rawAgentEntry(sessionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { pid: 4242, cwd: SESSION_CWD, kind: "interactive", startedAt: 1_757_671_200_000, sessionId, name: content.session_name, ...extra };
}

/** Every modelled hook once, in a plausible order, including an Agent call, both failure hooks and an MCP tool. */
export function rawSessionScript(sessionId: string): Record<string, unknown>[] {
  return [
    rawHook("SessionStart", sessionId, { source: "startup" }),
    rawHook("UserPromptSubmit", sessionId),
    rawHook("PreToolUse", sessionId, { tool_name: "Agent", tool_use_id: "toolu_0" }),
    rawHook("PostToolUse", sessionId, { tool_name: "Agent", tool_use_id: "toolu_0", duration_ms: 30 }),
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

Rename the old constant everywhere it is used:

```bash
cd apps/agent && grep -rl "CANARY_CWD" src | xargs sed -i "s/CANARY_CWD/SESSION_CWD/g"
```

Run: `cd apps/agent && npx vitest run`
Expected: PASS. Nothing reads the new fields yet, and every existing canary check still holds.

- [ ] **Step 2: Write the failing tests**

`config.test.ts`, add `detailLevel` to the import and a test:

```ts
  it("takes a detail level, defaults it to none, and refuses any other value", () => {
    expect(defaultConfig().detail).toBe("none");
    expect(detailLevel({ detail: "paths" })).toBe("paths");
    expect(detailLevel({})).toBe("none");
    expect(AgentConfigSchema.parse({ ...defaultConfig(), detail: "hints" }).detail).toBe("hints");
    const { detail: _detail, ...without } = defaultConfig();
    expect(AgentConfigSchema.parse(without).detail).toBeUndefined();
    expect(() => AgentConfigSchema.parse({ ...defaultConfig(), detail: "content" })).toThrow();
  });
```

If an existing assertion in `config.test.ts` lists the default config in full, add `detail: "none"` to it.

`server.test.ts`, add `LOCAL_ONLY, SESSION_CWD` to the `testing/raw` import and a `describe` at the end:

```ts
describe("detail level", () => {
  it("reports the level in health and lets detail through the sink check", async () => {
    const { port } = await start({ config: { allowlist: [ALLOWED_ROOT], token: TOKEN, corsOrigins: [WEB], detail: "paths" }, sensitive: () => [SESSION_CWD] });
    expect(HealthSchema.parse(JSON.parse((await send(port, { path: "/api/health" })).body)).detail).toBe("paths");
    await hook(port, rawHook("PreToolUse", "s1", { tool_name: "Write", tool_use_id: "t1" }));
    await waitFor(async () => (await send(port, { path: "/api/snapshot" })).body.includes(LOCAL_ONLY));
    const snapshot = SnapshotSchema.parse(JSON.parse((await send(port, { path: "/api/snapshot" })).body));
    expect(snapshot.sessions[0]?.detail).toMatchObject({ dir: SESSION_CWD, subject: { kind: "file", text: "src/LOCALONLY-secret.ts" } });
    expect(snapshot.panes[0]?.detail).toEqual({ dir: SESSION_CWD });
  });

  it("defaults to none: no detail key and no local string in any response", async () => {
    const { port } = await start({ sensitive: () => [SESSION_CWD] });
    expect(HealthSchema.parse(JSON.parse((await send(port, { path: "/api/health" })).body)).detail).toBe("none");
    await hook(port, rawHook("PreToolUse", "s1", { tool_name: "Write", tool_use_id: "t1" }));
    await waitFor(async () => (await send(port, { path: "/api/snapshot" })).body.includes("agent-1"));
    const body = (await send(port, { path: "/api/snapshot" })).body;
    expect(body).not.toContain("detail");
    expect(body).not.toContain(LOCAL_ONLY);
  });
});
```

`sse.test.ts`, add at the end (self-contained fakes, so it does not depend on the file's other helpers):

```ts
describe("stream and detail", () => {
  it("frames a snapshot whose detail holds a live directory, and still refuses that directory outside detail", () => {
    const T = "2026-09-12T10:00:00.000Z";
    const session = { alias: "agent-1", label: "Otter", pane: "pane-1", state: "working" as const, activity: null, subagents: 0, contextPct: null, since: T, updatedAt: T };
    const snapshot = { version: 1 as const, generatedAt: T, panes: [{ pane: "pane-1", label: "Oak" }], sessions: [session] };
    const chunks: string[] = [];
    const res = { writeHead() {}, write: (c: string) => (chunks.push(c), true), end() {}, writableLength: 0, writableEnded: false };
    const log = vi.fn();
    const hub = createStreamHub({ current: () => snapshot, log, sensitive: () => ["C:/work/repo"], minIntervalMs: 0 });
    hub.connect({ on() {} }, res);
    hub.snapshot({ ...snapshot, sessions: [{ ...session, detail: { dir: "C:/work/repo" } }] });
    expect(chunks.join("")).toContain('"dir":"C:/work/repo"');
    expect(log).not.toHaveBeenCalledWith("privacy.blocked");
    hub.snapshot({ ...snapshot, sessions: [{ ...session, label: "C:/work/repo" }] });
    expect(log).toHaveBeenCalledWith("privacy.blocked");
    hub.closeAll();
  });
});
```

Add `vi` to the vitest import of `sse.test.ts` if it is not there.

`event-log.test.ts`, add:

```ts
  it("strips detail before writing and refuses a stored line that carries one", async () => {
    const dir = await tempDir();
    const logger = vi.fn();
    const log = createEventLog(dir, { now: () => DAY1, retentionDays: 7, log: logger, sensitive: () => ["C:/work/repo"] });
    log.append({ ...prompt(DAY1), detail: { dir: "C:/work/repo", name: "Fix login" } });
    await log.flush();
    const text = await readFile(join(dir, logFileName(DAY1)), "utf8");
    expect(text).not.toContain("detail");
    expect(text).not.toContain("C:/work/repo");
    expect(parseFixture(text).events).toEqual([prompt(DAY1)]);
    expect(logger).not.toHaveBeenCalled();
    await appendFile(join(dir, logFileName(DAY1)), JSON.stringify({ ...prompt(DAY1 + 1), detail: { dir: "C:/work/repo" } }) + "\n");
    expect(await log.readRecent()).toEqual([prompt(DAY1)]);
    expect(logger).toHaveBeenCalledWith("privacy.blocked");
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/config.test.ts src/http/server.test.ts src/http/sse.test.ts src/store/event-log.test.ts`
Expected: FAIL. No `detail` in the config or health; the paths snapshot is blocked by the sink check; the log writes the detail.

- [ ] **Step 4: Implement**

`packages/core/src/schema/transport.ts`, import and the health schema:

```ts
import { DetailLevelSchema } from "./detail";
```

```ts
/** `detail` is what the agent's local view may carry (detail levels design §2); an agent always sends it. */
export const HealthSchema = z.object({ ok: z.literal(true), version: z.string(), sessions: z.number().int().nonnegative(), detail: DetailLevelSchema.optional() }).strict();
```

`apps/agent/src/config.ts`, import, schema field, helper and default:

```ts
import { DetailLevelSchema, type DetailLevel } from "@clawd/core";
```

In `AgentConfigSchema`, after `paneLabels`:

```ts
    /** How much of each session's activity the local view may show (detail levels design §2). Absent means none. */
    detail: DetailLevelSchema.optional(),
```

After `usesFolderPaneLabels`:

```ts
/** The configured detail level; none unless set. */
export function detailLevel(config: Pick<AgentConfig, "detail">): DetailLevel {
  return config.detail ?? "none";
}
```

In `defaultConfig`, after `paneLabels: "folder",`:

```ts
    detail: "none",
```

`apps/agent/src/http/server.ts`:

```ts
import { CommandSchema, ENDPOINTS, HealthSchema, containsForbidden, stripDetail, type RedactedEvent, type Snapshot, type TickerEvent } from "@clawd/core";
import { detailLevel, usesFolderPaneLabels, type AgentConfig } from "../config";
```

```ts
  config: Pick<AgentConfig, "allowlist" | "token" | "corsOrigins" | "paneLabels" | "detail">;
```

```ts
  /** Every JSON body is checked for forbidden keys and live directories before it is written. Detail is the one place a directory may live. */
  function send(res: ServerResponse, status: number, body: unknown, headers: Headers = {}): void {
    if (containsForbidden(stripDetail(body), deps.sensitive()) !== null) {
```

```ts
      const ctx = { now: deps.now(), allowlist: deps.config.allowlist, paneNames: usesFolderPaneLabels(deps.config), detail: detailLevel(deps.config) };
```

```ts
      return onlyGet(() => send(res, 200, HealthSchema.parse({ ok: true, version: AGENT_VERSION, sessions: deps.host.sessionCount(), detail: detailLevel(deps.config) }), cors));
```

`apps/agent/src/http/sse.ts`, import `stripDetail` from core and the frame check:

```ts
  function frame(event: string, data: unknown): string | null {
    if (containsForbidden(stripDetail(data), opts.sensitive?.() ?? []) !== null) {
```

`apps/agent/src/store/event-log.ts`, import `containsDetail, stripDetail` from core; `append` and `readRecent`:

```ts
    append(e) {
      // The log is level none whatever the agent's setting: detail never touches the disk.
      const parsed = RedactedEventSchema.safeParse(stripDetail(e));
      if (!parsed.success || containsForbidden(parsed.data, deps.sensitive?.() ?? []) !== null) {
```

```ts
          const parsed = RedactedEventSchema.safeParse(value);
          if (!parsed.success) continue;
          // A line with detail did not come from this log; it is not replayed.
          if (containsDetail(parsed.data)) {
            deps.log("privacy.blocked");
            continue;
          }
          events.push(parsed.data);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/agent && npx vitest run && npx tsc --noEmit && cd ../../packages/core && npx vitest run src/schema/wire.test.ts`
Expected: PASS, including `agent.e2e.test.ts` and `agent.recordings.test.ts` at the default level.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src packages/core/src/schema/transport.ts
git commit -m "feat(agent): a detail setting reaches ingest and health; every sink checks through stripDetail and the log stays level none"
```

---

### Task 8: End to end at every level, and the `detail` subcommand

**Files:**
- Modify: `apps/agent/src/agent.e2e.test.ts`
- Create: `apps/agent/src/detail.ts`
- Modify: `apps/agent/src/cli.ts`
- Test: `apps/agent/src/cli.test.ts`

**Interfaces:**
- Produces: `setDetail({ home, level, print }): Promise<number>`; CLI `agent detail <none|hints|paths>`.

- [ ] **Step 1: Make the end-to-end test run at each level**

In `agent.e2e.test.ts`, import `LOCAL_ONLY` and `SESSION_CWD` from `./testing/raw`, then replace the single `it(...)` with:

```ts
  it.each(["none", "hints", "paths"] as const)("serves the contract, focuses a session, and lets no canary reach any sink at level %s", async (level) => {
    const home = await tempDir();
    const config = { ...defaultConfig(), allowlist: [ALLOWED_ROOT], pollIntervalMs: 1_000, detail: level };
```

Keep the body as it is down to the `sinks` list, then replace the final `for` with:

```ts
    for (const [sink, text] of sinks) expect(text.includes(CANARY), `canary found in ${sink}`).toBe(false);
    for (const [sink, text] of sinks.slice(1)) expect(text.includes(LOCAL_ONLY), `local-only string found in ${sink}`).toBe(false);
    const responses = sinks[0]![1];
    expect(responses.includes(LOCAL_ONLY), "local-only strings in responses").toBe(level === "paths");
    expect(responses.includes('"detail":{'), "detail objects in responses").toBe(level !== "none");
    const parsed = SnapshotSchema.parse(JSON.parse(snapshot.body));
    if (level === "paths") {
      expect(parsed.sessions[1]?.detail).toMatchObject({ name: "LOCALONLY session name", dir: SESSION_CWD, permissionMode: "default" });
      expect(parsed.sessions[0]?.detail?.subject).toEqual({ kind: "file", text: "src/LOCALONLY-secret.ts" });
      expect(parsed.panes[0]?.detail).toEqual({ dir: SESSION_CWD });
    }
    if (level === "hints") expect(parsed.sessions[0]?.detail).toEqual({ permissionMode: "default", shells: 1, subject: { kind: "file", text: "ts" } });
  }, 20_000);
```

The `snapshot` variable is the `/api/snapshot` reply already fetched earlier in the test; it holds both sessions because the long linger keeps the ended one.

Run: `cd apps/agent && npx vitest run src/agent.e2e.test.ts`
Expected: PASS three times. If the `hints` expectation differs only in `shells`, the Stop in the script carries one shell task; check `rawSessionScript` was updated in Task 7.

- [ ] **Step 2: Write the failing CLI test**

`cli.test.ts`, import `agentPaths, readConfig` from `./config` and add:

```ts
  it("sets the detail level in the config and refuses an unknown one", async () => {
    const t = await env();
    expect(await runCli(["detail", "paths"], t.e)).toBe(0);
    expect((await readConfig(agentPaths(t.e.home)))?.detail).toBe("paths");
    expect(t.out.at(-1)).toContain("restart the agent");
    expect(await runCli(["detail", "content"], t.e)).toBe(2);
    expect(await runCli(["detail"], t.e)).toBe(2);
    expect(await runCli(["detail", "hints", "extra"], t.e)).toBe(2);
  });
```

Run: `cd apps/agent && npx vitest run src/cli.test.ts`
Expected: FAIL. `detail` falls to the usage branch and returns 2.

- [ ] **Step 3: Implement the subcommand**

`apps/agent/src/detail.ts`:

```ts
import type { DetailLevel } from "@clawd/core";
import { agentPaths, defaultConfig, readConfig, saveConfig } from "./config";
import type { Print } from "./install/installer";

/** Writes the detail level to config.json, creating the file with defaults when there is none. */
export async function setDetail(req: { home: string; level: DetailLevel; print: Print }): Promise<number> {
  const paths = agentPaths(req.home);
  const base = (await readConfig(paths)) ?? defaultConfig();
  await saveConfig(paths, { ...base, detail: req.level });
  req.print(`detail level set to ${req.level}; restart the agent for it to take effect`);
  return 0;
}
```

`cli.ts`, import, usage and the case:

```ts
import { DetailLevelSchema } from "@clawd/core";
import { setDetail } from "./detail";
```

```ts
export const USAGE = [
  "usage: agent serve",
  "       agent install --allow <dir> [--allow <dir> ...] [--port <n>] [--settings <path>] [--dry-run]",
  "       agent uninstall [--settings <path>]",
  "       agent detail <none|hints|paths>",
].join("\n");
```

```ts
      case "detail": {
        const level = DetailLevelSchema.safeParse(rest[0]);
        if (rest.length !== 1 || !level.success) return usage(env);
        return await setDetail({ home: env.home, level: level.data, print: env.print });
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/agent && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src
git commit -m "feat(agent): the end-to-end canaries run at every level; agent detail sets the level"
```

---

### Task 9: The web app shows the level, the subject and the header fields

**Files:**
- Modify: `apps/web/src/lib/feed/agent.ts`
- Modify: `apps/web/src/lib/feed/types.ts`
- Modify: `apps/web/src/lib/feed/policy.ts`
- Modify: `apps/web/src/hooks/use-feed.ts`
- Modify: `apps/web/src/lib/labels.ts`
- Modify: `apps/web/src/lib/ticker/format.ts`
- Modify: `apps/web/src/components/detail-sheet.tsx`
- Test: `apps/web/src/lib/feed/agent.test.ts`, `apps/web/src/lib/feed/policy.test.ts`, `apps/web/src/lib/labels.test.ts`, `apps/web/src/lib/ticker/format.test.ts`

**Interfaces:**
- Consumes: `Health.detail`, `TickerEvent.detail`, `SessionSnapshot.detail` from core.
- Produces: `probeHealth(): Promise<Health | null>`; `PolicyEvent` probe gains `detail?: DetailLevel`; `PolicyState.detail`; `FeedStatus` live gains `detail: DetailLevel`.

- [ ] **Step 1: Write the failing tests**

`agent.test.ts`, replace the probe test:

```ts
  it("probes health and returns the Health body only when it validates", async () => {
    expect(await probeHealth(BASE, respond({ ok: true, version: "0.1.0", sessions: 2 }))).toEqual({ ok: true, version: "0.1.0", sessions: 2 });
    expect(await probeHealth(BASE, respond({ ok: true, version: "0.1.0", sessions: 2, detail: "paths" }))).toMatchObject({ detail: "paths" });
    expect(await probeHealth(BASE, respond({ ok: true, version: "0.1.0", sessions: 2, extra: 1 }))).toBeNull();
    expect(await probeHealth(BASE, respond({ ok: true }, 500))).toBeNull();
    expect(await probeHealth(BASE, async () => { throw new TypeError("refused"); })).toBeNull();
  });
```

`policy.test.ts`, add:

```ts
  it("keeps the agent's detail level from the probe and reports none when it sent none", () => {
    const r = run("auto", [{ type: "start" }, { type: "probe", ok: true, detail: "paths" }]);
    expect(toFeedStatus(r.state, "http://127.0.0.1:4750")).toMatchObject({ mode: "live", detail: "paths" });
    const plain = run("auto", [{ type: "start" }, { type: "probe", ok: true }]);
    expect(toFeedStatus(plain.state, "http://127.0.0.1:4750")).toMatchObject({ mode: "live", detail: "none" });
  });
```

`labels.test.ts`, replace the source badge test:

```ts
  it("names the source in the status bar, with the detail level when above none", () => {
    const live = { mode: "live" as const, agentUrl: "http://127.0.0.1:4750", connected: true, rejected: 0, detail: "none" as const };
    expect(sourceBadge({ mode: "probing" })).toBe("probing for agent");
    expect(sourceBadge(live)).toBe("live · 127.0.0.1:4750");
    expect(sourceBadge({ ...live, rejected: 3 })).toBe("live · 127.0.0.1:4750 · 3 rejected");
    expect(sourceBadge({ ...live, detail: "paths" })).toBe("live · 127.0.0.1:4750 · paths");
    expect(sourceBadge({ ...live, detail: "hints", rejected: 1 })).toBe("live · 127.0.0.1:4750 · hints · 1 rejected");
    expect(sourceBadge({ ...live, connected: false })).toBe("live · reconnecting");
    expect(sourceBadge({ mode: "simulated", reason: "no-agent" })).toBe("simulated · no agent");
    expect(sourceBadge({ mode: "simulated", reason: "lost-agent" })).toBe("simulated · agent lost");
    expect(sourceBadge({ mode: "simulated", reason: "forced" })).toBe("simulated · forced");
  });
```

`format.test.ts`, add:

```ts
  it("appends the subject after the tool, dimmed and cut, and never the permission mode", () => {
    const line = stripAnsi(formatTicker({ t: T, kind: "tool.start", activity: "edit", tool: "Edit", detail: { subject: { kind: "file", text: "src/app.ts" }, permissionMode: "plan" } }));
    expect(line).toContain("Edit");
    expect(line).toContain("src/app.ts");
    expect(line).not.toContain("plan");
    const long = stripAnsi(formatTicker({ t: T, kind: "tool.end", activity: "read", tool: "Read", durationMs: 1, detail: { subject: { kind: "file", text: "x".repeat(80) } } }));
    expect(long).toContain(`${"x".repeat(47)}…`);
    expect(long).not.toContain("x".repeat(48));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/lib`
Expected: FAIL. `probeHealth` returns a boolean; the policy has no `detail`; the badge ignores it; the ticker line has no subject.

- [ ] **Step 3: Implement**

`lib/feed/agent.ts`, import `Health` and replace `probeHealth`:

```ts
import { CommandSchema, DEFAULT_AGENT_URL, ENDPOINTS, HealthSchema, TickerEventSchema, type Command, type Health, type TickerEvent } from "@clawd/core";
```

```ts
/** The agent's Health when it answers with a valid body within the timeout, else null. */
export async function probeHealth(base: string, fetchFn: FetchLike = defaultFetch, timeoutMs = PROBE_TIMEOUT_MS): Promise<Health | null> {
  try {
    const res = await fetchFn(`${base}${ENDPOINTS.health}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const parsed = HealthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

`lib/feed/types.ts`:

```ts
import type { DetailLevel, Snapshot, TickerEvent } from "@clawd/core";
```

```ts
  /** `rejected` counts stream messages that failed schema validation and were dropped. `detail` is the agent's level. */
  | { mode: "live"; agentUrl: string; connected: boolean; rejected: number; detail: DetailLevel }
```

`lib/feed/policy.ts`:

```ts
import type { DetailLevel } from "@clawd/core";
import type { FeedStatus, SimulatedReason } from "./types";
```

```ts
export type PolicyState = {
  mode: SourceMode;
  phase: PolicyPhase;
  connected: boolean;
  rejected: number;
  reason: SimulatedReason | null;
  /** The agent's detail level from the last successful probe; none until one answers. */
  detail: DetailLevel;
};

export type PolicyEvent =
  | { type: "start" }
  | { type: "probe"; ok: boolean; detail?: DetailLevel }
```

```ts
export function initialPolicy(mode: SourceMode): PolicyState {
  return { mode, phase: "probing", connected: false, rejected: 0, reason: null, detail: "none" };
}
```

In the `probe` case:

```ts
      if (e.ok) return { state: { ...s, phase: "live", connected: false, rejected: 0, reason: null, detail: e.detail ?? "none" }, effects: ["start-live", "schedule-grace"] };
```

In `toFeedStatus`:

```ts
    case "live":
      return { mode: "live", agentUrl, connected: s.connected, rejected: s.rejected, detail: s.detail };
```

`hooks/use-feed.ts`, the probe effect:

```ts
        case "probe":
          void probeHealth(base).then((health) => dispatch({ type: "probe", ok: health !== null, ...(health?.detail === undefined ? {} : { detail: health.detail }) }));
          break;
```

`lib/labels.ts`, the live branch:

```ts
    case "live": {
      if (!status.connected) return "live · reconnecting";
      const parts = ["live", hostOf(status.agentUrl)];
      if (status.detail !== "none") parts.push(status.detail);
      if (status.rejected > 0) parts.push(`${status.rejected} rejected`);
      return parts.join(" · ");
    }
```

`lib/ticker/format.ts`, a constant, a helper and the tool case:

```ts
/** Longest subject a line shows; a path longer than this is cut with an ellipsis. */
const SUBJECT_MAX = 48;

function cutText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
```

```ts
      if (e.tool) parts.push(plain(e.tool).padEnd(12));
      if (e.detail?.subject) parts.push(dim(plain(cutText(e.detail.subject.text, SUBJECT_MAX))));
      if (e.durationMs !== undefined) parts.push(dim(`${Math.round(e.durationMs)}ms`));
```

Update the comment at the top of `format.ts`: the strings are the fields `TickerEvent` carries, "and the subject its detail may carry".

`components/detail-sheet.tsx`, the title and a line under the badges:

```tsx
            <SheetTitle className="font-bold text-clawd">{session ? (session.detail?.name ?? session.label.toLowerCase()) : alias}</SheetTitle>
```

After the closing `</SheetDescription>` and before `</div>`:

```tsx
            {session?.detail ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {session.detail.dir ? <span className="truncate">{session.detail.dir}</span> : null}
                {session.detail.permissionMode ? <Badge variant="outline">{session.detail.permissionMode}</Badge> : null}
                {session.detail.shells ? <span>{session.detail.shells} background shells</span> : null}
              </div>
            ) : null}
```

- [ ] **Step 4: Run the tests, the type check and the lint**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit && npx eslint .`
Expected: PASS, no errors. Then `pnpm dev` with an agent at `paths` and click a session: the sheet shows the name, the directory and the mode, and ticker lines carry the subject.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): the source badge shows the detail level; ticker lines and the sheet header show what detail carries"
```

---

### Task 10: The scene shows the real name and a caption

**Files:**
- Modify: `packages/scene/src/layout.ts`
- Modify: `packages/scene/src/text.ts`
- Modify: `packages/scene/src/actors.ts`
- Modify: `packages/scene/src/panes.ts`
- Test: `packages/scene/src/text.test.ts`, `packages/scene/src/actors.test.ts`, `packages/scene/src/panes.test.ts`

**Interfaces:**
- Consumes: `SessionSnapshot.detail`, `Subject`, `Activity` from core.
- Produces: `CAPTION_ROW = 21`; `ACTIVITY_COLOURS: Record<Activity, string>`; `nameplate()` takes `name?: string | null`; `caption(subject, max): string`; `Actor.name: string | null`, `Actor.subject: Subject | null`.

- [ ] **Step 1: Write the failing tests**

`text.test.ts`, import `ACTIVITY_COLOURS, caption` and add:

```ts
  it("shows the session's real name on the nameplate when it has one", () => {
    expect(nameplate({ label: "Otter", name: "Fix Login", state: "working", activity: "edit", subagents: 0, since: T0 }, T0).name).toBe("fix login");
    expect(nameplate({ label: "Otter", name: null, state: "working", activity: "edit", subagents: 0, since: T0 }, T0).name).toBe("otter");
  });

  it("captions a file by its last two segments and cuts anything to the width", () => {
    expect(caption({ kind: "file", text: "src/lib/feed/agent.ts" }, 40)).toBe("feed/agent.ts");
    expect(caption({ kind: "file", text: "app.ts" }, 40)).toBe("app.ts");
    expect(caption({ kind: "file", text: "ts" }, 40)).toBe("ts");
    expect(caption({ kind: "program", text: "git" }, 40)).toBe("git");
    expect(caption({ kind: "host", text: "example.com" }, 8)).toBe("example…");
    expect(caption({ kind: "agent", text: "Find the login form" }, 1)).toBe("…");
    expect(ACTIVITY_COLOURS.edit).toBe(PALETTE.state.green);
  });
```

`actors.test.ts`, add to the `reconcile` describe:

```ts
  it("copies the name and subject from the session's detail, and clears them when a later snapshot has none", () => {
    const detailed = session({ alias: "agent-1", detail: { name: "Fix login", subject: { kind: "file", text: "src/app.ts" } } });
    const w = reconcile(emptyWorld(), snap([detailed]), T0);
    expect(w.actors[0]).toMatchObject({ name: "Fix login", subject: { kind: "file", text: "src/app.ts" } });
    reconcile(w, snap([session({ alias: "agent-1" })]), T0 + 1);
    expect(w.actors[0]).toMatchObject({ name: null, subject: null });
  });
```

`panes.test.ts`, add:

```ts
  it("captions a working Clawd with its subject and leaves an idle one without", () => {
    const h = harness();
    const working = { ...SNAPSHOT.sessions[0]!, state: "working" as const, activity: "edit" as const, detail: { name: "Fix Login", subject: { kind: "file" as const, text: "src/lib/feed/agent.ts" } } };
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [working] });
    h.setNow(T0 + 5000);
    h.frame(0);
    h.frame(100);
    expect(h.texts.some((t) => t.text === "fix login")).toBe(true);
    const cap = h.texts.find((t) => t.text === "feed/agent.ts");
    expect(cap?.col).toBe(PALETTE.state.green);
    h.reset();
    h.scene.setSnapshot({ ...SNAPSHOT, sessions: [{ ...working, state: "idle", activity: null }] });
    h.setNow(T0 + 10_000);
    h.frame(200);
    h.frame(300);
    expect(h.texts.some((t) => t.text === "feed/agent.ts")).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/scene && npx vitest run`
Expected: FAIL. No `caption`, no `ACTIVITY_COLOURS`, actors have no `name` or `subject`, the nameplate ignores the name.

- [ ] **Step 3: Implement**

`layout.ts`, after `CONTEXT_W`:

```ts
/** The caption row inside the seat: what the session is working on, when the detail level says. */
export const CAPTION_ROW = 21;
```

`text.ts`, imports, colours, the nameplate and the caption:

```ts
import type { Activity, SessionPhase, Subject } from "@clawd/core";
```

```ts
/** Caption colours by activity, matching the ticker's. */
export const ACTIVITY_COLOURS: Record<Activity, string> = {
  read: PALETTE.state.blue,
  edit: PALETTE.state.green,
  run: PALETTE.state.amber,
  web: PALETTE.state.pink,
  spawn: PALETTE.clawd.body,
  think: PALETTE.night.text,
  other: PALETTE.night.text,
};
```

```ts
/** Two lines under a Clawd: the name (the session's own when the detail level gives one) with its subagent count, then state, activity and time in state. */
export function nameplate(a: { label: string; name?: string | null; state: SessionPhase; activity: Activity | null; subagents: number; since: number }, now: number): Nameplate {
  const activity = a.state === "working" && a.activity ? `·${a.activity}` : "";
  return {
    name: (a.name ?? a.label).toLowerCase(),
```

```ts
/** The caption under a working Clawd: a file's last two segments, anything else as it is, cut with an ellipsis to `max` characters. */
export function caption(subject: Subject, max: number): string {
  const text = subject.kind === "file" ? subject.text.split("/").filter((s) => s.length > 0).slice(-2).join("/") : subject.text;
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}
```

`actors.ts`, the import, the `Actor` type, the creation and the update:

```ts
import type { Activity, SessionPhase, Snapshot, Subject } from "@clawd/core";
```

In `Actor`, after `contextPct`:

```ts
  /** From the session's detail, when the agent's level gives them. */
  name: string | null;
  subject: Subject | null;
```

In the `a = { ... }` literal, after `contextPct: ss.contextPct,`:

```ts
        name: ss.detail?.name ?? null,
        subject: ss.detail?.subject ?? null,
```

After `a.contextPct = ss.contextPct;`:

```ts
    a.name = ss.detail?.name ?? null;
    a.subject = ss.detail?.subject ?? null;
```

`panes.ts`, imports and the caption after the status row:

```ts
import { CAPTION_ROW, CELL, CONTEXT_ROW, CONTEXT_W, NAME_ROW, SEAT_H, SEAT_W, SPRITE_DX, SPRITE_DY, STATUS_ROW, layoutPanes, type PaneRect } from "./layout";
import { ACTIVITY_COLOURS, caption, drawText, nameplate, paneTitle } from "./text";
```

```ts
      drawText(ctx, PX, np.status, cx, sy + STATUS_ROW, np.colour, { size: textPx, font, align: "center" });
      if (a.subject && (a.state === "working" || a.state === "waiting")) {
        const max = Math.max(4, Math.floor((SEAT_W * PX) / (textPx * GLYPH_W)) - 1);
        const col = a.activity ? ACTIVITY_COLOURS[a.activity] : PALETTE.night.text;
        drawText(ctx, PX, caption(a.subject, max), cx, sy + CAPTION_ROW, col, { size: textPx, font, align: "center" });
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/scene && npx vitest run && npx tsc --noEmit`
Expected: PASS. Then `pnpm dev` with an agent at `paths`: a working Clawd shows its file, program or host under the status line, and its real name on the plate.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src
git commit -m "feat(scene): the nameplate shows the session's real name and a caption says what it is working on"
```

---

### Task 11: Documents and the full verification

**Files:**
- Modify: `docs/PRD.md`
- Modify: `docs/superpowers/specs/2026-09-12-local-agent-design.md`
- Modify: `apps/agent/README.md`
- Modify: `packages/core/README.md`
- Modify: `README.md`

- [ ] **Step 1: Edit the PRD**

In section 1, replace the sentence that begins "It costs zero model tokens, and no session content is ever displayed or transmitted" with:

> It costs zero model tokens. Session content is never displayed or transmitted; an opt-in local detail level may add file paths and session names to the view on this machine, and the cloud only ever receives the anonymised form.

Replace goal 3 with:

> 3. **Private by construction.** Prompt text, tool inputs and outputs and assistant messages are stripped by the local agent at ingest at every level. Nothing downstream can display them because nothing downstream receives them. The local view may name a pane after its directory's last segment and, when the `detail` setting is `hints` or `paths`, show what a session is working on (FR-9a); the cloud always receives level `none`, an anonymised summary of categories only, with generated pane names.

Replace the first non-goal with:

> - Displaying or transmitting prompts, tool inputs or outputs, or assistant text, anywhere, at any detail level. This is a hard boundary, not a later feature. Paths and session names are local-only and opt-in (FR-9a).

After FR-9, add:

> - **FR-9a** Detail levels. An agent setting `detail` with values `none` (default), `hints` and `paths`, cumulative, decides what an event may carry beyond FR-9 in an optional `detail` object. `hints`: the program name of a shell command, the extension of a file read or edited, the hostname of a fetch, the subagent type of an Agent call, the permission mode, the number of background shells. `paths`: the file or directory a tool touches relative to the working directory, the working directory, the session's name, an Agent call's short description. The event log and any cloud snapshot are always level `none`: core's `stripDetail` removes every `detail` key, and four invariants are proven by test (detail levels design §4).

In FR-27, after "and context percentage." add:

> Above level `none`, a tool line also shows its subject: the file, program, host or agent (FR-9a).

Append to the decision log table:

```
| 14 Sep 2026 | Detail levels: an opt-in agent setting adds hints or paths to the local view; the event log and the cloud stay at level none through one strip function with invariant tests. Content is never read at any level. |
```

- [ ] **Step 2: Edit the agent design's privacy rules**

In section 2, replace rule 2's second sentence "Each outgoing wire payload is validated against its core schema and checked with `containsForbidden()` before it is written." with:

> Each outgoing wire payload is validated against its core schema and checked with `containsForbidden(stripDetail(payload), …)` before it is written: outside a `detail` object nothing forbidden may appear at any level.

Replace the last sentence of rule 8 "Test sessions run in `C:/work/CANARY-parent/repo`, so the canary check still covers the rest of the path." with:

> Test sessions run in `C:/work/LOCALONLY-parent/repo`; the `CANARY` marker is content that must never appear, and `LOCALONLY` marks paths and names that may appear only inside `detail` at the paths level.

Append after rule 8:

```
9. **Detail is bounded by the level.** `config.detail` (`none`, `hints`, `paths`; absent means
   `none`) decides what ingest keeps in an event's `detail` object (detail levels design §2). At
   `none` no event carries the key, so that level's wire format is unchanged. `prompt`,
   `tool_input.prompt`, `.pattern`, `.query`, `tool_response`, `last_assistant_message` and the
   transcript paths are never read at any level.
10. **The log and the cloud are level none.** `eventLog.append` writes `stripDetail(e)` and
    `readRecent` refuses a line carrying `detail`. A cloud publisher may send only
    `toCloudSnapshot(s)`.
11. **Four invariants under test.** Level none is today; nothing forbidden outside `detail` at any
    level; the log and the cloud strip; hints validate against the strict hints schema, whose
    strings refuse separators. `packages/core/src/ingest/levels.test.ts` and
    `apps/agent/src/agent.e2e.test.ts` (run at every level) prove them with the two marker families.
```

- [ ] **Step 3: Edit the READMEs**

`apps/agent/README.md`: in the endpoints table, change the health row to:

```
| `GET /api/health` | `{ ok, version, sessions, detail }` |
```

In the files table, the `config.json` row becomes:

```
| `config.json` | port, allowlist, token, CORS origins, poll interval, the wrapped status line, the detail level |
```

After the Run section add:

```
## Detail levels

By default the agent keeps only states, categories, tool names and timings. `agent detail hints`
adds the program a shell command runs, the extension of a file being read or edited, the hostname
of a fetch, the subagent type, the permission mode and the background shell count. `agent detail
paths` adds the file or directory a tool touches (relative to the working directory), the working
directory and the session's name. `agent detail none` turns it back off. Restart the agent after
changing it.

Whatever the level, the event log on disk and any cloud snapshot are level none, and prompts,
commands, tool output and assistant text are never read. Design:
`docs/superpowers/specs/2026-09-14-detail-levels-design.md`.
```

Under Privacy, after "every outgoing body is checked before it is written," add "outside its `detail` object,".

`packages/core/README.md`, line 9's `ingest/` row: append " `IngestContext.detail` sets the level; `schema/detail.ts` holds the level enum, the detail schemas and `stripDetail()`; `toCloudSnapshot()` is the only snapshot a publisher may send."

Root `README.md`: in the paragraph beginning "It costs zero model tokens", replace "No session content is ever displayed or transmitted." with "Prompts, tool inputs and outputs and assistant text are never displayed or transmitted. An opt-in `detail` setting on the agent can add file paths and session names to the local view only; the cloud always gets the anonymised form."

- [ ] **Step 4: Run the whole repository**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: every package passes; the Next build succeeds.

- [ ] **Step 5: Commit**

```bash
git add docs/PRD.md docs/superpowers/specs/2026-09-12-local-agent-design.md apps/agent/README.md packages/core/README.md README.md
git commit -m "docs: detail levels in the PRD, the agent design privacy rules and the READMEs"
```

Then hand the branch back with the finishing-a-development-branch skill: the merge into `main` is the maintainer's call.
