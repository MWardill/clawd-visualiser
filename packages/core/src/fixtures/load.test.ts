import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, emptyFleet, reduceFleet } from "../state";
import { parseFixture } from "./load";

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");

describe("fixtures", () => {
  it("parses a header line and validated events", () => {
    const f = parseFixture(read("permission-denied.jsonl"));
    expect(f.name).toBe("permission-denied");
    expect(f.events.length).toBeGreaterThan(3);
    expect(f.events.every((e) => e.v === 1)).toBe(true);
  });

  it("names the fixture and the physical line number when a line will not parse", () => {
    expect(() => parseFixture('{"fixture":1,"name":"x"}\n\n{"v":1,')).toThrow(/^fixture x line 3: /);
    expect(() => parseFixture("{oops")).toThrow(/^fixture header line 1: /);
    expect(() => parseFixture('{"fixture":1,"name":"x"}\n\n{"v":1,"t":1,"sessionId":"s","paneKey":"k","kind":"prompt","prompt":"hi"}')).toThrow(/^fixture x line 3: /);
  });

  it("rejects a fixture with a forbidden field or a missing header", () => {
    expect(() => parseFixture('{"fixture":1,"name":"x"}\n{"v":1,"t":1,"sessionId":"s","paneKey":"k","kind":"prompt","prompt":"hi"}')).toThrow();
    expect(() => parseFixture('{"v":1,"t":1,"sessionId":"s","paneKey":"k","kind":"prompt"}')).toThrow(/header/);
    expect(() => parseFixture("")).toThrow(/empty/);
  });

  it("permission-denied: the session waits, is denied, and works again", () => {
    const f = parseFixture(read("permission-denied.jsonl"));
    const states: string[] = [];
    let fleet = emptyFleet();
    for (const e of f.events) {
      fleet = reduceFleet(fleet, e, e.t, DEFAULT_CONFIG);
      states.push(fleet.sessions["fix-1"]!.state);
    }
    expect(states).toContain("waiting");
    expect(states[states.length - 1]).toBe("idle");
  });

  it("killed-session: presence lost marks the session done without a session.end", () => {
    const f = parseFixture(read("killed-session.jsonl"));
    expect(f.events.some((e) => e.kind === "session.end")).toBe(false);
    let fleet = emptyFleet();
    for (const e of f.events) fleet = reduceFleet(fleet, e, e.t, DEFAULT_CONFIG);
    expect(fleet.sessions["fix-2"]!.state).toBe("done");
  });
});
