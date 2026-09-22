import type { Snapshot } from "@clawd/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACHED_FEED_MS, createAttachedFeed, feedPort } from "./attached-feed";
import { snapshot } from "./testing/snapshot";

/** Runs every queued promise callback. setImmediate is left real by the fake timers below. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

function harness(answer: (port: number) => Promise<Snapshot | null>) {
  const asked: number[] = [];
  const seen: Array<[number, number]> = [];
  const feed = createAttachedFeed({
    fetch: (port) => {
      asked.push(port);
      return answer(port);
    },
    onSnapshot: (s, port) => void seen.push([s.sessions.length, port]),
  });
  return { feed, asked, seen };
}

describe("feedPort", () => {
  it("is the attached agent's port while widgets are shown or the popup is on, and nothing otherwise", () => {
    expect(feedPort({ mode: "attached", port: 4750 }, "widgets", false)).toBe(4750);
    expect(feedPort({ mode: "attached", port: 4750 }, "window", true)).toBe(4750);
    expect(feedPort({ mode: "attached", port: 4750 }, "window", false)).toBeNull();
    expect(feedPort({ mode: "own", port: 4750 }, "widgets", true)).toBeNull();
    expect(feedPort({ mode: "attached", port: null }, "widgets", true)).toBeNull();
  });
});

describe("createAttachedFeed", () => {
  it("asks at once, hands each snapshot on with its port, and asks again a second after each answer", async () => {
    const { feed, asked, seen } = harness(async () => snapshot(["working"]));
    feed.watch(4750);
    await flush();
    expect(seen).toEqual([[1, 4750]]);
    await advance(ATTACHED_FEED_MS - 1);
    expect(asked).toHaveLength(1);
    await advance(1);
    expect(asked).toHaveLength(2);
    expect(seen).toHaveLength(2);
  });

  it("never has two requests out: the next is timed from the answer, not from the question", async () => {
    let release: (s: Snapshot | null) => void = () => {};
    const { feed, asked } = harness(() => new Promise((resolve) => (release = resolve)));
    feed.watch(4750);
    await advance(10 * ATTACHED_FEED_MS);
    expect(asked).toHaveLength(1);
    release(snapshot([]));
    await flush();
    await advance(ATTACHED_FEED_MS);
    expect(asked).toHaveLength(2);
  });

  it("carries on past an agent that has no answer, or a fetch that throws", async () => {
    let n = 0;
    const { feed, asked, seen } = harness(async () => {
      n++;
      if (n === 1) return null;
      if (n === 2) throw new Error("boom");
      return snapshot(["idle"]);
    });
    feed.watch(4750);
    await flush();
    await advance(ATTACHED_FEED_MS);
    await advance(ATTACHED_FEED_MS);
    expect(asked).toHaveLength(3);
    expect(seen).toEqual([[1, 4750]]);
  });

  it("stops when told, drops an answer that arrives afterwards, follows a new port, and does not restart for the same one", async () => {
    let release: (s: Snapshot | null) => void = () => {};
    const { feed, asked, seen } = harness(() => new Promise((resolve) => (release = resolve)));
    feed.watch(4750);
    feed.watch(4750);
    expect(asked).toEqual([4750]);
    feed.stop();
    release(snapshot(["working"]));
    await flush();
    await advance(5 * ATTACHED_FEED_MS);
    expect(seen).toEqual([]);
    expect(asked).toEqual([4750]);
    feed.watch(4751);
    expect(asked).toEqual([4750, 4751]);
  });

  it("keeps asking when the listener throws", async () => {
    const asked: number[] = [];
    let calls = 0;
    const laterCalls: Array<[number, number]> = [];
    const feed = createAttachedFeed({
      fetch: async (port) => {
        asked.push(port);
        return snapshot(["working"]);
      },
      onSnapshot: (s, port) => {
        calls++;
        if (calls === 1) throw new Error("listener boom");
        laterCalls.push([s.sessions.length, port]);
      },
    });
    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      feed.watch(4750);
      await flush();
      await advance(ATTACHED_FEED_MS);
      await flush();
      expect(asked).toHaveLength(2);
      expect(laterCalls).toEqual([[1, 4750]]);
      expect(rejections).toHaveLength(1);
      expect((rejections[0] as Error).message).toBe("listener boom");
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });

  it("a listener that stops the feed from inside its own call leaves no timer running", async () => {
    const asked: number[] = [];
    const feed = createAttachedFeed({
      fetch: async (port) => {
        asked.push(port);
        return snapshot(["working"]);
      },
      onSnapshot: () => feed.stop(),
    });
    feed.watch(4750);
    await flush();
    await advance(5 * ATTACHED_FEED_MS);
    expect(asked).toHaveLength(1);
  });
});
