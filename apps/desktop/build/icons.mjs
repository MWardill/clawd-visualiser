// Draws the icons from the canonical Clawd sprite and writes them under resources, where they are
// checked in: two tray ICOs (plain and badged) at the sizes Windows asks for, and the app's ICO up to
// 256 px for the packager. `--check` decodes each checked-in image and compares its pixels with a
// fresh render, so the icons cannot drift from the sprite, and a Node whose zlib packs the same
// pixels differently does not fail it; a file that is truncated, corrupted, or padded with bytes past
// its last image also counts as differing, never as a crash. Run it when the sprite or the palette
// changes: pnpm --filter @clawd/desktop icons
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");

// The sprite lives in @clawd/scene and the drawing in src/icons.ts, both TypeScript, so esbuild
// bundles the two into one module first and Node imports it from memory.
const bundled = await build({
  stdin: {
    contents: 'export { CLAWD_BODY, PALETTE } from "@clawd/scene";\nexport { APP_ICON, TRAY_ICONS, TRAY_SIZES, encodeIco, encodePng, renderIcon } from "./src/icons.ts";',
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
const { CLAWD_BODY, PALETTE, APP_ICON, TRAY_ICONS, TRAY_SIZES, encodeIco, encodePng, renderIcon } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const colours = { body: PALETTE.clawd.body, eye: PALETTE.clawd.eye, badge: PALETTE.state.amber };
const files = [...TRAY_ICONS.map((icon) => ({ path: join("tray", icon.file), sizes: TRAY_SIZES, badge: icon.badge })), { path: APP_ICON.file, sizes: APP_ICON.sizes, badge: false }];
const render = (size, badge) => Buffer.from(renderIcon(CLAWD_BODY, colours, size, badge));

/** The directory of an ICO: one entry per image, width 0 meaning 256. */
function icoEntries(ico) {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    return { size: ico[at] === 0 ? 256 : ico[at], bytes: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) };
  });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The RGBA pixels of one of our PNGs: 8-bit RGBA (colour type 6), unfiltered rows, exactly as
 * encodePng in src/icons.ts writes them; null for anything else, including truncated or corrupted data.
 */
function decodeRgba(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (png[24] !== 8 || png[25] !== 6) return null; // IHDR bit depth and colour type
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (rows.length !== height * (stride + 1)) return null;
  const out = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    if (rows[row * (stride + 1)] !== 0) return null;
    rows.copy(out, row * stride, row * (stride + 1) + 1, (row + 1) * (stride + 1));
  }
  return { width, height, rgba: out };
}

/**
 * Whether a checked-in ICO exactly spans these sizes with nothing truncated or left over past the
 * last image, each entry decoding to the fresh render. Never throws: a damaged file, at any stage,
 * just means false.
 */
async function matches(target, sizes, badge) {
  const ico = await readFile(target).catch(() => null);
  if (ico === null) return false;
  try {
    const entries = icoEntries(ico);
    if (entries.length !== sizes.length) return false;
    const end = Math.max(...entries.map((entry) => entry.offset + entry.bytes));
    if (end !== ico.length || entries.some((entry) => entry.offset + entry.bytes > ico.length)) return false;
    for (let i = 0; i < sizes.length; i++) {
      const entry = entries[i];
      const image = decodeRgba(ico.subarray(entry.offset, entry.offset + entry.bytes));
      if (entry.size !== sizes[i] || image === null || image.width !== sizes[i] || image.height !== sizes[i]) return false;
      if (!image.rgba.equals(render(sizes[i], badge))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

let differ = false;
for (const file of files) {
  const target = join(root, "resources", file.path);
  if (check) {
    const same = await matches(target, file.sizes, file.badge);
    if (!same) differ = true;
    console.log(`icons: resources/${file.path} ${same ? "matches the sprite" : "DIFFERS from the sprite; run pnpm --filter @clawd/desktop icons"}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, encodeIco(file.sizes.map((size) => ({ size, png: encodePng(size, size, render(size, file.badge)) }))));
    console.log(`icons: wrote resources/${file.path}`);
  }
}
if (differ) process.exit(1);
