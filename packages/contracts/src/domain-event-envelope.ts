// Форма job'ы очереди domain-events, общая между apps/worker (producer) и apps/api (consumer).
export interface DomainEventEnvelope {
  readonly eventId: string
  readonly eventType: string
  readonly aggregateType: string
  readonly aggregateId: string
  readonly tenantId: string | null
  readonly occurredAt: string
  readonly payload: Record<string, unknown>
}
