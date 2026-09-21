// Bundles the main process into one CommonJS file. Electron loads `main` from package.json as a
// plain Node module, and the workspace packages export TypeScript, so a bundler has to run first.
import { build } from "esbuild";
import { cp, stat } from "node:fs/promises";
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
  sourcemap: true,
  logLevel: "info",
});
await build({
  entryPoints: [here("../src/settings/page.ts")],
  outfile: here("../dist/settings/page.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome130",
  sourcemap: true,
  logLevel: "info",
});
await cp(here("../src/settings/page.html"), here("../dist/settings/index.html"));
await cp(here("../src/settings/page.css"), here("../dist/settings/page.css"));

// The settings page's font: the latin subset of JetBrains Mono, from a dev dependency rather than a
// checked-in binary, with its licence (OFL 1.1) beside it, as the licence asks of a redistribution.
const font = (file) => here(`../node_modules/@fontsource/jetbrains-mono/${file}`);
await cp(font("files/jetbrains-mono-latin-400-normal.woff2"), here("../dist/settings/jetbrains-mono-400.woff2"));
await cp(font("files/jetbrains-mono-latin-700-normal.woff2"), here("../dist/settings/jetbrains-mono-700.woff2"));
await cp(font("LICENSE"), here("../dist/settings/jetbrains-mono-LICENSE.txt"));

// The preload is parsed before every settings page. It needs the channel names and Electron's
// bridge, nothing more; if it grows past this, something has pulled a library into it again.
const PRELOAD_LIMIT = 20_000;
const preloadSize = (await stat(here("../dist/settings/preload.js"))).size;
if (preloadSize > PRELOAD_LIMIT) {
  console.error(`bundle: dist/settings/preload.js is ${preloadSize} bytes, over the ${PRELOAD_LIMIT} it is allowed; check what src/settings/preload.ts imports`);
  process.exit(1);
}

// The tray loads its icons from beside main.cjs, as the window loads the export.
await cp(here("../resources/tray"), here("../dist/tray"), { recursive: true });

// The hook scripts ship as they are: the installer copies them into <home>/bin, where they read
// ../config.json beside themselves, so they must not be bundled.
await cp(here("../../agent/hooks"), here("../dist/hooks"), { recursive: true });
