import { describe, expect, it } from "vitest";
import {
  DETAIL_LEVELS,
  DetailLevelSchema,
  HintsDetailSchema,
  PaneDetailSchema,
  PathsDetailSchema,
  SessionDetailSchema,
  SubjectSchema,
  TickerDetailSchema,
  atLeast,
  containsDetail,
  stripDetail,
} from "./detail";

describe("detail levels", () => {
  it("orders none, hints, paths", () => {
    expect(DETAIL_LEVELS).toEqual(["none", "hints", "paths"]);
    expect(atLeast("paths", "hints")).toBe(true);
    expect(atLeast("hints", "hints")).toBe(true);
    expect(atLeast("hints", "paths")).toBe(false);
    expect(atLeast("none", "hints")).toBe(false);
    expect(() => DetailLevelSchema.parse("content")).toThrow();
  });

  it("hints refuse anything path-shaped or unknown", () => {
    const full = { program: "git", ext: "ts", host: "example.com", agent: "general-purpose", permissionMode: "acceptEdits", shells: 1 };
    expect(HintsDetailSchema.parse(full)).toEqual(full);
    expect(HintsDetailSchema.parse({ host: "[::1]" })).toEqual({ host: "[::1]" });
    for (const bad of [
      { program: "a/b" },
      { program: "a\\b" },
      { program: "" },
      { ext: "TS" },
      { ext: "ts/x" },
      { host: "a/b" },
      { agent: "x y" },
      { permissionMode: "plan-mode" },
      { shells: -1 },
      { file: "src/a.ts" },
      { dir: "C:/mw" },
      { prompt: "secret" },
    ]) {
      expect(() => HintsDetailSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("paths add file, dir, name and description, bounded and free of control characters", () => {
    const value = { ext: "ts", file: "src/a.ts", dir: "C:/mw/visualiser", name: "Fix login", description: "Review the diff" };
    expect(PathsDetailSchema.parse(value)).toEqual(value);
    expect(() => PathsDetailSchema.parse({ file: "" })).toThrow();
    expect(() => PathsDetailSchema.parse({ name: "a\u0000b" })).toThrow();
    expect(() => PathsDetailSchema.parse({ dir: "x".repeat(513) })).toThrow();
    expect(() => PathsDetailSchema.parse({ description: "x".repeat(121) })).toThrow();
    expect(() => PathsDetailSchema.parse({ tool_input: "x" })).toThrow();
  });

  it("types the session, pane and ticker detail", () => {
    expect(SubjectSchema.parse({ kind: "file", text: "src/a.ts" })).toEqual({ kind: "file", text: "src/a.ts" });
    expect(() => SubjectSchema.parse({ kind: "prompt", text: "x" })).toThrow();
    expect(() => SubjectSchema.parse({ kind: "file", text: "" })).toThrow();
    expect(SessionDetailSchema.parse({ name: "Fix login", shells: 2, subject: { kind: "program", text: "git" } })).toMatchObject({ name: "Fix login", shells: 2 });
    expect(() => SessionDetailSchema.parse({ file: "x" })).toThrow();
    expect(PaneDetailSchema.parse({ dir: "C:/mw" })).toEqual({ dir: "C:/mw" });
    expect(() => PaneDetailSchema.parse({ name: "x" })).toThrow();
    expect(TickerDetailSchema.parse({ permissionMode: "plan", subject: { kind: "host", text: "example.com" } })).toMatchObject({ permissionMode: "plan" });
    expect(() => TickerDetailSchema.parse({ file: "x" })).toThrow();
  });

  it("strips every detail key at any depth and reports whether one is present", () => {
    const value = { a: 1, detail: { file: "x" }, list: [{ detail: { dir: "y" }, keep: true }, 2], nested: { deeper: { detail: {} } } };
    expect(stripDetail(value)).toEqual({ a: 1, list: [{ keep: true }, 2], nested: { deeper: {} } });
    expect(value.detail).toEqual({ file: "x" });
    expect(containsDetail(value)).toBe(true);
    expect(containsDetail(stripDetail(value))).toBe(false);
    expect(containsDetail({ detailed: 1, details: { detail: 1 } })).toBe(true);
    expect(containsDetail({ detailed: 1 })).toBe(false);
    expect(stripDetail("text")).toBe("text");
    expect(stripDetail(null)).toBeNull();
    expect(stripDetail([1, "detail"])).toEqual([1, "detail"]);
  });
});
