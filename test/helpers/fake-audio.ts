/** A permissive Web Audio fake for unit tests: every create*() returns a node whose AudioParams
 * record automation. Time only moves when a test sets `ctx.currentTime`.
 */
export class FakeParam {
  value: number;
  events: Array<{ type: string; value: number; time: number }> = [];
  constructor(value = 0) { this.value = value; }
  private push(type: string, value: number, time: number) { this.events.push({ type, value, time }); this.value = value; return this; }
  setValueAtTime(v: number, t: number) { return this.push("set", v, t); }
  linearRampToValueAtTime(v: number, t: number) { return this.push("linear", v, t); }
  exponentialRampToValueAtTime(v: number, t: number) { if (v <= 0) throw new RangeError("exponential ramp to non-positive value"); return this.push("exp", v, t); }
  setTargetAtTime(v: number, t: number) { return this.push("target", v, t); }
  setValueCurveAtTime(values: ArrayLike<number>, t: number) { return this.push("curve", values[values.length - 1] ?? 0, t); }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}

const PARAMS = new Set(["gain", "frequency", "detune", "Q", "pan", "delayTime", "playbackRate", "offset", "threshold", "knee", "ratio", "attack", "release",
  "positionX", "positionY", "positionZ", "orientationX", "orientationY", "orientationZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"]);

export class FakeNode {
  kind: string;
  connections: unknown[] = [];
  started?: number;
  stopped?: number;
  onended: (() => void) | null = null;
  [key: string]: unknown;
  constructor(kind: string) {
    this.kind = kind;
    return new Proxy(this, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (PARAMS.has(prop)) { const p = new FakeParam(prop === "gain" || prop === "playbackRate" ? 1 : 0); target[prop] = p; return p; }
        return undefined;
      },
    });
  }
  connect(node: unknown) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
  start(t = 0) { if (this.started !== undefined) throw new Error("InvalidStateError: start twice"); this.started = t; }
  stop(t = 0) { if (this.started === undefined) throw new Error("InvalidStateError: stop before start"); this.stopped = t; }
  setPeriodicWave() {}
  setPosition() {}
  setOrientation() {}
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  state = "running";
  destination = new FakeNode("destination");
  listener = new FakeNode("listener");
  created: FakeNode[] = [];
  private make(kind: string) { const n = new FakeNode(kind); this.created.push(n); return n; }
  createGain() { return this.make("gain"); }
  createOscillator() { return this.make("oscillator"); }
  createBufferSource() { return this.make("buffer-source"); }
  createConstantSource() { return this.make("constant"); }
  createBiquadFilter() { return this.make("biquad"); }
  createStereoPanner() { return this.make("stereo-panner"); }
  createPanner() { return this.make("panner"); }
  createDelay() { return this.make("delay"); }
  createConvolver() { return this.make("convolver"); }
  createWaveShaper() { return this.make("waveshaper"); }
  createDynamicsCompressor() { return this.make("compressor"); }
  createAnalyser() { return this.make("analyser"); }
  createPeriodicWave() { return {}; }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c] };
  }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  count(kind: string) { return this.created.filter(n => n.kind === kind).length; }
}

/** Offline flavour: the engine scheduler queues tasks against audio time; call `advance()` to run them. */
export class FakeOfflineContext extends FakeAudioContext {
  startRendering() { return Promise.resolve(this.createBuffer(2, 1, this.sampleRate)); }
}

export const asContext = (c: FakeAudioContext) => c as unknown as AudioContext;
