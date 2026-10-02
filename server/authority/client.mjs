
const connectionError = { ok: false, error: { code: 'connection_error', message: 'The authority did not acknowledge this wallet request.' } };

/**
 * A room's view of the shared wallet. Each purchase gets one command id that is reused on every retry,
 * so a lost acknowledgement can never charge twice: the server returns the original result instead.
 */
export class WalletClient {
    constructor(socket, { careerId, credential, timeoutMs = 10000, attempts = 3, newId = () => globalThis.crypto.randomUUID() }) {
        Object.assign(this, { socket, careerId, credential, timeoutMs, attempts, newId });
    }
    async request(action, input) {
        try { return await this.socket.timeout(this.timeoutMs).emitWithAck('save:request', { action, input: { careerId: this.careerId, credential: this.credential, ...input } }); }
        catch { return connectionError; }
    }
    open(balance) { return this.request('ledgerOpen', { balance }); }
    since(seq) { return this.request('ledgerSince', { seq }); }
    /** Apply one credit or debit, retrying only lost acknowledgements with the same command id. */
    async apply({ kind, amount, roomId, personId, reason, id = this.newId() }) {
        const command = { id, kind, amount, roomId, personId, reason };
        let result = connectionError;
        for (let attempt = 0; attempt < this.attempts; attempt++) {
            result = await this.request('ledgerApply', { command });
            if (!result || typeof result !== 'object') result = connectionError;
            if (result.ok || result.error?.code !== 'connection_error') return { ...result, id };
        }
        return { ...result, id };
    }
    spend(amount, roomId, personId, reason) { return this.apply({ kind: 'debit', amount, roomId, personId, reason }); }
    collect(amount, roomId, personId, reason) { return this.apply({ kind: 'credit', amount, roomId, personId, reason }); }
}
