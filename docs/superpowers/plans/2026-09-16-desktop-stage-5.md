# Desktop Stage 5 (Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A settings window sets a machine up from the app alone: it shows the agent, adds and removes watched folders, installs and removes the Claude Code hooks under the app's own binary, sets the detail level, and toggles start on login.

**Architecture:** The agent's installer splits into `setAllowlist()` and `installHooks()`, takes the hook command's runtime prefix as a string rather than a Node path, and gains `hookStatus()`. The desktop gets a second window on `app://settings/` with a preload bridge: `settings/preload.ts` exposes `window.clawd`, `settings/ipc.ts` validates every argument with zod and calls injected actions, and `settings-state.ts` builds the state the page renders. `hooks.ts` builds the prefix and decides whether a launch must repair the hooks. `main.ts` wires them.

**Tech Stack:** Electron 44, esbuild 0.28, zod 4, vitest 5, TypeScript 5.9, pnpm 12 workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-desktop-app-design.md`, sections 3, 6, 7, 8, 9, 10, 13 and stage 5 of section 12.

**Stage idea:** every window so far has been a sandboxed web page that could only reach the agent over HTTP. The settings window has to do things a web page must never do on its own: pick a folder, write Claude Code's settings file, change the login item. Electron's answer is the preload script: one small file that runs before the page, with no access to the page's globals, which publishes a named list of functions through `contextBridge`. Each call becomes a message to the main process, which validates it and does the work. The page itself stays sandboxed and has no Node access at all. This is Electron's process-model security in one stage: the privileged side is a handful of named, validated messages, and everything else stays out.

## Global Constraints

- Windows only. Nothing is built or tested elsewhere.
- Main-process code stays thin and untested; logic lives in Electron-free modules with vitest tests, written test first. `settings/preload.ts` and `settings/page.ts` are glue and stay untested, as `main.ts` is.
- `exactOptionalPropertyTypes` is on (`tsconfig.base.json`): never assign `undefined` to an optional property; omit it.
- The desktop package has no runtime dependencies. `@clawd/agent`, `@clawd/core`, `@clawd/scene` and, from this stage, `zod` are dev dependencies, bundled by esbuild.
- The bridge is exactly the design's §9 `ClawdSettingsApi` and `SettingsState`; nothing is added to it this stage.
- Main validates every argument with zod. A message that does not validate is refused, and the state is returned unchanged.
- `hookStatus` takes the settings file's parsed contents and both commands an install would write, rather than the design's path and single command: reading the file belongs to the caller, and the status line can go stale just as the hook can.
- The settings page is browser code. It type-checks against its own `tsconfig.page.json`, which adds the DOM library, so main-process code still cannot reach DOM types by accident.
- Folder edits and detail level changes save the agent's config and restart the agent in process, so the README's "restart the agent after changing the allowlist" happens for the user.
- The settings window is 560 by 720, loads `app://settings/`, and uses `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` with the preload. Text only, no framework; JetBrains Mono on the app's night background.
- Sections, top to bottom: agent, this app (version and where it runs from), watched folders, hooks, detail level, start on login.
- The runtime prefix is `ELECTRON_RUN_AS_NODE=1 "<exe>"` where `<exe>` is `process.execPath` with forward slashes: the unzipped folder's exe when packaged, Electron's exe in development.
- The installer's `InstallOptions.node` becomes `runtime`, the exact command prefix. The CLI passes the quoted Node path; the desktop passes the prefix above. `install()` splits into `setAllowlist()` and `installHooks()`; the CLI composes them as today and the settings window calls them separately.
- `hookStatus` returns `missing`, `current` or `stale`. On launch: `current` does nothing, `stale` rewrites through `installHooks()` with the usual backup and logs `desktop.hooksRepaired`, `missing` does nothing and the settings window offers to install.
- The hook scripts ship with the app: `build/bundle.mjs` copies `apps/agent/hooks` to `dist/hooks`, and the installer copies them from there into `<home>/bin`, where they read `../config.json`.
- Log lines carry a time, a code and numbers or booleans only. New code this stage: `desktop.hooksRepaired`.
- The tray menu becomes Open, Settings, Start on login, Quit, which completes the design's §10 menu.
- Each stage note explains the Electron idea it introduces, in plain words, for a maintainer learning Electron.
- Check listening ports with `netstat -ano`. Stop processes by exact process id; never by process tree, which on this machine also stopped unrelated processes.
- Commits: one-line messages, no Co-Authored-By trailer. Never push.
- Branch `feat/desktop-stage-5` in the worktree `C:\mw\visualiser-desktop`, cut from `main` (stage 4 is merged). Run package tests from the package directory: `npx vitest run <file>`.
- If `electron --version` prints a Node version, `ELECTRON_RUN_AS_NODE` is set in the shell; unset it before running the app.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/agent/src/install/settings.ts` | `InstallOptions.runtime`, `nodeRuntime`, `hookStatus`. |
| `apps/agent/src/install/installer.ts` | `setAllowlist`, `installHooks`, `removeFromAllowlist`; `install` composes them. |
| `apps/agent/src/cli.ts` | Passes `runtime: nodeRuntime(env.node)`. |
| `apps/agent/src/index.ts` | Exports the installer surface, `setDetail`, `defaultSettingsPath`, `AGENT_VERSION`. |
| `apps/agent/src/log.ts` | `desktop.hooksRepaired` joins the closed set. |
| `apps/desktop/src/paths.ts` | The directories beside the bundle: renderer, tray, settings, hooks. |
| `apps/desktop/src/hooks.ts` | The runtime prefix, the expected commands, and the launch decision. |
| `apps/desktop/src/settings-state.ts` | Builds `SettingsState` from the host, the config and the app. |
| `apps/desktop/src/settings/ipc.ts` | Channel names, zod validation, handlers over injected actions. |
| `apps/desktop/src/settings/preload.ts` | The `contextBridge` bridge. Untested glue. |
| `apps/desktop/src/settings/page.html`, `page.css`, `page.ts` | The settings page. Untested glue. |
| `apps/desktop/tsconfig.page.json` | The page's type check, with the DOM library the main process does not load. |
| `apps/desktop/src/scheme.ts` | Serves `app://settings/` from the settings directory, with its own policy. |
| `apps/desktop/src/tray.ts` | The menu gains Settings. |
| `apps/desktop/src/agent-host.ts` | `restart()`, for a config change. |
| `apps/desktop/src/window.ts` | `createSettingsWindow`. |
| `apps/desktop/src/main.ts` | Wiring: handlers, the window, hook repair, the tray item. |
| `apps/desktop/build/bundle.mjs` | Builds the preload and the page, copies the page's HTML and the hook scripts. |
| `apps/desktop/README.md`, `README.md` | The stage 5 note and the layout row. |

---

### Task 1: The installer's runtime prefix, its split, and hook status

**Files:**
- Modify: `apps/agent/src/install/settings.ts`
- Modify: `apps/agent/src/install/installer.ts`
- Modify: `apps/agent/src/cli.ts:52-64`
- Modify: `apps/agent/src/index.ts`
- Modify: `apps/agent/src/log.ts`
- Test: `apps/agent/src/install/settings.test.ts`, `apps/agent/src/install/installer.test.ts`, `apps/agent/src/cli.test.ts`

**Interfaces:**
- Produces, from `@clawd/agent`: `nodeRuntime(nodePath: string): string`; `hookCommand`, `statusCommand`, `hookStatus(settings: JsonObject | null, expected: { hook: string; status: string }): HookStatus` where `HookStatus = "missing" | "current" | "stale"`; `setAllowlist(req: AllowlistRequest): Promise<AllowlistResult>`; `removeFromAllowlist(existing: readonly string[], dir: string): string[]`; `installHooks(req: HooksRequest): Promise<HooksResult>`; `uninstall`; `setDetail`; `defaultSettingsPath`; `AGENT_VERSION`; `HOOK_SCRIPTS`; `type InstallOptions = { port: number; token: string; binDir: string; runtime: string }`.
- `desktop.hooksRepaired` in `LogCode`.

The CLI's behaviour does not change: `install()` still merges the allowlist, copies the scripts, writes the settings file with a backup and prints the same lines. It is now composed of the two halves the settings window calls separately.

- [ ] **Step 1: Write the failing tests for the prefix and the status**

In `apps/agent/src/install/settings.test.ts`, add to the imports `hookStatus`, `nodeRuntime`, `hookCommand`, `statusCommand`, and replace every `node: "C:\\Program Files\\nodejs\\node.exe"` in existing `InstallOptions` literals with `runtime: nodeRuntime("C:\\Program Files\\nodejs\\node.exe")`. Then add:

```ts
describe("nodeRuntime", () => {
  it("quotes the Node path with forward slashes, as the command needs", () => {
    expect(nodeRuntime("C:\\Program Files\\nodejs\\node.exe")).toBe('"C:/Program Files/nodejs/node.exe"');
  });
});

describe("hookStatus", () => {
  const expected = { hook: '"node" "C:/h/bin/clawd-hook.mjs"', status: '"node" "C:/h/bin/clawd-statusline.mjs"' };
  const withCommands = (hook: string, status: string): JsonObject => ({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: hook, timeout: 2 }] }] },
    statusLine: { type: "command", command: status },
  });

  it("is missing when nothing of ours is there", () => {
    expect(hookStatus(null, expected)).toBe("missing");
    expect(hookStatus({}, expected)).toBe("missing");
    expect(hookStatus({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other.mjs" }] }] } }, expected)).toBe("missing");
  });

  it("is current when both commands are the ones we would write", () => {
    expect(hookStatus(withCommands(expected.hook, expected.status), expected)).toBe("current");
  });

  it("is stale when ours are there with another command, as after the folder moved", () => {
    expect(hookStatus(withCommands('"D:/old/electron.exe" "C:/h/bin/clawd-hook.mjs"', expected.status), expected)).toBe("stale");
    expect(hookStatus(withCommands(expected.hook, '"D:/old/electron.exe" "C:/h/bin/clawd-statusline.mjs"'), expected)).toBe("stale");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/agent && npx vitest run src/install/settings.test.ts`
Expected: FAIL. `nodeRuntime` and `hookStatus` are not exported yet.

- [ ] **Step 3: Rename the option and add the two functions**

In `apps/agent/src/install/settings.ts`, change the options type and the command builder:

```ts
/** `runtime` is the whole command prefix that runs a script: a quoted Node path, or the desktop's Electron prefix. */
export type InstallOptions = { port: number; token: string; binDir: string; runtime: string };
export type HookStatus = "missing" | "current" | "stale";

const forwardSlashes = (p: string): string => p.replace(/\\/g, "/");

/** The CLI's prefix: the Node binary, quoted, with forward slashes. */
export const nodeRuntime = (nodePath: string): string => `"${forwardSlashes(nodePath)}"`;

function scriptCommand(opts: InstallOptions, script: string): string {
  return `${opts.runtime} "${forwardSlashes(opts.binDir).replace(/\/+$/, "")}/${script}"`;
}
```

and add, after `isOurStatusLine`:

```ts
/** Our SessionStart command hook, whatever command it holds, or null. */
function ourHookCommand(settings: JsonObject): string | null {
  const hooks = settings.hooks;
  if (!isJsonObject(hooks)) return null;
  const groups = hooks.SessionStart;
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    if (!isJsonObject(group) || !Array.isArray(group.hooks)) continue;
    for (const hook of group.hooks) {
      if (isJsonObject(hook) && hook.type === "command" && typeof hook.command === "string" && hook.command.includes(HOOK_SCRIPT)) return hook.command;
    }
  }
  return null;
}

/**
 * Whether the settings file already runs the commands we would write. `stale` is ours pointing
 * somewhere else, which is what a moved folder or a new unzip leaves behind.
 */
export function hookStatus(settings: JsonObject | null, expected: { hook: string; status: string }): HookStatus {
  if (settings === null) return "missing";
  const hook = ourHookCommand(settings);
  const line = isOurStatusLine(settings.statusLine) ? (settings.statusLine as { command: string }).command : null;
  if (hook === null && line === null) return "missing";
  return hook === expected.hook && line === expected.status ? "current" : "stale";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/agent && npx vitest run src/install/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Split the installer**

`apps/agent/src/install/installer.ts`, replacing everything from `export async function install` to the end of that function, and keeping `uninstall` as it is:

```ts
export type AllowlistRequest = {
  home: string;
  /** Directories to add, resolved against `cwd`. */
  add?: readonly string[];
  /** A directory to remove, compared after normalising. */
  remove?: string;
  cwd: string;
  port?: number;
};
export type AllowlistResult = { ok: true; allowlist: string[] } | { ok: false; message: string };

/** Drop a directory from an allowlist, comparing the way the agent does. */
export function removeFromAllowlist(existing: readonly string[], dir: string): string[] {
  return existing.filter((d) => normalisePath(d) !== normalisePath(dir));
}

/** Saves the allowlist, and the port when one is given. The agent reads the config at startup. */
export async function setAllowlist(req: AllowlistRequest): Promise<AllowlistResult> {
  const paths = agentPaths(req.home);
  const base: AgentConfig = (await readConfig(paths)) ?? defaultConfig();
  const added = mergeAllowlist(req.remove === undefined ? base.allowlist : removeFromAllowlist(base.allowlist, req.remove), req.add ?? [], req.cwd);
  if (!added.ok) return added;
  await saveConfig(paths, { ...base, port: req.port ?? base.port, allowlist: added.allowlist });
  return added;
}

export type HooksRequest = {
  home: string;
  settingsPath: string;
  /** The command prefix the written hooks run: a Node path, or the desktop's Electron prefix. */
  runtime: string;
  /** Where the hook scripts are copied from: apps/agent/hooks, or the app's dist/hooks. */
  hooksDir: string;
  port?: number;
  dryRun?: boolean;
  now: () => number;
};
export type HooksResult =
  | { ok: true; statusLine: InstallResult["statusLine"]; events: readonly string[]; backup: string | null; allowlist: string[]; port: number }
  | { ok: false; message: string };

/**
 * Copies the scripts to `<home>/bin` and writes Claude Code's settings file, backing up what was
 * there. The config is saved first, so the token the new hooks carry is on disk before they exist.
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
  if (req.dryRun === true) return { ok: true, statusLine: result.statusLine, events: result.events, backup: null, allowlist: base.allowlist, port };

  await mkdir(paths.bin, { recursive: true });
  for (const script of HOOK_SCRIPTS) await copyFile(join(req.hooksDir, script), join(paths.bin, script));
  const wrapped = result.statusLine === "wrapped" ? result.newlyWrapped : result.statusLine === "kept" ? base.wrappedStatusLine : undefined;
  const { wrappedStatusLine: _wrapped, ...baseWithoutWrapped } = base;
  await saveConfig(paths, { ...baseWithoutWrapped, port, ...(wrapped ? { wrappedStatusLine: wrapped } : {}) });
  const saved = read.kind === "ok" ? await backup(req.settingsPath, req.now()) : null;
  await writeJsonAtomic(req.settingsPath, result.settings);
  return { ok: true, statusLine: result.statusLine, events: result.events, backup: saved, allowlist: base.allowlist, port };
}

/** The CLI's install: check, then the allowlist, then the hooks, then the report the user reads. */
export async function install(req: InstallRequest): Promise<number> {
  const common = {
    home: req.home,
    settingsPath: req.settingsPath,
    runtime: req.runtime,
    hooksDir: req.hooksDir,
    ...(req.port === undefined ? {} : { port: req.port }),
    now: req.now,
  };
  // A dry run of the hooks reads and checks the settings file and writes nothing, so a file we
  // cannot use stops the install before anything is saved, as it did before the halves were split.
  const check = await installHooks({ ...common, dryRun: true });
  if (!check.ok) {
    req.print(check.message);
    return 1;
  }
  const base = (await readConfig(agentPaths(req.home)))?.allowlist ?? [];
  const allow = req.dryRun ? mergeAllowlist(base, req.allow, req.cwd) : await setAllowlist({ home: req.home, add: req.allow, cwd: req.cwd, ...(req.port === undefined ? {} : { port: req.port }) });
  if (!allow.ok) {
    req.print(allow.message);
    return 1;
  }
  if (req.dryRun) {
    req.print(`dry run: would add hooks to ${req.settingsPath} for ${check.events.join(", ")}`);
    req.print(`dry run: would ${STATUS_WORDS[check.statusLine]}`);
    req.print(`dry run: the allowlist would be ${allow.allowlist.join(", ")}`);
    return 0;
  }
  const hooks = await installHooks(common);
  if (!hooks.ok) {
    req.print(hooks.message);
    return 1;
  }
  req.print(`installed the Clawd hooks into ${req.settingsPath}; ${STATUS_DONE[hooks.statusLine]}`);
  req.print(hooks.backup ? `backup of the previous settings: ${hooks.backup}` : "there were no previous settings to back up");
  req.print(`allowlist: ${allow.allowlist.join(", ")}`);
  const running = await (req.probe ?? probeAgent)(hooks.port);
  req.print(running ? `an agent is running on port ${hooks.port}; restart it to pick up these changes` : "start the agent with: pnpm --filter @clawd/agent start");
  return 0;
}
```

In the same file, change `InstallRequest`'s `node: string` to `runtime: string`, with the comment `/** The command prefix the written hooks run. */`.

Two properties of the old `install()` have to survive the split, and both are in the code above.

An unusable settings file must leave the machine untouched, with no `~/.clawd` and no fresh token. The old `install()` checked everything before it wrote anything; now `setAllowlist()` writes as soon as it is called, so the dry run of `installHooks()` goes first as the check. It reads the settings file, applies the install in memory and writes nothing.

A dry run must also write nothing, so on that path the allowlist is merged for the printed line only, never saved. That is the `req.dryRun ? mergeAllowlist(...) : await setAllowlist(...)` line.

- [ ] **Step 6: Point the CLI at the prefix**

In `apps/agent/src/cli.ts`, add `nodeRuntime` to the `./install/settings` imports (add the import line if there is none), and change the `install(...)` call's `node: env.node` to:

```ts
          runtime: nodeRuntime(env.node),
```

- [ ] **Step 7: Run the agent's tests and fix the fixtures**

Run: `cd apps/agent && npx vitest run`
Expected: the installer and CLI tests fail only where they name `node:` in a request or options literal. Change each to `runtime: nodeRuntime(<the same path>)`, and re-run until every test passes with no behaviour change.

Then add this test to `installer.test.ts`, inside `describe("install and uninstall")`:

```ts
  it("sets the allowlist and installs the hooks separately, as the settings window does", async () => {
    const t = await setup();
    expect(await setAllowlist({ home: t.home, add: [t.allowed], cwd: t.cwd })).toEqual({ ok: true, allowlist: [t.allowed] });
    const hooks = await installHooks({ home: t.home, settingsPath: t.settingsPath, runtime: nodeRuntime("C:\\node.exe"), hooksDir: t.hooksDir, now: () => T0 });
    expect(hooks.ok).toBe(true);
    const settings = JSON.parse(await readFile(t.settingsPath, "utf8")) as JsonObject;
    expect(hookStatus(settings, { hook: hookCommand(t.opts), status: statusCommand(t.opts) })).toBe("current");
    expect(removeFromAllowlist([t.allowed], t.allowed)).toEqual([]);
  });
```

Adapt `setup()`, `t.opts` and `T0` to the file's existing helpers; if the file has no `setup()`, build the same values the neighbouring tests build.

- [ ] **Step 8: Export the surface and add the log code**

In `apps/agent/src/index.ts`, add:

```ts
export { AGENT_VERSION } from "./version";
export { defaultSettingsPath, defaultTranscriptsDir } from "./config";
export { setDetail } from "./detail";
export { install, installHooks, removeFromAllowlist, setAllowlist, uninstall, type AllowlistResult, type HooksResult } from "./install/installer";
export { HOOK_SCRIPTS, hookCommand, hookStatus, nodeRuntime, statusCommand, type HookStatus, type InstallOptions, type JsonObject } from "./install/settings";
```

In `apps/agent/src/log.ts`, in `LogCode`, after `| "desktop.loginItemReapplied"`:

```ts
  | "desktop.hooksRepaired"
```

- [ ] **Step 9: Run every check and commit**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add apps/agent/src/install apps/agent/src/cli.ts apps/agent/src/cli.test.ts apps/agent/src/index.ts apps/agent/src/log.ts
git commit -m "feat(agent): hooks take a runtime prefix, the install splits into allowlist and hooks, and hookStatus reports missing, current or stale"
```

---

### Task 2: The app's paths, its runtime prefix, and repairing hooks at launch

**Files:**
- Create: `apps/desktop/src/paths.ts`
- Test: `apps/desktop/src/paths.test.ts`
- Create: `apps/desktop/src/hooks.ts`
- Test: `apps/desktop/src/hooks.test.ts`
- Modify: `apps/desktop/build/bundle.mjs`

**Interfaces:**
- Consumes: `hookCommand`, `statusCommand`, `hookStatus`, `agentPaths` from `@clawd/agent` (Task 1).
- Produces: `distPaths(dir: string): { renderer: string; tray: string; settings: string; hooks: string }`; `runtimePrefix(execPath: string): string`; `expectedCommands(opts: { runtime: string; binDir: string; port: number; token: string }): { hook: string; status: string }`; `repairOnLaunch(status: HookStatus): boolean`.

`dist/hooks` holds the three `.mjs` files the installer copies into `<home>/bin`. They are plain ES modules that read `../config.json` beside themselves, so they are copied, never bundled.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/paths.test.ts`:

```ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distPaths } from "./paths";

describe("distPaths", () => {
  it("names the four directories beside the bundle", () => {
    const dist = join("C:", "app", "dist");
    expect(distPaths(dist)).toEqual({
      renderer: join(dist, "renderer"),
      tray: join(dist, "tray"),
      settings: join(dist, "settings"),
      hooks: join(dist, "hooks"),
    });
  });
});
```

`apps/desktop/src/hooks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { expectedCommands, repairOnLaunch, runtimePrefix } from "./hooks";

const BIN = "C:\\Users\\me\\.clawd\\bin";

describe("runtimePrefix", () => {
  it("runs the app's own binary as Node, quoted, with forward slashes", () => {
    expect(runtimePrefix("C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe")).toBe('ELECTRON_RUN_AS_NODE=1 "C:/Apps/Clawd Visualiser/Clawd Visualiser.exe"');
  });
});

describe("expectedCommands", () => {
  it("are the hook and status line commands an install would write", () => {
    const runtime = runtimePrefix("C:\\Apps\\app.exe");
    expect(expectedCommands({ runtime, binDir: BIN, port: 4750, token: "a".repeat(64) })).toEqual({
      hook: `${runtime} "C:/Users/me/.clawd/bin/clawd-hook.mjs"`,
      status: `${runtime} "C:/Users/me/.clawd/bin/clawd-statusline.mjs"`,
    });
  });
});

describe("repairOnLaunch", () => {
  it("rewrites only hooks of ours that point somewhere else", () => {
    expect(repairOnLaunch("stale")).toBe(true);
    expect(repairOnLaunch("current")).toBe(false);
    expect(repairOnLaunch("missing")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/paths.test.ts src/hooks.test.ts`
Expected: FAIL, "Failed to resolve import ./paths" and "./hooks".

- [ ] **Step 3: Write the modules**

`apps/desktop/src/paths.ts`:

```ts
// What sits beside the bundle. esbuild writes dist/main.cjs, and build/bundle.mjs fills these four
// directories: the web app's export, the tray icons, the settings page, and the hook scripts the
// installer copies into the user's home.
import { join } from "node:path";

export type DistPaths = { renderer: string; tray: string; settings: string; hooks: string };

export function distPaths(dir: string): DistPaths {
  return { renderer: join(dir, "renderer"), tray: join(dir, "tray"), settings: join(dir, "settings"), hooks: join(dir, "hooks") };
}
```

`apps/desktop/src/hooks.ts`:

```ts
// Claude Code's hooks run under the app's own binary: with ELECTRON_RUN_AS_NODE=1 it is plain Node
// and ignores the app. That prefix is what the installer writes into the settings file, so the
// commands follow the app wherever its folder is. Electron-free, so the strings are tested.
import { hookCommand, hookStatus, statusCommand, type HookStatus, type InstallOptions } from "@clawd/agent";

const forwardSlashes = (p: string): string => p.replace(/\\/g, "/");

/** The command prefix that runs a script under this app's binary. */
export function runtimePrefix(execPath: string): string {
  return `ELECTRON_RUN_AS_NODE=1 "${forwardSlashes(execPath)}"`;
}

/** The two commands an install would write now, which say whether what is installed is current. */
export function expectedCommands(opts: InstallOptions): { hook: string; status: string } {
  return { hook: hookCommand(opts), status: statusCommand(opts) };
}

/** Only our own hooks pointing elsewhere are rewritten; missing hooks wait for the settings window. */
export function repairOnLaunch(status: HookStatus): boolean {
  return status === "stale";
}

export { hookStatus, type HookStatus };
```

- [ ] **Step 4: Ship the hook scripts beside the bundle**

In `apps/desktop/build/bundle.mjs`, after the tray copy:

```js
// The hook scripts ship as they are: the installer copies them into <home>/bin, where they read
// ../config.json beside themselves, so they must not be bundled.
await cp(here("../../agent/hooks"), here("../dist/hooks"), { recursive: true });
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit && pnpm bundle`
Expected: PASS, no type errors, and the bundle written.

Run: `Get-ChildItem apps/desktop/dist/hooks | Select-Object Name` from the repository root.
Expected: `clawd-hook.mjs`, `clawd-lib.mjs`, `clawd-statusline.mjs`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/paths.ts apps/desktop/src/paths.test.ts apps/desktop/src/hooks.ts apps/desktop/src/hooks.test.ts apps/desktop/build/bundle.mjs
git commit -m "feat(desktop): the hook commands run under the app's own binary, and the scripts ship beside the bundle"
```

---

### Task 3: The settings page's state, and serving it over `app://settings/`

**Files:**
- Create: `apps/desktop/src/settings-state.ts`
- Test: `apps/desktop/src/settings-state.test.ts`
- Modify: `apps/desktop/src/scheme.ts`
- Test: `apps/desktop/src/scheme.test.ts`

**Interfaces:**
- Consumes: `type HostState` from `./agent-host`; `type HookStatus` from `./hooks`; `type DetailLevel` from `@clawd/core`.
- Produces: `SettingsState` exactly as the design's §9; `settingsState(input: SettingsInput): SettingsState`; `SETTINGS_HOST = "settings"`; `SETTINGS_URL = "app://settings/"`; `settingsPolicy(): string`; `mapRequest(url: string, dirs: { clawd: string; settings: string }): string | null`.

`mapRequest` gains a second directory rather than a second function: one mapper still decides every `app://` path, and the host chooses which directory it lands in.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/src/settings-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { HostState } from "./agent-host";
import { settingsState } from "./settings-state";

const HOST: HostState = { mode: "own", port: 4750, sessions: 3, waiting: 1, error: null };
const INPUT = {
  host: HOST,
  agentVersion: "0.1.0",
  appVersion: "0.1.0",
  exe: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe",
  allowlist: ["C:\\repos\\one"],
  hooks: "current" as const,
  detail: "none" as const,
  openAtLogin: false,
  logDir: "C:\\Users\\me\\.clawd\\logs",
};

describe("settingsState", () => {
  it("carries the agent, the app, the folders, the hooks, the level and the login choice", () => {
    expect(settingsState(INPUT)).toEqual({
      agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 3, waiting: 1 },
      app: { version: "0.1.0", exe: INPUT.exe },
      allowlist: ["C:\\repos\\one"],
      hooks: "current",
      detail: "none",
      openAtLogin: false,
      logDir: INPUT.logDir,
    });
  });

  it("reports the agent's default port until one is known, and keeps every mode", () => {
    expect(settingsState({ ...INPUT, host: { ...HOST, mode: "starting", port: null } }).agent).toMatchObject({ mode: "starting", port: 4750 });
    for (const mode of ["own", "attached", "restarting", "failed"] as const) {
      expect(settingsState({ ...INPUT, host: { ...HOST, mode } }).agent.mode).toBe(mode);
    }
  });
});
```

In `apps/desktop/src/scheme.test.ts`, replace every `mapRequest(<url>, ROOT)` with `mapRequest(<url>, DIRS)` where `DIRS` is declared after `ROOT`:

```ts
const SETTINGS = resolve("settings-root");
const DIRS = { clawd: ROOT, settings: SETTINGS };
```

Change the case that expects `app://settings/index.html` to be refused so that it maps into the settings directory, and add a test after `mapRequest`'s refusal test:

```ts
describe("the settings host", () => {
  it("serves the settings page from its own directory, and refuses any other host", () => {
    expect(mapRequest("app://settings/", DIRS)).toBe(join(SETTINGS, "index.html"));
    expect(mapRequest("app://settings/page.js", DIRS)).toBe(join(SETTINGS, "page.js"));
    expect(mapRequest("app://other/index.html", DIRS)).toBeNull();
    expect(mapRequest("app://settings/..%2F..%2Fmain.cjs", DIRS)).toBeNull();
  });

  it("gives the settings page a policy that lets it reach nothing", () => {
    expect(settingsPolicy()).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-ancestors 'none'",
    );
  });
});
```

In the handler tests, change `createSchemeHandler({ rendererDir: dir, port: () => 4750 })` to `createSchemeHandler({ dirs: { clawd: dir, settings: dir }, port: () => 4750 })`, and add to the handler describe:

```ts
  it("serves the settings page under its own policy", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.html"), "<p>settings</p>");
    const handle = createSchemeHandler({ dirs: { clawd: dir, settings: dir }, port: () => 4750 });
    const page = await handle({ url: "app://settings/" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(settingsPolicy());
  });
```

Add `settingsPolicy` to the file's imports from `./scheme`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/settings-state.test.ts src/scheme.test.ts`
Expected: FAIL: `./settings-state` does not resolve, and `settingsPolicy` is not exported.

- [ ] **Step 3: Write the state module**

`apps/desktop/src/settings-state.ts`:

```ts
// What the settings page shows. The design's §9 state, built from the host, the agent's config and
// the app itself. Pure, so the page's contents are tested without Electron.
import { DEFAULT_PORT } from "@clawd/agent";
import type { DetailLevel } from "@clawd/core";
import type { HostMode, HostState } from "./agent-host";
import type { HookStatus } from "./hooks";

export type SettingsState = {
  agent: { mode: HostMode; port: number; version: string; sessions: number; waiting: number };
  app: { version: string; exe: string };
  allowlist: string[];
  hooks: HookStatus;
  detail: DetailLevel;
  openAtLogin: boolean;
  logDir: string;
};

export type SettingsInput = {
  host: HostState;
  agentVersion: string;
  appVersion: string;
  exe: string;
  allowlist: readonly string[];
  hooks: HookStatus;
  detail: DetailLevel;
  openAtLogin: boolean;
  logDir: string;
};

export function settingsState(input: SettingsInput): SettingsState {
  return {
    agent: { mode: input.host.mode, port: input.host.port ?? DEFAULT_PORT, version: input.agentVersion, sessions: input.host.sessions, waiting: input.host.waiting },
    app: { version: input.appVersion, exe: input.exe },
    allowlist: [...input.allowlist],
    hooks: input.hooks,
    detail: input.detail,
    openAtLogin: input.openAtLogin,
    logDir: input.logDir,
  };
}
```

- [ ] **Step 4: Teach the scheme the second host**

In `apps/desktop/src/scheme.ts`:

```ts
export const APP_HOST = "clawd";
/** The settings window's host; its page is served from dist/settings (design §7). */
export const SETTINGS_HOST = "settings";
export const SETTINGS_URL = `${APP_SCHEME}://${SETTINGS_HOST}/`;

export type SchemeDirs = { clawd: string; settings: string };
```

Change `mapRequest`'s signature and host check:

```ts
export function mapRequest(url: string, dirs: SchemeDirs): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:`) return null;
  const host = parsed.host.toLowerCase();
  const root = host === APP_HOST ? dirs.clawd : host === SETTINGS_HOST ? dirs.settings : null;
  if (root === null) return null;
```

and use `resolve(root)` where it resolved `rendererDir`. Add, beside `contentSecurityPolicy`:

```ts
/**
 * The settings page talks to main through its preload bridge, never over the network, so it is
 * allowed no connections at all, and no inline scripts.
 */
export function settingsPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
```

Change `SchemeDeps.rendererDir` to `dirs: SchemeDirs`, and in the handler pick the policy by host.

> **Erratum, found in review.** This step first told the handler to pick the policy with
> `request.url.toLowerCase().startsWith(...)`, a second way of answering a question `mapRequest`
> already answers by parsing the URL. The two disagree: `app://clawd@settings/index.html` maps into
> the settings directory but takes the visualiser's policy, so the settings page would be served with
> connections allowed; `app://settings@clawd/index.html` does the reverse; and `app://settingsfoo/`
> matches the prefix although it is a different host. Commit `0304c8d` replaced both with one
> decision, which is what to build:
>
> ```ts
> type AppUrl = { host: string; pathname: string };
>
> /** The host and path of one of our URLs, or null when it does not parse or is not our scheme. */
> function parseAppUrl(url: string): AppUrl | null {
>   let parsed: URL;
>   try {
>     parsed = new URL(url);
>   } catch {
>     return null;
>   }
>   if (parsed.protocol !== `${APP_SCHEME}:`) return null;
>   return { host: parsed.host.toLowerCase(), pathname: parsed.pathname };
> }
>
> /** Which of our hosts a request names, or null. The one place that answers this question. */
> export function hostOf(url: string): string | null {
>   return parseAppUrl(url)?.host ?? null;
> }
> ```
>
> `mapRequest` calls `parseAppUrl` once for the host and the path, and the handler's policy line reads
> `hostOf(request.url) === SETTINGS_HOST ? settingsPolicy() : contentSecurityPolicy(deps.port())`.

```ts
  return async (request) => {
    const policy = { "content-security-policy": hostOf(request.url) === SETTINGS_HOST ? settingsPolicy() : contentSecurityPolicy(deps.port()) };
    const file = mapRequest(request.url, deps.dirs);
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS, once `main.ts`'s call is updated to `dirs`. If `main.ts` still passes `rendererDir`, change that line now to `dirs: distPaths(__dirname)`; Task 6 replaces the file anyway.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/settings-state.ts apps/desktop/src/settings-state.test.ts apps/desktop/src/scheme.ts apps/desktop/src/scheme.test.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): the settings page has a state and its own origin, served under a policy that allows no connections"
```

---

### Task 4: The bridge's messages, validated

> **Erratum, found in review.** This task first guarded the action a handler runs but not the fallback
> it used when that action failed, so a second failure rejected the handler instead of answering, and
> the page was left with nothing to render. The live `getState` reads the agent's config, Claude
> Code's settings file and the login item, so it can fail; for the get-state call the fallback was the
> function that had just failed. Commit `6b6cbb9` gave `createHandlers` a second parameter, the state
> main already holds when it registers the handlers, and has it keep the newest state built
> successfully, so an answer can never reject. The code below already carries the correction; main's
> call in Task 6 passes that starting state. Pin it with tests whose seed differs from the state a
> successful call returns: seeding both with one object passes even against an implementation that
> never tracks the newest state, which is how the first attempt at these tests went wrong.

**Files:**
- Create: `apps/desktop/src/settings/ipc.ts`
- Test: `apps/desktop/src/settings/ipc.test.ts`
- Modify: `apps/desktop/package.json` (zod)

**Interfaces:**
- Consumes: `SettingsState` (Task 3).
- Produces: `CHANNELS`; `SettingsActions`; `createHandlers(actions: SettingsActions): Record<string, (raw: unknown) => Promise<unknown>>`.

Every call from the page arrives as one message with one argument. The handler validates the argument, calls the action, and answers with the new state, so the page never has to ask again. An argument that does not validate changes nothing and returns the current state.

- [ ] **Step 1: Add zod and install**

In `apps/desktop/package.json`, in `devDependencies`, after `@clawd/scene`:

```json
    "zod": "^4.6.2",
```

Run from the repository root: `pnpm install`
Expected: the lockfile's `apps/desktop` importer gains zod; the version matches the agent's.

- [ ] **Step 2: Write the failing tests**

`apps/desktop/src/settings/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SettingsState } from "../settings-state";
import { CHANNELS, createHandlers, type SettingsActions } from "./ipc";

const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 0, waiting: 0 },
  app: { version: "0.1.0", exe: "C:\\app.exe" },
  allowlist: ["C:\\repos\\one"],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  logDir: "C:\\logs",
};

function actions(over: Partial<SettingsActions> = {}) {
  const calls: string[] = [];
  const base: SettingsActions = {
    getState: async () => STATE,
    addFolder: async () => {
      calls.push("addFolder");
      return STATE;
    },
    removeFolder: async (dir) => {
      calls.push(`removeFolder ${dir}`);
      return STATE;
    },
    installHooks: async () => {
      calls.push("installHooks");
      return STATE;
    },
    uninstallHooks: async () => {
      calls.push("uninstallHooks");
      return STATE;
    },
    setDetail: async (level) => {
      calls.push(`setDetail ${level}`);
      return STATE;
    },
    setOpenAtLogin: async (on) => {
      calls.push(`setOpenAtLogin ${on}`);
      return STATE;
    },
    retryAgent: async () => {
      calls.push("retryAgent");
      return STATE;
    },
    openLogs: async () => {
      calls.push("openLogs");
    },
    ...over,
  };
  return { calls, handlers: createHandlers(base) };
}

describe("createHandlers", () => {
  it("has one handler per channel of the bridge", () => {
    const { handlers } = actions();
    expect(Object.keys(handlers).sort()).toEqual(Object.values(CHANNELS).filter((c) => c !== CHANNELS.state).sort());
  });

  it("passes a valid argument through and answers with the state", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.getState]!(undefined)).toEqual(STATE);
    await handlers[CHANNELS.removeFolder]!("C:\\repos\\one");
    await handlers[CHANNELS.setDetail]!("paths");
    await handlers[CHANNELS.setOpenAtLogin]!(true);
    await handlers[CHANNELS.addFolder]!(undefined);
    await handlers[CHANNELS.installHooks]!(undefined);
    await handlers[CHANNELS.uninstallHooks]!(undefined);
    await handlers[CHANNELS.retryAgent]!(undefined);
    expect(calls).toEqual(["removeFolder C:\\repos\\one", "setDetail paths", "setOpenAtLogin true", "addFolder", "installHooks", "uninstallHooks", "retryAgent"]);
  });

  it("refuses an argument of the wrong shape, changes nothing and answers with the state", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.removeFolder]!(42)).toEqual(STATE);
    expect(await handlers[CHANNELS.removeFolder]!("")).toEqual(STATE);
    expect(await handlers[CHANNELS.setDetail]!("everything")).toEqual(STATE);
    expect(await handlers[CHANNELS.setOpenAtLogin]!("yes")).toEqual(STATE);
    expect(calls).toEqual([]);
  });

  it("answers with the state when an action throws, so the page is never left waiting", async () => {
    const { handlers } = actions({
      installHooks: async () => {
        throw new Error("boom");
      },
      getState: async () => STATE,
    });
    expect(await handlers[CHANNELS.installHooks]!(undefined)).toEqual(STATE);
  });

  it("opens the logs and answers with nothing", async () => {
    const { calls, handlers } = actions();
    expect(await handlers[CHANNELS.openLogs]!(undefined)).toBeUndefined();
    expect(calls).toEqual(["openLogs"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/settings/ipc.test.ts`
Expected: FAIL, "Failed to resolve import ./ipc".

- [ ] **Step 4: Write the module**

`apps/desktop/src/settings/ipc.ts`:

```ts
// The settings bridge's messages. The page can only send these names, main validates every
// argument, and each answer is the whole new state, so the page never has to ask again. Electron-free
// and tested over fake actions; main hands the real ones to ipcMain.
import { DetailLevelSchema } from "@clawd/core";
import { z } from "zod";
import type { SettingsState } from "../settings-state";

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

export type SettingsActions = {
  getState(): Promise<SettingsState>;
  addFolder(): Promise<SettingsState>;
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  openLogs(): Promise<void>;
};

const Folder = z.string().min(1);

export function createHandlers(actions: SettingsActions, fallback: SettingsState): Record<string, (raw: unknown) => Promise<unknown>> {
  // The page treats every answer as the whole new state, so a handler must never reject. `last` is
  // the newest state built successfully; it starts as what main knew when it registered these.
  let last: SettingsState = fallback;
  const answer = async (run: () => Promise<SettingsState>): Promise<SettingsState> => {
    try {
      last = await run();
      return last;
    } catch {
      // The action failed. Try to read the state; if that fails too, the page keeps what it last saw.
      try {
        last = await actions.getState();
      } catch {
        // Nothing fresher is available.
      }
      return last;
    }
  };
  const checked = <T>(schema: z.ZodType<T>, run: (value: T) => Promise<SettingsState>) => {
    return async (raw: unknown): Promise<SettingsState> => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return answer(() => actions.getState());
      return answer(() => run(parsed.data));
    };
  };
  return {
    [CHANNELS.getState]: () => answer(() => actions.getState()),
    [CHANNELS.addFolder]: () => answer(() => actions.addFolder()),
    [CHANNELS.removeFolder]: checked(Folder, (dir) => actions.removeFolder(dir)),
    [CHANNELS.installHooks]: () => answer(() => actions.installHooks()),
    [CHANNELS.uninstallHooks]: () => answer(() => actions.uninstallHooks()),
    [CHANNELS.setDetail]: checked(DetailLevelSchema, (level) => actions.setDetail(level)),
    [CHANNELS.setOpenAtLogin]: checked(z.boolean(), (on) => actions.setOpenAtLogin(on)),
    [CHANNELS.retryAgent]: () => answer(() => actions.retryAgent()),
    [CHANNELS.openLogs]: async () => {
      try {
        await actions.openLogs();
      } catch {
        // Opening a folder is a courtesy; a failure must not break the page.
      }
      return undefined;
    },
  };
}
```

- [ ] **Step 5: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/settings/ipc.ts apps/desktop/src/settings/ipc.test.ts
git commit -m "feat(desktop): the settings bridge's messages, each validated, each answering with the whole state"
```

---

### Task 5: Restarting the agent after a config change

**Files:**
- Modify: `apps/desktop/src/agent-host.ts`
- Test: `apps/desktop/src/agent-host.test.ts`

**Interfaces:**
- Produces: `AgentHost.restart(): void`.

A folder edit or a level change writes `config.json`, which the agent reads only at startup. The host gets one more transition for it: stop the agent it owns and start a fresh one, with the fault history cleared, because this is a change the user asked for and not a fault.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/src/agent-host.test.ts`, add inside `describe("createAgentHost")`:

```ts
  it("restarts the agent it owns, so a changed config is read again", async () => {
    const { host, agents, codes } = harness();
    host.start();
    await flush();
    host.restart();
    await flush();
    expect(agents[0]?.stopped).toBe(true);
    expect(agents).toHaveLength(2);
    expect(host.state()).toMatchObject({ mode: "own", port: 4750 });
    expect(codes).toEqual([]);
  });

  it("takes over from an attached agent on a restart, and starts nothing after stop", async () => {
    const attached = harness({ fail: [new PortInUseError(4750)], probe: async () => true });
    attached.host.start();
    await flush();
    attached.host.restart();
    await flush();
    expect(attached.host.state().mode).toBe("own");

    const stopped = harness();
    stopped.host.start();
    await flush();
    await stopped.host.stop();
    stopped.host.restart();
    await flush();
    expect(stopped.starts()).toBe(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/agent-host.test.ts`
Expected: FAIL, `host.restart is not a function`.

- [ ] **Step 3: Add the transition**

In `apps/desktop/src/agent-host.ts`, in `AgentHost`, after `retry()`:

```ts
  /** The user changed the config: stop the agent the app owns and start one that reads it. */
  restart(): void;
```

and in the returned object, after `retry`:

```ts
    restart() {
      queue(async () => {
        if (stopped()) return;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        faults = [];
        await release();
        return attempt();
      });
    },
```

- [ ] **Step 4: Run the checks**

Run: `cd apps/desktop && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/agent-host.ts apps/desktop/src/agent-host.test.ts
git commit -m "feat(desktop): the host restarts the agent it owns when the config changes"
```

---

### Task 6: The window, the bridge, the page, and the wiring

**Files:**
- Create: `apps/desktop/src/settings/preload.ts`
- Create: `apps/desktop/src/settings/page.html`
- Create: `apps/desktop/src/settings/page.ts`
- Modify: `apps/desktop/build/bundle.mjs`
- Modify: `apps/desktop/src/window.ts`
- Modify: `apps/desktop/src/tray.ts`, `apps/desktop/src/tray.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/README.md`, `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1 to 5.
- Produces: `createSettingsWindow(preload: string): BrowserWindow`; `window.clawd` in the settings page; a tray menu with Settings.

`preload.ts`, `page.ts` and `main.ts` have no unit tests on purpose: they are glue. The check is running the app, in step 7.

- [ ] **Step 1: The bridge**

`apps/desktop/src/settings/preload.ts`:

```ts
// Runs before the settings page, in its own world: the page cannot see this code's variables, and
// this code cannot see the page's. `contextBridge` publishes exactly these functions on
// window.clawd, and each one is a message to main. The page has no other way out.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "./ipc";
import type { SettingsState } from "../settings-state";

const invoke = <T>(channel: string, arg?: unknown): Promise<T> => ipcRenderer.invoke(channel, arg) as Promise<T>;

contextBridge.exposeInMainWorld("clawd", {
  getState: () => invoke<SettingsState>(CHANNELS.getState),
  addFolder: () => invoke<SettingsState>(CHANNELS.addFolder),
  removeFolder: (dir: string) => invoke<SettingsState>(CHANNELS.removeFolder, dir),
  installHooks: () => invoke<SettingsState>(CHANNELS.installHooks),
  uninstallHooks: () => invoke<SettingsState>(CHANNELS.uninstallHooks),
  setDetail: (level: SettingsState["detail"]) => invoke<SettingsState>(CHANNELS.setDetail, level),
  setOpenAtLogin: (on: boolean) => invoke<SettingsState>(CHANNELS.setOpenAtLogin, on),
  retryAgent: () => invoke<SettingsState>(CHANNELS.retryAgent),
  openLogs: () => invoke<void>(CHANNELS.openLogs),
  onState: (cb: (s: SettingsState) => void) => {
    const listener = (_event: unknown, state: SettingsState): void => cb(state);
    ipcRenderer.on(CHANNELS.state, listener);
    return () => void ipcRenderer.off(CHANNELS.state, listener);
  },
});
```

- [ ] **Step 2: The page**

`apps/desktop/src/settings/page.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Clawd Visualiser settings</title>
    <link rel="stylesheet" href="page.css" />
  </head>
  <body>
    <main id="app">Loading…</main>
    <script src="page.js"></script>
  </body>
</html>
```

`apps/desktop/src/settings/page.css`:

```css
/* The app's night palette, JetBrains Mono, no framework. */
:root { color-scheme: dark; --bg: #0a0b10; --panel: #141721; --line: #262a3a; --text: #c9ccd6; --dim: #5d6274; --amber: #f2c35b; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.5 "JetBrains Mono", Consolas, monospace; }
main { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; }
h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 0; }
.dim { color: var(--dim); }
.warn { color: var(--amber); }
button { font: inherit; color: var(--text); background: #1f2330; border: 1px solid var(--line); border-radius: 4px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: var(--dim); }
ul { list-style: none; margin: 0; padding: 0; }
code { word-break: break-all; }
```

`apps/desktop/src/settings/page.ts`:

```ts
// The settings page. It renders whatever state the bridge gives it and sends one message per click;
// every decision is main's. No framework, no network: window.clawd is its only way out.
import type { SettingsState } from "../settings-state";

type Api = {
  getState(): Promise<SettingsState>;
  addFolder(): Promise<SettingsState>;
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  openLogs(): Promise<void>;
  onState(cb: (s: SettingsState) => void): () => void;
};
declare const window: { clawd: Api } & Window;

const AGENT_WORDS: Record<SettingsState["agent"]["mode"], string> = {
  starting: "starting",
  own: "running in this app",
  attached: "attached to another agent",
  restarting: "restarting",
  failed: "failed",
};
const DETAIL_WORDS: Record<SettingsState["detail"], string> = { none: "none", hints: "hints", paths: "paths" };
const HOOK_WORDS: Record<SettingsState["hooks"], string> = { missing: "not installed", current: "installed", stale: "installed, pointing elsewhere" };

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

function button(label: string, run: () => Promise<SettingsState | void>): HTMLElement {
  const node = el("button", label) as HTMLButtonElement;
  node.addEventListener("click", () => {
    node.disabled = true;
    void run().then((state) => {
      if (state) render(state);
      node.disabled = false;
    });
  });
  return node;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const node = el("section");
  node.append(el("h2", title), ...rows);
  return node;
}

function row(label: string, value: HTMLElement | string): HTMLElement {
  const node = el("div", undefined, "row");
  node.append(el("span", label), typeof value === "string" ? el("span", value, "dim") : value);
  return node;
}

function render(state: SettingsState): void {
  const app = document.getElementById("app");
  if (app === null) return;
  const folders = el("ul");
  for (const dir of state.allowlist) {
    const item = el("li", undefined, "row");
    item.append(el("code", dir), button("Remove", () => window.clawd.removeFolder(dir)));
    folders.append(item);
  }
  if (state.allowlist.length === 0) folders.append(el("li", "no folders watched yet", "dim"));

  const levels = el("div", undefined, "row");
  for (const level of ["none", "hints", "paths"] as const) {
    levels.append(button(level === state.detail ? `• ${DETAIL_WORDS[level]}` : DETAIL_WORDS[level], () => window.clawd.setDetail(level)));
  }

  app.replaceChildren(
    section("Agent", [
      row("state", `${AGENT_WORDS[state.agent.mode]} · port ${state.agent.port} · version ${state.agent.version}`),
      row("sessions", `${state.agent.sessions} · ${state.agent.waiting} waiting`),
      row("logs", button("Open logs folder", () => window.clawd.openLogs())),
      ...(state.agent.mode === "failed" ? [row("retry", button("Start the agent again", () => window.clawd.retryAgent()))] : []),
    ]),
    section("This app", [row("version", state.app.version), row("runs from", el("code", state.app.exe))]),
    section("Watched folders", [folders, row("", button("Add folder…", () => window.clawd.addFolder()))]),
    section("Hooks", [
      row("status", el("span", HOOK_WORDS[state.hooks], state.hooks === "stale" ? "warn" : "dim")),
      row("", button(state.hooks === "missing" ? "Install hooks" : "Reinstall hooks", () => window.clawd.installHooks())),
      ...(state.hooks === "missing" ? [] : [row("", button("Remove hooks", () => window.clawd.uninstallHooks()))]),
    ]),
    section("Detail level", [row("what the local view shows", levels)]),
    section("Start on login", [row("", button(state.openAtLogin ? "On · turn off" : "Off · turn on", () => window.clawd.setOpenAtLogin(!state.openAtLogin)))]),
  );
}

window.clawd.onState(render);
void window.clawd.getState().then(render);
```

The page uses `document`, `HTMLElement` and `Window`, which the desktop package's type check does not load on purpose: main-process code has no DOM. Give the page its own project file, `apps/desktop/tsconfig.page.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"]
  }
}
```

In `apps/desktop/tsconfig.json`, add `"exclude": ["src/settings/page.ts"]` beside `"include"`, so the main check skips the page. In `apps/desktop/package.json`, change the typecheck script to run both:

```json
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.page.json",
```

- [ ] **Step 3: Build the settings files**

In `apps/desktop/build/bundle.mjs`, after the main build and before the copies:

```js
// The preload runs in Electron's preload world, which is CommonJS; the page is an ordinary script.
await build({
  entryPoints: [here("../src/settings/preload.ts")],
  outfile: here("../dist/settings/preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "info",
});
await build({
  entryPoints: [here("../src/settings/page.ts")],
  outfile: here("../dist/settings/page.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  logLevel: "info",
});
await cp(here("../src/settings/page.html"), here("../dist/settings/index.html"));
await cp(here("../src/settings/page.css"), here("../dist/settings/page.css"));
```

- [ ] **Step 4: The window and the tray item**

In `apps/desktop/src/window.ts`, add:

```ts
export const SETTINGS_SIZE = { width: 560, height: 720 } as const;

/**
 * The settings window. It is sandboxed like the visualiser, but with a preload: the one place the
 * app gives a page a way to ask main for something. It loads app://settings/ and nothing else.
 */
export function createSettingsWindow(preload: string): BrowserWindow {
  const win = new BrowserWindow({
    width: SETTINGS_SIZE.width,
    height: SETTINGS_SIZE.height,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    title: "Clawd Visualiser settings",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload },
  });
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, target) => {
    if (!sameOrigin(SETTINGS_URL, target)) event.preventDefault();
  });
  void win.loadURL(SETTINGS_URL);
  return win;
}
```

with `SETTINGS_URL` added to the `./scheme` import.

In `apps/desktop/src/tray.ts`, add `settings(): void;` to `TrayActions` and the item to the template, after Open:

```ts
    { label: "Settings", click: () => actions.settings() },
```

In `apps/desktop/src/tray.test.ts`, add `settings: () => void calls.push("settings")` to the recorder, change the expected labels to `["Open", "Settings", "Start on login", "separator", "Quit"]`, and move the indexes in the click test to match: Open is 0, Settings 1, Start on login 2, Quit 4.

- [ ] **Step 5: Wire the main process**

In `apps/desktop/src/main.ts`:

1. Add to the imports:

```ts
import { AGENT_VERSION, agentPaths, defaultSettingsPath, installHooks, readConfig, readJsonFile, removeFromAllowlist, setAllowlist, setDetail, uninstall, type JsonObject } from "@clawd/agent";
import { dialog, ipcMain, shell } from "electron";
import { expectedCommands, hookStatus, repairOnLaunch, runtimePrefix, type HookStatus } from "./hooks";
import { distPaths } from "./paths";
import { settingsState, type SettingsState } from "./settings-state";
import { CHANNELS, createHandlers } from "./settings/ipc";
import { createMainWindow, createSettingsWindow } from "./window";
```

2. After `const login = loginItemTarget(...)`, add:

```ts
  const dist = distPaths(__dirname);
  const settingsPath = defaultSettingsPath();
  const runtime = runtimePrefix(process.execPath);
  let settingsWin: BrowserWindow | null = null;
```

3. Replace the `protocol.handle` call's argument with `{ dirs: dist, port: () => host.state().port ?? DEFAULT_PORT }`, and the tray image path with `join(dist.tray, file)`, and the window's renderer directory with `dist.renderer`.

4. Add these functions inside `run()`, beside the tray ones:

```ts
  /** The agent's own installer options, which say what the hooks should run. */
  async function hookOptions(): Promise<{ runtime: string; binDir: string; port: number; token: string } | null> {
    const config = await readConfig(agentPaths(home)).catch(() => null);
    if (config === null) return null;
    return { runtime, binDir: agentPaths(home).bin, port: config.port, token: config.token };
  }

  async function currentHookStatus(): Promise<HookStatus> {
    const opts = await hookOptions();
    if (opts === null) return "missing";
    const file = await readJsonFile(settingsPath).catch(() => ({ found: false }) as const);
    const settings = file.found && file.ok ? (file.value as JsonObject) : null;
    return hookStatus(settings, expectedCommands(opts));
  }

  async function currentState(): Promise<SettingsState> {
    const config = await readConfig(agentPaths(home)).catch(() => null);
    return settingsState({
      host: host.state(),
      agentVersion: AGENT_VERSION,
      appVersion: app.getVersion(),
      exe: process.execPath,
      allowlist: config?.allowlist ?? [],
      hooks: await currentHookStatus(),
      detail: config?.detail ?? "none",
      openAtLogin: openAtLogin(),
      logDir: agentPaths(home).logs,
    });
  }

  /** After a config change the agent reads it again, and the page hears about the new state. */
  function pushState(): void {
    void currentState().then((state) => {
      if (settingsWin !== null && !settingsWin.isDestroyed()) settingsWin.webContents.send(CHANNELS.state, state);
    });
  }

  function showSettings(): void {
    if (settingsWin !== null && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
      return;
    }
    settingsWin = createSettingsWindow(join(dist.settings, "preload.js"));
    settingsWin.on("closed", () => {
      settingsWin = null;
    });
  }
```

5. Register the handlers inside the ready handler, after the tray is built:

```ts
    for (const [channel, handler] of Object.entries(
      createHandlers({
        getState: currentState,
        async addFolder() {
          const picked = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Watch a folder" });
          const dir = picked.canceled ? null : (picked.filePaths[0] ?? null);
          if (dir !== null) {
            const saved = await setAllowlist({ home, add: [dir], cwd: home });
            if (saved.ok) host.restart();
          }
          return currentState();
        },
        async removeFolder(dir) {
          const config = await readConfig(agentPaths(home));
          if (config !== null) {
            await setAllowlist({ home, remove: dir, cwd: home });
            host.restart();
          }
          return currentState();
        },
        async installHooks() {
          await installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now });
          return currentState();
        },
        async uninstallHooks() {
          await uninstall({ home, settingsPath, now: Date.now, print: () => {} });
          return currentState();
        },
        async setDetail(level) {
          await setDetail({ home, level, print: () => {} });
          host.restart();
          return currentState();
        },
        async setOpenAtLogin(on) {
          setOpenAtLogin(on);
          return currentState();
        },
        async retryAgent() {
          host.retry();
          return currentState();
        },
        async openLogs() {
          await shell.openPath(agentPaths(home).logs);
        },
      }),
    )) {
      ipcMain.handle(channel, (_event, arg: unknown) => handler(arg));
    }

    // Our hooks pointing at another folder are rewritten, so a moved app keeps receiving events.
    const status = await currentHookStatus();
    if (repairOnLaunch(status)) {
      await installHooks({ home, settingsPath, runtime, hooksDir: dist.hooks, now: Date.now });
      log("desktop.hooksRepaired");
    }
```

6. In the host's `onChange`, add `pushState();` after `refreshTray(state)`. In `refreshMenu`, pass `settings: showSettings` in the actions object. In `setOpenAtLogin`, add `pushState();` after `refreshMenu()`.

- [ ] **Step 6: Bundle and check**

Run: `cd apps/desktop && pnpm typecheck && npx vitest run && pnpm bundle`
Expected: no type errors from either project, every test passes, and esbuild writes `dist/main.cjs`, `dist/settings/preload.js` and `dist/settings/page.js`.

Run from the repository root: `grep -cE 'require\("(zod|@clawd/[a-z]+)"\)' apps/desktop/dist/main.cjs`
Expected: `0`.

- [ ] **Step 7: Run the app and walk the checklist (pause here for the maintainer)**

Use a scratch home so the real one is untouched, and stop any CLI agent first:

```
$env:CLAWD_HOME = "$env:TEMP\clawd-stage5"
$env:CLAUDE_CONFIG_DIR = "$env:TEMP\clawd-stage5-claude"
New-Item -ItemType Directory -Force $env:CLAUDE_CONFIG_DIR | Out-Null
pnpm --filter @clawd/desktop start
```

Check each:

- **The window.** The tray menu has Open, Settings, Start on login, Quit. Settings opens a 560 by 720 window in the app's colours, with the six sections.
- **The agent section** names the port, the version and the counts, and they follow the app while it runs.
- **Watched folders.** Add folder opens a folder picker. Pick a repository: it appears in the list, `config.json` in the scratch home holds it, and the log shows the agent stopping and starting. Remove takes it out again, the same way.
- **Hooks.** Status reads "not installed". Install hooks writes them: `Get-Content "$env:CLAUDE_CONFIG_DIR\settings.json"` shows a SessionStart command hook and a status line whose commands both begin `ELECTRON_RUN_AS_NODE=1` and point at the scratch home's `bin`, and `$env:CLAWD_HOME\bin` holds the three `.mjs` files. The status then reads "installed".
- **The hooks work under the app's binary.** With the folder watched and the hooks installed, start a Claude Code session in that folder using the scratch Claude directory. A Clawd appears in the visualiser window, and the status line still renders. Time one hook: `Measure-Command { ... }` over the written command with an empty payload on stdin stays well inside the two second timeout. Record the number in the stage note.
- **Repair.** Quit. Edit the settings file so the hook command names a different exe, then start the app again. The log gains `desktop.hooksRepaired`, and the file's commands point back at this app.
- **Detail level.** Set paths, then none. `config.json` follows, the agent restarts each time, and the sheet in the visualiser shows or hides the extra detail.
- **Start on login** ticks and unticks from this window as it does from the tray, and the two agree.
- **Remove hooks** takes the hooks and the status line out again, leaving the backup beside the settings file.
- **The page is sealed.** In the settings window's DevTools console, `window.require`, `window.process` and `window.module` are all undefined, `window.clawd` holds exactly the ten functions, and `fetch("http://127.0.0.1:4750/api/health")` is refused by the policy.
- Remove the scratch variables with `Remove-Item Env:CLAWD_HOME, Env:CLAUDE_CONFIG_DIR` and delete both scratch folders.

- [ ] **Step 8: Update the READMEs**

In `apps/desktop/README.md`, add to the Run section, after the paragraph about the tray:

```markdown
Settings opens from the tray. It watches folders, installs Claude Code's hooks under this app's own
binary, sets the detail level and toggles start on login, so a machine can be set up from the app
alone. `CLAWD_HOME` and `CLAUDE_CONFIG_DIR` point it at scratch folders while testing.
```

Append after the Stage 4 note:

```markdown
### Stage 5: the settings window

Every window so far was a sandboxed page that could only reach the agent over HTTP. The settings
window has to do things a page must never do by itself: open a folder picker, write Claude Code's
settings file, change the login item.

**The preload bridge.** A preload script runs before the page, in its own world: it cannot see the
page's variables, and the page cannot see its. `contextBridge.exposeInMainWorld` publishes exactly
the functions in `settings/preload.ts` as `window.clawd`, and each one is an `ipcRenderer.invoke`
message. The page stays sandboxed with no Node access; `window.require` and `window.process` are
undefined in it.

**Main is the only privileged side.** `settings/ipc.ts` names one channel per call, validates every
argument with zod, and answers with the whole new state, so the page never asks twice. An argument
that does not validate changes nothing. Everything that touches the disk, the registry or the agent
happens in main, over injected actions that are tested without Electron.

**Hooks under the app's binary.** With `ELECTRON_RUN_AS_NODE=1` the app's own exe runs as plain Node,
so Claude Code's hooks need no Node install: the written command is that prefix plus the script in
`~/.clawd/bin`. The installer takes this prefix as a string now, which is the only change the agent
needed. At launch the app compares the commands in the settings file with the ones it would write:
ours pointing elsewhere are rewritten and logged as `desktop.hooksRepaired`, so a moved folder
repairs itself; hooks that were never installed wait for this window.

**Its own origin.** The page is served from `app://settings/`, beside the visualiser's `app://clawd/`,
under a stricter policy: it may load only its own files and may open no connections at all, because
it talks to main through the bridge.

What stage 5 leaves in place: everything a teammate needs except packaging, which is stage 6.
```

In the root `README.md` layout table, replace the `apps/desktop` row with:

```markdown
| `apps/desktop` | The Electron app, built in stages: the agent and the visualiser in one window and the tray, run from a folder. Stage 5 adds the settings window, which watches folders and installs the hooks under the app's own binary. See its README. |
```

- [ ] **Step 9: Run every check and commit**

Run from the repository root: `pnpm test && pnpm typecheck`
Expected: PASS across the workspace.

```bash
git add apps/desktop/src/settings apps/desktop/src/window.ts apps/desktop/src/tray.ts apps/desktop/src/tray.test.ts apps/desktop/src/main.ts apps/desktop/build/bundle.mjs apps/desktop/README.md README.md
git commit -m "feat(desktop): a settings window sets the machine up from the app alone, over a validated preload bridge"
```

Then hand the branch back with the finishing-a-development-branch skill. Stage 6 (packaging) starts from `main` once this is merged, and must settle the development and packaged login item collision recorded in the design's §12.1.
