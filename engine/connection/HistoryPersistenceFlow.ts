import type { Frame, ReplayStack } from "./ConnectionInstance";

export type HistoryPersistenceOptions =
  | false
  | {
      enabled?: boolean;
      persistIntervalFrames?: number;
      maxSerializedCharacters?: number;
      storageKey?: string;
      worker?: boolean;
      indexedDbName?: string;
      indexedDbStore?: string;
    };

type ReplayHistory<T> = { [roomId: string]: ReplayStack<T> };

const DEFAULT_HISTORY_PERSIST_INTERVAL_FRAMES = 300;
const DEFAULT_STORAGE_KEY = "history";
const DEFAULT_INDEXED_DB_NAME = "yage-history";
const DEFAULT_INDEXED_DB_STORE = "replays";

const HISTORY_WORKER_SOURCE = `
let history = {};
let options = {};
let disabled = false;
let dbPromise = null;

function storageKey() {
  return options.storageKey || "${DEFAULT_STORAGE_KEY}";
}

function indexedDbName() {
  return options.indexedDbName || "${DEFAULT_INDEXED_DB_NAME}";
}

function indexedDbStore() {
  return options.indexedDbStore || "${DEFAULT_INDEXED_DB_STORE}";
}

function maxSerializedCharacters() {
  return options.maxSerializedCharacters || 0;
}

function postDisabled(reason, error) {
  disabled = true;
  self.postMessage({
    type: "disabled",
    reason,
    error: error ? String(error.message || error) : "",
  });
}

function ensureRoom(roomId) {
  history[roomId] = history[roomId] || {
    frames: {},
    seed: "",
    startTimestamp: Date.now(),
    stateHashes: {},
    snapshots: {},
    configs: {},
  };
  return history[roomId];
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB is unavailable in history worker"));
      return;
    }
    const request = indexedDB.open(indexedDbName(), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(indexedDbStore())) {
        db.createObjectStore(indexedDbStore());
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open history IndexedDB"));
  });
  return dbPromise;
}

async function persistHistory() {
  if (disabled) return;

  let serialized = "";
  try {
    serialized = JSON.stringify(history);
  } catch (error) {
    postDisabled("history could not be serialized", error);
    return;
  }

  const maxChars = maxSerializedCharacters();
  if (maxChars > 0 && serialized.length > maxChars) {
    postDisabled("history exceeded " + maxChars + " serialized characters");
    return;
  }

  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(indexedDbStore(), "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not write history IndexedDB"));
      transaction.objectStore(indexedDbStore()).put(serialized, storageKey());
    });
    self.postMessage({ type: "persisted", length: serialized.length });
  } catch (error) {
    postDisabled("indexedDB rejected history", error);
  }
}

self.onmessage = (event) => {
  if (disabled) return;
  const message = event.data || {};
  try {
    if (message.type === "configure") {
      options = message.options || {};
      return;
    }
    if (message.type === "resetRoom") {
      history[message.roomId] = message.stack;
      return;
    }
    if (message.type === "setPlayerConfig") {
      ensureRoom(message.roomId).configs[message.playerId] = message.config;
      return;
    }
    if (message.type === "recordSnapshot") {
      const room = ensureRoom(message.roomId);
      room.stateHashes[message.frame] = message.hash;
      room.snapshots[message.frame] = message.snapshot;
      return;
    }
    if (message.type === "recordFrame") {
      const room = ensureRoom(message.roomId);
      room.frames[message.playerId] = room.frames[message.playerId] || [];
      room.frames[message.playerId].push(message.frame);
      return;
    }
    if (message.type === "persist") {
      persistHistory();
      return;
    }
    if (message.type === "clear") {
      history = {};
      return;
    }
  } catch (error) {
    postDisabled("history worker failed", error);
  }
};
`;

function optionsEnabled(options: HistoryPersistenceOptions | undefined): boolean {
  return options !== false && options?.enabled !== false;
}

function storageKey(options: HistoryPersistenceOptions | undefined): string {
  return options === false ? DEFAULT_STORAGE_KEY : options?.storageKey ?? DEFAULT_STORAGE_KEY;
}

function indexedDbName(options: HistoryPersistenceOptions | undefined): string {
  return options === false ? DEFAULT_INDEXED_DB_NAME : options?.indexedDbName ?? DEFAULT_INDEXED_DB_NAME;
}

function indexedDbStore(options: HistoryPersistenceOptions | undefined): string {
  return options === false ? DEFAULT_INDEXED_DB_STORE : options?.indexedDbStore ?? DEFAULT_INDEXED_DB_STORE;
}

function maxSerializedCharacters(options: HistoryPersistenceOptions | undefined): number {
  return options === false ? 0 : options?.maxSerializedCharacters ?? 0;
}

async function readIndexedDbHistory<T>(options: HistoryPersistenceOptions | undefined): Promise<ReplayHistory<T> | null> {
  if (!optionsEnabled(options) || typeof indexedDB === "undefined") {
    return null;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(indexedDbName(options), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(indexedDbStore(options))) {
        db.createObjectStore(indexedDbStore(options));
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(indexedDbStore(options), "readonly");
      const getRequest = transaction.objectStore(indexedDbStore(options)).get(storageKey(options));
      getRequest.onerror = () => resolve(null);
      getRequest.onsuccess = () => {
        const value = getRequest.result;
        if (!value) {
          resolve(null);
          return;
        }
        try {
          resolve(typeof value === "string" ? JSON.parse(value) : value);
        } catch {
          resolve(null);
        }
      };
    };
  });
}

async function writeIndexedDbHistory<T>(
  history: ReplayHistory<T>,
  options: HistoryPersistenceOptions | undefined
): Promise<number> {
  if (!optionsEnabled(options) || typeof indexedDB === "undefined") {
    return 0;
  }

  const serialized = JSON.stringify(history);
  const maxChars = maxSerializedCharacters(options);
  if (maxChars > 0 && serialized.length > maxChars) {
    throw new Error(`history exceeded ${maxChars} serialized characters`);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(indexedDbName(options), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(indexedDbStore(options))) {
        db.createObjectStore(indexedDbStore(options));
      }
    };
    request.onerror = () => reject(request.error || new Error("Could not open history IndexedDB"));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(indexedDbStore(options), "readwrite");
      transaction.oncomplete = () => resolve(serialized.length);
      transaction.onerror = () => reject(transaction.error || new Error("Could not write history IndexedDB"));
      transaction.objectStore(indexedDbStore(options)).put(serialized, storageKey(options));
    };
  });
}

export async function loadPersistedHistory<T>(
  options?: HistoryPersistenceOptions
): Promise<ReplayHistory<T>> {
  return (await readIndexedDbHistory<T>(options)) ?? {};
}

export class HistoryPersistenceFlow<T> {
  private worker: Worker | null = null;
  private disabled = false;
  private warningLogged = false;

  constructor(
    private readonly getHistory: () => ReplayHistory<T>,
    private readonly options: HistoryPersistenceOptions | undefined
  ) {
    if (this.enabled && this.workerEnabled) {
      this.worker = this.createWorker();
    }
  }

  resetRoom(roomId: string, stack: ReplayStack<T>): void {
    this.postToWorker({ type: "resetRoom", roomId, stack });
  }

  setPlayerConfig(roomId: string, playerId: string, config: T | undefined): void {
    this.postToWorker({ type: "setPlayerConfig", roomId, playerId, config });
  }

  recordSnapshot(roomId: string, frame: number, hash: string, snapshot: any): void {
    this.postToWorker({ type: "recordSnapshot", roomId, frame, hash, snapshot });
  }

  recordFrame(roomId: string, playerId: string, frame: Frame): void {
    this.postToWorker({ type: "recordFrame", roomId, playerId, frame });
  }

  persistIfDue(frame: number): void {
    if (frame % this.persistIntervalFrames === 0) {
      this.persist();
    }
  }

  persist(): void {
    if (!this.enabled || this.disabled) {
      return;
    }
    if (this.worker) {
      this.postToWorker({ type: "persist" });
      return;
    }
    void this.persistOnMainThread();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private get enabled(): boolean {
    return optionsEnabled(this.options);
  }

  private get workerEnabled(): boolean {
    return this.options !== false && this.options?.worker !== false;
  }

  private get persistIntervalFrames(): number {
    return Math.max(
      1,
      this.options === false
        ? DEFAULT_HISTORY_PERSIST_INTERVAL_FRAMES
        : this.options?.persistIntervalFrames ?? DEFAULT_HISTORY_PERSIST_INTERVAL_FRAMES
    );
  }

  private get workerOptions(): Record<string, unknown> {
    const options = this.options === false ? undefined : this.options;
    return {
      storageKey: options?.storageKey ?? DEFAULT_STORAGE_KEY,
      indexedDbName: options?.indexedDbName ?? DEFAULT_INDEXED_DB_NAME,
      indexedDbStore: options?.indexedDbStore ?? DEFAULT_INDEXED_DB_STORE,
      maxSerializedCharacters: options?.maxSerializedCharacters ?? 0,
    };
  }

  private createWorker(): Worker | null {
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
      return null;
    }
    try {
      const blob = new Blob([HISTORY_WORKER_SOURCE], { type: "text/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl, { name: "yage-history-persistence" });
      URL.revokeObjectURL(workerUrl);
      worker.onmessage = (event) => {
        if (event.data?.type === "disabled") {
          this.worker?.terminate();
          this.worker = null;
          this.warn(`worker disabled: ${event.data.reason}`, event.data.error);
        }
      };
      worker.onerror = (event) => {
        this.worker?.terminate();
        this.worker = null;
        this.warn("worker error", event.message);
      };
      worker.postMessage({ type: "configure", options: this.workerOptions });
      return worker;
    } catch (error) {
      this.warn("worker could not start", error);
      return null;
    }
  }

  private postToWorker(message: Record<string, unknown>): void {
    if (!this.enabled || this.disabled || !this.worker) {
      return;
    }
    try {
      this.worker.postMessage(message);
    } catch (error) {
      this.worker.terminate();
      this.worker = null;
      this.warn("worker postMessage failed", error);
    }
  }

  private async persistOnMainThread(): Promise<void> {
    try {
      await writeIndexedDbHistory(this.getHistory(), this.options);
    } catch (error) {
      this.disable("indexedDB rejected history", error);
    }
  }

  private disable(reason: string, error?: unknown): void {
    this.disabled = true;
    this.warn(reason, error);
  }

  private warn(reason: string, error?: unknown): void {
    if (this.warningLogged) {
      return;
    }
    this.warningLogged = true;
    console.warn(`[yage] Replay history persistence disabled: ${reason}`, error ?? "");
  }
}
