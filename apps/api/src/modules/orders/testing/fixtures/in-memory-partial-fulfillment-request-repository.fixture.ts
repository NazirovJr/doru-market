/**
 * `InMemoryPartialFulfillmentRequestRepository` (EP-12, DTJ-304) — фикстура
 * `PartialFulfillmentRequestRepositoryPort` для unit-тестов `ResolvePartialFulfillmentUseCase`
 * (тот же приём, что `InMemoryOrderRepository`, DTJ-222). `transitionStatus` реализует
 * РЕАЛЬНУЮ CAS-семантику (`fromStatus` совпадает с текущим — иначе `false`), чтобы гонка
 * TC-PHT-013 была тестируема без реального Postgres.
 */
import type {
  CreatePartialFulfillmentRequestInput,
  PartialFulfillmentRequestRecord,
  PartialFulfillmentRequestRepositoryPort,
  TransitionPartialFulfillmentStatusInput,
} from '@/modules/orders/application/ports/partial-fulfillment-request-repository.port.js'

export class InMemoryPartialFulfillmentRequestRepository implements PartialFulfillmentRequestRepositoryPort {
  private readonly requests = new Map<string, PartialFulfillmentRequestRecord>()

  seed(record: PartialFulfillmentRequestRecord): void {
    this.requests.set(record.id, record)
  }

  create(input: CreatePartialFulfillmentRequestInput): Promise<PartialFulfillmentRequestRecord> {
    const record: PartialFulfillmentRequestRecord = {
      ...input,
      status: 'awaiting_customer',
      requestedAt: new Date(),
      respondedAt: null,
    }
    this.requests.set(record.id, record)
    return Promise.resolve(record)
  }

  findById(_tenantId: string, requestId: string): Promise<PartialFulfillmentRequestRecord | null> {
    return Promise.resolve(this.requests.get(requestId) ?? null)
  }

  /** ДОБАВЛЕНО (DTJ-305) — см. JSDoc порта. `requestedAt` DESC — тот же порядок, что Drizzle-реализация. */
  findLatestByOrderId(_tenantId: string, orderId: string): Promise<PartialFulfillmentRequestRecord | null> {
    const matches = [...this.requests.values()]
      .filter((request) => request.orderId === orderId)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
    return Promise.resolve(matches[0] ?? null)
  }

  transitionStatus(input: TransitionPartialFulfillmentStatusInput): Promise<boolean> {
    const current = this.requests.get(input.id)
    if (current?.status !== input.fromStatus) {
      return Promise.resolve(false)
    }
    this.requests.set(input.id, { ...current, status: input.toStatus, respondedAt: input.respondedAt })
    return Promise.resolve(true)
  }
}
