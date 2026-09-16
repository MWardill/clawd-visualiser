// What sits beside the bundle. esbuild writes dist/main.cjs, and build/bundle.mjs fills these four
// directories: the web app's export, the tray icons, the settings page, and the hook scripts the
// installer copies into the user's home.
import { join } from "node:path";

export type DistPaths = { renderer: string; tray: string; settings: string; hooks: string };

export function distPaths(dir: string): DistPaths {
  return { renderer: join(dir, "renderer"), tray: join(dir, "tray"), settings: join(dir, "settings"), hooks: join(dir, "hooks") };
}
