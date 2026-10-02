export type SaveResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export interface CareerRecord {
    familyId: string;
    gameId: string;
    careerId: string;
    version: number;
    seq: number;
    checksum: string;
    doc: unknown;
    updatedAt: number;
}
export interface SaveSocket {
    timeout(ms: number): { emitWithAck<T = unknown>(event: string, payload: unknown): Promise<SaveResult<T>> };
    disconnect(): void;
}
export function createSaveSocket(url: string): SaveSocket;
export function putCareerDocument(socket: SaveSocket, identity: { familyId: string; gameId: string; credential: string; serverSeq: number }, document: { careerId: string; version: number }): Promise<SaveResult<CareerRecord>>;
