# Session visibility design

13 September 2026. Approved in conversation. Builds on the restart restore (`feat/restart-state`).

## 1. Problem

The presence poll lists every open Claude Code session. On the user's machine one pane showed 14
sessions: 6 had never had a prompt, and most of the rest had been quiet for hours or days. The
view should show the sessions that matter and leave the dormant ones out.

## 2. Rule

| Session | Shown |
|---|---|
| Working or waiting | Always |
| No typed prompts | Never |
| One prompt | Until 3 hours after its last activity |
| Two to eight prompts | Until 24 hours after its last activity |
| More than eight prompts | Always |

- **Last activity** is the last prompt, tool start or end, permission request or denial, stop, or
  subagent start or stop. A session start or end, a presence poll, a status line and a transcript
  count are not activity.
- **Hidden, not removed.** A hidden session stays in the fleet. Its next prompt makes it working,
  which shows it.
- **Done sessions** are judged like quiet ones, so a session that ends while hidden plays no exit.
- **Panes** are shown while at least one of their sessions is.
- **Limits** live in `StateConfig`: `oneShotHideMs` (3 hours), `fewPromptsHideMs` (24 hours) and
  `fewPrompts` (8).

## 3. Architecture

Core decides, and the snapshot format does not change, so the web app and scene are untouched.

- `SessionState` gains `prompts` and `lastActiveAt`.
- A new redacted event, `history { prompts }`, raises `prompts` to the given count and never lowers
  it. It leaves `lastEventAt`, `lastActiveAt` and the state alone, creates no session and produces
  no ticker line.
- `isShown(session, now, cfg)` in `state/visibility.ts` applies the rule.
- `deriveSnapshot(fleet, aliases, now, cfg = DEFAULT_CONFIG)` leaves out hidden sessions and panes
  with nothing shown. Aliases are assigned only to what is shown.

Rejected alternatives:

- **Snapshot fields filtered by the web app.** It would allow a "show all" toggle, but it changes
  the public snapshot and repeats the rule in every viewer.
- **Agent-side filtering.** It keeps core untouched, but it splits the state rules across two
  packages and escapes core's golden snapshot tests.

## 4. Counting prompts

- **Live.** Each `prompt` event adds one.
- **Transcripts.** On each successful poll, the agent reads the newest transcript,
  `<projects>/<folder>/<sessionId>.jsonl`, of every allowlisted, listed session that is not ended
  and has not been counted in this run, one at a time. For each of those now in the fleet it
  ingests a `history` event with the count and marks the session counted. A counted id that has
  left the fleet is forgotten, so a session that comes back is counted again, and after a restart
  every session is counted again.
- **A typed prompt** is a transcript line that parses as an object with `type: "user"` and
  `origin.kind: "human"`, where neither `isMeta` nor `isSidechain` is true. On the user's
  transcripts, from 27 days old to today, every typed prompt carries that origin, and tool results,
  command output, metadata and background-task notifications do not.
- **The same read** gives the transcript's last write, which dates first-sight sessions as the
  restart design describes.

## 5. Privacy

The agent now reads transcript content, locally, in order to count. That is the trust level the
hooks already have: they deliver prompt text to the agent, which strips it at ingest. The parser
names only `type`, `origin.kind`, `isMeta` and `isSidechain`. Only the count and the modified time
leave the reader; no path, content or error is logged or served. `history` carries one number and
is logged like any redacted event.

## 6. Edge cases

- **Restart.** Idle sessions appear once the first poll has counted them. Working and waiting
  sessions show at once.
- **A prompt during a count** can be missed by one. Only the one-prompt and eight-prompt boundaries
  notice.
- **A new session** is hidden until its first prompt.
- **An unreadable or missing transcript** counts as nothing new: the session keeps its live count.
- **Live prompts before the count** are kept: the count becomes the larger of the two.

## 7. Testing

- **Core.** The schema accepts and bounds `history`. Sessions count prompts and date activity;
  `history` only raises; the fleet ignores `history` for unknown sessions; the ticker stays silent.
  `isShown` at each boundary. The snapshot leaves out hidden sessions and empty panes, and honours
  the config it is given. Golden sequences are regenerated and the diff reviewed.
- **Agent.** The transcript reader counts only typed prompts and picks the newest file. The poller
  reads each session once per run, raises counts, and counts a returning session again. The host
  judges visibility with its own config.
- **On real data.** The branch runs against a private copy of `~/.clawd`, and the shown sessions
  are compared with the rule applied by hand.
