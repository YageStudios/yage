/** Airport: a complete sound suite for airport games (tycoon/management, sims, adventure).
 *
 *  airport-aircraft  jets, turboprop, piston, helicopter: takeoff, landing, flyby (physical Doppler),
 *                    engine start/shutdown, touchdown chirp, reverse thrust
 *  airport-ground    tugs, pushback, beepers, fuel/catering/belt loaders, jet bridge, cargo doors
 *  airport-terminal  PA chimes, split-flap boards, doors, escalator, suitcases, kiosks, scanners, e-gates
 *  airport-security  walk-through detector, wand, x-ray belt, trays, body scanner
 *  airport-baggage   carousel start horn, bag drops, trolleys
 *  airport-cabin     cabin chimes (lo/hi/hi-lo), seatbelt, bins, galley, lavatory vacuum
 *  airport-atc       radio squelch & chatter, marker beacons, ILS ident, tower alerts, cockpit cues
 *  airport-game      gameplay feedback for airport management games
 *  airport-ambience  8 RTPC-driven loops (terminal crowd, gate, apron, baggage, security, engine, cabin, tower)
 *
 * Sources for the authentic details (buzz-saw tones, chime meanings, marker-beacon tones) are listed
 * in docs/airport-sound-suite.md.
 */
import type { GameAudio } from '../engine';
import type { Voice } from '../voice';
import type { Scene } from '../spaces';
import { diesel, printerFeed, whistle } from './airport-mechanics';
import { airportSpace, airportFinish } from './airport-feel';
import { humanGesture, humanPhrase } from './airport-human';
import { jetTakeoff, jetLanding, jetPass, jetStart, reverseThrust, touchdown, propeller, helicopter, turbofanLoop } from './airport-aircraft';
import type { SoundDefinition } from '../types';
import { clamp } from '../dsp';
import { hit, metallic, m, pluck } from './airport-materials';
import { clap, snap, punch, crunch, impact } from './airport-materials';
import { AIRPORT_LEVELS } from './airport-levels';
import { registerAirportTycoonSounds, TYCOON_CATEGORIES, TYCOON_PARAMS } from './airport-tycoon';
import { bed, hum, beep, chime, flight, grumble, layer, morse, poisson, radio, scale, solidKey, syllable, thudless, typing, vocal } from './airport-kit';

const BASE_CATEGORIES = {
  'airport-aircraft': 'Airport · Aircraft',
  'airport-ground': 'Airport · Ground vehicles',
  'airport-terminal': 'Airport · Terminal',
  'airport-security': 'Airport · Security',
  'airport-baggage': 'Airport · Baggage',
  'airport-cabin': 'Airport · Cabin',
  'airport-atc': 'Airport · ATC & cockpit',
  'airport-desk': 'Airport · Check-in desk',
  'airport-people': 'Airport · People',
  'airport-game': 'Airport · Game feedback',
  'airport-ambience': 'Airport · Ambience (RTPC)',
} as const;
export const AIRPORT_CATEGORIES = { ...BASE_CATEGORIES, ...TYCOON_CATEGORIES } as const;
type Cat = keyof typeof BASE_CATEGORIES;

/** Parameters of the continuous airport loops (all 0..1). */
const BASE_PARAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'apt-amb-terminal': { crowd: 'Empty hall (0) to holiday rush (1)', mood: 'Content (0) to fed-up passengers grumbling, sighing and tutting (1)' },
  'apt-amb-gate': { activity: 'Quiet early-morning gate (0) to boarding scrum (1)' },
  'apt-amb-apron': { activity: 'Sleepy stand (0) to turnaround chaos (1)' },
  'apt-amb-baggage': { running: 'Carousel stopped (0) to full speed with bags (1)' },
  'apt-amb-security': { busy: 'One lane (0) to every lane open (1)' },
  'apt-amb-jet-engine': { thrust: 'Idle (0) to take-off thrust (1); spools with real inertia' },
  'apt-amb-cabin': { turbulence: 'Smooth cruise (0) to rough air (1)' },
  'apt-amb-tower': { traffic: 'Quiet frequency (0) to non-stop radio (1)' },
};
export const AIRPORT_PARAMS: Readonly<Record<string, Readonly<Record<string, string>>>> = { ...BASE_PARAMS, ...TYCOON_PARAMS };

export function registerAirportSounds(audio: GameAudio): void {
  const D = (cat: Cat, id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'room', meta: Partial<SoundDefinition> = {}): void => {
    const space = airportSpace(cat, scene, id);
    const tail = space.wet ? (space.decay ?? 0) * 1.12 + 0.12 + (space.preDelay ?? 0) : space.early ? 0.08 : 0.02;
    audio.define(id, { category: cat, bus: cat === 'airport-ambience' ? 'ambient' : 'sfx', name, hint, gain: (meta.gain ?? 0.9) * (AIRPORT_LEVELS[id] ?? 1),
      duration: meta.loop ? 10 : Math.ceil((body + tail + 0.08) * 100) / 100, loop: meta.loop,
      tags: ['airport', cat.replace('airport-', ''), ...id.split('-')], variation: meta.variation ?? { pitch: 0.5, volume: 1.5 }, limit: meta.limit ?? 6, cooldown: meta.cooldown, priority: meta.priority ?? (meta.loop ? 20 : 4),
      play: (v, t) => { v.space(space); airportFinish(v, cat); play(v, t); } });
  };

  // ── Aircraft ───────────────────────────────────────────────────────────────
  const A = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'open') => D('airport-aircraft', id, name, body, hint, play, scene, { limit: 3, variation: { pitch: 0.3, volume: 1 } });
  A('apt-jet-takeoff', 'Jet take-off', 16, 'Inlet grows into a broad moving roar; tyre contact ends at rotation and exhaust recedes', (v, t) => jetTakeoff(v, t));
  A('apt-jet-landing', 'Jet landing', 14, 'Approach, paired tyre friction, rolling contact, delayed reverse thrust and deceleration', (v, t) => jetLanding(v, t));
  A('apt-jet-flyby', 'Jet fly-by', 9, 'Fan detail on approach, a full broadband pass and a later exhaust wake', (v, t) => jetPass(v, t));
  A('apt-jet-flyover-low', 'Low jet fly-over', 7, 'Close approach: fast spatial crossing, wing/airflow wash and an exhaust tail', (v, t) => jetPass(v, t, { duration: 7, pass: 3.2, speed: 75, height: 40, spool: 0.62 }));
  A('apt-jet-taxi-pass', 'Jet taxi past', 10, 'Low thrust, slow pan and low-mid engine body with faint fan detail', (v, t) => jetPass(v, t, { duration: 10, speed: 9, height: 25, spool: 0.19 }));
  A('apt-engine-start', 'Jet engine start', 9, 'Air starter, soft combustion light-off, accelerating fan turbulence and idle', (v, t) => jetStart(v, t));
  A('apt-engine-shutdown', 'Jet engine shutdown', 9, 'Combustion fades first; rotating airflow winds down without a long pure whistle', (v, t) => jetStart(v, t, true));
  A('apt-reverse-thrust', 'Reverse thrust', 5, 'Cascade engagement followed by a textured broadband surge and slow release', (v, t) => reverseThrust(v, t));
  A('apt-touchdown-chirp', 'Touchdown chirp', 0.55, 'Two brief tyre-friction contacts with weight below the squeal', (v, t) => touchdown(v, t));
  A('apt-turboprop-takeoff', 'Turboprop take-off', 12, 'Paired propeller blade pulses accelerate into a beating, air-loaded departure', (v, t) => propeller(v, t, 'takeoff'));
  A('apt-turboprop-flyby', 'Turboprop fly-by', 8, 'Two independently rotating propellers, blade-modulated wash and a Doppler pass', (v, t) => propeller(v, t, 'turboprop'));
  A('apt-prop-plane-pass', 'Light aircraft pass', 8, 'Uneven piston/exhaust harmonics and one two-blade propeller cross the listener', (v, t) => propeller(v, t, 'piston'));
  A('apt-helicopter-pass', 'Helicopter pass', 9, 'Blade-slap impulses and modulated rotor wash share the Doppler trajectory', (v, t) => helicopter(v, t));

  // ── Ground vehicles ────────────────────────────────────────────────────────
  const G = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'open') => D('airport-ground', id, name, body, hint, play, scene);
  const beeper = (v: Voice, t: number, n: number, f = 1040, peak = 0.12) => { for (let i = 0; i < n; i++) beep(v, t + i * 1.0, f, 0.5, peak, 'square'); };
  G('apt-baggage-tug-pass', 'Baggage tug & carts', 7, 'Electric tug whine and a train of rattling carts crossing left to right', (v, t) => {
    const fl = flight(7, 3.5, 6, 12), f = (b: number) => fl.doppler.map(([a, k]) => [a, b * k] as const);
    layer(v, t, { src: 'sine', f: f(1150), gain: scale(fl.level, 0.025), pan: fl.pan }); layer(v, t, { src: 'triangle', f: f(230), filter: { type: 'lowpass', f: [[0, 900], [7, 900]] }, gain: scale(fl.level, 0.05), pan: fl.pan });
    for (let i = 0; i < 26; i++) { const at = v.random(0.4, 6.6), k = Math.min(47, Math.round(at / 7 * 48)); hit(v, t + at, v.random(500, 1300), 0.06, 0.12 * fl.level[k][1], 'stone', fl.pan[k][1]); }
  });
  G('apt-tug-horn', 'Tug horn', 0.6, 'Short double toot of a ground vehicle horn', (v, t) => { [0, 0.22].forEach(d => { beep(v, t + d, 410, 0.16, 0.12, 'sawtooth'); beep(v, t + d, 515, 0.16, 0.09, 'sawtooth'); }); });
  G('apt-pushback', 'Pushback', 9, 'Tow bar hitch clunk · diesel tractor strains · aircraft rolls back', (v, t) => {
    metallic(v, t, 600, 0.3, 0.25); punch(v, t, { weight: 0.5, peak: 0.35 });
    diesel(v, t + 0.6, 8.2, 38, 52, 0.14); layer(v, t + 0.6, { src: 'triangle', f: [[0, 420], [8, 430]], filter: { type: 'bandpass', f: [[0, 420], [8, 430]], Q: 3 }, gain: [[0, 0], [1, 0.03], [7, 0.03], [8.2, 0]] });
  });
  G('apt-reverse-beeper', 'Reversing beeper', 4, 'Vehicle backing up: four 1 kHz beeps', (v, t) => beeper(v, t, 4));
  G('apt-fuel-truck', 'Fuel truck pumping', 6, 'Diesel PTO pump whines up · fuel rushes through the hose · cuts off', (v, t) => {
    diesel(v, t, 6, 32, 40, 0.1);
    layer(v, t, { src: 'triangle', f: [[0, 200], [1, 620], [5.5, 620], [6, 300]], filter: { type: 'bandpass', f: [[0, 200], [1, 620], [6, 300]], Q: 4 }, gain: [[0, 0], [1, 0.04], [5.5, 0.04], [6, 0]] });
    layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 700], [6, 700]], Q: 0.6 }, gain: [[0, 0], [1.2, 0.12], [5.5, 0.12], [6, 0]] });
  });
  G('apt-catering-lift', 'Catering truck lift', 5, 'Hydraulic scissor lift raises the galley box, then a hard stop', (v, t) => {
    layer(v, t, { src: 'sawtooth', f: [[0, 90], [0.5, 140], [4.2, 150], [4.4, 90]], filter: { type: 'lowpass', f: [[0, 600], [4.4, 600]], Q: 3 }, gain: [[0, 0], [0.5, 0.08], [4.2, 0.08], [4.4, 0]] });
    layer(v, t, { src: 'pink', filter: { type: 'highpass', f: [[0, 3000], [4, 3000]] }, gain: [[0, 0], [0.5, 0.03], [4.2, 0.03], [4.4, 0]] });
    metallic(v, t + 4.4, 420, 0.4, 0.2); punch(v, t + 4.4, { weight: 0.3, peak: 0.3 });
  });
  G('apt-belt-loader', 'Belt loader', 6, 'Inclined conveyor motor runs, bags thump up the belt', (v, t) => {
    layer(v, t, { src: 'sawtooth', f: [[0, 55], [6, 55]], filter: { type: 'lowpass', f: [[0, 400], [6, 400]] }, gain: [[0, 0], [0.4, 0.06], [5.6, 0.06], [6, 0]] });
    for (let i = 0; i < 5; i++) { const at = 0.6 + i * 1.05 + v.random(0, 0.2); punch(v, t + at, { weight: 0.2, peak: 0.25 }); v.surface(t + at + 0.05, { dur: 0.25, rate: 60, grain: 0.01, freq: 900, peak: 0.06 }); }
  });
  G('apt-jetbridge-dock', 'Jet bridge docks', 6, 'Bridge motors whir, canopy closes onto the fuselage, latches thunk', (v, t) => {
    layer(v, t, { src: 'sawtooth', f: [[0, 80], [0.5, 120], [4, 118], [4.4, 70]], filter: { type: 'lowpass', f: [[0, 700], [4.4, 500]], Q: 2 }, gain: [[0, 0], [0.5, 0.07], [4, 0.07], [4.4, 0]] });
    layer(v, t, { src: 'sine', f: [[0, 600], [0.5, 900], [4, 900], [4.4, 500]], gain: [[0, 0], [0.5, 0.015], [4, 0.015], [4.4, 0]] });
    punch(v, t + 4.4, { weight: 0.6, peak: 0.4 }); hit(v, t + 4.42, 260, 0.3, 0.2, 'wood'); metallic(v, t + 4.9, 900, 0.2, 0.1); metallic(v, t + 5.1, 950, 0.2, 0.1);
  }, 'chamber');
  G('apt-cargo-door', 'Cargo door open', 5, 'Hydraulic actuator hum, door swings up and locks with a clack', (v, t) => {
    layer(v, t, { src: 'sawtooth', f: [[0, 120], [0.3, 160], [3.6, 165], [3.8, 100]], filter: { type: 'lowpass', f: [[0, 900], [3.8, 900]], Q: 2 }, gain: [[0, 0], [0.3, 0.06], [3.6, 0.06], [3.8, 0]] });
    v.surface(t + 0.4, { dur: 3, rate: 25, grain: 0.02, freq: 800, peak: 0.03 }); metallic(v, t + 3.9, 700, 0.25, 0.18); snap(v, t + 3.9, { peak: 0.25, freq: 2500 });
  });
  G('apt-marshaller-whistle', 'Ramp whistle', 0.8, 'Two pressure-driven pea-whistle blasts with cavity flutter and breath', (v, t) => { whistle(v, t, 0.22, 0.12); whistle(v, t + 0.3, 0.24, 0.1); });

  // ── Terminal ───────────────────────────────────────────────────────────────
  const T = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'hall', meta: Partial<SoundDefinition> = {}) => D('airport-terminal', id, name, body, hint, play, scene, meta);
  const tuned = { variation: { pitch: 0, volume: 0.5 } };
  T('apt-pa-chime-2', 'PA chime · two-tone', 2.2, 'Classic "ding-dong" descending major third before an announcement', (v, t) => { chime(v, t, 76); chime(v, t + 0.55, 72); }, 'hall', tuned);
  T('apt-pa-chime-3', 'PA chime · three-tone', 2.8, 'Rising G–C–E triad: the airport attention chime', (v, t) => { [67, 72, 76].forEach((n, i) => chime(v, t + i * 0.42, n)); }, 'hall', tuned);
  T('apt-pa-chime-4', 'PA chime · four-tone', 3.4, 'Four-note C–E–G–C arpeggio for important announcements', (v, t) => { [60, 64, 67, 72].forEach((n, i) => chime(v, t + i * 0.38, n, 0.2)); }, 'hall', tuned);
  T('apt-pa-chime-end', 'PA chime · end', 2.6, 'Descending E–C–G triad closing an announcement', (v, t) => { [76, 72, 67].forEach((n, i) => chime(v, t + i * 0.42, n)); }, 'hall', tuned);
  T('apt-pa-announcement', 'PA announcement', 6, 'Attention chime, then one non-verbal speaker with phrase breaks through the PA', (v, t) => {
    [67, 72, 76].forEach((n, i) => chime(v, t + i * 0.42, n, 0.16, 1.2));
    const pitch = v.random(145, 162);
    humanPhrase(v, t + 1.65, { pitch, size: 1.02, duration: 1.7, syllables: 9, peak: 0.22, channel: 'pa' });
    humanPhrase(v, t + 3.66, { pitch, size: 1.02, duration: 1.93, syllables: 10, peak: 0.2, channel: 'pa' });
  }, 'hall', tuned);
  T('apt-split-flap-update', 'Departure board update', 2.5, 'Solari split-flap board: a wave of metallic click-clack sweeping across the rows', (v, t) => {
    for (let i = 0; i < 90; i++) { const at = Math.pow(v.random(), 0.8) * 2.1 + (i % 12) * 0.008; const p = v.random(-0.7, 0.7); hit(v, t + at, v.random(2400, 3600), 0.012, v.random(0.05, 0.11), 'ceramic', p, [1, 1.7]); if (i % 3 === 0) snap(v, t + at, { peak: 0.04, freq: 4500, dur: 0.0012, pan: p }); }
  }, 'chamber');
  T('apt-split-flap-single', 'Flap display flick', 0.4, 'One split-flap module flicking through a few characters', (v, t) => { for (let i = 0; i < 7; i++) hit(v, t + i * 0.035, 3000 + v.random(-200, 200), 0.012, 0.12, 'ceramic', 0, [1, 1.7]); }, 'room');
  T('apt-auto-door-open', 'Automatic door open', 1.6, 'Sensor beep, motor whir, glass panels slide apart with a soft stop', (v, t) => { beep(v, t, 2400, 0.04, 0.04); layer(v, t + 0.05, { src: 'sawtooth', f: [[0, 90], [0.3, 140], [1.1, 135], [1.3, 90]], filter: { type: 'lowpass', f: [[0, 500], [1.3, 500]] }, gain: [[0, 0], [0.2, 0.05], [1.1, 0.05], [1.3, 0]] }); v.noise(t + 0.1, { color: 'pink', type: 'bp', freq: 1500, Q: 0.6, dur: 1.1, peak: 0.03, flat: true, fade: { in: 0.2, hold: 0.6, out: 0.3 } }); punch(v, t + 1.3, { weight: 0, peak: 0.12, freq: 140 }); }, 'room');
  T('apt-auto-door-close', 'Automatic door close', 1.5, 'Panels glide shut and seal with a rubber thump', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 90], [0.3, 135], [1, 130], [1.2, 90]], filter: { type: 'lowpass', f: [[0, 500], [1.2, 500]] }, gain: [[0, 0], [0.2, 0.05], [1, 0.05], [1.2, 0]] }); punch(v, t + 1.2, { weight: 0.15, peak: 0.2, freq: 110 }); }, 'room');
  T('apt-escalator-step', 'Escalator', 4, 'Comb plate rumble, rhythmic step clatter, handrail hiss', (v, t) => { layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 200], [4, 200]] }, gain: [[0, 0], [0.4, 0.2], [3.6, 0.2], [4, 0]] }); for (let at = 0.2; at < 3.8; at += 0.62) { hit(v, t + at, 420, 0.06, 0.1, 'stone'); metallic(v, t + at + 0.02, 1100, 0.04, 0.03); } layer(v, t, { src: 'pink', filter: { type: 'highpass', f: [[0, 2500], [4, 2500]] }, gain: [[0, 0], [0.4, 0.02], [3.6, 0.02], [4, 0]] }); }, 'chamber');
  T('apt-travelator-end', 'Moving walkway end', 1.2, 'End-of-walkway warning beeps over the belt rumble', (v, t) => { layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 220], [1.2, 220]] }, gain: [[0, 0], [0.2, 0.15], [1, 0.15], [1.2, 0]] }); [0, 0.3, 0.6].forEach(d => beep(v, t + d, 880, 0.15, 0.08)); }, 'chamber');
  T('apt-suitcase-roll', 'Rolling suitcase', 3, 'Hard-shell spinner case rolls across tile: wheel rumble and grout clicks', (v, t) => { const fl = flight(3, 1.5, 1.4, 1.2); layer(v, t, { src: 'brown', filter: { type: 'bandpass', f: [[0, 260], [3, 260]], Q: 0.8 }, gain: scale(fl.level, 0.25), pan: fl.pan }); for (let at = 0.15; at < 2.9; at += 0.3 + v.random(-0.02, 0.02)) { const k = Math.min(47, Math.round(at / 3 * 48)); hit(v, t + at, 700, 0.03, 0.12 * fl.level[k][1], 'stone', fl.pan[k][1]); } }, 'chamber', { variation: { pitch: 1, volume: 2 } });
  T('apt-suitcase-drop', 'Suitcase set down', 0.6, 'Heavy case tipped onto its wheels: thud and handle clack', (v, t) => { impact(v, t, { weight: 0.5, material: 'wood', freq: 180, peak: 0.45 }); hit(v, t + 0.12, 1500, 0.05, 0.1, 'ceramic'); }, 'room');
  T('apt-suitcase-zip', 'Suitcase zip', 1, 'Long zipper run around a suitcase lid', (v, t) => { for (let i = 0; i < 70; i++) v.noise(t + i * 0.013, { color: 'white', type: 'bp', freq: 3000 + Math.sin(i / 9) * 400, Q: 2, dur: 0.003, peak: 0.1 }); }, 'touch');
  T('apt-footstep-tile', 'Footstep · terminal tile', 0.3, 'Hard shoe heel then sole on polished stone', (v, t) => { hit(v, t, 1500, 0.04, 0.2, 'stone'); punch(v, t, { weight: 0, peak: 0.1, freq: 130 }); hit(v, t + 0.06, 900, 0.03, 0.08, 'stone'); }, 'chamber', { variation: { pitch: 1.5, volume: 3 }, limit: 8 });
  T('apt-footstep-carpet', 'Footstep · gate carpet', 0.3, 'Muffled step on commercial carpet', (v, t) => { punch(v, t, { weight: 0, peak: 0.12, freq: 120 }); v.noise(t, { color: 'pink', type: 'lp', freq: 900, dur: 0.07, peak: 0.08 }); }, 'room', { variation: { pitch: 1.5, volume: 3 }, limit: 8 });
  T('apt-kiosk-tap', 'Check-in kiosk tap', 0.2, 'Glass touchscreen tap with a soft confirmation blip', (v, t) => { thudless(v, t); beep(v, t + 0.01, 1760, 0.05, 0.08); }, 'room', { cooldown: 0.03 });
  T('apt-boarding-pass-print', 'Boarding pass print', 2.2, 'Uneven thermal feed, paper friction, cutter and a card dropping into the slot', (v, t) => {
    printerFeed(v, t, 1.6); snap(v, t + 1.65, { peak: 0.15, freq: 2700 });
    hit(v, t + 1.651, 680, 0.038, 0.12, 'wood');
    v.noise(t + 1.8, { color: 'pink', type: 'bp', freq: 1200, dur: 0.1, peak: 0.09, attack: 0.005 });
  }, 'room');
  T('apt-scan-ok', 'Barcode scan · OK', 0.3, 'Scanner accepts: crisp single high beep', (v, t) => beep(v, t, 2730, 0.09, 0.12), 'room', { cooldown: 0.05, variation: { pitch: 0, volume: 0.5 } });
  T('apt-scan-fail', 'Barcode scan · rejected', 0.6, 'Scanner rejects: low buzzy double beep', (v, t) => { beep(v, t, 440, 0.14, 0.12, 'square'); beep(v, t + 0.2, 440, 0.14, 0.12, 'square'); }, 'room', { cooldown: 0.05, variation: { pitch: 0, volume: 0.5 } });
  T('apt-e-gate-open', 'E-gate opens', 1.2, 'Passport accepted: chime, glass flaps swing open', (v, t) => { beep(v, t, 1568, 0.08, 0.08); beep(v, t + 0.1, 2093, 0.12, 0.08); layer(v, t + 0.25, { src: 'sawtooth', f: [[0, 110], [0.5, 110]], filter: { type: 'lowpass', f: [[0, 600], [0.5, 600]] }, gain: [[0, 0], [0.1, 0.05], [0.45, 0.05], [0.5, 0]] }); punch(v, t + 0.75, { weight: 0, peak: 0.12, freq: 150 }); }, 'room');
  T('apt-passport-stamp', 'Passport stamp', 0.4, 'Self-inking stamp: spring plunge, rubber meets paper, desk thump', (v, t) => { v.surface(t, { dur: 0.05, rate: 200, grain: 0.003, freq: 2000, peak: 0.05 }); punch(v, t + 0.06, { weight: 0.3, peak: 0.4, freq: 110 }); hit(v, t + 0.06, 520, 0.08, 0.25, 'wood'); v.noise(t + 0.06, { color: 'pink', type: 'bp', freq: 1500, dur: 0.03, peak: 0.1 }); }, 'room');
  T('apt-coffee-machine', 'Coffee machine', 5, 'Grinder burr, pump hum, steam hiss and a final drip', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 160], [1.6, 170]], filter: { type: 'bandpass', f: [[0, 1200], [1.6, 1200]], Q: 0.8 }, gain: [[0, 0], [0.1, 0.06], [1.5, 0.06], [1.6, 0]] }); crunch(v, t, { dur: 1.5, events: 40, centroid: 2500, grain: 0.004, decay: 1, peak: 0.08, cluster: 0 }); layer(v, t + 1.9, { src: 'sawtooth', f: [[0, 50], [2, 50]], filter: { type: 'lowpass', f: [[0, 300], [2, 300]] }, gain: [[0, 0], [0.1, 0.05], [1.9, 0.05], [2, 0]] }); v.noise(t + 3.6, { color: 'white', type: 'hp', freq: 4000, dur: 0.8, peak: 0.1, attack: 0.05 }); }, 'room');
  T('apt-vending-drop', 'Vending machine drop', 1.5, 'Coil motor turns, bottle drops into the tray', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 70], [0.8, 70]], filter: { type: 'lowpass', f: [[0, 400], [0.8, 400]] }, gain: [[0, 0], [0.05, 0.05], [0.75, 0.05], [0.8, 0]] }); impact(v, t + 0.95, { weight: 0.4, material: 'stone', freq: 260, peak: 0.45 }); hit(v, t + 1.05, 700, 0.1, 0.1, 'ceramic'); }, 'room');
  T('apt-elevator-ding', 'Elevator arrival', 1.6, 'Car arrives: single soft chime as the doors part', (v, t) => { chime(v, t, 81, 0.18, 1.4); layer(v, t + 0.3, { src: 'pink', filter: { type: 'bandpass', f: [[0, 1200], [1, 1200]], Q: 0.6 }, gain: [[0, 0], [0.2, 0.03], [0.8, 0.03], [1, 0]] }); }, 'room', tuned);
  T('apt-duty-free-bag', 'Duty-free bag', 0.8, 'Crisp paper shopping bag handed over', (v, t) => { crunch(v, t, { dur: 0.6, events: 50, centroid: 3500, grain: 0.004, decay: 0.99, peak: 0.12, cluster: 0.3, air: 0.2 }); }, 'room');

  // ── Security ───────────────────────────────────────────────────────────────
  const S = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-security', id, name, body, hint, play, 'chamber', meta);
  S('apt-detector-pass', 'Walk-through · clear', 0.5, 'Archway clears you: soft rising two-tone', (v, t) => { beep(v, t, 880, 0.12, 0.08); beep(v, t + 0.14, 1175, 0.18, 0.08); }, { variation: { pitch: 0, volume: 0.5 } });
  S('apt-detector-alarm', 'Walk-through · alarm', 2.2, 'Metal detected: pulsing warble with the red light', (v, t) => { for (let i = 0; i < 8; i++) { beep(v, t + i * 0.25, i % 2 ? 1450 : 1700, 0.18, 0.12, 'square'); } }, { variation: { pitch: 0, volume: 0.5 } });
  S('apt-wand-beep', 'Hand wand', 1.2, 'Hand-held detector sweeps, chirps over a belt buckle', (v, t) => { v.tone(t, { f: 900, dur: 0.6, peak: 0.02, type: 'sine', flat: true, fade: { in: 0.05, hold: 0.5, out: 0.05 } }); layer(v, t + 0.5, { src: 'square', f: [[0, 1800], [0.3, 2600], [0.6, 1800]], filter: { type: 'lowpass', f: [[0, 5000], [0.6, 5000]] }, gain: [[0, 0], [0.05, 0.06], [0.55, 0.06], [0.6, 0]] }); });
  S('apt-xray-belt', 'X-ray conveyor', 4, 'Belt motor starts, bins ride into the tunnel past the curtain, belt stops', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 40], [0.4, 60], [3.6, 60], [4, 35]], filter: { type: 'lowpass', f: [[0, 350], [4, 350]] }, gain: [[0, 0], [0.4, 0.07], [3.6, 0.07], [4, 0]] }); for (let i = 0; i < 5; i++) hit(v, t + 0.5 + i * 0.65, 600, 0.04, 0.05, 'wood'); v.surface(t + 1.5, { dur: 0.6, rate: 80, grain: 0.012, freq: 1400, peak: 0.05 }); });
  S('apt-tray-slide', 'Tray slide', 0.8, 'Plastic bin shoved along steel rollers', (v, t) => { for (let i = 0; i < 9; i++) hit(v, t + i * 0.07, 900 + v.random(-60, 60), 0.03, 0.12 - i * 0.008, 'ceramic', 0, [1, 2.3]); v.noise(t, { color: 'pink', type: 'bp', freq: 1100, dur: 0.6, peak: 0.05, flat: true, fade: { in: 0.02, hold: 0.4, out: 0.18 } }); });
  S('apt-tray-stack', 'Tray stack', 0.7, 'Empty bins clatter onto the return stack', (v, t) => { impact(v, t, { weight: 0.3, material: 'ceramic', freq: 420, peak: 0.4 }); for (let i = 0; i < 4; i++) hit(v, t + 0.06 + i * 0.05, 700 + i * 60, 0.05, 0.12, 'ceramic'); });
  S('apt-body-scanner', 'Body scanner', 2.4, 'Millimetre-wave arms sweep around you: whoosh out and back, done chime', (v, t) => { [0, 0.9].forEach((d, i) => v.noise(t + d, { color: 'pink', type: 'bp', freq: i ? 2500 : 800, freq2: i ? 800 : 2500, Q: 1.5, dur: 0.85, peak: 0.12, pan: i ? 0.6 : -0.6, fade: { in: 0.3, hold: 0.1, out: 0.45 } })); beep(v, t + 1.9, 1319, 0.12, 0.07); beep(v, t + 2.05, 1760, 0.18, 0.07); });

  // ── Baggage ────────────────────────────────────────────────────────────────
  const B = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, scene: Scene = 'chamber') => D('airport-baggage', id, name, body, hint, play, scene);
  B('apt-carousel-start', 'Carousel start', 4.5, 'Warning horn and beacon, chain drive motor starts, slats begin to clatter', (v, t) => {
    for (let i = 0; i < 3; i++) { beep(v, t + i * 0.55, 620, 0.35, 0.12, 'sawtooth'); beep(v, t + i * 0.55, 780, 0.35, 0.08, 'sawtooth'); }
    layer(v, t + 1.7, { src: 'sawtooth', f: [[0, 20], [1.2, 48], [2.8, 50]], filter: { type: 'lowpass', f: [[0, 250], [2.8, 400]] }, gain: [[0, 0], [1.2, 0.08], [2.6, 0.08], [2.8, 0]] });
    for (let at = 2; at < 4.4; at += 0.42 - Math.min(0.22, (at - 2) * 0.1)) hit(v, t + at, 380, 0.05, 0.09, 'stone');
  });
  B('apt-bag-drop-carousel', 'Bag drops onto carousel', 0.8, 'Suitcase slides down the chute and slams onto the slats', (v, t) => { v.surface(t, { dur: 0.3, rate: 60, grain: 0.012, freq: 900, peak: 0.06 }); impact(v, t + 0.32, { weight: 0.6, material: 'wood', freq: 170, peak: 0.5 }); hit(v, t + 0.38, 1200, 0.05, 0.1, 'ceramic'); });
  B('apt-bag-thud', 'Bag thud', 0.4, 'Soft duffel bag lands', (v, t) => { punch(v, t, { weight: 0.4, peak: 0.45, freq: 85 }); v.noise(t, { color: 'pink', type: 'lp', freq: 800, dur: 0.1, peak: 0.12 }); });
  B('apt-trolley-push', 'Luggage trolley push', 3, 'Steel trolley rattles across expansion joints', (v, t) => { layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 300], [3, 300]] }, gain: [[0, 0], [0.3, 0.12], [2.7, 0.12], [3, 0]] }); for (let i = 0; i < 24; i++) metallic(v, t + v.random(0.1, 2.9), v.random(900, 1800), 0.05, 0.03, v.random(-0.3, 0.3), [1, 1.5]); [0.8, 2].forEach(d => { punch(v, t + d, { weight: 0, peak: 0.12 }); metallic(v, t + d, 1200, 0.1, 0.06); }); });
  B('apt-trolley-stack', 'Trolley stack', 1, 'Trolley nests into the line with a ringing steel clash', (v, t) => { impact(v, t, { weight: 0.4, material: 'bronze', freq: 380, peak: 0.4 }); metallic(v, t + 0.01, 1300, 0.6, 0.12); metallic(v, t + 0.15, 1700, 0.3, 0.05); });

  // ── Cabin ──────────────────────────────────────────────────────────────────
  const C = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-cabin', id, name, body, hint, play, 'cabinet', meta);
  const cabinChime = (v: Voice, t: number, f: number, peak = 0.2) => {
    v.resonate(t, { f, dur: 1.2, peak: peak * 0.82, material: 'tine', modes: [1, 2.01], strike: 0.035, bloom: 0.004, width: 0.08 });
    v.tone(t, { f, dur: 0.95, peak: peak * 0.35, attack: 0.005 });
    v.noise(t, { color: 'pink', type: 'lp', freq: 1400, dur: 0.012, peak: peak * 0.045, attack: 0.001 });
  };
  C('apt-cabin-chime-lo', 'Cabin chime · low', 1.5, 'Low single chime: passenger signs on/off', (v, t) => cabinChime(v, t, m(76)), tuned);
  C('apt-cabin-chime-hi', 'Cabin chime · high', 1.5, 'High single chime: attendant call button', (v, t) => cabinChime(v, t, m(83)), tuned);
  C('apt-cabin-chime-hilo', 'Cabin chime · high-low', 2, 'High-low: crew interphone call', (v, t) => { cabinChime(v, t, m(83)); cabinChime(v, t + 0.45, m(76)); }, tuned);
  C('apt-seatbelt-click', 'Seatbelt buckle', 0.2, 'Metal latch plate snaps into the buckle', (v, t) => { metallic(v, t, 2600, 0.04, 0.15, 0, [1, 1.5]); snap(v, t, { peak: 0.3, freq: 3500 }); punch(v, t, { weight: 0, peak: 0.1, freq: 160 }); });
  C('apt-overhead-bin-close', 'Overhead bin close', 0.5, 'Bin door swung shut: plastic slam, latch catches', (v, t) => { v.noise(t, { color: 'pink', type: 'bp', freq: 900, freq2: 2000, Q: 1, dur: 0.15, peak: 0.06 }); impact(v, t + 0.16, { weight: 0.45, material: 'ceramic', freq: 260, peak: 0.45 }); snap(v, t + 0.19, { peak: 0.15, freq: 3200 }); });
  C('apt-tray-table', 'Tray table', 0.4, 'Tray drops down and the latch turns', (v, t) => { hit(v, t, 600, 0.06, 0.2, 'ceramic'); punch(v, t, { weight: 0, peak: 0.1 }); hit(v, t + 0.22, 2200, 0.02, 0.1, 'ceramic'); });
  C('apt-galley-cart', 'Galley cart', 3, 'Trolley rolls down the aisle, bottles and cans chink', (v, t) => { layer(v, t, { src: 'brown', filter: { type: 'lowpass', f: [[0, 250], [3, 250]] }, gain: [[0, 0], [0.3, 0.08], [2.7, 0.08], [3, 0]] }); for (let i = 0; i < 14; i++) hit(v, t + v.random(0.1, 2.8), v.random(2500, 4200), 0.08, 0.04, 'glass', v.random(-0.3, 0.3)); punch(v, t + 2.9, { weight: 0.1, peak: 0.15 }); });
  C('apt-lavatory-flush', 'Lavatory vacuum flush', 2.5, 'Valve bangs open, vacuum roars for a second, slams shut', (v, t) => { punch(v, t, { weight: 0.3, peak: 0.35 }); layer(v, t, { src: 'pink', filter: { type: 'bandpass', f: [[0, 600], [0.2, 1400], [1.4, 900]], Q: 0.7 }, gain: [[0, 0], [0.1, 0.5], [1.2, 0.35], [1.5, 0]] }); hit(v, t + 1.5, 300, 0.1, 0.2, 'stone'); punch(v, t + 1.5, { weight: 0.2, peak: 0.25 }); });
  C('apt-cabin-pa-click', 'Cabin PA key', 0.3, 'Handset keyed: click and a breath of hiss', (v, t) => { hit(v, t, 620, 0.045, 0.055, 'wood'); snap(v, t + 0.003, { peak: 0.09, freq: 1900 }); v.noise(t + 0.012, { color: 'pink', type: 'bp', freq: 1900, Q: 0.65, dur: 0.2, attack: 0.012, peak: 0.035 }); });
  C('apt-window-shade', 'Window shade', 0.5, 'Plastic blind slides up and clicks', (v, t) => { v.surface(t, { dur: 0.3, rate: 80, grain: 0.008, freq: 1600, freqEnd: 2400, peak: 0.07 }); hit(v, t + 0.32, 1800, 0.03, 0.12, 'ceramic'); });

  // ── ATC & cockpit ──────────────────────────────────────────────────────────
  const R = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-atc', id, name, body, hint, play, 'dry', { variation: { pitch: 0, volume: 0.5 }, ...meta });
  R('apt-radio-key', 'Radio mic key', 0.25, 'Push-to-talk click and carrier open', (v, t) => { hit(v, t, 740, 0.038, 0.05, 'wood'); snap(v, t + 0.003, { peak: 0.1, freq: 2000 }); v.noise(t + 0.01, { color: 'white', type: 'bp', freq: 1800, Q: 0.6, dur: 0.12, attack: 0.006, peak: 0.045 }); });
  R('apt-radio-squelch', 'Radio squelch tail', 0.25, 'Carrier drops: the classic "kssh"', (v, t) => v.noise(t, { color: 'white', type: 'bp', freq: 1900, freq2: 1200, Q: 0.55, dur: 0.16, peak: 0.2, attack: 0.006 }));
  R('apt-radio-chatter', 'ATC radio chatter', 2.5, 'Bandlimited, unintelligible controller transmission with squelch tail', (v, t) => radio(v, t, 2.2), { variation: { pitch: 0.5, volume: 1 } });
  R('apt-radio-readback', 'Pilot readback', 1.6, 'Shorter, rougher cockpit transmission', (v, t) => radio(v, t, 1.3, 0.15), { variation: { pitch: 0.5, volume: 1 } });
  R('apt-outer-marker', 'Outer marker', 2.2, '400 Hz dashes, two per second: crossing the outer marker', (v, t) => { for (let i = 0; i < 4; i++) beep(v, t + i * 0.5, 400, 0.375, 0.14); });
  R('apt-middle-marker', 'Middle marker', 2.8, '1300 Hz alternating dot-dash', (v, t) => { let at = 0; for (let i = 0; i < 4; i++) { beep(v, t + at, 1300, 0.125, 0.12); beep(v, t + at + 0.2, 1300, 0.375, 0.12); at += 0.7; } });
  R('apt-inner-marker', 'Inner marker', 1.4, '3000 Hz dots, six per second', (v, t) => { for (let i = 0; i < 8; i++) beep(v, t + i / 6, 3000, 0.08, 0.08); });
  R('apt-ils-ident', 'ILS ident (Morse)', 3, 'Localizer identifier keyed in Morse at 1020 Hz: "I-L-S"', (v, t) => { morse(v, t, '.. .-.. ...', 1020); });
  R('apt-tower-alert', 'Tower conflict alert', 2, 'Two-tone short-term conflict alert from the radar console', (v, t) => { for (let i = 0; i < 6; i++) beep(v, t + i * 0.3, i % 2 ? 1000 : 1400, 0.22, 0.12, 'square'); }, { priority: 8 });
  R('apt-runway-incursion', 'Runway incursion alarm', 3, 'Urgent fast pulsing alarm: someone is on the active runway', (v, t) => { for (let i = 0; i < 14; i++) beep(v, t + i * 0.18, 2200, 0.09, 0.13, 'square'); }, { priority: 9 });
  R('apt-master-caution', 'Master caution', 1.4, 'Cockpit single chime with attention tone', (v, t) => { cabinChime(v, t, m(88), 0.25); beep(v, t, 1000, 0.3, 0.05); });
  R('apt-autopilot-disconnect', 'Autopilot disconnect', 2.4, 'Warbling disconnect warning', (v, t) => { for (let i = 0; i < 10; i++) beep(v, t + i * 0.22, i % 2 ? 1700 : 2000, 0.2, 0.08, 'triangle'); });
  R('apt-gear-down', 'Gear down & locked', 4, 'Hydraulic whine, airflow roar builds, three locks thunk', (v, t) => { layer(v, t, { src: 'sawtooth', f: [[0, 200], [0.5, 320], [3, 300], [3.3, 150]], filter: { type: 'lowpass', f: [[0, 800], [3.3, 800]] }, gain: [[0, 0], [0.4, 0.05], [3, 0.05], [3.3, 0]] }); layer(v, t + 0.8, { src: 'pink', filter: { type: 'lowpass', f: [[0, 400], [3, 1200]] }, gain: [[0, 0], [2.5, 0.25], [3.2, 0.2]] }); [2.6, 2.8, 3.0].forEach(d => { punch(v, t + d, { weight: 0.4, peak: 0.35 }); hit(v, t + d, 300, 0.1, 0.15, 'stone'); }); }, { variation: { pitch: 0.3, volume: 1 } });


  // ── Check-in desk ──────────────────────────────────────────────────────────
  const K = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-desk', id, name, body, hint, play, 'room', meta);
  K('apt-key-solid', 'Keystroke · solid', 0.15, 'One key on a heavy check-in keyboard: thick cap, deep bottom-out, desk takes the weight', (v, t) => solidKey(v, t), { cooldown: 0.012, limit: 10, variation: { pitch: 0.8, volume: 2 } });
  K('apt-key-solid-space', 'Spacebar · solid', 0.18, 'Long stabilized spacebar: deeper, with a faint wire settle', (v, t) => solidKey(v, t, { big: true }), { cooldown: 0.012, limit: 4, variation: { pitch: 0.5, volume: 1.5 } });
  K('apt-key-solid-enter', 'Enter · solid', 0.18, 'Emphatic Enter: struck harder, lower, a satisfying full stop', (v, t) => solidKey(v, t, { vel: 1.15, big: true, f: 128 }), { cooldown: 0.02, limit: 3, variation: { pitch: 0.4, volume: 1 } });
  K('apt-agent-typing-short', 'Agent typing · short', 1.8, 'A quick lookup: a few words of firm, rhythmic typing ending on Enter', (v, t) => { typing(v, t, 1.3, 75); }, { limit: 2 });
  K('apt-agent-typing-long', 'Agent typing · long', 4.6, 'Rebooking a passenger: long bursts, pauses, corrections, Enter', (v, t) => { const a = typing(v, t, 1.8, 80, false); typing(v, t + a + 0.6, 1.8, 70); }, { limit: 2 });
  K('apt-agent-typing-frantic', 'Agent typing · frantic', 3, 'Delay chaos: fast, hard, uneven typing with repeated Enters', (v, t) => { const a = typing(v, t, 2.1, 115, false); [0.1, 0.35, 0.55].forEach(d => solidKey(v, t + a + d, { vel: 1.15, big: true, f: 128 })); }, { limit: 2 });
  K('apt-card-swipe', 'Card swipe · approved', 1, 'Mag-stripe swipe through the reader rail, then a clean accept beep', (v, t) => { v.surface(t, { dur: 0.22, rate: 260, grain: 0.003, freq: 2600, freqEnd: 3400, peak: 0.12, attack: 0.02, release: 0.05, pan: -0.2, width: 0.3 }); v.noise(t, { color: 'pink', type: 'bp', freq: 1800, freq2: 2600, Q: 1, dur: 0.22, peak: 0.06, fade: { in: 0.03, hold: 0.12, out: 0.07 } }); hit(v, t + 0.23, 1400, 0.02, 0.08, 'ceramic'); beep(v, t + 0.42, 2700, 0.14, 0.12); });
  K('apt-card-swipe-fail', 'Card swipe · declined', 1.2, 'Swipe, then the reader\'s low double error beep', (v, t) => { v.surface(t, { dur: 0.2, rate: 260, grain: 0.003, freq: 2400, freqEnd: 3200, peak: 0.12, attack: 0.02, release: 0.05 }); hit(v, t + 0.21, 1400, 0.02, 0.08, 'ceramic'); beep(v, t + 0.4, 420, 0.16, 0.12, 'square'); beep(v, t + 0.62, 420, 0.24, 0.12, 'square'); });
  K('apt-card-tap', 'Contactless tap', 0.8, 'Card tapped on the terminal: plastic tick and a clean double beep', (v, t) => { hit(v, t, 1900, 0.02, 0.1, 'ceramic'); beep(v, t + 0.18, 2400, 0.09, 0.11); beep(v, t + 0.32, 2400, 0.12, 0.11); });
  K('apt-card-chip-insert', 'Chip card insert', 1, 'Card slides into the slot and seats; terminal chirps to read', (v, t) => { v.surface(t, { dur: 0.15, rate: 120, grain: 0.004, freq: 1800, peak: 0.07 }); snap(v, t + 0.16, { peak: 0.2, freq: 2800 }); hit(v, t + 0.16, 1200, 0.03, 0.1, 'ceramic'); beep(v, t + 0.45, 1760, 0.08, 0.09); });
  K('apt-pin-key', 'PIN pad key', 0.12, 'Rubber key press with its keypad beep', (v, t) => { hit(v, t, 700, 0.02, 0.1, 'wood'); beep(v, t + 0.005, 1950, 0.06, 0.08); }, { cooldown: 0.03, limit: 4, variation: { pitch: 0, volume: 1 } });
  K('apt-pin-entry', 'PIN entry', 1.6, 'Four PIN digits and the OK key', (v, t) => { [0, 0.28, 0.5, 0.79].forEach(d => { hit(v, t + d, 700, 0.02, 0.1, 'wood'); beep(v, t + d, 1950, 0.06, 0.08); }); hit(v, t + 1.15, 650, 0.03, 0.12, 'wood'); beep(v, t + 1.15, 2300, 0.1, 0.09); });
  K('apt-payment-approved', 'Payment approved', 0.8, 'Terminal confirms: rising two-tone', (v, t) => { beep(v, t, 1568, 0.1, 0.1); beep(v, t + 0.13, 2093, 0.22, 0.1); }, { variation: { pitch: 0, volume: 0.5 } });
  K('apt-receipt-print', 'Receipt print', 2, 'Short bursts of paper advance and a quick tear, rather than a sustained printer note', (v, t) => {
    printerFeed(v, t, 1.3, 0.8); v.surface(t + 1.45, { dur: 0.16, rate: 230, grain: 0.003, freq: 3100, freqEnd: 2000, peak: 0.12 });
  });
  K('apt-cash-drawer', 'Cash drawer', 0.8, 'Solenoid kick, drawer rolls out and bangs the stop, coins jingle', (v, t) => { snap(v, t, { peak: 0.2, freq: 2000 }); v.surface(t + 0.02, { dur: 0.18, rate: 90, grain: 0.008, freq: 1100, peak: 0.08 }); punch(v, t + 0.2, { weight: 0.3, peak: 0.3 }); metallic(v, t + 0.2, 900, 0.15, 0.08); [0.24, 0.28, 0.33].forEach(d => metallic(v, t + d, v.random(3000, 4200), 0.08, 0.04)); });
  K('apt-bag-scale', 'Baggage scale', 1.4, 'Suitcase lands on the belt scale, readout settles with a beep', (v, t) => { impact(v, t, { weight: 0.6, material: 'stone', freq: 160, peak: 0.45 }); hit(v, t + 0.15, 380, 0.08, 0.08, 'stone'); beep(v, t + 0.9, 2000, 0.12, 0.09); });
  K('apt-bag-overweight', 'Overweight bag', 1.4, 'Scale settles... then the dreaded triple alert', (v, t) => { impact(v, t, { weight: 0.75, material: 'stone', freq: 140, peak: 0.5 }); [0.85, 1.0, 1.15].forEach(d => beep(v, t + d, 990, 0.1, 0.1, 'square')); });
  K('apt-bag-tag', 'Bag tag print & stick', 2.4, 'Tag feed, backing peel, a soft wrap and pressure against the bag handle', (v, t) => {
    printerFeed(v, t, 1.2, 0.92);
    v.surface(t + 1.4, { dur: 0.35, rate: 180, grain: 0.004, freq: 2200, freqEnd: 3600, peak: 0.1 });
    v.noise(t + 1.9, { color: 'pink', type: 'bp', freq: 1200, dur: 0.12, peak: 0.08 });
    punch(v, t + 2.05, { weight: 0, peak: 0.1, freq: 150 });
  });
  K('apt-belt-send', 'Check-in belt send', 2.5, 'Agent hits the button: belt motor clunks on, bag rides away', (v, t) => { solidKey(v, t, { vel: 0.8, f: 180 }); punch(v, t + 0.1, { weight: 0.3, peak: 0.25 }); layer(v, t + 0.1, { src: 'sawtooth', f: [[0, 30], [0.4, 52], [2.2, 52], [2.4, 30]], filter: { type: 'lowpass', f: [[0, 300], [2.4, 300]] }, gain: [[0, 0], [0.3, 0.07], [2.1, 0.07], [2.4, 0]] }); v.surface(t + 0.4, { dur: 1.8, rate: 30, grain: 0.02, freq: 700, peak: 0.04, pan: 0.4 }); });
  K('apt-desk-bell', 'Service bell', 1.6, 'Palm on a counter bell: bright ding', (v, t) => { metallic(v, t, 2650, 1.4, 0.2, 0, [1, 2.1, 3.6, 5.2]); snap(v, t, { peak: 0.12, freq: 4000 }); }, { cooldown: 0.08, variation: { pitch: 0.3, volume: 1 } });
  K('apt-stapler', 'Stapler', 0.3, 'Office stapler crunches through a boarding-pass stack', (v, t) => { snap(v, t, { peak: 0.3, freq: 2800 }); metallic(v, t, 1800, 0.05, 0.1); punch(v, t + 0.005, { weight: 0.1, peak: 0.25, freq: 120 }); });
  K('apt-desk-phone', 'Desk phone ring', 3, 'Electronic office phone: trilled double ring', (v, t) => { [0, 0.5, 2, 2.5].filter(d => d < 2.6).forEach(d => { for (let i = 0; i < 8; i++) beep(v, t + d + i * 0.05, i % 2 ? 1300 : 1100, 0.045, 0.07); }); });
  K('apt-walkie-talkie', 'Walkie-talkie', 2.2, 'Handheld radio: chirp, garbled ground-crew call, roger beep', (v, t) => { beep(v, t, 1800, 0.06, 0.08); radio(v, t + 0.08, 1.6, 0.16); beep(v, t + 1.95, 1400, 0.08, 0.06); });
  K('apt-swipe-gate', 'Staff badge gate', 0.9, 'Badge swiped at the staff door: accept beep and the maglock clunk', (v, t) => { v.surface(t, { dur: 0.12, rate: 260, grain: 0.003, freq: 2800, peak: 0.08 }); beep(v, t + 0.18, 2400, 0.1, 0.1); punch(v, t + 0.32, { weight: 0.2, peak: 0.25 }); metallic(v, t + 0.32, 1400, 0.1, 0.06); });

  // ── People ─────────────────────────────────────────────────────────────────
  const P = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-people', id, name, body, hint, play, 'room', { variation: { pitch: 1.5, volume: 2 }, limit: 6, ...meta });
  P('apt-grumble-low', 'Grumble · low', 1.5, 'Low, connected mutter with consonant closures and falling phrase emphasis', (v, t) => { grumble(v, t, { pitch: 112, syllables: 7 }); });
  P('apt-grumble-high', 'Grumble · high', 1.3, 'Higher speaker, clipped consonants, restrained irritation', (v, t) => { grumble(v, t, { pitch: 185, syllables: 6, rough: 0.18 }); });
  P('apt-grumble-long', 'Grumble · long rant', 3.2, 'The same speaker complains in two phrases, with a breath between them', (v, t) => { grumble(v, t, { pitch: 126, syllables: 6, peak: 0.23 }); grumble(v, t + 1.42, { pitch: 129, syllables: 9, peak: 0.3 }); });
  P('apt-grumble-crowd', 'Crowd grumble', 3.5, 'A staggered queue reaction with separate speakers, not a unison vowel chord', (v, t) => {
    for (let i = 0; i < 8; i++) grumble(v, t + i * 0.17 + v.random(0, 0.09), {
      pitch: i % 3 ? v.random(108, 151) : v.random(181, 217), syllables: 4 + i % 3,
      peak: v.random(0.09, 0.14), pan: -0.77 + i * 0.22, rough: 0.18 });
  }, { limit: 2 });
  P('apt-sigh', 'Sigh', 1.3, 'An unforced exhale: brief voicing gives way to breath through a closing mouth', (v, t) => { humanGesture(v, t, 'sigh', { peak: 0.24 }); });
  P('apt-groan', 'Groan', 1.2, 'Pressed, low voiced exasperation with an irregular finish', (v, t) => { humanGesture(v, t, 'groan', { pitch: 128, peak: 0.3 }); });
  P('apt-tsk', 'Tut-tut', 0.4, 'Two dry tongue releases with a small mouth cavity, not metal clicks', (v, t) => {
    for (const [d, k] of [[0, 1], [0.17, 0.84]]) {
      v.noise(t + d, { color: 'white', type: 'bp', freq: 3150, Q: 1.25, dur: 0.009, peak: 0.21 * k, attack: 0.0005 });
      v.noise(t + d + 0.0015, { color: 'pink', type: 'bp', freq: 1350, Q: 1.5, dur: 0.02, peak: 0.12 * k, attack: 0.0008 });
    }
  });
  P('apt-huff', 'Huff', 0.5, 'A short pressure release through the mouth, mostly unvoiced', (v, t) => { humanGesture(v, t, 'huff', { peak: 0.25 }); });
  P('apt-hmm', 'Hmm?', 0.7, 'Closed-mouth hum with one modest questioning rise', (v, t) => { humanGesture(v, t, 'hum', { peak: 0.23, cutoff: 1900 }); });
  P('apt-cough', 'Cough', 0.6, 'Two pressure bursts, a voiced body and the trailing exhalation', (v, t) => { humanGesture(v, t, 'cough', { peak: 0.32 }); });
  P('apt-yawn', 'Yawn', 1.8, 'Breath intake, opening mouth, voiced stretch, then a breathy close', (v, t) => { humanGesture(v, t, 'yawn', { peak: 0.24 }); });
  P('apt-laugh', 'Laugh', 1.2, 'Uneven breath-driven laugh pulses, with a less voiced trailing breath', (v, t) => { humanGesture(v, t, 'laugh', { pitch: 174, peak: 0.27 }); });
  P('apt-kids-giggle', 'Kids giggling', 1.4, 'Two separate small speakers, staggered giggle pulses and breaths', (v, t) => {
    humanGesture(v, t, 'giggle', { pitch: 315, peak: 0.19, pan: -0.28, size: 1.19 });
    humanGesture(v, t + 0.17, 'giggle', { pitch: 357, peak: 0.16, pan: 0.31, size: 1.27 });
  }, { limit: 2 });
  P('apt-applause-small', 'Small applause', 3, 'Five clappers with separate hand sizes and slightly drifting rhythms', (v, t) => {
    for (let person = 0; person < 5; person++) {
      const pan = -0.64 + person * 0.32, pace = v.random(0.27, 0.39), hand = v.random(0.84, 1.17);
      for (let at = v.random(0.01, 0.26); at < 2.65; at += pace * v.random(0.88, 1.14)) {
        const envelope = Math.min(1, (at + 0.2) / 0.42, (2.9 - at) / 0.6);
        clap(v, t + at, v.random(0.12, 0.2) * envelope, pan, hand);
      }
    }
  }, { limit: 2 });
  P('apt-crowd-cheer', 'Crowd cheer', 2.5, 'Staggered open-mouth exclamations, breath and a small group applauding', (v, t) => {
    for (let i = 0; i < 8; i++) humanGesture(v, t + i * 0.055 + v.random(0, 0.09), 'cheer', {
      pitch: i % 3 ? v.random(143, 183) : v.random(211, 258), peak: 0.1, pan: -0.77 + i * 0.22 });
    for (let i = 0; i < 25; i++) { const at = v.random(0.35, 2.15); clap(v, t + at, 0.12 * Math.min(1, (2.4 - at) / 0.55), v.random(-0.75, 0.75)); }
  }, { limit: 2 });
  P('apt-baby-fuss', 'Baby fussing', 2, 'Two small whimpers separated by an audible breath; distinct from a full cry', (v, t) => { humanGesture(v, t, 'fuss', { peak: 0.2, rough: 0.14 }); }, { limit: 1 });
  P('apt-hurry-steps', 'Running late', 2, 'Someone sprints past dragging a rattling case', (v, t) => { const fl = flight(2, 1, 6, 2.5); for (let at = 0.05; at < 1.95; at += 0.16) { const k = Math.min(47, Math.round(at / 2 * 48)); hit(v, t + at, 1400, 0.03, 0.2 * fl.level[k][1], 'stone', fl.pan[k][1]); } layer(v, t, { src: 'brown', filter: { type: 'bandpass', f: [[0, 300], [2, 300]], Q: 0.8 }, gain: scale(fl.level, 0.2), pan: fl.pan }); });

  // ── Game feedback (airport management) ─────────────────────────────────────
  const F = (id: string, name: string, body: number, hint: string, play: (v: Voice, t: number) => void, meta: Partial<SoundDefinition> = {}) => D('airport-game', id, name, body, hint, play, 'room', { variation: { pitch: 0, volume: 0.5 }, ...meta });
  F('apt-flight-arrived', 'Flight arrived', 1.55, 'Warm descending-to-tonic chime: plane is on stand', (v, t) => { chime(v, t, 79, 0.2, 1); chime(v, t + 0.15, 76, 0.2, 1); chime(v, t + 0.3, 72, 0.22, 1.2); });
  F('apt-flight-departed', 'Flight departed', 1.55, 'Rising chime with a soft whoosh away', (v, t) => { chime(v, t, 72, 0.2, 1); chime(v, t + 0.15, 76, 0.2, 1); chime(v, t + 0.3, 79, 0.2, 1.2); v.noise(t + 0.1, { color: 'pink', type: 'bp', freq: 600, freq2: 3000, Q: 1.5, dur: 0.9, peak: 0.06, pan: 0.5, fade: { in: 0.3, hold: 0.1, out: 0.5 } }); });
  F('apt-flight-delayed', 'Flight delayed', 1.2, 'Minor-third drop with a muted wood knock', (v, t) => { pluck(v, t, 67, 0.6, 0.3, 0, 0.4); pluck(v, t + 0.22, 64, 0.8, 0.3, 0, 0.35); hit(v, t, 300, 0.08, 0.1, 'wood'); });
  F('apt-flight-cancelled', 'Flight cancelled', 1.6, 'Low descending tritone and a dull thud', (v, t) => { v.bloom(t, { f: m(55), dur: 1.2, peak: 0.18, attack: 0.02, release: 0.8, timbre: 'brass' }); v.bloom(t + 0.25, { f: m(49), dur: 1.2, peak: 0.18, attack: 0.02, release: 0.9, timbre: 'brass' }); punch(v, t + 0.25, { weight: 0.4, peak: 0.25 }); });
  F('apt-gate-assigned', 'Gate assigned', 0.6, 'Flap flick and a bright confirming tick', (v, t) => { for (let i = 0; i < 4; i++) hit(v, t + i * 0.03, 3000, 0.012, 0.1, 'ceramic', 0, [1, 1.7]); hit(v, t + 0.13, m(84), 0.3, 0.15, 'tine'); });
  F('apt-runway-cleared', 'Runway cleared', 1, 'Radio key + two-note "go" chime', (v, t) => { snap(v, t, { peak: 0.15, freq: 2200 }); beep(v, t + 0.08, 1047, 0.12, 0.1); beep(v, t + 0.22, 1568, 0.25, 0.1); });
  F('apt-near-miss', 'Near miss!', 2, 'Escalating two-tone alarm with a low hit', (v, t) => { punch(v, t, { weight: 0.6, peak: 0.4 }); for (let i = 0; i < 8; i++) beep(v, t + i * 0.2, i % 2 ? 1200 : 1600, 0.16, 0.08 + i * 0.008, 'sawtooth'); }, { priority: 9 });
  F('apt-money-earned', 'Revenue', 0.7, 'Coins land and a register bell rings on the fifth', (v, t) => { hit(v, t, 500, 0.05, 0.15, 'wood'); metallic(v, t + 0.05, m(84), 0.4, 0.15, 0, [1, 1.5, 2]); metallic(v, t + 0.1, m(91), 0.35, 0.1, 0, [1, 1.5]); [0.18, 0.24].forEach(d => metallic(v, t + d, v.random(2800, 3500), 0.12, 0.05, v.random(-0.4, 0.4))); }, { cooldown: 0.04 });
  F('apt-money-spent', 'Expense', 0.5, 'Coins slide out: short descending clink', (v, t) => { [0, 0.06, 0.12].forEach((d, i) => metallic(v, t + d, 3300 - i * 400, 0.12, 0.07, 0, [1, 1.5])); });
  F('apt-passenger-happy', 'Passenger happy', 0.5, 'Bright little major-sixth pop', (v, t) => { hit(v, t, m(79), 0.3, 0.16, 'glass'); hit(v, t + 0.07, m(88), 0.3, 0.14, 'glass'); }, { cooldown: 0.05 });
  F('apt-passenger-angry', 'Passenger annoyed', 1, 'A short human mutter with a dry interface detent, not a sustained synth buzz', (v, t) => { grumble(v, t, { pitch: 124, syllables: 4, peak: 0.23 }); hit(v, t + 0.015, 230, 0.034, 0.07, 'wood'); }, { cooldown: 0.1 });
  F('apt-build-place', 'Build placed', 0.6, 'Construction thunk: something new snaps into the grid', (v, t) => { impact(v, t, { weight: 0.55, material: 'wood', freq: 200, peak: 0.5 }); snap(v, t + 0.05, { peak: 0.2, freq: 3000 }); metallic(v, t + 0.06, 1100, 0.15, 0.06); }, { variation: { pitch: 0.6, volume: 1 } });
  F('apt-build-complete', 'Construction complete', 1.6, 'Ratchet, hammer taps, then a bright fanfare chord', (v, t) => { for (let i = 0; i < 3; i++) { metallic(v, t + i * 0.12, 1700, 0.06, 0.1); punch(v, t + i * 0.12, { weight: 0, peak: 0.1 }); } [72, 76, 79, 84].forEach((n, i) => v.fm(t + 0.45, { f: m(n), ratio: 2, index: 1.2, indexEnd: 0.05, dur: 0.9, peak: 0.07, pan: (i - 1.5) * 0.3 })); punch(v, t + 0.45, { weight: 0.2, peak: 0.2 }); });
  F('apt-demolish', 'Demolish', 1.4, 'Structure collapses into rubble', (v, t) => { impact(v, t, { weight: 0.9, material: 'stone', freq: 140, peak: 0.55, debris: 1 }); for (let i = 0; i < 10; i++) hit(v, t + 0.1 + v.random(0, 0.8), v.random(500, 1600), 0.06, 0.08, 'stone', v.random(-0.6, 0.6)); });
  F('apt-rating-up', 'Rating up', 1, 'Star chime climbing a pentatonic run', (v, t) => { [0, 2, 4, 7, 9].forEach((s, i) => hit(v, t + i * 0.06, m(79 + s), 0.3, 0.12, 'tine', (i - 2) * 0.2)); });
  F('apt-rating-down', 'Rating down', 1, 'Falling three-note minor run', (v, t) => { [76, 72, 69].forEach((n, i) => pluck(v, t + i * 0.12, n, 0.5, 0.25, 0, 0.4)); });
  F('apt-new-day', 'New day', 2.5, 'Dawn: soft rising pad and a morning bell', (v, t) => { [60, 67, 72, 76].forEach((n, i) => v.bloom(t + i * 0.1, { f: m(n), dur: 2.2, peak: 0.08, attack: 0.8, release: 1, timbre: 'glass', pan: (i - 1.5) * 0.3 })); chime(v, t + 0.9, 84, 0.12, 1.4); }, { gain: 0.9 });
  F('apt-speed-up', 'Time speed up', 0.4, 'Tape-wind blip rising', (v, t) => { v.tone(t, { f: 300, f2: 1400, dur: 0.18, peak: 0.12, type: 'triangle' }); hit(v, t + 0.18, 2400, 0.03, 0.08, 'ceramic'); });
  F('apt-speed-down', 'Time slow down', 0.4, 'Tape-wind blip falling', (v, t) => { v.tone(t, { f: 1400, f2: 300, dur: 0.2, peak: 0.12, type: 'triangle' }); hit(v, t + 0.2, 900, 0.03, 0.08, 'ceramic'); });
  F('apt-notify', 'Notification', 0.87, 'Neutral two-tone airport-chime notification', (v, t) => { chime(v, t, 79, 0.15, 0.6); chime(v, t + 0.12, 84, 0.15, 0.7); }, { cooldown: 0.1 });
  F('apt-queue-warning', 'Queue overflowing', 1.5, 'Busy three-beep warning with a crowd murmur swell', (v, t) => { for (let i = 0; i < 3; i++) beep(v, t + i * 0.18, 988, 0.12, 0.08, 'square'); for (let i = 0; i < 8; i++) syllable(v, t + v.random(0, 0.55), 0.08, v.random(-0.6, 0.6)); });
  F('apt-weather-warning', 'Weather warning', 2, 'Low siren swell and distant thunder', (v, t) => { v.tone(t, { f: 300, f2: 500, dur: 1.2, peak: 0.08, type: 'sawtooth', filter: { type: 'lp', freq: 1200 }, flat: true, fade: { in: 0.4, hold: 0.4, out: 0.4 } }); v.noise(t + 0.6, { color: 'brown', type: 'lp', freq: 400, freq2: 100, dur: 1.4, peak: 0.35, attack: 0.08 }); });

  // ── RTPC ambience loops ────────────────────────────────────────────────────
  const L = (id: string, name: string, hint: string, play: (v: Voice, t: number) => void, scene: Scene) => D('airport-ambience', id, name, 10, hint, play, scene, { loop: true, limit: 2 });
  const glide = (p: AudioParam, x: number, time: number, tc = 0.5) => p.setTargetAtTime(x, time, tc);
  L('apt-amb-terminal', 'Terminal hall', 'Huge reverberant hall: crowd babble, heel clicks, rolling cases, distant chimes; crowd RTPC', (v, t) => {
    const x = () => clamp(v.param('crowd', 0.5), 0, 1);
    const hvac = bed(v, t, 'brown', 'lowpass', 180), murmur = bed(v, t, 'pink', 'bandpass', 600, 0.5);
    const update = (time: number) => { glide(hvac.g.gain, 0.12, time); glide(murmur.g.gain, 0.02 + x() * 0.1, time); };
    v.onParam('crowd', (_, time) => update(time)); update(t);
    poisson(v, () => x() * 4.5, time => syllable(v, time, v.random(0.03, 0.08), v.random(-0.9, 0.9), 1800));
    poisson(v, () => x() * 3.5, time => { const p = v.random(-0.9, 0.9); hit(v, time, 1500, 0.03, v.random(0.03, 0.07), 'stone', p); });
    poisson(v, () => x() * 0.25, time => { const p = v.random(-0.8, 0.8); for (let at = 0; at < 2; at += 0.3) hit(v, time + at, 700, 0.03, 0.04, 'stone', p + at * 0.1); });
    poisson(v, () => 0.02, time => [67, 72, 76].forEach((n, i) => chime(v, time + i * 0.42, n, 0.06)));
    const mood = () => clamp(v.param('mood', 0), 0, 1);
    poisson(v, () => mood() * mood() * x() * 0.65, time => {
      const r = v.random(), pan = v.random(-0.9, 0.9);
      if (r < 0.55) grumble(v, time, { pitch: v.random() < 0.5 ? v.random(90, 120) : v.random(170, 220), syllables: 3 + Math.floor(v.random(0, 4)), peak: 0.08, pan });
      else if (r < 0.8) vocal(v, time, { contour: [180, 140, 100], dur: 0.9, vowel: [650, 1100], to: [450, 900], peak: 0.06, breath: 0.85, rough: 0.1, pan });
      else [0, 0.16].forEach(d => v.noise(time + d, { color: 'white', type: 'bp', freq: 3800, Q: 2, dur: 0.008, peak: 0.08, pan }));
    });
  }, 'hall');
  L('apt-amb-gate', 'Gate lounge', 'Carpeted gate area: HVAC, sparse conversation, window-muffled jets; activity RTPC', (v, t) => {
    const x = () => clamp(v.param('activity', 0.3), 0, 1);
    const hvac = bed(v, t, 'pink', 'lowpass', 400), jet = bed(v, t, 'pink', 'lowpass', 300), whine = bed(v, t, 'white', 'bandpass', 520, 2.5);
    const update = (time: number) => { glide(hvac.g.gain, 0.08, time); glide(jet.g.gain, 0.03 + x() * 0.08, time); glide(whine.g.gain, 0.002 + x() * 0.006, time); };
    v.onParam('activity', (_, time) => update(time)); update(t);
    poisson(v, () => x() * 2.3, time => syllable(v, time, v.random(0.03, 0.07), v.random(-0.7, 0.7), 1600));
    poisson(v, () => 0.05 + x() * 0.25, time => { hit(v, time, 2600, 0.15, 0.03, 'tine', v.random(-0.5, 0.5)); });
  }, 'room');
  L('apt-amb-apron', 'Apron / ramp', 'Outdoors at the stand: idling jets, APU whine, tugs and beepers, wind; activity RTPC', (v, t) => {
    const x = () => clamp(v.param('activity', 0.5), 0, 1);
    const roar = bed(v, t, 'pink', 'lowpass', 900), wind = bed(v, t, 'pink', 'bandpass', 500, 0.5), apu = bed(v, t, 'white', 'bandpass', 2300, 3.5), idle = bed(v, t, 'pink', 'bandpass', 430, 1.8);
    const update = (time: number) => { glide(roar.g.gain, 0.08 + x() * 0.2, time); glide(wind.g.gain, 0.06, time); glide(apu.g.gain, 0.012 + x() * 0.022, time); glide(idle.g.gain, 0.025 + x() * 0.06, time); };
    v.onParam('activity', (_, time) => update(time)); update(t);
    poisson(v, () => 0.04 + x() * 0.3, time => { for (let i = 0; i < 3; i++) beep(v, time + i, 1040, 0.5, 0.02, 'square', 0.6); });
    poisson(v, () => 0.1 + x() * 0.6, time => { const p = v.random(-0.8, 0.8); for (let i = 0; i < 6; i++) hit(v, time + i * 0.18, v.random(500, 1100), 0.05, 0.03, 'stone', p); });
  }, 'open');
  L('apt-amb-baggage', 'Baggage reclaim', 'Carousel chain drive, slat clatter, bag drops; running RTPC', (v, t) => {
    const x = () => clamp(v.param('running', 0.6), 0, 1);
    const motor = hum(v, t, 48, 'sawtooth'), hvac = bed(v, t, 'brown', 'lowpass', 200);
    const lp = v.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 350; motor.g.disconnect(); motor.g.connect(lp); lp.connect(v.dest); v.own(v.ctx.createConstantSource(), lp);
    const update = (time: number) => { glide(motor.g.gain, x() * 0.08, time); glide(hvac.g.gain, 0.1, time); glide(motor.o.frequency, (20 + x() * 30) * v.pitch, time, 1); };
    v.onParam('running', (_, time) => update(time)); update(t);
    poisson(v, () => x() * 2.4, time => hit(v, time, 380, 0.05, 0.05, 'stone', v.random(-0.6, 0.6)));
    poisson(v, () => x() * 0.25, time => { punch(v, time, { weight: 0.4, peak: 0.2, pan: v.random(-0.5, 0.5) }); hit(v, time, 200, 0.12, 0.08, 'wood'); });
    poisson(v, () => x() * 1.4, time => syllable(v, time, 0.04, v.random(-0.8, 0.8), 1600));
  }, 'chamber');
  L('apt-amb-security', 'Security checkpoint', 'Conveyor hum, trays clattering, detector tones, staff calls; busy RTPC', (v, t) => {
    const x = () => clamp(v.param('busy', 0.5), 0, 1);
    const belt = hum(v, t, 58, 'sawtooth'), hvac = bed(v, t, 'brown', 'lowpass', 220);
    const update = (time: number) => { glide(belt.g.gain, 0.01 + x() * 0.02, time); glide(hvac.g.gain, 0.1, time); };
    v.onParam('busy', (_, time) => update(time)); update(t);
    poisson(v, () => 0.3 + x() * 3, time => { const p = v.random(-0.8, 0.8); for (let i = 0; i < 5; i++) hit(v, time + i * 0.07, 900, 0.03, 0.05 - i * 0.006, 'ceramic', p); });
    poisson(v, () => 0.1 + x() * 0.6, time => { beep(v, time, 880, 0.1, 0.03, 'sine', v.random(-0.5, 0.5)); beep(v, time + 0.13, 1175, 0.15, 0.03, 'sine'); });
    poisson(v, () => x() * 2.2, time => syllable(v, time, 0.05, v.random(-0.8, 0.8), 1800));
  }, 'chamber');
  L('apt-amb-jet-engine', 'Jet engine (thrust)', 'Continuous turbofan: correlated spool inertia, core body, broadband roar and restrained fan detail', (v, t) => turbofanLoop(v, t), 'open');
  L('apt-amb-cabin', 'Cabin at cruise', 'Steady airframe roar, engine drone, air-con hiss; turbulence adds bumps and rattles', (v, t) => {
    const x = () => clamp(v.param('turbulence', 0.1), 0, 1);
    const roar = bed(v, t, 'pink', 'lowpass', 500), hiss = bed(v, t, 'white', 'highpass', 5000), drone = hum(v, t, 96, 'triangle');
    const update = (time: number) => { glide(roar.g.gain, 0.3, time); glide(hiss.g.gain, 0.012, time); glide(drone.g.gain, 0.015, time); };
    v.onParam('turbulence', (_, time) => update(time)); update(t);
    poisson(v, () => 0.02 + x() * 2.5, time => { punch(v, time, { weight: 0.3, peak: 0.08 + x() * 0.25 }); if (v.random() < 0.6) for (let i = 0; i < 3; i++) hit(v, time + 0.02 + i * 0.04, v.random(900, 2000), 0.03, 0.03 * (0.5 + x()), 'ceramic', v.random(-0.6, 0.6)); });
  }, 'cabinet');
  L('apt-amb-tower', 'Control tower cab', 'Quiet glass room: equipment fans, radio traffic bursts and squelch; traffic RTPC', (v, t) => {
    const x = () => clamp(v.param('traffic', 0.4), 0, 1);
    const fans = bed(v, t, 'pink', 'lowpass', 600), whine = hum(v, t, 120, 'sine');
    const update = (time: number) => { glide(fans.g.gain, 0.05, time); glide(whine.g.gain, 0.006, time); };
    v.onParam('traffic', (_, time) => update(time)); update(t);
    poisson(v, () => 0.05 + x() * 0.4, time => radio(v, time, v.random(1, 2.6), 0.12, v.random(-0.4, 0.4)));
    poisson(v, () => x() * 0.25, time => { hit(v, time, 2200, 0.02, 0.04, 'ceramic', v.random(-0.5, 0.5)); });
  }, 'room');

  // ── Events ─────────────────────────────────────────────────────────────────
  audio.defineEvent('apt-pa', { mode: 'shuffle', sounds: ['apt-pa-chime-2', 'apt-pa-chime-3', 'apt-pa-chime-4'], category: 'airport-terminal', name: 'Any PA chime' });
  audio.defineEvent('apt-footstep', { mode: 'switch', param: 'floor', cases: { tile: 'apt-footstep-tile', carpet: 'apt-footstep-carpet' }, default: 'apt-footstep-tile', category: 'airport-terminal', name: 'Footstep (switch: floor)' });
  audio.defineEvent('apt-scan', { mode: 'switch', param: 'scan', cases: { ok: 'apt-scan-ok', fail: 'apt-scan-fail' }, default: 'apt-scan-ok', category: 'airport-terminal', name: 'Scan (switch: ok/fail)' });
  audio.defineEvent('apt-aircraft-pass', { mode: 'random', sounds: ['apt-jet-flyby', 'apt-turboprop-flyby', 'apt-prop-plane-pass', 'apt-helicopter-pass'], weights: [4, 2, 1, 1], category: 'airport-aircraft', name: 'Something flies over' });
  audio.defineEvent('apt-agent-typing', { mode: 'shuffle', sounds: ['apt-agent-typing-short', 'apt-agent-typing-long', 'apt-agent-typing-frantic'], category: 'airport-desk', name: 'Agent typing (any)' });
  audio.defineEvent('apt-keystroke', { mode: 'random', sounds: ['apt-key-solid', 'apt-key-solid', 'apt-key-solid', 'apt-key-solid-space'], weights: [6, 6, 6, 2], avoidRepeat: 0, category: 'airport-desk', name: 'Per-key typing' });
  audio.defineEvent('apt-card-payment', { mode: 'switch', param: 'payment', cases: { swipe: 'apt-card-swipe', declined: 'apt-card-swipe-fail', tap: 'apt-card-tap', chip: 'apt-card-chip-insert' }, default: 'apt-card-tap', category: 'airport-desk', name: 'Card payment (switch)' });
  audio.defineEvent('apt-grumble', { mode: 'shuffle', sounds: ['apt-grumble-low', 'apt-grumble-high', 'apt-sigh', 'apt-groan', 'apt-tsk', 'apt-huff'], category: 'airport-people', name: 'Unhappy passenger (any)' });
  audio.defineEvent('apt-departure', { mode: 'random', sounds: ['apt-jet-takeoff', 'apt-turboprop-takeoff'], weights: [3, 1], category: 'airport-aircraft', name: 'A departure' });
  // Tycoon layer: UI, build, economy, staff, emergencies, weather, amenities, landside, more airside & ambience.
  registerAirportTycoonSounds(audio);
}

