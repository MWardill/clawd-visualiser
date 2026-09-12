# Local agent design (`apps/agent`)

Track B of [the PRD](../../PRD.md), milestones B1 to B3. The agent is the only component that sees
raw Claude Code payloads. It redacts them at the door with `@clawd/core`, keeps the fleet, and
serves the transport contract of [the core design](2026-09-12-core-contract-design.md) §8 on
`127.0.0.1:4750`. It also installs its own hooks and raises windows on Windows.

Decisions made without a live review are marked **Assumption** so they can be revisited.

## 1. Scope

In scope:

- **B1 Ingest.** HTTP receivers for hook and status line payloads, redaction with `redact()`, a
  redacted event log, the directory allowlist.
- **B2 Reconcile and serve.** The `claude agents --json` presence poll, alias persistence, the
  fleet driven by `applyEvent()` and `tickFleet()`, and the five endpoints: snapshot, SSE stream,
  ticker backfill, command, health.
- **B3 Install and focus.** An installer that edits `~/.claude/settings.json` with a backup and
  wraps any existing status line, and a Windows focus command that raises a session's window by
  working directory.

Out of scope: replay from the command line (M7), the headless transcript context fallback
(FR-11), cloud publishing (M6), collision detection (M7), starting the agent on login, focus on
macOS and Linux.

`@clawd/core` is not changed. Three places where the agent does something core does not already
offer are called out in §4.3, §5.3 and §5.4; each is a candidate to move into core later.

## 2. Privacy rules

These bind every module and every test.

1. **Raw payloads live only in memory, only for one request.** A request body is read, parsed,
   passed to `redact()` or `redactPresence()`, and dropped. It is never written to disk, logged,
   echoed in a response, or kept on an object that outlives the request.
2. **Nothing but redacted values reaches a sink.** The sinks are the event log, `aliases.json`, the
   HTTP responses, the SSE stream and stdout. Each outgoing wire payload is validated against its
   core schema and checked with `containsForbidden()` before it is written.
3. **Logging is typed so content cannot enter it.** The logger takes a code from a fixed union and
   a record of numbers and booleans. There is no parameter a string could travel through, so an
   error message that quotes a payload cannot be logged. Errors are reduced to a code.
4. **Presence details for focus stay in memory.** The poller keeps each listed session's `pid` and
   `cwd` from the latest poll so focus can find the window. They are never serialised, logged or
   exposed on any endpoint, and are replaced on the next poll.
5. **Only modelled hook events are registered.** `MessageDisplay` carries assistant text deltas and
   `Notification` carries messages; neither changes state, so the installer does not subscribe to
   them. This narrows the PRD's "http hooks for every event" on purpose: content the agent would
   only drop is better never sent.
6. **Tests prove it with canaries.** Synthetic raw payloads carry a unique canary string in every
   forbidden field. The end-to-end test asserts no canary appears in any sink.

## 3. Package layout

```
apps/agent/
  package.json              @clawd/agent; deps @clawd/core, zod, tsx; dev typescript, vitest, @types/node
  tsconfig.json
  README.md
  hooks/                    plain dependency-free ESM, copied to ~/.clawd/bin by the installer
    clawd-hook.mjs          command hook: posts its stdin to /ingest/hook
    clawd-statusline.mjs    status line: posts its stdin to /ingest/status, prints a line
  src/
    main.ts                 CLI: serve | install | uninstall
    version.ts              AGENT_VERSION
    log.ts                  typed operational logger
    config.ts               paths, config schema, load and save
    json-file.ts            atomic JSON write (temp file and rename)
    ingest/
      body.ts               bounded request body reader
      ingest.ts             raw body -> RedactedEvent | null
    host/
      host.ts               FleetHost: fleet, aliases, ticker buffers, snapshot change detection
      ticker-buffer.ts      per-session ring buffers
    store/
      alias-store.ts        load and persist the AliasMap
      event-log.ts          daily redacted event files and retention
    presence/
      poller.ts             runs `claude agents --json`, reconciles, keeps pids for focus
      reconcile.ts          pure: poll result + fleet -> presence events
    http/
      server.ts             node:http server, guards, routing
      guards.ts             host, origin and token checks
      sse.ts                stream hub: throttle, heartbeat, client limit
    focus/
      focus.ts              alias -> pid and folder -> PowerShell
      focus-script.ts       the PowerShell script as a constant
    install/
      settings.ts           pure: settings JSON in, settings JSON out
      installer.ts          backup, copy hook scripts, write settings and config
    agent.ts                createAgent(): wires everything, returns start and stop
```

Each `*.test.ts` sits next to its module. Everything that touches time, processes or the file
system takes an injected dependency, so tests use temp directories, fake clocks and fake process
runners.

**Runtime.** `tsx` runs the TypeScript directly, as core's scripts do: core exports source with
extensionless imports, which Node's own type stripping cannot load. `pnpm --filter @clawd/agent
start` runs `tsx src/main.ts serve`. No bundling step. **No HTTP framework:** seven routes on
`node:http` keep the dependency list at core, zod and tsx.

## 4. Ingest (B1)

### 4.1 Endpoints

Private to the agent and its hook scripts; not part of the core transport contract.

| Endpoint | Body | Sent by |
| --- | --- | --- |
| `POST /ingest/hook` | a raw hook payload | Claude Code http hooks; `clawd-hook.mjs` for the SessionStart command hook |
| `POST /ingest/status` | a raw status line payload | `clawd-statusline.mjs` |

Both require the header `x-clawd-token` to equal the token in `config.json`, compared in constant
time, and reject any request carrying an `Origin` header. A browser cannot set a custom header on a
cross-origin request without a preflight the agent never grants, so a web page cannot forge hook
events. A wrong or missing token gets `401`.

The response is sent as soon as the body has been read: `200` with `content-type:
application/json` and the body `{}`. Claude Code reads an http hook's body as hook output; an empty
object carries no decision and no context, so a PermissionRequest hook never decides and no hook
adds context (NFR-1). This is the response the spike listener gave in every measured run; an empty
body is not documented either way, so it is not used. Rejections (`401`, `403`) also send `{}`,
since a non-2xx status cannot block anything. Processing happens after the response, inside a
`try`, so an ingest failure never reaches Claude Code.

### 4.2 Body reading

`readBody(req, limit)` collects chunks up to `limit` bytes. A PostToolUse carries the whole tool
response, so the hook limit is generous (32 MiB); the status line limit is 1 MiB. Over the limit,
the reader stops buffering, drains the rest, and the payload is dropped with the log code
`ingest.tooLarge`. A body that fails `JSON.parse` is dropped as `ingest.badJson`.

### 4.3 Redaction

```ts
function ingestHook(raw: unknown, ctx: IngestContext): RedactedEvent | null;
function ingestStatus(raw: unknown, ctx: IngestContext): RedactedEvent | null;
```

Both call core's `redact(raw, { now, allowlist })`. `ingestStatus` returns null for anything
`redact()` did not turn into a `status` event, so the status endpoint cannot inject hook events.

**Failure hooks** (agent-side, §1). Core models `PostToolUse` and `Stop` but returns null for
`PostToolUseFailure` and `StopFailure`. Without them a tool that errors after its permission was
approved leaves the session `waiting` until the next Stop, and a turn that ends in an API error
leaves it `working` for thirty minutes. `ingestHook` renames the event before redaction:

| Received | Redacted as |
| --- | --- |
| `PostToolUseFailure` | `PostToolUse` (a `tool.end`; duration 0 when absent) |
| `StopFailure` | `Stop` (the PRD treats it as idle; no error flag until core has one) |

The rename is a shallow copy with a different `hook_event_name`; every other field still goes
through `redact()`. The documented `PostToolUseFailure` payload carries `tool_name`,
`tool_use_id`, and `agent_id` and `agent_type` inside a subagent, which is everything a `tool.end`
needs; its `error` and `tool_input` are stripped by the raw schema like any other unnamed field. A
failure with `is_interrupt` ends the tool but not the turn; no Stop follows an interrupt, so the
session reads `working` until the stale-working timer, as it already does for any interrupt.

## 5. The fleet host (B2)

`FleetHost` is the one owner of state. It does no I/O; it calls listeners.

```ts
type HostDeps = { now: () => number; config: StateConfig; aliases: AliasMap };
class FleetHost {
  ingest(e: RedactedEvent): void;          // from ingest and the poller
  tick(): void;                            // every 500 ms
  snapshot(): Snapshot;                    // derived now
  tickerFor(alias: string): TickerEvent[] | null;   // null for an unknown alias
  sessionIdFor(alias: string): string | null;       // for focus; local only
  sessions(): ReadonlyMap<string, { paneKey: string; state: SessionPhase; firstSeenAt: number }>;  // for reconcile
  endedIds(): ReadonlySet<string>;         // for reconcile (§6.2)
  forgetEnded(keep: ReadonlySet<string>): void;     // drop ended ids absent from the latest poll
  aliases(): AliasMap;
  on(listener: HostListener): () => void;
}
type HostListener = {
  event?(e: RedactedEvent): void;          // accepted event, for the log
  ticker?(m: StreamTickerMessage): void;
  snapshot?(s: Snapshot): void;            // only when it changed
  aliases?(map: AliasMap): void;           // only when it changed
};
```

### 5.1 Per event

1. Drop a duplicate `session.start`: one for a session already in the fleet whose last accepted
   event was a `session.start` less than five seconds ago. The installer registers both the http
   and the command SessionStart hook (PRD §11), so if both ever fire the ticker shows one line.
2. `applyEvent(fleet, e, now, cfg)`.
3. Emit `event` for the log.
4. For each ticker line, `ensureSessionAlias()` for the session (persisting the map if it grew),
   append the line to the session's buffer (last `TICKER_BACKFILL` lines), and emit `ticker` with
   `{ alias, event }` validated by `StreamTickerMessageSchema`.
5. Refresh the snapshot (§5.2).

If the event is a `session.end` or a dead `presence`, the session id joins the **ended set** (§6.2).
Any other hook event for an ended id takes it out again: the session is back.

### 5.2 Snapshot refresh

`deriveSnapshot(fleet, aliases, now)`; persist the returned alias map if it changed; compare the
snapshot's JSON without `generatedAt` against the last one emitted; emit only on change. Display
holds expire with time rather than with events, which is why `tick()` also refreshes.

### 5.3 Tick

`tickFleet(fleet, now, cfg)` every 500 ms. A session whose state the tick changed (idle to asleep,
stale working to idle) gets a ticker line `{ t, kind: "state", state }` built by the host and
validated with `TickerEventSchema`. This is the one ticker line not made by `toTickerEvents()`,
which needs an event (§1); it carries nothing but the state enum. Buffers of sessions the tick
pruned are dropped. Then the snapshot refreshes.

### 5.4 Alias resolution

`tickerFor` and `sessionIdFor` search `aliases.sessions` for the entry whose `alias` matches. A
known alias whose session has been pruned returns an empty ticker, not null.

## 6. Presence (B2)

### 6.1 Poll

Every `pollIntervalMs` (default 5 s), never overlapping: run `claude agents --json` through the
shell with a constant command string (`config.claudeCommand`, default `claude`), timeout 15 s,
`windowsHide`, 4 MiB output limit. On Windows `claude` resolves to a `.cmd` shim, which is why the
shell is used; no argument comes from input. The measured run takes about 1.8 s for 19 sessions.

A poll that exits non-zero, times out, or does not parse as a JSON array is a **failed poll**: it
says nothing, and no session is marked dead because of it (`presence.failed`).

### 6.2 Reconcile

```ts
function reconcile(input: {
  entries: unknown[];                           // the parsed array, entries unvalidated
  sessions: ReadonlyMap<string, { paneKey: string; state: SessionPhase; firstSeenAt: number }>;
  ended: ReadonlySet<string>;
  now: number; allowlist: readonly string[]; graceMs: number;
}): RedactedEvent[];
```

Pure. For each entry, read `sessionId` leniently; an entry without one is skipped.

- **Alive, first sight.** An entry whose session is not in the fleet and not in the ended set
  becomes `redactPresence(entry, true, ctx)`, which applies the allowlist. This is how sessions
  that were already running when the agent started appear, as idle.
- **Alive, known.** No event. A presence event refreshes `lastEventAt`, which would defeat the
  stale-working timer and churn `updatedAt` every poll.
- **Gone.** A fleet session that is not `done`, is absent from this poll, and was first seen more
  than `graceMs` (15 s) before `now` gets a dead presence event built from fleet state:
  `{ v: 1, t: now, sessionId, paneKey, kind: "presence", alive: false }`, validated with
  `RedactedEventSchema` (§1). There is no raw payload for a session that has left the list, so
  `redactPresence()` has nothing to redact. The grace covers a session whose first hook arrives
  before the list shows it.

The ended set (§5.1) stops a session that sent SessionEnd, but lingers in the list for a few
seconds, from coming back as idle after the fleet prunes it; this closes the gap noted in core
design §12. Ids absent from the latest successful poll are removed from the set.

### 6.3 Focus lookup

After a successful poll, the poller keeps `sessionId -> { pid, cwd }` for every entry, parsed with
an agent-local schema, replacing the previous map (§2 rule 4).

## 7. Stores (B1, B2)

### 7.1 Home directory

`~/.clawd/`, or `CLAWD_HOME` when set.

```
~/.clawd/
  config.json
  aliases.json
  logs/events-YYYY-MM-DD.jsonl
  bin/clawd-hook.mjs
  bin/clawd-statusline.mjs
```

### 7.2 Config

```ts
type AgentConfig = {
  version: 1;
  port: number;                   // 4750
  allowlist: string[];            // absolute directories; empty admits nothing
  token: string;                  // 64 hex characters, generated on first write
  corsOrigins: string[];          // ["http://localhost:3000", "http://127.0.0.1:3000"]
  pollIntervalMs: number;         // 5000
  claudeCommand: string;          // "claude"
  logRetentionDays: number;       // 7
  wrappedStatusLine?: { command: string; [field: string]: unknown };  // set by the installer, verbatim
};
```

Validated with zod. A missing file means defaults with a fresh token, written on first save. An
invalid file stops the agent with the failing field paths and no values. `serve` with an empty
allowlist starts, logs `config.emptyAllowlist`, and shows nothing.

**Assumption.** The Vercel origin is not in the default `corsOrigins`. A user who wants the deployed
page to read the local agent from their own browser adds it.

### 7.3 Aliases

`aliases.json` holds the `AliasMap`. Loaded at start; an unreadable or invalid file is renamed to
`aliases.json.bad-<timestamp>` and the agent starts with an empty map rather than crashing. Saved
atomically, debounced to one write a second, and flushed on shutdown. The map grows by one entry
per session ever seen, which stays small for years of use.

### 7.4 Event log

One file per UTC day, `logs/events-YYYY-MM-DD.jsonl`, in core's fixture format: a header line
`{"fixture":1,"name":"events-YYYY-MM-DD"}` then one `RedactedEvent` per line, so `parseFixture()`
and `createReplaySource()` read a day's log unchanged (FR-32). Appends are queued so order is
kept. Every line is revalidated with `RedactedEventSchema` and checked with `containsForbidden()`
first. Files older than `logRetentionDays` are deleted at start and hourly.

The log holds `sessionId`, `paneKey` and the status line's cost and rate-limit figures, as the
redacted event model allows. It is local and never served.

## 8. HTTP server (B2)

Bound to `127.0.0.1` only. Each request passes three guards before routing:

1. **Host.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`, else `403`. This
   stops DNS rebinding.
2. **Origin.** For `/api/*`: an `Origin` in `corsOrigins` gets `Access-Control-Allow-Origin` with
   that origin and `Vary: Origin`; an `OPTIONS` preflight from it gets `204` with methods `GET,
   POST`, header `content-type`, and `Access-Control-Allow-Private-Network: true` when requested.
   An unlisted origin gets no CORS headers, so its page cannot read responses, and a `POST` or
   `OPTIONS` from it gets `403`. For `/ingest/*`, any `Origin` gets `403`.
3. **Token.** For `/ingest/*` only (§4.1).

| Route | Behaviour |
| --- | --- |
| `GET /api/snapshot` | `200`, the current `Snapshot`, `cache-control: no-store` |
| `GET /api/stream` | SSE (§8.1) |
| `GET /api/ticker/:alias` | `200`, a JSON array of up to 200 `TickerEvent`s, oldest first; `404` for an unknown alias |
| `POST /api/command` | `content-type: application/json` required (`415`); body at most 4 KiB; `CommandSchema` (`400`); `focus` for an unknown alias `404`; otherwise `202` with an empty body, and the command runs after the response |
| `GET /api/health` | `200`, `{ ok: true, version: AGENT_VERSION, sessions }` validated by `HealthSchema`, where `sessions` is the fleet size |
| anything else | `404`, or `405` for a known path with the wrong method |

Every JSON response body passes `containsForbidden()` before it is written; a hit sends `500` and
logs `privacy.blocked`. The requirement of a JSON content type on `POST /api/command` means a
cross-origin page cannot send it as a simple request, which would skip the preflight.

### 8.1 Stream

- Headers `content-type: text/event-stream`, `cache-control: no-store`, `connection: keep-alive`.
- On connect: `event: snapshot` with the current snapshot.
- On a host `snapshot`: broadcast, throttled to one every `SNAPSHOT_MIN_INTERVAL_MS` (250 ms). A
  change inside the window schedules one trailing send of the latest snapshot.
- On a host `ticker`: broadcast `event: ticker` with `{ alias, event }` at once.
- `: heartbeat` comment every `STREAM_HEARTBEAT_MS` (15 s).
- At most 16 clients; the seventeenth gets `503`. A client whose socket buffers more than 1 MiB is
  closed. A closed request removes its client.

## 9. Hook scripts and installer (B3)

### 9.1 Hook scripts

Plain `.mjs` files with no dependencies, so the installed copies do not depend on this repository
or its worktree still existing. Each reads `../config.json` relative to its own file for the port
and token. Both always exit 0 and never write files or print payloads.

- **`clawd-hook.mjs`**, the SessionStart command hook: read stdin, `POST` it to `/ingest/hook` with
  the token, give up after 250 ms, exit 0 with no output.
- **`clawd-statusline.mjs`**, the status line command: read stdin; in parallel `POST` it to
  `/ingest/status` (250 ms limit) and, when `config.wrappedStatusLine` is set, run that command
  through the shell with the same stdin (5 s limit). Print the wrapped command's stdout unchanged.
  With nothing wrapped, or if the wrapped command fails, print a default line built from the
  payload: `clawd · <model> · ctx <n>%`, with missing parts left out. The status bar never goes
  blank (NFR-2).

### 9.2 Settings changes

`settings.ts` is pure: `applyInstall(settings, opts)` and `applyUninstall(settings, wrapped)`
return new settings objects plus what was wrapped.

**Installed hooks.** One matcher group without a matcher, appended to each event's array so other
hooks are untouched:

| Event | Hook |
| --- | --- |
| `SessionStart` | http and command (`node "<home>/bin/clawd-hook.mjs"`) |
| `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `SessionEnd` | http |

The http hook is `{ type: "http", url: "http://127.0.0.1:<port>/ingest/hook", headers: {
"x-clawd-token": "<token>" }, timeout: 2 }` and the command hook has `timeout: 2`. Timeouts are in
seconds and default to 600, so an agent that accepts a connection and then hangs would stall a
session for ten minutes without them. The token is a literal header value; `allowedEnvVars` is not
needed. The group has no `matcher` field, as in the spike settings, where every event fired.
Paths in commands use forward slashes, which both the bash that runs command hooks on Windows and
Node accept.

**Recognising our own entries.** An http hook whose URL is `http://127.0.0.1:<any port>/ingest/hook`,
a command hook whose command contains `clawd-hook.mjs`, and a status line whose command contains
`clawd-statusline.mjs`. Install first removes all of them, then adds the current set, so running it
twice changes nothing. Groups left with no hooks and events left with no groups are removed.

**Status line.** An existing status line that is not ours is saved verbatim to
`config.wrappedStatusLine`. The new status line is a copy of it with `type: "command"` and our
command, so fields such as `padding` survive; with no existing status line it is just those two
fields. The `statusLine` fields are not documented beyond what the spike used, which is why unknown
fields are carried rather than named. Uninstall puts the saved object back exactly, or removes the
status line when nothing was wrapped.

### 9.3 Installer

```
pnpm --filter @clawd/agent agent install --allow <dir> [--allow <dir> ...] [--port <n>] [--settings <path>] [--dry-run]
pnpm --filter @clawd/agent agent uninstall [--settings <path>]
```

Install:

1. Resolve each `--allow` to an absolute path and merge it into the config allowlist. Refuse a
   blank entry or a filesystem root, and refuse to finish with an empty allowlist.
2. Read the settings file (default `~/.claude/settings.json`). A missing file is `{}`. A file that
   does not parse stops the installer before anything is written.
3. Compute the new settings with `applyInstall`.
4. With `--dry-run`, print which events gain hooks and whether a status line would be wrapped, then
   stop. Never print settings content: `env` in that file can hold secrets.
5. Copy the hook scripts to `<home>/bin`.
6. Back up the settings file byte for byte to `settings.json.clawd-backup-<YYYYMMDDHHmmss>` beside
   it, when it existed.
7. Write the settings atomically as two-space JSON with a trailing newline, then save the config.
8. Print the backup path and a reminder to start the agent.

Uninstall backs up, removes our entries, restores the status line, and leaves `~/.clawd` in place.

This work does not run the installer against the real `~/.claude/settings.json`; tests use temp
files, and the user runs it.

## 10. Focus (B3)

`POST /api/command` with `{ type: "focus", alias }`:

1. `host.sessionIdFor(alias)`, else `404`.
2. `202`, then `poller.lookup(sessionId)`. A miss triggers one immediate poll and a second lookup;
   still missing logs `focus.notListed`.
3. On Windows, spawn `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command -`
   with the script from `focus-script.ts` on stdin, and the pid and the folder name (the last
   segment of `cwd`) in the environment as `CLAWD_FOCUS_PID` and `CLAWD_FOCUS_FOLDER`. Nothing is
   interpolated into the script. Timeout 10 s. Elsewhere, log `focus.unsupported`.

The script:

1. Loads every process's parent id once with `Get-CimInstance Win32_Process`.
2. Walks up from the pid, at most 12 steps. At a VS Code family process (`Code`, `Code - Insiders`,
   `Cursor`), it enumerates that program's visible top-level windows and picks the one whose title
   contains the folder name as a whole ` - ` or ` — ` separated segment, else the first containing
   it at all. At any other ancestor with a main window (Windows Terminal, a console host), it picks
   that window.
3. Falls back to the console window attached to the pid (`AttachConsole` and `GetConsoleWindow`).
4. Restores the window if minimised and calls `SetForegroundWindow` after the Alt key press that
   satisfies the foreground lock. If the window did not come forward, it calls `FlashWindowEx`.
5. Exits 0 raised, 2 flashed, 3 no window found. The agent logs `focus.raised`, `focus.flashed` or
   `focus.noWindow`.

Tabs and panels inside a window are not targeted (PRD decision log).

## 11. Startup and shutdown

`serve`: load config; load aliases; create the host, event log, poller, SSE hub and server; listen
on `127.0.0.1:<port>`; start the 500 ms tick, the poll loop and the hourly retention sweep.
`EADDRINUSE` exits 1 with a message naming the port. `SIGINT` and `SIGTERM` stop the timers, end
the streams, close the server, flush the aliases and the log, and exit 0.

`createAgent({ home, port, now, exec, spawn })` does all of this with injected dependencies, and
returns `{ start(): Promise<{ port }>, stop(): Promise<void> }` so tests can run a whole agent on
port 0.

## 12. Operational log

One JSON line on stdout per event worth knowing: `{ t, code, ...fields }`. Codes are a closed union
(`agent.started`, `agent.stopped`, `ingest.dropped`, `ingest.tooLarge`, `ingest.badJson`,
`ingest.unauthorised`, `presence.failed`, `privacy.blocked`, `focus.*`, `store.*`, `config.*`,
`server.portInUse`, `stream.clientLimit`); fields are numbers and booleans. Ingest counts are
aggregated and logged once a minute rather than per request.

## 13. Tests

Vitest, next to each module.

- **Ingest.** Canary payloads for every modelled event, the failure-hook renames, a status payload
  posted to the hook route and a hook payload posted to the status route, over-limit and bad JSON.
- **Host.** Each core fixture fed through the host with the clock set to each event's time ends at
  the same snapshot as core's golden sequence; ticker buffers cap at 200; duplicate session.start;
  tick-made state lines; snapshot emitted only on change; alias persistence callback.
- **Reconcile.** First sight, known alive, gone after grace, within grace, ended set, failed poll,
  allowlist, malformed entries.
- **Stores.** Config defaults, token generation, invalid config message without values; alias file
  recovery; event log header, day rollover, retention, `parseFixture` round trip.
- **Server.** Every route and status code; host, origin and token guards; preflight; the JSON
  content type rule; `containsForbidden` blocking.
- **Stream.** Snapshot on connect, throttle with trailing send, ticker broadcast, heartbeat, client
  limit, cleanup on close. Fake timers.
- **Hook scripts.** Spawned with Node against a test server: posts with the token, exits 0 when the
  agent is down, status line prints the wrapped command's output or the default line.
- **Settings.** Install on empty, on settings with other hooks, twice (idempotent), with an existing
  status line; uninstall restores exactly the original hooks and status line.
- **Installer.** Temp files: backup written, bad JSON leaves the file untouched, dry run writes
  nothing, refusal of an empty allowlist and of a root.
- **Focus.** Alias resolution and the retry poll with a fake spawner; on Windows only, the script
  parses with PowerShell's parser. Raising a real window is a manual check.
- **End to end.** A whole agent on port 0 with a fake `claude`: canary hook and status payloads
  posted; a stream client connected; afterwards no canary is found in the stream bytes,
  `/api/snapshot`, `/api/ticker`, the log files, `aliases.json` or captured stdout, and every
  stream message validates against its core schema (NFR-7).
- **Local recordings.** When `CLAWD_SPIKE_DIR` points at the raw spike recordings, every recorded
  body is posted to a test agent and the same no-leak assertions run against the recorded `cwd`,
  transcript paths and prompts. Skipped otherwise; failures name the leaked field kind, never the
  value.

## 14. Open points

1. The failure-hook renames (§4.3), the host-made tick state line (§5.3) and the fleet-built dead
   presence (§6.2) belong in core once one session owns a core change.
2. Whether PostToolUse also fires after PostToolUseFailure. If it does, the second `tool.end` finds
   nothing in flight and changes nothing. The `StopFailure` payload is undocumented; it is read
   with the same loose schema as `Stop`, so a missing `background_tasks` counts as none.
3. Focus on Windows Terminal: whether the shell's ancestor chain reaches the terminal's window or
   only the console host fallback does. Measured during the manual check.
