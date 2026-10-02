/**
 * Theme-agnostic shared-wallet authority: one integer balance and one globally ordered, numbered event log.
 * Every room spends through it, so two rooms can never spend the same money, and every command carries an
 * idempotency key so a retried request returns its original result instead of charging twice.
 */
const fail = (code, message) => ({ ok: false, error: { code, message } });
const amountValid = value => Number.isSafeInteger(value) && value > 0;
const keyValid = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const KINDS = ['credit', 'debit'];
const fingerprint = command => JSON.stringify([command.kind, command.amount, command.roomId, command.personId, command.reason]);

export class CareerLedger {
    /** @param {{ balance?: number, seq?: number, maxBalance?: number, baseBalance?: number, events?: object[], results?: object }} [state] */
    constructor({ balance = 0, seq = 0, maxBalance = Number.MAX_SAFE_INTEGER, baseBalance, events = [], results = {} } = {}) {
        this.balance = balance; this.seq = seq; this.maxBalance = maxBalance;
        // Balance before the first retained event; replaying the log from it must reach the current balance.
        this.baseBalance = baseBalance ?? balance;
        this.events = events.map(event => ({ ...event }));
        this.results = new Map(Object.entries(results).map(([id, value]) => [id, { ...value }]));
    }

    /**
     * Restore from a snapshot only after a total check; returns errors as values. Replay catches inconsistent edits;
     * the storage layer's checksummed envelope guards against a coordinated forgery of several fields.
     */
    static restore(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return fail('invalid_snapshot', 'Ledger snapshot must be an object.');
        const { balance, seq, maxBalance, baseBalance, events, results } = snapshot;
        if (!Number.isSafeInteger(maxBalance) || maxBalance < 0 || !Number.isSafeInteger(balance) || balance < 0 || balance > maxBalance
            || !Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(baseBalance) || baseBalance < 0 || baseBalance > maxBalance
            || !Array.isArray(events) || !results || typeof results !== 'object' || Array.isArray(results))
            return fail('invalid_snapshot', 'Ledger balance, sequence, events or results are invalid.');
        // The event log must replay exactly to the stored balance and sequence, so a tampered snapshot cannot mint money.
        let replay = baseBalance, expected = events.length ? events[0].seq : seq + 1;
        for (const event of events) {
            if (!event || event.seq !== expected++ || !KINDS.includes(event.kind) || !amountValid(event.amount) || !keyValid(event.id)
                || !Number.isSafeInteger(event.balanceAfter) || event.balanceAfter < 0 || event.balanceAfter > maxBalance) return fail('invalid_snapshot', 'Ledger events are out of order or malformed.');
            replay += event.kind === 'credit' ? event.amount : -event.amount;
            if (replay !== event.balanceAfter) return fail('invalid_snapshot', 'Ledger events do not replay to their balances.');
        }
        if (replay !== balance || events.length && events.at(-1).seq !== seq) return fail('invalid_snapshot', 'Ledger head does not match its event log.');
        for (const [id, result] of Object.entries(results))
            if (!keyValid(id) || !result || typeof result.fingerprint !== 'string' || typeof result.ok !== 'boolean') return fail('invalid_snapshot', 'Ledger command results are malformed.');
        return { ok: true, value: new CareerLedger({ balance, seq, maxBalance, baseBalance, events, results }) };
    }

    snapshot() {
        return { balance: this.balance, seq: this.seq, maxBalance: this.maxBalance, baseBalance: this.baseBalance, events: this.events.map(event => ({ ...event })),
            results: Object.fromEntries([...this.results].map(([id, value]) => [id, { ...value }])) };
    }

    /**
     * Apply one credit or debit in global order. A debit never overdraws; a credit never exceeds maxBalance.
     * Repeating an id with the same contents returns the first result; reusing it for different contents is refused.
     */
    apply(command) {
        if (!command || typeof command !== 'object' || !keyValid(command.id) || !KINDS.includes(command.kind) || !amountValid(command.amount)
            || !keyValid(command.roomId) || !keyValid(command.personId) || typeof command.reason !== 'string' || command.reason.length > 64)
            return fail('invalid_command', 'Ledger commands need an id, credit/debit kind, positive whole amount, room, person and short reason.');
        const print = fingerprint(command), prior = this.results.get(command.id);
        if (prior) return prior.fingerprint === print ? prior.result : fail('duplicate_id', 'This command id was already used for a different request.');
        let result;
        if (command.kind === 'debit' && command.amount > this.balance) result = fail('insufficient_funds', 'The shared wallet cannot cover this purchase.');
        else if (command.kind === 'credit' && command.amount > this.maxBalance - this.balance) result = fail('balance_limit', 'The shared wallet is at its safe limit.');
        else {
            this.balance += command.kind === 'credit' ? command.amount : -command.amount;
            const event = { seq: ++this.seq, id: command.id, kind: command.kind, amount: command.amount, roomId: command.roomId, personId: command.personId, reason: command.reason, balanceAfter: this.balance };
            this.events.push(event);
            result = { ok: true, value: { ...event } };
        }
        // Refusals are remembered too, so a retried purchase cannot succeed later after someone else spent.
        this.results.set(command.id, { fingerprint: print, ok: result.ok, result });
        return result;
    }

    /** Numbered events after a room's last applied sequence, for exactly-once catch-up. */
    eventsSince(seq) {
        if (!Number.isSafeInteger(seq) || seq < 0) return fail('invalid_request', 'Supply the last applied sequence.');
        const first = this.events[0]?.seq ?? this.seq + 1;
        if (seq < first - 1) return fail('compacted', 'Those events were compacted; reload the career snapshot.');
        return { ok: true, value: this.events.filter(event => event.seq > seq).map(event => ({ ...event })) };
    }

    /** Drop events every room has acknowledged; results are kept so retries stay idempotent. */
    compact(throughSeq) {
        if (!Number.isSafeInteger(throughSeq) || throughSeq < 0 || throughSeq > this.seq) return fail('invalid_request', 'Compact only through an applied sequence.');
        const dropped = this.events.filter(event => event.seq <= throughSeq);
        if (dropped.length) this.baseBalance = dropped.at(-1).balanceAfter;
        this.events = this.events.filter(event => event.seq > throughSeq);
        return { ok: true, value: { seq: this.seq, retained: this.events.length } };
    }
}
