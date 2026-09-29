/**
 * `PharmacySuspensionController` (DTJ-071) — маршруты `suspend` и
 * `force-cancel-incomplete-orders`. `Idempotency-Key` обязателен для
 * force-cancel (SRS-ADM-016): `@Idempotent()` даёт 400 без заголовка и повтор без дублей.
 */
import { Body, Controller, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import {
  ForceCancelOrdersRequestSchema,
  SuspendPharmacyRequestSchema,
  ok,
  type ForceCancelOrdersRequest,
  type SuspendPharmacyRequest,
} from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { SuspendPharmacyUseCase } from '@/modules/onboarding/application/use-cases/suspend-pharmacy.use-case.js'
import { ForceCancelIncompleteOrdersUseCase } from '@/modules/onboarding/application/use-cases/force-cancel-incomplete-orders.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'admin/pharmacy-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PharmacySuspensionController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `CategoriesController`.
  constructor(
    @Inject(SuspendPharmacyUseCase) private readonly suspendPharmacy: SuspendPharmacyUseCase,
    @Inject(ForceCancelIncompleteOrdersUseCase) private readonly forceCancelIncompleteOrders: ForceCancelIncompleteOrdersUseCase,
  ) {}

  @Post(':id/suspend')
  async suspend(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(SuspendPharmacyRequestSchema)) body: SuspendPharmacyRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.suspendPharmacy.execute({
      pharmacyId: id,
      actorId: claims.sub,
      reason: body.reason,
      notes: body.notes ?? null,
    })
    return ok(result)
  }

  @Post(':id/force-cancel-incomplete-orders')
  @Idempotent()
  async forceCancel(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(ForceCancelOrdersRequestSchema)) body: ForceCancelOrdersRequest,
    @CurrentUser() claims: JwtClaims,
  ): Promise<unknown> {
    const result = await this.forceCancelIncompleteOrders.execute({
      pharmacyId: id,
      actorId: claims.sub,
      reason: body.reason,
    })
    return ok(result)
  }
}
