import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { checksum } from './storage.mjs';
import { CareerLedger } from '../authority/ledger.mjs';

/** Retained ledger events per career; older acknowledged events compact away, retries stay idempotent. */
const LEDGER_EVENTS = 1000;

const fail = (code, message) => ({ ok: false, error: { code, message } });
const ok = value => ({ ok: true, value: structuredClone(value) });
const identifier = value => typeof value === 'string' && !['__proto__', 'constructor', 'prototype'].includes(value) && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const careerIdentifier = value => typeof value === 'string' && !['__proto__', 'constructor', 'prototype'].includes(value) && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const sequence = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const secret = () => randomBytes(32).toString('base64url');
const hashSecret = value => checksum(value);
const sameSecret = (value, expected) => typeof value === 'string' && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected)
    && timingSafeEqual(Buffer.from(hashSecret(value)), Buffer.from(expected));
const profileKey = (gameId, personId) => `${gameId}:${personId}`;

/** The only game-specific seam is an optional synchronous document validator. */
export class SaveService {
    constructor(storage, { operatorCredential, validators = {}, now = Date.now } = {}) {
        if (typeof operatorCredential !== 'string' || operatorCredential.length < 24) throw new Error('A private operator credential of at least 24 characters is required.');
        this.storage = storage;
        this.operatorHash = hashSecret(operatorCredential);
        this.validators = validators;
        this.now = now;
    }
    authorize(database, familyId, credential, parentOnly = false, personId) {
        const family = Object.hasOwn(database.families, familyId) ? database.families[familyId] : undefined;
        if (!family) return false;
        if (sameSecret(credential, family.parentHash)) return true;
        if (parentOnly) return false;
        return Object.values(family.members).some(member => (!personId || member.personId === personId) && sameSecret(credential, member.credentialHash));
    }
    validateDocument(gameId, version, doc) {
        if (!identifier(gameId) || !Number.isSafeInteger(version) || version < 1 || !object(doc)) return fail('invalid_document', 'Supply a game ID, positive version and JSON object document.');
        try {
            if (Buffer.byteLength(JSON.stringify(doc)) > 1024 * 1024) return fail('invalid_document', 'Document exceeds the 1 MiB limit.');
            const validator = Object.hasOwn(this.validators, gameId) ? this.validators[gameId] : undefined;
            if (validator && !validator(doc, version)) return fail('invalid_document', 'The game validator rejected this document.');
            return ok(doc);
        } catch { return fail('invalid_document', 'Document must be valid JSON accepted by its game validator.'); }
    }
    record(familyId, gameId, careerId, version, seq, doc) {
        return { familyId, gameId, careerId, version, seq, checksum: checksum(doc), doc: structuredClone(doc), updatedAt: this.now() };
    }
    async request(action, input = {}) {
        if (!object(input)) return fail('invalid_request', 'Request payload must be an object.');
        const data = this.storage.snapshot();
        if (action === 'createFamily') {
            if (!sameSecret(input.operatorCredential, this.operatorHash)) return fail('unauthorized', 'Operator credential required.');
            const familyId = randomUUID(), personId = randomUUID(), parentCredential = secret(), memberCredential = secret();
            const family = { familyId, parentHash: hashSecret(parentCredential), members: { [personId]: { personId, displayName: 'Parent', avatar: 'parent', credentialHash: hashSecret(memberCredential) } } };
            return this.storage.transact(next => { next.families[familyId] = family; return ok({ familyId, personId, parentCredential, memberCredential }); });
        }
        if (action === 'createMember') {
            if (!this.authorize(data, input.familyId, input.credential, true)) return fail('unauthorized', 'Parent credential required.');
            if (typeof input.displayName !== 'string' || !input.displayName.trim() || input.displayName.length > 32 || !identifier(input.avatar)) return fail('invalid_request', 'A parent-chosen display name (1–32 characters) and avatar ID are required.');
            const personId = randomUUID(), credential = secret();
            return this.storage.transact(next => {
                const family = next.families[input.familyId];
                if (Object.keys(family.members).length >= 8) return fail('member_limit', 'A family supports up to eight members.');
                family.members[personId] = { personId, displayName: input.displayName.trim(), avatar: input.avatar, credentialHash: hashSecret(credential) };
                return ok({ personId, credential });
            });
        }
        if (['getProfile', 'putProfile'].includes(action)) {
            if (!identifier(input.gameId) || !identifier(input.personId) || !this.authorize(data, input.familyId, input.credential, false, input.personId)
                || !data.families[input.familyId]?.members[input.personId]) return fail('unauthorized', 'Profile owner or parent credential required.');
            const key = profileKey(input.gameId, input.personId);
            if (action === 'getProfile') return ok(data.profiles[key] ?? null);
            const doc = input.doc;
            const fields = ['cosmetics', 'postcards', 'achievements', 'learningRef'];
            if (!object(doc) || Object.keys(doc).some(key => !fields.includes(key))
                || fields.slice(0, 3).some(key => !Array.isArray(doc[key]) || doc[key].length > 1000 || new Set(doc[key]).size !== doc[key].length || doc[key].some(item => !identifier(item)))
                || doc.learningRef !== undefined && !identifier(doc.learningRef)) return fail('invalid_profile', 'Profiles contain cosmetic, postcard and achievement IDs plus an optional local learning reference.');
            return this.storage.transact(next => {
                const prior = next.profiles[key];
                if (!sequence(input.seq) || input.seq !== (prior?.seq ?? 0)) return fail('stale_seq', 'Profile changed; fetch its current sequence.');
                const profile = { familyId: input.familyId, gameId: input.gameId, personId: input.personId, seq: input.seq + 1, checksum: checksum(doc), doc: structuredClone(doc), updatedAt: this.now() };
                next.profiles[key] = profile;
                return ok(profile);
            });
        }
        if (action === 'listCareers') {
            if (!this.authorize(data, input.familyId, input.credential)) return fail('unauthorized', 'Family credential required.');
            return ok(Object.values(data.careers).filter(career => career.familyId === input.familyId).map(career => { const metadata = { ...career }; delete metadata.doc; return metadata; }));
        }
        if (action === 'putCareer' && (!input.careerId || !Object.hasOwn(data.careers, input.careerId))) {
            if (!this.authorize(data, input.familyId, input.credential)) return fail('unauthorized', 'Family credential required.');
            const valid = this.validateDocument(input.gameId, input.version, input.doc);
            if (!valid.ok) return valid;
            if (input.seq !== 0) return fail('stale_seq', 'A new career starts at sequence zero.');
            if (input.careerId !== undefined && !careerIdentifier(input.careerId)) return fail('invalid_request', 'Career ID must be a stable identifier.');
            const careerId = input.careerId ?? randomUUID();
            return this.storage.transact(next => { if (Object.hasOwn(next.careers, careerId)) return fail('stale_seq', 'Career was created by another request.'); const career = this.record(input.familyId, input.gameId, careerId, input.version, 1, input.doc); next.careers[careerId] = career; return ok(career); });
        }
        const career = careerIdentifier(input.careerId) ? data.careers[input.careerId] : undefined;
        if (!career || !this.authorize(data, career.familyId, input.credential, ['deleteCareer', 'listSlots', 'promoteSlot'].includes(action))) return fail('unauthorized', 'Valid career and authorized family credential required.');
        if (action === 'getCareer') return ok(career);
        if (action === 'ledgerOpen') {
            if (!Number.isSafeInteger(input.balance) || input.balance < 0) return fail('invalid_request', 'Supply a whole nonnegative opening balance.');
            return this.storage.transact(next => {
                if (Object.hasOwn(next.ledgers, career.careerId)) return fail('ledger_exists', 'This career already has a shared wallet.');
                next.ledgers[career.careerId] = new CareerLedger({ balance: input.balance }).snapshot();
                return ok({ careerId: career.careerId, balance: input.balance, seq: 0 });
            });
        }
        if (action === 'ledgerApply' || action === 'ledgerSince') {
            const stored = data.ledgers[career.careerId];
            if (!stored) return fail('not_found', 'This career has no shared wallet yet.');
            if (action === 'ledgerSince') {
                const restored = CareerLedger.restore(stored);
                if (!restored.ok) return restored;
                const events = restored.value.eventsSince(input.seq);
                return events.ok ? ok({ balance: restored.value.balance, seq: restored.value.seq, events: events.value }) : events;
            }
            // One ordered writer: the ledger is re-read inside the transaction, so concurrent rooms serialize exactly.
            return this.storage.transact(next => {
                const restored = CareerLedger.restore(next.ledgers[career.careerId]);
                if (!restored.ok) return restored;
                const ledger = restored.value, applied = ledger.apply(input.command);
                if (ledger.seq > LEDGER_EVENTS) ledger.compact(ledger.seq - LEDGER_EVENTS);
                next.ledgers[career.careerId] = ledger.snapshot();
                // Refusals are remembered durably too, so a retry cannot succeed later; the request still reports the error.
                if (applied.ok) return ok(applied.value);
                return ['insufficient_funds', 'balance_limit'].includes(applied.error.code) ? { ...applied, commit: true } : applied;
            });
        }
        if (action === 'listSlots') return ok(Object.values(data.slots).filter(slot => slot.careerId === career.careerId));
        if (action === 'deleteCareer') return this.storage.transact(next => {
            delete next.careers[career.careerId];
            for (const [id, slot] of Object.entries(next.slots)) if (slot.careerId === career.careerId) delete next.slots[id];
            for (const [id, upload] of Object.entries(next.uploads)) if (upload.careerId === career.careerId) delete next.uploads[id];
            return ok({ careerId: career.careerId });
        });
        if (action === 'promoteSlot') return this.storage.transact(next => {
            const current = next.careers[career.careerId], slot = next.slots[input.slotId];
            if (!current) return fail('not_found', 'Career was deleted.');
            if (!slot || slot.careerId !== career.careerId) return fail('not_found', 'Offline slot does not belong to this career.');
            if (!sequence(input.seq) || input.seq !== current.seq) return fail('stale_seq', 'Career changed; review its current version before promotion.');
            next.careers[career.careerId] = this.record(current.familyId, current.gameId, current.careerId, slot.version, current.seq + 1, slot.doc);
            next.slots[input.slotId] = { ...current, slotId: input.slotId, label: 'Previous main', offlineSessionId: slot.offlineSessionId };
            return ok(next.careers[career.careerId]);
        });
        if (!['putCareer', 'putOfflineCopy'].includes(action)) return fail('invalid_request', 'Unknown save action.');
        const valid = this.validateDocument(career.gameId, input.version, input.doc);
        if (!valid.ok) return valid;
        if (action === 'putCareer') return this.storage.transact(next => {
            const current = next.careers[career.careerId];
            if (!current) return fail('not_found', 'Career was deleted.');
            if (!sequence(input.seq) || input.seq !== current.seq) return fail('stale_seq', 'Career changed; fetch its current sequence.');
            const updated = this.record(current.familyId, current.gameId, current.careerId, input.version, current.seq + 1, input.doc);
            next.careers[current.careerId] = updated;
            return ok(updated);
        });
        if (!sequence(input.baseSeq) || !identifier(input.offlineSessionId) || typeof input.label !== 'string' || input.label.length > 128) return fail('invalid_request', 'Offline copies require baseSeq, offlineSessionId and a short device/date/milestone label.');
        return this.storage.transact(next => {
            const current = next.careers[career.careerId];
            if (!current) return fail('not_found', 'Career was deleted.');
            if (input.baseSeq > current.seq) return fail('invalid_request', 'Offline baseSeq cannot be newer than the server career.');
            const uploadId = `${career.careerId}:${input.offlineSessionId}`;
            const fingerprint = checksum({ doc: input.doc, version: input.version, baseSeq: input.baseSeq });
            const prior = next.uploads[uploadId];
            if (prior) return prior.fingerprint === fingerprint ? ok(prior.result) : fail('offline_conflict', 'This offline session was already uploaded with different content.');
            let result;
            if (input.baseSeq === current.seq) {
                const updated = this.record(current.familyId, current.gameId, current.careerId, input.version, current.seq + 1, input.doc);
                next.careers[current.careerId] = updated;
                result = { status: 'fast_forward', career: updated };
            } else {
                const slotId = randomUUID(), slot = { ...this.record(current.familyId, current.gameId, current.careerId, input.version, input.baseSeq, input.doc), slotId, label: input.label, offlineSessionId: input.offlineSessionId };
                next.slots[slotId] = slot;
                result = { status: 'diverged', slot };
            }
            next.uploads[uploadId] = { careerId: career.careerId, fingerprint, result };
            return ok(result);
        });
    }
}
