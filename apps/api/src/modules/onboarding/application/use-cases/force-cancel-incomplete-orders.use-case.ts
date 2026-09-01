/**
 * `ForceCancelIncompleteOrdersUseCase` (DTJ-071) — принудительная отмена
 * незавершённых заказов приостановленной аптеки. Идемпотентно (общий механизм
 * EP-01, заголовок `Idempotency-Key` проверяется на уровне контроллера).
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import { ORDERS_CANCELLATION, type OrdersCancellationPort } from '@/modules/onboarding/application/ports/orders-cancellation.port.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewLogRepositoryPort,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'

export interface ForceCancelIncompleteOrdersInput {
  readonly pharmacyId: string
  readonly actorId: string
  readonly reason: string
}

export interface ForceCancelIncompleteOrdersResult {
  readonly pharmacyId: string
  readonly cancelledOrderIds: readonly string[]
}

@Injectable()
export class ForceCancelIncompleteOrdersUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(ORDERS_CANCELLATION)
    private readonly ordersCancellation: OrdersCancellationPort,
    @Inject(ONBOARDING_REVIEW_LOG_REPOSITORY)
    private readonly reviewLogRepository: OnboardingReviewLogRepositoryPort,
  ) {}

  async execute(input: ForceCancelIncompleteOrdersInput): Promise<ForceCancelIncompleteOrdersResult> {
    const account = await this.pharmacyAccountRepository.findById(input.pharmacyId)
    if (account === null) {
      throw new Error(`PharmacyAccount not found: ${input.pharmacyId}`)
    }
    if (account.status !== 'suspended') {
      throw new Error(`forceCancelIncompleteOrders requires status='suspended', got '${account.status}'`)
    }
    const result = await this.ordersCancellation.forceCancelIncomplete(input.pharmacyId, input.reason)
    await this.reviewLogRepository.append({
      pharmacyId: input.pharmacyId,
      action: 'suspend', // В тикете: «новое значение, например 'force_cancel_orders'» — пока вписываем в логический action, факт отмены — в reason + checklist.
      actorUserId: input.actorId,
      reason: `force_cancel: ${input.reason} | ids=[${result.cancelledOrderIds.join(',')}]`,
      checklistSnapshot: { cancelledOrderIds: result.cancelledOrderIds },
    })
    return { pharmacyId: input.pharmacyId, cancelledOrderIds: result.cancelledOrderIds }
  }
}
