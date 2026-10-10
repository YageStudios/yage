/** Short musical cues that are composed in whatever key the score is in. */
import type { Voice } from "../voice";
import { INSTRUMENTS, KITS, riser, type InstrumentName } from "./instruments";
import { SCALES, degreeToMidi, type Key } from "./theory";

export interface StingerContext { key: Key; bpm: number }
type Stinger = { description: string; /** Loudness trim. */ gain?: number; play: (v: Voice, t: number, c: StingerContext) => number };

const note = (v: Voice, inst: InstrumentName, midi: number, time: number, dur: number, vel = 0.8, pan = 0) => INSTRUMENTS[inst](v, { midi, time, dur, vel, pan });
const isMajor = (k: Key) => (SCALES[k.scale] as readonly number[]).includes(4);
/** Tonic triad (major or minor by the key's scale) rooted near `base`. */
const tonic = (k: Key, base: number) => { const r = base + ((k.tonic - base) % 12 + 12) % 12; return [r, r + (isMajor(k) ? 4 : 3), r + 7]; };
const chord = (v: Voice, inst: InstrumentName, notes: number[], time: number, dur: number, vel = 0.75) => notes.forEach((m, i) => note(v, inst, m, time + i * 0.006, dur, vel, (i - (notes.length - 1) / 2) * 0.25));

export const STINGERS = {
  victory: { gain: 0.79, description: "Brass fanfare up the tonic arpeggio, timpani roll and a held major chord.", play: (v, t, c) => {
    const b = 60 / Math.max(90, c.bpm) / 2, r = tonic({ ...c.key, scale: "major" }, 55);
    [r[0], r[1], r[2], r[0] + 12].forEach((m, i) => note(v, "lead.horn", m + 12, t + i * b, i === 3 ? b * 6 : b * 0.85, 0.85));
    chord(v, "pad.brass", [r[0], r[1], r[2], r[0] + 12], t + 3 * b, b * 6, 0.85);
    chord(v, "pad.strings", [r[0] - 12, r[2] - 12, r[1], r[0] + 12], t + 3 * b, b * 7, 0.7);
    for (let i = 0; i < 6; i++) KITS.orchestral.timpani(v, t + 3 * b - 0.4 + i * 0.065, 0.3 + i * 0.08);
    KITS.orchestral.crash(v, t + 3 * b, 0.8); KITS.orchestral.kick(v, t + 3 * b, 0.9);
    return 3 * b + b * 7 + 1;
  } },
  defeat: { gain: 1.57, description: "Descending minor line on low strings over a dark held chord.", play: (v, t, c) => {
    const k: Key = { ...c.key, scale: "minor" }, b = 60 / Math.min(90, c.bpm);
    [4, 3, 2, 1, 0].forEach((d, i) => note(v, "bass.cello", degreeToMidi(k, d, 48), t + i * b * 0.75, b * 0.8, 0.7));
    chord(v, "pad.dark", tonic(k, 48), t + 3.75 * b, b * 4, 0.8);
    KITS.orchestral.timpani(v, t + 3.75 * b, 0.6);
    return 3.75 * b + b * 4 + 1.5;
  } },
  discovery: { gain: 2.09, description: "Lydian harp sweep and celesta sparkle resolving to a bright chord.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "lydian" };
    for (let i = 0; i < 10; i++) note(v, "pluck.harp", degreeToMidi(k, i, 60), t + i * 0.055, 1.2, 0.5 + i * 0.03, (i / 9 - 0.5) * 0.8);
    [0, 2, 4, 6, 7].forEach((d, i) => note(v, "mallet.celesta", degreeToMidi(k, d + 7, 60), t + 0.6 + i * 0.09, 0.6, 0.55));
    chord(v, "pad.glass", [degreeToMidi(k, 0, 48), degreeToMidi(k, 3, 60), degreeToMidi(k, 4, 60), degreeToMidi(k, 6, 60)], t + 0.55, 2.2, 0.7);
    return 3.6;
  } },
  danger: { gain: 0.82, description: "Low brass cluster stab with taiko hit and a rising string tremolo.", play: (v, t, c) => {
    const r = 36 + ((c.key.tonic - 36) % 12 + 12) % 12;
    KITS.orchestral.taiko(v, t, 1); KITS.orchestral.boom(v, t, 0.8);
    chord(v, "brass.stab", [r + 12, r + 13, r + 18, r + 19], t, 0.5, 0.95);
    for (let i = 0; i < 12; i++) note(v, "strings.stab", r + 24 + Math.floor(i / 4), t + 0.5 + i * 0.07, 0.07, 0.4 + i * 0.04);
    return 2.6;
  } },
  item: { gain: 3.09, description: "Bright two-octave bell arpeggio — a classic pickup jingle.", play: (v, t, c) => {
    const r = tonic({ ...c.key, scale: "major" }, 72);
    [r[0], r[1], r[2], r[0] + 12, r[1] + 12].forEach((m, i) => note(v, "mallet.glock", m, t + i * 0.07, 0.4, 0.75));
    note(v, "lead.bell", r[0] + 12, t + 0.35, 0.8, 0.6);
    return 1.8;
  } },
  levelup: { gain: 1.93, description: "Rising scale run into a sustained chord with sparkle.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "major" };
    for (let i = 0; i < 8; i++) note(v, "pluck.synth", degreeToMidi(k, i, 60), t + i * 0.06, 0.12, 0.7);
    chord(v, "pad.synth", tonic(k, 60).concat(degreeToMidi(k, 7, 60)), t + 0.48, 1.3, 0.85);
    note(v, "lead.supersaw", degreeToMidi(k, 7, 60) + 12, t + 0.48, 1, 0.75);
    riser(v, t, 0.48, 0.35);
    return 2.6;
  } },
  secret: { gain: 2.88, description: "Whole-tone celesta shimmer ascending into air.", play: (v, t, c) => {
    for (let i = 0; i < 9; i++) note(v, "mallet.celesta", 72 + c.key.tonic % 12 + i * 2, t + i * 0.075, 0.5, 0.6 - i * 0.02, (i % 2 ? 0.3 : -0.3));
    note(v, "pad.glass", 84 + c.key.tonic % 12, t + 0.5, 1.6, 0.5);
    return 2.8;
  } },
  quest: { gain: 1.19, description: "Warm IV–V–I cadence on strings and horn.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "major" }, b = 60 / Math.max(80, c.bpm) * 1.2;
    const voice = (d: number) => [degreeToMidi(k, d, 48), degreeToMidi(k, d + 2, 60), degreeToMidi(k, d + 4, 60)];
    chord(v, "pad.strings", voice(3), t, b, 0.7); chord(v, "pad.strings", voice(4), t + b, b, 0.75); chord(v, "pad.strings", voice(0).concat(degreeToMidi(k, 7, 60)), t + 2 * b, b * 3, 0.85);
    [5, 6, 7].forEach((d, i) => note(v, "lead.horn", degreeToMidi(k, d, 60), t + i * b, i === 2 ? b * 3 : b * 0.95, 0.75));
    KITS.orchestral.timpani(v, t + 2 * b, 0.6);
    return 5 * b + 1;
  } },
  "boss-intro": { gain: 0.97, description: "Three heavy hits and a choir swell — the gates open.", play: (v, t, c) => {
    const r = 36 + ((c.key.tonic - 36) % 12 + 12) % 12;
    [0, 0.45, 0.9].forEach((at, i) => { KITS.orchestral.taiko(v, t + at, 0.9 + i * 0.05); KITS.orchestral.boom(v, t + at, 0.6); chord(v, "brass.stab", [r + 12, r + 15, r + 19], t + at, 0.3, 0.9); });
    chord(v, "pad.choir", [r + 24, r + 27, r + 31, r + 36], t + 1.35, 2.4, 0.9);
    KITS.orchestral.crash(v, t + 1.35, 0.9);
    return 4.5;
  } },
  checkpoint: { gain: 1.97, description: "Soft two-note chime with a pad bloom.", play: (v, t, c) => {
    const r = tonic({ ...c.key, scale: "major" }, 72);
    note(v, "mallet.vibes", r[2], t, 0.6, 0.7); note(v, "mallet.vibes", r[0] + 12, t + 0.16, 1.2, 0.75);
    chord(v, "pad.warm", tonic({ ...c.key, scale: "major" }, 60), t + 0.1, 1.4, 0.55);
    return 2.4;
  } },
  death: { gain: 3.0, description: "Detuned descending chip voice and a hollow thud.", play: (v, t, c) => {
    const r = 60 + ((c.key.tonic - 60) % 12 + 12) % 12;
    [12, 11, 7, 6, 3, 0, -1, -5].forEach((d, i) => note(v, "lead.chip", r + d, t + i * 0.09, 0.08, 0.7));
    KITS.chip.kick(v, t + 0.75, 0.9);
    return 1.6;
  } },
  award: { gain: 0.97, description: "Annual award: timpani roll into a brass fanfare on I–IV–V–I with cymbal and bells.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "major" }, b = 60 / 100 / 2, tri = (d: number, base: number) => [degreeToMidi(k, d, base), degreeToMidi(k, d + 2, base), degreeToMidi(k, d + 4, base)];
    for (let i = 0; i < 10; i++) KITS.orchestral.timpani(v, t + i * 0.06, 0.25 + i * 0.05);
    [0, 3, 4, 0].forEach((d, i) => chord(v, "pad.brass", tri(d, 55).concat(i === 3 ? [degreeToMidi(k, 7, 55)] : []), t + 0.6 + i * b * 2, i === 3 ? b * 8 : b * 1.8, 0.85));
    [4, 5, 6, 7].forEach((d, i) => note(v, "lead.horn", degreeToMidi(k, d, 67), t + 0.6 + i * b * 2, i === 3 ? b * 8 : b * 1.8, 0.85));
    KITS.orchestral.crash(v, t + 0.6 + 3 * b * 2, 0.9); [0, 4, 7, 12].forEach((s, i) => note(v, "mallet.glock", degreeToMidi(k, 0, 84) + s, t + 0.6 + 3 * b * 2 + i * 0.08, 0.6, 0.6));
    return 0.6 + 3 * b * 2 + b * 8 + 1;
  } },
  bankrupt: { gain: 1.29, description: "Game over / bankruptcy: deflating tuba-ish slide, minor chord, a final thud.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "minor" }, r = degreeToMidi(k, 0, 48);
    [r + 7, r + 6, r + 5, r + 3].forEach((n, i) => note(v, "bass.cello", n, t + i * 0.45, 0.42, 0.8));
    chord(v, "pad.dark", [r, r + 3, r + 7, r + 12], t + 1.8, 2.4, 0.8); KITS.orchestral.boom(v, t + 1.8, 0.7);
    return 4.6;
  } },
  milestone: { gain: 2.03, description: "Milestone reached: quick rising arpeggio, sparkle and a bright chord.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "major" };
    [0, 2, 4, 7].forEach((d, i) => note(v, "pluck.harp", degreeToMidi(k, d, 67), t + i * 0.07, 0.6, 0.75, (i - 1.5) * 0.2));
    chord(v, "pad.glass", tonic(k, 67).concat(degreeToMidi(k, 7, 67)), t + 0.28, 1.4, 0.8);
    [0, 4, 7, 12, 16].forEach((s, i) => note(v, "mallet.celesta", degreeToMidi(k, 0, 84) + s, t + 0.3 + i * 0.05, 0.4, 0.55));
    return 2.4;
  } },
  contract: { gain: 1.1, description: "Deal signed: two warm chords and a confident low note.", play: (v, t, c) => {
    const k: Key = { tonic: c.key.tonic, scale: "major" };
    chord(v, "keys.epiano", [degreeToMidi(k, 3, 55), degreeToMidi(k, 5, 55), degreeToMidi(k, 7, 55), degreeToMidi(k, 9, 55)], t, 0.5, 0.8);
    chord(v, "keys.epiano", [degreeToMidi(k, 0, 55), degreeToMidi(k, 2, 60), degreeToMidi(k, 4, 60), degreeToMidi(k, 6, 60)], t + 0.35, 1.2, 0.85);
    note(v, "bass.upright", degreeToMidi(k, 0, 36), t + 0.35, 1, 0.9);
    return 2;
  } },
} satisfies Record<string, Stinger>;
export type StingerName = keyof typeof STINGERS;
export const STINGER_NAMES = Object.keys(STINGERS) as StingerName[];
