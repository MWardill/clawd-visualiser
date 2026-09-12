# Core contract design (`packages/core`)

Milestone M1 of [the PRD](../../PRD.md). This package is the fork point: once it exists and its
tests pass, the web app and the local agent can be built concurrently against it without either
needing the other to run.

## 1. Purpose and scope

`@clawd/core` holds everything both halves must agree on:

- the **schemas** that cross the wire: snapshot, ticker event, command;
- the **redacted event** model that the agent produces from raw Claude Code payloads and that every
  reducer consumes;
- **ingest redaction**, the function that turns a raw hook or status line payload into a redacted
  event, and the allowlist that defines it;
- the **state machine**: per-session reducer, fleet reducer, timers, and snapshot derivation;
- **aliasing** helpers: animal names, pane keys;
- the **source interface** plus two synthetic sources, simulated and replay;
- **fixtures**: recorded, redacted event logs used by every test.

Out of scope for this package: any I/O. No HTTP, no file system, no timers of its own, no DOM. The
agent and the web app wrap it. `zod` is the only runtime dependency.

## 2. Package layout

```
packages/core/src/
  index.ts                 public exports
  schema/
    snapshot.ts            Snapshot, PaneSnapshot, SessionSnapshot (zod + inferred types)
    ticker.ts              TickerEvent
    command.ts             Command (focus, and room for more)
    events.ts              RedactedEvent union
    raw.ts                 shapes of raw hook / status line / agents-list payloads, loosely typed
  ingest/
    redact.ts              redact(raw, context) -> RedactedEvent | null
    allowlist.ts           directory allowlist matching
    categories.ts          tool name -> activity category
  state/
    session.ts             reduceSession(state, event, now) -> state
    fleet.ts               reduceFleet(fleet, event, now); tick(fleet, now)
    snapshot.ts            deriveSnapshot(fleet, aliases, now) -> Snapshot
    ticker.ts              toTickerEvent(event, prev) -> TickerEvent | null
    config.ts              thresholds with defaults
  alias/
    names.ts               label list and assignment
    pane.ts                paneKey(cwd) hashing
  sources/
    source.ts              Source interface
    simulated.ts           seeded fleet that emits RedactedEvents
    replay.ts              plays a fixture back with scaled timing
  fixtures/
    *.jsonl                redacted recordings
    load.ts                parse and validate a fixture
```

Each folder exports through `index.ts`; nothing imports across folders except through those
barrels. The reducers are pure: state in, state out, `now` passed in as a number of milliseconds.

## 3. Data model

### 3.1 Redacted events

The internal event type. Produced only by `redact()` and the synthetic sources; consumed by the
reducers and by the ticker. Every variant carries:

```ts
type Base = {
  v: 1;                 // event schema version
  t: number;            // epoch milliseconds
  sessionId: string;    // Claude Code's session id; local only, never in a snapshot
  paneKey: string;      // hash of the working directory; local only
  agentId?: string;     // present when the event came from a subagent
};
```

Variants, with their extra fields:

| `kind` | Fields | From |
| --- | --- | --- |
| `session.start` | `source?: string` | command hook on SessionStart |
| `session.end` | `reason: string` | SessionEnd |
| `prompt` | | UserPromptSubmit |
| `tool.start` | `tool: string`, `category`, `toolUseId: string` | PreToolUse |
| `tool.end` | `tool`, `category`, `toolUseId`, `durationMs: number` | PostToolUse |
| `permission.request` | `tool`, `category` | PermissionRequest |
| `permission.denied` | `tool?` | PermissionDenied |
| `stop` | `backgroundTasks: number` | Stop, counting only the `background_tasks` entries of type `subagent`; a background shell is not work the session waits on |
| `subagent.start` | `agentId`, `agentType: string` | SubagentStart |
| `subagent.stop` | `agentId`, `agentType` | SubagentStop |
| `status` | `contextPct?: number`, `costUsd?: number`, `rateLimit5h?: number`, `rateLimit7d?: number`, `model?: string` | status line command |
| `presence` | `alive: boolean` | `redactPresence()` over one agents-list entry, one per known session |

`tool` is the built-in tool name, or `"mcp"` for any MCP tool (open question 5 in the PRD).
`category` is derived by `categories.ts`: `read`, `edit`, `run`, `web`, `spawn`, `other`.

Internal helper subagents, a `SubagentStop` with an empty `agent_type`, are dropped at ingest.

### 3.2 Wire schemas

As in PRD section 8, expressed as zod schemas so both the agent (on send) and the web app (on
receive) validate against the same definition. Types are inferred from the schemas; nothing is
declared twice.

```ts
Snapshot        { version: 1, generatedAt, panes: PaneSnapshot[], sessions: SessionSnapshot[], ext? }
PaneSnapshot    { pane, label, collision }
SessionSnapshot { alias, label, pane, state, activity, subagents, contextPct, since, updatedAt, ext? }
TickerEvent     { t, kind, activity?, tool?, durationMs?, agentType?, state?, contextPct?, reason? }
Command         { type: "focus", alias } | { type: "ping" }
```

Schemas use `.strict()` on the wire types so unknown top-level fields fail validation, and `ext` is
the sanctioned place for extras. `ext` is `z.record(z.unknown()).optional()` and is stripped before
publishing in cloud mode.

### 3.3 Raw payloads

`raw.ts` describes the hook payloads as measured in `docs/spike-hooks.md`, but loosely:
`z.object({...})` on the handful of fields we read, so a new Claude Code version adding fields
never breaks ingest. The schemas parse in zod's default strip mode rather than passthrough, so
parsing is itself the first redaction step: every field we never named is gone before ingest reads
the payload. Fields we never read are never typed, which keeps them out of the code by
construction. The status line is the loosest of them: every section and every figure is optional
and nullable, since a session reports nulls before its first turn.

## 4. Ingest redaction

```ts
type IngestContext = { now: number; allowlist: string[] };
function redact(raw: unknown, ctx: IngestContext): RedactedEvent | null;
```

- Determines the hook event from `hook_event_name` (or the status line shape), parses with the
  matching raw schema, and returns the redacted variant with only the allowlisted fields copied.
- Returns `null` for sessions whose `cwd` is outside the allowlist, for internal helper subagents,
  and for events we don't model, such as `MessageDisplay`.
- Never copies `prompt`, `tool_input`, `tool_response`, `last_assistant_message`,
  `transcript_path`, `agent_transcript_path`, `session_name`, `cwd` (it becomes `paneKey`), or the
  status line's `workspace`. These names form the **forbidden list** exported for tests.

`redactPresence(entry, alive, ctx)` is the same function for the presence poll: it parses one
agents-list entry, keeps only `sessionId` and the pane key its `cwd` hashes to, and returns a
`presence` event or null. The entry's `name` is session-name content and is never named in the
schema.

`paneKey(cwd)` is a 64-bit FNV-1a hash of the normalised path, rendered as hex. It is an internal
key, never published; the snapshot carries the pane alias. Hashing is not for secrecy, it is so the
path never appears in any log line.

The redaction test feeds every raw fixture through `redact()` and asserts, for every produced event,
that JSON-serialising it contains none of the forbidden keys and none of the recorded cwd or
transcript path strings.

## 5. State machine

### 5.1 Session state

```ts
type SessionState = {
  sessionId: string;
  paneKey: string;
  state: "working" | "waiting" | "idle" | "asleep" | "done";
  activity: Activity | null;
  since: number;              // when `state` began
  lastEventAt: number;
  waitingOn: string | null;   // toolUseId of the pending permission
  inFlight: { toolUseId: string; tool: string }[];  // parent tool calls started, not yet ended
  backgroundTasks: number;
  subagents: Set<string>;     // live agent ids
  contextPct: number | null;
  firstSeenAt: number;        // set once, never changed; the snapshot's sort key
  displayHold: { state: SessionState["state"]; until: number } | null;  // min display duration
};
```

Two tool calls can be in flight at once, so `inFlight` is a list and not a single id; it is what a
`PermissionRequest`, which carries no `tool_use_id` of its own, is matched against.

### 5.2 Transitions

`reduceSession(s, e, now)` implements PRD section 9 exactly:

| From | Event | To |
| --- | --- | --- |
| any but done | `prompt` | working |
| working | `tool.start` / `tool.end` | working, activity updated (`think` between tool.end and the next event) |
| any but done, not already waiting | `permission.request` | waiting. `waitingOn` is the request's own `tool_use_id` when it has one, else the newest call in flight with the same tool name, else the newest call in flight, else null (asleep and idle cover a request that arrives before, or long after, its prompt event) |
| waiting | `tool.end` with that toolUseId, or any `tool.end` when no id was resolved, or `permission.denied` | working |
| working or waiting | `stop` with no subagent tasks and no live subagents | idle; any wait ends |
| working or waiting | `stop` with subagent tasks | working, activity `spawn`; any wait ends |
| idle | `tick` past `asleepAfterMs` | asleep |
| idle / asleep | `prompt` | working |
| any | `session.end`, or `presence.alive === false` | done |

A `stop` carries Claude Code's own `background_tasks`, and on that question it is authoritative:
a count of zero clears the locally tracked subagent set, so a `SubagentStop` we never received
cannot wedge the parent on `spawn` for the rest of its life. A `stop` also ends a wait whose
`PostToolUse` never arrived.

`subagent.start` and `subagent.stop` update the set and never change `state`. `status` updates
`contextPct`. `tool.start` inside a subagent (`agentId` set) updates `activity` to `spawn` on the
parent rather than the tool's own category, so the parent reads as "running subagents".

Timers live in `tick(fleet, now)`, called by the host on an interval: it applies the asleep
threshold. Minimum display duration works in two halves: when the reducer changes `state` it
records the previous state in `displayHold` with `until = now + minDisplayMs`, and
`deriveSnapshot` reports that held state until `until` has passed, then the real one. `since`
always reflects the real transition time, so the nameplate clock is never wrong by the hold.

### 5.3 Fleet

```ts
type Fleet = { sessions: Map<string, SessionState>; panes: Map<string, PaneState> };
function reduceFleet(f: Fleet, e: RedactedEvent, now: number): Fleet;
function tick(f: Fleet, now: number): Fleet;
```

Panes are created on the first event for a paneKey and dropped when their last session has been
`done` for `doneLingerMs`. `done` sessions themselves linger for the same period so the view can
play the exit, then are removed.

### 5.4 Snapshot derivation

```ts
function deriveSnapshot(f: Fleet, aliases: AliasMap, now: number): Snapshot;
```

Applies display holds, maps session ids and pane keys to aliases and labels, sorts panes and
sessions by first appearance (sessions tie-breaking on session id, so the order is deterministic
and a state change never reshuffles the fleet), and validates the result against the schema before
returning it.
`deriveSnapshot` is where the local-only identifiers are left behind.

### 5.5 Ticker

`toTickerEvent(e, prevState, nextState)` maps a redacted event to zero or one `TickerEvent`, adding
a synthetic `state` line whenever the reducer changed the session's state. This is the only source
of ticker lines, so the ticker can never carry more than the redacted event does.

`applyEvent(fleet, e, now, cfg)` is the one call a host makes per event. It reduces the fleet and
returns `{ fleet, before, after, ticker }`: the session as it was, the session as it is, and the
ticker lines derived from that same pair, so no host has to keep the two halves in step itself.

## 6. Aliases

- `names.ts`: a fixed list of about sixty animal names. `assignLabel(map, sessionId)` returns the
  existing label or picks the next unused one; the map is a plain object so the agent can persist it
  as JSON.
- Aliases are `agent-<n>` and `pane-<n>` with monotonically increasing `n`, also from the map.
- The map type is `AliasMap = { sessions: Record<sessionId, { alias, label }>, panes: Record<paneKey, { alias, label }>, next: number }`.

## 7. Sources

```ts
type Sink = (e: RedactedEvent) => void;
interface Source { start(sink: Sink): () => void }   // returns stop
```

- **Simulated** (`simulated.ts`): a seeded, deterministic fleet like the proof of concept's, but it
  emits *redacted events* rather than moving sprites, so the web app in simulated mode runs the
  same reducer as live mode. Options: seed, session count, speed. Uses an injected clock so tests
  can step it.
- **Replay** (`replay.ts`): reads a fixture and emits its events with the recorded gaps scaled by a
  speed factor, or all at once when speed is `Infinity` for tests.

The agent's live source is not in core; it is the agent's HTTP receivers calling `redact()` and
feeding the same sink.

## 8. Transport contract

Defined here as types and documented endpoint shapes; implemented by the agent, consumed by the
web app.

| Endpoint | Shape |
| --- | --- |
| `GET /api/snapshot` | current `Snapshot` as JSON |
| `GET /api/stream` | SSE. `event: snapshot` with a full `Snapshot` on connect and whenever it changes, debounced to at most four a second. `event: ticker` with `{ alias, event: TickerEvent }`. Heartbeat comment every 15 s. |
| `GET /api/ticker/:alias` | last 200 `TickerEvent`s for a session, for the detail pane's backfill |
| `POST /api/command` | a `Command`; `202` when accepted |
| `GET /api/health` | `{ ok: true, version, sessions }` |

Default agent address `http://127.0.0.1:4750`, overridable by the web app through
`NEXT_PUBLIC_AGENT_URL`. The agent sends CORS headers for the web app's origin. When the web app
cannot reach an agent it falls back to the simulated source and says so in the status bar.

Cloud mode (M6) publishes the same `Snapshot` to Redis with `ext` stripped and tool names already
reduced to categories; it never publishes ticker events.

## 9. Fixtures

- Source recordings are the spike's `spike-events.jsonl` files (headless and interactive). A
  one-off script in `tools/` runs them through `redact()` with a test allowlist and writes
  `packages/core/src/fixtures/spike-headless.jsonl` and `spike-interactive.jsonl`.
- Before writing, the script scrubs what redaction legitimately keeps but a committed file must
  not carry: session, tool-use and agent ids are renumbered in order of first appearance as
  `rec-n`, `use-n` and `sub-n`, and `status` events lose `costUsd`, `rateLimit5h` and `rateLimit7d`.
  The golden test asserts that none of those survive.
- Fixture format is one `RedactedEvent` per line, plus a first line `{"fixture": 1, "name": ...}`.
- The raw recordings never enter the repo; `.gitignore` already excludes them.
- Two hand-written fixtures cover what the spike did not: a permission denial and a kill without
  `session.end`.

## 10. Tests

All Vitest, all pure:

- **Schemas:** every fixture event parses; a snapshot with an unknown top-level field is rejected;
  `ext` passes through.
- **Redaction:** the forbidden-list property over every raw fixture payload.
- **Reducer, table-driven:** one test per row of the transition table, plus subagent bookkeeping,
  display holds and the asleep timer.
- **Golden:** each fixture reduced to a sequence of snapshots, compared to a committed expected
  file. Regenerated deliberately with a script when the design changes.
- **Simulator:** same seed, same event sequence; every emitted event validates; the reduced fleet
  never has a session in an impossible combination (for example waiting with no `waitingOn`).
- **Ticker:** never contains a key outside the `TickerEvent` schema.

## 11. Versioning and extension

- `Snapshot.version`, `TickerEvent` via the stream's event name, and `RedactedEvent.v` are the
  three version numbers. Additive changes add optional fields or use `ext`; only removals or
  meaning changes bump a version.
- New event kinds are added to the union and ignored by reducers that don't handle them; new
  sources implement `Source`; new views consume `Snapshot` and nothing else.

## 12. Deferred

- Collision detection (M7) adds a `file.touch` redacted event carrying a short-lived hash; not in M1.
- Cost and rate-limit display; the `status` event already carries the numbers.
- Redis publishing helpers for cloud mode.
- `StopFailure` and an error flag. Nothing in M1 sets one, so `SessionState` does not carry it and
  an errored session reads as whatever its last hook said.
- Presence for sessions the poller has never seen. Track B should emit `presence` only for sessions
  it has already seen, or accept that a late poll can re-create a just-removed session as idle.
