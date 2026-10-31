import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { addPngText, crc32, readPngText } from "./pngText";

/** A 1×1 RGBA PNG built by hand, so the test needs no encoder. */
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: number[] | Uint8Array) => {
    const body = Uint8Array.from([...Array.from(type, (c) => c.charCodeAt(0)), ...data]);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, (crc32(body) ^ 0xffffffff) >>> 0);
    return out;
  };
  const ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];
  const idat = deflateSync(Uint8Array.from([0, 10, 20, 30, 255]));
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", idat),
    ...chunk("IEND", []),
  ]);
}

describe("PNG text metadata", () => {
  it("matches the standard CRC-32", () => {
    expect((crc32(new TextEncoder().encode("123456789")) ^ 0xffffffff) >>> 0).toBe(0xcbf43926);
  });

  it("inserts tEXt chunks after IHDR that read back exactly, keeping the image chunks", () => {
    const png = tinyPng();
    const out = addPngText(png, { Software: "Maskora 0.1.0", "Maskora sources": "k2.pdf sha256 ab12" });
    expect(readPngText(out)).toEqual({ Software: "Maskora 0.1.0", "Maskora sources": "k2.pdf sha256 ab12" });
    // IHDR stays first, and the original image data is carried over byte for byte.
    expect(String.fromCharCode(...out.subarray(12, 16))).toBe("IHDR");
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe("tEXt");
    expect(out.subarray(out.length - (png.length - 33))).toEqual(png.subarray(33));
  });

  it("escapes characters outside Latin-1 printable text instead of dropping them", () => {
    const out = addPngText(tinyPng(), { Title: "Flyer – 2×" });
    expect(readPngText(out).Title).toBe("Flyer \\u2013 2\\u00d7");
  });

  it("refuses a non-PNG and invalid keywords", () => {
    expect(() => addPngText(new Uint8Array(40), { a: "b" })).toThrow(/Not a PNG/);
    expect(() => addPngText(tinyPng(), { "": "b" })).toThrow(/keyword/);
    expect(() => addPngText(tinyPng(), { " lead": "b" })).toThrow(/keyword/);
  });

  it("detects a corrupted chunk", () => {
    const out = addPngText(tinyPng(), { Software: "Maskora" });
    out[45] ^= 0xff;
    expect(() => readPngText(out)).toThrow(/CRC/);
  });
});
