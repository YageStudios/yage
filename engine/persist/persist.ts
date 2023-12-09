import { assignGlobalSingleton } from "@/global";

/* eslint-disable @typescript-eslint/no-explicit-any */
export class Persist {
  private static _instance: Persist;
  public indexedDB: IndexedDB;

  public async init(): Promise<void> {
    this.indexedDB = new IndexedDB("persist");
    await this.indexedDB.init("persist");
    return Promise.resolve();
  }

  public static getInstance(): Persist {
    return assignGlobalSingleton("PersistInstance", () => new Persist());
  }

  public set(key: string, value: any): Promise<void> {
    return this.indexedDB.saveObject(key.toLocaleLowerCase(), JSON.stringify(value));
  }

  public async get(key: string): Promise<any> {
    const res = await this.indexedDB.getObject(key.toLocaleLowerCase());
    return JSON.parse(res);
  }

  public async remove(key: string): Promise<void> {
    return this.indexedDB.deleteObject(key.toLocaleLowerCase());
  }

  public async listKeys(): Promise<string[]> {
    return this.indexedDB.listKeys();
  }
}
class IndexedDB {
  db: IDBDatabase;
  storeName: string;

  constructor(storeName: string) {
    this.storeName = storeName;
  }

  init(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(name, 1);
      request.onerror = (evt: any) => {
        console.log("IndexedDB error: " + evt.target.errorCode);
        reject(evt.target.errorCode);
      };
      request.onsuccess = (evt: any) => {
        this.db = evt.target.result;
        console.log("IndexedDB init success.");
        resolve(evt.target.result);
      };
      request.onupgradeneeded = (evt: any) => {
        // Create an objectStore for this database
        const objectStore = evt.currentTarget.result.createObjectStore(this.storeName, { keyPath: "key" });
        objectStore.createIndex("key", "key", { unique: true });
      };
    });
  }

  listKeys(): Promise<any> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readonly");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAllKeys();

      request.onsuccess = (evt: any) => {
        console.log("List keys success: " + evt.target.result);
        resolve(evt.target.result);
      };

      request.onerror = (evt: any) => {
        console.log("List keys error: " + evt.target.errorCode);
        reject(evt.target.errorCode);
      };
    });
  }

  listObjects(): Promise<any> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readonly");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAll();

      request.onsuccess = (evt: any) => {
        console.log("List objects success: " + evt.target.result);
        resolve(evt.target.result);
      };

      request.onerror = (evt: any) => {
        console.log("List objects error: " + evt.target.errorCode);
        reject(evt.target.errorCode);
      };
    });
  }

  saveObject(key: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.put({ key, data });

      request.onsuccess = (evt: any) => {
        console.log("Save object success: " + evt.target.result);
        resolve(evt.target.result);
      };

      request.onerror = (evt: any) => {
        console.log("Save object error: " + evt.target.errorCode);
        reject(evt.target.errorCode);
      };
    });
  }

  getObject(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readonly");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(key);

      request.onsuccess = (evt: any) => {
        console.log("Get object success: " + evt.target.result);
        resolve(evt.target.result?.data);
      };

      request.onerror = (evt: any) => {
        console.log("Get object error: " + evt.target.errorCode);
        reject(evt.target.errorCode);
      };
    });
  }

  deleteObject(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], "readwrite");
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.delete(key);

      request.onsuccess = (evt: any) => {
        console.log("Delete object success: " + evt.target.result);
        resolve(evt.target.result);
      };

      request.onerror = (evt: any) => {
        console.log("Delete object error: " + evt.target.errorCode);
        reject(evt.target.errorCode);
      };
    });
  }
}
