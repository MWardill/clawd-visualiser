import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUIT_CAP_MS, createQuitHandler, settleWithin } from "./quit";

/** Runs every queued promise callback. setImmediate is left real by the fake timers below. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("settleWithin", () => {
  it("is true when the work settles in time, whether it resolves or rejects", async () => {
    await expect(settleWithin(Promise.resolve(), 100)).resolves.toBe(true);
    await expect(settleWithin(Promise.reject(new Error("boom")), 100)).resolves.toBe(true);
  });

  it("is false when the cap passes first", async () => {
    const result = settleWithin(new Promise(() => {}), 100);
    vi.advanceTimersByTime(100);
    await expect(result).resolves.toBe(false);
  });
});

describe("createQuitHandler", () => {
  it("holds every quit, stops once, then flushes the log and exits", async () => {
    const order: string[] = [];
    let prevented = 0;
    let finishStop: () => void = () => {};
    const handler = createQuitHandler({
      stop: () =>
        new Promise<void>((resolve) => {
          order.push("stop");
          finishStop = resolve;
        }),
      flush: async () => {
        order.push("flush");
      },
      exit: (code) => {
        order.push(`exit ${code}`);
      },
      log: (code) => {
        order.push(code);
      },
    });
    const event = { preventDefault: () => void prevented++ };
    handler(event);
    handler(event);
    await flush();
    expect(prevented).toBe(2);
    expect(order).toEqual(["stop"]);
    finishStop();
    await flush();
    expect(order).toEqual(["stop", "flush", "exit 0"]);
  });

  it("exits after five seconds when the stop hangs, and logs that it did", async () => {
    const order: string[] = [];
    const handler = createQuitHandler({
      stop: () => new Promise<void>(() => {}),
      flush: async () => {
        order.push("flush");
      },
      exit: (code) => {
        order.push(`exit ${code}`);
      },
      log: (code) => {
        order.push(code);
      },
    });
    handler({ preventDefault: () => {} });
    await flush();
    vi.advanceTimersByTime(QUIT_CAP_MS - 1);
    await flush();
    expect(order).toEqual([]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(order).toEqual(["desktop.stopTimedOut", "flush", "exit 0"]);
  });
});
