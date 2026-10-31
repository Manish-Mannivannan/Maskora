/**
 * PNG text metadata for exported stills (architecture §9.4, §11.1).
 *
 * An export records what it shows and how far to trust it: the app version,
 * the source files by name and digest, and whether each finish is
 * implemented or approximate. The entries go into tEXt chunks placed right
 * after IHDR, so any viewer that lists PNG text shows them. tEXt is Latin-1;
 * other characters are written as `\uXXXX` escapes so nothing is lost.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const latin1 = (text: string) =>
  text.replace(/[^\x20-\x7e\n]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** `png` with a tEXt chunk per entry inserted after IHDR. Keywords are 1–79 printable Latin-1 characters. */
export function addPngText(png: Uint8Array, entries: Record<string, string>): Uint8Array {
  if (png.length < 33 || SIGNATURE.some((b, i) => png[i] !== b)) throw new Error("Not a PNG image.");
  const ihdrLength = new DataView(png.buffer, png.byteOffset).getUint32(8);
  const afterIhdr = 8 + 12 + ihdrLength;
  const chunks = Object.entries(entries).map(([keyword, text]) => {
    if (!/^[\x20-\x7e]{1,79}$/.test(keyword) || keyword.trim() !== keyword)
      throw new Error(`Invalid PNG text keyword "${keyword}".`);
    const body = `${keyword}\0${latin1(text)}`;
    return chunk(
      "tEXt",
      Uint8Array.from(body, (c) => c.charCodeAt(0)),
    );
  });
  const total = png.length + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  out.set(png.subarray(0, afterIhdr), 0);
  let at = afterIhdr;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  out.set(png.subarray(afterIhdr), at);
  return out;
}

/** The tEXt entries of a PNG, checking each chunk's CRC. */
export function readPngText(png: Uint8Array): Record<string, string> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: Record<string, string> = {};
  let at = 8;
  while (at + 12 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    const crc = view.getUint32(at + 8 + length);
    if ((crc32(png.subarray(at + 4, at + 8 + length)) ^ 0xffffffff) >>> 0 !== crc)
      throw new Error(`Bad CRC in ${type} chunk.`);
    if (type === "tEXt") {
      const text = String.fromCharCode(...data);
      const nul = text.indexOf("\0");
      out[text.slice(0, nul)] = text.slice(nul + 1);
    }
    if (type === "IEND") break;
    at += 12 + length;
  }
  return out;
}
