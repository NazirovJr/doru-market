/**
 * `SuspendPharmacyUseCase` (DTJ-071) — приостановка аптеки оператором
 * `super_admin`. САМ не вызывает `forceCancelIncompleteOrdersUseCase` —
 * это ОТДЕЛЬНОЕ явное действие (SRS-ADM-016).
 *
 * Возвращает флаг `requiresForceCancelAction: true` если причина входит в
 * `PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL` (`fraud_or_safety`,
 * `license_revoked`) — фронтенд оператора показывает оператору ярлык «нужна
 * принудительная отмена заказов».
 */
import { Inject, Injectable } from '@nestjs/common'
import { PHARMACY_ACCOUNT_REPOSITORY, type PharmacyAccountRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-account.repository.port.js'
import {
  ONBOARDING_REVIEW_LOG_REPOSITORY,
  type OnboardingReviewLogRepositoryPort,
} from '@/modules/onboarding/application/ports/onboarding-review-log.repository.port.js'
import { ORDERS_CANCELLATION, type OrdersCancellationPort } from '@/modules/onboarding/application/ports/orders-cancellation.port.js'
import {
  PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL,
  type PharmacySuspensionReason,
} from '@/modules/onboarding/domain/pharmacy-account-entity.types.js'

export interface SuspendPharmacyInput {
  readonly pharmacyId: string
  readonly actorId: string
  readonly reason: PharmacySuspensionReason
  readonly notes: string | null
}

export interface SuspendPharmacyResult {
  readonly id: string
  readonly status: string
  readonly requiresForceCancelAction: boolean
  readonly cancelledOrderIds: readonly string[]
}

@Injectable()
export class SuspendPharmacyUseCase {
  constructor(
    @Inject(PHARMACY_ACCOUNT_REPOSITORY)
    private readonly pharmacyAccountRepository: PharmacyAccountRepositoryPort,
    @Inject(ONBOARDING_REVIEW_LOG_REPOSITORY)
    private readonly reviewLogRepository: OnboardingReviewLogRepositoryPort,
    @Inject(ORDERS_CANCELLATION)
    private readonly ordersCancellation: OrdersCancellationPort,
  ) {}

  // Повторный вызов на уже приостановленной аптеке не меняет причину и лишь дорабатывает отмену заказов.
  async execute(input: SuspendPharmacyInput): Promise<SuspendPharmacyResult> {
    const account = await this.pharmacyAccountRepository.findById(input.pharmacyId)
    if (account === null) {
      throw new Error(`PharmacyAccount not found: ${input.pharmacyId}`)
    }
    const alreadySuspended = account.status === 'suspended'
    const suspended = alreadySuspended ? account : account.suspend(input.reason, { id: input.actorId })
    const reason = suspended.suspensionReason ?? input.reason
    if (!alreadySuspended) {
      await this.pharmacyAccountRepository.save(suspended)
      await this.reviewLogRepository.append({
        pharmacyId: input.pharmacyId,
        action: 'suspend',
        actorUserId: input.actorId,
        reason: input.notes,
        checklistSnapshot: { reason },
      })
    }
    const requiresForceCancelAction = PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL.has(reason)
    // SRS-DOM-161: без force-cancel отменяются только заказы без оплаты; оплаченные идут штатным ходом.
    const cancelled = requiresForceCancelAction ? { cancelledOrderIds: [] } : await this.ordersCancellation.cancelUnpaid(input.pharmacyId)
    return {
      id: suspended.id,
      status: suspended.status,
      requiresForceCancelAction,
      cancelledOrderIds: cancelled.cancelledOrderIds,
    }
  }
}
