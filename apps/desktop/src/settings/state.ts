// The shape the settings page renders. It deliberately spells out its unions instead of importing
// them: the page is sandboxed browser code, checked by tsconfig.page.json with no Node types, so
// anything this file imported would drag the main process's world into that check.
export type SettingsState = {
  agent: {
    mode: "starting" | "own" | "attached" | "restarting" | "failed";
    port: number;
    version: string;
    sessions: number;
    waiting: number;
    /** Why the agent failed, when it did: a config message naming a field, never a value. */
    error: string | null;
  };
  app: { version: string; exe: string };
  allowlist: string[];
  hooks: "missing" | "current" | "stale" | "unreadable";
  detail: "none" | "hints" | "paths";
  openAtLogin: boolean;
  logDir: string;
  /** One sentence about the last action, when it was refused, failed, or was saved but not applied; null otherwise. */
  notice: string | null;
};

/**
 * The bridge: what the preload publishes as `window.clawd`, what the page calls, and, less `onState`,
 * what main's actions implement. The one spelling of it; the preload, the page and the handlers all
 * take it from here, so a call added in one place and not another fails to compile.
 */
export type SettingsApi = {
  getState(): Promise<SettingsState>;
  /** Opens the folder picker. */
  addFolder(): Promise<SettingsState>;
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  openLogs(): Promise<void>;
  /** Subscribes to the states main pushes on its own; returns the unsubscribe. */
  onState(cb: (s: SettingsState) => void): () => void;
};
