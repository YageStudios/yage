import { afterEach, expect, it, vi } from "vitest";
import { randomSource } from "../../engine/audio/dsp";
import { synthesizeHuman, type VocalFrame } from "../../engine/audio/presets/airport-human";
import { FakeAudioContext, type FakeNode } from "../helpers/fake-audio";

const FRAMES: VocalFrame[] = [
  { at: 0, pitch: 130, mouth: [520, 1210, 2450], gain: 0 },
  { at: 0.2, pitch: 128, mouth: [720, 1160, 2520], gain: 1 },
  { at: 0.4, pitch: 120, mouth: [460, 850, 2460], gain: 0 },
];
const voice = (ctx: FakeAudioContext) => {
  const random = randomSource(7);
  return { _stopped: false, ctx, dest: ctx.destination, pitch: 1, brightness: 1, random: (a = 0, b = 1) => a + random() * (b - a), own: vi.fn(), _track: vi.fn() };
};
const source = (ctx: FakeAudioContext) => ctx.created.find((n) => n.kind === "buffer-source") as FakeNode & { buffer?: { getChannelData(c: number): Float32Array } };
const seedOf = () => Math.floor(randomSource(7)() * 4294967296);

afterEach(() => vi.unstubAllGlobals());
// The module keeps its worker (or that there is none): each test loads it afresh.
const fresh = async () => { vi.resetModules(); return (await import("../../engine/audio/presets/airport-human")).performHuman; };

it("without a worker, a voice's PCM is made from one seed it draws and starts on time", async () => {
  const performHuman = await fresh();
  const ctx = new FakeAudioContext();
  performHuman(voice(ctx) as never, 0.5, FRAMES);
  const src = source(ctx);
  expect(src.started).toBe(0.5);
  expect([...src.buffer!.getChannelData(0)]).toEqual([...synthesizeHuman(FRAMES, randomSource(seedOf()), { sampleRate: 24000, pitch: 1, brightness: 1, rough: 0.1 })]);
});

it("with a worker, the frame only asks: the same PCM arrives later and starts from where it would be by then", async () => {
  const posted: { id: number; frames: VocalFrame[]; seed: number; options: never }[] = [];
  let worker: { onmessage: ((e: { data: unknown }) => void) | null } | null = null;
  vi.stubGlobal("Worker", class { onmessage = null; onerror = null; constructor() { worker = this as never; } postMessage(m: never) { posted.push(m); } terminate() {} });
  const performHuman = await fresh();
  const ctx = new FakeAudioContext();
  performHuman(voice(ctx) as never, 0.5, FRAMES);
  const src = source(ctx);
  // Nothing synthesized here: the source waits for its buffer.
  expect(src.started).toBeUndefined();
  expect(posted).toHaveLength(1);
  expect(posted[0].seed).toBe(seedOf());
  ctx.currentTime = 0.6;
  const pcm = synthesizeHuman(posted[0].frames, randomSource(posted[0].seed), posted[0].options);
  worker!.onmessage!({ data: { id: posted[0].id, pcm } });
  expect(src.started).toBeCloseTo(0.6);
  expect([...src.buffer!.getChannelData(0)]).toEqual([...synthesizeHuman(FRAMES, randomSource(seedOf()), { sampleRate: 24000, pitch: 1, brightness: 1, rough: 0.1 })]);
});
