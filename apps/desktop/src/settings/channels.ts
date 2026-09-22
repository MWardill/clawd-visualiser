// The settings bridge's channel names, in a file that imports nothing. The preload needs only these,
// and it is parsed before every settings page: taken from ipc.ts, they dragged the schema library and
// the whole of core in with them, about 750 kB.

/** One channel per call in the design's §9 bridge, plus the one main pushes state on. */
export const CHANNELS = {
  getState: "clawd:settings/getState",
  addFolder: "clawd:settings/addFolder",
  removeFolder: "clawd:settings/removeFolder",
  installHooks: "clawd:settings/installHooks",
  uninstallHooks: "clawd:settings/uninstallHooks",
  setDetail: "clawd:settings/setDetail",
  setOpenAtLogin: "clawd:settings/setOpenAtLogin",
  setView: "clawd:settings/setView",
  setFinishedPopup: "clawd:settings/setFinishedPopup",
  retryAgent: "clawd:settings/retryAgent",
  openLogs: "clawd:settings/openLogs",
  /** Main to the page: the state changed. */
  state: "clawd:settings/state",
} as const;
