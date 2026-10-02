import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initialize, start, stop, status } from '../../server/local-save/process.mjs';
import { setupFamily, addMember, backup, restoreCheck } from '../../server/local-save/admin.mjs';
import { decode } from '../../server/saves/storage.mjs';

const execute = promisify(execFile);
async function privateRoot(t, running = false) {
    const root = await mkdtemp(join(tmpdir(), 'yage-workstation-save-'));
    t.after(async () => { await stop(root); await rm(root, { recursive: true, force: true }); });
    assert.equal((await initialize(root, 0)).ok, true);
    if (running) assert.equal((await start(root)).ok, true);
    return root;
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));

test('initialization is private and idempotent without rotating credentials or configuration', async t => {
    const root = await privateRoot(t), before = await json(join(root, 'operator.json'));
    await chmod(root, 0o755);
    assert.equal((await initialize(root, 3008)).ok, true);
    assert.deepEqual(await json(join(root, 'operator.json')), before);
    assert.equal((await json(join(root, 'config.json'))).port, 0);
    for (const path of [root, join(root, 'data'), join(root, 'backups')]) assert.equal((await stat(path)).mode & 0o777, 0o700);
    for (const name of ['operator.json', 'config.json']) assert.equal((await stat(join(root, name))).mode & 0o777, 0o600);
    for (const port of [-1, 65536, 1.5]) assert.equal((await initialize(root, port)).ok, false);
});

test('uninitialized, unreadable and malformed process state returns explicit errors', async t => {
    const root = await privateRoot(t), missing = join(root, 'missing');
    assert.equal((await status(missing)).running, false);
    assert.equal((await stop(missing)).running, false);
    assert.equal((await start(missing)).ok, false);
    assert.equal((await setupFamily(missing)).ok, false);
    assert.equal((await addMember(missing)).ok, false);
    assert.equal((await restoreCheck(missing)).ok, false);
    assert.equal((await backup(missing)).ok, false);
    const file = join(root, 'file'); await writeFile(file, 'file');
    assert.equal((await initialize(file)).ok, false);
    await writeFile(join(root, 'process.json'), 'invalid');
    assert.equal((await status(root)).ok, false);
    assert.equal((await start(root)).ok, false);
});

test('a foreign live PID is never signalled and a dead PID is treated as stopped', async t => {
    const root = await privateRoot(t);
    await writeFile(join(root, 'process.json'), JSON.stringify({ pid: process.pid, url: 'http://127.0.0.1:1' }));
    assert.equal((await status(root)).ok, false);
    assert.equal((await stop(root)).ok, false);
    assert.equal((await start(root)).ok, false);
    await writeFile(join(root, 'process.json'), JSON.stringify({ pid: 2147483647 }));
    assert.equal((await status(root)).running, false);
});

test('detached process, credentials, authenticated backup restore and restart preserve accepted state', async t => {
    const root = await privateRoot(t, true), first = await status(root);
    assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await start(root)).pid, first.pid);
    assert.equal((await setupFamily(root)).ok, true);
    const original = await json(join(root, 'family.json'));
    assert.equal((await setupFamily(root)).familyId, original.familyId);
    const member = await addMember(root); assert.equal(member.ok, true);
    const family = await json(join(root, 'family.json'));
    assert.equal(family.members.length, 2);
    assert.equal(family.members[1].credential.length, 43);
    assert.equal(family.parentCredential, original.parentCredential);
    assert.equal((await stat(join(root, 'family.json'))).mode & 0o777, 0o600);
    await writeFile(join(root, 'client.json'), JSON.stringify({ url: first.url, familyId: family.familyId, credential: family.members[1].credential, careerId: `deployment-check:${family.familyId}` }));
    const drill = await restoreCheck(root); assert.equal(drill.ok, true, drill.error);
    assert.equal(drill.drillServerStopped, true);
    assert.equal(drill.configuredCareerVerified, true);
    assert.equal(drill.careerSeq, 1); assert.equal(drill.profileSeq, 1);
    assert.equal((await stat(drill.restoredDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(drill.credentialBackupPath)).mode & 0o777, 0o600);
    const credentialCopy = await json(drill.credentialBackupPath);
    assert.equal(credentialCopy.family.members[1].credential, family.members[1].credential);
    assert.equal(credentialCopy.client.credential, family.members[1].credential);
    assert.equal((await stat(join(root, 'backups'))).mode & 0o777, 0o700);
    const snapshot = decode(await readFile(drill.backupPath, 'utf8'));
    assert.equal(snapshot.careers[drill.careerId].seq, 1);
    assert.deepEqual(decode(await readFile(join(drill.restoredDirectory, 'saves.json'), 'utf8')), snapshot);
    for (const secret of [family.parentCredential, ...family.members.map(member => member.credential)]) {
        assert.ok(!(await readFile(drill.backupPath, 'utf8')).includes(secret));
        assert.ok(!(await readFile(join(root, 'server.log'), 'utf8')).includes(secret));
    }
    assert.equal((await restoreCheck(root)).ok, true);
    const clientPath = join(root, 'client.json'), config = await json(clientPath);
    await writeFile(clientPath, JSON.stringify({ ...config, credential: 'invalid-credential' }));
    assert.equal((await restoreCheck(root)).ok, false);
    await writeFile(clientPath, JSON.stringify(config));
    assert.equal((await backup(root)).ok, true);
    assert.equal((await stop(root)).running, false);
    assert.equal((await start(root)).ok, true);
    const again = await restoreCheck(root); assert.equal(again.ok, true, again.error);
    assert.equal(again.careerSeq, 1); assert.equal(again.profileSeq, 1);
    assert.deepEqual(await json(join(root, 'family.json')), family);
});

test('family administration refuses malformed private files, bad credentials and invalid member details', async t => {
    const root = await privateRoot(t, true);
    assert.equal((await addMember(root)).ok, false);
    const operatorPath = join(root, 'operator.json'), operator = await readFile(operatorPath, 'utf8');
    await writeFile(operatorPath, 'invalid');
    assert.equal((await setupFamily(root)).ok, false);
    await writeFile(operatorPath, JSON.stringify({ operatorCredential: 'wrong' }));
    assert.equal((await setupFamily(root)).ok, false);
    await writeFile(operatorPath, operator);
    assert.equal((await setupFamily(root)).ok, true);
    assert.equal((await addMember(root, '', 'fox')).ok, false);
    const familyPath = join(root, 'family.json'), family = await json(familyPath);
    await writeFile(familyPath, 'invalid');
    assert.equal((await setupFamily(root)).ok, false);
    assert.equal((await addMember(root)).ok, false);
    assert.equal((await restoreCheck(root)).ok, false);
    assert.equal((await backup(root)).ok, false);
    await writeFile(familyPath, JSON.stringify({ ...family, parentCredential: 'wrong', members: family.members.map(member => ({ ...member, credential: 'wrong' })) }));
    assert.equal((await addMember(root)).ok, false);
    assert.equal((await restoreCheck(root)).ok, false);
    await writeFile(familyPath, JSON.stringify(family));
    await writeFile(join(root, 'client.json'), 'invalid');
    assert.equal((await backup(root)).ok, false);
});

test('startup failure exits cleanly with no credential disclosure or surviving writer lock', async t => {
    const root = await privateRoot(t);
    await writeFile(join(root, 'operator.json'), JSON.stringify({ operatorCredential: 'short' }));
    assert.equal((await start(root)).ok, false);
    assert.equal((await status(root)).running, false);
    assert.ok(!(await readFile(join(root, 'server.log'), 'utf8')).includes('short'));
    await assert.rejects(stat(join(root, 'data', 'writer.lock')), { code: 'ENOENT' });
});

test('documented CLI commands work and print metadata without credentials', async t => {
    const root = await privateRoot(t);
    const processCLI = action => execute(process.execPath, ['server/local-save/process.mjs', action, root]);
    const adminCLI = action => execute(process.execPath, ['server/local-save/admin.mjs', action, root]);
    assert.equal(JSON.parse((await processCLI('init')).stdout).ok, true);
    assert.equal(JSON.parse((await processCLI('start')).stdout).running, true);
    assert.equal(JSON.parse((await processCLI('status')).stdout).running, true);
    assert.equal(JSON.parse((await adminCLI('setup')).stdout).ok, true);
    assert.equal(JSON.parse((await adminCLI('member')).stdout).ok, true);
    assert.equal(JSON.parse((await adminCLI('backup')).stdout).ok, true);
    const drill = await adminCLI('restore-check'); assert.match(drill.stdout, /"ok":true/);
    for (const secret of (await json(join(root, 'family.json'))).members.map(member => member.credential)) assert.ok(!drill.stdout.includes(secret));
    assert.equal(JSON.parse((await processCLI('stop')).stdout).running, false);
    await assert.rejects(processCLI('invalid'));
    await assert.rejects(adminCLI('invalid'));
    await writeFile(join(root, 'config.json'), 'invalid');
    await assert.rejects(processCLI('run'));
    await writeFile(join(root, 'config.json'), JSON.stringify({ port: 0 }));
    await mkdir(join(root, 'process.json'));
    await assert.rejects(processCLI('run'));
    await assert.rejects(stat(join(root, 'data', 'writer.lock')), { code: 'ENOENT' });
});

test('managed server automatically archives private companions, preserves cadence and stops its timer', async t => {
    const root = await privateRoot(t);
    await writeFile(join(root, 'config.json'), JSON.stringify({ port: 0, backupIntervalMs: 1000 }));
    assert.equal((await start(root)).ok, true);
    assert.equal((await status(root)).backupIntervalMs, 1000);
    assert.equal((await setupFamily(root)).ok, true);
    assert.equal((await addMember(root)).ok, true);
    const schedulePath = join(root, 'backup-schedule.json');
    const waitForArchive = async previous => {
        for (let i = 0; i < 100; i++) {
            const schedule = await json(schedulePath).catch(() => null);
            if (schedule?.backupPath && schedule.lastSuccessAt > previous) return schedule;
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.fail('Automatic archive did not complete within the isolated test window.');
    };
    const first = await waitForArchive(0);
    const data = decode(await readFile(first.backupPath, 'utf8'));
    const companion = await json(first.credentialBackupPath);
    assert.ok(data.families[companion.family.familyId]);
    assert.equal(companion.family.members.length, 2);
    assert.equal((await stat(first.credentialBackupPath)).mode & 0o777, 0o600);
    assert.equal(first.nextDueAt - first.lastSuccessAt, 1000);
    assert.equal((await stop(root)).running, false);
    const beforeRestart = await json(schedulePath);
    assert.equal((await start(root)).ok, true);
    if (Date.now() < beforeRestart.nextDueAt) assert.equal((await json(schedulePath)).nextDueAt, beforeRestart.nextDueAt);
    assert.equal((await stop(root)).running, false);
    const stopped = await json(schedulePath);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.deepEqual(await json(schedulePath), stopped);
    assert.equal((await start(root)).ok, true);
    const caughtUp = await waitForArchive(stopped.lastSuccessAt);
    assert.equal(caughtUp.nextDueAt - caughtUp.lastSuccessAt, 1000);
    assert.equal((await stop(root)).running, false);
});

test('invalid automatic cadence refuses a healthy process claim and releases the writer lock', async t => {
    const root = await privateRoot(t);
    await writeFile(join(root, 'config.json'), JSON.stringify({ port: 0, backupIntervalMs: 86400001 }));
    assert.equal((await start(root)).ok, false);
    assert.equal((await status(root)).running, false);
    await assert.rejects(stat(join(root, 'data', 'writer.lock')), { code: 'ENOENT' });
});
