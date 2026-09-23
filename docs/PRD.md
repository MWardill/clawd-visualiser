# Claude Agent Visualiser (working title)

**Product Requirements Document**
Version 1.0 · 12 September 2026 · the version we build against

Earlier drafts are in `docs/archive/`. Measured facts about Claude Code's hooks are in `docs/spike-hooks.md`.

---

## 1. Summary

A dashboard that shows every Claude Code session on your machine as a Clawd, the Claude Code crab, sitting in a terminal-style pane for its repository. At a glance you can tell which sessions are working, which are waiting on you and which are asleep, and click one to jump to its window. The data stays local; an anonymised summary is published so the same view is available on any of your devices. It costs zero model tokens. Session content is never displayed or transmitted; an opt-in local detail level may add file paths and session names to the view on this machine, and the cloud only ever receives the anonymised form.

## 2. Problem

- Several Claude Code sessions run in parallel across repos (today: ten sessions across four repos), each in its own terminal or VS Code window.
- A session blocked on a permission prompt looks identical to one that is working until you go tab-hunting.
- Finished sessions go unnoticed; working ones get interrupted.
- Existing tools focus on cost and usage, not live state.

## 3. Goals

1. **Glanceable state.** Within one second of looking, know which sessions need a human.
2. **Zero token cost.** All observation is done by the Claude Code harness and a local process. The model is never asked to report on itself.
3. **Private by construction.** Prompt text, tool inputs and outputs and assistant messages are stripped by the local agent at ingest at every level. Nothing downstream can display them because nothing downstream receives them. The local view may name a pane after its directory's last segment and, when the `detail` setting is `hints` or `paths`, show what a session is working on (FR-9a); the cloud always receives level `none`, an anonymised summary of categories only, with generated pane names.
4. **Fun to look at.** A black terminal with stars and drifting clouds, box-drawn panes, and the canonical Clawd animated by state.
5. **Actionable.** Click a Clawd to focus its window and to open a detail pane showing its redacted activity ticker.
6. **Local data, viewable anywhere.** Raw observation never leaves the machine; anonymised snapshots are published to the web app on Vercel so the city can be watched from any device from the first release. The detail ticker is the one exception and stays local.
7. **Extensible.** Everything is an event; events reduce to a versioned snapshot; views render snapshots. Sources, views and themes are plugins behind those two contracts.

## 4. Non-goals (v1)

- Displaying or transmitting prompts, tool inputs or outputs, or assistant text, anywhere, at any detail level. This is a hard boundary, not a later feature. Paths and session names are local-only and opt-in (FR-9a).
- Sending prompts or answering permission prompts from the web UI. Claude Code Remote Control already covers that.
- Multi-user or team dashboards.
- Cost and usage accounting as a feature. The status line payload carries cost and rate limits, so the data is available, but no v1 screen is built around it.
- Window focusing on macOS or Linux. Design for it, implement Windows first.
- A native mobile app.
- Animation libraries. The scene is frame-based on a pixel grid; tween libraries fight that.

## 5. Users

- **Primary:** a developer running multiple Claude Code sessions on one Windows machine, often in the VS Code terminal.
- **Secondary:** any developer with the same setup who clones the repo.

## 6. System overview

```
sources                      local agent (apps/agent)                     web app (apps/web)
────────                     ────────────────────────                     ──────────────────
hook POSTs (http) ─────┐     ingest ── redact ── event log (redacted)      panes scene (canvas)
status line command ───┼──▶  state machine ── alias map ── snapshot  ─SSE─▶ detail pane (xterm.js)
claude agents --json ──┘                                   ▲               cards, timeline (later)
replay / simulated ────────────────────────────────────────┘  (also runs in the browser with no agent)
```

1. **Sources** emit events. v1 ships three real ones, HTTP hooks, a status line command and the agents-list poll, plus two synthetic ones, a simulated fleet and a replay of recorded logs. Later sources, such as an Azure DevOps poll for headless pipeline runs, plug in at the same interface.
2. **Local agent** (Node). The only component that sees raw hook payloads. It strips content at the door, appends redacted events to a local log, runs the state machine, owns the alias map, serves snapshots and the per-session ticker over SSE, and executes focus commands.
3. **Web app** (Next.js). Renders snapshots. In local mode it subscribes to the agent's SSE stream. With no agent present it runs the simulated source in the browser, which is how the Vercel deployment and stage-one development work. Cloud mode (P2) reads anonymised snapshots from Redis.
4. **Desktop app** (Electron). The agent and the web app's static export in one process, run from an unzipped folder: the agent in the main process, the visualiser in a sandboxed window over a custom scheme, a tray icon, and a settings window that watches folders and installs the hooks under the app's own binary. See `docs/superpowers/specs/2026-09-14-desktop-app-design.md`.

The web app never talks to Claude Code and never reads transcripts. The snapshot and ticker schemas in section 8 are the whole contract between the two halves, which is what allows them to be built in parallel.

## 7. Functional requirements

Priority: **P0** first usable version · **P1** next · **P2** later.

### 7.1 Session discovery (P0)

- **FR-1** Detect a session on its first hook event of any kind. The HTTP `SessionStart` hook does not fire in practice; the command hook does, so the installer registers both.
- **FR-2** Detect end on `SessionEnd`, or on disappearance from `claude agents --json`, which the agent polls every few seconds. A killed session sends no `SessionEnd`. The agents list includes interactive and headless sessions with PID, working directory, start time and session ID.
- **FR-3** Group sessions by working directory into panes. A pane is created when its first session appears and removed when its last session ends or leaves the view (FR-7a).
- **FR-4** Directory allowlist. User-level hooks fire for every session on the machine, so the agent only accepts sessions whose working directory matches a configured allowlist. Everything else is dropped at ingest, before logging.

### 7.2 State derivation (P0)

- **FR-5** Each session has exactly one state: `working`, `waiting`, `idle`, `asleep`, `done`.
- **FR-6** Transitions are defined in section 9. `idle` becomes `asleep` after a configurable period (default 10 minutes).
- **FR-7** Each state and activity has a minimum display duration (default 1.5 s) to prevent flicker.
- **FR-7a** Dormant sessions leave the view. A working session is always shown, and a waiting one until it has waited 36 hours, after which it is hidden until it is answered. A session with no typed prompts is never shown; one with a single prompt is hidden 3 hours after its last activity, one with two to eight after 24 hours, and one with more is never hidden. A hidden session returns on its next prompt. Prompt counts come from the session's transcript, read locally by the agent, which keeps only the number.

### 7.3 Activity categorisation (P0)

- **FR-8** Map tool names to categories: `read` (Read, Glob, Grep), `edit` (Edit, Write, NotebookEdit), `run` (Bash, PowerShell), `web` (WebFetch, WebSearch), `spawn` (Agent), `think` (between events), `other` (MCP tools and unknown).
- **FR-9** Redaction at ingest. The agent keeps from each payload only: session ID, working directory (hashed to a pane alias), event name, tool name, tool-use ID, duration, agent ID and type for subagents, permission mode, `background_tasks` counts, `SessionEnd` reason, and the status line's context, cost and rate-limit numbers. `prompt`, `tool_input`, `tool_response`, `last_assistant_message`, transcript paths and session names are discarded before anything is stored. A test suite feeds recorded payloads through ingest and asserts none of those fields survive.
- **FR-9a** Detail levels. An agent setting `detail` with values `none` (default), `hints` and `paths`, cumulative, decides what an event may carry beyond FR-9 in an optional `detail` object. `hints`: the program name of a shell command, the extension of a file read or edited, the hostname of a fetch, the subagent type of an Agent call, the permission mode, the number of background shells. `paths`: the file or directory a tool touches relative to the working directory, the working directory, the session's name, an Agent call's short description. The event log and any cloud snapshot are always level `none`: core's `stripDetail` removes every `detail` key, and four invariants are proven by test (detail levels design §4).

### 7.4 Subagents (P0)

- **FR-10** Track the live subagent count per session from `SubagentStart` and `SubagentStop`, ignoring internal helpers, which arrive as a `SubagentStop` with an empty `agent_type` and no matching start. The parent's `Stop` payload also lists running subagents in `background_tasks`.

### 7.5 Context usage (P1)

- **FR-11** Show context-window used percentage per session. Interactive sessions report it through the status line command, whose input JSON carries `context_window.used_percentage`. Headless sessions fall back to the latest assistant `message.usage` in the transcript, parsed by the agent and reduced to a number; the transcript itself is never forwarded.

### 7.6 Privacy and anonymisation (P0)

- **FR-12** The agent assigns each session a random alias and each working directory a pane alias. The mapping is persisted locally so aliases survive an agent restart, and exists nowhere else.
- **FR-13** The published snapshot contains only the fields in section 8.
- **FR-14** Cloud mode is off by default, requires explicit configuration, and receives snapshots with tool names reduced to categories.
- **FR-15** Session labels are generated (animal names), never the session name. Pane labels default to the working directory's last path segment (`visualiser` for `C:\mw\visualiser`), numbered on collision (`visualiser 2`); an agent setting selects generated tree names instead, and cloud snapshots always carry generated names.

### 7.7 Visualisation: terminal panes (P0 basic, P1 polish)

The look is the "panes" concept from the proof of concept: a black terminal with pixel stars and drifting block clouds, tmux-style status bars top and bottom, and box-drawn panes.

- **FR-16** One pane per working-directory alias, drawn with box-drawing borders and titled with the pane label. Panes are laid out in a grid that grows as panes are added and never reorders existing panes while they are live.
- **FR-17** One Clawd per session, seated inside its pane at a stable seat for the life of the session. A new session walks in from the pane's bottom edge to the next free seat; a finished session walks back out. Vacated seats are reused before the pane grows.
- **FR-18** The Clawd is the canonical 14 by 8 sprite in `#CD6E58` with single-pixel eyes and no mouth, rendered on a pixel grid with the engine from the clawd-animation skill. Mood is carried by eyes, accessories and particles, never by a mouth. Appearance by state:

  | State | Clawd |
  |---|---|
  | `working` | eyes down, breathing, a trickle of keystroke particles coloured by activity |
  | `waiting` | amber `!` above the head, a small hop every second and a half, a sweat drop after ten seconds |
  | `idle` | eyes forward, blinks every few seconds |
  | `asleep` | eyes closed, body slightly dimmed, drifting `z Z` |
  | `done` | waves alternate claws with heart particles, then walks out and fades |
  | walking | alternating legs, eyes toward the destination |

- **FR-19** Subagents appear as 7 by 4 mini Clawds that scuttle out to their parent's side and back; the parent glances at them and its eyes sparkle on spawn. The live count also appears on the nameplate.
- **FR-20** Nameplate under each Clawd: label, state, activity and time in the current state. Context percentage renders as a thin bar under the nameplate (P1).
- **FR-21** The top status bar shows the session count, waiting count and subagent count; the bottom bar shows navigation and the clock. Ambient stars twinkle and clouds drift.
- **FR-22** Animation pauses when the tab is hidden.

### 7.8 Attention (P0)

- **FR-23** `waiting` is visually distinct at a glance: the amber `!`, the hop, an amber nameplate, and the pane's border turning amber while anyone inside is waiting.
- **FR-24** The browser tab title shows the number of waiting sessions.
- **FR-25** Optional sound on transition into `waiting`, off by default (P1).

### 7.9 Click: focus and detail (P1)

- **FR-26** Clicking a Clawd issues a focus command for its alias. The agent resolves the alias to a session in the agents list and raises its window by working directory: the VS Code workspace window for that directory, or the top-level window owning the process for a terminal session (Windows). Tabs and panels inside the window are not targeted.
- **FR-27** Clicking a Clawd also opens a detail pane rendered with xterm.js, styled as a terminal, that streams the session's **redacted ticker**: one line per event with timestamp, event name, activity category, tool name, duration, state transitions, subagent starts and stops, and context percentage. Above level `none`, a tool line also shows its subject: the file, program, host or agent (FR-9a). Because redaction happened at ingest, the ticker cannot contain prompt text, full tool arguments or assistant output. Above level `none` a tool line carries only its derived subject; file paths and Agent descriptions appear only at level `paths`, and only in the local view. The local event log holds the same events at level `none`. The ticker is local-mode only and is never part of a cloud snapshot.
- **FR-28** If the session has ended, the detail pane shows a copyable `claude --resume <id>` command instead (P2).

### 7.10 Timeline view (P1)

- **FR-29** A swimlane below the panes: one row per session, blocks per activity coloured by category, last 30 minutes.

### 7.11 File collision warning (P1)

- **FR-30** The agent detects two live sessions in the same pane editing the same file within a time window and publishes a warning flag on the pane, shown as a warning marker on the pane border. The path itself is never published; the comparison happens on a hash that is discarded after the window.

### 7.12 Simulated and replayed sources (P0 simulated, P1 replay)

- **FR-31** A simulated source runs in the browser with no agent: it invents sessions and walks them through the state machine on timers. It is the default when no agent is reachable, so the Vercel deployment and stage-one development show a live city from the first push.
- **FR-32** The agent can replay a recorded redacted event log at adjustable speed, so real behaviour can be reproduced without live sessions. The spike's recordings, redacted, form the first fixture.

### 7.13 Cloud mode (P1)

- **FR-33** The agent pushes anonymised snapshots to the Vercel-hosted app via Upstash Redis, authenticated with a shared secret, on change and at most a few times a second.
- **FR-34** The web app polls or streams snapshots; the agent polls for pending commands, such as focus, on an outbound request. No inbound ports on the machine.
- **FR-35** What a remote viewer sees is exactly the section 8 snapshot with tool names reduced to categories: panes, Clawds, states, activities, subagent counts and context percentages. The detail ticker is not published, so the detail pane on a remote device shows the snapshot fields only.

### 7.14 Remote runs (P2, undecided)

- **FR-36** Headless Claude calls in Azure DevOps pipelines could appear as Clawds in a pipeline pane by polling the ADO Builds API from the agent with a read-only token, one per Claude-running task, state from task status. This needs no change to the pipelines themselves. Sharing the same Claude account gives no visibility of those runs, since the agents list is per machine and there is no account-level session registry; the only account-wide trace is rate-limit consumption in the status line. Not yet decided.

## 8. Contracts

These two schemas are the entire interface between the agent and the web app, and the whole set of data that may leave the agent. Both carry a version.

```ts
type Snapshot = {
  version: 1;
  generatedAt: string;                 // ISO timestamp
  panes: PaneSnapshot[];
  sessions: SessionSnapshot[];
  ext?: Record<string, unknown>;       // room for plugins; never required by the core views
};

type PaneSnapshot = {
  pane: string;                        // "pane-2"; alias of the working directory
  label: string;                       // generated
  collision: boolean;
};

type SessionSnapshot = {
  alias: string;                       // "agent-3"; random; mapping to session ID and PID stays local
  label: string;                       // "Otter"; generated display name
  pane: string;
  state: "working" | "waiting" | "idle" | "asleep" | "done";
  activity: "read" | "edit" | "run" | "web" | "spawn" | "think" | "other" | null;
  subagents: number;
  contextPct: number | null;
  since: string;                       // ISO timestamp the current state began
  updatedAt: string;
  ext?: Record<string, unknown>;
};

// One line of the detail ticker. Local mode only.
type TickerEvent = {
  t: string;                           // ISO timestamp
  kind: "session.start" | "session.end" | "prompt" | "tool.start" | "tool.end"
      | "permission" | "stop" | "subagent.start" | "subagent.stop" | "state" | "context";
  activity?: SessionSnapshot["activity"];
  tool?: string;                       // built-in tool name, or "mcp" for MCP tools
  durationMs?: number;
  agentType?: string;                  // subagent type
  state?: SessionSnapshot["state"];    // for "state"
  contextPct?: number;                 // for "context"
  reason?: string;                     // for "session.end"
};
```

Rule for extending either type: add optional fields or use `ext`; bump `version` only for breaking changes. Views must ignore fields they do not know.

## 9. State machine

| From | Event | To |
|---|---|---|
| any | `UserPromptSubmit` | `working` |
| `working` | `PreToolUse` / `PostToolUse` | `working` (activity updated) |
| `working` | `PermissionRequest` (any tool, including AskUserQuestion) | `waiting` |
| `waiting` | `PostToolUse` for the same `tool_use_id`, or `PermissionDenied` | `working` |
| `working` | `Stop` with empty `background_tasks` | `idle` |
| `working` | `Stop` with running `background_tasks` | `working` (subagents still busy) |
| `idle` | timer exceeds asleep threshold | `asleep` |
| `idle` / `asleep` | `UserPromptSubmit` | `working` |
| any | `SessionEnd`, or missing from agents list | `done` |

`waiting` starts on `PermissionRequest`, not on the `Notification` that follows it about six seconds later. `StopFailure` is treated as `idle` with an error flag; a dedicated `error` state is a candidate for later. The state machine lives in `packages/core`, is pure, and is tested against recorded fixtures.

## 10. Non-functional requirements

- **NFR-1** Zero model tokens consumed by observation. No `prompt` or `agent` hook types; no `additionalContext` returned from any hook.
- **NFR-2** Hook handlers return within 100 ms and always exit 0. If the agent is down, sessions are unaffected. The status line command prints a line itself, wrapping any status line the user already had, so their status bar never goes blank.
- **NFR-3** Local event-to-screen latency under 2 seconds.
- **NFR-4** Ten sessions on screen at a few percent CPU: one canvas, one draw loop at 30 frames a second, no per-agent DOM, paused when the tab is hidden.
- **NFR-5** Windows 11 first; no admin rights required.
- **NFR-6** The scene renders on a pixel grid with `image-rendering: pixelated`; positions are rounded to grid cells so nothing anti-aliases.
- **NFR-7** No session content in the app. Proven by the ingest redaction tests and by a schema check that the SSE stream contains only the section 8 types.

## 11. Technical approach

- **Monorepo** (pnpm workspaces, TypeScript strict throughout):
  - `packages/core`: event types, ingest redaction, the state machine, snapshot and ticker schemas, the simulated source, fixture loading. Pure, no browser or Node APIs, fully tested. Built first, because both apps depend on it.
  - `packages/scene`: the canvas renderer. The engine block from the clawd-animation skill template (palette, pixel grid, `CLAWD_BODY`, eyes, particles, easing) is kept intact as a module; the panes scene is written around it, as the skill prescribes. Framework-free; takes a snapshot, draws a frame.
  - `apps/web`: Next.js App Router, Tailwind for layout and chrome, shadcn/ui for structural components restyled to the terminal look (monospace, square corners, the dark palette), xterm.js for the detail pane. Hand-written CSS only for deliberate "juice": the status bar blink, glows, the odd transition.
  - `apps/agent`: the local Node service. Hook receiver, status line receiver, agents-list poller, redacted event log, SSE server, focus commands, settings installer.
- **Sprite source.** The canonical Clawd matrix is the skill template's `CLAWD_BODY`, copied once into `packages/scene` with its palette and eye variants. Static uses in the chrome, such as the favicon and empty states, are rendered from the same matrix so there is one definition of the character.
- **Styling rule.** Tailwind utilities by default; shadcn components for anything with behaviour; custom CSS is the exception and lives in one file per effect.
- **No animation libraries.** Movement is easing on the pixel grid inside the scene; UI transitions are CSS.
- **Hooks and status line** are registered in `~/.claude/settings.json` by an installer that backs up the file, adds `http` hooks for every event plus the command hook for `SessionStart`, and wraps any existing status line.
- **Windows focus:** resolve the session's PID from the agents list, walk to the top-level window, `SetForegroundWindow` via PowerShell, with the taskbar flash as fallback.
- **Development in parallel.** Contract first: `packages/core` with fixtures lands before the fork. Then the web app and the agent proceed in separate sessions on separate git worktrees, each tested against the same fixtures, neither needing the other running. Changes to `packages/core` are made by one session at a time.
- **Deployment.** GitHub with a Vercel deployment of `apps/web` from the first commit, running the simulated source, so the city is visible online before any agent exists.
- **Desktop deployment.** `apps/desktop` packages the agent and the web app's export into one folder, zipped, with electron-builder: `Clawd-Visualiser-<version>-win-x64.zip`. Unzipped and run; no installer, no updater, no signing. The hooks run under the app's own binary with `ELECTRON_RUN_AS_NODE=1`, so teammates need no Node install.

## 12. Milestones

The contract comes first and is the fork point. After it, the web app and the agent are built concurrently in separate sessions on separate worktrees, each against the shared fixtures, and meet again at integration.

**Before the fork**

| # | Milestone | Outcome |
|---|---|---|
| M0 | Spike | Done. Hook payloads, subagent lifecycle, kill behaviour, agents-list contents, the permission path and the status line source are measured in `docs/spike-hooks.md`. |
| M1 | Contract | Monorepo scaffold. `packages/core` with the section 8 schemas, the event types, ingest redaction, the state machine, the simulated source and recorded fixtures, all under test. The SSE endpoint shape (snapshot stream, per-session ticker stream) is written down. This is the only milestone both tracks depend on. |

**Track A: web app** (consumes snapshots; runs on the simulated source until the agent exists)

| # | Milestone | Outcome |
|---|---|---|
| A1 | Deployed shell | Next.js app with Tailwind and shadcn/ui, deployed to Vercel from the first commit, showing session cards from the simulated source. |
| A2 | Panes scene | The proof of concept ported into `packages/scene` and the app: panes, Clawd states, subagents, status bars, attention rules, tab title. |
| A3 | Detail pane | Click a Clawd for the xterm.js ticker, driven by simulated ticker events; the focus button wired to the command contract. |

**Track B: local agent** (produces snapshots; tested against the fixtures, no web app needed)

| # | Milestone | Outcome |
|---|---|---|
| B1 | Ingest | Hook and status line receivers, redaction at the door proven by the fixture tests, redacted event log, directory allowlist. |
| B2 | Reconcile and serve | Agents-list polling, alias persistence, state machine driven from live events, SSE snapshot and ticker streams matching the contract. |
| B3 | Install and focus | Settings installer with backup and status line wrapping; Windows window raising by working directory. |

**After both tracks**

| # | Milestone | Outcome |
|---|---|---|
| M5 | Integration | The web app switches from simulated to live when an agent is present; end-to-end with real sessions. |
| M6 | Cloud mode | The agent publishes to Redis; the Vercel app shows the live city on any device; commands flow back by outbound polling. |
| M7 | Replay and timeline | Replay recorded logs at speed; swimlane view; collision warning. |

**Desktop**

| # | Milestone | Outcome |
|---|---|---|
| M8 | Desktop | The Electron app in six stages, one Electron idea each: the window, the agent inside, the packaged UI over `app://`, the tray, the settings window, the package; then the review fixes (6.1) and two hardening stages (7 and 8) that closed the design's §12.1. Done when a teammate unzips the folder, runs the exe and sets up the hooks from the settings window, and moving the folder and relaunching repairs the hooks and the login item. Stage 9 adds a widget view, each pane its own frameless window that can be dragged and pinned on top; stage 10 adds a popup when a turn finishes (`docs/superpowers/specs/2026-09-21-desktop-widgets-design.md`). |

## 13. Open questions

1. Still unmeasured from the spike: `PermissionDenied` on an explicit deny, and whether an idle notification exists after a longer wait. Neither blocks the state machine.
2. Where the agent runs: standalone process started on login is the working assumption; inside the Next.js dev server is the alternative.
3. Product name.
4. Remote runs (FR-36): whether to add the Azure DevOps source, and when. It is the only viable route; the shared account offers none.
5. Whether MCP tool names appear in the ticker as `mcp` alone or with the server name. Default is `mcp` alone until decided.

## 14. Risks

- The hook event set and payload fields may change between Claude Code versions. Pin a version and keep the event mapping in one file in `packages/core`.
- The transcript JSONL format is documented as internal. Only the headless context fallback depends on it.
- Vercel functions cap a streaming response at 300 s (Hobby) or 800 s (Pro). Use polling in cloud mode.
- Windows foreground-lock rules can block `SetForegroundWindow`. Fall back to flashing the taskbar button.
- xterm.js adds bundle weight; load it only when a detail pane opens.

## 15. Success criteria

- Waiting sessions are identifiable within one second of looking at the screen.
- No measurable change in Claude Code responsiveness with hooks enabled.
- Zero tokens attributable to the visualiser.
- The scene runs all day at a few percent CPU.
- The redaction test suite passes on every recorded payload, and the SSE stream validates against section 8.

## 16. Decision log

| Date | Decision |
|---|---|
| 11 Sep 2026 | Hex-tile pixel city replaced by Kenney isometric packs. |
| 11 Sep 2026 | Work pipelines under `C:\git\b2b` are never modified for this project; remote runs, if any, are observed by polling ADO. |
| 12 Sep 2026 | Kenney city replaced by the terminal panes concept with the canonical Clawd on the clawd-animation canvas engine. |
| 12 Sep 2026 | Focus is raised by working directory; no tab targeting. |
| 12 Sep 2026 | No session content anywhere in the app; the detail pane shows a redacted ticker only. |
| 12 Sep 2026 | Tailwind and shadcn/ui for chrome; xterm.js for the detail pane; no animation libraries. |
| 12 Sep 2026 | Contract first, then the web app and the agent concurrently in separate sessions on worktrees; the web app deploys on simulated data from its first commit. |
| 12 Sep 2026 | Viewing from other devices is a goal from the start: cloud mode is P1 and follows integration; remote viewers get the anonymised snapshot only, never the ticker. |
| 13 Sep 2026 | Pane labels in the local view are the working directory's last path segment, numbered on collision, behind an agent setting; cloud snapshots keep generated tree names. Session labels stay generated. |
| 14 Sep 2026 | Detail levels: an opt-in agent setting adds hints or paths to the local view; the event log and the cloud stay at level none through one strip function with invariant tests. Content is never read at any level. |
| 14 Sep 2026 | Desktop app: the agent runs in Electron's main process; the UI is the static export over a custom scheme; the hooks run under the app's own binary; shipped as a zipped folder with no installer, electron-builder's `portable` target ruled out. |
| 21 Sep 2026 | The packaged desktop app's agent does not accept the dev server's origins (`http://localhost:3000`, `http://127.0.0.1:3000`); the CLI and a development run still do. An option on `startAgent`, not a config field. |
| 21 Sep 2026 | A session that has waited 36 hours for an answer leaves the view, whatever its prompt count, and returns the moment it is answered; it stays `waiting` in the fleet. |
| 21 Sep 2026 | The settings window ships JetBrains Mono from a dev dependency, copied at bundle time; no font binary is checked in. |
| 21 Sep 2026 | Desktop widgets: a widget is a pane, drawn by a page of the desktop package that main feeds over IPC and that may open no connection; the Next app gains only a `#session=` link. Windows are dragged by hand, since a CSS drag region swallows clicks. A finished turn means working to idle, and its popup goes down on a press or the next prompt, never on a timer. |
| 22 Sep 2026 | The finished popup raises a box by window level (`screen-saver` above the pinned `floating`), never by a z-order move, since Windows refuses those from a background process; the full window's focus at the moment of the finish decides whether a popup is made; a press lowers a temporary box by closing it at once. |
| 22 Sep 2026 | A raise goes to one place, the bottom-right corner of the primary display, in both views: in widget view the widget itself is moved there unless it is pinned, and a popup no longer opens where the folder's widget was last dragged. The maintainer watches one corner, not wherever each box happens to live. A lowered box stays in the corner; only a drag by hand is remembered. |
| 23 Sep 2026 | The finished popup also fires when a session goes from working to waiting, for a permission or a question, and a wait no longer lowers a raised box; only working again, a press or leaving does. Amber alone was missed when the box sat on another display. |
| 23 Sep 2026 | A click on a raised, unpinned widget sends it behind every other window: seen, and out of the way. A drag leaves it in front where it was dropped. The move is Win32's `SetWindowPos` through koffi, the desktop package's first native dependency, whose win-x64 binary ships beside the archive; Electron has no call for it. |
| 23 Sep 2026 | Where a box pops up is a setting: the corner, the default, or in place, where the folder's widget already is. |
