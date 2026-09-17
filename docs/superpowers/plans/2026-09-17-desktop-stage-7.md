# Desktop Stage 7 (Hardening I: the hooks, the install, the bridge, and what development leaves behind) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The settings window and the installer stop losing events and stop lying: the hook check compares everything an install writes, an update refreshes the scripts, an unreadable file says so, a refusal and a failed agent's reason reach the page, a change while attached says it was not applied, the install never leaves the config half-changed, and development runs leave nothing behind for the packaged app to trip over.

**Architecture:** The agent's installer saves the config once, inside `installHooks`, and gains result-returning cores for uninstall and the detail level. `hookStatus` compares the whole set an install would write, and the desktop's `hooks.ts` adds the scripts check and the `unreadable` classification. The settings actions move out of `main.ts` into `settings/actions.ts`, a tested module over injected doubles, and the bridge's state gains a `notice` and the agent's `error`. Stage 6.1 has already closed the stage 6 review's items, so this stage builds on version 2 of `desktop.json` and a smoke script with its own profile.

**Tech Stack:** Electron 44, electron-builder 26, esbuild 0.28, zod 4, vitest 5, TypeScript 5.9, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, §5, §8, §9, §11, and these §12.1 items: from stage 5's review the settings actions in untested glue, the status line removed by hand, the hook check ignoring port and token, the bridge unable to say an action was refused, the failed agent's reason; from the 17 September overall review attached mode, unreadable config or settings, `install()` saving before the hooks, the minted token, the double config read, the double login build, the CLI-shaped uninstall, the detail default; from stage 6's final review the update not refreshing the scripts, the icon byte check, the smoke answered by another agent. The 17 September review of stage 6's merge is stage 6.1's, done before this stage. Everything else in §12.1 is stage 8's (Task 4 lists it).

**Stage idea:** none new in Electron. This is the first half of the post-dev hardening row: the items where the app loses events, misleads the user, or corrupts its own state. The second half, the page's rendering and tests, the shell's edge cases and the scheme, is stage 8.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere; a test may spell Windows paths.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first. After this stage the settings actions are such a module.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The desktop package has no runtime dependencies. No dependency is added this stage.
- The bridge's list of calls does not grow. Its state gains two fields, `notice: string | null` and `agent.error: string | null`, and the hook status gains `unreadable`.
- `stale` means: hooks of ours are present and any part of what an install would write now differs, including the http hooks' port and token, a status line removed by hand, and a script in `~/.clawd/bin` that differs from the one shipped. The packaged app repairs all of it at launch; a development run shows it and offers Reinstall. This settles the two §12.1 items on what stale should mean.
- `unreadable` means: the config file exists but cannot be used, or the settings file exists but is not a JSON object. The page says so and offers no buttons.
- A saved config change is applied by restarting the agent the app owns. While attached to another agent, the change is saved, not applied, logged as `desktop.attachedChange`, and the page says the attached agent must be restarted.
- Installing hooks from the app while attached and without a config of its own is refused: the hooks would carry a token the other agent does not hold.
- `install()` validates the settings file, copies the scripts, then saves the config and writes the settings file, in that order, in one `installHooks` call; a failure before the save leaves the config untouched. An install whose settings content would not change writes no backup and no file.
- Log lines carry a time, a code and numbers or booleans only. New code this stage: `desktop.attachedChange`. Notices shown on the page are never logged.
- Automated checks never run the packaged app against the real `~/.clawd` or `~/.claude`: the smoke script uses scratch folders and its own profile directory.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-7` in the worktree `C:\mw\visualiser-desktop`, cut from `main` once stage 6.1 is merged. That worktree will have `feat/desktop-stage-6.1` checked out, merged by then: `git -C C:mwisualiser-desktop checkout -b feat/desktop-stage-7 main`. Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app or the packager.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/agent/src/install/installer.ts` | `installHooks` saves once, after the scripts; `uninstallHooks` returns a result; `install` and `uninstall` print. |
| `apps/agent/src/install/settings.ts` | `hookStatus` compares the whole set; `unreadable` joins `HookStatus`. |
| `apps/agent/src/detail.ts` | `saveDetail` core; `setDetail` prints. |
| `apps/agent/src/index.ts` | Exports `uninstallHooks`, `saveDetail`, `detailLevel`, `isJsonObject`. |
| `apps/agent/src/log.ts` | `desktop.attachedChange` joins the closed set. |
| `apps/desktop/src/hooks.ts` | `readConfigState`, `scriptsMatch`, `currentHookStatus`. |
| `apps/desktop/src/settings/actions.ts` | `createSettingsActions(deps)`: the rules, with notices. |
| `apps/desktop/src/settings/state.ts`, `settings-state.ts` | `notice` and `agent.error`; `unreadable`. |
| `apps/desktop/src/settings/page.ts`, `page.css` | Renders the notice, the reason, the unreadable status. |
| `apps/desktop/src/main.ts` | Wiring only: the deps for the actions. |
| `docs/superpowers/specs/2026-09-14-desktop-app-design.md` | The decisions, the done items, the stage 8 list. |
| `apps/desktop/README.md`, `README.md` | The stage 7 note; the update sentence. |

---

### Task 1: The installer saves once, and uninstall and the detail level return results

**Files:**
- Modify: `apps/agent/src/install/installer.ts`
- Modify: `apps/agent/src/detail.ts`
- Modify: `apps/agent/src/index.ts`
- Test: `apps/agent/src/install/installer.test.ts`, create `apps/agent/src/detail.test.ts`

**Interfaces:**
- Produces, from `@clawd/agent`: `installHooks(req: HooksRequest)` where `HooksRequest` gains `allowlist?: readonly string[]` and `HooksResult` loses `allowlist`; `uninstallHooks(req: { home: string; settingsPath: string; now: () => number }): Promise<UninstallResult>` with `UninstallResult = { ok: true; outcome: "missing" | "nothing" | "removed"; backup: string | null } | { ok: false; reason: "invalid" } | { ok: false; reason: "shape"; at: string }`; `saveDetail(req: { home: string; level: DetailLevel }): Promise<void>`; `detailLevel(config: Pick<AgentConfig, "detail">): DetailLevel`; `isJsonObject(value: unknown): value is JsonObject`. `install`, `uninstall` and `setDetail` keep their signatures and their printed lines.

- [ ] **Step 1: Write the failing tests**

In `apps/agent/src/install/installer.test.ts`, add `uninstallHooks` to the import from `./installer`, and add `rm` to the import from `node:fs/promises`. Replace the test `keeps an existing token and gives each backup its own name` with:

```ts
  it("keeps an existing token, writes no backup when nothing would change, and gives each real backup its own name", async () => {
    const t = await setup("{}");
    const existing = { ...defaultConfig("f".repeat(64)), allowlist: [join(t.root, "work")] };
    await saveConfig(agentPaths(t.home), existing);
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    const first = await readFile(t.settingsPath, "utf8");
    expect(first).toContain("f".repeat(64));
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    expect(await readFile(t.settingsPath, "utf8")).toBe(first);
    expect((await readdir(dirname(t.settingsPath))).sort()).toEqual(["settings.json", "settings.json.clawd-backup-20260912100000"]);
    // A hand edit makes the next install write again, and its backup takes the next free name.
    await writeFile(t.settingsPath, first.replace("{\n", '{\n  "model": "opus",\n'));
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    expect((await readdir(dirname(t.settingsPath))).sort()).toEqual([
      "settings.json",
      "settings.json.clawd-backup-20260912100000",
      "settings.json.clawd-backup-20260912100000-2",
    ]);
  });

  it("copies the scripts before it saves anything, so a copy that fails leaves the config and the settings file untouched", async () => {
    const t = await setup("{}");
    const partial = join(t.root, "partial-hooks");
    await mkdir(partial);
    await writeFile(join(partial, "clawd-lib.mjs"), "");
    await expect(install({ ...t.base, hooksDir: partial, allow: ["work"], dryRun: false })).rejects.toThrow();
    expect(await readConfig(agentPaths(t.home))).toBeNull();
    expect(await readFile(t.settingsPath, "utf8")).toBe("{}");
  });

  it("saves the allowlist it is given with the hooks, in one call", async () => {
    const t = await setup();
    const allowed = join(t.root, "work");
    const hooks = await installHooks({ home: t.home, settingsPath: t.settingsPath, runtime: nodeRuntime("C:\\node.exe"), hooksDir: HOOKS, allowlist: [allowed], now: () => NOW });
    expect(hooks.ok).toBe(true);
    expect((await readConfig(agentPaths(t.home)))?.allowlist).toEqual([allowed]);
  });
```

Replace the two `uninstall` tests at the end of the describe with:

```ts
  it("uninstall restores the original settings and forgets the wrapped status line", async () => {
    const original = { env: { A: "1" }, statusLine: { type: "command", command: "mine.sh" } };
    const t = await setup(JSON.stringify(original));
    await install({ ...t.base, allow: ["work"], dryRun: false });
    const result = await uninstallHooks({ home: t.home, settingsPath: t.settingsPath, now: () => NOW + 1_000 });
    expect(result).toEqual({ ok: true, outcome: "removed", backup: `${t.settingsPath}.clawd-backup-20260912100001` });
    expect(await readJson(t.settingsPath)).toEqual(original);
    expect((await readConfig(agentPaths(t.home)))?.wrappedStatusLine).toBeUndefined();
    expect(existsSync(t.home)).toBe(true);
  });

  it("uninstall says what it found: no file, nothing of ours, a file it cannot use", async () => {
    const missing = await setup();
    expect(await uninstallHooks({ home: missing.home, settingsPath: missing.settingsPath, now: () => NOW })).toEqual({ ok: true, outcome: "missing", backup: null });
    const clean = await setup('{"model":"opus"}');
    expect(await uninstallHooks({ home: clean.home, settingsPath: clean.settingsPath, now: () => NOW })).toEqual({ ok: true, outcome: "nothing", backup: null });
    expect(await readdir(dirname(clean.settingsPath))).toEqual(["settings.json"]);
    const invalid = await setup("[1, 2]");
    expect(await uninstallHooks({ home: invalid.home, settingsPath: invalid.settingsPath, now: () => NOW })).toEqual({ ok: false, reason: "invalid" });
    const shape = await setup('{"hooks": []}');
    expect(await uninstallHooks({ home: shape.home, settingsPath: shape.settingsPath, now: () => NOW })).toEqual({ ok: false, reason: "shape", at: "hooks" });
  });

  it("the CLI's uninstall prints the outcome and keeps its exit codes", async () => {
    const clean = await setup('{"model":"opus"}');
    expect(await uninstall({ home: clean.home, settingsPath: clean.settingsPath, now: () => NOW, print: clean.base.print })).toBe(0);
    expect(clean.lines.join("\n")).toContain("nothing was changed");
    const invalid = await setup("[1, 2]");
    expect(await uninstall({ home: invalid.home, settingsPath: invalid.settingsPath, now: () => NOW, print: invalid.base.print })).toBe(1);
    expect(invalid.lines.join("\n")).toContain("not a JSON object");
  });
```

Create `apps/agent/src/detail.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentPaths, readConfig } from "./config";
import { saveDetail, setDetail } from "./detail";
import { useTempDirs } from "./testing/tmp";

describe("saveDetail", () => {
  const tempDir = useTempDirs();

  it("writes the level, creating the config with defaults when there is none, and keeps the rest", async () => {
    const home = join(await tempDir(), "clawd");
    await saveDetail({ home, level: "paths" });
    const created = await readConfig(agentPaths(home));
    expect(created?.detail).toBe("paths");
    expect(created?.token).toMatch(/^[0-9a-f]{64}$/);
    await saveDetail({ home, level: "none" });
    const again = await readConfig(agentPaths(home));
    expect(again?.detail).toBe("none");
    expect(again?.token).toBe(created?.token);
  });

  it("the CLI's setDetail saves and says so", async () => {
    const home = join(await tempDir(), "clawd");
    const lines: string[] = [];
    expect(await setDetail({ home, level: "hints", print: (line) => lines.push(line) })).toBe(0);
    expect((await readConfig(agentPaths(home)))?.detail).toBe("hints");
    expect(lines.join("\n")).toContain("hints");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/install/installer.test.ts src/detail.test.ts`
Expected: FAIL. `uninstallHooks` and `saveDetail` are not exported; the second install still writes a backup; the partial copy leaves a saved config.

- [ ] **Step 3: Write the installer changes**

In `apps/agent/src/install/installer.ts`, replace everything from `export type HooksRequest = {` to the end of `install()` with:

```ts
export type HooksRequest = {
  home: string;
  settingsPath: string;
  /** The command prefix the written hooks run: a Node path, or the desktop's Electron prefix. */
  runtime: string;
  /** Where the hook scripts are copied from: apps/agent/hooks, or the app's resources/hooks. */
  hooksDir: string;
  port?: number;
  /** An allowlist to save with the port, when the caller has merged one; otherwise the config's stays. */
  allowlist?: readonly string[];
  dryRun?: boolean;
  now: () => number;
};
export type HooksResult = { ok: true; statusLine: InstallResult["statusLine"]; events: readonly string[]; backup: string | null; port: number } | { ok: false; message: string };

/**
 * Validates the settings file, copies the scripts to `<home>/bin`, saves the config, then writes the
 * settings file with a backup of what was there. In that order: a settings file that cannot be used
 * changes nothing, and a copy that fails leaves the config as it was. The config is saved before the
 * settings file so the token the new hooks carry is on disk before they exist. A settings file that
 * already holds exactly what would be written is left alone, with no backup.
 */
export async function installHooks(req: HooksRequest): Promise<HooksResult> {
  const paths = agentPaths(req.home);
  const base: AgentConfig = (await readConfig(paths)) ?? defaultConfig();
  const port = req.port ?? base.port;
  const read = await readSettings(req.settingsPath);
  if (read.kind === "invalid") return { ok: false, message: `${req.settingsPath} is not a JSON object; nothing was changed` };
  let result: InstallResult;
  try {
    result = applyInstall(read.kind === "ok" ? read.value : {}, { port, token: base.token, binDir: paths.bin, runtime: req.runtime });
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    return { ok: false, message: `${req.settingsPath} has an unexpected shape at ${err.message}; nothing was changed` };
  }
  if (req.dryRun === true) return { ok: true, statusLine: result.statusLine, events: result.events, backup: null, port };

  await mkdir(paths.bin, { recursive: true });
  for (const script of HOOK_SCRIPTS) await copyFile(join(req.hooksDir, script), join(paths.bin, script));
  const wrapped = result.statusLine === "wrapped" ? result.newlyWrapped : result.statusLine === "kept" ? base.wrappedStatusLine : undefined;
  const { wrappedStatusLine: _wrapped, ...baseWithoutWrapped } = base;
  await saveConfig(paths, { ...baseWithoutWrapped, port, allowlist: req.allowlist === undefined ? base.allowlist : [...req.allowlist], ...(wrapped ? { wrappedStatusLine: wrapped } : {}) });
  const unchanged = read.kind === "ok" && JSON.stringify(read.value) === JSON.stringify(result.settings);
  if (unchanged) return { ok: true, statusLine: result.statusLine, events: result.events, backup: null, port };
  const saved = read.kind === "ok" ? await backup(req.settingsPath, req.now()) : null;
  await writeJsonAtomic(req.settingsPath, result.settings);
  return { ok: true, statusLine: result.statusLine, events: result.events, backup: saved, port };
}

/** The CLI's install: the allowlist merged, then one installHooks call, then the report the user reads. */
export async function install(req: InstallRequest): Promise<number> {
  // The command, unlike setAllowlist, insists on at least one folder: an empty --allow with an empty
  // (or absent) config means the user named nothing to watch.
  const existing = (await readConfig(agentPaths(req.home)))?.allowlist ?? [];
  const merged = mergeAllowlist(existing, req.allow, req.cwd);
  if (!merged.ok) {
    req.print(merged.message);
    return 1;
  }
  const hooks = await installHooks({
    home: req.home,
    settingsPath: req.settingsPath,
    runtime: req.runtime,
    hooksDir: req.hooksDir,
    ...(req.port === undefined ? {} : { port: req.port }),
    allowlist: merged.allowlist,
    dryRun: req.dryRun,
    now: req.now,
  });
  if (!hooks.ok) {
    req.print(hooks.message);
    return 1;
  }
  if (req.dryRun) {
    req.print(`dry run: would add hooks to ${req.settingsPath} for ${hooks.events.join(", ")}`);
    req.print(`dry run: would ${STATUS_WORDS[hooks.statusLine]}`);
    req.print(`dry run: the allowlist would be ${merged.allowlist.join(", ")}`);
    return 0;
  }
  req.print(`installed the Clawd hooks into ${req.settingsPath}; ${STATUS_DONE[hooks.statusLine]}`);
  req.print(hooks.backup ? `backup of the previous settings: ${hooks.backup}` : "the settings already held these hooks, or there were none to back up");
  req.print(`allowlist: ${merged.allowlist.join(", ")}`);
  const running = await (req.probe ?? probeAgent)(hooks.port);
  req.print(running ? `an agent is running on port ${hooks.port}; restart it to pick up these changes` : "start the agent with: pnpm --filter @clawd/agent start");
  return 0;
}

export type UninstallRequest = { home: string; settingsPath: string; now: () => number };
export type UninstallResult =
  | { ok: true; outcome: "missing" | "nothing" | "removed"; backup: string | null }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "shape"; at: string };

/** Removes our hooks and puts a wrapped status line back. The result says what was found; nothing is printed. */
export async function uninstallHooks(req: UninstallRequest): Promise<UninstallResult> {
  const paths = agentPaths(req.home);
  const config = await readConfig(paths);
  const read = await readSettings(req.settingsPath);
  if (read.kind === "missing") return { ok: true, outcome: "missing", backup: null };
  if (read.kind === "invalid") return { ok: false, reason: "invalid" };
  let next: JsonObject;
  try {
    next = applyUninstall(read.value, config?.wrappedStatusLine);
  } catch (err) {
    if (!(err instanceof SettingsShapeError)) throw err;
    return { ok: false, reason: "shape", at: err.message };
  }
  if (JSON.stringify(next) === JSON.stringify(read.value)) return { ok: true, outcome: "nothing", backup: null };
  const saved = await backup(req.settingsPath, req.now());
  await writeJsonAtomic(req.settingsPath, next);
  if (config?.wrappedStatusLine) {
    const { wrappedStatusLine: _wrapped, ...rest } = config;
    await saveConfig(paths, rest);
  }
  return { ok: true, outcome: "removed", backup: saved };
}

/** The CLI's uninstall: the result above, printed. */
export async function uninstall(req: UninstallRequest & { print: Print }): Promise<number> {
  const result = await uninstallHooks(req);
  if (!result.ok) {
    req.print(result.reason === "invalid" ? `${req.settingsPath} is not a JSON object; nothing was changed` : `${req.settingsPath} has an unexpected shape at ${result.at}; nothing was changed`);
    return 1;
  }
  if (result.outcome === "missing") req.print(`${req.settingsPath} does not exist; nothing to uninstall`);
  else if (result.outcome === "nothing") req.print("no Clawd hooks or status line were found; nothing was changed");
  else {
    req.print(`removed the Clawd hooks from ${req.settingsPath}`);
    req.print(`backup of the previous settings: ${result.backup}`);
    req.print(`${agentPaths(req.home).home} was left in place`);
  }
  return 0;
}
```

Delete the old `UninstallRequest` type near the top of the file (the line beginning `export type UninstallRequest = { home: string; settingsPath: string; now: () => number; print: Print };`), since the new one replaces it. `setAllowlist` and `removeFromAllowlist` stay as they are.

Replace `apps/agent/src/detail.ts` with:

```ts
import type { DetailLevel } from "@clawd/core";
import { agentPaths, defaultConfig, readConfig, saveConfig } from "./config";
import type { Print } from "./install/installer";

/** Writes the detail level to config.json, creating the file with defaults when there is none. */
export async function saveDetail(req: { home: string; level: DetailLevel }): Promise<void> {
  const paths = agentPaths(req.home);
  const base = (await readConfig(paths)) ?? defaultConfig();
  await saveConfig(paths, { ...base, detail: req.level });
}

/** The CLI's detail command: saves, then says so. */
export async function setDetail(req: { home: string; level: DetailLevel; print: Print }): Promise<number> {
  await saveDetail(req);
  req.print(`detail level set to ${req.level}; restart the agent for it to take effect`);
  return 0;
}
```

In `apps/agent/src/index.ts`, change the three lines:

```ts
export { ConfigError, DEFAULT_PORT, agentPaths, defaultConfig, defaultHome, defaultSettingsPath, defaultTranscriptsDir, detailLevel, readConfig, saveConfig, type AgentConfig, type AgentPaths } from "./config";
export { saveDetail, setDetail } from "./detail";
export { install, installHooks, removeFromAllowlist, setAllowlist, uninstall, uninstallHooks, type AllowlistResult, type HooksResult, type UninstallResult } from "./install/installer";
export { HOOK_SCRIPTS, hookCommand, hookStatus, isJsonObject, nodeRuntime, statusCommand, type HookStatus, type InstallOptions, type JsonObject } from "./install/settings";
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd apps/agent && npx vitest run && pnpm typecheck`
Expected: PASS. The CLI tests still pass: `install`, `uninstall` and `setDetail` print what they printed. If `pnpm typecheck` complains that the desktop's `main.ts` reads `hooks.allowlist`, it does not; the desktop reads only `.ok`.

Run: `cd ../desktop && pnpm typecheck`
Expected: PASS, since the desktop's calls into the installer are unchanged in shape.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/install/installer.ts apps/agent/src/install/installer.test.ts apps/agent/src/detail.ts apps/agent/src/detail.test.ts apps/agent/src/index.ts
git commit -m "fix(agent): the install saves the config once, after the scripts, and uninstall and the detail level return results the desktop can read"
```

---

### Task 2: Hook status that tells the truth

**Files:**
- Modify: `apps/agent/src/install/settings.ts`
- Modify: `apps/desktop/src/hooks.ts`
- Modify: `apps/desktop/src/settings/state.ts`, `apps/desktop/src/settings/page.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: `apps/agent/src/install/settings.test.ts`, `apps/agent/src/install/installer.test.ts`, `apps/desktop/src/hooks.test.ts`

**Interfaces:**
- Produces: `HookStatus = "missing" | "current" | "stale" | "unreadable"`; `hookStatus(settings: JsonObject | null, opts: InstallOptions): HookStatus` (the second argument changes from the two commands to the install options, so the whole set is compared); in `hooks.ts`: `type ConfigRead = { kind: "ok"; config: AgentConfig } | { kind: "missing" } | { kind: "unreadable" }`, `readConfigState(paths: AgentPaths): Promise<ConfigRead>`, `scriptsMatch(hooksDir: string, binDir: string): Promise<boolean>`, `currentHookStatus(deps: { config: ConfigRead; settingsPath: string; runtime: string; binDir: string; hooksDir: string }): Promise<HookStatus>`. `expectedCommands` goes.

- [ ] **Step 1: Write the failing tests**

In `apps/agent/src/install/settings.test.ts`, replace the whole `describe("hookStatus", ...)` block with:

```ts
describe("hookStatus", () => {
  const opts: InstallOptions = { port: 4750, token: "a".repeat(64), binDir: "C:\\h\\bin", runtime: '"node"' };
  /** A settings file as an install with `opts` leaves it, beside a setting of the user's own. */
  const installed = (): JsonObject => applyInstall({ model: "opus" }, opts).settings;
  const edit = (settings: JsonObject, change: (s: JsonObject) => void): JsonObject => {
    const copy = JSON.parse(JSON.stringify(settings)) as JsonObject;
    change(copy);
    return copy;
  };

  it("is missing when nothing of ours is there", () => {
    expect(hookStatus(null, opts)).toBe("missing");
    expect(hookStatus({}, opts)).toBe("missing");
    expect(hookStatus({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other.mjs" }] }] } }, opts)).toBe("missing");
  });

  it("is current when every hook and the status line are what an install would write now", () => {
    expect(hookStatus(installed(), opts)).toBe("current");
  });

  it("is stale when the commands point elsewhere, as after the folder moved", () => {
    expect(hookStatus(installed(), { ...opts, runtime: '"D:/old/electron.exe"' })).toBe("stale");
  });

  it("is stale when the http hooks carry another port or another token", () => {
    expect(hookStatus(installed(), { ...opts, port: 4800 })).toBe("stale");
    expect(hookStatus(installed(), { ...opts, token: "b".repeat(64) })).toBe("stale");
  });

  it("is stale when part of the set was removed by hand: the status line, or one event's hook", () => {
    expect(hookStatus(edit(installed(), (s) => delete s.statusLine), opts)).toBe("stale");
    expect(hookStatus(edit(installed(), (s) => delete (s.hooks as JsonObject).Stop), opts)).toBe("stale");
  });

  it("ignores hooks that are not ours beside ours", () => {
    const withMine = edit(installed(), (s) => ((s.hooks as JsonObject).Stop as unknown[]).unshift({ hooks: [{ type: "command", command: "mine.sh" }] }));
    expect(hookStatus(withMine, opts)).toBe("current");
  });
});
```

Make sure `applyInstall` and `InstallOptions` are in that file's import from `./settings` (add them if not).

In `apps/agent/src/install/installer.test.ts`, in the test `sets the allowlist and installs the hooks separately, as the settings window does`, replace the two lines from `// Only the prefix and the bin directory shape the two commands.` to the `expect(hookStatus(...))` with:

```ts
    const config = await readConfig(agentPaths(t.home));
    expect(hookStatus(settings, { port: DEFAULT_PORT, token: config?.token ?? "", binDir: agentPaths(t.home).bin, runtime })).toBe("current");
```

and remove `hookCommand`, `statusCommand` and `InstallOptions` from that file's import of `./settings` if nothing else uses them.

Replace `apps/desktop/src/hooks.test.ts` with:

```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInstall, defaultConfig, type InstallOptions } from "@clawd/agent";
import { currentHookStatus, readConfigState, repairOnLaunch, runtimePrefix, scriptsMatch, type ConfigRead } from "./hooks";
import { agentPaths, saveConfig } from "@clawd/agent";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-hooks-"));
  made.push(dir);
  return dir;
}

const SCRIPTS = ["clawd-lib.mjs", "clawd-hook.mjs", "clawd-statusline.mjs"] as const;

/** A shipped hooks directory and a bin directory holding copies, with one script's text changed when asked. */
async function scriptDirs(root: string, differ?: (typeof SCRIPTS)[number]): Promise<{ hooksDir: string; binDir: string }> {
  const hooksDir = join(root, "shipped");
  const binDir = join(root, "bin");
  await mkdir(hooksDir);
  await mkdir(binDir);
  for (const script of SCRIPTS) {
    await writeFile(join(hooksDir, script), `// ${script} v2\n`);
    await writeFile(join(binDir, script), script === differ ? `// ${script} v1\n` : `// ${script} v2\n`);
  }
  return { hooksDir, binDir };
}

describe("runtimePrefix", () => {
  it("runs the app's own binary as Node, quoted, with forward slashes", () => {
    expect(runtimePrefix("C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe")).toBe('ELECTRON_RUN_AS_NODE=1 "C:/Apps/Clawd Visualiser/Clawd Visualiser.exe"');
  });
});

describe("repairOnLaunch", () => {
  it("rewrites only hooks of ours that differ, and only from the packaged app", () => {
    expect(repairOnLaunch("stale", true)).toBe(true);
    expect(repairOnLaunch("current", true)).toBe(false);
    expect(repairOnLaunch("missing", true)).toBe(false);
    expect(repairOnLaunch("unreadable", true)).toBe(false);
    expect(repairOnLaunch("stale", false)).toBe(false);
  });
});

describe("readConfigState", () => {
  it("tells a missing config from an unusable one", async () => {
    const home = join(await tempDir(), "clawd");
    expect(await readConfigState(agentPaths(home))).toEqual({ kind: "missing" });
    await saveConfig(agentPaths(home), defaultConfig("a".repeat(64)));
    expect((await readConfigState(agentPaths(home))).kind).toBe("ok");
    await writeFile(agentPaths(home).config, "{ nope");
    expect(await readConfigState(agentPaths(home))).toEqual({ kind: "unreadable" });
  });
});

describe("scriptsMatch", () => {
  it("is true when every installed script is byte for byte the shipped one, false when one differs or is missing", async () => {
    const same = await scriptDirs(await tempDir());
    expect(await scriptsMatch(same.hooksDir, same.binDir)).toBe(true);
    const changed = await scriptDirs(await tempDir(), "clawd-hook.mjs");
    expect(await scriptsMatch(changed.hooksDir, changed.binDir)).toBe(false);
    const missing = await scriptDirs(await tempDir());
    await rm(join(missing.binDir, "clawd-lib.mjs"));
    expect(await scriptsMatch(missing.hooksDir, missing.binDir)).toBe(false);
  });
});

describe("currentHookStatus", () => {
  const token = "c".repeat(64);
  const runtime = runtimePrefix("C:\\Apps\\app.exe");
  const ok: ConfigRead = { kind: "ok", config: { ...defaultConfig(token), port: 4750 } };

  async function scenario(settings: string | null, differ?: (typeof SCRIPTS)[number]) {
    const root = await tempDir();
    const dirs = await scriptDirs(root, differ);
    const settingsPath = join(root, "settings.json");
    if (settings !== null) await writeFile(settingsPath, settings);
    return { ...dirs, settingsPath };
  }
  const written = (binDir: string): string => JSON.stringify(applyInstall({}, { port: 4750, token, binDir, runtime }).settings);

  it("is unreadable when the config cannot be used, or the settings file is not a JSON object", async () => {
    const s = await scenario("{}");
    expect(await currentHookStatus({ config: { kind: "unreadable" }, settingsPath: s.settingsPath, runtime, binDir: s.binDir, hooksDir: s.hooksDir })).toBe("unreadable");
    const bad = await scenario("{ nope");
    expect(await currentHookStatus({ config: ok, settingsPath: bad.settingsPath, runtime, binDir: bad.binDir, hooksDir: bad.hooksDir })).toBe("unreadable");
    const list = await scenario("[1, 2]");
    expect(await currentHookStatus({ config: ok, settingsPath: list.settingsPath, runtime, binDir: list.binDir, hooksDir: list.hooksDir })).toBe("unreadable");
  });

  it("is missing with no config or no hooks of ours", async () => {
    const none = await scenario(null);
    expect(await currentHookStatus({ config: ok, settingsPath: none.settingsPath, runtime, binDir: none.binDir, hooksDir: none.hooksDir })).toBe("missing");
    expect(await currentHookStatus({ config: { kind: "missing" }, settingsPath: none.settingsPath, runtime, binDir: none.binDir, hooksDir: none.hooksDir })).toBe("missing");
  });

  it("is current when the file and the scripts both match, and stale when a shipped script differs from the installed copy", async () => {
    const same = await scenario("{}");
    await writeFile(same.settingsPath, written(same.binDir));
    expect(await currentHookStatus({ config: ok, settingsPath: same.settingsPath, runtime, binDir: same.binDir, hooksDir: same.hooksDir })).toBe("current");
    const updated = await scenario("{}", "clawd-statusline.mjs");
    await writeFile(updated.settingsPath, written(updated.binDir));
    expect(await currentHookStatus({ config: ok, settingsPath: updated.settingsPath, runtime, binDir: updated.binDir, hooksDir: updated.hooksDir })).toBe("stale");
  });
});
```

(`applyInstall` and `defaultConfig` must be exported from `@clawd/agent`: `defaultConfig` already is; add `applyInstall` to the `./install/settings` export line in `apps/agent/src/index.ts`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/install/settings.test.ts && cd ../desktop && npx vitest run src/hooks.test.ts`
Expected: FAIL. `hookStatus` still takes two commands; `readConfigState`, `scriptsMatch` and `currentHookStatus` do not exist.

- [ ] **Step 3: Compare the whole set in the agent**

In `apps/agent/src/install/settings.ts`, change `export type HookStatus = "missing" | "current" | "stale";` to `export type HookStatus = "missing" | "current" | "stale" | "unreadable";`, and replace the `ourHookCommand` function and the `hookStatus` function (with their comments) with:

```ts
/** What identifies one of our hooks: its kind, where it points, the token it carries and its timeout. */
function hookKey(hook: JsonObject): string {
  const headers = isJsonObject(hook.headers) ? hook.headers : {};
  return JSON.stringify([hook.type, hook.url ?? hook.command ?? null, headers[TOKEN_HEADER] ?? null, hook.timeout ?? null]);
}

/** Our hooks in a settings file, keyed by event, and our status line's command; empty and null when absent. */
function ourInstalled(settings: JsonObject): { byEvent: Map<string, Set<string>>; status: string | null } {
  const byEvent = new Map<string, Set<string>>();
  if (isJsonObject(settings.hooks)) {
    for (const [event, groups] of Object.entries(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue;
        for (const hook of group.hooks) {
          if (!isOurHook(hook)) continue;
          const keys = byEvent.get(event) ?? new Set<string>();
          keys.add(hookKey(hook as JsonObject));
          byEvent.set(event, keys);
        }
      }
    }
  }
  const status = isOurStatusLine(settings.statusLine) ? (settings.statusLine as { command: string }).command : null;
  return { byEvent, status };
}

/**
 * Whether the settings file already holds everything an install with these options would write: the
 * http hook for each event with its port and token, the SessionStart command, and the status line.
 * `stale` is ours present with any part different or missing: a moved folder, an edited port, a
 * recreated token, or a status line removed by hand. `unreadable` is decided by the caller, which
 * reads the file. Hooks that are not ours are ignored.
 */
export function hookStatus(settings: JsonObject | null, opts: InstallOptions): HookStatus {
  if (settings === null) return "missing";
  const have = ourInstalled(settings);
  if (have.byEvent.size === 0 && have.status === null) return "missing";
  const want = ourInstalled(applyInstall({}, opts).settings);
  if (have.status !== want.status || have.byEvent.size !== want.byEvent.size) return "stale";
  for (const [event, keys] of want.byEvent) {
    const installed = have.byEvent.get(event);
    if (installed === undefined || installed.size !== keys.size) return "stale";
    for (const key of keys) if (!installed.has(key)) return "stale";
  }
  return "current";
}
```

`applyInstall` is defined later in the same file; a function declaration is hoisted, so the order is fine.

- [ ] **Step 4: Read the config, the file and the scripts in the desktop**

Replace `apps/desktop/src/hooks.ts` with:

```ts
// Claude Code's hooks run under the app's own binary: with ELECTRON_RUN_AS_NODE=1 it is plain Node
// and ignores the app. That prefix is what the installer writes into the settings file, so the
// commands follow the app wherever its folder is. This module also decides what the hooks' status
// is: it reads the config, the settings file and the installed scripts, so main only wires it.
// Electron-free, so every classification is tested.
import { HOOK_SCRIPTS, hookStatus, isJsonObject, nodeRuntime, readConfig, readJsonFile, type AgentConfig, type AgentPaths, type HookStatus } from "@clawd/agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The command prefix that runs a script under this app's binary. */
export function runtimePrefix(execPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 ${nodeRuntime(execPath)}`;
}

/** Only our own hooks that differ are rewritten, and only by the packaged app (see stage 6); missing and unreadable wait for the settings window. */
export function repairOnLaunch(status: HookStatus, packaged: boolean): boolean {
  return packaged && status === "stale";
}

export type ConfigRead = { kind: "ok"; config: AgentConfig } | { kind: "missing" } | { kind: "unreadable" };

/** The config, telling a file that does not exist from one that exists but cannot be used. */
export async function readConfigState(paths: AgentPaths): Promise<ConfigRead> {
  try {
    const config = await readConfig(paths);
    return config === null ? { kind: "missing" } : { kind: "ok", config };
  } catch {
    return { kind: "unreadable" };
  }
}

/** Whether every script in the bin directory is byte for byte the shipped one; false when one is missing. */
export async function scriptsMatch(hooksDir: string, binDir: string): Promise<boolean> {
  for (const script of HOOK_SCRIPTS) {
    const [shipped, installed] = await Promise.all([readFile(join(hooksDir, script)).catch(() => null), readFile(join(binDir, script)).catch(() => null)]);
    if (shipped === null || installed === null || !shipped.equals(installed)) return false;
  }
  return true;
}

export type HookStatusDeps = { config: ConfigRead; settingsPath: string; runtime: string; binDir: string; hooksDir: string };

/**
 * The hooks' status now. `unreadable`: the config exists but cannot be used, or the settings file
 * exists but is not a JSON object. `missing`: no config yet, no settings file, or nothing of ours in
 * it. Otherwise the file is compared with what an install would write, and then the installed
 * scripts with the shipped ones, so an update that changed a script reads `stale` and is repaired.
 */
export async function currentHookStatus(deps: HookStatusDeps): Promise<HookStatus> {
  if (deps.config.kind === "unreadable") return "unreadable";
  if (deps.config.kind === "missing") return "missing";
  const file = await readJsonFile(deps.settingsPath).catch(() => null);
  if (file === null || (file.found && !file.ok)) return "unreadable";
  if (file.found && !isJsonObject(file.value)) return "unreadable";
  const status = hookStatus(file.found ? file.value : null, { runtime: deps.runtime, binDir: deps.binDir, port: deps.config.config.port, token: deps.config.config.token });
  if (status !== "current") return status;
  return (await scriptsMatch(deps.hooksDir, deps.binDir)) ? "current" : "stale";
}

export type { HookStatus };
```

In `apps/desktop/src/settings/state.ts`, change `hooks: "missing" | "current" | "stale";` to `hooks: "missing" | "current" | "stale" | "unreadable";`.

In `apps/desktop/src/settings/page.ts`, change `HOOK_WORDS` to:

```ts
const HOOK_WORDS: Record<SettingsState["hooks"], string> = {
  missing: "not installed",
  current: "installed",
  stale: "installed, but not what this app would write now",
  unreadable: "cannot be checked: the agent's config or Claude Code's settings file is not usable",
};
```

and the Hooks section in `render` to:

```ts
    section("Hooks", [
      row("status", el("span", HOOK_WORDS[state.hooks], state.hooks === "current" || state.hooks === "missing" ? "dim" : "warn")),
      ...(state.hooks === "unreadable" ? [] : [row("", button("install-hooks", state.hooks === "missing" ? "Install hooks" : "Reinstall hooks", () => window.clawd.installHooks()))]),
      ...(state.hooks === "missing" || state.hooks === "unreadable" ? [] : [row("", button("remove-hooks", "Remove hooks", () => window.clawd.uninstallHooks()))]),
    ]),
```

In `apps/desktop/src/main.ts`:

1. Change the import from `./hooks` to `import { currentHookStatus, readConfigState, repairOnLaunch, runtimePrefix } from "./hooks";` and, in the `@clawd/agent` import, remove `readJsonFile`, `type JsonObject`, and add `detailLevel`.
2. Replace the `hookOptions`, `currentHookStatus` and `currentState` functions with:

```ts
  /** The state the page renders, from one read of the config. */
  async function currentState(): Promise<SettingsState> {
    const read = await readConfigState(agentPaths(home));
    const config = read.kind === "ok" ? read.config : null;
    return settingsState({
      host: host.state(),
      agentVersion: AGENT_VERSION,
      appVersion: app.getVersion(),
      exe: process.execPath,
      allowlist: config?.allowlist ?? [],
      hooks: await currentHookStatus({ config: read, settingsPath, runtime, binDir: agentPaths(home).bin, hooksDir: dist.hooks }),
      detail: detailLevel(config ?? {}),
      openAtLogin: openAtLogin(),
      logDir: agentPaths(home).logs,
    });
  }
```

3. In the startup block, change `await currentState(),` (the handlers' fallback argument) to `fallback,` after adding `const fallback = await currentState();` above the `for (const [channel, handler] of Object.entries(` line, and replace `const status = await currentHookStatus();` and the following `if (repairOnLaunch(status, app.isPackaged)) {` with `if (repairOnLaunch(fallback.hooks, app.isPackaged)) {`.

- [ ] **Step 5: Run the tests and the type checks**

Run: `cd apps/agent && npx vitest run && pnpm typecheck && cd ../desktop && npx vitest run && pnpm typecheck`
Expected: PASS. The compile-time `Extends` check in `settings-state.ts` passes because the page's union gained `unreadable` with the real one.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/src/install/settings.ts apps/agent/src/install/settings.test.ts apps/agent/src/install/installer.test.ts apps/agent/src/index.ts apps/desktop/src/hooks.ts apps/desktop/src/hooks.test.ts apps/desktop/src/settings/state.ts apps/desktop/src/settings/page.ts apps/desktop/src/main.ts
git commit -m "fix(desktop): the hook check compares every hook, the token, the status line and the installed scripts, and an unusable file says so"
```

---

### Task 3: The settings actions become a tested module, and the bridge carries a notice and the agent's reason

**Files:**
- Create: `apps/desktop/src/settings/actions.ts`
- Modify: `apps/desktop/src/settings/state.ts`, `apps/desktop/src/settings-state.ts`, `apps/desktop/src/settings/page.ts`, `apps/desktop/src/settings/page.css`
- Modify: `apps/agent/src/log.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: create `apps/desktop/src/settings/actions.test.ts`; modify `apps/desktop/src/settings/ipc.test.ts`, `apps/desktop/src/settings-state.test.ts`

**Interfaces:**
- Produces: `createSettingsActions(deps: ActionDeps): SettingsActions` with

```ts
type ActionDeps = {
  state(): Promise<SettingsState>;
  pickFolder(): Promise<string | null>;
  hostMode(): HostMode;
  hasConfig(): Promise<boolean>;
  restartAgent(): void;
  retryAgent(): void;
  setAllowlist(change: { add: string } | { remove: string }): Promise<AllowlistResult>;
  installHooks(): Promise<HooksResult>;
  uninstallHooks(): Promise<UninstallResult>;
  saveDetail(level: DetailLevel): Promise<void>;
  applyOpenAtLogin(on: boolean): void;
  openLogs(): Promise<void>;
  log: Logger;
};
```

  and the exported notice texts `ATTACHED_NOTICE`, `NO_CONFIG_NOTICE`, `NO_CONFIG_TO_CHANGE`, `SEE_LOG`. `SettingsState` gains `notice: string | null` and `agent.error: string | null`; `SettingsInput` gains `notice: string | null`. `desktop.attachedChange` in `LogCode`.

The rules, in one place: a folder or level change is saved, then the agent the app owns is restarted; while attached it is saved and the notice says the attached agent must be restarted, with `desktop.attachedChange` logged. A refusal or a failure logs its code and puts a sentence in the notice; a success clears it. Removing a folder with no config saves nothing. Installing hooks while attached with no config of this app's own is refused. The login toggle applies once and returns one state; main's tray path pushes on its own.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/settings/actions.test.ts`:

```ts
import type { AllowlistResult, HooksResult, LogCode, UninstallResult } from "@clawd/agent";
import { describe, expect, it } from "vitest";
import type { HostMode } from "../agent-host";
import type { SettingsState } from "../settings-state";
import { ATTACHED_NOTICE, NO_CONFIG_NOTICE, NO_CONFIG_TO_CHANGE, createSettingsActions, type ActionDeps } from "./actions";

const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 0, waiting: 0, error: null },
  app: { version: "0.1.0", exe: "C:\\app.exe" },
  allowlist: [],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  logDir: "C:\\logs",
  notice: null,
};

const OK_HOOKS: HooksResult = { ok: true, statusLine: "added", events: [], backup: null, port: 4750 };

function harness(over: Partial<ActionDeps> & { mode?: HostMode; config?: boolean } = {}) {
  const calls: string[] = [];
  const codes: string[] = [];
  const deps: ActionDeps = {
    state: async () => STATE,
    pickFolder: async () => "C:\\repos\\one",
    hostMode: () => over.mode ?? "own",
    hasConfig: async () => over.config ?? true,
    restartAgent: () => void calls.push("restart"),
    retryAgent: () => void calls.push("retry"),
    setAllowlist: async (change) => {
      calls.push("add" in change ? `add ${change.add}` : `remove ${change.remove}`);
      return { ok: true, allowlist: [] } satisfies AllowlistResult;
    },
    installHooks: async () => {
      calls.push("install");
      return OK_HOOKS;
    },
    uninstallHooks: async () => {
      calls.push("uninstall");
      return { ok: true, outcome: "removed", backup: null } satisfies UninstallResult;
    },
    saveDetail: async (level) => void calls.push(`detail ${level}`),
    applyOpenAtLogin: (on) => void calls.push(`login ${on}`),
    openLogs: async () => void calls.push("logs"),
    log: (code: LogCode) => void codes.push(code),
    ...over,
  };
  return { calls, codes, actions: createSettingsActions(deps) };
}

describe("createSettingsActions", () => {
  it("adds the picked folder, restarts the agent it owns, and answers with the state and no notice", async () => {
    const { calls, actions } = harness();
    expect(await actions.addFolder()).toEqual(STATE);
    expect(calls).toEqual(["add C:\\repos\\one", "restart"]);
  });

  it("does nothing when the picker is cancelled", async () => {
    const { calls, actions } = harness({ pickFolder: async () => null });
    expect(await actions.addFolder()).toEqual(STATE);
    expect(calls).toEqual([]);
  });

  it("puts the installer's refusal in the notice, logs it, and does not restart", async () => {
    const { calls, codes, actions } = harness({ setAllowlist: async () => ({ ok: false, message: "refusing to allow a whole filesystem root: C:\\" }) });
    expect((await actions.addFolder()).notice).toBe("refusing to allow a whole filesystem root: C:\\");
    expect(calls).toEqual([]);
    expect(codes).toEqual(["desktop.folderFailed"]);
  });

  it("says a write failed, and where to look, when the installer throws", async () => {
    const { codes, actions } = harness({
      setAllowlist: async () => {
        throw new Error("EPERM");
      },
    });
    expect((await actions.removeFolder("C:\\repos\\one")).notice).toContain("see the log");
    expect(codes).toEqual(["desktop.folderFailed"]);
  });

  it("saves but does not restart while attached, and says the attached agent keeps its own settings", async () => {
    const { calls, codes, actions } = harness({ mode: "attached" });
    expect((await actions.addFolder()).notice).toBe(ATTACHED_NOTICE);
    expect((await actions.setDetail("paths")).notice).toBe(ATTACHED_NOTICE);
    expect(calls).toEqual(["add C:\\repos\\one", "detail paths"]);
    expect(codes).toEqual(["desktop.attachedChange", "desktop.attachedChange"]);
  });

  it("removes nothing when there is no config to change", async () => {
    const { calls, actions } = harness({ config: false });
    expect((await actions.removeFolder("C:\\repos\\one")).notice).toBe(NO_CONFIG_TO_CHANGE);
    expect(calls).toEqual([]);
  });

  it("installs the hooks and clears the notice, or carries the installer's message", async () => {
    const good = harness();
    expect((await good.actions.installHooks()).notice).toBeNull();
    expect(good.calls).toEqual(["install"]);
    const refused = harness({ installHooks: async () => ({ ok: false, message: "settings.json is not a JSON object; nothing was changed" }) });
    expect((await refused.actions.installHooks()).notice).toContain("not a JSON object");
    expect(refused.codes).toEqual(["desktop.hooksFailed"]);
  });

  it("refuses to install hooks while attached with no config of its own, and installs when there is one", async () => {
    const none = harness({ mode: "attached", config: false });
    expect((await none.actions.installHooks()).notice).toBe(NO_CONFIG_NOTICE);
    expect(none.calls).toEqual([]);
    expect(none.codes).toEqual(["desktop.hooksFailed"]);
    const some = harness({ mode: "attached", config: true });
    expect((await some.actions.installHooks()).notice).toBeNull();
    expect(some.calls).toEqual(["install"]);
  });

  it("says what uninstall found", async () => {
    expect((await harness().actions.uninstallHooks()).notice).toBeNull();
    const nothing = harness({ uninstallHooks: async () => ({ ok: true, outcome: "nothing", backup: null }) });
    expect((await nothing.actions.uninstallHooks()).notice).toContain("no hooks of ours");
    const shape = harness({ uninstallHooks: async () => ({ ok: false, reason: "shape", at: "hooks.Stop" }) });
    expect((await shape.actions.uninstallHooks()).notice).toContain("hooks.Stop");
    expect(shape.codes).toEqual(["desktop.hooksFailed"]);
  });

  it("saves the level and restarts, or logs and says so when the save throws", async () => {
    const good = harness();
    expect((await good.actions.setDetail("hints")).notice).toBeNull();
    expect(good.calls).toEqual(["detail hints", "restart"]);
    const bad = harness({
      saveDetail: async () => {
        throw new Error("EPERM");
      },
    });
    expect((await bad.actions.setDetail("hints")).notice).toContain("see the log");
    expect(bad.calls).toEqual([]);
    expect(bad.codes).toEqual(["desktop.detailFailed"]);
  });

  it("applies the login choice once and answers with one state, retries the agent, and opens the logs", async () => {
    const { calls, actions } = harness();
    expect(await actions.setOpenAtLogin(true)).toEqual(STATE);
    await actions.retryAgent();
    await actions.openLogs();
    expect(calls).toEqual(["login true", "retry", "logs"]);
  });
});
```

In `apps/desktop/src/settings/ipc.test.ts`, change the `STATE` fixture to include the two new fields:

```ts
const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 0, waiting: 0, error: null },
  app: { version: "0.1.0", exe: "C:\\app.exe" },
  allowlist: ["C:\\repos\\one"],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  logDir: "C:\\logs",
  notice: null,
};
```

In `apps/desktop/src/settings-state.test.ts`, add `notice: null` to `INPUT`, add `error: null` inside the expected `agent` object and `notice: null` at the end of the expected state in the first test, and add:

```ts
  it("carries the failed agent's reason and a notice", () => {
    expect(settingsState({ ...INPUT, host: { ...HOST, mode: "failed", error: "config.json is invalid at: port" } }).agent.error).toBe("config.json is invalid at: port");
    expect(settingsState({ ...INPUT, notice: "saved" }).notice).toBe("saved");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/settings/actions.test.ts src/settings/ipc.test.ts src/settings-state.test.ts`
Expected: FAIL. `./actions` does not exist; `notice` and `agent.error` are not in the state.

- [ ] **Step 3: Write the state fields and the actions**

In `apps/agent/src/log.ts`, after `| "desktop.detailFailed"`, add `| "desktop.attachedChange"`.

Replace `apps/desktop/src/settings/state.ts` with:

```ts
// The shape the settings page renders. It deliberately spells out its unions instead of importing
// them: the page is sandboxed browser code, checked by tsconfig.page.json with no Node types, so
// anything this file imported would drag the main process's world into that check.
export type SettingsState = {
  agent: {
    mode: "starting" | "own" | "attached" | "restarting" | "failed";
    port: number;
    version: string;
    sessions: number;
    waiting: number;
    /** Why the agent failed, when it did: a config message naming a field, never a value. */
    error: string | null;
  };
  app: { version: string; exe: string };
  allowlist: string[];
  hooks: "missing" | "current" | "stale" | "unreadable";
  detail: "none" | "hints" | "paths";
  openAtLogin: boolean;
  logDir: string;
  /** One sentence about the last action, when it was refused, failed, or was saved but not applied; null otherwise. */
  notice: string | null;
};
```

In `apps/desktop/src/settings-state.ts`, add `notice: string | null;` to `SettingsInput` after `logDir: string;`, and in `settingsState` change the `agent` line to include the error and add the notice:

```ts
    agent: { mode: input.host.mode, port: input.host.port ?? DEFAULT_PORT, version: input.agentVersion, sessions: input.host.sessions, waiting: input.host.waiting, error: input.host.error },
```

and after `logDir: input.logDir,` add `notice: input.notice,`.

Create `apps/desktop/src/settings/actions.ts`:

```ts
// The settings window's actions: what each bridge call does, as rules with tests. Save, then restart
// the agent this app owns only when the save succeeded; log a code when a write fails or is refused;
// say why in the state's notice, since the page shows the whole state and nothing else. Electron-free:
// main hands in the picker, the installer, the host and the log, and only wires.
import type { AllowlistResult, HooksResult, Logger, UninstallResult } from "@clawd/agent";
import type { DetailLevel } from "@clawd/core";
import type { HostMode } from "../agent-host";
import type { SettingsState } from "../settings-state";
import type { SettingsActions } from "./ipc";

export type ActionDeps = {
  /** The state the page renders, built fresh with no notice; the actions add one. */
  state(): Promise<SettingsState>;
  /** The folder picker; null when the user cancels. */
  pickFolder(): Promise<string | null>;
  hostMode(): HostMode;
  /** Whether this app's home has a usable config.json. */
  hasConfig(): Promise<boolean>;
  restartAgent(): void;
  retryAgent(): void;
  setAllowlist(change: { add: string } | { remove: string }): Promise<AllowlistResult>;
  installHooks(): Promise<HooksResult>;
  uninstallHooks(): Promise<UninstallResult>;
  saveDetail(level: DetailLevel): Promise<void>;
  /** Registers or removes the login item and remembers the choice. Pushes nothing: the answer carries the state. */
  applyOpenAtLogin(on: boolean): void;
  openLogs(): Promise<void>;
  log: Logger;
};

export const ATTACHED_NOTICE = "saved; the agent this app is attached to keeps its own settings until it is restarted";
export const NO_CONFIG_NOTICE = "this app is attached to another agent and has no config of its own, so it cannot write hooks that agent would accept";
export const NO_CONFIG_TO_CHANGE = "there is no config to change yet";
export const SEE_LOG = "see the log";

export function createSettingsActions(deps: ActionDeps): SettingsActions {
  const answer = async (notice: string | null = null): Promise<SettingsState> => ({ ...(await deps.state()), notice });

  /** After a successful save: the agent this app owns reads the config again; an attached one cannot be made to. */
  const applied = (): string | null => {
    if (deps.hostMode() === "attached") {
      deps.log("desktop.attachedChange");
      return ATTACHED_NOTICE;
    }
    deps.restartAgent();
    return null;
  };

  const changeAllowlist = async (change: { add: string } | { remove: string }): Promise<SettingsState> => {
    try {
      const saved = await deps.setAllowlist(change);
      if (saved.ok) return answer(applied());
      deps.log("desktop.folderFailed");
      return answer(saved.message);
    } catch {
      deps.log("desktop.folderFailed");
      return answer(`the folder could not be saved; ${SEE_LOG}`);
    }
  };

  return {
    getState: () => answer(),
    async addFolder() {
      let dir: string | null;
      try {
        dir = await deps.pickFolder();
      } catch {
        deps.log("desktop.folderFailed");
        return answer(`the folder picker failed; ${SEE_LOG}`);
      }
      return dir === null ? answer() : changeAllowlist({ add: dir });
    },
    async removeFolder(dir) {
      // Saving with no config would create one with a fresh token; there is nothing to remove from anyway.
      if (!(await deps.hasConfig())) return answer(NO_CONFIG_TO_CHANGE);
      return changeAllowlist({ remove: dir });
    },
    async installHooks() {
      if (deps.hostMode() === "attached" && !(await deps.hasConfig())) {
        deps.log("desktop.hooksFailed", { repair: false, attached: true });
        return answer(NO_CONFIG_NOTICE);
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
    async uninstallHooks() {
      try {
        const result = await deps.uninstallHooks();
        if (result.ok) return answer(result.outcome === "removed" ? null : "no hooks of ours were found; nothing was changed");
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(result.reason === "invalid" ? "Claude Code's settings file is not a JSON object; nothing was changed" : `Claude Code's settings file has an unexpected shape at ${result.at}; nothing was changed`);
      } catch {
        deps.log("desktop.hooksFailed", { repair: false });
        return answer(`the hooks could not be removed; ${SEE_LOG}`);
      }
    },
    async setDetail(level) {
      try {
        await deps.saveDetail(level);
        return answer(applied());
      } catch {
        deps.log("desktop.detailFailed");
        return answer(`the detail level could not be saved; ${SEE_LOG}`);
      }
    },
    async setOpenAtLogin(on) {
      deps.applyOpenAtLogin(on);
      return answer();
    },
    async retryAgent() {
      deps.retryAgent();
      return answer();
    },
    openLogs: () => deps.openLogs(),
  };
}
```

- [ ] **Step 4: Render the notice and the reason**

In `apps/desktop/src/settings/page.ts`, in `render`, replace the `app.replaceChildren(` call's first two arguments so the notice comes first and the Agent section shows the reason:

```ts
  app.replaceChildren(
    ...(state.notice === null ? [] : [el("p", state.notice, "notice")]),
    section("Agent", [
      row("state", `${AGENT_WORDS[state.agent.mode]} · port ${state.agent.port} · version ${state.agent.version}`),
      ...(state.agent.error === null ? [] : [row("reason", el("span", state.agent.error, "warn"))]),
      row("sessions", `${state.agent.sessions} · ${state.agent.waiting} waiting`),
      row("logs", el("code", state.logDir)),
      row("", button("open-logs", "Open logs folder", () => window.clawd.openLogs())),
      ...(state.agent.mode === "failed" ? [row("retry", button("retry", "Start the agent again", () => window.clawd.retryAgent()))] : []),
    ]),
```

(the remaining sections stay as they are). In `apps/desktop/src/settings/page.css`, add after the `.warn` rule:

```css
.notice { margin: 0; padding: 8px 12px; border: 1px solid var(--amber); border-radius: 6px; color: var(--amber); }
```

- [ ] **Step 5: Wire main to the module**

In `apps/desktop/src/main.ts`:

1. In the `@clawd/agent` import, replace `setDetail,` with `saveDetail,` and `uninstall,` with `uninstallHooks,`.
2. Add `import { createSettingsActions } from "./settings/actions";`.
3. Rename the function `setOpenAtLogin(on: boolean)` to `applyOpenAtLogin(on: boolean)` and delete its last line, `pushState();`. In `refreshMenu`, change `setOpenAtLogin,` in the actions object to `setOpenAtLogin: (on: boolean) => { applyOpenAtLogin(on); pushState(); },`.
4. In `currentState`, add `notice: null,` after `logDir: agentPaths(home).logs,`.
5. Replace the whole `for (const [channel, handler] of Object.entries(createHandlers({ ... }, fallback))) { ipcMain.handle(...) }` block (from `const fallback = await currentState();` through the closing `}` of the loop) with:

```ts
    const fallback = await currentState();
    const actions = createSettingsActions({
      state: currentState,
      async pickFolder() {
        // The picker belongs to the settings window, so it is modal to it and a second click cannot open another.
        const options: OpenDialogOptions = { properties: ["openDirectory"], title: "Watch a folder" };
        const parent = settingsWin !== null && !settingsWin.isDestroyed() ? settingsWin : null;
        const picked = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
        return picked.canceled ? null : (picked.filePaths[0] ?? null);
      },
      hostMode: () => host.state().mode,
      hasConfig: async () => (await readConfigState(agentPaths(home))).kind === "ok",
      restartAgent: () => host.restart(),
      retryAgent: () => host.retry(),
      setAllowlist: (change) => setAllowlist({ home, cwd: home, ...("add" in change ? { add: [change.add] } : { remove: change.remove }) }),
      installHooks: () => installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now }),
      uninstallHooks: () => uninstallHooks({ home, settingsPath, now: Date.now }),
      saveDetail: (level) => saveDetail({ home, level }),
      applyOpenAtLogin,
      openLogs: () => shell.openPath(agentPaths(home).logs).then(() => {}),
      log,
    });
    for (const [channel, handler] of Object.entries(createHandlers(actions, fallback))) {
      ipcMain.handle(channel, (_event, arg: unknown) => handler(arg));
    }
```

6. `readConfig` may now be unused in `main.ts`; remove it from the `@clawd/agent` import if the type check says so.

- [ ] **Step 6: Run every check and commit**

Run: `cd apps/desktop && npx vitest run && pnpm typecheck && pnpm bundle`
Expected: PASS, no type errors from either project, and esbuild writes the three bundles.

Run: `pnpm --filter @clawd/desktop start` with `CLAWD_HOME` and `CLAUDE_CONFIG_DIR` pointing at scratch folders (see stage 5's checklist for the two lines). In Settings: pick a drive root as a folder and read the notice; remove the last folder and see the notice clear; Remove hooks with none installed and read "no hooks of ours were found". Stop the app.

```bash
git add apps/desktop/src/settings/actions.ts apps/desktop/src/settings/actions.test.ts apps/desktop/src/settings/state.ts apps/desktop/src/settings-state.ts apps/desktop/src/settings-state.test.ts apps/desktop/src/settings/ipc.test.ts apps/desktop/src/settings/page.ts apps/desktop/src/settings/page.css apps/agent/src/log.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): the settings actions are a tested module, the page says why an action did nothing, and a change while attached says it was not applied"
```

---

### Task 4: The documents, the checklist, and the hand-off

**Files:**
- Modify: `docs/superpowers/specs/2026-09-14-desktop-app-design.md`
- Modify: `apps/desktop/README.md`, `README.md`

- [ ] **Step 1: The design records the decisions**

In `docs/superpowers/specs/2026-09-14-desktop-app-design.md`:

1. In §3's layout block, after the `      ipc.ts` line add `      actions.ts          the settings actions: save, restart, refuse, notice; tested over doubles`, and change the `hooks.ts` line to `    hooks.ts              hook status (missing, current, stale, unreadable) from the config, the file and the scripts; the runtime prefix`.

2. In §5, after the `- **attached.**` bullet's last sentence, add: `A folder or detail-level change made while attached is saved but not applied, since the other agent read its config at its own start: the page says so and \`desktop.attachedChange\` is logged. Installing hooks while attached with no config of this app's own is refused, since they would carry a token the other agent does not hold (stage 7).`

3. In §6, the last bullet ends with a sentence beginning `\`hookStatus(settingsPath, expectedCommand)\` returns` (it wraps across two lines, around line 121). Replace that whole sentence with: `\`hookStatus(settings, options)\` compares everything an install would write, the http hooks with their port and token, the SessionStart command and the status line, and returns \`missing\`, \`current\` or \`stale\`; \`uninstallHooks()\` and \`saveDetail()\` are the result-returning cores the CLI's \`uninstall\` and \`detail\` print (stage 7).`

4. In §8, in the bullet beginning `On launch, \`hooks.ts\` reads the settings file.`, replace `\`stale\` (our hook present with a different command, as after the folder moved or a new version was unzipped elsewhere)` with `\`stale\` (ours present with any part different from what an install would write now: the commands after the folder moved or a new version was unzipped elsewhere, an http hook's port or token, a status line removed by hand, or a script in \`~/.clawd/bin\` that differs from the one shipped beside the archive, which is how an update refreshes the scripts)`, and after the sentence ending `the settings window offers to install.` add `\`unreadable\`: the config exists but cannot be used, or the settings file is not a JSON object; nothing is repaired and the page offers no buttons (stage 7).`

5. In §9, replace the `SettingsState` type block with:

```ts
type SettingsState = {
  agent: { mode: "starting" | "own" | "attached" | "restarting" | "failed"; port: number; version: string; sessions: number; waiting: number; error: string | null };
  app: { version: string; exe: string };
  allowlist: string[];
  hooks: "missing" | "current" | "stale" | "unreadable";
  detail: "none" | "hints" | "paths";
  openAtLogin: boolean;
  logDir: string;
  notice: string | null;
};
```

and after the paragraph ending `The detail section is present only once the detail levels design has landed.` add: `\`notice\` is one sentence about the last action when it was refused, failed, or was saved but not applied, and null otherwise; \`agent.error\` is the failed agent's reason, which names a field and never a value. The actions that decide them live in \`settings/actions.ts\`, tested over doubles (stage 7).`

6. In §10, in the logs bullet's list of codes add `\`desktop.attachedChange\` (a config change saved while attached to another agent, which will not see it)` before `\`desktop.loginItemReapplied\``.

7. In §11, the Updating bullet (around line 264, wrapped over four lines) currently reads: quit, unzip over, launch; the hooks and the login item point at the same path, so nothing is repaired; unzipping to a new place is the moved-folder case; and a final sentence beginning `When a new version changes the hook scripts, open Settings and choose Reinstall`. Replace the whole bullet with:

```markdown
- Updating: quit the app, unzip the new version over the folder, launch. The hooks and the login
  item point at the same path; the launch repair copies the scripts again when the new version
  changed them (stage 7). Unzipping to a new place is the moved-folder case in §8 and §10.
```

- [ ] **Step 2: The design records what stage 7 closed, what stage 6's review found, and what stage 8 takes**

In §12's stages table, replace the `Post-dev Hardening` row with two rows:

```markdown
| 7 Hardening I | The hooks, the install, the bridge, and what development leaves behind (§12.1) | None new | Every §12.1 item marked stage 7 is done or dropped with a reason |
| 8 Hardening II | The page's rendering and tests, the shell's edge cases, the scheme, the stale wait (§12.1) | None new | Every remaining §12.1 item is done or dropped with a reason in the decision log |
```

In §12.1, append `Done in stage 7.` with a clause to each of these items: stage 5's `The settings actions are rules living in untested glue` (`: \`settings/actions.ts\``), `A status line removed by hand is reinstated at every launch` (`: decided, it is stale and the packaged app repairs it`), `The hook check ignores the port and the token` (`: the whole set is compared`), `The bridge cannot tell the user an action was refused` (`: the state's \`notice\``), `The failed agent's reason is never shown` (`: \`agent.error\``); from the 17 September overall review `Attached mode applies nothing`, `An unreadable config or settings file reads as "not installed"`, `\`install()\` saves the config before the hooks can still fail`, `An install from the app can mint a token the serving agent lacks`, `Every state build reads the config twice`, `The login toggle from the page builds the state twice`, `The desktop calls the CLI-shaped uninstall with a no-op printer`, `The detail default duplicates \`detailLevel()\``; from stage 6's final review `An update does not refresh the hook scripts` (`: the scripts are compared at launch`).

Then, after the stage 6.1 list (`Found in the review of stage 6's merge`), add:

```markdown
Stage 8 takes what remains: the settings page rebuilding on every push, its missing tests (a DOM
environment for vitest), the bridge typed by hand in three places, the two window copies, the
scheme's host table with the handler that can reject, Windows device names, the 404 body,
`args.ts`'s dependency on `scheme.ts`, `connect-src 'self'`, one source for the agent's port, an
unreadable `desktop.json`, restored bounds, the Start on login checkbox and Task Manager, Ctrl+Q on
other layouts, tearing the tray down in `will-quit`, the settings window's font, the preload's
bundle, zod's eval probe, the built-in `http://localhost:3000` origin, the restart that clears the
fault budget, the two extra fuses, and the wait nobody answers.
```

- [ ] **Step 3: The READMEs**

In `apps/desktop/README.md`, in the stage 6 note, delete the two sentences `When a new version changes the hook scripts, open Settings and choose Reinstall after updating: the scripts copied into \`~/.clawd/bin\` are only refreshed by an install, not by unzipping a new version over the folder.` and append after the stage 6 note:

```markdown
### Stage 7: hardening, the first half

Nothing new in Electron. The settings window and the installer stop losing events and stop lying.

**What stale means now.** The hook check compares everything an install would write: the http hook
for each event with its port and token, the SessionStart command, the status line, and the three
scripts in `~/.clawd/bin` against the ones shipped beside the archive. Any difference is `stale`, so
an edited port, a recreated token, a status line removed by hand and an update that changed a script
are all repaired by the packaged app at launch, and offered as Reinstall in development. A config or
settings file that exists but cannot be used reads `unreadable`, with no buttons.

**The page can say no.** Every answer over the bridge is still the whole state, but the state now
carries a `notice`, one sentence about the last action when it was refused, failed, or was saved but
not applied, and the failed agent's reason. The rules that decide them live in
`settings/actions.ts`, tested with doubles for the picker, the installer, the host and the log;
`main.ts` only wires. A change made while attached to another agent is saved but not applied, and
the notice says so. Installing hooks while attached with no config of this app's own is refused.

**The install saves once.** The installer validates Claude Code's settings file, copies the
scripts, saves the config, then writes the settings file, in one call and in that order; a failure
before the save leaves the config untouched, and an install that would change nothing writes no
backup.

```

In the root `README.md`, in the Run section, delete the sentence `If the new version changes the hook scripts, open Settings and choose Reinstall afterwards, since an update alone does not refresh the copies in \`~/.clawd/bin\`.`

- [ ] **Step 4: Run every check and commit the documents**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md apps/desktop/README.md README.md
git commit -m "docs: the design and the READMEs record what stale means, the bridge's notice, the version 2 state file, and what stage 8 takes"
```

- [ ] **Step 5: Walk the checklist (pause here for the maintainer)**

Package first (`pnpm --filter @clawd/desktop package`), then use the scratch folders as stage 6's checklist did:

```
$env:CLAWD_HOME = "$env:TEMP\clawd-stage7"
$env:CLAUDE_CONFIG_DIR = "$env:TEMP\clawd-stage7-claude"
New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null
Expand-Archive apps\desktop\release\Clawd-Visualiser-0.1.0-win-x64.zip "$env:USERPROFILE\Apps\Clawd Visualiser"
& "$env:USERPROFILE\Apps\Clawd Visualiser\Clawd Visualiser.exe"
```

Stop any CLI agent and any development run first. Check each:

- **Refusals reach the page.** Settings, Add folder, pick `C:\`: the notice says a filesystem root is refused. Remove the last folder: the notice clears. Remove hooks with none installed: "no hooks of ours were found".
- **Unreadable.** Quit. Write `{ nope` into `$env:CLAWD_HOME\config.json`. Launch: the Agent section reads failed with the reason, and the Hooks section reads `cannot be checked` with no buttons. Restore the file (delete it; the agent recreates it) and launch again.
- **The whole set is stale.** Install the hooks. Quit. In `$env:CLAUDE_CONFIG_DIR\settings.json`, change one http hook's port to 4800. Launch: the log gains `desktop.hooksRepaired` and the port is back. Do the same by deleting the `statusLine`: repaired.
- **An update refreshes the scripts.** Quit. Append a comment line to `$env:CLAWD_HOME\bin\clawd-hook.mjs`. Launch: `desktop.hooksRepaired`, and the file matches the shipped one again.
- **Attached.** Start the CLI agent (`pnpm --filter @clawd/agent start`) against the same scratch home, then launch the app: the tray says attached. Add a folder: the notice says the attached agent keeps its own settings, and the log has `desktop.attachedChange`. Stop the CLI agent; the app takes over.
- **Refused install while attached without a config.** With the CLI agent running from a different `CLAWD_HOME` and this app's scratch home empty, Install hooks: the notice says the app has no config of its own, and nothing is written.
- **The two checks stage 6 left.** A real sign-out and sign-in with the login item on: the app returns hidden, and Task Manager's Startup apps list shows Clawd Visualiser. And deleting the folder while a Claude Code session runs: no dialog, the session carries on.
- Delete both scratch folders and the unzipped folder, and remove `Env:CLAWD_HOME` and `Env:CLAUDE_CONFIG_DIR`.

- [ ] **Step 6: Record the checks and hand the branch back**

In §12.1, after the `Stage 6's manual checks: partly done` item, add:

```markdown
- **Stage 6's remaining checks and stage 7's: done.** On <date> the maintainer walked them: the
  refusals and the attached notice on the page, the unreadable config, the port, the status line and
  a changed script all repaired at launch, the refused install without a config, a sign-out and sign-in with the login item on, and the
  folder deleted under a running session.
```

with the real date, then:

```bash
git add docs/superpowers/specs/2026-09-14-desktop-app-design.md
git commit -m "docs: stage 7's checks are done, with stage 6's two remaining ones"
```

Then hand the branch back with the finishing-a-development-branch skill. The maintainer merges from `C:\mw\visualiser`:

```bash
git merge --no-ff feat/desktop-stage-7 -m "Merge branch 'feat/desktop-stage-7' (desktop stage 7: hardening, the first half)"
```

Stage 8's plan is written from `main` once this is merged, from the list at the end of §12.1.
