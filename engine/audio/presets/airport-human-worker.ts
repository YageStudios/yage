/** Synthesizes human-voice PCM (airport-human.ts synthesizeHuman) off the main thread: one phrase per message. */
import { randomSource } from '../dsp';
import { synthesizeHuman, type VocalFrame } from './airport-human';

type Request = { id: number; frames: VocalFrame[]; seed: number; options: { sampleRate: number; pitch: number; brightness: number; rough: number } };
const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
scope.onmessage = (e) => {
  const { id, frames, seed, options } = e.data;
  try {
    const pcm = synthesizeHuman(frames, randomSource(seed), options);
    scope.postMessage({ id, pcm }, [pcm.buffer]);
  } catch (error) {
    scope.postMessage({ id, error: String(error) }, []);
  }
};
