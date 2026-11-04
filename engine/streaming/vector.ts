/**
 * Vector geometry for static world art that is not on the tile grid: polylines stroked into
 * triangle strips (roads, rails, kerbs, paths) and meshes clipped to a chunk's square, so a
 * shape that crosses chunks can be built in each chunk it touches and meet seamlessly.
 *
 * Pure data, Pixi-free (src: "yage/streaming/vector"); `meshGeometry` in "yage/streaming/statics"
 * turns a VectorMesh into a Pixi geometry.
 */

export type Point = { x: number; y: number };

/** Interleaving-free triangle mesh: positions (x, y pairs), named float attributes, indices. */
export type VectorMesh = {
  positions: number[];
  attributes: Record<string, { size: number; data: number[] }>;
  indices: number[];
};

export type StrokeOptions = {
  /** End shape; "round" adds a half-disc fan beyond each end. Default "butt". */
  cap?: "butt" | "round" | readonly ["butt" | "round", "butt" | "round"];
  /** Segments in a round cap's half circle. Default 8. */
  capSegments?: number;
  /** Longest miter, in half widths, before a sharp join is clamped. Default 4. */
  miterLimit?: number;
  /** Distance along the line at the first point (keeps dashes continuous across pieces). Default 0. */
  startDistance?: number;
};

/**
 * Strokes a polyline into a mesh `2 × half` wide, three vertices across (left, centre, right).
 * Attributes:
 *  - `uv`: x = distance along the line, y = signed offset across it (− left … + right, in the
 *    same units as the points; "left" is the left-hand side walking from the first point, with
 *    y pointing down the screen);
 *  - `edge`: unsigned distance from the centreline (radial within round caps), so a shader can
 *    draw kerbs, verges and rounded dead-ends by distance alone.
 * Duplicate consecutive points are skipped; fewer than two distinct points give an empty mesh.
 */
export const strokePolyline = (points: readonly Point[], half: number, options: StrokeOptions = {}): VectorMesh => {
  const pts: Point[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) pts.push(p);
  }
  const mesh = emptyMesh({ uv: 2, edge: 1 });
  if (pts.length < 2 || !(half > 0)) return mesh;
  const limit = options.miterLimit ?? 4;
  const uv = mesh.attributes.uv.data;
  const edge = mesh.attributes.edge.data;
  const add = (x: number, y: number, u: number, v: number, e: number) => {
    mesh.positions.push(x, y);
    uv.push(u, v);
    edge.push(e);
    return mesh.positions.length / 2 - 1;
  };
  const dirs = pts.slice(1).map((p, i) => {
    const dx = p.x - pts[i].x;
    const dy = p.y - pts[i].y;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len, len };
  });
  let along = options.startDistance ?? 0;
  let prev = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = dirs[Math.max(0, i - 1)];
    const b = dirs[Math.min(dirs.length - 1, i)];
    // Normal pointing to the right of travel: (−dy, dx) with y down.
    let nx = -(a.y + b.y);
    let ny = a.x + b.x;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) {
      nx = -b.y;
      ny = b.x;
    } else {
      nx /= nl;
      ny /= nl;
    }
    // Miter: the offset that keeps both segments' edges at `half`.
    const cos = nx * -b.y + ny * b.x;
    const scale = Math.min(limit, 1 / Math.max(cos, 1e-6));
    const p = pts[i];
    if (i > 0) along += dirs[i - 1].len;
    const l = add(p.x - nx * half * scale, p.y - ny * half * scale, along, -half, half);
    const c = add(p.x, p.y, along, 0, 0);
    add(p.x + nx * half * scale, p.y + ny * half * scale, along, half, half);
    if (prev >= 0) {
      const [pl, pc, pr] = [prev, prev + 1, prev + 2];
      mesh.indices.push(pl, pc, l, pc, c, l, pc, pr, c, pr, c + 1, c);
    }
    prev = l;
  }
  const caps = typeof options.cap === "string" || !options.cap ? [options.cap ?? "butt", options.cap ?? "butt"] : options.cap;
  const segments = Math.max(2, options.capSegments ?? 8);
  const cap = (p: Point, dx: number, dy: number, u: number, sign: number) => {
    // Half disc on the outside of an end; `sign` −1 at the start (behind it), +1 at the end.
    const centre = add(p.x, p.y, u, 0, 0);
    let last = -1;
    for (let s = 0; s <= segments; s++) {
      const t = (s / segments) * Math.PI;
      const across = -Math.cos(t) * half;
      const out = Math.sin(t) * half * sign;
      const x = p.x + dx * out - dy * across;
      const y = p.y + dy * out + dx * across;
      const k = add(x, y, u + out, across, half);
      if (last >= 0) mesh.indices.push(centre, last, k);
      last = k;
    }
  };
  if (caps[0] === "round") cap(pts[0], dirs[0].x, dirs[0].y, options.startDistance ?? 0, -1);
  if (caps[1] === "round") {
    const d = dirs[dirs.length - 1];
    cap(pts[pts.length - 1], d.x, d.y, along, 1);
  }
  return mesh;
};

export const emptyMesh = (attributes: Record<string, number> = {}): VectorMesh => ({
  positions: [],
  attributes: Object.fromEntries(Object.entries(attributes).map(([k, size]) => [k, { size, data: [] }])),
  indices: [],
});

/** Concatenates meshes with the same attribute layout. */
export const mergeMeshes = (meshes: readonly VectorMesh[]): VectorMesh => {
  const first = meshes[0];
  const out = emptyMesh(first ? Object.fromEntries(Object.entries(first.attributes).map(([k, a]) => [k, a.size])) : {});
  for (const m of meshes) {
    const base = out.positions.length / 2;
    // Dense road layers exceed the JavaScript function-argument limit; append values directly.
    for (let i = 0; i < m.positions.length; i++) out.positions.push(m.positions[i]);
    for (const [k, a] of Object.entries(out.attributes)) {
      const src = m.attributes[k];
      if (!src || src.size !== a.size) throw new Error(`mergeMeshes: attribute ${k} differs`);
      for (let i = 0; i < src.data.length; i++) a.data.push(src.data[i]);
    }
    for (const i of m.indices) out.indices.push(i + base);
  }
  return out;
};

/** Moves every position by (dx, dy), e.g. from global into chunk-local units. */
export const translateMesh = (mesh: VectorMesh, dx: number, dy: number): VectorMesh => ({
  ...mesh,
  positions: mesh.positions.map((v, i) => v + (i % 2 ? dy : dx)),
});

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Clips every triangle to `rect` (Sutherland–Hodgman), interpolating all attributes linearly, so
 * the pieces built in neighbouring chunks share their cut edges exactly.
 */
export const clipMesh = (mesh: VectorMesh, rect: Rect): VectorMesh => {
  const names = Object.keys(mesh.attributes);
  const sizes = names.map((k) => mesh.attributes[k].size);
  const width = 2 + sizes.reduce((a, b) => a + b, 0);
  const vertex = (i: number) => {
    const v = [mesh.positions[i * 2], mesh.positions[i * 2 + 1]];
    names.forEach((k, n) => {
      for (let c = 0; c < sizes[n]; c++) v.push(mesh.attributes[k].data[i * sizes[n] + c]);
    });
    return v;
  };
  const out = emptyMesh(Object.fromEntries(names.map((k, n) => [k, sizes[n]])));
  const emit = (v: number[]) => {
    out.positions.push(v[0], v[1]);
    let o = 2;
    names.forEach((k, n) => {
      for (let c = 0; c < sizes[n]; c++) out.attributes[k].data.push(v[o++]);
    });
    return out.positions.length / 2 - 1;
  };
  const planes: [number, number, number][] = [
    [0, 1, rect.minX],
    [0, -1, rect.maxX],
    [1, 1, rect.minY],
    [1, -1, rect.maxY],
  ];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    let poly = [vertex(mesh.indices[t]), vertex(mesh.indices[t + 1]), vertex(mesh.indices[t + 2])];
    const inside = poly.every((v) => v[0] >= rect.minX && v[0] <= rect.maxX && v[1] >= rect.minY && v[1] <= rect.maxY);
    if (!inside) {
      for (const [axis, sign, bound] of planes) {
        const next: number[][] = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          const da = (a[axis] - bound) * sign;
          const db = (b[axis] - bound) * sign;
          if (da >= 0) next.push(a);
          if ((da >= 0) !== (db >= 0)) {
            const k = da / (da - db);
            const v = new Array<number>(width);
            for (let c = 0; c < width; c++) v[c] = a[c] + (b[c] - a[c]) * k;
            v[axis] = bound;
            next.push(v);
          }
        }
        poly = next;
        if (poly.length < 3) break;
      }
    }
    if (poly.length < 3) continue;
    const ids = poly.map(emit);
    for (let i = 1; i + 1 < ids.length; i++) out.indices.push(ids[0], ids[i], ids[i + 1]);
  }
  return out;
};

/** Total triangle area (for tests and budget checks). */
export const meshArea = (mesh: VectorMesh) => {
  let sum = 0;
  const p = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
    sum += Math.abs((p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[c * 2] - p[a * 2]) * (p[b * 2 + 1] - p[a * 2 + 1])) / 2;
  }
  return sum;
};

/** A rotated rectangle's axis-aligned bounds: local (0,0)–(w,h) placed at (x, y), turned by `angle`. */
export const rotatedBounds = (x: number, y: number, w: number, h: number, angle: number): Rect => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const xs = [0, w * c, w * c - h * s, -h * s].map((v) => v + x);
  const ys = [0, w * s, w * s + h * c, h * c].map((v) => v + y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
};

/** A world point in a rotated rectangle's local frame (the inverse of the placement above). */
export const toLocal = (x: number, y: number, angle: number, px: number, py: number): Point => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = px - x;
  const dy = py - y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};
