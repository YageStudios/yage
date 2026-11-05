/**
 * Immutable, content-addressed assets. A successful write means its transaction committed. With `offset`,
 * the asset is the `bytes` at that offset in the file at `path` (fetched by HTTP range), hashed on their own.
 */
export type AssetRecord = { path: string; bytes: number; sha256: string; offset?: number };
export type AssetStore = {
  read(key: string): Promise<ArrayBuffer | undefined>;
  write(key: string, bytes: ArrayBuffer): Promise<void>;
};

export class IndexedDBAssetStore implements AssetStore {
  private connection: Promise<IDBDatabase> | undefined;
  constructor(
    private readonly factory: IDBFactory,
    private readonly name = "yage-assets"
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("assets");
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Asset database upgrade blocked by another tab"));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.connection = undefined;
        };
        resolve(db);
      };
    });
    this.connection = connection;
    void connection.catch(() => {
      if (this.connection === connection) this.connection = undefined;
    });
    return connection;
  }

  async read(key: string): Promise<ArrayBuffer | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("assets", "readonly");
      const request = transaction.objectStore("assets").get(key);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Asset read aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async write(key: string, bytes: ArrayBuffer): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("assets", "readwrite");
      transaction.objectStore("assets").put(bytes, key);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Asset write aborted"));
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export class AssetCache {
  private readonly pending = new Map<string, Promise<ArrayBuffer>>();
  /** Content hashes this cache has already verified this session: their stored bytes are read without hashing again. */
  private readonly verified = new Set<string>();
  constructor(
    private readonly store: AssetStore,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  load(base: string, asset: AssetRecord): Promise<ArrayBuffer> {
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 0 ||
      (asset.offset !== undefined && (!Number.isSafeInteger(asset.offset) || asset.offset < 0)) ||
      asset.path.split("/").some((part) => part === "..") ||
      asset.path.startsWith("/") ||
      asset.path.includes(":")
    ) {
      return Promise.reject(new Error(`Invalid asset record: ${asset.path}`));
    }
    const key = asset.sha256;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.read(base, asset);
    this.pending.set(key, task);
    void task.finally(() => this.pending.delete(key)).catch(() => {});
    return task;
  }

  private async valid(
    bytes: ArrayBuffer,
    asset: AssetRecord
  ): Promise<boolean> {
    if (bytes.byteLength !== asset.bytes) return false;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return (
      Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join(
        ""
      ) === asset.sha256
    );
  }

  private async read(base: string, asset: AssetRecord): Promise<ArrayBuffer> {
    const cached = await this.store.read(asset.sha256);
    if (cached && this.verified.has(asset.sha256) && cached.byteLength === asset.bytes) return cached;
    if (cached && (await this.valid(cached, asset))) {
      this.verified.add(asset.sha256);
      return cached;
    }
    const ranged = asset.offset !== undefined;
    const response = await this.fetcher(
      new URL(asset.path, base),
      ranged && asset.bytes ? { headers: { Range: `bytes=${asset.offset}-${asset.offset! + asset.bytes - 1}` } } : undefined
    );
    if (!response.ok) throw new Error(`${asset.path}: HTTP ${response.status}`);
    let bytes = await response.arrayBuffer();
    // A server that ignores the range sends the whole file: the asset is still its slice.
    if (ranged && response.status !== 206) bytes = bytes.slice(asset.offset!, asset.offset! + asset.bytes);
    if (!(await this.valid(bytes, asset)))
      throw new Error(`Asset integrity mismatch: ${asset.path}`);
    await this.store.write(asset.sha256, bytes);
    this.verified.add(asset.sha256);
    return bytes;
  }

  /**
   * A small download window overlaps transaction/network waits, reserving at most the largest asset's
   * declared bytes. Results are reported in input order, after each persistent commit. Already-started
   * loads settle on failure; their successful suffix may be cached for the next attempt.
   */
  async preload(
    base: string,
    assets: readonly AssetRecord[],
    progress: (complete: number, total: number) => void = () => {}
  ): Promise<void> {
    let total = 0, largest = 0;
    for (const asset of assets) {
      total += asset.bytes;
      if (Number.isSafeInteger(asset.bytes) && asset.bytes >= 0) largest = Math.max(largest, asset.bytes);
    }
    let complete = 0;
    progress(complete, total);
    for (let first = 0; first < assets.length;) {
      if (this.verified.has(assets[first].sha256)) {
        complete += assets[first++].bytes;
        progress(complete, total);
        continue;
      }
      const jobs: Promise<{ ok: true } | { ok: false; error: unknown }>[] = [];
      let end = first, reserved = 0;
      try {
        while (end < assets.length && jobs.length < 4) {
          const asset = assets[end], known = this.verified.has(asset.sha256);
          const validBytes = Number.isSafeInteger(asset.bytes) && asset.bytes >= 0;
          const bytes = known ? 0 : asset.bytes;
          if (jobs.length && (!validBytes || reserved + bytes > largest)) break;
          jobs.push(known ? Promise.resolve({ ok: true }) : this.load(base, asset).then(
            () => ({ ok: true as const }), error => ({ ok: false as const, error })
          ));
          reserved += bytes;
          end++;
          if (!validBytes) break;
        }
        for (let at = first; at < end; at++) {
          const result = await jobs[at - first];
          if (!result.ok) throw result.error;
          complete += assets[at].bytes;
          progress(complete, total);
        }
      } finally { await Promise.all(jobs); }
      first = end;
    }
  }
}
