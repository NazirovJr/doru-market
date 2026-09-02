/**
 * InMemory-заглушка `FullSyncCompletionPort` (EP-05, DTJ-148/151, SRS-INV-041).
 *
 * Только для R1-бутстрапа. Реальная Drizzle-реализация (set-based
 * `UPDATE pharmacy_inventory SET quantity=0 WHERE pharmacy_id=$1 AND NOT EXISTS
 * (...touched in session)`) — DTJ-151/DTJ-154.
 */
import { Injectable } from '@nestjs/common'
import {
  FULL_SYNC_COMPLETION,
  type FullSyncCompletionPort,
} from '@/modules/inventory/application/ports/full-sync-completion.port.js'

@Injectable()
export class InMemoryFullSyncCompletion implements FullSyncCompletionPort {
  public zeroOutCalls = 0
  public lastArgs: { pharmacyId: string; sessionId: string; timestamp: Date } | null = null

  zeroOutMissing(
    pharmacyId: string,
    sessionId: string,
    timestamp: Date,
  ): Promise<{ readonly zeroedLots: number }> {
    this.zeroOutCalls += 1
    this.lastArgs = { pharmacyId, sessionId, timestamp }
    return Promise.resolve({ zeroedLots: 0 })
  }
}

export const FULL_SYNC_COMPLETION_INMEMORY_PROVIDER = {
  provide: FULL_SYNC_COMPLETION,
  useClass: InMemoryFullSyncCompletion,
} as const
