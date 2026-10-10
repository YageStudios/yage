/** Small, deterministic DSP utilities shared by the synthesis primitives. */
export const EPSILON = 0.00001;
export function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`bleep-bloop: ${label} must be finite`);
  return value;
}
export function positive(value: number, label: string): number {
  if (finite(value, label) <= 0) throw new RangeError(`bleep-bloop: ${label} must be positive`);
  return value;
}
export function nonnegative(value: number, label: string): number {
  if (finite(value, label) < 0) throw new RangeError(`bleep-bloop: ${label} cannot be negative`);
  return value;
}
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
/** Mulberry32. Seeds are explicit; playback never changes global Math.random. */
export function randomSource(seed?: number): () => number {
  if (seed === undefined) return () => Math.random();
  let state = finite(seed, "seed") >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
