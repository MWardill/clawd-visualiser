import { describe, expect, it } from "vitest";
import type { EventDetail } from "../schema/detail";
import { T0, event } from "../testing/events";
import { mergeSessionDetail, subjectOf } from "./detail";

const tool = (category: "read" | "edit" | "run" | "web" | "spawn" | "other", detail: EventDetail) =>
  event("tool.start", T0, { tool: "X", category, toolUseId: "u1", detail });

describe("subjectOf", () => {
  it("picks the file, the extension, the program, the host or the agent by category", () => {
    expect(subjectOf(tool("edit", { file: "src/app.ts", ext: "ts" }))).toEqual({ kind: "file", text: "src/app.ts" });
    expect(subjectOf(tool("read", { ext: "ts" }))).toEqual({ kind: "file", text: "ts" });
    expect(subjectOf(tool("run", { program: "git" }))).toEqual({ kind: "program", text: "git" });
    expect(subjectOf(tool("web", { host: "example.com" }))).toEqual({ kind: "host", text: "example.com" });
    expect(subjectOf(tool("spawn", { agent: "Explore", description: "Find the form" }))).toEqual({ kind: "agent", text: "Find the form" });
    expect(subjectOf(tool("spawn", { agent: "Explore" }))).toEqual({ kind: "agent", text: "Explore" });
  });

  it("has nothing to say without detail, for the other category, or for events without a category", () => {
    expect(subjectOf(tool("other", { permissionMode: "default" }))).toBeUndefined();
    expect(subjectOf(tool("run", { permissionMode: "default" }))).toBeUndefined();
    expect(subjectOf(event("tool.start", T0, { tool: "X", category: "run", toolUseId: "u1" }))).toBeUndefined();
    expect(subjectOf(event("prompt", T0, { detail: { program: "git" } }))).toBeUndefined();
  });
});

describe("mergeSessionDetail", () => {
  it("copies the session fields when present and sets the subject on a tool start, returning prev when nothing changed", () => {
    const a = mergeSessionDetail({}, event("prompt", T0, { detail: { permissionMode: "plan", dir: "C:/mw" } }));
    expect(a).toEqual({ permissionMode: "plan", dir: "C:/mw" });
    const b = mergeSessionDetail(a, tool("run", { program: "git", permissionMode: "plan", shells: 1 }));
    expect(b).toEqual({ permissionMode: "plan", dir: "C:/mw", shells: 1, subject: { kind: "program", text: "git" } });
    expect(mergeSessionDetail(b, tool("run", { program: "git", permissionMode: "plan", shells: 1 }))).toBe(b);
    expect(mergeSessionDetail(b, event("stop", T0, { backgroundTasks: 0 }))).toBe(b);
    const c = mergeSessionDetail(b, event("status", T0, { detail: { name: "Fix login" } }));
    expect(c).toEqual({ ...b, name: "Fix login" });
  });

  it("keeps the last subject through tool ends and stops", () => {
    const s = mergeSessionDetail({}, tool("edit", { file: "src/app.ts" }));
    expect(mergeSessionDetail(s, event("tool.end", T0, { tool: "X", category: "edit", toolUseId: "u1", durationMs: 1, detail: { file: "other.ts" } }))).toBe(s);
  });
});
