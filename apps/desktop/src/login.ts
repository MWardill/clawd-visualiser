// The login item: a Windows Run key entry that starts the app, hidden, when the user signs in. Pure
// decisions; main makes the Electron calls.

/**
 * The app's id (spec §11 appId). Main sets it as the AppUserModelId, which names the Run key entry,
 * so development and the packaged app use one name. Stage 6's electron-builder appId is the same.
 */
export const APP_ID = "io.github.mwardill.clawd-visualiser";

export type LoginItemTarget = { path: string; args: string[] };

/**
 * What the Run key entry launches. Packaged, the exe itself. In development the exe is Electron's,
 * so the app's folder comes first, quoted as Windows needs, just as `electron .` passes it.
 */
export function loginItemTarget(packaged: boolean, execPath: string, appPath: string): LoginItemTarget {
  return { path: execPath, args: packaged ? ["--hidden"] : [`"${appPath}"`, "--hidden"] };
}

export type LoginOnLaunch = "none" | "enableFirstRun" | "reapply";

/**
 * What the login item needs at launch. `remembered` is desktop.json's openAtLogin, absent until the
 * first packaged run or the tray decides; `registered` is whether Windows has an entry for this exe
 * and these arguments. The first packaged run turns it on. After that, an entry the user wants but
 * Windows lacks for this path, as after the folder moved, is written again. An entry Windows already
 * has, and a choice of off, are left alone.
 */
export function loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean }): LoginOnLaunch {
  if (s.remembered === undefined) return s.packaged ? "enableFirstRun" : "none";
  if (s.remembered && !s.registered) return "reapply";
  return "none";
}
