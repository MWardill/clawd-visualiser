// The main process: the one Node program in the app. It owns the lifecycle and the windows and,
// from stage 2, runs the agent itself; Chromium draws, in a sandboxed renderer process per window.
import { agentPaths, createLogger, defaultHome, startAgent } from "@clawd/agent";
import { app, type BrowserWindow } from "electron";
import { fetchCounts, probeHealth } from "./agent-client";
import { createAgentHost, statusText } from "./agent-host";
import { ownArgs, parseArgs, resolveDevUrl } from "./args";
import { createFileSink, readRetentionDays } from "./log";
import { createQuitHandler } from "./quit";
import { createMainWindow } from "./window";

const args = parseArgs(ownArgs(process.argv, app.isPackaged));
const url = resolveDevUrl(args, process.env);
const home = defaultHome();

// The agent's own logger, writing to a dated file: codes and numbers only. In development the
// lines also reach the terminal that ran the dev command.
const sink = createFileSink(agentPaths(home).logs, { now: Date.now, retentionDays: () => readRetentionDays(home) });
const log = createLogger((line) => {
  sink.write(line);
  if (!app.isPackaged) process.stdout.write(line);
});

let win: BrowserWindow | null = null;

const host = createAgentHost({
  start: (onSnapshot) => startAgent({ home, log, onSnapshot }),
  probe: (port) => probeHealth(port),
  counts: (port) => fetchCounts(port),
  log,
  onChange: (state) => {
    if (win !== null && !win.isDestroyed()) win.setTitle(statusText(state));
  },
});

// Without these, an error nothing caught ends the app behind Electron's crash dialog. The host
// logs it by code and restarts the agent when the app owns it.
process.on("uncaughtException", () => host.fault());
process.on("unhandledRejection", () => host.fault());

// `ready` fires once Electron has initialised; no window can be made before it.
void app.whenReady().then(() => {
  log("desktop.started", { packaged: app.isPackaged });
  host.start();
  win = createMainWindow(url, statusText(host.state()));
  win.on("closed", () => {
    win = null;
  });
});

// Stage 2 still quits when the window closes; stage 4 hides it instead and keeps the tray.
app.on("window-all-closed", () => app.quit());

// `will-quit` comes after every window has closed. The handler holds it until the agent has stopped
// (at most five seconds), writes out the log, then exits.
app.on("will-quit", createQuitHandler({ stop: () => host.stop(), flush: () => sink.flush(), exit: (code) => app.exit(code), log }));

// Ctrl+C in the terminal asks for the same sequence.
process.on("SIGINT", () => app.quit());
process.on("SIGTERM", () => app.quit());
