# Desktop Stage 8 (Hardening II: the page, the shell's edge cases, the scheme, the stale wait) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every item still open in the desktop design's §12.1: the settings page patches itself in place and has tests, the bridge has one type, the scheme cannot reject or hang, the shell handles an unreadable state file, a smaller display, other keyboard layouts and a quit that is not yet certain, the app asks the serving agent about its token before it writes hooks, the poller and its command runner lose their races, and a wait nobody answers leaves the view. Each item ends the stage done, or dropped with a reason written into §12.1.

**Architecture:** Nothing new in Electron. Logic moves into Electron-free modules with tests, as in every stage: `launchRepair(deps)` in `hooks.ts`, `showOrCreate` in a new `reveal.ts`, a per-host table in `scheme.ts`, `shownAtLogin` in `login.ts`. The agent gains one option (`devOrigins`) and a spawn-based command runner; core gains one `StateConfig` field. The settings page is rebuilt once and then patched, with a happy-dom test file beside it. `main.ts` stays wiring.

**Tech Stack:** Electron 44, electron-builder 26, esbuild 0.28, zod 4, vitest 5, TypeScript 5.9, pnpm 12 workspaces. New dev dependencies in `apps/desktop` only: `happy-dom` and `@fontsource/jetbrains-mono`.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, §12.1, the paragraph beginning `Stage 8 takes what remains`, plus one open item that paragraph leaves out: `Attaching to an agent that refuses the page` (stage 3's review), which is still not done and is taken here as Task 4. The "done when" is §12's row 8: every remaining §12.1 item is done or dropped with a reason.

**Stage idea:** none new in Electron. This is the second half of the hardening row.

## Decisions already made (do not reopen them)

The maintainer chose these on 21 September 2026:

- **The settings font ships.** `@fontsource/jetbrains-mono` is a dev dependency of `apps/desktop`; the bundle step copies the latin 400 and 700 woff2 files beside the page. No binary is checked in.
- **The packaged app drops the dev origins.** `startAgent` gains `devOrigins`; the packaged desktop passes `false`, so its agent accepts `app://clawd` and whatever `corsOrigins` lists, and not `http://localhost:3000`. The CLI and a development run keep them.
- **The branch is cut from `main` after `fix/settings-notice` is merged.** Task 0 checks it.

The plan's author chose these; each is recorded with its reason in Task 11:

- **A stale wait is hidden whatever its prompt count.** §12.1 says it "falls through to the existing rules, which hide it whatever its prompt count". The existing rules keep a session with more than eight prompts for good, so a literal fall-through would not hide it. The sentence's stated intent wins: past `waitingHideMs` a waiting session is not shown.
- **Ctrl+Q by physical key only when the typed key is not a Latin letter.** §12.1 says to also accept `input.code === "KeyQ"`. On AZERTY the physical Q key types `a`, so that would make Ctrl+A quit the app. The code is accepted only when `input.key` is not `a` to `z`, which covers Cyrillic, Greek and similar layouts and leaves AZERTY and Dvorak alone.
- **The Start on login control trusts Electron's `launchItems` only when it names our entry.** Stage 6 saw `launchItems` empty for the packaged exe. When Electron reports our entry and says it is disabled, the control shows off; when it reports nothing, the control shows `openAtLogin`, as today. A `desktop.loginItem` log line records what Electron said at each launch, which is the check §12.1 asks for.
- **Both extra fuses are turned off now**, not "with signing": it is two lines, the smoke run proves the hooks still work, and the app reads neither `NODE_OPTIONS` nor `--inspect`.
- **`connect-src 'self'` is added now**, with a test, rather than waiting for the change that adds `next/link`: whoever adds it would otherwise meet a silent CSP failure.
- **`404.html` is served now** when the export has one, for page-like paths only.
- **Dropped, with reasons:** one source for the agent's port (no stage lets the port vary; a test pins the two defaults together), zod's eval probe (README note; the probe runs when core's schemas are built, at import, so a `jitless` call would depend on an import order no test can pin), the restart that clears the fault budget (still deliberate; still one caller), and a CLI call that outlives an app that exits on its own during the smoke (the cost is a leftover temp folder the script already warns about).

## Global Constraints

- Windows only. Nothing is built or tested elsewhere; a test may spell Windows paths.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The desktop package has no runtime dependencies. Two dev dependencies are added this stage and no others: `happy-dom` and `@fontsource/jetbrains-mono`.
- `apps/web` is not touched this stage. The Next app keeps zero desktop-specific code.
- The bridge's list of calls does not grow, and `SettingsState` does not change shape.
- Log lines carry a time, a code and numbers or booleans only. New codes this stage: `desktop.attachedRefused`, `desktop.stateUnreadable`, `desktop.stateWriteFailed`, `desktop.loginItem`. Notices shown on the page are never logged.
- No session content anywhere: nothing in this stage reads, shows or sends prompts, tool input or output, or assistant text.
- Automated checks never run the packaged app against the real `~/.clawd` or `~/.claude`: the smoke script uses scratch folders and its own profile directory.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-8` in the worktree `C:\mw\visualiser-desktop` (Task 0). Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app or the packager.
- Every §12.1 item this plan drops gets its reason written into §12.1 in Task 11. Do not drop anything else. If a task cannot be done as written, stop and say so; do not quietly narrow it.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/state/config.ts`, `visibility.ts` | `waitingHideMs`; a stale wait is not shown. |
| `apps/agent/src/presence/taskkill.ts` | New. `taskkillPath()`: the full path under `%SystemRoot%\System32`. |
| `apps/agent/src/presence/poller.ts` | A spawn-based `nodeExec` with its own output cap; a poller that survives stop then start. |
| `apps/agent/src/http/guards.ts`, `server.ts`, `agent.ts` | `devOrigins`: the dev server's origins can be left out. |
| `apps/agent/src/index.ts`, `log.ts` | Exports `TOKEN_HEADER`, `taskkillPath`; drops `hookCommand`, `statusCommand`; four new log codes. |
| `apps/desktop/src/agent-client.ts` | `probeHealth` sends the app's origin and tells `refused` from `none`; `checkToken`. |
| `apps/desktop/src/agent-host.ts` | Attaches to a refusing agent and says so; `settled()`. |
| `apps/desktop/src/hooks.ts` | `launchRepair(deps)`, decided after the first start settles. |
| `apps/desktop/src/settings/actions.ts` | Never mints a config; asks the serving agent about the token; a change made between agents is judged when the host settles. |
| `apps/desktop/src/scheme.ts` | One host table, a handler that cannot reject, device names, `404.html`, `connect-src 'self'`. |
| `apps/desktop/src/args.ts` | Import-free: the export's URL is passed in. |
| `apps/desktop/src/desktop-state.ts`, `bounds.ts`, `keys.ts`, `quit.ts`, `login.ts` | Unreadable state file, clamped and maximised bounds, Ctrl+Q on other layouts, the tray goes in `will-quit`, the login control and Task Manager. |
| `apps/desktop/src/reveal.ts`, `window.ts` | New `showOrCreate`; one hardened-window factory. |
| `apps/desktop/src/settings/channels.ts`, `state.ts`, `ipc.ts`, `preload.ts` | New import-free channel names; one `SettingsApi`; a small preload. |
| `apps/desktop/src/settings/page.ts`, `page.html`, `page.css`, `page.test.ts` | Patch in place, the live region, the font, the page's tests. |
| `apps/desktop/build/bundle.mjs`, `smoke-packaged.mjs`, `electron-builder.yml` | The font files, the preload size check, the smoke's fixes, the two fuses. |
| `apps/desktop/tsconfig.json`, `tsconfig.page-test.json`, `package.json` | The page test's own type-check project; the two dev dependencies. |
| `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, `docs/PRD.md`, the READMEs | What was done, what was dropped and why. |

---

### Task 0: The branch

- [ ] **Step 1: Check that `main` holds the settings-notice fix**

Run from `C:\mw\visualiser`:

```bash
git merge-base --is-ancestor 95cbc12 main && echo merged
```

Expected: `merged`. If it prints nothing, stop: the maintainer has to merge `fix/settings-notice` into `main` first. Do not merge it yourself.

- [ ] **Step 2: Cut the branch in the desktop worktree and install**

The worktree `C:\mw\visualiser-desktop` has `feat/desktop-stage-7` checked out, which is merged.

```bash
git -C C:/mw/visualiser-desktop status --short
git -C C:/mw/visualiser-desktop checkout -b feat/desktop-stage-8 main
cd C:/mw/visualiser-desktop && pnpm install
```

Expected: `status --short` prints nothing (if it prints anything, stop and ask). All later paths are relative to `C:\mw\visualiser-desktop`.

This plan should be in the branch, at `docs/superpowers/plans/2026-09-21-desktop-stage-8.md`. If it is not, the maintainer has not committed it to `main` yet: copy it from `C:\mw\visualiser\docs\superpowers\plans\` and make it the branch's first commit, `git commit -m "docs: desktop stage 8 implementation plan (hardening, the second half)"`.

- [ ] **Step 3: Confirm the starting point is green**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace. If anything fails before you have changed a line, stop and report it.

---

### Task 1: A wait nobody answers leaves the view

**Files:**
- Modify: `packages/core/src/state/config.ts`
- Modify: `packages/core/src/state/visibility.ts`
- Test: `packages/core/src/state/visibility.test.ts`, `packages/core/src/state/snapshot.test.ts`

**Interfaces:**
- Produces: `StateConfig.waitingHideMs: number`, default `36 * 3_600_000`. Nothing else changes: the snapshot format, the scene, the web app and the agent are untouched, and both places that build a `StateConfig` spread `DEFAULT_CONFIG`, so the field reaches them.

- [ ] **Step 1: Write the failing tests**

In `packages/core/src/state/visibility.test.ts`, replace the test `always shows a working or waiting session, prompted or not` with:

```ts
  it("always shows a working session, prompted or not", () => {
    expect(isShown(quiet(0, { state: "working" }), T0 + 1_000 * HOUR, DEFAULT_CONFIG)).toBe(true);
  });

  it("shows a waiting session until it has waited 36 hours, measured from when the wait began, whatever its prompts", () => {
    for (const prompts of [0, 1, 9]) {
      // Something else in the session was active 30 hours in (a subagent stopping, say): the wait is still dated from `since`.
      const waiting = quiet(prompts, { state: "waiting", since: T0, lastActiveAt: T0 + 30 * HOUR });
      expect(isShown(waiting, T0 + 36 * HOUR - 1, DEFAULT_CONFIG)).toBe(true);
      expect(isShown(waiting, T0 + 36 * HOUR, DEFAULT_CONFIG)).toBe(false);
    }
  });
```

In `packages/core/src/state/snapshot.test.ts`, add inside `describe("deriveSnapshot", ...)`:

```ts
  it("drops a wait nobody has answered for 36 hours, with its pane, and brings it back the moment it is answered", () => {
    const ids = { sessionId: "s1", paneKey: "k1" };
    let f = reduceFleet(emptyFleet(), event("prompt", T0, {}, ids), T0, DEFAULT_CONFIG);
    f = reduceFleet(f, event("permission.request", T0 + 1, { tool: "Bash", category: "run" }, ids), T0 + 1, DEFAULT_CONFIG);
    const limit = T0 + 1 + DEFAULT_CONFIG.waitingHideMs;
    expect(deriveSnapshot(f, emptyAliasMap(), limit - 1).snapshot.sessions.map((s) => s.state)).toEqual(["waiting"]);
    const stale = deriveSnapshot(f, emptyAliasMap(), limit).snapshot;
    expect(stale.sessions).toEqual([]);
    expect(stale.panes).toEqual([]);
    // Hidden, not re-stated: it is still waiting in the fleet.
    expect(f.sessions.s1?.state).toBe("waiting");
    const answeredAt = limit + 24 * 3_600_000;
    f = reduceFleet(f, event("permission.denied", answeredAt, {}, ids), answeredAt, DEFAULT_CONFIG);
    expect(deriveSnapshot(f, emptyAliasMap(), answeredAt).snapshot.sessions).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run src/state/visibility.test.ts src/state/snapshot.test.ts`
Expected: FAIL. `isShown` still shows every waiting session, so the 36-hour case is `true` where `false` is expected; and `DEFAULT_CONFIG.waitingHideMs` is `undefined` (vitest does not type-check), so the snapshot test's `limit` is `NaN` and the stale snapshot still holds the session.

- [ ] **Step 3: Add the field**

In `packages/core/src/state/config.ts`, add to `StateConfig` after `fewPrompts`:

```ts
  /**
   * A waiting session leaves the view once it has waited this long, measured from `since`, the moment
   * the wait began, not from its last activity, which a tool finishing or a subagent stopping
   * elsewhere in the session could push back. It stays `waiting` in the fleet, so an answer makes it
   * working and it returns at once.
   */
  waitingHideMs: number;
```

and to `DEFAULT_CONFIG` after `fewPrompts: 8,`:

```ts
  waitingHideMs: 36 * 3_600_000,
```

- [ ] **Step 4: Write the rule**

Replace the body of `packages/core/src/state/visibility.ts` from the doc comment down with:

```ts
/**
 * Whether a session belongs in the snapshot. A working session always does. A waiting one does until
 * it has waited `waitingHideMs`: a prompt nobody answers is not activity, so past that it is hidden
 * whatever its prompt count. One nobody has prompted never is. A quiet session stays longer the more
 * it has been used: one prompt keeps it `oneShotHideMs` past its last activity, up to `fewPrompts`
 * keep it `fewPromptsHideMs`, and more keep it for good. A hidden session stays in the fleet, so its
 * next prompt, or the answer to its wait, brings it back.
 */
export function isShown(s: SessionState, now: number, cfg: StateConfig): boolean {
  if (s.state === "working") return true;
  if (s.state === "waiting") return now - s.since < cfg.waitingHideMs;
  if (s.prompts === 0) return false;
  if (s.prompts > cfg.fewPrompts) return true;
  return now - s.lastActiveAt < (s.prompts === 1 ? cfg.oneShotHideMs : cfg.fewPromptsHideMs);
}
```

- [ ] **Step 5: Run the core tests, the goldens among them**

Run: `cd packages/core && npx vitest run && pnpm typecheck`
Expected: PASS. `fixtures/golden.test.ts` passes without any golden file changing: each replays a short captured run, far inside 36 hours. If a golden moves, stop: the rule is wrong, not the golden.

- [ ] **Step 6: Run the agent's tests, which spread the defaults**

Run: `cd apps/agent && npx vitest run src/host && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/state/config.ts packages/core/src/state/visibility.ts packages/core/src/state/visibility.test.ts packages/core/src/state/snapshot.test.ts
git commit -m "feat(core): a wait nobody has answered for 36 hours leaves the view, and returns the moment it is answered"
```

---

### Task 2: The poller survives stop then start, and the command runner ends the tree in every case

**Files:**
- Create: `apps/agent/src/presence/taskkill.ts`, `apps/agent/src/presence/taskkill.test.ts`
- Modify: `apps/agent/src/presence/poller.ts`
- Test: `apps/agent/src/presence/poller.test.ts`

**Interfaces:**
- Produces: `taskkillPath(env?: NodeJS.ProcessEnv): string`. `nodeExec` keeps its type (`Exec`); `createPresencePoller` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Create `apps/agent/src/presence/taskkill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { taskkillPath } from "./taskkill";

describe("taskkillPath", () => {
  it("is taskkill.exe under System32 of the system root, never a bare name Windows would search for", () => {
    expect(taskkillPath({ SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\taskkill.exe");
    expect(taskkillPath({ windir: "E:\\Windows" })).toBe("E:\\Windows\\System32\\taskkill.exe");
    expect(taskkillPath({})).toBe("C:\\Windows\\System32\\taskkill.exe");
  });
});
```

In `apps/agent/src/presence/poller.test.ts`, add `waitFor` to the imports: `import { waitFor } from "../testing/http";`.

Add inside `describe("presence poller", ...)`, after `polls on its interval until stopped`:

```ts
  it("starts cleanly straight after a stop: the aborted run logs no failure, the new loop polls at once, and only one loop survives", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.exec.mockImplementationOnce((_command, opts) => new Promise((resolve) => opts.signal?.addEventListener("abort", () => resolve({ ok: false }))));
      t.poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(t.exec).toHaveBeenCalledTimes(1);
      t.poller.stop();
      t.poller.start();
      await vi.advanceTimersByTimeAsync(0);
      // The new loop runs its own command rather than sharing the aborted one.
      expect(t.exec).toHaveBeenCalledTimes(2);
      expect(t.log).not.toHaveBeenCalledWith("presence.failed");
      // One loop, not two: one more poll per interval.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.exec).toHaveBeenCalledTimes(3);
      t.poller.stop();
    } finally {
      vi.useRealTimers();
    }
  });
```

In `describe.concurrent("nodeExec", ...)`:

1. In the abort test, replace `await new Promise((resolve) => setTimeout(resolve, 300));` with `await waitFor(() => existsSync(started), 5_000);` so a loaded machine cannot abort before the process has started.

2. In the timeout test, change `timeoutMs: 300` to `timeoutMs: 1_000`.

3. Add two tests:

```ts
  it("returns what the command wrote when it exits cleanly", async () => {
    expect(await nodeExec(`"${process.execPath}" -e "process.stdout.write('[]')"`, { timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024 })).toEqual({ ok: true, stdout: "[]" });
    expect(await nodeExec(`"${process.execPath}" -e "process.exit(3)"`, { timeoutMs: 15_000, maxBuffer: 4 * 1024 * 1024 })).toEqual({ ok: false });
  }, 10_000);

  it("kills the whole process tree when the output overflows the cap, so a chatty CLI cannot outlive its shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clawd-nodeexec-"));
    try {
      const delayed = join(dir, "delayed.txt").replace(/\\/g, "/");
      const command = `"${process.execPath}" -e "process.stdout.write('x'.repeat(65536)); setTimeout(() => require('fs').writeFileSync('${delayed}', 'x'), 1500)"`;
      expect(await nodeExec(command, { timeoutMs: 15_000, maxBuffer: 1024 })).toEqual({ ok: false });
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(existsSync(delayed)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 10_000);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/presence/taskkill.test.ts src/presence/poller.test.ts`
Expected: FAIL. `./taskkill` does not exist; the restart test sees one `exec` call and a `presence.failed`; the overflow test finds `delayed.txt`, because Node's own `maxBuffer` kill ends only `cmd.exe`.

- [ ] **Step 3: Write `taskkill.ts`**

Create `apps/agent/src/presence/taskkill.ts`:

```ts
import { join } from "node:path";

/**
 * taskkill by its full path. Run by name, Windows would search the working directory and then PATH,
 * and whatever it found first would be handed a process id to end.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", "taskkill.exe");
}
```

- [ ] **Step 4: Rewrite `nodeExec` over `spawn`**

In `apps/agent/src/presence/poller.ts`, change the `node:child_process` import to `import { execFile, spawn } from "node:child_process";`, add `import { taskkillPath } from "./taskkill";`, and replace the `nodeExec` doc comment and constant with:

```ts
/**
 * Runs a constant command through the shell (on Windows `claude` is a .cmd shim). stdout is
 * captured up to `maxBuffer` and stderr discarded, never inherited, and the error itself is never
 * looked at. A timeout, an aborted signal or too much output ends the command's whole process tree,
 * because ending only the shell would leave the CLI the shim started running, and it could still
 * write into the Claude directory. The cap is this function's own: Node's `exec` enforces its
 * `maxBuffer` by killing the shell alone.
 */
export const nodeExec: Exec = (command, opts) =>
  new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({ ok: false });
      return;
    }
    let settled = false;
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (result: ExecResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", end);
      resolve(result);
    };
    const end = (): void => {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        execFile(taskkillPath(), ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
      }
      finish({ ok: false });
    };
    const child = spawn(command, { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > opts.maxBuffer) end();
      else chunks.push(chunk);
    });
    child.on("error", () => finish({ ok: false }));
    child.on("close", (code) => finish(code === 0 ? { ok: true, stdout: Buffer.concat(chunks).toString("utf8") } : { ok: false }));
    const timer = setTimeout(end, opts.timeoutMs);
    opts.signal?.addEventListener("abort", end, { once: true });
  });
```

- [ ] **Step 5: Give each run a generation**

In `createPresencePoller`, after `let listing: AbortController | null = null;` add:

```ts
  /**
   * Raised by every stop. A run or a loop that began under an earlier generation is over, even when
   * `start()` has cleared `stopped` again by the time it looks: without this, a stop followed at
   * once by a start shared the aborted run, logged it as a failure, skipped a poll, and left the
   * old loop scheduling polls beside the new one.
   */
  let generation = 0;
```

Change `async function run(): Promise<boolean> {` to `async function run(mine: number): Promise<boolean> {`, add as its first line `const over = (): boolean => stopped || mine !== generation;`, and replace both `if (stopped) return false;` lines in it with `if (over()) return false;`.

Replace `pollOnce` with:

```ts
  const pollOnce = (): Promise<boolean> => {
    if (inFlight !== null) return inFlight;
    const mine = generation;
    const current: Promise<boolean> = run(mine)
      .catch(() => {
        if (!stopped && mine === generation) deps.log("presence.failed");
        return false;
      })
      .finally(() => {
        // Only its own slot: a stop may have emptied it, and a start filled it, since this run began.
        if (inFlight === current) inFlight = null;
      });
    inFlight = current;
    return current;
  };
```

Replace `start()` and `stop()` with:

```ts
    start() {
      if (running) return;
      running = true;
      stopped = false;
      const mine = generation;
      const loop = async (): Promise<void> => {
        await pollOnce();
        if (running && mine === generation) timer = setTimeout(() => void loop(), deps.intervalMs);
      };
      void loop();
    },
    stop() {
      stopped = true;
      running = false;
      generation++;
      listing?.abort();
      listing = null;
      // The aborted run is no longer the one to share.
      inFlight = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/agent && npx vitest run src/presence && pnpm typecheck`
Expected: PASS, the existing `marks nothing dead when the command throws` among them (it never stops the poller, so it still logs).

- [ ] **Step 7: Commit**

```bash
git add apps/agent/src/presence/taskkill.ts apps/agent/src/presence/taskkill.test.ts apps/agent/src/presence/poller.ts apps/agent/src/presence/poller.test.ts
git commit -m "fix(agent): a poller started straight after a stop runs its own poll, and the command runner ends the whole tree on overflow too, with taskkill by its full path"
```

---

### Task 3: The agent's surface for this stage: dev origins, exports, log codes

**Files:**
- Modify: `apps/agent/src/http/guards.ts`, `apps/agent/src/http/server.ts`, `apps/agent/src/agent.ts`
- Modify: `apps/agent/src/index.ts`, `apps/agent/src/log.ts`
- Test: `apps/agent/src/http/guards.test.ts`, `apps/agent/src/http/server.test.ts`, `apps/agent/src/agent.test.ts`

**Interfaces:**
- Produces, from `@clawd/agent`: `AgentOptions.devOrigins?: boolean` (default true); `TOKEN_HEADER: "x-clawd-token"`; `taskkillPath`; `LogCode` gains `"desktop.attachedRefused" | "desktop.stateUnreadable" | "desktop.stateWriteFailed" | "desktop.loginItem"`. `hookCommand` and `statusCommand` leave the index (they stay exported from `install/settings.ts`, where the installer uses them).

- [ ] **Step 1: Write the failing tests**

In `apps/agent/src/http/guards.test.ts`, add `DEV_ORIGINS` to the import and replace the test `allows the local web origins and the desktop app's before any configured ones` with:

```ts
  it("allows the dev server's origins and the desktop app's before any configured ones, and can leave the dev server's out", () => {
    expect(DEV_ORIGINS).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
    expect(BUILTIN_ORIGINS).toEqual(["http://localhost:3000", "http://127.0.0.1:3000", "app://clawd"]);
    expect(allowedOrigins([])).toEqual(BUILTIN_ORIGINS);
    expect(allowedOrigins(["https://clawd.example"])).toEqual([...BUILTIN_ORIGINS, "https://clawd.example"]);
    expect(allowedOrigins([], false)).toEqual(["app://clawd"]);
    // Listing it in the config is the opt-in.
    expect(allowedOrigins(["http://localhost:3000"], false)).toEqual(["app://clawd", "http://localhost:3000"]);
  });
```

In `apps/agent/src/http/server.test.ts`, after the test `allows the built-in origins, the desktop app's among them, with no origins configured`, add:

```ts
  it("refuses the dev server's origins when the host leaves them out, and still lets the desktop app's page and a configured origin in", async () => {
    const { port } = await start({ devOrigins: false, config: { allowlist: [ALLOWED_ROOT], token: TOKEN, corsOrigins: [WEB] } });
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect((await send(port, { path: "/api/health", headers: { origin } })).status).toBe(403);
      expect((await send(port, { path: "/api/stream", headers: { origin } })).status).toBe(403);
    }
    for (const origin of [DESKTOP_ORIGIN, WEB]) {
      const reply = await send(port, { path: "/api/health", headers: { origin } });
      expect(reply.status).toBe(200);
      expect(reply.headers["access-control-allow-origin"]).toBe(origin);
    }
  });
```

In `apps/agent/src/agent.test.ts`, add inside `describe("startAgent", ...)`:

```ts
  it("leaves the dev server's origins out when its host asks, which the packaged desktop app does", async () => {
    const home = await tempDir();
    await saveConfig(agentPaths(home), { ...defaultConfig(), allowlist: [ALLOWED_ROOT] });
    const agent = await startAgent({ home, port: 0, devOrigins: false, exec: async () => ({ ok: true, stdout: "[]" }), log: silentLogger, platform: "linux", transcriptsDir: await tempDir() });
    try {
      expect((await send(agent.port, { path: "/api/health", headers: { origin: "http://localhost:3000" } })).status).toBe(403);
      expect((await send(agent.port, { path: "/api/health", headers: { origin: "app://clawd" } })).status).toBe(200);
    } finally {
      await agent.stop();
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/http/guards.test.ts src/http/server.test.ts src/agent.test.ts`
Expected: FAIL. `DEV_ORIGINS` is not exported, and `devOrigins` is not a known option, so the dev origins still answer 200.

- [ ] **Step 3: Write the guard**

In `apps/agent/src/http/guards.ts`, replace from the `BUILTIN_ORIGINS` doc comment to the end of `allowedOrigins` with:

```ts
/**
 * The web app's dev server. Accepted with no configuration unless the agent's host leaves them out:
 * the packaged desktop app does, because a teammate's machine has no dev server of ours, and
 * whatever else listens on port 3000 there should not read the stream or send focus commands.
 */
export const DEV_ORIGINS: readonly string[] = ["http://localhost:3000", "http://127.0.0.1:3000"];

/** Origins an agent accepts with no configuration: the dev server's and the desktop app's page. */
export const BUILTIN_ORIGINS: readonly string[] = [...DEV_ORIGINS, DESKTOP_ORIGIN];

/** The built-in origins, then those the config adds. A config that lists a built-in one is harmless, and is how a host without the dev origins gets one back. */
export function allowedOrigins(configured: readonly string[], devOrigins = true): string[] {
  return [...(devOrigins ? DEV_ORIGINS : []), DESKTOP_ORIGIN, ...configured];
}
```

- [ ] **Step 4: Thread the option through the server and `startAgent`**

In `apps/agent/src/http/server.ts`, add to `ServerDeps` after `sensitive`:

```ts
  /** Whether the dev server's origins are accepted with no configuration. Absent means yes. */
  devOrigins?: boolean;
```

and in `handleApi` change the first line to:

```ts
    const origin = checkOrigin(req.headers.origin, allowedOrigins(deps.config.corsOrigins, deps.devOrigins !== false));
```

In `apps/agent/src/agent.ts`, add to `AgentOptions` after `onSnapshot`:

```ts
  /** Whether `http://localhost:3000` and `http://127.0.0.1:3000` are accepted with no configuration. Default true; the packaged desktop app passes false. */
  devOrigins?: boolean;
```

and in the `createAgentServer({ ... })` call add, after `sensitive,`:

```ts
    ...(opts.devOrigins === undefined ? {} : { devOrigins: opts.devOrigins }),
```

- [ ] **Step 5: The index and the log codes**

In `apps/agent/src/index.ts`:

1. In the `./install/settings` export line, remove `hookCommand` and `statusCommand`, and add `TOKEN_HEADER` (keep the list alphabetical as it is: `HOOK_SCRIPTS, TOKEN_HEADER, applyInstall, hookStatus, ...`).
2. Add a line: `export { taskkillPath } from "./presence/taskkill";`

First confirm nothing outside the package uses the two names being dropped:

Run: `git grep -n "hookCommand\|statusCommand" -- apps/desktop apps/web packages`
Expected: no output.

In `apps/agent/src/log.ts`, add to `LogCode` after `"desktop.attachedChange"`:

```ts
  | "desktop.attachedRefused"
  | "desktop.stateUnreadable"
  | "desktop.stateWriteFailed"
  | "desktop.loginItem"
```

- [ ] **Step 6: Run the agent's checks and commit**

Run: `cd apps/agent && npx vitest run && pnpm typecheck`
Expected: PASS.

```bash
git add apps/agent/src/http/guards.ts apps/agent/src/http/guards.test.ts apps/agent/src/http/server.ts apps/agent/src/http/server.test.ts apps/agent/src/agent.ts apps/agent/src/agent.test.ts apps/agent/src/index.ts apps/agent/src/log.ts
git commit -m "feat(agent): a host can leave the dev server's origins out, the index exports the token header and taskkill's path and drops two names nothing used, and the desktop gains four log codes"
```

---

### Task 4: The host asks as the page would, attaches to a refusing agent and says so, and says when its first start has settled

**Files:**
- Modify: `apps/desktop/src/agent-client.ts`, `apps/desktop/src/agent-host.ts`
- Modify: `apps/desktop/src/main.ts` (wiring only)
- Test: `apps/desktop/src/agent-client.test.ts`, `apps/desktop/src/agent-host.test.ts`

**Interfaces:**
- Consumes: `TOKEN_HEADER` and `AgentOptions.devOrigins` from `@clawd/agent` (Task 3).
- Produces: `type Probe = "ok" | "refused" | "none"`; `probeHealth(port: number, timeoutMs?: number): Promise<Probe>`; `type TokenCheck = "held" | "refused" | "unknown"`; `checkToken(port: number, token: string, timeoutMs?: number): Promise<TokenCheck>`; `AgentHostDeps.probe(port): Promise<Probe>`; `AgentHost.settled(): Promise<void>`; `REFUSED_MESSAGE: string` from `agent-host.ts`. `HostState` keeps its shape: a refusing agent is `mode: "attached"` with `error: REFUSED_MESSAGE`, which the settings page already renders as the agent's reason.

- [ ] **Step 1: Write the failing client tests**

In `apps/desktop/src/agent-client.test.ts`, change the import to `import { checkToken, countsOf, fetchCounts, probeHealth } from "./agent-client";` and replace the whole `describe("probeHealth", ...)` block with:

```ts
describe("probeHealth", () => {
  it("is ok when the health endpoint answers ok, whatever else the body carries, and asks as the app's page would", async () => {
    let path = "";
    let origin: string | undefined;
    const port = await serve((req, res) => {
      path = req.url ?? "";
      origin = req.headers.origin;
      reply({ ok: true, version: "9.9.9", sessions: 2, somethingNewer: 1 })(req, res);
    });
    expect(await probeHealth(port)).toBe("ok");
    expect(path).toBe("/api/health");
    expect(origin).toBe("app://clawd");
  });

  it("is refused when an agent answers the app's origin with its own 403, and none for a 403 from anything else", async () => {
    expect(await probeHealth(await serve(reply({ error: "origin not allowed" }, 403)))).toBe("refused");
    expect(await probeHealth(await serve(reply("<html>forbidden</html>", 403)))).toBe("none");
    expect(await probeHealth(await serve(reply({ error: "something else" }, 403)))).toBe("none");
  });

  it("is none for an error status, a body that is not ok, a body that is not JSON, a closed port or a reply too slow", async () => {
    expect(await probeHealth(await serve(reply({ error: "not found" }, 404)))).toBe("none");
    expect(await probeHealth(await serve(reply({ ok: false })))).toBe("none");
    expect(await probeHealth(await serve(reply("<html>")))).toBe("none");
    expect(await probeHealth(await closedPort())).toBe("none");
    expect(await probeHealth(await serve(() => {}), 50)).toBe("none");
  });
});

describe("checkToken", () => {
  it("posts the token to the status ingest route with an empty body and no origin, and reads 200 as held and 401 as refused", async () => {
    const seen: { method?: string; url?: string; token?: string | string[]; origin?: string; length?: string } = {};
    const held = await serve((req, res) => {
      Object.assign(seen, { method: req.method, url: req.url, token: req.headers["x-clawd-token"], origin: req.headers.origin, length: req.headers["content-length"] });
      reply({})(req, res);
    });
    expect(await checkToken(held, "a".repeat(64))).toBe("held");
    expect(seen).toEqual({ method: "POST", url: "/ingest/status", token: "a".repeat(64), origin: undefined, length: "0" });
    expect(await checkToken(await serve(reply({}, 401)), "a".repeat(64))).toBe("refused");
  });

  it("is unknown for any other status, a closed port or a reply too slow", async () => {
    expect(await checkToken(await serve(reply({}, 403)), "t")).toBe("unknown");
    expect(await checkToken(await closedPort(), "t")).toBe("unknown");
    expect(await checkToken(await serve(() => {}), "t", 50)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Write the failing host tests**

In `apps/desktop/src/agent-host.test.ts`:

1. Change the import from `./agent-host` to also bring `REFUSED_MESSAGE`, and add `import type { Probe } from "./agent-client";`.
2. The probe doubles become words. In `harness`, change `probe: opts.probe ?? (async () => false),` to `probe: opts.probe ?? (async () => "none"),`. At line 66 change `probe: async () => answering` to `probe: async () => (answering ? "ok" : "none")`. At lines 165 and 229 change `probe: async () => true` to `probe: async () => "ok"`. At line 199 change `probe: async () => false,` to `probe: async () => "none",`.
3. Add inside `describe("createAgentHost", ...)`:

```ts
  it("attaches to an agent that refuses this app's page, says why, and stops saying it once a later probe is let in", async () => {
    let found: Probe = "refused";
    const { host, codes } = harness({ fail: [new PortInUseError(4750)], probe: async () => found });
    host.start();
    await flush();
    expect(host.state()).toMatchObject({ mode: "attached", port: 4750, error: REFUSED_MESSAGE });
    expect(codes).toEqual(["desktop.attachedRefused"]);

    found = "ok";
    await advance(ATTACHED_POLL_MS);
    expect(host.state()).toMatchObject({ mode: "attached", error: null });

    found = "none";
    await advance(ATTACHED_POLL_MS);
    expect(host.state()).toMatchObject({ mode: "own", error: null });
  });

  it("says when its first start has settled, however it went, and on stop", async () => {
    const own = harness();
    let settled = false;
    void own.host.settled().then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    own.host.start();
    await flush();
    expect(settled).toBe(true);

    const attached = harness({ fail: [new PortInUseError(4750)], probe: async () => "ok" });
    attached.host.start();
    await flush();
    await expect(attached.host.settled()).resolves.toBeUndefined();

    const failed = harness({ fail: [new ConfigError("config.json is invalid at: port")] });
    failed.host.start();
    await flush();
    await expect(failed.host.settled()).resolves.toBeUndefined();

    const never = harness();
    const waiting = never.host.settled();
    await never.host.stop();
    await expect(waiting).resolves.toBeUndefined();
  });
```

4. In `describe("statusText", ...)`, add to the existing test:

```ts
    expect(statusText({ ...base, mode: "attached", error: REFUSED_MESSAGE })).toBe("Clawd Visualiser · 3 sessions · 1 waiting · agent attached, refuses this app");
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/agent-client.test.ts src/agent-host.test.ts`
Expected: FAIL. `checkToken`, `REFUSED_MESSAGE` and `settled` do not exist, and `probeHealth` answers booleans and sends no `Origin`.

- [ ] **Step 4: Write the client**

In `apps/desktop/src/agent-client.ts`:

1. Change the imports to:

```ts
import { TOKEN_HEADER } from "@clawd/agent";
import { DESKTOP_ORIGIN, ENDPOINTS, SnapshotSchema, type Snapshot } from "@clawd/core";
import { request } from "node:http";
```

2. Leave `getJson` as it is (`fetchCounts` still uses it, with no origin, as any client would). Replace `probeHealth` and its doc comment with:

```ts
/** What answered on the port: an agent that lets this app's page in, an agent that refuses it, or nothing of use. */
export type Probe = "ok" | "refused" | "none";

/**
 * Asks the health endpoint as the app's page would, with its origin. `ok` when it answers `ok: true`
 * in time; only `ok` is read, so a newer agent with more fields still counts. `refused` when it
 * answers the agent's own 403 for an origin it does not know: an agent started before it learned
 * `app://clawd`, which the page cannot talk to. Never rejects.
 */
export async function probeHealth(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<Probe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${ENDPOINTS.health}`, { headers: { origin: DESKTOP_ORIGIN }, signal: AbortSignal.timeout(timeoutMs) });
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return "none";
    if (res.status === 403) return (body as { error?: unknown }).error === "origin not allowed" ? "refused" : "none";
    return res.ok && (body as { ok?: unknown }).ok === true ? "ok" : "none";
  } catch {
    return "none";
  }
}
```

If the first probe test fails because no `Origin` header arrives (Node's `fetch` is meant to pass it through, since it does not enforce the browser's forbidden header names), write `probeHealth` over `node:http`'s `request` instead, in the shape `checkToken` below uses, and keep the tests as they are.

3. Add at the end of the file:

```ts
/** Whether the agent on the port holds a token: it does, it refuses it, or it did not say. */
export type TokenCheck = "held" | "refused" | "unknown";

/** The agent's status-line ingest route, which answers 401 to a token it does not hold and 200 otherwise. */
const INGEST_STATUS_PATH = "/ingest/status";

/**
 * Asks the agent on the port whether it holds this token, the way a hook script would: a POST with
 * the token header, an empty body, and no Origin, which the ingest routes refuse outright. The agent
 * counts the empty body as one bad one in its `ingest.counts`. Over `node:http`, as the hook scripts
 * are, so nothing adds a header. Never rejects.
 */
export function checkToken(port: number, token: string, timeoutMs = COUNTS_TIMEOUT_MS): Promise<TokenCheck> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path: INGEST_STATUS_PATH, headers: { [TOKEN_HEADER]: token, "content-length": "0" }, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? "held" : res.statusCode === 401 ? "refused" : "unknown");
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve("unknown"));
    req.end();
  });
}
```

- [ ] **Step 5: Write the host**

In `apps/desktop/src/agent-host.ts`:

1. Change the client import to `import { countsOf, type Counts, type Probe } from "./agent-client";`.
2. Change the `error` comment in `HostState` to:

```ts
  /** Why the agent is no use, when it is not: a ConfigError's message, which names a field and never a value, or REFUSED_MESSAGE while attached to an agent that refuses this app's page. Shown, never logged. */
  error: string | null;
```

3. Change `probe` in `AgentHostDeps` to:

```ts
  /** What answers on the port, asked as the app's page would ask. Never rejects. */
  probe(port: number): Promise<Probe>;
```

4. Add to `AgentHost`, after `start(): void;`:

```ts
  /** Resolves once the first start has settled as own, attached, restarting or failed, or the host was stopped. By then this home's config.json exists, unless it could not be written. */
  settled(): Promise<void>;
```

5. Add after `BACKOFF_MS`:

```ts
/** Shown as the agent's reason while attached to an agent started before it knew this app's origin. */
export const REFUSED_MESSAGE = "the agent on this port refuses this app's page; stop it and this app will start its own";
```

6. In `createAgentHost`, after `const stopped = ...` add:

```ts
  let markSettled: () => void = () => {};
  const firstSettled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });
```

and change `set` to:

```ts
  const set = (patch: Partial<HostState>): void => {
    state = { ...state, ...patch };
    if (state.mode !== "starting") markSettled();
    deps.onChange?.(state);
  };
```

7. In `attempt`, replace the `PortInUseError` branch with:

```ts
      if (err instanceof PortInUseError) {
        const found = await deps.probe(err.port);
        if (found === "none") return faulted({ portInUse: true });
        if (stopped()) return;
        // An agent that refuses the page is still an agent holding the port: attach, so the takeover
        // happens when it stops, and say why the page stays simulated until then.
        deps.log(found === "refused" ? "desktop.attachedRefused" : "desktop.attached", { port: err.port });
        set({ mode: "attached", port: err.port, error: found === "refused" ? REFUSED_MESSAGE : null });
        return refresh(err.port);
      }
```

8. Replace `poll` with:

```ts
  const poll = async (port: number): Promise<void> => {
    if (stopped() || state.mode !== "attached") return;
    const found = await deps.probe(port);
    if (stopped()) return;
    if (found !== "none") {
      // The agent on the port may have been replaced by a newer one since the last look.
      const error = found === "refused" ? REFUSED_MESSAGE : null;
      if (error !== state.error) set({ error });
      return refresh(port);
    }
    deps.log("desktop.takeover", { port });
    return attempt();
  };
```

9. In the returned object add `settled: () => firstSettled,` after `start() {...},`, and in `stop()` add `markSettled();` as the first line inside the `(async () => {` body.

10. In `statusText`, replace the attached line with:

```ts
  if (state.mode === "attached") parts.push(state.error === null ? "agent attached" : "agent attached, refuses this app");
```

- [ ] **Step 6: Wire `main.ts`**

In `apps/desktop/src/main.ts`, change the host's `start` dependency to:

```ts
    // Packaged, the agent accepts this app's page and whatever the config lists, and not the dev
    // server's origins: a teammate's machine has no dev server of ours on port 3000.
    start: (onSnapshot) => startAgent({ home, log, onSnapshot, devOrigins: !app.isPackaged }),
```

- [ ] **Step 7: Run every desktop check and commit**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS.

```bash
git add apps/desktop/src/agent-client.ts apps/desktop/src/agent-client.test.ts apps/desktop/src/agent-host.ts apps/desktop/src/agent-host.test.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): the host probes as the page would and says when the agent it attached to refuses the app, the packaged agent drops the dev origins, and the first start can be awaited"
```

---

### Task 5: The launch repair waits for the first start, and the install asks the serving agent about its token

**Files:**
- Modify: `apps/desktop/src/hooks.ts`, `apps/desktop/src/settings/actions.ts`
- Modify: `apps/desktop/src/main.ts` (wiring only)
- Test: `apps/desktop/src/hooks.test.ts`, `apps/desktop/src/settings/actions.test.ts`

**Interfaces:**
- Consumes: `checkToken`, `TokenCheck` and `AgentHost.settled()` (Task 4).
- Produces: `launchRepair(deps: LaunchRepairDeps): Promise<"none" | "repaired" | "failed">` from `hooks.ts`; `ActionDeps.tokenCheck(): Promise<TokenCheck>`; `CONFIG_GONE_NOTICE` and `OTHER_HOME_NOTICE` from `actions.ts`.

The rules this task adds to the actions:

1. **Install never mints a config.** With no usable `config.json`, Install hooks writes nothing. Attached, it answers `NO_CONFIG_NOTICE` as stage 7 did. In any other mode it restarts the agent, whose start writes a fresh config, and answers `CONFIG_GONE_NOTICE`, which says to choose Install again.
2. **Install asks first.** With a config, it asks the agent on the port whether it holds the config's token. `refused` while attached: that agent was started from another home; nothing is written and `OTHER_HOME_NOTICE` says so. `refused` while this app owns the agent: the config was recreated under it; the agent is restarted, which reads the config the hooks will carry, and the install goes ahead. `held` and `unknown` go ahead.
3. **A change made between agents is judged when the host settles.** A folder or detail change made while the host is `starting`, `restarting` or `failed` is answered with no notice and a queued restart. If the host then settles as `attached`, the next push carries `ATTACHED_NOTICE` and logs `desktop.attachedChange`, once.

- [ ] **Step 1: Write the failing hooks tests**

In `apps/desktop/src/hooks.test.ts`, add `launchRepair, type LaunchRepairDeps` to the import from `./hooks`, add `import type { LogFields } from "@clawd/agent";`, and add at the end of the file:

```ts
describe("launchRepair", () => {
  function harness(over: Partial<LaunchRepairDeps> = {}) {
    const codes: string[] = [];
    const fields: LogFields[] = [];
    const calls: string[] = [];
    const deps: LaunchRepairDeps = {
      packaged: true,
      thisExe: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe",
      status: async () => "stale",
      installedExe: async () => "C:/Apps/Clawd Visualiser/Clawd Visualiser.exe",
      exists: async () => true,
      install: async () => {
        calls.push("install");
        return { ok: true };
      },
      log: (code, logFields = {}) => {
        codes.push(code);
        fields.push(logFields);
      },
      ...over,
    };
    return { deps, codes, fields, calls };
  }

  it("rewrites stale hooks that are this app's to rewrite, and logs the repair", async () => {
    const mine = harness();
    expect(await launchRepair(mine.deps)).toBe("repaired");
    expect(mine.calls).toEqual(["install"]);
    expect(mine.codes).toEqual(["desktop.hooksRepaired"]);

    const moved = harness({ installedExe: async () => "C:/Old/Clawd Visualiser.exe", exists: async () => false });
    expect(await launchRepair(moved.deps)).toBe("repaired");
  });

  it("does nothing in development, for any status but stale, or for a live install by another exe", async () => {
    for (const over of [
      { packaged: false },
      { status: async () => "current" as const },
      { status: async () => "missing" as const },
      { status: async () => "unreadable" as const },
      { installedExe: async () => "C:/Program Files/nodejs/node.exe" },
    ]) {
      const t = harness(over);
      expect(await launchRepair(t.deps)).toBe("none");
      expect(t.calls).toEqual([]);
      expect(t.codes).toEqual([]);
    }
  });

  it("never reads anything in development, so a development launch costs no file reads", async () => {
    let reads = 0;
    const t = harness({
      packaged: false,
      status: async () => {
        reads++;
        return "stale";
      },
    });
    await launchRepair(t.deps);
    expect(reads).toBe(0);
  });

  it("logs a failed repair when the install refuses, or when anything throws", async () => {
    const refused = harness({ install: async () => ({ ok: false }) });
    expect(await launchRepair(refused.deps)).toBe("failed");
    expect(refused.codes).toEqual(["desktop.hooksFailed"]);
    expect(refused.fields).toEqual([{ repair: true }]);

    const threw = harness({
      install: async () => {
        throw new Error("EPERM");
      },
    });
    expect(await launchRepair(threw.deps)).toBe("failed");
    expect(threw.fields).toEqual([{ repair: true }]);
  });
});
```

- [ ] **Step 2: Write the failing actions tests**

In `apps/desktop/src/settings/actions.test.ts`:

1. Add `import type { TokenCheck } from "../agent-client";` and change the actions import to `import { ATTACHED_NOTICE, CONFIG_GONE_NOTICE, NO_CONFIG_NOTICE, NO_CONFIG_TO_CHANGE, OTHER_HOME_NOTICE, createSettingsActions, type ActionDeps } from "./actions";`.
2. In `harness`, change the parameter type to `Partial<ActionDeps> & { mode?: HostMode; config?: boolean; token?: TokenCheck } = {}` and add to `deps`, after `hasConfig`:

```ts
    tokenCheck: async () => over.token ?? "held",
```

3. Add inside the describe, after `logs the fields that tell an attached hooks refusal apart from an ordinary hooks failure`:

```ts
  it("never mints a config from the settings window: with none, it restarts the agent it is not attached to, so one is written, and says to install again", async () => {
    for (const mode of ["own", "starting", "restarting", "failed"] as const) {
      const t = harness({ mode, config: false });
      expect((await t.actions.installHooks()).notice, mode).toBe(CONFIG_GONE_NOTICE);
      expect(t.calls, mode).toEqual(["restart"]);
      expect(t.fields, mode).toEqual([{ repair: false, noConfig: true }]);
    }
  });

  it("asks the serving agent about the token first: attached to one that refuses it, nothing is written and the page says why", async () => {
    const other = harness({ mode: "attached", token: "refused" });
    expect((await other.actions.installHooks()).notice).toBe(OTHER_HOME_NOTICE);
    expect(other.calls).toEqual([]);
    expect(other.codes).toEqual(["desktop.hooksFailed"]);
    expect(other.fields).toEqual([{ repair: false, attached: true, otherHome: true }]);
  });

  it("restarts its own agent when that agent refuses the token on disk, then installs, since the restart reads the config the hooks will carry", async () => {
    const own = harness({ mode: "own", token: "refused" });
    expect((await own.actions.installHooks()).notice).toBeNull();
    expect(own.calls).toEqual(["restart", "install"]);
    expect(own.codes).toEqual([]);
  });

  it("installs without a restart when the agent holds the token, or does not say", async () => {
    for (const token of ["held", "unknown"] as const) {
      for (const mode of ["own", "attached"] as const) {
        const t = harness({ mode, token });
        expect((await t.actions.installHooks()).notice).toBeNull();
        expect(t.calls).toEqual(["install"]);
      }
    }
  });
```

4. Add after `keeps the attached notice when the takeover leaves the agent restarting or failed`:

```ts
  it("judges a change made between agents when the host settles: attached means it was not applied, said once", async () => {
    let mode: HostMode = "restarting";
    const { actions, calls, codes } = harness({ hostMode: () => mode });
    expect((await actions.setDetail("hints")).notice).toBeNull();
    expect(calls).toEqual(["detail hints", "restart"]);
    expect((await actions.pushedState()).notice).toBeNull();

    mode = "attached";
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    expect((await actions.pushedState()).notice).toBe(ATTACHED_NOTICE);
    expect(codes).toEqual(["desktop.attachedChange"]);

    mode = "own";
    expect((await actions.pushedState()).notice).toBeNull();
  });

  it("says nothing about a change made between agents once this app's own agent has it, even if the host attaches later", async () => {
    let mode: HostMode = "starting";
    const { actions, codes } = harness({ hostMode: () => mode });
    await actions.addFolder();
    mode = "own";
    expect((await actions.pushedState()).notice).toBeNull();
    mode = "attached";
    expect((await actions.pushedState()).notice).toBeNull();
    expect(codes).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/hooks.test.ts src/settings/actions.test.ts`
Expected: FAIL. `launchRepair`, `CONFIG_GONE_NOTICE` and `OTHER_HOME_NOTICE` do not exist; an install with no config in `own` mode goes ahead; nothing is said when the host settles as attached.

- [ ] **Step 4: Write `launchRepair`**

In `apps/desktop/src/hooks.ts`, add `type Logger` to the `@clawd/agent` import, and add after `installedExe`:

```ts
export type LaunchRepairDeps = {
  packaged: boolean;
  /** This app's own executable, `process.execPath`. */
  thisExe: string;
  /** The hooks' status now. Main calls this after the host's first start has settled, so a config that start created is seen. */
  status(): Promise<HookStatus>;
  /** The executable the installed SessionStart command names, or null. */
  installedExe(): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  install(): Promise<{ ok: boolean }>;
  log: Logger;
};

/**
 * The repair a packaged launch makes on its own: read the status, decide with `repairOnLaunch`
 * whether stale hooks are this app's to rewrite, rewrite them, and log which way it went. Nothing is
 * read in development. Never rejects.
 */
export async function launchRepair(deps: LaunchRepairDeps): Promise<"none" | "repaired" | "failed"> {
  if (!deps.packaged) return "none";
  try {
    const status = await deps.status();
    if (status !== "stale") return "none";
    const named = await deps.installedExe();
    const namedExists = named !== null && (await deps.exists(named));
    if (!repairOnLaunch({ status, packaged: true, installedExe: named, installedExeExists: namedExists, thisExe: deps.thisExe })) return "none";
    if ((await deps.install()).ok) {
      deps.log("desktop.hooksRepaired");
      return "repaired";
    }
  } catch {
    // Logged below, as a refused install is.
  }
  deps.log("desktop.hooksFailed", { repair: true });
  return "failed";
}
```

- [ ] **Step 5: Write the actions**

In `apps/desktop/src/settings/actions.ts`:

1. Add `import type { TokenCheck } from "../agent-client";`.
2. Add to `ActionDeps`, after `hasConfig`:

```ts
  /** Whether the agent serving the port holds the token in this home's config, asked of that agent. `unknown` with no config, no port yet, or no answer. */
  tokenCheck(): Promise<TokenCheck>;
```

3. Add after `NO_CONFIG_NOTICE`:

```ts
export const CONFIG_GONE_NOTICE = "the agent's config file was missing, so the agent has been started again to write a new one; choose Install hooks again";
export const OTHER_HOME_NOTICE = "the agent this app is attached to was started from another home and would refuse these hooks; stop it and this app will start its own";
```

4. Replace the `applied` function and its comment with:

```ts
  /**
   * A change saved while the host was between agents (starting, restarting, failed): the restart it
   * queued has yet to settle, and may settle as attached, where the change was not applied. The next
   * push that finds the host settled decides, in `pushedState`.
   */
  let unsettled = false;

  /** After a successful save: the agent this app owns reads the config again; an attached one cannot be made to. */
  const applied = (): string | null => {
    const mode = deps.hostMode();
    if (mode === "attached") {
      deps.log("desktop.attachedChange");
      return ATTACHED_NOTICE;
    }
    deps.restartAgent();
    unsettled = mode !== "own";
    return null;
  };
```

5. Replace `installHooks` with:

```ts
    async installHooks() {
      const mode = deps.hostMode();
      // Never mint a config here: the installer would fall back to a fresh token no running agent holds.
      if (!(await deps.hasConfig())) {
        if (mode === "attached") {
          deps.log("desktop.hooksFailed", { repair: false, attached: true });
          return answer(NO_CONFIG_NOTICE);
        }
        deps.log("desktop.hooksFailed", { repair: false, noConfig: true });
        // The agent's start writes the config; the next Install then carries the token it holds.
        deps.restartAgent();
        return answer(CONFIG_GONE_NOTICE);
      }
      if ((await deps.tokenCheck()) === "refused") {
        if (mode === "attached") {
          deps.log("desktop.hooksFailed", { repair: false, attached: true, otherHome: true });
          return answer(OTHER_HOME_NOTICE);
        }
        // This app's own agent started before the config now on disk was written. A restart reads it,
        // and the install below only reads the token, so the two cannot disagree.
        deps.restartAgent();
      }
      try {
        const result = await deps.installHooks();
        if (result.ok) return answer();
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(result.message);
      } catch {
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(`the hooks could not be written; ${SEE_LOG}`);
      }
    },
```

6. Replace `pushedState` with:

```ts
    pushedState: async () => {
      const mode = deps.hostMode();
      if (mode === "attached" && unsettled) {
        unsettled = false;
        deps.log("desktop.attachedChange");
        lastNotice = ATTACHED_NOTICE;
      } else if (mode === "own") {
        unsettled = false;
        if (lastNotice === ATTACHED_NOTICE) lastNotice = null;
      }
      return { ...(await deps.state()), notice: lastNotice };
    },
```

and add one sentence to the end of the long comment above `lastNotice`: `` `pushedState` also raises ATTACHED_NOTICE itself, once, when a change made between agents (`unsettled`) is followed by the host settling as attached.``

- [ ] **Step 6: Wire `main.ts`**

In `apps/desktop/src/main.ts`:

1. Change the imports: `import { checkToken, fetchCounts, probeHealth } from "./agent-client";`, `import { currentHookStatus, installedExe, launchRepair, readConfigState, runtimePrefix } from "./hooks";` (drop `repairOnLaunch`), and `import { createQuitHandler, settleWithin } from "./quit";`.
2. Add after `STATE_COALESCE_MS`: `/** How long the launch repair waits for the host's first start; an agent starts in well under a second. */` and `const FIRST_START_CAP_MS = 10_000;`.
3. Add to the `createSettingsActions({ ... })` call, after `hasConfig`:

```ts
    tokenCheck: async () => {
      const read = await readConfigState(agentPaths(home));
      const port = host.state().port;
      return read.kind === "ok" && port !== null ? checkToken(port, read.config.token) : "unknown";
    },
```

4. Replace the block from the comment `// The packaged app rewrites our hooks when what they name is this exe` down to the closing brace of its `if (repairOnLaunch(...)) { ... }` with:

```ts
    // Decided once the host's first start has settled, and not awaited, so the window is not held up.
    // That start writes config.json when there is none; hooks left from before then carry the old
    // token, which only a status read after the write can see as stale.
    void settleWithin(host.settled(), FIRST_START_CAP_MS)
      .then(() =>
        quitting
          ? ("none" as const)
          : launchRepair({
              packaged: app.isPackaged,
              thisExe: process.execPath,
              status: async () => currentHookStatus({ config: await readConfigState(agentPaths(home)), settingsPath, runtime, binDir: agentPaths(home).bin, hooksDir: dist.hooks }),
              installedExe: () => installedExe(settingsPath),
              exists: (path) => access(path).then(() => true, () => false),
              install: () => installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now }),
              log,
            }),
      )
      .then((outcome) => {
        if (outcome !== "none") pushState();
      });
```

- [ ] **Step 7: Run every desktop check and commit**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS.

```bash
git add apps/desktop/src/hooks.ts apps/desktop/src/hooks.test.ts apps/desktop/src/settings/actions.ts apps/desktop/src/settings/actions.test.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): the launch repair is a tested function decided after the first start, an install never mints a config and asks the serving agent about its token, and a change made between agents is judged when the host settles"
```

---

### Task 6: The scheme: one host table, a handler that cannot reject, device names, the export's 404 page, and an import-free argument parser

**Files:**
- Modify: `apps/desktop/src/scheme.ts`, `apps/desktop/src/args.ts`
- Modify: `apps/desktop/src/main.ts` (wiring only)
- Test: `apps/desktop/src/scheme.test.ts`, `apps/desktop/src/args.test.ts`

**Interfaces:**
- Produces: `SETTINGS_POLICY: string` (replaces `settingsPolicy()`); `SchemeDeps.fallbackPort: number` (required); `resolveRendererUrl(args, env, packaged, exportUrl: string): string`. `mapRequest`, `mimeFor`, `hostOf`, `contentSecurityPolicy` and the URL constants keep their signatures.

- [ ] **Step 1: Write the failing scheme tests**

In `apps/desktop/src/scheme.test.ts`:

1. In the import list replace `settingsPolicy,` with `SETTINGS_POLICY,` (keep the list's order otherwise).
2. Replace `expect(settingsPolicy()).toBe(` with `expect(SETTINGS_POLICY).toBe(`, and every other `settingsPolicy()` with `SETTINGS_POLICY`.
3. In the `contentSecurityPolicy` test, change the expected string's `connect-src http://127.0.0.1:4750 http://localhost:4750` to `connect-src 'self' http://127.0.0.1:4750 http://localhost:4750`. In `reads the port for each response`, change the expected fragment to `"connect-src 'self' http://127.0.0.1:4800 http://localhost:4800;"`.
4. Add `fallbackPort: 4750` to every `createSchemeHandler({ ... })` call in the file.
5. An unknown host now gets the strictest policy rather than the visualiser's. In the first handler test, take `"app://other/"` out of the URL loop and add after the loop:

```ts
    const other = await handle({ url: "app://other/" });
    expect(other.status).toBe(404);
    expect(other.headers.get("content-security-policy")).toBe(SETTINGS_POLICY);
```

and in the last handler test change `expect(other.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));` to `.toBe(SETTINGS_POLICY);`.

6. Add inside `describe("mapRequest", ...)`:

```ts
  it("refuses a segment whose name before the first dot is a Windows device, which Windows 10 would open as one", () => {
    for (const url of ["app://clawd/CON", "app://clawd/con.txt", "app://clawd/NUL.js", "app://clawd/_next/COM1.json", "app://clawd/lpt9.tar.gz", "app://clawd/aux%20.css", "app://clawd/PRN/index.html", "app://clawd/CONIN$"]) {
      expect(mapRequest(url, DIRS), url).toBeNull();
    }
    // Only the whole name before the first dot counts: these are ordinary files.
    expect(mapRequest("app://clawd/console.js", DIRS)).toBe(join(ROOT, "console.js"));
    expect(mapRequest("app://clawd/com10.js", DIRS)).toBe(join(ROOT, "com10.js"));
    expect(mapRequest("app://clawd/icon.con", DIRS)).toBe(join(ROOT, "icon.con"));
  });
```

7. Add inside `describe("createSchemeHandler", ...)`:

```ts
  it("never rejects: a port getter that throws falls back to the given port, and a read that rejects is a 404", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>hi</p>");
    const throwing = createSchemeHandler({
      dirs: { clawd: dir, settings: dir },
      port: () => {
        throw new Error("no host yet");
      },
      fallbackPort: 4750,
    });
    const page = await throwing({ url: "app://clawd/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(contentSecurityPolicy(4750));

    const unreadable = createSchemeHandler({
      dirs: { clawd: dir, settings: dir },
      port: () => 4750,
      fallbackPort: 4750,
      readFile: async () => {
        throw new Error("EIO");
      },
    });
    const res = await unreadable({ url: "app://clawd/" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  it("answers a missing page with the export's 404.html when there is one, and anything else with plain text", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "404.html"), "<p>gone</p>");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir }, port: () => 4750, fallbackPort: 4750 });
    for (const url of ["app://clawd/nowhere", "app://clawd/nowhere.html", "app://clawd/a/b/"]) {
      const res = await handle({ url });
      expect(res.status, url).toBe(404);
      expect(res.headers.get("content-type"), url).toBe("text/html; charset=utf-8");
      expect(res.headers.get("content-security-policy"), url).toBe(contentSecurityPolicy(4750));
      expect(await res.text(), url).toBe("<p>gone</p>");
    }
    const script = await handle({ url: "app://clawd/missing.js" });
    expect(script.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await script.text()).toBe("not found");
    // The settings page has one route and no 404 page of its own.
    const settings = await handle({ url: "app://settings/nowhere" });
    expect(settings.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });
```

- [ ] **Step 2: Write the failing args tests**

In `apps/desktop/src/args.test.ts`, add `import { readFile } from "node:fs/promises";` and replace the whole `describe("resolveRendererUrl", ...)` block with:

```ts
describe("resolveRendererUrl", () => {
  const EXPORT = "app://clawd/";

  it("in development, prefers the flag, then the environment, then the export's URL it was given", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" }, false, EXPORT)).toBe("http://a");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "http://b" }, false, EXPORT)).toBe("http://b");
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, { CLAWD_DESKTOP_URL: "  " }, false, EXPORT)).toBe(EXPORT);
    expect(resolveRendererUrl({ hidden: false, devUrl: null }, {}, false, EXPORT)).toBe(EXPORT);
  });

  it("packaged, loads the export whatever the flag or the environment says", () => {
    expect(resolveRendererUrl({ hidden: false, devUrl: "http://a" }, { CLAWD_DESKTOP_URL: "http://b" }, true, EXPORT)).toBe(EXPORT);
  });
});

describe("args.ts", () => {
  it("imports nothing, so the argument parser pulls no schema library or file system into itself", async () => {
    expect(await readFile(new URL("./args.ts", import.meta.url), "utf8")).not.toMatch(/^\s*import\s/m);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/scheme.test.ts src/args.test.ts`
Expected: FAIL. `SETTINGS_POLICY` is not exported, device names map to files, a throwing port getter rejects, there is no 404 page, and `args.ts` imports `./scheme`.

- [ ] **Step 4: Rewrite `scheme.ts`**

Replace `apps/desktop/src/scheme.ts` from the `parseAppUrl` doc comment (`/** The host and path of one of our URLs...`) to the end of the file with the following. Keep everything above it except the path import, which becomes `import { extname, isAbsolute, join, relative, resolve } from "node:path";`.

```ts
/** The host and path of one of our URLs, or null when it does not parse or is not our scheme. */
function parseAppUrl(url: string): AppUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:`) return null;
  return { host: parsed.host.toLowerCase(), pathname: parsed.pathname };
}

/** Which of our hosts a request names, or null. */
export function hostOf(url: string): string | null {
  return parseAppUrl(url)?.host ?? null;
}

export type SchemeDirs = { clawd: string; settings: string };

const HTML_TYPE = "text/html; charset=utf-8";

/** The only file types served. Anything else is 404, so a stray file in the export is never run. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  html: HTML_TYPE,
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  woff2: "font/woff2",
  // Next's export writes its page payloads as .txt, and its router accepts them only as text/plain.
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

/**
 * The page may load and fetch its own files, run the inline scripts Next's export emits, and reach
 * only the agent. The renderer is sandboxed too; the network limit is where this policy earns its
 * keep. `'self'` in connect-src is for the router: a page that navigates on the client fetches its
 * own payloads, and without it that fails with nothing said.
 */
export function contentSecurityPolicy(port: number): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' http://127.0.0.1:${port} http://localhost:${port}`,
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The settings page talks to main through its preload bridge, never over the network, so it is
 * allowed no connections at all, and no inline scripts. Also what a host we do not serve gets: the
 * strictest policy there is, and one that needs no port.
 */
export const SETTINGS_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** Everything that differs between our two hosts, looked up once per request. */
type HostEntry = { dir(dirs: SchemeDirs): string; policy(port: number): string; notFound: string | null };

const HOSTS: ReadonlyMap<string, HostEntry> = new Map<string, HostEntry>([
  [APP_HOST, { dir: (dirs) => dirs.clawd, policy: contentSecurityPolicy, notFound: "404.html" }],
  [SETTINGS_HOST, { dir: (dirs) => dirs.settings, policy: () => SETTINGS_POLICY, notFound: null }],
]);

/**
 * Names Windows treats as devices whatever follows the first dot. On Windows 11 `CON.txt` is an
 * ordinary missing file; on Windows 10 it is the console, and reading it can hang the request.
 */
const DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/i;
const isDeviceName = (segment: string): boolean => DEVICE_NAME.test((segment.split(".")[0] ?? "").trimEnd());

/**
 * The file a URL's path names inside a directory, or null. The URL parser has already resolved dot
 * segments; what decoding reveals (an encoded slash or backslash, a `..`, a drive letter, a NUL, a
 * device name) is refused, and the result must still lie inside the directory.
 */
function fileFor(pathname: string, dir: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("\0") || path.includes("\\")) return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  // ":" would let a segment name a drive or an alternate data stream on Windows.
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":") || isDeviceName(segment))) return null;
  if (segments.length === 0) segments.push("index.html");
  const root = resolve(dir);
  const file = resolve(root, ...segments);
  const inside = relative(root, file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) return null;
  return file;
}

/** The file an app:// URL names inside its host's directory, the visualiser's or the settings page's, or null. */
export function mapRequest(url: string, dirs: SchemeDirs): string | null {
  const parsed = parseAppUrl(url);
  const entry = parsed === null ? undefined : HOSTS.get(parsed.host);
  return parsed === null || entry === undefined ? null : fileFor(parsed.pathname, entry.dir(dirs));
}

/** The served type of a file, by extension; null for any type not in the table. */
export function mimeFor(file: string): string | null {
  const ext = extname(file).slice(1).toLowerCase();
  return Object.hasOwn(MIME_TYPES, ext) ? (MIME_TYPES[ext] ?? null) : null;
}

export type SchemeDeps = {
  /** The renderer's and the settings page's directories: dist/renderer and dist/settings beside main.cjs. */
  dirs: SchemeDirs;
  /** The port of the agent in use, read for each response. */
  port(): number;
  /** The port the policy names if `port` throws. Main passes the agent's default. */
  fallbackPort: number;
  readFile?(path: string): Promise<Uint8Array>;
};

/**
 * The protocol.handle callback. It never rejects, which Chromium would show as a failed load with no
 * policy at all: anything it cannot map, type or read is a 404, the export's own 404 page for a
 * path that looks like a page, plain text otherwise.
 */
export function createSchemeHandler(deps: SchemeDeps): (request: { url: string }) => Promise<Response> {
  const read = deps.readFile ?? ((path: string) => readFile(path));
  const readOrNull = (path: string): Promise<Uint8Array | null> => read(path).then((bytes) => bytes, () => null);
  const port = (): number => {
    try {
      return deps.port();
    } catch {
      return deps.fallbackPort;
    }
  };
  return async (request) => {
    // The strictest policy until the host is known.
    let policy = SETTINGS_POLICY;
    try {
      const parsed = parseAppUrl(request.url);
      const entry = parsed === null ? undefined : HOSTS.get(parsed.host);
      if (parsed !== null && entry !== undefined) {
        policy = entry.policy(port());
        const dir = entry.dir(deps.dirs);
        const file = fileFor(parsed.pathname, dir);
        const type = file === null ? null : mimeFor(file);
        const body = file === null || type === null ? null : await readOrNull(file);
        if (body !== null && type !== null) return new Response(body, { status: 200, headers: { "content-security-policy": policy, "content-type": type } });
        const pageLike = ["", ".html"].includes(extname(parsed.pathname).toLowerCase());
        const notFound = entry.notFound === null || !pageLike ? null : await readOrNull(join(resolve(dir), entry.notFound));
        if (notFound !== null) return new Response(notFound, { status: 404, headers: { "content-security-policy": policy, "content-type": HTML_TYPE } });
      }
    } catch {
      // Whatever threw, the answer is the plain 404 below.
    }
    return new Response("not found", { status: 404, headers: { "content-security-policy": policy, "content-type": "text/plain; charset=utf-8" } });
  };
}
```

- [ ] **Step 5: Make `args.ts` import-free**

In `apps/desktop/src/args.ts`, delete the line `import { APP_URL } from "./scheme";` and replace `resolveRendererUrl` and its comment with:

```ts
/**
 * Where the window loads from: packaged, always `exportUrl`, the static export over app://clawd/, so
 * no flag or environment variable can point a teammate's app elsewhere; in development the flag,
 * else the environment, else the export. The URL is passed in so this file imports nothing.
 */
export function resolveRendererUrl(args: Args, env: Readonly<Record<string, string | undefined>>, packaged: boolean, exportUrl: string): string {
  if (packaged) return exportUrl;
  const fromEnv = env.CLAWD_DESKTOP_URL?.trim();
  return args.devUrl ?? (fromEnv ? fromEnv : exportUrl);
}
```

- [ ] **Step 6: Wire `main.ts`**

In `apps/desktop/src/main.ts`:

1. Change the scheme import to `import { APP_SCHEME, APP_URL, createSchemeHandler } from "./scheme";` and the URL line to `const url = resolveRendererUrl(args, process.env, app.isPackaged, APP_URL);`.
2. Change the `protocol.handle(...)` line to:

```ts
    protocol.handle(APP_SCHEME, createSchemeHandler({ dirs: { clawd: dist.renderer, settings: dist.settings }, port: () => host.state().port ?? DEFAULT_PORT, fallbackPort: DEFAULT_PORT }));
```

3. In the comment above `protocol.registerSchemesAsPrivileged`, replace the last sentence (`` `supportFetchAPI` lets fetch reach the scheme, though the CSP's connect-src currently allows fetch to the agent only.``) with `` `supportFetchAPI` lets fetch reach the scheme, which the CSP's connect-src allows for the page's own files.``

- [ ] **Step 7: Run every desktop check and commit**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS.

```bash
git add apps/desktop/src/scheme.ts apps/desktop/src/scheme.test.ts apps/desktop/src/args.ts apps/desktop/src/args.test.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): the scheme looks its host up once, never rejects, refuses Windows device names, serves the export's 404 page and lets the page fetch its own files, and the argument parser imports nothing"
```

---

### Task 7: The shell's edge cases: the state file, the bounds, Ctrl+Q, the tray at quit, the login control, and one window factory

**Files:**
- Modify: `apps/desktop/src/desktop-state.ts`, `apps/desktop/src/bounds.ts`, `apps/desktop/src/keys.ts`, `apps/desktop/src/quit.ts`, `apps/desktop/src/login.ts`, `apps/desktop/src/window.ts`
- Create: `apps/desktop/src/reveal.ts`, `apps/desktop/src/reveal.test.ts`
- Modify: `apps/desktop/src/main.ts` (wiring only)
- Test: `apps/desktop/src/desktop-state.test.ts`, `bounds.test.ts`, `keys.test.ts`, `quit.test.ts`, `login.test.ts`

**Interfaces:**
- Consumes: the log codes `desktop.stateUnreadable`, `desktop.stateWriteFailed`, `desktop.loginItem` (Task 3).
- Produces: `DesktopState.maximized?: boolean`; `createDesktopStore(path: string, log?: Logger): DesktopStore` with `usable(): boolean`; `restoredBounds` keeps its signature and now clamps; `KeyInput.code: string`; `QuitDeps.begin?(): void`; `shownAtLogin(read: LoginItemRead, name: string): boolean`; `loginOnLaunch` takes `stateUsable: boolean`; `showOrCreate<W extends Revealable>(current: W | null, quitting: boolean, create: () => W): W | null`; `createMainWindow(url, title, bounds, maximized: boolean)`.

- [ ] **Step 1: Write the failing state-file tests**

In `apps/desktop/src/desktop-state.test.ts`, change the fs import to `import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";` and:

1. Replace the first `parseDesktopState` test with:

```ts
  it("keeps valid bounds, a boolean maximized and a boolean openAtLogin from a version 2 file", () => {
    expect(parseDesktopState({ version: 2, bounds: BOUNDS, maximized: true, openAtLogin: false })).toEqual({ bounds: BOUNDS, maximized: true, openAtLogin: false });
    expect(parseDesktopState({ version: 2, maximized: "yes" })).toEqual({});
    expect(parseDesktopState({ version: 2 })).toEqual({});
  });
```

2. In `reads nothing remembered from a missing or damaged file`, add `expect(missing.usable()).toBe(true);` after the first `expect(missing.get())...` line and `expect(damaged.usable()).toBe(true);` after the last line: a missing file has nothing to lose, and neither has one that is not JSON.

3. Add inside `describe("createDesktopStore", ...)`:

```ts
  it("tells a file it cannot read from a missing one: nothing is written over it, it says so once, and this run still remembers", async () => {
    const dir = await tempDir();
    const path = join(dir, "desktop.json");
    // A directory where the file should be: the read fails, and not with "no such file", as a locked file would.
    await mkdir(path);
    const codes: string[] = [];
    const store = createDesktopStore(path, (code) => void codes.push(code));
    await store.load();
    expect(store.usable()).toBe(false);
    store.update({ openAtLogin: true });
    store.update({ bounds: BOUNDS });
    await store.flush();
    expect(store.get()).toEqual({ openAtLogin: true, bounds: BOUNDS });
    expect((await stat(path)).isDirectory()).toBe(true);
    expect(await readdir(dir)).toEqual(["desktop.json"]);
    expect(codes).toEqual(["desktop.stateUnreadable"]);
  });

  it("logs a write that fails", async () => {
    const inTheWay = join(await tempDir(), "a-file");
    await writeFile(inTheWay, "");
    const codes: string[] = [];
    const store = createDesktopStore(join(inTheWay, "desktop.json"), (code) => void codes.push(code));
    store.update({ openAtLogin: true });
    await store.flush();
    expect(codes).toEqual(["desktop.stateWriteFailed"]);
  });
```

- [ ] **Step 2: Write the failing bounds, keys, quit, login and reveal tests**

In `apps/desktop/src/bounds.test.ts`, add inside the describe:

```ts
  it("counts a title strip that lies across the seam of two displays, side by side or stacked", () => {
    const narrow = { x: 1850, y: 100, width: 150, height: 120 };
    expect(restoredBounds(narrow, [PRIMARY, RIGHT])).toEqual(narrow);
    const TOP = { x: 0, y: 0, width: 1920, height: 1080 };
    const BOTTOM = { x: 0, y: 1080, width: 1920, height: 1080 };
    const across = { x: 100, y: 1064, width: 1280, height: 800 };
    expect(restoredBounds(across, [TOP, BOTTOM])).toEqual(across);
  });

  it("does not count two displays that each show only part of the strip's height", () => {
    expect(restoredBounds({ x: 1500, y: -12, width: 1280, height: 800 }, [PRIMARY, RIGHT])).toBeNull();
  });

  it("clamps bounds saved on a larger display to the work area holding most of the window, and pulls what it shrank inside", () => {
    expect(restoredBounds({ x: 100, y: 80, width: 2400, height: 1300 }, [PRIMARY])).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    expect(restoredBounds({ x: 400, y: 80, width: 1280, height: 1300 }, [PRIMARY])).toEqual({ x: 400, y: 0, width: 1280, height: 1040 });
    // A window that fits is left exactly where it was, even hanging off an edge, since that was the user's choice.
    const hanging = { x: 1000, y: 80, width: 1280, height: 800 };
    expect(restoredBounds(hanging, [PRIMARY])).toEqual(hanging);
  });
```

In `apps/desktop/src/keys.test.ts`, change the helper to `const key = (over: Partial<KeyInput>): KeyInput => ({ type: "keyDown", key: "q", code: "KeyQ", control: true, shift: false, alt: false, meta: false, ...over });` and add:

```ts
  it("goes by the physical key only on a layout with no Latin letters, so Ctrl+A stays select-all on AZERTY", () => {
    // Russian: the Q key types й, so `key` never says q.
    expect(isQuitShortcut(key({ key: "й", code: "KeyQ" }))).toBe(true);
    // AZERTY: the physical Q key types a, and the key that types q is physical A.
    expect(isQuitShortcut(key({ key: "a", code: "KeyQ" }))).toBe(false);
    expect(isQuitShortcut(key({ key: "q", code: "KeyA" }))).toBe(true);
    // Dvorak: the physical Q key types an apostrophe.
    expect(isQuitShortcut(key({ key: "'", code: "KeyQ" }))).toBe(false);
    expect(isQuitShortcut(key({ key: "й", code: "KeyW" }))).toBe(false);
  });
```

In `apps/desktop/src/quit.test.ts`, add inside `describe("createQuitHandler", ...)`:

```ts
  it("says once that the quit is now certain, before it stops anything, which is when main takes the tray icon away", async () => {
    const order: string[] = [];
    const handler = createQuitHandler({
      begin: () => void order.push("begin"),
      stop: async () => void order.push("stop"),
      flush: async () => void order.push("flush"),
      exit: (code) => void order.push(`exit ${code}`),
      log: (code) => void order.push(code),
    });
    handler({ preventDefault: () => {} });
    handler({ preventDefault: () => {} });
    await flush();
    expect(order).toEqual(["begin", "stop", "flush", "exit 0"]);
  });

  it("still stops and exits when taking the tray away throws", async () => {
    const order: string[] = [];
    const handler = createQuitHandler({
      begin: () => {
        throw new Error("tray already gone");
      },
      stop: async () => void order.push("stop"),
      flush: async () => void order.push("flush"),
      exit: (code) => void order.push(`exit ${code}`),
      log: () => {},
    });
    handler({ preventDefault: () => {} });
    await flush();
    expect(order).toEqual(["stop", "flush", "exit 0"]);
  });
```

In `apps/desktop/src/login.test.ts`, add `shownAtLogin` to the import, add `stateUsable: true` to every existing `loginOnLaunch({ ... })` argument in the file, and add:

```ts
  it("touches nothing when the state file could not be read, since a stored choice of off may be in it", () => {
    expect(loginOnLaunch({ packaged: true, remembered: undefined, registered: false, stateUsable: false })).toBe("none");
    expect(loginOnLaunch({ packaged: true, remembered: true, registered: false, stateUsable: false })).toBe("none");
  });
```

inside `describe("loginOnLaunch", ...)`, and at the end of the file:

```ts
describe("shownAtLogin", () => {
  const NAME = "io.github.mwardill.clawd-visualiser";

  it("is off when Windows has no entry for this exe", () => {
    expect(shownAtLogin({ openAtLogin: false, launchItems: [] }, NAME)).toBe(false);
    expect(shownAtLogin({ openAtLogin: false, launchItems: [{ name: NAME, enabled: true }] }, NAME)).toBe(false);
  });

  it("is off when our entry is there but switched off in Task Manager, and on when it is enabled", () => {
    expect(shownAtLogin({ openAtLogin: true, launchItems: [{ name: NAME, enabled: false }] }, NAME)).toBe(false);
    expect(shownAtLogin({ openAtLogin: true, launchItems: [{ name: NAME, enabled: true }] }, NAME)).toBe(true);
  });

  it("goes by the Run value when Electron reports no entry of ours, as it did for the packaged exe in stage 6", () => {
    expect(shownAtLogin({ openAtLogin: true, launchItems: [] }, NAME)).toBe(true);
    expect(shownAtLogin({ openAtLogin: true }, NAME)).toBe(true);
    expect(shownAtLogin({ openAtLogin: true, launchItems: [{ name: "some.other.app", enabled: false }] }, NAME)).toBe(true);
  });
});
```

Create `apps/desktop/src/reveal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { showOrCreate, type Revealable } from "./reveal";

function fakeWindow(over: { destroyed?: boolean; minimized?: boolean } = {}) {
  const calls: string[] = [];
  const win: Revealable = {
    isDestroyed: () => over.destroyed === true,
    isMinimized: () => over.minimized === true,
    restore: () => void calls.push("restore"),
    show: () => void calls.push("show"),
    focus: () => void calls.push("focus"),
  };
  return { win, calls };
}

describe("showOrCreate", () => {
  it("makes the window when there is none, or the one there was is destroyed", () => {
    const made = fakeWindow();
    expect(showOrCreate(null, false, () => made.win)).toBe(made.win);
    expect(showOrCreate(fakeWindow({ destroyed: true }).win, false, () => made.win)).toBe(made.win);
    // Creating shows: nothing more is asked of a new window.
    expect(made.calls).toEqual([]);
  });

  it("shows and focuses the window there is, restoring it first when minimised, and makes nothing", () => {
    const plain = fakeWindow();
    const create = (): Revealable => {
      throw new Error("must not create");
    };
    expect(showOrCreate(plain.win, false, create)).toBe(plain.win);
    expect(plain.calls).toEqual(["show", "focus"]);
    const minimised = fakeWindow({ minimized: true });
    showOrCreate(minimised.win, false, create);
    expect(minimised.calls).toEqual(["restore", "show", "focus"]);
  });

  it("does nothing once quitting has begun, for either window", () => {
    const open = fakeWindow();
    const create = (): Revealable => {
      throw new Error("must not create");
    };
    expect(showOrCreate(open.win, true, create)).toBe(open.win);
    expect(showOrCreate(null, true, create)).toBeNull();
    expect(open.calls).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/desktop-state.test.ts src/bounds.test.ts src/keys.test.ts src/quit.test.ts src/login.test.ts src/reveal.test.ts`
Expected: FAIL in every file: `usable`, `shownAtLogin` and `./reveal` do not exist, the seam and clamp cases answer `null` or the saved size, the Cyrillic key is not a quit, and `begin` is never called.

- [ ] **Step 4: Write the state file**

In `apps/desktop/src/desktop-state.ts`:

1. Change the agent import to `import { readJsonFile, silentLogger, writeJsonAtomic, type Logger } from "@clawd/agent";`.
2. In the header comment, replace the sentence `A missing or damaged file reads as nothing remembered; a failed write is dropped, since the next change writes the whole file again.` with `A missing or damaged file reads as nothing remembered. A file that is there but cannot be read (locked, say) is different: what it holds is unknown, so nothing is written over it for the rest of the run. A failed write is logged and dropped, since the next change writes the whole file again.`
3. Change the state type to `export type DesktopState = { bounds?: Bounds; maximized?: boolean; openAtLogin?: boolean };`.
4. In `parseDesktopState`, widen the cast to `{ version?: unknown; bounds?: unknown; maximized?: unknown; openAtLogin?: unknown }` and add before the `openAtLogin` line: `if (typeof file.maximized === "boolean") state.maximized = file.maximized;`
5. Add to `DesktopStore`, after `get()`:

```ts
  /** False after a load that found a file it could not read. Nothing is written then, and main skips the first-run login item, since a stored choice of off may be in that file. */
  usable(): boolean;
```

6. Replace `createDesktopStore` with:

```ts
export function createDesktopStore(path: string, log: Logger = silentLogger): DesktopStore {
  let state: DesktopState = {};
  let usable = true;
  let chain: Promise<void> = Promise.resolve();
  return {
    async load() {
      try {
        const file = await readJsonFile(path);
        // What was updated while the file was being read is newer than the file.
        if (file.found && file.ok) state = { ...parseDesktopState(file.value), ...state };
      } catch {
        // There is a file and it cannot be read now. What it holds is unknown, so it must not be replaced by a guess.
        usable = false;
        log("desktop.stateUnreadable");
      }
    },
    get: () => state,
    usable: () => usable,
    update(patch) {
      state = { ...state, ...patch };
      if (!usable) return;
      const snapshot = { version: VERSION, ...state };
      chain = chain.then(() => writeJsonAtomic(path, snapshot)).catch(() => log("desktop.stateWriteFailed"));
    },
    flush: () => chain,
  };
}
```

`maximized` is a new optional field, read by this version and ignored by an older one, so the file stays version 2.

- [ ] **Step 5: Write the bounds**

Replace `apps/desktop/src/bounds.ts` from the `GRAB_STRIP` doc comment down with:

```ts
/** How much of the window's top strip, where the title bar is, must be showing to grab it. */
export const GRAB_STRIP = { width: 100, height: 32 } as const;

/** Whether [from, to) is covered by the union of the intervals. */
function covers(intervals: readonly (readonly [number, number])[], from: number, to: number): boolean {
  let reached = from;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (start > reached) break;
    reached = Math.max(reached, end);
  }
  return reached >= to;
}

/**
 * The widest run of the strip's columns that the work areas show, between them, at the strip's full
 * height. Between them, so a strip lying across the seam of two displays counts, side by side or
 * stacked; at full height, so two displays that each show a sliver do not add up to a title bar.
 */
function grabbableWidth(strip: Bounds, workAreas: readonly Bounds[]): number {
  const right = strip.x + strip.width;
  const cuts = [...new Set([strip.x, right, ...workAreas.flatMap((area) => [area.x, area.x + area.width])])].filter((x) => x >= strip.x && x <= right).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i] ?? 0;
    const to = cuts[i + 1] ?? 0;
    const rows = workAreas.filter((area) => area.x <= from && area.x + area.width >= to).map((area) => [area.y, area.y + area.height] as const);
    run = covers(rows, strip.y, strip.y + strip.height) ? run + (to - from) : 0;
    best = Math.max(best, run);
  }
  return best;
}

const shared = (aStart: number, aLength: number, bStart: number, bLength: number): number => Math.max(0, Math.min(aStart + aLength, bStart + bLength) - Math.max(aStart, bStart));

/**
 * The bounds to open at, or null to open at the default size: the saved ones when enough of their
 * title strip is showing to grab, made no larger than the work area holding most of the window. A
 * window that had to shrink is also pulled inside that area, since the part that was cut off would
 * otherwise simply hang off the other edge; one that fits is left exactly where the user put it.
 */
export function restoredBounds(saved: Bounds | undefined, workAreas: readonly Bounds[]): Bounds | null {
  if (saved === undefined) return null;
  if (grabbableWidth({ x: saved.x, y: saved.y, width: saved.width, height: GRAB_STRIP.height }, workAreas) < GRAB_STRIP.width) return null;
  let home: Bounds | undefined;
  let most = -1;
  for (const area of workAreas) {
    const overlap = shared(saved.x, saved.width, area.x, area.width) * shared(saved.y, saved.height, area.y, area.height);
    if (overlap > most) {
      most = overlap;
      home = area;
    }
  }
  if (home === undefined) return null;
  const width = Math.min(saved.width, home.width);
  const height = Math.min(saved.height, home.height);
  if (width === saved.width && height === saved.height) return saved;
  return { x: Math.min(Math.max(saved.x, home.x), home.x + home.width - width), y: Math.min(Math.max(saved.y, home.y), home.y + home.height - height), width, height };
}
```

- [ ] **Step 6: Write the keys, the quit handler, the login control and `reveal.ts`**

Replace `apps/desktop/src/keys.ts` from the `KeyInput` doc comment down with:

```ts
/** The fields of Electron's `Input` a shortcut needs. */
export type KeyInput = { type: string; key: string; code: string; control: boolean; shift: boolean; alt: boolean; meta: boolean };

/**
 * Ctrl+Q pressed, with no other modifier: quit the app, not just hide the window. `key` is what the
 * layout types, so it is right wherever the layout has a q. A layout with no Latin letters (Russian,
 * Greek, Hebrew) never types one, and there the physical Q key stands in. Only there: on AZERTY the
 * physical Q key types `a`, and Ctrl+A has to stay select-all.
 */
export function isQuitShortcut(input: KeyInput): boolean {
  if (input.type !== "keyDown" || !input.control || input.shift || input.alt || input.meta) return false;
  if (input.key.toLowerCase() === "q") return true;
  const nonLatin = input.key.length === 1 && input.key.charCodeAt(0) > 127;
  return nonLatin && input.code === "KeyQ";
}
```

In `apps/desktop/src/quit.ts`, add to `QuitDeps` before `stop`:

```ts
  /** Called once, when the first `will-quit` arrives: every window has closed, so the quit is certain. Main takes the tray icon away here, not in `before-quit`, which a page's `beforeunload` could still cancel, leaving the agent running with no icon. */
  begin?(): void;
```

and in `createQuitHandler`, after `quitting = true;` add:

```ts
    try {
      deps.begin?.();
    } catch {
      // Tidying up must not stop the quit.
    }
```

In `apps/desktop/src/login.ts`, change `loginOnLaunch` to:

```ts
export function loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean; stateUsable: boolean }): LoginOnLaunch {
  // A state file that could not be read may hold a choice of off: leave the entry as Windows has it.
  if (!s.packaged || !s.stateUsable) return "none";
  if (s.remembered === undefined) return "enableFirstRun";
  if (s.remembered && !s.registered) return "reapply";
  return "none";
}
```

add to its doc comment the sentence `` `stateUsable` is false when that file exists but could not be read, and then nothing is touched.``, and add at the end of the file:

```ts
/** The parts of Electron's `getLoginItemSettings()` answer the control reads. */
export type LoginItemRead = { openAtLogin: boolean; launchItems?: readonly { name: string; enabled: boolean }[] };

/**
 * What the Start on login control shows. `openAtLogin` says Windows has a Run value for this exe; it
 * stays true when the user switches the entry off in Task Manager's startup list, which Windows
 * records beside the value rather than by removing it. Electron reports that per entry, under the
 * Run value's name, and an entry of ours it reports as disabled shows as off. When it reports no
 * entry of ours, which stage 6 saw for the packaged exe, the Run value is all there is to go on.
 */
export function shownAtLogin(read: LoginItemRead, name: string): boolean {
  if (!read.openAtLogin) return false;
  const ours = (read.launchItems ?? []).filter((item) => item.name === name);
  return ours.length === 0 || ours.some((item) => item.enabled);
}
```

Create `apps/desktop/src/reveal.ts`:

```ts
// Showing a window that may not exist yet. Both windows, the visualiser and the settings page, are
// made the first time they are asked for and shown after that; this is the one copy of that rule.
// Electron-free: a BrowserWindow fits `Revealable` as it is.

export type Revealable = { isDestroyed(): boolean; isMinimized(): boolean; restore(): void; show(): void; focus(): void };

/**
 * The window to keep hold of: the one there is, restored if minimised, shown and focused; else a new
 * one. Once quitting has begun nothing is shown or made, so neither a second launch nor the tray can
 * bring a window back while the app exits.
 */
export function showOrCreate<W extends Revealable>(current: W | null, quitting: boolean, create: () => W): W | null {
  if (quitting) return current;
  if (current === null || current.isDestroyed()) return create();
  if (current.isMinimized()) current.restore();
  current.show();
  current.focus();
  return current;
}
```

- [ ] **Step 7: One hardened-window factory**

Replace `apps/desktop/src/window.ts` from the `createMainWindow` doc comment to the end of the file with:

```ts
type WindowSpec = { url: string; title: string; size: { width: number; height: number }; bounds?: Bounds | null; preload?: string };

/**
 * Every window the app makes: sandboxed, no Node access, its title set by main, no new windows, and
 * no navigation away from the origin it was loaded from. The one copy of the hardening.
 */
function createHardenedWindow(spec: WindowSpec): BrowserWindow {
  const win = new BrowserWindow({
    ...(spec.bounds ?? spec.size),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: spec.title,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, ...(spec.preload === undefined ? {} : { preload: spec.preload }) },
  });
  // A page's <title> replaces the window's by default; main sets the title instead.
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(spec.url, target)) event.preventDefault();
  });
  void win.loadURL(spec.url);
  return win;
}

/**
 * The one visualiser window: a web page that talks to the agent over HTTP, as a browser tab does,
 * with no preload. `bounds` puts it back where it was, and `maximized` how it was; without bounds it
 * opens at the default size, centred.
 */
export function createMainWindow(url: string, title: string, bounds: Bounds | null, maximized: boolean): BrowserWindow {
  const win = createHardenedWindow({ url, title, size: WINDOW_SIZE, bounds });
  if (maximized) win.maximize();
  return win;
}

export const SETTINGS_SIZE = { width: 560, height: 720 } as const;

/**
 * The settings window, with a preload: the one place the app gives a page a way to ask main for
 * something. It loads app://settings/ and nothing else.
 */
export function createSettingsWindow(preload: string): BrowserWindow {
  return createHardenedWindow({ url: SETTINGS_URL, title: "Clawd Visualiser settings", size: SETTINGS_SIZE, preload });
}
```

- [ ] **Step 8: Wire `main.ts`**

In `apps/desktop/src/main.ts`:

1. Imports: `import { appUserModelId, loginItemTarget, loginOnLaunch, shownAtLogin } from "./login";` and add `import { showOrCreate } from "./reveal";`.
2. Change the store line to `const store = createDesktopStore(desktopStatePath(home, app.isPackaged), log);` (it already sits below the `const log = createLogger(...)` block).
3. After `const login = loginItemTarget(...)` add `const loginName = appUserModelId(app.isPackaged);`, with the comment `/** The Run value's name, which is the AppUserModelId set above: how Electron names our entry in launchItems. */`. Leave the earlier `app.setAppUserModelId(...)` call as it is.
4. Replace `showWindow` with:

```ts
  /** Shows the window, making it the first time; from the tray, a second launch, or startup. */
  function showWindow(): void {
    win = showOrCreate(win, quitting, () => {
      const workAreas = screen.getAllDisplays().map((display) => display.workArea);
      const created = createMainWindow(url, statusText(host.state()), restoredBounds(store.get().bounds, workAreas), store.get().maximized === true);
      // Closing hides the window, and the app and its agent carry on in the tray. Once quitting has
      // begun the close goes through. Either way where it was, and whether it filled the screen, is remembered.
      created.on("close", (event) => {
        store.update({ bounds: created.getNormalBounds(), maximized: created.isMaximized() });
        if (quitting) return;
        event.preventDefault();
        created.hide();
      });
      created.webContents.on("before-input-event", (event, input) => {
        if (!isQuitShortcut(input)) return;
        event.preventDefault();
        app.quit();
      });
      created.on("closed", () => {
        win = null;
      });
      return created;
    });
  }
```

5. Replace `openAtLogin()` with:

```ts
  /** What the tray checkbox and the settings page show: off too when the entry is switched off in Task Manager. The launch rule below goes by the Run value alone, so it never re-enables an entry the user switched off there. */
  function openAtLogin(): boolean {
    return shownAtLogin(app.getLoginItemSettings(login), loginName);
  }
```

`applyOpenAtLogin` stays as it is: Electron's `setLoginItemSettings` enables the entry in Task Manager's list by default, so ticking the control on also undoes a switch-off made there.

6. Replace `showSettings` with:

```ts
  function showSettings(): void {
    settingsWin = showOrCreate(settingsWin, quitting, () => {
      const created = createSettingsWindow(join(dist.settings, "preload.js"));
      created.on("closed", () => {
        settingsWin = null;
      });
      return created;
    });
  }
```

7. Replace the login block in the `whenReady` callback (from `const action = loginOnLaunch(` to `if (action === "reapply") log("desktop.loginItemReapplied");`) with:

```ts
    // What Electron says about the entry, at every launch: numbers and booleans, so whether
    // `launchItems` can be trusted for a packaged path with spaces is on record from the first run.
    const item = app.getLoginItemSettings(login);
    log("desktop.loginItem", { openAtLogin: item.openAtLogin, willLaunch: item.executableWillLaunchAtLogin, items: item.launchItems.length, shown: shownAtLogin(item, loginName) });
    const action = loginOnLaunch({ packaged: app.isPackaged, remembered: store.get().openAtLogin, registered: item.openAtLogin, stateUsable: store.usable() });
    if (action !== "none") {
      app.setLoginItemSettings({ ...login, openAtLogin: true });
      store.update({ openAtLogin: true });
      refreshMenu();
    }
    if (action === "reapply") log("desktop.loginItemReapplied");
```

8. In the `before-quit` handler, delete the two lines `tray?.destroy();` and `tray = null;`, and change its comment's last clause from `and take the window and the tray icon away at once while the agent stops.` to `and take the window away at once. The tray icon goes in will-quit, once the quit is certain.`
9. Change the `will-quit` line to:

```ts
  app.on(
    "will-quit",
    createQuitHandler({
      begin: () => {
        tray?.destroy();
        tray = null;
      },
      stop: () => host.stop(),
      flush: () => Promise.all([sink.flush(), store.flush()]).then(() => {}),
      exit: (code) => app.exit(code),
      log,
    }),
  );
```

- [ ] **Step 9: Run every desktop check, try it by hand, and commit**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS.

Run: `pnpm --filter @clawd/desktop start` with `CLAWD_HOME` and `CLAUDE_CONFIG_DIR` pointing at scratch folders (PowerShell: `$env:CLAWD_HOME = "$env:TEMP\clawd-stage8"; $env:CLAUDE_CONFIG_DIR = "$env:TEMP\clawd-stage8-claude"; New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null`). Maximise the window, quit from the tray, start again: it opens maximised, and un-maximising returns it to its earlier size. The tray icon stays until the window has gone. The terminal shows a `desktop.loginItem` line. Stop the app.

```bash
git add apps/desktop/src/desktop-state.ts apps/desktop/src/desktop-state.test.ts apps/desktop/src/bounds.ts apps/desktop/src/bounds.test.ts apps/desktop/src/keys.ts apps/desktop/src/keys.test.ts apps/desktop/src/quit.ts apps/desktop/src/quit.test.ts apps/desktop/src/login.ts apps/desktop/src/login.test.ts apps/desktop/src/reveal.ts apps/desktop/src/reveal.test.ts apps/desktop/src/window.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): an unreadable state file is left alone, bounds are clamped and the maximised state kept, Ctrl+Q works on layouts with no Latin letters, the tray goes once the quit is certain, the login control reads Task Manager's switch, and both windows share one factory"
```

---

### Task 8: One type for the bridge, a small preload, and the settings window's font

**Files:**
- Create: `apps/desktop/src/settings/channels.ts`, `apps/desktop/src/settings/assets.test.ts`
- Modify: `apps/desktop/src/settings/state.ts`, `ipc.ts`, `preload.ts`, `page.ts`, `page.css`
- Modify: `apps/desktop/src/main.ts`, `apps/desktop/src/settings/ipc.test.ts` (imports only)
- Modify: `apps/desktop/build/bundle.mjs`, `apps/desktop/package.json`

**Interfaces:**
- Produces: `SettingsApi` from `settings/state.ts` (the design's §9 `ClawdSettingsApi`, the only spelling of the bridge); `CHANNELS` from `settings/channels.ts` (no longer exported from `ipc.ts`); `SettingsActions = Omit<SettingsApi, "onState">` in `ipc.ts`.

- [ ] **Step 1: Add the font package**

Run: `pnpm --filter @clawd/desktop add -D @fontsource/jetbrains-mono@^5.3.0`
Expected: `apps/desktop/package.json` gains the dev dependency and nothing moves into `dependencies`. Then check the two files the bundle will copy exist:

Run: `ls apps/desktop/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2 apps/desktop/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2 apps/desktop/node_modules/@fontsource/jetbrains-mono/LICENSE`
Expected: all three are listed. If a name differs in the installed version, use the names that are there, in every step below.

- [ ] **Step 2: Write the failing test**

Create `apps/desktop/src/settings/assets.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

describe("the settings page's files", () => {
  it("loads only fonts the bundle step copies beside the page", async () => {
    const css = await read("./page.css");
    const bundle = await read("../../build/bundle.mjs");
    const fonts = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((match) => match[1] ?? "");
    expect(fonts).toEqual(["jetbrains-mono-400.woff2", "jetbrains-mono-700.woff2"]);
    for (const font of fonts) expect(bundle, font).toContain(`dist/settings/${font}`);
  });

  it("keeps the preload free of the schema library: it imports the channel names and types, nothing else of ours", async () => {
    const preload = await read("./preload.ts");
    // `\r?` because a Windows checkout may hold CRLF line endings.
    const imports = [...preload.matchAll(/^import (type )?.* from "([^"]+)";\r?$/gm)].map((match) => `${match[1] ?? ""}${match[2] ?? ""}`);
    expect(imports).toEqual(["electron", "./channels", "type ./state"]);
    expect(await read("./channels.ts")).not.toMatch(/^\s*import\s/m);
  });
});
```

Run: `cd apps/desktop && npx vitest run src/settings/assets.test.ts`
Expected: FAIL. The stylesheet names no font file, and the preload imports `./ipc`.

- [ ] **Step 3: The channel names in a module of their own**

Create `apps/desktop/src/settings/channels.ts`:

```ts
// The settings bridge's channel names, in a file that imports nothing. The preload needs only these,
// and it is parsed before every settings page: taken from ipc.ts, they dragged the schema library and
// the whole of core in with them, about 750 kB.

/** One channel per call in the design's §9 bridge, plus the one main pushes state on. */
export const CHANNELS = {
  getState: "clawd:settings/getState",
  addFolder: "clawd:settings/addFolder",
  removeFolder: "clawd:settings/removeFolder",
  installHooks: "clawd:settings/installHooks",
  uninstallHooks: "clawd:settings/uninstallHooks",
  setDetail: "clawd:settings/setDetail",
  setOpenAtLogin: "clawd:settings/setOpenAtLogin",
  retryAgent: "clawd:settings/retryAgent",
  openLogs: "clawd:settings/openLogs",
  /** Main to the page: the state changed. */
  state: "clawd:settings/state",
} as const;
```

- [ ] **Step 4: One `SettingsApi`**

Add at the end of `apps/desktop/src/settings/state.ts`:

```ts
/**
 * The bridge: what the preload publishes as `window.clawd`, what the page calls, and, less `onState`,
 * what main's actions implement. The one spelling of it; the preload, the page and the handlers all
 * take it from here, so a call added in one place and not another fails to compile.
 */
export type SettingsApi = {
  getState(): Promise<SettingsState>;
  /** Opens the folder picker. */
  addFolder(): Promise<SettingsState>;
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  openLogs(): Promise<void>;
  /** Subscribes to the states main pushes on its own; returns the unsubscribe. */
  onState(cb: (s: SettingsState) => void): () => void;
};
```

In `apps/desktop/src/settings/ipc.ts`:

1. Delete the `CHANNELS` constant and its doc comment, and add `import { CHANNELS } from "./channels";` and `import type { SettingsApi } from "./state";`.
2. Replace the `SettingsActions` type with:

```ts
/** The page's calls as main implements them: the bridge less `onState`, which is the preload's own. */
export type SettingsActions = Omit<SettingsApi, "onState">;
```

In `apps/desktop/src/settings/preload.ts`, replace the two project imports with:

```ts
import { CHANNELS } from "./channels";
import type { SettingsApi, SettingsState } from "./state";
```

and change the last line of the `exposeInMainWorld` call from `});` to `} satisfies SettingsApi);`.

In `apps/desktop/src/settings/page.ts`, change the import to `import type { SettingsApi, SettingsState } from "./state";`, delete the whole `type Api = { ... };` block, and change the declaration to `declare const window: { clawd: SettingsApi } & Window;`.

In `apps/desktop/src/main.ts`, replace `import { CHANNELS, createHandlers } from "./settings/ipc";` with `import { CHANNELS } from "./settings/channels";` and `import { createHandlers } from "./settings/ipc";`. In `apps/desktop/src/settings/ipc.test.ts`, replace `import { CHANNELS, createHandlers, type BridgeActions } from "./ipc";` with `import { CHANNELS } from "./channels";` and `import { createHandlers, type BridgeActions } from "./ipc";`.

- [ ] **Step 5: The font**

In `apps/desktop/src/settings/page.css`, replace the first line (the comment) with:

```css
/* The app's night palette, JetBrains Mono, no framework. The two font files are copied beside this
   page by build/bundle.mjs: the settings origin may load only its own files, so the visualiser's
   copy of the face is out of reach. */
@font-face { font-family: "JetBrains Mono"; font-style: normal; font-weight: 400; font-display: block; src: url("jetbrains-mono-400.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-style: normal; font-weight: 700; font-display: block; src: url("jetbrains-mono-700.woff2") format("woff2"); }
```

In `apps/desktop/build/bundle.mjs`:

1. Change the fs import to `import { cp, stat } from "node:fs/promises";`.
2. After the two `cp` lines that copy `page.html` and `page.css`, add:

```js
// The settings page's font: the latin subset of JetBrains Mono, from a dev dependency rather than a
// checked-in binary, with its licence (OFL 1.1) beside it, as the licence asks of a redistribution.
const font = (file) => here(`../node_modules/@fontsource/jetbrains-mono/${file}`);
await cp(font("files/jetbrains-mono-latin-400-normal.woff2"), here("../dist/settings/jetbrains-mono-400.woff2"));
await cp(font("files/jetbrains-mono-latin-700-normal.woff2"), here("../dist/settings/jetbrains-mono-700.woff2"));
await cp(font("LICENSE"), here("../dist/settings/jetbrains-mono-LICENSE.txt"));

// The preload is parsed before every settings page. It needs the channel names and Electron's
// bridge, nothing more; if it grows past this, something has pulled a library into it again.
const PRELOAD_LIMIT = 20_000;
const preloadSize = (await stat(here("../dist/settings/preload.js"))).size;
if (preloadSize > PRELOAD_LIMIT) {
  console.error(`bundle: dist/settings/preload.js is ${preloadSize} bytes, over the ${PRELOAD_LIMIT} it is allowed; check what src/settings/preload.ts imports`);
  process.exit(1);
}
```

- [ ] **Step 6: Run the checks**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck && pnpm bundle`
Expected: PASS. esbuild's summary shows `dist\settings\preload.js` at a few kB (it was about 750 kB), and `dist/settings/` holds the two `.woff2` files and the licence.

Run: `pnpm --filter @clawd/desktop start` with the scratch variables from Task 7, open Settings from the tray: the text is JetBrains Mono (compare a `0`, which has a dotted centre, with Consolas's slashed one), and DevTools' console (Ctrl+Shift+I) shows no CSP or font errors. Stop the app.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/build/bundle.mjs apps/desktop/src/settings/channels.ts apps/desktop/src/settings/assets.test.ts apps/desktop/src/settings/state.ts apps/desktop/src/settings/ipc.ts apps/desktop/src/settings/ipc.test.ts apps/desktop/src/settings/preload.ts apps/desktop/src/settings/page.ts apps/desktop/src/settings/page.css apps/desktop/src/main.ts
git commit -m "fix(desktop): the bridge has one type, the preload carries the channel names and nothing else, and the settings window ships its font"
```

---

### Task 9: The settings page is built once and patched, its notice is a real live region, and it has tests

**Files:**
- Modify: `apps/desktop/src/settings/page.ts`, `page.html`, `page.css`
- Create: `apps/desktop/src/settings/page.test.ts`, `apps/desktop/tsconfig.page-test.json`
- Modify: `apps/desktop/tsconfig.json`, `apps/desktop/package.json`

**Interfaces:**
- Consumes: `SettingsApi`, `SettingsState` from `./state` (Task 8).
- Produces: nothing other code imports. The page's contract is what its tests pin: nodes survive a push; a button's busy guard survives a push; a push leaves a radio group alone while a request for it is out; the newest answer for a group always sets it; a failed request puts a radio back; the folder list is rebuilt only when the list changes, and focus in it goes to the same folder's button or to Add folder; focus in a row that is hidden goes to the section's first visible button; the notice is a paragraph inside an always-present `role="status"` container, replaced only when its text changes or the user's own action answers.

- [ ] **Step 1: Add the DOM environment and the test's type-check project**

Run: `pnpm --filter @clawd/desktop add -D happy-dom@^20`

Create `apps/desktop/tsconfig.page-test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["src/settings/page.test.ts"],
  "exclude": []
}
```

The page itself stays in `tsconfig.page.json`, with no Node types, so it still cannot reach for `process` or `Buffer`; only its test, which reads `page.html` from disk, sees both worlds.

In `apps/desktop/tsconfig.json`, change `"exclude": ["src/settings/page.ts"]` to `"exclude": ["src/settings/page.ts", "src/settings/page.test.ts"]`.

In `apps/desktop/package.json`, change the `typecheck` script to `"tsc --noEmit && tsc --noEmit -p tsconfig.page.json && tsc --noEmit -p tsconfig.page-test.json"`.

- [ ] **Step 2: Write the failing tests**

Create `apps/desktop/src/settings/page.test.ts`. The first line must be the environment comment.

```ts
// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { SettingsApi, SettingsState } from "./state";

const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 2, waiting: 0, error: null },
  app: { version: "0.1.0", exe: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe" },
  allowlist: ["C:\\repos\\one", "C:\\repos\\two"],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  logDir: "C:\\logs",
  notice: null,
};

// The real markup, less the script tag: the test imports the page's module itself.
const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), "page.html"), "utf8");
const BODY = (/<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "").replace(/<script[^>]*><\/script>/g, "");

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Loads a fresh copy of the page over a stub bridge, and waits for its first draw. */
async function load(over: Partial<SettingsApi> = {}, initial: SettingsState = STATE) {
  vi.resetModules();
  document.body.innerHTML = BODY;
  const listeners: Array<(s: SettingsState) => void> = [];
  const api: SettingsApi = {
    getState: async () => initial,
    addFolder: async () => initial,
    removeFolder: async () => initial,
    installHooks: async () => initial,
    uninstallHooks: async () => initial,
    setDetail: async () => initial,
    setOpenAtLogin: async () => initial,
    retryAgent: async () => initial,
    openLogs: async () => {},
    onState: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    ...over,
  };
  (window as unknown as { clawd: SettingsApi }).clawd = api;
  await import("./page");
  await flush();
  return { push: (state: SettingsState): void => listeners.forEach((cb) => cb(state)) };
}

function control<E extends HTMLElement = HTMLElement>(key: string): E {
  const found = Array.from(document.querySelectorAll<E>("[data-focus-key]")).find((node) => node.dataset.focusKey === key);
  if (found === undefined) throw new Error(`no control with the key ${key}`);
  return found;
}

const radio = (key: string): HTMLInputElement => control<HTMLInputElement>(key);

/** What the browser does when the user picks a radio: move the mark, then say so. */
function choose(key: string): void {
  const input = radio(key);
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const region = (): HTMLElement => {
  const node = document.getElementById("notice-region");
  if (node === null) throw new Error("no live region");
  return node;
};

describe("the settings page", () => {
  it("is built once: a push patches the text in place and keeps every node, so focus survives it", async () => {
    const page = await load();
    const add = control("add-folder");
    const hints = radio("detail:hints");
    const remove = control("remove-folder:C:\\repos\\one");
    add.focus();
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 4, waiting: 1 } });
    expect(control("add-folder")).toBe(add);
    expect(radio("detail:hints")).toBe(hints);
    expect(control("remove-folder:C:\\repos\\one")).toBe(remove);
    expect(document.activeElement).toBe(add);
    expect(document.body.textContent).toContain("4 · 1 waiting");
    expect(document.body.textContent).not.toContain("Loading");
  });

  it("keeps a button busy across a push, so a second click while the picker is open asks for nothing", async () => {
    let asked = 0;
    const picking = deferred<SettingsState>();
    const page = await load({
      addFolder: () => {
        asked++;
        return picking.promise;
      },
    });
    control("add-folder").click();
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 3 } });
    control("add-folder").click();
    expect(asked).toBe(1);
    expect(control("add-folder").getAttribute("aria-busy")).toBe("true");
    picking.resolve(STATE);
    await flush();
    expect(control("add-folder").hasAttribute("aria-busy")).toBe(false);
    control("add-folder").click();
    expect(asked).toBe(2);
  });

  it("does not let a slow answer to an earlier choice overwrite a later one", async () => {
    const first = deferred<SettingsState>();
    const second = deferred<SettingsState>();
    const answers = [first, second];
    await load({ setDetail: () => (answers.shift() ?? second).promise });
    choose("detail:hints");
    choose("detail:paths");
    second.resolve({ ...STATE, detail: "paths" });
    await flush();
    first.resolve({ ...STATE, detail: "hints" });
    await flush();
    expect(radio("detail:paths").checked).toBe(true);
    expect(radio("detail:hints").checked).toBe(false);
  });

  it("sets a group from its newest answer even while an older request is still out, so a refused choice goes back at once", async () => {
    const first = deferred<SettingsState>();
    const second = deferred<SettingsState>();
    const answers = [first, second];
    await load({ setDetail: () => (answers.shift() ?? second).promise });
    choose("detail:hints");
    choose("detail:paths");
    second.resolve({ ...STATE, detail: "none", notice: "the detail level could not be saved; see the log" });
    await flush();
    expect(radio("detail:none").checked).toBe(true);
    expect(radio("detail:paths").checked).toBe(false);
    expect(region().textContent).toContain("could not be saved");
  });

  it("puts a radio back when its request fails, by drawing main's last state again", async () => {
    await load({ setOpenAtLogin: () => Promise.reject(new Error("main is gone")) });
    choose("login:on");
    expect(radio("login:on").checked).toBe(true);
    await flush();
    expect(radio("login:off").checked).toBe(true);
    expect(radio("login:on").checked).toBe(false);
  });

  it("leaves a radio where the user put it when a push arrives before the answer, and follows pushes again afterwards", async () => {
    const saving = deferred<SettingsState>();
    const page = await load({ setDetail: () => saving.promise });
    choose("detail:hints");
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 5 } });
    expect(radio("detail:hints").checked).toBe(true);
    saving.resolve({ ...STATE, detail: "hints" });
    await flush();
    expect(radio("detail:hints").checked).toBe(true);
    page.push({ ...STATE, detail: "paths" });
    expect(radio("detail:paths").checked).toBe(true);
    expect(radio("detail:hints").checked).toBe(false);
  });

  it("rebuilds the folder list only when the list changes, keeping focus on the same folder's button, or on Add folder when that folder is gone", async () => {
    const page = await load();
    const two = control("remove-folder:C:\\repos\\two");
    page.push({ ...STATE, hooks: "stale" });
    expect(control("remove-folder:C:\\repos\\two")).toBe(two);

    two.focus();
    page.push({ ...STATE, allowlist: ["C:\\repos\\two"] });
    expect(document.activeElement).toBe(control("remove-folder:C:\\repos\\two"));
    expect(document.querySelectorAll("li")).toHaveLength(1);

    page.push({ ...STATE, allowlist: [] });
    expect(document.activeElement).toBe(control("add-folder"));
    expect(document.body.textContent).toContain("no folders watched yet");
  });

  it("shows the rows a state calls for and hides the rest, moving focus out of a row it hides", async () => {
    const page = await load();
    const row = (key: string): HTMLElement => {
      const found = control(key).closest<HTMLElement>(".row");
      if (found === null) throw new Error(`no row for ${key}`);
      return found;
    };
    expect(row("retry").hidden).toBe(true);
    expect(row("remove-hooks").hidden).toBe(false);

    control("remove-hooks").focus();
    page.push({ ...STATE, hooks: "missing" });
    expect(row("remove-hooks").hidden).toBe(true);
    expect(control("install-hooks").textContent).toBe("Install hooks");
    expect(document.activeElement).toBe(control("install-hooks"));

    page.push({ ...STATE, hooks: "unreadable", agent: { ...STATE.agent, mode: "failed", error: "config.json is invalid at: port" } });
    expect(row("install-hooks").hidden).toBe(true);
    expect(row("retry").hidden).toBe(false);
    expect(document.body.textContent).toContain("config.json is invalid at: port");
  });

  it("announces a notice from a live region that is always there: the paragraph goes in, stays the same node across pushes, and comes out", async () => {
    const page = await load();
    expect(region().getAttribute("role")).toBe("status");
    expect(region().hidden).toBe(false);
    expect(region().children).toHaveLength(0);

    page.push({ ...STATE, notice: "refusing to allow a whole filesystem root: C:\\" });
    const said = region().firstElementChild;
    expect(said?.tagName).toBe("P");
    expect(said?.className).toBe("notice");
    expect(said?.textContent).toBe("refusing to allow a whole filesystem root: C:\\");

    // An unrelated push carries the same notice: nothing is replaced, so nothing is read out twice.
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 9 }, notice: "refusing to allow a whole filesystem root: C:\\" });
    expect(region().firstElementChild).toBe(said);

    page.push(STATE);
    expect(region().children).toHaveLength(0);
  });

  it("reads the same refusal out again when the user's own action earns it again", async () => {
    const refusal = { ...STATE, notice: "no hooks of ours were found; nothing was changed" };
    await load({ uninstallHooks: async () => refusal }, refusal);
    const said = region().firstElementChild;
    control("remove-hooks").click();
    await flush();
    expect(region().firstElementChild).not.toBe(said);
    expect(region().textContent).toBe("no hooks of ours were found; nothing was changed");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/settings/page.test.ts`
Expected: FAIL, in the page's behaviour and not in the harness: nodes are replaced on a push, the busy guard is lost, and there is no `notice-region`.

If instead vitest reports that it does not know the environment comment, or that `document` is not defined, this vitest version wants the environment set in a config: create `apps/desktop/vitest.config.ts` with two projects, `{ test: { name: "node", include: ["src/**/*.test.ts"], exclude: ["src/settings/page.test.ts"] } }` and `{ test: { name: "page", include: ["src/settings/page.test.ts"], environment: "happy-dom" } }`, inside `defineConfig({ test: { projects: [...] } })` from `vitest/config`, add that file to the commit, and run again.

- [ ] **Step 4: The markup and the stylesheet**

In `apps/desktop/src/settings/page.html`, replace the comment and the `<p id="notice" ...>` line with:

```html
    <!-- The live region: always rendered and never hidden, so it is in the accessibility tree before
         the first notice arrives. render() puts the styled paragraph inside it and takes it out. -->
    <div id="notice-region" role="status"></div>
```

In `apps/desktop/src/settings/page.css`:

1. After the `* { box-sizing: border-box; }` line add:

```css
/* Rows are flex, which would otherwise beat the hidden attribute: the page hides rows rather than removing them. */
[hidden] { display: none !important; }
```

2. In the comment above `.notice`, replace `#notice sits before <main> in page.html` with `The notice's paragraph sits in #notice-region, before <main> in page.html`. The rule itself stays.

- [ ] **Step 5: Rewrite `page.ts`**

Replace `apps/desktop/src/settings/page.ts` with:

```ts
// The settings page. It draws whatever state the bridge gives it and sends one message per change;
// every decision is main's. No framework, no network: window.clawd is its only way out. The page is
// built once and then patched. Main pushes a state whenever a session changes, and rebuilding under
// the reader dropped a button's busy guard, reset a radio mid-request, wiped a text selection and
// swallowed a click that straddled the old nodes and the new.
import type { SettingsApi, SettingsState } from "./state";

declare const window: { clawd: SettingsApi } & Window;

type Detail = SettingsState["detail"];
type Login = "on" | "off";

const AGENT_WORDS: Record<SettingsState["agent"]["mode"], string> = {
  starting: "starting",
  own: "running in this app",
  attached: "attached to another agent",
  restarting: "restarting",
  failed: "failed",
};
const HOOK_WORDS: Record<SettingsState["hooks"], string> = {
  missing: "not installed",
  current: "installed",
  stale: "installed, but not what this app would write now",
  unreadable: "cannot be checked: the agent's config or Claude Code's settings file is not usable",
};
const DETAIL_CHOICES: readonly { value: Detail; label: string }[] = [
  { value: "none", label: "none: states, tool names and timings" },
  { value: "hints", label: "hints: adds programs, file types and web hosts" },
  { value: "paths", label: "paths: adds files, folders and session names" },
];
const LOGIN_CHOICES: readonly { value: Login; label: string }[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

/** The state last drawn, which a failed request draws again, so a radio the browser already moved goes back. */
let drawn: SettingsState | undefined;
/** The newest request per control, so a slow answer to an earlier choice cannot overwrite a later one. */
const newest = new Map<string, number>();
/** Requests still out, per control. While a group has one, a push leaves its radios where the user put them. */
const pending = new Map<string, number>();

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

/** Every control carries a key: the folder list puts focus back by it, and the tests find controls by it. */
function keyed<E extends HTMLElement>(node: E, key: string): E {
  node.dataset.focusKey = key;
  return node;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Sends one request for a control and draws its answer, unless a newer request for that control has gone since. */
function send(key: string, request: () => Promise<SettingsState | void>): Promise<void> {
  const n = (newest.get(key) ?? 0) + 1;
  newest.set(key, n);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  const settle = (): void => void pending.set(key, Math.max(0, (pending.get(key) ?? 1) - 1));
  return request().then(
    (state) => {
      settle();
      if (state && newest.get(key) === n) render(state, key, true);
    },
    () => {
      settle();
      // No answer: draw what main last said again, so a radio the browser already moved goes back.
      if (drawn !== undefined && newest.get(key) === n) render(drawn, key);
    },
  );
}

/** A button that stays focusable while its request runs: marked busy rather than disabled, since disabling drops focus. */
function button(key: string, label: string, run: () => Promise<SettingsState | void>): HTMLElement {
  const node = keyed(el("button", label) as HTMLButtonElement, key);
  node.type = "button";
  node.addEventListener("click", () => {
    if (node.getAttribute("aria-busy") === "true") return;
    node.setAttribute("aria-busy", "true");
    void send(key, run).finally(() => node.removeAttribute("aria-busy"));
  });
  return node;
}

type Choices<T extends string> = { group: HTMLElement; inputs: Map<T, HTMLInputElement> };

/**
 * Mutually exclusive choices as real radio inputs in a fieldset: arrow keys move between the options,
 * and a screen reader announces the group, each option and which one is chosen.
 */
function choices<T extends string>(key: string, legend: string, options: readonly { value: T; label: string }[], choose: (value: T) => Promise<SettingsState>): Choices<T> {
  const group = el("fieldset", undefined, "choices");
  group.append(el("legend", legend));
  const inputs = new Map<T, HTMLInputElement>();
  for (const option of options) {
    const input = keyed(document.createElement("input"), `${key}:${option.value}`);
    input.type = "radio";
    input.name = key;
    input.value = option.value;
    input.addEventListener("change", () => {
      if (input.checked) void send(key, () => choose(option.value));
    });
    const label = el("label");
    label.append(input, document.createTextNode(option.label));
    group.append(label);
    inputs.set(option.value, input);
  }
  return { group, inputs };
}

/** Puts a group's radios where the state says, unless a request for the group is still out and this draw is not its answer. */
function check<T extends string>(group: Choices<T>, key: string, current: T, answered: string | undefined): void {
  if ((pending.get(key) ?? 0) > 0 && answered !== key) return;
  for (const [value, input] of group.inputs) input.checked = value === current;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const node = el("section");
  node.append(el("h2", title), ...rows);
  return node;
}

function row(label: string, value: HTMLElement): HTMLElement {
  const node = el("div", undefined, "row");
  node.append(el("span", label), value);
  return node;
}

/** The nodes a draw writes to. Made once; every draw after that patches them. */
type View = {
  agent: HTMLElement;
  reasonRow: HTMLElement;
  reason: HTMLElement;
  sessions: HTMLElement;
  logs: HTMLElement;
  retryRow: HTMLElement;
  version: HTMLElement;
  exe: HTMLElement;
  folders: HTMLElement;
  addFolder: HTMLElement;
  hooks: HTMLElement;
  installRow: HTMLElement;
  install: HTMLElement;
  removeRow: HTMLElement;
  detail: Choices<Detail>;
  login: Choices<Login>;
};
let view: View | undefined;
/** The folder list last drawn, as text: the one part of the page that is rebuilt, and only when this changes. */
let drawnFolders = "";

function build(app: HTMLElement): View {
  const agent = el("span", "", "dim");
  const reason = el("span", "", "warn");
  const reasonRow = row("reason", reason);
  const sessions = el("span", "", "dim");
  const logs = el("code");
  const retryRow = row("retry", button("retry", "Start the agent again", () => window.clawd.retryAgent()));
  const version = el("span", "", "dim");
  const exe = el("code");
  const folders = el("ul");
  const addFolder = button("add-folder", "Add folder…", () => window.clawd.addFolder());
  const hooks = el("span");
  const install = button("install-hooks", "Install hooks", () => window.clawd.installHooks());
  const installRow = row("", install);
  const removeRow = row("", button("remove-hooks", "Remove hooks", () => window.clawd.uninstallHooks()));
  const detail = choices<Detail>("detail", "What the local view shows", DETAIL_CHOICES, (level) => window.clawd.setDetail(level));
  const login = choices<Login>("login", "Start the app when you sign in", LOGIN_CHOICES, (value) => window.clawd.setOpenAtLogin(value === "on"));
  app.replaceChildren(
    section("Agent", [row("state", agent), reasonRow, row("sessions", sessions), row("logs", logs), row("", button("open-logs", "Open logs folder", () => window.clawd.openLogs())), retryRow]),
    section("This app", [row("version", version), row("runs from", exe)]),
    section("Watched folders", [folders, row("", addFolder)]),
    section("Hooks", [row("status", hooks), installRow, removeRow]),
    section("Detail level", [detail.group]),
    section("Start on login", [login.group]),
  );
  return { agent, reasonRow, reason, sessions, logs, retryRow, version, exe, folders, addFolder, hooks, installRow, install, removeRow, detail, login };
}

/** The folder list is the one thing rebuilt, and only when it differs. Focus inside it goes to the same folder's button, or to Add folder when that folder has gone. */
function drawFolders(v: View, allowlist: readonly string[]): void {
  const text = JSON.stringify(allowlist);
  if (text === drawnFolders) return;
  drawnFolders = text;
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && v.folders.contains(active) ? active.dataset.focusKey : undefined;
  const items = allowlist.map((dir) => {
    const item = el("li", undefined, "row");
    item.append(el("code", dir), button(`remove-folder:${dir}`, "Remove", () => window.clawd.removeFolder(dir)));
    return item;
  });
  v.folders.replaceChildren(...(items.length === 0 ? [el("li", "no folders watched yet", "dim")] : items));
  if (focusKey === undefined) return;
  const again = Array.from(v.folders.querySelectorAll<HTMLElement>("button")).find((node) => node.dataset.focusKey === focusKey);
  (again ?? v.addFolder).focus();
}

/**
 * The notice, in the live region page.html always renders. The paragraph is replaced only when its
 * text changes, so a push that carries the same notice is not read out again, or when the user's own
 * action has just earned the same sentence a second time, which should be.
 */
function announce(notice: string | null, again: boolean): void {
  const region = document.getElementById("notice-region");
  if (region === null) return;
  const shown = region.firstElementChild?.textContent ?? null;
  if (shown === notice && !(again && notice !== null)) return;
  if (notice === null) region.replaceChildren();
  else region.replaceChildren(el("p", notice, "notice"));
}

/**
 * Draws a state. `answered` names the control whose request this state answers, when it answers one:
 * that group is set from it even while an older request of its own is still out. `announceAgain` is
 * true for an answer to the user's own action.
 */
function render(state: SettingsState, answered?: string, announceAgain = false): void {
  const app = document.getElementById("app");
  if (app === null) return;
  const v = (view ??= build(app));
  drawn = state;
  const focused = document.activeElement;

  announce(state.notice, announceAgain);
  setText(v.agent, `${AGENT_WORDS[state.agent.mode]} · port ${state.agent.port} · version ${state.agent.version}`);
  setText(v.reason, state.agent.error ?? "");
  v.reasonRow.hidden = state.agent.error === null;
  setText(v.sessions, `${state.agent.sessions} · ${state.agent.waiting} waiting`);
  setText(v.logs, state.logDir);
  v.retryRow.hidden = state.agent.mode !== "failed";
  setText(v.version, state.app.version);
  setText(v.exe, state.app.exe);
  drawFolders(v, state.allowlist);
  setText(v.hooks, HOOK_WORDS[state.hooks]);
  v.hooks.className = state.hooks === "current" || state.hooks === "missing" ? "dim" : "warn";
  v.installRow.hidden = state.hooks === "unreadable";
  setText(v.install, state.hooks === "missing" ? "Install hooks" : "Reinstall hooks");
  v.removeRow.hidden = state.hooks === "missing" || state.hooks === "unreadable";
  check(v.detail, "detail", state.detail, answered);
  check(v.login, "login", state.openAtLogin ? "on" : "off", answered);

  // A row that has just been hidden may hold the focus, which would strand a keyboard or screen
  // reader user: hand it to the first button still showing in the same section.
  if (focused instanceof HTMLElement && focused.closest("[hidden]") !== null) {
    focused.closest("section")?.querySelector<HTMLElement>(".row:not([hidden]) button")?.focus();
  }
}

window.clawd.onState((state) => render(state));
void window.clawd.getState().then((state) => render(state));
```

- [ ] **Step 6: Run the page's tests, then everything**

Run: `cd apps/desktop && npx vitest run src/settings/page.test.ts`
Expected: PASS, all ten.

Run: `cd apps/desktop && npx vitest run && pnpm typecheck && pnpm bundle`
Expected: PASS, with all three type-check projects clean.

- [ ] **Step 7: Try it by hand**

Run `pnpm --filter @clawd/desktop start` with the scratch variables from Task 7 and open Settings. Select some text on the page with the mouse and wait ten seconds while a Claude Code session runs or the simulated feed ticks: the selection stays. Tab to a Detail level radio and press the arrow keys: the choice moves and focus stays on the chosen radio. Add `C:\` as a folder: the amber notice appears above the sections. Stop the app.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/tsconfig.json apps/desktop/tsconfig.page-test.json apps/desktop/src/settings/page.ts apps/desktop/src/settings/page.html apps/desktop/src/settings/page.css apps/desktop/src/settings/page.test.ts
git commit -m "fix(desktop): the settings page is built once and patched in place, its notice sits in an always-present live region, and a DOM test file pins what the page decides"
```

---

### Task 10: The package: two fuses off, the smoke script's fixes, and the port pinned

**Files:**
- Modify: `apps/desktop/electron-builder.yml`, `apps/desktop/build/smoke-packaged.mjs`
- Create: `apps/desktop/src/packaging.test.ts`

**Interfaces:**
- Consumes: `taskkillPath` from `@clawd/agent` (Task 3); the log code `desktop.attachedRefused` (Tasks 3 and 4).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/packaging.test.ts`:

```ts
import { DEFAULT_PORT } from "@clawd/agent";
import { DEFAULT_AGENT_URL } from "@clawd/core";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("electron-builder.yml", () => {
  it("keeps the fuse every installed hook depends on, and turns off the two doors the app never uses", async () => {
    const yml = await readFile(new URL("../electron-builder.yml", import.meta.url), "utf8");
    const fuse = (name: string): string | undefined => new RegExp(`^\\s+${name}:\\s*(true|false)\\s*$`, "m").exec(yml)?.[1];
    expect(fuse("runAsNode")).toBe("true");
    expect(fuse("onlyLoadAppFromAsar")).toBe("true");
    expect(fuse("enableNodeOptionsEnvironmentVariable")).toBe("false");
    expect(fuse("enableNodeCliInspectArguments")).toBe("false");
  });
});

describe("the agent's port", () => {
  it("is the same in the export's built-in agent URL and the agent's default, the two places it is written", () => {
    // No stage lets the port vary, so the page's URL is fixed at build time. If either default moves, both must.
    expect(DEFAULT_AGENT_URL).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
  });
});
```

Run: `cd apps/desktop && npx vitest run src/packaging.test.ts`
Expected: FAIL on the two fuses, which the file does not name; the port test passes already.

- [ ] **Step 2: Turn the two fuses off**

In `apps/desktop/electron-builder.yml`, replace the fuses comment and block with:

```yaml
# Fuses are switches baked into the binary. runAsNode stays on because every installed hook runs
# the exe as Node. The rest close doors the app never uses: it reads no NODE_OPTIONS, takes no
# --inspect, and loads its code from the archive only.
electronFuses:
  runAsNode: true
  enableCookieEncryption: true
  onlyLoadAppFromAsar: true
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
```

- [ ] **Step 3: Fix the smoke script**

In `apps/desktop/build/smoke-packaged.mjs`:

1. In the bundled entry's contents, change the first line to `'export { agentPaths, readConfig, taskkillPath } from "@clawd/agent";',` and add `taskkillPath` to the destructuring of the dynamic import below it.

2. Replace the `desktop.started` wait with a parsed one:

```js
  await waitFor("desktop.started in the log", async () => (await logRecords()).some((record) => record.code === "desktop.started" && record.packaged === true), 20_000);
```

3. An app that attaches to an agent refusing its origin logs `desktop.attachedRefused`, not `desktop.attached`. Replace the `owner` wait and the check after it with:

```js
  const owner = await waitFor(
    "the log to say whose agent serves the port (agent.started, desktop.attached or desktop.attachedRefused)",
    async () => (await logRecords()).find((record) => record.code === "agent.started" || record.code === "desktop.attached" || record.code === "desktop.attachedRefused"),
    10_000,
  );
  if (owner.code !== "agent.started") throw new Error(`another agent holds port ${owner.port} and answered instead; stop it (the CLI's, or a development run) and run the smoke again`);
```

4. Replace the body of the `if (ended === null) { ... }` block inside `finally` with:

```js
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
```

and update the comment above that block: replace `If the tree is still there, taskkill is missing or timed out: the app is killed by its own id, and the smoke fails, since what it started may live on.` with `If the tree is still there, taskkill failed or timed out: the app is killed by its own id, its handle is let go if even that fails, and the smoke fails, since what it started may live on. An app that exits on its own mid-poll leaves its children orphaned and out of reach of a tree kill; the cost is a scratch folder that may not delete, which removeScratch warns about.`

- [ ] **Step 4: Run the checks**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Package and smoke**

Stop any CLI agent and any development run first: the smoke fails, by design, if another agent holds the port.

Run: `pnpm --filter @clawd/desktop package`
Expected: `apps/desktop/release/Clawd-Visualiser-0.1.0-win-x64.zip` and `release/win-unpacked/`.

Run: `pnpm --filter @clawd/desktop smoke`
Expected: three `smoke:` lines, the exe ran as Node (which is the hooks, with the two fuses off), the app started and knows it is packaged, and its own agent answers the visualiser's origin; exit code 0; no warning.

If the exe no longer runs as Node, take `enableNodeOptionsEnvironmentVariable: false` back out, package and smoke again, and if that cures it record in Task 11 that the fuse stays on and why; the test in Step 1 then expects `"true"` for it. Do not touch `runAsNode`.

Optional, needs the network: `pnpm dlx @electron/fuses read --app "apps/desktop/release/win-unpacked/Clawd Visualiser.exe"` lists `RunAsNode is Enabled`, `EnableNodeOptionsEnvironmentVariable is Disabled`, `EnableNodeCliInspectArguments is Disabled`. If there is no network, say so in the hand-off and leave it for the maintainer.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/build/smoke-packaged.mjs apps/desktop/src/packaging.test.ts
git commit -m "fix(desktop): the package turns off the two fuses it never uses, the smoke calls taskkill by its full path, parses the log line it waits for and cannot hang on a process it could not end, and a test pins the two default ports together"
```

---

### Task 11: The documents, the checklist, and the hand-off

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-desktop-app-design.md`
- Modify: `docs/superpowers/specs/2026-09-13-session-visibility-design.md`, `docs/PRD.md`
- Modify: `apps/desktop/README.md`, `apps/agent/README.md`, `README.md`

Write in the documents' own voice: plain sentences, British spelling, no bullet-point fragments where the surrounding text is prose. Wrap at the width the file already uses.

- [ ] **Step 1: The design's sections**

In `docs/superpowers/specs/2026-09-14-desktop-app-design.md`:

1. §3's layout block. After the `    login.ts` line add `    reveal.ts             show the window there is, or make one; nothing once quitting has begun`. After the `      ipc.ts` line add `      channels.ts         the bridge's channel names, import-free, all the preload takes` and change the `      page.html, page.ts  the settings window` line to `      page.html, page.ts  the settings window, built once and patched; page.test.ts runs it under happy-dom`. In the `package.json` line's devDependencies list add `happy-dom, @fontsource/jetbrains-mono`.

2. §5, the `- **attached.**` bullet. Replace its first sentence's `a health probe on the port answered within 500 ms: another agent (the CLI's, say) is serving.` with `a health probe on the port, sent with this app's origin, answered within 500 ms: another agent (the CLI's, say) is serving. An agent that answers the origin with its 403 was started before it knew \`app://clawd\`: the host attaches all the same, logs \`desktop.attachedRefused\`, and the title, the tooltip and the settings page's reason say the agent refuses this app, until it stops and the app takes over.` Replace the bullet's text from `Installing hooks while attached with no config of this` to the end of the bullet with: `Installing hooks never creates a config: with none, the install is refused, and unless the app is attached the agent is restarted to write one. With one, the app first asks the agent on the port whether it holds the config's token, a \`POST /ingest/status\` with the token and an empty body: a 401 while attached means that agent runs from another \`CLAWD_HOME\` and the install is refused; a 401 from the app's own agent means the config was recreated under it, and the agent is restarted before the hooks are written (stage 8).`

3. §5, after the Faults paragraph, add a paragraph: `` `settled()` resolves once the first start has left `starting`, or the host was stopped. The launch repair (§8) waits for it, since that start is what writes `config.json` when there is none. ``

4. §6, add a bullet at the end: `` - `AgentOptions.devOrigins?: boolean`, default true. False leaves `http://localhost:3000` and `http://127.0.0.1:3000` out of the built-in origins; the packaged desktop app passes false, since a teammate's machine has no dev server of ours and whatever else listens on port 3000 there should not read the stream. A config that lists one of them in `corsOrigins` still gets it (stage 8). ``

5. §7. In the scheme-handler bullet, after `refuses \`..\` and absolute paths,` add `and any segment whose name before the first dot is a Windows device (\`CON\`, \`NUL\`, \`COM1\`…), which Windows 10 would open as one,`; at the end of that bullet add `A path that looks like a page and is not there is answered with the export's \`404.html\` when it has one. The handler never rejects: a port getter that throws falls back to the default port, and a read that fails is a 404. Both hosts come from one table, looked up once per request; a host that is neither gets the settings page's policy, the strictest.` In the CSP bullet change `connect-src http://127.0.0.1:<port> http://localhost:<port>` to `connect-src 'self' http://127.0.0.1:<port> http://localhost:<port>` and add at its end `\`'self'\` lets a page that navigates on the client fetch its own payloads.` In the first bullet, after `Bounds persist in` … `(§10).` add `They are restored when enough of the title strip shows on the displays there are now, counted across a seam between two of them, and made no larger than the work area holding most of the window; the maximised state is kept too (stage 8).`

6. §8, the bullet beginning `On launch, \`hooks.ts\` reads the settings file.` Change its opening to `Once the host's first start has settled, \`launchRepair()\` in \`hooks.ts\` reads the settings file. It waits because that start writes \`config.json\` when there is none, and hooks left from before then carry the old token, which only a status read after the write sees as stale.`

7. §9. Change `type ClawdSettingsApi = {` to `type SettingsApi = {` and add after the code block: `` `SettingsApi` lives in the import-free `settings/state.ts`; the preload's literal `satisfies` it, the page declares `window.clawd` with it, and main's actions are `Omit<SettingsApi, "onState">`, so the bridge is spelled once (stage 8). ``. Replace the paragraph's last two sentences, from `The page shows the notice in a permanent` to `not yet checked with one.`, with: `The page shows the notice in a live region that is always rendered: \`page.html\` holds an empty \`<div id="notice-region" role="status">\` above the sections, and \`render\` puts the styled paragraph inside it and takes it out, replacing it only when the text changes or the user's own action earns the same sentence again, so a push that carries an old notice is not read out twice. The page is built once and patched after that: text, \`hidden\` and \`checked\` are set in place, only the folder list is rebuilt, and only when it changes (stage 8).`

8. §10. In the tray bullet, change `in those states` to `in those states, or \`· agent attached, refuses this app\``. In the login bullet, after `read \`getLoginItemSettings()\`.` add `They show off when Windows has the entry but the user has switched it off in Task Manager's startup list, which Electron reports per entry in \`launchItems\`; when Electron reports no entry of ours, which stage 6 saw for the packaged exe, they go by \`openAtLogin\` as before, and each launch logs what Electron said as \`desktop.loginItem\`. A \`desktop.json\` that exists but could not be read is never written over, and the first-run enable is skipped, since a stored choice of off may be in it (stage 8).` In the logs bullet's list of codes add, before `\`desktop.stopTimedOut\``: `\`desktop.attachedRefused\` (attached to an agent that refuses this app's origin), \`desktop.stateUnreadable\` and \`desktop.stateWriteFailed\` (the state file), \`desktop.loginItem\` (what Electron reports of the login item at launch: numbers and booleans),`.

9. §4, item 4. After `and calls \`app.exit(0)\`.` add `The tray icon is taken away in \`will-quit\`, when the quit is certain, not in \`before-quit\`, which a page could still cancel.`

10. §11. In the electron-builder bullet change `fuses \`runAsNode: true\`, \`enableCookieEncryption: true\`, \`onlyLoadAppFromAsar: true\`` to `fuses \`runAsNode: true\`, \`enableCookieEncryption: true\`, \`onlyLoadAppFromAsar: true\`, \`enableNodeOptionsEnvironmentVariable: false\`, \`enableNodeCliInspectArguments: false\``, and after `\`dist/renderer/\` and \`dist/settings/\`, without source maps;` add `the settings directory carries the latin JetBrains Mono at 400 and 700 with its licence, copied from a dev dependency by the bundle step;`.

11. §13, first bullet: add at its end `` `settings/page` under happy-dom with a stub bridge; `reveal`; `hooks`' launch repair over doubles. ``

12. §12, the stage 8 row stays as it is.

- [ ] **Step 2: The design's §12.1: every item closed**

Append to each §12.1 item named below the sentence given, at the end of the item, in the item's own paragraph. Where an item already ends with a stage 7 note that points at stage 8, append after it.

Found in the reviews of stage 3:
- **Attaching to an agent that refuses the page.** `Done in stage 8: the probe carries the app's origin, the agent's own 403 reads as refused, the host attaches and says so, and the README's warning went.`
- **Windows device names in `app://` paths.** `Done in stage 8.`
- **One source for the agent's port.** `Dropped in stage 8: no stage lets the port vary and the settings window has no port control. A test pins core's \`DEFAULT_AGENT_URL\` to the agent's \`DEFAULT_PORT\`, and the desktop README says that a port edited by hand in \`config.json\` leaves the page simulated.`
- **`connect-src 'self'`.** `Done in stage 8, ahead of the change that needs it, so that change does not meet a silent failure.`
- **A handler that can reject.** `Done in stage 8.`
- **The 404 body.** `Done in stage 8: \`404.html\`, for paths that look like a page, on the visualiser's host.`
- **`args.ts` depends on `scheme.ts`.** `Done in stage 8: the export's URL is passed in, and a test reads the file for imports.`
- **The built-in `http://localhost:3000` origin.** `Done in stage 8, decided 21 September 2026: \`startAgent\` takes \`devOrigins\`, the packaged app passes false, and the CLI and a development run keep the origins. No config field.`
- **zod's eval probe.** `Dropped in stage 8, and noted as expected in the desktop README: zod probes when core's schemas are built, at import, so a \`jitless\` call would have to run before any import of core, an order no test can pin, and it would put desktop-specific code in the web app.`

Found in the reviews of stage 4:
- **An unreadable `desktop.json`.** `Done in stage 8.`
- **Restored bounds.** `Done in stage 8: clamped to the work area holding most of the window, the maximised state kept, and a strip across a seam counted.`
- **The Start on login checkbox and Task Manager.** `Done in stage 8: an entry of ours that Electron reports as disabled shows as off; when it reports none, \`openAtLogin\` decides as before, and \`desktop.loginItem\` logs what Electron said at each launch.`
- **Ctrl+Q on other keyboard layouts.** `Done in stage 8, narrower than written: the physical key counts only when the typed key is outside ASCII, since on AZERTY the physical Q key types \`a\` and Ctrl+A must stay select-all.`
- **Tearing the tray down before a quit is certain.** `Done in stage 8.`

Found in the reviews of stage 5:
- **A restart the user asked for clears the fault budget.** `Kept in stage 8: still deliberate. The settings actions are still its only callers, now also from an install that finds the agent's token out of date or its config gone, each a click.`
- **The settings window does not get the app's font.** `Done in stage 8, decided 21 September 2026: shipped beside the page from the dev dependency \`@fontsource/jetbrains-mono\`.`
- **The preload carries the validation library.** `Done in stage 8: the channel names have a module of their own, and the bundle step fails if the preload passes 20 kB.`

Found in the overall review at stage 5:
- **An install from the app can mint a token the serving agent lacks.** `Done in stage 8: the install never creates a config, and asks the serving agent about the token first.`
- **The settings page rebuilds itself on every push.** `Done in stage 8.`
- **The bridge is typed by hand in three places.** `Done in stage 8.`
- **Two copies of the window hardening and of show-or-create.** `Done in stage 8: \`createHardenedWindow\` and \`showOrCreate\`.`
- **Two host tables in `scheme.ts`.** `Done in stage 8.`

Found in the final review of stage 6:
- **Two fuses the app does not need are still on.** `Done in stage 8: both off, and the smoke run shows the exe still runs as Node.` (If Task 10 had to keep one on, say which and why instead.)

Found in the final review of stage 6.1:
- **A restarted poller logs a false failure.** `Done in stage 8: each stop raises a generation, and a run or loop from an earlier one is over.`
- **`taskkill` is found by searching.** `Done in stage 8, at both sites.`
- **An output overflow still ends only the shell.** `Done in stage 8: a spawn-based runner with its own cap.`
- **The real-process `nodeExec` tests abort at 300 ms.** `Done in stage 8.`
- **The smoke's kill fallback can hang.** `Done in stage 8.`
- **A CLI call can outlive an app that exits on its own.** `Dropped in stage 8: the children of an app that has already exited are no longer its tree, and the cost is a scratch folder the script already warns about.`
- **The smoke still spells one log line.** `Done in stage 8.`

Found in stage 7's reviews:
- **The live region is a `hidden` node, outside the accessibility tree.** `Done in stage 8.`
- **The attached-without-a-config refusal cannot be reached.** `Done in stage 8.`
- **Nothing stops a config minted after attaching either.** `Done in stage 8.`
- **`applied()` reads the host's mode at the instant of the action.** `Done in stage 8: a change made between agents is judged by the next push that finds the host settled.`
- **The launch repair is decided while the host's first start may still be creating `config.json`.** `Done in stage 8.`
- **`hookCommand` and `statusCommand` have no consumer, and `main.ts` repeats a guard.** `Done in stage 8: \`launchRepair(deps)\`, and the two names left the agent's index.`

Asked for while stage 5 was finishing:
- **A wait nobody answers should stop being shown.** `Done in stage 8. One reading was settled: past the limit the session is hidden whatever its prompt count, which a literal fall-through to the existing rules would not do for a session with more than eight prompts.`

Skipped when the settings page's choices became radio groups:
- **The settings page is no longer only glue, and nothing tests it.** `Done in stage 8: happy-dom, and \`settings/page.test.ts\` over a stub bridge.`

Then add, after the paragraph beginning `Stage 8 takes what remains`, a new paragraph:

```markdown
Stage 8 closed the list (21 September 2026). Dropped, each with its reason beside the item: one
source for the agent's port, zod's eval probe, and a CLI call that outlives an app that exits on its
own during the smoke. Kept as it is: the restart that clears the fault budget. Everything else in
§12.1 is done. Nothing here is open.
```

Check the claim: run `git grep -n "stage 8" -- docs/superpowers/specs/2026-09-14-desktop-app-design.md` and read every hit; none may still describe work to come, apart from the historical `Stage 8 takes what remains` paragraph and the stage 7 notes that the appended sentences now answer.

- [ ] **Step 3: The visibility rule and the PRD**

In `docs/superpowers/specs/2026-09-13-session-visibility-design.md`, §2's table, replace the row `| Working or waiting | Always |` with:

```markdown
| Working | Always |
| Waiting | Until it has waited 36 hours (`waitingHideMs`), measured from when the wait began; it stays `waiting` in the fleet, so an answer brings it back at once (desktop stage 8) |
```

In `docs/PRD.md`:

1. FR-7a: replace `Working and waiting sessions are always shown.` with `A working session is always shown, and a waiting one until it has waited 36 hours, after which it is hidden until it is answered.`
2. The M8 row: replace `The Electron app in six stages, one Electron idea each: the window, the agent inside, the packaged UI over \`app://\`, the tray, the settings window, the package.` with `The Electron app in six stages, one Electron idea each: the window, the agent inside, the packaged UI over \`app://\`, the tray, the settings window, the package; then the review fixes (6.1) and two hardening stages (7 and 8) that closed the design's §12.1.`
3. Add three rows at the end of the decision log, with the date you are writing on if it is later than 21 Sep 2026 only where the decision was made later; these three were made on 21 Sep 2026:

```markdown
| 21 Sep 2026 | The packaged desktop app's agent does not accept the dev server's origins (`http://localhost:3000`, `http://127.0.0.1:3000`); the CLI and a development run still do. An option on `startAgent`, not a config field. |
| 21 Sep 2026 | A session that has waited 36 hours for an answer leaves the view, whatever its prompt count, and returns the moment it is answered; it stays `waiting` in the fleet. |
| 21 Sep 2026 | The settings window ships JetBrains Mono from a dev dependency, copied at bundle time; no font binary is checked in. |
```

- [ ] **Step 4: The READMEs**

In `apps/agent/README.md`, replace the sentence beginning `Browsers may call these only from a built-in origin` (three lines, ending `need the token from \`config.json\`.`) with:

```markdown
Browsers may call these only from a built-in origin (`http://localhost:3000`, `http://127.0.0.1:3000`
and the desktop app's `app://clawd`) or one added to `corsOrigins`. A host can leave the two dev
server origins out with `startAgent({ devOrigins: false })`, which the packaged desktop app does.
`/ingest/hook` and `/ingest/status` are for the hook scripts and need the token from `config.json`.
```

In `apps/desktop/README.md`:

1. In the Run section, replace the paragraph beginning `The export talks to the agent at \`http://127.0.0.1:4750\`` with:

```markdown
The export talks to the agent at `http://127.0.0.1:4750`, unless `NEXT_PUBLIC_AGENT_URL` was set
when it was built. No stage lets the port vary: a `port` edited by hand in `config.json` moves the
agent, and the page, which still asks 4750, stays simulated. An agent started before stage 3, such
as a CLI agent left running from earlier, does not know the `app://clawd` origin and refuses the
page: the app attaches to it, and the title, the tray and Settings say `agent attached, refuses this
app`. Stop that agent and the app starts its own. DevTools' console shows one `unsafe-eval`
Content Security Policy report per page load. It is expected and harmless: zod tests whether it may
compile its parsers, is told no, and carries on without.
```

2. Append after the stage 7 note:

```markdown
### Stage 8: hardening, the second half

Nothing new in Electron. Every item the reviews left in the design's §12.1 is done, or dropped with
its reason written beside it.

**The page is built once.** Main pushes a state whenever a session changes, and the settings page
used to rebuild itself each time, which dropped a button's busy guard, reset a radio mid-request and
wiped a text selection. It now patches text, `hidden` and `checked` in place and rebuilds only the
folder list, when the list changes. The notice sits in a `role="status"` container that is always
rendered, so a screen reader hears the first one. `settings/page.test.ts` runs the real page under
happy-dom over a stub bridge. The bridge is typed once, as `SettingsApi` in `settings/state.ts`; the
preload takes the channel names from an import-free module and fell from about 750 kB to a few; the
window has its font, copied beside the page from `@fontsource/jetbrains-mono`.

**The install asks first.** Install hooks never creates a config. With one, the app asks the agent on
the port whether it holds the config's token, the way a hook would. Attached to an agent that
answers 401, one started from another `CLAWD_HOME`, nothing is written and the page says why. When
the app's own agent answers 401, the config was recreated under it: the agent is restarted and the
hooks are then written. The launch repair is a tested function, and runs once the agent's first
start has settled, so a token that start created is seen on the same launch.

**The shell.** A `desktop.json` that exists but cannot be read is left alone for the run, and the
first-run login item is skipped. Bounds saved on a larger display are clamped to the one holding
most of the window, a title strip across the seam of two displays counts, and the maximised state is
kept. Ctrl+Q also works on a layout with no Latin letters, by the physical key, and only there, since
on AZERTY that key types `a`. The tray icon goes in `will-quit`, when the quit is certain. The Start
on login control shows off when the entry is switched off in Task Manager, if Electron reports the
entry; each launch logs what it reported as `desktop.loginItem`.

**The scheme.** One table for the two hosts, a handler that cannot reject, Windows device names
refused, the export's `404.html` for a missing page, and `connect-src 'self'`.

**The agent.** The packaged app's agent no longer accepts `http://localhost:3000`. The presence
poller survives a stop followed at once by a start, and its command runner ends the whole process
tree on overflow as well as on a timeout or an abort, with `taskkill` called by its full path. A
session that has waited 36 hours for an answer leaves the view until it is answered.
```

In the root `README.md`, add to the Credits list:

```markdown
- The desktop app's settings window ships **JetBrains Mono** (SIL Open Font License 1.1), by JetBrains,
  taken at build time from the `@fontsource/jetbrains-mono` package.
```

- [ ] **Step 5: Run every check and commit the documents**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md docs/superpowers/specs/2026-09-13-session-visibility-design.md docs/PRD.md apps/desktop/README.md apps/agent/README.md README.md
git commit -m "docs: the design closes every item in its hardening list, done or dropped with a reason, and the PRD and the READMEs record stage 8's decisions"
```

- [ ] **Step 6: Walk the checklist (pause here for the maintainer)**

Package first (`pnpm --filter @clawd/desktop package`), then use scratch folders as stage 7's checklist did:

```
$env:CLAWD_HOME = "$env:TEMP\clawd-stage8"
$env:CLAUDE_CONFIG_DIR = "$env:TEMP\clawd-stage8-claude"
New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null
Expand-Archive apps\desktop\release\Clawd-Visualiser-0.1.0-win-x64.zip "$env:USERPROFILE\Apps\Clawd Visualiser"
& "$env:USERPROFILE\Apps\Clawd Visualiser\Clawd Visualiser.exe"
```

Stop any CLI agent and any development run first. Check each:

- **The font and the page.** Settings is in JetBrains Mono. Select some text and leave it for ten seconds with a session running: the selection stays. Arrow keys move a Detail level choice and focus stays on it.
- **The first notice is heard.** With Narrator on and Settings freshly opened, add `C:\` as a folder: Narrator reads the refusal. Do it again: it reads it again.
- **The dev origins are gone.** With the packaged app running: `curl.exe -s -o NUL -w "%{http_code}" -H "Origin: http://localhost:3000" http://127.0.0.1:4750/api/health` prints `403`, and the same with `Origin: app://clawd` prints `200`.
- **The page may fetch its own files, and a device name is refused.** In the visualiser window's DevTools console: `(await fetch("/CON.txt")).status` is `404`, at once, with no CSP error.
- **Install with the config gone.** Install the hooks. Delete `$env:CLAWD_HOME\config.json` while the app runs. Settings, Reinstall hooks: the notice says the config was missing and to install again. Reinstall again: no notice, and a Claude Code session started with the scratch variables set shows its Clawd.
- **A recreated token is repaired on the same launch.** Quit. Delete `config.json`, leave the settings file. Launch: the log gains `desktop.hooksRepaired`, on this launch and not the next.
- **Attached to an agent from another home.** Start the CLI agent with a different `CLAWD_HOME` (`$env:CLAWD_HOME = "$env:TEMP\clawd-other"; pnpm --filter @clawd/agent start` in another terminal), then launch the app with its own scratch home: the tray says attached. Install hooks: the notice says that agent was started from another home, and the settings file is unchanged. Stop the CLI agent; the app takes over, and Install hooks then works.
- **The window.** Maximise, quit from the tray, launch: maximised, and restoring gives the earlier size. The tray icon stays until the window has gone.
- **Task Manager.** With Start on login on, switch Clawd Visualiser off in Task Manager's Startup apps, then open the tray menu: Start on login is unticked. If it is still ticked, read the newest `desktop.loginItem` line: `items: 0` means Electron does not report the entry for this path, which §12.1 allows for; record which it was. Tick it in the app: Task Manager shows it enabled again.
- **The fuses**, if Task 10 could not read them: `pnpm dlx @electron/fuses read --app "apps\desktop\release\win-unpacked\Clawd Visualiser.exe"`.
- Delete the scratch folders and the unzipped folder, and remove `Env:CLAWD_HOME` and `Env:CLAUDE_CONFIG_DIR`.

Not walked by hand, because tests cover them and the real thing takes too long or another machine: the 36-hour wait, an unreadable `desktop.json`, a smaller display, a Cyrillic layout, a pre-stage-3 agent, Windows 10's devices.

- [ ] **Step 7: Record the checks and hand the branch back**

In §12.1, after the `Stage 6's remaining checks and stage 7's: done.` item, add an item with the real date and what was actually seen, in the manner of the items above it:

```markdown
- **Stage 8's manual checks: done.** On <date> the maintainer walked them: <what was seen, one
  clause each, including what Task Manager's switch did to the control and what `desktop.loginItem`
  logged>.
```

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md
git commit -m "docs: stage 8's checks are done"
```

Then hand the branch back with the finishing-a-development-branch skill. The maintainer merges from `C:\mw\visualiser`:

```bash
git merge --no-ff feat/desktop-stage-8 -m "Merge branch 'feat/desktop-stage-8' (desktop stage 8: hardening, the second half)"
```

Stage 8 is the last row of §12. Nothing follows it in this design.
