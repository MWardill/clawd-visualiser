import { readFile } from "node:fs/promises";
import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BADGE_ORIGIN, ICON_GRID, SPRITE_ORIGIN, TRAY_ICONS, encodePng, renderTrayIcon, type Sprite } from "./icons";

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

describe("the checked-in tray icons", () => {
  it("are PNGs at 16 and 32 pixels, a plain pair and a badged pair", async () => {
    expect(TRAY_ICONS.map((icon) => icon.file)).toEqual(["tray.png", "tray@2x.png", "tray-waiting.png", "tray-waiting@2x.png"]);
    for (const icon of TRAY_ICONS) {
      const png = await readFile(new URL(`../resources/tray/${icon.file}`, import.meta.url));
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([ICON_GRID * icon.scale, ICON_GRID * icon.scale]);
    }
  });
});
