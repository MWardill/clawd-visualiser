// The settings page. It renders whatever state the bridge gives it and sends one message per click;
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
const DETAIL_WORDS: Record<SettingsState["detail"], string> = { none: "none", hints: "hints", paths: "paths" };
const HOOK_WORDS: Record<SettingsState["hooks"], string> = { missing: "not installed", current: "installed", stale: "installed, pointing elsewhere" };

const el = (tag: string, text?: string, className?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

function button(label: string, run: () => Promise<SettingsState | void>): HTMLElement {
  const node = el("button", label) as HTMLButtonElement;
  node.addEventListener("click", () => {
    node.disabled = true;
    void run().then((state) => {
      if (state) render(state);
      node.disabled = false;
    });
  });
  return node;
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

function render(state: SettingsState): void {
  const app = document.getElementById("app");
  if (app === null) return;
  const folders = el("ul");
  for (const dir of state.allowlist) {
    const item = el("li", undefined, "row");
    item.append(el("code", dir), button("Remove", () => window.clawd.removeFolder(dir)));
    folders.append(item);
  }
  if (state.allowlist.length === 0) folders.append(el("li", "no folders watched yet", "dim"));

  const levels = el("div", undefined, "row");
  for (const level of ["none", "hints", "paths"] as const) {
    levels.append(button(level === state.detail ? `• ${DETAIL_WORDS[level]}` : DETAIL_WORDS[level], () => window.clawd.setDetail(level)));
  }

  app.replaceChildren(
    section("Agent", [
      row("state", `${AGENT_WORDS[state.agent.mode]} · port ${state.agent.port} · version ${state.agent.version}`),
      row("sessions", `${state.agent.sessions} · ${state.agent.waiting} waiting`),
      row("logs", el("code", state.logDir)),
      row("", button("Open logs folder", () => window.clawd.openLogs())),
      ...(state.agent.mode === "failed" ? [row("retry", button("Start the agent again", () => window.clawd.retryAgent()))] : []),
    ]),
    section("This app", [row("version", state.app.version), row("runs from", el("code", state.app.exe))]),
    section("Watched folders", [folders, row("", button("Add folder…", () => window.clawd.addFolder()))]),
    section("Hooks", [
      row("status", el("span", HOOK_WORDS[state.hooks], state.hooks === "stale" ? "warn" : "dim")),
      row("", button(state.hooks === "missing" ? "Install hooks" : "Reinstall hooks", () => window.clawd.installHooks())),
      ...(state.hooks === "missing" ? [] : [row("", button("Remove hooks", () => window.clawd.uninstallHooks()))]),
    ]),
    section("Detail level", [row("what the local view shows", levels)]),
    section("Start on login", [row("", button(state.openAtLogin ? "On · turn off" : "Off · turn on", () => window.clawd.setOpenAtLogin(!state.openAtLogin)))]),
  );
}

window.clawd.onState(render);
void window.clawd.getState().then(render);
