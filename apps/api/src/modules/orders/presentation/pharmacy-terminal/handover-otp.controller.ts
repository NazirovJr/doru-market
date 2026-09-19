/**
 * `HandoverOtpController` (EP-12, DTJ-306, модуль 24 §A.5, SRS-PHT-028/029) — тот же приём
 * структуры, что `CompletePickingController`/`PartialFulfillmentController` (DTJ-304/305):
 * отдельный файл-контроллер на уровне ЗАКАЗА, не дописан в `PharmacyTerminalItemsController`.
 *
 * - `GET /api/v1/orders/:id/handover-otp` — просмотр (без `Idempotency-Key`, чтение).
 * - `POST /api/v1/orders/:id/handover-otp/regenerate` — регенерация, `Idempotency-Key`
 *   обязателен (двойной тап не должен зря сжигать rate-limit регенераций, тикет п.5).
 *
 * Маппинг доменных ошибок → HTTP — автоматический (`AllExceptionsFilter`,
 * `ERROR_HTTP_STATUS[error.code]`): `HandoverOtpNotFoundError`(404)/
 * `HandoverOtpRegenerationRateLimitedError`(429) уже смаплены `packages/contracts`.
 */
import { Controller, Get, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ErrorCode, ok, type SuccessEnvelope } from '@dorutj/contracts'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { GetHandoverOtpUseCase } from '@/modules/orders/application/pharmacy-terminal/get-handover-otp.use-case.js'
import { RegenerateHandoverOtpUseCase } from '@/modules/orders/application/pharmacy-terminal/regenerate-handover-otp.use-case.js'
import {
  toHandoverOtpDto,
  toRegenerateHandoverOtpResponseData,
  type RegenerateHandoverOtpResponseData,
} from './pharmacy-terminal.mapper.js'
import type { HandoverOtpDto } from '@dorutj/contracts'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class HandoverOtpController {
  constructor(
    // Явный @Inject — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(GetHandoverOtpUseCase) private readonly getHandoverOtp: GetHandoverOtpUseCase,
    @Inject(RegenerateHandoverOtpUseCase) private readonly regenerateHandoverOtp: RegenerateHandoverOtpUseCase,
  ) {}

  /** `GET /api/v1/orders/:id/handover-otp` (SRS-PHT-028). */
  @Get(':id/handover-otp')
  @Roles('pharmacist', 'pharmacy_admin')
  async get(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<HandoverOtpDto>> {
    const result = await this.getHandoverOtp.execute({
      orderId,
      actor: {
        userId: claims.sub,
        role: requireHandoverOtpRole(claims),
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    })
    return ok(toHandoverOtpDto(result))
  }

  /** `POST /api/v1/orders/:id/handover-otp/regenerate` (SRS-PHT-029). */
  @Post(':id/handover-otp/regenerate')
  @Roles('pharmacist', 'pharmacy_admin')
  @Idempotent()
  async regenerate(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<RegenerateHandoverOtpResponseData>> {
    const result = await this.regenerateHandoverOtp.execute({
      orderId,
      actor: {
        userId: claims.sub,
        role: requireHandoverOtpRole(claims),
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    })
    return ok(toRegenerateHandoverOtpResponseData(result))
  }
}

/** 1:1 с `PartialFulfillmentController.requireTenantId`/`CompletePickingController` — та же
 *  причина дублирования на ≤3 файла, не общий util (`02` C15). */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'handover-otp requires a tenant-scoped actor',
    })
  }
  return claims.tenantId
}

/** `@Roles('pharmacist', 'pharmacy_admin')` уже гарантирует один из двух на уровне guard'а —
 *  этот узкий каст нужен ТОЛЬКО типам (`JwtClaims.role: UserRole`, use case ожидает более узкий
 *  союз, чтобы не пропустить случайно другую роль дальше по цепочке типов). */
function requireHandoverOtpRole(claims: JwtClaims): 'pharmacist' | 'pharmacy_admin' {
  if (claims.role !== 'pharmacist' && claims.role !== 'pharmacy_admin') {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'handover-otp requires a pharmacist/pharmacy_admin actor',
    })
  }
  return claims.role
}
