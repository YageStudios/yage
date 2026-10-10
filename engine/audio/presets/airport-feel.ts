/** Airport-only mix perspective. The bank keeps its IDs, buses, pitch and event semantics.
 * Close contacts stay dry; spaces have dark tails; machinery retains mid-bass weight.
 * No compressor, look-ahead, stereo inversion or generic "success" layer on every sound. */
import type { Voice } from '../voice';
import type { SpaceOptions } from '../types';
import { SPACES, type Scene } from '../spaces';

interface Perspective {
  highpass: number; body: number; bodyHz: number; edge: number; air: number;
  wet: number; decay: number;
}
const near: Perspective = { highpass: 65, body: 0, bodyHz: 230, edge: -1.1, air: -0.5, wet: 0.38, decay: 0.64 };
const machine: Perspective = { highpass: 32, body: 0, bodyHz: 160, edge: -1, air: -0.5, wet: 0.58, decay: 0.8 };
const human: Perspective = { highpass: 75, body: 0, bodyHz: 360, edge: -0.5, air: -0.5, wet: 0.2, decay: 0.62 };
export const AIRPORT_PERSPECTIVES: Readonly<Record<string, Perspective>> = {
  'airport-ui': { ...near, highpass: 110, bodyHz: 330, wet: 0, decay: 0.5 },
  'airport-build': { ...near, highpass: 40, body: 1.8, bodyHz: 170, wet: 0.4 },
  'airport-economy': { ...near, highpass: 90, edge: -3.4, wet: 0.48 },
  'airport-game': { ...near, highpass: 45, body: 1.8, wet: 0.55 },
  'airport-aircraft': { ...machine, highpass: 32, edge: -0.65, wet: 0.1, decay: 0.5 },
  'airport-ground': machine,
  'airport-landside': { ...machine, highpass: 38, wet: 0.4 },
  'airport-terminal': { ...near, wet: 0.64, decay: 0.82 },
  'airport-security': { ...near, edge: -2, wet: 0.55 },
  'airport-baggage': { ...machine, body: 1.8, wet: 0.5 },
  'airport-cabin': { ...near, highpass: 48, wet: 0.55, decay: 0.7 },
  'airport-desk': { ...near, highpass: 55, wet: 0.22, decay: 0.6 },
  'airport-staff': { ...near, highpass: 50, wet: 0.5 },
  'airport-amenities': { ...near, highpass: 65, wet: 0.5 },
  'airport-people': human,
  'airport-atc': { ...near, highpass: 180, body: 0, edge: -1.5, air: -5, wet: 0.3 },
  'airport-emergency': { ...machine, highpass: 48, body: 0.5, edge: -1.8, air: -2.5, wet: 0.48 },
  'airport-weather': { ...machine, highpass: 28, body: 0.5, edge: -3.5, air: -3, wet: 0.5 },
  'airport-ambience': { ...human, highpass: 38, body: 0, edge: -3.5, air: -3, wet: 0.66, decay: 0.85 },
  'airport-music': { ...near, highpass: 32, body: 0.5, edge: -1.2, air: -0.8, wet: 0.7, decay: 0.9 },
};

/** Cached by registration, so duration metadata and the actual reverb always agree. */
export function airportSpace(category: string, scene: Scene, id = ''): SpaceOptions {
  const p = AIRPORT_PERSPECTIVES[category] ?? near;
  const space: SpaceOptions = { ...SPACES[scene] };
  // The PA belongs in the hall; a scanner in the same category belongs close to the player.
  const pa = id.startsWith('apt-pa-');
  space.wet = (space.wet ?? 0) * (pa ? 0.8 : p.wet);
  space.early = (space.early ?? 0) * (category === 'airport-ui' ? 0 : category === 'airport-people' ? 0.3 : 0.65);
  space.decay = Math.max(0.2, (space.decay ?? 0.5) * (pa ? 0.95 : p.decay));
  space.damping = Math.min(space.damping ?? 3500, pa ? 3400 : 3200);
  // Close human gestures and physical contacts should not acquire a hall-sized tail.
  if (category === 'airport-people') { space.preDelay = 0.009; space.lowCut = 220; }
  if (category === 'airport-aircraft') { space.early = 0.008; space.lowCut = 300; }
  return space;
}
export function airportFinish(v: Voice, category: string): void {
  const p = AIRPORT_PERSPECTIVES[category] ?? near;
  const filter = (type: BiquadFilterType, hz: number, gain: number, q: number) => {
    const f = v.ctx.createBiquadFilter(); f.type = type;
    f.frequency.value = Math.min(hz, v.ctx.sampleRate * 0.42); f.Q.value = q; f.gain.value = gain; return f;
  };
  v._insert(
    filter('highpass', p.highpass, 0, 0.55),
    filter('peaking', p.bodyHz, p.body, 0.7),
    filter('peaking', 3200, p.edge, 0.85),
    filter('highshelf', 6500, p.air, 0.7),
  );
}
