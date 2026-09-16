/**
 * Порт `PartialFulfillmentTimeoutQueuePort` (EP-12, DTJ-304, SRS-PHT-019/023a) — планирование
 * BullMQ delayed job таймаута ответа клиента (`Что сделать` п.2 тикета). Заводится по тому же
 * обязательному правилу `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3, что `EscrowLedgerRepository`
 * (DTJ-240)/`PartialFulfillmentRequestRepositoryPort` (этот тикет) — `application` не имеет
 * права знать конкретный BullMQ/`Queue` напрямую (`infrastructure`), только через порт.
 *
 * Реализация — `PartialFulfillmentTimeoutProcessor`
 * (`infrastructure/jobs/partial-fulfillment-timeout.processor.ts`, files_owned этого тикета) —
 * см. её JSDoc про DISPUTED архитектурное решение (Worker внутри `apps/api`, отступление от
 * общего приёма `apps/worker`-консьюмера).
 */
export const PARTIAL_FULFILLMENT_TIMEOUT_QUEUE = Symbol.for('@dorutj/orders/partial-fulfillment-timeout-queue')

export interface SchedulePartialFulfillmentTimeoutInput {
  readonly requestId: string
  readonly tenantId: string
  /** `tenant_settings.partial_fulfillment_confirmation_timeout_minutes` (`TenancyFacadePort`). */
  readonly timeoutMinutes: number
}

export interface PartialFulfillmentTimeoutQueuePort {
  /**
   * `jobId = requestId` (SRS-PHT DoD: «идемпотентно при повторном планировании») — повторный
   * вызов с ТЕМ ЖЕ `requestId` не создаёт вторую джобу (BullMQ отбрасывает дубликат `jobId`,
   * тот же приём, что `BullmqInventorySyncQueueAdapter.enqueue`, DTJ-153).
   */
  schedule(input: SchedulePartialFulfillmentTimeoutInput): Promise<void>
}
