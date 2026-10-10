import type { GameAudio } from './engine';
import { Voice } from './voice';
import type { BufferedSound, BufferRequest } from './buffer-cache';

/** Bake the authored graph, including its acoustic tail, outside the live renderer. */
export async function renderSoundBuffer(request: BufferRequest, create: (context: OfflineAudioContext, seed: number) => GameAudio): Promise<BufferedSound> {
  const { definition, options, sampleRate, seed } = request;
  const duration = definition.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) throw new Error('Buffered sounds require a positive finite duration');
  const warmup = definition.loop ? 2 : 0;
  const context = new OfflineAudioContext(2, Math.ceil((duration + warmup) * sampleRate), sampleRate);
  const audio = create(context, seed);
  const voice = new Voice(audio, context.destination, { seed, params: options.params, depth: options.depth, motion: options.motion, brightness: options.brightness });
  audio._voices.add(voice);
  try {
    if (definition.loop) voice.hold();
    const control = definition.play(voice, 0);
    if (control && typeof control === 'object' && 'stop' in control) voice.onStop(() => control.stop());
    const parameters = voice.parameterNames;
    const end = context.length / sampleRate, quantum = 128 / sampleRate;
    let checkpoint: Promise<void> | undefined;
    const canSuspend = typeof context.suspend === 'function' && typeof context.resume === 'function';
    const schedule = () => {
      if (!canSuspend) return undefined;
      const at = Math.max(context.currentTime + quantum, Math.ceil(audio.timers.nextAt / quantum) * quantum);
      return at < end ? context.suspend(at) : undefined;
    };
    checkpoint = schedule();
    const rendering = context.startRendering();
    while (checkpoint) {
      await Promise.race([checkpoint, rendering]);
      audio.timers.flush();
      checkpoint = schedule();
      if (context.currentTime < end) await context.resume();
    }
    let buffer = await rendering;
    audio.timers.flush();
    if (definition.loop) {
      const start = Math.round(warmup * sampleRate), length = buffer.length - start;
      const loop = context.createBuffer(buffer.numberOfChannels, length, sampleRate);
      const overlap = Math.min(Math.round(sampleRate * 0.03), Math.floor(length / 4));
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const source = buffer.getChannelData(channel), target = loop.getChannelData(channel);
        target.set(source.subarray(start));
        // Match the loop boundary without a discontinuity in the generated bed.
        for (let i = 0; i < overlap; i++) {
          const mix = i / overlap;
          target[length - overlap + i] = target[length - overlap + i] * (1 - mix) + target[i] * mix;
        }
      }
      // The overlapping prefix is already heard at the end of each cycle.
      const trimmed = context.createBuffer(loop.numberOfChannels, length - overlap, sampleRate);
      for (let channel = 0; channel < loop.numberOfChannels; channel++) trimmed.getChannelData(channel).set(loop.getChannelData(channel).subarray(overlap));
      buffer = trimmed;
    }
    return { buffer, loop: !!definition.loop, parameters };
  } finally { await audio.dispose(); }
}
