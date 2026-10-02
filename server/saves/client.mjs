import { io } from 'socket.io-client';

export const createSaveSocket = url => io(url, { transports: ['websocket'] });

/** Local document sequence/checksum stay unchanged; serverSeq is the last acknowledged remote CAS sequence. */
export async function putCareerDocument(socket, { familyId, gameId, credential, serverSeq }, document) {
    if (!document || typeof document.careerId !== 'string' || !Number.isSafeInteger(document.version)
        || !Number.isSafeInteger(serverSeq) || serverSeq < 0) {
        return { ok: false, error: { code: 'invalid_request', message: 'A career document and last acknowledged serverSeq are required.' } };
    }
    try {
        return await socket.timeout(10000).emitWithAck('save:request', {
            action: 'putCareer', input: { familyId, gameId, credential, careerId: document.careerId, version: document.version, seq: serverSeq, doc: document },
        });
    } catch { return { ok: false, error: { code: 'connection_error', message: 'The server did not acknowledge this save. Keep the local copy and retry with the same server sequence.' } }; }
}
