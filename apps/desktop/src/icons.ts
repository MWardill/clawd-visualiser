// The app's icons: the canonical Clawd drawn on a 16-cell grid at any pixel size Windows asks for,
// with an amber dot while sessions wait, encoded as PNG with nothing but node:zlib and gathered into
// ICO files, which hold one image per size so Windows picks a crisp one at every display scale. The
// sprite and colours come in as arguments: build/icons.mjs takes them from @clawd/scene, whose engine
// needs DOM types this package does not load. Pure, so the drawing and both encodings are tested.
import { deflateSync } from "node:zlib";

export type Sprite = {
  width: number;
  height: number;
  data: readonly (readonly number[])[];
  anchors: { eyeLeft: { x: number; y: number }; eyeRight: { x: number; y: number } };
};

export type IconColours = { body: string; eye: string; badge: string };

/** The icon's logical grid, in cells. */
export const ICON_GRID = 16;
/** The sprite's top-left cell: a clear column each side of the 14-wide Clawd, clear rows above it for the badge. */
export const SPRITE_ORIGIN = { x: 1, y: 5 } as const;
/** The badge's top-left cell, in the top-right corner. */
export const BADGE_ORIGIN = { x: 12, y: 0 } as const;
const BADGE = [
  [0, 1, 1, 0],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [0, 1, 1, 0],
] as const;

/** The tray's two ICO files: plain, and with the badge while sessions wait. Windows picks the size from the file. */
export const TRAY_ICONS = [
  { file: "tray.ico", badge: false },
  { file: "tray-waiting.ico", badge: true },
] as const;
/** The images in each tray ICO: 16 px at 100% scaling, 20 at 125%, 24 at 150%, 32 at 200%. */
export const TRAY_SIZES = [16, 20, 24, 32] as const;
/** The app's own icon, stamped into the exe by the packager, which needs the 256 px image. */
export const APP_ICON = { file: "icon.ico", sizes: [16, 24, 32, 48, 64, 128, 256] } as const;
/** The largest image an ICO directory entry can describe. */
const ICO_MAX = 256;

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error("a colour must be #rrggbb");
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** One colour per grid cell, or null where the icon is clear: the sprite, its eyes and, when asked, the badge. */
function cellGrid(sprite: Sprite, colours: IconColours, badge: boolean): (Rgb | null)[] {
  if (SPRITE_ORIGIN.x + sprite.width > ICON_GRID || SPRITE_ORIGIN.y + sprite.height > ICON_GRID) throw new Error("the sprite does not fit the icon grid");
  const body = rgb(colours.body);
  const eye = rgb(colours.eye);
  const amber = rgb(colours.badge);
  const cells: (Rgb | null)[] = Array.from({ length: ICON_GRID * ICON_GRID }, () => null);
  const set = (gx: number, gy: number, colour: Rgb): void => {
    cells[gy * ICON_GRID + gx] = colour;
  };
  for (let row = 0; row < sprite.height; row++) {
    for (let col = 0; col < sprite.width; col++) {
      if (sprite.data[row]?.[col] === 1) set(SPRITE_ORIGIN.x + col, SPRITE_ORIGIN.y + row, body);
    }
  }
  set(SPRITE_ORIGIN.x + sprite.anchors.eyeLeft.x, SPRITE_ORIGIN.y + sprite.anchors.eyeLeft.y, eye);
  set(SPRITE_ORIGIN.x + sprite.anchors.eyeRight.x, SPRITE_ORIGIN.y + sprite.anchors.eyeRight.y, eye);
  if (badge) {
    for (let row = 0; row < BADGE.length; row++) {
      for (let col = 0; col < BADGE[row]!.length; col++) {
        if (BADGE[row]![col] === 1) set(BADGE_ORIGIN.x + col, BADGE_ORIGIN.y + row, amber);
      }
    }
  }
  return cells;
}

/**
 * RGBA pixels, row by row, `size` pixels a side. Each pixel takes the colour of the grid cell it falls
 * in, so a size that is not a multiple of 16 gives cells of uneven width but every edge stays sharp,
 * which is what pixel art wants; 20 and 24 px are what Windows asks for at 125% and 150% scaling.
 */
export function renderIcon(sprite: Sprite, colours: IconColours, size: number, badge: boolean): Uint8Array {
  if (!Number.isInteger(size) || size < ICON_GRID) throw new Error("the size must be a whole number of pixels, at least the grid's 16");
  const cells = cellGrid(sprite, colours, badge);
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const gy = Math.floor((py * ICON_GRID) / size);
    for (let px = 0; px < size; px++) {
      const cell = cells[gy * ICON_GRID + Math.floor((px * ICON_GRID) / size)];
      if (cell === null || cell === undefined) continue;
      const i = (py * size + px) * 4;
      pixels[i] = cell[0];
      pixels[i + 1] = cell[1];
      pixels[i + 2] = cell[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** The grid at a whole-number scale: 16 px at 1×, 32 at 2×. */
export function renderTrayIcon(sprite: Sprite, colours: IconColours, scale: number, badge: boolean): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1) throw new Error("the scale must be a whole number above zero");
  return renderIcon(sprite, colours, ICON_GRID * scale, badge);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A PNG chunk: the data's length, the type, the data, and a CRC over type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(typed.length + 8);
  out.writeUInt32BE(data.length, 0);
  typed.copy(out, 4);
  out.writeUInt32BE(crc32(typed), typed.length + 4);
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An 8-bit RGBA PNG: a header, one compressed block of unfiltered rows, and the end marker. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new Error("the pixel data does not match the size");
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // colour type 6: red, green, blue and alpha
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    // Each row starts with its filter type, and 0 means none; Buffer.alloc has already written it.
    rows.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array(0))]);
}

/**
 * An ICO file: a six-byte header, one sixteen-byte directory entry per image, then the images, each
 * a whole PNG, which Windows has accepted inside an ICO since Vista. A 256 px image is written with
 * width and height 0, the format's spelling for 256.
 */
export function encodeIco(images: readonly { size: number; png: Buffer }[]): Buffer {
  if (images.length === 0) throw new Error("an ICO needs at least one image");
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1: an icon, not a cursor
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    if (!Number.isInteger(size) || size < 1 || size > ICO_MAX) throw new Error("an ICO image is between 1 and 256 pixels a side");
    const entry = Buffer.alloc(16);
    entry[0] = size === ICO_MAX ? 0 : size; // width
    entry[1] = size === ICO_MAX ? 0 : size; // height
    entry[2] = 0; // colours in a palette: none, the image is true colour
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}
