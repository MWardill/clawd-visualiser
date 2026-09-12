# Claude Agent Visualiser (working title)

**Product Requirements Document, high level**
Version 0.2 · Draft · 11 September 2026

---

## 1. Summary

A local-first dashboard that shows every Claude Code session running on a machine as an office building in a small isometric city. At a glance you can tell which agents are working, which are waiting on you, and which are asleep, and click one to jump to its window. It costs zero model tokens, and no sensitive data leaves the machine.

## 2. Problem

- Several Claude Code sessions run in parallel across repos (today: six sessions across four repos), each in its own terminal or VS Code window.
- A session blocked on a permission prompt looks identical to one that is working until you go tab-hunting.
- Finished sessions go unnoticed; working ones get interrupted.
- Existing tools focus on cost and usage, not live state.

## 3. Goals

1. **Glanceable state.** Within one second of looking, know which sessions need a human.
2. **Zero token cost.** All observation is done by the Claude Code harness and a local process. The model is never asked to report on itself.
3. **Private by default.** No paths, commands, file contents, prompts, or repo names leave the machine. Cloud viewing is opt-in and receives only an anonymised summary.
4. **Fun to look at.** An isometric city where each session's building shows its state, built from Kenney's CC0 asset packs.
5. **Actionable.** Click a building to focus its window.
6. **Local first, cloud optional.** Works entirely on localhost. Can later be viewed from another device via Vercel.

## 4. Non-goals (v1)

- Sending prompts or answering permission prompts from the web UI. Claude Code Remote Control already covers that.
- Multi-user or team dashboards.
- Cost and usage accounting.
- Window focusing on macOS or Linux. Design for it, implement Windows first.
- A native mobile app.

## 5. Users

- **Primary:** a developer running multiple Claude Code sessions on one Windows machine.
- **Secondary:** any developer with the same setup who clones the repo.

## 6. System overview

Three components:

1. **Hook configuration** in Claude Code user settings. Each relevant event POSTs its JSON to the local agent on localhost. Fire-and-forget; never blocks a session.
2. **Local agent** (Node.js). The only component that sees raw data. Receives hooks, polls `claude agents --json` to reconcile, derives state, maps tools to activity categories, owns the alias map, serves snapshots to the web app, and executes focus commands.
3. **Web app** (Next.js). Renders the city.
   - *Local mode:* in-memory state, streamed to the browser over SSE.
   - *Cloud mode:* deployed to Vercel. The local agent pushes anonymised snapshots to Redis; the web app reads them; the local agent polls for commands.

```
Claude Code session ── hook POST (localhost) ──▶ Local agent ── SSE ──▶ Browser                      (local mode)
claude agents --json ── poll ──────────────────▶             ── push ─▶ Redis ─▶ Vercel app ─▶ Browser  (cloud mode)
                                                             ◀── poll ── commands ("focus agent-3")
```

## 7. Functional requirements

Priority: **P0** first usable version · **P1** next · **P2** later.

### 7.1 Session discovery (P0)

- **FR-1** Detect a session on `SessionStart`, or on the first hook event from an unknown session ID.
- **FR-2** Detect end on `SessionEnd`. Reconcile against `claude agents --json` on an interval to catch crashed or killed sessions.
- **FR-3** Group sessions by working directory into neighbourhoods: blocks of adjacent plots along the same street.

### 7.2 State derivation (P0)

- **FR-4** Each session has exactly one state: `working`, `waiting`, `idle`, `asleep`, `done`.
- **FR-5** Transitions are defined in section 9. `idle` becomes `asleep` after a configurable period (default 10 minutes).
- **FR-6** Each state and activity has a minimum display duration (default 1.5 s) to prevent flicker.

### 7.3 Activity categorisation (P0)

- **FR-7** Map tool names to categories: `read` (Read, Glob, Grep), `edit` (Edit, Write, NotebookEdit), `run` (Bash, PowerShell), `web` (WebFetch, WebSearch), `spawn` (Agent), `think` (between events), `other` (MCP tools and unknown).
- **FR-8** Only the category is published. Tool input is never retained beyond what the local agent needs in memory.

### 7.4 Subagents (P0)

- **FR-9** Track the live subagent count per session from `SubagentStart` and `SubagentStop`, ignoring internal helpers, which arrive as a `SubagentStop` with an empty `agent_type` and no matching start.

### 7.5 Context usage (P1)

- **FR-10** Show context-window used percentage per session, from the status line JSON for interactive sessions and the transcript for headless ones. The same status line payload carries cost and rate-limit usage, available to later features at no extra cost.

### 7.6 Privacy and anonymisation (P0)

- **FR-11** The local agent assigns each session a random alias and each working directory a neighbourhood alias. The mapping exists only locally.
- **FR-12** The published snapshot contains only the fields in section 8.
- **FR-13** Cloud mode is off by default and requires explicit configuration.
- **FR-14** Display labels are generated (for example animal names), never the session name or directory.

### 7.7 Visualisation: isometric city (P0 basic, P1 polish)

- **FR-15** A square-grid isometric map. Each session owns one plot beside a street; sessions from the same neighbourhood alias sit on the same street. A plot keeps its position for the life of the session, and vacated plots are reused before the city grows.
- **FR-16** Each session is a building assembled from Kenney parts: a ground floor, zero to three upper floors and a roof, chosen deterministically from the alias so a session looks the same every time. Appearance by state:
  - `working`: windows lit amber. The current activity shows as a bubble above the roof.
  - `waiting`: windows lit, a red "!" bubble that stays until the state changes.
  - `idle`: windows unlit.
  - `asleep`: windows dark, a "zZ" bubble.
  - `done`: a completion bubble for a short time, then the building is removed and the plot freed.
- **FR-17** The live subagent count shows as a small numeric badge on the building (P1). Animated helpers are out of scope for v1.
- **FR-18** Context percentage renders as the number of upper floors, growing as context fills (P1).
- **FR-19** Nameplate under each building showing label and time in current state.
- **FR-20** Animations pause when the tab is hidden.

### 7.8 Attention (P0)

- **FR-21** `waiting` is visually distinct from every other state at a glance.
- **FR-22** The browser tab title shows the number of waiting sessions.
- **FR-23** Optional sound on transition into `waiting`, off by default (P1).

### 7.9 Click to focus (P1)

- **FR-24** Clicking a building issues a focus command for its alias.
- **FR-25** The local agent resolves the alias to a session in the agents list and raises its window by working directory: the VS Code workspace window for that directory, or the top-level window owning the process for a terminal session (Windows). Tabs and panels inside the window are not targeted.
- **FR-26** If the session has ended, show a copyable `claude --resume <id>` command instead (P2).

### 7.10 Timeline view (P1)

- **FR-27** A swimlane below the office: one row per session, blocks per activity coloured by category, last 30 minutes.

### 7.11 File collision warning (P1)

- **FR-28** The local agent detects two live sessions in the same neighbourhood editing the same file within a time window and publishes a warning flag on the neighbourhood, shown as a warning bubble over the street. The path itself is never published.

### 7.12 Replay and dev mode (P1)

- **FR-29** The local agent can replay a recorded event log or historical transcript at adjustable speed, so the renderer can be developed and demoed without live sessions.

### 7.13 Cloud mode (P2)

- **FR-30** The local agent pushes snapshots to a Vercel-hosted app via Upstash Redis, authenticated with a shared secret.
- **FR-31** The web app polls or streams snapshots; the local agent polls for pending commands on an outbound request. No inbound ports.

## 8. Published snapshot schema

This is the entire set of data that may leave the local agent.

```ts
type SessionSnapshot = {
  alias: string;        // "agent-3"; random; mapping to session ID and PID stays local
  label: string;        // "Otter"; generated display name
  room: string;         // "room-2"; alias of the working directory
  state: "working" | "waiting" | "idle" | "asleep" | "done";
  activity: "read" | "edit" | "run" | "web" | "spawn" | "think" | "other" | null;
  subagents: number;
  contextPct: number | null;
  since: string;        // ISO timestamp the current state began
  updatedAt: string;
};

type RoomSnapshot = {
  room: string;
  collision: boolean;
};
```

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

`StopFailure` is treated as `idle` with an error flag for now; a dedicated `error` state is a candidate for later.

## 10. Non-functional requirements

- **NFR-1** Zero model tokens consumed by observation. No `prompt` or `agent` hook types; no `additionalContext` returned from any hook.
- **NFR-2** Hook handlers return within 100 ms and always exit 0. If the local agent is down, sessions are unaffected.
- **NFR-3** Local event-to-screen latency under 2 seconds.
- **NFR-4** Runs comfortably with ten sessions on screen. State changes swap sprites through CSS classes; bubbles animate with CSS keyframes; no per-frame JavaScript.
- **NFR-5** Windows 11 first; no admin rights required.
- **NFR-6** Sprites are anti-aliased renders, drawn at 1x or 2x with smooth scaling; buildings and tiles composite in painter's order by map depth.
- **NFR-7** All sprite assets are Kenney CC0 packs or files derived from them; Kenney is credited in the app.

## 11. Technical approach

- **Monorepo:** `apps/web` (Next.js App Router, TypeScript), `apps/local-agent` (Node, TypeScript), `packages/shared` (snapshot types, tool-to-activity map).
- **Store interface:** in-memory for local mode, Redis for cloud mode, same API.
- **Sprites:** Kenney packs, all CC0, under `sprites/`. Ground and roads from Isometric Landscape (grass) with Isometric City (concrete) as an alternative; buildings from Isometric Buildings; bubbles from the Emotes pack. Tiles are 132 px wide with a 132 by 66 top face on a square grid; +x runs screen down-right, +y down-left.
- **Derived assets and tools:** `tools/kenney-index.js` measures every ground tile and maps each road port set to tile indices; `tools/kenney-building-states.js` derives working (amber-lit) and asleep (dark) window variants of every building part by remapping the glass tones; `tools/kenney-city-preview.js` composes a sample city and is the reference for stacking and draw order. Outputs and geometry notes live in `sprites/kenney-derived/`.
- **Earlier direction:** the hex-tile pixel city under `sprites/hex-roads` and `sprites/hex-props` was superseded by the Kenney packs on 11 September 2026 and is kept for reference.
- **Windows focus:** walk the parent process chain from the Claude PID to the terminal or Code.exe window, then `SetForegroundWindow` via PowerShell.
- **Hooks:** registered in `~/.claude/settings.json` as `http` handlers pointing at localhost.

## 12. Milestones

| # | Milestone | Outcome |
|---|---|---|
| M0 | Spike | Done 11 September 2026 for the headless path; see `docs/spike-hooks.md`. Payload fields, subagent lifecycle, kill behaviour, agents-list contents and context source are measured. The interactive permission path remains on the checklist. |
| M1 | Plain dashboard | Cards per session with state and activity, SSE, agents-list reconciliation. Proves the data before the art. |
| M2 | Isometric city | Square-grid map, streets from the road index, one building per session with state variants, emote bubbles, plot allocation. |
| M3 | Click to focus | Windows window focusing from the browser. |
| M4 | Replay and timeline | Dev mode from recorded events; swimlane view. |
| M5 | Cloud mode | Vercel deployment with Redis and command polling. |

## 13. Open questions

1. Context percentage source: resolved. In interactive sessions the status line input JSON carries `context_window.used_percentage` along with cost, rate limits, model and session name, so a status line command that posts to the local agent is the source. For headless sessions the transcript's latest assistant `message.usage` is the fallback. See `docs/spike-hooks.md`.
2. Resolved 12 September 2026: `PermissionRequest` fires immediately when a decision is needed, including for AskUserQuestion, and the `Notification` with `notification_type: "permission_prompt"` follows about six seconds later. `waiting` therefore starts on PermissionRequest. Read-only shell commands were auto-approved without any event in the VS Code terminal. An explicit deny and idle notifications are still unmeasured.
3. Resolved by the spike: `SessionEnd` does not fire on a kill; the session simply disappears from `claude agents --json`, which lists interactive and headless sessions alike with PID, working directory and session ID. Reconciliation against that list is confirmed as the liveness mechanism, and it also gives the alias-to-PID mapping for click to focus.
4. Resolved 12 September 2026: focus is raised by working directory. For a VS Code session, raise the workspace window that has that directory open; for a terminal session, raise the top-level window owning the process from the agents list. No attempt to select a tab or panel inside the window.
5. Resolved by the spike: subagents are not in the agents list. They are visible through `SubagentStart` and `SubagentStop`, their tool events carry an `agent_id`, and the parent's `Stop` payload lists running subagents in `background_tasks`, so a parent at Stop with background tasks is still busy.
6. Activity bubbles: the Emotes pack has no read, edit, run or web glyphs. Use the thought-dots bubble for all activity, or add a second icon set.
7. Where the local agent runs: standalone process, or inside the Next.js dev server.
8. Product name.
9. Remote runs: headless Claude calls in Azure DevOps pipelines could be shown by polling the ADO Builds API from the local agent, one building per Claude-running task with state from task status. This needs no change to the pipelines. Not yet decided.

## 14. Risks

- The hook event set and payload fields may change between Claude Code versions. Pin a version and keep the event mapping in one file.
- The transcript JSONL format is documented as internal. Only replay mode depends on it.
- Vercel functions cap a streaming response at 300 s (Hobby) or 800 s (Pro). Use polling in cloud mode.
- Windows foreground-lock rules can block `SetForegroundWindow`. Fall back to flashing the taskbar button.

## 15. Success criteria

- Waiting sessions are identifiable within one second of looking at the screen.
- No measurable change in Claude Code responsiveness with hooks enabled.
- Zero tokens attributable to the visualiser.
- The office view runs all day at a few percent CPU.
