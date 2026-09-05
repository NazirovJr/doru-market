/**
 * `AdminPaymentOverrideController` (EP-10, DTJ-246, SRS-API-009) —
 * `POST /api/v1/admin/payment-override`. `@Roles('super_admin')` — ОСНОВНОЙ рубеж (см. JSDoc
 * `AdminPaymentOverrideUseCase` про второй, defensive, рубеж внутри use case).
 * `@Idempotent()` — обязателен буквальным текстом тикета (SRS-API-009), общая инфраструктура
 * (`common/http/decorators/idempotent.decorator.js`), НЕ своя реализация — тот же приём, что
 * `checkout.controller.ts`.
 */
import { Body, Controller, HttpCode, HttpStatus, Inject, InternalServerErrorException, Post, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { ErrorCode, ok, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { AdminPaymentOverrideUseCase } from '@/modules/payments/application/use-cases/admin-payment-override.use-case.js'

const AdminPaymentOverrideRequestSchema = z.object({
  orderId: z.uuid(),
  txId: z.string().min(1),
  amountDiram: z.coerce.bigint().positive(),
  paidAt: z.iso.datetime(),
  reason: z.string().min(1),
})
type AdminPaymentOverrideRequest = z.infer<typeof AdminPaymentOverrideRequestSchema>

@Controller({ path: 'admin/payment-override', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class AdminPaymentOverrideController {
  public constructor(
    @Inject(AdminPaymentOverrideUseCase) private readonly adminPaymentOverride: AdminPaymentOverrideUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin')
  @Idempotent()
  public async override(
    @Body(new ZodValidationPipe(AdminPaymentOverrideRequestSchema)) body: AdminPaymentOverrideRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<{ readonly orderId: string }>> {
    await this.adminPaymentOverride.execute({
      tenantId: resolveTenantId(),
      orderId: body.orderId,
      txId: body.txId,
      amountDiram: body.amountDiram,
      paidAt: new Date(body.paidAt),
      reason: body.reason,
      actorUserId: claims.sub,
      actorRole: claims.role,
    })
    return ok({ orderId: body.orderId })
  }
}

/** 1:1 с `get-order-ledger.controller.ts`/`pharmacies-map.controller.ts` — см. их JSDoc. */
function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
