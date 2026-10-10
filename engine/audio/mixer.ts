import { clamp, finite, nonnegative, positive } from "./dsp";
import type { Vec3 } from "./types";
import type { Voice } from "./voice";

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (gain: number): number => 20 * Math.log10(Math.max(gain, 1e-12));

// ---------------------------------------------------------------------------
// Handle — what play()/melody()/sequence() return.
// ---------------------------------------------------------------------------

export class Handle {
  private _v: Voice;
  id: string | null;
  loop: boolean;
  /** False when the trigger was rejected by a cooldown or an instance limit with steal: "none". */
  readonly accepted: boolean;

  constructor(voice: Voice, meta: { id?: string | null; loop?: boolean; accepted?: boolean } = {}) {
    this._v = voice;
    this.id = meta.id ?? null;
    this.loop = !!meta.loop;
    this.accepted = meta.accepted ?? true;
  }
  /** Stop playback (fade in seconds, default 40 ms). Safe to call twice. */
  stop(fade?: number): this {
    this._v._stop(fade);
    return this;
  }
  get playing(): boolean {
    return (
      !this._v._stopped && (this._v._live || this._v.now() < this._v.until)
    );
  }
  /** Audio-clock time at which the scheduled sound (including its tail) ends; Infinity for loops. */
  get endTime(): number { return this._v._live ? Infinity : this._v.until; }
  get volume(): number {
    return this._v.volume;
  }
  set volume(v: number) {
    this._v.volume = v;
  }
  setVolume(v: number): this {
    this.volume = v;
    return this;
  }
  /** Linear level ramp over `seconds`. */
  fadeTo(volume: number, seconds: number): this { this._v.fadeTo(volume, seconds); return this; }
  setPan(p: number): this {
    this._v.setPan(p);
    return this;
  }
  /** Drive a game parameter (RTPC) on this playback, e.g. handle.setParam('rpm', 0.7). */
  setParam(name: string, value: number): this { this._v.setParam(name, value); return this; }
  getParam(name: string, fallback = 0): number { return this._v.param(name, fallback); }
  /** Move a 3-D voice (or make a voice 3-D). */
  setPosition(position: Vec3, glide?: number): this {
    if (this._v._spatial) this._v.setPosition(position, glide); else this._v.spatialize({ position });
    return this;
  }
  setOrientation(direction: Vec3): this { this._v.setOrientation(direction); return this; }
  /** 0 = clear, 1 = fully occluded. */
  setOcclusion(amount: number, glide?: number): this { this._v.setOcclusion(amount, glide); return this; }
  /** Run `fn` once playback has stopped (immediately if it already has). */
  onEnded(fn: () => void): this { this._v.onStop(fn); return this; }
  /** @internal */
  get voice(): Voice { return this._v; }
}

// ---------------------------------------------------------------------------
// Bus — named mix group ('sfx', 'music', 'ambient', ...).
//   input (user volume) → [high-pass] → [low-pass] → duck → snapshot → parent
// Filters are inserted only when first used, so an untouched bus is two gains.
// ---------------------------------------------------------------------------

export interface BusState { volume?: number; lowpass?: number | null; highpass?: number | null }

export class Bus {
  name: string;
  /** Input node; voices connect here. Its gain is the user volume. */
  node: GainNode;
  parent: string | null;
  private _ctx: AudioContext | OfflineAudioContext;
  private _muted: boolean;
  private _level: number;
  private _duck: GainNode;
  private _snap: GainNode;
  private _hp?: BiquadFilterNode;
  private _lp?: BiquadFilterNode;
  private _dest: AudioNode;

  constructor(ctx: AudioContext | OfflineAudioContext, dest: AudioNode, name: string, parent: string | null = null) {
    this.name = name;
    this.parent = parent;
    this._ctx = ctx;
    this._dest = dest;
    this.node = ctx.createGain();
    this._duck = ctx.createGain();
    this._snap = ctx.createGain();
    this._muted = false;
    this._level = 1;
    this._wire();
  }
  private _wire(): void {
    const chain: AudioNode[] = [this.node, ...(this._hp ? [this._hp] : []), ...(this._lp ? [this._lp] : []), this._duck, this._snap];
    for (const n of chain) { try { n.disconnect(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    this._snap.connect(this._dest);
  }
  /** @internal Re-parent the bus output. */
  _route(dest: AudioNode, parent: string | null): void { this._dest = dest; this.parent = parent; this._wire(); }
  get output(): AudioNode { return this._snap; }
  get volume(): number {
    return this._level;
  }
  set volume(v: number) {
    this._level = nonnegative(v, "bus volume");
    if (!this._muted)
      this.node.gain.setTargetAtTime(v, this._ctx.currentTime, 0.02);
  }
  get muted(): boolean {
    return this._muted;
  }
  set muted(m: boolean) {
    this._muted = m;
    this.node.gain.setTargetAtTime(
      m ? 0 : this._level,
      this._ctx.currentTime,
      0.02,
    );
  }
  /** Ramp the user volume linearly. */
  fadeTo(volume: number, seconds: number): this {
    this._level = nonnegative(volume, "bus volume");
    if (this._muted) return this;
    ramp(this.node.gain, volume, this._ctx.currentTime, seconds);
    return this;
  }
  /** Sweep a low-pass on the bus (null opens it fully). Great for pause menus and underwater. */
  setLowpass(freq: number | null, seconds = 0.2): this {
    const nyquist = this._ctx.sampleRate / 2;
    if (!this._lp) {
      if (freq === null) return this;
      this._lp = this._ctx.createBiquadFilter(); this._lp.type = "lowpass"; this._lp.Q.value = 0.6;
      this._lp.frequency.value = nyquist * 0.98; this._wire();
    }
    const f = freq === null ? nyquist * 0.98 : clamp(positive(freq, "low-pass frequency"), 40, nyquist * 0.98);
    expRamp(this._lp.frequency, f, this._ctx.currentTime, seconds);
    return this;
  }
  setHighpass(freq: number | null, seconds = 0.2): this {
    if (!this._hp) {
      if (freq === null) return this;
      this._hp = this._ctx.createBiquadFilter(); this._hp.type = "highpass"; this._hp.Q.value = 0.6;
      this._hp.frequency.value = 10; this._wire();
    }
    const f = freq === null ? 10 : clamp(positive(freq, "high-pass frequency"), 10, this._ctx.sampleRate * 0.4);
    expRamp(this._hp.frequency, f, this._ctx.currentTime, seconds);
    return this;
  }
  /** @internal Ducking multiplier, driven by GameAudio.duck rules. */
  get duckGain(): AudioParam { return this._duck.gain; }
  /** @internal Snapshot multiplier. */
  get snapshotGain(): AudioParam { return this._snap.gain; }
  /** Temporarily lower this bus by `db` for `seconds` (manual duck, e.g. for a cutscene line). */
  duck(db: number, seconds: number, attack = 0.04, release = 0.35): this {
    finite(db, "duck amount"); nonnegative(seconds, "duck time");
    const g = this._duck.gain, t = this._ctx.currentTime;
    hold(g, t);
    g.setTargetAtTime(dbToGain(-Math.abs(db)), t, Math.max(0.001, attack / 3));
    g.setTargetAtTime(1, t + attack + seconds, Math.max(0.001, release / 3));
    return this;
  }
  disconnect(): void {
    for (const n of [this.node, this._hp, this._lp, this._duck, this._snap]) { try { n?.disconnect(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
  }
}

/** Freeze an AudioParam at its current value so new automation starts from there. */
export function hold(param: AudioParam, t: number): void {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
}
export function ramp(param: AudioParam, value: number, t: number, seconds: number): void {
  hold(param, t);
  if (seconds <= 0.001) param.setValueAtTime(value, t);
  else param.linearRampToValueAtTime(value, t + seconds);
}
function expRamp(param: AudioParam, value: number, t: number, seconds: number): void {
  hold(param, t);
  if (seconds <= 0.001) param.setValueAtTime(value, t);
  else param.setTargetAtTime(value, t, seconds / 3);
}
