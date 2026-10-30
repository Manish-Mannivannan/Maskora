/**
 * The Phase 0.4 probe corpus (implementation plan 0.4, "Probe specification").
 *
 * Each fixture returns { pdf, expected }. Expected values are stated from ISO
 * 32000-1, never measured from an engine:
 *   - MediaBox, CropBox and Rotate are inheritable from the Pages tree; BleedBox,
 *     TrimBox and ArtBox are not (§7.7.3.4, §14.11.2).
 *   - CropBox defaults to MediaBox; Bleed/Trim/ArtBox default to CropBox.
 *   - Boxes beyond the MediaBox are reduced to their intersection with it.
 *   - Rotate must be a multiple of 90; anything else is diagnosed, not guessed.
 *
 * Box expectations: { raw, effective, origin, adjustments? } where origin is
 * explicit | inherited | default | invalid, and an invalid box's `effective` is
 * the default it falls back to, so a reader can show the fallback with a warning.
 */
import { deflateSync } from "node:zlib";
import { standardSecurity } from "./encrypt.mjs";
import { PdfBuilder, name, ref, stream, str, hex } from "./pdf-writer.mjs";

const FILE_ID = "4d61736b6f72612d666978747572652d";

/** A filled rectangle, colour as RGB 0..1. */
const fill = ([x, y, w, h], [r, g, b]) => `${r} ${g} ${b} rg ${x} ${y} ${w} ${h} re f\n`;

/**
 * A document from page specs. `prepare(pdf)` may add shared objects first and
 * returns a context passed to function-valued page dicts and catalog extras.
 */
function makeDoc({ pages, pagesNode = {}, catalog = {}, version = "1.7", prepare, encryption, info }) {
  const pdf = new PdfBuilder({ version });
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const ctx = prepare ? prepare(pdf) : {};
  const kids = pages.map((page) => {
    const contents = pdf.add(stream(page.streamDict ?? {}, page.content ?? ""));
    const dict = typeof page.dict === "function" ? page.dict(ctx) : (page.dict ?? {});
    return pdf.add({ Type: name("Page"), Parent: ref(pagesId), ...dict, Contents: ref(contents) });
  });
  pdf.set(pagesId, { Type: name("Pages"), ...pagesNode, Kids: kids.map(ref), Count: kids.length });
  pdf.set(catalogId, {
    Type: name("Catalog"),
    Pages: ref(pagesId),
    ...(typeof catalog === "function" ? catalog(ctx) : catalog),
  });
  if (!encryption) {
    const trailer = info ? { Info: ref(pdf.add(info)) } : {};
    return pdf.build({ root: catalogId, id: FILE_ID, trailer });
  }
  const sec = standardSecurity({ ...encryption, idHex: FILE_ID });
  const encryptId = pdf.add({
    Filter: name("Standard"),
    V: 2,
    R: 3,
    Length: 128,
    O: hex(sec.o),
    U: hex(sec.u),
    P: sec.permissions,
  });
  return pdf.build({
    root: catalogId,
    id: FILE_ID,
    trailer: { Encrypt: ref(encryptId) },
    encryptFor: (objId) => (objId === encryptId ? undefined : sec.forObject(objId)),
  });
}

const box = (raw, effective, origin, adjustments) => ({
  raw,
  effective,
  origin,
  ...(adjustments ? { adjustments } : {}),
});
const rotate = (raw, effective, origin) => ({ raw, effective, origin });
const page = (index, boxes, { rot = rotate(null, 0, "default"), userUnit = 1, ...rest } = {}) => ({
  index,
  rotate: rot,
  userUnit,
  boxes,
  ...rest,
});

/** Boxes where only the MediaBox (and optionally CropBox) are present: the rest default. */
function defaulted(media, mediaOrigin = "explicit", crop = null, cropOrigin = "explicit") {
  const cropEff = crop ?? media;
  return {
    MediaBox: box(media, media, mediaOrigin),
    CropBox: crop ? box(crop, crop, cropOrigin) : box(null, media, "default"),
    BleedBox: box(null, cropEff, "default"),
    TrimBox: box(null, cropEff, "default"),
    ArtBox: box(null, cropEff, "default"),
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const G3 = () => {
  const media = [0, 0, 500, 700];
  const crop = [5, 5, 495, 695];
  const crop2 = [10, 20, 480, 690];
  const trim2 = [30, 40, 470, 660];
  return {
    pdf: makeDoc({
      pagesNode: { MediaBox: media, CropBox: crop, Rotate: 90, TrimBox: [50, 50, 450, 650] },
      pages: [{ dict: {} }, { dict: { CropBox: crop2, TrimBox: trim2 } }],
    }),
    expected: {
      description:
        "MediaBox, CropBox and Rotate inherited from the Pages node; an illegal TrimBox on the Pages node is ignored",
      pages: [
        page(0, defaulted(media, "inherited", crop, "inherited"), { rot: rotate(90, 90, "inherited") }),
        page(
          1,
          {
            MediaBox: box(media, media, "inherited"),
            CropBox: box(crop2, crop2, "explicit"),
            BleedBox: box(null, crop2, "default"),
            TrimBox: box(trim2, trim2, "explicit"),
            ArtBox: box(null, crop2, "default"),
          },
          { rot: rotate(90, 90, "inherited") },
        ),
      ],
    },
  };
};

const G4 = () => {
  const m1 = [-300, -400, 300, 400];
  const c1 = [-290, -395, 295, 390];
  const t1 = [-280, -380, 280, 380];
  const m2 = [1000, 2000, 1595, 2842];
  return {
    pdf: makeDoc({
      pages: [{ dict: { MediaBox: m1, CropBox: c1, TrimBox: t1 } }, { dict: { MediaBox: m2 } }],
    }),
    expected: {
      description: "Negative and large positive MediaBox origins; user-space rectangles are preserved",
      pages: [
        page(0, {
          MediaBox: box(m1, m1, "explicit"),
          CropBox: box(c1, c1, "explicit"),
          BleedBox: box(null, c1, "default"),
          TrimBox: box(t1, t1, "explicit"),
          ArtBox: box(null, c1, "default"),
        }),
        page(1, defaulted(m2)),
      ],
    },
  };
};

const G5 = () => {
  const media = [0, 0, 300, 500];
  const raws = [90, 180, 270, 45, -90, 450];
  const effective = [90, 180, 270, null, 270, 90];
  return {
    pdf: makeDoc({ pages: raws.map((r) => ({ dict: { MediaBox: media, Rotate: r } })) }),
    expected: {
      description:
        "Rotate values: valid multiples of 90 (including negative and over 360) normalise; 45 is invalid",
      pages: raws.map((r, i) =>
        page(i, defaulted(media), {
          rot: rotate(r, effective[i], effective[i] === null ? "invalid" : "explicit"),
        }),
      ),
    },
  };
};

const G6 = () => {
  const media = [0, 0, 300, 400];
  return {
    pdf: makeDoc({ version: "1.6", pages: [{ dict: { MediaBox: media, UserUnit: 2 } }] }),
    expected: {
      description: "UserUnit 2: one user-space unit is 2/72 inch, so mm = pt × 2 × 25.4 / 72",
      pages: [page(0, defaulted(media), { userUnit: 2, mediaSizeMm: [211.6667, 282.2222] })],
    },
  };
};

const G7 = () => {
  const sizes = [
    [0, 0, 595.2756, 841.8898],
    [0, 0, 595.2756, 419.5276],
    [0, 0, 612, 792],
  ];
  return {
    pdf: makeDoc({ pages: sizes.map((m) => ({ dict: { MediaBox: m } })) }),
    expected: {
      description: "Mixed page sizes in one file: A4 portrait, A5 landscape, US Letter",
      pages: sizes.map((m, i) => page(i, defaulted(m))),
    },
  };
};

const G8 = () => {
  const media = [0, 0, 400, 600];
  const others = (crop, overrides) => ({
    MediaBox: box(media, media, "explicit"),
    CropBox: crop,
    BleedBox: box(null, crop.effective, "default"),
    TrimBox: box(null, crop.effective, "default"),
    ArtBox: box(null, crop.effective, "default"),
    ...overrides,
  });
  const defaultCrop = box(null, media, "default");
  return {
    pdf: makeDoc({
      pages: [
        { dict: { MediaBox: media, CropBox: [390, 590, 10, 10] } },
        { dict: { MediaBox: media, CropBox: [-50, -50, 450, 650] } },
        { dict: { MediaBox: media, TrimBox: [100, 100, 100, 300] } },
        { dict: { MediaBox: media, TrimBox: [500, 700, 600, 800] } },
        { dict: { MediaBox: media, BleedBox: [0, 0, 100] } },
      ],
    }),
    expected: {
      description:
        "Invalid rectangles: inverted corners normalise; a CropBox beyond the MediaBox is clipped; zero-area, non-intersecting and wrong-length boxes are invalid and fall back to their default",
      pages: [
        page(0, others(box([390, 590, 10, 10], [10, 10, 390, 590], "explicit", ["normalized"]))),
        page(1, others(box([-50, -50, 450, 650], [0, 0, 400, 600], "explicit", ["clipped"]))),
        page(2, others(defaultCrop, { TrimBox: box([100, 100, 100, 300], media, "invalid") })),
        page(3, others(defaultCrop, { TrimBox: box([500, 700, 600, 800], media, "invalid") })),
        page(4, others(defaultCrop, { BleedBox: box([0, 0, 100], media, "invalid") })),
      ],
    },
  };
};

// ---------------------------------------------------------------------------
// Raster coverage
// ---------------------------------------------------------------------------

/** R1's boxes and marks; `dx, dy` shift everything for the origin variant. */
function coverageLayout(dx = 0, dy = 0) {
  const shiftBox = ([a, b, c, d]) => [a + dx, b + dy, c + dx, d + dy];
  const boxes = {
    MediaBox: shiftBox([0, 0, 300, 400]),
    CropBox: shiftBox([18, 22, 284, 386]),
    BleedBox: shiftBox([30, 34, 272, 374]),
    TrimBox: shiftBox([40, 46, 262, 362]),
  };
  // Each mark: rectangle [x, y, w, h], colour, and the regions it must appear in.
  const marks = [
    { id: "mediaMarginLeft", rect: [5, 200, 8, 8], color: [1, 0, 0], in: ["MediaBox"] },
    { id: "mediaMarginBottom", rect: [150, 5, 8, 8], color: [1, 0, 0], in: ["MediaBox"] },
    { id: "cropBleedBand", rect: [20, 200, 8, 8], color: [0, 0.8, 0], in: ["MediaBox", "CropBox"] },
    { id: "bleedTrimBand", rect: [31, 200, 8, 8], color: [0, 0, 1], in: ["MediaBox", "CropBox", "BleedBox"] },
    {
      id: "trimInterior",
      rect: [100, 100, 40, 60],
      color: [0, 0, 0],
      in: ["MediaBox", "CropBox", "BleedBox", "TrimBox"],
    },
    {
      id: "trimUpperRight",
      rect: [240, 340, 12, 12],
      color: [1, 0, 1],
      in: ["MediaBox", "CropBox", "BleedBox", "TrimBox"],
    },
  ].map((m) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2], m.rect[3]] }));
  const content = marks.map((m) => fill(m.rect, m.color)).join("");
  return { boxes, marks, content };
}

const R1 = () => {
  const { boxes, marks, content } = coverageLayout();
  return {
    pdf: makeDoc({ pages: [{ dict: boxes, content }] }),
    expected: {
      description:
        "Coloured marks in each band between MediaBox, CropBox, BleedBox and TrimBox; each region's render contains exactly the marks listed for it",
      pages: [{ index: 0, rotate: 0, userUnit: 1, boxes, marks }],
    },
  };
};

const R2 = () => {
  const base = coverageLayout();
  const shifted = coverageLayout(1000, -500);
  const variants = [
    { rotate: 90, layout: base },
    { rotate: 180, layout: base },
    { rotate: 270, layout: base },
    { rotate: 0, layout: shifted },
    { rotate: 0, layout: base, userUnit: 2 },
  ];
  return {
    pdf: makeDoc({
      version: "1.6",
      pages: variants.map((v) => ({
        dict: { ...v.layout.boxes, Rotate: v.rotate, ...(v.userUnit ? { UserUnit: v.userUnit } : {}) },
        content: v.layout.content,
      })),
    }),
    expected: {
      description: "R1 under Rotate 90/180/270, with a shifted origin (+1000, -500), and with UserUnit 2",
      pages: variants.map((v, index) => ({
        index,
        rotate: v.rotate,
        userUnit: v.userUnit ?? 1,
        boxes: v.layout.boxes,
        marks: v.layout.marks,
      })),
    },
  };
};

// ---------------------------------------------------------------------------
// Masks, annotations, optional content
// ---------------------------------------------------------------------------

const maskShape = [40, 40, 60, 80];
const maskSamples = [
  { id: "inside", at: [70, 80], coverage: 1 },
  { id: "outside", at: [150, 150], coverage: 0 },
];

const M1 = () => ({
  pdf: makeDoc({
    pages: [
      {
        dict: { MediaBox: [0, 0, 200, 200] },
        content: fill([0, 0, 200, 200], [1, 1, 1]) + fill(maskShape, [0, 0, 0]),
      },
    ],
  }),
  expected: {
    description:
      "Opaque mask page: black shape on a painted white page. Alpha is 1 everywhere, so only luminance separates",
    pages: [{ index: 0, boxes: { MediaBox: [0, 0, 200, 200] }, samples: maskSamples, alphaUsable: false }],
  },
});

const M2 = () => ({
  pdf: makeDoc({ pages: [{ dict: { MediaBox: [0, 0, 200, 200] }, content: fill(maskShape, [0, 0, 0]) }] }),
  expected: {
    description:
      "Transparent mask page: black shape, nothing painted elsewhere. Alpha and luminance both separate",
    pages: [{ index: 0, boxes: { MediaBox: [0, 0, 200, 200] }, samples: maskSamples, alphaUsable: true }],
  },
});

const M3 = () => {
  const bands = Array.from({ length: 10 }, (_, i) => ({ grey: i / 10, rect: [i * 20, 0, 20, 200] }));
  return {
    pdf: makeDoc({
      pages: [
        {
          dict: { MediaBox: [0, 0, 200, 200] },
          content: bands.map((b) => fill(b.rect, [b.grey, b.grey, b.grey])).join(""),
        },
      ],
    }),
    expected: {
      description:
        "Ten grey bands 0.0–0.9: luminance at each band centre must rise monotonically, so thresholds are measurable",
      pages: [
        {
          index: 0,
          boxes: { MediaBox: [0, 0, 200, 200] },
          samples: bands.map((b, i) => ({ id: `band${i}`, at: [b.rect[0] + 10, 100], luminance: b.grey })),
        },
      ],
    },
  };
};

const A1 = () => {
  const appearance = (pdf, color) =>
    pdf.add(
      stream(
        { Type: name("XObject"), Subtype: name("Form"), BBox: [0, 0, 40, 40] },
        fill([0, 0, 40, 40], color),
      ),
    );
  return {
    pdf: makeDoc({
      prepare: (pdf) => {
        const print = pdf.add({
          Type: name("Annot"),
          Subtype: name("Square"),
          Rect: [20, 20, 60, 60],
          F: 4,
          C: [1, 0, 0],
          AP: { N: ref(appearance(pdf, [1, 0, 0])) },
        });
        const noPrint = pdf.add({
          Type: name("Annot"),
          Subtype: name("Square"),
          Rect: [80, 20, 120, 60],
          F: 0,
          C: [0, 0.8, 0],
          AP: { N: ref(appearance(pdf, [0, 0.8, 0])) },
        });
        const widget = pdf.add({
          Type: name("Annot"),
          Subtype: name("Widget"),
          FT: name("Tx"),
          T: str("field1"),
          Rect: [140, 20, 180, 60],
          F: 4,
          AP: { N: ref(appearance(pdf, [0, 0, 1])) },
        });
        return { print, noPrint, widget };
      },
      catalog: (ctx) => ({ AcroForm: { Fields: [ref(ctx.widget)] } }),
      pages: [
        {
          dict: (ctx) => ({
            MediaBox: [0, 0, 200, 100],
            Annots: [ref(ctx.print), ref(ctx.noPrint), ref(ctx.widget)],
          }),
        },
      ],
    }),
    expected: {
      description:
        "Annotations with appearance streams: a print-flagged square (red), a non-print square (green) and a print-flagged text-field widget (blue)",
      pages: [
        {
          index: 0,
          boxes: { MediaBox: [0, 0, 200, 100] },
          annotations: [
            { id: "printSquare", at: [40, 40], color: [1, 0, 0], printFlag: true },
            { id: "noPrintSquare", at: [100, 40], color: [0, 0.8, 0], printFlag: false },
            { id: "widget", at: [160, 40], color: [0, 0, 1], printFlag: true },
          ],
        },
      ],
    },
  };
};

const O1 = () => ({
  pdf: makeDoc({
    prepare: (pdf) => ({
      viewOnly: pdf.add({
        Type: name("OCG"),
        Name: str("ViewOnly"),
        Usage: { View: { ViewState: name("ON") }, Print: { PrintState: name("OFF") } },
      }),
      printOnly: pdf.add({
        Type: name("OCG"),
        Name: str("PrintOnly"),
        Usage: { View: { ViewState: name("OFF") }, Print: { PrintState: name("ON") } },
      }),
    }),
    catalog: ({ viewOnly, printOnly }) => ({
      OCProperties: {
        OCGs: [ref(viewOnly), ref(printOnly)],
        D: {
          ON: [ref(viewOnly)],
          OFF: [ref(printOnly)],
          AS: [
            { Event: name("View"), Category: [name("View")], OCGs: [ref(viewOnly), ref(printOnly)] },
            { Event: name("Print"), Category: [name("Print")], OCGs: [ref(viewOnly), ref(printOnly)] },
          ],
        },
      },
    }),
    pages: [
      {
        dict: ({ viewOnly, printOnly }) => ({
          MediaBox: [0, 0, 200, 100],
          Resources: { Properties: { oc1: ref(viewOnly), oc2: ref(printOnly) } },
        }),
        content: `/OC /oc1 BDC\n${fill([20, 20, 60, 60], [0, 0.8, 0])}EMC\n/OC /oc2 BDC\n${fill([120, 20, 60, 60], [1, 0, 0])}EMC\n`,
      },
    ],
  }),
  expected: {
    description:
      "Optional content: 'ViewOnly' (green) is on for viewing and off for print; 'PrintOnly' (red) the reverse, through /AS usage",
    pages: [
      {
        index: 0,
        boxes: { MediaBox: [0, 0, 200, 100] },
        groups: [
          { id: "ViewOnly", at: [50, 50], color: [0, 0.8, 0], view: true, print: false },
          { id: "PrintOnly", at: [150, 50], color: [1, 0, 0], view: false, print: true },
        ],
      },
    ],
  },
});

// ---------------------------------------------------------------------------
// Failure, scale, encryption
// ---------------------------------------------------------------------------

const baseline = () =>
  makeDoc({
    pages: [{ dict: { MediaBox: [0, 0, 300, 400] }, content: fill([50, 50, 200, 300], [0.2, 0.2, 0.2]) }],
  });

const X1a = () => {
  const full = baseline();
  return {
    pdf: full.subarray(0, Math.floor(full.length * 0.6)),
    expected: {
      description: "Truncated at 60%: no trailer or xref",
      outcome: "named failure or explicit recovery; never a hang",
    },
  };
};

const X1b = () => {
  const text = baseline()
    .toString("latin1")
    .replace(/(\d{10}) 00000 n/g, "0000000999 00000 n");
  return {
    pdf: Buffer.from(text, "latin1"),
    expected: {
      description: "Every xref offset wrong: a reader must rebuild the table or fail by name",
      outcome: "named failure or explicit recovery; never a hang",
    },
  };
};

const X1c = () => ({
  pdf: Buffer.from("This is not a PDF document. ".repeat(40), "latin1"),
  expected: { description: "Not a PDF at all", outcome: "named failure" },
});

const X2a = () => ({
  pdf: makeDoc({
    pages: Array.from({ length: 500 }, (_, i) => ({
      dict: { MediaBox: [0, 0, 595.2756, 841.8898] },
      content: fill([40 + (i % 50) * 10, 40, 100, 100], [0.1, 0.1, 0.1]),
    })),
  }),
  expected: { description: "500 A4 pages of vector content", pageCount: 500 },
});

const X2b = () => ({
  pdf: makeDoc({
    pages: [
      {
        dict: { MediaBox: [0, 0, 14400, 14400] },
        content: Array.from({ length: 20 }, (_, i) => fill([i * 700, i * 700, 400, 400], [0, 0, 0])).join(""),
      },
    ],
  }),
  expected: {
    description: "One 200 in × 200 in page (14 400 pt, the largest size without UserUnit)",
    sizeMm: [5080, 5080],
  },
});

const X2c = () => {
  const size = 4000;
  const pixels = Buffer.alloc(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) pixels[y * size + x] = (x + y) & 0xff;
  const data = deflateSync(pixels, { level: 9 });
  return {
    pdf: makeDoc({
      prepare: (pdf) => ({
        image: pdf.add(
          stream(
            {
              Type: name("XObject"),
              Subtype: name("Image"),
              Width: size,
              Height: size,
              ColorSpace: name("DeviceGray"),
              BitsPerComponent: 8,
              Filter: name("FlateDecode"),
            },
            data,
          ),
        ),
      }),
      pages: [
        {
          dict: ({ image }) => ({ MediaBox: [0, 0, 600, 600], Resources: { XObject: { Im0: ref(image) } } }),
          content: "q 600 0 0 600 0 0 cm /Im0 Do Q\n",
        },
      ],
    }),
    expected: {
      description: "A 4000 × 4000 8-bit grey image on a 600 pt page (≈ 480 ppi)",
      imagePixels: [size, size],
    },
  };
};

const encrypted = (userPassword) =>
  makeDoc({
    encryption: { userPassword, ownerPassword: "owner-secret" },
    pages: [{ dict: { MediaBox: [0, 0, 300, 400] }, content: fill([50, 50, 200, 300], [0.2, 0.2, 0.2]) }],
  });

const E1a = () => ({
  pdf: encrypted(""),
  expected: {
    description:
      "RC4-128 (R3) with an owner password only: opens without a password; permissions are reported, not enforced",
    needsPassword: false,
    permissions: -3904,
  },
});

const E1b = () => ({
  pdf: encrypted("maskora"),
  expected: {
    description:
      "RC4-128 (R3) with user password 'maskora': refuses without it, refuses a wrong one, opens with it",
    needsPassword: true,
    userPassword: "maskora",
  },
});

// ---------------------------------------------------------------------------
// Document information (step 1.1)
// ---------------------------------------------------------------------------

/** An asymmetric "F" plus one dot per page index, so orientation and order are visible. */
const markF = ([x0, y0, x1, y1], index) => {
  const w = x1 - x0;
  const h = y1 - y0;
  const u = Math.min(w, h) / 10;
  const left = x0 + 1.5 * u;
  const top = y1 - 1.5 * u;
  return (
    fill([left, top - 6 * u, u, 6 * u], [0.1, 0.1, 0.1]) +
    fill([left, top - u, 4 * u, u], [0.1, 0.1, 0.1]) +
    fill([left, top - 3.5 * u, 2.5 * u, u], [0.1, 0.1, 0.1]) +
    Array.from({ length: index + 1 }, (_, i) =>
      fill([x1 - 2 * u, y0 + u + i * 1.2 * u, 0.8 * u, 0.8 * u], [0.85, 0.2, 0.2]),
    ).join("")
  );
};

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Maskora mixed document</rdf:li></rdf:Alt></dc:title>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;

const D1 = () => {
  const specs = [
    { media: [0, 0, 595.2756, 841.8898], label: "i", mm: [210, 297] },
    { media: [0, 0, 841.8898, 595.2756], label: "ii", mm: [297, 210] },
    { media: [0, 0, 419.5276, 595.2756], label: "1", mm: [148, 210] },
    { media: [0, 0, 612, 792], label: "2", mm: [215.9, 279.4], rotate: 90 },
    {
      media: [0, 0, 300, 300],
      bleed: [9, 9, 291, 291],
      trim: [17.5039, 17.5039, 282.4961, 282.4961],
      label: "A-1",
      mm: [93.4834, 93.4834],
    },
  ];
  return {
    pdf: makeDoc({
      prepare: (pdf) => ({
        metadata: pdf.add(stream({ Type: name("Metadata"), Subtype: name("XML") }, XMP)),
      }),
      catalog: ({ metadata }) => ({
        Metadata: ref(metadata),
        PageLabels: {
          Nums: [0, { S: name("r") }, 2, { S: name("D") }, 4, { S: name("D"), P: str("A-") }],
        },
      }),
      info: {
        Title: str("Maskora mixed document"),
        Author: str("Maskora fixtures"),
        Subject: str("Mixed sizes and page labels"),
        Creator: str("Maskora fixture generator"),
        Producer: str("Maskora pdf-writer"),
        CreationDate: str("D:20261030120000Z"),
        ModDate: str("D:20261030123000Z"),
      },
      pages: specs.map((p, i) => ({
        dict: {
          MediaBox: p.media,
          ...(p.bleed ? { BleedBox: p.bleed } : {}),
          ...(p.trim ? { TrimBox: p.trim } : {}),
          ...(p.rotate ? { Rotate: p.rotate } : {}),
        },
        content: markF(p.trim ?? p.media, i),
      })),
    }),
    expected: {
      description:
        "Mixed sizes, orientations and page labels (roman i–ii, decimal 1–2, prefixed A-1), Info dictionary and XMP; physical size is the effective TrimBox in mm",
      labels: specs.map((p) => p.label),
      pages: specs.map((p, index) => ({ index, rotate: p.rotate ?? 0, trimSizeMm: p.mm })),
      info: {
        Title: "Maskora mixed document",
        Author: "Maskora fixtures",
        Subject: "Mixed sizes and page labels",
        Creator: "Maskora fixture generator",
        Producer: "Maskora pdf-writer",
        CreationDate: "2026-10-30T12:00:00.000Z",
        ModDate: "2026-10-30T12:30:00.000Z",
      },
      pdfVersion: "1.7",
      xmp: true,
    },
  };
};

// ---------------------------------------------------------------------------
// Mask mapping and registration (step 1.2)
// ---------------------------------------------------------------------------

/** Millimetres to points, rounded to the writer's 4 decimals. */
const pt = (mm) => Math.round(((mm * 72) / 25.4) * 10000) / 10000;

/**
 * A page with a 100 × 150 mm trim. `trimAt` is the trim's lower-left corner in
 * mm from the MediaBox origin; the MediaBox is the trim plus `margin` mm on
 * every side, extended to fit `trimAt`. The BleedBox is stated as 3 mm around
 * the trim. Shapes are rectangles in mm relative to the trim's lower-left
 * corner, so registration is judged in trim space whatever the page layout.
 */
function maskPage({ trimMm = [100, 150], trimAt = [3, 3], shapes = [], background, color = [0, 0, 0] } = {}) {
  const [tw, th] = trimMm;
  const [ox, oy] = trimAt;
  const media = [0, 0, pt(ox + tw + 3), pt(oy + th + 3)];
  const toPt = ([x, y, w, h]) => [pt(ox + x), pt(oy + y), pt(w), pt(h)];
  return {
    dict: {
      MediaBox: media,
      BleedBox: [pt(ox - 3), pt(oy - 3), pt(ox + tw + 3), pt(oy + th + 3)],
      TrimBox: [pt(ox), pt(oy), pt(ox + tw), pt(oy + th)],
    },
    content:
      (background ? fill([0, 0, media[2], media[3]], background) : "") +
      shapes.map((s) => fill(toPt(s), color)).join(""),
  };
}

/** Artwork: a pale full-bleed tint, an asymmetric "F" and a corner block, so orientation is visible. */
const artworkPage = (tint) => {
  const page = maskPage({ background: tint });
  page.content += fill([pt(13), pt(118), pt(8), pt(30)], [0.15, 0.15, 0.2]);
  page.content += fill([pt(13), pt(140), pt(26), pt(8)], [0.15, 0.15, 0.2]);
  page.content += fill([pt(13), pt(127), pt(18), pt(7)], [0.15, 0.15, 0.2]);
  page.content += fill([pt(85), pt(8), pt(14), pt(14)], [0.8, 0.25, 0.2]);
  return page;
};

const K1 = () => {
  const raised = [10, 20, 30, 15];
  const uvA = [25, 25, 30, 20];
  const uvStripe = [90, 60, 13, 5];
  const uvB = [45, 40, 20, 20];
  return {
    pdf: makeDoc({
      pages: [
        maskPage({ shapes: [raised] }),
        artworkPage([0.98, 0.94, 0.8]),
        artworkPage([0.82, 0.9, 0.98]),
        maskPage({ shapes: [uvA, uvStripe] }),
        maskPage({ shapes: [uvB] }),
      ],
    }),
    expected: {
      description:
        "One PDF, pages out of order: raised-UV mask, artwork A, artwork B, ordinary-UV mask (with a stripe past the trim), a second ordinary-UV mask overlapping the first",
      trimMm: [100, 150],
      mapping: [
        { page: 0, role: "mask", finish: "raisedUv", target: 1 },
        { page: 1, role: "print" },
        { page: 2, role: "print" },
        { page: 3, role: "mask", finish: "uv", target: 1 },
        { page: 4, role: "mask", finish: "uv", target: 1 },
      ],
      shapesMm: { 0: [raised], 3: [uvA, uvStripe], 4: [uvB] },
      // Trim-relative mm on artwork A, all three layers enabled. Raised UV replaces ordinary UV where both cover.
      samples: [
        { at: [15, 30], uv: 0, raisedUv: 1 },
        { at: [30, 30], uv: 0, raisedUv: 1 },
        { at: [45, 30], uv: 1, raisedUv: 0 },
        { at: [50, 42], uv: 1, raisedUv: 0 },
        { at: [60, 50], uv: 1, raisedUv: 0 },
        { at: [80, 120], uv: 0, raisedUv: 0 },
      ],
      warnings: { beyondTrim: [3], sameTypeOverlap: [[3, 4]] },
    },
  };
};

const K2a = () => ({
  pdf: makeDoc({ pages: [artworkPage([0.95, 0.88, 0.95])] }),
  expected: {
    description: "Artwork alone: one page, 100 × 150 mm trim with 3 mm bleed; its masks are in K2m",
    trimMm: [100, 150],
  },
});

const K2m = () => {
  const misregistered = { nominal: [20, 100, 30, 15], shift: [1.5, -1.0] };
  const drawn = [20 + 1.5, 100 - 1.0, 30, 15];
  return {
    pdf: makeDoc({
      pages: [
        maskPage({ trimAt: [13, 13], background: [1, 1, 1], shapes: [[20, 30, 30, 10]] }),
        maskPage({ shapes: [[60, 40, 20, 20]] }),
        maskPage({ shapes: [drawn] }),
        maskPage({ trimMm: [101, 150], shapes: [[20, 30, 30, 10]] }),
      ],
    }),
    expected: {
      description:
        "Masks for K2a in a separate file: an opaque page whose trim sits elsewhere on a larger sheet, a transparent page, a page drawn 1.5 mm right and 1 mm down of its nominal place, and a page whose trim is 1 mm too wide",
      pages: [
        {
          page: 0,
          shapesMm: [[20, 30, 30, 10]],
          alphaUsable: false,
          warnings: ["originMismatch"],
          samples: [
            { at: [35, 35], coverage: 1 },
            { at: [35, 45], coverage: 0 },
          ],
        },
        {
          page: 1,
          shapesMm: [[60, 40, 20, 20]],
          alphaUsable: true,
          warnings: [],
          samples: [
            { at: [70, 50], coverage: 1 },
            { at: [50, 50], coverage: 0 },
          ],
        },
        {
          page: 2,
          shapesMm: [misregistered.nominal],
          drawnMm: [drawn],
          correctionMm: [-1.5, 1.0],
          alphaUsable: true,
          warnings: [],
          // Without correction the shape spans x 21.5–51.5, y 99–114; corrected, x 20–50, y 100–115.
          samples: [
            { at: [20.7, 107], uncorrected: 0, corrected: 1 },
            { at: [35, 99.4], uncorrected: 1, corrected: 0 },
            { at: [50.8, 107], uncorrected: 1, corrected: 0 },
            { at: [35, 114.6], uncorrected: 0, corrected: 1 },
          ],
        },
        { page: 3, shapesMm: [[20, 30, 30, 10]], alphaUsable: true, warnings: ["sizeMismatch"] },
      ],
    },
  };
};

export const CORPUS = {
  G3,
  G4,
  G5,
  G6,
  G7,
  G8,
  R1,
  R2,
  M1,
  M2,
  M3,
  A1,
  O1,
  X1a,
  X1b,
  X1c,
  X2a,
  X2b,
  X2c,
  E1a,
  E1b,
  D1,
  K1,
  K2a,
  K2m,
};
