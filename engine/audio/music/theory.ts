/** Scales, keys, chromatic roman-numeral chords and voice leading. Pure functions. */

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  hungarianMinor: [0, 2, 3, 6, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
} as const satisfies Record<string, readonly number[]>;
export type ScaleName = keyof typeof SCALES;

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  scale: ScaleName;
}

/** "D minor", "F# dorian", "Bb", "eb harmonicMinor". */
export function parseKey(text: string): Key {
  const m = /^\s*([a-gA-G])([#b]?)\s*([A-Za-z]*)\s*$/.exec(text);
  if (!m) throw new Error(`bleep-bloop: bad key "${text}"`);
  const tonic = (PC[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  const scale = (m[3] || "major") as ScaleName;
  if (!(scale in SCALES)) throw new Error(`bleep-bloop: unknown scale "${m[3]}"`);
  return { tonic, scale };
}
export const keyName = (k: Key): string => `${NAMES[k.tonic]} ${k.scale}`;
export const pitchName = (midi: number): string => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** MIDI note for a (possibly negative or > 7) scale degree, 0-based, in a given octave of the tonic. */
export function degreeToMidi(key: Key, degree: number, baseMidi = 60): number {
  const s = SCALES[key.scale], n = s.length;
  const oct = Math.floor(degree / n), idx = ((degree % n) + n) % n;
  return baseMidi + key.tonic + oct * 12 + s[idx];
}
/** Snap a MIDI note to the nearest scale tone (ties resolve downward). */
export function snapToScale(key: Key, midi: number): number {
  const s = SCALES[key.scale] as readonly number[];
  for (let d = 0; d < 7; d++) for (const sign of [-1, 1]) {
    const m = midi + sign * d, pc = ((m - key.tonic) % 12 + 12) % 12;
    if (s.includes(pc)) return m;
  }
  return midi;
}
/** Scale-step neighbor: move `steps` scale degrees from a note that is in (or near) the scale. */
export function stepInScale(key: Key, midi: number, steps: number): number {
  const s = SCALES[key.scale] as readonly number[], n = s.length;
  const snapped = snapToScale(key, midi), rel = snapped - key.tonic;
  const oct = Math.floor(rel / 12), pc = ((rel % 12) + 12) % 12;
  const idx = s.indexOf(pc) + steps;
  return key.tonic + (oct + Math.floor(idx / n)) * 12 + s[((idx % n) + n) % n];
}

export interface Chord {
  /** Semitones of the chord root above the key tonic. */
  root: number;
  /** Intervals above the root, ascending, starting with 0. */
  intervals: number[];
  symbol: string;
}

const ROMAN: Record<string, number> = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };

/** Chromatic roman numerals relative to the key's tonic, independent of mode:
 *  uppercase = major, lowercase = minor, `°`/`dim` diminished, `+` augmented; prefixes `b`/`#`;
 *  suffixes 7, maj7, 9, add9, sus2, sus4, 6, 5 (power chord). e.g. "i", "bVI", "V7", "ivadd9", "bIImaj7", "I5".
 */
export function parseChord(symbol: string): Chord {
  const m = /^([b#]?)([ivIV]+)(°|dim|\+)?(maj7|maj9|7|9|add9|sus2|sus4|6|5|m7b5)?$/.exec(symbol.trim());
  if (!m || !(m[2].toLowerCase() in ROMAN)) throw new Error(`bleep-bloop: bad chord "${symbol}"`);
  const upper = m[2] === m[2].toUpperCase();
  const root = (ROMAN[m[2].toLowerCase()] + (m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0) + 12) % 12;
  let third = upper ? 4 : 3, fifth = 7;
  if (m[3] === "°" || m[3] === "dim" || m[4] === "m7b5") { third = 3; fifth = 6; }
  if (m[3] === "+") { third = 4; fifth = 8; }
  let intervals = [0, third, fifth];
  switch (m[4]) {
    case "7": intervals.push(m[3] === "°" || m[3] === "dim" ? 9 : 10); break;
    case "m7b5": intervals.push(10); break;
    case "maj7": intervals.push(11); break;
    case "maj9": intervals.push(11, 14); break;
    case "9": intervals.push(10, 14); break;
    case "add9": intervals.push(14); break;
    case "6": intervals.push(9); break;
    case "sus2": intervals = [0, 2, fifth]; break;
    case "sus4": intervals = [0, 5, fifth]; break;
    case "5": intervals = [0, 7]; break;
  }
  return { root, intervals, symbol };
}

/** Pitch classes (absolute, 0-11) for a chord in a key. */
export function chordPitchClasses(key: Key, chord: Chord): number[] {
  return chord.intervals.map(i => (key.tonic + chord.root + i) % 12);
}
/** Root MIDI note of a chord nearest to `around`. */
export function chordRoot(key: Key, chord: Chord, around = 40): number {
  const pc = (key.tonic + chord.root) % 12;
  let m = around - (((around - pc) % 12) + 12) % 12;
  if (around - m > 6) m += 12;
  return m;
}

/** Voice a chord inside [low, high] with minimal total motion from `previous` (smooth voice leading). */
export function voiceChord(key: Key, chord: Chord, o: { low?: number; high?: number; previous?: number[]; voices?: number } = {}): number[] {
  const low = o.low ?? 52, high = o.high ?? 76, pcs = chordPitchClasses(key, chord);
  const want = Math.max(pcs.length, o.voices ?? pcs.length);
  // Candidate voicings: each inversion stacked upward from every start note in range.
  const candidates: number[][] = [];
  for (let start = low; start < low + 12; start++) {
    if (!pcs.includes(((start % 12) + 12) % 12)) continue;
    const rot = pcs.indexOf(((start % 12) + 12) % 12);
    const notes: number[] = [start];
    for (let i = 1; i < want; i++) {
      const pc = pcs[(rot + i) % pcs.length];
      let n = notes[notes.length - 1] + 1;
      while (((n % 12) + 12) % 12 !== pc) n++;
      notes.push(n);
    }
    if (notes[notes.length - 1] <= high + 2) candidates.push(notes);
  }
  if (!candidates.length) return pcs.map(pc => low + ((pc - low) % 12 + 12) % 12).sort((a, b) => a - b);
  const prev = o.previous;
  if (!prev?.length) {
    const center = (low + high) / 2;
    return candidates.sort((a, b) => Math.abs(mean(a) - center) - Math.abs(mean(b) - center))[0];
  }
  const cost = (c: number[]) => c.reduce((sum, n) => sum + Math.min(...prev.map(p => Math.abs(p - n))), 0) + Math.abs(mean(c) - mean(prev)) * 0.5;
  return candidates.sort((a, b) => cost(a) - cost(b))[0];
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Parse a progression string: bars separated by spaces, half-bar splits with "/": "i bVI/bVII i V". */
export function parseProgression(text: string): Chord[][] {
  return text.trim().split(/\s+/).map(bar => bar.split("/").map(parseChord));
}
