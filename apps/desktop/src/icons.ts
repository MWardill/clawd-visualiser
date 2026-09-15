// The tray icons: the canonical Clawd drawn on a 16-pixel grid at 1× and 2×, with an amber dot while
// sessions wait, encoded as PNG with nothing but node:zlib. The sprite and colours come in as
// arguments: build/icons.mjs takes them from @clawd/scene, whose engine needs DOM types this package
// does not load. Pure, so the drawing and the encoding are tested.
import { deflateSync } from "node:zlib";

export type Sprite = {
  width: number;
  height: number;
  data: readonly (readonly number[])[];
  anchors: { eyeLeft: { x: number; y: number }; eyeRight: { x: number; y: number } };
};

export type IconColours = { body: string; eye: string; badge: string };

/** The icon's logical grid, in pixels at 1×. */
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

/** The files the tray loads. Electron picks the @2x file beside a name on a display scaled to 200%. */
export const TRAY_ICONS = [
  { file: "tray.png", scale: 1, badge: false },
  { file: "tray@2x.png", scale: 2, badge: false },
  { file: "tray-waiting.png", scale: 1, badge: true },
  { file: "tray-waiting@2x.png", scale: 2, badge: true },
] as const;

function rgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null) throw new Error("a colour must be #rrggbb");
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** RGBA pixels, row by row: clear except the sprite, its eyes and, when asked, the badge. */
export function renderTrayIcon(sprite: Sprite, colours: IconColours, scale: number, badge: boolean): Uint8Array {
  if (!Number.isInteger(scale) || scale < 1) throw new Error("the scale must be a whole number above zero");
  if (SPRITE_ORIGIN.x + sprite.width > ICON_GRID || SPRITE_ORIGIN.y + sprite.height > ICON_GRID) throw new Error("the sprite does not fit the icon grid");
  const body = rgb(colours.body);
  const eye = rgb(colours.eye);
  const amber = rgb(colours.badge);
  const size = ICON_GRID * scale;
  const pixels = new Uint8Array(size * size * 4);
  const cell = (gx: number, gy: number, [r, g, b]: readonly [number, number, number]): void => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((gy * scale + dy) * size + gx * scale + dx) * 4;
        pixels[i] = r;
        pixels[i + 1] = g;
        pixels[i + 2] = b;
        pixels[i + 3] = 255;
      }
    }
  };
  for (let row = 0; row < sprite.height; row++) {
    for (let col = 0; col < sprite.width; col++) {
      if (sprite.data[row]?.[col] === 1) cell(SPRITE_ORIGIN.x + col, SPRITE_ORIGIN.y + row, body);
    }
  }
  cell(SPRITE_ORIGIN.x + sprite.anchors.eyeLeft.x, SPRITE_ORIGIN.y + sprite.anchors.eyeLeft.y, eye);
  cell(SPRITE_ORIGIN.x + sprite.anchors.eyeRight.x, SPRITE_ORIGIN.y + sprite.anchors.eyeRight.y, eye);
  if (badge) {
    for (let row = 0; row < BADGE.length; row++) {
      for (let col = 0; col < BADGE[row]!.length; col++) {
        if (BADGE[row]![col] === 1) cell(BADGE_ORIGIN.x + col, BADGE_ORIGIN.y + row, amber);
      }
    }
  }
  return pixels;
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
