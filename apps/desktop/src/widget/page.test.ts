// @vitest-environment happy-dom
import type { PanesScene, PanesSceneOptions } from "@clawd/scene";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { WidgetApi, WidgetState } from "./state";

const here = dirname(fileURLToPath(import.meta.url));
// The real markup, less the script tag: the test imports the page's module itself.
const html = await readFile(join(here, "page.html"), "utf8");
const BODY = (/<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "").replace(/<script[^>]*><\/script>/g, "");

const t = new Date(0).toISOString();
const session = (alias: string) => ({ alias, label: alias, pane: "pane-1", state: "working" as const, activity: null, subagents: 0, contextPct: null, since: t, updatedAt: t });
const snapshotOf = (...aliases: string[]): NonNullable<WidgetState["snapshot"]> => ({ version: 1, generatedAt: t, panes: [{ pane: "pane-1", label: "repo" }], sessions: aliases.map(session) });
const STATE: WidgetState = { snapshot: snapshotOf("agent-1"), generation: 1, pinned: false };

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Loads a fresh copy of the page over a stub bridge and a stub scene, and waits for its first draw. */
async function load(initial: WidgetState | null = STATE, hit: string | null = null) {
  vi.resetModules();
  document.body.innerHTML = BODY;
  const calls: string[] = [];
  const drawn: string[] = [];
  const mounted: { options?: PanesSceneOptions } = {};
  const scene: PanesScene = {
    setSnapshot: (s, o) => void drawn.push(`snapshot ${s.sessions.length} seated=${o?.seated === true}`),
    clear: () => void drawn.push("clear"),
    resize: () => {},
    setPaused: () => {},
    hitTest: () => hit,
    destroy: () => {},
  };
  // The real scene runs a frame loop; the page's decisions are what is under test here.
  vi.doMock("@clawd/scene", () => ({
    mountPanesScene: (_canvas: unknown, options: PanesSceneOptions) => {
      mounted.options = options;
      return scene;
    },
  }));
  const frames: Array<() => void> = [];
  (window as unknown as { requestAnimationFrame: (fn: FrameRequestCallback) => number }).requestAnimationFrame = (fn) => frames.push(() => fn(0));
  const listeners: Array<(s: WidgetState) => void> = [];
  const api: WidgetApi = {
    ready: async () => initial,
    onState: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    resize: (size) => void calls.push(size === null ? "resize null" : `resize ${size.width}x${size.height}`),
    dragStart: () => void calls.push("dragStart"),
    dragMove: () => void calls.push("dragMove"),
    dragEnd: () => void calls.push("dragEnd"),
    togglePin: () => void calls.push("togglePin"),
    select: (alias) => void calls.push(`select ${alias}`),
    menu: () => void calls.push("menu"),
  };
  (window as unknown as { clawdWidget: WidgetApi }).clawdWidget = api;
  await import("./page");
  await flush();
  const canvas = document.getElementById("scene") as HTMLElement;
  const pin = document.getElementById("pin") as HTMLElement;
  return {
    calls,
    drawn,
    mounted,
    canvas,
    pin,
    push: (state: WidgetState): void => listeners.forEach((cb) => cb(state)),
    frame: (): void => frames.splice(0).forEach((run) => run()),
  };
}

/** A pointer event as the page reads one: the button, where it is on the screen and in the page, and whose it is. */
function pointer(type: string, init: { button?: number; screenX?: number; screenY?: number; clientX?: number; clientY?: number } = {}): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("the widget page", () => {
  it("mounts the scene as a widget, without the scene's own click handling, and only then asks for its state", async () => {
    const page = await load();
    expect(page.mounted.options).toMatchObject({ background: "none", clipActors: true, emptyState: false, margin: 1 });
    expect(page.mounted.options?.onSelect).toBeUndefined();
    expect(page.drawn).toEqual(["snapshot 1 seated=true"]);
  });

  it("seats the sessions of its first snapshot at once, and walks later arrivals in", async () => {
    const page = await load();
    page.push({ ...STATE, snapshot: snapshotOf("agent-1", "agent-2") });
    expect(page.drawn).toEqual(["snapshot 1 seated=true", "snapshot 2 seated=false"]);
  });

  it("clears the scene when the generation changes, and seats that snapshot's sessions at once too", async () => {
    const page = await load();
    page.push({ ...STATE, generation: 2 });
    expect(page.drawn).toEqual(["snapshot 1 seated=true", "clear", "snapshot 1 seated=true"]);
  });

  it("draws nothing for a window main does not know, and waits for a snapshot when the first state has none", async () => {
    expect((await load(null)).drawn).toEqual([]);
    const page = await load({ ...STATE, snapshot: null });
    expect(page.drawn).toEqual([]);
    page.push(STATE);
    expect(page.drawn).toEqual(["snapshot 1 seated=true"]);
  });

  it("tells main the size the scene needs, and when nothing is left to draw", async () => {
    const page = await load();
    page.mounted.options?.onContentSize?.({ width: 346, height: 192 });
    page.mounted.options?.onContentSize?.(null);
    expect(page.calls).toEqual(["resize 346x192", "resize null"]);
  });

  it("treats a press that barely moves as a click: no move is sent, and a Clawd under it is selected", async () => {
    const page = await load(STATE, "agent-1");
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300, clientX: 60, clientY: 70 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 502, screenY: 302 }));
    page.frame();
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 502, screenY: 302, clientX: 62, clientY: 72 }));
    expect(page.calls).toEqual(["dragStart", "dragEnd", "select agent-1"]);
  });

  it("selects nothing when the click was not on a Clawd", async () => {
    const page = await load(STATE, null);
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 500, screenY: 300 }));
    expect(page.calls).toEqual(["dragStart", "dragEnd"]);
  });

  it("treats a press that moves four pixels as a drag: one move per frame, and no selection at the end", async () => {
    const page = await load(STATE, "agent-1");
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 504, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 520, screenY: 310 }));
    expect(page.calls).toEqual(["dragStart"]);
    page.frame();
    expect(page.calls).toEqual(["dragStart", "dragMove"]);
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 540, screenY: 320 }));
    page.frame();
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 540, screenY: 320 }));
    expect(page.calls).toEqual(["dragStart", "dragMove", "dragMove", "dragEnd"]);
  });

  it("ends a press that is cancelled, or that the window loses, without selecting anything, and sends no move after it", async () => {
    const page = await load(STATE, "agent-1");
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointermove", { screenX: 600, screenY: 300 }));
    page.canvas.dispatchEvent(pointer("pointercancel"));
    page.frame();
    expect(page.calls).toEqual(["dragStart", "dragEnd"]);
    page.canvas.dispatchEvent(pointer("pointerdown", { screenX: 500, screenY: 300 }));
    window.dispatchEvent(new Event("blur"));
    page.canvas.dispatchEvent(pointer("pointerup", { screenX: 500, screenY: 300 }));
    expect(page.calls).toEqual(["dragStart", "dragEnd", "dragStart", "dragEnd"]);
  });

  it("starts no drag with the right button, and asks main for the menu in place of the browser's", async () => {
    const page = await load();
    page.canvas.dispatchEvent(pointer("pointerdown", { button: 2, screenX: 500, screenY: 300 }));
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    page.canvas.dispatchEvent(menu);
    expect(page.calls).toEqual(["menu"]);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("shows whether it is pinned on a real button, and asks main to change it", async () => {
    const page = await load();
    expect(page.pin.tagName).toBe("BUTTON");
    expect(page.pin.getAttribute("aria-pressed")).toBe("false");
    page.push({ ...STATE, pinned: true });
    expect(page.pin.getAttribute("aria-pressed")).toBe("true");
    page.pin.click();
    expect(page.calls).toEqual(["togglePin"]);
  });
});

describe("the widget page's files", () => {
  it("loads only fonts the bundle step copies beside the page", async () => {
    const css = await readFile(join(here, "page.css"), "utf8");
    const bundle = await readFile(join(here, "../../build/bundle.mjs"), "utf8");
    const fonts = [...css.matchAll(/url\("([^"]+\.woff2)"\)/g)].map((match) => match[1] ?? "");
    expect(fonts).toEqual(["jetbrains-mono-400.woff2", "jetbrains-mono-700.woff2"]);
    for (const font of fonts) expect(bundle, font).toContain(`dist/widget/${font}`);
    for (const file of ["index.html", "page.css", "page.js", "preload.js"]) expect(bundle, file).toContain(`dist/widget/${file}`);
  });
});
