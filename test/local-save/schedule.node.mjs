import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DAY, startDailyBackups } from '../../server/local-save/schedule.mjs';

async function privateRoot(t) {
    const root = await mkdtemp(join(tmpdir(), 'yage-daily-backup-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}
function clock(time = 1000) {
    const jobs = new Map(); let nextId = 0;
    return {
        time, jobs, now() { return this.time; },
        setTimer(callback, delay) { const id = nextId++; jobs.set(id, { callback, delay }); return id; },
        clearTimer(id) { jobs.delete(id); },
        async fire(time = this.time) { this.time = time; const [id, job] = jobs.entries().next().value; jobs.delete(id); await job.callback(); },
        options() { return { now: () => this.time, setTimer: this.setTimer.bind(this), clearTimer: this.clearTimer.bind(this) }; },
    };
}
const success = { ok: true, backupPath: '/private/archive.json', credentialBackupPath: '/private/archive-credentials.json' };
const scheduleState = async root => JSON.parse(await readFile(join(root, 'backup-schedule.json'), 'utf8'));

test('first start archives immediately and records a private daily deadline only after completion', async t => {
    const root = await privateRoot(t), time = clock(), calls = [];
    const schedule = await startDailyBackups(root, { ...time.options(), archive: async directory => { calls.push(directory); return success; } });
    assert.equal(schedule.ok, true); assert.equal(schedule.intervalMs, DAY);
    assert.equal(time.jobs.values().next().value.delay, 0);
    await time.fire();
    assert.deepEqual(calls, [root]);
    assert.deepEqual(await scheduleState(root), { lastSuccessAt: 1000, nextDueAt: 1000 + DAY, backupPath: success.backupPath, credentialBackupPath: success.credentialBackupPath });
    assert.equal((await stat(join(root, 'backup-schedule.json'))).mode & 0o777, 0o600);
    assert.equal(time.jobs.values().next().value.delay, DAY);
    await schedule.stop(); assert.equal(time.jobs.size, 0);
});

test('restart retains the deadline, catches up overdue work and never postpones daily protection', async t => {
    const root = await privateRoot(t), time = clock(), calls = [];
    const options = { ...time.options(), archive: async () => { calls.push(time.time); return success; }, intervalMs: 100 };
    let schedule = await startDailyBackups(root, options); await time.fire(); await schedule.stop();
    time.time = 1040;
    schedule = await startDailyBackups(root, options);
    assert.equal(time.jobs.values().next().value.delay, 60); await schedule.stop();
    time.time = 1200;
    schedule = await startDailyBackups(root, options);
    assert.equal(time.jobs.values().next().value.delay, 0); await time.fire();
    assert.deepEqual(calls, [1000, 1200]); assert.equal((await scheduleState(root)).nextDueAt, 1300);
    await schedule.stop();
});

test('failed archives retain the previous success and retry cadence across restart', async t => {
    const root = await privateRoot(t), time = clock(), errors = [];
    const options = { ...time.options(), intervalMs: 100, retryMs: 20, report: error => errors.push(error), archive: async () => ({ ok: false }) };
    let schedule = await startDailyBackups(root, options); await time.fire();
    assert.deepEqual(await scheduleState(root), { lastSuccessAt: 0, nextDueAt: 1020 });
    assert.equal(time.jobs.values().next().value.delay, 20); assert.equal(errors.length, 1);
    await schedule.stop(); time.time = 1010;
    schedule = await startDailyBackups(root, options);
    assert.equal(time.jobs.values().next().value.delay, 10);
    await time.fire(1020); assert.equal((await scheduleState(root)).nextDueAt, 1040);
    await schedule.stop();
});

test('thrown archive errors and schedule write failures are reported without leaking details', async t => {
    const root = await privateRoot(t), time = clock(), errors = [];
    const options = { ...time.options(), intervalMs: 100, retryMs: 20, report: message => errors.push(message), archive: async () => { throw Error('secret-detail'); } };
    let schedule = await startDailyBackups(root, options); await time.fire();
    assert.equal(time.jobs.values().next().value.delay, 20); assert.ok(!errors[0].includes('secret-detail'));
    await schedule.stop();
    schedule = await startDailyBackups(root, { ...options, archive: async () => success });
    await mkdir(join(root, 'backup-schedule.json'));
    await time.fire(1020);
    assert.equal(time.jobs.values().next().value.delay, 20); assert.equal(errors.length, 2);
    await schedule.stop();
});

test('stop clears pending timers and waits for an in-flight archive without scheduling an orphan', async t => {
    const root = await privateRoot(t), time = clock(); let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    const schedule = await startDailyBackups(root, { ...time.options(), archive: () => pending });
    const job = time.fire(); let stopped = false;
    const stopping = schedule.stop().then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false);
    complete(success); await job; await stopping;
    assert.equal(stopped, true); assert.equal(time.jobs.size, 0);
    assert.equal((await scheduleState(root)).lastSuccessAt, 1000);
    await schedule.stop();
});

test('a cancelled callback cannot archive after stop, and an early timer is rearmed', async t => {
    const root = await privateRoot(t), time = clock(); let calls = 0;
    let schedule = await startDailyBackups(root, { ...time.options(), intervalMs: 100, archive: async () => { calls++; return success; } });
    const cancelled = time.jobs.values().next().value.callback;
    await schedule.stop(); await cancelled(); assert.equal(calls, 0);
    schedule = await startDailyBackups(root, { ...time.options(), intervalMs: 100, archive: async () => { calls++; return success; } });
    await time.fire(); await time.fire(1050);
    assert.equal(calls, 1); assert.equal(time.jobs.values().next().value.delay, 50);
    await schedule.stop();
});

test('invalid cadence or private state fails explicitly before installing a timer', async t => {
    const root = await privateRoot(t), time = clock();
    for (const config of [{ intervalMs: 0 }, { intervalMs: DAY + 1 }, { retryMs: 0 }, { intervalMs: 10, retryMs: 11 }]) {
        assert.equal((await startDailyBackups(root, { ...time.options(), ...config })).ok, false);
    }
    for (const value of ['invalid', JSON.stringify({ lastSuccessAt: -1, nextDueAt: 1 }), JSON.stringify({ lastSuccessAt: 10, nextDueAt: 1 })]) {
        await writeFile(join(root, 'backup-schedule.json'), value);
        assert.equal((await startDailyBackups(root, time.options())).ok, false);
    }
    assert.equal(time.jobs.size, 0);
});
