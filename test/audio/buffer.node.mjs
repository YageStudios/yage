import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../../.audio-build/engine.js';
import { SoundBufferCache } from '../../.audio-build/buffer-cache.js';
import { renderSoundBuffer } from '../../.audio-build/buffer-render.js';
import { FakeAudioContext } from '../../.audio-build/helpers/fake-audio.js';

const MEBIBYTE = 1024 * 1024;
class TestOfflineAudioContext extends FakeAudioContext {
  static instances = [];
  constructor(_channels, length, sampleRate) {
    super(); this.length = length; this.sampleRate = sampleRate;
    TestOfflineAudioContext.instances.push(this); this.suspendTimes = []; this.resumeCount = 0;
  }
  suspend(at = this.currentTime) { this.currentTime = at; this.suspendTimes.push(at); return Promise.resolve(); }
  resume() { this.resumeCount++; return Promise.resolve(); }
  startRendering() { return Promise.resolve(this.createBuffer(2, this.length, this.sampleRate)); }
}
const setOffline = () => { globalThis.OfflineAudioContext = TestOfflineAudioContext; TestOfflineAudioContext.instances = []; };
const clearOffline = () => { delete globalThis.OfflineAudioContext; };
function makeSound(length = 480, channels = 1) {
  return { buffer: { length, numberOfChannels: channels, sampleRate: 48_000, duration: length / 48_000 }, loop: false, parameters: [] };
}
function request(overrides = {}) {
  return { definition: { play() {}, duration: 0.01 }, options: {}, sampleRate: 48_000, seed: 1, ...overrides };
}
function setup(options = {}) {
  const context = new FakeAudioContext();
  return { context, audio: new GameAudio({ context, ...options }) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cache deduplicates pending renders and normalizes parameters in its key', async () => {
  let resolveRender;
  const sound = makeSound(); let renders = 0;
  const cache = new SoundBufferCache(() => { renders++; return new Promise(resolve => { resolveRender = resolve; }); });
  const req = request({ options: { params: { wind: 0.25, thrust: 0.75 } } });
  const first = cache.prepare(req), concurrent = cache.prepare({ ...req, options: { ...req.options } });
  assert.equal(concurrent, first);
  await tick(); assert.equal(renders, 1); resolveRender(sound);
  assert.deepEqual(await first, { sound });
  assert.equal(cache.get(req), sound);
  await cache.prepare({ ...req, options: { params: { thrust: 0.75, wind: 0.25 } } });
  assert.equal(renders, 1);
  for (const other of [
    { ...req, seed: 2 }, { ...req, sampleRate: 44_100 },
    { ...req, options: { ...req.options, depth: 1.5 } },
    { ...req, options: { ...req.options, motion: 1.5 } },
    { ...req, options: { ...req.options, brightness: 1.5 } },
    { ...req, options: { params: { thrust: 0.8, wind: 0.25 } } },
  ]) {
    const p = cache.prepare(other); await tick(); resolveRender(sound); await p;
  }
  assert.equal(renders, 7);
});

test('cache ignores playback options, invalidates replaced definitions, and returns render errors', async () => {
  let renders = 0; const failure = new Error('offline render failed');
  const cache = new SoundBufferCache(async () => { renders++; if (renders === 1) throw failure; return makeSound(); });
  const req = request({ options: { depth: 1, motion: 1, brightness: 1, params: { thrust: 0.5 } } });
  assert.deepEqual(await cache.prepare(req), { error: failure });
  assert.deepEqual(cache.stats.errors, [failure]);
  cache.invalidate(req.definition);
  await cache.prepare(req);
  await cache.prepare({ ...req, options: { ...req.options, volume: 0.25, pitch: 1.2, pan: -0.5, position: [12, 0, -9] } });
  assert.equal(renders, 2);
  cache.invalidate(req.definition);
  assert.equal(cache.get(req), undefined);
  assert.equal(cache.stats.entries, 0);
});

test('cache discards pending invalidated or disposed work and rejects later requests after disposal', async () => {
  let resolveRender;
  const cache = new SoundBufferCache(() => new Promise(resolve => { resolveRender = resolve; }));
  const req = request(), pending = cache.prepare(req);
  await tick(); cache.invalidate(req.definition); resolveRender(makeSound());
  assert.match((await pending).error.message, /invalidated/);
  assert.equal(cache.get(req), undefined);

  let finish;
  const disposed = new SoundBufferCache(() => new Promise(resolve => { finish = resolve; }));
  const late = disposed.prepare(req); await tick(); disposed.dispose(); finish(makeSound());
  assert.match((await late).error.message, /invalidated/);
  assert.match((await disposed.prepare(req)).error.message, /disposed/);
  assert.deepEqual(disposed.stats, { bytes: 0, entries: 0, errors: [] });
});

test('cache evicts least-recently-used buffers within its default budget and skips oversized buffers', async () => {
  const cache = new SoundBufferCache(async () => makeSound(8 * MEBIBYTE, 1));
  const first = request({ seed: 1 }), second = request({ seed: 2 }), third = request({ seed: 3 });
  await cache.prepare(first); await cache.prepare(second); assert.ok(cache.get(first)); await cache.prepare(third);
  assert.equal(cache.stats.bytes, 64 * MEBIBYTE);
  assert.equal(cache.get(second), undefined); assert.ok(cache.get(first)); assert.ok(cache.get(third));
  const tooLarge = new SoundBufferCache(async () => makeSound(16 * MEBIBYTE + 1, 1));
  const result = await tooLarge.prepare(request());
  assert.ok(result.sound); assert.equal(tooLarge.stats.entries, 0);
  await tooLarge.prepare(request()); assert.equal(tooLarge.stats.entries, 0);
});

test('prepare warms finite one-shot seed banks but just one variant per loop and honors 16 kHz', async () => {
  setOffline();
  const { audio } = setup({ sampleRate: 16_000, seed: 41 });
  audio.define('hit', { duration: 0.1, play: (voice, at) => voice.tone(at, { f: 440, dur: 0.1 }) });
  audio.define('bed', { duration: 0.1, loop: true, play: voice => voice.tone(0, { f: 110, dur: 0.1 }) });
  assert.equal((await audio.prepare(['hit']))[0].error, undefined);
  assert.equal((await audio.prepare(['bed']))[0].error, undefined);
  assert.equal(audio.soundBufferStats.entries, 5);
  assert.equal(TestOfflineAudioContext.instances.length, 5);
  assert.ok(TestOfflineAudioContext.instances.every(context => context.sampleRate === 16_000));
  await audio.dispose(); clearOffline();

  setOffline();
  const explicit = setup({ sampleRate: 16_000 });
  explicit.audio.define('hit', { duration: 0.1, play: (voice, at) => voice.tone(at, { f: 440, dur: 0.1 }) });
  await explicit.audio.prepare(['hit'], { seed: 99 });
  assert.equal(explicit.audio.soundBufferStats.entries, 1);
  await explicit.audio.dispose(); clearOffline();
});

test('prepare reports missing, undurationed, and unavailable sounds per id', async () => {
  setOffline();
  const { audio } = setup(); audio.define('unbounded', voice => voice.tone(0, { f: 440 }));
  const result = await audio.prepare(['missing', 'unbounded']);
  assert.deepEqual(result.map(item => [item.id, item.error.message]), [
    ['missing', 'Unknown sound "missing"'],
    ['unbounded', 'Sound "unbounded" requires a duration for buffering'],
  ]);
  await audio.dispose(); clearOffline();

  const fallback = setup(); fallback.audio.define('hit', { duration: 0.1, play() {} });
  assert.match((await fallback.audio.prepare(['hit']))[0].error.message, /unavailable/);
  await fallback.audio.dispose();
});

test('prepared playback uses one buffer source, preserves trim and pitch, and finite timbre variation selects warmed PCM', async () => {
  setOffline();
  const { audio, context } = setup({ sampleRate: 16_000, seed: 20 });
  audio.define('hit', { duration: 0.1, gain: 0.4, variation: { depth: 0.2, brightness: 0.2 }, play: (voice, at) => voice.tone(at, { f: 440, dur: 0.1 }) });
  await audio.prepare(['hit']);
  const renderCount = TestOfflineAudioContext.instances.length;
  const initial = { oscillator: context.count('oscillator'), filter: context.count('biquad'), convolver: context.count('convolver') };
  const handles = Array.from({ length: 4 }, () => audio.play('hit', { volume: 0.5, pitch: 1.75 }));
  assert.ok(handles.every(handle => handle.accepted));
  assert.equal(context.count('buffer-source'), 4);
  assert.equal(TestOfflineAudioContext.instances.length, renderCount, 'each finite timbre variation reuses the warmed bank');
  assert.equal(context.count('oscillator'), initial.oscillator);
  assert.equal(context.count('biquad'), initial.filter);
  assert.equal(context.count('convolver'), initial.convolver);
  assert.equal(context.created.filter(node => node.kind === 'buffer-source').at(-1).playbackRate.value, 1.75);
  assert.equal(new Set(context.created.filter(node => node.kind === 'buffer-source').map(node => node.buffer)).size, 4);
  assert.ok([...audio._voices].every(voice => Math.abs(voice._gain.gain.value - 0.2) < 1e-9));
  await audio.dispose(); clearOffline();
});

test('one-shot RTPC replacement keeps elapsed position and skips a bank that finishes late', async () => {
  setOffline(); const { audio, context } = setup();
  audio.define('one-shot', { duration: 0.1, play: voice => {
    voice.onParam('mix', () => undefined); voice.tone(0, { f: 440, dur: 0.1 });
  } });
  await audio.prepare(['one-shot'], { seed: 8, params: { mix: 0 } });
  const handle = audio.play('one-shot', { seed: 8, params: { mix: 0 } });
  context.currentTime = 0.03;
  const create = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const source = create(); const start = source.start.bind(source); source.startCalls = [];
    source.start = (...args) => { source.startCalls.push(args); return start(...args); };
    return source;
  };
  handle.setParam('mix', 0.5); await tick(); await tick();
  assert.equal(context.count('buffer-source'), 2);
  const replacement = context.created.filter(node => node.kind === 'buffer-source')[1];
  assert.ok(Math.abs(replacement.startCalls[0][1] - 0.03) < 1e-8);

  context.currentTime = 0.2;
  handle.setParam('mix', 0.75); await tick(); await tick();
  assert.equal(context.count('buffer-source'), 2, 'completed one-shots do not restart from a late render');
  handle.stop(0); await audio.dispose(); clearOffline();
});

test('definition replacement invalidates prepared PCM', async () => {
  setOffline(); const { audio } = setup({ seed: 10 });
  audio.define('hit', { duration: 0.1, play: (voice, at) => voice.tone(at, { f: 440, dur: 0.1 }) });
  await audio.prepare(['hit']); assert.equal(audio.soundBufferStats.entries, 4);
  audio.define('hit', { duration: 0.2, play: (voice, at) => voice.tone(at, { f: 220, dur: 0.2 }) });
  assert.equal(audio.soundBufferStats.entries, 0);
  await audio.prepare(['hit']); assert.equal(audio.soundBufferStats.entries, 4);
  assert.equal(TestOfflineAudioContext.instances.length, 8);
  await audio.dispose(); clearOffline();
});

test('loop banks no-op on equal RTPC, crossfade changed RTPC at the current phase, and ignore late stopped results', async () => {
  setOffline(); const { audio, context } = setup({ sampleRate: 16_000 });
  audio.define('loop', { duration: 0.2, loop: true, play: voice => {
    voice.onParam('blend', () => undefined); voice.tone(0, { f: 110, dur: 0.2 });
  } });
  await audio.prepare(['loop'], { seed: 5, params: { blend: 0 } });
  const handle = audio.play('loop', { seed: 5, volume: 0.6, params: { blend: 0 } });
  handle.setParam('blend', 0); await tick(); assert.equal(context.count('buffer-source'), 1);
  context.currentTime = 0.755;
  const create = context.createBufferSource.bind(context);
  context.createBufferSource = () => { const source = create(); const start = source.start.bind(source); source.startCalls = []; source.start = (...args) => { source.startCalls.push(args); return start(...args); }; return source; };
  handle.setParam('blend', 1);
  await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.count('buffer-source'), 2);
  const replacement = context.created.filter(node => node.kind === 'buffer-source')[1];
  assert.ok(Math.abs(replacement.startCalls[0][1] - 0.755 % replacement.buffer.duration) < 1e-8);
  assert.equal([...audio._voices][0]._gain.gain.value, 0.6);
  handle.stop(0); await audio.dispose(); clearOffline();
});

test('loop parameter completion does not start a buffer after its voice stops', async () => {
  setOffline(); const { audio, context } = setup();
  audio.define('loop', { duration: 0.1, loop: true, play: voice => {
    voice.onParam('blend', () => undefined); voice.tone(0, { f: 110, dur: 0.1 });
  } });
  await audio.prepare(['loop'], { seed: 5, params: { blend: 0 } });
  const handle = audio.play('loop', { seed: 5, params: { blend: 0 } });
  handle.setParam('blend', 1); handle.stop(0); await tick(); await tick();
  assert.equal(context.count('buffer-source'), 1);
  await audio.dispose(); clearOffline();
});

test('offline renderer flushes audio-clock callbacks at suspend checkpoints, trims loop preview and disposes', async () => {
  setOffline(); let callbacks = 0, stopped = 0;
  const definition = { duration: 0.2, loop: true, play: voice => {
    voice.repeat(() => { callbacks++; }, 0.05); return { stop() { stopped++; } };
  } };
  const sound = await renderSoundBuffer({ definition, options: {}, sampleRate: 16_000, seed: 3 },
    (context, seed) => new GameAudio({ context, seed, sampleRate: 16_000, soundBuffers: false, protection: false }));
  const context = TestOfflineAudioContext.instances.at(-1);
  assert.ok(callbacks > 0); assert.ok(context.suspendTimes.length > 0);
  assert.equal(context.resumeCount, context.suspendTimes.length);
  assert.equal(sound.loop, true); assert.equal(sound.buffer.sampleRate, 16_000);
  assert.ok(sound.buffer.length < 3 * 16_000); assert.equal(stopped, 1);
  clearOffline();
});

test('offline renderer succeeds when OfflineAudioContext lacks suspend (e.g. Firefox Android)', async () => {
  setOffline();
  class LegacyOfflineContext extends TestOfflineAudioContext {
    constructor(...args) {
      super(...args);
      delete this.suspend;
      delete this.resume;
    }
  }
  globalThis.OfflineAudioContext = LegacyOfflineContext;
  const definition = { duration: 0.1, loop: false, play: () => {} };
  const sound = await renderSoundBuffer({ definition, options: {}, sampleRate: 16_000, seed: 1 },
    (context, seed) => new GameAudio({ context, seed, sampleRate: 16_000, soundBuffers: false, protection: false }));
  assert.equal(sound.buffer.sampleRate, 16_000);
  assert.equal(sound.loop, false);
  clearOffline();
});

test('offline renderer rejects invalid duration and runs cleanup after definition failure', async () => {
  setOffline();
  const create = context => new GameAudio({ context, soundBuffers: false });
  for (const definition of [{ play() {} }, { duration: Infinity, play() {} }]) {
    await assert.rejects(renderSoundBuffer({ definition, options: {}, sampleRate: 16_000, seed: 1 }, create), /positive finite duration/);
  }
  assert.equal(TestOfflineAudioContext.instances.length, 0);
  let renderedAudio;
  const failure = new Error('definition failed');
  await assert.rejects(renderSoundBuffer({ definition: { duration: 0.1, play() { throw failure; } }, options: {}, sampleRate: 16_000, seed: 1 },
    context => renderedAudio = create(context)), error => error === failure);
  assert.equal(renderedAudio._closed, true);
  clearOffline();
});
