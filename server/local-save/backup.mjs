import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWrite, copyVerifiedSnapshot } from '../saves/storage.mjs';

const failed = message => ({ ok: false, error: message });
const privateJSON = async path => JSON.parse(await readFile(path, 'utf8'));

export async function backup(root) {
    root = resolve(root);
    const path = join(root, 'backups', `family-${new Date().toISOString().replaceAll(':', '-')}.json`);
    try {
        const credentials = { operator: await privateJSON(join(root, 'operator.json')), family: await privateJSON(join(root, 'family.json')) };
        try { credentials.client = await privateJSON(join(root, 'client.json')); }
        catch (error) { if (error.code !== 'ENOENT') return failed('Cannot read the private game connection configuration.'); }
        const result = await copyVerifiedSnapshot(join(root, 'data', 'saves.json'), path);
        if (!result.ok) return failed(result.error.message);
        const credentialBackupPath = path.replace(/\.json$/, '-credentials.json');
        await atomicWrite(credentialBackupPath, JSON.stringify(credentials));
        return { ok: true, backupPath: path, credentialBackupPath };
    } catch { return failed('Cannot create verified data and private credential backups.'); }
}

