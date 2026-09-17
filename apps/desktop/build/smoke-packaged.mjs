// Runs the packaged app once, hidden, against scratch folders: the exe must run as plain Node (the
// hooks depend on it), the app must start as packaged, and its agent must answer the health check
// from the visualiser's origin. Then the process is stopped by its own id. Nothing under the real
// ~/.clawd or ~/.claude is touched. pnpm --filter @clawd/desktop smoke
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const exe = fileURLToPath(new URL("../release/win-unpacked/Clawd Visualiser.exe", import.meta.url));
if (!existsSync(exe)) {
  console.error(`smoke: no packaged app at ${exe}; run pnpm --filter @clawd/desktop package first`);
  process.exit(1);
}

const home = await mkdtemp(join(tmpdir(), "clawd-smoke-home-"));
const claudeDir = await mkdtemp(join(tmpdir(), "clawd-smoke-claude-"));
// A remembered choice of off keeps the packaged app's first-run rule from writing a real Run key entry.
await writeFile(join(home, "desktop.json"), JSON.stringify({ version: 1, openAtLogin: false }));
const env = { ...process.env, CLAWD_HOME: home, CLAUDE_CONFIG_DIR: claudeDir };
delete env.ELECTRON_RUN_AS_NODE;

const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exitCode = 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `read` gives something other than null, undefined or false. */
async function waitFor(what, read, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (startError !== null) throw new Error(`the app failed to start: ${startError.message}`);
    const value = await read().catch(() => null);
    if (value !== null && value !== undefined && value !== false) return value;
    await sleep(250);
  }
  throw new Error(`gave up waiting for ${what} after ${timeoutMs} ms; is another copy of the app running, or its port held?`);
}

async function newestLog() {
  const dir = join(home, "logs");
  const names = (await readdir(dir)).filter((name) => name.startsWith("desktop-")).sort();
  const name = names.at(-1);
  return name === undefined ? "" : readFile(join(dir, name), "utf8");
}

/**
 * The agent runs the Claude CLI through a shell to see which sessions are alive, and a call in
 * flight when the app stops outlives it and can still write into the scratch Claude folder. So the
 * folder is removed again until it has stayed gone for three seconds, for at most twenty.
 */
async function removeUntilGone(dir) {
  const until = Date.now() + 20_000;
  let goneSince = null;
  while (Date.now() < until) {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
      goneSince = null;
    } else if (goneSince === null) {
      goneSince = Date.now();
    } else if (Date.now() - goneSince >= 3_000) {
      return;
    }
    await sleep(250);
  }
  if (existsSync(dir)) console.warn(`smoke: ${dir} was written again after cleanup; delete it by hand`);
}

const before = Date.now();
const asNode = spawnSync(exe, ["-e", "process.exit(0)"], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 10_000 });
if (asNode.status !== 0) {
  const cause = asNode.error?.message ?? (asNode.signal ? `signal ${asNode.signal}` : undefined);
  fail(`the exe did not run as Node (exit ${asNode.status}${cause ? `, ${cause}` : ""}); is the runAsNode fuse on?`);
} else console.log(`smoke: the exe ran as Node and exited in ${Date.now() - before} ms`);

const app = spawn(exe, ["--hidden"], { env, stdio: "ignore" });
// A spawn failure is kept here, so the waits below stop at once instead of timing out.
let startError = null;
app.on("error", (err) => {
  startError = err;
});
try {
  await waitFor("desktop.started in the log", async () => (await newestLog()).includes('"code":"desktop.started","packaged":true'), 20_000);
  console.log("smoke: the app started, and knows it is packaged");
  const port = await waitFor("config.json", async () => JSON.parse(await readFile(join(home, "config.json"), "utf8")).port, 10_000);
  const health = await waitFor(`health on port ${port}`, async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { origin: "app://clawd" } });
    return res.ok ? res.json() : null;
  }, 10_000);
  console.log(`smoke: the agent on port ${port} answers ${JSON.stringify(health)} to the visualiser's origin`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  // The app's own process id, nothing else. No quit sequence: the scratch home is about to go.
  const running = startError === null && app.exitCode === null && app.signalCode === null;
  // A plain listener, not events.once, which would reject on an 'error' event and skip the cleanup.
  const exited = new Promise((resolve) => app.once("exit", resolve));
  app.kill();
  let cap;
  const capped = new Promise((resolve) => {
    cap = setTimeout(resolve, 5_000);
  });
  if (running) await Promise.race([exited, capped]);
  clearTimeout(cap);
  await rm(home, { recursive: true, force: true });
  await removeUntilGone(claudeDir);
}
