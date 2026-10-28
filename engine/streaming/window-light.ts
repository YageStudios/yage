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
 * Built in a wall's frame lying on the ground: x along the wall, y out from its foot (0 at the
 * wall), z (heights) up from the ground. Draw it added (BLEND_MODES.ADD); the mesh's tint and
 * alpha scale it.
 */
import * as PIXI from "pixi.js";

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
};

const vertex = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec4 aOpening;
attribute vec2 aLamp;
attribute vec4 aLight;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vPos;
varying vec4 vOpening;
varying vec2 vLamp;
varying vec4 vLight;

void main() {
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
uniform vec4 uColor;

const float PI = 3.14159265;

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
  float soft = 0.35 + 2.5 * p.y / (p.y + depth);
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
  float light = vLight.a * (0.55 * min(direct, 1.5) + 2.2 * glow);
  gl_FragColor = vec4(vLight.rgb * light, 0.0) * uColor;
}
`;

/** How far out (and to the sides) of an opening its light is drawn, in openings' heights. */
const REACH = 3.5;

/** The ground quads for a wall's lit windows; share it between every wall drawn alike. */
export const windowLightGeometry = (lights: WindowLight[]) => {
  const pos: number[] = [], opening: number[] = [], lamp: number[] = [], light: number[] = [], index: number[] = [];
  lights.forEach((l, q) => {
    const reach = Math.max(8, (l.lampHeight + l.lampDepth) * REACH * 0.5);
    const r = ((l.colour >> 16) & 255) / 255, g = ((l.colour >> 8) & 255) / 255, b = (l.colour & 255) / 255;
    for (const [x, y] of [[l.x0 - reach, 0], [l.x1 + reach, 0], [l.x1 + reach, reach], [l.x0 - reach, reach]]) {
      pos.push(x, y);
      opening.push(l.x0, l.x1, l.z0, l.z1);
      lamp.push(l.lampDepth, l.lampHeight);
      light.push(r, g, b, l.strength);
    }
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  });
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", pos, 2, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aOpening", opening, 4, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aLamp", lamp, 2, false, GL_FLOAT as PIXI.TYPES)
    .addAttribute("aLight", light, 4, false, GL_FLOAT as PIXI.TYPES)
    .addIndex(index);
};

let program: PIXI.Program | null = null;

/** A wall's window light, from its shared geometry: tint and alpha it as the scene's light needs. */
export const windowLightMesh = (geometry: PIXI.Geometry) => {
  program ??= PIXI.Program.from(vertex, fragment, "window-light");
  const mesh = new PIXI.Mesh(geometry, new PIXI.MeshMaterial(PIXI.Texture.WHITE, { program }));
  mesh.blendMode = PIXI.BLEND_MODES.ADD;
  return mesh;
};
