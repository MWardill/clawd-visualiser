# Detail levels design (privacy tiers)

14 September 2026. Approved in conversation. Reopens the 12 September decision that no session
content is shown locally. The cloud path keeps that rule in full: it receives level `none`, which is
today's wire format, and nothing in this design can widen it.

## 1. Problem

The local view shows states, categories and tool names, and nothing about what a session is working
on. Everything it could show is already on this machine, and the cloud viewer is a separate, opt-in
path. The maintainer wants a local view that says what each session is doing, short of prompts,
commands, outputs and assistant text, and a cloud view exactly as anonymised as today. The desktop
app (`2026-09-14-desktop-app-design.md`) exposes the setting; the browser app on the same machine
gets the same data, because the setting, not the packaging, is the gate.

## 2. Levels

An agent setting `detail` with three values. Default `none`. Each level includes the ones below it.

| Level | Adds | From |
| --- | --- | --- |
| `none` | Nothing. Today's wire format byte for byte. | |
| `hints` | `program`: the shell command's program name. `ext`: the extension of the file a tool reads or edits. `host`: the hostname a fetch targets. `agent`: the subagent type an Agent call asks for. `permissionMode`. `shells`: background shells still running. | `tool_input.command`, `.file_path`, `.notebook_path`, `.url`, `.subagent_type`; `permission_mode`; `background_tasks` |
| `paths` | `file`: the file or directory a tool touches, relative to the working directory. `dir`: the working directory. `name`: the session's name. `description`: an Agent call's short description. | `tool_input.file_path`, `.notebook_path`, `.path`; `cwd`; the agents list `name` and the status line `session_name`; `tool_input.description` |

Never read at any level: `prompt`; `tool_input.prompt` (Agent), `tool_input.pattern` (Grep and
Glob) and `tool_input.query` (WebSearch); `tool_response`; `last_assistant_message`;
`transcript_path` and `agent_transcript_path`; MessageDisplay and Notification, which stay
unregistered. The transcript reader keeps its single approved use, counting prompts.

Derivations, in `packages/core/src/ingest/detail.ts`, all pure:

- `program(command)`: skip leading `NAME=value` tokens; take the first token, a quoted one whole;
  keep its last path segment; drop a trailing `.exe`, `.cmd` or `.bat`; at most 32 characters and
  matching `^[A-Za-z0-9._+-]+$`, else absent.
- `ext(path)`: the last segment's text after its last dot, lower case, matching `^[a-z0-9]{1,16}$`,
  else absent.
- `host(url)`: `new URL(url).hostname`, at most 253 characters, else absent.
- `agent`: `tool_input.subagent_type`, matching `^[A-Za-z0-9._:-]{1,64}$`, else absent.
- `permissionMode`: matching `^[a-zA-Z]{1,32}$`, else absent.
- `shells`: the count of `background_tasks` entries with `type: "shell"`.
- `relative(file, cwd)`: forward slashes; when `file` starts with `cwd` (compared through
  `normalisePath`, so case-insensitive on Windows), the remainder without its leading slash; else
  the file as given. At most 512 characters.
- `dir`: `cwd` with forward slashes, at most 512 characters.
- `name`, `description`: control characters removed, at most 120 characters.

## 3. Contract

`packages/core/src/schema/detail.ts`:

```ts
DetailLevelSchema  = z.enum(["none", "hints", "paths"]);
HintsDetailSchema  = z.object({ program?, ext?, host?, agent?, permissionMode?, shells? }).strict();
                     // every string field refuses "/" and "\"
PathsDetailSchema  = HintsDetailSchema.extend({ file?, dir?, name?, description? }).strict();
EventDetailSchema  = PathsDetailSchema;
SubjectSchema      = z.object({ kind: z.enum(["file", "program", "host", "agent"]), text: z.string().min(1).max(512) }).strict();
SessionDetailSchema = z.object({ name?, dir?, permissionMode?, shells?, subject?: SubjectSchema }).strict();
PaneDetailSchema   = z.object({ dir? }).strict();
TickerDetailSchema = z.object({ subject?: SubjectSchema, permissionMode? }).strict();
```

- The `RedactedEvent` base gains `detail?: EventDetailSchema`.
- `SessionSnapshot.detail?: SessionDetailSchema`, `PaneSnapshot.detail?: PaneDetailSchema`,
  `TickerEvent.detail?: TickerDetailSchema`. `version` stays 1: the fields are optional and absent
  at level `none`.
- `SessionState.detail: { permissionMode?, shells?, name?, dir?, subject? }`. The reducer copies
  `permissionMode`, `name`, `dir` and `shells` from any event that carries them, and sets `subject`
  on every `tool.start`, parent or subagent, from the event's detail: a file tool gives `file` at
  `paths` or `ext` at `hints`; Bash and PowerShell give `program`; WebFetch gives `host`; Agent
  gives `description` at `paths` when present, else `agent`. A subject persists until the next
  tool start; nothing clears it.
- `deriveSnapshot` carries session detail through and gives each pane the `dir` of any of its
  sessions. `label` stays the generated alias label at every level; the UI prefers `detail.name`.
- `toTickerEvents` puts the event's subject and `permissionMode` on `tool.start`, `tool.end` and
  `permission` lines.
- `Health` gains `detail: DetailLevel`. `probeHealth` returns the parsed `Health` rather than a
  boolean, so the web app's policy can keep the level for the source badge.

## 4. Projection and invariants

`stripDetail<T>(value: T): T` in core removes every `detail` key from any nested object; arrays
are mapped. `toCloudSnapshot(s) = SnapshotSchema.parse(stripDetail(s))` is the one function the
cloud publisher (M6) may call, and the M6 design inherits that obligation.

Four invariants, each with a test:

1. **Level `none` is today.** With `detail` absent or `none`, no event, snapshot or ticker line
   carries a `detail` key. The golden fixtures do not change.
2. **Nothing forbidden outside `detail`.** At every level, every sink (the event log, the alias
   file, responses, the stream, stdout) passes `containsForbidden(stripDetail(payload),
   liveDirectories)`. `FORBIDDEN_KEYS` is unchanged; detail uses `dir`, `file` and `name`, never a
   raw key's name.
3. **The log and the cloud are level `none`.** `eventLog.append` writes `stripDetail(e)`, and
   `readRecent` refuses a line carrying a `detail` key. `toCloudSnapshot` output has no `detail` key.
4. **Bounded by level.** Output at `hints` validates against `HintsDetailSchema`, which is strict,
   so a `paths` field is a failure. The `hints` regexes refuse separators, so nothing path-shaped fits.

Canaries: raw payloads carry unique strings in `prompt`, `tool_input.prompt`, `tool_input.pattern`,
`tool_response`, `last_assistant_message` and `transcript_path`, and different unique strings in
`tool_input.file_path`, `cwd`, `name`, `session_name` and `tool_input.description`. The first group
appears in no sink at any level. The second appears only inside `detail`, only at `paths`, only in
the memory sinks (responses and the stream), never in the log, the alias file or stdout, and never
after `stripDetail`. One test proves the strip is needed: the unstripped `paths` snapshot does
contain the file canary.

## 5. Ingest

- `IngestContext.detail: DetailLevel`.
- `RawHookDetailSchema` extends `RawHookSchema` with `tool_input: { file_path?, notebook_path?,
  path?, command?, url?, subagent_type?, description? }` and `permission_mode?`.
  `RawAgentEntryDetailSchema` adds `name?`; `RawStatusLineDetailSchema` adds `session_name?`. These
  parse only when the level is above `none`; at `none` the existing schemas parse and, in strip
  mode, the fields never become values.
- `redact()`, `redactPresence()` and `redactStatus()` build detail through `detailFor(level, raw)`
  and attach it when it is not empty.
- Privacy rule 1 holds: raw values live for one request only.

## 6. Agent

- Config gains `detail: DetailLevelSchema.optional()`; absent means `none`. A CLI subcommand
  `agent detail <none|hints|paths>` writes it and prints that the agent needs restarting. The
  desktop app restarts the agent itself (desktop design §9).
- The sink checks in `server.ts`, `sse.ts` and `event-log.ts` become
  `containsForbidden(stripDetail(x), sensitive())`, and the event log strips before writing.
- The agent design's privacy rules gain 9 (the levels and what each may carry), 10 (the log and
  the cloud are level `none`) and 11 (the four invariants). Rules 2 and 8 are reworded for detail.

## 7. UI

Local by construction: the cloud never receives detail and the simulated source never produces it,
so the Vercel build renders nothing new.

- Scene: `nameplate()` takes an optional `name` and shows it, lower case and cut to fit, instead of
  the alias label. A caption at `CAPTION_ROW = 21` in the seat, for working and waiting sessions
  only: `subject.text`, coloured by activity, cut with an ellipsis to the seat width through
  `GLYPH_W`. A `file` subject shows at most its last two path segments.
- Ticker: `formatTicker` appends the subject after the tool name, dimmed, through `plain()`, cut to
  48 characters.
- Sheet header: `detail.name` as the title when present; `detail.dir`, a `permissionMode` badge
  and, when above zero, the background shell count beneath.
- Status bar: the source badge shows the level above `none` (`live · paths`), from health.

## 8. Tests

Core: the derivations with edge cases (quoted programs, environment prefixes, UNC paths, files
outside the working directory, unparsable URLs); ingest at each level over the recorded fixtures;
the four invariants; the reducer's subject rules; snapshot and ticker carry-through;
`toCloudSnapshot`. Agent: the canary end-to-end test at each level; log strip and refusal; health;
the CLI subcommand. Web and scene: `formatTicker` with subjects; `nameplate` and caption cutting;
the sheet header with and without detail.

## 9. Documents

PRD: goal 3, non-goal 1 and the summary sentence in §1 now say that content never leaves the
machine and that the cloud receives level `none`; FR-9 gains the levels; a new FR-9a states the
setting and its default; FR-27 mentions the subject column; a decision log row for 14 September
2026. Agent README: the setting. The privacy memory note records the change.

## 10. Out of scope

A content level (prompts, commands, outputs, assistant text). Collision detection on real paths
(M7 may use `file` at `paths`). Registering MessageDisplay or Notification. Any change to what the
cloud receives.
