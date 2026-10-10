/** Original procedural instruments and spaces. No recordings, downloads or worklets. */
import { clamp, finite, nonnegative, positive, randomSource } from "./dsp";
import { hz } from "./notes";
import type { Voice } from "./voice";
import type { BloomOptions, CloudOptions, MaterialVoice, ResonatorOptions, SpaceOptions, StringOptions } from "./types";

type Context = AudioContext | OfflineAudioContext;
const rooms = new WeakMap<Context, Map<string, AudioBuffer>>();
const TAU = Math.PI * 2;
/** Live contexts advance while JS builds a graph. Offline contexts do not.
 * Native engines may clamp a past curve onset, so schedule live curves ahead. */
function safeStart(v: Voice, t: number): number {
  return Math.max(nonnegative(t, "start time"), v.now() + ("startRendering" in v.ctx ? 0 : .025));
}

/** An eight-line, damped Householder FDN, rendered once into a stereo FIR.
 * Four input allpasses build density before the late field. Orthogonal output
 * taps decorrelate the sides without polarity-inverting the dry sound.
 * This is a designed space, not a measured room or a physical-room simulation.
 */
function roomImpulse(ctx: Context, decay: number, damping: number, size: number): AudioBuffer {
  const key = [decay, damping, size].join(":");
  let cache = rooms.get(ctx);
  if (!cache) { cache = new Map(); rooms.set(ctx, cache); }
  const old = cache.get(key); if (old) return old;
  const sr = ctx.sampleRate, n = Math.ceil((decay * 1.12 + .12) * sr);
  const buffer = ctx.createBuffer(2, n, sr), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const lengths = [1493, 1601, 1867, 2053, 2251, 2399, 2671, 2917].map(x => Math.max(31, Math.round(x * sr / 48000 * size)));
  const lines = lengths.map(x => new Float64Array(x)), heads = new Int32Array(8), low = new Float64Array(8), values = new Float64Array(8);
  const gains = lengths.map(x => Math.exp(-6.907755 * x / sr / decay));
  const damp = Math.exp(-TAU * damping / sr);
  const ap = [113, 337, 1051, 1777].map(x => new Float64Array(Math.max(7, Math.round(x * sr / 48000 * size))));
  const apHeads = new Int32Array(4), signsL = [1, 1, -1, 1, -1, -1, 1, -1], signsR = [1, -1, 1, 1, 1, -1, -1, -1];
  for (let i = 0; i < n; i++) {
    let excitation = i === 0 ? 1 : 0;
    for (let a = 0; a < 4; a++) {
      const delayed = ap[a][apHeads[a]], out = delayed - .67 * excitation;
      ap[a][apHeads[a]] = excitation + .67 * out;
      if (++apHeads[a] === ap[a].length) apHeads[a] = 0;
      excitation = out;
    }
    let sum = 0, l = 0, r = 0;
    for (let j = 0; j < 8; j++) {
      const raw = lines[j][heads[j]];
      low[j] = raw * (1 - damp) + low[j] * damp;
      values[j] = low[j] * gains[j]; sum += values[j];
      l += raw * signsL[j]; r += raw * signsR[j];
    }
    left[i] = l * .353553; right[i] = r * .353553;
    for (let j = 0; j < 8; j++) {
      lines[j][heads[j]] = values[j] - sum * .25 + excitation * (j % 3 === 0 ? -.353553 : .353553);
      if (++heads[j] === lengths[j]) heads[j] = 0;
    }
  }
  // Equal-energy normalization is explicit, so browser-specific IR normalization
  // cannot change a patch's wet level. Fade the FIR boundary, not the dry source.
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, (n - 1 - i) / (sr * .08));
    left[i] *= fade; right[i] *= fade;
    energy += (left[i] ** 2 + right[i] ** 2) * .5;
  }
  const norm = .85 / Math.sqrt(Math.max(energy, 1e-20));
  for (let i = 0; i < n; i++) { left[i] *= norm; right[i] *= norm; }
  // Bounded per-context cache; active ConvolverNodes keep their own references.
  const oldest = cache.keys().next().value;
  if (cache.size >= 8 && oldest !== undefined) cache.delete(oldest);
  cache.set(key, buffer); return buffer;
}

export function makeSpace(v: Voice, options: SpaceOptions, output: AudioNode): { input: AudioNode; nodes: AudioNode[]; tail: number } {
  const ctx = v.ctx;
  const wet = clamp(nonnegative(options.wet ?? .45, "space wet") * v.depth, 0, 1.5);
  const decay = clamp(positive(options.decay ?? 3.2, "space decay"), .2, 8);
  const damping = clamp(positive(options.damping ?? 4200, "space damping"), 500, ctx.sampleRate * .4);
  const size = clamp(positive(options.size ?? 1, "space size"), .3, 2.5);
  const pre = clamp(nonnegative(options.preDelay ?? .026, "space pre-delay"), 0, .2);
  const echo = clamp(nonnegative(options.echo ?? 0, "echo level"), 0, .6);
  const delayTime = clamp(positive(options.echoTime ?? .38, "echo time"), .05, 1.4);
  const dry = clamp(nonnegative(options.dry ?? 1, "dry level"), 0, 1.5);
  const input = ctx.createGain(), direct = ctx.createGain(); direct.gain.value = dry;
  input.connect(direct); direct.connect(output);
  const nodes: AudioNode[] = [input, direct];
  const early = clamp(nonnegative(options.early ?? 0, "early level") * v.depth, 0, .6);
  let earlyTail = 0;
  if (early) {
    [.0071, .0137, .0259, .0391].forEach((seconds, i) => {
      const delay = ctx.createDelay(.2), gain = ctx.createGain(), filter = ctx.createBiquadFilter(), pan = ctx.createStereoPanner();
      delay.delayTime.value = seconds * size;
      gain.gain.value = early * [.65,.5,.32,.2][i];
      filter.type = "lowpass"; filter.frequency.value = damping / (1 + i * .25); filter.Q.value = .5;
      pan.pan.value = [-.42,.36,.66,-.55][i];
      input.connect(delay); delay.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(output);
      nodes.push(delay,gain,filter,pan); earlyTail = seconds * size + .025;
    });
  }
  if (!wet) return { input, nodes, tail: earlyTail };
  const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), predelay = ctx.createDelay(.21), convolver = ctx.createConvolver(), returnGain = ctx.createGain();
  hp.type = "highpass"; hp.frequency.value = clamp(positive(options.lowCut ?? 140, "space low cut"), 30, 1600); hp.Q.value = .55;
  lp.type = "lowpass"; lp.frequency.value = damping * 1.3; lp.Q.value = .55;
  predelay.delayTime.value = pre;
  convolver.normalize = false; convolver.buffer = roomImpulse(ctx, decay, damping, size);
  returnGain.gain.value = wet;
  input.connect(hp); hp.connect(predelay); predelay.connect(convolver); convolver.connect(lp); lp.connect(returnGain); returnGain.connect(output);
  nodes.push(hp, lp, predelay, convolver, returnGain);
  if (echo > 0) {
    // Finite, progressively darker stereo echoes. No live feedback graph to leak.
    for (let i = 1; i <= 4; i++) {
      const delay = ctx.createDelay(6), gain = ctx.createGain(), filter = ctx.createBiquadFilter(), pan = ctx.createStereoPanner();
      delay.delayTime.value = delayTime * i * (i % 2 ? 1 : 1.027);
      gain.gain.value = echo * Math.pow(.48, i - 1); filter.type = "lowpass"; filter.frequency.value = damping / (1 + i * .35); filter.Q.value = .5;
      pan.pan.value = (i % 2 ? -.65 : .65);
      input.connect(delay); delay.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(predelay);
      nodes.push(delay, gain, filter, pan);
    }
  }
  return { input, nodes, tail: convolver.buffer.duration + pre + (echo ? delayTime * 4.108 : 0) };
}

function route(v: Voice, node: AudioNode, pan: number): StereoPannerNode {
  const p = v.ctx.createStereoPanner(); p.pan.value = clamp(finite(pan, "layer pan"), -1, 1); node.connect(p); p.connect(v.dest); return p;
}
function shape(param: AudioParam, t: number, dur: number, peak: number, attack: number, release: number, sustain = .72): void {
  const curve = new Float32Array(512), a = clamp(attack / dur, .002, .8), r = clamp(release / dur, .01, 1 - a);
  for (let i = 0; i < curve.length; i++) {
    const x = i / (curve.length - 1);
    let y = x < a ? Math.pow(Math.sin(x / a * Math.PI / 2), 1.35) : sustain + (1 - sustain) * Math.exp(-6 * (x - a) / Math.max(.01, 1 - a));
    if (x > 1 - r) y *= Math.pow(Math.cos((x - (1 - r)) / r * Math.PI / 2), 2);
    curve[i] = peak * y;
  }
  curve[0] = 0; curve[curve.length - 1] = 0;
  param.setValueAtTime(0, t); param.setValueCurveAtTime(curve, t, dur);
  // The curve already ends at zero. A redundant end event can overlap a
  // native engine's clamped curve when graph construction made its onset late.
}

/** Smooth spectral sources, not detuned saws with a reverb strapped on. */
function spectrum(ctx: Context, kind: NonNullable<BloomOptions["timbre"]>, phase: number, f: number): PeriodicWave {
  const re = new Float32Array(33), im = new Float32Array(33);
  for (let h = 1; h < re.length; h++) {
    if (h * f >= ctx.sampleRate * .43) break;
    let amp: number;
    if (kind === "glass") amp = (h === 1 ? 1 : h === 2 ? .32 : h === 3 ? .1 : h === 5 ? .07 : .012) / Math.pow(h, .4);
    else if (kind === "bowed") amp = Math.pow(h, -1.25) * Math.exp(-h / 18) * (h % 2 ? 1 : .8);
    else if (kind === "brass") amp = Math.pow(h, -1.12) * Math.exp(-h / 11);
    else if (kind === "choir") {
      const formant = (center: number, spread: number) => Math.exp(-.5 * ((h * f - center) / spread) ** 2);
      amp = (.16 + 1.5 * formant(640, 160) + .75 * formant(1220, 220) + .2 * formant(2450, 320)) / Math.pow(h, 1.15);
    } else amp = Math.pow(h, -1.9) * Math.exp(-h / 9) * (h % 2 ? 1 : .48);
    re[h] = amp * Math.sin(phase * h); im[h] = amp * Math.cos(phase * h);
  }
  return ctx.createPeriodicWave(re, im, { disableNormalization: false });
}

export function bloom(v: Voice, t0: number, o: BloomOptions): number {
  if (v._stopped) return t0;
  const ctx = v.ctx, t = safeStart(v, t0);
  let latestEnd = t;
  const dur = positive(o.dur ?? 4, "bloom duration"), f = clamp(hz(o.f) * v.pitch, 12, ctx.sampleRate * .2);
  const peak = nonnegative(o.peak ?? .28, "bloom peak"), attack = nonnegative(o.attack ?? .5, "bloom attack"), release = nonnegative(o.release ?? dur * .65, "bloom release");
  const unison = clamp(Math.round(positive(o.unison ?? 3, "unison")), 1, 5), width = clamp(nonnegative(o.width ?? .65, "width"), 0, 1);
  const spread = clamp(nonnegative(o.detune ?? 5.5, "unison detune"), 0, 40), motion = v.motion;
  const cutoff = clamp(positive(o.cutoff ?? 1900, "bloom cutoff") * v.brightness, 80, ctx.sampleRate * .43);
  const endCutoff = clamp(positive(o.cutoffEnd ?? cutoff * .6, "bloom end cutoff") * (o.cutoffEnd === undefined ? 1 : v.brightness), 60, ctx.sampleRate * .43);
  const f2 = o.f2 === undefined ? f : clamp(hz(o.f2) * v.pitch, 12, ctx.sampleRate * .2);
  for (let j = 0; j < unison; j++) {
    const position = unison === 1 ? 0 : j / (unison - 1) * 2 - 1;
    const osc = ctx.createOscillator(), amp = ctx.createGain(), filter = ctx.createBiquadFilter();
    osc.setPeriodicWave(spectrum(ctx, o.timbre ?? "velvet", v.random(0, TAU), Math.max(f, f2)));
    const at = safeStart(v, t);
    latestEnd = Math.max(latestEnd, at + dur);
    osc.frequency.setValueAtTime(f, at); osc.frequency.exponentialRampToValueAtTime(f2, at + dur * .8);
    osc.detune.value = position * spread + v.random(-.8, .8);
    filter.type = "lowpass"; filter.Q.value = .55;
    filter.frequency.setValueAtTime(Math.max(80, cutoff * .52), at);
    filter.frequency.exponentialRampToValueAtTime(cutoff, at + Math.min(dur * .6, Math.max(.025, attack * 1.6)));
    filter.frequency.exponentialRampToValueAtTime(endCutoff, at + dur);
    shape(amp.gain, at, dur, peak * .75 / Math.sqrt(unison), attack, release, o.sustain ?? .74);
    osc.connect(filter); filter.connect(amp);
    const pan = route(v, amp, (o.pan ?? 0) + position * width * .6);
    v.own(osc, filter, amp, pan);
    if (motion > 0) {
      const drift = ctx.createOscillator(), depth = ctx.createGain();
      drift.frequency.value = v.random(.09, .28); depth.gain.value = (o.drift ?? 3.5) * motion;
      drift.connect(depth); depth.connect(osc.detune); v.own(drift, depth); drift.start(at); drift.stop(at + dur + .006);
      const breath = ctx.createOscillator(), breathDepth = ctx.createGain();
      breath.frequency.value = v.random(.28, .65); breathDepth.gain.value = .04 * motion;
      // An offset gain modulates amplitude without competing with its envelope.
      const breathing = ctx.createGain(); breathing.gain.value = 1 - .04 * motion;
      amp.disconnect(); amp.connect(breathing); breathing.connect(pan);
      breath.connect(breathDepth); breathDepth.connect(breathing.gain);
      v.own(breath, breathDepth, breathing); breath.start(at); breath.stop(at + dur + .006);
    }
    osc.start(at); osc.stop(at + dur + .008);
  }
  v._track(latestEnd + .015); return latestEnd;
}

const MODES: Record<MaterialVoice, readonly number[]> = {
  bowl: [1, 2.71, 5.18, 8.37, 12.22],
  bronze: [1, 1.506, 2.014, 2.553, 3.19, 4.08, 5.43],
  glass: [1, 2.32, 4.25, 6.63, 9.48],
  stone: [1, 1.593, 2.361, 3.447, 4.932, 6.18],
  wood: [1, 2.756, 5.404, 8.933],
  tine: [1, 2, 3.996, 6.04, 8.12],
  ceramic: [1, 1.998, 3.173, 4.828, 6.63],
  wire: [1, 2.003, 3.012, 4.035, 5.083, 6.16, 7.28, 8.44],
};

export function resonate(v: Voice, t0: number, o: ResonatorOptions): number {
  if (v._stopped) return t0;
  const ctx = v.ctx, t = safeStart(v, t0);
  let latestEnd = t;
  const f = hz(o.f) * v.pitch, dur = positive(o.dur ?? 3.5, "resonator duration"), peak = nonnegative(o.peak ?? .4, "resonator peak");
  const material = o.material ?? "bowl", modes = o.modes ?? MODES[material];
  if (!modes?.length || modes.length > 24) throw new RangeError("bleep-bloop: resonator needs 1–24 modes");
  const strike = clamp(nonnegative(o.strike ?? .45, "strike"), 0, 1), bloomTime = nonnegative(o.bloom ?? .012, "resonator bloom");
  const weights = modes.map((r, i) => { positive(r, "mode ratio"); return i === 0 ? 1 : Math.pow(.48 + strike * .2, i) * (i === 1 ? 1.1 : 1); });
  const norm = Math.sqrt(weights.reduce((sum, x) => sum + x * x, 0));
  modes.forEach((ratio, i) => {
    const freq = f * ratio; if (freq >= ctx.sampleRate * .42) return;
    const md = Math.max(.009, dur / (1 + i * (material === "wood" ? .9 : .35)));
    const osc = ctx.createOscillator(), amp = ctx.createGain(); osc.frequency.value = freq;
    osc.detune.value = v.random(-.75, .75) * v.motion;
    const curve = new Float32Array(512), a = Math.min(md * .25, bloomTime * (1 + i * .22));
    for (let k = 0; k < curve.length; k++) {
      const x = k / (curve.length - 1) * md;
      const onset = Math.min(1, x / Math.max(.0018, a));
      // Two rates: short energy transfer from the strike, then the ringing body.
      const decay = .64 * Math.exp(-7.4 * x / md) + .36 * Math.exp(-3.9 * x / md);
      curve[k] = peak * weights[i] / norm * .86 * Math.sin(onset * Math.PI / 2) * decay * Math.min(1, (md - x) / Math.min(.055, md * .23));
    }
    curve[0] = 0; curve[511] = 0;
    const at = safeStart(v, t); latestEnd = Math.max(latestEnd, at + md);
    amp.gain.setValueAtTime(0, at); amp.gain.setValueCurveAtTime(curve, at, md);
    osc.connect(amp); const pan = route(v, amp, (o.pan ?? 0) + (i % 2 ? -.08 : .08) * (o.width ?? .6));
    v.own(osc, amp, pan); osc.start(at); osc.stop(at + md + .008);
  });
  if (strike > 0) v.noise(t, { color: "pink", type: "bp", freq: clamp(f * 5, 450, 3400) * v.brightness, Q: .65, dur: .018 + (1 - strike) * .025, peak: peak * strike * .16, attack: .001, pan: o.pan });
  v._track(Math.max(t + dur, latestEnd) + .015); return latestEnd;
}

/** Fractional-delay, damped Karplus–Strong string. The noise only excites the
 * initial period; subsequent samples come from the string's feedback state. */
export function string(v: Voice, t0: number, o: StringOptions): number {
  if (v._stopped) return t0;
  const ctx = v.ctx; nonnegative(t0, "start time");
  const f = clamp(hz(o.f) * v.pitch, 24, ctx.sampleRate * .12), dur = positive(o.dur ?? 3.2, "string duration"), peak = nonnegative(o.peak ?? .4, "string peak");
  const bright = clamp((o.brightness ?? .65) * v.brightness, .05, 1), damping = .52 - bright * .32;
  const delay = ctx.sampleRate / f - damping, length = Math.ceil(delay) + 2;
  const ring = new Float64Array(length), excitation = new Float64Array(length), pick = clamp(o.pick ?? .22, .05, .48);
  const rng = randomSource(Math.floor(v.random(0, 4294967296)));
  for (let i = 0; i < length; i++) excitation[i] = rng() * 2 - 1;
  let mean = 0;
  for (let i = 0; i < length; i++) { ring[i] = excitation[i] - excitation[(i + Math.round(length * pick)) % length]; mean += ring[i]; }
  mean /= length; for (let i = 0; i < length; i++) ring[i] -= mean;
  const buffer = ctx.createBuffer(1, Math.ceil(dur * ctx.sampleRate), ctx.sampleRate), data = buffer.getChannelData(0);
  const feedback = Math.exp(-6.907755 / (dur * f));
  let write = 0, previous = 0, max = 0;
  for (let i = 0; i < data.length; i++) {
    let read = write - delay; while (read < 0) read += length;
    const k = Math.floor(read), mix = read - k;
    const x = ring[k] * (1 - mix) + ring[(k + 1) % length] * mix;
    const filtered = (1 - damping) * x + damping * previous; previous = x;
    ring[write] = filtered * feedback; if (++write === length) write = 0;
    const envelope = Math.min(1, i / (ctx.sampleRate * .003)) * Math.min(1, (data.length - 1 - i) / (ctx.sampleRate * .07));
    data[i] = filtered * envelope; max = Math.max(max, Math.abs(data[i]));
  }
  const scale = peak * .9 / Math.max(max, 1e-9); for (let i = 0; i < data.length; i++) data[i] *= scale;
  const t = safeStart(v, t0);
  const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(); source.buffer = buffer;
  filter.type = "lowpass"; filter.frequency.value = clamp((1800 + bright * 7000), 100, ctx.sampleRate * .42); filter.Q.value = .55;
  source.connect(filter); const pan = route(v, filter, o.pan ?? 0); v.own(source, filter, pan); source.start(t); source.stop(t + dur + .008);
  v._track(t + dur + .015); return t + dur;
}

/** Overlapping Hann-like grains drawn from a harmonic palette, not random bleeps. */
export function cloud(v: Voice, t: number, o: CloudOptions): number {
  if (v._stopped) return t;
  const dur = positive(o.dur ?? 6, "cloud duration"), density = clamp(positive(o.density ?? 2.5, "cloud density"), .2, 12), peak = nonnegative(o.peak ?? .22, "cloud peak");
  if (!o.notes.length || o.notes.length > 32) throw new RangeError("bleep-bloop: cloud needs 1–32 pitches");
  o.notes.forEach(hz);
  const count = Math.ceil(dur * density), grain = clamp(positive(o.grain ?? 1.25, "grain length"), .12, 4);
  for (let i = 0; i < count; i++) {
    const at = i / count * dur, progress = at / dur, f = o.notes[Math.floor(v.random(0, o.notes.length))];
    const level = peak * (.2 + .8 * Math.pow(Math.sin(Math.PI * progress), .7)) / Math.sqrt(Math.max(1, density * grain));
    bloom(v, t + at, { f, dur: grain * v.random(.82, 1.15), peak: level, attack: grain * .46, release: grain * .52, unison: 1,
      timbre: o.timbre ?? "glass", cutoff: o.cutoff ?? 3000, cutoffEnd: (o.cutoff ?? 3000) * .5,
      pan: v.random(-.86, .86) * (o.width ?? 1), drift: 5, sustain: 1 });
  }
  return t + dur + grain * 1.15;
}
