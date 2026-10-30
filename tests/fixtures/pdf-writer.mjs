/**
 * A minimal, deterministic PDF writer for test fixtures.
 *
 * It writes page dictionaries exactly as given — inverted rectangles, boxes on
 * the Pages node, wrong-length arrays, non-multiple-of-90 rotations — because
 * the geometry probes need malformed and inherited cases that high-level PDF
 * libraries normalise away. Output is byte-for-byte reproducible: no dates, a
 * fixed file identifier, objects in insertion order.
 *
 * Values:
 *   numbers           written as PDF numbers (up to 4 decimals, no exponent)
 *   name("Page")      /Page
 *   str("text")       (text) with \ ( ) escaped
 *   hex(bytes)        <hex>
 *   ref(n)            n 0 R
 *   raw("...")        written verbatim
 *   arrays            [ ... ]
 *   plain objects     << /Key value ... >>  (keys in insertion order)
 *   stream(dict, buf) a stream object; /Length is added
 */
export const name = (value) => ({ kind: "name", value });
export const str = (value) => ({ kind: "str", value });
export const hex = (bytes) => ({ kind: "hex", value: Buffer.from(bytes) });
export const ref = (id) => ({ kind: "ref", id });
export const raw = (value) => ({ kind: "raw", value });
export const stream = (dict, data) => ({ kind: "stream", dict, data: Buffer.from(data) });

function num(n) {
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${n}`);
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeString(s) {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Serialise a value. `encrypt` (optional) transforms string and stream bytes for object `id`. */
export function serialize(value, ctx = {}) {
  if (typeof value === "number") return num(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => serialize(v, ctx)).join(" ")}]`;
  switch (value.kind) {
    case "name":
      return `/${value.value}`;
    case "str":
      if (ctx.encrypt) return `<${ctx.encrypt(Buffer.from(value.value, "latin1")).toString("hex")}>`;
      return `(${escapeString(value.value)})`;
    case "hex":
      if (ctx.encrypt) return `<${ctx.encrypt(value.value).toString("hex")}>`;
      return `<${value.value.toString("hex")}>`;
    case "ref":
      return `${value.id} 0 R`;
    case "raw":
      return value.value;
    case "stream":
      throw new Error("a stream can only be a top-level object");
    default: {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      return `<< ${entries.map(([k, v]) => `/${k} ${serialize(v, ctx)}`).join(" ")} >>`;
    }
  }
}

export class PdfBuilder {
  constructor({ version = "1.7" } = {}) {
    this.version = version;
    this.objects = [];
  }

  /** Reserve an object number now, set its value later (for parent/child cycles). */
  reserve() {
    this.objects.push(undefined);
    return this.objects.length;
  }

  set(id, value) {
    this.objects[id - 1] = value;
    return id;
  }

  add(value) {
    return this.set(this.reserve(), value);
  }

  /**
   * Write the file. `trailer` adds trailer entries (e.g. /Encrypt).
   * `encryptFor(id)` (optional) returns a byte transform for strings and streams of object `id`.
   */
  build({ root, trailer = {}, encryptFor, id = "4d61736b6f72612d666978747572652d" } = {}) {
    const chunks = [];
    let offset = 0;
    const push = (buf) => {
      const b = typeof buf === "string" ? Buffer.from(buf, "latin1") : buf;
      chunks.push(b);
      offset += b.length;
    };
    push(`%PDF-${this.version}\n%\xE2\xE3\xCF\xD3\n`);
    const offsets = [];
    this.objects.forEach((value, index) => {
      const objId = index + 1;
      if (value === undefined) throw new Error(`object ${objId} reserved but never set`);
      offsets.push(offset);
      const encrypt = encryptFor?.(objId);
      push(`${objId} 0 obj\n`);
      if (value?.kind === "stream") {
        const data = encrypt ? encrypt(value.data) : value.data;
        push(`${serialize({ ...value.dict, Length: data.length }, { encrypt })}\nstream\n`);
        push(data);
        push("\nendstream");
      } else {
        push(serialize(value, { encrypt }));
      }
      push("\nendobj\n");
    });
    const xrefAt = offset;
    push(`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`);
    for (const o of offsets) push(`${String(o).padStart(10, "0")} 00000 n \n`);
    const fileId = raw(`[<${id}> <${id}>]`);
    push(
      `trailer\n${serialize({ Size: this.objects.length + 1, Root: ref(root), ...trailer, ID: fileId })}\n` +
        `startxref\n${xrefAt}\n%%EOF\n`,
    );
    return Buffer.concat(chunks);
  }
}
