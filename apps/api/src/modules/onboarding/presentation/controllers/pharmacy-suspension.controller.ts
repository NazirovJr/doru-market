/**
 * `PharmacySuspensionController` (DTJ-071) — маршруты `suspend` и
 * `force-cancel-incomplete-orders`. `Idempotency-Key` обязателен для
 * force-cancel (SRS-ADM-016), проверяется общим механизмом EP-01.
 */
import { Body, Controller, Headers, Inject, Param, ParseUUIDPipe, Post, UseGuards, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ForceCancelOrdersRequestSchema,
  SuspendPharmacyRequestSchema,
  ok,
  type ForceCancelOrdersRequest,
  type SuspendPharmacyRequest,
} from '@dorutj/contracts'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import { SuspendPharmacyUseCase } from '@/modules/onboarding/application/use-cases/suspend-pharmacy.use-case.js'
import { ForceCancelIncompleteOrdersUseCase } from '@/modules/onboarding/application/use-cases/force-cancel-incomplete-orders.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000'
const IDEMPOTENCY_HEADER = 'idempotency-key'

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
  @UsePipes(new ZodValidationPipe(SuspendPharmacyRequestSchema))
  async suspend(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: SuspendPharmacyRequest,
  ): Promise<unknown> {
    const result = await this.suspendPharmacy.execute({
      pharmacyId: id,
      actorId: SYSTEM_ACTOR_ID,
      reason: body.reason,
      notes: body.notes ?? null,
    })
    return ok(result)
  }

  @Post(':id/force-cancel-incomplete-orders')
  @UsePipes(new ZodValidationPipe(ForceCancelOrdersRequestSchema))
  async forceCancel(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body() body: ForceCancelOrdersRequest,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
  ): Promise<unknown> {
    if (idempotencyKey === undefined || idempotencyKey.length === 0) {
      // TODO(EP-01): заменить на 400 IDEMPOTENCY_KEY_REQUIRED через общий interceptor
      throw new Error('Idempotency-Key header is required')
    }
    const result = await this.forceCancelIncompleteOrders.execute({
      pharmacyId: id,
      actorId: SYSTEM_ACTOR_ID,
      reason: body.reason,
    })
    return ok(result)
  }
}
