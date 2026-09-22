// What sits beside the bundle, and what sits beside the archive. esbuild writes dist/main.cjs and
// build/bundle.mjs fills five directories next to it. Packaged, main.cjs and the three pages travel
// inside app.asar, which Node's read calls see through; the tray icons and the hook scripts are used
// as files (an image loaded by path, scripts copied into the user's home), so the packager puts them
// beside the archive in the resources directory, and main passes that directory in.
import { join } from "node:path";

export type DistPaths = { renderer: string; tray: string; settings: string; widget: string; hooks: string; appIcon: string };

/**
 * `dir` is the bundle's directory. `resources` is where the icons and the scripts are: the same
 * directory in development, `process.resourcesPath` when packaged. The app's own icon is beside the
 * tray's: a window's `icon` is a path too, and an asar is transparent only to Node's read calls.
 */
export function distPaths(dir: string, resources: string): DistPaths {
  return {
    renderer: join(dir, "renderer"),
    settings: join(dir, "settings"),
    widget: join(dir, "widget"),
    tray: join(resources, "tray"),
    hooks: join(resources, "hooks"),
    appIcon: join(resources, "tray", "app.ico"),
  };
}
