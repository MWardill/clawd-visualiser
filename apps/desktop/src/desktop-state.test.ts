import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PLACEMENTS, createDesktopStore, desktopStatePath, parseDesktopState, placementOf, withPlacement } from "./desktop-state";

const made: string[] = [];
afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "clawd-desktop-state-"));
  made.push(dir);
  return dir;
}

const BOUNDS = { x: 100, y: 80, width: 1280, height: 800 };

describe("desktopStatePath", () => {
  it("is desktop.json for the packaged app and desktop-dev.json for a development run, in the home directory", () => {
    expect(desktopStatePath(join("C:", "home"), true)).toBe(join("C:", "home", "desktop.json"));
    expect(desktopStatePath(join("C:", "home"), false)).toBe(join("C:", "home", "desktop-dev.json"));
  });
});

describe("parseDesktopState", () => {
  it("keeps valid bounds, a boolean maximized and a boolean openAtLogin from a version 2 file", () => {
    expect(parseDesktopState({ version: 2, bounds: BOUNDS, maximized: true, openAtLogin: false })).toEqual({ bounds: BOUNDS, maximized: true, openAtLogin: false });
    expect(parseDesktopState({ version: 2, maximized: "yes" })).toEqual({});
    expect(parseDesktopState({ version: 2 })).toEqual({});
  });

  it("reads a version 1 file, which only development runs before stage 6 wrote, as nothing remembered", () => {
    expect(parseDesktopState({ version: 1, bounds: BOUNDS, openAtLogin: false })).toEqual({});
  });

  it("drops each invalid field on its own, and everything from another version or a non-object", () => {
    expect(parseDesktopState({ version: 2, bounds: { ...BOUNDS, x: "100" }, openAtLogin: true })).toEqual({ openAtLogin: true });
    expect(parseDesktopState({ version: 2, bounds: { ...BOUNDS, width: 0 }, openAtLogin: "yes" })).toEqual({});
    expect(parseDesktopState({ version: 2, bounds: { ...BOUNDS, height: 10.5 } })).toEqual({});
    expect(parseDesktopState({ version: 3, bounds: BOUNDS })).toEqual({});
    expect(parseDesktopState(null)).toEqual({});
    expect(parseDesktopState([BOUNDS])).toEqual({});
  });

  it("keeps the view and each widget's place, each judged on its own", () => {
    const widgets = { visualiser: { x: 40, y: 60, pinned: true }, "b2b 2": { x: -1200, y: 0, pinned: false } };
    expect(parseDesktopState({ version: 2, view: "widgets", widgets })).toEqual({ view: "widgets", widgets });
    expect(parseDesktopState({ version: 2, view: "floating" })).toEqual({});
    expect(parseDesktopState({ version: 2, widgets: [widgets] })).toEqual({});
    expect(parseDesktopState({ version: 2, widgets: { ok: { x: 1, y: 2, pinned: false }, half: { x: 1.5, y: 2, pinned: false }, loose: { x: 1, y: 2 }, "": { x: 1, y: 2, pinned: true }, flat: 7 } })).toEqual({
      widgets: { ok: { x: 1, y: 2, pinned: false } },
    });
  });

  it("keeps only the 200 places written last", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_PLACEMENTS + 5 }, (_, i) => [`folder-${i}`, { x: i, y: 0, pinned: false }]));
    const kept = Object.keys(parseDesktopState({ version: 2, widgets: many }).widgets ?? {});
    expect(kept).toHaveLength(MAX_PLACEMENTS);
    expect(kept[0]).toBe("folder-5");
  });
});

describe("createDesktopStore", () => {
  it("reads nothing remembered from a missing or damaged file", async () => {
    const dir = await tempDir();
    const missing = createDesktopStore(join(dir, "desktop.json"));
    await missing.load();
    expect(missing.get()).toEqual({});
    expect(missing.usable()).toBe(true);

    await writeFile(join(dir, "desktop.json"), "{ not json");
    const damaged = createDesktopStore(join(dir, "desktop.json"));
    await damaged.load();
    expect(damaged.get()).toEqual({});
    expect(damaged.usable()).toBe(true);
  });

  it("tells a file it cannot read from a missing one: nothing is written over it, it says so once, and this run still remembers", async () => {
    const dir = await tempDir();
    const path = join(dir, "desktop.json");
    // A directory where the file should be: the read fails, and not with "no such file", as a locked file would.
    await mkdir(path);
    const codes: string[] = [];
    const store = createDesktopStore(path, (code) => void codes.push(code));
    await store.load();
    expect(store.usable()).toBe(false);
    store.update({ openAtLogin: true });
    store.update({ bounds: BOUNDS });
    await store.flush();
    expect(store.get()).toEqual({ openAtLogin: true, bounds: BOUNDS });
    expect((await stat(path)).isDirectory()).toBe(true);
    expect(await readdir(dir)).toEqual(["desktop.json"]);
    expect(codes).toEqual(["desktop.stateUnreadable"]);
  });

  it("logs a write that fails", async () => {
    const inTheWay = join(await tempDir(), "a-file");
    await writeFile(inTheWay, "");
    const codes: string[] = [];
    const store = createDesktopStore(join(inTheWay, "desktop.json"), (code) => void codes.push(code));
    store.update({ openAtLogin: true });
    await store.flush();
    expect(codes).toEqual(["desktop.stateWriteFailed"]);
  });

  it("loads what was saved, merges each update and writes the whole file as version 2", async () => {
    const path = join(await tempDir(), "desktop.json");
    await writeFile(path, JSON.stringify({ version: 2, bounds: BOUNDS }));
    const store = createDesktopStore(path);
    await store.load();
    expect(store.get()).toEqual({ bounds: BOUNDS });

    store.update({ openAtLogin: true });
    store.update({ bounds: { ...BOUNDS, x: 200 } });
    await store.flush();
    expect(store.get()).toEqual({ bounds: { ...BOUNDS, x: 200 }, openAtLogin: true });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 2, bounds: { ...BOUNDS, x: 200 }, openAtLogin: true });
  });

  it("lets an update made before the load finishes win over the file", async () => {
    const path = join(await tempDir(), "desktop.json");
    await writeFile(path, JSON.stringify({ version: 2, bounds: BOUNDS, openAtLogin: false }));
    const store = createDesktopStore(path);
    const loading = store.load();
    store.update({ openAtLogin: true });
    await loading;
    await store.flush();
    expect(store.get()).toEqual({ bounds: BOUNDS, openAtLogin: true });
  });

  it("never rejects a flush, even when the file cannot be written", async () => {
    const inTheWay = join(await tempDir(), "a-file");
    await writeFile(inTheWay, "");
    const store = createDesktopStore(join(inTheWay, "desktop.json"));
    await store.load();
    store.update({ openAtLogin: true });
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.get()).toEqual({ openAtLogin: true });
  });
});

describe("placements", () => {
  const HERE = { x: 10, y: 20, pinned: false };

  it("reads a folder's place by its own name only, whatever the folder is called", () => {
    const state = parseDesktopState(JSON.parse('{"version":2,"widgets":{"__proto__":{"x":1,"y":2,"pinned":true},"repo":{"x":10,"y":20,"pinned":false}}}'));
    expect(placementOf(state, "repo")).toEqual(HERE);
    expect(placementOf(state, "__proto__")).toEqual({ x: 1, y: 2, pinned: true });
    expect(placementOf(state, "constructor")).toBeUndefined();
    expect(placementOf(state, "toString")).toBeUndefined();
    expect(placementOf({}, "repo")).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined(); // nothing reached the prototype
  });

  it("writes a place last, replacing the folder's old one, and drops the oldest past the cap", () => {
    expect(withPlacement(undefined, "repo", HERE)).toEqual({ repo: HERE });
    const moved = withPlacement({ repo: HERE, docs: HERE }, "repo", { ...HERE, x: 99 });
    expect(Object.keys(moved)).toEqual(["docs", "repo"]);
    expect(moved.repo).toEqual({ ...HERE, x: 99 });
    const full = Object.fromEntries(Array.from({ length: MAX_PLACEMENTS }, (_, i) => [`folder-${i}`, HERE]));
    const next = withPlacement(full, "new", HERE);
    expect(Object.keys(next)).toHaveLength(MAX_PLACEMENTS);
    expect(Object.keys(next)[0]).toBe("folder-1");
    expect(Object.keys(next).at(-1)).toBe("new");
  });
});
