import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../../.audio-build/engine.js';
import { SpatialPlayback } from '../../.audio-build/SpatialPlayback.js';
import * as runtime from '../../.audio-build/runtime.js';
import { registerAirportSounds, AIRPORT_CATEGORIES, AIRPORT_PARAMS } from '../../.audio-build/presets/airport.js';
import { FakeAudioContext, FakeOfflineContext } from '../../.audio-build/helpers/fake-audio.js';
const setup = () => { const ctx = new FakeOfflineContext(); return { ctx, audio: new GameAudio({ context: ctx, maxVoices: 8192 }) }; };
const advance = (audio, ctx, seconds) => { for (let t = 0; t < seconds; t += 0.02) { ctx.currentTime += 0.02; audio.timers.flush(); } };
const source = (patch = {}) => ({ sound: 'apt-amb-terminal', enabled: true, volume: 0.4, refDistance: 100, maxDistance: 3000, rolloff: 1, occlusion: 0, air: false, trigger: 0, params: { crowd: 0.5 }, ...patch });

test('entire extracted airport bank plays, all loops respond, and events resolve', async () => {
  const { audio, ctx } = setup();
  registerAirportSounds(audio);
  const list = audio.list();
  assert.equal(list.length, 309);
  assert.deepEqual(new Set(list.map(s => s.category)), new Set(Object.keys(AIRPORT_CATEGORIES)));
  for (const sound of list.filter(s => !s.loop)) assert.equal(audio.play(sound.id).accepted, true, sound.id);
  advance(audio, ctx, 15);
  for (const [id, params] of Object.entries(AIRPORT_PARAMS)) {
    const handle = audio.play(id);
    assert.equal(handle.loop, true, id);
    for (const param of Object.keys(params)) { handle.setParam(param, 1); advance(audio, ctx, 0.3); handle.setParam(param, 0); }
    handle.stop(0.05); advance(audio, ctx, 0.2);
    assert.equal(handle.playing, false, id);
  }
  assert.deepEqual(audio.resolve('apt-scan', { switch: 'fail' }), ['apt-scan-fail']);
  for (const event of ['apt-pa', 'apt-departure', 'apt-grumble']) assert.equal(audio.play(event).accepted, true);
  await audio.dispose();
  assert.equal(audio.timers.pending, 0);
});

test('entity emitters move, update parameters, restart on triggers, stop on removal and rejection retries', async () => {
  const { audio, ctx } = setup(); registerAirportSounds(audio);
  const playback = new SpatialPlayback(), config = source();
  const emitter = { id: 1, position: [100, 0, 50], source: config };
  playback.update(audio, [emitter]);
  const panner = ctx.created.find(n => n.kind === 'panner'); assert.ok(panner);
  const count = ctx.count('panner');
  emitter.position = [300, 0, 50]; config.params.crowd = 1; config.occlusion = 0.7;
  playback.update(audio, [emitter]);
  assert.equal(ctx.count('panner'), count);
  assert.equal(panner.positionX.value, 300);
  for (const voice of audio._voices) voice._stop(0);
  advance(audio, ctx, 0.2); playback.update(audio, [emitter]);
  assert.ok(ctx.count('panner') > count, 'stolen or ended loops recover');
  config.trigger++; playback.update(audio, [emitter]);
  assert.ok(ctx.count('panner') > count);
  config.sound = 'apt-kiosk-tap'; playback.update(audio, [emitter]);
  advance(audio, ctx, 3);
  const oneShotCount = ctx.count('panner'); playback.update(audio, [emitter]);
  assert.equal(ctx.count('panner'), oneShotCount, 'one-shot must not replay every frame');
  playback.update(audio, [{ id: 2, position: [0,0,0], source: source({ enabled: false }) }, { id: 3, position: [0,0,0], source: source({ sound: '' }) }]);
  playback.clear();
  audio.define('reject', { duration: 1, limit: 1, steal: 'none', play() {} });
  audio.play('reject'); playback.update(audio, [{ id: 1, position: [0,0,0], source: source({ sound: 'reject' }) }]);
  advance(audio, ctx, 2); playback.update(audio, [{ id: 1, position: [0,0,0], source: source({ sound: 'reject' }) }]);
  playback.clear(); await audio.dispose();
});

test('runtime is lazy, unlocks on gesture, respects mute, and disposes its context', async () => {
  assert.equal(runtime.getAudio(), undefined);
  assert.equal(runtime.audioEnabled(), false);
  runtime.setAudioEnabled(false); assert.equal(runtime.unlockAudio(), undefined);
  runtime.setAudioEnabled(true); assert.equal(runtime.unlockAudio(), undefined);
  globalThis.AudioContext = FakeAudioContext;
  let registered = 0;
  runtime.configureAudio(audio => { registered++; audio.define('click', () => {}); });
  const audio = runtime.unlockAudio();
  assert.equal(registered, 1); assert.equal(runtime.unlockAudio(), audio);
  assert.equal(runtime.audioEnabled(), true);
  runtime.setAudioEnabled(false); assert.equal(audio.volume, 0); assert.equal(runtime.audioEnabled(), false);
  runtime.setAudioEnabled(true); assert.equal(audio.volume, 0.8);
  await runtime.disposeAudio(); assert.equal(audio.ctx.state, 'closed'); assert.equal(runtime.getAudio(), undefined);
  await runtime.disposeAudio(); delete globalThis.AudioContext;
});
