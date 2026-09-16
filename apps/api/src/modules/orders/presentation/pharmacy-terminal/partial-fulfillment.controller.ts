/**
 * `PartialFulfillmentController` (EP-12, DTJ-304, модуль 24 §A.4, SRS-PHT-019/020) —
 * `POST /api/v1/orders/:id/propose-partial-fulfillment`. Единственный эндпоинт, которым владеет
 * ЭТОТ тикет (`Что сделать` п.6 тикета) — эндпоинт клиентского `confirm`/`reject` НЕ в зоне
 * владения этого тикета (владелец `apps/web`, `ResolvePartialFulfillmentUseCase` уже
 * реализован и готов принять её вызов, см. её JSDoc).
 *
 * Отдельный файл-контроллер, НЕ дописан в `PharmacyTerminalItemsController` (`/orders/:id/
 * items/:itemId/**`, DTJ-302/303) — этот маршрут на уровне ЗАКАЗА (`/orders/:id/**`), не
 * позиции, ближе по форме к `PharmacyTerminalQueueController` (`accept`/`reclaim`). Маппинг
 * доменных ошибок → HTTP — АВТОМАТИЧЕСКИЙ (`AllExceptionsFilter`), тот же приём, что везде.
 */
import { Body, Controller, Headers, HttpCode, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import {
  ErrorCode,
  ProposePartialFulfillmentRequestSchema,
  type ProposePartialFulfillmentRequestDto,
  ok,
  type SuccessEnvelope,
  type PartialFulfillmentRequestDto,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ProposePartialFulfillmentUseCase } from '@/modules/orders/application/pharmacy-terminal/propose-partial-fulfillment.use-case.js'
import { toPartialFulfillmentResponseData } from './pharmacy-terminal.mapper.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class PartialFulfillmentController {
  constructor(
    // Явный @Inject — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(ProposePartialFulfillmentUseCase) private readonly proposePartialFulfillment: ProposePartialFulfillmentUseCase,
  ) {}

  /** `POST /api/v1/orders/:id/propose-partial-fulfillment` (SRS-PHT-019). */
  // eslint-disable-next-line max-params -- 4 HTTP-параметра (:id, Idempotency-Key, JWT-claims, тело), тот же приём, что PharmacyTerminalItemsController.scan/reportIssue.
  @Post(':id/propose-partial-fulfillment')
  @HttpCode(HttpStatus.Created)
  @Roles('pharmacist')
  @Idempotent()
  async propose(
    @Param('id', UUID_PIPE) orderId: string,
    // `@Idempotent()` уже гарантирует наличие валидного UUID v4 ДО этого метода (`IdempotencyInterceptor`,
    // ветка 1/2) — тот же приём, что `CheckoutController.checkout`, типизирован НЕ-опциональной `string`.
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(ProposePartialFulfillmentRequestSchema))
    _body: ProposePartialFulfillmentRequestDto,
  ): Promise<SuccessEnvelope<PartialFulfillmentRequestDto>> {
    const result = await this.proposePartialFulfillment.execute({
      orderId,
      idempotencyKey,
      actor: {
        userId: claims.sub,
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    })
    return ok(toPartialFulfillmentResponseData(result))
  }
}

/** 1:1 с `PharmacyTerminalItemsController.requireTenantId`/`CheckoutController.requireTenantId`. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'propose-partial-fulfillment requires a tenant-scoped actor',
    })
  }
  return claims.tenantId
}
