# @clawd/desktop

The desktop app: the agent and the visualiser in one window and the tray, run from a folder.
Built in stages, one Electron idea at a time. Design:
`docs/superpowers/specs/2026-09-14-desktop-app-design.md`.

## Run (development)

Start the agent and the web app as usual, then the desktop app:

```
pnpm --filter @clawd/agent start
pnpm dev
pnpm --filter @clawd/desktop dev
```

The window loads `http://localhost:3000` by default. `--dev-url <url>` or `CLAWD_DESKTOP_URL`
point it elsewhere, for example `--dev-url "http://localhost:3000/?source=simulated"`.

Renderer changes hot-reload through Next. A change under `src/` needs the dev command run again:
it bundles `src/main.ts` into `dist/main.cjs` and starts Electron on it.

```
pnpm --filter @clawd/desktop test
pnpm --filter @clawd/desktop typecheck
```

## Stage notes

### Stage 1: the window

Electron is two kinds of process. The **main process** is one Node program: it starts first, owns
the app lifecycle (`ready`, windows closing, quit) and makes windows. It never draws anything. Each
window is a **renderer**: a Chromium page in its own process, and in this app a sandboxed one with
no Node access and no preload, so it is a web page that talks to the agent over HTTP exactly as a
browser tab does. The two kinds share nothing unless a preload bridge is added on purpose, which
stage 5 does for the settings window.

Because Electron loads `main` from `package.json` as a plain Node module, and the workspace
packages export TypeScript, a bundler runs first: esbuild turns `src/main.ts` into one CommonJS
file with `electron` left external, since the runtime provides it.

One thing to know about the binary: with `ELECTRON_RUN_AS_NODE=1` in the environment it runs as
plain Node and ignores the app entirely, which is how the hook scripts will use it in stage 5. A
VS Code extension host sets that variable and its children inherit it, so if `electron --version`
prints a Node version, unset it (or prefix the command with `env -u ELECTRON_RUN_AS_NODE`).
