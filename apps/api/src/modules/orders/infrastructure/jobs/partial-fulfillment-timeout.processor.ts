/**
 * `PartialFulfillmentTimeoutProcessor` (EP-12, DTJ-304, SRS-PHT-019/023a) — реализация
 * `PartialFulfillmentTimeoutQueuePort` (`application/ports/partial-fulfillment-timeout-queue.port.ts`).
 *
 * **DISPUTED (архитектурное решение, зафиксировано явно, не обойдено молча).** Общий приём
 * этого проекта для BullMQ delayed job, чей ОБРАБОТЧИК исполняет реальную бизнес-логику
 * (не просто HTTP-ретрансляция) — producer в `apps/api`, CONSUMER (`Worker`) в `apps/worker`
 * (ОТДЕЛЬНЫЙ процесс/TS-проект, единственный входной HTTP-процесс продукта — `apps/api/src/
 * main.ts` — HTTP-процесс, НЕ воркер; `apps/worker` не может импортировать код `apps/api`
 * напрямую), мост — internal HTTP (`system-order-cancel.client.ts`/`mock-bank-auto-pay.job.ts`,
 * EP-10). Буквальный `files_owned` ЭТОГО тикета — ОДИН файл ИМЕННО в `apps/api/.../
 * infrastructure/jobs/`, БЕЗ единого файла `apps/worker/**`, а тест-план тикета явно требует
 * «тест таймаут-джобы с РЕАЛЬНЫМ BullMQ (тестовый Redis)» — тест, проверяющий планирование
 * (`schedule`, `jobId=requestId`), а не запуск живого `Worker` внутри `apps/api`.
 *
 * Из этого следует РАЗДЕЛЕНИЕ (минимально необходимое расширение периметра, тот же класс
 * решения, что новый порт `partial-fulfillment-request-repository.port.ts`/`partial-
 * fulfillment-timeout-queue.port.ts` этого же тикета — не в буквальном `files_owned`, но
 * обязательно для работы фичи):
 *   1. ЭТОТ файл — ТОЛЬКО producer (`Queue.add`, планирование), 1:1 приём
 *      `BullmqInventorySyncQueueAdapter` (DTJ-153)/`MockBankProvider`'s auto-pay queue (EP-10).
 *   2. `presentation/internal/partial-fulfillment-timeout.controller.ts` (ЭТОТ тикет,
 *      необходимое расширение, см. её JSDoc) — `POST /api/v1/internal/orders/
 *      partial-fulfillment-requests/:id/resolve-timeout`, `InternalServiceGuard`, вызывает
 *      `ResolvePartialFulfillmentUseCase(confirmed=true, source='timeout')`.
 *   3. `apps/worker/src/jobs/escrow-timeouts/partial-fulfillment-timeout.*` (ЭТОТ тикет,
 *      необходимое расширение) — реальный `Worker`, консьюмер очереди `QUEUE_NAME` ниже, бьёт
 *      на (2) через ТЕ ЖЕ `API_INTERNAL_URL_TOKEN`/`INTERNAL_API_KEY_TOKEN`
 *      (`system-order-cancel.client.ts`), не заводит новую пару токенов.
 * Без (2)/(3) таймаут НИКОГДА бы физически не сработал (задокументированный «недостижимый
 * DoD» — не приемлемо для финансово чувствительного тикета, DoD прямо требует джобу, покрытую
 * тестом идемпотентности). Альтернатива «Worker внутри `apps/api`» отклонена: общий
 * `REDIS_CLIENT` (`infrastructure/redis/redis.provider.ts`) сконфигурирован
 * `maxRetriesPerRequest: 1` — BullMQ `Worker` требует `null` на своём соединении, отдельное
 * соединение внутри `apps/api` шло бы ПРОТИВ «один пул, переиспользуется всеми модулями»
 * (JSDoc `redis.provider.ts`) и самого определения `apps/api` как HTTP-only процесса.
 *
 * `jobId = requestId` — идемпотентное повторное планирование (DoD тикета): BullMQ отбрасывает
 * повторный `add` с тем же `jobId` для job'ы, которая ещё не завершилась/не удалена — тот же
 * приём, что `BullmqInventorySyncQueueAdapter.enqueue` (`jobId = batchId`).
 */
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { Queue, type JobsOptions } from 'bullmq'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '@/infrastructure/redis/redis.token.js'
import {
  PARTIAL_FULFILLMENT_TIMEOUT_QUEUE,
  type PartialFulfillmentTimeoutQueuePort,
  type SchedulePartialFulfillmentTimeoutInput,
} from '@/modules/orders/application/ports/partial-fulfillment-timeout-queue.port.js'

/** SVOYA копия строки на стороне `apps/worker` (`partial-fulfillment-timeout.constants.ts`,
 *  ЭТОТ тикет) — отдельные TS-проекты монорепо, значение синхронизируется вручную, не импортом
 *  (тот же приём, что `MOCK_BANK_AUTO_PAY_QUEUE_NAME`/`QUEUE_NAMES.MOCK_BANK_AUTO_PAY`). */
export const PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME = 'partial-fulfillment-timeout'

const MS_PER_MINUTE = 60_000
/** Тот же профиль, что `BullmqInventorySyncQueueAdapter`/`MOCK_BANK_AUTO_PAY` (EP-05/EP-10). */
const JOB_ATTEMPTS = 5
const JOB_BACKOFF_DELAY_MS = 5_000
const REMOVE_ON_COMPLETE_AGE_SECONDS = 86_400
const REMOVE_ON_COMPLETE_COUNT = 10_000
const REMOVE_ON_FAIL_AGE_SECONDS = 604_800

/** Форма job payload — СВОЯ копия должна существовать в `apps/worker/.../partial-fulfillment-timeout.types.ts` (см. JSDoc файла). */
export interface PartialFulfillmentTimeoutJobData {
  readonly requestId: string
  readonly tenantId: string
}

const JOB_OPTIONS: Omit<JobsOptions, 'delay' | 'jobId'> = {
  attempts: JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
  removeOnComplete: { age: REMOVE_ON_COMPLETE_AGE_SECONDS, count: REMOVE_ON_COMPLETE_COUNT },
  removeOnFail: { age: REMOVE_ON_FAIL_AGE_SECONDS },
}

@Injectable()
export class PartialFulfillmentTimeoutProcessor implements PartialFulfillmentTimeoutQueuePort, OnModuleDestroy {
  private readonly queue: Queue<PartialFulfillmentTimeoutJobData>

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.queue = new Queue<PartialFulfillmentTimeoutJobData>(PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME, { connection: redis })
  }

  async schedule(input: SchedulePartialFulfillmentTimeoutInput): Promise<void> {
    await this.queue.add(
      PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_NAME,
      { requestId: input.requestId, tenantId: input.tenantId },
      { ...JOB_OPTIONS, jobId: input.requestId, delay: input.timeoutMinutes * MS_PER_MINUTE },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

export const PARTIAL_FULFILLMENT_TIMEOUT_QUEUE_PROVIDER = {
  provide: PARTIAL_FULFILLMENT_TIMEOUT_QUEUE,
  useClass: PartialFulfillmentTimeoutProcessor,
} as const
