import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyDatabase = () => ({ families: {}, careers: {}, profiles: {}, slots: {}, uploads: {}, ledgers: {} });
const storageError = () => ({ ok: false, error: { code: 'storage_error', message: 'The save could not be durably stored. Retry after checking server storage.' } });

export function decode(text) {
    let envelope;
    try { envelope = JSON.parse(text); } catch { return null; }
    if (envelope.format !== 1 || !envelope.data || checksum(envelope.data) !== envelope.checksum
        || ['families', 'careers', 'profiles', 'slots', 'uploads'].some(key => !envelope.data[key] || typeof envelope.data[key] !== 'object' || Array.isArray(envelope.data[key]))) {
        return null;
    }
    // Databases written before shared-wallet ledgers existed simply have none yet.
    if (envelope.data.ledgers === undefined) envelope.data.ledgers = {};
    if (!envelope.data.ledgers || typeof envelope.data.ledgers !== 'object' || Array.isArray(envelope.data.ledgers)) return null;
    return envelope.data;
}
const encode = data => JSON.stringify({ format: 1, checksum: checksum(data), data });

/** Rename a synced private file, then sync the directory before acknowledging a write. */
export async function atomicWrite(path, text) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    let file;
    try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(text);
        await file.sync();
        await file.close();
        file = undefined;
        await rename(temporary, path);
        const directory = await open(join(path, '..'), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    } finally {
        if (file) await file.close();
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
}

/** One process owns this directory. All transactions share one ordered write queue. */
export class SaveStorage {
    constructor(directory, data, writer = atomicWrite) {
        this.directory = directory;
        this.path = join(directory, 'saves.json');
        this.data = data;
        this.writer = writer;
        this.queue = Promise.resolve();
    }
    static async open(directory, { writer = atomicWrite } = {}) {
        try {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const path = join(directory, 'saves.json');
            let data, missing = false, recovered = false;
            try { data = decode(await readFile(path, 'utf8')); }
            catch (error) { missing = error.code === 'ENOENT'; }
            if (!data) {
                let backupExists = false;
                for (let i = 1; i <= 3; i++) {
                    try {
                        const text = await readFile(join(directory, `backup-${i}.json`), 'utf8');
                        backupExists = true;
                        data = decode(text);
                        if (data) { recovered = true; break; }
                    } catch (error) { if (error.code !== 'ENOENT') backupExists = true; }
                }
                if (data) await atomicWrite(path, encode(data));
                else if (missing && !backupExists) data = emptyDatabase();
                else return { ok: false, error: { code: 'corrupt_storage', message: 'No valid database or retained backup. Restore a verified backup before starting.' } };
            }
            return { ok: true, storage: new SaveStorage(directory, data, writer), recovered };
        } catch { return storageError(); }
    }
    snapshot() { return structuredClone(this.data); }
    transact(change) {
        const run = async () => {
            const next = this.snapshot();
            let result;
            try { result = change(next); } catch { return storageError(); }
            // A failed result normally discards the change; `commit: true` persists it while still reporting the failure.
            if (!result.ok && result.commit !== true) return result;
            try {
                for (let i = 3; i >= 2; i--) {
                    try { await atomicWrite(join(this.directory, `backup-${i}.json`), await readFile(join(this.directory, `backup-${i - 1}.json`), 'utf8')); }
                    catch (error) { if (error.code !== 'ENOENT') throw error; }
                }
                await atomicWrite(join(this.directory, 'backup-1.json'), encode(this.data));
                await this.writer(this.path, encode(next));
                this.data = next;
                if (Object.hasOwn(result, 'commit')) { const { commit: _commit, ...plain } = result; return plain; }
                return result;
            } catch {
                // A rename may have succeeded before a directory-sync error. Re-read to keep CAS truthful.
                try { const committed = decode(await readFile(this.path, 'utf8')); if (committed) this.data = committed; } catch { /* Last acknowledged snapshot remains authoritative in memory. */ }
                return storageError();
            }
        };
        const result = this.queue.then(run);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
    async backup(path) {
        await this.queue;
        try { await atomicWrite(path, encode(this.data)); return { ok: true }; }
        catch { return storageError(); }
    }
    async restore(path) {
        let replacement;
        try { replacement = decode(await readFile(path, 'utf8')); }
        catch { replacement = null; }
        if (!replacement) return { ok: false, error: { code: 'invalid_backup', message: 'Backup is missing or its checksum is invalid.' } };
        return this.transact(next => { Object.assign(next, replacement); return { ok: true }; });
    }
}

/** Export an atomic committed snapshot without stopping the single writer. */
export async function copyVerifiedSnapshot(source, destination) {
    try {
        const data = decode(await readFile(source, 'utf8'));
        if (!data) return { ok: false, error: { code: 'invalid_backup', message: 'Snapshot checksum or format is invalid.' } };
        await atomicWrite(destination, encode(data));
        return { ok: true };
    }
    catch { return { ok: false, error: { code: 'invalid_backup', message: 'Snapshot is missing, corrupt or its destination cannot be written.' } }; }
}
