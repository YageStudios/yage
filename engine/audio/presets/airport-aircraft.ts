/** Airport aircraft source models. An engine is a changing noise spectrum with
 * embedded shaft/fan detail, not a prominent triangle/sawtooth over pink noise.
 * These are designed game approximations, not aircraft-certified recordings.
 */
import type { Voice } from '../voice';
import { clamp } from '../dsp';
import { layer, bed, hum, flight, scale, type Pts } from './airport-kit';
import { hit } from './airport-materials';

export type JetSize = 'airliner' | 'widebody' | 'regional' | 'business' | 'apu';
const ENGINES: Record<JetSize, { fan: number; body: number; color: number; mass: number; tone: number }> = {
  airliner: { fan: 1320, body: 155, color: 1, mass: 1, tone: 1 },
  widebody: { fan: 960, body: 112, color: 0.83, mass: 1.22, tone: 0.84 },
  regional: { fan: 1740, body: 200, color: 1.2, mass: 0.76, tone: 1.08 },
  business: { fan: 2150, body: 245, color: 1.36, mass: 0.57, tone: 1.15 },
  apu: { fan: 2480, body: 280, color: 1.4, mass: 0.36, tone: 0.85 },
};
function value(points: Pts, at: number): number {
  if (at <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (at <= points[i][0]) {
    const [a, x] = points[i - 1], [b, y] = points[i];
    const k = clamp((at - a) / Math.max(1e-9, b - a), 0, 1);
    return x + (y - x) * k;
  }
  return points[points.length - 1][1];
}
function curve(duration: number, fn: (at: number) => number): Pts {
  const steps = Math.ceil(duration * 24);
  return Array.from({ length: steps + 1 }, (_, i) => { const at = duration * i / steps; return [at, fn(at)] as const; });
}
export interface JetOptions {
  duration: number; spool: Pts; level: Pts; size?: JetSize; pan?: Pts;
  doppler?: Pts; cutoff?: Pts; exhaust?: Pts; reverse?: number;
}
/** Independent low core, mixing roar, fan-band turbulence and upper airflow.
 * Inlet tones retreat behind the listener while exhaust develops a later peak. */
export function jetEngine(v: Voice, t: number, o: JetOptions): void {
  const p = ENGINES[o.size ?? 'airliner'], dur = o.duration;
  const n = (at: number) => clamp(value(o.spool, at), 0, 1);
  const level = (at: number) => Math.max(0, value(o.level, at));
  const rear = (at: number) => o.exhaust ? clamp(value(o.exhaust, at), 0, 1) : 0.45;
  const doppler = (at: number) => o.doppler ? value(o.doppler, at) : 1;
  const cutoff = curve(dur, at => Math.min(o.cutoff ? value(o.cutoff, at) : 10000, (1700 + 4300 * n(at)) * p.color));
  const fan = curve(dur, at => p.fan * (0.34 + 0.66 * n(at)) * doppler(at));
  const mix = (fn: (at: number) => number) => curve(dur, at => level(at) * fn(at));
  layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: curve(dur, at => p.body * (0.68 + n(at) * 0.8) * doppler(at)), Q: 0.48 },
    gain: mix(at => (0.2 + n(at) * 0.46) * p.mass * (0.7 + rear(at) * 0.5)), pan: o.pan, width: 0.14, motion: 0.65 });
  layer(v, t, { src: 'pink', filter: { type: 'lowpass', f: cutoff, Q: 0.55 }, highpass: 190,
    gain: mix(at => (0.2 + n(at) * n(at) * 1.28) * (0.48 + rear(at) * 0.74) * (1 + (o.reverse ?? 0) * 0.35)),
    pan: o.pan, width: 0.29, motion: 1.2 });
  layer(v, t, { src: 'white', filter: { type: 'bandpass', f: curve(dur, at => (620 + 1400 * n(at)) * p.color * doppler(at)), Q: 0.62 },
    gain: mix(at => (0.11 + 0.32 * n(at)) * (1.1 - rear(at) * 0.42)), pan: o.pan, width: 0.2, motion: 0.85 });
  layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: curve(dur, at => Math.min(value(cutoff, at), (2100 + n(at) * 1700) * p.color)), Q: 0.55 },
    gain: mix(at => 0.045 + n(at) * 0.12), pan: o.pan, width: 0.33, motion: 0.9 });
  layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 120], [dur, 120]], Q: 0.5 },
    gain: mix(at => (0.08 + n(at) * 0.12) * p.mass), width: 0, motion: 0.65 });
  // The blade-passing feature is broadened/noisy. Small offset partials avoid a
  // single conspicuous synth note; high partials are short/quiet, never shrill.
  layer(v, t, { src: 'white', filter: { type: 'bandpass', f: fan, Q: 5 },
    gain: mix(at => (0.075 + n(at) * 0.13) * (1 - rear(at) * 0.58)), pan: o.pan, width: 0.12, motion: 0.65 });
  for (const [ratio, gain] of [[0.995, 0.013], [1.006, 0.009], [2.003, 0.0035]]) {
    layer(v, t, { src: 'sine', f: scale(fan, ratio), filter: { type: 'lowpass', f: cutoff, Q: 0.55 },
      gain: mix(at => gain * p.tone * (0.38 + n(at) * 0.62) * (1.05 - rear(at) * 0.8)),
      pan: o.pan, frequencyJitter: 0.003, motion: 0.55 });
  }
  // High-power shock/shaft harmonics are a subdued texture, not a raw saw.
  layer(v, t, { src: 'sine', harmonics: [0.12, 0.4, 0.7, 0.56, 0.39, 0.2, 0.13, 0.08, 0.05],
    f: curve(dur, at => (22 + 43 * n(at)) * p.color * doppler(at)),
    filter: { type: 'lowpass', f: curve(dur, at => 330 + n(at) * 1200), Q: 0.5 },
    gain: mix(at => Math.max(0, n(at) - 0.63) * 0.055 * (1 - rear(at) * 0.4)),
    pan: o.pan, frequencyJitter: 0.006, motion: 0.6 });
}

export function jetTakeoff(v: Voice, t: number, size: JetSize = 'airliner', duration = 16, rotate = 9): void {
  jetEngine(v, t, { size, duration,
    spool: [[0, 0.17], [0.7, 0.2], [3.2, 0.9], [rotate, 1], [duration, 0.81]],
    level: [[0, 0], [0.5, 0.1], [2.8, 0.39], [rotate * 0.85, 0.86], [rotate + 0.6, 1], [duration * 0.86, 0.28], [duration, 0]],
    pan: [[0, -0.45], [rotate, 0.02], [duration, 0.68]],
    exhaust: [[0, 0.1], [rotate, 0.5], [rotate + 1.5, 0.95], [duration, 1]],
    doppler: [[0, 1.025], [rotate - 1, 1.08], [rotate + 1, 0.94], [duration, 0.88]],
    cutoff: [[0, 4500], [rotate, 7500], [duration, 600]],
  });
  // Continuous runway contact drops at rotation. Individual joints are quiet,
  // weight-bearing tyre impulses, not repeated game-impact kick drums.
  layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 145], [rotate, 260], [rotate + 0.4, 100]], Q: 0.55 },
    gain: [[0, 0], [2, 0], [rotate - 0.5, 0.27], [rotate + 0.1, 0.018], [rotate + 0.4, 0]], width: 0.1, motion: 1.4 });
  for (let k = 1; ; k++) {
    const at = 2.1 + Math.sqrt(k * 7.8); if (at > rotate - 0.18) break;
    v.noise(t + at, { color: 'pink', type: 'bp', freq: 210, Q: 0.6, dur: 0.052, peak: 0.07, attack: 0.003 });
  }
}
export function jetPass(v: Voice, t: number, o: { duration?: number; pass?: number; speed?: number; height?: number; size?: JetSize; spool?: number } = {}): void {
  const duration = o.duration ?? 9, pass = o.pass ?? duration * 0.5;
  const fl = flight(duration, pass, o.speed ?? 80, o.height ?? 120, Math.ceil(duration * 24));
  jetEngine(v, t, { duration, size: o.size, spool: [[0, o.spool ?? 0.8], [duration, o.spool ?? 0.8]],
    level: fl.level, pan: fl.pan, doppler: fl.doppler, cutoff: fl.cutoff,
    exhaust: [[0, 0.04], [Math.max(0.1, pass - 0.5), 0.22], [pass + 0.7, 0.86], [duration, 1]],
  });
}
export function touchdown(v: Voice, t: number, peak = 0.4): void {
  for (const [d, k] of [[0, 1], [0.072, 0.67]]) {
    v.noise(t + d, { color: 'white', type: 'bp', freq: 1680, freq2: 980, Q: 1.35, dur: 0.19, peak: peak * k, attack: 0.002 });
    // A short friction resonance, not a 200 ms pure descending whistle.
    v.noise(t + d + 0.008, { color: 'pink', type: 'bp', freq: 1000, freq2: 740, Q: 3.6, dur: 0.115, peak: peak * 0.38 * k, attack: 0.003 });
    v.noise(t + d + 0.008, { color: 'brown', type: 'bp', freq: 125, Q: 0.6, dur: 0.14, peak: peak * 0.7 * k, attack: 0.002 });
    hit(v, t + d + 0.012, 175, 0.07, peak * 0.27 * k, 'stone');
  }
}
export function jetLanding(v: Voice, t: number, duration = 14, size: JetSize = 'airliner', distant = false): void {
  const td = duration * 0.357;
  jetEngine(v, t, { duration, size,
    spool: [[0, 0.47], [td, 0.4], [td + 0.9, 0.28], [td + 2.5, 0.86], [duration - 2, 0.27], [duration, 0.18]],
    level: [[0, 0], [1.4, 0.17], [td, 0.6], [td + 1, 0.48], [td + 2.3, 1], [duration - 2, 0.3], [duration, 0]],
    pan: [[0, -0.65], [td, -0.08], [duration, 0.57]],
    exhaust: [[0, 0.08], [td, 0.32], [td + 1.5, 0.85], [duration, 0.96]],
    doppler: [[0, 1.15], [td, 1.01], [td + 2, 0.95], [duration, 0.98]],
    cutoff: [[0, distant ? 1100 : 4700], [td, distant ? 1400 : 6900], [duration, 600]], reverse: 1,
  });
  if (!distant) touchdown(v, t + td, 0.29);
  layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 160], [duration, 210]], Q: 0.55 },
    gain: [[0, 0], [td - 0.01, 0], [td + 0.08, distant ? 0.06 : 0.22], [td + 4, 0.16], [duration, 0]], width: 0.08 });
}
export function jetStart(v: Voice, t: number, shutdown = false): void {
  const duration = 9;
  jetEngine(v, t, { duration,
    spool: shutdown ? [[0, 0.3], [0.5, 0.29], [3, 0.12], [6, 0.025], [9, 0]] : [[0, 0], [2, 0.015], [3.1, 0.065], [6, 0.28], [9, 0.31]],
    level: shutdown ? [[0, 0], [0.05, 0.8], [0.65, 0.62], [2.5, 0.32], [6, 0.13], [9, 0]] : [[0, 0], [1, 0.07], [3, 0.1], [3.35, 0.38], [6, 0.8], [8.4, 0.8], [9, 0]],
    exhaust: [[0, 0.45], [9, 0.6]],
  });
  layer(v, t, { src: 'white', filter: { type: 'bandpass', f: shutdown ? [[0, 2250], [3, 1120], [9, 180]] : [[0, 230], [3, 1250], [6, 2300], [9, 2200]], Q: 3 },
    gain: shutdown ? [[0, 0], [0.05, 0.09], [4, 0.04], [9, 0]] : [[0, 0], [1, 0.04], [3, 0.085], [6, 0.04], [9, 0]], motion: 0.6 });
  if (!shutdown) v.noise(t + 3.1, { color: 'pink', type: 'bp', freq: 130, freq2: 230, Q: 0.55, dur: 0.9, peak: 0.3, attack: 0.08 });
}
export function reverseThrust(v: Voice, t: number): void {
  hit(v, t, 250, 0.1, 0.09, 'stone');
  jetEngine(v, t, { duration: 5, spool: [[0, 0.32], [0.65, 0.7], [1.4, 0.9], [3, 0.74], [5, 0.24]],
    level: [[0, 0], [0.2, 0.18], [0.8, 0.83], [1.6, 1], [3.2, 0.65], [5, 0]], exhaust: [[0, 0.6], [1, 1], [5, 1]], reverse: 1 });
}

/** A blade pulse has a different spectrum from a digital sawtooth. Engine
 * pairs beat slowly; the noise is amplitude-modulated at blade passage too. */
export function propeller(v: Voice, t: number, kind: 'takeoff' | 'turboprop' | 'piston'): void {
  const takeoff = kind === 'takeoff', piston = kind === 'piston', duration = takeoff ? 12 : 8;
  const fl = flight(duration, takeoff ? 7 : 4, piston ? 45 : 65, takeoff ? 100 : piston ? 60 : 90, Math.ceil(duration * 24));
  const level: Pts = takeoff ? [[0, 0], [1.2, 0.2], [3.4, 0.65], [7.5, 1], [10, 0.36], [12, 0]] : fl.level;
  const rpm = curve(duration, at => (piston ? 81 : takeoff ? 67 + 37 * Math.min(1, at / 3) : 101) * value(fl.doppler, at));
  for (const [ratio, pan, k] of piston ? [[1, 0, 1]] : [[0.998, -0.12, 0.7], [1.003, 0.12, 0.7]]) {
    layer(v, t, { src: 'sine', harmonics: piston ? [0.7, 0.85, 0.42, 0.35, 0.23, 0.16, 0.12, 0.08] : [0.32, 1, 0.73, 0.49, 0.3, 0.24, 0.18, 0.1, 0.08, 0.035],
      f: scale(rpm, ratio), filter: { type: 'lowpass', f: scale(fl.cutoff, piston ? 0.19 : 0.29), Q: 0.55 },
      gain: scale(level, 0.12 * k), pan: fl.pan.map(([at, x]) => [at, clamp(x + pan, -0.9, 0.9)] as const), frequencyJitter: 0.002, motion: 0.8 });
  }
  layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: scale(rpm, piston ? 2.2 : 3.8), Q: 0.65 },
    gain: scale(level, piston ? 0.38 : 0.5), pan: fl.pan, pulse: { frequency: rpm, depth: 0.48 }, width: 0.18, motion: 0.75 });
  layer(v, t, { src: 'pink', highpass: 450, filter: { type: 'lowpass', f: scale(fl.cutoff, 0.56), Q: 0.6 },
    gain: scale(level, piston ? 0.28 : 0.42), pan: fl.pan, width: 0.28, motion: 0.8 });
  if (piston) layer(v, t, { src: 'sine', harmonics: [0.6, 0.26, 1, 0.23, 0.51, 0.15, 0.08], f: scale(rpm, 0.5),
    filter: { type: 'lowpass', f: [[0, 700], [duration, 700]], Q: 0.65 }, gain: scale(level, 0.08), pan: fl.pan, frequencyJitter: 0.008 });
  else layer(v, t, { src: 'white', filter: { type: 'bandpass', f: scale(rpm, 23), Q: 2.5 },
    gain: scale(level, 0.045), pan: fl.pan, width: 0.1 });
}
export function helicopter(v: Voice, t: number): void {
  const duration = 9, fl = flight(duration, 4.5, 40, 70, 216);
  // Blade slap timing follows the SAME Doppler trajectory as the tonal body.
  let at = 0.035;
  while (at < duration - 0.1) {
    const lv = value(fl.level, at), pan = value(fl.pan, at), d = value(fl.doppler, at);
    const velocity = v.random(0.85, 1.1);
    v.noise(t + at, { color: 'pink', type: 'bp', freq: 170 * d, Q: 0.6, dur: 0.061 / d, peak: 0.57 * lv * velocity, attack: 0.0025, pan });
    v.noise(t + at + 0.004, { color: 'white', type: 'bp', freq: 650 * d, Q: 0.7, dur: 0.026 / d, peak: 0.13 * lv * velocity, attack: 0.0015, pan });
    at += 1 / (10.4 * d * v.pitch);
  }
  layer(v, t, { src: 'pink', filter: { type: 'lowpass', f: scale(fl.cutoff, 0.33), Q: 0.55 },
    gain: scale(fl.level, 0.45), pan: fl.pan, pulse: { frequency: scale(fl.doppler, 20.8), depth: 0.18 }, width: 0.24, motion: 0.6 });
  layer(v, t, { src: 'sine', harmonics: [0.28, 1, 0.38, 0.16, 0.08], f: scale(fl.doppler, 132),
    filter: { type: 'lowpass', f: scale(fl.cutoff, 0.23), Q: 0.6 }, gain: scale(fl.level, 0.022), pan: fl.pan, frequencyJitter: 0.004 });
  layer(v, t, { src: 'white', filter: { type: 'bandpass', f: scale(fl.doppler, 2400), Q: 2 }, gain: scale(fl.level, 0.045), pan: fl.pan, width: 0.12 });
}

/** Continuous version of the same source palette. All layer gains and fan
 * speeds share spool inertia; RTPC zero means idle, not engine-off. */
export function turbofanLoop(v: Voice, t: number, param = 'thrust', size: JetSize = 'airliner'): void {
  const p = ENGINES[size], get = () => clamp(v.param(param, size === 'apu' ? 0.4 : 0.1), 0, 1);
  const core = bed(v, t, 'pink', 'bandpass', p.body, 0.5), roar = bed(v, t, 'pink', 'bandpass', 950, 0.55);
  const inlet = bed(v, t, 'white', 'bandpass', p.fan, 4.5), air = bed(v, t, 'pink', 'bandpass', 3100, 0.6);
  const sub = bed(v, t, 'brown', 'lowpass', 120, 0.55);
  const tones = [hum(v, t, p.fan * 0.995), hum(v, t, p.fan * 1.006)];
  let previous = get();
  const update = (time: number, initial = false) => {
    const x = get(), tc = initial ? 0.09 : x > previous ? 1.65 : 2.25; previous = x;
    const glide = (parameter: AudioParam, target: number) => parameter.setTargetAtTime(target, time, tc);
    const spool = size === 'apu' ? 0.65 + x * 0.18 : 0.34 + x * 0.66;
    glide(core.g.gain, (0.16 + x * 0.35) * p.mass); glide(core.fl.frequency, p.body * (0.7 + x * 0.8));
    glide(roar.g.gain, 0.18 + x * x * 0.86); glide(roar.fl.frequency, (650 + x * 1150) * p.color);
    glide(inlet.g.gain, 0.08 + x * 0.12); glide(inlet.fl.frequency, p.fan * spool * v.pitch);
    glide(air.g.gain, 0.035 + x * 0.12); glide(air.fl.frequency, (2100 + x * 1500) * p.color);
    glide(sub.g.gain, (0.055 + x * 0.1) * p.mass);
    tones.forEach((tone, i) => { glide(tone.o.frequency, p.fan * spool * (i ? 1.006 : 0.995) * v.pitch); glide(tone.g.gain, (i ? 0.006 : 0.009) * (0.6 + x * 0.4)); });
  };
  v.onParam(param, (_, time) => update(time)); update(t, true);
}
