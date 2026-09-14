import { describe, expect, it } from "vitest";
import { RawAgentEntryDetailSchema, RawHookDetailSchema, RawStatusLineDetailSchema } from "../schema/raw";
import { agentType, dir, ext, hookDetail, host, label, permissionMode, presenceDetail, program, relative, statusDetail } from "./detail";

const cwd = "C:\\mw\\visualiser";
const hook = (extra: Record<string, unknown>) => RawHookDetailSchema.parse({ session_id: "s1", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t1", ...extra });

describe("derivations", () => {
  it("names the program a shell command runs", () => {
    expect(program("git status")).toBe("git");
    expect(program("  pnpm  test")).toBe("pnpm");
    expect(program("FOO=1 BAR=x node script.js")).toBe("node");
    expect(program('"C:\\Program Files\\Git\\bin\\git.exe" log')).toBe("git");
    expect(program("'./scripts/run.sh' --flag")).toBe("run.sh");
    expect(program("C:/tools/build.cmd all")).toBe("build");
    expect(program("cd x && git status")).toBe("cd");
    expect(program("")).toBeUndefined();
    expect(program("FOO=1")).toBeUndefined();
    expect(program("a".repeat(33))).toBeUndefined();
    expect(program("we!rd")).toBeUndefined();
  });

  it("takes a file's extension, lower case, and none for dotfiles or bare names", () => {
    expect(ext("C:\\mw\\visualiser\\src\\App.TSX")).toBe("tsx");
    expect(ext("notes.md")).toBe("md");
    expect(ext("archive.tar.gz")).toBe("gz");
    expect(ext(".env")).toBeUndefined();
    expect(ext("Makefile")).toBeUndefined();
    expect(ext("trailing.")).toBeUndefined();
    expect(ext("x.this-has-a-dash")).toBeUndefined();
  });

  it("takes a URL's hostname and nothing else", () => {
    expect(host("https://example.com/secret/path?q=secret")).toBe("example.com");
    expect(host("http://[::1]:8080/x")).toBe("[::1]");
    expect(host("not a url")).toBeUndefined();
    expect(host("mailto:someone@example.com")).toBeUndefined();
  });

  it("bounds the agent type and the permission mode", () => {
    expect(agentType("general-purpose")).toBe("general-purpose");
    expect(agentType("engg-skills-generic:engg-qa")).toBe("engg-skills-generic:engg-qa");
    expect(agentType("bad type")).toBeUndefined();
    expect(permissionMode("acceptEdits")).toBe("acceptEdits");
    expect(permissionMode("bypass-permissions")).toBeUndefined();
  });

  it("normalises a directory and makes a file relative to it", () => {
    expect(dir("C:\\mw\\visualiser\\")).toBe("C:/mw/visualiser");
    expect(dir("/home/me/repo")).toBe("/home/me/repo");
    expect(dir("/")).toBe("/");
    expect(relative("C:\\mw\\visualiser\\src\\app.ts", cwd)).toBe("src/app.ts");
    expect(relative("c:/MW/Visualiser/src/app.ts", cwd)).toBe("src/app.ts");
    expect(relative("C:\\mw\\visualiser", cwd)).toBe(".");
    expect(relative("C:\\mw\\visualiser-web\\src\\app.ts", cwd)).toBe("C:/mw/visualiser-web/src/app.ts");
    expect(relative("\\\\server\\share\\file.txt", cwd)).toBe("//server/share/file.txt");
    expect(relative("", cwd)).toBeUndefined();
    expect(relative(`C:\\mw\\visualiser\\${"x".repeat(600)}`, cwd)).toHaveLength(512);
  });

  it("cleans free text: no control characters, trimmed, cut, none when empty", () => {
    expect(label("  Fix login \u001b[2J ")).toBe("Fix login [2J");
    expect(label("\u0000")).toBeUndefined();
    expect(label("x".repeat(200))).toHaveLength(120);
  });
});

describe("hookDetail", () => {
  it("yields nothing at none", () => {
    expect(hookDetail("none", hook({ tool_input: { command: "git status" }, permission_mode: "default" }))).toBeUndefined();
  });

  it("yields hints from the input's shape, never its content", () => {
    expect(hookDetail("hints", hook({ tool_input: { command: "git status secret-arg", description: "Show status" }, permission_mode: "default" }))).toEqual({ program: "git", permissionMode: "default" });
    expect(hookDetail("hints", hook({ tool_name: "Write", tool_input: { file_path: "C:\\mw\\visualiser\\src\\app.ts", content: "secret" } }))).toEqual({ ext: "ts" });
    expect(hookDetail("hints", hook({ tool_name: "NotebookEdit", tool_input: { notebook_path: "C:\\mw\\visualiser\\nb.ipynb" } }))).toEqual({ ext: "ipynb" });
    expect(hookDetail("hints", hook({ tool_name: "WebFetch", tool_input: { url: "https://example.com/secret", prompt: "secret" } }))).toEqual({ host: "example.com" });
    expect(hookDetail("hints", hook({ tool_name: "Agent", tool_input: { subagent_type: "Explore", description: "Find the thing", prompt: "secret" } }))).toEqual({ agent: "Explore" });
    expect(hookDetail("hints", hook({ hook_event_name: "Stop", background_tasks: [{ type: "shell" }, { type: "subagent" }, { type: "shell" }] }))).toEqual({ shells: 2 });
    expect(hookDetail("hints", hook({ tool_name: "Grep", tool_input: { pattern: "secret", path: "C:\\mw\\visualiser\\src" } }))).toBeUndefined();
    expect(hookDetail("hints", hook({}))).toBeUndefined();
  });

  it("yields paths relative to the working directory, the directory and an Agent call's description", () => {
    expect(hookDetail("paths", hook({ tool_name: "Write", tool_input: { file_path: "C:\\mw\\visualiser\\src\\app.ts" }, permission_mode: "plan" }))).toEqual({ ext: "ts", permissionMode: "plan", file: "src/app.ts", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_name: "Grep", tool_input: { pattern: "secret", path: "C:\\mw\\visualiser\\src" } }))).toEqual({ file: "src", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_name: "Agent", tool_input: { subagent_type: "Explore", description: "Find the thing", prompt: "secret" } }))).toEqual({ agent: "Explore", description: "Find the thing", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_input: { command: "git status", description: "Show status" } }))).toEqual({ program: "git", dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ hook_event_name: "UserPromptSubmit", prompt: "secret" }))).toEqual({ dir: "C:/mw/visualiser" });
  });

  it("drops tool input it cannot read rather than the event", () => {
    expect(hookDetail("paths", hook({ tool_input: "junk" }))).toEqual({ dir: "C:/mw/visualiser" });
    expect(hookDetail("paths", hook({ tool_input: { file_path: 42 } }))).toEqual({ dir: "C:/mw/visualiser" });
  });
});

describe("statusDetail and presenceDetail", () => {
  const status = RawStatusLineDetailSchema.parse({ session_id: "s1", cwd, session_name: "Run whoami", context_window: { used_percentage: 5 } });
  const entry = RawAgentEntryDetailSchema.parse({ sessionId: "s1", cwd, name: "Run whoami", pid: 4 });

  it("yield nothing below paths", () => {
    expect(statusDetail("hints", status)).toBeUndefined();
    expect(presenceDetail("hints", entry)).toBeUndefined();
  });

  it("yield the directory and the session's name at paths", () => {
    expect(statusDetail("paths", status)).toEqual({ dir: "C:/mw/visualiser", name: "Run whoami" });
    expect(presenceDetail("paths", entry)).toEqual({ dir: "C:/mw/visualiser", name: "Run whoami" });
    expect(statusDetail("paths", { ...status, session_name: null })).toEqual({ dir: "C:/mw/visualiser" });
    expect(presenceDetail("paths", RawAgentEntryDetailSchema.parse({ sessionId: "s1", cwd }))).toEqual({ dir: "C:/mw/visualiser" });
  });
});

describe("raw detail schemas", () => {
  it("still strip everything they do not name", () => {
    const parsed = hook({ tool_input: { command: "x", prompt: "secret", pattern: "secret", query: "secret" }, tool_response: { out: "secret" }, last_assistant_message: "secret" });
    expect(parsed.tool_input).toEqual({ command: "x" });
    expect(parsed).not.toHaveProperty("tool_response");
    expect(parsed).not.toHaveProperty("last_assistant_message");
    expect(RawStatusLineDetailSchema.parse({ session_id: "s1", cwd, session_name: "n", transcript_path: "secret" })).not.toHaveProperty("transcript_path");
  });
});
