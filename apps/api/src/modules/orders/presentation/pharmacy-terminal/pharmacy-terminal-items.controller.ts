/**
 * `PharmacyTerminalItemsController` (EP-12, модуль 24 §A.3) — HTTP-граница терминала фармацевта
 * на уровне ОДНОЙ позиции заказа (`/orders/:id/items/:itemId/**`).
 *
 * D-27 (см. риски DTJ-302/303): этот файл ДЕЛИТСЯ между DTJ-302 (`scan`, создаёт файл первым) и
 * DTJ-303 (`report-issue`, дописывает метод вторым, `depends_on: [DTJ-300, DTJ-302]`) — разведено
 * зависимостью тикетов, не параллельным rebase.
 *
 * Маппинг доменных ошибок → HTTP — АВТОМАТИЧЕСКИЙ (`AllExceptionsFilter`, `DomainError` →
 * `ERROR_HTTP_STATUS[code]`, см. его JSDoc) — контроллер не перехватывает и не строит таблицу
 * заново, тот же приём, что `CheckoutController`/`CancelOrderUseCase`.
 */
import { Body, Controller, HttpCode, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ErrorCode, ScanOrderItemRequestSchema, type ScanOrderItemRequestDto, ok, type SuccessEnvelope, type OrderItemDto } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ScanOrderItemUseCase } from '@/modules/orders/application/pharmacy-terminal/scan-order-item.use-case.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class PharmacyTerminalItemsController {
  constructor(
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(ScanOrderItemUseCase) private readonly scanOrderItem: ScanOrderItemUseCase,
  ) {}

  /** `POST /api/v1/orders/:id/items/:itemId/scan` (SRS-PHT-011). */
  // eslint-disable-next-line max-params -- 4 HTTP-параметра (:id, :itemId, JWT-claims, тело), каждый со своим Nest-декоратором (@Param/@CurrentUser/@Body) — тот же приём, что CartController (явные декорированные параметры, не объект-обёртка).
  @Post(':id/items/:itemId/scan')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist')
  @Idempotent()
  async scan(
    @Param('id', UUID_PIPE) orderId: string,
    @Param('itemId', UUID_PIPE) itemId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(ScanOrderItemRequestSchema)) body: ScanOrderItemRequestDto,
  ): Promise<SuccessEnvelope<OrderItemDto>> {
    const result = await this.scanOrderItem.execute({
      orderId,
      itemId,
      rawBarcode: body.rawBarcode,
      manualEntry: body.manualEntry,
      scannedBatchNumber: body.scannedBatchNumber ?? null,
      actor: {
        userId: claims.sub,
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    })
    return ok(result)
  }
}

/** 1:1 с `CheckoutController.requireTenantId`/`CartController.resolveTenantId` — см. их JSDoc. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'pharmacy-terminal item actions require a tenant-scoped actor',
    })
  }
  return claims.tenantId
}
