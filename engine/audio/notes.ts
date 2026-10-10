import { positive } from "./dsp";
const SEMITONES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export type Frequency = number | string;

export function noteToFreq(n: Frequency): number {
  if (typeof n === "number") return positive(n, "frequency");
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(String(n).trim());
  if (!m) {
    throw new Error(`bleep-bloop: bad note "${n}" (expected e.g. "C4", "F#3", "Bb5")`);
  }
  const semi = SEMITONES[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
  return positive(440 * Math.pow(2, (midi - 69) / 12), "frequency");
}

export const hz = noteToFreq;
