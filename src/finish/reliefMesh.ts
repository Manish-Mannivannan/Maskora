/**
 * Raised UV as geometry: a prototype for architecture §17.2.
 *
 * The coating's footprint is the raised-UV coverage's 0.5 contour on the
 * shared finish raster, so the mesh's outer edge is registered to the same
 * coverage the overlay shows. Inset rings are level sets of one distance
 * field (the exact Euclidean distance, in mm, from each covered pixel to the
 * footprint's edge): the shoulder rises from height 0 at the edge to the full
 * height at the bevel distance along a quarter-sine profile, and the top may
 * carry a slight crown. Because every ring comes from the same field, rings
 * that would collapse, split or intersect under polygon offsetting simply
 * change topology; those events are counted per shape and reported, and a
 * shape narrower than twice the bevel keeps its footprint at reduced height
 * rather than disappearing.
 *
 * Geometry is concentrated where the surface bends: every raster cell in the
 * shoulder band is triangulated (clipped to the footprint by marching
 * squares), while the flat top is merged into rectangles. Coordinates are
 * raster pixels (x right, y down, at pixel centres) and height in µm, so this
 * module needs no renderer; the scene converts them to metres.
 */

export interface ReliefProfile {
  heightUm: number;
  bevelMm: number;
  /** Extra height at the middle of wide tops, µm; 0 keeps the top flat. */
  crownUm: number;
}

export interface ReliefShape {
  /** Covered pixels in this connected shape. */
  pixels: number;
  /** Largest distance from the edge inside the shape, mm. */
  maxInsetMm: number;
  /** Separate full-height tops: 0 if the shape is too narrow, more than 1 if its inset splits. */
  plateaus: number;
  /** Height the shape actually reaches, µm. */
  reachedUm: number;
}

export interface ReliefMesh {
  /** x, y in raster pixels, z in µm, per vertex. */
  positions: Float32Array;
  /**
   * Unit normals per vertex in physical space with y up (x right, y up the
   * page, z out of it), from the intended surface rather than the triangles.
   */
  normals: Float32Array;
  indices: Uint32Array;
  shapes: ReliefShape[];
  triangles: number;
  vertices: number;
}

/** Height at inset distance `d` mm. */
export function profileHeight(d: number, p: ReliefProfile): number {
  if (d <= 0) return 0;
  const t = Math.min(1, d / p.bevelMm);
  const crown = p.crownUm * Math.min(1, Math.max(0, (d - p.bevelMm) / (2 * p.bevelMm)));
  return p.heightUm * Math.sin((t * Math.PI) / 2) + crown;
}

/** One-dimensional squared distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
  }
}

/** Distance in pixels from each inside pixel to the nearest outside pixel centre (0 outside). */
export function distanceField(inside: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e20;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i += 1) grid[i] = inside[i] ? INF : 0;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y];
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) f[x] = grid[y * width + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x += 1) out[y * width + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** 8-connected labels of `mask` (0 = not in mask); returns labels and the count. */
function label(mask: Uint8Array, width: number, height: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(width * height);
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start]) continue;
    count += 1;
    labels[start] = count;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy += 1)
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (mask[j] && !labels[j]) {
            labels[j] = count;
            stack.push(j);
          }
        }
    }
  }
  return { labels, count };
}

export function buildReliefMesh(
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
  /** `exactNormals: false` keeps the triangles' own normals, for comparison. */
  options: { exactNormals?: boolean } = {},
): ReliefMesh {
  // Plain loops: typed-array .from with a mapper is several times slower on rasters this size.
  const inside = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i += 1) inside[i] = coverage[i] >= 128 ? 1 : 0;
  const dist = distanceField(inside, width, height);
  // The edge lies half a pixel beyond the outermost covered pixel centre.
  const insetMm = new Float32Array(dist.length);
  for (let i = 0; i < dist.length; i += 1) insetMm[i] = inside[i] ? Math.max(0, dist[i] - 0.5) / pxPerMm : 0;
  const top = (i: number) => insetMm[i] >= profile.bevelMm;

  // Topology: shapes, how far each insets, and how many full-height tops it keeps.
  const shapesL = label(inside, width, height);
  const tops = new Uint8Array(inside.length);
  for (let i = 0; i < inside.length; i += 1) tops[i] = inside[i] && top(i) ? 1 : 0;
  const topsL = label(tops, width, height);
  const shapes: ReliefShape[] = Array.from({ length: shapesL.count }, () => ({
    pixels: 0,
    maxInsetMm: 0,
    plateaus: 0,
    reachedUm: 0,
  }));
  const topsOf = Array.from({ length: shapesL.count }, () => new Set<number>());
  for (let i = 0; i < inside.length; i += 1) {
    const s = shapesL.labels[i];
    if (!s) continue;
    const shape = shapes[s - 1];
    shape.pixels += 1;
    shape.maxInsetMm = Math.max(shape.maxInsetMm, insetMm[i]);
    if (topsL.labels[i]) topsOf[s - 1].add(topsL.labels[i]);
  }
  shapes.forEach((s, k) => {
    s.plateaus = topsOf[k].size;
    s.reachedUm = profileHeight(s.maxInsetMm, profile);
  });

  const positions: number[] = [];
  const indices: number[] = [];
  const ids = new Map<number, number>();
  const corner = (x: number, y: number) => {
    const key = y * width + x;
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      positions.push(x, y, profileHeight(insetMm[key], profile));
      ids.set(key, id);
    }
    return id;
  };
  const crossing = (ax: number, ay: number, bx: number, by: number) => {
    // One id per grid edge: horizontal edges even, vertical edges odd, after the corners.
    const [x0, y0] = ax < bx || ay < by ? [ax, ay] : [bx, by];
    const key = width * height + (y0 * width + x0) * 2 + (ay === by ? 0 : 1);
    let id = ids.get(key);
    if (id === undefined) {
      const va = coverage[ay * width + ax] / 255;
      const vb = coverage[by * width + bx] / 255;
      const t = (0.5 - va) / (vb - va);
      id = positions.length / 3;
      positions.push(ax + (bx - ax) * t, ay + (by - ay) * t, 0);
      ids.set(key, id);
    }
    return id;
  };

  // Shoulder cells are triangulated one by one; full-height cells are collected and merged.
  const flatTop = profile.crownUm === 0;
  const plateauCell = new Uint8Array(width * height);
  // Corners in order: top-left, top-right, bottom-right, bottom-left (offsets into the raster).
  const cx = [0, 1, 1, 0];
  const cy = [0, 0, 1, 1];
  const inn = [false, false, false, false];
  const poly: number[] = [];
  const rim: number[] = [];
  for (let y = 0; y < height - 1; y += 1)
    for (let x = 0; x < width - 1; x += 1) {
      const i0 = y * width + x;
      inn[0] = inside[i0] === 1;
      inn[1] = inside[i0 + 1] === 1;
      inn[2] = inside[i0 + width + 1] === 1;
      inn[3] = inside[i0 + width] === 1;
      if (!(inn[0] || inn[1] || inn[2] || inn[3])) continue;
      if (
        flatTop &&
        inn[0] &&
        inn[1] &&
        inn[2] &&
        inn[3] &&
        top(i0) &&
        top(i0 + 1) &&
        top(i0 + width + 1) &&
        top(i0 + width)
      ) {
        plateauCell[i0] = 1;
        continue;
      }
      poly.length = 0;
      for (let i = 0; i < 4; i += 1) {
        const j = (i + 1) & 3;
        if (inn[i]) poly.push(corner(x + cx[i], y + cy[i]));
        if (inn[i] !== inn[j]) poly.push(crossing(x + cx[i], y + cy[i], x + cx[j], y + cy[j]));
      }
      for (let k = 1; k + 1 < poly.length; k += 1) indices.push(poly[0], poly[k], poly[k + 1]);
      // Rim segments: consecutive crossings in the cell's polygon (rim vertices are the only ones at height 0).
      for (let k = 0; k < poly.length; k += 1) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        if (a !== b && positions[a * 3 + 2] === 0 && positions[b * 3 + 2] === 0) rim.push(a, b);
      }
    }

  // Merge full-height cells: runs along rows, then identical runs down the rows.
  const used = new Uint8Array(width * height);
  for (let y = 0; y < height - 1; y += 1)
    for (let x = 0; x < width - 1; x += 1) {
      if (!plateauCell[y * width + x] || used[y * width + x]) continue;
      let x1 = x;
      while (x1 + 1 < width - 1 && plateauCell[y * width + x1 + 1] && !used[y * width + x1 + 1]) x1 += 1;
      let y1 = y;
      const rowFits = (yy: number) => {
        for (let xx = x; xx <= x1; xx += 1)
          if (!plateauCell[yy * width + xx] || used[yy * width + xx]) return false;
        return true;
      };
      while (y1 + 1 < height - 1 && rowFits(y1 + 1)) y1 += 1;
      for (let yy = y; yy <= y1; yy += 1) for (let xx = x; xx <= x1; xx += 1) used[yy * width + xx] = 1;
      const tl = corner(x, y);
      const tr = corner(x1 + 1, y);
      const br = corner(x1 + 1, y1 + 1);
      const bl = corner(x, y1 + 1);
      indices.push(tl, tr, br, tl, br, bl);
    }

  const nearest = nearestRim(positions, rim, pxPerMm, profile);

  const mesh: ReliefMesh = {
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    indices: Uint32Array.from(indices),
    shapes,
    triangles: indices.length / 3,
    vertices: positions.length / 3,
  };
  mesh.normals.set(
    options.exactNormals === false
      ? meshNormals(mesh, pxPerMm)
      : shoulderNormals(
          mesh,
          nearest,
          smoothedSignedDistance(inside, dist, width, height),
          width,
          height,
          pxPerMm,
          profile,
        ),
  );
  return mesh;
}

interface NearestRim {
  /** Distance to the rim in pixels (Infinity beyond the search reach). */
  dist: Float32Array;
  /** Nearest rim point, raster pixels. */
  px: Float32Array;
  py: Float32Array;
}

/**
 * For every shoulder vertex, the nearest point on the rim (the footprint's
 * interpolated contour), and the vertex's height from that exact distance
 * instead of the pixel-centre distance, which steps by whole pixels next to a
 * curved edge. Heights only: no vertex moves sideways, and the rim stays at 0.
 */
function nearestRim(positions: number[], rim: number[], pxPerMm: number, profile: ReliefProfile): NearestRim {
  const n = positions.length / 3;
  const out = { dist: new Float32Array(n).fill(Infinity), px: new Float32Array(n), py: new Float32Array(n) };
  if (!rim.length) return out;
  const reach = profile.bevelMm * pxPerMm + 1.5;
  const cell = Math.max(2, Math.ceil(reach / 2));
  const buckets = new Map<number, number[]>();
  const key = (bx: number, by: number) => by * 1_000_003 + bx;
  for (let s = 0; s < rim.length; s += 2) {
    const ax = positions[rim[s] * 3];
    const ay = positions[rim[s] * 3 + 1];
    const bx = positions[rim[s + 1] * 3];
    const by = positions[rim[s + 1] * 3 + 1];
    for (let gy = Math.floor(Math.min(ay, by) / cell); gy <= Math.floor(Math.max(ay, by) / cell); gy += 1)
      for (let gx = Math.floor(Math.min(ax, bx) / cell); gx <= Math.floor(Math.max(ax, bx) / cell); gx += 1) {
        const list = buckets.get(key(gx, gy));
        if (list) list.push(s);
        else buckets.set(key(gx, gy), [s]);
      }
  }
  const span = Math.ceil(reach / cell);
  for (let i = 0; i < n; i += 1) {
    const z = positions[i * 3 + 2];
    if (z >= profile.heightUm) continue;
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const gx0 = Math.floor(px / cell);
    const gy0 = Math.floor(py / cell);
    let best = Infinity;
    let nx = px;
    let ny = py;
    for (let gy = gy0 - span; gy <= gy0 + span; gy += 1)
      for (let gx = gx0 - span; gx <= gx0 + span; gx += 1)
        for (const s of buckets.get(key(gx, gy)) ?? []) {
          const ax = positions[rim[s] * 3];
          const ay = positions[rim[s] * 3 + 1];
          const dx = positions[rim[s + 1] * 3] - ax;
          const dy = positions[rim[s + 1] * 3 + 1] - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
          const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
          if (d < best) {
            best = d;
            nx = ax + t * dx;
            ny = ay + t * dy;
          }
        }
    // Beyond the search reach the vertex is at full bevel distance anyway.
    if (best >= reach) continue;
    out.dist[i] = best;
    out.px[i] = nx;
    out.py[i] = ny;
    if (z !== 0) positions[i * 3 + 2] = profileHeight(best / pxPerMm, profile);
  }
  return out;
}

/** Slope of the profile (height per distance, both in mm) at inset `d` mm. */
function profileSlope(d: number, p: ReliefProfile): number {
  if (d >= p.bevelMm) return 0;
  return (
    (p.heightUm / 1000) * (Math.PI / (2 * p.bevelMm)) * Math.cos((Math.PI / 2) * (Math.max(0, d) / p.bevelMm))
  );
}

/** Separable box blur of a float field, three passes (close to a Gaussian); edges extend their last value. */
function blurField(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  const inv = 1 / (2 * radius + 1);
  const pass = (
    from: Float32Array,
    to: Float32Array,
    lines: number,
    len: number,
    lineStride: number,
    step: number,
  ) => {
    const last = (len - 1) * step;
    for (let line = 0; line < lines; line += 1) {
      const base = line * lineStride;
      let sum = from[base] * (radius + 1);
      for (let k = 1; k <= radius; k += 1) sum += from[base + Math.min(k, len - 1) * step];
      for (let k = 0; k < len; k += 1) {
        to[base + k * step] = sum * inv;
        const add = k + radius + 1 < len ? (k + radius + 1) * step : last;
        const sub = k - radius > 0 ? (k - radius) * step : 0;
        sum += from[base + add] - from[base + sub];
      }
    }
  };
  for (let n = 0; n < 3; n += 1) {
    pass(a, b, height, width, width, 1);
    [a, b] = [b, a];
    pass(a, b, width, height, 1, width);
    [a, b] = [b, a];
  }
  return a;
}

/** Bilinear sample of a field at raster coordinates (pixel centres at integers), clamped at the edges. */
function sample(field: Float32Array, width: number, height: number, x: number, y: number): number {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const x0 = Math.min(width - 2, Math.floor(cx));
  const y0 = Math.min(height - 2, Math.floor(cy));
  const fx = cx - x0;
  const fy = cy - y0;
  const i = y0 * width + x0;
  return (
    field[i] * (1 - fx) * (1 - fy) +
    field[i + 1] * fx * (1 - fy) +
    field[i + width] * (1 - fx) * fy +
    field[i + width + 1] * fx * fy
  );
}

/**
 * Signed distance to the footprint's edge in pixels (positive inside),
 * smoothed: a binary coverage edge is a staircase at pixel scale, and so is
 * any contour drawn through it, but the smoothed field's level sets are round
 * where the shape is round. Only directions are taken from it.
 */
function smoothedSignedDistance(inside: Uint8Array, distIn: Float32Array, width: number, height: number) {
  const outside = new Uint8Array(inside.length);
  for (let i = 0; i < inside.length; i += 1) outside[i] = inside[i] ? 0 : 1;
  const distOut = distanceField(outside, width, height);
  const sdf = new Float32Array(inside.length);
  for (let i = 0; i < inside.length; i += 1) sdf[i] = inside[i] ? distIn[i] - 0.5 : 0.5 - distOut[i];
  return blurField(sdf, width, height, 2);
}

/**
 * Normals of the intended surface, which removes the stair-steps that pixel-
 * grid triangles (and the slivers along the rim) leave on curved shoulders.
 * The height is the profile of the distance to the edge, so the normal leans
 * outwards by the profile's slope at that distance, in the direction of the
 * smoothed signed distance's gradient. Ridges of thin strokes (local peaks)
 * and full-height tops point straight up. Nothing moves: positions,
 * footprint and holes are those of the triangulated mesh.
 */
function shoulderNormals(
  mesh: ReliefMesh,
  nearest: NearestRim,
  sdf: Float32Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
) {
  const n = mesh.vertices;
  const p = mesh.positions;
  const out = new Float32Array(n * 3);
  // Neighbours from the triangles, as compressed rows: to recognise peaks and to orient rim vertices inwards.
  const degree = new Uint32Array(n + 1);
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k += 1) degree[idx[t + k] + 1] += 2;
  for (let i = 0; i < n; i += 1) degree[i + 1] += degree[i];
  const fill = degree.slice(0, n);
  const neighbours = new Uint32Array(degree[n]);
  for (let t = 0; t < idx.length; t += 3)
    for (let k = 0; k < 3; k += 1) {
      const a = idx[t + k];
      neighbours[fill[a]++] = idx[t + ((k + 1) % 3)];
      neighbours[fill[a]++] = idx[t + ((k + 2) % 3)];
    }
  for (let i = 0; i < n; i += 1) {
    const z = p[i * 3 + 2];
    let gx = 0;
    let gy = 0;
    let peak = z > 0;
    for (let j = degree[i]; j < degree[i + 1] && peak; j += 1) if (p[neighbours[j] * 3 + 2] > z) peak = false;
    const onRim = z === 0;
    if (onRim || (!peak && Number.isFinite(nearest.dist[i]))) {
      // Inwards: up the smoothed signed distance, whose level sets round off the binary edge's stairs.
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const dx = sample(sdf, width, height, x + 1, y) - sample(sdf, width, height, x - 1, y);
      const dy = sample(sdf, width, height, x, y + 1) - sample(sdf, width, height, x, y - 1);
      const l = Math.hypot(dx, dy);
      const s = profileSlope(onRim ? 0 : nearest.dist[i] / pxPerMm, profile);
      if (l > 1e-6) [gx, gy] = [(dx / l) * s, (dy / l) * s];
    }
    // Raster y runs down: in y-up space the gradient's y flips, and the normal leans against the gradient.
    const l = Math.hypot(gx, gy, 1);
    out[i * 3] = -gx / l;
    out[i * 3 + 1] = gy / l;
    out[i * 3 + 2] = 1 / l;
  }
  return out;
}

/** Area-weighted vertex normals in physical units (x, y in mm from pixels; z in mm from µm). */
export function meshNormals(mesh: ReliefMesh, pxPerMm: number): Float32Array {
  const p = mesh.positions;
  const out = new Float32Array(mesh.vertices * 3);
  const at = (i: number) => [p[i * 3] / pxPerMm, -p[i * 3 + 1] / pxPerMm, p[i * 3 + 2] / 1000];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    // Raster y runs down; flipping it makes the normals point up (+z) for these triangles.
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 2], mesh.indices[t + 1]];
    const [pa, pb, pc] = [at(a), at(b), at(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    const nz = u[0] * v[1] - u[1] * v[0];
    for (const i of [a, b, c]) {
      out[i * 3] += nx;
      out[i * 3 + 1] += ny;
      out[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < mesh.vertices; i += 1) {
    const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1;
    out[i * 3] /= l;
    out[i * 3 + 1] /= l;
    out[i * 3 + 2] /= l;
  }
  return out;
}

/** Triangles allowed for one face's coating mesh: about 8 MB of geometry. */
export const RELIEF_TRIANGLE_BUDGET = 300_000;
const MAX_STEP = 8;

export type BoundedRelief =
  | { mesh: ReliefMesh; step: number; estimated: number }
  | { mesh: null; step: number; estimated: number; reason: string };

/** Coverage averaged over `step` × `step` blocks. */
function downsample(coverage: Uint8Array, width: number, height: number, step: number) {
  const w = Math.ceil(width / step);
  const h = Math.ceil(height / step);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let yy = y * step; yy < Math.min(height, (y + 1) * step); yy += 1)
        for (let xx = x * step; xx < Math.min(width, (x + 1) * step); xx += 1) {
          sum += coverage[yy * width + xx];
          n += 1;
        }
      out[y * w + x] = Math.round(sum / n);
    }
  return { coverage: out, width: w, height: h };
}

/** Triangles a full-resolution mesh would need: edge pixels times the shoulder's width in pixels, plus the rim. */
export function estimateTriangles(
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  bevelMm: number,
) {
  let edge = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (coverage[i] < 128) continue;
      if (
        (x > 0 && coverage[i - 1] < 128) ||
        (x < width - 1 && coverage[i + 1] < 128) ||
        (y > 0 && coverage[i - width] < 128) ||
        (y < height - 1 && coverage[i + width] < 128)
      )
        edge += 1;
    }
  return edge * 2 * (Math.max(1, bevelMm * pxPerMm) + 1);
}

/**
 * A coating mesh that fits the triangle budget. If the full raster would
 * exceed it, the mesh is built from coverage averaged over 2 × 2, 4 × 4 or
 * 8 × 8 pixels (coarser shoulders, same footprint within the step), and the
 * step is reported so the view can say so. If even that cannot fit, there is
 * no mesh and the caller falls back to surface normals. Positions are always
 * in the full raster's pixel coordinates.
 */
export function buildBoundedReliefMesh(
  coverage: Uint8Array,
  width: number,
  height: number,
  pxPerMm: number,
  profile: ReliefProfile,
  budget = RELIEF_TRIANGLE_BUDGET,
): BoundedRelief {
  const estimated = estimateTriangles(coverage, width, height, pxPerMm, profile.bevelMm);
  // Coarsening must never drop a shape (a dot or stroke averaging below half coverage would vanish).
  const inside = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i += 1) inside[i] = coverage[i] >= 128 ? 1 : 0;
  const shapes = label(inside, width, height).count;
  let lost = false;
  // Edge pixels and the shoulder's width both shrink with the step, so the estimate falls with its square.
  let step = 1;
  while (step < MAX_STEP && estimated / (step * step) > budget) step *= 2;
  for (; step <= MAX_STEP; step *= 2) {
    const small = step === 1 ? { coverage, width, height } : downsample(coverage, width, height, step);
    const mesh = buildReliefMesh(small.coverage, small.width, small.height, pxPerMm / step, profile);
    if (mesh.triangles > budget) continue;
    if (mesh.shapes.length !== shapes) {
      lost = true;
      continue;
    }
    if (step > 1)
      for (let i = 0; i < mesh.vertices; i += 1) {
        // Block centres back to full-raster pixel coordinates.
        mesh.positions[i * 3] = mesh.positions[i * 3] * step + (step - 1) / 2;
        mesh.positions[i * 3 + 1] = mesh.positions[i * 3 + 1] * step + (step - 1) / 2;
      }
    return { mesh, step, estimated };
  }
  return {
    mesh: null,
    step: MAX_STEP,
    estimated,
    reason: lost
      ? `fitting ${budget.toLocaleString("en")} triangles would need a resolution that loses some of the mask's ${shapes} shapes`
      : `the mask needs more than ${budget.toLocaleString("en")} triangles even at 1/${MAX_STEP} resolution`,
  };
}
