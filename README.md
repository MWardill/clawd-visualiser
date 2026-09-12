# Clawd Visualiser

A dashboard that shows every Claude Code session on your machine as a Clawd, the Claude Code crab,
sitting in a terminal-style pane for its repository. At a glance you can see which sessions are
working, which are waiting on you and which are asleep, and click one to jump to its window.

It costs zero model tokens: everything is observed through Claude Code's hooks and a small local
process, and the model is never asked to report on itself. No session content is ever displayed or
transmitted. Prompts, tool arguments and outputs, file paths and assistant text are stripped at
ingest; what remains is state, activity category and timing.

## Status

Design complete, build starting. The product requirements are in [docs/PRD.md](docs/PRD.md), and the
measured facts about Claude Code's hooks that the design rests on are in
[docs/spike-hooks.md](docs/spike-hooks.md).

## Layout

A pnpm workspace. Packages export TypeScript source directly; the web app compiles them.

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js app (App Router, Tailwind, shadcn/ui). Renders snapshots; runs on the simulated source when no agent is present. |
| `packages/core` | Contracts, redaction, state machine, aliases, simulated and replay sources, fixtures. Pure TypeScript, tested with Vitest. See its README. |
| `packages/scene` | The canvas renderer: the Clawd pixel engine and the panes scene. Framework-free. |
| `docs/PRD.md` | Requirements, contracts, state machine, milestones, decision log. |
| `docs/spike-hooks.md` | What the hooks, agents list and status line actually provide, measured on real runs. |
| `tools/hook-spike/` | The listener and settings used for those measurements; reusable for further checks. |

The local agent (`apps/agent`) arrives with milestone B1.

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

## Credits

- **Clawd** is the Claude Code mascot by Anthropic.
- The character engine, the canonical 14 by 8 Clawd matrix and its expression vocabulary come from
  the **clawd-animation** skill by mmguo, found at <https://mmguo.dev/clawd/>. The visualiser draws
  its Clawds with that engine and follows its rules: one flat body colour, single-pixel eyes, no mouth,
  mood carried by eyes, accessories and particles.
