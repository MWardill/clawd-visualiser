import { describe, expect, it } from "vitest";
import type { Fixture } from "./load";
import { snapshotFrames } from "./frames";

const T0 = 1_757_671_200_000;
const fixture: Fixture = {
  name: "tiny",
  events: [
    { v: 1, t: T0, sessionId: "s1", paneKey: "k1", kind: "prompt" },
    { v: 1, t: T0 + 100, sessionId: "s1", paneKey: "k1", kind: "status", costUsd: 1 },
    { v: 1, t: T0 + 200, sessionId: "s1", paneKey: "k1", kind: "stop", backgroundTasks: 0 },
  ],
};

describe("snapshotFrames", () => {
  it("records one frame per visible change, without generatedAt", () => {
    const frames = snapshotFrames(fixture);
    expect(frames.map((f) => f.sessions[0]?.state)).toEqual(["working", "idle"]);
    expect(frames[0]).not.toHaveProperty("generatedAt");
    expect(frames[0]?.sessions[0]?.alias).toBe("agent-1");
  });
});
