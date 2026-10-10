import type { BufferedSound, BufferRequest, SoundBufferCache } from './buffer-cache';
import type { Voice } from './voice';
import { hold } from './mixer';

/** Keep generated PCM separate from the instance's live gain, bus and positioning. */
export function playSoundBuffer(voice: Voice, sound: BufferedSound, at: number, cache: SoundBufferCache, request: BufferRequest): void {
  let revision = 0;
  const start = (next: BufferedSound, time: number, fade: boolean) => {
    const elapsed = Math.max(0, time - at) * voice.pitch;
    if (!next.loop && elapsed >= next.buffer.duration) return;
    const source = voice.ctx.createBufferSource(), gain = voice.ctx.createGain();
    source.buffer = next.buffer; source.loop = next.loop; source.playbackRate.value = voice.pitch;
    gain.gain.setValueAtTime(fade ? 0 : 1, time);
    if (fade) gain.gain.linearRampToValueAtTime(1, time + 0.04);
    source.connect(gain); gain.connect(voice.dest); voice.own(source, gain);
    const offset = next.loop ? elapsed % next.buffer.duration : elapsed;
    source.start(time, offset);
    if (next.loop) voice.hold(); else voice._track(at + next.buffer.duration / voice.pitch);
    return { source, gain };
  };
  const first = start(sound, at, false);
  if (!first) return;
  let current = first;
  const params = { ...request.options.params };
  for (const name of sound.parameters) voice.onParam(name, value => {
    if (params[name] === value) return;
    params[name] = value;
    const version = ++revision;
    const nextRequest = { ...request, options: { ...request.options, params: { ...params } } };
    void cache.prepare(nextRequest).then(result => {
      if (result.error || voice._stopped || version !== revision) return;
      const time = Math.max(at, voice.now() + 0.005), old = current;
      const replacement = start(result.sound, time, true);
      if (!replacement) return;
      current = replacement;
      hold(old.gain.gain, time);
      old.gain.gain.linearRampToValueAtTime(0, time + 0.04);
      old.source.stop(time + 0.045);
    });
  });
}
