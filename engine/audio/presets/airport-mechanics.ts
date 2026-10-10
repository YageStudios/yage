/** Mechanical sources for the airport bank. Engine cycles, paper feed and
 * pressure-driven whistles are not interchangeable sustained synth notes. */
import type { Voice } from '../voice';
import { layer, scale, type Pts } from './airport-kit';

/** Exhaust pulses plus chassis/combustion noise. f0/f1 are firing rates, not a
 * musical bass note; both tonal and turbulent parts follow the same speed. */
export function diesel(v: Voice, t: number, duration: number, f0: number, f1: number, peak = 0.12, pan?: Pts): void {
  const speed: Pts = [[0, f0], [duration * 0.5, f1], [duration, f0]];
  const envelope: Pts = [[0, 0], [duration * 0.12, peak], [duration * 0.86, peak], [duration, 0]];
  layer(v, t, { src: 'sine', harmonics: [0.62, 0.22, 1, 0.3, 0.45, 0.16, 0.2, 0.09, 0.1, 0.05],
    f: speed, highpass: 32, filter: { type: 'lowpass', f: [[0, 460], [duration * 0.5, 790], [duration, 460]], Q: 0.55 },
    gain: scale(envelope, 0.55), frequencyJitter: 0.014, pan });
  layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: scale(speed, 5.1), Q: 0.65 },
    gain: scale(envelope, 2.7), pulse: { frequency: speed, depth: 0.62 }, pan, width: 0.12, motion: 1.2 });
  layer(v, t, { src: 'pink', highpass: 150, filter: { type: 'lowpass', f: [[0, 780], [duration, 780]], Q: 0.6 },
    gain: scale(envelope, 1.4), pan, width: 0.1, motion: 1.1 });
}

/** Intermittent thermal stepper/paper feed. Motor commutation is low in the
 * mix; uneven advancement and sheet friction carry the event. No square drone. */
export function printerFeed(v: Voice, t: number, duration: number, peak = 1): void {
  let at = 0, segment = 0;
  while (at < duration - 0.04) {
    const d = Math.min(duration - at, v.random(0.18, 0.31)), f = 128 + (segment % 3) * 13;
    const envelope: Pts = [[0, 0], [0.014, 1], [Math.max(0.015, d - 0.025), 0.85], [d, 0]];
    layer(v, t + at, { src: 'sine', harmonics: [0.3, 0.64, 0.23, 0.4, 0.18, 0.11],
      f: [[0, f * 0.75], [0.02, f], [d, f * 0.93]],
      filter: { type: 'bandpass', f: [[0, 870], [d, 1000]], Q: 0.75 },
      gain: scale(envelope, peak * 0.024), frequencyJitter: 0.009, motion: 0.5 });
    layer(v, t + at, { src: 'pink', filter: { type: 'bandpass', f: [[0, 1160], [d, 1380]], Q: 0.8 },
      gain: scale(envelope, peak * 0.13), pulse: { frequency: [[0, f], [d, f * 0.94]], depth: 0.35 }, width: 0 });
    v.surface(t + at, { dur: d, rate: 150, grain: 0.0025, freq: 2700, freqEnd: 2100,
      peak: 0.035 * peak, attack: 0.008, release: 0.014, width: 0.03 });
    at += d + v.random(0.012, 0.032); segment++;
  }
}

/** Pea flutter modulates a pressure-excited cavity, not a siren-like pitch LFO. */
export function whistle(v: Voice, t: number, duration: number, peak = 0.12, pan = 0): void {
  const envelope: Pts = [[0, 0], [0.012, 1], [duration * 0.75, 0.85], [duration, 0]];
  const p: Pts = [[0, pan], [duration, pan]];
  layer(v, t, { src: 'white', filter: { type: 'bandpass', f: [[0, 2840], [duration, 2740]], Q: 15 },
    gain: scale(envelope, peak * 3.2), pulse: { frequency: [[0, 29], [duration, 37]], depth: 0.55 }, pan: p, width: 0 });
  layer(v, t, { src: 'sine', f: [[0, 2840], [duration, 2790]], gain: scale(envelope, peak * 0.12),
    pulse: { frequency: [[0, 29], [duration, 37]], depth: 0.35 }, pan: p, frequencyJitter: 0.003 });
  v.noise(t, { color: 'pink', type: 'bp', freq: 3200, Q: 0.6, dur: duration, peak: peak * 0.15, attack: 0.008, pan });
}
