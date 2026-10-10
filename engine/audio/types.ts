import type { Frequency } from "./notes";
import type { GameAudio } from "./engine";
import type { Voice } from "./voice";

export type NoiseColor = "white" | "pink" | "brown";

export type WaveType = Exclude<OscillatorType, "custom">;
export type FilterKind = "lp" | "hp" | "bp" | "none";
export type GlideKind = "exp" | "lin" | "step";

export type FrequencyPoint =
  | Frequency
  | {
      f: Frequency;
      at?: number;
      glide?: GlideKind;
    };

export interface FilterOptions {
  [key: `freq${number}`]: Frequency | null | undefined;
  type?: FilterKind;
  freq?: Frequency;
  freq2?: Frequency | null;
  freq3?: Frequency | null;
  freq4?: Frequency | null;
  freqs?: FrequencyPoint[];
  Q?: number;
  glide?: GlideKind;
}

export interface FadeOptions {
  in?: number;
  out?: number;
  hold?: number;
}

export interface ToneOptions {
  [key: `f${number}`]: Frequency | null | undefined;
  f: Frequency;
  f2?: Frequency | null;
  f3?: Frequency | null;
  f4?: Frequency | null;
  freqs?: FrequencyPoint[];
  curve?: Frequency[] | null;
  type?: WaveType;
  /** Position this layer independently inside the voice. */
  pan?: number;
  dur?: number;
  a?: number;
  attack?: number;
  fadeIn?: number;
  fadeOut?: number;
  fade?: FadeOptions;
  peak?: number;
  sustain?: number;
  glide?: GlideKind;
  flat?: boolean;
  detune?: number;
  vibratoF?: number;
  vibratoD?: number;
  filter?: FilterOptions | null;
}

export interface NoiseOptions {
  color?: NoiseColor;
  pan?: number;
  /** Hold at peak instead of decaying; useful for air and spray sounds. */
  flat?: boolean;
  [key: `freq${number}`]: Frequency | null | undefined;
  dur?: number;
  peak?: number;
  a?: number;
  attack?: number;
  fadeIn?: number;
  fadeOut?: number;
  fade?: FadeOptions;
  sustain?: number;
  type?: FilterKind;
  freq?: Frequency;
  freq2?: Frequency | null;
  freq3?: Frequency | null;
  freq4?: Frequency | null;
  freqs?: FrequencyPoint[];
  Q?: number;
  filter?: FilterOptions | null;
  glide?: GlideKind;
}

export type SoundPlay = (voice: Voice, time: number) => void | number | Voice | { stop(): void };

/** Per-play randomization so repeated triggers never sound machine-gunned. */
export interface VariationOptions {
  /** ± semitones of random pitch offset. */
  pitch?: number;
  /** ± decibels of random level offset (never boosts above +volume dB). */
  volume?: number;
  /** ± random stereo offset, -1..1. Ignored for 3-D voices. */
  pan?: number;
  /** ± random reverb-depth offset, 0..1. */
  depth?: number;
  /** ± random brightness offset ratio, 0..1. */
  brightness?: number;
}

/** What to do when a sound reaches its instance limit. */
export type StealMode = "oldest" | "newest" | "none";

export interface SoundDefinition {
  id?: string;
  /** Randomize pitch/level/pan per trigger. */
  variation?: VariationOptions;
  /** Maximum simultaneous instances of this id. */
  limit?: number;
  /** "oldest" (default) fades the oldest instance, "none" rejects the new trigger, "newest" replaces the latest. */
  steal?: StealMode;
  /** Minimum seconds between triggers; faster retriggers are skipped. */
  cooldown?: number;
  /** Higher priority wins when the engine voice budget is full (default 0; loops default 10). */
  priority?: number;
  category?: string;
  name?: string;
  hint?: string;
  loop?: boolean;
  bus?: string;
  /** Linear preset trim, separate from caller volume. */
  gain?: number;
  tags?: readonly string[];
  /** Nominal full render including the designed decay; loops use preview length. */
  duration?: number;
  play: SoundPlay;
}

export type SoundInput = SoundPlay | SoundDefinition;

export type Vec3 = readonly [number, number, number];

/** 3-D emitter configuration. Distances are in the same world units as the listener. */
export interface SpatialOptions {
  position: Vec3;
  /** "hrtf" (default) for headphones-grade localization, "equalpower" for cheap stereo. */
  model?: "hrtf" | "equalpower";
  distance?: DistanceModelType;
  refDistance?: number;
  maxDistance?: number;
  rolloff?: number;
  /** 0..1; 1 = fully occluded (low-passed and attenuated). */
  occlusion?: number;
  /** Distance-based high-frequency air absorption; default true. */
  air?: boolean;
  orientation?: Vec3;
  cone?: { inner: number; outer: number; outerGain: number };
}

export interface VoiceOptions {
  /** Place the voice in 3-D space (switches the voice to a PannerNode). */
  position?: Vec3;
  spatial?: Omit<SpatialOptions, "position">;
  /** Initial game-parameter values for this playback (see `handle.setParam`). */
  params?: Record<string, number>;
  /** Override or disable (`false`) the definition's variation. */
  variation?: VariationOptions | false;
  /** Override the definition priority for voice stealing. */
  priority?: number;
  /** Start the sound later, in seconds from now (audio-clock accurate). */
  delay?: number;
  /** Reverb send multiplier: 0 is dry, 1 is the designed space, up to 2. */
  depth?: number;
  /** Slow drift and breathing multiplier, 0–2. Does not randomize notes. */
  motion?: number;
  /** Spectral brightness multiplier, 0.25–2. */
  brightness?: number;
  /** Repeatable timbre and noise offsets for this playback. */
  seed?: number;
  volume?: number;
  pitch?: number;
  pan?: number;
  bus?: string;
}

export interface GameAudioOptions {
  /** Synthesis and generated PCM rate. Defaults to 16000 Hz; the output device may resample. */
  sampleRate?: number;
  /** Cache finite procedural definitions as generated PCM. Enabled for live contexts when OfflineAudioContext is available. */
  soundBuffers?: boolean;
  /** Global polyphony budget. Lowest-priority, oldest one-shots are stolen first. Default 128. */
  maxVoices?: number;
  /** Add a transparent look-ahead-free brickwall limiter (DynamicsCompressor) before the safety knee. */
  limiter?: boolean;
  /** Opt-in legacy bus compression. Off by default to preserve transient dynamics. */
  compression?: boolean;
  /** Repeatable shared noise buffers and default voice random streams. */
  seed?: number;
  /** Transparent below the safety knee; bounds sample peaks, not true peaks. */
  protection?: boolean;
  volume?: number;
  analyser?: boolean;
  presets?: boolean | PresetRegistrar;
  context?: AudioContext | OfflineAudioContext;
}

export type PresetRegistrar = (audio: GameAudio) => void;

/** Wwise-style event container: resolves one trigger to concrete sounds. */
export interface EventDefinition {
  /** random (avoids recent repeats), shuffle (bag), sequence (round robin), switch (by param / opts.switch), layer (all at once). */
  mode: "random" | "shuffle" | "sequence" | "switch" | "layer";
  sounds?: readonly string[];
  /** Weights for random mode, same order as `sounds`. */
  weights?: readonly number[];
  /** Random mode: how many recent picks to avoid (default: min(2, n-1)). */
  avoidRepeat?: number;
  /** Switch mode: switch group read from `audio.setSwitch` (or a numeric `audio.setParam`) unless `opts.switch` is given. */
  param?: string;
  cases?: Readonly<Record<string, string>>;
  /** Switch fallback. */
  default?: string;
  /** Applied on top of the resolved sound. */
  variation?: VariationOptions;
  category?: string;
  name?: string;
  hint?: string;
}

export interface SoundQuery {
  category?: string;
  query?: string;
  loop?: boolean;
  bus?: string;
  tags?: readonly string[];
}

export interface ListedSound {
  id: string;
  category: string;
  name: string;
  hint: string;
  loop: boolean;
  bus: string;
  gain: number;
  tags: string[];
  duration?: number;
}

export interface MelodyOptions extends VoiceOptions {
  bpm?: number;
  wave?: WaveType;
  peak?: number;
  sustain?: number;
  a?: number;
  loop?: boolean;
  filter?: FilterOptions | null;
}

export interface SequenceOptions extends VoiceOptions {
  bpm?: number;
  stepsPerBeat?: number;
  loop?: boolean;
  swing?: number;
}

export interface NoteOptions extends VoiceOptions {
  wave?: WaveType;
  dur?: number;
  peak?: number;
  a?: number;
}

export interface ChordOptions extends NoteOptions {
  spread?: number;
}

/** A resonant mode. Gains are normalized across the bank to preserve headroom. */
export interface PartialTone {
  ratio: number;
  gain: number;
  /** Duration multiplier; higher modes can decay faster. */
  decay?: number;
  detune?: number;
}
export interface AdditiveOptions extends Omit<ToneOptions, "type" | `f${number}` | "curve" | "freqs" | "glide"> {
  partials: readonly PartialTone[];
}
/** Two-operator FM with a decaying modulation index, suited to tines and bells. */
export interface FmOptions extends Omit<ToneOptions, `f${number}` | "curve" | "freqs" | "glide" | "vibratoF" | "vibratoD"> {
  ratio?: number;
  index?: number;
  indexEnd?: number;
}
export interface NoiseLoopOptions {
  color?: NoiseColor;
  type?: Exclude<FilterKind, "none">;
  freq?: number;
  Q?: number;
  gain?: number;
  pan?: number;
  lfoF?: number;
  lfoD?: number;
}

/** Designed acoustic space; its tail is included in the voice lifetime. */
export interface SpaceOptions {
  /** Close early reflections, independent of the late hall. Scales with voice depth. */
  early?: number;
  wet?: number; dry?: number; decay?: number; damping?: number; size?: number;
  preDelay?: number; lowCut?: number; echo?: number; echoTime?: number;
}
export interface BloomOptions {
  f: Frequency; f2?: Frequency; dur?: number; peak?: number; attack?: number;
  release?: number; sustain?: number; pan?: number; width?: number; detune?: number;
  drift?: number; unison?: number; cutoff?: number; cutoffEnd?: number;
  timbre?: "velvet" | "bowed" | "choir" | "glass" | "brass";
}
export type MaterialVoice = "bowl" | "bronze" | "glass" | "stone" | "wood" | "tine" | "ceramic" | "wire";
export interface ResonatorOptions {
  f: Frequency; dur?: number; peak?: number; pan?: number; width?: number;
  material?: MaterialVoice; modes?: readonly number[]; strike?: number; bloom?: number;
}
export interface StringOptions {
  f: Frequency; dur?: number; peak?: number; pan?: number; brightness?: number; pick?: number;
}
export interface CloudOptions {
  notes: Frequency[]; dur?: number; peak?: number; density?: number; grain?: number;
  timbre?: BloomOptions["timbre"]; cutoff?: number; width?: number;
}

/** Moving cavities driven by a glottal/reed source; suitable for animals, horns and motors. */
export interface FormantOptions {
  f: Frequency; f2?: Frequency; contour?: readonly Frequency[];
  dur?: number; peak?: number; attack?: number; release?: number; pan?: number;
  formants?: readonly { freq: number; end?: number; Q?: number; gain?: number }[];
  breath?: number; roughness?: number; flutter?: number;
  vibrato?: number; vibratoRate?: number; slope?: number; odd?: number; cutoff?: number;
}
/** Stochastic contact/friction field. Grains remain independently placed and shaped. */
export interface SurfaceOptions {
  dur?: number; rate?: number; rateEnd?: number; grain?: number; grainEnd?: number;
  peak?: number; freq?: number; freqEnd?: number; Q?: number;
  color?: NoiseColor; type?: Exclude<FilterKind, 'none'>; pan?: number; width?: number;
  attack?: number; release?: number;
}
