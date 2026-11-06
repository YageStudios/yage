import { expect, it, vi } from 'vitest';
import { AssetCache } from '../engine/data/AssetCache';
const bytes = new TextEncoder().encode('verified map shard').buffer;
const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const asset = { path: 'map/shard.bin', bytes: bytes.byteLength, sha256 };

it('releases verified render bytes while load and preload still wait for the same durable commit', async () => {
  let commit!: () => void;
  const gate = new Promise<void>(resolve => { commit = resolve; });
  const write = vi.fn(async () => gate), fetcher = vi.fn(async () => new Response(bytes));
  const cache = new AssetCache({ read: async () => undefined, write }, fetcher);
  const ready = await cache.readVerified('https://local/', asset);
  expect(ready.bytes).toEqual(bytes);
  const loaded = vi.fn(), preloaded = vi.fn();
  const load = cache.load('https://local/', asset).then(loaded);
  const preload = cache.preload('https://local/', [asset]).then(preloaded);
  await Promise.resolve();
  expect(loaded).not.toHaveBeenCalled(); expect(preloaded).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledOnce();
  commit();
  expect(await ready.persisted).toEqual({ ok: true });
  await Promise.all([load, preload]);
  expect(loaded).toHaveBeenCalledWith(bytes); expect(preloaded).toHaveBeenCalledOnce();
});

it('gives renderers owned bytes so transfers and mutations cannot corrupt pending persistence', async () => {
  let commit!: () => void, saved: ArrayBuffer | undefined;
  const gate = new Promise<void>(resolve => { commit = resolve; });
  const cache = new AssetCache({ read: async () => undefined, write: async (_key, body) => { await gate; saved = body.slice(0); } }, async () => new Response(bytes));
  const first = await cache.readVerified('https://local/', asset);
  new Uint8Array(first.bytes).fill(0);
  structuredClone(first.bytes, { transfer: [first.bytes] });
  const second = await cache.readVerified('https://local/', asset);
  expect(second.bytes).toEqual(bytes);
  commit(); await second.persisted;
  expect(saved).toEqual(bytes);
});

it('reports failed writes as values to renderers, still rejects durable loads, and permits retry', async () => {
  const failure = new Error('quota'), write = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
  const cache = new AssetCache({ read: async () => undefined, write }, async () => new Response(bytes));
  const ready = await cache.readVerified('https://local/', asset);
  expect(ready.bytes).toEqual(bytes);
  expect(await ready.persisted).toEqual({ error: failure });
  await expect(cache.load('https://local/', asset)).resolves.toEqual(bytes);
  expect(write).toHaveBeenCalledTimes(2);
});

it('does not allow a renderer read to make concurrent durable loads skip a failed transaction', async () => {
  let fail!: () => void;
  const error = new Error('transaction aborted'), gate = new Promise<void>((_resolve, reject) => { fail = () => reject(error); });
  const cache = new AssetCache({ read: async () => undefined, write: async () => gate }, async () => new Response(bytes));
  const ready = await cache.readVerified('https://local/', asset);
  const durable = cache.load('https://local/', asset).then(() => ({ ok: true }), error => ({ error }));
  fail();
  expect(await ready.persisted).toEqual({ error });
  expect(await durable).toEqual({ error });
});
