/**
 * The PDF Standard security handler, revision 3 (RC4, 128-bit key), for
 * encrypted test fixtures. ISO 32000-1 §7.6.3, algorithms 2, 3, 5 and the
 * per-object key of §7.6.2. Fixtures only: RC4 is obsolete as protection, but it
 * is the encryption real production files still arrive with, and the reader must
 * open (or refuse) it explicitly.
 */
import { createHash } from "node:crypto";

const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");

const md5 = (...parts) => {
  const h = createHash("md5");
  for (const p of parts) h.update(p);
  return h.digest();
};

export function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const padded = (password) => Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);

/** Algorithm 3: the /O entry. */
function ownerEntry(ownerPassword, userPassword) {
  let digest = md5(padded(ownerPassword));
  for (let i = 0; i < 50; i += 1) digest = md5(digest);
  const key = digest.subarray(0, 16);
  let out = rc4(key, padded(userPassword));
  for (let i = 1; i <= 19; i += 1) out = rc4(Buffer.from(key.map((b) => b ^ i)), out);
  return out;
}

/** Algorithm 2: the file encryption key. */
function fileKey(userPassword, o, p, id) {
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p);
  let digest = md5(padded(userPassword), o, pBytes, id);
  for (let i = 0; i < 50; i += 1) digest = md5(digest.subarray(0, 16));
  return digest.subarray(0, 16);
}

/** Algorithm 5: the /U entry. */
function userEntry(key, id) {
  let out = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i += 1) out = rc4(Buffer.from(key.map((b) => b ^ i)), out);
  return Buffer.concat([out, Buffer.alloc(16)]);
}

/**
 * Prepare encryption for a file with identifier `idHex`.
 * Returns the /Encrypt dictionary values and `forObject(id)`, the byte
 * transform for strings and streams of object `id` (generation 0).
 */
export function standardSecurity({ userPassword, ownerPassword, permissions = -3904, idHex }) {
  const id = Buffer.from(idHex, "hex");
  const o = ownerEntry(ownerPassword, userPassword);
  const key = fileKey(userPassword, o, permissions, id);
  const u = userEntry(key, id);
  const forObject = (objId) => {
    const objKey = md5(key, Buffer.from([objId & 0xff, (objId >> 8) & 0xff, (objId >> 16) & 0xff, 0, 0]));
    return (bytes) => rc4(objKey.subarray(0, 16), bytes);
  };
  return { o, u, permissions, forObject };
}
