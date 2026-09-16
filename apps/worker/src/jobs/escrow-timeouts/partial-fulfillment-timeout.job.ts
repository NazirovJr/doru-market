/**
 * `PartialFulfillmentTimeoutJob` (EP-12, DTJ-304, SRS-PHT-019/023a) — consumer стороны
 * apps/worker очереди `partial-fulfillment-timeout`. Producer —
 * `apps/api/.../infrastructure/jobs/partial-fulfillment-timeout.processor.ts`
 * (`PartialFulfillmentTimeoutProcessor.schedule()`, планируется В ТОЙ ЖЕ транзакции, что
 * создание `order_partial_fulfillment_requests`, см. её JSDoc «DISPUTED» для полного
 * архитектурного обоснования моста между процессами). Связь ТОЛЬКО через имя очереди
 * BullMQ/Redis — apps/worker не может импортировать код apps/api напрямую.
 *
 * Отправляет `POST /api/v1/internal/orders/partial-fulfillment-requests/:id/resolve-timeout`
 * (`PartialFulfillmentTimeoutController`, apps/api) — 1:1 приём `requestSystemOrderCancel`
 * (`system-order-cancel.client.ts`, DTJ-253/254): ТЕ ЖЕ `API_INTERNAL_URL`/`INTERNAL_API_KEY`
 * (`x-internal-api-key`), не заводит вторую пару токенов/ENV.
 *
 * Джоба — ТОЛЬКО мост (HTTP-ретрансляция `requestId`/`tenantId` из своего payload'а).
 * Идемпотентность на `already-resolved` (TC-PHT-013: явный ответ клиента опередил таймер) и
 * денежное решение (D-10/SRS-DOM-162) — ЦЕЛИКОМ на стороне `ResolvePartialFulfillmentUseCase`
 * (apps/api) — эта джоба НИКОГДА не решает бизнес-вопрос сама, только передаёт вызов и
 * трактует НЕ-2xx ответ как `job failed` (BullMQ ретраит по СВОЕЙ политике, см. JSDoc
 * `PartialFulfillmentTimeoutProcessor`).
 */
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import type { PartialFulfillmentTimeoutJobData } from './partial-fulfillment-timeout.types.js'

const RESOLVE_TIMEOUT_PATH_SUFFIX = '/resolve-timeout'
const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

export interface PartialFulfillmentTimeoutJobDeps {
  readonly apiInternalUrl: string
  readonly internalApiKey: string | undefined
}

@Injectable()
export class PartialFulfillmentTimeoutJob {
  private readonly logger = new Logger(PartialFulfillmentTimeoutJob.name)

  public async process(job: Job<PartialFulfillmentTimeoutJobData>, deps: PartialFulfillmentTimeoutJobDeps): Promise<void> {
    if (deps.internalApiKey === undefined) {
      // Программная ошибка конфигурации — бросает, не молчит (тот же приём, что
      // `MockBankAutoPayJob`/`requestSystemOrderCancel` про отсутствующий секрет, D-EP09-16).
      throw new Error('INTERNAL_API_KEY is not configured — cannot call internal resolve-timeout endpoint')
    }
    const url = new URL(
      `/api/v1/internal/orders/partial-fulfillment-requests/${job.data.requestId}${RESOLVE_TIMEOUT_PATH_SUFFIX}`,
      deps.apiInternalUrl,
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERNAL_API_KEY_HEADER]: deps.internalApiKey },
      body: JSON.stringify({ tenantId: job.data.tenantId }),
    })
    if (!response.ok) {
      throw new Error(
        `partial-fulfillment-timeout: resolve-timeout POST failed for requestId=${job.data.requestId} (HTTP ${String(response.status)})`,
      )
    }
    this.logger.log(`partial-fulfillment-timeout: requestId=${job.data.requestId} resolved (or already settled)`)
  }
}
