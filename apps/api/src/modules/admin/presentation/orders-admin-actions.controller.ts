// DTJ-356 — payment-override/admin-force-cancel, отдельный контроллер, тот же path-префикс, что
// OrdersAdminController ('admin/orders' — 'orders' занят PharmacyTerminalQueueController).
import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import {
  AdminForceCancelOrderBodySchema,
  AdminPaymentOverrideBodySchema,
  ok,
  type AdminForceCancelOrderBodyDto,
  type AdminForceCancelOrderResultDto,
  type AdminPaymentOverrideBodyDto,
  type AdminPaymentOverrideResultDto,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { RequestContext } from '@/common/context/request-context.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { AdminPaymentOverrideUseCase } from '../application/use-cases/admin-payment-override.use-case.js'
import { AdminForceCancelOrderUseCase } from '../application/use-cases/admin-force-cancel-order.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'admin/orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class OrdersAdminActionsController {
  public constructor(
    @Inject(AdminPaymentOverrideUseCase) private readonly paymentOverrideUseCase: AdminPaymentOverrideUseCase,
    @Inject(AdminForceCancelOrderUseCase) private readonly forceCancelUseCase: AdminForceCancelOrderUseCase,
  ) {}

  @Post(':id/payment-override')
  @HttpCode(HttpStatus.Ok)
  public async paymentOverride(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(AdminPaymentOverrideBodySchema)) body: AdminPaymentOverrideBodyDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<AdminPaymentOverrideResultDto>> {
    const result = await this.paymentOverrideUseCase.execute({
      orderId: id,
      reason: body.reason,
      txId: body.txId,
      amountDiram: body.amountDiram,
      paidAt: new Date(body.paidAt),
      actor: { userId: claims.sub, role: claims.role },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(result)
  }

  @Post(':id/admin-force-cancel')
  @HttpCode(HttpStatus.Ok)
  public async adminForceCancel(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(AdminForceCancelOrderBodySchema)) body: AdminForceCancelOrderBodyDto,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<AdminForceCancelOrderResultDto>> {
    const result = await this.forceCancelUseCase.execute({
      orderId: id,
      reason: body.reason,
      actor: { userId: claims.sub, role: claims.role },
      requestId: RequestContext.get()?.requestId ?? null,
    })
    return ok(result)
  }
}
