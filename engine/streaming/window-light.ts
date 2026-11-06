/**
 * Light out of lit windows onto the ground, worked out per pixel: a projected light. Each window
 * is an opening in a wall standing on the ground, with a lamp in the room behind it; a ground
 * point is lit if the ray from the lamp to it passes through the opening (so the pool on the
 * ground is the opening's own shape, cast out and stretched away from the wall), falling off
 * with the square of the distance and the cosine of the light's angle onto the ground. On top, the
 * opening's own glow as a diffuse area light (Lambert's polygon form factor), which softens the
 * pool near the wall. A blind is a smaller opening: one let nearly down leaves a slit at the sill
 * that throws a thin strip of light just out from the wall.
 *
 * A sign glowing on the wall (neon) is the same opening with no lamp through it: only its glow.
 *
 * Built in a wall's frame lying on the ground: x along the wall, y out from its foot (0 at the
 * wall), z (heights) up from the ground. Light is light, not paint: the meshes are not drawn into
 * the scene but added into a light buffer (`LightPass`, the screen's light, drawn before the ground),
 * which a surface's shader adds to its own ambient light before multiplying its colour by it:
 * colour × (ambient + light), each light's colour multiplying the ground's. Its alpha scales it.
 */
import * as PIXI from "pixi.js";
import { FramePrint } from "./frame-print";

const GL_FLOAT = 5126;

/** One lit opening: x0..x1 along the wall, z0..z1 up from the ground (its open part), and its lamp. */
export type WindowLight = {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** How far behind the wall the lamp hangs, and how high. */
  lampDepth: number;
  lampHeight: number;
  colour: number;
  /** 1 a plain lit room; less through a blind or a dim lamp. */
  strength: number;
  /** How much of the lamp's light comes through the opening (1), and how much the opening glows itself (1): a neon sign is all glow. */
  direct?: number;
  glow?: number;
};

const vertex = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec4 aOpening;
attribute vec2 aLamp;
attribute vec4 aLight;
attribute vec2 aMix;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vPos;
varying vec4 vOpening;
varying vec2 vLamp;
varying vec4 vLight;
varying vec2 vMix;

void main() {
  vMix = aMix;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aVertexPosition;
  vOpening = aOpening;
  vLamp = aLamp;
  vLight = aLight;
}
`;

const fragment = `
precision highp float;
varying vec2 vPos;
varying vec4 vOpening;
varying vec2 vLamp;
varying vec4 vLight;
varying vec2 vMix;
uniform float uAlpha;

const float PI = 3.14159265;
// A lamp's pool at the wall's foot: a warm room light, under daylight but plain against the night.
const float GAIN = 0.85;

// The form factor of an edge of a polygon light seen from a point facing straight up.
float edge(vec3 a, vec3 b) {
  vec3 c = cross(a, b);
  float l = length(c);
  return l < 1e-5 ? 0.0 : acos(clamp(dot(a, b), -1.0, 1.0)) * c.z / l;
}

void main() {
  float x0 = vOpening.x, x1 = vOpening.y, z0 = vOpening.z, z1 = vOpening.w;
  float depth = vLamp.x, height = vLamp.y;
  vec3 p = vec3(vPos.x, max(vPos.y, 0.0), 0.0);
  vec3 lamp = vec3((x0 + x1) * 0.5, -depth, height);
  // Where the lamp's ray to this point crosses the wall, and whether that is inside the opening:
  // softened by the lamp's size, more the further out the point is.
  float t = depth / (p.y + depth);
  vec2 hit = vec2(lamp.x + (p.x - lamp.x) * t, height * (1.0 - t));
  // A lampshade, not a bulb: wide soft edges that widen further out.
  float soft = 1.2 + 7.0 * p.y / (p.y + depth);
  float across = smoothstep(x0 - soft, x0 + soft, hit.x) * (1.0 - smoothstep(x1 - soft, x1 + soft, hit.x));
  float up = smoothstep(z0 - soft, z0 + soft, hit.y) * (1.0 - smoothstep(z1 - soft, z1 + soft, hit.y));
  vec3 toLamp = lamp - p;
  float r2 = dot(toLamp, toLamp);
  // Inverse square and the cosine onto the ground, 1 at the wall's foot below the lamp.
  float r0 = sqrt(depth * depth + height * height);
  float direct = across * up * (height / sqrt(r2)) / r2 * (r0 * r0 * r0 / height);
  // The opening itself glowing: the polygon's form factor from this point.
  vec3 a = normalize(vec3(x0, 0.0, z0) - p), b = normalize(vec3(x1, 0.0, z0) - p);
  vec3 c = normalize(vec3(x1, 0.0, z1) - p), d = normalize(vec3(x0, 0.0, z1) - p);
  float glow = abs(edge(a, b) + edge(b, c) + edge(c, d) + edge(d, a)) / (2.0 * PI);
  // Soft and never blinding: a lit room warms the pavement, it doesn't floodlight it.
  float light = min(vLight.a * (vMix.x * 0.7 * min(direct, 1.4) + vMix.y * 5.0 * glow) * GAIN, 0.8) * uAlpha;
  // Added into the light buffer.
  gl_FragColor = vec4(vLight.rgb * light, 0.0);
}
`;

/** How far out (and to the sides) of an opening its light is drawn, in openings' heights. */
const REACH = 5;

/** The ground quads for a wall's lit windows; share it between every wall drawn alike. */
export const windowLightGeometry = (lights: WindowLight[]) => {
  const pos: number[] = [], opening: number[] = [], lamp: number[] = [], light: number[] = [], mix: number[] = [], index: number[] = [];
  lights.forEach((l, q) => {
    const reach = Math.max(8, (l.lampHeight + l.lampDepth) * REACH * 0.5);
    const r = ((l.colour >> 16) & 255) / 255, g = ((l.colour >> 8) & 255) / 255, b = (l.colour & 255) / 255;
    for (const [x, y] of [[l.x0 - reach, 0], [l.x1 + reach, 0], [l.x1 + reach, reach], [l.x0 - reach, reach]]) {
      pos.push(x, y);
      opening.push(l.x0, l.x1, l.z0, l.z1);
      lamp.push(l.lampDepth, l.lampHeight);
      light.push(r, g, b, l.strength);
      mix.push(l.direct ?? 1, l.glow ?? 1);
    }
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  });
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", pos, 2, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aOpening", opening, 4, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aLamp", lamp, 2, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aLight", light, 4, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aMix", mix, 2, false, GL_FLOAT as PIXI.TYPES)
    .addIndex(index);
};

let program: PIXI.Program | null = null;
/** Every light; `lit` says whether it would add anything now, `drawLit` adds it (only once lit). */
const lights = new Set<{ lit(): boolean; drawLit(renderer: PIXI.Renderer): void }>();

/** A wall's window light, from its shared geometry; its alpha (with its parents') scales the light. */
export class WindowLightMesh extends PIXI.Mesh<PIXI.Shader> {
  constructor(geometry: PIXI.Geometry) {
    program ??= PIXI.Program.from(vertex, fragment, "window-light");
    super(geometry, new PIXI.Shader(program, { uAlpha: 1 }));
    this.blendMode = PIXI.BLEND_MODES.ADD;
    lights.add(this);
    this.on("destroyed", () => lights.delete(this));
  }

  /** Not drawn into the scene: `LightPass` adds it into the light buffer. */
  render() {}

  lit() {
    // A wall with none lit holds an empty geometry (windowLightGeometry([])), to be given one later.
    return this.worldAlpha > 0.01 && this.worldVisible && !!this.geometry.indexBuffer?.data.length;
  }

  drawLit(renderer: PIXI.Renderer) {
    this.shader.uniforms.uAlpha = this.worldAlpha;
    this._render(renderer);
  }

  draw(renderer: PIXI.Renderer) {
    if (this.lit()) this.drawLit(renderer);
  }
}

/** A lamp on a post: its head `height` over the ground at x, y, lighting out to `radius` (world units). */
export type LampLight = {
  x: number;
  y: number;
  height: number;
  radius: number;
  colour: number;
  /** 1 a plain street lamp. */
  strength: number;
};

const lampVertex = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec4 aLamp;
attribute vec4 aLight;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vPos;
varying vec4 vLamp;
varying vec4 vLight;

void main() {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aVertexPosition;
  vLamp = aLamp;
  vLight = aLight;
}
`;

const lampFragment = `
precision highp float;
varying vec2 vPos;
varying vec4 vLamp;
varying vec4 vLight;
uniform float uAlpha;

// Under the head: a lamp lights its pavement well, under daylight but over a lit room's pool.
const float GAIN = 0.95;

void main() {
  float d = distance(vPos, vLamp.xy);
  float h = vLamp.z, radius = vLamp.w;
  // Inverse square and the cosine onto the ground: (h / r)^3, 1 straight under the head.
  float k = h / sqrt(d * d + h * h);
  float direct = k * k * k;
  // Light the lamp throws about (its glass, the walls, the air): a wide faint skirt.
  float skirt = 1.0 - d / radius;
  float light = (direct + 0.12 * skirt * skirt) * smoothstep(radius, radius * 0.6, d);
  gl_FragColor = vec4(vLight.rgb * min(vLight.a * light * GAIN, 1.1) * uAlpha, 0.0);
}
`;

/** The ground quads for a set of lamps (one chunk's, say), in the units they are placed in. */
export const lampLightGeometry = (lamps: LampLight[]) => {
  const pos: number[] = [], lamp: number[] = [], light: number[] = [], index: number[] = [];
  lamps.forEach((l, q) => {
    const r = ((l.colour >> 16) & 255) / 255, g = ((l.colour >> 8) & 255) / 255, b = (l.colour & 255) / 255;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(l.x + x * l.radius, l.y + y * l.radius);
      lamp.push(l.x, l.y, l.height, l.radius);
      light.push(r, g, b, l.strength);
    }
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  });
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", pos, 2, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aLamp", lamp, 4, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aLight", light, 4, false, GL_FLOAT as PIXI.TYPES)
    .addIndex(index);
};

let lampProgram: PIXI.Program | null = null;

/**
 * Lamps' light, from their geometry; its alpha (with its parents') times `level.value` scales it.
 * Share one `level` between every lamp to turn them all up at dusk at once.
 */
export class LampLightMesh extends PIXI.Mesh<PIXI.Shader> {
  constructor(geometry: PIXI.Geometry, readonly level: { value: number } = { value: 1 }) {
    lampProgram ??= PIXI.Program.from(lampVertex, lampFragment, "lamp-light");
    super(geometry, new PIXI.Shader(lampProgram, { uAlpha: 1 }));
    this.blendMode = PIXI.BLEND_MODES.ADD;
    lights.add(this);
    this.on("destroyed", () => lights.delete(this));
  }

  /** Not drawn into the scene: `LightPass` adds it into the light buffer. */
  render() {}

  lit() {
    return this.worldAlpha * this.level.value > 0.01 && this.worldVisible;
  }

  drawLit(renderer: PIXI.Renderer) {
    this.shader.uniforms.uAlpha = this.worldAlpha * this.level.value;
    this._render(renderer);
  }

  draw(renderer: PIXI.Renderer) {
    if (this.lit()) this.drawLit(renderer);
  }
}

/** The screen's light (rgb added to a surface's ambient), redrawn every frame by `LightPass`. */
let buffer: PIXI.RenderTexture | null = null;
let uniforms: PIXI.UniformGroup | null = null;
/**
 * What a lit surface's shader samples: `uLights` at the fragment's place on screen,
 * `texture2D(uLights, vec2(gl_FragCoord.x, uLightScreen.y - gl_FragCoord.y) / uLightScreen).rgb`.
 * Add it to the shader's uniforms as a group.
 */
export const lightUniforms = () => {
  buffer ??= PIXI.RenderTexture.create({ width: 1, height: 1 });
  return (uniforms ??= PIXI.UniformGroup.from({ uLights: buffer, uLightScreen: new Float32Array([1, 1]) }));
};

/** The light buffer holds nothing (cleared with no light lit since its last resize): an unlit frame needn't clear it again. */
let bufferClear = false;

/** How much finer the screen is than the light buffer: light is soft, so a coarse buffer does. */
const COARSE = 2;

/**
 * A batch's shaders: a light's own, its place given in the pass's parent's space (from the batch's
 * origin, `aRoot`) and its alpha a vertex's (`aAlpha`), so a frame's lights of a kind add in one draw.
 */
const batchedVertex = (source: string) =>
  source
    .replace("attribute vec2 aVertexPosition;", "attribute vec2 aVertexPosition;\nattribute vec2 aRoot;\nattribute float aAlpha;\nvarying float vAlpha;")
    .replace("void main() {", "void main() {\n  vAlpha = aAlpha;")
    .replace("translationMatrix * vec3(aVertexPosition, 1.0)", "translationMatrix * vec3(aRoot, 1.0)");
const batchedFragment = (source: string) => source.replace("uniform float uAlpha;", "varying float vAlpha;\n#define uAlpha vAlpha");

type Light = WindowLightMesh | LampLightMesh;
/** A light's attributes as the batch copies them: a float buffer each, packed. */
const WINDOW_ATTRIBUTES: [string, number][] = [["aVertexPosition", 2], ["aOpening", 4], ["aLamp", 2], ["aLight", 4], ["aMix", 2]];
const LAMP_ATTRIBUTES: [string, number][] = [["aVertexPosition", 2], ["aLamp", 4], ["aLight", 4]];

/** Its float attribute's packed data, or null (laid out otherwise: drawn by itself). */
const packed = (geometry: PIXI.Geometry, name: string, size: number) => {
  const attribute = geometry.getAttribute(name);
  if (!attribute || attribute.size !== size || attribute.stride || attribute.start || attribute.instance) return null;
  const data = geometry.buffers[attribute.buffer].data;
  return data instanceof Float32Array ? data : null;
};

/**
 * Every lit light of a kind under the pass's parent, merged into one mesh: rebuilt when which are
 * lit, their geometry or their place under the parent changes, its alphas rewritten when theirs
 * change. A camera moving moves the parent only: the batch stands, drawn through the parent's transform.
 */
class LightBatch {
  readonly mesh: PIXI.Mesh<PIXI.Shader>;
  private readonly members: Light[] = [];
  private readonly alphas: number[] = [];
  /** Each member's first vertex and count, in the batch. */
  private readonly spans: number[] = [];
  private alphaData = new Float32Array(0);
  private readonly print = new FramePrint();
  /** The batch's origin under the parent (its first light's place), so its positions stay small. */
  private readonly origin = new PIXI.Matrix();
  /** The batch drew something different from last frame (rebuilt or alpha changed). */
  changed = false;

  constructor(
    program: PIXI.Program,
    private readonly attributes: [string, number][],
  ) {
    const geometry = new PIXI.Geometry().addAttribute("aRoot", new Float32Array(0), 2, false, GL_FLOAT as PIXI.TYPES).addAttribute("aAlpha", new Float32Array(0), 1, false, GL_FLOAT as PIXI.TYPES);
    for (const [name, size] of attributes) geometry.addAttribute(name, new Float32Array(0), size, false, GL_FLOAT as PIXI.TYPES);
    geometry.addIndex(new Uint32Array(0));
    this.mesh = new PIXI.Mesh(geometry, new PIXI.Shader(program));
    this.mesh.blendMode = PIXI.BLEND_MODES.ADD;
  }

  /** Whether this light can go in the batch (its attributes packed floats, its index plain). */
  takes(light: Light) {
    const geometry = light.geometry;
    if (light.blendMode !== PIXI.BLEND_MODES.ADD || light.drawMode !== PIXI.DRAW_MODES.TRIANGLES || light.start || light.size || geometry.instanceCount > 1) return false;
    if (!geometry.indexBuffer) return false;
    for (const [name, size] of this.attributes) if (!packed(geometry, name, size)) return false;
    return true;
  }

  begin() {
    this.members.length = 0;
    this.alphas.length = 0;
    this.print.begin();
  }

  /** A lit light, `alpha` its light's scale this frame; its place under `root` printed (what each step is and its local id). */
  add(light: Light, alpha: number, root: PIXI.Container) {
    const print = this.print;
    print.ref(light);
    const geometry = light.geometry;
    print.ref(geometry);
    for (const buffer of geometry.buffers) {
      print.ref(buffer);
      print.num((buffer as unknown as { _updateID: number })._updateID);
    }
    for (let o: PIXI.DisplayObject | null = light; o && o !== root; o = o.parent) {
      print.ref(o);
      print.num((o.transform as unknown as { _localID: number })._localID);
    }
    this.members.push(light);
    this.alphas.push(alpha);
  }

  /** Brings the mesh up to this frame's lights; false with none. */
  end(root: PIXI.Container) {
    this.changed = false;
    if (!this.print.end()) {
      this.build(root);
      this.changed = true;
    } else
      for (let i = 0; i < this.members.length; i++) {
        const alpha = this.alphas[i];
        if (this.alphaData[this.spans[2 * i]] === Math.fround(alpha)) continue;
        this.alphaData.fill(alpha, this.spans[2 * i], this.spans[2 * i] + this.spans[2 * i + 1]);
        this.changed = true;
      }
    if (this.changed) this.mesh.geometry.getBuffer("aAlpha").update(this.alphaData);
    return this.members.length > 0;
  }

  private build(root: PIXI.Container) {
    const members = this.members;
    let vertices = 0, indices = 0;
    for (const light of members) {
      vertices += packed(light.geometry, "aVertexPosition", 2)!.length / 2;
      indices += light.geometry.indexBuffer.data.length;
    }
    const geometry = this.mesh.geometry;
    const rootData = new Float32Array(vertices * 2);
    const alphaData = new Float32Array(vertices);
    const data = this.attributes.map(([, size]) => new Float32Array(vertices * size));
    const index = new Uint32Array(indices);
    this.spans.length = 0;
    const local = new PIXI.Matrix();
    let v = 0, k = 0;
    members.forEach((light, m) => {
      // Its place under the root, from the local transforms between (the camera's above the root: not in it).
      local.copyFrom(light.localTransform);
      for (let o = light.parent; o && o !== root; o = o.parent) local.prepend(o.localTransform);
      if (m === 0) this.origin.set(1, 0, 0, 1, local.tx, local.ty);
      const ox = this.origin.tx, oy = this.origin.ty;
      const g = light.geometry;
      const pos = packed(g, "aVertexPosition", 2)!;
      const count = pos.length / 2;
      for (let i = 0; i < count; i++) {
        const x = pos[2 * i], y = pos[2 * i + 1];
        rootData[2 * (v + i)] = local.a * x + local.c * y + local.tx - ox;
        rootData[2 * (v + i) + 1] = local.b * x + local.d * y + local.ty - oy;
      }
      alphaData.fill(this.alphas[m], v, v + count);
      this.attributes.forEach(([name, size], a) => data[a].set(packed(g, name, size)!.subarray(0, count * size), v * size));
      const source = g.indexBuffer.data as ArrayLike<number>;
      for (let i = 0; i < source.length; i++) index[k + i] = source[i] + v;
      this.spans.push(v, count);
      v += count;
      k += source.length;
    });
    geometry.getBuffer("aRoot").update(rootData);
    this.attributes.forEach(([name], a) => geometry.getBuffer(name).update(data[a]));
    geometry.getIndex().update(index);
    this.alphaData = alphaData;
  }

  draw(renderer: PIXI.Renderer, root: PIXI.Container) {
    // Drawn where the root is now, from the batch's origin.
    this.mesh.transform.worldTransform.copyFrom(root.worldTransform).append(this.origin);
    (this.mesh as unknown as { _render(renderer: PIXI.Renderer): void })._render(renderer);
  }
}

let windowBatchProgram: PIXI.Program | null = null;
let lampBatchProgram: PIXI.Program | null = null;
/** The LightPass that drew the shared buffer last, and whether it is to be drawn afresh. */
let drewLast: LightPass | null = null;

/**
 * Draws every window and lamp light in view into the light buffer. Add it to the camera's tree before the
 * surfaces that sample it (ChunkScene does, under its ground); the tree's transforms are already
 * this frame's when it draws, so the lights are where the camera puts them now.
 *
 * The lights under its parent are drawn a batch a kind; any other on its own. A frame drawing the
 * same as the last, through the same camera, keeps the buffer as it is.
 */
export class LightPass extends PIXI.Container {
  private windows: LightBatch | null = null;
  private lamps: LightBatch | null = null;
  private readonly alone: { drawLit(renderer: PIXI.Renderer): void }[] = [];
  private readonly camera = new FramePrint();
  /** Frames the buffer was drawn and kept. */
  readonly drawn = { drawn: 0, kept: 0 };

  render(renderer: PIXI.Renderer) {
    const { width, height } = renderer.screen;
    const group = lightUniforms();
    const buffer = group.uniforms.uLights as PIXI.RenderTexture;
    const screen = group.uniforms.uLightScreen as Float32Array;
    if (screen[0] !== renderer.view.width || screen[1] !== renderer.view.height) {
      screen[0] = renderer.view.width;
      screen[1] = renderer.view.height;
      group.update();
    }
    const fine = Math.max(1e-3, renderer.resolution / COARSE);
    if (buffer.width !== width || buffer.height !== height || buffer.baseTexture.resolution !== fine) {
      buffer.setResolution(fine);
      buffer.resize(width, height);
      bufferClear = false;
      drewLast = null;
    }
    const root = this.parent;
    windowBatchProgram ??= PIXI.Program.from(batchedVertex(vertex), batchedFragment(fragment), "window-light-batch");
    lampBatchProgram ??= PIXI.Program.from(batchedVertex(lampVertex), batchedFragment(lampFragment), "lamp-light-batch");
    const windows = (this.windows ??= new LightBatch(windowBatchProgram, WINDOW_ATTRIBUTES));
    const lamps = (this.lamps ??= new LightBatch(lampBatchProgram, LAMP_ATTRIBUTES));
    const alone = this.alone;
    alone.length = 0;
    windows.begin();
    lamps.begin();
    let any = false;
    for (const light of lights) {
      if (!light.lit()) continue;
      any = true;
      const batch = light instanceof WindowLightMesh ? windows : light instanceof LampLightMesh ? lamps : null;
      const mesh = light as Light;
      if (!batch || !root || !under(mesh, root) || !batch.takes(mesh)) {
        alone.push(light);
        continue;
      }
      batch.add(mesh, mesh instanceof LampLightMesh ? mesh.worldAlpha * mesh.level.value : mesh.worldAlpha, root);
    }
    const drawWindows = windows.end(root);
    const drawLamps = lamps.end(root);
    // Daylight, or no light in view: one clear, then nothing until a light shows.
    if (!any && bufferClear) return;
    const still = this.still(renderer, root) && drewLast === this && !alone.length && !windows.changed && !lamps.changed;
    drewLast = this;
    if (still && any) {
      this.drawn.kept++;
      return;
    }
    this.drawn.drawn++;
    renderInto(renderer, buffer, [0, 0, 0, 0], () => {
      if (drawWindows) windows.draw(renderer, root);
      if (drawLamps) lamps.draw(renderer, root);
      for (const light of alone) light.drawLit(renderer);
    });
    bufferClear = !any;
  }

  /** Whether the camera, the target and the root's place on screen are as last frame. */
  private still(renderer: PIXI.Renderer, root: PIXI.Container) {
    const print = this.camera;
    print.begin();
    const target = renderer.renderTexture;
    print.ref(target.current);
    for (const rect of [target.sourceFrame, target.destinationFrame, renderer.screen]) {
      print.num(rect.x);
      print.num(rect.y);
      print.num(rect.width);
      print.num(rect.height);
    }
    print.num(renderer.view.width);
    print.num(renderer.view.height);
    print.num(renderer.resolution);
    for (const m of [renderer.projection.projectionMatrix, renderer.projection.transform, root.worldTransform]) {
      if (!m) {
        print.ref(null);
        continue;
      }
      print.num(m.a);
      print.num(m.b);
      print.num(m.c);
      print.num(m.d);
      print.num(m.tx);
      print.num(m.ty);
    }
    return print.end();
  }
}

const under = (light: PIXI.DisplayObject, root: PIXI.Container) => {
  for (let o = light.parent; o; o = o.parent) if (o === root) return true;
  return false;
};

/**
 * Draws into a screen-sized `buffer` what `draw` draws, where the camera puts it now, and goes back
 * to the screen as it was. A camera may sit in the projection (ProjectedCamera): what it adds to the
 * target's own is carried into the buffer's (a Pixi filter would drop it for what draws after).
 * `frame` (the screen's px, default the screen) is the part of the screen the buffer takes.
 * `flip` draws it upside down, as the screen is: clip y (a sprite's depth) runs as it does there.
 */
export const renderInto = (renderer: PIXI.Renderer, buffer: PIXI.RenderTexture, clear: [number, number, number, number], draw: () => void, frame?: PIXI.Rectangle, flip = false) => {
  renderer.batch.flush();
  const target = renderer.renderTexture;
  const projection = renderer.projection;
  const was = target.current ?? undefined;
  const source = target.sourceFrame.clone();
  const destination = target.destinationFrame.clone();
  const camera = projection.projectionMatrix.clone();
  target.bind(was, source, destination);
  const view = projection.projectionMatrix.clone().invert().append(camera);
  target.bind(buffer, frame ? new PIXI.Rectangle(source.x + frame.x, source.y + frame.y, frame.width, frame.height) : source);
  projection.projectionMatrix.append(view);
  if (flip) projection.projectionMatrix.prepend(FLIP);
  sync(renderer);
  target.clear(clear);
  draw();
  renderer.batch.flush();
  target.bind(was, source, destination);
  projection.projectionMatrix.copyFrom(camera);
  sync(renderer);
};

const FLIP = new PIXI.Matrix(1, 0, 0, -1, 0, 0);

const sync = (renderer: PIXI.Renderer) => {
  renderer.globalUniforms.update();
  const bound = renderer.shader.shader;
  if (bound) renderer.shader.syncUniformGroup(bound.uniforms.globals);
};
