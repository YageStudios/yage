/** Shared synthesis helpers for the airport suite (automated layers, physical fly-bys, chimes,
 * beeps, radio voice, crowd/vocal formants, solid keyboard typing). */
import type { Voice } from '../voice';
import type { WaveType } from '../types';
import { clamp } from '../dsp';
import { hit, thud, air, m } from './airport-materials';
import { crowdPhrase, humanPhrase, humanVocal } from './airport-human';

export type Pts = ReadonlyArray<readonly [number, number]>;
export type Src = 'white' | 'pink' | 'brown' | OscillatorType;
export interface Layer {
  src: Src; f?: Pts; filter?: { type: BiquadFilterType; f: Pts; Q?: number };
  gain: Pts; pan?: Pts; detune?: number;
  /** Organic pressure motion. Zero keeps an exact signalling tone. */
  motion?: number;
  /** Independent noise sources, never delayed/inverted copies. Bass stays centred. */
  width?: number;
  /** Extra DC/low-frequency rejection before the authored resonant band. */
  highpass?: number;
  /** Explicit harmonic source for blades, motors and other non-musical cycles. */
  harmonics?: readonly number[];
  /** Aperiodic frequency deviation as a fraction of the base frequency. */
  frequencyJitter?: number;
  /** Blade/running-surface amplitude modulation. */
  pulse?: { frequency: Pts; depth: number };
}

export function automate(p: AudioParam, t: number, pts: Pts, min = -Infinity): void {
  if (!pts.length) throw new RangeError('airport: automation needs at least one point');
  let previous = -Infinity;
  for (const [at, value] of pts) {
    if (!Number.isFinite(at) || at < 0 || at < previous || !Number.isFinite(value))
      throw new RangeError('airport: automation points must be finite and time-ordered');
    previous = at;
  }
  p.setValueAtTime(Math.max(min, pts[0][1]), t + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(Math.max(min, pts[i][1]), t + pts[i][0]);
}
/** Preserve authored motion, but never start or cut a sustained layer at nonzero gain. */
export function feather(pts: Pts): Pts {
  if (!pts.length) throw new RangeError('airport: envelope needs points');
  let previous = -Infinity;
  for (const [at, value] of pts) {
    if (!Number.isFinite(at) || at < 0 || at < previous || !Number.isFinite(value))
      throw new RangeError('airport: envelope points must be finite and time-ordered');
    previous = at;
  }
  const end = pts[pts.length - 1][0];
  if (!(end > 0)) throw new RangeError('airport: layer duration must be positive');
  const sample = (at: number) => {
    if (at <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (at <= pts[i][0]) {
      const [a, x] = pts[i - 1], [b, y] = pts[i];
      return x + (y - x) * (at - a) / Math.max(1e-9, b - a);
    }
    return pts[pts.length - 1][1];
  };
  const attack = Math.min(0.008, end * 0.08), release = Math.min(0.09, end * 0.12);
  const times = [...new Set([0, attack, end - release, end, ...pts.map(p => p[0])])].sort((a, b) => a - b);
  return times.map(at => [at, Math.max(0, sample(at)) * Math.min(1, at / attack, (end - at) / release)] as const);
}
/** Seed-offset low-frequency noise modulation, not a periodic tremolo. */
function wander(v: Voice, t: number, param: AudioParam, amount: number, end?: number): void {
  if (amount <= 0) return;
  const source = v.ctx.createBufferSource(), depth = v.ctx.createGain(), smooth = v.ctx.createBiquadFilter();
  source.buffer = v.engine.noiseBuffer('brown'); source.loop = true;
  source.playbackRate.value = v.random(0.025, 0.06);
  smooth.type = 'lowpass'; smooth.frequency.value = 12; smooth.Q.value = 0.5;
  depth.gain.value = amount;
  source.connect(smooth); smooth.connect(depth); depth.connect(param);
  v.own(source, smooth, depth); source.start(t, v.random(0, source.buffer.duration));
  if (end !== undefined) source.stop(end + 0.012);
}
function pressure(v: Voice, t: number, output: AudioNode, amount: number, end?: number): GainNode {
  const g = v.ctx.createGain(); g.gain.value = 1; g.connect(output);
  wander(v, t, g.gain, amount * 0.36, end);
  return g;
}
/** One automated source → filter → pressure → gain → pan chain. */
export function layer(v: Voice, t: number, o: Layer): number {
  if (v._stopped) return t;
  // Validate optional extensions before allocating any native audio nodes.
  if ((o.width !== undefined && (!Number.isFinite(o.width) || o.width < 0 || o.width > 0.95))
    || (o.highpass !== undefined && (!Number.isFinite(o.highpass) || o.highpass <= 0))
    || (o.frequencyJitter !== undefined && (!Number.isFinite(o.frequencyJitter) || o.frequencyJitter < 0 || o.frequencyJitter > 0.2))
    || (o.harmonics && (!o.harmonics.length || o.harmonics.some(x => !Number.isFinite(x))))
    || (o.pulse && (!Number.isFinite(o.pulse.depth) || o.pulse.depth < 0 || o.pulse.depth > 0.9)))
    throw new RangeError('airport: invalid layer source options');
  if (o.pulse) {
    let last = -1;
    if (!o.pulse.frequency.length) throw new RangeError('airport: missing blade frequency');
    for (const [at, hz] of o.pulse.frequency) {
      if (!Number.isFinite(at) || at < 0 || at < last || !Number.isFinite(hz) || hz <= 0)
        throw new RangeError('airport: invalid blade frequency');
      last = at;
    }
  }
  const envelope = feather(o.gain), end = envelope[envelope.length - 1][0];
  const noise = o.src === 'white' || o.src === 'pink' || o.src === 'brown';
  const width = o.width ?? (noise && o.src !== 'brown' && end > 0.4 ? 0.24 : 0);
  if (width > 0) {
    // Two independent excitations: real width, with a usable mono fold-down.
    for (const side of [-1, 1]) layer(v, t, { ...o, width: 0, gain: scale(o.gain, Math.SQRT1_2),
      pan: (o.pan ?? [[0, 0], [end, 0]]).map(([at, x]) => [at, clamp(x + side * width, -0.95, 0.95)] as const) });
    return t + end;
  }
  const ctx = v.ctx, nyq = ctx.sampleRate * 0.45;
  let src: AudioScheduledSourceNode;
  if (noise) {
    const b = ctx.createBufferSource(); b.buffer = v.engine.noiseBuffer(o.src as 'white' | 'pink' | 'brown'); b.loop = true;
    b.playbackRate.value = 1 + v.random(-0.004, 0.004) * v.motion; src = b;
  } else {
    const osc = ctx.createOscillator(); osc.type = o.src as OscillatorType; osc.detune.value = o.detune ?? 0;
    if (o.harmonics?.length) {
      const real = new Float32Array(o.harmonics.length + 1), imag = new Float32Array(o.harmonics.length + 1);
      o.harmonics.forEach((gain, i) => { imag[i + 1] = gain; });
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    } else if (o.src === 'sawtooth') {
      // Damped rotating mechanism rather than a synthesizer saw's full harmonic ladder.
      const real = new Float32Array(25), imag = new Float32Array(25);
      for (let h = 1; h < imag.length; h++) imag[h] = Math.exp(-h / 6) / Math.pow(h, 0.85) * (h % 3 === 0 ? 0.62 : 1);
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    }
    wander(v, t, osc.frequency, (o.f?.[0]?.[1] ?? 440) * (o.frequencyJitter ?? 0) * v.motion, t + end);
    automate(osc.frequency, t, (o.f ?? [[0, 440]]).map(([a, f]) => [a, clamp(f * v.pitch, 5, nyq)] as const));
    src = osc;
  }
  const g = ctx.createGain(), p = ctx.createStereoPanner();
  const movement = clamp((o.motion ?? (noise ? 1 : 0.32)) * v.motion, 0, 2);
  const texture = pressure(v, t, g, end > 0.18 ? movement : 0, t + end);
  const nodes: AudioNode[] = [g, p, texture];
  let head: AudioNode = src;
  if (o.highpass) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = clamp(o.highpass, 10, nyq); hp.Q.value = 0.55;
    head.connect(hp); head = hp; nodes.push(hp);
  }
  if (o.filter) {
    const f = ctx.createBiquadFilter(); f.type = o.filter.type; f.Q.value = o.filter.Q ?? 0.7;
    const brightness = o.filter.type === 'highpass' ? 1 : v.brightness;
    automate(f.frequency, t, o.filter.f.map(([a, x]) => [a, clamp(x * brightness, 10, nyq)] as const));
    head.connect(f); head = f; nodes.push(f);
  }
  automate(g.gain, t, envelope, 0);
  if (o.pan) automate(p.pan, t, o.pan.map(([a, x]) => [a, clamp(x, -1, 1)] as const)); else p.pan.value = 0;
  if (o.pulse) {
    const modulation = ctx.createOscillator(), amount = ctx.createGain(), gate = ctx.createGain();
    const depth = clamp(o.pulse.depth, 0, 0.9); gate.gain.value = 1 - depth * 0.5; amount.gain.value = depth * 0.5;
    automate(modulation.frequency, t, o.pulse.frequency.map(([at, hz]) => [at, Math.min(nyq, hz * v.pitch)] as const)); modulation.connect(amount); amount.connect(gate.gain);
    head.connect(gate); head = gate; v.own(modulation, amount, gate); modulation.start(t); modulation.stop(t + end + 0.012);
  }
  head.connect(texture); g.connect(p); p.connect(v.dest); v.own(src, ...nodes);
  if (noise) (src as AudioBufferSourceNode).start(t, v.random(0, ((src as AudioBufferSourceNode).buffer?.duration ?? 0))); else src.start(t);
  src.stop(t + end + 0.012); v._track(t + end + 0.025);
  return t + end;
}

/** Stereo ambience bed with independent phases and pressure drift. Return shape preserves RTPC callers. */
export function bed(v: Voice, t: number, color: 'white' | 'pink' | 'brown', type: BiquadFilterType, f: number, Q = 0.7) {
  const ctx = v.ctx, fl = ctx.createBiquadFilter(), g = ctx.createGain();
  fl.type = type; fl.frequency.value = Math.min(f * v.brightness, ctx.sampleRate * 0.43); fl.Q.value = Q; g.gain.value = 0;
  const texture = pressure(v, t, g, v.motion * 0.65); fl.connect(texture); g.connect(v.dest);
  for (const side of [-1, 1]) {
    const s = ctx.createBufferSource(), p = ctx.createStereoPanner(), level = ctx.createGain();
    s.buffer = v.engine.noiseBuffer(color); s.loop = true; s.playbackRate.value = 1 + side * 0.0031 * v.motion;
    p.pan.value = side * (color === 'brown' ? 0.22 : 0.65); level.gain.value = Math.SQRT1_2;
    s.connect(level); level.connect(p); p.connect(fl);
    v.own(s, level, p, ...(side === -1 ? [fl, texture, g] : [])); s.start(t, v.random(0, s.buffer.duration));
  }
  return { g, fl };
}
/** Continuous motor oscillator. Harmonics are damped at source rather than a raw saw in the hall. */
export function hum(v: Voice, t: number, f: number, type: OscillatorType = 'sine') {
  const ctx = v.ctx, o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
  o.type = type; o.frequency.value = f * v.pitch; g.gain.value = 0;
  if (type === 'sawtooth' || type === 'triangle') {
    const real = new Float32Array(25), imag = new Float32Array(25);
    for (let h = 1; h < imag.length; h++) imag[h] = type === 'triangle'
      ? (h % 2 ? Math.pow(-1, (h - 1) / 2) / (h * h) : 0)
      : Math.exp(-h / 5.5) / Math.pow(h, 0.85) * (h % 3 === 0 ? 0.65 : 1);
    o.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    wander(v, t, o.frequency, f * 0.003 * v.motion);
  }
  fl.type = 'lowpass'; fl.frequency.value = Math.min(ctx.sampleRate * 0.43, Math.min(6800, Math.max(650, f * (type === 'sawtooth' ? 14 : 5))) * v.brightness); fl.Q.value = 0.6;
  const texture = pressure(v, t, g, v.motion * 0.35);
  o.connect(fl); fl.connect(texture); g.connect(v.dest); v.own(o, fl, texture, g); o.start(t);
  return { o, g };
}

/** Physical fly-by: straight path at `speed` m/s, closest approach `height` m at `pass` s.
 * Returns breakpoints for Doppler ratio, level (1/r), pan and air-absorption cutoff. */
export function flight(dur: number, pass: number, speed: number, height: number, steps = 48) {
  if (![dur, pass, speed, height, steps].every(Number.isFinite) || dur <= 0 || pass < 0 || pass > dur || speed < 0 || speed >= 343 || height <= 0 || steps < 2 || !Number.isInteger(steps))
    throw new RangeError('airport: invalid subsonic flight path');
  const c = 343, doppler: [number, number][] = [], level: [number, number][] = [], pan: [number, number][] = [], cutoff: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const at = i / steps * dur;
    let emission = at - pass;
    for (let j = 0; j < 5; j++) {
      const dist = Math.hypot(speed * emission, height);
      emission -= (emission + (dist - height) / c - (at - pass)) / (1 + speed * speed * emission / (c * dist));
    }
    const x = speed * emission, d = Math.hypot(x, height), vr = speed * x / d;
    doppler.push([at, c / (c + vr)]);
    level.push([at, Math.min(1, height / d)]);
    pan.push([at, clamp(x / (Math.abs(x) + height * 1.5), -0.95, 0.95)]);
    cutoff.push([at, clamp(16000 / (1 + d / 120), 500, 16000)]);
  }
  const ramp = (pts: [number, number][], k = 0.15) => pts.map(([a, x], i) => [a, x * Math.min(1, i / (steps * k), (steps - i) / (steps * k))] as const);
  return { doppler, level: ramp(level), pan, cutoff };
}
export const scale = (pts: Pts, k: number): Pts => pts.map(([a, x]) => [a, x * k] as const);

/** Crowd syllable: a random vowel through moving formants (intelligibility deliberately low). */
export const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]] as const;
export function syllable(v: Voice, t: number, peak: number, pan: number, cutoff = 2400): void {
  crowdPhrase(v, t, peak, pan, cutoff);
}
/** Inhomogeneous Poisson process, integrated in short audio-time windows.
 * Zero rate means silence. Busy RTPC changes are heard without waiting for an old, long gap.
 * Nothing is forcibly fired on startup (old loops all fired every event at +50 ms). */
export function poisson(v: Voice, rate: () => number, fire: (time: number) => void): void {
  let cursor = Math.max(v.now(), v._started);
  const draw = () => -Math.log(1 - v.random(0.000001, 0.999999));
  let remaining = draw();
  const tick = () => {
    if (v._stopped) return;
    cursor = Math.max(cursor, v.now());
    const end = v.now() + 0.09;
    const value = rate(), intensity = Number.isFinite(value) ? clamp(value, 0, 180) : 0;
    let count = 0;
    while (cursor < end && count++ < 128) {
      if (intensity === 0) { cursor = end; break; }
      const wait = remaining / intensity;
      if (cursor + wait >= end) { remaining -= (end - cursor) * intensity; cursor = end; break; }
      cursor += wait; fire(cursor); remaining = draw();
      if (v._stopped) return;
    }
    v.later(tick, 30);
  };
  tick();
}
/** Rounded mallet, warm fundamental, brief upper glint. Long high partials no longer dominate. */
export function chime(v: Voice, t: number, midi: number, peak = 0.22, len = 1.6, pan = 0): void {
  const f = m(midi);
  v.resonate(t, { f, dur: len, peak: peak * 0.86, material: 'tine', modes: [1, 2.005, 3.98],
    strike: 0.08, bloom: 0.0035, width: 0.14, pan });
  v.tone(t, { f, dur: len * 0.76, peak: peak * 0.3, attack: 0.004, pan });
  v.resonate(t, { f: f * 4.01, dur: Math.min(0.13, len * 0.24), peak: peak * 0.045,
    material: 'glass', modes: [1], strike: 0, bloom: 0.003, width: 0.1, pan });
  v.noise(t, { color: 'pink', type: 'lp', freq: 1800, dur: 0.012, peak: peak * 0.055, attack: 0.001, pan });
}
/** Signalling pitch and pulse duration stay exact. Softer edges and filtered harmonics remove sting. */
export function beep(v: Voice, t: number, f: number, dur: number, peak = 0.15, type: WaveType = 'sine', pan = 0): number {
  const a = Math.min(0.008, dur * 0.12), r = Math.min(0.018, dur * 0.2);
  return v.tone(t, { f, dur, peak, type, flat: true, pan,
    fade: { in: a, hold: dur - r, out: r },
    filter: type === 'sine' ? undefined : { type: 'lp', freq: Math.min(4200, f * 2.8), Q: 0.55 } });
}
const radioBusy = new WeakMap<Voice, number>();
/** Bandlimited radio voice burst (unintelligible). Transmissions on one loop cannot talk over each other. */
export function radio(v: Voice, t: number, dur: number, peak = 0.18, pan = 0): void {
  if (v._stopped || t < (radioBusy.get(v) ?? -1)) return;
  radioBusy.set(v, t + dur + 0.2);
  v.noise(t, { color: 'pink', type: 'bp', freq: 1900, Q: 0.8, dur: 0.027, peak: peak * 0.16, pan });
  humanPhrase(v, t + 0.04, { duration: Math.max(0.04, dur - 0.1), syllables: Math.max(2, Math.round(dur * 5)),
    pitch: v.random(112, 147), peak: peak * 1.2, pan, channel: 'radio', breath: 0.1, rough: 0.12 });
  v.noise(t, { color: 'pink', type: 'bp', freq: 1700, Q: 0.6, dur,
    peak: peak * 0.03, flat: true, fade: { in: 0.02, hold: dur - 0.045, out: 0.045 }, pan });
  v.noise(t + dur, { color: 'white', type: 'bp', freq: 1800, Q: 0.7, dur: 0.055,
    peak: peak * 0.14, attack: 0.002, pan });
}
export const morse = (v: Voice, t: number, code: string, f: number, unit = 0.09, peak = 0.12): number => {
  let at = 0;
  for (const ch of code) { if (ch === ' ') { at += unit * 3; continue; } const len = ch === '-' ? unit * 3 : unit; beep(v, t + at, f, len, peak); at += len + unit; }
  return at;
};
export function engineHum(v: Voice, t: number, dur: number, whine: Pts, roar: Pts, gainK = 1, pan?: Pts): void {
  layer(v, t, { src: 'triangle', f: whine, filter: { type: 'bandpass', f: whine, Q: 3 }, gain: scale([[0, 0], [dur * 0.1, 0.05], [dur * 0.9, 0.05], [dur, 0]], gainK), pan });
  layer(v, t, { src: 'pink', filter: { type: 'lowpass', f: roar }, gain: scale([[0, 0], [dur * 0.15, 0.3], [dur * 0.85, 0.3], [dur, 0]], gainK), pan });
}


/** A SOLID keystroke: thick cap, deep bottom-out, firm plate, the desk takes the weight. */
export function solidKey(v: Voice, t: number, o: { vel?: number; pan?: number; f?: number; big?: boolean } = {}): void {
  const vel = o.vel ?? 1, pan = o.pan ?? 0, scale = (o.f ?? 150) / 150 * (o.big ? 0.88 : 1);
  // Switch/cap contact first; chassis weight does not precede the key hit.
  v.noise(t, { color: 'white', type: 'bp', freq: 2050 * scale, Q: 1.2, dur: 0.0055,
    peak: 0.21 * vel, attack: 0.0005, pan });
  v.noise(t + 0.001, { color: 'pink', type: 'bp', freq: 510 * scale, Q: 1.5, dur: 0.044,
    peak: 0.6 * vel, attack: 0.0008, pan });
  v.resonate(t + 0.002, { f: 275 * scale, dur: 0.047, peak: 0.095 * vel,
    material: 'wood', modes: [1, 1.73, 2.58], strike: 0, bloom: 0.001, width: 0.03, pan });
  v.noise(t + 0.002, { color: 'brown', type: 'bp', freq: 165 * scale, Q: 0.8, dur: 0.044,
    peak: 0.21 * vel, attack: 0.0008, pan });
  if (o.big) hit(v, t + 0.009, 1160 * scale, 0.024, 0.038 * vel, 'wire', pan, [1, 2.01]);
  hit(v, t + v.random(0.048, 0.07), 790 * scale, 0.014, 0.065 * vel, 'wood', pan);
}
/** Human typing: words of 2–9 letters, faster within words, a breath at spaces, hand-side panning,
 * occasional backspace corrections, Enter to finish. */
export function typing(v: Voice, t: number, seconds: number, wpm = 70, enter = true): number {
  const base = 60 / (wpm * 5);
  let at = 0;
  while (at < seconds) {
    const letters = 2 + Math.floor(v.random(0, 8));
    for (let i = 0; i < letters && at < seconds; i++) {
      solidKey(v, t + at, { vel: v.random(0.65, 1), pan: v.random() < 0.5 ? -0.18 : 0.18, f: 150 + v.random(-12, 12) });
      at += base * Math.exp(v.random(-0.45, 0.35)) * (i === 0 ? 1.3 : 0.85);
    }
    if (at >= seconds) { at = seconds; break; }
    if (v.random() < 0.12 && at + base * 2.8 < seconds) for (let k = 0; k < 2; k++) { solidKey(v, t + at, { vel: 0.8, pan: 0.25, f: 140 }); at += base * 1.4; }
    solidKey(v, t + at, { vel: 0.85, big: true }); at = Math.min(seconds, at + base * v.random(1.2, 2.4));
  }
  if (enter) { at += 0.12; solidKey(v, t + at, { vel: 1.1, pan: 0.25, f: 130, big: true }); }
  return at;
}
/** Vocalization through moving formants with a pitch contour (non-verbal, no words). */
export function vocal(v: Voice, t: number, o: { contour: number[]; dur: number; vowel?: readonly [number, number]; to?: readonly [number, number]; peak?: number; rough?: number; breath?: number; pan?: number; cutoff?: number }): void {
  humanVocal(v, t, o);
}
/** One utterance, one speaker, connected consonant/vowel articulation. */
export function grumble(v: Voice, t: number, o: { pitch?: number; syllables?: number; peak?: number; pan?: number; rough?: number } = {}): number {
  return humanPhrase(v, t, { ...o, pitch: o.pitch ?? 113, syllables: o.syllables ?? 6,
    peak: o.peak ?? 0.28, rough: o.rough ?? 0.3, mood: 0.8, cutoff: 3300, breath: 0.14 });
}

/** Glass touchscreen contact (no mechanical travel). */
export function thudless(v: Voice, t: number): void { v.noise(t, { color: 'pink', type: 'bp', freq: 1400, Q: 1, dur: 0.012, peak: 0.08, attack: 0.001 }); thud(v, t, 160, 0.05, 0.04); air(v, t, 0.01, 3000, 2000, 0.02); }
