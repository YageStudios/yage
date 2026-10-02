import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../saves/storage.mjs';
import { backup } from './backup.mjs';

export const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A single timer belongs to the server; completed archive cadence survives restarts. */
export async function startDailyBackups(root, {
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, archive = backup,
    intervalMs = DAY, retryMs = Math.min(HOUR, intervalMs), report = message => console.error(message),
} = {}) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > DAY
        || !Number.isSafeInteger(retryMs) || retryMs < 1 || retryMs > intervalMs) return { ok: false, error: 'Backup cadence must be positive and at most one day.' };
    const path = join(root, 'backup-schedule.json');
    let state = { lastSuccessAt: 0, nextDueAt: now() };
    try {
        state = JSON.parse(await readFile(path, 'utf8'));
        if (!Number.isSafeInteger(state.lastSuccessAt) || state.lastSuccessAt < 0
            || !Number.isSafeInteger(state.nextDueAt) || state.nextDueAt < state.lastSuccessAt) return { ok: false, error: 'Private backup schedule is invalid.' };
        if (state.lastSuccessAt > 0) state.nextDueAt = Math.min(state.nextDueAt, state.lastSuccessAt + intervalMs);
    } catch (error) {
        if (error.code !== 'ENOENT') return { ok: false, error: 'Cannot read private backup schedule.' };
    }
    let stopped = false, timer, active = Promise.resolve();
    const arm = () => {
        if (stopped) return;
        timer = setTimer(() => { timer = undefined; active = attempt(); return active; }, Math.min(DAY, Math.max(0, state.nextDueAt - now())));
    };
    const attempt = async () => {
        if (stopped) return;
        if (now() < state.nextDueAt) { arm(); return; }
        try {
            const result = await archive(root);
            if (!result.ok) {
                state.nextDueAt = now() + retryMs;
                await atomicWrite(path, JSON.stringify(state));
                report('Automatic save backup failed; a retry is scheduled.');
            } else {
                const completedAt = now();
                state = { lastSuccessAt: completedAt, nextDueAt: completedAt + intervalMs,
                    backupPath: result.backupPath, credentialBackupPath: result.credentialBackupPath };
                await atomicWrite(path, JSON.stringify(state));
            }
        } catch {
            state.nextDueAt = now() + retryMs;
            report('Automatic save backup or schedule persistence failed; a retry is scheduled.');
        }
        arm();
    };
    arm();
    return { ok: true, intervalMs,
        async stop() {
            stopped = true;
            if (timer !== undefined) clearTimer(timer);
            timer = undefined;
            await active;
        },
    };
}
