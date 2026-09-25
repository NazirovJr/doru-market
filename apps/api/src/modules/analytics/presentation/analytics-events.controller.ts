// Публичный батч-приём телеметрии: @Public() снимает обязательность JWT, тенант всё равно
// резолвится (TenantScopeGuard глобальный). Ответ всегда 202 сразу — обработка синхронна в R1.
import { Body, Controller, HttpCode, Inject, InternalServerErrorException, Post, UseGuards } from '@nestjs/common'
import {
  ErrorCode,
  ok,
  ProductEventsBatchSchema,
  type ProductEventsBatchInput,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  RecordProductEventsBatchUseCase,
  type RecordProductEventsBatchItem,
} from '../application/use-cases/record-product-events-batch.use-case.js'
import { AnalyticsEventsIdentityGuard } from './guards/analytics-events-identity.guard.js'
import { AnalyticsActorUserId } from './decorators/analytics-actor-user-id.decorator.js'

const EVENTS_BATCH_PIPE = new ZodValidationPipe(ProductEventsBatchSchema)
const HTTP_ACCEPTED = 202 // тот же приём, что OtpRequestController

@Controller({ path: 'analytics/events', version: '1' })
@Public()
@UseGuards(AnalyticsEventsIdentityGuard)
export class AnalyticsEventsController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` (DTJ-001).
  constructor(
    @Inject(RecordProductEventsBatchUseCase) private readonly recordBatch: RecordProductEventsBatchUseCase,
  ) {}

  @Post()
  @HttpCode(HTTP_ACCEPTED)
  async submit(
    @Body(EVENTS_BATCH_PIPE) events: ProductEventsBatchInput,
    @AnalyticsActorUserId() userId: string | null,
  ): Promise<SuccessEnvelope<{ accepted: true }>> {
    const tenantId = resolveTenantId()
    await this.recordBatch.execute({
      tenantId,
      userId,
      events: events.map(toBatchItem),
    })
    return ok({ accepted: true })
  }
}

function toBatchItem(input: ProductEventsBatchInput[number]): RecordProductEventsBatchItem {
  return {
    eventType: input.eventType,
    sessionId: input.sessionId,
    medicineId: input.medicineId ?? null,
    pharmacyId: input.pharmacyId ?? null,
    savingsDiram: input.savingsDiram === undefined ? null : BigInt(input.savingsDiram),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }), // exactOptionalPropertyTypes
  }
}

function resolveTenantId(): string { // 1:1 с CartController.resolveTenantId()
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
