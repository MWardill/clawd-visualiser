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
