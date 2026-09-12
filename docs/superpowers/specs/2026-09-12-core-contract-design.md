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
    redact.ts              redact(raw, context) -> RedactedEvent | null; also exports
                            redactPresence(entry, alive, context) -> RedactedEvent | null
    allowlist.ts           directory allowlist matching
    categories.ts          tool name -> activity category
  state/
    session.ts             reduceSession(state, event, now, cfg) -> state; tickSession(state, now, cfg)
    fleet.ts               reduceFleet(fleet, event, now, cfg); tickFleet(fleet, now, cfg)
    snapshot.ts            deriveSnapshot(fleet, aliases, now) -> { snapshot, aliases }
    ticker.ts              toTickerEvents(event, before, after, now) -> TickerEvent[]
    apply.ts               applyEvent(fleet, event, now, cfg) -> { fleet, before, after, ticker }
    config.ts              thresholds with defaults
  own.ts                   own-property lookup for records keyed by ids that arrive off the wire
  testing/
    events.ts              test-only typed event builder and epoch; not exported
  alias/
    names.ts               label lists (sessions, panes) and ensureSessionAlias / ensurePaneAlias
    pane.ts                paneKey(cwd) hashing
  sources/
    source.ts              Source interface
    simulated.ts           seeded fleet that emits RedactedEvents
    replay.ts              plays a fixture back with scaled timing
  fixtures/
    *.jsonl                redacted recordings
    load.ts                parse and validate a fixture
    frames.ts              snapshotFrames(fixture) -> SnapshotFrame[], for golden tests

packages/core/scripts/
  redact-spike.ts          regenerates the committed fixtures and their golden files from the
                            spike recordings; run with `pnpm --filter @clawd/core fixtures` (see §9)
```

Each folder exports through `index.ts`, and `src/index.ts` is the only public surface, pinned by
name in `index.test.ts`; inside the package, modules import what they need by path. The reducers
are pure: state in, state out, `now` passed in as a number of milliseconds.

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
| `stop` | `backgroundTasks: number` | Stop, counting only the `background_tasks` entries of type `subagent`; a background shell is not work the session waits on. An entry that cannot be read counts for nothing rather than costing the whole Stop |
| `subagent.start` | `agentId`, `agentType: string` | SubagentStart |
| `subagent.stop` | `agentId`, `agentType` | SubagentStop |
| `status` | `contextPct?: number`, `costUsd?: number`, `rateLimit5h?: number`, `rateLimit7d?: number`, `model?: string` | status line command |
| `presence` | `alive: boolean` | `redactPresence()` over one agents-list entry, one per known session |

`tool` is the built-in tool name, or `"mcp"` for any MCP tool (open question 5 in the PRD).
`category` is derived by `categories.ts`: `read`, `edit`, `run`, `web`, `spawn`, `other`.

Internal helper subagents (an `agent_id` with an empty `agent_type`) are dropped at ingest, whichever
hook the event came from.

### 3.2 Wire schemas

As in PRD section 8, expressed as zod schemas so both the agent (on send) and the web app (on
receive) validate against the same definition. Types are inferred from the schemas; nothing is
declared twice.

```ts
Snapshot        { version: 1, generatedAt, panes: PaneSnapshot[], sessions: SessionSnapshot[], ext? }
PaneSnapshot    { pane, label, collision? }
SessionSnapshot { alias, label, pane, state, activity, subagents, contextPct, since, updatedAt, ext? }
TickerEvent     { t, kind, activity?, tool?, durationMs?, agentType?, state?, contextPct?, reason? }
Command         { type: "focus", alias } | { type: "ping" }
```

`collision` is absent until collision detection (M7) computes it; an optional field, per §11.

Schemas use `.strict()` on the wire types so unknown top-level fields fail validation, and `ext` is
the sanctioned place for extras. `ext` is `z.record(z.unknown()).optional()` and is stripped before
publishing in cloud mode.

### 3.3 Raw payloads

`raw.ts` describes the hook payloads as measured in `docs/spike-hooks.md`, but loosely:
`z.object({...})` on the handful of fields we read, so a new Claude Code version adding fields
never breaks ingest. The schemas parse in zod's default strip mode rather than passthrough, so
parsing is itself the first redaction step: every field we never named is gone before ingest reads
the payload. Fields we never read are never typed, which keeps them out of the code by
construction. The status line is the loosest of them: every section may be omitted and every figure is
nullable, since a session reports nulls before its first turn. (No recording has a whole section
set to null; if one turns up, the sections become nullable too.)

## 4. Ingest redaction

```ts
type IngestContext = { now: number; allowlist: string[] };
function redact(raw: unknown, ctx: IngestContext): RedactedEvent | null;
```

- Determines the hook event from `hook_event_name` (or the status line shape), parses with the
  matching raw schema, and returns the redacted variant with only the allowlisted fields copied.
- Returns `null` for sessions whose `cwd` is outside the allowlist, for internal helper subagents,
  and for events we don't model, such as `MessageDisplay`. An allowlist entry admits its directory
  and everything beneath it; a filesystem root such as `/` admits everything on it; an empty or
  blank entry admits nothing, so a stray separator in a configured list cannot open the boundary.
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
  waitingOn: string | null;   // toolUseId of the pending permission, when one could be resolved
  waitingAgent: string | null; // the subagent whose permission request is pending; null for the parent's own
  inFlight: { toolUseId: string; tool: string; category: ToolCategory }[];  // parent tool calls started, not yet ended
  backgroundTasks: number;
  subagents: string[];        // live agent ids; an array, not a Set, so state stays JSON-serialisable
  contextPct: number | null;
  firstSeenAt: number;        // set once, never changed; the snapshot's sort key
  displayHold: { state: SessionState["state"]; activity: Activity | null; until: number } | null;  // what was shown before the last transition
};
```

Two tool calls can be in flight at once, so `inFlight` is a list and not a single id; it is what a
`PermissionRequest`, which carries no `tool_use_id` of its own, is matched against.

### 5.2 Transitions

`reduceSession(s, e, now)` implements PRD section 9 exactly:

| From | Event | To |
| --- | --- | --- |
| any but done | `prompt` | working |
| working | `tool.start` / `tool.end` | working, activity re-derived: the newest parent tool still in flight, else `spawn` while subagents are live, else `think` |
| any but done, not already waiting | `permission.request` | waiting. `waitingOn` is the request's own `tool_use_id` when it has one, else the newest call in flight with the same tool name, else the newest call in flight, else null (asleep and idle cover a request that arrives before, or long after, its prompt event). A request raised inside a subagent (`agentId` set) matches nothing in `inFlight`; it records the subagent in `waitingAgent` instead |
| waiting | `tool.end` with that toolUseId, or, when no id was resolved, a `tool.end` from the same origin (the parent for the parent's request, the subagent named in `waitingAgent` for its own), or `permission.denied` | working; a denied call leaves `inFlight` |
| working or waiting | `stop` with no subagent tasks and no live subagents | idle; any wait ends |
| working or waiting | `stop` with subagent tasks | working, activity `spawn`; any wait ends |
| idle | `tick` past `asleepAfterMs` | asleep |
| working | `tick` past `staleWorkingMs` since the last event | idle. The Stop never came: a user interrupt, a lost hook. Generous (30 minutes), since one tool call can run for minutes |
| idle / asleep | `prompt` | working |
| any | `session.end`, or `presence.alive === false` | done |

A second `permission.request` that arrives while the session is already `waiting` is ignored outright
(the "not already waiting" guard in the table above): the first request's `waitingOn` wins, and there
is no queue. What Claude Code itself does when two tools each want a permission dialog at once —
whether it queues the second `PermissionRequest` behind the first, and in what hook order — is not
measured (see `docs/spike-hooks.md`), so that scenario is unhandled rather than deliberately resolved.

A `stop` carries Claude Code's own `background_tasks`, and on that question it is authoritative:
a count of zero clears the locally tracked subagent set, so a `SubagentStop` we never received
cannot wedge the parent on `spawn` for the rest of its life. `subagent.stop` reconciles that count
one subagent at a time, so the last one to finish clears it and the parent reads `think` again
rather than `spawn` until its next Stop. A `stop` also ends a wait whose `PostToolUse` never arrived.

`subagent.start` and `subagent.stop` update the set and never change `state`. `status` updates
`contextPct`. `tool.start` inside a subagent (`agentId` set) reads as `spawn` on the parent rather
than the tool's own category, so the parent reads as "running subagents"; a parent tool still in
flight takes precedence, as it does everywhere activity is derived.

Timers live in `tickFleet(fleet, now, cfg)`, called by the host on an interval: it applies the
asleep threshold and the stale-working threshold. Minimum display duration works in two halves:
when the reducer changes `state` it records the previous state and activity in `displayHold` with
`until = now + minDisplayMs`, unless a hold is still running, in which case that hold is kept, so
a burst of transitions shows one state per `minDisplayMs` rather than a phantom hold of whichever
transient state came last. `deriveSnapshot` reports the held state and activity until `until` has
passed, then the real ones. `since` always reflects the real transition time, so the nameplate
clock is never wrong by the hold.

### 5.3 Fleet

```ts
type Fleet = { sessions: Record<string, SessionState>; panes: Record<string, PaneState> };
function reduceFleet(f: Fleet, e: RedactedEvent, now: number, cfg: StateConfig): Fleet;
function tickFleet(f: Fleet, now: number, cfg: StateConfig): Fleet;
```

Plain records rather than Maps, so a fleet is JSON-serialisable and comparable in tests; lookups
go through `own()`, so an id such as `constructor` is never an inherited hit. Panes are created on
the first event for a paneKey and dropped when their last session has been `done` for
`doneLingerMs`. `done` sessions themselves linger for the same period so the view can play the
exit, then are removed. An event that only ever ends a session (`session.end`, a dead `presence`)
creates nothing on first sight: it describes a session we never knew.

### 5.4 Snapshot derivation

```ts
function deriveSnapshot(f: Fleet, aliases: AliasMap, now: number): { snapshot: Snapshot; aliases: AliasMap };
```

Applies display holds (state and activity), maps session ids and pane keys to aliases and labels, sorts panes and
sessions by first appearance (sessions tie-breaking on session id, so the order is deterministic
and a state change never reshuffles the fleet), and validates the result against the schema before
returning it.
`deriveSnapshot` is where the local-only identifiers are left behind. It returns the alias map
alongside the snapshot, since a first sight may have minted aliases the host must persist.

### 5.5 Ticker

`toTickerEvents(e, before, after, now)` maps a redacted event to zero, one or two `TickerEvent`s:
the event's own line, then a synthetic `state` line whenever the reducer changed the session's
state (a first sight has no previous state, so no `state` line). Lines are stamped with `now`, the
clock the reducer was given, so a replayed or rescaled event never puts the ticker and the snapshot
on different clocks. This is the only source of ticker lines, so the ticker can never carry more
than the redacted event does.

`applyEvent(fleet, e, now, cfg)` is the one call a host makes per event. It reduces the fleet and
returns `{ fleet, before, after, ticker }`: the session as it was, the session as it is, and the
ticker lines derived from that same pair, so no host has to keep the two halves in step itself.
An event the reducer left untouched (the session is done) yields no lines.

## 6. Aliases

- `names.ts`: a fixed list of about sixty animal names (session labels) and a separate list of
  tree names (pane labels). `ensureSessionAlias(map, sessionId)` and `ensurePaneAlias(map, paneKey)`
  each return the existing `{ alias, label }` for a known id, or mint the next one; both return
  `{ map, alias, label }` so the caller gets the (possibly unchanged) map back alongside the result
  it asked for. The map is a plain object so the agent can persist it as JSON.
- Aliases are `agent-<n>` and `pane-<n>`, numbered from the map's own counters rather than shared.
- The map type is
  `AliasMap = { sessions: Record<sessionId, { alias, label }>, panes: Record<paneKey, { alias, label }>, nextSession: number, nextPane: number }`.
  Once every name in a list is taken, later labels repeat with a suffix (`Otter 2`, `Otter 3`, ...)
  rather than colliding.

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

- Source recordings are the spike's `spike-events-headless.jsonl` and `spike-events-interactive.jsonl`
  files under `tools/hook-spike/`. `packages/core/scripts/redact-spike.ts`, run with
  `pnpm --filter @clawd/core fixtures` (tsx, no build step), runs them through `redact()` with a
  test allowlist and writes `packages/core/src/fixtures/spike-headless.jsonl` and
  `spike-interactive.jsonl`, then regenerates the golden snapshot sequences (`fixtures/golden/*.json`,
  via `snapshotFrames`) for every fixture.
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
  never has a session in an impossible combination (for example idle or asleep with an activity).
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
- Presence for sessions the poller has never seen. The fleet ignores a dead `presence` (and a
  `session.end`) for a session it has never seen, but a live `presence` for a session it has just
  pruned re-creates it as idle. Track B should emit `presence` only for sessions it has already
  seen, or accept that.
