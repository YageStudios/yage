import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSaveSocket } from '../saves/client.mjs';
import { atomicWrite, decode } from '../saves/storage.mjs';
import { startSaveServer } from '../saves/run.mjs';
import { defaultRoot, status } from './process.mjs';
import { backup } from './backup.mjs';
export { backup } from './backup.mjs';

const failed = message => ({ ok: false, error: message });
const request = (socket, action, input) => socket.timeout(5000).emitWithAck('save:request', { action, input });
const privateJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const stamp = () => new Date().toISOString().replaceAll(':', '-');

export async function setupFamily(root = defaultRoot) {
    root = resolve(root);
    const running = await status(root);
    if (!running.ok || !running.running) return failed('Start the local save process before setting up a family.');
    const familyPath = join(root, 'family.json');
    try {
        const family = await privateJSON(familyPath);
        return { ok: true, familyId: family.familyId, familyPath };
    } catch (error) {
        if (error.code !== 'ENOENT') return failed('Cannot read the private family credential file.');
    }
    const socket = createSaveSocket(running.url);
    try {
        const { operatorCredential } = await privateJSON(join(root, 'operator.json'));
        const result = await request(socket, 'createFamily', { operatorCredential });
        if (!result.ok) return failed(result.error.message);
        const family = { familyId: result.value.familyId, parentPersonId: result.value.personId,
            parentCredential: result.value.parentCredential, members: [{ personId: result.value.personId,
                displayName: 'Parent', avatar: 'parent', credential: result.value.memberCredential }] };
        await atomicWrite(familyPath, JSON.stringify(family, null, 2));
        return { ok: true, familyId: family.familyId, familyPath };
    } catch { return failed('Family setup failed; retain private credentials and check server availability.'); }
    finally { socket.disconnect(); }
}

export async function addMember(root = defaultRoot, displayName = 'Captain', avatar = 'fox') {
    root = resolve(root);
    const running = await status(root);
    if (!running.ok || !running.running) return failed('Start the local save process before creating a member.');
    const socket = createSaveSocket(running.url);
    try {
        const familyPath = join(root, 'family.json'), family = await privateJSON(familyPath);
        const result = await request(socket, 'createMember', { familyId: family.familyId, credential: family.parentCredential, displayName, avatar });
        if (!result.ok) return failed(result.error.message);
        family.members.push({ personId: result.value.personId, displayName, avatar, credential: result.value.credential });
        await atomicWrite(familyPath, JSON.stringify(family, null, 2));
        return { ok: true, personId: result.value.personId, familyPath };
    } catch { return failed('Member setup failed; check the private family file and server availability.'); }
    finally { socket.disconnect(); }
}

/** Exercise an actual restored server without replacing the live directory or game careers. */
export async function restoreCheck(root = defaultRoot) {
    root = resolve(root);
    const running = await status(root);
    if (!running.ok || !running.running) return failed('Start the local save process before the restore drill.');
    const socket = createSaveSocket(running.url);
    let restored, client;
    try {
        const family = await privateJSON(join(root, 'family.json'));
        const member = family.members.find(member => member.displayName === 'Captain') ?? family.members[0];
        const identity = { familyId: family.familyId, gameId: 'deployment-verification', personId: member.personId, credential: member.credential };
        const careerId = `deployment-check:${family.familyId}`;
        const careers = await request(socket, 'listCareers', identity);
        if (!careers.ok) return failed(careers.error.message);
        const career = careers.value.some(career => career.careerId === careerId)
            ? await request(socket, 'getCareer', { careerId, credential: member.credential })
            : await request(socket, 'putCareer', { ...identity, careerId, version: 1, seq: 0,
                doc: { purpose: 'Workstation backup verification; not gameplay progress.' } });
        if (!career.ok) return failed(career.error.message);
        const existing = await request(socket, 'getProfile', identity);
        if (!existing.ok) return failed(existing.error.message);
        if (existing.value === null) {
            const profile = await request(socket, 'putProfile', { ...identity, seq: 0, doc: { cosmetics: [], postcards: [], achievements: [] } });
            if (!profile.ok) return failed(profile.error.message);
        }
        const archived = await backup(root);
        if (!archived.ok) return archived;
        const text = await readFile(archived.backupPath, 'utf8'), snapshot = decode(text);
        const directory = join(root, 'restore-drills', stamp());
        await mkdir(join(root, 'restore-drills'), { recursive: true, mode: 0o700 });
        await mkdir(directory, { mode: 0o700 });
        await atomicWrite(join(directory, 'saves.json'), text);
        const credentials = await privateJSON(archived.credentialBackupPath);
        await atomicWrite(join(directory, 'credentials.json'), JSON.stringify(credentials));
        const restoredMember = credentials.family.members.find(saved => saved.personId === member.personId);
        const { operatorCredential } = credentials.operator;
        restored = await startSaveServer({ directory, operatorCredential, port: 0, host: '127.0.0.1' });
        if (!restored.ok) return failed(restored.error.message);
        client = createSaveSocket(`http://127.0.0.1:${restored.server.address().port}`);
        const careerCopy = await request(client, 'getCareer', { careerId, credential: restoredMember.credential });
        const profileCopy = await request(client, 'getProfile', { ...identity, credential: restoredMember.credential });
        const expectedCareer = snapshot.careers[careerId];
        const expectedProfile = snapshot.profiles[`${identity.gameId}:${member.personId}`];
        if (!careerCopy.ok || !profileCopy.ok || JSON.stringify(careerCopy.value) !== JSON.stringify(expectedCareer)
            || JSON.stringify(profileCopy.value) !== JSON.stringify(expectedProfile)) return failed('Restored career or profile differs from the archive.');
        let configuredCareerVerified = false;
        if (credentials.client) {
            const configured = await request(client, 'getCareer', { careerId: credentials.client.careerId, credential: credentials.client.credential });
            if (!configured.ok || JSON.stringify(configured.value) !== JSON.stringify(snapshot.careers[credentials.client.careerId])) return failed('Restored configured game career differs from the archive.');
            configuredCareerVerified = true;
        }
        const denied = await request(client, 'getCareer', { careerId, credential: 'invalid-credential' });
        if (denied.ok || denied.error.code !== 'unauthorized') return failed('Restored credential permissions failed.');
        return { ok: true, backupPath: archived.backupPath, credentialBackupPath: archived.credentialBackupPath, restoredDirectory: directory, careerId,
            careerSeq: careerCopy.value.seq, profileSeq: profileCopy.value.seq, configuredCareerVerified, restoredEndpoint: `http://127.0.0.1:${restored.server.address().port}`, drillServerStopped: true };
    } catch { return failed('Restore drill failed; inspect private files and server availability.'); }
    finally { socket.disconnect(); client?.disconnect(); if (restored?.ok) await restored.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [action, directory = defaultRoot, displayName = 'Captain', avatar = 'fox'] = process.argv.slice(2);
    const result = action === 'setup' ? await setupFamily(directory) : action === 'member' ? await addMember(directory, displayName, avatar)
        : action === 'backup' ? await backup(directory) : action === 'restore-check' ? await restoreCheck(directory)
            : failed('Usage: admin.mjs setup|member|backup|restore-check [PRIVATE_DIRECTORY] [MEMBER_NAME] [AVATAR]');
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
}
