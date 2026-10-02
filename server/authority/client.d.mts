import type { SaveResult, SaveSocket } from '../saves/client.mjs';
export interface LedgerEvent { seq: number; id: string; kind: 'credit' | 'debit'; amount: number; roomId: string; personId: string; reason: string; balanceAfter: number }
export interface WalletCommand { kind: 'credit' | 'debit'; amount: number; roomId: string; personId: string; reason: string; id?: string }
export class WalletClient {
    constructor(socket: SaveSocket, options: { careerId: string; credential: string; timeoutMs?: number; attempts?: number; newId?: () => string });
    open(balance: number): Promise<SaveResult<{ careerId: string; balance: number; seq: number }>>;
    since(seq: number): Promise<SaveResult<{ balance: number; seq: number; events: LedgerEvent[] }>>;
    apply(command: WalletCommand): Promise<SaveResult<LedgerEvent> & { id: string }>;
    spend(amount: number, roomId: string, personId: string, reason: string): Promise<SaveResult<LedgerEvent> & { id: string }>;
    collect(amount: number, roomId: string, personId: string, reason: string): Promise<SaveResult<LedgerEvent> & { id: string }>;
}
