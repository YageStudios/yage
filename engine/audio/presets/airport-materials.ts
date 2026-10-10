/** Tactile materials for the airport only. Contacts have a head, a body and a short settle;
 * metal is not a pure bell, and weight is not a laser-like two-octave kick sweep. */
import type { Voice } from '../voice';
import type { MaterialVoice } from '../types';
import { clamp } from '../dsp';
import { crunch as fractures, bubble } from '../sfx/feel';
import type { SnapOptions, PunchOptions, CrunchOptions, ImpactOptions } from '../sfx/feel';
export { m, pluck } from './design';
export { bubble };

export function snap(v: Voice, t: number, o: SnapOptions = {}): void {
  const peak = o.peak ?? 0.35, dur = clamp(o.dur ?? 0.004, 0.0015, 0.012);
  v.noise(t, { color: 'white', type: 'bp', freq: Math.min(o.freq ?? 3200, 4800), Q: 0.65,
    dur, peak: peak * 0.8, attack: 0.0005, pan: o.pan });
  // Broader skin/contact energy replaces the old ultrasonic tick.
  v.noise(t, { color: 'pink', type: 'lp', freq: 1600, dur: dur * 1.8,
    peak: peak * 0.22, attack: 0.0006, pan: o.pan });
}
export function punch(v: Voice, t: number, o: PunchOptions = {}): void {
  const w = clamp(o.weight ?? 0.5, 0, 1), f = o.freq ?? 62 + (1 - w) * 42, peak = o.peak ?? 0.55;
  const dur = 0.075 + w * 0.18;
  v.tone(t, { f: f * 1.22, f2: f, dur, peak: peak * 0.46, attack: 0.001,
    freqs: [{ f: f * 1.22, at: 0 }, { f: f * 1.025, at: 0.022 }, { f, at: dur }], pan: o.pan });
  // Audible on small speakers as well as in the sub band.
  v.resonate(t + 0.001, { f: f * 2.7, dur: dur * 0.55, peak: peak * 0.16, material: 'wood',
    modes: [1, 1.43, 2.18], strike: 0.08, bloom: 0.0015, width: 0.08, pan: o.pan });
  v.noise(t, { color: 'brown', type: 'bp', freq: 180, Q: 0.65, dur: dur * 0.6,
    peak: peak * 0.85, attack: 0.001, pan: o.pan });
}
export function hit(v: Voice, t: number, f: number, dur: number, peak = 0.35, material: MaterialVoice = 'wood', pan = 0, modes?: readonly number[]): void {
  const hard = ['bronze', 'glass', 'tine', 'wire'].includes(material);
  const contact = dur <= 0.25 || material === 'wood' || material === 'stone' || material === 'ceramic';
  if (!contact) {
    v.resonate(t, { f, dur, peak: peak * 0.8, material, pan, modes,
      strike: hard ? 0.14 : 0.32, bloom: 0.0015, width: 0.1 });
    return;
  }
  // A struck object is excited across a band. Most short airport contacts used
  // to be almost pure pitched notes (woodblocks, even for shoes and tray plastic).
  const length = clamp(dur, 0.008, 0.22);
  const resonance = material === 'wood' ? 1.25 : material === 'stone' ? 0.95 : hard ? 2.6 : 1.7;
  v.noise(t, { color: 'white', type: 'bp', freq: clamp(f, 150, 5000), Q: resonance,
    dur: length, peak: peak * (hard ? 0.78 : 1.2), attack: Math.min(0.0011, length * 0.08), pan });
  v.noise(t + 0.0007, { color: 'pink', type: 'bp', freq: clamp(f * 2.35, 500, 5600), Q: 0.6,
    dur: Math.min(0.025, length * 0.62), peak: peak * 0.5, attack: 0.0006, pan });
  const ring = hard ? 0.31 : material === 'ceramic' ? 0.17 : 0.09;
  v.resonate(t + 0.001, { f, dur: length * (hard ? 0.85 : 0.53), peak: peak * ring,
    material, pan, modes: modes ?? (material === 'wood' ? [1, 1.71, 2.63] : undefined), strike: 0, bloom: 0.001, width: 0.08 });
}
export function metallic(v: Voice, t: number, f: number, dur: number, peak = 0.3, pan = 0,
  ratios: readonly number[] = [1, 1.483, 2.137, 2.672, 3.89]): void {
  hit(v, t, f, dur * 0.85, peak, 'bronze', pan, ratios);
  v.noise(t, { color: 'pink', type: 'bp', freq: clamp(f * 1.5, 800, 4200), Q: 0.75,
    dur: Math.min(0.027, dur * 0.5), peak: peak * 0.2, attack: 0.0008, pan });
  // A damped second contact gives the metal a physical seat instead of FM fizz.
  if (dur > 0.08) v.resonate(t + 0.013, { f: f * 0.51, dur: Math.min(dur * 0.4, 0.1), peak: peak * 0.1,
    material: 'bronze', modes: [1, 1.51], strike: 0, bloom: 0.002, width: 0.08, pan });
}
export function thud(v: Voice, t: number, f = 95, peak = 0.4, dur = 0.24): void {
  punch(v, t, { freq: f, weight: clamp((dur - 0.075) / 0.18, 0, 1), peak });
  hit(v, t + 0.003, f * 2.1, dur * 0.48, peak * 0.24, 'stone');
}
export function air(v: Voice, t: number, dur: number, f: number, end: number, peak = 0.15, pan = 0,
  color: 'white' | 'pink' | 'brown' = 'pink'): void {
  v.noise(t, { dur, color, type: 'bp', freq: f * v.brightness, freq2: end * v.brightness, Q: 0.55,
    peak, pan, fade: { in: Math.min(0.035, dur * 0.14), hold: dur * 0.32, out: dur * 0.6 } });
}
export function crunch(v: Voice, t: number, o: CrunchOptions): void {
  fractures(v, t, { ...o, centroid: o.centroid * 0.85, air: (o.air ?? 0) * 0.35,
    peak: (o.peak ?? 0.3) * 0.85, width: Math.min(o.width ?? 0.3, 0.5) });
}
export function impact(v: Voice, t: number, o: ImpactOptions = {}): void {
  const w = clamp(o.weight ?? 0.5, 0, 1), peak = o.peak ?? 0.5;
  snap(v, t, { peak: peak * (0.25 + w * 0.18), freq: 2800 + (1 - w) * 1100, pan: o.pan });
  punch(v, t + 0.001, { weight: w, peak: peak * (0.65 + w * 0.3), pan: o.pan });
  hit(v, t + 0.003, o.freq ?? 240 - w * 100, 0.08 + w * 0.24, peak * 0.5, o.material ?? 'wood', o.pan);
  // Small, late material settle; strongest energy remains in the first contact.
  hit(v, t + 0.026 + w * 0.023, (o.freq ?? 200) * 1.35, 0.035 + w * 0.035,
    peak * 0.09, o.material ?? 'wood', o.pan);
  if ((o.debris ?? 0) > 0) crunch(v, t + 0.012, { dur: 0.06 + w * 0.17,
    events: Math.round(5 + (o.debris ?? 0) * 18), centroid: 2100, spread: 1.5, decay: 0.88,
    grain: 0.005, peak: peak * 0.4 * (o.debris ?? 0), cluster: 0.65, pan: o.pan, width: 0.35 });
}
/** A palm contact and a short hand-cavity pressure release. No snare-like
 * three-hit flam; separate people can retain their own hand-size spectrum. */
export function clap(v: Voice, t: number, peak: number, pan = 0, hand = 1): void {
  const f = 1120 * hand;
  v.noise(t, { color: 'white', type: 'bp', freq: f * 1.6, Q: 0.75,
    dur: 0.008, peak: peak * 1.15, attack: 0.0005, pan });
  v.noise(t + 0.0018, { color: 'white', type: 'bp', freq: f, Q: 1.1,
    dur: 0.058, peak: peak * 1.32, attack: 0.0007, pan });
  v.noise(t + 0.004, { color: 'pink', type: 'bp', freq: f * 0.38, Q: 0.75,
    dur: 0.065, peak: peak * 0.72, attack: 0.001, pan });
}
