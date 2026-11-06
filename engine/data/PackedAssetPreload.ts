import type { AssetRecord, AssetStore } from './AssetCache';

/** Bound both transfer memory and transaction size while coalescing physically adjacent fragments. */
export const packedAssetWindows = (assets: readonly AssetRecord[]) => {
  const sorted = [...assets].sort((a, b) => a.path.localeCompare(b.path) || a.offset! - b.offset!);
  const windows: AssetRecord[][] = [];
  for (const asset of sorted) {
    if (asset.offset === undefined || !Number.isSafeInteger(asset.offset) || asset.offset < 0
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !Number.isSafeInteger(asset.offset + asset.bytes)
      || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.path.startsWith('/') || asset.path.includes(':')
      || asset.path.split('/').some(part => part === '..')) throw new Error('Invalid packed asset');
    const current = windows[windows.length - 1], first = current?.[0], last = current?.[current.length - 1];
    if (!first || current.length >= 512 || first.path !== asset.path || asset.offset < last.offset! + last.bytes
      || asset.offset - last.offset! - last.bytes > 65536 || asset.offset + asset.bytes - first.offset! > 8 * 1024 * 1024) windows.push([asset]);
    else current.push(asset);
  }
  return windows;
};

export const preloadPackedAssets = async (
  base: string, assets: readonly AssetRecord[], store: AssetStore, fetcher: typeof fetch,
  progress: (bytes: number) => void, verified: (key: string) => void,
) => {
  for (const window of packedAssetWindows(assets)) {
    const keys = window.map(asset => asset.sha256);
    const cached = store.readMany ? await store.readMany(keys) : await Promise.all(keys.map(key => store.read(key)));
    const valid = async (bytes: ArrayBuffer | undefined, asset: AssetRecord) => {
      if (!bytes || bytes.byteLength !== asset.bytes) return false;
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      return [...hash].map(value => value.toString(16).padStart(2, '0')).join('') === asset.sha256;
    };
    const missing: AssetRecord[] = [];
    for (let i = 0; i < window.length; i++) {
      if (await valid(cached[i], window[i])) { verified(keys[i]); progress(window[i].bytes); }
      else missing.push(window[i]);
    }
    if (!missing.length) continue;
    const first = missing[0], end = missing[missing.length - 1].offset! + missing[missing.length - 1].bytes;
    const response = await fetcher(new URL(first.path, base), { headers: { Range: `bytes=${first.offset}-${end - 1}` } });
    if (!response.ok) throw new Error(`${first.path}: HTTP ${response.status}`);
    const body = await response.arrayBuffer(), origin = response.status === 206 ? first.offset! : 0;
    if (response.status === 206 && body.byteLength !== end - first.offset!) throw new Error('Truncated packed asset response');
    const entries: [string, ArrayBuffer][] = [];
    for (const asset of missing) {
      const bytes = body.slice(asset.offset! - origin, asset.offset! - origin + asset.bytes);
      if (!await valid(bytes, asset)) throw new Error(`Asset integrity mismatch: ${asset.path}`);
      entries.push([asset.sha256, bytes]);
    }
    // Hash every member before opening the write transaction. A failed batch is never reported ready.
    if (store.writeMany) await store.writeMany(entries);
    else for (const [key, bytes] of entries) await store.write(key, bytes);
    for (const asset of missing) { verified(asset.sha256); progress(asset.bytes); }
  }
};
