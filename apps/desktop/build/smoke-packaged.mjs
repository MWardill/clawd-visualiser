// Runs the packaged app once, hidden, against scratch folders and its own profile directory: the exe
// must run as plain Node (the hooks depend on it), the app must start as packaged and own its agent,
// and that agent must answer the health check from the visualiser's origin. Then the process and
// what it started are stopped by its own id. Nothing under the real ~/.clawd or ~/.claude is
// touched, and the installed copy of the app, if it is running, is neither disturbed nor mistaken
// for the one under test.
// pnpm --filter @clawd/desktop smoke
import { build } from "esbuild";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const exe = join(root, "release", "win-unpacked", "Clawd Visualiser.exe");
if (!existsSync(exe)) {
  console.error(`smoke: no packaged app at ${exe}; run pnpm --filter @clawd/desktop package first`);
  process.exit(1);
}

// The file formats and names this script touches belong to the app and the agent: bundled from their
// TypeScript, as build/icons.mjs does, so a change there reaches here.
const bundled = await build({
  stdin: {
    contents: [
      'export { agentPaths, readConfig, taskkillPath } from "@clawd/agent";',
      'export { DESKTOP_ORIGIN, ENDPOINTS } from "@clawd/core";',
      'export { createDesktopStore, desktopStatePath } from "./src/desktop-state.ts";',
      'export { logFileName } from "./src/log.ts";',
    ].join("\n"),
    resolveDir: root,
    sourcefile: "smoke-entry.mjs",
    loader: "js",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
});
const { agentPaths, readConfig, taskkillPath, DESKTOP_ORIGIN, ENDPOINTS, createDesktopStore, desktopStatePath, logFileName } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const home = await mkdtemp(join(tmpdir(), "clawd-smoke-home-"));
const claudeDir = await mkdtemp(join(tmpdir(), "clawd-smoke-claude-"));
const profile = await mkdtemp(join(tmpdir(), "clawd-smoke-profile-"));

/** Removes the scratch folders, with retries while a process that has just ended still holds a file. */
async function removeScratch() {
  for (const dir of [home, claudeDir, profile]) {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch((err) => console.warn(`smoke: could not remove ${dir} (${err.code ?? err.message}); delete it by hand`));
  }
}

// A remembered choice of off keeps the packaged app's first-run rule from writing a real Run key entry.
// The store drops a failed write, so the file is read back the way the app reads it at launch, where a
// missing, damaged or other-version file remembers nothing; without the choice nothing is started.
const seed = createDesktopStore(desktopStatePath(home, true));
seed.update({ openAtLogin: false });
await seed.flush();
const seeded = createDesktopStore(desktopStatePath(home, true));
await seeded.load();
if (seeded.get().openAtLogin !== false) {
  console.error("smoke: the scratch desktop.json does not read back as a choice of off, so the app could write a real Run key entry; nothing was started");
  await removeScratch();
  process.exit(1);
}
const env = { ...process.env, CLAWD_HOME: home, CLAUDE_CONFIG_DIR: claudeDir };
delete env.ELECTRON_RUN_AS_NODE;

const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const before = Date.now();
const asNode = spawnSync(exe, ["-e", "process.exit(0)"], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 10_000 });
if (asNode.status !== 0) {
  const cause = asNode.error?.message ?? (asNode.signal ? `signal ${asNode.signal}` : undefined);
  fail(`the exe did not run as Node (exit ${asNode.status}${cause ? `, ${cause}` : ""}); is the runAsNode fuse on?`);
} else console.log(`smoke: the exe ran as Node and exited in ${Date.now() - before} ms`);

// Its own profile directory: Electron derives the single-instance lock from it, so the installed copy's lock is not this one's.
const app = spawn(exe, ["--hidden", `--user-data-dir=${profile}`], { env, stdio: "ignore" });
/** Set once the app is gone: a spawn error, or its exit code and signal. The waits below stop on it at once. */
let ended = null;
app.on("error", (err) => {
  ended ??= err;
});
app.on("exit", (code, signal) => {
  ended ??= { code, signal };
});

/** Polls until `read` gives something truthy. */
async function waitFor(what, read, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (ended !== null) throw new Error(ended instanceof Error ? `the app failed to start: ${ended.message}` : `the app exited with ${ended.code === null ? `signal ${ended.signal}` : `code ${ended.code}`} before ${what}`);
    const value = await read().catch(() => null);
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`gave up waiting for ${what} after ${timeoutMs} ms`);
}

// The app picks its log file by each line's UTC day, so a run that crosses midnight spans two files.
const logDir = agentPaths(home).logs;
const firstLog = logFileName(Date.now());
const logText = async () => {
  const names = [...new Set([firstLog, logFileName(Date.now())])];
  return (await Promise.all(names.map((name) => readFile(join(logDir, name), "utf8").catch(() => "")))).join("\n");
};
/** The log's lines as records, in order; a line still being written is skipped. */
const logRecords = async () =>
  (await logText()).split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

try {
  await waitFor("desktop.started in the log", async () => (await logRecords()).some((record) => record.code === "desktop.started" && record.packaged === true), 20_000);
  console.log("smoke: the app started, and knows it is packaged");
  // Who serves the port, from the log and never from a missing line: the app's own agent logs
  // agent.started with the port it bound, and an app that found another agent answering there logs
  // desktop.attached. The config is written before the port is tried, so neither can be judged sooner.
  const owner = await waitFor(
    "the log to say whose agent serves the port (agent.started, desktop.attached or desktop.attachedRefused)",
    async () => (await logRecords()).find((record) => record.code === "agent.started" || record.code === "desktop.attached" || record.code === "desktop.attachedRefused"),
    10_000,
  );
  if (owner.code !== "agent.started") throw new Error(`another agent holds port ${owner.port} and answered instead; stop it (the CLI's, or a development run) and run the smoke again`);
  const config = await waitFor("config.json", () => readConfig(agentPaths(home)), 10_000);
  if (owner.port !== config.port) throw new Error(`the app's agent started on port ${owner.port}, but its config says ${config.port}`);
  const health = await waitFor(`health on port ${owner.port}`, async () => {
    const res = await fetch(`http://127.0.0.1:${owner.port}${ENDPOINTS.health}`, { headers: { origin: DESKTOP_ORIGIN }, signal: AbortSignal.timeout(2_000) });
    return res.ok ? res.json() : null;
  }, 10_000);
  console.log(`smoke: the app's own agent on port ${owner.port} answers ${JSON.stringify(health)} to the visualiser's origin`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  // The app's own process tree, nothing else: the app and everything it started, such as a Claude CLI
  // call still in flight that would otherwise write into the scratch folder after it is gone. No quit
  // sequence: the scratch home is about to go. If the tree is still there, taskkill failed or timed
  // out: the app is killed by its own id, its handle is let go if even that fails, and the smoke
  // fails, since what it started may live on. An app that exits on its own mid-poll leaves its
  // children orphaned and out of reach of a tree kill; the cost is a scratch folder that may not
  // delete, which removeScratch warns about.
  if (ended === null) {
    // taskkill by its full path: by name, Windows would search this directory and PATH for it.
    const kill = spawnSync(taskkillPath(), ["/pid", String(app.pid), "/T", "/F"], { windowsHide: true, timeout: 10_000 });
    await once(app, "exit", { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    if (ended === null) {
      app.kill();
      await once(app, "exit", { signal: AbortSignal.timeout(5_000) }).catch(() => {});
      // Still there: let go of its handle, or this script would wait on it for ever.
      if (ended === null) app.unref();
      fail(`the app did not stop when its process tree was ended (taskkill ${kill.error?.message ?? `exit ${kill.status}`}); ${ended === null ? "killing it by its own id did not end it either, and it was left running" : "it was killed by its own id"}, and what it started may still be running`);
    } else if (kill.status !== 0) {
      // The app is gone but taskkill was not clean. A child that exits between the listing and the
      // kill earns the same code, so this warns rather than fails.
      console.warn(`smoke: taskkill reported ${kill.error?.message ?? `exit ${kill.status}`} though the app stopped; something it started may still be running`);
    }
  }
  await removeScratch();
}
