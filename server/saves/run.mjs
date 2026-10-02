import { open, readFile, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import SocketIoGameServer from '../SocketIoGameServer.ts';
import { SaveStorage } from './storage.mjs';
import { SaveService } from './service.mjs';

/** Refuse a second writer. A dead PID lock is cleared after verifying its process exited. */
export async function acquireLock(directory) {
    const path = join(directory, 'writer.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const file = await open(path, 'wx', 0o600);
            await file.writeFile(String(process.pid));
            await file.close();
            return { ok: true, release: () => unlink(path) };
        } catch (error) {
            if (error.code !== 'EEXIST') return { ok: false, error: 'Cannot create storage writer lock.' };
            try {
                const pid = Number(await readFile(path, 'utf8'));
                if (!Number.isSafeInteger(pid) || pid < 1) return { ok: false, error: 'Writer lock is invalid; verify no process is using this directory before removing it.' };
                try { process.kill(pid, 0); return { ok: false, error: 'Another save process owns this directory.' }; }
                catch (probe) { if (probe.code !== 'ESRCH') return { ok: false, error: 'Cannot verify that the previous save process exited.' }; }
                await unlink(path);
            } catch { return { ok: false, error: 'Cannot read or clear the previous writer lock.' }; }
        }
    }
    return { ok: false, error: 'Another save process acquired the writer lock.' };
}

export async function startSaveServer({ directory, operatorCredential, port = 3001, host = '127.0.0.1', validators = {} }) {
    try { await mkdir(directory, { recursive: true, mode: 0o700 }); }
    catch { return { ok: false, error: { code: 'storage_error', message: 'Cannot create storage directory.' } }; }
    const lock = await acquireLock(directory);
    if (!lock.ok) return { ok: false, error: { code: 'writer_locked', message: lock.error } };
    const loaded = await SaveStorage.open(directory);
    if (!loaded.ok) { await lock.release(); return loaded; }
    let server;
    try {
        const service = new SaveService(loaded.storage, { operatorCredential, validators });
        server = new SocketIoGameServer(port, service, host);
        await server.ready();
        return { ok: true, server, service, storage: loaded.storage, recovered: loaded.recovered,
            async close() { await server.close(); await loaded.storage.queue; await lock.release(); } };
    } catch (error) {
        if (server) await server.close();
        await lock.release();
        return { ok: false, error: { code: 'startup_error', message: `Cannot start save server: ${error.message}` } };
    }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
    const result = await startSaveServer({ directory: resolve(process.env.YAGE_SAVE_DIR ?? './save-data'), operatorCredential: process.env.YAGE_SAVE_OPERATOR_CREDENTIAL,
        port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
    if (!result.ok) { console.error(result.error.message); process.exitCode = 1; }
    else {
        if (result.recovered) console.warn('Recovered the most recent checksum-verified retained backup. Review any lost unacknowledged work.');
        let closing = false;
        const close = async () => { if (closing) return; closing = true; await result.close(); };
        process.once('SIGINT', close);
        process.once('SIGTERM', close);
        console.log('Save API ready.');
    }
}
