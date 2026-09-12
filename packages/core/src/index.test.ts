import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("@clawd/core public API", () => {
  it("exports the contract surface", () => {
    expect(core.CORE_VERSION).toBe("0.1.0");
    const names = [
      "SnapshotSchema", "TickerEventSchema", "CommandSchema", "RedactedEventSchema", "HealthSchema", "StreamTickerMessageSchema",
      "redact", "containsForbidden", "FORBIDDEN_KEYS", "categoryFor", "normaliseTool", "isAllowed",
      "paneKey", "emptyAliasMap", "ensureSessionAlias", "ensurePaneAlias",
      "newSession", "reduceSession", "tickSession", "emptyFleet", "reduceFleet", "tickFleet", "deriveSnapshot", "displayedState", "toTickerEvents",
      "DEFAULT_CONFIG", "SIMULATED_CONFIG", "createSimulatedFleet", "createSimulatedSource", "createReplaySource",
      "parseFixture", "snapshotFrames", "ENDPOINTS", "DEFAULT_AGENT_URL", "STREAM_EVENTS",
    ];
    for (const name of names) expect(core, name).toHaveProperty(name);
  });
});
