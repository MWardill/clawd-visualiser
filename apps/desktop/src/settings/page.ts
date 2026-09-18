// The settings page. It renders whatever state the bridge gives it and sends one message per change;
// every decision is main's. No framework, no network: window.clawd is its only way out.
import type { SettingsState } from "./state";

type Api = {
  getState(): Promise<SettingsState>;
  addFolder(): Promise<SettingsState>;
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  openLogs(): Promise<void>;
  onState(cb: (s: SettingsState) => void): () => void;
};
declare const window: { clawd: Api } & Window;

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
const DETAIL_CHOICES: readonly { value: SettingsState["detail"]; label: string }[] = [
  { value: "none", label: "none: states, tool names and timings" },
  { value: "hints", label: "hints: adds programs, file types and web hosts" },
  { value: "paths", label: "paths: adds files, folders and session names" },
];
const LOGIN_CHOICES = [
  { value: "off", label: "off" },
  { value: "on", label: "on" },
] as const;

/** The state last drawn, so a push that changes nothing does not rebuild the page under the reader. */
let drawn: { state: SettingsState; text: string } | undefined;
/** The newest request per control, so a slow answer to an earlier choice cannot overwrite a later one. */
const newest = new Map<string, number>();

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

/** Every control carries a key, so focus can be put back after the page is rebuilt. */
function keyed<E extends HTMLElement>(node: E, key: string): E {
  node.dataset.focusKey = key;
  return node;
}

/** Sends one request for a control and draws its answer, unless a newer request for that control has gone since. */
function send(key: string, request: () => Promise<SettingsState | void>): Promise<void> {
  const n = (newest.get(key) ?? 0) + 1;
  newest.set(key, n);
  return request().then(
    (state) => {
      if (state && newest.get(key) === n) render(state, true);
    },
    () => {
      // No answer: redraw what main last said, so a radio the browser already moved goes back.
      if (drawn !== undefined && newest.get(key) === n) render(drawn.state, true);
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

/**
 * Mutually exclusive choices as real radio inputs in a fieldset: arrow keys move between the options,
 * and a screen reader announces the group, each option and which one is chosen.
 */
function choices<T extends string>(
  key: string,
  legend: string,
  options: readonly { value: T; label: string }[],
  current: T,
  choose: (value: T) => Promise<SettingsState>,
): HTMLElement {
  const group = el("fieldset", undefined, "choices");
  group.append(el("legend", legend));
  for (const option of options) {
    const input = keyed(document.createElement("input"), `${key}:${option.value}`);
    input.type = "radio";
    input.name = key;
    input.value = option.value;
    input.checked = option.value === current;
    input.addEventListener("change", () => {
      if (input.checked) void send(key, () => choose(option.value));
    });
    const label = el("label");
    label.append(input, document.createTextNode(option.label));
    group.append(label);
  }
  return group;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const node = el("section");
  node.append(el("h2", title), ...rows);
  return node;
}

function row(label: string, value: HTMLElement | string): HTMLElement {
  const node = el("div", undefined, "row");
  node.append(el("span", label), typeof value === "string" ? el("span", value, "dim") : value);
  return node;
}

/** Draws the page. A push that changes nothing is skipped; an answer to the user's own action always draws. */
function render(state: SettingsState, force = false): void {
  const app = document.getElementById("app");
  if (app === null) return;
  const text = JSON.stringify(state);
  if (!force && text === drawn?.text) return;
  drawn = { state, text };
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement ? active.dataset.focusKey : undefined;

  // A permanent live region, present since page.html: a node inserted fresh on every render is
  // announced unreliably, so the notice's text and visibility are set on the same element each time.
  const notice = document.getElementById("notice");
  if (notice !== null) {
    notice.textContent = state.notice ?? "";
    notice.hidden = state.notice === null;
  }

  const folders = el("ul");
  for (const dir of state.allowlist) {
    const item = el("li", undefined, "row");
    item.append(el("code", dir), button(`remove-folder:${dir}`, "Remove", () => window.clawd.removeFolder(dir)));
    folders.append(item);
  }
  if (state.allowlist.length === 0) folders.append(el("li", "no folders watched yet", "dim"));

  app.replaceChildren(
    section("Agent", [
      row("state", `${AGENT_WORDS[state.agent.mode]} · port ${state.agent.port} · version ${state.agent.version}`),
      ...(state.agent.error === null ? [] : [row("reason", el("span", state.agent.error, "warn"))]),
      row("sessions", `${state.agent.sessions} · ${state.agent.waiting} waiting`),
      row("logs", el("code", state.logDir)),
      row("", button("open-logs", "Open logs folder", () => window.clawd.openLogs())),
      ...(state.agent.mode === "failed" ? [row("retry", button("retry", "Start the agent again", () => window.clawd.retryAgent()))] : []),
    ]),
    section("This app", [row("version", state.app.version), row("runs from", el("code", state.app.exe))]),
    section("Watched folders", [folders, row("", button("add-folder", "Add folder…", () => window.clawd.addFolder()))]),
    section("Hooks", [
      row("status", el("span", HOOK_WORDS[state.hooks], state.hooks === "current" || state.hooks === "missing" ? "dim" : "warn")),
      ...(state.hooks === "unreadable" ? [] : [row("", button("install-hooks", state.hooks === "missing" ? "Install hooks" : "Reinstall hooks", () => window.clawd.installHooks()))]),
      ...(state.hooks === "missing" || state.hooks === "unreadable" ? [] : [row("", button("remove-hooks", "Remove hooks", () => window.clawd.uninstallHooks()))]),
    ]),
    section("Detail level", [choices("detail", "What the local view shows", DETAIL_CHOICES, state.detail, (level) => window.clawd.setDetail(level))]),
    section("Start on login", [
      choices("login", "Start the app when you sign in", LOGIN_CHOICES, state.openAtLogin ? "on" : "off", (value) => window.clawd.setOpenAtLogin(value === "on")),
    ]),
  );

  // Rebuilding the page drops focus, which strands a keyboard or screen reader user, so put it back.
  if (focusKey !== undefined) app.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

window.clawd.onState((state) => render(state));
void window.clawd.getState().then((state) => render(state, true));
