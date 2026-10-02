import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, copyVerifiedSnapshot, decode } from './storage.mjs';
import { acquireLock } from './run.mjs';

const [action, directory, path] = process.argv.slice(2);
if (!['backup', 'restore'].includes(action) || !directory || !path) {
    console.error('Usage: node server/saves/backup.mjs backup|restore DATA_DIRECTORY BACKUP_FILE');
    process.exitCode = 1;
} else {
    const target = resolve(directory), file = resolve(path);
    if (action === 'backup') {
        const result = await copyVerifiedSnapshot(join(target, 'saves.json'), file);
        if (!result.ok) { console.error(result.error.message); process.exitCode = 1; }
        else console.log('backup completed.');
    } else {
        await mkdir(target, { recursive: true, mode: 0o700 });
        const lock = await acquireLock(target);
        if (!lock.ok) { console.error(lock.error); process.exitCode = 1; }
        else {
            try {
                // Validate the archive before replacing any existing state. Restore also works after total data loss.
                const text = await readFile(file, 'utf8');
                if (!decode(text)) { console.error('Restore failed: archive checksum or format is invalid.'); process.exitCode = 1; }
                else { await atomicWrite(join(target, 'saves.json'), text); console.log('restore completed.'); }
            } catch { console.error('Restore failed: archive invalid or storage unavailable.'); process.exitCode = 1; }
            finally { await lock.release(); }
        }
    }
}
