/** Pure palette helpers for instanced chunk layers (no GPU imports, so they test in node). */

export const MAX_PALETTE = 32;

export const paletteArray = (palette: number[]) => {
  const values = new Float32Array(MAX_PALETTE * 3);
  palette.slice(0, MAX_PALETTE).forEach((color, i) => {
    values[i * 3] = ((color >> 16) & 255) / 255;
    values[i * 3 + 1] = ((color >> 8) & 255) / 255;
    values[i * 3 + 2] = (color & 255) / 255;
  });
  return values;
};

/** The palette indices a tint byte selects under `fields` (what the shader computes). */
export const tintIndices = (tint: number, fields: [number, number, number]): [number, number, number] => {
  const a = tint % fields[0];
  const b = Math.floor(tint / fields[0]) % fields[1];
  const c = Math.floor(tint / (fields[0] * fields[1]));
  return [a, fields[0] + b, fields[0] + fields[1] + c];
};

/** At most this many glow ranges per layer, and ramp colours across all of them. */
export const MAX_GLOWS = 4;
export const MAX_GLOW_RAMP = 16;

/**
 * One glowing group of sprites, [from, to) sprite indices. `color` is one colour or a ramp (e.g.
 * green → yellow → red as an infected host nears death); `stage` says which ramp entry a sprite
 * shows: by its offset in the range (floor((sprite - from) / stride)), or by its tint byte
 * (floor(tint / tintDivisor) % ramp length). `pulse` (0–1) throbs the last ramp stage (or the whole
 * range with one colour); `scale` widens the halo (e.g. a stronger ring round the player's host).
 */
export type GlowRange = {
  from: number;
  to: number;
  color: number | number[];
  alpha: number;
  stage?: { stride: number } | { tintDivisor: number };
  pulse?: number;
  scale?: number;
};

const rampOf = (range: GlowRange) => (Array.isArray(range.color) ? range.color : [range.color]);

/** The packed uniforms the glow shader reads (see layer.ts). */
export const glowUniforms = (ranges: GlowRange[]) => {
  const bounds = new Float32Array(MAX_GLOWS * 4);
  const shape = new Float32Array(MAX_GLOWS * 4);
  const ramp = new Float32Array(MAX_GLOW_RAMP * 3);
  let next = 0;
  ranges.slice(0, MAX_GLOWS).forEach((range, i) => {
    const colors = rampOf(range).slice(0, MAX_GLOW_RAMP - next);
    const stage = range.stage;
    const stride = stage && "stride" in stage ? stage.stride : 0;
    const divisor = stage && "tintDivisor" in stage ? stage.tintDivisor : 0;
    bounds.set([range.from, range.to, stride, divisor], i * 4);
    shape.set([range.alpha, range.scale ?? 1, Math.max(1, colors.length), next + (range.pulse ?? 0) * 0.5], i * 4);
    ramp.set(paletteArray(colors).subarray(0, colors.length * 3), next * 3);
    next += colors.length;
  });
  return { bounds, shape, ramp };
};

/** Which glow (range index, ramp stage) a sprite and tint get, or null: what the shader computes. */
export const glowOf = (ranges: GlowRange[], sprite: number, tint: number) => {
  for (let i = Math.min(ranges.length, MAX_GLOWS) - 1; i >= 0; i--) {
    const range = ranges[i];
    if (sprite < range.from || sprite >= range.to) continue;
    const stages = rampOf(range).length;
    const stage = range.stage;
    let k = 0;
    if (stage && "stride" in stage && stage.stride > 0) k = Math.floor((sprite - range.from) / stage.stride);
    else if (stage && "tintDivisor" in stage && stage.tintDivisor > 0) k = Math.floor(tint / stage.tintDivisor) % stages;
    return { range: i, stage: Math.min(Math.max(k, 0), stages - 1) };
  }
  return null;
};
