// Bundles the main process into one CommonJS file. Electron loads `main` from package.json as a
// plain Node module, and the workspace packages export TypeScript, so a bundler has to run first.
import { build } from "esbuild";
import { cp, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/**
 * koffi's JavaScript is bundled, its binary is not: the require of its own `.node` fails at run time
 * and koffi then looks under process.resourcesPath, where electron-builder.yml puts the binary, or
 * under node_modules in a development run.
 */
const nativeBinariesStayOut = {
  name: "native-binaries-stay-out",
  setup(b) {
    b.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }));
  },
};

await build({
  entryPoints: [here("../src/main.ts")],
  outfile: here("../dist/main.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // The runtime provides Electron's module; bundling it would break it.
  external: ["electron"],
  plugins: [nativeBinariesStayOut],
  sourcemap: true,
  logLevel: "info",
});

/** The pages served from their own app:// hosts, each built and given its files the same way. */
const PAGES = ["settings", "widget"];
/** The latin JetBrains Mono at 400 and 700, from the dev dependency rather than a checked-in binary: source in the package, name beside the page; the licence (OFL 1.1) is copied beside the fonts too, because the licence asks it of a redistribution. */
const PAGE_FONTS = [
  ["files/jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-400.woff2"],
  ["files/jetbrains-mono-latin-700-normal.woff2", "jetbrains-mono-700.woff2"],
];
const font = (file) => here(`../node_modules/@fontsource/jetbrains-mono/${file}`);

// A preload is parsed before every page it serves. It needs the channel names and Electron's bridge,
// nothing more; if one grows past this, something has pulled a library into it again.
const PRELOAD_LIMIT = 20_000;

for (const page of PAGES) {
  // The preload runs in Electron's preload world, which is CommonJS; the page is an ordinary script.
  await build({
    entryPoints: [here(`../src/${page}/preload.ts`)],
    outfile: here(`../dist/${page}/preload.js`),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true,
    logLevel: "info",
  });
  await build({
    entryPoints: [here(`../src/${page}/page.ts`)],
    outfile: here(`../dist/${page}/page.js`),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome130",
    sourcemap: true,
    logLevel: "info",
  });
  await cp(here(`../src/${page}/page.html`), here(`../dist/${page}/index.html`));
  await cp(here(`../src/${page}/page.css`), here(`../dist/${page}/page.css`));
  for (const [source, name] of PAGE_FONTS) {
    await cp(font(source), here(`../dist/${page}/${name}`));
  }
  await cp(font("LICENSE"), here(`../dist/${page}/jetbrains-mono-LICENSE.txt`));

  const preloadSize = (await stat(here(`../dist/${page}/preload.js`))).size;
  if (preloadSize > PRELOAD_LIMIT) {
    console.error(`bundle: dist/${page}/preload.js is ${preloadSize} bytes, over the ${PRELOAD_LIMIT} it is allowed; check what src/${page}/preload.ts imports`);
    process.exit(1);
  }
}

// The tray loads its icons from beside main.cjs, as the window loads the export.
await cp(here("../resources/tray"), here("../dist/tray"), { recursive: true });

// The app's own icon goes beside the tray's, so the one extraResources entry carries it: every
// window is given it by path, and a development run is electron.exe, whose icon is Electron's.
await cp(here("../resources/icon.ico"), here("../dist/tray/app.ico"));

// The hook scripts ship as they are: the installer copies them into <home>/bin, where they read
// ../config.json beside themselves, so they must not be bundled.
await cp(here("../../agent/hooks"), here("../dist/hooks"), { recursive: true });
