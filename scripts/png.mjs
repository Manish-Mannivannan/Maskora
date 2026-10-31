/**
 * Read an 8-bit RGB or RGBA PNG from disk for the smoke: its size, pixels and
 * tEXt entries. Enough for the stills Maskora writes; not a general decoder.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function readPng(path) {
  const buf = readFileSync(path);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error(`${path} is not a PNG`);
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  const text = {};
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit, non-interlaced PNGs are read");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "tEXt") {
      const nul = data.indexOf(0);
      text[data.toString("latin1", 0, nul)] = data.toString("latin1", nul + 1);
    } else if (type === "IEND") break;
    at += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`colour type ${colorType} is not read`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      out[o] = line[x * channels];
      out[o + 1] = line[x * channels + 1];
      out[o + 2] = line[x * channels + 2];
      out[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev.set(line);
  }
  /** Luminance statistics in a (2r+1)² window around (x, y). */
  const around = ([x, y], r = 2) => {
    const lum = [];
    let alpha = 0;
    for (let j = -r; j <= r; j += 1)
      for (let i = -r; i <= r; i += 1) {
        const px = Math.min(width - 1, Math.max(0, Math.floor(x) + i));
        const py = Math.min(height - 1, Math.max(0, Math.floor(y) + j));
        const o = (py * width + px) * 4;
        lum.push(0.2126 * out[o] + 0.7152 * out[o + 1] + 0.0722 * out[o + 2]);
        alpha += out[o + 3];
      }
    return {
      max: Math.max(...lum),
      min: Math.min(...lum),
      mean: lum.reduce((s, v) => s + v, 0) / lum.length,
      alpha: alpha / lum.length,
    };
  };
  return { width, height, pixels: out, text, around, bytes: buf.length };
}
