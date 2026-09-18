import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, agentPaths, defaultConfig, readConfig, saveConfig } from "../config";
import { useTempDirs } from "../testing/tmp";
import { install, installHooks, mergeAllowlist, removeFromAllowlist, setAllowlist, uninstall, uninstallHooks } from "./installer";
import { HOOK_SCRIPTS, hookCommand, hookStatus, nodeRuntime, statusCommand, type InstallOptions, type JsonObject } from "./settings";

const HOOKS = fileURLToPath(new URL("../../hooks/", import.meta.url));
const NOW = Date.UTC(2026, 8, 12, 10, 0, 0);

describe("mergeAllowlist", () => {
  it("resolves against the working directory and does not repeat a directory", () => {
    const cwd = process.platform === "win32" ? "C:\\base" : "/base";
    const r = mergeAllowlist([join(cwd, "a")], ["a", "b", join(cwd, "B").toUpperCase()], cwd);
    expect(r).toEqual({ ok: true, allowlist: [join(cwd, "a"), join(cwd, "b")] });
  });

  it("refuses blanks, roots and an empty result", () => {
    const cwd = process.platform === "win32" ? "C:\\base" : "/base";
    expect(mergeAllowlist([], ["  "], cwd)).toMatchObject({ ok: false });
    expect(mergeAllowlist([], [parse(cwd).root], cwd)).toMatchObject({ ok: false });
    const empty = mergeAllowlist([], [], cwd);
    expect(empty).toMatchObject({ ok: false });
    expect(empty.ok ? "" : empty.message).toContain("--allow");
  });
});

describe("install and uninstall", () => {
  const tempDir = useTempDirs();

  async function setup(settings?: string) {
    const root = await tempDir();
    const home = join(root, "clawd");
    const settingsPath = join(root, "claude", "settings.json");
    await mkdir(join(root, "work"));
    if (settings !== undefined) {
      await mkdir(dirname(settingsPath), { recursive: true });
      await writeFile(settingsPath, settings);
    }
    const lines: string[] = [];
    const base = {
      home,
      settingsPath,
      hooksDir: HOOKS,
      cwd: root,
      runtime: nodeRuntime("C:\\node\\node.exe"),
      now: () => NOW,
      print: (line: string) => lines.push(line),
      probe: async () => false,
    };
    return { root, home, settingsPath, lines, base };
  }

  const readJson = async (path: string): Promise<JsonObject> => JSON.parse(await readFile(path, "utf8")) as JsonObject;

  it("installs into a machine with no settings and no agent home", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(0);
    const config = await readConfig(agentPaths(t.home));
    expect(config?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(config?.allowlist).toEqual([join(t.root, "work")]);
    const settings = await readJson(t.settingsPath);
    const stop = (settings.hooks as JsonObject).Stop as { hooks: { headers: Record<string, string> }[] }[];
    expect(stop[0]?.hooks[0]?.headers["x-clawd-token"]).toBe(config?.token);
    expect((await readdir(join(t.home, "bin"))).sort()).toEqual([...HOOK_SCRIPTS].sort());
    expect(await readdir(dirname(t.settingsPath))).toEqual(["settings.json"]);
    expect(t.lines.join("\n")).toContain("start the agent");
    expect(t.lines.join("\n")).not.toContain(config?.token ?? "no token");
  });

  it("backs up existing settings byte for byte, wraps the status line and prints no settings content", async () => {
    const original = '{\n    "env": { "API_KEY": "SECRET-VALUE" },\n    "statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "padding": 0 }\n}\n';
    const t = await setup(original);
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(0);
    expect(await readFile(`${t.settingsPath}.clawd-backup-20260912100000`, "utf8")).toBe(original);
    const config = await readConfig(agentPaths(t.home));
    expect(config?.wrappedStatusLine).toEqual({ type: "command", command: "~/.claude/statusline.sh", padding: 0 });
    const settings = await readJson(t.settingsPath);
    expect(settings.env).toEqual({ API_KEY: "SECRET-VALUE" });
    expect(t.lines.join("\n")).not.toContain("SECRET-VALUE");
  });

  it.each([
    ["not JSON", "{ nope"],
    ["not an object", "[1, 2]"],
    ["a malformed hooks entry", '{"hooks": {"Stop": {}}}'],
  ])("changes nothing when the settings file is %s", async (_label, text) => {
    const t = await setup(text);
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(1);
    expect(await readFile(t.settingsPath, "utf8")).toBe(text);
    expect(existsSync(t.home)).toBe(false);
    expect(await readdir(dirname(t.settingsPath))).toEqual(["settings.json"]);
  });

  it("writes nothing on a dry run", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: ["work"], dryRun: true })).toBe(0);
    expect(existsSync(t.home)).toBe(false);
    expect(existsSync(t.settingsPath)).toBe(false);
    expect(t.lines.every((line) => line.startsWith("dry run"))).toBe(true);
  });

  it("refuses to install with no allowlist", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(1);
    expect(t.lines.join("\n")).toContain("--allow");
    expect(existsSync(t.settingsPath)).toBe(false);
  });

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
    // A hand edit makes the next install write again, and its backup takes the next free name. An
    // unrelated field would round-trip through the spread untouched, so this corrupts something the
    // install itself manages: the port baked into the first http hook's URL.
    await writeFile(t.settingsPath, first.replace(":4750/", ":4751/"));
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

  it("forgets a wrapped status line the settings no longer have, and keeps one they still point at", async () => {
    const t = await setup(JSON.stringify({ statusLine: { type: "command", command: "mine.sh" } }));
    expect(await install({ ...t.base, allow: ["work"], dryRun: false })).toBe(0);
    let config = await readConfig(agentPaths(t.home));
    expect(config?.wrappedStatusLine).toEqual({ type: "command", command: "mine.sh" });

    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    config = await readConfig(agentPaths(t.home));
    expect(config?.wrappedStatusLine).toEqual({ type: "command", command: "mine.sh" });

    await writeFile(t.settingsPath, "{}");
    expect(await install({ ...t.base, allow: [], dryRun: false })).toBe(0);
    expect((await readConfig(agentPaths(t.home)))?.wrappedStatusLine).toBeUndefined();
  });

  it("tells the user to restart an agent that is already running", async () => {
    const t = await setup();
    expect(await install({ ...t.base, allow: ["work"], dryRun: false, probe: async () => true })).toBe(0);
    expect(t.lines.join("\n")).toContain("restart");
  });

  it("sets the allowlist and installs the hooks separately, as the settings window does", async () => {
    const t = await setup();
    const allowed = join(t.root, "work");
    const runtime = nodeRuntime("C:\\node.exe");
    expect(await setAllowlist({ home: t.home, add: [allowed], cwd: t.root })).toEqual({ ok: true, allowlist: [allowed] });
    const hooks = await installHooks({ home: t.home, settingsPath: t.settingsPath, runtime, hooksDir: HOOKS, now: () => NOW });
    expect(hooks.ok).toBe(true);
    const settings = JSON.parse(await readFile(t.settingsPath, "utf8")) as JsonObject;
    // Only the prefix and the bin directory shape the two commands.
    const opts: InstallOptions = { port: DEFAULT_PORT, token: "t".repeat(64), binDir: agentPaths(t.home).bin, runtime };
    expect(hookStatus(settings, { hook: hookCommand(opts), status: statusCommand(opts) })).toBe("current");
    expect(removeFromAllowlist([allowed], allowed)).toEqual([]);
  });

  it("removing the last folder saves an allowlist with nothing in it, as the settings window does", async () => {
    const t = await setup();
    const allowed = join(t.root, "work");
    expect(await setAllowlist({ home: t.home, add: [allowed], cwd: t.root })).toEqual({ ok: true, allowlist: [allowed] });
    expect(await setAllowlist({ home: t.home, remove: allowed, cwd: t.root })).toEqual({ ok: true, allowlist: [] });
    const config = await readConfig(agentPaths(t.home));
    expect(config?.allowlist).toEqual([]);
  });

  it("removing a folder that is not in the list leaves the allowlist as it was", async () => {
    const t = await setup();
    const allowed = join(t.root, "work");
    const other = join(t.root, "other");
    expect(await setAllowlist({ home: t.home, add: [allowed], cwd: t.root })).toEqual({ ok: true, allowlist: [allowed] });
    expect(await setAllowlist({ home: t.home, remove: other, cwd: t.root })).toEqual({ ok: true, allowlist: [allowed] });
    const config = await readConfig(agentPaths(t.home));
    expect(config?.allowlist).toEqual([allowed]);
  });

  it("setAllowlist still refuses a blank addition and a filesystem root, and saves nothing", async () => {
    const t = await setup();
    expect(await setAllowlist({ home: t.home, add: ["  "], cwd: t.root })).toMatchObject({ ok: false });
    expect(await setAllowlist({ home: t.home, add: [parse(t.root).root], cwd: t.root })).toMatchObject({ ok: false });
    expect(await readConfig(agentPaths(t.home))).toBeNull();
  });

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
});
