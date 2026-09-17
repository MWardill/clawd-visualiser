// The login item: a Windows Run key entry that starts the app, hidden, when the user signs in. Pure
// decisions; main makes the Electron calls.

/**
 * The app's id (spec §11 appId). Stage 6's electron-builder appId is the same, so the packaged app's
 * Run key entry is named after it. A development run uses `appUserModelId(false)` instead.
 */
export const APP_ID = "io.github.mwardill.clawd-visualiser";

/**
 * The name of the Run key entry, which is the AppUserModelId main sets. The packaged app uses the id;
 * a development run uses its own name, so the two never read or overwrite each other's entry.
 */
export function appUserModelId(packaged: boolean): string {
  return packaged ? APP_ID : `${APP_ID}.dev`;
}

export type LoginItemTarget = { path: string; args: string[] };

/**
 * What the Run key entry launches. Packaged, the exe itself. In development the exe is Electron's,
 * so the app's folder comes first, just as `electron .` passes it. Electron quotes each argument
 * itself when it writes the Run value, so a path containing spaces still arrives whole.
 */
export function loginItemTarget(packaged: boolean, execPath: string, appPath: string): LoginItemTarget {
  return { path: execPath, args: packaged ? ["--hidden"] : [appPath, "--hidden"] };
}

export type LoginOnLaunch = "none" | "enableFirstRun" | "reapply";

/**
 * What the login item needs at launch, packaged only: a development run never touches the entry at
 * launch, since its toggle is a testing convenience and the packaged app owns the real choice.
 * `remembered` is desktop.json's openAtLogin, absent until the first packaged run or a packaged toggle;
 * `registered` is whether Windows has an entry for this exe and these arguments. The first packaged
 * run turns it on. After that, an entry the user wants but Windows lacks for this path, as after the
 * folder moved, is written again. An entry Windows already has, and a choice of off, are left alone.
 */
export function loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean }): LoginOnLaunch {
  if (!s.packaged) return "none";
  if (s.remembered === undefined) return "enableFirstRun";
  if (s.remembered && !s.registered) return "reapply";
  return "none";
}
