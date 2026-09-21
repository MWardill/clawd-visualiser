import type { Snapshot } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { linkedSelection, pinLink, readLink, sessionFromHash, type SessionLink } from "./deep-link";

const t = new Date(0).toISOString();
const SNAPSHOT: Snapshot = {
  version: 1,
  generatedAt: t,
  panes: [{ pane: "pane-1", label: "repo" }],
  sessions: [{ alias: "agent-3", label: "Otter", pane: "pane-1", state: "idle", activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t }],
};

describe("sessionFromHash", () => {
  it("reads the alias a #session= hash names", () => {
    expect(sessionFromHash("#session=agent-3")).toBe("agent-3");
    expect(sessionFromHash("#session=agent%2D3")).toBe("agent-3");
  });

  it("is null for any other hash, an empty or over-long alias, a bad escape, or characters no alias has", () => {
    for (const hash of ["", "#", "#session=", "#other=agent-3", "session=agent-3", "#session=%E0%A4%A", "#session=agent 3", "#session=<b>", `#session=${"a".repeat(65)}`]) {
      expect(sessionFromHash(hash), hash).toBeNull();
    }
  });
});

describe("readLink", () => {
  it("belongs to the live feed running when it is read", () => {
    expect(readLink("agent-3", "live", 4)).toEqual({ alias: "agent-3", generation: 4 });
  });

  it("waits for the first live feed when read at load, while probing, or under the simulated feed", () => {
    expect(readLink("agent-3", "probing", 0)).toEqual({ alias: "agent-3", generation: null });
    expect(readLink("agent-3", "simulated", 1)).toEqual({ alias: "agent-3", generation: null });
  });
});

describe("pinLink", () => {
  it("pins a waiting link to the first live feed, whatever its generation number", () => {
    const waiting: SessionLink = { alias: "agent-3", generation: null };
    // The simulated feed took generation 1 (the finding's scenario); the first live feed is 2.
    expect(pinLink(waiting, "live", 2)).toEqual({ alias: "agent-3", generation: 2 });
  });

  it("leaves a waiting link waiting through probing and the simulated feed, unchanged by reference", () => {
    const waiting: SessionLink = { alias: "agent-3", generation: null };
    expect(pinLink(waiting, "probing", 0)).toBe(waiting);
    expect(pinLink(waiting, "simulated", 1)).toBe(waiting);
  });

  it("never moves a pinned link to another feed, unchanged by reference", () => {
    const pinned: SessionLink = { alias: "agent-3", generation: 2 };
    expect(pinLink(pinned, "live", 3)).toBe(pinned);
  });

  it("leaves null as null", () => {
    expect(pinLink(null, "live", 2)).toBeNull();
  });
});

describe("linkedSelection", () => {
  it("is the linked alias once a live snapshot holds it", () => {
    expect(linkedSelection({ alias: "agent-3", generation: 1 }, 1, "live", SNAPSHOT)).toBe("agent-3");
  });

  it("is nothing with no link, before the first snapshot, or for an alias the snapshot does not hold", () => {
    expect(linkedSelection(null, 1, "live", SNAPSHOT)).toBeNull();
    expect(linkedSelection({ alias: "agent-3", generation: 1 }, 1, "live", null)).toBeNull();
    expect(linkedSelection({ alias: "agent-9", generation: 1 }, 1, "live", SNAPSHOT)).toBeNull();
  });

  it("is never honoured from the simulated feed, whose aliases are its own", () => {
    expect(linkedSelection({ alias: "agent-3", generation: 1 }, 1, "simulated", SNAPSHOT)).toBeNull();
    expect(linkedSelection({ alias: "agent-3", generation: 1 }, 1, "probing", SNAPSHOT)).toBeNull();
  });

  it("belongs to the feed it was pinned to: a later feed does not honour it", () => {
    const link: SessionLink = { alias: "agent-3", generation: 1 };
    expect(linkedSelection(link, 1, "live", SNAPSHOT)).toBe("agent-3");
    expect(linkedSelection(link, 2, "live", SNAPSHOT)).toBeNull();
  });

  it("shows nothing for a waiting link, even when a live snapshot holds its alias", () => {
    expect(linkedSelection({ alias: "agent-3", generation: null }, 1, "live", SNAPSHOT)).toBeNull();
  });

  it("honours a pinned link only at its own generation", () => {
    const pinned: SessionLink = { alias: "agent-3", generation: 2 };
    expect(linkedSelection(pinned, 2, "live", SNAPSHOT)).toBe("agent-3");
    expect(linkedSelection(pinned, 3, "live", SNAPSHOT)).toBeNull();
  });
});

describe("a link's lifecycle", () => {
  it("waits from load through a simulated feed, is pinned by the first live feed, then only ever belongs to that one", () => {
    // Read at load, before any feed exists.
    const atLoad = readLink("agent-3", "probing", 0);
    expect(atLoad.generation).toBeNull();

    // The default mode's probe fails first, so the simulated feed starts and takes generation 1.
    expect(linkedSelection(atLoad, 1, "simulated", SNAPSHOT)).toBeNull();
    const stillWaiting = pinLink(atLoad, "simulated", 1);
    expect(stillWaiting).toBe(atLoad);

    // The agent answers; the first live feed takes generation 2 and pins the link.
    const pinned = pinLink(stillWaiting, "live", 2);
    expect(pinned).toEqual({ alias: "agent-3", generation: 2 });
    expect(linkedSelection(pinned, 2, "live", SNAPSHOT)).toBe("agent-3");

    // A later feed (generation 3) does not reopen it.
    expect(linkedSelection(pinned, 3, "live", SNAPSHOT)).toBeNull();
  });
});
