// The settings page. It draws whatever state the bridge gives it and sends one message per change;
// every decision is main's. No framework, no network: window.clawd is its only way out. The page is
// built once and then patched. Main pushes a state whenever a session changes, and rebuilding under
// the reader dropped a button's busy guard, reset a radio mid-request, wiped a text selection and
// swallowed a click that straddled the old nodes and the new.
import type { SettingsApi, SettingsState } from "./state";

declare const window: { clawd: SettingsApi } & Window;

type Detail = SettingsState["detail"];
type Login = "on" | "off";

const AGENT_WORDS: Record<SettingsState["agent"]["mode"], string> = {
  starting: "starting",
  own: "running in this app",
  attached: "attached to another agent",
  restarting: "restarting",
  failed: "failed",
};
const HOOK_WORDS: Record<SettingsState["hooks"], string> = {
  missing: "not installed",
  current: "installed",
  stale: "installed, but not what this app would write now",
  unreadable: "cannot be checked: the agent's config or Claude Code's settings file is not usable",
};
const DETAIL_CHOICES: readonly { value: Detail; label: string }[] = [
  { value: "none", label: "none: states, tool names and timings" },
  { value: "hints", label: "hints: adds programs, file types and web hosts" },
  { value: "paths", label: "paths: adds files, folders and session names" },
];
const LOGIN_CHOICES: readonly { value: Login; label: string }[] = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
];

/** The state last drawn, which a failed request draws again, so a radio the browser already moved goes back. */
let drawn: SettingsState | undefined;
/** The newest request per control, so a slow answer to an earlier choice cannot overwrite a later one. */
const newest = new Map<string, number>();
/** Requests still out, per control. While a group has one, a push leaves its radios where the user put them. */
const pending = new Map<string, number>();

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

/** Every control carries a key: the folder list puts focus back by it, and the tests find controls by it. */
function keyed<E extends HTMLElement>(node: E, key: string): E {
  node.dataset.focusKey = key;
  return node;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Sends one request for a control and draws its answer, unless a newer request for that control has gone since. */
function send(key: string, request: () => Promise<SettingsState | void>): Promise<void> {
  const n = (newest.get(key) ?? 0) + 1;
  newest.set(key, n);
  pending.set(key, (pending.get(key) ?? 0) + 1);
  const settle = (): void => void pending.set(key, Math.max(0, (pending.get(key) ?? 1) - 1));
  return request().then(
    (state) => {
      settle();
      if (state && newest.get(key) === n) render(state, key, true);
    },
    () => {
      settle();
      // No answer: draw what main last said again, so a radio the browser already moved goes back.
      if (drawn !== undefined && newest.get(key) === n) render(drawn, key);
    },
  );
}

/** A button that stays focusable while its request runs: marked busy rather than disabled, since disabling drops focus. */
function button(key: string, label: string, run: () => Promise<SettingsState | void>): HTMLElement {
  const node = keyed(el("button", label) as HTMLButtonElement, key);
  node.type = "button";
  node.addEventListener("click", () => {
    if (node.getAttribute("aria-busy") === "true") return;
    node.setAttribute("aria-busy", "true");
    void send(key, run).finally(() => node.removeAttribute("aria-busy"));
  });
  return node;
}

type Choices<T extends string> = { group: HTMLElement; inputs: Map<T, HTMLInputElement> };

/**
 * Mutually exclusive choices as real radio inputs in a fieldset: arrow keys move between the options,
 * and a screen reader announces the group, each option and which one is chosen.
 */
function choices<T extends string>(key: string, legend: string, options: readonly { value: T; label: string }[], choose: (value: T) => Promise<SettingsState>): Choices<T> {
  const group = el("fieldset", undefined, "choices");
  group.append(el("legend", legend));
  const inputs = new Map<T, HTMLInputElement>();
  for (const option of options) {
    const input = keyed(document.createElement("input"), `${key}:${option.value}`);
    input.type = "radio";
    input.name = key;
    input.value = option.value;
    input.addEventListener("change", () => {
      if (input.checked) void send(key, () => choose(option.value));
    });
    const label = el("label");
    label.append(input, document.createTextNode(option.label));
    group.append(label);
    inputs.set(option.value, input);
  }
  return { group, inputs };
}

/** Puts a group's radios where the state says, unless a request for the group is still out and this draw is not its answer. */
function check<T extends string>(group: Choices<T>, key: string, current: T, answered: string | undefined): void {
  if ((pending.get(key) ?? 0) > 0 && answered !== key) return;
  for (const [value, input] of group.inputs) input.checked = value === current;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const node = el("section");
  node.append(el("h2", title), ...rows);
  return node;
}

function row(label: string, value: HTMLElement): HTMLElement {
  const node = el("div", undefined, "row");
  node.append(el("span", label), value);
  return node;
}

/** The nodes a draw writes to. Made once; every draw after that patches them. */
type View = {
  agent: HTMLElement;
  reasonRow: HTMLElement;
  reason: HTMLElement;
  sessions: HTMLElement;
  logs: HTMLElement;
  retryRow: HTMLElement;
  version: HTMLElement;
  exe: HTMLElement;
  folders: HTMLElement;
  addFolder: HTMLElement;
  hooks: HTMLElement;
  installRow: HTMLElement;
  install: HTMLElement;
  removeRow: HTMLElement;
  detail: Choices<Detail>;
  login: Choices<Login>;
};
let view: View | undefined;
/** The folder list last drawn, as text: the one part of the page that is rebuilt, and only when this changes. */
let drawnFolders = "";

function build(app: HTMLElement): View {
  const agent = el("span", "", "dim");
  const reason = el("span", "", "warn");
  const reasonRow = row("reason", reason);
  const sessions = el("span", "", "dim");
  const logs = el("code");
  const retryRow = row("retry", button("retry", "Start the agent again", () => window.clawd.retryAgent()));
  const version = el("span", "", "dim");
  const exe = el("code");
  const folders = el("ul");
  const addFolder = button("add-folder", "Add folder…", () => window.clawd.addFolder());
  const hooks = el("span");
  const install = button("install-hooks", "Install hooks", () => window.clawd.installHooks());
  const installRow = row("", install);
  const removeRow = row("", button("remove-hooks", "Remove hooks", () => window.clawd.uninstallHooks()));
  const detail = choices<Detail>("detail", "What the local view shows", DETAIL_CHOICES, (level) => window.clawd.setDetail(level));
  const login = choices<Login>("login", "Start the app when you sign in", LOGIN_CHOICES, (value) => window.clawd.setOpenAtLogin(value === "on"));
  app.replaceChildren(
    section("Agent", [row("state", agent), reasonRow, row("sessions", sessions), row("logs", logs), row("", button("open-logs", "Open logs folder", () => window.clawd.openLogs())), retryRow]),
    section("This app", [row("version", version), row("runs from", exe)]),
    section("Watched folders", [folders, row("", addFolder)]),
    section("Hooks", [row("status", hooks), installRow, removeRow]),
    section("Detail level", [detail.group]),
    section("Start on login", [login.group]),
  );
  return { agent, reasonRow, reason, sessions, logs, retryRow, version, exe, folders, addFolder, hooks, installRow, install, removeRow, detail, login };
}

/** The folder list is the one thing rebuilt, and only when it differs. Focus inside it goes to the same folder's button, or to Add folder when that folder has gone. */
function drawFolders(v: View, allowlist: readonly string[]): void {
  const text = JSON.stringify(allowlist);
  if (text === drawnFolders) return;
  drawnFolders = text;
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && v.folders.contains(active) ? active.dataset.focusKey : undefined;
  const items = allowlist.map((dir) => {
    const item = el("li", undefined, "row");
    item.append(el("code", dir), button(`remove-folder:${dir}`, "Remove", () => window.clawd.removeFolder(dir)));
    return item;
  });
  v.folders.replaceChildren(...(items.length === 0 ? [el("li", "no folders watched yet", "dim")] : items));
  if (focusKey === undefined) return;
  const again = Array.from(v.folders.querySelectorAll<HTMLElement>("button")).find((node) => node.dataset.focusKey === focusKey);
  (again ?? v.addFolder).focus();
}

/**
 * The notice, in the live region page.html always renders. The paragraph is replaced only when its
 * text changes, so a push that carries the same notice is not read out again, or when the user's own
 * action has just earned the same sentence a second time, which should be.
 */
function announce(notice: string | null, again: boolean): void {
  const region = document.getElementById("notice-region");
  if (region === null) return;
  const shown = region.firstElementChild?.textContent ?? null;
  if (shown === notice && !(again && notice !== null)) return;
  if (notice === null) region.replaceChildren();
  else region.replaceChildren(el("p", notice, "notice"));
}

/**
 * Draws a state. `answered` names the control whose request this state answers, when it answers one:
 * that group is set from it even while an older request of its own is still out. `announceAgain` is
 * true for an answer to the user's own action.
 */
function render(state: SettingsState, answered?: string, announceAgain = false): void {
  const app = document.getElementById("app");
  if (app === null) return;
  const v = (view ??= build(app));
  drawn = state;
  const focused = document.activeElement;

  announce(state.notice, announceAgain);
  setText(v.agent, `${AGENT_WORDS[state.agent.mode]} · port ${state.agent.port} · version ${state.agent.version}`);
  setText(v.reason, state.agent.error ?? "");
  v.reasonRow.hidden = state.agent.error === null;
  setText(v.sessions, `${state.agent.sessions} · ${state.agent.waiting} waiting`);
  setText(v.logs, state.logDir);
  v.retryRow.hidden = state.agent.mode !== "failed";
  setText(v.version, state.app.version);
  setText(v.exe, state.app.exe);
  drawFolders(v, state.allowlist);
  setText(v.hooks, HOOK_WORDS[state.hooks]);
  v.hooks.className = state.hooks === "current" || state.hooks === "missing" ? "dim" : "warn";
  v.installRow.hidden = state.hooks === "unreadable";
  setText(v.install, state.hooks === "missing" ? "Install hooks" : "Reinstall hooks");
  v.removeRow.hidden = state.hooks === "missing" || state.hooks === "unreadable";
  check(v.detail, "detail", state.detail, answered);
  check(v.login, "login", state.openAtLogin ? "on" : "off", answered);

  // A row that has just been hidden may hold the focus, which would strand a keyboard or screen
  // reader user: hand it to the first button still showing in the same section.
  if (focused instanceof HTMLElement && focused.closest("[hidden]") !== null) {
    focused.closest("section")?.querySelector<HTMLElement>(".row:not([hidden]) button")?.focus();
  }
}

window.clawd.onState((state) => render(state));
void window.clawd.getState().then((state) => render(state));