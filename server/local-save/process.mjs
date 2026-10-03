import { chmod, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { atomicWrite } from '../saves/storage.mjs';
import { startSaveServer } from '../saves/run.mjs';
import { startDailyBackups } from './schedule.mjs';

const script = fileURLToPath(import.meta.url);
export const defaultRoot = fileURLToPath(new URL('../../.local/save-server/', import.meta.url));
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const failed = message => ({ ok: false, error: message });

export async function initialize(root = defaultRoot, port = 3001) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) return failed('Port must be an integer from 0 to 65535.');
    try {
        root = resolve(root);
        for (const directory of [root, join(root, 'data'), join(root, 'backups')]) {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            await chmod(directory, 0o700);
        }
        const file = await open(join(root, 'operator.json'), 'wx', 0o600).catch(error => {
            if (error.code === 'EEXIST') return null;
            throw error;
        });
        if (file) {
            await file.writeFile(JSON.stringify({ operatorCredential: randomBytes(32).toString('base64url') }));
            await file.sync();
            await file.close();
        }
        await chmod(join(root, 'operator.json'), 0o600);
        try { await readFile(join(root, 'config.json')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await atomicWrite(join(root, 'config.json'), JSON.stringify({ port }));
        }
        await chmod(join(root, 'config.json'), 0o600);
        return { ok: true, root };
    } catch { return failed('Cannot initialize private local save storage.'); }
}

/** Verify the command before signalling a PID; a stale PID can belong to another program. */
export async function status(root = defaultRoot) {
    root = resolve(root);
    let info;
    try { info = JSON.parse(await readFile(join(root, 'process.json'), 'utf8')); }
    catch (error) {
        if (error.code === 'ENOENT') return { ok: true, running: false, root };
        return failed('Cannot read local process metadata.');
    }
    try {
        process.kill(info.pid, 0);
        const args = (await readFile(`/proc/${info.pid}/cmdline`, 'utf8')).split('\0');
        if (!args.includes(script) || !args.includes('run') || !args.includes(root)) return failed('Stored PID does not identify this local save process; no signal was sent.');
        return { ok: true, running: true, ...info, root };
    } catch (error) {
        if (error.code === 'ESRCH' || error.code === 'ENOENT') return { ok: true, running: false, root };
        return failed('Cannot verify local save process identity.');
    }
}

export async function start(root = defaultRoot) {
    root = resolve(root);
    const current = await status(root);
    if (!current.ok || current.running) return current;
    try {
        // Config/credential files must exist before detaching a persistent child.
        await readFile(join(root, 'config.json'));
        await readFile(join(root, 'operator.json'));
        const log = await open(join(root, 'server.log'), 'a', 0o600);
        await chmod(join(root, 'server.log'), 0o600);
        const child = spawn(process.execPath, [script, 'run', root], { detached: true, stdio: ['ignore', log.fd, log.fd] });
        let spawnError = false;
        child.on('error', () => { spawnError = true; });
        child.unref();
        await log.close();
        for (let attempt = 0; attempt < 50; attempt++) {
            await pause();
            if (spawnError) break;
            const ready = await status(root);
            if (ready.ok && ready.running) return ready;
            if (child.exitCode !== null) break;
        }
        return failed('Local save startup did not complete; inspect the private server.log.');
    } catch { return failed('Initialize storage before starting the local save process.'); }
}

export async function stop(root = defaultRoot) {
    const current = await status(root);
    if (!current.ok || !current.running) return current;
    try {
        process.kill(current.pid, 'SIGTERM');
        for (let attempt = 0; attempt < 50; attempt++) {
            await pause();
            const stopped = await status(root);
            if (stopped.ok && !stopped.running) return stopped;
        }
        return failed('Save process has not stopped; inspect the private server.log.');
    } catch { return failed('Cannot stop the verified local save process.'); }
}

async function run(root) {
    const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'));
    const { operatorCredential } = JSON.parse(await readFile(join(root, 'operator.json'), 'utf8'));
    // config.json may set `host` (e.g. this computer's LAN address) so family devices can reach the server; default is loopback only.
    const host = typeof config.host === 'string' && config.host ? config.host : '127.0.0.1';
    const result = await startSaveServer({ directory: join(root, 'data'), operatorCredential, port: config.port, host });
    if (!result.ok) { console.error(result.error.message); process.exitCode = 1; return; }
    const schedule = await startDailyBackups(root, { intervalMs: config.backupIntervalMs });
    if (!schedule.ok) { await result.close(); console.error(schedule.error); process.exitCode = 1; return; }
    const url = `http://${host}:${result.server.address().port}`;
    try { await atomicWrite(join(root, 'process.json'), JSON.stringify({ pid: process.pid, url, backupIntervalMs: schedule.intervalMs })); }
    catch { await schedule.stop(); await result.close(); console.error('Cannot write private process metadata; the server was stopped.'); process.exitCode = 1; return; }
    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true;
        await schedule.stop();
        await result.close();
        await unlink(join(root, 'process.json'));
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    console.log(`Local save API ready at ${url}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
    const [action, directory = defaultRoot, port = '3001'] = process.argv.slice(2);
    try {
        if (action === 'run') await run(resolve(directory));
        else {
            const result = action === 'init' ? await initialize(directory, Number(port)) : action === 'start' ? await start(directory) : action === 'stop' ? await stop(directory) : action === 'status' ? await status(directory) : failed('Usage: process.mjs init|start|stop|status [PRIVATE_DIRECTORY] [PORT]');
            console.log(JSON.stringify(result));
            if (!result.ok) process.exitCode = 1;
        }
    } catch { console.error('Local save operation failed; inspect private configuration and logs.'); process.exitCode = 1; }
}
