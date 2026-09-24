export interface OutboxEventRecord {
  readonly id: string
  readonly eventType: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly tenantId: string | null
  readonly occurredAt: Date
  readonly payload: Record<string, unknown>
}

// Один объект-клейм на вызов (не общее состояние адаптера): FOR UPDATE SKIP LOCKED держит лок
// строк до commit(), а конкурентные claimPending() (два worker-реплики) должны получать каждый
// свою транзакцию, иначе один инстанс порта перезаписывал бы клиент другого.
export interface OutboxClaim {
  readonly events: readonly OutboxEventRecord[]
  markPublished(id: string): Promise<void>
  recordFailure(id: string): Promise<void>
  commit(): Promise<void>
}

export const OUTBOX_READER_PORT = Symbol('OUTBOX_READER_PORT')

export interface OutboxReaderPort {
  claimPending(limit: number): Promise<OutboxClaim>
}
