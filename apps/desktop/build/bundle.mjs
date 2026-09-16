// Bundles the main process into one CommonJS file. Electron loads `main` from package.json as a
// plain Node module, and the workspace packages export TypeScript, so a bundler has to run first.
import { build } from "esbuild";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here("../src/main.ts")],
  outfile: here("../dist/main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // The runtime provides Electron's module; bundling it would break it.
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

// The preload runs in Electron's preload world, which is CommonJS; the page is an ordinary script.
await build({
  entryPoints: [here("../src/settings/preload.ts")],
  outfile: here("../dist/settings/preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "info",
});
await build({
  entryPoints: [here("../src/settings/page.ts")],
  outfile: here("../dist/settings/page.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  logLevel: "info",
});
await cp(here("../src/settings/page.html"), here("../dist/settings/index.html"));
await cp(here("../src/settings/page.css"), here("../dist/settings/page.css"));

// The tray loads its icons from beside main.cjs, as the window loads the export.
await cp(here("../resources/tray"), here("../dist/tray"), { recursive: true });

// The hook scripts ship as they are: the installer copies them into <home>/bin, where they read
// ../config.json beside themselves, so they must not be bundled.
await cp(here("../../agent/hooks"), here("../dist/hooks"), { recursive: true });
