import type { SoundDefinition, VoiceOptions } from './types';

export type BufferedSound = { buffer: AudioBuffer; loop: boolean; parameters: string[] };
export type BufferRequest = { definition: SoundDefinition; options: VoiceOptions; sampleRate: number; seed: number };
export type BufferResult = { sound: BufferedSound; error?: never } | { sound?: never; error: Error };
type Entry = { request: BufferRequest; promise: Promise<BufferResult>; sound?: BufferedSound; error?: Error; bytes: number };

/** Owns bounded, generated PCM. Re-registering a definition invalidates its buffers. */
export class SoundBufferCache {
  private entries = new Map<string, Entry>();
  private revisions = new WeakMap<SoundDefinition, number>();
  private revision = 0;
  private bytes = 0;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private render: (request: BufferRequest) => Promise<BufferedSound>, private maxBytes = 64 * 1024 * 1024) {}

  private key(request: BufferRequest): string {
    let revision = this.revisions.get(request.definition);
    if (revision === undefined) { revision = ++this.revision; this.revisions.set(request.definition, revision); }
    const o = request.options;
    return JSON.stringify([revision, request.sampleRate, request.seed, o.depth ?? 1, o.motion ?? 1, o.brightness ?? 1,
      Object.entries(o.params ?? {}).sort(([a], [b]) => a.localeCompare(b))]);
  }

  get(request: BufferRequest): BufferedSound | undefined {
    const key = this.key(request), entry = this.entries.get(key);
    if (!entry?.sound) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.sound;
  }

  prepare(request: BufferRequest): Promise<BufferResult> {
    if (this.closed) return Promise.resolve({ error: new Error('Sound buffer cache is disposed') });
    const key = this.key(request), previous = this.entries.get(key);
    if (previous) return previous.promise;
    const entry: Entry = { request, promise: Promise.resolve({ error: new Error('Render not started') }), bytes: 0 };
    // Serialize synthesis so background preparation cannot launch many heavy renderers at once.
    entry.promise = this.queue.then(async (): Promise<BufferResult> => {
      if (this.closed || this.entries.get(key) !== entry) return { error: new Error('Sound buffer render was invalidated') };
      try {
        const sound = await this.render(request);
        if (this.closed || this.entries.get(key) !== entry) return { error: new Error('Sound buffer render was invalidated') };
        entry.bytes = sound.buffer.length * sound.buffer.numberOfChannels * 4;
        if (entry.bytes <= this.maxBytes) {
          entry.sound = sound; this.bytes += entry.bytes;
          for (const [oldKey, old] of this.entries) {
            if (this.bytes <= this.maxBytes) break;
            if (!old.sound || old === entry) continue;
            this.entries.delete(oldKey); this.bytes -= old.bytes;
          }
        } else this.entries.delete(key);
        return { sound };
      } catch (error) {
        entry.error = error instanceof Error ? error : new Error(String(error));
        return { error: entry.error };
      }
    });
    this.queue = entry.promise.then(() => undefined);
    this.entries.set(key, entry);
    return entry.promise;
  }

  invalidate(definition: SoundDefinition): void {
    for (const [key, entry] of this.entries) if (entry.request.definition === definition) {
      this.entries.delete(key); this.bytes -= entry.bytes;
    }
  }

  get stats() { return { bytes: this.bytes, entries: this.entries.size, errors: [...this.entries.values()].flatMap(entry => entry.error ? [entry.error] : []) }; }
  dispose(): void { this.closed = true; this.entries.clear(); this.bytes = 0; }
}
