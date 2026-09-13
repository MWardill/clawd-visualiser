import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import * as core from "./index";

describe("@clawd/core public API", () => {
  it("exports exactly the contract surface", () => {
    expect(core.CORE_VERSION).toBe("0.1.0");
    expect(pkg.version).toBe(core.CORE_VERSION);
    // A ceiling, not a floor: anything added or removed here is a deliberate change to the
    // contract both halves are built against, so the list is pinned by name.
    expect(Object.keys(core).sort()).toEqual([
      "ActivitySchema",
      "CORE_VERSION",
      "CommandSchema",
      "DEFAULT_AGENT_URL",
      "DEFAULT_CONFIG",
      "ENDPOINTS",
      "EVENT_SCHEMA_VERSION",
      "FORBIDDEN_KEYS",
      "HealthSchema",
      "PANE_LABELS",
      "PaneSnapshotSchema",
      "RedactedEventSchema",
      "SESSION_LABELS",
      "SIMULATED_CONFIG",
      "SNAPSHOT_MIN_INTERVAL_MS",
      "STREAM_EVENTS",
      "STREAM_HEARTBEAT_MS",
      "SessionPhaseSchema",
      "SessionSnapshotSchema",
      "SnapshotSchema",
      "StreamTickerMessageSchema",
      "TICKER_BACKFILL",
      "TickerEventSchema",
      "TickerKindSchema",
      "ToolCategorySchema",
      "applyEvent",
      "categoryFor",
      "containsForbidden",
      "createReplaySource",
      "createSimulatedFleet",
      "createSimulatedSource",
      "deriveSnapshot",
      "displayedState",
      "emptyAliasMap",
      "emptyFleet",
      "ensurePaneAlias",
      "ensureSessionAlias",
      "isAllowed",
      "isShown",
      "newSession",
      "normalisePath",
      "normaliseTool",
      "paneKey",
      "paneName",
      "parseFixture",
      "redact",
      "redactPresence",
      "reduceFleet",
      "reduceSession",
      "snapshotFrames",
      "tickFleet",
      "tickSession",
      "toTickerEvents",
    ]);
  });
});
