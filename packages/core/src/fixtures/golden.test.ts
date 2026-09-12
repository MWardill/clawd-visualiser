import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsForbidden } from "../ingest/redact";
import { snapshotFrames } from "./frames";
import { parseFixture } from "./load";

const ALL = ["permission-denied", "killed-session", "spike-headless", "spike-interactive"];
const NAMES = ALL.filter((n) => existsSync(join(__dirname, `${n}.jsonl`)));

describe("golden snapshots", () => {
  it("has every fixture the plan expects", () => {
    expect(NAMES).toEqual(ALL);
  });

  it.each(NAMES)("%s reduces to its committed snapshot sequence", (name) => {
    const expected: unknown = JSON.parse(readFileSync(join(__dirname, "golden", `${name}.json`), "utf8"));
    expect(snapshotFrames(parseFixture(readFileSync(join(__dirname, `${name}.jsonl`), "utf8")))).toEqual(expected);
  });

  it.each(NAMES)("%s contains nothing forbidden", (name) => {
    const text = readFileSync(join(__dirname, `${name}.jsonl`), "utf8");
    const lines = text.trim().split(/\r?\n/).map((l) => JSON.parse(l) as unknown);
    expect(containsForbidden(lines)).toBeNull();
    expect(text).not.toMatch(/\.jsonl"|[A-Za-z]:\\\\|\/Users\/|\/home\//);
  });
});
