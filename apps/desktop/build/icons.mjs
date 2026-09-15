// Draws the tray icons from the canonical Clawd sprite and writes them to resources/tray, where they
// are checked in. Run it when the sprite or the palette changes: pnpm --filter @clawd/desktop icons
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// The sprite lives in @clawd/scene and the drawing in src/icons.ts, both TypeScript, so esbuild
// bundles the two into one module first and Node imports it from memory.
const bundled = await build({
  stdin: {
    contents: 'export { CLAWD_BODY, PALETTE } from "@clawd/scene";\nexport { ICON_GRID, TRAY_ICONS, encodePng, renderTrayIcon } from "./src/icons.ts";',
    resolveDir: root,
    sourcefile: "icons-entry.mjs",
    loader: "js",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "warning",
});
const { CLAWD_BODY, PALETTE, ICON_GRID, TRAY_ICONS, encodePng, renderTrayIcon } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const colours = { body: PALETTE.clawd.body, eye: PALETTE.clawd.eye, badge: PALETTE.state.amber };
const outDir = join(root, "resources", "tray");
await mkdir(outDir, { recursive: true });
for (const icon of TRAY_ICONS) {
  const size = ICON_GRID * icon.scale;
  await writeFile(join(outDir, icon.file), encodePng(size, size, renderTrayIcon(CLAWD_BODY, colours, icon.scale, icon.badge)));
  console.log(`icons: wrote resources/tray/${icon.file} (${size}x${size})`);
}
