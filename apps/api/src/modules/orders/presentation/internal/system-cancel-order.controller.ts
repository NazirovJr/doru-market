/**
 * `SystemCancelOrderController` (EP-10, DTJ-253/254, SRS-ORD-032..036) —
 * `POST /api/v1/internal/orders/:id/system-cancel`, единственный HTTP-вход
 * `SystemCancelOrderUseCase` (см. её JSDoc «МОСТ МЕЖДУ ПРОЦЕССАМИ» для полного обоснования).
 * Вызывающие — ИСКЛЮЧИТЕЛЬНО `apps/worker`: `UnpaidOrderTimeoutJob` (DTJ-253) и
 * `PickupSlaTimeoutJob` (DTJ-254), ни один браузер/мобильный клиент этот путь не видит.
 *
 * `tenantId` — В ТЕЛЕ запроса, НЕ из `TenantContext`/`Host` (в отличие от ВСЕХ остальных
 * контроллеров `orders`/`payments`): `apps/worker` бьёт на `API_INTERNAL_URL`
 * (localhost/internal-service-имя, НЕ tenant-поддомен) — `TenantResolutionMiddleware`
 * резолвил бы ЭТОТ запрос в NEUTRAL tenant (шаг 3 её алгоритма, «Host не совпал, X-Tenant-Slug
 * не передан»), что было бы НЕВЕРНЫМ tenant'ом для реального заказа и привело бы к тихому
 * «заказ не найден» на КАЖДОМ вызове — проверено чтением `tenant-resolution.middleware.ts`
 * перед этим решением, не предположено. Джоба УЖЕ знает `tenantId` заказа из СВОЕГО же
 * SQL-скана (`orders.tenant_id` — обычная колонка выборки) — передать его явно значительно
 * дешевле и надёжнее, чем городить exclusion-путь в `TenantResolutionMiddleware` ради одного
 * internal-маршрута.
 *
 * `reason` — НАМЕРЕННО у́же canonического `OrderCancelReason` (8 значений) и даже у́же публичной
 * `CANCEL_ORDER_REASON_VALUES` (`packages/contracts`, 6 значений, тоже НЕ включает
 * `payment_timeout`): здесь принимаются РОВНО два значения — те, что реально устанавливает
 * СИСТЕМА (`payment_timeout`/`pickup_sla_timeout`), least-privilege для internal-маршрута —
 * ни `fraud_or_safety_force_cancel`, ни другие ручные/административные причины сюда не проходят
 * даже теоретически, чужой секрет не даёт больше возможностей, чем этим двум джобам нужно.
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  SystemCancelOrderUseCase,
  type SystemCancelOrderResult,
} from '@/modules/orders/application/order-lifecycle/system-cancel-order.use-case.js'
import { InternalServiceGuard } from './internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

/** Значения `OrderCancelReason`, которые реально устанавливает СИСТЕМА (см. JSDoc файла). */
const SYSTEM_CANCEL_REASON_VALUES = ['payment_timeout', 'pickup_sla_timeout'] as const

const SystemCancelOrderRequestSchema = z.object({
  tenantId: z.uuid(),
  expectedFromStatus: z.enum(['pending_payment', 'paid_escrow', 'confirmed']),
  reason: z.enum(SYSTEM_CANCEL_REASON_VALUES),
})
type SystemCancelOrderRequest = z.infer<typeof SystemCancelOrderRequestSchema>

@Controller({ path: 'internal/orders', version: '1' })
@UseGuards(InternalServiceGuard)
export class SystemCancelOrderController {
  public constructor(
    @Inject(SystemCancelOrderUseCase) private readonly systemCancelOrder: SystemCancelOrderUseCase,
  ) {}

  @Post(':id/system-cancel')
  @HttpCode(HttpStatus.OK)
  public async systemCancel(
    @Param('id', ID_PARSE_UUID) orderId: string,
    @Body(new ZodValidationPipe(SystemCancelOrderRequestSchema)) body: SystemCancelOrderRequest,
  ): Promise<SuccessEnvelope<SystemCancelOrderResult>> {
    const result = await this.systemCancelOrder.execute({
      tenantId: body.tenantId,
      orderId,
      expectedFromStatus: body.expectedFromStatus,
      reason: body.reason,
    })
    return ok(result)
  }
}
