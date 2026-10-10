/** Airport-only non-verbal voices. Procedural, not speech recordings.
 *
 * The old airport voice was a periodic organ/reed with a separate hiss. Here an
 * asymmetric glottal-flow derivative excites a moving, cascaded vocal tract.
 * Breath shares that tract; closures, consonants and breaths interrupt voicing.
 * One phrase has one speaker, one continuous phase and one pressure contour.
 * No vibrato oscillator, dry oscillator bypass, per-syllable pitch lottery or
 * time-stretching. Pitch changes do not move formants or change gesture length.
 *
 * Design references and the limits of verification: docs/airport-revision-2.md.
 */
import type { Voice } from '../voice';
import { clamp } from '../dsp';

export type Mouth = readonly [number, number, number];
export interface VocalFrame {
  at: number; pitch: number; mouth: Mouth; gain: number;
  voiced?: number; breath?: number; friction?: number;
}
export interface HumanOptions {
  peak?: number; pan?: number; pitch?: number; size?: number;
  breath?: number; rough?: number; cutoff?: number;
  channel?: 'close' | 'crowd' | 'radio' | 'pa';
}
export type HumanGesture = 'sigh' | 'huff' | 'groan' | 'hum' | 'cough' | 'yawn'
  | 'laugh' | 'giggle' | 'fuss' | 'cry' | 'cheer';

const A: Mouth = [720, 1160, 2520], UH: Mouth = [520, 1210, 2450];
const OH: Mouth = [460, 850, 2460], OO: Mouth = [300, 840, 2250];
const EH: Mouth = [560, 1720, 2500], M: Mouth = [260, 1060, 2180];
const VOWEL: readonly Mouth[] = [UH, OH, EH, A, OO, [390, 1760, 2530]];
const smooth = (x: number) => x * x * (3 - 2 * x);
const mix = (a: number, b: number, x: number) => a + (b - a) * x;

/** Pure PCM generator exposed in this module for repeatability/tract tests.
 * 24 kHz is sufficient for this deliberately non-verbal, close/mid-distance bank;
 * native Web Audio resamples the result. Work is O(samples), independent of nodes.
 */
export function synthesizeHuman(frames: readonly VocalFrame[], random: () => number,
  options: { sampleRate?: number; pitch?: number; brightness?: number; rough?: number } = {}): Float32Array {
  if (frames.length < 2 || frames[0].at !== 0) throw new RangeError('airport human: need at least two frames');
  let last = -1;
  for (const f of frames) {
    if (!Number.isFinite(f.at) || f.at < 0 || f.at < last || !Number.isFinite(f.pitch) || f.pitch <= 0
      || !Number.isFinite(f.gain) || f.gain < 0 || f.mouth.length !== 3
      || f.mouth.some(x => !Number.isFinite(x) || x <= 0)
      || [f.voiced, f.breath, f.friction].some(x => x !== undefined && (!Number.isFinite(x) || x < 0 || x > 1)))
      throw new RangeError('airport human: invalid vocal frame');
    last = f.at;
  }
  const sr = options.sampleRate ?? 24000, pitch = options.pitch ?? 1;
  const bright = options.brightness ?? 1, rough = options.rough ?? 0.1;
  if (!Number.isFinite(sr) || sr < 8000 || sr > 96000 || !Number.isFinite(pitch) || pitch <= 0
    || !Number.isFinite(bright) || bright <= 0 || !Number.isFinite(rough) || rough < 0 || rough > 1
    || !(last > 0) || last > 30) throw new RangeError('airport human: invalid render options');
  const n = Math.max(2, Math.round(last * sr)), pcm = new Float32Array(n);
  const y1 = [0, 0, 0, 0], y2 = [0, 0, 0, 0];
  const b = [0, 0, 0, 0], c = [0, 0, 0, 0], a = [0, 0, 0, 0];
  const db = [0, 0, 0, 0], dc = [0, 0, 0, 0], da = [0, 0, 0, 0];
  let frame = 0, phase = random(), cyclePitch = 1, shimmer = 1;
  let breathNoise = 0, slow = 0, prior = 0, dcBlock = 0, frictionLP = 0;
  let energy = 0, maximum = 0, active = 0;
  const bw = [95, 140, 210, 300], block = 32;
  for (let i = 0; i < n; i++) {
    const time = i / sr;
    while (frame < frames.length - 2 && time >= frames[frame + 1].at) frame++;
    const from = frames[frame], to = frames[frame + 1];
    const x = smooth(clamp((time - from.at) / Math.max(1 / sr, to.at - from.at), 0, 1));
    const amplitude = mix(from.gain, to.gain, x);
    const voiced = mix(from.voiced ?? 1, to.voiced ?? 1, x);
    const air = mix(from.breath ?? 0.12, to.breath ?? 0.12, x);
    const friction = mix(from.friction ?? 0, to.friction ?? 0, x);
    const f0 = clamp(mix(from.pitch, to.pitch, x) * pitch, 55, 900);
    if (i % block === 0) {
      for (let j = 0; j < 4; j++) {
        const freq = clamp((j < 3 ? mix(from.mouth[j], to.mouth[j], x) : 3550) * clamp(bright, 0.78, 1.3), 150, sr * 0.43);
        const r = Math.exp(-Math.PI * (bw[j] + air * (180 + j * 60) + rough * 30) / sr);
        const nextB = 2 * r * Math.cos(2 * Math.PI * freq / sr), nextC = -r * r;
        // Unity DC gain: a stable all-pole tract, NOT a sum of organ oscillators.
        const nextA = 1 - nextB - nextC;
        if (i === 0) { b[j] = nextB; c[j] = nextC; a[j] = nextA; }
        db[j] = (nextB - b[j]) / block; dc[j] = (nextC - c[j]) / block; da[j] = (nextA - a[j]) / block;
      }
    }
    const white = random() * 2 - 1;
    breathNoise += 0.48 * (white - breathNoise);
    slow += 0.0012 * (white - slow);
    phase += f0 / sr * cyclePitch;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      cyclePitch = 1 + (random() * 2 - 1) * (0.004 + rough * 0.012);
      shimmer = 1 + (random() * 2 - 1) * (0.025 + rough * 0.13);
    }
    const opening = 0.47 + air * 0.12, closing = 0.052 + air * 0.12;
    // Derivative of a smooth asymmetric opening/closing flow pulse. No hard reset.
    const glottis = phase < opening ? closing / opening * Math.sin(Math.PI * phase / opening)
      : phase < opening + closing ? -Math.sin(Math.PI * (phase - opening) / closing) : 0;
    const breathGate = 1 - voiced * 0.35 * (phase < opening + closing ? 0 : 1);
    let signal = (glottis * voiced * shimmer + breathNoise * (0.025 + air * 0.28) * breathGate)
      * amplitude * (1 + slow * 1.4);
    for (let j = 0; j < 4; j++) {
      b[j] += db[j]; c[j] += dc[j]; a[j] += da[j];
      const next = a[j] * signal + b[j] * y1[j] + c[j] * y2[j];
      y2[j] = y1[j]; y1[j] = next; signal = next;
    }
    // Unvoiced consonants are born at the mouth, not through the glottis.
    frictionLP += 0.65 * (white - frictionLP);
    signal += (white - frictionLP) * friction * amplitude * 0.14;
    dcBlock = signal - prior + 0.982 * dcBlock; prior = signal;
    const edge = smooth(Math.min(1, time / 0.006)) * smooth(Math.min(1, (last - time) / 0.018));
    const value = dcBlock * edge;
    pcm[i] = value; maximum = Math.max(maximum, Math.abs(value));
    if (amplitude > 0.08) { energy += value * value; active++; }
  }
  // One static gain for a complete performance. Does not flatten its syllables.
  const gain = Math.min(0.78 / Math.max(1e-9, maximum), 0.19 / Math.max(1e-9, Math.sqrt(energy / Math.max(1, active))));
  for (let i = 0; i < n; i++) pcm[i] *= gain;
  pcm[0] = 0; pcm[n - 1] = 0;
  return pcm;
}

export function performHuman(v: Voice, t: number, frames: readonly VocalFrame[], o: HumanOptions = {}): number {
  if (v._stopped) return t;
  const duration = frames[frames.length - 1].at, sr = 24000;
  const samples = synthesizeHuman(frames, () => v.random(), {
    sampleRate: sr, pitch: v.pitch, brightness: v.brightness, rough: o.rough ?? 0.1,
  });
  const buffer = v.ctx.createBuffer(1, samples.length, sr); buffer.getChannelData(0).set(samples);
  const src = v.ctx.createBufferSource(), level = v.ctx.createGain(), pan = v.ctx.createStereoPanner();
  const hp = v.ctx.createBiquadFilter(), lp = v.ctx.createBiquadFilter();
  const channel = o.channel ?? 'close';
  src.buffer = buffer; level.gain.value = o.peak ?? 0.3; pan.pan.value = clamp(o.pan ?? 0, -1, 1);
  hp.type = 'highpass'; hp.frequency.value = channel === 'radio' ? 330 : channel === 'pa' ? 230 : 75; hp.Q.value = 0.65;
  lp.type = 'lowpass'; lp.frequency.value = Math.min(o.cutoff ?? (channel === 'radio' ? 2750 : channel === 'crowd' ? 2100 : 5800), v.ctx.sampleRate * 0.43); lp.Q.value = 0.55;
  src.connect(hp); hp.connect(lp); lp.connect(level); level.connect(pan); pan.connect(v.dest);
  v.own(src, hp, lp, level, pan); src.start(t); src.stop(t + duration + 0.005); v._track(t + duration + 0.025);
  return duration;
}

/** Speech-shaped, deliberately non-lexical phrase. Vowels connect through actual
 * closures/consonants; emphasis sits on a word, not on every individual note. */
export function humanPhrase(v: Voice, t: number, o: HumanOptions & { syllables?: number; duration?: number; mood?: number } = {}): number {
  const count = Math.max(1, Math.min(24, Math.round(o.syllables ?? 5)));
  const duration = o.duration ?? count * 0.185;
  const root = o.pitch ?? v.random(112, 148), size = o.size ?? (root > 170 ? 1.1 : 0.96);
  const mood = clamp(o.mood ?? 0, 0, 1), frames: VocalFrame[] = [];
  const mouth = (m: Mouth): Mouth => [m[0] * size, m[1] * size, m[2] * size];
  const widths = Array.from({ length: count }, (_, i) => v.random(0.85, 1.15) * (i % 3 === 1 ? 1.22 : 1));
  const total = widths.reduce((a, b) => a + b, 0);
  let at = 0;
  for (let i = 0; i < count; i++) {
    const dur = duration * widths[i] / total;
    const vowel = VOWEL[Math.floor(v.random(0, VOWEL.length))];
    const p = root * (1.055 - 0.12 * i / count + (i % 3 === 1 ? 0.035 : -0.01));
    const stress = i % 3 === 1 ? 1 : 0.68 + mood * 0.08;
    const fricative = i > 0 && i % 4 === 2;
    frames.push({ at, pitch: p, mouth: mouth(M), gain: i === 0 || i % 3 === 0 ? 0 : stress * 0.2, voiced: 0.4, breath: 0.18 });
    frames.push({ at: at + dur * 0.13, pitch: p, mouth: mouth(M), gain: stress * 0.42, voiced: fricative ? 0 : 0.6, breath: 0.2, friction: fricative ? 0.85 : 0 });
    frames.push({ at: at + dur * 0.35, pitch: p * 1.018, mouth: mouth(vowel), gain: stress, voiced: 0.94, breath: o.breath ?? 0.13 });
    frames.push({ at: at + dur * 0.7, pitch: p * 0.985, mouth: mouth(vowel), gain: stress * 0.85, voiced: 0.95, breath: o.breath ?? 0.12 });
    frames.push({ at: at + dur * 0.96, pitch: p * 0.97, mouth: mouth(i % 2 ? UH : M), gain: i % 3 === 2 ? 0.03 : stress * 0.25, voiced: 0.65, breath: 0.2 });
    at += dur;
  }
  frames.push({ at: duration, pitch: root * 0.89, mouth: mouth(M), gain: 0, voiced: 0, breath: 0 });
  performHuman(v, t, frames, o); return duration;
}

export function humanVocal(v: Voice, t: number, o: HumanOptions & {
  contour: number[]; dur: number; vowel?: readonly [number, number]; to?: readonly [number, number];
}): void {
  const root = o.contour[0], from = o.vowel ?? [500, 900], to = o.to ?? from;
  const duration = o.dur, air = o.breath ?? 0.2;
  const frames: VocalFrame[] = [];
  const steps = Math.max(8, o.contour.length * 2);
  for (let i = 0; i <= steps; i++) {
    const x = i / steps, index = x * (o.contour.length - 1), j = Math.min(o.contour.length - 2, Math.floor(index));
    const p = mix(o.contour[Math.max(0, j)] ?? root, o.contour[j + 1] ?? root, index - Math.max(0, j));
    const edge = Math.sin(Math.PI * Math.min(1, x * 5) / 2) * Math.sin(Math.PI * Math.min(1, (1 - x) * 3) / 2);
    frames.push({ at: duration * x, pitch: p, mouth: [mix(from[0], to[0], x), mix(from[1], to[1], x), 2520],
      gain: edge, voiced: air > 0.6 ? Math.max(0.05, (1 - x) * 0.55) : 0.95, breath: air });
  }
  performHuman(v, t, frames, o);
}

/** Authored breath gestures, rather than the same vowel with a different label. */
export function humanGesture(v: Voice, t: number, kind: HumanGesture, o: HumanOptions = {}): number {
  const root = o.pitch ?? (kind === 'giggle' ? 335 : kind === 'fuss' || kind === 'cry' ? 435 : v.random(120, 154));
  const frames: VocalFrame[] = [];
  const push = (at: number, pitch: number, mouth: Mouth, gain: number, voiced = 0.95, breath = 0.16, friction = 0) => {
    const size = o.size ?? (root > 300 ? 1.25 : root > 180 ? 1.08 : 1);
    frames.push({ at, pitch: root * pitch, mouth: [mouth[0] * size, mouth[1] * size, mouth[2] * size], gain, voiced, breath, friction });
  };
  switch (kind) {
    case 'sigh':
      push(0, 1.04, OH, 0, 0, 0.8); push(0.09, 1.02, A, 0.3, 0.12, 0.85);
      push(0.24, 1, UH, 1, 0.4, 0.75); push(0.55, 0.88, OH, 0.65, 0.13, 0.9);
      push(0.93, 0.83, OO, 0.16, 0, 0.9); push(1.1, 0.82, OO, 0, 0, 0.6); break;
    case 'huff':
      push(0, 1, OH, 0, 0, 0.7); push(0.036, 0.99, UH, 1, 0.1, 1);
      push(0.11, 0.96, OH, 0.55, 0, 1); push(0.3, 0.95, OO, 0, 0, 0.8); break;
    case 'groan':
      push(0, 1.08, M, 0); push(0.12, 1.03, UH, 0.8, 0.95, 0.1);
      push(0.35, 0.99, UH, 1, 0.95, 0.12); push(0.67, 0.89, OH, 0.6, 0.8, 0.25);
      push(0.94, 0.83, M, 0, 0.25, 0.4); break;
    case 'hum':
      push(0, 1, M, 0, 0.98, 0.04); push(0.07, 0.98, M, 0.78, 0.98, 0.04);
      push(0.29, 0.98, M, 0.9, 0.98, 0.05); push(0.43, 1.14, M, 0.72, 0.98, 0.08);
      push(0.56, 1.12, M, 0, 0.8, 0.1); break;
    case 'cough':
      for (const [offset, weight] of [[0, 1], [0.25, 0.68]]) {
        push(offset, 1.08, UH, 0, 0, 0.1); push(offset + 0.017, 1.1, A, weight, 0.32, 1, 0.25);
        push(offset + 0.058, 0.95, UH, weight * 0.65, 0.8, 0.55);
        push(offset + 0.12, 0.86, OH, weight * 0.12, 0.05, 0.85); push(offset + 0.2, 0.83, OH, 0, 0, 0.8);
      } break;
    case 'yawn':
      push(0, 0.94, M, 0, 0, 0.65); push(0.16, 0.99, OO, 0.34, 0.25, 0.9);
      push(0.5, 1.16, A, 0.9, 0.8, 0.35); push(0.81, 1.17, A, 1, 0.9, 0.3);
      push(1.06, 1.02, UH, 0.7, 0.6, 0.5); push(1.35, 0.86, M, 0.25, 0.15, 0.8);
      push(1.6, 0.83, M, 0, 0, 0.8); break;
    case 'laugh': case 'giggle': {
      const beats = kind === 'giggle' ? [0, 0.14, 0.29, 0.49, 0.7, 0.94] : [0, 0.2, 0.43, 0.71];
      beats.forEach((at, i) => {
        const d = kind === 'giggle' ? 0.115 : 0.16, p = (1.09 - i * 0.037) * v.random(0.985, 1.015), w = (1 - i * 0.085) * v.random(0.92, 1);
        push(at, p, OH, 0.02, 0, 0.9); push(at + 0.022, p * 1.025, A, w, 0.88, 0.3);
        push(at + d * 0.58, p, kind === 'giggle' ? EH : UH, w * 0.7, 0.96, 0.2);
        push(at + d, p * 0.95, OH, 0, 0.05, 0.8);
      });
      push(kind === 'giggle' ? 1.105 : 0.94, 0.88, OH, 0.1, 0, 0.9);
      push(kind === 'giggle' ? 1.2 : 1.08, 0.88, OH, 0, 0, 0.8); break;
    }
    case 'fuss': case 'cry': {
      const count = kind === 'cry' ? 3 : 2, period = kind === 'cry' ? 0.96 : 0.76;
      for (let i = 0; i < count; i++) {
        const at = i * period, weight = kind === 'cry' ? 0.93 - i * 0.07 : 0.5 + i * 0.13;
        push(at, 0.97, EH, 0, 0.1, 0.7); push(at + 0.07, 1.03, EH, weight * 0.8, 0.86, 0.32);
        push(at + 0.22, 1.09 - i * 0.013, A, weight, 0.96, 0.15);
        push(at + period * 0.65, 0.98, UH, weight * 0.7, 0.8, 0.33);
        push(at + period * 0.89, 0.88, M, 0.03, 0.05, 0.9);
      }
      push(count * period, 0.86, M, 0, 0, 0.8); break;
    }
    case 'cheer':
      push(0, 1, OH, 0); push(0.08, 1.06, OH, 0.5, 0.9, 0.25);
      push(0.22, 1.13, A, 1, 0.96, 0.16); push(0.52, 1.09, A, 0.8, 0.9, 0.2);
      push(0.78, 1.02, UH, 0.35, 0.7, 0.4); push(0.96, 0.96, M, 0, 0, 0.65); break;
  }
  return performHuman(v, t, frames, { ...o, rough: o.rough ?? (kind === 'groan' ? 0.42 : kind === 'cough' ? 0.35 : 0.1) });
}

interface Speaker { pitch: number; size: number; pan: number; free: number; }
const crowds = new WeakMap<Voice, Speaker[]>();
/** Persistent speakers, with turn-taking. Overlap is bounded even at extreme RTPC values. */
export function crowdPhrase(v: Voice, t: number, peak: number, pan: number, cutoff = 2200): void {
  let speakers = crowds.get(v);
  if (!speakers) {
    speakers = Array.from({ length: 8 }, (_, i) => ({ pitch: i % 3 ? v.random(110, 157) : v.random(177, 218),
      size: i % 3 ? v.random(0.92, 1.01) : v.random(1.05, 1.14), pan: -0.77 + i * 0.22, free: -1 }));
    crowds.set(v, speakers);
  }
  const available = speakers.filter(s => s.free <= t);
  if (!available.length) return;
  const speaker = available.reduce((a, b) => Math.abs(a.pan - pan) < Math.abs(b.pan - pan) ? a : b);
  const syllables = 3 + Math.floor(v.random(0, 3)), duration = v.random(0.48, 0.83);
  speaker.free = t + duration + v.random(0.15, 0.5);
  humanPhrase(v, t, { pitch: speaker.pitch, size: speaker.size, pan: speaker.pan, syllables, duration,
    peak, cutoff, channel: 'crowd', breath: 0.19 });
}
