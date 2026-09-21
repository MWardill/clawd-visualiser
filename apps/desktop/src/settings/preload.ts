// Runs before the settings page, in its own world: the page cannot see this code's variables, and
// this code cannot see the page's. `contextBridge` publishes exactly these functions on
// window.clawd, and each one is a message to main. The page has no other way out.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "./channels";
import type { SettingsApi, SettingsState } from "./state";

const invoke = <T>(channel: string, arg?: unknown): Promise<T> => ipcRenderer.invoke(channel, arg) as Promise<T>;

contextBridge.exposeInMainWorld("clawd", {
  getState: () => invoke<SettingsState>(CHANNELS.getState),
  addFolder: () => invoke<SettingsState>(CHANNELS.addFolder),
  removeFolder: (dir: string) => invoke<SettingsState>(CHANNELS.removeFolder, dir),
  installHooks: () => invoke<SettingsState>(CHANNELS.installHooks),
  uninstallHooks: () => invoke<SettingsState>(CHANNELS.uninstallHooks),
  setDetail: (level: SettingsState["detail"]) => invoke<SettingsState>(CHANNELS.setDetail, level),
  setOpenAtLogin: (on: boolean) => invoke<SettingsState>(CHANNELS.setOpenAtLogin, on),
  retryAgent: () => invoke<SettingsState>(CHANNELS.retryAgent),
  openLogs: () => invoke<void>(CHANNELS.openLogs),
  onState: (cb: (s: SettingsState) => void) => {
    const listener = (_event: unknown, state: SettingsState): void => cb(state);
    ipcRenderer.on(CHANNELS.state, listener);
    return () => void ipcRenderer.off(CHANNELS.state, listener);
  },
} satisfies SettingsApi);
