/**
 * `CompletePickingController` (EP-12, DTJ-305, модуль 24 §A.5, SRS-PHT-024/025) —
 * `POST /api/v1/orders/:id/complete-picking`. Отдельный файл-контроллер (тот же приём, что
 * `PartialFulfillmentController`, DTJ-304) — маршрут на уровне ЗАКАЗА, не позиции, НЕ дописан в
 * `PharmacyTerminalItemsController` (`/orders/:id/items/:itemId/**`).
 *
 * `Idempotency-Key` — общая инфраструктура `@Idempotent()`/`IdempotencyInterceptor`, метод её не
 * читает (1:1 приём `PharmacyTerminalQueueController.accept`/`.reclaim` — заголовок нужен только
 * `IdempotencyInterceptor` ДО вызова метода, `CompletePickingUseCase` не персистирует ключ на
 * отдельную строку, в отличие от `PartialFulfillmentController.propose`).
 *
 * Маппинг доменных ошибок → HTTP — автоматический (`AllExceptionsFilter`,
 * `ERROR_HTTP_STATUS[error.code]`): `SealConfirmationRequiredError`(400)/
 * `BusinessRuleViolationError`(422)/`PendingCustomerConfirmationError`(409)/
 * `ExpiredStockError`(422) уже смаплены `packages/contracts` (DTJ-300/304).
 */
import { Body, Controller, HttpCode, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import {
  CompletePickingRequestSchema,
  ErrorCode,
  ok,
  type CompletePickingRequestDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { CompletePickingUseCase } from '@/modules/orders/application/pharmacy-terminal/complete-picking.use-case.js'
import { toCompletePickingResponseData, type CompletePickingResponseData } from './pharmacy-terminal.mapper.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CompletePickingController {
  constructor(
    // Явный @Inject — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(CompletePickingUseCase) private readonly completePicking: CompletePickingUseCase,
  ) {}

  /** `POST /api/v1/orders/:id/complete-picking` (SRS-PHT-024). */
  @Post(':id/complete-picking')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist')
  @Idempotent()
  async complete(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(CompletePickingRequestSchema)) body: CompletePickingRequestDto,
  ): Promise<SuccessEnvelope<CompletePickingResponseData>> {
    const result = await this.completePicking.execute({
      orderId,
      sealConfirmed: body.sealConfirmed,
      actor: {
        userId: claims.sub,
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    })
    return ok(toCompletePickingResponseData(result))
  }
}

/** 1:1 с `PartialFulfillmentController.requireTenantId`/`PharmacyTerminalItemsController.requireTenantId`. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'complete-picking requires a tenant-scoped actor',
    })
  }
  return claims.tenantId
}
