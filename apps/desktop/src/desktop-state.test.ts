import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PLACEMENTS, createDesktopStore, desktopStatePath, parseDesktopState, placementOf, withPlacement, type StoredPlacement } from "./desktop-state";

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
    const widgets = [
      { label: "visualiser", x: 40, y: 60, pinned: true },
      { label: "b2b 2", x: -1200, y: 0, pinned: false },
    ];
    expect(parseDesktopState({ version: 2, view: "widgets", widgets })).toEqual({ view: "widgets", widgets });
    expect(parseDesktopState({ version: 2, view: "floating" })).toEqual({});
    // A non-array widgets is not a list of places at all.
    expect(parseDesktopState({ version: 2, widgets: { ok: { x: 1, y: 2, pinned: false } } })).toEqual({});
    expect(
      parseDesktopState({
        version: 2,
        widgets: [
          { label: "ok", x: 1, y: 2, pinned: false },
          { label: "half", x: 1.5, y: 2, pinned: false }, // a half number
          { label: "loose", x: 1, y: 2 }, // missing pinned
          { label: "", x: 1, y: 2, pinned: true }, // empty label
          7, // not an object
        ],
      }),
    ).toEqual({ widgets: [{ label: "ok", x: 1, y: 2, pinned: false }] });
  });

  it("keeps only the 200 places written last", () => {
    const many = Array.from({ length: MAX_PLACEMENTS + 5 }, (_, i) => ({ label: `folder-${i}`, x: i, y: 0, pinned: false }));
    const kept = parseDesktopState({ version: 2, widgets: many }).widgets ?? [];
    expect(kept).toHaveLength(MAX_PLACEMENTS);
    expect(kept[0]?.label).toBe("folder-5");
  });

  it("keeps a label's last occurrence, in that occurrence's position, when a parsed file repeats it", () => {
    const widgets = [
      { label: "repo", x: 1, y: 1, pinned: false },
      { label: "docs", x: 2, y: 2, pinned: false },
      { label: "repo", x: 9, y: 9, pinned: true },
    ];
    const parsed = parseDesktopState({ version: 2, widgets }).widgets ?? [];
    expect(parsed.map((entry) => entry.label)).toEqual(["docs", "repo"]);
    expect(parsed.find((entry) => entry.label === "repo")).toEqual({ label: "repo", x: 9, y: 9, pinned: true });
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

  it("treats any label as an ordinary folder name, including __proto__, constructor, toString and 2024", () => {
    for (const label of ["__proto__", "constructor", "toString", "2024"]) {
      const widgets = withPlacement(undefined, label, HERE);
      expect(placementOf({ widgets }, label)).toEqual(HERE);
    }
    const widgets = withPlacement(undefined, "repo", HERE);
    expect(placementOf({ widgets }, "docs")).toBeUndefined();
    expect(placementOf({}, "repo")).toBeUndefined();
  });

  it("keeps write order even when a label looks like a number, unlike an object's key order", () => {
    let widgets: StoredPlacement[] | undefined;
    for (const label of ["b", "2024", "c", "d"]) widgets = withPlacement(widgets, label, HERE);
    expect(widgets?.map((entry) => entry.label)).toEqual(["b", "2024", "c", "d"]);
  });

  it("drops the first-written label past the cap even when a number-like label was written second", () => {
    let widgets = withPlacement(undefined, "folder-0", HERE);
    widgets = withPlacement(widgets, "2024", HERE);
    for (let i = 2; i < MAX_PLACEMENTS; i++) widgets = withPlacement(widgets, `folder-${i}`, HERE);
    expect(widgets).toHaveLength(MAX_PLACEMENTS);

    widgets = withPlacement(widgets, "one-more", HERE);
    expect(widgets).toHaveLength(MAX_PLACEMENTS);
    expect(widgets.map((entry) => entry.label)).not.toContain("folder-0");
    expect(widgets.map((entry) => entry.label)).toContain("2024");
  });

  it("writes a place last, replacing the folder's old one, and drops the oldest past the cap, without mutating the list passed in", () => {
    expect(withPlacement(undefined, "repo", HERE)).toEqual([{ label: "repo", ...HERE }]);

    const before: StoredPlacement[] = [
      { label: "repo", ...HERE },
      { label: "docs", ...HERE },
    ];
    const snapshot = before.map((entry) => ({ ...entry }));
    const moved = withPlacement(before, "repo", { ...HERE, x: 99 });
    expect(moved.map((entry) => entry.label)).toEqual(["docs", "repo"]);
    expect(moved.find((entry) => entry.label === "repo")).toEqual({ label: "repo", ...HERE, x: 99 });
    expect(before).toEqual(snapshot);

    const full: StoredPlacement[] = Array.from({ length: MAX_PLACEMENTS }, (_, i) => ({ label: `folder-${i}`, ...HERE }));
    const next = withPlacement(full, "new", HERE);
    expect(next).toHaveLength(MAX_PLACEMENTS);
    expect(next[0]?.label).toBe("folder-1");
    expect(next.at(-1)?.label).toBe("new");
    expect(full).toHaveLength(MAX_PLACEMENTS); // not mutated
  });
});
