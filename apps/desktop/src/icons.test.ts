import { readFile } from "node:fs/promises";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { APP_ICON, BADGE_ORIGIN, ICON_GRID, SPRITE_ORIGIN, TRAY_ICONS, TRAY_SIZES, encodeIco, encodePng, renderIcon, renderTrayIcon, type Sprite } from "./icons";

const COLOURS = { body: "#cd6e58", eye: "#000000", badge: "#f2c35b" };
const BODY = [205, 110, 88, 255];
const EYE = [0, 0, 0, 255];
const AMBER = [242, 195, 91, 255];
const CLEAR = [0, 0, 0, 0];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A 3×2 sprite: a full top row with an eye at each end, and a bottom row with a gap in the middle. */
const SPRITE: Sprite = {
  width: 3,
  height: 2,
  data: [
    [1, 1, 1],
    [1, 0, 1],
  ],
  anchors: { eyeLeft: { x: 0, y: 0 }, eyeRight: { x: 2, y: 0 } },
};

const pixel = (rgba: Uint8Array, size: number, x: number, y: number): number[] => Array.from(rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
const opaque = (rgba: Uint8Array): number => rgba.filter((_, i) => i % 4 === 3 && rgba[i] === 255).length;

type Chunk = { type: string; data: Buffer; crc: number; typeAndData: Buffer };
function chunks(png: Buffer): Chunk[] {
  const out: Chunk[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    out.push({ type: png.toString("ascii", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + length), crc: png.readUInt32BE(at + 8 + length), typeAndData: png.subarray(at + 4, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

type IcoEntry = { size: number; bytes: number; offset: number };
/** The directory of an ICO: one entry per image, width 0 meaning 256. */
function icoEntries(ico: Buffer): IcoEntry[] {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + i * 16;
    const width = ico[at]!;
    return { size: width === 0 ? 256 : width, bytes: ico.readUInt32LE(at + 8), offset: ico.readUInt32LE(at + 12) };
  });
}

describe("renderTrayIcon", () => {
  it("draws the sprite's body and eyes at the origin on a clear 16-pixel grid", () => {
    const rgba = renderTrayIcon(SPRITE, COLOURS, 1, false);
    expect(rgba.length).toBe(ICON_GRID * ICON_GRID * 4);
    const { x, y } = SPRITE_ORIGIN;
    expect(pixel(rgba, 16, x, y)).toEqual(EYE);
    expect(pixel(rgba, 16, x + 1, y)).toEqual(BODY);
    expect(pixel(rgba, 16, x + 2, y)).toEqual(EYE);
    expect(pixel(rgba, 16, x, y + 1)).toEqual(BODY);
    expect(pixel(rgba, 16, x + 1, y + 1)).toEqual(CLEAR);
    expect(pixel(rgba, 16, 0, 0)).toEqual(CLEAR);
    expect(opaque(rgba)).toBe(5);
  });

  it("draws each grid cell as a 2×2 block at 2×", () => {
    const rgba = renderTrayIcon(SPRITE, COLOURS, 2, false);
    expect(rgba.length).toBe(32 * 32 * 4);
    const { x, y } = SPRITE_ORIGIN;
    expect(pixel(rgba, 32, 2 * x + 1, 2 * y + 1)).toEqual(EYE);
    expect(pixel(rgba, 32, 2 * (x + 1), 2 * y)).toEqual(BODY);
    expect(opaque(rgba)).toBe(20);
  });

  it("adds a rounded amber dot in the top-right corner only when asked", () => {
    const plain = renderTrayIcon(SPRITE, COLOURS, 1, false);
    const badged = renderTrayIcon(SPRITE, COLOURS, 1, true);
    const { x, y } = BADGE_ORIGIN;
    expect(pixel(plain, 16, x + 1, y)).toEqual(CLEAR);
    expect(pixel(badged, 16, x + 1, y)).toEqual(AMBER);
    expect(pixel(badged, 16, x, y)).toEqual(CLEAR);
    expect(opaque(badged) - opaque(plain)).toBe(12);
  });

  it("refuses a sprite that does not fit, a colour that is not #rrggbb, and a scale that is not a whole number above zero", () => {
    expect(() => renderTrayIcon({ ...SPRITE, width: 16, data: [Array<number>(16).fill(1), Array<number>(16).fill(1)] }, COLOURS, 1, false)).toThrow();
    expect(() => renderTrayIcon(SPRITE, { ...COLOURS, body: "coral" }, 1, false)).toThrow();
    expect(() => renderTrayIcon(SPRITE, COLOURS, 0, false)).toThrow();
    expect(() => renderTrayIcon(SPRITE, COLOURS, 1.5, false)).toThrow();
  });
});

describe("renderIcon", () => {
  it("at 24 pixels, gives each grid cell one or two pixels a side and keeps every edge sharp", () => {
    const rgba = renderIcon(SPRITE, COLOURS, 24, false);
    expect(rgba.length).toBe(24 * 24 * 4);
    // Cell x=1 covers pixel 2 only, cell x=2 covers 3 and 4, cell x=3 covers 5; row y=5 is pixel 8, row y=6 is 9 and 10.
    expect(pixel(rgba, 24, 2, 8)).toEqual(EYE);
    expect(pixel(rgba, 24, 3, 8)).toEqual(BODY);
    expect(pixel(rgba, 24, 4, 8)).toEqual(BODY);
    expect(pixel(rgba, 24, 5, 8)).toEqual(EYE);
    expect(pixel(rgba, 24, 2, 9)).toEqual(BODY);
    expect(pixel(rgba, 24, 2, 10)).toEqual(BODY);
    expect(pixel(rgba, 24, 3, 9)).toEqual(CLEAR);
    expect(opaque(rgba)).toBe(8);
  });

  it("at 32 pixels is exactly the 2× tray render", () => {
    expect(Buffer.from(renderIcon(SPRITE, COLOURS, 32, true)).equals(Buffer.from(renderTrayIcon(SPRITE, COLOURS, 2, true)))).toBe(true);
  });

  it("refuses a size below the grid or not a whole number", () => {
    expect(() => renderIcon(SPRITE, COLOURS, 8, false)).toThrow();
    expect(() => renderIcon(SPRITE, COLOURS, 20.5, false)).toThrow();
  });
});

describe("encodeIco", () => {
  it("writes a directory of PNG entries, 256 spelled as 0, at the offsets where the images sit", () => {
    const small = encodePng(16, 16, renderIcon(SPRITE, COLOURS, 16, false));
    const large = encodePng(256, 256, renderIcon(SPRITE, COLOURS, 256, false));
    const ico = encodeIco([
      { size: 16, png: small },
      { size: 256, png: large },
    ]);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 2]);
    expect([ico[6], ico[7], ico[8], ico[9], ico.readUInt16LE(10), ico.readUInt16LE(12)]).toEqual([16, 16, 0, 0, 1, 32]);
    expect([ico[22], ico[23]]).toEqual([0, 0]);
    const entries = icoEntries(ico);
    expect(entries).toEqual([
      { size: 16, bytes: small.length, offset: 6 + 32 },
      { size: 256, bytes: large.length, offset: 6 + 32 + small.length },
    ]);
    expect(ico.subarray(entries[0]!.offset, entries[0]!.offset + entries[0]!.bytes).equals(small)).toBe(true);
    expect(ico.subarray(entries[1]!.offset, entries[1]!.offset + entries[1]!.bytes).equals(large)).toBe(true);
    expect(ico.length).toBe(6 + 32 + small.length + large.length);
  });

  it("refuses no images, and an image larger than an entry can describe", () => {
    const png = encodePng(16, 16, renderIcon(SPRITE, COLOURS, 16, false));
    expect(() => encodeIco([])).toThrow();
    expect(() => encodeIco([{ size: 512, png }])).toThrow();
  });
});

describe("encodePng", () => {
  it("writes an 8-bit RGBA PNG whose chunks check out and whose rows inflate back to the pixels", () => {
    const rgba = renderTrayIcon(SPRITE, COLOURS, 1, true);
    const png = encodePng(16, 16, rgba);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    for (const part of parts) expect(part.crc).toBe(crc32(part.typeAndData));
    const header = parts[0]!.data;
    expect([header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9], header[10], header[11], header[12]]).toEqual([16, 16, 8, 6, 0, 0, 0]);
    const rows = inflateSync(parts[1]!.data);
    expect(rows.length).toBe(16 * (16 * 4 + 1));
    for (let row = 0; row < 16; row++) {
      const start = row * (16 * 4 + 1);
      expect(rows[start]).toBe(0);
      expect(rows.subarray(start + 1, start + 1 + 16 * 4).equals(Buffer.from(rgba.subarray(row * 64, (row + 1) * 64)))).toBe(true);
    }
  });

  it("refuses pixel data of the wrong length", () => {
    expect(() => encodePng(16, 16, new Uint8Array(10))).toThrow();
  });
});

describe("the checked-in icons", () => {
  const pngSize = (png: Buffer): number => png.readUInt32BE(16);

  it("are two tray ICOs holding 16, 20, 24 and 32 pixel PNGs, plain and badged", async () => {
    expect(TRAY_ICONS.map((icon) => icon.file)).toEqual(["tray.ico", "tray-waiting.ico"]);
    for (const icon of TRAY_ICONS) {
      const ico = await readFile(new URL(`../resources/tray/${icon.file}`, import.meta.url));
      const entries = icoEntries(ico);
      expect(entries.map((entry) => entry.size)).toEqual([...TRAY_SIZES]);
      for (const entry of entries) {
        const png = ico.subarray(entry.offset, entry.offset + entry.bytes);
        expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(pngSize(png)).toBe(entry.size);
      }
    }
  });

  it("include the app icon up to 256 pixels, which the packager needs", async () => {
    const ico = await readFile(new URL(`../resources/${APP_ICON.file}`, import.meta.url));
    expect(icoEntries(ico).map((entry) => entry.size)).toEqual([...APP_ICON.sizes]);
  });
});
