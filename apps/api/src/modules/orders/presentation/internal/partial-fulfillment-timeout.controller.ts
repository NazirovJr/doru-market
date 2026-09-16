/**
 * `PartialFulfillmentTimeoutController` (EP-12, DTJ-304) —
 * `POST /api/v1/internal/orders/partial-fulfillment-requests/:id/resolve-timeout`, единственный
 * HTTP-вход `ResolvePartialFulfillmentUseCase(confirmed=true, source='timeout')`. Необходимое
 * расширение периметра тикета — см. JSDoc `PartialFulfillmentTimeoutProcessor`
 * (`infrastructure/jobs/partial-fulfillment-timeout.processor.ts`) «DISPUTED» для полного
 * обоснования моста между процессами. 1:1 приём `SystemCancelOrderController` (EP-10,
 * DTJ-253/254) — вызывающий ИСКЛЮЧИТЕЛЬНО `apps/worker`
 * (`jobs/escrow-timeouts/partial-fulfillment-timeout.job.ts`), ни один браузер/мобильный
 * клиент этот путь не видит.
 *
 * `tenantId` — В ТЕЛЕ запроса, НЕ из `TenantContext`/`Host` (см. её же обоснование в
 * `system-cancel-order.controller.ts`: `apps/worker` бьёт на `API_INTERNAL_URL`, не
 * tenant-поддомен — джоба уже знает `tenantId` из СВОЕГО же payload'а очереди,
 * `PartialFulfillmentTimeoutJobData`, `ProposePartialFulfillmentUseCase` положил его туда при
 * планировании).
 *
 * `503 PAYMENT_PROVIDER_UNAVAILABLE` — легальный, ожидаемый ответ (SRS-PHT-075, «Что сделать»
 * п.5 тикета): `AllExceptionsFilter` мапит `PaymentProviderUnavailableError` автоматически, тот
 * же приём, что везде в проекте — контроллер НЕ перехватывает и не строит таблицу заново.
 * BullMQ-джоба (`apps/worker`) трактует НЕ-2xx ответ как `job failed` и ретраит по СВОЕЙ
 * политике (`attempts`/`backoff`, см. JSDoc процессора) — независимо, но совместимо с
 * outbox-сигналом `PartialFulfillmentRefundRetryRequestedEvent`, который use case публикует в
 * ТОЙ ЖЕ ветке (более долгосрочная сверка, не подменяет быстрый ретрай BullMQ).
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ResolvePartialFulfillmentUseCase,
  type ResolvePartialFulfillmentResult,
} from '@/modules/orders/application/pharmacy-terminal/resolve-partial-fulfillment.use-case.js'
import { InternalServiceGuard } from './internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

const ResolveTimeoutRequestSchema = z.object({ tenantId: z.uuid() })
type ResolveTimeoutRequest = z.infer<typeof ResolveTimeoutRequestSchema>

@Controller({ path: 'internal/orders/partial-fulfillment-requests', version: '1' })
@UseGuards(InternalServiceGuard)
export class PartialFulfillmentTimeoutController {
  public constructor(
    @Inject(ResolvePartialFulfillmentUseCase) private readonly resolvePartialFulfillment: ResolvePartialFulfillmentUseCase,
  ) {}

  @Post(':id/resolve-timeout')
  @HttpCode(HttpStatus.OK)
  public async resolveTimeout(
    @Param('id', ID_PARSE_UUID) requestId: string,
    @Body(new ZodValidationPipe(ResolveTimeoutRequestSchema)) body: ResolveTimeoutRequest,
  ): Promise<SuccessEnvelope<ResolvePartialFulfillmentResult>> {
    const result = await this.resolvePartialFulfillment.execute({
      requestId,
      tenantId: body.tenantId,
      confirmed: true,
      source: 'timeout',
    })
    return ok(result)
  }
}
