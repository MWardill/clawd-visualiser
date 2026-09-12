import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, SettingsShapeError, applyInstall, applyUninstall, isOurHook, isOurStatusLine, type InstallOptions, type JsonObject } from "./settings";

const OPTS: InstallOptions = { port: 4750, token: "t".repeat(64), binDir: "C:\\Users\\me\\.clawd\\bin\\", node: "C:\\Program Files\\nodejs\\node.exe" };
const HTTP = { type: "http", url: "http://127.0.0.1:4750/ingest/hook", headers: { "x-clawd-token": OPTS.token }, timeout: 2 };
const HOOK_CMD = '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.clawd/bin/clawd-hook.mjs"';
const STATUS_CMD = '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.clawd/bin/clawd-statusline.mjs"';
const hooksOf = (settings: JsonObject): JsonObject => settings.hooks as JsonObject;

describe("applyInstall", () => {
  it("adds every modelled event and a status line to empty settings", () => {
    const r = applyInstall({}, OPTS);
    expect(Object.keys(hooksOf(r.settings))).toEqual([...HOOK_EVENTS]);
    expect(hooksOf(r.settings).SessionStart).toEqual([{ hooks: [HTTP, { type: "command", command: HOOK_CMD, timeout: 2 }] }]);
    expect(hooksOf(r.settings).PermissionRequest).toEqual([{ hooks: [HTTP] }]);
    expect(r.settings.statusLine).toEqual({ type: "command", command: STATUS_CMD });
    expect(r).toMatchObject({ newlyWrapped: null, statusLine: "added" });
    expect(HOOK_EVENTS).not.toContain("MessageDisplay");
    expect(HOOK_EVENTS).not.toContain("Notification");
  });

  it("keeps other settings and other hooks, appending its own group after them", () => {
    const settings = {
      env: { SECRET: "x" },
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        Notification: [{ hooks: [{ type: "command", command: "notify.sh" }] }],
      },
    };
    const r = applyInstall(settings, OPTS);
    expect(Object.keys(r.settings)).toEqual(["env", "permissions", "hooks", "statusLine"]);
    expect(r.settings.env).toEqual(settings.env);
    expect(hooksOf(r.settings).PreToolUse).toEqual([settings.hooks.PreToolUse[0], { hooks: [HTTP] }]);
    expect(hooksOf(r.settings).Notification).toEqual(settings.hooks.Notification);
  });

  it("is idempotent and replaces its own hooks when the port changes", () => {
    const once = applyInstall({}, OPTS).settings;
    expect(applyInstall(once, OPTS).settings).toEqual(once);
    const moved = applyInstall(once, { ...OPTS, port: 4800 }).settings;
    expect(hooksOf(moved).Stop).toEqual([{ hooks: [{ ...HTTP, url: "http://127.0.0.1:4800/ingest/hook" }] }]);
  });

  it("wraps an existing status line verbatim and keeps its other fields", () => {
    const original = { type: "command", command: "~/.claude/statusline.sh", padding: 2 };
    const r = applyInstall({ statusLine: original }, OPTS);
    expect(r).toMatchObject({ newlyWrapped: original, statusLine: "wrapped" });
    expect(r.settings.statusLine).toEqual({ type: "command", command: STATUS_CMD, padding: 2 });
    const again = applyInstall(r.settings, OPTS);
    expect(again).toMatchObject({ newlyWrapped: null, statusLine: "kept" });
    expect(again.settings.statusLine).toEqual(r.settings.statusLine);
  });

  it.each([
    [{ hooks: "x" }, "hooks"],
    [{ hooks: [] }, "hooks"],
    [{ hooks: { Stop: {} } }, "hooks.Stop"],
    [{ statusLine: "x" }, "statusLine"],
    [{ statusLine: { type: "command" } }, "statusLine.command"],
  ])("refuses malformed settings %j", (settings, where) => {
    expect(() => applyInstall(settings as JsonObject, OPTS)).toThrow(SettingsShapeError);
    expect(() => applyInstall(settings as JsonObject, OPTS)).toThrow(where);
  });
});

describe("applyUninstall", () => {
  it("restores the original settings exactly, key order included", () => {
    const original = {
      env: { A: "1" },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }],
        Stop: [{ hooks: [{ type: "http", url: "http://127.0.0.1:4747/Stop" }] }],
      },
      statusLine: { type: "command", command: "~/.claude/statusline.sh", padding: 1 },
    };
    const installed = applyInstall(original, OPTS);
    const restored = applyUninstall(installed.settings, installed.newlyWrapped ?? undefined);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
  });

  it("removes its status line and an emptied hooks key when nothing was wrapped", () => {
    expect(applyUninstall(applyInstall({ model: "opus" }, OPTS).settings, undefined)).toEqual({ model: "opus" });
  });

  it("changes nothing in settings that hold none of its entries", () => {
    const settings = { hooks: {}, statusLine: { type: "command", command: "mine.sh" } };
    expect(applyUninstall(settings, undefined)).toEqual(settings);
  });

  it("keeps a hooks key named __proto__ through install and uninstall", () => {
    const original = JSON.parse('{"hooks":{"__proto__":[{"hooks":[{"type":"command","command":"odd.sh"}]}]}}') as JsonObject;
    const installed = applyInstall(original, OPTS);
    expect(Object.hasOwn(installed.settings.hooks as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(installed.settings.hooks)).toBe(Object.prototype);
    const restored = applyUninstall(installed.settings, undefined);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
  });
});

describe("recognising its own entries", () => {
  it("matches only its own hooks and status line", () => {
    expect(isOurHook({ type: "http", url: "http://127.0.0.1:4750/ingest/hook" })).toBe(true);
    expect(isOurHook({ type: "http", url: "http://127.0.0.1:4750/ingest/hookx" })).toBe(false);
    expect(isOurHook({ type: "http", url: "http://localhost:4750/ingest/hook" })).toBe(false);
    expect(isOurHook({ type: "http", url: "http://127.0.0.1:4747/Stop" })).toBe(false);
    expect(isOurHook({ type: "command", command: '"node" "C:/x/clawd-hook.mjs"' })).toBe(true);
    expect(isOurHook({ type: "command", command: "other.mjs" })).toBe(false);
    expect(isOurHook(null)).toBe(false);
    expect(isOurStatusLine({ type: "command", command: '"node" "C:/x/clawd-statusline.mjs"' })).toBe(true);
    expect(isOurStatusLine({ type: "command", command: "mine.sh" })).toBe(false);
  });
});
