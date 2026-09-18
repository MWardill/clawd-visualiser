import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentPaths, applyInstall, defaultConfig, saveConfig } from "@clawd/agent";
import { currentHookStatus, installedExe, readConfigState, repairOnLaunch, runtimePrefix, samePath, scriptsMatch, type ConfigRead } from "./hooks";

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

describe("samePath", () => {
  it("compares the way Windows does: slashes either way, no case, no trailing slash", () => {
    expect(samePath("C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe", "c:/apps/clawd visualiser/clawd visualiser.exe")).toBe(true);
    expect(samePath("C:/Apps/", "C:\\Apps")).toBe(true);
    expect(samePath("C:/Apps/One/app.exe", "C:/Apps/Two/app.exe")).toBe(false);
  });
});

describe("repairOnLaunch", () => {
  const base = { status: "stale" as const, packaged: true, installedExe: "C:/Apps/Clawd Visualiser/Clawd Visualiser.exe", installedExeExists: true, thisExe: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe" };

  it("repairs stale hooks that name this exe, however the path is spelled", () => {
    expect(repairOnLaunch(base)).toBe(true);
    expect(repairOnLaunch({ ...base, installedExe: "c:/apps/clawd visualiser/clawd visualiser.exe" })).toBe(true);
  });

  it("repairs stale hooks that name an exe that no longer exists, as after the folder moved", () => {
    expect(repairOnLaunch({ ...base, installedExe: "C:/Apps/Old/Clawd Visualiser.exe", installedExeExists: false })).toBe(true);
  });

  it("leaves a live install by another exe alone, so two installs never take turns", () => {
    expect(repairOnLaunch({ ...base, installedExe: "C:/Program Files/nodejs/node.exe" })).toBe(false);
    expect(repairOnLaunch({ ...base, installedExe: "D:/Other/Clawd Visualiser.exe" })).toBe(false);
  });

  it("repairs stale hooks with no command of ours, and never anything that is not stale or not packaged", () => {
    expect(repairOnLaunch({ ...base, installedExe: null, installedExeExists: false })).toBe(true);
    for (const status of ["current", "missing", "unreadable"] as const) expect(repairOnLaunch({ ...base, status })).toBe(false);
    expect(repairOnLaunch({ ...base, packaged: false })).toBe(false);
  });
});

describe("installedExe", () => {
  it("reads the exe our command names, and null when the file is missing, unreadable or has no command of ours", async () => {
    const settingsPath = join(await tempDir(), "settings.json");
    expect(await installedExe(settingsPath)).toBeNull();
    await writeFile(settingsPath, "{ nope");
    expect(await installedExe(settingsPath)).toBeNull();
    await writeFile(settingsPath, "{}");
    expect(await installedExe(settingsPath)).toBeNull();
    await writeFile(settingsPath, JSON.stringify(applyInstall({}, { port: 4750, token: "c".repeat(64), binDir: "C:\\h\\bin", runtime: runtimePrefix("C:\\Apps\\app.exe") }).settings));
    expect(await installedExe(settingsPath)).toBe("C:/Apps/app.exe");
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
