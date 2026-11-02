import type { Opening } from "./statics";
import type { Point } from "./vector";

/** One outer ring followed by courtyard rings, in a static's local world units. */
export type StaticFootprint = readonly (readonly Point[])[];
export type DepthSlab = { corners: Point[]; near: Point[] };
const EPS = 1e-7;

/** Even-odd containment includes the perimeter, so a point on a wall belongs to its building. */
export const footprintContains = (rings: StaticFootprint, point: Point) => {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j],
        b = ring[i];
      const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
      if (
        Math.abs(cross) <= EPS &&
        point.x >= Math.min(a.x, b.x) - EPS &&
        point.x <= Math.max(a.x, b.x) + EPS &&
        point.y >= Math.min(a.y, b.y) - EPS &&
        point.y <= Math.max(a.y, b.y) + EPS
      )
        return true;
      if (a.y > point.y !== b.y > point.y && point.x < a.x + ((point.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
    }
  return inside;
};

/** Whether the screen-down segment meets the footprint, including concave edges and holes. */
export const footprintCovers = (rings: StaticFootprint, from: Point, to: Point) => {
  if (footprintContains(rings, from) || footprintContains(rings, to)) return true;
  const dx = to.x - from.x,
    dy = to.y - from.y;
  for (const ring of rings)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      const ex = b.x - a.x,
        ey = b.y - a.y,
        det = dx * ey - dy * ex;
      if (Math.abs(det) <= EPS) continue;
      const ax = a.x - from.x,
        ay = a.y - from.y;
      const t = (ax * ey - ay * ex) / det,
        u = (ax * dy - ay * dx) / det;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
  return false;
};

/**
 * Exact vertical silhouette strips of a polygon extruded screen-up by rise. Each disconnected
 * column keeps its own near edge: a courtyard or alley must not inherit the enclosing box's depth.
 * Cuts include where the rising roof bridges a gap, since the silhouette changes topology there.
 */
export const footprintSlabs = (rings: StaticFootprint, angle: number, rise = 0, reach = 0, openings: readonly Opening[] = []): DepthSlab[] => {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const rotated = rings.map((ring) => ring.map(({ x, y }) => ({ x: x * c - y * s, y: x * s + y * c })));
  const ways = openings.map(o => ({ x: o.x * c - o.y * s, y: o.x * s + o.y * c, half: o.half + reach }));
  const edges: { x0: number; x1: number; m: number; b: number }[] = [];
  const cuts: number[] = ways.flatMap(o => [o.x - o.half, o.x + o.half]);
  for (const ring of rotated)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      cuts.push(a.x);
      if (Math.abs(a.x - b.x) <= EPS) continue;
      const m = (b.y - a.y) / (b.x - a.x);
      edges.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), m, b: a.y - m * a.x });
    }
  if (rise > 0)
    for (const a of edges)
      for (const b of edges) {
        if (Math.abs(a.m - b.m) <= EPS) continue;
        const x = (b.b - a.b + rise) / (a.m - b.m);
        if (x > Math.max(a.x0, b.x0) + EPS && x < Math.min(a.x1, b.x1) - EPS) cuts.push(x);
      }
  cuts.sort((a, b) => a - b);
  const xs = cuts.filter((x, i) => !i || x - cuts[i - 1] > EPS);
  const local = ({ x, y }: Point): Point => ({ x: x * c + y * s, y: -x * s + y * c });
  const slabs: DepthSlab[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i],
      x1 = xs[i + 1],
      mid = (x0 + x1) / 2;
    const crossing = edges.filter((e) => mid > e.x0 && mid < e.x1).sort((a, b) => a.m * mid + a.b - b.m * mid - b.b);
    for (let j = 0; j + 1 < crossing.length; j += 2) {
      const top = crossing[j];
      let bottom = crossing[j + 1];
      while (j + 3 < crossing.length && crossing[j + 2].m * mid + crossing[j + 2].b - rise <= bottom.m * mid + bottom.b + EPS) {
        j += 2;
        bottom = crossing[j + 1];
      }
      const y = (edge: typeof top, x: number) => edge.m * x + edge.b;
      // A sprite's feet have one depth; use the shallower end of its width on this column's edge.
      // A doorway changes only the occupied column containing its threshold, never a courtyard gap.
      const opening = ways.find(o => Math.abs(mid - o.x) < o.half && o.y >= y(top, mid) - EPS && o.y <= y(bottom, mid) + EPS);
      const near = (x: number) => opening?.y ?? Math.min(y(bottom, Math.max(x0, x - reach)), y(bottom, Math.min(x1, x + reach)));
      const a = { x: x0, y: near(x0) },
        b = { x: x1, y: near(x1) };
      slabs.push({
        corners: [
          { x: x0, y: y(top, x0) - rise },
          { x: x1, y: y(top, x1) - rise },
          { x: x1, y: y(bottom, x1) },
          { x: x0, y: y(bottom, x0) },
        ].map(local),
        near: [a, b, b, a].map(local),
      });
    }
  }
  return slabs;
};
