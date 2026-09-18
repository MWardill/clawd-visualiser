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
