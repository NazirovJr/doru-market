/**
 * `OrderDeliveredController` (EP-10, DTJ-244) — `POST /api/v1/internal/orders/:id/delivered`,
 * ВРЕМЕННЫЙ HTTP-мост к `OrderDeliveredSubscriber` (см. её JSDoc «МЕХАНИЗМ ПОДПИСКИ» для
 * полного обоснования) — TODO(EP-13): заменить на реальный механизм публикации, когда модуль
 * `delivery` появится.
 *
 * `tenantId` — В ТЕЛЕ (не `TenantContext`), тот же приём и то же обоснование, что
 * `system-cancel-order.controller.ts` (DTJ-253/254): вызывающий (сегодня — тест/curl,
 * впоследствии — `delivery`) уже знает `tenantId` заказа.
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { OrderDeliveredSubscriber } from '@/modules/payments/infrastructure/subscribers/order-delivered.subscriber.js'
import { PaymentsInternalServiceGuard } from './payments-internal-service.guard.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

const OrderDeliveredRequestSchema = z.object({
  tenantId: z.uuid(),
  deliveredAt: z.iso.datetime(),
  eventId: z.uuid(),
})
type OrderDeliveredRequest = z.infer<typeof OrderDeliveredRequestSchema>

@Controller({ path: 'internal/orders', version: '1' })
@UseGuards(PaymentsInternalServiceGuard)
export class OrderDeliveredController {
  public constructor(@Inject(OrderDeliveredSubscriber) private readonly subscriber: OrderDeliveredSubscriber) {}

  @Post(':id/delivered')
  @HttpCode(HttpStatus.OK)
  public async delivered(
    @Param('id', ID_PARSE_UUID) orderId: string,
    @Body(new ZodValidationPipe(OrderDeliveredRequestSchema)) body: OrderDeliveredRequest,
  ): Promise<SuccessEnvelope<{ readonly received: true }>> {
    await this.subscriber.handle({
      tenantId: body.tenantId,
      orderId,
      deliveredAt: new Date(body.deliveredAt),
      eventId: body.eventId,
    })
    return ok({ received: true })
  }
}
