import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescer } from "./coalesce";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createCoalescer", () => {
  it("costs one run however many asks arrive inside the delay", () => {
    let runs = 0;
    const coalescer = createCoalescer(150, () => void runs++);
    for (let i = 0; i < 20; i++) coalescer.ask();
    vi.advanceTimersByTime(150);
    expect(runs).toBe(1);
  });

  it("runs after the delay, not before", () => {
    let runs = 0;
    const coalescer = createCoalescer(150, () => void runs++);
    coalescer.ask();
    vi.advanceTimersByTime(149);
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(1);
  });

  it("asks arriving while one waits do not put the run off", () => {
    let runs = 0;
    const coalescer = createCoalescer(150, () => void runs++);
    coalescer.ask();
    vi.advanceTimersByTime(140);
    coalescer.ask();
    vi.advanceTimersByTime(10);
    expect(runs).toBe(1);
  });

  it("a later ask starts a new run", () => {
    let runs = 0;
    const coalescer = createCoalescer(150, () => void runs++);
    coalescer.ask();
    vi.advanceTimersByTime(150);
    expect(runs).toBe(1);
    coalescer.ask();
    vi.advanceTimersByTime(149);
    expect(runs).toBe(1);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(2);
  });

  it("cancel stops a waiting run, and asking again still works", () => {
    let runs = 0;
    const coalescer = createCoalescer(150, () => void runs++);
    coalescer.ask();
    vi.advanceTimersByTime(149);
    coalescer.cancel();
    vi.advanceTimersByTime(10_000);
    expect(runs).toBe(0);
    coalescer.ask();
    vi.advanceTimersByTime(150);
    expect(runs).toBe(1);
  });

  it("cancel with nothing waiting changes nothing", () => {
    let runs = 0;
    const coalescer = createCoalescer(150, () => void runs++);
    coalescer.cancel();
    vi.advanceTimersByTime(10_000);
    expect(runs).toBe(0);
  });
});
