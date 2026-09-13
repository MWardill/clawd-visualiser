import { describe, expect, it } from "vitest";
import { createLogger, type LogFields } from "./log";

describe("createLogger", () => {
  it("writes one JSON line with time, code and fields", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), () => Date.UTC(2026, 8, 12, 10, 0, 0));
    log("agent.started", { port: 4750, ok: true });
    expect(lines).toEqual(['{"t":"2026-09-12T10:00:00.000Z","code":"agent.started","port":4750,"ok":true}\n']);
  });

  it("writes a line with no fields", () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => 0)("agent.stopped");
    expect(lines).toEqual(['{"t":"1970-01-01T00:00:00.000Z","code":"agent.stopped"}\n']);
  });

  it("drops any field that is not a number or a boolean, even one smuggled in with a cast", () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), () => 0);
    log("ingest.failed", { count: 1, leak: "CANARY prompt", nested: { a: 1 } } as unknown as LogFields);
    expect(lines.join("")).not.toContain("CANARY");
    expect(JSON.parse(lines[0] ?? "")).toEqual({ t: "1970-01-01T00:00:00.000Z", code: "ingest.failed", count: 1 });
  });

  it("never lets a field overwrite the time or the code", () => {
    const lines: string[] = [];
    createLogger((l) => lines.push(l), () => 0)("agent.stopped", { t: 5, code: 6 } as unknown as LogFields);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ t: "1970-01-01T00:00:00.000Z", code: "agent.stopped" });
  });
});
