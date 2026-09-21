// The login item: a Windows Run key entry that starts the app, hidden, when the user signs in. Pure
// decisions; main makes the Electron calls.

/**
 * The app's id (spec §11 appId), matching electron-builder.yml's appId. electron-builder does not set
 * the packaged app's AppUserModelId itself for the dir and zip targets; main's `app.setAppUserModelId`
 * call is what names the login item's Run key entry. A development run uses `appUserModelId(false)`
 * instead.
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
 * launch, since nothing acts on its toggle in development and the packaged app owns the real
 * choice. `remembered` comes from this build's own state file's openAtLogin, absent until its first
 * packaged run or a toggle; `registered` is whether Windows has an entry for this exe and these
 * arguments. The first packaged run turns it on. After that, an entry the user wants but Windows
 * lacks for this path, as after the folder moved, is written again. An entry Windows already has,
 * and a choice of off, are left alone. `stateUsable` is false when that file exists but could not
 * be read, and then nothing is touched.
 */
export function loginOnLaunch(s: { packaged: boolean; remembered: boolean | undefined; registered: boolean; stateUsable: boolean }): LoginOnLaunch {
  // A state file that could not be read may hold a choice of off: leave the entry as Windows has it.
  if (!s.packaged || !s.stateUsable) return "none";
  if (s.remembered === undefined) return "enableFirstRun";
  if (s.remembered && !s.registered) return "reapply";
  return "none";
}

/** The parts of Electron's `getLoginItemSettings()` answer the control reads. */
export type LoginItemRead = { openAtLogin: boolean; launchItems?: readonly { name: string; enabled: boolean }[] };

/**
 * What the Start on login control shows. `openAtLogin` says Windows has a Run value for this exe; it
 * stays true when the user switches the entry off in Task Manager's startup list, which Windows
 * records beside the value rather than by removing it. Electron reports that per entry, under the
 * Run value's name, and an entry of ours it reports as disabled shows as off. When it reports no
 * entry of ours, which stage 6 saw for the packaged exe, the Run value is all there is to go on.
 */
export function shownAtLogin(read: LoginItemRead, name: string): boolean {
  if (!read.openAtLogin) return false;
  const ours = (read.launchItems ?? []).filter((item) => item.name === name);
  return ours.length === 0 || ours.some((item) => item.enabled);
}
