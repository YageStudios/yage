import { noteToFreq, type Frequency } from "./notes";
import { Bus, Handle, dbToGain, hold, ramp, type BusState } from "./mixer";
import { Voice } from "./voice";
import { Scheduler } from "./clock";
import { SoundBufferCache, type BufferRequest } from './buffer-cache';
import { renderSoundBuffer } from './buffer-render';
import { playSoundBuffer } from './buffer-playback';
import { clamp, finite, nonnegative, positive, randomSource } from "./dsp";
import type { EventDefinition, NoiseColor, SoundQuery, Vec3 } from "./types";
import type { ChordOptions, GameAudioOptions, ListedSound, MelodyOptions, NoteOptions, SequenceOptions, SoundDefinition, SoundInput, SoundPlay, VoiceOptions } from "./types";

export { Bus, Handle, dbToGain, gainToDb, type BusState } from "./mixer";
export { Scheduler } from "./clock";
export { Voice } from "./voice";
export type { EventDefinition, SpatialOptions, StealMode, Vec3, VariationOptions } from "./types";
export type { SpaceOptions, BloomOptions, CloudOptions, ResonatorOptions, MaterialVoice, StringOptions, AdditiveOptions, FmOptions, NoiseColor, NoiseLoopOptions, PartialTone, SoundQuery, ChordOptions, FadeOptions, FilterKind, FilterOptions, FrequencyPoint, GameAudioOptions, GlideKind, ListedSound, MelodyOptions, NoiseOptions, NoteOptions, PresetRegistrar, SequenceOptions, SoundDefinition, SoundInput, SoundPlay, ToneOptions, VoiceOptions, WaveType } from "./types";

// ---------------------------------------------------------------------------
// GameAudio — the public object.
// ---------------------------------------------------------------------------

export class GameAudio {
  ctx: AudioContext | OfflineAudioContext;
  analyser?: AnalyserNode;
  nb: AudioBuffer;
  private _master: GainNode;
  private _comp: DynamicsCompressorNode | GainNode;
  private _level: number;
  private _noise = new Map<NoiseColor, AudioBuffer>();
  private _seed?: number;
  private _voiceSeed: () => number;
  private _ownsContext: boolean;
  private _closed = false;
  private _output: AudioNode;
  private _disposeCallbacks: Array<() => void> = [];
  private _buses: Map<string, Bus>;
  _defs: Map<string, SoundDefinition & { id: string; category: string }>;
  _voices: Set<Voice>;
  /** Control-rate scheduler; offline renders drive it from audio time. */
  readonly timers: Scheduler;
  /** Global polyphony budget. */
  maxVoices: number;
  private _params = new Map<string, number>();
  private _switches = new Map<string, string>();
  private _events = new Map<string, EventDefinition & { id: string; recent: string[]; bag: string[]; step: number }>();
  private _lastTrigger = new Map<string, number>();
  private _snapshots = new Map<string, Record<string, BusState>>();
  private _activeSnapshot: string | null = null;
  private _ducks: Array<{ target: string; triggers: string[]; gain: number; attack: number; release: number; until: number; live: number }> = [];
  private _listener: { position: Vec3; forward: Vec3; up: Vec3 } = { position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] };
  private _rng: () => number;
  private _soundBuffers?: SoundBufferCache;
  private _bufferSampleRate: number;
  private _bufferVariants = new WeakMap<SoundDefinition, number>();

  /**
   * @param {object} [opts]
   * @param {number}  [opts.volume=0.8]     master volume 0..1
   * @param {boolean} [opts.analyser=false] expose an AnalyserNode as audio.analyser
   * @param {boolean|function} [opts.presets=false] optional preset registrar
   * @param {AudioContext} [opts.context]   bring your own AudioContext
   */
  constructor(opts: GameAudioOptions = {}) {
    const AC =
      typeof window !== "undefined"
        ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        : globalThis.AudioContext;
    if (!opts.context && !AC) throw new Error("bleep-bloop: Web Audio is unavailable; provide an AudioContext");
    this._bufferSampleRate = positive(opts.sampleRate ?? 16000, 'sample rate');
    this.ctx = opts.context ?? new AC({ sampleRate: this._bufferSampleRate });
    this._ownsContext = !opts.context;
    this._seed = opts.seed;
    this._voiceSeed = randomSource(opts.seed);
    this._rng = randomSource(opts.seed === undefined ? undefined : opts.seed ^ 0x5eed);
    this.timers = new Scheduler(this.ctx);
    this.maxVoices = Math.max(1, Math.round(positive(opts.maxVoices ?? 128, "max voices")));
    const ctx = this.ctx;

    this._master = ctx.createGain();
    // Do not run every transient through an always-on compressor. In native
    // Chromium its startup gain attenuates the first short hit, and the makeup
    // stage changes later hits. Designed source levels + the safety knee are
    // the transparent default; legacy bus compression is an explicit option.
    if (opts.compression) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.ratio.value = 4;
      compressor.attack.value = .003;
      compressor.release.value = .18;
      this._comp = compressor;
    } else this._comp = ctx.createGain();
    this._master.connect(this._comp);
    let tail: AudioNode = this._comp;
    if (opts.limiter && ctx.createDynamicsCompressor) {
      // Fast, high-ratio peak control near full scale. Off by default to keep transients exact.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.001; limiter.release.value = 0.12;
      tail.connect(limiter); tail = limiter;
    }
    if (opts.protection !== false && ctx.createWaveShaper) {
      // Identity in the normal range; a soft knee bounds large stacked sample peaks.
      const safety = ctx.createWaveShaper();
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) {
        const x = 2 * i / (curve.length - 1) - 1, a = Math.abs(x);
        curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
      }
      safety.curve = curve; safety.oversample = "none";
      tail.connect(safety); tail = safety;
    }
    if (opts.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      tail.connect(this.analyser);
      tail = this.analyser;
    }
    tail.connect(ctx.destination);
    this._output = tail;

    this._level = nonnegative(opts.volume ?? 0.8, "master volume");
    this._master.gain.value = this._level * 0.55; // fixed mixing headroom

    // Shared immutable buffers; colored beds are allocated only when requested.
    this.nb = this.noiseBuffer("white");

    this._buses = new Map();
    this.bus("sfx");
    this.bus("music");
    this.bus("ambient");

    this._defs = new Map();
    this._voices = new Set();
    if (opts.soundBuffers !== false && !this.timers.offline && typeof OfflineAudioContext !== 'undefined') {
      this._soundBuffers = new SoundBufferCache(request => renderSoundBuffer(request,
        (context, seed) => new GameAudio({ context, seed, sampleRate: context.sampleRate, soundBuffers: false, protection: false })));
    }

    if (typeof opts.presets === "function") opts.presets(this);
  }

  // ---- master / lifecycle ---------------------------------------------------

  get volume(): number {
    return this._level;
  }
  set volume(v: number) {
    this._level = nonnegative(v, "master volume");
    this._master.gain.setTargetAtTime(v * 0.55, this.ctx.currentTime, 0.02);
  }

  /**
   * Resume the AudioContext. Browsers require a user gesture before audio can
   * start; call this from your first input handler (play() also calls it).
   */
  resume(): this {
    if (this._closed || this.ctx.state === "closed") throw new Error("bleep-bloop: this audio instance is disposed or its context is closed");
    if (this.ctx.state === "suspended" && !("startRendering" in this.ctx)) void this.ctx.resume().catch(() => {});
    return this;
  }
  suspend(): Promise<void> {
    if ("startRendering" in this.ctx) return Promise.reject(new Error("bleep-bloop: suspend offline contexts directly with a time"));
    if (typeof this.ctx.suspend === "function") return this.ctx.suspend();
    return Promise.resolve();
  }

  /** Shared, seeded noise with DC removal and a continuous loop boundary. */
  noiseBuffer(color: NoiseColor = "white"): AudioBuffer {
    const existing = this._noise.get(color);
    if (existing) return existing;
    if (!["white", "pink", "brown"].includes(color)) throw new RangeError("bleep-bloop: unknown noise color");
    const ctx = this.ctx, n = Math.max(128, Math.round(ctx.sampleRate * 4));
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate), data = buffer.getChannelData(0);
    const rng = randomSource((this._seed ?? 0xB1EE9) + ({ white: 0, pink: 1, brown: 2 }[color]));
    let b0 = 0, b1 = 0, b2 = 0, brown = 0;
    // Warm filters before retaining samples, so a loop does not replay a startup transient.
    for (let i = -8192; i < n; i++) {
      const white = rng() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      brown = (brown + 0.02 * white) / 1.02;
      const sample = color === "white" ? white : color === "pink" ? (b0 + b1 + b2 + white * 0.1848) * 0.2 : brown * 3.5;
      if (i >= 0) data[i] = sample;
    }
    // Short equal-power seam for colored noise. White noise is already stationary.
    if (color !== "white") {
      const seam = Math.min(2048, Math.floor(n / 8));
      for (let i = 0; i < seam; i++) {
        const a = i / (seam - 1) * Math.PI / 2;
        data[n - seam + i] = data[n - seam + i] * Math.cos(a) + data[i] * Math.sin(a);
      }
      // The next loop sample follows data[seam-1], not data[0]; rotate the retained section.
      data.copyWithin(0, seam); data.fill(0, n - seam);
      // Rebuild a buffer of the retained period rather than introducing a silent tail.
      const trimmed = ctx.createBuffer(1, n - seam, ctx.sampleRate);
      trimmed.getChannelData(0).set(data.subarray(0, n - seam));
      this.centerNoise(trimmed.getChannelData(0)); this._noise.set(color, trimmed); return trimmed;
    }
    this.centerNoise(data); this._noise.set(color, buffer); return buffer;
  }
  private centerNoise(data: Float32Array): void {
    let sum = 0; for (const x of data) sum += x;
    const mean = sum / data.length; let peak = 0;
    for (let i = 0; i < data.length; i++) { data[i] -= mean; peak = Math.max(peak, Math.abs(data[i])); }
    const scale = peak > 1 ? 1 / peak : 1;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
  /** Cleanup hook used by browser preset registration, without retaining dead instances. */
  onDispose(fn: () => void): this { if (this._closed) fn(); else this._disposeCallbacks.push(fn); return this; }
  /** Release voices and graph; a caller-owned context remains open. */
  async dispose(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._soundBuffers?.dispose();
    for (const v of [...this._voices]) { v._stop(0); v._dispose(); }
    this.timers.clearAll();
    for (const b of this._buses.values()) b.disconnect();
    this._master.disconnect(); this._comp.disconnect(); this._output.disconnect();
    this._noise.clear(); this._defs.clear();
    for (const fn of this._disposeCallbacks.splice(0)) fn();
    if (this._ownsContext && "close" in this.ctx && this.ctx.state !== "closed") await this.ctx.close();
  }

  /** Get (or lazily create) a named bus. `parent` nests it under another bus: bus('dialogue', { parent: 'sfx' }). */
  bus(name: string, opts: { parent?: string | null; volume?: number } = {}): Bus {
    let b = this._buses.get(name);
    if (!b) {
      b = new Bus(this.ctx, this._master, name);
      this._buses.set(name, b);
    }
    if (opts.parent !== undefined && opts.parent !== b.parent) {
      if (opts.parent === name) throw new Error("bleep-bloop: a bus cannot be its own parent");
      for (let p = opts.parent; p; p = this._buses.get(p)?.parent ?? null)
        if (p === name) throw new Error(`bleep-bloop: bus "${name}" would create a routing cycle`);
      b._route(opts.parent ? this.bus(opts.parent).node : this._master, opts.parent);
    }
    if (opts.volume !== undefined) b.volume = opts.volume;
    return b;
  }
  get buses(): string[] { return [...this._buses.keys()]; }

  // ---- game parameters (RTPCs) -------------------------------------------------

  /** Set a global game parameter; every playing voice that listens to it is notified. */
  setParam(name: string, value: number): this {
    finite(value, `parameter ${name}`);
    this._params.set(name, value);
    // Children are reached through their parents, so notify root voices only.
    for (const v of this._voices) if (!v._childOfOther) v.setParam(name, value, false);
    return this;
  }
  getParam(name: string): number | undefined { return this._params.get(name); }
  /** Set a named switch state (e.g. setSwitch('surface', 'gravel')) read by switch events. */
  setSwitch(group: string, state: string): this { this._switches.set(group, String(state)); return this; }
  getSwitch(group: string): string | undefined { return this._switches.get(group); }

  // ---- 3-D listener --------------------------------------------------------------

  /** Place the listener (camera / player head). `forward` and `up` are direction vectors. */
  setListener(o: { position?: Vec3; forward?: Vec3; up?: Vec3 }, glide = 0.03): this {
    const l = this.ctx.listener, t = this.ctx.currentTime;
    const next = { ...this._listener, ...o };
    this._listener = next;
    if (l) {
      const set = (p: AudioParam | undefined, v: number) => p?.setTargetAtTime(v, t, glide);
      if (l.positionX) { set(l.positionX, next.position[0]); set(l.positionY, next.position[1]); set(l.positionZ, next.position[2]); }
      else l.setPosition?.(...(next.position as [number, number, number]));
      if (l.forwardX) {
        set(l.forwardX, next.forward[0]); set(l.forwardY, next.forward[1]); set(l.forwardZ, next.forward[2]);
        set(l.upX, next.up[0]); set(l.upY, next.up[1]); set(l.upZ, next.up[2]);
      } else l.setOrientation?.(...(next.forward as [number, number, number]), ...(next.up as [number, number, number]));
    }
    if (o.position) for (const v of this._voices) v._updateFilter();
    return this;
  }
  get listenerPosition(): Vec3 { return this._listener.position; }

  // ---- mix automation ------------------------------------------------------------

  /** Sidechain-style ducking: while anything plays on `by`, lower `target` by `amount` dB. */
  duck(target: string, o: { by: string | string[]; amount?: number; attack?: number; release?: number }): this {
    const triggers = Array.isArray(o.by) ? o.by : [o.by];
    if (triggers.includes(target)) throw new Error("bleep-bloop: a bus cannot duck itself");
    this.bus(target); triggers.forEach(t => this.bus(t));
    this._ducks.push({ target, triggers, gain: dbToGain(-Math.abs(finite(o.amount ?? 9, "duck amount"))), attack: nonnegative(o.attack ?? 0.06, "duck attack"), release: nonnegative(o.release ?? 0.5, "duck release"), until: 0, live: 0 });
    return this;
  }
  /** Remove ducking rules for a target bus (all rules when omitted). */
  unduck(target?: string): this {
    for (const r of this._ducks.filter(r => !target || r.target === target)) {
      const g = this.bus(r.target).duckGain; hold(g, this.ctx.currentTime); g.setTargetAtTime(1, this.ctx.currentTime, 0.05);
    }
    this._ducks = this._ducks.filter(r => target && r.target !== target);
    return this;
  }
  private _engageDucks(v: Voice, bus: string): void {
    for (const r of this._ducks) {
      if (!r.triggers.includes(bus)) continue;
      const g = this.bus(r.target).duckGain, now = this.ctx.currentTime, start = Math.max(now, v._started);
      hold(g, now);
      g.setTargetAtTime(r.gain, start, Math.max(0.001, r.attack / 3));
      const release = () => { if (r.live === 0) g.setTargetAtTime(1, Math.max(this.ctx.currentTime, r.until), Math.max(0.001, r.release / 3)); };
      if (v._live) {
        r.live++;
        v.onStop(() => { r.live--; r.until = Math.max(r.until, this.ctx.currentTime); hold(g, this.ctx.currentTime); release(); });
      } else { r.until = Math.max(r.until, v.until); release(); }
    }
  }
  /** Name a mix state, e.g. defineSnapshot('paused', { music: { volume: .5, lowpass: 900 }, sfx: { volume: .2 } }). */
  defineSnapshot(name: string, buses: Record<string, BusState>): this {
    for (const [bus, state] of Object.entries(buses)) {
      if (state.volume !== undefined) nonnegative(state.volume, `snapshot ${name} ${bus} volume`);
      this.bus(bus);
    }
    this._snapshots.set(name, buses);
    return this;
  }
  /** Transition to a snapshot (or `null` for the neutral mix) over `fade` seconds. */
  snapshot(name: string | null, fade = 0.4): this {
    const state = name === null ? {} : this._snapshots.get(name);
    if (!state) throw new Error(`bleep-bloop: unknown snapshot "${name}"`);
    const t = this.ctx.currentTime;
    for (const [busName, bus] of this._buses) {
      const s = state[busName] ?? {};
      ramp(bus.snapshotGain, s.volume ?? 1, t, fade);
      bus.setLowpass(s.lowpass ?? null, fade); bus.setHighpass(s.highpass ?? null, fade);
    }
    this._activeSnapshot = name;
    return this;
  }
  get activeSnapshot(): string | null { return this._activeSnapshot; }

  // ---- event containers ----------------------------------------------------------

  /** Define a Wwise-style event that resolves to registered sounds at play time. */
  defineEvent(id: string, def: EventDefinition): this {
    if (!id.trim()) throw new Error("bleep-bloop: event id cannot be empty");
    if (!["random", "shuffle", "sequence", "switch", "layer"].includes(def.mode)) throw new Error(`bleep-bloop: unknown event mode "${def.mode}"`);
    if (def.mode === "switch" ? !def.cases || !Object.keys(def.cases).length : !def.sounds?.length) throw new Error(`bleep-bloop: event "${id}" has nothing to play`);
    if (def.weights && def.weights.length !== def.sounds?.length) throw new Error(`bleep-bloop: event "${id}" weights must match sounds`);
    this._events.set(id, { ...def, id, recent: [], bag: [], step: 0 });
    return this;
  }
  hasEvent(id: string): boolean { return this._events.has(id); }
  /** Resolve an event (or plain sound id) to the concrete ids it would play now. Advances container state. */
  resolve(id: string, opts: { switch?: string } = {}, depth = 0): string[] {
    const e = this._events.get(id);
    if (!e) return [id];
    if (depth > 8) throw new Error(`bleep-bloop: event "${id}" nests too deeply`);
    const sounds = e.sounds ?? [];
    let picks: string[];
    switch (e.mode) {
      case "layer": picks = [...sounds]; break;
      case "sequence": picks = [sounds[e.step++ % sounds.length]]; break;
      case "shuffle": {
        if (!e.bag.length) {
          e.bag = [...sounds];
          for (let i = e.bag.length - 1; i > 0; i--) { const j = Math.floor(this._rng() * (i + 1)); [e.bag[i], e.bag[j]] = [e.bag[j], e.bag[i]]; }
          // Never repeat across the bag boundary.
          if (e.bag.length > 1 && e.bag[e.bag.length - 1] === e.recent[0]) [e.bag[0], e.bag[e.bag.length - 1]] = [e.bag[e.bag.length - 1], e.bag[0]];
        }
        const picked = e.bag.pop(); picks = picked === undefined ? [] : [picked]; e.recent = picks; break;
      }
      case "switch": {
        const key = opts.switch ?? (e.param === undefined ? "" : this._switches.get(e.param) ?? String(this.getParam(e.param) ?? ""));
        const chosen = e.cases?.[key] ?? e.default;
        if (!chosen) throw new Error(`bleep-bloop: event "${id}" has no case for "${key}"`);
        picks = [chosen]; break;
      }
      default: {
        const avoid = clamp(Math.round(e.avoidRepeat ?? 2), 0, sounds.length - 1);
        const recent = new Set(e.recent.slice(0, avoid));
        const pool = sounds.map((s, i) => ({ s, w: recent.has(s) ? 0 : nonnegative(e.weights?.[i] ?? 1, "event weight") }));
        const total = pool.reduce((a, p) => a + p.w, 0);
        let r = this._rng() * total, pick = pool.find(p => p.w > 0)?.s ?? sounds[0];
        for (const p of pool) { if (p.w <= 0) continue; if ((r -= p.w) <= 0) { pick = p.s; break; } }
        e.recent = [pick, ...e.recent].slice(0, Math.max(1, avoid));
        picks = [pick];
      }
    }
    return picks.flatMap(p => this.resolve(p, opts, depth + 1));
  }

  private _budget(priority: number, now: number): boolean {
    const active = [...this._voices].filter(v => !v._stopped && !v._childOfOther);
    if (active.length < this.maxVoices) return true;
    // Steal the lowest-priority, most-progressed voice that does not outrank the newcomer.
    const victims = active.filter(v => v._priority <= priority)
      .sort((a, b) => a._priority - b._priority || (a._live === b._live ? 0 : a._live ? 1 : -1) || a._started - b._started);
    if (!victims.length) return false;
    victims[0]._stop(0.03);
    void now; return true;
  }

  /** Stop every playing voice, or only those on one bus: stopAll('music'). */
  stopAll(busName?: string, fade = 0.05): this {
    for (const v of [...this._voices]) {
      if (busName && v._busName !== busName) continue;
      v._stop(fade);
    }
    return this;
  }

  // ---- registry ---------------------------------------------------------------

  /**
   * Register a custom sound.
   *   audio.define('boom', (v, t) => { v.tone(t, { f: 80, f2: 30, dur: 0.4, peak: 0.8 }); });
   *   audio.define('drone', { loop: true, category: 'custom', play: v => v.cadence({ freqs: [55, 82.5], continuous: true }) });
   * Loop sounds either set `loop: true` or use a loop primitive (repeat / sweep /
   * cadence / noiseLoop / jitter) — both keep the handle alive until .stop().
   */
  define(id: string, def: SoundInput): this {
    if (!id.trim()) throw new Error("bleep-bloop: sound id cannot be empty");
    const d = typeof def === "function" ? { play: def } : { ...def };
    if (typeof d.play !== "function")
      throw new Error(`bleep-bloop: define("${id}") needs a play function`);
    if (d.gain !== undefined) nonnegative(d.gain, "preset gain");
    const sound = {
      ...d,
      id,
      category: d.category ?? "custom",
    };
    const previous = this._defs.get(id);
    if (previous) this._soundBuffers?.invalidate(previous);
    this._defs.set(id, sound);
    return this;
  }

  /** Warm reusable timbres before gameplay. Failures are returned for the caller to handle. */
  async prepare(ids: readonly string[], options: VoiceOptions = {}): Promise<Array<{ id: string; error?: Error }>> {
    const cache = this._soundBuffers;
    return Promise.all(ids.map(async id => {
      const definition = this._defs.get(id);
      if (!definition) return { id, error: new Error(`Unknown sound "${id}"`) };
      if (!cache) return { id, error: new Error('Offline sound buffering is unavailable') };
      if (!definition.duration) return { id, error: new Error(`Sound "${id}" requires a duration for buffering`) };
      const results = await Promise.all(Array.from({ length: options.seed === undefined && !definition.loop ? 4 : 1 }, (_, variant) =>
        cache.prepare(this._bufferRequest(definition, options, variant))));
      return { id, error: results.find(result => result.error)?.error };
    }));
  }

  /** Memory and preparation failures, useful when checking a warm-up phase. */
  get soundBufferStats() { return this._soundBuffers?.stats; }

  private _bufferRequest(definition: SoundDefinition, options: VoiceOptions, variant: number): BufferRequest {
    const seed = options.seed ?? ((this._seed ?? 0x5eed) + variant * 104729) >>> 0;
    const vary = options.variation === false ? undefined : { ...definition.variation, ...options.variation };
    const random = randomSource(seed ^ 0xbafe);
    // Bake timbre variation into the finite seed bank so each trigger can reuse it.
    const depth = vary?.depth ? clamp((options.depth ?? 1) + (random() * 2 - 1) * vary.depth, 0, 2) : options.depth;
    const brightness = vary?.brightness ? clamp((options.brightness ?? 1) * (1 + (random() * 2 - 1) * vary.brightness), .25, 2) : options.brightness;
    return { definition, sampleRate: this._bufferSampleRate,
      seed,
      options: { depth, motion: options.motion, brightness,
        params: { ...Object.fromEntries(this._params), ...options.params } } };
  }

  defineAll(obj: Record<string, SoundInput>): this {
    for (const [id, def] of Object.entries(obj)) this.define(id, def);
    return this;
  }

  has(id: string): boolean {
    return this._defs.has(id);
  }

  /** List registered sounds, optionally filtered by category. */
  list(filter?: string | SoundQuery): ListedSound[] {
    const q: SoundQuery = typeof filter === "string" ? { category: filter } : filter ?? {};
    const out: ListedSound[] = [];
    for (const d of this._defs.values()) {
      if (q.category && d.category !== q.category) continue;
      if (q.loop !== undefined && !!d.loop !== q.loop) continue;
      if (q.bus && (d.bus ?? "sfx") !== q.bus) continue;
      if (q.tags?.some(tag => !d.tags?.includes(tag))) continue;
      if (q.query && !`${d.id} ${d.name ?? ""} ${d.hint ?? ""} ${(d.tags ?? []).join(" ")}`.toLowerCase().includes(q.query.toLowerCase())) continue;
      out.push({
        id: d.id,
        category: d.category,
        name: d.name ?? d.id,
        hint: d.hint ?? "",
        loop: !!d.loop,
        bus: d.bus ?? "sfx",
        gain: d.gain ?? 1,
        tags: [...(d.tags ?? [])],
        duration: d.duration,
      });
    }
    return out;
  }

  get categories(): string[] {
    return [...new Set([...this._defs.values()].map((d) => d.category))];
  }

  // ---- playback ---------------------------------------------------------------

  /**
   * Play a registered sound by id, or an inline definition function.
   * @param {string|function} sound
   * @param {object} [opts]
   * @param {number} [opts.volume=1]   this voice only (multiplied with bus & master)
   * @param {number} [opts.pitch=1]    frequency multiplier (0.5 = octave down)
   * @param {number} [opts.pan]        -1..1 stereo position
   * @param {string} [opts.bus='sfx']  mix bus
   * @returns {Handle}
   */
  play(sound: string | SoundPlay, opts: VoiceOptions & { switch?: string } = {}): Handle {
    this.resume();
    if (typeof sound === "string" && this._events.has(sound)) return this._playEvent(sound, opts);
    const def: (Partial<SoundDefinition> & { play: SoundPlay }) | undefined =
      typeof sound === "function" ? { play: sound } : this._defs.get(sound);
    if (!def)
      throw new Error(
        `bleep-bloop: unknown sound "${sound}" — see audio.list()`,
      );
    const id = def.id ?? null, now = this.ctx.currentTime;
    const delay = nonnegative(opts.delay ?? 0, "delay");
    const priority = finite(opts.priority ?? def.priority ?? (def.loop ? 10 : 0), "priority");
    const busName = opts.bus ?? def.bus ?? "sfx";
    // Cooldown: skip retriggers that arrive too fast (e.g. 30 bullets hitting the same wall in one frame).
    if (id && def.cooldown) {
      const last = this._lastTrigger.get(id);
      if (last !== undefined && now + delay - last < def.cooldown) return this._rejected(busName, id);
    }
    // Per-sound instance limit.
    if (id && def.limit !== undefined) {
      const same = [...this._voices].filter(v => v._id === id && !v._stopped).sort((a, b) => a._started - b._started);
      if (same.length >= Math.max(1, def.limit)) {
        if ((def.steal ?? "oldest") === "none") return this._rejected(busName, id);
        (def.steal === "newest" ? same[same.length - 1] : same[0])._stop(0.03);
      }
    }
    if (!this._budget(priority, now)) return this._rejected(busName, id);
    if (id) this._lastTrigger.set(id, now + delay);
    const vary = opts.variation === false ? undefined : { ...def.variation, ...opts.variation };
    const r = () => this._rng() * 2 - 1;
    const pitch = (opts.pitch ?? 1) * (vary?.pitch ? Math.pow(2, r() * vary.pitch / 12) : 1);
    const volume = (opts.volume ?? 1) * (vary?.volume ? dbToGain(-Math.abs(r()) * vary.volume) : 1);
    const pan = vary?.pan && !opts.position ? clamp((opts.pan ?? 0) + r() * vary.pan, -1, 1) : opts.pan;
    const depth = vary?.depth ? clamp((opts.depth ?? 1) + r() * vary.depth, 0, 2) : opts.depth;
    const brightness = vary?.brightness ? clamp((opts.brightness ?? 1) * (1 + r() * vary.brightness), .25, 2) : opts.brightness;
    const v = new Voice(this, this.bus(busName).node, { ...opts, pitch, volume, pan, depth, brightness, seed: opts.seed ?? (this._seed === undefined ? undefined : Math.floor(this._voiceSeed() * 4294967296)) });
    v.setTrim(def.gain ?? 1);
    v._busName = busName; v._id = id ?? undefined; v._priority = priority;
    this._voices.add(v);
    const t = v.now() + 0.005 + delay;
    v._started = t;
    try {
      if (def.loop) v.hold();
      let buffered = false;
      if (this._soundBuffers && def.duration && id) {
        const definition = def as SoundDefinition;
        const variant = this._bufferVariants.get(definition) ?? 0;
        this._bufferVariants.set(definition, (variant + 1) % (def.loop ? 1 : 4));
        const request = this._bufferRequest(definition, opts, variant);
        const ready = this._soundBuffers.get(request);
        if (ready) { playSoundBuffer(v, ready, t, this._soundBuffers, request); buffered = true; }
        else void this._soundBuffers.prepare(request);
      }
      const ctrl = buffered ? undefined : def.play(v, t);
      if (ctrl && typeof ctrl === "object" && "stop" in ctrl && typeof ctrl.stop === "function") {
        v.hold(); v.onStop(() => ctrl.stop());
      }
    } catch (error) { v._stop(0); v._dispose(); throw error; }
    v._autoStop();
    this._engageDucks(v, busName);
    return new Handle(v, { id, loop: v._live });
  }
  private _rejected(busName: string, id: string | null): Handle {
    const v = new Voice(this, this.bus(busName).node, { volume: 0 });
    v._stop(0);
    return new Handle(v, { id, accepted: false });
  }
  private _playEvent(id: string, opts: VoiceOptions & { switch?: string }): Handle {
    const e = this._events.get(id);
    if (!e) throw new Error(`Unknown audio event: ${id}`);
    const ids = this.resolve(id, opts);
    const variation = opts.variation === false ? false : { ...e.variation, ...opts.variation };
    if (ids.length === 1) {
      const h = this.play(ids[0], { ...opts, variation: variation === false ? false : Object.keys(variation).length ? { ...this._defs.get(ids[0])?.variation, ...variation } : undefined });
      return new Handle(h.voice, { id, loop: h.loop, accepted: h.accepted });
    }
    // Layer: one parent voice owns every layer so stop/params/position act on the whole event.
    const parent = new Voice(this, this.bus(opts.bus ?? "sfx").node, { volume: opts.volume ?? 1 });
    parent._busName = opts.bus ?? "sfx"; parent._id = id; parent._childOfOther = false;
    this._voices.add(parent);
    let live = false;
    for (const sid of ids) {
      const h = this.play(sid, { ...opts, volume: 1, variation: variation === false ? false : { ...this._defs.get(sid)?.variation, ...variation } });
      if (!h.accepted) continue;
      parent.adopt(h.voice); h.voice._childOfOther = true; parent._track(h.voice.until);
      if (h.loop) live = true;
      // Re-route the child through the parent so the parent's volume/fades apply.
      h.voice._reroute(parent.dest);
    }
    if (live) parent.hold();
    parent._autoStop();
    return new Handle(parent, { id, loop: live });
  }

  // ---- composition --------------------------------------------------------------

  /** Play a single note: audio.note('C4', { wave: 'triangle', dur: 0.5 }). */
  note(n: Frequency, opts: NoteOptions = {}): Handle {
    const {
      wave = "triangle",
      dur = 0.4,
      peak = 0.35,
      a = 0.004,
      ...voiceOpts
    } = opts;
    return this.play((v, t) => {
      v.tone(t, { f: n, type: wave, dur, peak, a });
    }, {
      bus: "music",
      ...voiceOpts,
    });
  }

  /** Play several notes at once: audio.chord(['C4','E4','G4']). */
  chord(notes: Frequency[], opts: ChordOptions = {}): Handle {
    const {
      wave = "triangle",
      dur = 0.8,
      peak = 0.22,
      a = 0.006,
      spread = 0,
      ...voiceOpts
    } = opts;
    return this.play(
      (v, t) =>
        notes.forEach((n, i) =>
          v.tone(t + i * spread, { f: n, type: wave, dur, peak, a }),
        ),
      { bus: "music", ...voiceOpts },
    );
  }

  /**
   * Play a melody from a pattern string.
   *   Tokens: note names ('C4', 'F#5'), optional ':beats' length ('C4:2'),
   *   '.' or '-' for a one-beat rest ('-:0.5' works too).
   *   audio.melody('C4 E4 G4:2 . C5:2', { bpm: 140, wave: 'square', loop: true })
   * @returns {Handle}
   */
  melody(pattern: string, opts: MelodyOptions = {}): Handle {
    const {
      bpm = 120,
      wave = "triangle",
      peak = 0.32,
      sustain = 0.9,
      a = 0.006,
      loop = false,
      filter = null,
      ...voiceOpts
    } = opts;
    positive(bpm, "bpm"); positive(sustain, "note length ratio");
    if (!pattern.trim()) throw new Error("bleep-bloop: melody cannot be empty");
    const beat = 60 / bpm;
    const events: Array<{ at: number; dur: number; f: string | null }> = [];
    let cursor = 0;
    for (const raw of String(pattern).trim().split(/\s+/)) {
      const parts = raw.split(":");
      if (parts.length > 2) throw new Error(`bleep-bloop: bad melody token "${raw}"`);
      const [tok, beatsStr] = parts;
      const beats = beatsStr === undefined ? 1 : Number(beatsStr);
      if (!Number.isFinite(beats) || beats <= 0)
        throw new Error(`bleep-bloop: bad length in melody token "${raw}"`);
      const rest = tok === "." || tok === "-";
      if (!rest) noteToFreq(tok);
      events.push({ at: cursor, dur: beats * beat, f: rest ? null : tok });
      cursor += beats * beat;
    }
    const total = cursor;
    const playBar = (v: Voice, t: number) => {
      for (const e of events) {
        if (e.f == null) continue;
        v.tone(t + e.at, {
          f: e.f,
          type: wave,
          dur: Math.max(0.03, e.dur * sustain),
          peak,
          a,
          filter,
        });
      }
    };
    return this.play(
      (v, t) => {
        if (loop) v.repeat((tt) => playBar(v, tt), total);
        else playBar(v, t);
      },
      { bus: "music", ...voiceOpts },
    );
  }

  /**
   * Step-sequence registered one-shot sounds (a drum machine).
   *   Steps separated by whitespace; '.' or '-' is a rest; layer with '+':
   *   audio.sequence('kick . snare . kick kick+hat snare .', { bpm: 110, loop: true })
   * @param {string|Array<string|null>} pattern
   * @param {object} [opts] bpm (default 120), stepsPerBeat (default 2), loop, swing 0..0.5
   * @returns {Handle}
   */
  sequence(pattern: string | Array<string | null>, opts: SequenceOptions = {}): Handle {
    const {
      bpm = 120,
      stepsPerBeat = 2,
      loop = false,
      swing = 0,
      ...voiceOpts
    } = opts;
    positive(bpm, "bpm"); positive(stepsPerBeat, "steps per beat");
    if (finite(swing, "swing") < 0 || swing > 0.5) throw new RangeError("bleep-bloop: swing must be between 0 and 0.5");
    if (!pattern.length || (typeof pattern === "string" && !pattern.trim())) throw new Error("bleep-bloop: sequence cannot be empty");
    const stepDur = 60 / bpm / stepsPerBeat;
    const steps = (
      Array.isArray(pattern) ? pattern : String(pattern).trim().split(/\s+/)
    ).map((s) =>
      s == null || s === "." || s === "-" ? [] : String(s).split("+"),
    );
    // validate up front — clearer than silence at runtime
    for (const layer of steps)
      for (const id of layer) {
        const d = this._defs.get(id);
        if (!d)
          throw new Error(
            `bleep-bloop: sequence step "${id}" is not a registered sound`,
          );
        if (d.loop)
          throw new Error(
            `bleep-bloop: sequence step "${id}" is a looping sound — sequences take one-shots only`,
          );
      }
    const total = steps.length * stepDur;
    const playBar = (v: Voice, t: number) => {
      steps.forEach((layer, i) => {
        const off = i % 2 === 1 ? swing * stepDur : 0;
        for (const id of layer) {
          const def = this._defs.get(id);
          if (!def) throw new Error(`Unknown sequence sound: ${id}`);
          const child = new Voice(this, v.dest, { pitch: v.pitch, volume: 1, seed: Math.floor(v.random(0, 4294967296)) });
          child.setTrim(def.gain ?? 1);
          child._busName = v._busName; child._childOfOther = true; this._voices.add(child); v.adopt(child);
          try {
            const ctrl = def.play(child, t + i * stepDur + off);
            if (ctrl && typeof ctrl === "object" && "stop" in ctrl && typeof ctrl.stop === "function") {
              child.onStop(() => ctrl.stop());
              child.hold();
            }
          }
          catch (error) { child._stop(0); child._dispose(); throw error; }
          if (child._live) { child._stop(0); child._dispose(); throw new Error("bleep-bloop: sequence sounds must not create loops"); }
          v._track(child.until); child._autoStop();
          // Parent owns active children only; disposed notes remove themselves from that set.

        }
      });
    };
    return this.play(
      (v, t) => {
        if (loop) v.repeat((tt) => playBar(v, tt), total);
        else playBar(v, t);
      },
      { bus: "music", ...voiceOpts },
    );
  }
}

/** Create a GameAudio instance. See the GameAudio constructor for options. */
export function createAudio(opts: GameAudioOptions = {}): GameAudio {
  return new GameAudio(opts);
}

export { noteToFreq };

export type { FormantOptions, SurfaceOptions } from "./types";
