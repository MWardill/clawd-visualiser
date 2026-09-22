// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { SettingsApi, SettingsState } from "./state";

const STATE: SettingsState = {
  agent: { mode: "own", port: 4750, version: "0.1.0", sessions: 2, waiting: 0, error: null },
  app: { version: "0.1.0", exe: "C:\\Apps\\Clawd Visualiser\\Clawd Visualiser.exe" },
  allowlist: ["C:\\repos\\one", "C:\\repos\\two"],
  hooks: "current",
  detail: "none",
  openAtLogin: false,
  view: "window",
  logDir: "C:\\logs",
  notice: null,
};

// The real markup, less the script tag: the test imports the page's module itself.
const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), "page.html"), "utf8");
const BODY = (/<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "").replace(/<script[^>]*><\/script>/g, "");

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Loads a fresh copy of the page over a stub bridge, and waits for its first draw. */
async function load(over: Partial<SettingsApi> = {}, initial: SettingsState = STATE) {
  vi.resetModules();
  document.body.innerHTML = BODY;
  const listeners: Array<(s: SettingsState) => void> = [];
  const api: SettingsApi = {
    getState: async () => initial,
    addFolder: async () => initial,
    removeFolder: async () => initial,
    installHooks: async () => initial,
    uninstallHooks: async () => initial,
    setDetail: async () => initial,
    setOpenAtLogin: async () => initial,
    setView: async () => initial,
    retryAgent: async () => initial,
    openLogs: async () => {},
    onState: (cb) => {
      listeners.push(cb);
      return () => {};
    },
    ...over,
  };
  (window as unknown as { clawd: SettingsApi }).clawd = api;
  await import("./page");
  await flush();
  return { push: (state: SettingsState): void => listeners.forEach((cb) => cb(state)) };
}

function control<E extends HTMLElement = HTMLElement>(key: string): E {
  const found = Array.from(document.querySelectorAll<E>("[data-focus-key]")).find((node) => node.dataset.focusKey === key);
  if (found === undefined) throw new Error(`no control with the key ${key}`);
  return found;
}

const radio = (key: string): HTMLInputElement => control<HTMLInputElement>(key);

/** What the browser does when the user picks a radio: move the mark, then say so. */
function choose(key: string): void {
  const input = radio(key);
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const region = (): HTMLElement => {
  const node = document.getElementById("notice-region");
  if (node === null) throw new Error("no live region");
  return node;
};

/** The live region inside one section, where a notice answering a click in that section appears. */
const sectionRegion = (name: string): HTMLElement => {
  const node = document.getElementById(`notice-${name}`);
  if (node === null) throw new Error(`no live region for ${name}`);
  return node;
};

describe("the settings page", () => {
  it("is built once: a push patches the text in place and keeps every node, so focus survives it", async () => {
    const page = await load();
    const add = control("add-folder");
    const hints = radio("detail:hints");
    const remove = control("remove-folder:C:\\repos\\one");
    add.focus();
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 4, waiting: 1 } });
    expect(control("add-folder")).toBe(add);
    expect(radio("detail:hints")).toBe(hints);
    expect(control("remove-folder:C:\\repos\\one")).toBe(remove);
    expect(document.activeElement).toBe(add);
    expect(document.body.textContent).toContain("4 · 1 waiting");
    expect(document.body.textContent).not.toContain("Loading");
  });

  it("keeps a button busy across a push, so a second click while the picker is open asks for nothing", async () => {
    let asked = 0;
    const picking = deferred<SettingsState>();
    const page = await load({
      addFolder: () => {
        asked++;
        return picking.promise;
      },
    });
    control("add-folder").click();
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 3 } });
    control("add-folder").click();
    expect(asked).toBe(1);
    expect(control("add-folder").getAttribute("aria-busy")).toBe("true");
    picking.resolve(STATE);
    await flush();
    expect(control("add-folder").hasAttribute("aria-busy")).toBe(false);
    control("add-folder").click();
    expect(asked).toBe(2);
  });

  it("does not let a slow answer to an earlier choice overwrite a later one", async () => {
    const first = deferred<SettingsState>();
    const second = deferred<SettingsState>();
    const answers = [first, second];
    await load({ setDetail: () => (answers.shift() ?? second).promise });
    choose("detail:hints");
    choose("detail:paths");
    second.resolve({ ...STATE, detail: "paths" });
    await flush();
    first.resolve({ ...STATE, detail: "hints" });
    await flush();
    expect(radio("detail:paths").checked).toBe(true);
    expect(radio("detail:hints").checked).toBe(false);
  });

  it("sets a group from its newest answer even while an older request is still out, so a refused choice goes back at once", async () => {
    const first = deferred<SettingsState>();
    const second = deferred<SettingsState>();
    const answers = [first, second];
    await load({ setDetail: () => (answers.shift() ?? second).promise });
    choose("detail:hints");
    choose("detail:paths");
    second.resolve({ ...STATE, detail: "none", notice: "the detail level could not be saved; see the log" });
    await flush();
    expect(radio("detail:none").checked).toBe(true);
    expect(radio("detail:paths").checked).toBe(false);
    expect(sectionRegion("detail").textContent).toContain("could not be saved");
  });

  it("puts a radio back when its request fails, by drawing main's last state again", async () => {
    await load({ setOpenAtLogin: () => Promise.reject(new Error("main is gone")) });
    choose("login:on");
    expect(radio("login:on").checked).toBe(true);
    await flush();
    expect(radio("login:off").checked).toBe(true);
    expect(radio("login:on").checked).toBe(false);
  });

  it("leaves a radio where the user put it when a push arrives before the answer, and follows pushes again afterwards", async () => {
    const saving = deferred<SettingsState>();
    const page = await load({ setDetail: () => saving.promise });
    choose("detail:hints");
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 5 } });
    expect(radio("detail:hints").checked).toBe(true);
    saving.resolve({ ...STATE, detail: "hints" });
    await flush();
    expect(radio("detail:hints").checked).toBe(true);
    page.push({ ...STATE, detail: "paths" });
    expect(radio("detail:paths").checked).toBe(true);
    expect(radio("detail:hints").checked).toBe(false);
  });

  it("rebuilds the folder list only when the list changes, keeping focus on the same folder's button, or on Add folder when that folder is gone", async () => {
    const page = await load();
    const two = control("remove-folder:C:\\repos\\two");
    page.push({ ...STATE, hooks: "stale" });
    expect(control("remove-folder:C:\\repos\\two")).toBe(two);

    two.focus();
    page.push({ ...STATE, allowlist: ["C:\\repos\\two"] });
    expect(document.activeElement).toBe(control("remove-folder:C:\\repos\\two"));
    expect(document.querySelectorAll("li")).toHaveLength(1);

    page.push({ ...STATE, allowlist: [] });
    expect(document.activeElement).toBe(control("add-folder"));
    expect(document.body.textContent).toContain("no folders watched yet");
  });

  it("shows the rows a state calls for and hides the rest, moving focus out of a row it hides", async () => {
    const page = await load();
    const row = (key: string): HTMLElement => {
      const found = control(key).closest<HTMLElement>(".row");
      if (found === null) throw new Error(`no row for ${key}`);
      return found;
    };
    expect(row("retry").hidden).toBe(true);
    expect(row("remove-hooks").hidden).toBe(false);

    control("remove-hooks").focus();
    page.push({ ...STATE, hooks: "missing" });
    expect(row("remove-hooks").hidden).toBe(true);
    expect(control("install-hooks").textContent).toBe("Install hooks");
    expect(document.activeElement).toBe(control("install-hooks"));

    page.push({ ...STATE, hooks: "unreadable", agent: { ...STATE.agent, mode: "failed", error: "config.json is invalid at: port" } });
    expect(row("install-hooks").hidden).toBe(true);
    expect(row("retry").hidden).toBe(false);
    expect(document.body.textContent).toContain("config.json is invalid at: port");
  });

  it("announces a notice from a live region that is always there: the paragraph goes in, stays the same node across pushes, and comes out", async () => {
    const page = await load();
    expect(region().getAttribute("role")).toBe("status");
    expect(region().hidden).toBe(false);
    expect(region().children).toHaveLength(0);

    page.push({ ...STATE, notice: "refusing to allow a whole filesystem root: C:\\" });
    const said = region().firstElementChild;
    expect(said?.tagName).toBe("P");
    expect(said?.className).toBe("notice");
    expect(said?.textContent).toBe("refusing to allow a whole filesystem root: C:\\");

    // An unrelated push carries the same notice: nothing is replaced, so nothing is read out twice.
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 9 }, notice: "refusing to allow a whole filesystem root: C:\\" });
    expect(region().firstElementChild).toBe(said);

    page.push(STATE);
    expect(region().children).toHaveLength(0);
  });

  it("reads the same refusal out again when the user's own action earns it again, from that action's own section", async () => {
    const refusal = { ...STATE, notice: "no hooks of ours were found; nothing was changed" };
    await load({ uninstallHooks: async () => refusal }, refusal);
    // It came with the first draw, which answered no click, so it starts above the sections.
    expect(region().textContent).toBe("no hooks of ours were found; nothing was changed");

    control("remove-hooks").click();
    await flush();
    expect(region().children).toHaveLength(0);
    expect(sectionRegion("hooks").textContent).toBe("no hooks of ours were found; nothing was changed");

    const said = sectionRegion("hooks").firstElementChild;
    control("remove-hooks").click();
    await flush();
    expect(sectionRegion("hooks").firstElementChild).not.toBe(said);
  });

  it("gives every section that owns a control its own live region, there from the first draw", async () => {
    await load();
    for (const name of ["agent", "view", "folders", "hooks", "detail", "login"]) {
      expect(sectionRegion(name).getAttribute("role"), name).toBe("status");
      expect(sectionRegion(name).hidden, name).toBe(false);
      expect(sectionRegion(name).children, name).toHaveLength(0);
    }
  });

  it("puts a notice that answers a click beside the control that earned it, and a push carrying the same one leaves it there", async () => {
    const refused = "the agent this app is attached to was started from another home and would refuse these hooks; stop it and this app will start its own";
    const page = await load({ installHooks: async () => ({ ...STATE, notice: refused }) });
    control("install-hooks").click();
    await flush();
    expect(sectionRegion("hooks").textContent).toBe(refused);
    expect(region().children).toHaveLength(0);

    // The host polls while attached: a push carrying the same notice must not move it or replace it.
    const said = sectionRegion("hooks").firstElementChild;
    page.push({ ...STATE, agent: { ...STATE.agent, sessions: 7 }, notice: refused });
    expect(sectionRegion("hooks").firstElementChild).toBe(said);
    expect(region().children).toHaveLength(0);
  });

  it("keeps a notice nobody's click earned above the sections, where it was before", async () => {
    const page = await load();
    page.push({ ...STATE, notice: "saved; the agent this app is attached to keeps its own settings until it is restarted" });
    expect(region().textContent).toContain("keeps its own settings");
    for (const name of ["agent", "view", "folders", "hooks", "detail", "login"]) expect(sectionRegion(name).children, name).toHaveLength(0);
  });

  it("takes a notice out of one section when the next one belongs to another", async () => {
    const root = "refusing to allow a whole filesystem root: C:\\";
    await load({ installHooks: async () => ({ ...STATE, notice: "the hooks could not be written; see the log" }), addFolder: async () => ({ ...STATE, notice: root }) });
    control("install-hooks").click();
    await flush();
    expect(sectionRegion("hooks").children).toHaveLength(1);

    control("add-folder").click();
    await flush();
    expect(sectionRegion("hooks").children).toHaveLength(0);
    expect(sectionRegion("folders").textContent).toBe(root);
  });

  it("offers the view as two radios after This app, asks main for the one chosen, and puts a notice about it in its own section", async () => {
    const asked: string[] = [];
    const held = "applied for this run; desktop.json could not be read when the app started, so the choice will not be remembered";
    await load({
      setView: async (view) => {
        asked.push(view);
        return { ...STATE, view, notice: held };
      },
    });
    expect(Array.from(document.querySelectorAll("h2")).map((h) => h.textContent)).toEqual(["Agent", "This app", "View", "Watched folders", "Hooks", "Detail level", "Start on login"]);
    expect(radio("view:window").checked).toBe(true);
    choose("view:widgets");
    await flush();
    expect(asked).toEqual(["widgets"]);
    expect(radio("view:widgets").checked).toBe(true);
    expect(sectionRegion("view").textContent).toBe(held);
    expect(region().children).toHaveLength(0);
  });
});