/** Airport tycoon layer: everything a management game needs beyond the airport itself —
 * a consistent airport UI kit, build mode, economy, staff & maintenance, emergencies, weather,
 * passenger amenities, extra airside equipment and aircraft sizes, landside, time-of-day
 * ambience, and music stingers. Registered by registerAirportSounds (all IDs `apt-`).
 */
import type { GameAudio } from '../engine';
import type { Voice } from '../voice';
import type { Scene } from '../spaces';
import { diesel, printerFeed } from './airport-mechanics';
import { airportSpace, airportFinish } from './airport-feel';
import { humanGesture, humanPhrase } from './airport-human';
import { jetTakeoff, jetLanding, jetEngine, touchdown, turbofanLoop } from './airport-aircraft';
import type { SoundDefinition } from '../types';
import { clamp } from '../dsp';
import { hit, metallic, air, m, pluck } from './airport-materials';
import { snap, punch, crunch, impact, bubble } from './airport-materials';
import { STINGERS, type StingerName } from '../music/stingers';
import { parseKey } from '../music/theory';
import { AIRPORT_LEVELS } from './airport-levels';
import { bed, hum, layer, flight, scale, beep, chime, syllable, vocal, grumble, poisson, solidKey } from './airport-kit';

export const TYCOON_CATEGORIES = {
  'airport-ui': 'Airport · UI kit',
  'airport-build': 'Airport · Build mode',
  'airport-economy': 'Airport · Economy',
  'airport-staff': 'Airport · Staff & maintenance',
  'airport-emergency': 'Airport · Emergencies',
  'airport-weather': 'Airport · Weather',
  'airport-amenities': 'Airport · Amenities',
  'airport-landside': 'Airport · Landside',
  'airport-music': 'Airport · Music stingers',
} as const;
type Cat = keyof typeof TYCOON_CATEGORIES | 'airport-ground' | 'airport-aircraft' | 'airport-ambience' | 'airport-people';

export const TYCOON_PARAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'apt-amb-day': { hour: 'Time of day 0..1 = 00:00..24:00: night cleaning, morning rush, midday, evening rush, late quiet' },
  'apt-amb-night': { cleaning: 'Empty late-night hall (0) to scrubbers and vacuums working (1)' },
  'apt-amb-food-court': { busy: 'Quiet café (0) to lunchtime rush (1)' },
  'apt-amb-vip-lounge': { occupancy: 'Empty lounge (0) to full (1)' },
  'apt-amb-curbside': { traffic: 'Light drop-off (0) to gridlock with horns (1)' },
  'apt-amb-construction': { workers: 'Idle site (0) to full crew (1)' },
  'apt-amb-storm': { intensity: 'Rain on the roof (0) to violent thunderstorm (1)' },
  'apt-amb-rail': { trains: 'Quiet platform (0) to frequent trains (1)' },
  'apt-gpu-hum': { load: 'Ground power unit idle (0) to fully loaded (1)' },
  'apt-apu': { load: 'APU idle (0) to air-conditioning load (1)' },
};

// ── Shared timbres ───────────────────────────────────────────────────────────
/** Felt-tipped click: the tactile base of every UI sound. */
const felt = (v: Voice, t: number, f = 1800, peak = 0.16, pan = 0) => {
  const body = clamp(f * 0.17, 170, 520);
  hit(v, t, body, 0.038, peak * 0.82, 'wood', pan, [1, 1.58, 2.37]);
  v.tone(t, { f: body * 0.72, f2: body * 0.68, dur: 0.032, peak: peak * 0.12, attack: 0.001, pan });
  snap(v, t, { peak: peak * 0.18, freq: 2100 + f * 0.2, dur: 0.002, pan });
};
/** Soft glass/felt palette: tuned fundamental, fast sparkle, no long piercing upper mode. */
const glint = (v: Voice, t: number, midi: number, peak = 0.12, len = 0.35, pan = 0) => {
  const f = m(midi);
  v.resonate(t, { f, dur: len, peak: peak * 0.8, material: 'tine', modes: [1, 2.005], strike: 0.04, bloom: 0.003, width: 0.12, pan });
  v.tone(t, { f, dur: len * 0.7, peak: peak * 0.32, attack: 0.003, pan });
  v.resonate(t, { f: f * 3, dur: Math.min(0.07, len * 0.3), peak: peak * 0.045, material: 'glass', modes: [1], strike: 0, bloom: 0.002, pan });
};
const whoosh = (v: Voice, t: number, dur: number, from: number, to: number, peak: number, pan = 0) => {
  air(v, t, dur, from, to, peak, pan);
  v.noise(t, { color: 'brown', type: 'bp', freq: 360, freq2: 180, Q: 0.5, dur: dur * 0.85,
    peak: peak * 0.1, pan, fade: { in: dur * 0.1, hold: dur * 0.3, out: dur * 0.5 } });
};
/** Siren with Doppler: `pattern(t)` gives the source frequency; the pass geometry shifts it. */
function siren(v: Voice, t: number, dur: number, pattern: (x: number) => number, o: { speed?: number; dist?: number; peak?: number; wave?: OscillatorType } = {}): void {
  const fl = flight(dur, dur / 2, o.speed ?? 16, o.dist ?? 18, 48), steps = Math.ceil(dur / 0.03), f: [number, number][] = [];
  for (let i = 0; i <= steps; i++) { const at = i / steps * dur, k = fl.doppler[Math.min(48, Math.round(at / dur * 48))][1]; f.push([at, pattern(at) * k]); }
  layer(v, t, { src: o.wave ?? 'square', f, filter: { type: 'lowpass', f: fl.cutoff.map(([a, x]) => [a, Math.min(x, 4000)] as const), Q: 0.7 }, gain: scale(fl.level, o.peak ?? 0.12), pan: fl.pan, motion: 0 });
}
const twoTone = (hi: number, lo: number, half: number) => (x: number) => (Math.floor(x / half) % 2 ? lo : hi);
const wail = (lo: number, hi: number, period: number) => (x: number) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * x / period));
const yelp = (lo: number, hi: number, period: number) => (x: number) => lo + (hi - lo) * ((x / period) % 1);

export function registerAirportTycoonSounds(audio: GameAudio): void {
  const D = (cat: Cat, id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'room', meta: Partial<SoundDefinition> = {}): void => {
    const space = airportSpace(cat, scene, id);
    const tail = space.wet ? (space.decay ?? 0) * 1.12 + 0.12 + (space.preDelay ?? 0) : space.early ? 0.08 : 0.02;
    audio.define(id, { category: cat, bus: cat === 'airport-ambience' ? 'ambient' : cat === 'airport-music' ? 'music' : 'sfx', name, hint, gain: (meta.gain ?? 0.9) * (AIRPORT_LEVELS[id] ?? 1),
      duration: meta.loop ? 10 : Math.ceil((body + tail + 0.08) * 100) / 100, loop: meta.loop,
      tags: ['airport', 'tycoon', cat.replace('airport-', ''), ...id.split('-')], variation: meta.variation ?? { pitch: 0.5, volume: 1.5 }, limit: meta.limit ?? 6, cooldown: meta.cooldown, priority: meta.priority ?? (meta.loop ? 20 : 4),
      play: (v, t) => { v.space(space); airportFinish(v, cat); play(v, t); } });
  };

  // ── UI kit: felt clicks + glass glints, all in C major pentatonic ──────────
  const U = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-ui', id, name, body, hint, play, 'touch', { variation: { pitch: 0, volume: 0.8 }, cooldown: 0.02, ...meta });
  U('apt-ui-hover', 'Hover', 0.06, 'Barely-there tick when the cursor enters a button', (v, t) => felt(v, t, 2400, 0.06), { cooldown: 0.04, limit: 3 });
  U('apt-ui-click', 'Click', 0.1, 'Felt click with a faint glass edge', (v, t) => { felt(v, t, 1800, 0.18); glint(v, t, 84, 0.03, 0.12); });
  U('apt-ui-click-soft', 'Click · soft', 0.08, 'Secondary/list click', (v, t) => felt(v, t, 1500, 0.12));
  U('apt-ui-back', 'Back', 0.12, 'Lower click, slight downward glint', (v, t) => { felt(v, t, 1300, 0.15); glint(v, t + 0.01, 72, 0.05, 0.15); });
  U('apt-ui-select', 'Select', 0.25, 'Click and a bright pentatonic glint', (v, t) => { felt(v, t, 1800, 0.15); glint(v, t + 0.01, 79, 0.1, 0.3); });
  U('apt-ui-confirm', 'Confirm', 0.45, 'Two rising glints: G → C', (v, t) => { felt(v, t, 1800, 0.15); glint(v, t + 0.01, 79, 0.11); glint(v, t + 0.09, 84, 0.12, 0.45); });
  U('apt-ui-cancel', 'Cancel', 0.35, 'Two falling glints: E → C', (v, t) => { felt(v, t, 1500, 0.14); glint(v, t + 0.01, 76, 0.1); glint(v, t + 0.09, 72, 0.1, 0.35); });
  U('apt-ui-invalid', 'Invalid action', 0.3, 'Dull double knock with a muted low buzz (not shrill)', (v, t) => { [0, 0.09].forEach(d => hit(v, t + d, 420, 0.05, 0.18, 'wood')); beep(v, t, 155, 0.16, 0.05, 'sawtooth'); });
  U('apt-ui-menu-open', 'Menu open', 0.35, 'Panel whooshes in and settles with a glint', (v, t) => { whoosh(v, t, 0.18, 600, 2600, 0.08); felt(v, t + 0.17, 1600, 0.12); glint(v, t + 0.17, 79, 0.06, 0.25); });
  U('apt-ui-menu-close', 'Menu close', 0.3, 'Panel whooshes out with a soft stop', (v, t) => { whoosh(v, t, 0.16, 2400, 600, 0.07); felt(v, t + 0.15, 1200, 0.1); });
  U('apt-ui-panel-in', 'Panel slide in', 0.3, 'Side panel slides in', (v, t) => { whoosh(v, t, 0.2, 500, 1800, 0.06, -0.5); felt(v, t + 0.2, 1500, 0.08, -0.3); });
  U('apt-ui-panel-out', 'Panel slide out', 0.3, 'Side panel slides away', (v, t) => whoosh(v, t, 0.2, 1800, 500, 0.06, -0.5));
  U('apt-ui-tab', 'Tab switch', 0.12, 'Index-card flick', (v, t) => { v.surface(t, { dur: 0.04, rate: 200, grain: 0.004, freq: 2400, peak: 0.06 }); felt(v, t + 0.04, 2000, 0.12); }, { cooldown: 0.03 });
  U('apt-ui-toggle-on', 'Toggle on', 0.15, 'Switch up with a rising glint', (v, t) => { felt(v, t, 2000, 0.14); glint(v, t + 0.01, 84, 0.06, 0.15); });
  U('apt-ui-toggle-off', 'Toggle off', 0.15, 'Switch down, duller', (v, t) => { felt(v, t, 1200, 0.14); glint(v, t + 0.01, 72, 0.04, 0.12); });
  U('apt-ui-slider', 'Slider tick', 0.04, 'Fine notch for sliders and steppers', (v, t) => felt(v, t, 2800, 0.07), { cooldown: 0.015, limit: 3 });
  U('apt-ui-scroll', 'Scroll tick', 0.04, 'List scroll detent', (v, t) => felt(v, t, 2200, 0.05), { cooldown: 0.03, limit: 3 });
  U('apt-ui-tooltip', 'Tooltip', 0.2, 'Tiny airy glint', (v, t) => glint(v, t, 91, 0.04, 0.2), { cooldown: 0.1 });
  U('apt-ui-dialog', 'Dialog open', 0.84, 'Modal appears: soft swell and two-note chime', (v, t) => { whoosh(v, t, 0.25, 400, 1400, 0.05); glint(v, t + 0.2, 76, 0.08, 0.4); glint(v, t + 0.28, 84, 0.08, 0.5); });
  U('apt-ui-drag', 'Drag start', 0.12, 'Item lifted: soft pluck up', (v, t) => { v.tone(t, { f: 400, f2: 700, dur: 0.06, peak: 0.05, type: 'triangle' }); felt(v, t, 1600, 0.1); });
  U('apt-ui-drop', 'Drop', 0.18, 'Item set down with a weighted thock', (v, t) => { solidKey(v, t, { vel: 0.6, f: 170 }); });
  U('apt-ui-pause', 'Pause', 0.3, 'Time stops: tape slows to a halt', (v, t) => { v.tone(t, { f: 900, f2: 200, dur: 0.22, peak: 0.08, type: 'triangle' }); felt(v, t + 0.22, 900, 0.12); });
  U('apt-ui-play', 'Resume', 0.3, 'Time resumes: tape spins up', (v, t) => { v.tone(t, { f: 200, f2: 900, dur: 0.2, peak: 0.08, type: 'triangle' }); felt(v, t, 1800, 0.1); });
  U('apt-ui-zoom-in', 'Camera zoom in', 0.35, 'Airy push in', (v, t) => whoosh(v, t, 0.3, 500, 2200, 0.06), { cooldown: 0.08 });
  U('apt-ui-zoom-out', 'Camera zoom out', 0.35, 'Airy pull out', (v, t) => whoosh(v, t, 0.3, 2200, 500, 0.06), { cooldown: 0.08 });
  U('apt-ui-save', 'Game saved', 0.89, 'Disk-like whirr and a settled two-note glint', (v, t) => { v.surface(t, { dur: 0.25, rate: 200, grain: 0.003, freq: 3000, peak: 0.03 }); glint(v, t + 0.25, 79, 0.08); glint(v, t + 0.33, 84, 0.09, 0.5); });
  U('apt-ui-text', 'Text tick', 0.03, 'Per-character tick for typed-out dialogue/messages', (v, t) => felt(v, t, 2600 + Math.floor(v.random(0, 3)) * 200, 0.04), { cooldown: 0.02, limit: 4 });

  // ── Build mode ─────────────────────────────────────────────────────────────
  const BU = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'room', meta: Partial<SoundDefinition> = {}) => D('airport-build', id, name, body, hint, play, scene, meta);
  BU('apt-build-snap', 'Placement snap', 0.06, 'Preview snaps to the next grid cell', (v, t) => felt(v, t, 2600, 0.09), 'touch', { cooldown: 0.02, limit: 3, variation: { pitch: 0.3, volume: 1 } });
  BU('apt-build-rotate', 'Rotate', 0.2, 'Ratchet quarter-turn', (v, t) => { [0, 0.035, 0.07].forEach(d => felt(v, t + d, 2200, 0.1)); }, 'touch');
  BU('apt-build-invalid', 'Can\'t build here', 0.3, 'Red-preview hover: muted double bonk', (v, t) => { [0, 0.1].forEach(d => { hit(v, t + d, 260, 0.06, 0.2, 'wood'); punch(v, t + d, { weight: 0, peak: 0.08, freq: 120 }); }); }, 'touch', { cooldown: 0.15 });
  BU('apt-build-tile', 'Floor tile paint', 0.1, 'One floor tile laid during drag-paint (fire per tile)', (v, t) => { hit(v, t, 900, 0.04, 0.12, 'stone'); felt(v, t, 2000, 0.05); }, 'room', { cooldown: 0.02, limit: 5, variation: { pitch: 1.5, volume: 2 } });
  BU('apt-build-wall', 'Wall segment', 0.25, 'Wall panel drops into place', (v, t) => { impact(v, t, { weight: 0.35, material: 'stone', freq: 260, peak: 0.35 }); }, 'room', { cooldown: 0.03, variation: { pitch: 1, volume: 1.5 } });
  BU('apt-build-zone', 'Zone paint', 0.15, 'Soft spray stroke for painting zones', (v, t) => v.noise(t, { color: 'white', type: 'hp', freq: 4000, dur: 0.12, peak: 0.05, attack: 0.01 }), 'touch', { cooldown: 0.03, limit: 4 });
  BU('apt-build-refund', 'Refund', 0.6, 'Coins pour back into the budget', (v, t) => { [0, 0.06, 0.11, 0.15].forEach((d, i) => metallic(v, t + d, 2800 + i * 250, 0.15, 0.07, v.random(-0.3, 0.3), [1, 1.48])); });
  BU('apt-build-upgrade', 'Upgrade', 0.9, 'Mechanism tightens, then a rising sparkle', (v, t) => { [0, 0.08, 0.16].forEach(d => metallic(v, t + d, 1700, 0.06, 0.08)); [72, 76, 79, 84].forEach((n, i) => glint(v, t + 0.25 + i * 0.06, n, 0.08, 0.4)); });
  BU('apt-build-blueprint', 'Blueprint mode', 0.6, 'Large drafting sheet unrolls', (v, t) => { v.surface(t, { dur: 0.45, rate: 70, rateEnd: 25, grain: 0.02, freq: 1600, freqEnd: 2400, peak: 0.09, attack: 0.05 }); punch(v, t + 0.45, { weight: 0, peak: 0.06, freq: 160 }); }, 'touch');
  BU('apt-build-runway-paint', 'Runway markings', 1.6, 'Line-painting machine sprays a stripe', (v, t) => { diesel(v, t, 1.6, 40, 44, 0.05); v.noise(t + 0.1, { color: 'white', type: 'hp', freq: 3500, dur: 1.4, peak: 0.08, flat: true, fade: { in: 0.05, hold: 1.2, out: 0.15 } }); }, 'open');
  BU('apt-build-concrete', 'Concrete pour', 2.2, 'Chute rattles, wet concrete slumps and spreads', (v, t) => { v.surface(t, { dur: 0.4, rate: 120, grain: 0.006, freq: 1200, peak: 0.06 }); layer(v, t + 0.3, { src: 'brown', filter: { type: 'lowpass', f: [[0, 600], [1.8, 300]] }, gain: [[0, 0], [0.2, 0.3], [1.5, 0.2], [1.9, 0]] }); for (let i = 0; i < 10; i++) bubble(v, t + 0.4 + v.random(0, 1.4), { radius: v.random(4, 9), peak: 0.05, rise: 0.1 }); }, 'open');
  BU('apt-build-crane', 'Crane hoist', 3, 'Tower crane motor winds, warning bell, load lands', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 70], [0.3, 110], [2.4, 110], [2.6, 60]], filter: { type: 'lowpass', f: [[0, 500], [2.6, 500]] }, gain: [[0, 0], [0.3, 0.06], [2.4, 0.06], [2.6, 0]] }); [0, 0.25, 0.5].forEach(d => metallic(v, t + d, 1900, 0.2, 0.06)); impact(v, t + 2.6, { weight: 0.7, material: 'bronze', freq: 180, peak: 0.45 }); }, 'open');
  BU('apt-construct-hammer', 'Hammering', 1.4, 'Claw hammer drives a nail: five blows, last one seats', (v, t) => { [0, 0.28, 0.54, 0.8, 1.05].forEach((d, i) => { impact(v, t + d, { weight: 0.25, material: 'wood', freq: 300, peak: 0.35 + i * 0.03 }); metallic(v, t + d, 2500 - i * 150, 0.08, 0.06); }); }, 'room', { variation: { pitch: 1, volume: 1.5 } });
  BU('apt-construct-drill', 'Power drill', 1.6, 'Cordless drill bites into wood: motor whine dips under load', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 300], [0.15, 520], [0.5, 380], [1.3, 400], [1.5, 520], [1.6, 300]], filter: { type: 'bandpass', f: [[0, 1500], [1.6, 1500]], Q: 1 }, gain: [[0, 0], [0.1, 0.08], [1.5, 0.08], [1.6, 0]] }); crunch(v, t + 0.5, { dur: 0.8, events: 30, centroid: 2000, grain: 0.004, decay: 1, peak: 0.08, cluster: 0 }); }, 'room');
  BU('apt-construct-saw', 'Circular saw', 2, 'Saw spins up, howls through a board, spins down', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 200], [0.3, 900], [0.6, 700], [1.5, 720], [2, 300]], filter: { type: 'bandpass', f: [[0, 2500], [2, 2500]], Q: 0.8 }, gain: [[0, 0], [0.3, 0.08], [1.6, 0.1], [2, 0]] }); crunch(v, t + 0.6, { dur: 0.9, events: 50, centroid: 3500, grain: 0.003, decay: 1, peak: 0.1, cluster: 0, air: 0.3 }); }, 'room');
  BU('apt-construct-jackhammer', 'Jackhammer', 2, 'Pneumatic breaker pounding concrete (~20 blows/s)', (v, t) => { for (let at = 0; at < 1.9; at += 0.05) { punch(v, t + at, { weight: 0, peak: 0.15, freq: 90 }); v.noise(t + at, { color: 'pink', type: 'bp', freq: 1400, Q: 0.8, dur: 0.02, peak: 0.12 }); } v.noise(t, { color: 'white', type: 'hp', freq: 3000, dur: 1.9, peak: 0.03, flat: true, fade: { in: 0.02, hold: 1.8, out: 0.08 } }); crunch(v, t + 0.2, { dur: 1.6, events: 30, centroid: 1800, grain: 0.005, decay: 1, peak: 0.07, cluster: 0 }); }, 'open');
  BU('apt-construct-reverse', 'Construction vehicle reversing', 3.2, 'Excavator tracks and back-up alarm', (v, t) => { diesel(v, t, 3.2, 34, 40, 0.1); for (let i = 0; i < 3; i++) beep(v, t + i, 1100, 0.5, 0.1, 'square'); }, 'open');

  // ── Economy ────────────────────────────────────────────────────────────────
  const E = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-economy', id, name, body, hint, play, 'room', { variation: { pitch: 0, volume: 0.5 }, ...meta });
  const scribble = (v: Voice, t: number, dur: number) => v.surface(t, { dur, rate: 110, rateEnd: 60, grain: 0.01, freq: 2600, freqEnd: 3200, peak: 0.07, attack: 0.03 });
  E('apt-contract-signed', 'Airline contract signed', 2.9, 'Pen signature, embossed stamp, warm deal chord', (v, t) => { scribble(v, t, 0.55); punch(v, t + 0.65, { weight: 0.3, peak: 0.35 }); hit(v, t + 0.65, 500, 0.08, 0.2, 'wood'); STINGERS.contract.play(v, t + 0.8, { key: parseKey('Bb major'), bpm: 100 }); });
  E('apt-loan-taken', 'Loan taken', 1.2, 'Bank vault-ish thunk and a cautious minor chime', (v, t) => { punch(v, t, { weight: 0.5, peak: 0.35 }); metallic(v, t, 700, 0.3, 0.1); glint(v, t + 0.2, 72, 0.08, 0.6); glint(v, t + 0.3, 75, 0.08, 0.7); });
  E('apt-loan-repaid', 'Loan repaid', 1.2, 'Chain unlocks and a relieved major resolve', (v, t) => { metallic(v, t, 1500, 0.1, 0.1); metallic(v, t + 0.08, 1300, 0.1, 0.08); glint(v, t + 0.2, 79, 0.09); glint(v, t + 0.3, 84, 0.1, 0.7); });
  E('apt-salaries-paid', 'Salaries paid', 1, 'Cash register sequence spending out', (v, t) => { [0, 0.07, 0.14, 0.21, 0.28].forEach((d, i) => metallic(v, t + d, 3300 - i * 200, 0.1, 0.06, v.random(-0.4, 0.4), [1, 1.5])); hit(v, t + 0.4, 500, 0.05, 0.15, 'wood'); });
  E('apt-bill-due', 'Bill due', 0.9, 'Envelope slit open, paper unfolded, flat two-note', (v, t) => { v.surface(t, { dur: 0.15, rate: 250, grain: 0.003, freq: 3000, peak: 0.07 }); v.surface(t + 0.2, { dur: 0.25, rate: 60, grain: 0.02, freq: 1800, peak: 0.06 }); glint(v, t + 0.5, 72, 0.07); glint(v, t + 0.62, 72, 0.06); });
  E('apt-budget-warning', 'Budget warning', 1.3, 'Low two-tone warning with a ticking counter', (v, t) => { for (let i = 0; i < 6; i++) felt(v, t + i * 0.09, 2500, 0.06); beep(v, t + 0.6, 392, 0.25, 0.08, 'triangle'); beep(v, t + 0.9, 330, 0.35, 0.08, 'triangle'); }, { priority: 7 });
  E('apt-bankruptcy-warning', 'Bankruptcy warning', 2.6, 'Ominous: slow heartbeat thumps under a falling minor line', (v, t) => { [0, 0.8, 1.6].forEach(d => { punch(v, t + d, { weight: 0.5, peak: 0.35, freq: 55 }); punch(v, t + d + 0.25, { weight: 0.3, peak: 0.22, freq: 50 }); }); [64, 63, 60, 59].forEach((n, i) => pluck(v, t + i * 0.5, n - 12, 0.6, 0.25, 0, 0.3)); }, { priority: 8 });
  E('apt-quarterly-report', 'Quarterly report', 2, 'Paper shuffle, a tally of ticks, a decisive stamp', (v, t) => { v.surface(t, { dur: 0.35, rate: 80, grain: 0.02, freq: 1600, peak: 0.07 }); for (let i = 0; i < 10; i++) felt(v, t + 0.45 + i * 0.07, 2800, 0.07); punch(v, t + 1.3, { weight: 0.3, peak: 0.3 }); hit(v, t + 1.3, 520, 0.08, 0.2, 'wood'); });
  E('apt-profit-day', 'Day profit', 1.4, 'End-of-day tally rolls up into a cheerful register ring', (v, t) => { for (let i = 0; i < 12; i++) felt(v, t + i * 0.055, 2600 + i * 40, 0.06); metallic(v, t + 0.7, m(84), 0.5, 0.16, 0, [1, 1.5, 2]); metallic(v, t + 0.75, m(91), 0.45, 0.1, 0, [1, 1.5]); });
  E('apt-loss-day', 'Day loss', 1.35, 'Tally rolls down into a dull thud', (v, t) => { for (let i = 0; i < 10; i++) felt(v, t + i * 0.06, 2800 - i * 80, 0.06); punch(v, t + 0.7, { weight: 0.4, peak: 0.3 }); pluck(v, t + 0.7, 52, 0.6, 0.2, 0, 0.25); });
  E('apt-income-tick', 'Income tick', 0.15, 'Tiny coin for frequent small income', (v, t) => metallic(v, t, 3400, 0.1, 0.06, 0, [1, 1.48]), { cooldown: 0.05, limit: 3 });
  E('apt-expense-tick', 'Expense tick', 0.15, 'Tiny dull coin for frequent small costs', (v, t) => { metallic(v, t, 2200, 0.06, 0.05, 0, [1, 1.3]); hit(v, t, 500, 0.02, 0.05, 'wood'); }, { cooldown: 0.05, limit: 3 });
  E('apt-fuel-price-up', 'Fuel price up', 0.8, 'Pump bell and a rising question tone', (v, t) => { metallic(v, t, 2100, 0.3, 0.1); v.tone(t + 0.2, { f: 330, f2: 494, dur: 0.4, peak: 0.07, type: 'triangle' }); });
  E('apt-fuel-price-down', 'Fuel price down', 0.8, 'Pump bell and a relaxing falling tone', (v, t) => { metallic(v, t, 2100, 0.3, 0.1); v.tone(t + 0.2, { f: 494, f2: 392, dur: 0.4, peak: 0.07, type: 'triangle' }); });
  E('apt-tax-paid', 'Taxes paid', 0.8, 'Rubber stamp and coins slide away', (v, t) => { punch(v, t, { weight: 0.3, peak: 0.3 }); hit(v, t, 520, 0.08, 0.2, 'wood'); [0.15, 0.2, 0.26].forEach((d, i) => metallic(v, t + d, 3000 - i * 400, 0.1, 0.05)); });
  E('apt-milestone', 'Passenger milestone', 3.32, '"1,000,000 passengers!": harp run, sparkle, bright chord', (v, t) => STINGERS.milestone.play(v, t, { key: parseKey('D major'), bpm: 110 }));

  // ── Staff & maintenance ────────────────────────────────────────────────────
  const ST = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'room', meta: Partial<SoundDefinition> = {}) => D('airport-staff', id, name, body, hint, play, scene, meta);
  ST('apt-staff-hired', 'Staff hired', 0.9, 'Lanyard badge clips on, friendly two-note welcome', (v, t) => { metallic(v, t, 2600, 0.06, 0.08); felt(v, t + 0.05, 1800, 0.12); glint(v, t + 0.2, 76, 0.09); glint(v, t + 0.3, 81, 0.1, 0.5); }, 'room', { variation: { pitch: 0, volume: 0.5 } });
  ST('apt-staff-fired', 'Staff fired', 0.9, 'Desk drawer slams, badge dropped in a tray, flat note', (v, t) => { impact(v, t, { weight: 0.4, material: 'wood', freq: 220, peak: 0.4 }); metallic(v, t + 0.3, 2400, 0.08, 0.06); pluck(v, t + 0.35, 52, 0.5, 0.2, 0, 0.25); }, 'room', { variation: { pitch: 0, volume: 0.5 } });
  ST('apt-staff-strike', 'Staff strike', 4, 'A small group keeps a two-beat chant; individual voices lag the pulse rather than forming a vowel chord', (v, t) => {
    const speakers = Array.from({ length: 6 }, (_, i) => ({ pitch: i % 3 ? v.random(115, 164) : v.random(181, 222), pan: -0.68 + i * 0.27, lag: v.random(0, 0.07) }));
    for (let k = 0; k < 4; k++) {
      const at = k * 0.94;
      for (const s of speakers) {
        humanPhrase(v, t + at + s.lag, { pitch: s.pitch, duration: 0.32, syllables: 2, peak: 0.07, pan: s.pan, mood: 0.7 });
        humanPhrase(v, t + at + 0.44 + s.lag, { pitch: s.pitch * 0.97, duration: 0.35, syllables: 2, peak: 0.075, pan: s.pan, mood: 0.7 });
      }
      punch(v, t + at, { weight: 0.3, peak: 0.13 }); punch(v, t + at + 0.44, { weight: 0.2, peak: 0.1 });
    }
    [0.6, 2.5].forEach(d => v.tone(t + d, { f: 2800, dur: 0.3, peak: 0.025, type: 'sine', vibratoF: 33, vibratoD: 60 }));
  }, 'open', { limit: 1 });
  ST('apt-staff-break', 'Staff on break', 1.85, 'Mug contact, chair movement and an unvoiced relieved exhale', (v, t) => { hit(v, t, 900, 0.07, 0.17, 'ceramic'); v.surface(t + 0.3, { dur: 0.3, rate: 40, grain: 0.03, freq: 700, peak: 0.05 }); humanGesture(v, t + 0.6, 'sigh', { peak: 0.15 }); });
  ST('apt-staff-tired', 'Staff exhausted', 1.8, 'A tired yawn opens from breath and closes into a soft exhale', (v, t) => { humanGesture(v, t, 'yawn', { pitch: 133, peak: 0.2 }); });
  ST('apt-janitor-mop', 'Mopping', 2.2, 'Wet mop slaps down and swishes across tile, bucket wringer squeaks', (v, t) => { [0, 0.8].forEach(d => { v.noise(t + d, { color: 'pink', type: 'lp', freq: 1200, dur: 0.06, peak: 0.25 }); v.surface(t + d + 0.05, { dur: 0.6, rate: 140, grain: 0.006, freq: 1500, freqEnd: 1100, peak: 0.08, attack: 0.05, release: 0.2 }); for (let i = 0; i < 5; i++) bubble(v, t + d + v.random(0, 0.5), { radius: v.random(1, 2.5), peak: 0.03 }); }); v.tone(t + 1.6, { f: 900, f2: 1300, dur: 0.25, peak: 0.04, type: 'triangle', vibratoF: 25, vibratoD: 50 }); }, 'chamber');
  ST('apt-bin-empty', 'Bin emptied', 1, 'Lid flaps, liner yanked out, bag thumps into the cart', (v, t) => { hit(v, t, 700, 0.06, 0.15, 'ceramic'); crunch(v, t + 0.15, { dur: 0.4, events: 30, centroid: 3000, grain: 0.004, decay: 0.98, peak: 0.08, cluster: 0.3 }); punch(v, t + 0.7, { weight: 0.3, peak: 0.25 }); }, 'chamber');
  ST('apt-equipment-break', 'Equipment breaks', 1.4, 'Crackling electrical short, a clunk and the motor whining down', (v, t) => { for (let i = 0; i < 9; i++) v.noise(t + v.random(0, 0.35), { color: 'white', type: 'hp', freq: 3000, dur: v.random(0.003, 0.02), peak: v.random(0.1, 0.3) }); impact(v, t + 0.35, { weight: 0.4, material: 'bronze', freq: 260, peak: 0.35 }); v.tone(t + 0.35, { f: 600, f2: 60, dur: 0.9, peak: 0.07, type: 'sawtooth', filter: { type: 'lp', freq: 1500 } }); }, 'room', { priority: 6 });
  ST('apt-out-of-order', 'Out of order', 1.2, 'Machine refuses: three flat beeps and a relay click', (v, t) => { [0, 0.25, 0.5].forEach(d => beep(v, t + d, 520, 0.16, 0.08, 'square')); felt(v, t + 0.85, 1200, 0.15); }, 'room', { variation: { pitch: 0, volume: 0.5 } });
  ST('apt-repair-wrench', 'Wrench repair', 1.4, 'Ratchet wrench clicks a bolt tight, metal tap to check', (v, t) => { for (let i = 0; i < 9; i++) metallic(v, t + i * 0.09, 2400, 0.03, 0.06, 0, [1, 1.6]); metallic(v, t + 1, 1300, 0.3, 0.12); }, 'room');
  ST('apt-repair-done', 'Repair complete', 1, 'Motor restarts cleanly and a happy chime', (v, t) => { v.tone(t, { f: 60, f2: 600, dur: 0.5, peak: 0.06, type: 'sawtooth', filter: { type: 'lp', freq: 1500 } }); glint(v, t + 0.45, 79, 0.1); glint(v, t + 0.53, 84, 0.1, 0.5); }, 'room', { variation: { pitch: 0, volume: 0.5 } });
  ST('apt-power-outage', 'Power outage', 2.6, 'Mains hum collapses, lights die with a thunk, everything goes quiet, a crowd "ohh"', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 120], [0.8, 40]], filter: { type: 'lowpass', f: [[0, 800], [0.8, 200]] }, gain: [[0, 0.07], [0.8, 0]] }); punch(v, t + 0.35, { weight: 0.5, peak: 0.4 }); [0.36, 0.4, 0.47].forEach(d => felt(v, t + d, 900, 0.12)); for (let i = 0; i < 12; i++) vocal(v, t + 0.9 + v.random(0, 0.2), { contour: [v.random(140, 260), v.random(100, 200)], dur: 0.9, vowel: [450, 800], peak: 0.04, breath: 0.3, pan: v.random(-0.9, 0.9) }); }, 'hall', { priority: 8 });
  ST('apt-generator-start', 'Backup generator', 4, 'Diesel starter cranks, catches, revs and settles; transfer switch clunks', (v, t) => { for (let i = 0; i < 5; i++) { punch(v, t + i * 0.13, { weight: 0, peak: 0.15, freq: 70 }); v.noise(t + i * 0.13, { color: 'pink', type: 'lp', freq: 600, dur: 0.08, peak: 0.1 }); } diesel(v, t + 0.7, 3.3, 28, 46, 0.14); metallic(v, t + 2.2, 500, 0.3, 0.15); punch(v, t + 2.2, { weight: 0.5, peak: 0.35 }); }, 'open', { priority: 7 });
  ST('apt-emergency-lights', 'Emergency lighting', 1, 'Relays clack in sequence and fluorescent tubes flicker to life', (v, t) => { for (let i = 0; i < 6; i++) felt(v, t + i * 0.08, 1000, 0.15, (i - 2.5) * 0.25); layer(v, t + 0.5, { src: 'sawtooth', f: [[0, 100], [0.5, 100]], filter: { type: 'bandpass', f: [[0, 2000], [0.5, 2000]], Q: 2 }, gain: [[0, 0], [0.03, 0.02], [0.08, 0], [0.12, 0.02], [0.45, 0.015], [0.5, 0]] }); }, 'hall');

  // ── Emergencies ────────────────────────────────────────────────────────────
  const EM = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'hall', meta: Partial<SoundDefinition> = {}) => D('airport-emergency', id, name, body, hint, play, scene, { variation: { pitch: 0, volume: 0.5 }, priority: 9, limit: 2, ...meta });
  EM('apt-fire-alarm', 'Fire alarm (temporal-3)', 8, 'Evacuation horn in the standard temporal-3 rhythm: three 0.5 s pulses 0.5 s apart, then 1.5 s silence; two cycles', (v, t) => { for (let c = 0; c < 2; c++) for (let i = 0; i < 3; i++) { const at = c * 4 + i; beep(v, t + at, 520, 0.5, 0.12, 'square'); beep(v, t + at, 1040, 0.5, 0.05, 'square'); } });
  EM('apt-evacuation', 'Evacuation alert', 4, 'Attention chime followed by a slow rising whoop, repeating', (v, t) => { chime(v, t, 72, 0.15, 0.8); chime(v, t + 0.35, 72, 0.15, 0.8); for (let i = 0; i < 3; i++) v.tone(t + 1 + i * 1, { f: 500, f2: 1200, dur: 0.85, peak: 0.12, type: 'square', glide: 'lin', filter: { type: 'lp', freq: 3500 } }); });
  EM('apt-sprinklers', 'Sprinklers', 3, 'Heads pop and spray: hissing water sheets onto the floor', (v, t) => { [0, 0.15, 0.27].forEach(d => snap(v, t + d, { peak: 0.2, freq: 2200 })); layer(v, t + 0.1, { src: 'white', filter: { type: 'highpass', f: [[0, 2500], [2.8, 2500]] }, gain: [[0, 0], [0.3, 0.18], [2.6, 0.18], [2.9, 0]] }); layer(v, t + 0.2, { src: 'pink', filter: { type: 'bandpass', f: [[0, 800], [2.7, 800]], Q: 0.6 }, gain: [[0, 0], [0.4, 0.12], [2.5, 0.12], [2.8, 0]] }); });
  EM('apt-suspicious-bag', 'Suspicious bag', 2.4, 'Tense low pulse and a two-note security sting', (v, t) => { for (let i = 0; i < 6; i++) punch(v, t + i * 0.32, { weight: 0.2, peak: 0.2, freq: 60 }); v.bloom(t + 0.2, { f: m(48), f2: m(49), dur: 2, peak: 0.12, attack: 0.5, release: 1, timbre: 'bowed' }); beep(v, t + 1.6, 880, 0.15, 0.08); beep(v, t + 1.8, 831, 0.3, 0.08); });
  EM('apt-security-breach', 'Security breach', 3, 'Fast alternating high siren from the checkpoint', (v, t) => { for (let i = 0; i < 12; i++) beep(v, t + i * 0.24, i % 2 ? 1300 : 1800, 0.2, 0.1, 'sawtooth'); });
  EM('apt-lockdown', 'Lockdown', 2.5, 'Heavy security shutters slam down in sequence, then a buzzer', (v, t) => { [0, 0.4, 0.75].forEach((d, i) => { layer(v, t + d, { src: 'pink', filter: { type: 'bandpass', f: [[0, 600], [0.3, 900]], Q: 0.6 }, gain: [[0, 0], [0.05, 0.1], [0.28, 0.1], [0.3, 0]], pan: [[0, (i - 1) * 0.6], [0.3, (i - 1) * 0.6]] }); impact(v, t + d + 0.3, { weight: 0.8, material: 'bronze', freq: 140, peak: 0.45, pan: (i - 1) * 0.6 }); }); beep(v, t + 1.5, 220, 0.6, 0.1, 'sawtooth'); });
  EM('apt-ambulance', 'Ambulance pass', 7, 'European two-tone siren drives past with Doppler and diesel', (v, t) => { siren(v, t, 7, twoTone(740, 554, 0.55), { speed: 15, dist: 14, peak: 0.12 }); const fl = flight(7, 3.5, 15, 14); layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 250], [7, 250]] }, gain: scale(fl.level, 0.2), pan: fl.pan }); }, 'open');
  EM('apt-fire-tender', 'Crash tender pass', 7, 'Airport fire truck: US-style wail and yelp, deep diesel, Doppler', (v, t) => { siren(v, t, 7, (x: number) => (x < 3.5 ? wail(650, 1450, 2.2)(x) : yelp(700, 1500, 0.28)(x)), { speed: 18, dist: 16, peak: 0.12, wave: 'sawtooth' }); const fl = flight(7, 3.5, 18, 16); layer(v, t, { src: 'sawtooth', f: fl.doppler.map(([a, k]) => [a, 38 * k] as const), filter: { type: 'lowpass', f: [[0, 400], [7, 400]] }, gain: scale(fl.level, 0.12), pan: fl.pan }); }, 'open');
  EM('apt-police-siren', 'Police pass', 6, 'Fast yelp siren passing', (v, t) => siren(v, t, 6, yelp(750, 1550, 0.3), { speed: 20, dist: 15, peak: 0.11, wave: 'sawtooth' }), 'open');
  EM('apt-emergency-landing', 'Emergency landing', 8, 'Uneven approach power, two compressor surges, hard tyre contact and an approaching siren', (v, t) => {
    jetEngine(v, t, { duration: 6.5, spool: [[0, 0.43], [1.4, 0.45], [1.55, 0.25], [2.3, 0.5], [3, 0.28], [3.6, 0.48], [4.5, 0.3], [6.5, 0.16]],
      level: [[0, 0], [1, 0.2], [3.5, 0.78], [4.5, 1], [6.5, 0]],
      pan: [[0, -0.58], [4.5, 0.02], [6.5, 0.56]], exhaust: [[0, 0.12], [4.5, 0.6], [6.5, 0.85]] });
    for (const at of [1.55, 3]) {
      v.noise(t + at, { color: 'pink', type: 'bp', freq: 280, freq2: 190, Q: 0.65, dur: 0.18, peak: 0.3, attack: 0.002 });
      v.noise(t + at, { color: 'white', type: 'bp', freq: 1900, Q: 0.6, dur: 0.12, peak: 0.14, attack: 0.002 });
    }
    touchdown(v, t + 4.5, 0.37); impact(v, t + 4.51, { weight: 0.75, material: 'stone', freq: 135, peak: 0.3 });
    siren(v, t + 5, 3, twoTone(740, 554, 0.55), { speed: 6, dist: 40, peak: 0.065 });
  }, 'open');
  EM('apt-go-around', 'Go-around', 7, 'Approach power transitions through a delayed spool-up into a climbing exhaust wake', (v, t) => {
    jetEngine(v, t, { duration: 7, spool: [[0, 0.36], [1.8, 0.33], [2.6, 0.45], [4.2, 1], [7, 0.88]],
      level: [[0, 0], [1, 0.2], [2.2, 0.34], [4, 0.88], [4.6, 1], [7, 0]],
      doppler: [[0, 1.12], [3, 1.04], [4.5, 0.96], [7, 0.89]],
      pan: [[0, -0.6], [3.5, 0], [7, 0.74]], exhaust: [[0, 0.12], [3, 0.25], [4.8, 0.95], [7, 1]],
      cutoff: [[0, 2800], [3.5, 5800], [7, 800]] });
  }, 'open');
  EM('apt-bird-strike', 'Bird strike', 2.5, 'A dull strike, irregular compressor pressure bursts and decaying engine airflow', (v, t) => {
    impact(v, t, { weight: 0.45, material: 'wood', freq: 200, peak: 0.32 });
    jetEngine(v, t, { duration: 2.5, spool: [[0, 0.72], [0.3, 0.67], [0.58, 0.33], [1, 0.56], [1.4, 0.26], [2.5, 0.19]],
      level: [[0, 0], [0.06, 0.55], [0.3, 0.75], [0.55, 0.43], [1.1, 0.65], [2.5, 0]], exhaust: [[0, 0.65], [2.5, 0.75]] });
    [0.3, 0.57, 1.1].forEach((d, i) => {
      v.noise(t + d, { color: 'pink', type: 'bp', freq: 290 - i * 30, Q: 0.65, dur: 0.13, peak: 0.4 - i * 0.06, attack: 0.001 });
      v.noise(t + d, { color: 'white', type: 'bp', freq: 2300, Q: 0.6, dur: 0.09, peak: 0.2, attack: 0.001 });
    });
  }, 'open');
  EM('apt-engine-fire-bell', 'Cockpit fire bell', 2.5, 'Continuous ringing cockpit fire bell', (v, t) => { for (let i = 0; i < 40; i++) metallic(v, t + i * 0.055, 1450, 0.08, 0.07, 0, [1, 2.2]); }, 'cabinet');
  EM('apt-runway-closed', 'Runway closed', 1.4, 'Descending three-note alert and a gate-barrier clunk', (v, t) => { [988, 784, 659].forEach((f, i) => beep(v, t + i * 0.2, f, 0.18, 0.1, 'triangle')); punch(v, t + 0.7, { weight: 0.3, peak: 0.25 }); }, 'room');
  EM('apt-medical-call', 'Medical assistance', 1.4, 'Distinct first-aid chime: two rising, two held', (v, t) => { [76, 81, 81, 81].forEach((n, i) => chime(v, t + i * 0.25, n, 0.14, 0.6)); });

  // ── Weather ────────────────────────────────────────────────────────────────
  const W = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'open') => D('airport-weather', id, name, body, hint, play, scene, { limit: 3 });
  W('apt-thunder-close', 'Thunder · close', 4, 'Sharp crack overhead, then a heavy rolling boom', (v, t) => { v.noise(t, { color: 'white', type: 'hp', freq: 1500, dur: 0.12, peak: 0.2, attack: 0.004 }); punch(v, t, { weight: 1, peak: 0.4, freq: 40 }); layer(v, t + 0.05, { src: 'brown', filter: { type: 'lowpass', f: [[0, 800], [3.8, 150]] }, gain: [[0, 0.6], [0.6, 0.3], [1.4, 0.4], [3.8, 0]] }); }, 'deep');
  W('apt-thunder-distant', 'Thunder · distant', 5, 'Far rumble, no highs, slow swell and tail', (v, t) => layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 250], [5, 120]] }, gain: [[0, 0], [0.5, 0.35], [1.5, 0.45], [2.5, 0.3], [5, 0]] }), 'deep');
  W('apt-wind-gust', 'Wind gust', 3, 'Gust buffets the terminal glass and whistles past the hangar', (v, t) => { layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 300], [1.2, 900], [3, 300]], Q: 0.6 }, gain: [[0, 0], [1.2, 0.4], [3, 0]] }); layer(v, t + 0.6, { src: 'white', filter: { type: 'bandpass', f: [[0, 1600], [1.5, 1900]], Q: 14 }, gain: [[0, 0], [0.8, 0.12], [1.6, 0]] }); for (let i = 0; i < 4; i++) hit(v, t + 0.8 + v.random(0, 1), 160, 0.15, 0.06, 'glass'); });
  W('apt-hail', 'Hail on roof', 4, 'Hailstones hammering the terminal roof and glass', (v, t) => { for (let i = 0; i < 200; i++) { const at = Math.pow(v.random(), 0.7) * 3.8; hit(v, t + at, v.random(1500, 4000), 0.02, v.random(0.02, 0.07) * Math.min(1, at * 2) * Math.min(1, (4 - at)), v.random() < 0.3 ? 'glass' : 'stone', v.random(-0.9, 0.9)); } layer(v, t, { src: 'pink', filter: { type: 'highpass', f: [[0, 1500], [4, 1500]] }, gain: [[0, 0], [0.5, 0.06], [3.5, 0.06], [4, 0]] }); }, 'chamber');
  W('apt-deicing', 'De-icing truck', 5, 'Boom truck engine and pump, glycol spray hissing across the wing', (v, t) => { diesel(v, t, 5, 30, 38, 0.1); layer(v, t + 0.6, { src: 'white', filter: { type: 'bandpass', f: [[0, 3000], [4, 2400]], Q: 0.7 }, gain: [[0, 0], [0.3, 0.18], [3.8, 0.18], [4.2, 0]], pan: [[0, -0.5], [4.2, 0.5]] }); });
  W('apt-snowplow', 'Snowplow pass', 6, 'Runway plough: blade scraping, diesel, amber-beacon beeps', (v, t) => { const fl = flight(6, 3, 8, 15); layer(v, t, { src: 'sawtooth', f: fl.doppler.map(([a, k]) => [a, 36 * k] as const), filter: { type: 'lowpass', f: [[0, 400], [6, 400]] }, gain: scale(fl.level, 0.14), pan: fl.pan }); layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 1600], [6, 1600]], Q: 1 }, gain: scale(fl.level, 0.25), pan: fl.pan }); crunch(v, t + 1, { dur: 4, events: 120, centroid: 1400, grain: 0.006, decay: 1, peak: 0.06, cluster: 0 }); });
  W('apt-lightning-warning', 'Lightning ramp closure', 3, 'Ramp lightning warning: long low horn blasts — ground crews clear the apron', (v, t) => { [0, 1.2].forEach(d => { beep(v, t + d, 420, 0.9, 0.1, 'sawtooth'); beep(v, t + d, 525, 0.9, 0.07, 'sawtooth'); }); });
  W('apt-all-clear', 'Weather all clear', 1.55, 'One long steady tone and a bright resolving chime', (v, t) => { beep(v, t, 525, 0.8, 0.08, 'triangle'); glint(v, t + 0.9, 79, 0.1); glint(v, t + 1, 84, 0.1, 0.5); });

  // ── Amenities ──────────────────────────────────────────────────────────────
  const AM = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'room', meta: Partial<SoundDefinition> = {}) => D('airport-amenities', id, name, body, hint, play, scene, meta);
  AM('apt-hand-dryer', 'Jet hand dryer', 3, 'Blade dryer spins up to a roaring jet and cuts out', (v, t) => { layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 600], [0.4, 2400], [2.6, 2400], [3, 600]], Q: 0.7 }, gain: [[0, 0], [0.4, 0.4], [2.6, 0.4], [3, 0]] }); layer(v, t, { src: 'sine', f: [[0, 400], [0.4, 3200], [2.6, 3200], [3, 800]], gain: [[0, 0], [0.4, 0.02], [2.6, 0.02], [3, 0]] }); }, 'chamber');
  AM('apt-sink-tap', 'Sensor tap', 2, 'Sensor click, water runs into a steel basin, stops', (v, t) => { felt(v, t, 1200, 0.1); layer(v, t + 0.1, { src: 'pink', filter: { type: 'bandpass', f: [[0, 1500], [1.6, 1500]], Q: 0.8 }, gain: [[0, 0], [0.05, 0.14], [1.5, 0.14], [1.7, 0]] }); for (let i = 0; i < 18; i++) bubble(v, t + 0.15 + v.random(0, 1.5), { radius: v.random(1, 3), peak: 0.03 }); }, 'chamber');
  AM('apt-soap', 'Soap dispenser', 0.4, 'Automatic soap squirt', (v, t) => { v.tone(t, { f: 600, dur: 0.12, peak: 0.03, type: 'sawtooth', filter: { type: 'lp', freq: 1200 } }); bubble(v, t + 0.12, { radius: 4, peak: 0.12, rise: -0.2 }); }, 'chamber');
  AM('apt-toilet-flush', 'Toilet flush', 3.5, 'Pressure-valve commercial flush: bang, roaring rush, refill hiss', (v, t) => { punch(v, t, { weight: 0.3, peak: 0.3 }); layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 700], [0.3, 1200], [2, 700]], Q: 0.6 }, gain: [[0, 0], [0.1, 0.4], [1.8, 0.25], [2.2, 0]] }); for (let i = 0; i < 20; i++) bubble(v, t + v.random(0.2, 2), { radius: v.random(2, 7), peak: 0.04 }); layer(v, t + 2, { src: 'white', filter: { type: 'highpass', f: [[0, 3000], [1.4, 3000]] }, gain: [[0, 0], [0.1, 0.04], [1.2, 0.04], [1.4, 0]] }); }, 'chamber');
  AM('apt-order-bell', 'Food court order bell', 1, 'Kitchen "order up" bell, two dings', (v, t) => { metallic(v, t, 2650, 0.8, 0.16, 0, [1, 2.1, 3.6]); metallic(v, t + 0.2, 2650, 0.8, 0.14, 0, [1, 2.1, 3.6]); }, 'chamber', { cooldown: 0.3 });
  AM('apt-fryer', 'Fryer basket', 2.5, 'Basket drops into hot oil: violent sizzle settling down', (v, t) => { metallic(v, t, 900, 0.1, 0.1); layer(v, t + 0.05, { src: 'white', filter: { type: 'highpass', f: [[0, 2500], [2.4, 3500]] }, gain: [[0, 0], [0.05, 0.3], [0.6, 0.15], [2.4, 0]] }); crunch(v, t + 0.05, { dur: 2, events: 120, centroid: 4500, grain: 0.002, decay: 0.99, peak: 0.12, cluster: 0, air: 0.3 }); }, 'room');
  AM('apt-cutlery', 'Cutlery clatter', 0.6, 'Knives and forks dropped into a bin', (v, t) => { for (let i = 0; i < 9; i++) metallic(v, t + v.random(0, 0.3), v.random(2500, 4500), 0.12, 0.06, v.random(-0.4, 0.4), [1, 1.6, 2.4]); }, 'room');
  AM('apt-food-tray', 'Food tray down', 0.5, 'Plastic tray set on a table: plates and cup rattle', (v, t) => { impact(v, t, { weight: 0.3, material: 'ceramic', freq: 380, peak: 0.35 }); hit(v, t + 0.04, 1500, 0.1, 0.08, 'ceramic'); hit(v, t + 0.07, 2600, 0.12, 0.05, 'glass'); }, 'room');
  AM('apt-shop-till', 'Shop till', 1, 'Barcode beep, keypad, drawer and receipt', (v, t) => { beep(v, t, 2700, 0.08, 0.1); [0.2, 0.3, 0.38].forEach(d => { hit(v, t + d, 700, 0.02, 0.08, 'wood'); beep(v, t + d, 1950, 0.05, 0.05); }); snap(v, t + 0.6, { peak: 0.15, freq: 2000 }); punch(v, t + 0.75, { weight: 0.2, peak: 0.2 }); }, 'room');
  AM('apt-shop-door', 'Shop door chime', 1.2, 'Entry chime as someone walks into a store', (v, t) => { glint(v, t, 88, 0.1, 0.6); glint(v, t + 0.18, 84, 0.1, 0.8); }, 'room', { cooldown: 0.2 });
  AM('apt-bar-glasses', 'Bar glasses clink', 0.8, 'Two glasses clink "cheers"', (v, t) => { hit(v, t, 2900, 0.6, 0.18, 'glass'); hit(v, t + 0.006, 3400, 0.5, 0.12, 'glass'); }, 'room');
  AM('apt-beer-pour', 'Draught pour', 3, 'Tap opens, beer foams into a glass, tap closes', (v, t) => { felt(v, t, 900, 0.12); layer(v, t + 0.1, { src: 'pink', filter: { type: 'bandpass', f: [[0, 1200], [2.5, 2200]], Q: 1 }, gain: [[0, 0], [0.1, 0.12], [2.3, 0.1], [2.5, 0]] }); for (let i = 0; i < 40; i++) bubble(v, t + 0.2 + v.random(0, 2.6), { radius: v.random(0.4, 1.2), peak: 0.02 }); felt(v, t + 2.6, 900, 0.12); }, 'room');
  AM('apt-massage-chair', 'Massage chair', 3, 'Paid massage chair motors rolling and kneading', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 90], [3, 90]], filter: { type: 'lowpass', f: [[0, 300], [3, 300]] }, gain: [[0, 0], [0.2, 0.05], [2.8, 0.05], [3, 0]] }); for (let at = 0.2; at < 2.8; at += 0.45) punch(v, t + at, { weight: 0, peak: 0.08, freq: 110 }); }, 'room');
  AM('apt-baby-cry', 'Baby crying', 3, 'Three changing cry phrases with actual breath gaps and pressed onset', (v, t) => { humanGesture(v, t, 'cry', { peak: 0.28, rough: 0.26 }); }, 'room', { limit: 1 });
  AM('apt-dog-bark', 'Sniffer dog bark', 1, 'Two sharp breath/tract barks with a short, low chest resonance', (v, t) => {
    [0, 0.34].forEach((d, i) => { vocal(v, t + d, { contour: [205, 185, 140], dur: 0.17, vowel: [620, 1560], to: [450, 1200], peak: i ? 0.25 : 0.32, rough: 0.72, breath: 0.64 });
      v.noise(t + d, { color: 'pink', type: 'bp', freq: 780, freq2: 430, Q: 0.8, dur: 0.12, peak: 0.21, attack: 0.002 }); });
  }, 'chamber');
  AM('apt-pigeon', 'Pigeon in the terminal', 2.2, 'Soft coo phrases, then wing air pulses passing overhead', (v, t) => {
    [0, 0.53].forEach(d => { v.tone(t + d, { f: 390, f2: 345, dur: 0.39, peak: 0.075, attack: 0.055, filter: { type: 'lp', freq: 850 }, fade: { in: 0.065, hold: 0.22, out: 0.17 } });
      v.noise(t + d, { color: 'pink', type: 'bp', freq: 440, Q: 2, dur: 0.36, peak: 0.1, attack: 0.055 }); });
    for (let i = 0; i < 10; i++) v.noise(t + 1.27 + i * 0.073, { color: 'pink', type: 'bp', freq: 1100, Q: 0.55, dur: 0.044, peak: 0.1, pan: -0.4 + i * 0.08 });
  }, 'hall');
  AM('apt-lost-luggage', 'Lost-luggage complaint', 3, 'Desk bell rung insistently, then an exasperated rant', (v, t) => { [0, 0.25, 0.45].forEach(d => metallic(v, t + d, 2650, 0.6, 0.15, 0, [1, 2.1, 3.6])); grumble(v, t + 0.9, { pitch: 140, syllables: 10, peak: 0.3, rough: 0.5 }); }, 'room', { limit: 1 });

  // ── Airside extras & aircraft sizes ────────────────────────────────────────
  const GR = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-ground', id, name, body, hint, play, 'open', meta);
  GR('apt-aircraft-door', 'Aircraft door open', 3, 'Handle lifts, door unlatches and swings out with a pneumatic sigh', (v, t) => { metallic(v, t, 900, 0.1, 0.12); punch(v, t + 0.3, { weight: 0.3, peak: 0.3 }); v.noise(t + 0.4, { color: 'pink', type: 'bp', freq: 1200, freq2: 600, dur: 0.6, peak: 0.12 }); layer(v, t + 0.6, { src: 'sawtooth', f: [[0, 110], [1.8, 110]], filter: { type: 'lowpass', f: [[0, 500], [1.8, 500]] }, gain: [[0, 0], [0.2, 0.04], [1.6, 0.04], [1.8, 0]] }); hit(v, t + 2.5, 300, 0.1, 0.2, 'stone'); });
  GR('apt-stairs-truck', 'Stairs truck docks', 3.5, 'Airstairs truck creeps up, stabilizers clunk down', (v, t) => { diesel(v, t, 2.6, 30, 34, 0.08); [2.7, 3, 3.2].forEach(d => { punch(v, t + d, { weight: 0.4, peak: 0.3 }); metallic(v, t + d, 700, 0.1, 0.06); }); });
  GR('apt-apron-bus', 'Apron bus', 7, 'Bus pulls up, kneels with an air hiss, doors fold open, chime', (v, t) => { diesel(v, t, 4, 30, 45, 0.12); v.noise(t + 4, { color: 'white', type: 'hp', freq: 2000, freq2: 1000, dur: 0.6, peak: 0.25 }); v.noise(t + 4.7, { color: 'pink', type: 'bp', freq: 900, dur: 0.5, peak: 0.12 }); metallic(v, t + 5.2, 900, 0.1, 0.1); chime(v, t + 5.4, 79, 0.08, 0.6); chime(v, t + 5.6, 74, 0.08, 0.7); });
  GR('apt-cargo-loader', 'Cargo loader', 4, 'K-loader platform rises, ULD container rolls across ball-mats into the hold', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 90], [0.4, 130], [1.8, 130], [2, 80]], filter: { type: 'lowpass', f: [[0, 600], [2, 600]] }, gain: [[0, 0], [0.4, 0.06], [1.8, 0.06], [2, 0]] }); v.surface(t + 2.1, { dur: 1.4, rate: 150, grain: 0.006, freq: 900, freqEnd: 700, peak: 0.08 }); impact(v, t + 3.6, { weight: 0.6, material: 'bronze', freq: 200, peak: 0.4 }); });
  GR('apt-forklift', 'Forklift', 4, 'Electric forklift whine, back-up beeper, forks clack and lift', (v, t) => { layer(v, t, { src: 'sine', f: [[0, 600], [0.5, 1400], [3.5, 1200], [4, 600]], gain: [[0, 0], [0.5, 0.03], [3.5, 0.03], [4, 0]] }); [0, 0.8, 1.6].forEach(d => beep(v, t + 0.3 + d, 1400, 0.3, 0.08, 'square')); metallic(v, t + 2.5, 700, 0.15, 0.12); layer(v, t + 2.6, { src: 'sawtooth', f: [[0, 100], [1.2, 130]], filter: { type: 'lowpass', f: [[0, 600], [1.2, 600]] }, gain: [[0, 0], [0.2, 0.04], [1, 0.04], [1.2, 0]] }); });
  GR('apt-container-clunk', 'Cargo container', 0.8, 'Aluminium ULD bumps into the lock: hollow boom', (v, t) => { impact(v, t, { weight: 0.6, material: 'bronze', freq: 160, peak: 0.45 }); metallic(v, t, 420, 0.5, 0.12); });
  GR('apt-lav-truck', 'Lavatory service truck', 4, 'Hose couples, pump gurgles and slurps', (v, t) => { metallic(v, t, 800, 0.1, 0.12); diesel(v, t + 0.3, 3.6, 32, 36, 0.06); for (let i = 0; i < 30; i++) bubble(v, t + 0.6 + v.random(0, 3), { radius: v.random(3, 9), peak: 0.06, rise: 0.2 }); });
  GR('apt-water-truck', 'Potable water truck', 4, 'Pump hum and water rushing through the hose', (v, t) => { diesel(v, t, 4, 30, 34, 0.06); layer(v, t + 0.3, { src: 'pink', filter: { type: 'bandpass', f: [[0, 900], [3.4, 900]], Q: 0.8 }, gain: [[0, 0], [0.3, 0.12], [3.2, 0.12], [3.6, 0]] }); });
  GR('apt-engine-runup', 'Engine run-up test', 8, 'Stationary engine test: slow spool-up, held broadband thrust and an inertial return to idle', (v, t) => {
    jetEngine(v, t, { duration: 8, spool: [[0, 0.18], [0.6, 0.23], [2.7, 0.95], [5.5, 0.95], [7.5, 0.25], [8, 0.18]],
      level: [[0, 0], [0.3, 0.32], [2.7, 1], [5.5, 1], [7.6, 0.35], [8, 0]], exhaust: [[0, 0.8], [8, 0.8]] });
  });
  const AC = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void) => D('airport-aircraft', id, name, body, hint, play, 'open', { limit: 3, variation: { pitch: 0.3, volume: 1 } });
  AC('apt-widebody-takeoff', 'Wide-body take-off', 20, 'Lower fan band, stronger low-mid core, a longer roll and a late exhaust wake', (v, t) => jetTakeoff(v, t, 'widebody', 20, 12));
  AC('apt-regional-takeoff', 'Regional jet take-off', 12, 'Smaller engine body, a higher fan band and a shorter departure', (v, t) => jetTakeoff(v, t, 'regional', 12, 6.5));
  AC('apt-bizjet-takeoff', 'Business jet take-off', 11, 'Compact, brighter turbine wash with a quick climb; no exposed 7 kHz sine', (v, t) => jetTakeoff(v, t, 'business', 11, 5.5));
  AC('apt-cargo-night', 'Night cargo arrival', 12, 'A distant heavy approach, low reverse-thrust swell and muffled runway contact', (v, t) => jetLanding(v, t, 12, 'widebody', true));
  D('airport-ground', 'apt-gpu-hum', 'Ground power unit', 10, 'Loaded diesel pulse, damped chassis and a quiet electrical whine; load RTPC', (v, t) => {
    const x = () => clamp(v.param('load', 0.3), 0, 1);
    const engine = hum(v, t, 29, 'sawtooth'), electric = hum(v, t, 400, 'sine');
    const casing = bed(v, t, 'brown', 'lowpass', 240);
    const up = (time: number) => {
      engine.o.frequency.setTargetAtTime((28 + x() * 8) * v.pitch, time, 0.9);
      engine.g.gain.setTargetAtTime(0.07 + x() * 0.05, time, 0.65);
      electric.g.gain.setTargetAtTime(0.004 + x() * 0.006, time, 0.65);
      casing.g.gain.setTargetAtTime(0.065 + x() * 0.08, time, 0.8);
    };
    v.onParam('load', (_, time) => up(time)); up(t);
  }, 'open', { loop: true, limit: 2 });
  D('airport-ground', 'apt-apu', 'APU running', 10, 'A small turbine: exhaust airflow, narrow fan-band turbulence and load inertia', (v, t) => turbofanLoop(v, t, 'load', 'apu'), 'open', { loop: true, limit: 2 });

  // ── Landside ───────────────────────────────────────────────────────────────
  const LS = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'open') => D('airport-landside', id, name, body, hint, play, scene);
  LS('apt-taxi-pass', 'Taxi pulls up', 5, 'Car approaches, tyres on asphalt, brakes, idles', (v, t) => { const fl = flight(5, 3.2, 9, 5); layer(v, t, { src: 'pink', filter: { type: 'lowpass', f: scale(fl.cutoff, 0.15) }, gain: scale(fl.level.map(([a, x]) => [a, a > 3.2 ? x * 0.6 : x] as const), 0.3), pan: fl.pan }); layer(v, t, { src: 'sawtooth', f: fl.doppler.map(([a, k]) => [a, 32 * k] as const), filter: { type: 'lowpass', f: [[0, 300], [5, 300]] }, gain: scale(fl.level, 0.06), pan: fl.pan }); v.tone(t + 2.9, { f: 1800, f2: 1500, dur: 0.25, peak: 0.02, type: 'sine' }); });
  LS('apt-car-horn-short', 'Car horn tap', 0.4, 'Impatient short double tap', (v, t) => { [0, 0.18].forEach(d => { beep(v, t + d, 420, 0.12, 0.1, 'sawtooth'); beep(v, t + d, 500, 0.12, 0.07, 'sawtooth'); }); });
  LS('apt-car-horn-long', 'Car horn lean', 1.4, 'Angry long horn', (v, t) => { beep(v, t, 415, 1.1, 0.1, 'sawtooth'); beep(v, t, 494, 1.1, 0.08, 'sawtooth'); });
  LS('apt-car-door', 'Car door slam', 0.5, 'Solid car door shut', (v, t) => { impact(v, t, { weight: 0.55, material: 'bronze', freq: 140, peak: 0.45 }); hit(v, t + 0.01, 900, 0.04, 0.1, 'stone'); });
  LS('apt-car-trunk', 'Trunk close', 0.6, 'Boot lid swung down and latched', (v, t) => { v.noise(t, { color: 'pink', type: 'bp', freq: 700, dur: 0.12, peak: 0.05 }); impact(v, t + 0.14, { weight: 0.6, material: 'bronze', freq: 120, peak: 0.45 }); snap(v, t + 0.15, { peak: 0.15, freq: 2600 }); });
  LS('apt-car-lock', 'Car lock chirp', 0.5, 'Remote lock: chirp and door-lock clunk', (v, t) => { beep(v, t, 2600, 0.08, 0.08); [0.02, 0.04].forEach(d => felt(v, t + d, 700, 0.12)); });
  LS('apt-parking-barrier', 'Parking barrier', 2.2, 'Ticket accepted beep, boom arm motor lifts', (v, t) => { beep(v, t, 1760, 0.1, 0.08); layer(v, t + 0.3, { src: 'sawtooth', f: [[0, 90], [1.5, 100]], filter: { type: 'lowpass', f: [[0, 500], [1.5, 500]] }, gain: [[0, 0], [0.1, 0.05], [1.4, 0.05], [1.5, 0]] }); punch(v, t + 1.8, { weight: 0.1, peak: 0.15 }); });
  LS('apt-parking-ticket', 'Parking ticket machine', 1.6, 'Button, acceptance beep, intermittent feed and the ticket sliding out', (v, t) => {
    felt(v, t, 1200, 0.15); beep(v, t + 0.05, 1950, 0.06, 0.06);
    printerFeed(v, t + 0.3, 0.8, 0.85); v.surface(t + 1.15, { dur: 0.15, rate: 100, grain: 0.01, freq: 1800, peak: 0.07 });
  });
  LS('apt-shuttle-bus', 'Hotel shuttle', 6, 'Shuttle bus pulls in, air brakes hiss, door folds, chime', (v, t) => { diesel(v, t, 3.5, 30, 46, 0.1); v.noise(t + 3.5, { color: 'white', type: 'hp', freq: 2200, dur: 0.4, peak: 0.25 }); v.noise(t + 4.2, { color: 'pink', type: 'bp', freq: 800, dur: 0.6, peak: 0.12 }); chime(v, t + 4.9, 81, 0.08, 0.7); });
  LS('apt-rail-arrival', 'Airport train arrives', 8, 'Rails sing as the train brakes in, doors chime and slide open', (v, t) => { layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 300], [5, 200]] }, gain: [[0, 0], [1.5, 0.35], [4.5, 0.2], [5.2, 0]], pan: [[0, -0.8], [5, 0.2]] }); layer(v, t + 1, { src: 'triangle', f: [[0, 900], [4, 520]], filter: { type: 'bandpass', f: [[0, 900], [4, 520]], Q: 6 }, gain: [[0, 0], [0.5, 0.04], [3.8, 0.04], [4.2, 0]] }); v.noise(t + 5, { color: 'white', type: 'hp', freq: 2500, dur: 0.5, peak: 0.15 }); [76, 72, 76].forEach((n, i) => beep(v, t + 5.6 + i * 0.25, m(n), 0.22, 0.07)); layer(v, t + 6.4, { src: 'pink', filter: { type: 'bandpass', f: [[0, 900], [0.9, 900]], Q: 0.6 }, gain: [[0, 0], [0.2, 0.08], [0.7, 0.08], [0.9, 0]] }); }, 'chamber');
  LS('apt-rail-doors', 'Train door warning', 2, 'Door-closing chime and beeps, doors slam', (v, t) => { for (let i = 0; i < 6; i++) beep(v, t + i * 0.2, 2000, 0.1, 0.07); layer(v, t + 1.2, { src: 'pink', filter: { type: 'bandpass', f: [[0, 900], [0.5, 900]], Q: 0.6 }, gain: [[0, 0], [0.1, 0.08], [0.4, 0.08], [0.5, 0]] }); punch(v, t + 1.7, { weight: 0.3, peak: 0.25 }); }, 'chamber');
  LS('apt-rail-departure', 'Airport train departs', 7, 'Traction motors whine up as the train pulls out of the station', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 100], [5, 900], [7, 1000]], filter: { type: 'bandpass', f: [[0, 400], [7, 2500]], Q: 2 }, gain: [[0, 0], [1, 0.04], [5, 0.05], [7, 0]], pan: [[0, 0], [7, 0.9]] }); layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 250], [7, 250]] }, gain: [[0, 0], [2, 0.3], [5, 0.25], [7, 0]], pan: [[0, 0], [7, 0.9]] }); }, 'chamber');

  // ── Music stingers as playable sounds ──────────────────────────────────────
  const MS = (id: string, name: string, stinger: StingerName, key: string, body: number) => D('airport-music', id, name, body, STINGERS[stinger].description, (v, t) => { STINGERS[stinger].play(v, t, { key: parseKey(key), bpm: 100 }); }, 'hall', { variation: { pitch: 0, volume: 0 }, limit: 1, gain: 0.9 * ((STINGERS[stinger] as { gain?: number }).gain ?? 1) });
  MS('apt-stinger-award', 'Annual award', 'award', 'Bb major', 5.4);
  MS('apt-stinger-bankrupt', 'Bankruptcy / game over', 'bankrupt', 'D minor', 6.1);
  MS('apt-stinger-milestone', 'Milestone', 'milestone', 'D major', 3.35);
  MS('apt-stinger-contract', 'New airline partner', 'contract', 'Bb major', 2);
  MS('apt-stinger-victory', 'Objective complete', 'victory', 'F major', 4);

  // ── Ambience loops (RTPC) ──────────────────────────────────────────────────
  const L = (id: string, name: string, hint: string, play: (v: Voice, t: number) => void, scene: Scene) => D('airport-ambience', id, name, 10, hint, play, scene, { loop: true, limit: 2 });
  const glide = (p: AudioParam, x: number, time: number, tc = 0.6) => p.setTargetAtTime(x, time, tc);
  const scrubber = (v: Voice, t: number, f: number) => hum(v, t, f, 'sawtooth');
  /** Crowd density across a day: overnight trough, morning rush peak, midday plateau, evening rush peak. */
  const dayCurve = (h: number) => clamp(0.05 + 0.85 * Math.exp(-(((h - 0.3) / 0.06) ** 2)) + 0.45 * Math.exp(-(((h - 0.52) / 0.1) ** 2)) + 0.7 * Math.exp(-(((h - 0.75) / 0.07) ** 2)), 0, 1);
  L('apt-amb-day', 'Terminal through the day', 'One loop for a whole day: hour RTPC drives crowd density (rushes at ~07:00 and ~18:00), PA frequency, night cleaning machines and dawn quiet', (v, t) => {
    const h = () => ((v.param('hour', 0.35) % 1) + 1) % 1, crowd = () => dayCurve(h()), night = () => (h() < 0.2 || h() > 0.92 ? 1 : 0);
    const hvac = bed(v, t, 'brown', 'lowpass', 180), murmur = bed(v, t, 'pink', 'bandpass', 600, 0.5), scrub = scrubber(v, t, 62);
    const lp = v.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; scrub.g.disconnect(); scrub.g.connect(lp); lp.connect(v.dest); v.own(v.ctx.createConstantSource(), lp);
    const update = (time: number) => { glide(hvac.g.gain, 0.12, time); glide(murmur.g.gain, 0.02 + crowd() * 0.1, time, 1.5); glide(scrub.g.gain, night() * 0.03, time, 2); };
    v.onParam('hour', (_, time) => update(time)); update(t);
    poisson(v, () => crowd() * 4.2, time => syllable(v, time, v.random(0.03, 0.08), v.random(-0.9, 0.9), 1800));
    poisson(v, () => 0.2 + crowd() * 6, time => hit(v, time, 1500, 0.03, v.random(0.03, 0.07), 'stone', v.random(-0.9, 0.9)));
    poisson(v, () => 0.02 + crowd() * 0.3, time => { const p = v.random(-0.8, 0.8); for (let at = 0; at < 2; at += 0.3) hit(v, time + at, 700, 0.03, 0.04, 'stone', p + at * 0.1); });
    poisson(v, () => 0.005 + crowd() * 0.04, time => [67, 72, 76].forEach((n, i) => chime(v, time + i * 0.42, n, 0.06)));
  }, 'hall');
  L('apt-amb-night', 'Terminal at night', 'Near-empty hall: buzzing lights, floor scrubber and vacuum passes, a lone traveller; cleaning RTPC', (v, t) => {
    const x = () => clamp(v.param('cleaning', 0.5), 0, 1);
    const hvac = bed(v, t, 'brown', 'lowpass', 160), light = hum(v, t, 120, 'sawtooth'), scrub = scrubber(v, t, 58), vac = bed(v, t, 'pink', 'bandpass', 1400, 1.2);
    const lp = v.ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 2400; lp.Q.value = 3; light.g.disconnect(); light.g.connect(lp); lp.connect(v.dest); v.own(v.ctx.createConstantSource(), lp);
    const update = (time: number) => { glide(hvac.g.gain, 0.1, time); glide(light.g.gain, 0.012, time); glide(scrub.g.gain, x() * 0.03, time, 2); glide(vac.g.gain, x() * 0.05, time, 2); };
    v.onParam('cleaning', (_, time) => update(time)); update(t);
    poisson(v, () => 0.08, time => { const p = v.random(-0.8, 0.8); for (let i = 0; i < 6; i++) hit(v, time + i * 0.55, 1400, 0.03, 0.04, 'stone', p + i * 0.05); });
    poisson(v, () => 0.02, time => { vocal(v, time, { contour: [140, 200, 120], dur: 1.2, vowel: [300, 900], to: [700, 1100], peak: 0.04, breath: 0.6 }); });
  }, 'hall');
  L('apt-amb-food-court', 'Food court', 'Cutlery, trays, fryers, order bells, conversation; busy RTPC', (v, t) => {
    const x = () => clamp(v.param('busy', 0.5), 0, 1);
    const hvac = bed(v, t, 'brown', 'lowpass', 200), sizzle = bed(v, t, 'white', 'highpass', 4500);
    const update = (time: number) => { glide(hvac.g.gain, 0.1, time); glide(sizzle.g.gain, 0.006 + x() * 0.012, time); };
    v.onParam('busy', (_, time) => update(time)); update(t);
    poisson(v, () => x() * 4, time => syllable(v, time, v.random(0.03, 0.07), v.random(-0.9, 0.9), 2000));
    poisson(v, () => 0.5 + x() * 5, time => metallic(v, time, v.random(2500, 4500), 0.1, v.random(0.015, 0.04), v.random(-0.8, 0.8), [1, 1.6, 2.4]));
    poisson(v, () => 0.2 + x() * 1.5, time => hit(v, time, v.random(400, 900), 0.06, 0.05, 'ceramic', v.random(-0.8, 0.8)));
    poisson(v, () => 0.02 + x() * 0.15, time => metallic(v, time, 2650, 0.6, 0.05, v.random(-0.5, 0.5), [1, 2.1, 3.6]));
  }, 'chamber');
  L('apt-amb-vip-lounge', 'VIP lounge', 'Hushed luxury: soft carpet, glassware, distant piano bar, quiet conversation; occupancy RTPC', (v, t) => {
    const x = () => clamp(v.param('occupancy', 0.4), 0, 1);
    const hvac = bed(v, t, 'pink', 'lowpass', 350);
    const update = (time: number) => glide(hvac.g.gain, 0.06, time);
    v.onParam('occupancy', (_, time) => update(time)); update(t);
    poisson(v, () => x() * 1.3, time => syllable(v, time, v.random(0.02, 0.05), v.random(-0.7, 0.7), 1400));
    poisson(v, () => 0.1 + x() * 0.6, time => hit(v, time, v.random(2600, 3600), 0.3, 0.02, 'glass', v.random(-0.6, 0.6)));
    poisson(v, () => 0.6, time => { const n = [60, 64, 67, 71, 72, 74, 76][Math.floor(v.random(0, 7))]; v.additive(time, { f: m(n), dur: 1.5, peak: 0.03, pan: 0.5, partials: [{ ratio: 1, gain: 1 }, { ratio: 2, gain: 0.4, decay: 0.6 }, { ratio: 3, gain: 0.15, decay: 0.4 }] }); });
  }, 'room');
  L('apt-amb-curbside', 'Curbside drop-off', 'Outdoor departures road: traffic, taxis, doors, horns, whistles; traffic RTPC', (v, t) => {
    const x = () => clamp(v.param('traffic', 0.5), 0, 1);
    const road = bed(v, t, 'pink', 'lowpass', 700), idle = hum(v, t, 32, 'sawtooth');
    const lp = v.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 250; idle.g.disconnect(); idle.g.connect(lp); lp.connect(v.dest); v.own(v.ctx.createConstantSource(), lp);
    const update = (time: number) => { glide(road.g.gain, 0.08 + x() * 0.2, time); glide(idle.g.gain, 0.02 + x() * 0.05, time); };
    v.onParam('traffic', (_, time) => update(time)); update(t);
    poisson(v, () => 0.1 + x() * 0.6, time => { const p = v.random(-0.9, 0.9); impact(v, time, { weight: 0.5, material: 'bronze', freq: 140, peak: 0.12, pan: p }); });
    poisson(v, () => x() * x() * 0.5, time => { const d = v.random(0.1, 0.8); beep(v, time, 415, d, 0.04, 'sawtooth', v.random(-0.8, 0.8)); });
    poisson(v, () => 0.03 + x() * 0.15, time => v.tone(time, { f: 2900, dur: 0.3, peak: 0.03, type: 'sine', vibratoF: 38, vibratoD: 90, pan: v.random(-0.6, 0.6) }));
    poisson(v, () => x() * 1.3, time => syllable(v, time, 0.04, v.random(-0.9, 0.9), 2200));
  }, 'open');
  L('apt-amb-construction', 'Construction site', 'Expansion work: hammers, drills, saws, reversing beepers, a generator; workers RTPC', (v, t) => {
    const x = () => clamp(v.param('workers', 0.5), 0, 1);
    const gen = hum(v, t, 30, 'sawtooth');
    const lp = v.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; gen.g.disconnect(); gen.g.connect(lp); lp.connect(v.dest); v.own(v.ctx.createConstantSource(), lp);
    const update = (time: number) => glide(gen.g.gain, 0.03 + x() * 0.04, time);
    v.onParam('workers', (_, time) => update(time)); update(t);
    poisson(v, () => 0.1 + x() * 1.2, time => { const p = v.random(-0.8, 0.8), n = 2 + Math.floor(v.random(0, 5)); for (let i = 0; i < n; i++) { impact(v, time + i * 0.26, { weight: 0.2, material: 'wood', freq: 320, peak: 0.12, pan: p }); metallic(v, time + i * 0.26, 2400, 0.06, 0.03, p); } });
    poisson(v, () => x() * 0.15, time => layer(v, time, { src: 'sawtooth', f: [[0, 300], [0.15, 520], [0.5, 380], [1.2, 400], [1.3, 300]], filter: { type: 'bandpass', f: [[0, 1500], [1.3, 1500]], Q: 1 }, gain: [[0, 0], [0.1, 0.04], [1.2, 0.04], [1.3, 0]], pan: [[0, v.random(-0.7, 0.7)], [1.3, 0]] }));
    poisson(v, () => x() * 0.06, time => { for (let i = 0; i < 4; i++) beep(v, time + i, 1100, 0.5, 0.025, 'square', 0.7); });
  }, 'open');
  L('apt-amb-storm', 'Storm on the terminal roof', 'Rain drumming on the roof and glass, gusts, thunder; intensity RTPC', (v, t) => {
    const x = () => clamp(v.param('intensity', 0.4), 0, 1);
    const rain = bed(v, t, 'pink', 'highpass', 900), low = bed(v, t, 'brown', 'lowpass', 300), gust = bed(v, t, 'pink', 'bandpass', 500, 0.5);
    const update = (time: number) => { glide(rain.g.gain, 0.1 + x() * 0.3, time); glide(low.g.gain, 0.05 + x() * 0.2, time); glide(gust.g.gain, x() * 0.15, time); };
    v.onParam('intensity', (_, time) => update(time)); update(t);
    poisson(v, () => 8 + x() * 60, time => v.noise(time, { color: 'white', type: 'bp', freq: v.random(1500, 5000), Q: 2.5, dur: 0.01, peak: v.random(0.02, 0.08) * (0.5 + x()), pan: v.random(-0.9, 0.9) }));
    poisson(v, () => x() * x() * 0.12, time => { const close = v.random() < x() * 0.5; if (close) v.noise(time, { color: 'white', type: 'hp', freq: 1500, dur: 0.06, peak: 0.25 }); layer(v, time, { src: 'brown', filter: { type: 'lowpass', f: [[0, close ? 700 : 250], [4, 120]] }, gain: [[0, close ? 0.4 : 0.2], [1, 0.25], [4, 0]] }); });
  }, 'chamber');
  L('apt-amb-rail', 'Airport rail station', 'Underground platform: tunnel draught, trains arriving and leaving, door chimes; trains RTPC', (v, t) => {
    const x = () => clamp(v.param('trains', 0.4), 0, 1);
    const draught = bed(v, t, 'brown', 'lowpass', 220), air2 = bed(v, t, 'pink', 'bandpass', 400, 0.5);
    const update = (time: number) => { glide(draught.g.gain, 0.12, time); glide(air2.g.gain, 0.04, time); };
    v.onParam('trains', (_, time) => update(time)); update(t);
    poisson(v, () => 0.01 + x() * 0.08, time => { layer(v, time, { src: 'brown', filter: { type: 'lowpass', f: [[0, 300], [6, 200]] }, gain: [[0, 0], [2, 0.3], [5, 0.15], [6, 0]], pan: [[0, -0.8], [6, 0.6]] }); [76, 72, 76].forEach((n, i) => beep(v, time + 5 + i * 0.25, m(n), 0.22, 0.04)); });
    poisson(v, () => x() * 1.3, time => syllable(v, time, 0.04, v.random(-0.9, 0.9), 1600));
  }, 'chamber');

  // ── Events ─────────────────────────────────────────────────────────────────
  audio.defineEvent('apt-construct-any', { mode: 'shuffle', sounds: ['apt-construct-hammer', 'apt-construct-drill', 'apt-construct-saw', 'apt-construct-jackhammer'], category: 'airport-build', name: 'Construction noise (any)' });
  audio.defineEvent('apt-siren', { mode: 'switch', param: 'emergency', cases: { ambulance: 'apt-ambulance', fire: 'apt-fire-tender', police: 'apt-police-siren' }, default: 'apt-ambulance', category: 'airport-emergency', name: 'Emergency vehicle (switch)' });
  audio.defineEvent('apt-thunder', { mode: 'random', sounds: ['apt-thunder-close', 'apt-thunder-distant'], weights: [1, 2], category: 'airport-weather', name: 'Thunder (any)' });
  audio.defineEvent('apt-takeoff-size', { mode: 'switch', param: 'aircraft', cases: { regional: 'apt-regional-takeoff', narrow: 'apt-jet-takeoff', wide: 'apt-widebody-takeoff', bizjet: 'apt-bizjet-takeoff', turboprop: 'apt-turboprop-takeoff' }, default: 'apt-jet-takeoff', category: 'airport-aircraft', name: 'Take-off by aircraft size (switch)' });
}
