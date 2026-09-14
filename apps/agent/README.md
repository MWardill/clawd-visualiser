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

Uninstall removes only the agent's own entries. If an event's hook list becomes empty it is removed, so an event that was present but empty before you installed is not put back.

## Run

```
pnpm --filter @clawd/agent start
```

Restart the agent after changing the allowlist. If Node moves (a version manager, an upgrade), run
install again so the hook commands point at it.

## Detail levels

By default the agent keeps only states, categories, tool names and timings. `agent detail hints`
adds the program a shell command runs, the extension of a file being read or edited, the hostname
of a fetch, the subagent type, the permission mode and the background shell count. `agent detail
paths` adds the file or directory a tool touches (relative to the working directory), the working
directory and the session's name. `agent detail none` turns it back off. Restart the agent after
changing it.

Whatever the level, the event log on disk and any cloud snapshot are level none, and prompts,
the rest of a command, tool output and assistant text are never read. Design:
`docs/superpowers/specs/2026-09-14-detail-levels-design.md`.

## Endpoints

| Route | What it returns |
| --- | --- |
| `GET /api/snapshot` | the current snapshot |
| `GET /api/stream` | SSE: `snapshot` events (at most four a second) and `ticker` events |
| `GET /api/ticker/:alias` | the last 200 ticker lines for a session |
| `POST /api/command` | `{"type":"focus","alias":"agent-1"}` raises that session's window (Windows); `202` |
| `GET /api/health` | `{ ok, version, sessions, detail }` |

Browsers may call these only from an origin in `corsOrigins`. `/ingest/hook` and `/ingest/status`
are for the hook scripts and need the token from `config.json`.

## Files

`~/.clawd` (or `CLAWD_HOME`):

| File | What it holds |
| --- | --- |
| `config.json` | port, allowlist, token, CORS origins, poll interval, the wrapped status line, the detail level |
| `aliases.json` | session and pane aliases, so names survive a restart |
| `logs/events-YYYY-MM-DD.jsonl` | the redacted event log, kept seven days; replayable with core's fixture loader |
| `bin/*.mjs` | the hook scripts the settings point at |

## Privacy

Raw payloads live in memory for one request. Prompts, tool output, assistant text and transcript
paths never reach any sink: the log, the alias file, any response or the stream. Tool input is
never passed on whole: at the hints and paths levels only the values listed under Detail levels,
and at paths an Agent call's description, are taken from it, and those values, with the session's
name and working directory at paths, reach responses and the stream only inside `detail`, never the
event log, the alias file or stdout. Every outgoing body is checked before it is written, outside
its `detail` object, and operational logs carry a timestamp, a code and numbers only.
`src/agent.e2e.test.ts` proves it with canary payloads.

To run the same check over the raw spike recordings, which never leave your machine:

```
$env:CLAWD_SPIKE_DIR = "C:\path\to\tools\hook-spike"; pnpm --filter @clawd/agent exec vitest run src/agent.recordings.test.ts
```

## Develop

```
pnpm --filter @clawd/agent test
pnpm --filter @clawd/agent typecheck
```
