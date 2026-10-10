/** "Feel" primitives: research-derived building blocks for satisfying, crunchy sounds.
 * See docs/satisfying-sound-research.md for the evidence behind each rule.
 *
 *   snap       — ≤ 3 ms broadband/4 kHz contact transient (definition, "click")
 *   punch      — 63–250 Hz weight with a 0–2 ms onset (Fenton: onset > 20 ms loses punch)
 *   crunch     — stochastic fracture bursts with decaying successive amplitudes (food acoustic emission)
 *   thock      — dense, low, cavity-damped knock with highs trapped (keyboard acoustics)
 *   bubble     — radius-driven resonant bubble with an upward glide (Minnaert / van den Doel)
 *   impact     — snap + punch + material body + fracture debris + tail, the full hit stack
 */
import { clamp } from "../dsp";
import type { GameAudio } from "../engine";
import type { Voice } from "../voice";
import type { MaterialVoice } from "../types";

export interface SnapOptions { peak?: number; freq?: number; dur?: number; pan?: number }
/** Contact transient. Short, bright and immediate; carries the "this registered" information. */
export function snap(v: Voice, t: number, o: SnapOptions = {}): void {
  const peak = o.peak ?? 0.35, f = o.freq ?? 4000, dur = clamp(o.dur ?? 0.004, 0.001, 0.012);
  v.noise(t, { color: "white", type: "bp", freq: f, Q: 0.9, dur, peak, attack: 0.0003, pan: o.pan });
  v.noise(t, { color: "white", type: "hp", freq: Math.max(6000, f * 1.6), dur: dur * 0.6, peak: peak * 0.35, attack: 0.0002, pan: o.pan });
}

export interface PunchOptions { weight?: number; freq?: number; peak?: number; pan?: number }
/** Low-frequency weight: pitch-dropping sine + band-limited thump with a near-zero onset. weight 0..1 scales length and depth. */
export function punch(v: Voice, t: number, o: PunchOptions = {}): void {
  const w = clamp(o.weight ?? 0.5, 0, 1), f = o.freq ?? 55 + (1 - w) * 45, peak = o.peak ?? 0.55;
  const dur = 0.08 + w * 0.22;
  v.tone(t, { f: f * 2.4, f2: f, dur, peak, type: "sine", attack: 0.0015, pan: o.pan, freqs: [{ f: f * 2.4, at: 0 }, { f: f * 1.15, at: Math.min(0.03, dur * 0.3) }, { f, at: dur }] });
  v.noise(t, { color: "brown", type: "lp", freq: 260, freq2: 90, dur: dur * 0.6, peak: peak * 0.45, attack: 0.001, pan: o.pan });
}

export interface CrunchOptions {
  /** Spread of the fracture train, seconds. */
  dur: number;
  /** Number of fracture events (crisp ≈ many, crunchy ≈ fewer). */
  events: number;
  /** Spectral centre of the bursts: crisp ≥ 4 kHz, crunchy ≈ 1–2 kHz. */
  centroid: number;
  /** Octaves of random centroid spread. */
  spread?: number;
  /** Amplitude ratio between successive bursts (< 1 = decaying, as measured in chewing). */
  decay?: number;
  /** Burst length, seconds. Crisp ≈ 1–3 ms, crunchy ≈ 3–8 ms. */
  grain?: number;
  peak?: number;
  /** 13–14 kHz "air" sparkle that reads as fresh/crisp (0 disables). */
  air?: number;
  /** Clustering 0..1: events arrive in layer-by-layer groups (cellular structure) instead of uniformly. */
  cluster?: number;
  pan?: number;
  width?: number;
}
/** Fracture train: irregular, clustered, decaying micro-impulses — the acoustic signature of crispness. */
export function crunch(v: Voice, t: number, o: CrunchOptions): void {
  const n = Math.max(1, Math.round(o.events)), spread = o.spread ?? 1, decay = o.decay ?? 0.93, grain = o.grain ?? 0.003;
  const cluster = clamp(o.cluster ?? 0.5, 0, 1), width = o.width ?? 0.35, peak = o.peak ?? 0.3;
  // Onset times: a few cell layers (clusters), each a quick burst; earlier layers fail under higher load.
  const layers = Math.max(1, Math.round(1 + cluster * 4));
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / n * layers), base = layer / layers * o.dur, span = o.dur / layers * (1 - cluster * 0.7);
    times.push(base + Math.pow(v.random(), 1.6) * span);
  }
  times.sort((a, b) => a - b);
  times.forEach((at, i) => {
    const a = peak * Math.pow(decay, i) * v.random(0.45, 1);
    const f = clamp(o.centroid * Math.pow(2, v.random(-spread / 2, spread / 2)) * v.brightness, 200, 16000);
    const pan = (o.pan ?? 0) + v.random(-width, width);
    v.noise(t + at, { color: "white", type: "bp", freq: f, Q: v.random(0.9, 2.6), dur: grain * v.random(0.6, 1.7), peak: a, attack: 0.0002, pan });
    if (o.air && v.random() < 0.45) v.noise(t + at, { color: "white", type: "hp", freq: 11500, dur: grain * 0.5, peak: a * o.air, attack: 0.0002, pan });
  });
}

export interface ThockOptions { freq?: number; peak?: number; pan?: number; bright?: number }
/** Mechanical-keyboard "thock": dense low-mid knock, damped cavity, highs trapped. bright 0 = thock … 1 = clack. */
export function thock(v: Voice, t: number, o: ThockOptions = {}): void {
  const f = o.freq ?? 170, peak = o.peak ?? 0.4, b = clamp(o.bright ?? 0, 0, 1);
  v.tone(t, { f: f * 1.8, f2: f, dur: 0.045, peak: peak * 0.8, type: "sine", attack: 0.0008, pan: o.pan });
  v.resonate(t, { f: f * 2.05, dur: 0.06, peak: peak * 0.5, material: "wood", modes: [1, 2.31, 3.9], strike: 0.6, width: 0.1, pan: o.pan });
  v.noise(t, { color: "pink", type: "lp", freq: 900 + b * 4000, dur: 0.018, peak: peak * (0.35 + b * 0.25), attack: 0.0004, pan: o.pan });
  if (b > 0) v.resonate(t + 0.001, { f: 2600 + b * 1400, dur: 0.03, peak: peak * b * 0.35, material: "ceramic", modes: [1, 1.7], width: 0.1, pan: o.pan });
  // Bottom-out then top-out: the return stroke is softer and slightly higher.
  v.tone(t + 0.075, { f: f * 1.35, f2: f * 1.1, dur: 0.025, peak: peak * 0.18, type: "sine", pan: o.pan });
}

export interface BubbleOptions { radius?: number; peak?: number; rise?: number; pan?: number; decay?: number }
/** Resonant bubble: frequency from radius (Minnaert, f ≈ 3.26 / r[m]) with the upward glide of a bubble nearing the surface. radius in mm. */
export function bubble(v: Voice, t: number, o: BubbleOptions = {}): void {
  const r = clamp(o.radius ?? 2, 0.4, 20) / 1000, f0 = clamp(3.26 / r, 120, 9000);
  const dur = o.decay ?? clamp(0.02 + 18 / f0, 0.025, 0.25), rise = o.rise ?? 0.35;
  v.tone(t, { f: f0, f2: f0 * (1 + rise), dur, peak: o.peak ?? 0.3, type: "sine", attack: 0.001, pan: o.pan, glide: "exp" });
}

export interface ImpactOptions {
  /** 0..1 overall heft: scales punch depth, body length, debris count and tail. */
  weight?: number;
  material?: MaterialVoice;
  /** Body resonance frequency. */
  freq?: number;
  /** Fracture debris amount 0..1 (0 for clean hits). */
  debris?: number;
  peak?: number;
  pan?: number;
}
/** The full hit stack (research: transient + body + weight within ~100 ms). */
export function impact(v: Voice, t: number, o: ImpactOptions = {}): void {
  const w = clamp(o.weight ?? 0.5, 0, 1), peak = o.peak ?? 0.5, mat = o.material ?? "wood";
  snap(v, t, { peak: peak * (0.4 + w * 0.3), freq: 3500 + (1 - w) * 1500, pan: o.pan });
  punch(v, t, { weight: w, peak: peak * (0.6 + w * 0.5), pan: o.pan });
  v.resonate(t + 0.001, { f: o.freq ?? 240 - w * 120, dur: 0.08 + w * 0.3, peak: peak * 0.45, material: mat, strike: 0.6, width: 0.3, pan: o.pan });
  if ((o.debris ?? 0) > 0) crunch(v, t + 0.004, { dur: 0.05 + w * 0.15, events: Math.round(6 + (o.debris ?? 0) * 22), centroid: 2400, spread: 1.4, decay: 0.9, grain: 0.004, peak: peak * 0.35 * (o.debris ?? 0), cluster: 0.6, pan: o.pan, width: 0.5 });
}

/** "Audio hit-stop": a 40–150 ms dip of other buses on a heavy impact, so the hit lands in space (and silence makes the return hit harder). */
export function impactDuck(audio: GameAudio, strength = 1, buses: readonly string[] = ["music", "ambient"]): void {
  const s = clamp(strength, 0, 1);
  for (const b of buses) audio.bus(b).duck(3 + 9 * s, 0.04 + 0.11 * s, 0.004, 0.18 + 0.25 * s);
}
