import { SnapshotSchema, TICKER_BACKFILL, TickerEventSchema, type Snapshot, type TickerEvent } from "@clawd/core";
import { describe, expect, it } from "vitest";
import { createSimulatedFeed } from "./simulated";

const T0 = 1_700_000_000_000;

/** Injected timers: every interval callback runs on each step of the clock. */
function harness(seed = 1) {
  let now = T0;
  const intervals: (() => void)[] = [];
  const feed = createSimulatedFeed({
    seed,
    sessions: 4,
    now: () => now,
    setInterval: (fn) => {
      intervals.push(fn);
      return intervals.length;
    },
    clearInterval: () => {},
  });
  const snapshots: Snapshot[] = [];
  const ticker: [string, TickerEvent][] = [];
  const stop = feed.start({ onSnapshot: (s) => snapshots.push(s), onTicker: (alias, e) => ticker.push([alias, e]) });
  const advance = (ms: number, step = 250): void => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + step);
      for (const fn of intervals) fn();
    }
  };
  return { feed, snapshots, ticker, advance, stop };
}

describe("simulated feed", () => {
  it("publishes an empty snapshot at once, then a fleet that arrives over time", () => {
    const h = harness();
    expect(h.snapshots[0]).toMatchObject({ version: 1, panes: [], sessions: [] });
    h.advance(60_000);
    const last = h.snapshots.at(-1)!;
    expect(last.sessions.length).toBeGreaterThan(0);
    expect(last.panes.length).toBeGreaterThan(0);
    for (const s of h.snapshots) expect(SnapshotSchema.safeParse(s).success).toBe(true);
    h.stop();
  });

  it("only publishes when panes or sessions changed", () => {
    const h = harness();
    // Session slot 0 is always born synchronously at start (offset 0), so its arrival lands in the
    // fleet before any tick runs; flush that through a snapshot first, then check a quiet window
    // (the next event isn't due for at least 800 ms) produces no more.
    h.advance(250);
    const before = h.snapshots.length;
    h.advance(250);
    expect(h.snapshots.length).toBe(before);
    h.stop();
  });

  it("keys ticker lines by alias and never leaks a session id or pane key", () => {
    const h = harness();
    h.advance(60_000);
    expect(h.ticker.length).toBeGreaterThan(0);
    for (const [alias, e] of h.ticker) {
      expect(alias).toMatch(/^agent-\d+$/);
      expect(TickerEventSchema.safeParse(e).success).toBe(true);
    }
    const everything = JSON.stringify([h.snapshots, h.ticker]);
    expect(everything).not.toContain("sim-");
    expect(everything).not.toContain("5a1e");
    expect(everything).not.toContain("sessionId");
    expect(everything).not.toContain("paneKey");
    h.stop();
  });

  it("backfills at most TICKER_BACKFILL lines per alias and cannot focus", async () => {
    const h = harness();
    h.advance(180_000);
    const alias = h.ticker[0]![0];
    const lines = await h.feed.backfill(alias);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(TICKER_BACKFILL);
    expect(lines).toEqual(h.ticker.filter(([a]) => a === alias).map(([, e]) => e).slice(-TICKER_BACKFILL));
    expect(await h.feed.backfill("agent-999")).toEqual([]);
    expect(await h.feed.focus(alias)).toBe(false);
    h.stop();
  });
});
