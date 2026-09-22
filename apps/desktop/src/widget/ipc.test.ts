import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WIDGET_CHANNELS as C } from "./channels";
import { createWidgetHandlers, type WidgetCalls } from "./ipc";
import type { WidgetState } from "./state";

const STATE: WidgetState = { snapshot: null, generation: 1, pinned: false, raised: false, temporary: false };

function harness(over: Partial<WidgetCalls> = {}) {
  const calls: string[] = [];
  const base: WidgetCalls = {
    ready: (sender) => {
      calls.push(`ready ${sender}`);
      return STATE;
    },
    resize: (sender, size) => void calls.push(`resize ${sender} ${size === null ? "null" : `${size.width}x${size.height}`}`),
    dragStart: (sender) => void calls.push(`dragStart ${sender}`),
    dragMove: (sender) => void calls.push(`dragMove ${sender}`),
    dragEnd: (sender) => void calls.push(`dragEnd ${sender}`),
    togglePin: (sender) => void calls.push(`togglePin ${sender}`),
    select: (sender, alias) => void calls.push(`select ${sender} ${alias}`),
    menu: (sender) => void calls.push(`menu ${sender}`),
    ...over,
  };
  return { calls, handlers: createWidgetHandlers(base) };
}

describe("createWidgetHandlers", () => {
  it("has one handler per channel the page can send on, the answered one apart from the rest", () => {
    const { handlers } = harness();
    expect(Object.keys(handlers.invoke)).toEqual([C.ready]);
    expect(Object.keys(handlers.on).sort()).toEqual([C.dragEnd, C.dragMove, C.dragStart, C.menu, C.resize, C.select, C.togglePin].sort());
  });

  it("passes each call on with the sender's id", () => {
    const { calls, handlers } = harness();
    expect(handlers.invoke[C.ready]?.(7, undefined)).toEqual(STATE);
    handlers.on[C.resize]?.(7, { width: 346, height: 192 });
    handlers.on[C.resize]?.(7, null);
    handlers.on[C.dragStart]?.(7, undefined);
    handlers.on[C.dragMove]?.(7, undefined);
    handlers.on[C.dragEnd]?.(7, undefined);
    handlers.on[C.togglePin]?.(7, undefined);
    handlers.on[C.select]?.(7, "agent-3");
    handlers.on[C.menu]?.(7, undefined);
    expect(calls).toEqual(["ready 7", "resize 7 346x192", "resize 7 null", "dragStart 7", "dragMove 7", "dragEnd 7", "togglePin 7", "select 7 agent-3", "menu 7"]);
  });

  it("drops a size that is not two whole numbers from 1 to 4096 and nothing else, and an alias that is not a short string", () => {
    const { calls, handlers } = harness();
    for (const size of [undefined, "big", {}, { width: 346 }, { width: 346.5, height: 192 }, { width: 0, height: 192 }, { width: 5000, height: 192 }, { width: 346, height: 192, x: 0 }]) {
      handlers.on[C.resize]?.(7, size);
    }
    for (const alias of [undefined, "", 3, { alias: "agent-3" }, "a".repeat(201)]) handlers.on[C.select]?.(7, alias);
    expect(calls).toEqual([]);
  });

  it("never throws, whatever the controller does: an exception nothing catches in main restarts the agent", () => {
    const boom = (): never => {
      throw new Error("boom");
    };
    const { handlers } = harness({ ready: boom, resize: boom, dragStart: boom, dragMove: boom, dragEnd: boom, togglePin: boom, select: boom, menu: boom });
    expect(handlers.invoke[C.ready]?.(7, undefined)).toBeNull();
    for (const [channel, handler] of Object.entries(handlers.on)) {
      expect(() => handler(7, channel === C.resize ? { width: 1, height: 1 } : "agent-1"), channel).not.toThrow();
    }
  });
});

describe("the widget bridge's files", () => {
  const read = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), "utf8");

  it("keeps the preload free of everything but the channel names and the types", async () => {
    const preload = await read("./preload.ts");
    // `\r?` because a Windows checkout may hold CRLF line endings.
    const imports = [...preload.matchAll(/^import (type )?.* from "([^"]+)";\r?$/gm)].map((match) => `${match[1] ?? ""}${match[2] ?? ""}`);
    expect(imports).toEqual(["electron", "./channels", "type ./state"]);
    expect(await read("./channels.ts")).not.toMatch(/^\s*import\s/m);
  });
});
