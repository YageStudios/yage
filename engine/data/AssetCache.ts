/** Immutable, content-addressed assets. A successful write means its transaction committed. */
export type AssetRecord = { path: string; bytes: number; sha256: string };
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
    const response = await this.fetcher(new URL(asset.path, base));
    if (!response.ok) throw new Error(`${asset.path}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (!(await this.valid(bytes, asset)))
      throw new Error(`Asset integrity mismatch: ${asset.path}`);
    await this.store.write(asset.sha256, bytes);
    this.verified.add(asset.sha256);
    return bytes;
  }

  /**
   * Sequential downloads bound peak memory and resume after interruption by content hash. An asset
   * already verified this session is stored and whole, so it is not read again.
   */
  async preload(
    base: string,
    assets: readonly AssetRecord[],
    progress: (complete: number, total: number) => void = () => {}
  ): Promise<void> {
    const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    let complete = 0;
    progress(complete, total);
    for (const asset of assets) {
      if (!this.verified.has(asset.sha256)) await this.load(base, asset);
      complete += asset.bytes;
      progress(complete, total);
    }
  }
}
