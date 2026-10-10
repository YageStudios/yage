/** Synthesized instruments for the music system. Every instrument schedules sample-accurate
 * Web Audio graphs on a Voice; nothing is sampled or downloaded.
 */
import { clamp } from "../dsp";
import type { Voice } from "../voice";
import { midiToHz } from "./theory";

export interface NoteEvent {
  midi: number;
  /** Audio-context start time. */
  time: number;
  /** Gate length in seconds (release is added by the instrument). */
  dur: number;
  /** Velocity 0..1. */
  vel: number;
  pan?: number;
}
export type Instrument = (v: Voice, e: NoteEvent) => void;

type Wave = OscillatorType | "pulse25" | "pulse12";
interface SynthPatch {
  osc: ReadonlyArray<{ wave: Wave; detune?: number; octave?: number; level?: number }>;
  /** Oscillators per osc entry, spread in cents across the stereo field. */
  unison?: number;
  spread?: number;
  width?: number;
  amp: { a: number; d: number; s: number; r: number };
  filter?: { type?: BiquadFilterType; cutoff: number; env?: number; decay?: number; Q?: number; keytrack?: number; velocity?: number };
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Breath/chiff noise at the attack. */
  chiff?: { level: number; freq: number; decay: number; Q?: number };
  level: number;
}

type Ctx = AudioContext | OfflineAudioContext;
const pulses = new WeakMap<Ctx, Map<number, PeriodicWave>>();
function pulseWave(ctx: Ctx, duty: number): PeriodicWave {
  let c = pulses.get(ctx); if (!c) { c = new Map(); pulses.set(ctx, c); }
  const hit = c.get(duty); if (hit) return hit;
  const n = 48, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) re[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * duty);
  const w = ctx.createPeriodicWave(re, im); c.set(duty, w); return w;
}

/** ADSR amplitude with an anchored release; returns the time the voice is silent. */
function adsr(param: AudioParam, t: number, gate: number, peak: number, a: number, d: number, s: number, r: number): number {
  const attack = Math.max(0.002, Math.min(a, gate * 0.9 + 0.002));
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  const sustain = Math.max(1e-4, peak * s);
  const decayTau = Math.max(0.003, d / 3);
  param.setTargetAtTime(sustain, t + attack, decayTau);
  const release = Math.max(0.01, r), off = t + Math.max(gate, attack + 0.001);
  // Value the decay reached at gate time; anchors the release ramp.
  const atGate = sustain + (peak - sustain) * Math.exp(-(off - t - attack) / decayTau);
  param.setValueAtTime(Math.max(1e-4, atGate), off);
  param.exponentialRampToValueAtTime(1e-4, off + release);
  param.linearRampToValueAtTime(0, off + release + 0.005);
  return off + release + 0.005;
}

function synth(v: Voice, e: NoteEvent, p: SynthPatch): void {
  if (v._stopped) return;
  const ctx = v.ctx, t = Math.max(e.time, v.now()), f = midiToHz(e.midi) * v.pitch, nyquist = ctx.sampleRate * 0.45;
  const vel = clamp(e.vel, 0, 1), amp = ctx.createGain(), out = ctx.createStereoPanner();
  out.pan.value = clamp(e.pan ?? 0, -1, 1);
  let head: AudioNode = amp;
  const nodes: AudioNode[] = [amp, out];
  if (p.filter) {
    const fl = ctx.createBiquadFilter(), fo = p.filter;
    fl.type = fo.type ?? "lowpass"; fl.Q.value = fo.Q ?? 0.7;
    const track = Math.pow(f / 261.6, fo.keytrack ?? 0.5);
    const base = clamp(fo.cutoff * track * v.brightness, 40, nyquist);
    const peak = clamp(base + (fo.env ?? 0) * track * v.brightness * (1 - (fo.velocity ?? 0.5) + (fo.velocity ?? 0.5) * vel), 40, nyquist);
    fl.frequency.setValueAtTime(base, t);
    if (peak !== base) {
      fl.frequency.exponentialRampToValueAtTime(peak, t + Math.max(0.003, p.amp.a * 0.7));
      fl.frequency.setTargetAtTime(base, t + Math.max(0.003, p.amp.a * 0.7), Math.max(0.005, (fo.decay ?? 0.3) / 3));
    }
    fl.connect(amp); head = fl; nodes.push(fl);
  }
  amp.connect(out); out.connect(v.dest);
  const end = adsr(amp.gain, t, e.dur, p.level * (0.35 + 0.65 * vel), p.amp.a, p.amp.d, p.amp.s, p.amp.r);
  const unison = Math.max(1, p.unison ?? 1), count = p.osc.length * unison;
  let vib: GainNode | undefined;
  if (p.vibrato) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = p.vibrato.rate * (1 + v.random(-0.05, 0.05));
    const delay = p.vibrato.delay ?? 0.2;
    depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(p.vibrato.depth * v.motion, t + delay + 0.25);
    lfo.connect(depth); v.own(lfo, depth); lfo.start(t); lfo.stop(end + 0.01); vib = depth;
  }
  for (const o of p.osc) for (let u = 0; u < unison; u++) {
    const osc = ctx.createOscillator(), g = ctx.createGain(), pos = unison === 1 ? 0 : u / (unison - 1) * 2 - 1;
    if (o.wave === "pulse25" || o.wave === "pulse12") osc.setPeriodicWave(pulseWave(ctx, o.wave === "pulse25" ? 0.25 : 0.125));
    else osc.type = o.wave;
    osc.frequency.value = clamp(f * Math.pow(2, o.octave ?? 0), 8, nyquist);
    osc.detune.value = (o.detune ?? 0) + pos * (p.spread ?? 0) + v.random(-2, 2);
    g.gain.value = (o.level ?? 1) / Math.sqrt(count);
    let into: AudioNode = head;
    if (p.width && unison > 1) {
      const sp = ctx.createStereoPanner(); sp.pan.value = pos * p.width; sp.connect(head); into = sp; v.own(osc, g, sp);
    } else v.own(osc, g);
    osc.connect(g); g.connect(into);
    if (vib) vib.connect(osc.detune);
    osc.start(t); osc.stop(end + 0.01);
  }
  if (p.chiff) {
    const b = ctx.createBufferSource(), bf = ctx.createBiquadFilter(), bg = ctx.createGain();
    b.buffer = v.engine.noiseBuffer("pink"); bf.type = "bandpass"; bf.frequency.value = clamp(p.chiff.freq, 100, nyquist); bf.Q.value = p.chiff.Q ?? 1.2;
    bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(p.chiff.level * vel, t + 0.006);
    bg.gain.exponentialRampToValueAtTime(1e-4, t + p.chiff.decay); bg.gain.linearRampToValueAtTime(0, t + p.chiff.decay + 0.005);
    b.connect(bf); bf.connect(bg); bg.connect(out); v.own(b, bf, bg); b.start(t, v.random(0, 2)); b.stop(t + p.chiff.decay + 0.01);
  }
  v.own(keepAlive(ctx, out, t, end), amp, out, ...nodes);
  v._track(end + 0.02);
}
/** A silent source whose `onended` releases a shared node chain once every partial has finished. */
function keepAlive(ctx: Ctx, into: AudioNode, t: number, end: number): AudioScheduledSourceNode {
  const k = ctx.createConstantSource(); k.offset.value = 0; k.connect(into); k.start(t); k.stop(end + 0.02); return k;
}

function noiseHit(v: Voice, t: number, o: { color?: "white" | "pink" | "brown"; type?: BiquadFilterType; freq: number; freqEnd?: number; Q?: number; dur: number; peak: number; attack?: number; pan?: number; hold?: number }): number {
  const ctx = v.ctx, b = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
  b.buffer = v.engine.noiseBuffer(o.color ?? "white"); b.loop = true;
  f.type = o.type ?? "highpass"; f.Q.value = o.Q ?? 0.7;
  const ny = ctx.sampleRate * 0.45;
  f.frequency.setValueAtTime(clamp(o.freq * v.brightness, 20, ny), t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(clamp(o.freqEnd * v.brightness, 20, ny), t + o.dur);
  const a = o.attack ?? 0.001, hold = o.hold ?? 0;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.peak, t + a);
  if (hold) g.gain.setValueAtTime(o.peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(1e-4, t + o.dur); g.gain.linearRampToValueAtTime(0, t + o.dur + 0.004);
  p.pan.value = clamp(o.pan ?? 0, -1, 1);
  b.connect(f); f.connect(g); g.connect(p); p.connect(v.dest); v.own(b, f, g, p);
  b.start(t, v.random(0, 3)); b.stop(t + o.dur + 0.01); v._track(t + o.dur + 0.02);
  return t + o.dur;
}
function pitchDrop(v: Voice, t: number, o: { f0: number; f1: number; f2?: number; drop: number; dur: number; peak: number; wave?: OscillatorType; pan?: number; attack?: number }): number {
  const ctx = v.ctx, osc = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
  osc.type = o.wave ?? "sine";
  osc.frequency.setValueAtTime(o.f0 * v.pitch, t);
  osc.frequency.exponentialRampToValueAtTime(o.f1 * v.pitch, t + o.drop);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2 * v.pitch, t + o.dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.peak, t + (o.attack ?? 0.0015));
  g.gain.exponentialRampToValueAtTime(1e-4, t + o.dur); g.gain.linearRampToValueAtTime(0, t + o.dur + 0.004);
  p.pan.value = o.pan ?? 0;
  osc.connect(g); g.connect(p); p.connect(v.dest); v.own(osc, g, p); osc.start(t); osc.stop(t + o.dur + 0.01); v._track(t + o.dur + 0.02);
  return t + o.dur;
}
/** TR-style metal: six square partials through a band-pass and high-pass. */
function metal(v: Voice, t: number, dur: number, peak: number, base = 1, pan = 0): void {
  const ctx = v.ctx, bp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
  bp.type = "bandpass"; bp.frequency.value = clamp(10000 * v.brightness, 2000, ctx.sampleRate * 0.45); bp.Q.value = 0.9;
  hp.type = "highpass"; hp.frequency.value = 7000;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.001);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.004);
  p.pan.value = pan;
  bp.connect(hp); hp.connect(g); g.connect(p); p.connect(v.dest);
  const k = keepAlive(ctx, g, t, t + dur); v.own(k, bp, hp, g, p);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f * base * 1.7;
    o.connect(bp); v.own(o); o.start(t); o.stop(t + dur + 0.01);
  }
  v._track(t + dur + 0.02);
}

// ---------------------------------------------------------------------------
// Drum kits
// ---------------------------------------------------------------------------

export type DrumVoice = "kick" | "snare" | "clap" | "hat" | "openhat" | "ride" | "crash" | "tomLow" | "tomMid" | "tomHigh" | "shaker" | "rim" | "taiko" | "timpani" | "cymbalSwell" | "boom";
export type DrumKit = Record<DrumVoice, (v: Voice, t: number, vel: number) => void>;

const common = (over: Partial<DrumKit>): DrumKit => ({
  kick: (v, t, x) => { pitchDrop(v, t, { f0: 160, f1: 55, f2: 44, drop: 0.07, dur: 0.38, peak: 0.95 * x }); noiseHit(v, t, { freq: 2500, dur: 0.012, peak: 0.25 * x }); },
  snare: (v, t, x) => { pitchDrop(v, t, { f0: 240, f1: 185, drop: 0.05, dur: 0.12, peak: 0.42 * x, wave: "triangle" }); noiseHit(v, t, { type: "bandpass", freq: 4200, Q: 0.6, dur: 0.2, peak: 0.55 * x }); noiseHit(v, t, { freq: 7000, dur: 0.09, peak: 0.18 * x }); },
  clap: (v, t, x) => { [0, 0.01, 0.021].forEach(d => noiseHit(v, t + d, { type: "bandpass", freq: 1400, Q: 1.1, dur: 0.02, peak: 0.5 * x, color: "pink" })); noiseHit(v, t + 0.03, { type: "bandpass", freq: 1500, Q: 0.8, dur: 0.18, peak: 0.45 * x, color: "pink" }); },
  hat: (v, t, x) => { metal(v, t, 0.045, 0.3 * x, 1, 0.18); noiseHit(v, t, { freq: 8000, dur: 0.035, peak: 0.17 * x, pan: 0.18 }); },
  openhat: (v, t, x) => { metal(v, t, 0.32, 0.22 * x, 1, 0.18); noiseHit(v, t, { freq: 7500, dur: 0.3, peak: 0.14 * x, pan: 0.18 }); },
  ride: (v, t, x) => { metal(v, t, 0.9, 0.08 * x, 0.7, -0.25); pitchDrop(v, t, { f0: 3250, f1: 3200, drop: 0.3, dur: 0.7, peak: 0.04 * x, pan: -0.25 }); },
  crash: (v, t, x) => { metal(v, t, 1.8, 0.14 * x, 0.85, -0.3); noiseHit(v, t, { freq: 4500, freqEnd: 7000, dur: 1.9, peak: 0.24 * x, pan: -0.2 }); },
  tomLow: (v, t, x) => { pitchDrop(v, t, { f0: 150, f1: 95, f2: 88, drop: 0.08, dur: 0.45, peak: 0.6 * x, pan: 0.2 }); noiseHit(v, t, { type: "bandpass", freq: 900, dur: 0.05, peak: 0.12 * x }); },
  tomMid: (v, t, x) => { pitchDrop(v, t, { f0: 210, f1: 135, f2: 126, drop: 0.07, dur: 0.38, peak: 0.55 * x }); noiseHit(v, t, { type: "bandpass", freq: 1200, dur: 0.05, peak: 0.12 * x }); },
  tomHigh: (v, t, x) => { pitchDrop(v, t, { f0: 290, f1: 190, f2: 180, drop: 0.06, dur: 0.32, peak: 0.5 * x, pan: -0.2 }); noiseHit(v, t, { type: "bandpass", freq: 1500, dur: 0.05, peak: 0.12 * x }); },
  shaker: (v, t, x) => noiseHit(v, t, { type: "bandpass", freq: 6500, Q: 1.2, dur: 0.07, peak: 0.28 * x, attack: 0.012, pan: -0.3 }),
  rim: (v, t, x) => { pitchDrop(v, t, { f0: 1700, f1: 1650, drop: 0.02, dur: 0.03, peak: 0.25 * x, wave: "square" }); noiseHit(v, t, { type: "bandpass", freq: 3200, Q: 2, dur: 0.02, peak: 0.25 * x }); },
  taiko: (v, t, x) => { pitchDrop(v, t, { f0: 120, f1: 68, f2: 58, drop: 0.09, dur: 0.95, peak: 0.95 * x }); noiseHit(v, t, { type: "lowpass", color: "brown", freq: 500, freqEnd: 120, dur: 0.5, peak: 0.7 * x }); noiseHit(v, t, { type: "bandpass", freq: 1500, dur: 0.03, peak: 0.25 * x }); },
  timpani: (v, t, x) => { pitchDrop(v, t, { f0: 98, f1: 87, f2: 86, drop: 0.08, dur: 1.6, peak: 0.6 * x }); pitchDrop(v, t, { f0: 152, f1: 140, drop: 0.08, dur: 0.9, peak: 0.16 * x }); noiseHit(v, t, { type: "lowpass", color: "pink", freq: 700, dur: 0.12, peak: 0.25 * x }); },
  cymbalSwell: (v, t, x) => { noiseHit(v, t, { freq: 3500, freqEnd: 9000, dur: 1.6, peak: 0.16 * x, attack: 1.45, color: "white" }); metal(v, t + 1.45, 0.4, 0.06 * x); },
  boom: (v, t, x) => { pitchDrop(v, t, { f0: 90, f1: 38, f2: 30, drop: 0.25, dur: 2.2, peak: 0.95 * x }); noiseHit(v, t, { type: "lowpass", color: "brown", freq: 900, freqEnd: 60, dur: 1.4, peak: 0.6 * x }); noiseHit(v, t, { freq: 3000, dur: 0.05, peak: 0.25 * x }); },
  ...over,
});

export const KITS = {
  acoustic: common({}),
  electronic: common({
    kick: (v, t, x) => { pitchDrop(v, t, { f0: 190, f1: 52, f2: 45, drop: 0.055, dur: 0.42, peak: 0.85 * x }); noiseHit(v, t, { type: "bandpass", freq: 3200, Q: 1, dur: 0.008, peak: 0.35 * x }); },
    snare: (v, t, x) => { pitchDrop(v, t, { f0: 260, f1: 190, drop: 0.04, dur: 0.1, peak: 0.4 * x, wave: "triangle" }); noiseHit(v, t, { type: "bandpass", freq: 2600, Q: 0.7, dur: 0.24, peak: 0.6 * x, hold: 0.08 }); },
  }),
  "808": common({
    kick: (v, t, x) => { pitchDrop(v, t, { f0: 120, f1: 52, f2: 46, drop: 0.05, dur: 1.1, peak: 0.85 * x }); noiseHit(v, t, { type: "bandpass", freq: 1800, dur: 0.006, peak: 0.2 * x }); },
    clap: (v, t, x) => { [0, 0.012, 0.024].forEach(d => noiseHit(v, t + d, { type: "bandpass", freq: 1100, Q: 1.3, dur: 0.02, peak: 0.55 * x, color: "pink" })); noiseHit(v, t + 0.034, { type: "bandpass", freq: 1200, Q: 0.9, dur: 0.24, peak: 0.45 * x, color: "pink" }); },
  }),
  gated: common({
    kick: (v, t, x) => { pitchDrop(v, t, { f0: 170, f1: 56, f2: 48, drop: 0.06, dur: 0.36, peak: 1 * x }); noiseHit(v, t, { type: "bandpass", freq: 2800, dur: 0.01, peak: 0.3 * x }); },
    // 80s gated snare: loud diffuse noise held flat then cut hard.
    snare: (v, t, x) => { pitchDrop(v, t, { f0: 230, f1: 180, drop: 0.04, dur: 0.14, peak: 0.45 * x, wave: "triangle" }); noiseHit(v, t, { type: "bandpass", freq: 2200, Q: 0.5, dur: 0.3, peak: 0.6 * x, hold: 0.2 }); noiseHit(v, t, { freq: 6000, dur: 0.26, peak: 0.2 * x, hold: 0.16 }); },
  }),
  lofi: common({
    kick: (v, t, x) => { pitchDrop(v, t, { f0: 115, f1: 54, f2: 48, drop: 0.07, dur: 0.3, peak: 0.8 * x }); noiseHit(v, t, { type: "lowpass", color: "brown", freq: 300, dur: 0.08, peak: 0.25 * x }); },
    snare: (v, t, x) => { noiseHit(v, t, { type: "bandpass", color: "pink", freq: 2400, Q: 0.6, dur: 0.22, peak: 0.42 * x, attack: 0.004 }); pitchDrop(v, t, { f0: 210, f1: 170, drop: 0.05, dur: 0.09, peak: 0.25 * x, wave: "triangle" }); },
    hat: (v, t, x) => noiseHit(v, t, { type: "bandpass", freq: 7000, Q: 0.8, dur: 0.04, peak: 0.13 * x, pan: 0.2 }),
  }),
  chip: common({
    kick: (v, t, x) => pitchDrop(v, t, { f0: 220, f1: 58, drop: 0.08, dur: 0.14, peak: 0.75 * x, wave: "triangle" }),
    snare: (v, t, x) => { noiseHit(v, t, { freq: 1500, dur: 0.11, peak: 0.5 * x }); pitchDrop(v, t, { f0: 330, f1: 140, drop: 0.06, dur: 0.06, peak: 0.25 * x, wave: "square" }); },
    hat: (v, t, x) => noiseHit(v, t, { freq: 9000, dur: 0.03, peak: 0.2 * x }),
    openhat: (v, t, x) => noiseHit(v, t, { freq: 8000, dur: 0.16, peak: 0.16 * x }),
    crash: (v, t, x) => noiseHit(v, t, { freq: 5000, dur: 0.9, peak: 0.22 * x }),
  }),
  orchestral: common({
    kick: (v, t, x) => { pitchDrop(v, t, { f0: 80, f1: 50, f2: 44, drop: 0.1, dur: 1.3, peak: 0.85 * x, attack: 0.004 }); noiseHit(v, t, { type: "lowpass", color: "brown", freq: 260, dur: 0.6, peak: 0.55 * x }); },
    snare: (v, t, x) => { noiseHit(v, t, { type: "highpass", freq: 2600, dur: 0.28, peak: 0.42 * x }); pitchDrop(v, t, { f0: 220, f1: 200, drop: 0.05, dur: 0.12, peak: 0.25 * x, wave: "triangle" }); },
    crash: (v, t, x) => { metal(v, t, 2.6, 0.1 * x, 0.6, -0.35); metal(v, t, 2.4, 0.08 * x, 0.83, 0.35); noiseHit(v, t, { freq: 3500, dur: 2.6, peak: 0.2 * x }); },
  }),
} satisfies Record<string, DrumKit>;
export type KitName = keyof typeof KITS;

// ---------------------------------------------------------------------------
// Pitched instruments
// ---------------------------------------------------------------------------

const P = (p: SynthPatch): Instrument => (v, e) => synth(v, e, p);

/** Electric piano: FM tine + soft bark, velocity-sensitive brightness. */
const epiano: Instrument = (v, e) => {
  const t = Math.max(e.time, v.now()), f = midiToHz(e.midi), dur = Math.max(0.35, e.dur + 0.5), vel = e.vel;
  v.fm(t, { f, ratio: 1, index: 1.2 + vel * 2.2, indexEnd: 0.15, dur, peak: 0.16 * (0.4 + 0.6 * vel), pan: e.pan, attack: 0.002, fadeOut: 0.18, filter: { type: "hp", freq: Math.max(30, f * 0.5), Q: 0.6 } });
  v.fm(t, { f, ratio: 14, index: 0.5 + vel * 0.9, indexEnd: 0.01, dur: 0.3, peak: 0.03 * vel, pan: e.pan });
};
/** Additive piano-like tone with hammer noise and per-partial decay. */
const piano: Instrument = (v, e) => {
  const t = Math.max(e.time, v.now()), f = midiToHz(e.midi), vel = e.vel, dur = clamp(e.dur + 1.6 - (e.midi - 60) / 40, 0.6, 4);
  v.additive(t, { f, dur, peak: 0.17 * (0.35 + 0.65 * vel), pan: e.pan, attack: 0.002, partials: [
    { ratio: 1, gain: 1 }, { ratio: 2.003, gain: 0.55 * (0.5 + vel), decay: 0.7 }, { ratio: 3.009, gain: 0.3 * vel, decay: 0.45 },
    { ratio: 4.017, gain: 0.18 * vel, decay: 0.35 }, { ratio: 5.03, gain: 0.08 * vel, decay: 0.25 }, { ratio: 1.001, gain: 0.5, detune: 1.2 } ] });
  noiseHit(v, t, { type: "bandpass", freq: clamp(f * 4, 800, 6000), Q: 1, dur: 0.03, peak: 0.03 * vel, pan: e.pan });
};
const mallet = (material: "wood" | "tine" | "glass" | "bronze" | "bowl", length = 1, peak = 0.3, modes?: number[]): Instrument => (v, e) =>
  v.resonate(Math.max(e.time, v.now()), { f: midiToHz(e.midi), dur: clamp((e.dur + 0.4) * length, 0.15, 6), peak: peak * (0.4 + 0.6 * e.vel), material, pan: e.pan, modes, strike: material === "wood" ? 0.7 : 0.4, width: 0.25 });
const pluckString = (brightness: number, length = 1.2, peak = 0.32): Instrument => (v, e) =>
  v.string(Math.max(e.time, v.now()), { f: midiToHz(e.midi), dur: clamp((e.dur + 0.6) * length, 0.3, 5), peak: peak * (0.4 + 0.6 * e.vel), brightness: brightness * (0.75 + 0.35 * e.vel), pan: e.pan });
const bloomed = (timbre: "velvet" | "bowed" | "choir" | "glass" | "brass", o: { attack?: number; release?: number; peak?: number; cutoff?: number; unison?: number } = {}): Instrument => (v, e) => {
  const attack = o.attack ?? 0.25, release = o.release ?? 0.8, dur = Math.max(e.dur + release, attack + 0.1);
  v.bloom(Math.max(e.time, v.now()), { f: midiToHz(e.midi), dur, peak: (o.peak ?? 0.22) * (0.5 + 0.5 * e.vel), attack, release, timbre, unison: o.unison ?? 2, detune: 5, cutoff: (o.cutoff ?? 2200) * (0.7 + 0.5 * e.vel), cutoffEnd: (o.cutoff ?? 2200) * 0.6, pan: e.pan ?? 0, width: 0.5, sustain: 0.8 });
};

export const INSTRUMENTS = {
  // Bass
  "bass.sub": P({ osc: [{ wave: "sine" }, { wave: "triangle", level: 0.35 }], amp: { a: 0.006, d: 0.3, s: 0.85, r: 0.08 }, level: 0.55 }),
  "bass.pluck": P({ osc: [{ wave: "sawtooth" }, { wave: "square", level: 0.4, detune: 5 }], amp: { a: 0.003, d: 0.25, s: 0.4, r: 0.07 }, filter: { cutoff: 280, env: 1600, decay: 0.18, Q: 2.5, keytrack: 0.4 }, level: 0.5 }),
  "bass.acid": P({ osc: [{ wave: "sawtooth" }], amp: { a: 0.003, d: 0.2, s: 0.6, r: 0.05 }, filter: { cutoff: 380, env: 2800, decay: 0.14, Q: 9, keytrack: 0.3, velocity: 0.9 }, level: 0.42 }),
  "bass.synthwave": P({ osc: [{ wave: "sawtooth", detune: -6 }, { wave: "sawtooth", detune: 6 }, { wave: "square", level: 0.4 }], amp: { a: 0.004, d: 0.18, s: 0.55, r: 0.06 }, filter: { cutoff: 420, env: 1400, decay: 0.12, Q: 1.6, keytrack: 0.4 }, level: 0.46 }),
  "bass.fm": (v, e) => { const t = Math.max(e.time, v.now()); v.fm(t, { f: midiToHz(e.midi), ratio: 1, index: 2.5 + e.vel * 2, indexEnd: 0.4, dur: Math.max(0.12, e.dur + 0.06), peak: 0.32 * (0.5 + 0.5 * e.vel), attack: 0.003, fadeOut: 0.05, pan: e.pan, filter: { type: "hp", freq: 25, Q: 0.6 } }); },
  "bass.chip": P({ osc: [{ wave: "triangle" }], amp: { a: 0.002, d: 0.05, s: 1, r: 0.02 }, level: 0.48 }),
  "bass.upright": pluckString(0.25, 1, 0.5),
  "bass.cello": bloomed("bowed", { attack: 0.08, release: 0.35, peak: 0.34, cutoff: 1300, unison: 2 }),
  "bass.reese": P({ osc: [{ wave: "sawtooth", detune: -14 }, { wave: "sawtooth", detune: 14 }, { wave: "sine", level: 0.6 }], amp: { a: 0.01, d: 0.4, s: 0.85, r: 0.12 }, filter: { cutoff: 520, env: 300, decay: 0.4, Q: 1.2, keytrack: 0.2 }, level: 0.42 }),
  // Pads & sustained
  "pad.warm": bloomed("velvet", { attack: 0.6, release: 1.4, peak: 0.2, cutoff: 2800 }),
  "pad.strings": bloomed("bowed", { attack: 0.35, release: 0.9, peak: 0.22, cutoff: 4200, unison: 3 }),
  "pad.choir": bloomed("choir", { attack: 0.5, release: 1.2, peak: 0.2, cutoff: 3600, unison: 3 }),
  "pad.glass": bloomed("glass", { attack: 0.8, release: 1.6, peak: 0.16, cutoff: 5200 }),
  "pad.brass": bloomed("brass", { attack: 0.12, release: 0.5, peak: 0.24, cutoff: 3400, unison: 2 }),
  "pad.synth": P({ osc: [{ wave: "sawtooth", detune: -9 }, { wave: "sawtooth", detune: 9 }, { wave: "sawtooth", octave: 1, level: 0.35 }], unison: 2, spread: 14, width: 0.8, amp: { a: 0.35, d: 0.6, s: 0.8, r: 0.9 }, filter: { cutoff: 900, env: 900, decay: 0.8, Q: 0.8, keytrack: 0.3 }, level: 0.18 }),
  "pad.dark": P({ osc: [{ wave: "sawtooth", detune: -7 }, { wave: "triangle", detune: 7 }], unison: 2, spread: 10, width: 0.7, amp: { a: 1.2, d: 1, s: 0.9, r: 1.8 }, filter: { cutoff: 480, env: 260, decay: 2, Q: 1.4, keytrack: 0.2 }, level: 0.22 }),
  "organ": P({ osc: [{ wave: "sine" }, { wave: "sine", octave: 1, level: 0.6 }, { wave: "sine", octave: 2, level: 0.3 }, { wave: "sine", octave: -1, level: 0.5 }], amp: { a: 0.012, d: 0.1, s: 1, r: 0.09 }, vibrato: { rate: 6.4, depth: 6, delay: 0 }, level: 0.2 }),
  "strings.stab": bloomed("bowed", { attack: 0.012, release: 0.18, peak: 0.26, cutoff: 4800, unison: 3 }),
  "brass.stab": bloomed("brass", { attack: 0.03, release: 0.25, peak: 0.28, cutoff: 4200, unison: 2 }),
  // Keys, mallets, plucks
  "keys.epiano": epiano,
  "keys.piano": piano,
  "mallet.marimba": mallet("wood", 0.6, 0.34, [1, 3.93, 9.2]),
  "mallet.vibes": mallet("bronze", 1.6, 0.2, [1, 3.98, 9.9]),
  "mallet.celesta": mallet("tine", 1.2, 0.2, [1, 2.76, 5.4]),
  "mallet.glock": mallet("glass", 1.4, 0.16, [1, 2.71, 5.2]),
  "mallet.kalimba": mallet("tine", 0.8, 0.28, [1, 5.4, 11.3]),
  "pluck.harp": pluckString(0.55, 1.8, 0.3),
  "pluck.guitar": pluckString(0.42, 1.3, 0.3),
  "pluck.synth": P({ osc: [{ wave: "sawtooth" }, { wave: "square", detune: 7, level: 0.5 }], amp: { a: 0.002, d: 0.22, s: 0, r: 0.15 }, filter: { cutoff: 600, env: 3800, decay: 0.15, Q: 2.2, keytrack: 0.5 }, level: 0.26 }),
  "pluck.chip": P({ osc: [{ wave: "pulse25" }], amp: { a: 0.001, d: 0.12, s: 0.3, r: 0.04 }, level: 0.24 }),
  // Leads
  "lead.supersaw": P({ osc: [{ wave: "sawtooth" }], unison: 5, spread: 22, width: 0.8, amp: { a: 0.01, d: 0.3, s: 0.8, r: 0.25 }, filter: { cutoff: 2200, env: 2400, decay: 0.3, Q: 1, keytrack: 0.5 }, vibrato: { rate: 5.5, depth: 10, delay: 0.25 }, level: 0.2 }),
  "lead.square": P({ osc: [{ wave: "square" }, { wave: "square", detune: 8, level: 0.5 }], amp: { a: 0.006, d: 0.2, s: 0.75, r: 0.12 }, filter: { cutoff: 2000, env: 1400, decay: 0.25, Q: 1.2 }, vibrato: { rate: 5.8, depth: 14, delay: 0.2 }, level: 0.17 }),
  "lead.chip": P({ osc: [{ wave: "pulse12" }], amp: { a: 0.002, d: 0.1, s: 0.75, r: 0.05 }, vibrato: { rate: 7, depth: 22, delay: 0.12 }, level: 0.2 }),
  "lead.flute": P({ osc: [{ wave: "sine" }, { wave: "triangle", level: 0.25 }], amp: { a: 0.06, d: 0.3, s: 0.85, r: 0.18 }, vibrato: { rate: 5, depth: 12, delay: 0.25 }, chiff: { level: 0.09, freq: 2400, decay: 0.08 }, level: 0.3 }),
  "lead.horn": bloomed("brass", { attack: 0.07, release: 0.35, peak: 0.3, cutoff: 3200, unison: 2 }),
  "lead.bell": (v, e) => { const t = Math.max(e.time, v.now()); v.fm(t, { f: midiToHz(e.midi), ratio: 3.5, index: 2.4 * (0.5 + e.vel), indexEnd: 0.05, dur: Math.max(0.8, e.dur + 1.2), peak: 0.15 * (0.5 + 0.5 * e.vel), pan: e.pan, attack: 0.002 }); },
  "lead.whistle": P({ osc: [{ wave: "sine" }], amp: { a: 0.04, d: 0.2, s: 0.9, r: 0.12 }, vibrato: { rate: 5.6, depth: 18, delay: 0.15 }, chiff: { level: 0.05, freq: 3500, decay: 0.05 }, level: 0.26 }),
} satisfies Record<string, Instrument>;
export type InstrumentName = keyof typeof INSTRUMENTS;

// ---------------------------------------------------------------------------
// Transitional FX
// ---------------------------------------------------------------------------

/** Noise + tone riser that peaks exactly at `t + dur`. */
export function riser(v: Voice, t: number, dur: number, level = 0.3): void {
  noiseHit(v, t, { type: "bandpass", freq: 400, freqEnd: 7000, Q: 2, dur: dur + 0.05, peak: level * 0.6, attack: dur * 0.95, color: "white" });
  const ctx = v.ctx, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sawtooth"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(5000, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * 0.12, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  o.connect(f); f.connect(g); g.connect(v.dest); v.own(o, f, g); o.start(t); o.stop(t + dur + 0.05); v._track(t + dur + 0.06);
}
export function downlifter(v: Voice, t: number, dur: number, level = 0.3): void {
  noiseHit(v, t, { type: "bandpass", freq: 6000, freqEnd: 200, Q: 1.5, dur, peak: level * 0.5, attack: 0.01 });
  pitchDrop(v, t, { f0: 220, f1: 40, drop: dur, dur, peak: level * 0.5 });
}
