# Clawd Visualiser

A dashboard that shows every Claude Code session on your machine as a Clawd, the Claude Code crab,
sitting in a terminal-style pane for its repository. At a glance you can see which sessions are
working, which are waiting on you and which are asleep, and click one to jump to its window.

It costs zero model tokens: everything is observed through Claude Code's hooks and a small local
process, and the model is never asked to report on itself. Prompts, full commands, tool outputs and
assistant text are stripped at ingest and never displayed or transmitted; by default what remains is
state, activity category and timing. An opt-in `detail` setting on the agent can add short hints
taken from tool calls (a program name, a hostname, a file path) and session names to the local view
only; the cloud always gets the anonymised form.

## Status

The contract (`packages/core`) and the web app (Track A: the panes scene, the simulated and live
feeds, the detail ticker) are built. The local agent (Track B) is in progress on its own branch.
The product requirements are in [docs/PRD.md](docs/PRD.md), and the measured facts about Claude
Code's hooks that the design rests on are in [docs/spike-hooks.md](docs/spike-hooks.md).

## Layout

A pnpm workspace. Packages export TypeScript source directly; the web app compiles them.

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app (App Router, Tailwind, shadcn/ui). The panes scene on one canvas, fed by the agent's SSE stream when one answers and by the simulated source otherwise; a detail sheet with the redacted ticker in xterm.js. See `docs/superpowers/specs/2026-09-12-web-app-design.md`. |
| `apps/agent` | The local agent: hook and status line receivers, redaction at ingest, presence polling, snapshot and ticker streams, the settings installer and Windows window focus. See its README. |
| `apps/desktop` | The Electron app, built in stages: the agent and the visualiser in one window and the tray, run from a folder. Stage 4 adds the tray: closing the window keeps the agent running, one copy runs at a time, and it can start hidden at login. See its README. |
| `packages/core` | Contracts, redaction, state machine, aliases, simulated and replay sources, fixtures. Pure TypeScript, tested with Vitest. See its README. |
| `packages/scene` | The canvas renderer: the Clawd pixel engine and the panes scene. Framework-free; takes a snapshot, draws a frame. See its README. |
| `docs/PRD.md` | Requirements, contracts, state machine, milestones, decision log. |
| `docs/spike-hooks.md` | What the hooks, agents list and status line actually provide, measured on real runs. |
| `tools/hook-spike/` | The listener and settings used for those measurements; reusable for further checks. |

To see real sessions, install the agent's hooks and start it; see [apps/agent/README.md](apps/agent/README.md).

## Develop

```
pnpm install
pnpm dev          # web app on http://localhost:3000
pnpm test         # every package
pnpm typecheck
pnpm lint
pnpm build
```

Requires Node 22 or later and pnpm 12, pinned in `package.json`.

The web app looks for the agent at `http://127.0.0.1:4750` (override with `NEXT_PUBLIC_AGENT_URL`
at build time) and falls back to the simulated fleet when nothing answers. `?source=simulated`
forces the simulation; `?source=live` disables the fallback. Click a Clawd for its ticker.

## Credits

- **Clawd** is the Claude Code mascot by Anthropic.
- The character engine, the canonical 14 by 8 Clawd matrix and its expression vocabulary come from
  the **clawd-animation** skill by mmguo, found at <https://mmguo.dev/clawd/>. The visualiser draws
  its Clawds with that engine and follows its rules: one flat body colour, single-pixel eyes, no mouth,
  mood carried by eyes, accessories and particles.
