import * as PIXI from "pixi.js";
import { LeanGeometry, LeanGraphics } from "./lean-graphics";

/**
 * A Graphics drawn again every frame from the same shapes moved about: a herd's legs, a flock's
 * wings, each one a rigid part turned and carried somewhere new. Pixi would tessellate every shape
 * every frame; here each shape is brought to a canonical place (a polygon's first point at the
 * origin and its first edge along +x; a circle, ellipse or rect at the origin) and its
 * tessellation, by Pixi, is kept by that form and its fill and line styles. A frame then only turns
 * and moves the kept triangles into place: a rigid motion, so what is drawn is what Pixi would draw.
 * A mirrored shape (an animal facing the other way) is a different form and kept on its own.
 *
 * Canonical forms are snapped to a 1/1024 px grid, so the same shape always gives the same
 * triangles whatever drew it first.
 *
 * Line width is not part of a form, so a stroke that follows the zoom (a width of so many screen
 * pixels) is not tessellated again as the zoom changes. Every stroke vertex Pixi makes is the
 * path point plus an offset in proportion to the width (offset lines, miter points, the arcs of
 * round caps and joins), so a form keeps its points at one width and how each one moves per unit
 * of width, and a frame sets each vertex for the width drawn. What width changes besides is how
 * many pieces Pixi cuts a round cap or join into (in proportion to the root of the width) and which
 * way a tight inside corner is built: a form keeps the pieces of the middle of its octave of
 * widths (one octave of widths to a form), the same triangles Pixi draws at that width, so a cap
 * may have a piece more or less than Pixi would give it at the edge of the octave. Untextured colour shapes only: textures, holes and
 * setMatrix throw. Drawn with one draw call through `shader` (its own colour shader if none).
 * With `anchor`, each vertex also carries the point last given to `at` (aAnchor), e.g. the foot
 * an animal's depth is taken from.
 */
const GRID = 1024;
const CAPS: Record<string, number> = { butt: 0, round: 1, square: 2 };
const JOINS: Record<string, number> = { miter: 0, round: 1, bevel: 2 };
/** Forms kept at most (all of them dropped past this, to be built again as drawn). */
const KEEP = 8192;

/** points at width `width`; each vertex moves by `perWidth` per unit of line width (null: no stroke). */
type Form = { key: Float64Array; points: Float32Array; perWidth: Float32Array | null; width: number; colors: Uint32Array; indices: Uint32Array };

/** Never batched, so the colours are always laid out per vertex (Pixi only does that for direct draws). */
class FormGeometry extends LeanGeometry {
  override isBatchable() {
    return false;
  }
}

const forms = new Map<number, Form[]>();
let formCount = 0;
const scratch = new FormGeometry();
/** How many forms were tessellated, since load: tests and probes read it. */
export const retainedStats = { built: 0 };

const key: number[] = [];
const hashKey = (k: readonly number[]) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < k.length; i++) {
    const v = k[i];
    h = Math.imul(h ^ (v | 0), 16777619);
    h = Math.imul(h ^ ((v * 4096) | 0), 16777619);
  }
  return h >>> 0;
};
const same = (a: Float64Array, b: readonly number[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
const snap = (v: number) => Math.round(v * GRID) / GRID;

/** The octave of widths a line width is kept in, by its nearest power of two. */
const octave = (width: number) => Math.round(Math.log2(width));
/** How far apart the two widths a form's stroke is tessellated at are (relative to its octave's middle). */
const STEP = 1 / 256;

const tessellate = (shape: PIXI.IShape, fill: PIXI.FillStyle, line: PIXI.LineStyle, width: number) => {
  scratch.clear();
  const l = line.clone();
  if (l.visible) l.width = width;
  scratch.drawShape(shape, fill.clone(), l);
  scratch.updateBatches();
  const out = { points: scratch.points.slice(), colors: scratch.colors.slice(), indices: scratch.indices.slice() };
  scratch.clear();
  return out;
};
const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const pushStyles = (fill: PIXI.FillStyle, line: PIXI.LineStyle) => {
  if (fill.visible) key.push(1, fill.color, fill.alpha);
  else key.push(0);
  if (line.visible) key.push(1, octave(line.width), line.color, line.alpha, line.alignment, CAPS[line.cap] ?? 0, JOINS[line.join] ?? 0, line.miterLimit);
  else key.push(0);
};

const build = (make: () => PIXI.IShape, fill: PIXI.FillStyle, line: PIXI.LineStyle): Form => {
  retainedStats.built++;
  const width = line.visible ? 2 ** octave(line.width) : 0;
  const at = tessellate(make(), fill, line, width);
  let perWidth: Float32Array | null = null;
  if (line.visible) {
    // A second width just beside the first (on whichever side cuts the same pieces) gives each vertex's motion per unit width.
    for (const dw of [width * STEP, -width * STEP]) {
      const by = tessellate(make(), fill, line, width + dw);
      if (!sameList(by.indices, at.indices) || by.points.length !== at.points.length) continue;
      perWidth = new Float32Array(at.points.length);
      for (let i = 0; i < at.points.length; i++) perWidth[i] = (by.points[i] - at.points[i]) / dw;
      break;
    }
    perWidth ??= new Float32Array(at.points.length);
  }
  return { key: Float64Array.from(key), points: Float32Array.from(at.points), perWidth, width, colors: Uint32Array.from(at.colors), indices: Uint32Array.from(at.indices) };
};

/** The kept form for `key` (as filled in), built from `make` (the canonical shape) when there is none. */
const formFor = (make: () => PIXI.IShape, fill: PIXI.FillStyle, line: PIXI.LineStyle) => {
  const h = hashKey(key);
  let bucket = forms.get(h);
  if (bucket) for (const f of bucket) if (same(f.key, key)) return f;
  if (formCount >= KEEP) forms.clear(), (formCount = 0), (bucket = undefined);
  const form = build(make, fill, line);
  if (bucket) bucket.push(form);
  else forms.set(h, [form]);
  formCount++;
  return form;
};

const vertex = `
attribute vec2 aVertexPosition;
attribute vec4 aColor;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec4 tint;
varying vec4 vColor;
void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vColor = aColor * tint;
}`;
const fragment = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }
`;
let program: PIXI.Program | null = null;

type Internals = { _fillStyle: PIXI.FillStyle; _lineStyle: PIXI.LineStyle; _matrix: PIXI.Matrix | null; _holeMode: boolean; _bounds: PIXI.Bounds; _tintColor: PIXI.Color };

export class RetainedGraphics extends LeanGraphics {
  private positions = new Float32Array(1024);
  private colorStore = new Uint32Array(512);
  private anchors: Float32Array | null;
  private indexStore = new Uint32Array(1024);
  private vertexCount = 0;
  private indexCount = 0;
  private ax = 0;
  private ay = 0;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  private posBuffer = new PIXI.Buffer(new Float32Array(0), false, false);
  private colorBuffer = new PIXI.Buffer(new Uint32Array(0), false, false);
  private anchorBuffer: PIXI.Buffer | null;
  private indexBuffer = new PIXI.Buffer(new Uint32Array(0), false, true);
  readonly mesh = new PIXI.Geometry();

  constructor(options: { anchor?: boolean } = {}) {
    super();
    this.anchors = options.anchor ? new Float32Array(1024) : null;
    this.mesh.addAttribute("aVertexPosition", this.posBuffer, 2, false, PIXI.TYPES.FLOAT);
    this.mesh.addAttribute("aColor", this.colorBuffer, 4, true, PIXI.TYPES.UNSIGNED_BYTE);
    this.anchorBuffer = this.anchors ? new PIXI.Buffer(new Float32Array(0), false, false) : null;
    if (this.anchorBuffer) this.mesh.addAttribute("aAnchor", this.anchorBuffer, 2, false, PIXI.TYPES.FLOAT);
    this.mesh.addIndex(this.indexBuffer);
  }

  /** The anchor of what is drawn next (finishing the open path at the old one). */
  at(x: number, y: number) {
    this.finishPoly();
    this.ax = x;
    this.ay = y;
    return this;
  }

  /** Vertices drawn since the last clear. */
  get vertices() {
    return this.vertexCount;
  }

  override clear() {
    super.clear();
    this.vertexCount = this.indexCount = 0;
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
    return this;
  }

  override drawShape(shape: PIXI.IShape): this {
    const self = this as unknown as Internals;
    const fill = self._fillStyle, line = self._lineStyle;
    if (self._holeMode || self._matrix) throw new Error("RetainedGraphics: holes and setMatrix are not supported");
    if (!fill.visible && !line.visible) return this;
    if ((fill.visible && (fill.texture !== PIXI.Texture.WHITE || fill.matrix)) || (line.visible && (line.texture !== PIXI.Texture.WHITE || line.matrix || line.native)))
      throw new Error("RetainedGraphics: untextured, non-native shapes only");
    key.length = 0;
    key.push(shape.type);
    pushStyles(fill, line);
    let cos = 1, sin = 0, tx = 0, ty = 0, form: Form;
    switch (shape.type) {
      case PIXI.SHAPES.POLY: {
        const poly = shape as PIXI.Polygon, p = poly.points;
        if (p.length < 2) return this;
        tx = p[0], ty = p[1];
        for (let i = 2; i + 1 < p.length; i += 2) {
          const dx = p[i] - tx, dy = p[i + 1] - ty, d = Math.hypot(dx, dy);
          if (d > 1e-6) {
            cos = dx / d, sin = dy / d;
            break;
          }
        }
        key.push(poly.closeStroke ? 1 : 0);
        const start = key.length;
        for (let i = 0; i + 1 < p.length; i += 2) {
          const dx = p[i] - tx, dy = p[i + 1] - ty;
          key.push(Math.round((cos * dx + sin * dy) * GRID), Math.round((-sin * dx + cos * dy) * GRID));
        }
        form = formFor(() => {
          const pts: number[] = [];
          for (let i = start; i < key.length; i++) pts.push(key[i] / GRID);
          const out = new PIXI.Polygon(pts);
          out.closeStroke = poly.closeStroke;
          return out;
        }, fill, line);
        break;
      }
      case PIXI.SHAPES.CIRC: {
        const c = shape as PIXI.Circle;
        tx = c.x, ty = c.y;
        key.push(snap(c.radius));
        form = formFor(() => new PIXI.Circle(0, 0, snap(c.radius)), fill, line);
        break;
      }
      case PIXI.SHAPES.ELIP: {
        const e = shape as PIXI.Ellipse;
        tx = e.x, ty = e.y;
        key.push(snap(e.width), snap(e.height));
        form = formFor(() => new PIXI.Ellipse(0, 0, snap(e.width), snap(e.height)), fill, line);
        break;
      }
      case PIXI.SHAPES.RECT: {
        const r = shape as PIXI.Rectangle;
        tx = r.x, ty = r.y;
        key.push(snap(r.width), snap(r.height));
        form = formFor(() => new PIXI.Rectangle(0, 0, snap(r.width), snap(r.height)), fill, line);
        break;
      }
      case PIXI.SHAPES.RREC: {
        const r = shape as PIXI.RoundedRectangle;
        tx = r.x, ty = r.y;
        key.push(snap(r.width), snap(r.height), snap(r.radius));
        form = formFor(() => new PIXI.RoundedRectangle(0, 0, snap(r.width), snap(r.height), snap(r.radius)), fill, line);
        break;
      }
      default:
        throw new Error(`RetainedGraphics: shape type ${(shape as PIXI.IShape).type}`);
    }
    this.place(form, line.visible ? line.width : 0, cos, sin, tx, ty);
    return this;
  }

  private place(form: Form, width: number, cos: number, sin: number, tx: number, ty: number) {
    const n = form.points.length / 2;
    if (!n) return;
    const base = this.vertexCount, need = base + n, needIdx = this.indexCount + form.indices.length;
    if (need * 2 > this.positions.length) {
      const size = Math.max(need * 2, this.positions.length * 2);
      const pos = new Float32Array(size);
      pos.set(this.positions.subarray(0, base * 2));
      this.positions = pos;
      const col = new Uint32Array(size / 2);
      col.set(this.colorStore.subarray(0, base));
      this.colorStore = col;
      if (this.anchors) {
        const an = new Float32Array(size);
        an.set(this.anchors.subarray(0, base * 2));
        this.anchors = an;
      }
    }
    if (needIdx > this.indexStore.length) {
      const idx = new Uint32Array(Math.max(needIdx, this.indexStore.length * 2));
      idx.set(this.indexStore.subarray(0, this.indexCount));
      this.indexStore = idx;
    }
    const src = form.points, per = form.perWidth, dw = width - form.width, pos = this.positions, an = this.anchors;
    let minX = this.minX, minY = this.minY, maxX = this.maxX, maxY = this.maxY;
    for (let i = 0, o = base * 2; i < src.length; i += 2, o += 2) {
      let x = src[i], y = src[i + 1];
      if (per) (x += per[i] * dw), (y += per[i + 1] * dw);
      const X = cos * x - sin * y + tx, Y = sin * x + cos * y + ty;
      pos[o] = X;
      pos[o + 1] = Y;
      if (X < minX) minX = X;
      if (X > maxX) maxX = X;
      if (Y < minY) minY = Y;
      if (Y > maxY) maxY = Y;
      if (an) (an[o] = this.ax), (an[o + 1] = this.ay);
    }
    this.minX = minX, this.minY = minY, this.maxX = maxX, this.maxY = maxY;
    this.colorStore.set(form.colors, base);
    const idx = this.indexStore, fi = form.indices;
    for (let i = 0, o = this.indexCount; i < fi.length; i++, o++) idx[o] = fi[i] + base;
    this.vertexCount = need;
    this.indexCount = needIdx;
  }

  override _render(renderer: PIXI.Renderer) {
    this.finishPoly();
    if (!this.indexCount) return;
    this.posBuffer.update(this.positions.subarray(0, this.vertexCount * 2));
    this.colorBuffer.update(this.colorStore.subarray(0, this.vertexCount));
    if (this.anchorBuffer && this.anchors) this.anchorBuffer.update(this.anchors.subarray(0, this.vertexCount * 2));
    this.indexBuffer.update(this.indexStore.subarray(0, this.indexCount));
    renderer.batch.flush();
    program ??= PIXI.Program.from(vertex, fragment, "yage-retained-graphics");
    this.shader ??= new PIXI.Shader(program, { tint: new Float32Array([1, 1, 1, 1]) });
    const shader = this.shader;
    shader.uniforms.translationMatrix = this.transform.worldTransform;
    PIXI.Color.shared.setValue((this as unknown as Internals)._tintColor).premultiply(this.worldAlpha).toArray(shader.uniforms.tint);
    renderer.shader.bind(shader);
    renderer.geometry.bind(this.mesh, shader);
    renderer.state.set((this as unknown as { state: PIXI.State }).state);
    renderer.geometry.draw(PIXI.DRAW_MODES.TRIANGLES, this.indexCount, 0);
  }

  override _calculateBounds() {
    this.finishPoly();
    if (this.vertexCount) (this as unknown as Internals)._bounds.addFrame(this.transform, this.minX, this.minY, this.maxX, this.maxY);
  }

  /** The drawn triangles since the last clear: positions, packed colours, indices (views, valid until the next draw). */
  triangles() {
    this.finishPoly();
    return { positions: this.positions.subarray(0, this.vertexCount * 2), colors: this.colorStore.subarray(0, this.vertexCount), indices: this.indexStore.subarray(0, this.indexCount), anchors: this.anchors?.subarray(0, this.vertexCount * 2) ?? null };
  }

  override destroy(options?: PIXI.IDestroyOptions | boolean) {
    this.mesh.destroy();
    super.destroy(options);
  }
}
