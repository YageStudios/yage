import { formant, surface } from "./texture";
import type { FormantOptions, SurfaceOptions } from "./types";
import { makeSpace, bloom, resonate, string, cloud } from "./depth";
import type { BloomOptions, CloudOptions, ResonatorOptions, SpaceOptions, StringOptions } from "./types";
import { hz, type Frequency } from "./notes";
import { clamp, EPSILON, finite, nonnegative, positive, randomSource } from "./dsp";
import type { GameAudio } from "./engine";
import type { AdditiveOptions, FadeOptions, FilterKind, FilterOptions, FmOptions, FrequencyPoint, GlideKind, NoiseLoopOptions, NoiseOptions, SpatialOptions, ToneOptions, Vec3, VoiceOptions, WaveType } from "./types";

type Cleanup = () => void;
type Timer = number;
type Point = { f: Frequency; at: number; glide: GlideKind };
const filterType = (type?: FilterKind): BiquadFilterType => type === "hp" ? "highpass" : type === "bp" ? "bandpass" : "lowpass";

function numbered(source: object, prefix: string): Frequency[] {
  return Object.entries(source).flatMap(([key, value]) => {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(key);
    if (!match || Number(match[1]) < 2 || value == null) return [];
    if (typeof value !== "string" && typeof value !== "number") throw new TypeError(`bleep-bloop: ${key} must be a frequency`);
    return [{ index: Number(match[1]), value }];
  }).sort((a, b) => a.index - b.index).map(p => p.value);
}
function points(first: Frequency | undefined, rest: Frequency[], path: FrequencyPoint[] | undefined, dur: number, glide: GlideKind): Point[] {
  const input: FrequencyPoint[] = path?.length ? path : [first, ...rest].filter((f): f is Frequency => f != null);
  const result = input.map((p, i) => {
    const at = input.length < 2 ? 0 : i * dur / (input.length - 1);
    return typeof p === "object" ? { f: p.f, at: clamp(finite(p.at ?? at, "frequency point time"), 0, dur), glide: p.glide ?? glide } : { f: p, at, glide };
  }).sort((a, b) => a.at - b.at);
  for (const p of result) hz(p.f);
  return result;
}
function frequency(param: AudioParam, path: Point[], t: number, pitch: number, nyquist: number): void {
  if (!path.length) return;
  const value = (f: Frequency) => clamp(hz(f) * pitch, 1, nyquist);
  // Initialize at onset even when the first explicitly timed point is later.
  param.setValueAtTime(value(path[0].f), t);
  for (const [i, p] of path.entries()) {
    if (i === 0 && p.at === 0) continue;
    if (p.at === 0 || p.glide === "step") param.setValueAtTime(value(p.f), t + p.at);
    else if (p.glide === "lin") param.linearRampToValueAtTime(value(p.f), t + p.at);
    else param.exponentialRampToValueAtTime(value(p.f), t + p.at);
  }
}
function envelope(param: AudioParam, t: number, dur: number, o: { a?: number; attack?: number; fadeIn?: number; fadeOut?: number; fade?: FadeOptions; peak?: number; sustain?: number; flat?: boolean }, defaultPeak: number): void {
  const peak = nonnegative(o.peak ?? defaultPeak, "peak");
  const sustain = nonnegative(o.sustain ?? EPSILON, "sustain");
  const attack = clamp(nonnegative(o.fade?.in ?? o.fadeIn ?? o.attack ?? o.a ?? 0.004, "attack"), Math.min(0.001, dur / 4), dur * 0.8);
  const release = clamp(nonnegative(o.fade?.out ?? o.fadeOut ?? Math.min(0.04, dur * 0.3), "release"), Math.min(0.001, dur / 4), dur - attack);
  const endRamp = dur - Math.min(0.003, dur * 0.06);
  const hold = clamp(nonnegative(o.fade?.hold ?? dur - release, "hold"), attack, endRamp);
  param.setValueAtTime(0, t);
  if (peak === 0) { param.setValueAtTime(0, t + dur); return; }
  param.linearRampToValueAtTime(peak, t + attack);
  if (o.flat || o.fade || o.fadeOut !== undefined) param.setValueAtTime(peak, t + hold);
  // An exponential release must stay positive; finish with a short linear ramp to exact silence.
  param.exponentialRampToValueAtTime(Math.max(EPSILON, Math.min(peak, sustain)), t + endRamp);
  param.linearRampToValueAtTime(0, t + dur);
}

/** One playback instance. Every primitive owns and releases its entire graph. */
export class Voice {
  engine: GameAudio;
  ctx: AudioContext | OfflineAudioContext;
  nb: AudioBuffer;
  pitch: number;
  until: number;
  _live = false;
  _stopped = false;
  _busName?: string;
  _gain: GainNode;
  _panner?: StereoPannerNode;
  _spatial?: PannerNode;
  _occlusion?: BiquadFilterNode;
  private _occlusionGain?: GainNode;
  /** Engine bookkeeping: definition id, priority and start time used for voice stealing. */
  _id?: string;
  _priority = 0;
  _started = 0;
  /** Owned by a parent voice (event layer / sequence step); excluded from the voice budget. */
  _childOfOther = false;
  private _position: Vec3 = [0, 0, 0];
  private _spatialOptions?: SpatialOptions;
  private _params = new Map<string, number>();
  private _paramFns = new Map<string, Array<(value: number, time: number) => void>>();
  private _bus: AudioNode;
  private _cleanups: Cleanup[] = [];
  private _nodes = new Set<AudioNode>();
  private _sources = new Set<AudioScheduledSourceNode>();
  private _timers = new Set<Timer>();
  private _random: () => number;
  private _disposed = false;
  private _level: number;
  private _trim = 1;
  private _children = new Set<Voice>();
  private _parent?: Voice;
  readonly depth: number;
  readonly motion: number;
  readonly brightness: number;
  private _spaceInput?: AudioNode;
  private _insertInput?: AudioNode;
  private _spaceTail = 0;
  private _dryUntil = 0;

  constructor(engine: GameAudio, busNode: AudioNode, opts: VoiceOptions = {}) {
    this.engine = engine; this.ctx = engine.ctx; this.nb = engine.nb; this._bus = busNode;
    this.pitch = positive(opts.pitch ?? 1, "pitch");
    this.depth = clamp(nonnegative(opts.depth ?? 1, "depth"), 0, 2);
    this.motion = clamp(nonnegative(opts.motion ?? 1, "motion"), 0, 2);
    this.brightness = clamp(positive(opts.brightness ?? 1, "brightness"), .25, 2);
    this._random = randomSource(opts.seed);
    this._level = nonnegative(opts.volume ?? 1, "volume");
    if (opts.pan !== undefined) finite(opts.pan, "pan");
    this._gain = this.ctx.createGain();
    this._gain.gain.value = this._level;
    this._gain.connect(busNode);
    if (opts.pan !== undefined) this.setPan(opts.pan);
    for (const [name, value] of Object.entries(opts.params ?? {})) this._params.set(name, finite(value, `parameter ${name}`));
    if (opts.position) this.spatialize({ ...opts.spatial, position: opts.position });
    this.until = this.ctx.currentTime;
    this._started = this.ctx.currentTime;
  }
  now(): number { return this.ctx.currentTime; }
  get dest(): AudioNode { return this._insertInput ?? this._spaceInput ?? this._gain; }
  get volume(): number { return this._level; }
  set volume(value: number) {
    nonnegative(value, "voice volume");
    if (this._stopped) return;
    this._level = value;
    this._gain.gain.setTargetAtTime(value * this._trim, this.now(), 0.02);
  }
  /** Ramp the voice level over `seconds`, used by music stems and crossfades. */
  fadeTo(value: number, seconds: number, at = this.now()): this {
    nonnegative(value, "voice volume"); nonnegative(seconds, "fade time");
    if (this._stopped) return this;
    this._level = value;
    const g = this._gain.gain, start = Math.max(at, this.now());
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(start); else { g.cancelScheduledValues(start); g.setValueAtTime(g.value, start); }
    g.linearRampToValueAtTime(value * this._trim, start + Math.max(0.005, seconds));
    return this;
  }
  /** Current value of a game parameter: playback-local, then engine-global, then `fallback`. */
  param(name: string, fallback = 0): number {
    return this._params.get(name) ?? this.engine.getParam(name) ?? fallback;
  }
  /** React to parameter changes (`handle.setParam`, `audio.setParam`). Called with the new value and audio time. */
  onParam(name: string, fn: (value: number, time: number) => void): this {
    const list = this._paramFns.get(name) ?? [];
    list.push(fn); this._paramFns.set(name, list); return this;
  }
  /** Parameters discovered while baking a definition's graph. */
  get parameterNames(): string[] { return [...this._paramFns.keys()]; }
  setParam(name: string, value: number, local = true): this {
    finite(value, `parameter ${name}`);
    if (this._stopped) return this;
    if (local) this._params.set(name, value);
    else if (this._params.has(name)) return this; // a local override wins over the global value
    for (const fn of this._paramFns.get(name) ?? []) fn(value, this.now());
    for (const child of this._children) child.setParam(name, value, local);
    return this;
  }
  /** Route the voice through an HRTF/equal-power 3-D panner with distance air absorption and occlusion. */
  spatialize(o: SpatialOptions): this {
    if (this._stopped) return this;
    const ctx = this.ctx;
    if (!ctx.createPanner) return this.setPan(clamp(o.position[0] / Math.max(1, Math.abs(o.position[2]) + 1), -1, 1));
    this._spatialOptions = { ...this._spatialOptions, ...o };
    if (!this._spatial) {
      const panner = ctx.createPanner(), occlusion = ctx.createBiquadFilter(), occlusionGain = ctx.createGain();
      panner.panningModel = o.model === "equalpower" ? "equalpower" : "HRTF";
      panner.distanceModel = o.distance ?? "inverse";
      panner.refDistance = positive(o.refDistance ?? 1, "reference distance");
      panner.maxDistance = positive(o.maxDistance ?? 10000, "maximum distance");
      panner.rolloffFactor = nonnegative(o.rolloff ?? 1, "rolloff");
      if (o.cone) {
        panner.coneInnerAngle = o.cone.inner; panner.coneOuterAngle = o.cone.outer; panner.coneOuterGain = clamp(o.cone.outerGain, 0, 1);
      }
      occlusion.type = "lowpass"; occlusion.Q.value = 0.5; occlusion.frequency.value = ctx.sampleRate * 0.45;
      const tail: AudioNode = this._panner ?? this._bus;
      this._gain.disconnect(); this._gain.connect(occlusion); occlusion.connect(occlusionGain); occlusionGain.connect(panner); panner.connect(tail);
      this._spatial = panner; this._occlusion = occlusion; this._occlusionGain = occlusionGain;
    }
    if (o.orientation) this.setOrientation(o.orientation);
    return this.setPosition(o.position);
  }
  setPosition(position: Vec3, glide = 0.03): this {
    const [x, y, z] = position.map((n, i) => finite(n, `position[${i}]`));
    this._position = [x, y, z];
    if (this._stopped || !this._spatial) return this;
    const p = this._spatial, t = this.now();
    if (p.positionX) { p.positionX.setTargetAtTime(x, t, glide); p.positionY.setTargetAtTime(y, t, glide); p.positionZ.setTargetAtTime(z, t, glide); }
    else p.setPosition(x, y, z);
    return this._updateFilter(glide);
  }
  setOrientation(direction: Vec3): this {
    if (this._stopped || !this._spatial) return this;
    const [x, y, z] = direction.map((n, i) => finite(n, `orientation[${i}]`)), p = this._spatial, t = this.now();
    if (p.orientationX) { p.orientationX.setTargetAtTime(x, t, .03); p.orientationY.setTargetAtTime(y, t, .03); p.orientationZ.setTargetAtTime(z, t, .03); }
    else p.setOrientation(x, y, z);
    return this;
  }
  /** 0 = clear line of sight, 1 = fully behind a wall (heavy low-pass and attenuation). */
  setOcclusion(amount: number, glide = 0.08): this {
    this._spatialOptions = { ...(this._spatialOptions ?? { position: this._position }), occlusion: clamp(finite(amount, "occlusion"), 0, 1) };
    return this._updateFilter(glide);
  }
  /** @internal Recompute occlusion + distance air absorption after the source or listener moved. */
  _updateFilter(glide = 0.05): this {
    if (this._stopped || !this._occlusion || !this._spatialOptions) return this;
    const o = this._spatialOptions, listener = this.engine.listenerPosition;
    const distance = Math.hypot(this._position[0] - listener[0], this._position[1] - listener[1], this._position[2] - listener[2]);
    const nyquist = this.ctx.sampleRate * 0.45;
    // Air absorbs highs with distance; ~20 kHz close, ~3.5 kHz at 300 m. Opt out with air:false.
    const air = o.air === false ? nyquist : clamp(20000 / (1 + distance / 70), 3500, nyquist);
    const occlusion = clamp(o.occlusion ?? 0, 0, 1);
    const cutoff = clamp(air * Math.pow(0.04, occlusion), 180, nyquist);
    this._occlusion.frequency.setTargetAtTime(cutoff, this.now(), glide);
    this._occlusionGain?.gain.setTargetAtTime(1 - occlusion * 0.55, this.now(), glide);
    return this;
  }
  get position(): Vec3 { return this._position; }
  /** Internal preset trim stays separate from the public volume multiplier. */
  setTrim(value: number): void { this._trim = nonnegative(value, "preset gain"); this._gain.gain.value = this._level * this._trim; }
  /** Deterministic when a playback seed is supplied. */
  random(min = 0, max = 1): number { return min + this._random() * (max - min); }
  hold(): this { if (!this._stopped) this._live = true; return this; }
  onStop(fn: Cleanup): this { if (this._stopped) fn(); else this._cleanups.push(fn); return this; }
  _track(t: number): void {
    this._dryUntil = Math.max(this._dryUntil, t);
    this.until = Math.max(this.until, this._dryUntil + this._spaceTail);
  }
  /** Set the acoustic scene before scheduling any sources. One space per voice. */
  space(options: SpaceOptions = {}): this {
    if (this._stopped) return this;
    if (this._spaceInput || this._insertInput || this._sources.size) throw new Error("bleep-bloop: call space once, before scheduling sources");
    const scene = makeSpace(this, options, this._gain);
    this._spaceInput = scene.input; this._spaceTail = scene.tail;
    scene.nodes.forEach(node => this._nodes.add(node));
    return this;
  }
  /** @internal Insert a preset-owned, zero-tail processor before the acoustic scene.
   * Call after space(), before sources. Nodes are disposed with this voice, not a dummy source. */
  _insert(...nodes: AudioNode[]): this {
    if (this._stopped || !nodes.length) return this;
    if (this._sources.size) throw new Error("bleep-bloop: insert processors before scheduling sources");
    const output = this.dest;
    nodes.forEach((node, i) => { node.connect(nodes[i + 1] ?? output); this._nodes.add(node); });
    this._insertInput = nodes[0];
    return this;
  }
  formant(t: number, options: FormantOptions): number { return formant(this, t, options); }
  surface(t: number, options: SurfaceOptions): number { return surface(this, t, options); }
  bloom(t: number, options: BloomOptions): number { return bloom(this, t, options); }
  resonate(t: number, options: ResonatorOptions): number { return resonate(this, t, options); }
  string(t: number, options: StringOptions): number { return string(this, t, options); }
  cloud(t: number, options: CloudOptions): number { return cloud(this, t, options); }
  setPan(pan: number): this {
    const p = clamp(finite(pan, "pan"), -1, 1);
    if (this._stopped || !this.ctx.createStereoPanner) return this;
    if (!this._panner) {
      this._panner = this.ctx.createStereoPanner();
      const head: AudioNode = this._spatial ?? this._gain;
      head.disconnect(); head.connect(this._panner); this._panner.connect(this._bus);
      this._panner.pan.value = p;
    } else this._panner.pan.setTargetAtTime(p, this.now(), 0.02);
    return this;
  }
  adopt(child: Voice): void { this._children.add(child); child._parent = this; }
  /** @internal Send this voice's output somewhere other than its bus (used by layered events). */
  _reroute(dest: AudioNode): void {
    const tail: AudioNode = this._panner ?? this._spatial ?? this._gain;
    try { tail.disconnect(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ }
    tail.connect(dest); this._bus = dest;
  }
  /** Track a custom graph too; onended releases nodes while loops keep playing. */
  own(source: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
    this._sources.add(source); this._nodes.add(source); nodes.forEach(n => this._nodes.add(n));
    source.onended = () => {
      this._sources.delete(source);
      for (const n of [source, ...nodes]) { try { n.disconnect(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } this._nodes.delete(n); }
    };
  }
  /** Control-rate callback on the engine scheduler; cancelled when the voice stops. */
  later(fn: () => void, ms: number): Timer {
    const timer = this.engine.timers.set(() => { this._timers.delete(timer); fn(); }, ms);
    this._timers.add(timer); return timer;
  }
  private route(node: AudioNode, pan?: number): AudioNode[] {
    if (pan === undefined || !this.ctx.createStereoPanner) { node.connect(this.dest); return []; }
    const p = this.ctx.createStereoPanner(); p.pan.value = clamp(finite(pan, "pan"), -1, 1);
    node.connect(p); p.connect(this.dest); return [p];
  }
  private filter(node: AudioNode, o: FilterOptions | null | undefined, t: number, dur: number, glide: GlideKind): AudioNode[] {
    if (!o || o.type === "none") return [];
    const f = this.ctx.createBiquadFilter(); f.type = filterType(o.type);
    frequency(f.frequency, points(o.freq ?? 1000, numbered(o, "freq"), o.freqs, dur, o.glide ?? glide), t, this.pitch, (this.ctx.sampleRate || 44100) * 0.49);
    f.Q.value = clamp(nonnegative(o.Q ?? 0.707, "Q"), 0, 30);
    node.connect(f); return [f];
  }
  private time(t: number, dur: number): number {
    positive(dur, "duration"); return Math.max(this.now(), nonnegative(t, "start time"));
  }

  /** Oscillator, optional filter and vibrato, with a bounded attack/release envelope. */
  tone(t0: number, o: ToneOptions): number {
    if (this._stopped) return t0;
    const dur = o.dur ?? 0.18, t = this.time(t0, dur), ctx = this.ctx;
    const glide = o.glide ?? "exp", nyquist = (ctx.sampleRate || 44100) * 0.49;
    const path = points(o.f, numbered(o, "f"), o.freqs, dur, glide);
    const curve = o.curve?.map(f => clamp(hz(f) * this.pitch, 1, nyquist));
    if (o.curve && o.curve.length < 2) throw new RangeError("bleep-bloop: curve needs at least two frequencies");
    const osc = ctx.createOscillator(); osc.type = o.type ?? "sine"; osc.detune.value = finite(o.detune ?? 0, "detune");
    if (curve) osc.frequency.setValueCurveAtTime(Float32Array.from(curve), t, dur);
    else frequency(osc.frequency, path, t, this.pitch, nyquist);
    const g = ctx.createGain(); envelope(g.gain, t, dur, o, 0.5);
    const filters = this.filter(osc, o.filter, t, dur, glide);
    (filters[0] ?? osc).connect(g); const pan = this.route(g, o.pan);
    this.own(osc, ...filters, g, ...pan);
    if (o.vibratoF) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = positive(o.vibratoF, "vibrato rate");
      depth.gain.value = finite(o.vibratoD ?? 10, "vibrato depth") * this.pitch;
      lfo.connect(depth); depth.connect(osc.frequency); this.own(lfo, depth);
      lfo.start(t); lfo.stop(t + dur + 0.004);
    }
    osc.start(t); osc.stop(t + dur + 0.005); this._track(t + dur + 0.01); return t + dur;
  }

  /** Filtered, decorrelated noise burst. Explicit flat/fade options opt into a sustained bed. */
  noise(t0: number, o: NoiseOptions = {}): number {
    if (this._stopped) return t0;
    const dur = o.dur ?? 0.2, t = this.time(t0, dur), ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noiseBuffer(o.color ?? "white"); src.loop = true;
    const filters = this.filter(src, o.filter ?? { ...o, type: o.type ?? "hp", freq: o.freq ?? 1000 }, t, dur, o.glide ?? "exp");
    const g = ctx.createGain(); envelope(g.gain, t, dur, { a: 0.002, ...o }, 0.5);
    (filters[0] ?? src).connect(g); const pan = this.route(g, o.pan);
    this.own(src, ...filters, g, ...pan);
    src.start(t, this.random(0, src.buffer.duration)); src.stop(t + dur + 0.005);
    this._track(t + dur + 0.01); return t + dur;
  }
  seq(t: number, notes: Array<Frequency | ToneOptions>, gap = 0.09, common: Partial<ToneOptions> = {}): void {
    nonnegative(gap, "note gap");
    notes.forEach((n, i) => this.tone(t + i * gap, { ...common, ...(typeof n === "object" ? n : { f: n }) }));
  }
  /** Normalized resonant modes, each with an independent decay. */
  additive(t: number, o: AdditiveOptions): number {
    if (!o.partials.length || o.partials.length > 32) throw new RangeError("bleep-bloop: additive needs 1–32 partials");
    const f = hz(o.f), dur = o.dur ?? 0.8;
    const sum = o.partials.reduce((a, p) => a + nonnegative(p.gain, "partial gain"), 0);
    let end = t;
    for (const p of o.partials) {
      positive(p.ratio, "partial ratio"); positive(p.decay ?? 1, "partial decay");
      if (!p.gain || f * p.ratio * this.pitch >= (this.ctx.sampleRate || 44100) * 0.47) continue;
      end = Math.max(end, this.tone(t, { ...o, f: f * p.ratio, dur: dur * (p.decay ?? 1), type: "sine", peak: (o.peak ?? 0.4) * p.gain / Math.max(sum, EPSILON), detune: (o.detune ?? 0) + (p.detune ?? 0) }));
    }
    return end;
  }
  /** Two-operator FM. Both amplitude and modulation reach silence before teardown. */
  fm(t0: number, o: FmOptions): number {
    if (this._stopped) return t0;
    const dur = o.dur ?? 0.7, t = this.time(t0, dur), ctx = this.ctx;
    const f = Math.min(hz(o.f) * this.pitch, (ctx.sampleRate || 44100) * 0.2);
    const ratio = positive(o.ratio ?? 2, "FM ratio"), index = nonnegative(o.index ?? 1.5, "FM index"), end = nonnegative(o.indexEnd ?? 0.02, "FM index end");
    const carrier = ctx.createOscillator(), mod = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
    carrier.type = o.type ?? "sine"; carrier.frequency.value = f; carrier.detune.value = finite(o.detune ?? 0, "detune");
    mod.frequency.value = Math.min(f * ratio, (ctx.sampleRate || 44100) * 0.45);
    depth.gain.setValueAtTime(Math.min(index * f, (ctx.sampleRate || 44100) * 0.2), t);
    depth.gain.exponentialRampToValueAtTime(Math.max(EPSILON, end * f), t + dur);
    mod.connect(depth); depth.connect(carrier.frequency);
    envelope(g.gain, t, dur, o, 0.4);
    const filters = this.filter(carrier, o.filter, t, dur, "exp");
    (filters[0] ?? carrier).connect(g); const pan = this.route(g, o.pan);
    this.own(carrier, ...filters, g, ...pan); this.own(mod, depth);
    carrier.start(t); mod.start(t); carrier.stop(t + dur + 0.005); mod.stop(t + dur + 0.005);
    this._track(t + dur + 0.01); return t + dur;
  }

  /** Bounded lookahead; late callbacks skip missed beats rather than burst them. */
  repeat(fn: (t: number, index: number) => void, stepDur: number): this {
    if (positive(stepDur, "repeat interval") < 0.005) throw new RangeError("bleep-bloop: repeat interval must be at least 5 ms");
    if (this._stopped) return this;
    this.hold(); let i = 0; const start = this.now() + 0.025;
    const tick = () => {
      if (this._stopped) return;
      const now = this.now();
      i = Math.max(i, Math.ceil((now - start) / stepDur));
      try { while (start + i * stepDur < now + 0.12) { fn(start + i * stepDur, i); i++; if (this._stopped) return; } }
      catch (error) { this._stop(0); throw error; }
      this.later(tick, 25);
    };
    tick(); return this;
  }
  jitter(fn: () => void, minMs: number, maxMs: number): this {
    if (positive(minMs, "minimum jitter delay") < 5 || finite(maxMs, "maximum jitter delay") < minMs) throw new RangeError("bleep-bloop: jitter needs 5 <= min <= max milliseconds");
    if (this._stopped) return this;
    this.hold(); const fire = () => {
      if (this._stopped) return;
      try { fn(); } catch (error) { this._stop(0); throw error; }
      if (!this._stopped) this.later(fire, this.random(minMs, maxMs));
    }; fire(); return this;
  }
  sweep({ type = "triangle", center, depth, rate, gain = 0.4 }: { type?: WaveType; center: Frequency; depth: number; rate: number; gain?: number }): this {
    if (this._stopped) return this;
    const f = hz(center) * this.pitch, d = Math.min(nonnegative(depth, "sweep depth") * this.pitch, f * 0.95);
    positive(rate, "sweep rate"); nonnegative(gain, "sweep gain"); this.hold();
    const ctx = this.ctx, osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    osc.type = type; osc.frequency.value = f; lfo.frequency.value = rate; lg.gain.value = d;
    lfo.connect(lg); lg.connect(osc.frequency); g.gain.value = 0; g.gain.setTargetAtTime(gain, this.now(), 0.04);
    osc.connect(g); g.connect(this.dest); this.own(osc, g); this.own(lfo, lg); osc.start(); lfo.start(); return this;
  }
  cadence({ freqs, wave = "sine", tremolo = null, cadence = null, continuous = false, peak = 0.5 }: {
    freqs: Frequency[]; wave?: WaveType; tremolo?: { freq: number; depth: number } | null;
    cadence?: Array<[number, number]> | null; continuous?: boolean; peak?: number;
  }): this {
    if (!freqs.length || freqs.length > 32) throw new RangeError("bleep-bloop: cadence needs 1–32 frequencies");
    freqs.forEach(hz); nonnegative(peak, "cadence peak");
    if (!continuous && (!cadence?.length || cadence.some(([d, on]) => !Number.isFinite(d) || d < 0.005 || ![0, 1].includes(on)))) throw new RangeError("bleep-bloop: cadence needs positive on/off steps of at least 5 ms");
    if (cadence) finite(cadence.reduce((sum, [d]) => sum + d, 0), "cadence duration");
    if (tremolo) { positive(tremolo.freq, "tremolo rate"); finite(tremolo.depth, "tremolo depth"); }
    if (this._stopped) return this;
    this.hold(); const ctx = this.ctx, gate = ctx.createGain(), mod = ctx.createGain();
    gate.gain.value = 0; mod.gain.value = 1; mod.connect(gate); gate.connect(this.dest);
    // Power-normalize oscillator banks; four partials must not be four times louder.
    const level = peak / Math.sqrt(freqs.length);
    freqs.forEach(f => { const osc = ctx.createOscillator(); osc.type = wave; osc.frequency.value = hz(f) * this.pitch; osc.connect(mod); this.own(osc); osc.start(); });
    this._nodes.add(mod); this._nodes.add(gate);
    if (tremolo) {
      const depth = clamp(tremolo.depth, 0, 1), lfo = ctx.createOscillator(), lg = ctx.createGain();
      mod.gain.value = 1 - depth / 2; lfo.frequency.value = tremolo.freq; lg.gain.value = depth / 2;
      lfo.connect(lg); lg.connect(mod.gain); this.own(lfo, lg); lfo.start();
    }
    if (continuous) gate.gain.setTargetAtTime(level, this.now(), 0.02);
    else {
      if (!cadence) throw new Error("Audio cadence is required for pulsed modulation");
      const steps = cadence, total = steps.reduce((sum, [d]) => sum + d, 0), start = this.now() + 0.025;
      let cycle = 0, index = 0;
      const offsets = steps.map((_, i) => steps.slice(0, i).reduce((s, [d]) => s + d, 0));
      const tick = () => {
        if (this._stopped) return;
        const now = this.now();
        if (start + cycle * total + offsets[index] < now - 0.12) {
          cycle = Math.max(0, Math.floor((now - start) / total)); index = 0;
          while (index + 1 < steps.length && start + cycle * total + offsets[index + 1] <= now) index++;
        }
        while (start + cycle * total + offsets[index] < now + 0.12) {
          gate.gain.setTargetAtTime(steps[index][1] ? level : 0, Math.max(now, start + cycle * total + offsets[index]), 0.004);
          if (++index === steps.length) { index = 0; cycle++; }
        }
        this.later(tick, 25);
      }; tick();
    }
    return this;
  }
  noiseLoop({ color = "white", type = "lp", freq = 800, Q = 0.8, gain = 0.3, pan, lfoF = 0, lfoD = 0 }: NoiseLoopOptions = {}): this {
    positive(freq, "noise frequency"); nonnegative(gain, "noise gain"); nonnegative(lfoF, "noise LFO rate"); nonnegative(lfoD, "noise LFO depth");
    if (this._stopped) return this;
    this.hold(); const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.engine.noiseBuffer(color); src.loop = true; f.type = filterType(type);
    const center = clamp(freq * this.pitch, 20, (ctx.sampleRate || 44100) * 0.45);
    f.frequency.value = center; f.Q.value = clamp(nonnegative(Q, "noise Q"), 0, 12);
    g.gain.value = 0; g.gain.setTargetAtTime(gain, this.now(), 0.12);
    src.connect(f); f.connect(g); const p = this.route(g, pan); this.own(src, f, g, ...p);
    if (lfoF) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = lfoF;
      lg.gain.value = Math.min(lfoD * this.pitch, center * 0.9, (ctx.sampleRate || 44100) * 0.49 - center);
      lfo.connect(lg); lg.connect(f.frequency); this.own(lfo, lg); lfo.start();
    }
    src.start(this.now(), this.random(0, src.buffer.duration)); return this;
  }
  /** One-shot cleanup follows audio time, so suspending a context cannot eat a long sound. */
  _autoStop(): void {
    if (this._stopped || this._live) return;
    const poll = () => {
      if (this._stopped || this._live) return;
      if (this.ctx.state === "closed" || this.now() >= this.until + 0.02) this._stop(0);
      else this.later(poll, Math.min(1000, Math.max(30, (this.until - this.now()) * 1000)));
    }; this.later(poll, Math.max(30, (this.until - this.now() + 0.025) * 1000));
  }
  _stop(fade = 0.04): void {
    nonnegative(fade, "stop fade"); if (this._stopped) return;
    this._stopped = true; this._live = false;
    for (const timer of this._timers) this.engine.timers.clear(timer); this._timers.clear();
    const t = this.now(), end = t + Math.max(0.003, fade);
    const gain = this._gain.gain;
    const value = gain.value;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(t);
    else gain.cancelScheduledValues(t);
    // Anchor the fade even when the only prior value was assigned via .value.
    // Without an event here, a first linear ramp can interpolate from time zero.
    gain.setValueAtTime(value, t);
    gain.linearRampToValueAtTime(0, end);
    for (const source of this._sources) { try { source.stop(end + 0.005); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
    for (const child of this._children) child._stop(fade);
    for (const fn of this._cleanups.splice(0)) { try { fn(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
    this.later(() => this._dispose(), (Math.max(0.003, fade) + 0.025) * 1000);
  }
  _dispose(): void {
    if (this._disposed) return; this._disposed = true; this._stopped = true;
    for (const timer of this._timers) this.engine.timers.clear(timer); this._timers.clear();
    for (const source of this._sources) { try { source.stop(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
    this._sources.clear();
    for (const child of this._children) child._dispose();
    this._children.clear(); this._parent?._children.delete(this);
    for (const node of this._nodes) { try { node.disconnect(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
    this._nodes.clear();
    for (const node of [this._gain, this._panner, this._spatial, this._occlusion, this._occlusionGain]) { try { node?.disconnect(); } catch { /* Cleanup also runs after nodes have ended or disconnected. */ } }
    this._paramFns.clear();
    this.engine._voices.delete(this);
  }
}
