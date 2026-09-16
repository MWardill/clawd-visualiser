// The settings bridge's messages. The page can only send these names, main validates every
// argument, and each answer is the whole new state, so the page never has to ask again. Electron-free
// and tested over fake actions; main hands the real ones to ipcMain.
import { DetailLevelSchema } from "@clawd/core";
import { z } from "zod";
import type { SettingsState } from "../settings-state";

/** One channel per call in the design's §9 bridge, plus the one main pushes state on. */
export const CHANNELS = {
  getState: "clawd:settings/getState",
  addFolder: "clawd:settings/addFolder",
  removeFolder: "clawd:settings/removeFolder",
  installHooks: "clawd:settings/installHooks",
  uninstallHooks: "clawd:settings/uninstallHooks",
  setDetail: "clawd:settings/setDetail",
  setOpenAtLogin: "clawd:settings/setOpenAtLogin",
  retryAgent: "clawd:settings/retryAgent",
  openLogs: "clawd:settings/openLogs",
  /** Main to the page: the state changed. */
  state: "clawd:settings/state",
} as const;

export type SettingsActions = {
  getState(): Promise<SettingsState>;
  addFolder(): Promise<SettingsState>;
  removeFolder(dir: string): Promise<SettingsState>;
  installHooks(): Promise<SettingsState>;
  uninstallHooks(): Promise<SettingsState>;
  setDetail(level: SettingsState["detail"]): Promise<SettingsState>;
  setOpenAtLogin(on: boolean): Promise<SettingsState>;
  retryAgent(): Promise<SettingsState>;
  openLogs(): Promise<void>;
};

export function createHandlers(actions: SettingsActions, fallback: SettingsState): Record<string, (raw: unknown) => Promise<unknown>> {
  const Folder = z.string().min(1);
  // The page treats every answer as the whole new state, so a handler must never reject. `last` is
  // the newest state built successfully; it starts as what main knew when it registered these.
  let last: SettingsState = fallback;
  const answer = async (run: () => Promise<SettingsState>): Promise<SettingsState> => {
    try {
      last = await run();
      return last;
    } catch {
      // The action failed. Try to read the state; if that fails too, the page keeps what it last saw.
      try {
        last = await actions.getState();
      } catch {
        // Nothing fresher is available.
      }
      return last;
    }
  };
  const checked = <T>(schema: z.ZodType<T>, run: (value: T) => Promise<SettingsState>) => {
    return async (raw: unknown): Promise<SettingsState> => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return answer(() => actions.getState());
      return answer(() => run(parsed.data));
    };
  };
  return {
    [CHANNELS.getState]: () => answer(() => actions.getState()),
    [CHANNELS.addFolder]: () => answer(() => actions.addFolder()),
    [CHANNELS.removeFolder]: checked(Folder, (dir) => actions.removeFolder(dir)),
    [CHANNELS.installHooks]: () => answer(() => actions.installHooks()),
    [CHANNELS.uninstallHooks]: () => answer(() => actions.uninstallHooks()),
    [CHANNELS.setDetail]: checked(DetailLevelSchema, (level) => actions.setDetail(level)),
    [CHANNELS.setOpenAtLogin]: checked(z.boolean(), (on) => actions.setOpenAtLogin(on)),
    [CHANNELS.retryAgent]: () => answer(() => actions.retryAgent()),
    [CHANNELS.openLogs]: async () => {
      try {
        await actions.openLogs();
      } catch {
        // Opening a folder is a courtesy; a failure must not break the page.
      }
      return undefined;
    },
  };
}
